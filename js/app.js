import { parseWhatsappList } from './parser.js';
import {
  createConference,
  resolveSku,
  processScan,
  acceptOtherCompany,
  adjustItem,
  companyProgress,
  summary,
  gtinValid,
  cellToEan,
  fuzzyMatches,
  confirmExtra,
  enrichDescriptions,
} from './logic.js';

// Mantenha em sincronia com o CACHE do sw.js a cada publicação.
const APP_VERSION = 'v13';

// ---------- Persistência ----------
const K = { catalog: 'cc_catalogo', conf: 'cc_conferencia', hist: 'cc_historico' };

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

let catalog = load(K.catalog, {});
let conf = load(K.conf, null);
let history = load(K.hist, []);
// Nomes de produtos aprendidos de listas antigas (a lista nova vem sem descrição).
let descricoes = load('cc_descricoes', {});

const $ = (sel) => document.querySelector(sel);

// ---------- Navegação ----------
const VIEWS = ['nova', 'conferencia', 'cadastro', 'historico'];

function goto(view) {
  VIEWS.forEach((v) => $(`#view-${v}`).classList.toggle('hidden', v !== view));
  document.querySelectorAll('#navbar button').forEach((b) => {
    b.classList.toggle('active', b.dataset.goto === view);
  });
  if (view === 'conferencia') renderConferencia();
  if (view === 'cadastro') renderCadastro();
  if (view === 'historico') renderHistorico();
  if (view !== 'conferencia') stopScanner();
}

document.body.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-goto]');
  if (btn) goto(btn.dataset.goto);
});

// ---------- Feedback (flash + som) ----------
let audioCtx = null;

function ensureAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function beep(ok) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = ok ? 1400 : 200;
  gain.gain.setValueAtTime(ok ? 0.25 : 0.4, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + (ok ? 0.15 : 0.4));
  osc.start(t);
  osc.stop(t + (ok ? 0.15 : 0.4));
}

// Três notas subindo: som de empresa 100% conferida.
function beepComplete() {
  if (!audioCtx) return;
  [660, 880, 1320].forEach((freq, i) => {
    const t = audioCtx.currentTime + i * 0.16;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.start(t);
    osc.stop(t + 0.15);
  });
}

// Se a empresa chegou a 100%, celebra e retorna true.
function celebrarSeCompleta(company) {
  const { scanned, total } = companyProgress(company);
  if (!total || scanned < total) return false;
  beepComplete();
  showUltimoBipe('ok', `🎉 ${company.name} completa! (${total}/${total})`, 'Todos os itens desta empresa foram conferidos.');
  return true;
}

let flashTimer = null;
function flash(ok) {
  const el = $('#flash');
  el.className = ok ? 'ok' : 'erro';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.className = ''; }, 350);
}

function showUltimoBipe(tipo, titulo, detalhe) {
  const el = $('#ultimo-bipe');
  el.className = tipo;
  el.innerHTML = `<strong>${esc(titulo)}</strong>${detalhe ? esc(detalhe) : ''}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Diálogos ----------
function openDialog(html) {
  $('#dialogo').innerHTML = html;
  $('#overlay').classList.remove('hidden');
}
function closeDialog() {
  $('#overlay').classList.add('hidden');
  $('#dialogo').innerHTML = '';
}
$('#overlay').addEventListener('click', (e) => {
  if (e.target.id === 'overlay') closeDialog();
});

// ---------- Nova conferência ----------
$('#btn-montar').addEventListener('click', () => {
  const text = $('#nova-texto').value;
  const parsed = parseWhatsappList(text);
  const preview = $('#nova-preview');

  if (!parsed.companies.length) {
    preview.classList.remove('hidden');
    preview.innerHTML = '<div class="aviso-linhas">Nenhum item reconhecido. Verifique se o texto está no formato "1 - SKU descrição".</div>';
    return;
  }

  let html = '';
  if (parsed.unparsed.length) {
    html += `<div class="aviso-linhas">Linhas não reconhecidas (serão ignoradas):<br>${parsed.unparsed.map(esc).join('<br>')}</div>`;
  }
  for (const c of parsed.companies) {
    const units = c.items.reduce((s, i) => s + i.qty, 0);
    html += `<div class="empresa-resumo"><strong>${esc(c.name)}</strong> — ${c.items.length} produtos, ${units} unidades</div>`;
  }
  html += '<button id="btn-iniciar" class="btn-primary">Iniciar conferência</button>';
  preview.classList.remove('hidden');
  preview.innerHTML = html;

  $('#btn-iniciar').addEventListener('click', () => {
    if (conf && !window.confirm('Já existe uma conferência em andamento. Descartar e começar outra?')) return;
    enrichDescriptions(parsed, descricoes);
    save('cc_descricoes', descricoes);
    conf = createConference(parsed, new Date().toISOString());
    save(K.conf, conf);
    $('#nova-texto').value = '';
    preview.classList.add('hidden');
    preview.innerHTML = '';
    goto('conferencia');
  });
});

// ---------- Conferência ----------
function renderConferencia() {
  const vazia = $('#conf-vazia');
  const conteudo = $('#conf-conteudo');
  if (!conf) {
    vazia.classList.remove('hidden');
    conteudo.classList.add('hidden');
    return;
  }
  vazia.classList.add('hidden');
  conteudo.classList.remove('hidden');

  const abas = $('#conf-abas');
  abas.innerHTML = '';
  conf.companies.forEach((c, idx) => {
    const { scanned, total } = companyProgress(c);
    const pct = total ? Math.round((scanned / total) * 100) : 0;
    const b = document.createElement('button');
    b.className = idx === conf.active ? 'active' : '';
    b.innerHTML = `${esc(c.name)}<span class="tab-prog">${scanned}/${total}</span><span class="tab-bar"><span style="width:${pct}%"></span></span>`;
    b.addEventListener('click', () => {
      conf.active = idx;
      save(K.conf, conf);
      renderConferencia();
    });
    abas.appendChild(b);
  });

  const lista = $('#conf-lista');
  lista.innerHTML = '';
  const company = conf.companies[conf.active];
  // Pendentes primeiro; conferidos descem para o fim (ordem original dentro de cada grupo).
  const itensOrdenados = [...company.items].sort((a, b) => (a.scanned >= a.qty) - (b.scanned >= b.qty));
  itensOrdenados.forEach((item) => {
    const li = document.createElement('li');
    li.className = item.scanned >= item.qty ? 'done' : item.scanned > 0 ? 'partial' : '';
    li.innerHTML = `
      <div class="item-info">
        <div class="item-sku">${esc(item.sku)}</div>
        <div class="item-desc">${esc(item.description)}</div>
      </div>
      <div class="item-count">${item.scanned}/${item.qty}</div>`;
    li.addEventListener('click', () => openItemDialog(conf.active, item.sku));
    lista.appendChild(li);
  });
}

function openItemDialog(companyIdx, sku) {
  const item = conf.companies[companyIdx].items.find((i) => i.sku === sku);
  if (!item) return;
  openDialog(`
    <h2>${esc(item.sku)}</h2>
    <p>${esc(item.description)}</p>
    <p style="margin-top:6px"><strong>${item.scanned}/${item.qty}</strong> unidades conferidas</p>
    <div class="dialogo-acoes">
      <button id="dlg-menos">−1</button>
      <button id="dlg-mais">+1</button>
    </div>
    <div class="dialogo-acoes">
      <button id="dlg-tudo">Marcar tudo</button>
      <button id="dlg-zero">Zerar</button>
    </div>
    <div class="dialogo-acoes"><button id="dlg-fechar">Fechar</button></div>`);
  const apply = (action) => {
    adjustItem(conf, companyIdx, sku, action);
    save(K.conf, conf);
    renderConferencia();
    closeDialog();
  };
  $('#dlg-menos').addEventListener('click', () => apply(-1));
  $('#dlg-mais').addEventListener('click', () => apply(+1));
  $('#dlg-tudo').addEventListener('click', () => apply('all'));
  $('#dlg-zero').addEventListener('click', () => apply('zero'));
  $('#dlg-fechar').addEventListener('click', closeDialog);
}

// ---------- Bipagem ----------
let unknownPending = '';
let unknownPendingTime = 0;

function handleCode(code, fromCamera = false) {
  if (!conf) return;
  if (gtinValid(code) === false) {
    flash(false);
    beep(false);
    showUltimoBipe('erro', 'Leitura inválida — bipe de novo', `O código ${code} tem dígito verificador errado.`);
    $('#ultimo-bipe').classList.remove('hidden');
    return;
  }
  const sku = resolveSku(catalog, code, conf);
  if (!sku) {
    flash(false);
    beep(false);
    // Pela câmera, código desconhecido precisa ser lido de novo antes de
    // abrir o cadastro — leitura embaçada quase nunca erra igual duas vezes.
    if (fromCamera && !(unknownPending === code && Date.now() - unknownPendingTime < 15000)) {
      unknownPending = code;
      unknownPendingTime = Date.now();
      showUltimoBipe('aviso', 'Código desconhecido — bipe de novo para confirmar', code);
      $('#ultimo-bipe').classList.remove('hidden');
      return;
    }
    unknownPending = '';
    openUnknownDialog(code);
    return;
  }
  applyScan(sku);
}

function applyScan(sku) {
  const r = processScan(conf, sku);
  save(K.conf, conf);

  if (r.status === 'ok') {
    flash(true);
    if (celebrarSeCompleta(r.company)) {
      // som e aviso especiais já emitidos por celebrarSeCompleta
    } else {
      beep(true);
      showUltimoBipe('ok', `${r.item.sku} conferido (${r.item.scanned}/${r.item.qty})${r.complete ? ' ✓ completo' : ''}`, r.item.description);
    }
  } else if (r.status === 'excess') {
    beep(false);
    const unidades = r.item.qty === 1 ? 'A lista prevê 1 unidade, já conferida' : `A lista prevê ${r.item.qty} unidades, todas já conferidas`;
    showUltimoBipe('aviso', `${r.item.sku}: bipe além do previsto`, r.item.description);
    openDialog(`
      <h2>Unidade além do previsto</h2>
      <p><strong>${esc(r.item.sku)}</strong> — ${esc(r.item.description)}</p>
      <p style="margin-top:6px">${unidades}. O que aconteceu?</p>
      <div class="dialogo-acoes">
        <button id="dlg-duplicado">Foi bipe duplicado — ignorar</button>
      </div>
      <div class="dialogo-acoes">
        <button id="dlg-extra">Veio 1 unidade a mais — registrar</button>
      </div>`);
    $('#dlg-duplicado').addEventListener('click', () => {
      closeDialog();
      showUltimoBipe('ok', `${r.item.sku}: bipe duplicado ignorado`, r.item.description);
    });
    $('#dlg-extra').addEventListener('click', () => {
      confirmExtra(conf, r.item.sku, r.item.description);
      save(K.conf, conf);
      closeDialog();
      showUltimoBipe('aviso', `${r.item.sku}: 1 unidade a mais registrada`, 'Vai aparecer no resumo em "Bipados a mais".');
      renderConferencia();
    });
  } else if (r.status === 'not-in-list') {
    flash(false);
    beep(false);
    showUltimoBipe('erro', `${sku} não está na lista de hoje`, '');
  } else if (r.status === 'other-company') {
    beep(false);
    showUltimoBipe('aviso', `${r.item.sku} está na lista da ${r.company.name}`, r.item.description);
    openOtherCompanyDialog(r);
  }
  $('#ultimo-bipe').classList.remove('hidden');
  renderConferencia();
}

function openOtherCompanyDialog(r) {
  openDialog(`
    <h2>Produto de outra empresa</h2>
    <p><strong>${esc(r.item.sku)}</strong> — ${esc(r.item.description)}</p>
    <p style="margin-top:6px">Este item está na lista da <strong>${esc(r.company.name)}</strong> (${r.item.scanned}/${r.item.qty}).</p>
    <div class="dialogo-acoes">
      <button id="dlg-cancelar">Cancelar</button>
      <button id="dlg-marcar" class="btn-primary" style="margin-top:0">Marcar na ${esc(r.company.name)}</button>
    </div>`);
  $('#dlg-marcar').addEventListener('click', () => {
    const res = acceptOtherCompany(conf, r.companyIdx, r.item.sku);
    save(K.conf, conf);
    closeDialog();
    if (res) {
      flash(true);
      if (!celebrarSeCompleta(res.company)) {
        beep(true);
        showUltimoBipe('ok', `${res.item.sku} conferido na ${res.company.name} (${res.item.scanned}/${res.item.qty})`, res.item.description);
      }
      $('#ultimo-bipe').classList.remove('hidden');
    }
    renderConferencia();
  });
  $('#dlg-cancelar').addEventListener('click', closeDialog);
}

function openUnknownDialog(code) {
  const pendentes = [];
  conf.companies.forEach((c, idx) => {
    c.items.forEach((i) => {
      if (i.scanned < i.qty) pendentes.push({ companyIdx: idx, companyName: c.name, item: i });
    });
  });
  const opcoes = pendentes.length
    ? pendentes.map((p, n) => `
        <button class="opcao-sku" data-n="${n}">
          <strong>${esc(p.item.sku)}</strong> · ${esc(p.companyName)}
          <small>${esc(p.item.description)}</small>
        </button>`).join('')
    : '<p>Não há itens pendentes na lista.</p>';
  const parecidos = fuzzyMatches(catalog, code);
  const avisoParecido = parecidos.length
    ? `<div style="background:var(--ambar-claro);color:var(--ambar);border-radius:10px;padding:10px;font-size:13px;margin-top:10px">
        Atenção: esse código é parecido com ${parecidos.map((p) => `<strong>${esc(p.sku)}</strong> (${esc(p.ean)})`).join(' e ')} do cadastro.
        Pode ser uma leitura imperfeita da câmera — o mais seguro é cancelar e bipar de novo.</div>`
    : '';
  openDialog(`
    <h2>Código não cadastrado</h2>
    <p>O código <strong>${esc(code)}</strong> não está no cadastro. Ele é de qual produto?</p>
    ${avisoParecido}
    <input id="dlg-filtro" type="search" placeholder="Buscar SKU ou nome do produto" style="margin-top:10px" />
    <div style="margin-top:10px">${opcoes}</div>
    <div class="dialogo-acoes"><button id="dlg-cancelar">Cancelar</button></div>`);
  document.querySelectorAll('#dialogo .opcao-sku').forEach((b) => {
    b.addEventListener('click', () => {
      const p = pendentes[Number(b.dataset.n)];
      catalog[String(code).trim()] = { sku: p.item.sku, manual: true };
      save(K.catalog, catalog);
      closeDialog();
      applyScan(p.item.sku);
    });
  });
  $('#dlg-filtro').addEventListener('input', () => {
    const termo = $('#dlg-filtro').value.trim().toUpperCase();
    document.querySelectorAll('#dialogo .opcao-sku').forEach((b) => {
      const p = pendentes[Number(b.dataset.n)];
      const alvo = `${p.item.sku} ${p.item.description}`.toUpperCase();
      b.style.display = !termo || alvo.includes(termo) ? '' : 'none';
    });
  });
  $('#dlg-cancelar').addEventListener('click', closeDialog);
}

// Entrada manual
$('#form-manual').addEventListener('submit', (e) => {
  e.preventDefault();
  ensureAudio();
  const code = $('#input-manual').value.trim();
  if (!code) return;
  $('#input-manual').value = '';
  handleCode(code);
});

// ---------- Leitor Bluetooth (modo teclado) ----------
// Leitores físicos "digitam" o código e mandam Enter. Captura global:
// funciona sem precisar tocar no campo de digitação antes de bipar.
let wedgeBuf = '';
let wedgeLast = 0;

document.addEventListener('keydown', (e) => {
  if (!conf || $('#view-conferencia').classList.contains('hidden')) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  const now = Date.now();
  if (now - wedgeLast > 300) wedgeBuf = '';
  wedgeLast = now;
  if (e.key === 'Enter') {
    if (wedgeBuf.length >= 4) {
      ensureAudio();
      handleCode(wedgeBuf);
    }
    wedgeBuf = '';
  } else if (e.key.length === 1) {
    wedgeBuf += e.key;
  }
});

// ---------- Scanner (câmera) ----------
let scanner = null;
let scannerOn = false;
let lastCode = '';
let lastTime = 0;
let candidate = '';
let candidateCount = 0;

// Só os formatos que o fornecedor usa: menos hipóteses para o decodificador
// significa leitura mais rápida e menos leituras erradas.
const SCAN_FORMATS = typeof Html5QrcodeSupportedFormats !== 'undefined'
  ? [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.CODE_128,
    ]
  : undefined;

$('#btn-scanner').addEventListener('click', async () => {
  ensureAudio();
  if (scannerOn) {
    stopScanner();
    return;
  }
  if (typeof Html5Qrcode === 'undefined') {
    showUltimoBipe('erro', 'Leitor não carregou. Verifique a internet e recarregue a página.', '');
    $('#ultimo-bipe').classList.remove('hidden');
    return;
  }
  try {
    $('#reader').classList.remove('hidden');
    scanner = new Html5Qrcode('reader', {
      formatsToSupport: SCAN_FORMATS,
      verbose: false,
      // Usa o decodificador nativo do sistema quando o navegador oferece —
      // mais preciso que o genérico, principalmente em códigos pequenos.
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
    await scanner.start(
      { facingMode: 'environment' },
      {
        fps: 15,
        qrbox: (w, h) => ({ width: Math.min(320, Math.floor(w * 0.85)), height: 150 }),
        // Full HD puro: pedir aspecto quadrado junto muda o modo da câmera
        // no iOS (imagem escura e leitura pior). A janela compacta fica por
        // conta do corte visual no CSS (#reader com max-height).
        videoConstraints: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      },
      (decoded) => {
        const now = Date.now();
        if (decoded === lastCode && now - lastTime < 2500) return;
        // Leitura com dígito verificador inválido é descartada (câmera leu errado).
        if (gtinValid(decoded) === false) return;
        // Exige duas leituras iguais seguidas antes de aceitar — elimina
        // os EANs com o primeiro dígito trocado por leitura ruim.
        if (decoded === candidate) candidateCount++;
        else { candidate = decoded; candidateCount = 1; }
        if (candidateCount < 2) return;
        candidate = '';
        candidateCount = 0;
        lastCode = decoded;
        lastTime = now;
        handleCode(decoded, true);
      },
      () => {}
    );
    scannerOn = true;
    $('#btn-scanner').textContent = 'Parar câmera';
    // Zoom e foco contínuo ajudam com códigos de barras pequenos.
    try {
      const caps = scanner.getRunningTrackCapabilities();
      if (caps && Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
        await scanner.applyVideoConstraints({ advanced: [{ focusMode: 'continuous' }] });
      }
      if (caps && caps.zoom) {
        montarCardsZoom(caps.zoom);
        const salvo = Number(localStorage.getItem('cc_zoom')) || 2;
        await aplicarZoom(salvo);
      }
    } catch { /* nem todo aparelho suporta; segue sem zoom */ }
  } catch (err) {
    $('#reader').classList.add('hidden');
    showUltimoBipe('erro', 'Não foi possível abrir a câmera', 'Permita o acesso à câmera nos ajustes do Safari e tente de novo.');
    $('#ultimo-bipe').classList.remove('hidden');
    scanner = null;
  }
});

// Cards de zoom: um toque por nível, na zona do polegar.
function montarCardsZoom(capsZoom) {
  const minZ = Math.max(1, Math.ceil(capsZoom.min || 1));
  const maxZ = Math.min(5, Math.floor(capsZoom.max || 5));
  const controle = $('#zoom-controle');
  controle.innerHTML = '';
  for (let z = minZ; z <= maxZ; z++) {
    const b = document.createElement('button');
    b.textContent = `${z}x`;
    b.dataset.zoom = z;
    b.addEventListener('click', () => aplicarZoom(z));
    controle.appendChild(b);
  }
  controle.classList.remove('hidden');
}

async function aplicarZoom(valor) {
  if (!scanner || !scannerOn) return;
  const cards = document.querySelectorAll('#zoom-controle button');
  let efetivo = valor;
  if (cards.length) {
    const niveis = [...cards].map((b) => Number(b.dataset.zoom));
    efetivo = niveis.reduce((melhor, z) => (Math.abs(z - valor) < Math.abs(melhor - valor) ? z : melhor), niveis[0]);
    cards.forEach((b) => b.classList.toggle('active', Number(b.dataset.zoom) === efetivo));
  }
  localStorage.setItem('cc_zoom', String(efetivo));
  try {
    await scanner.applyVideoConstraints({ advanced: [{ zoom: efetivo }] });
  } catch { /* aparelho sem suporte a zoom via web */ }
}

function stopScanner() {
  if (scanner && scannerOn) {
    scanner.stop().catch(() => {});
  }
  scanner = null;
  scannerOn = false;
  const reader = $('#reader');
  if (reader) {
    reader.classList.add('hidden');
    reader.innerHTML = '';
  }
  const zoom = $('#zoom-controle');
  if (zoom) zoom.classList.add('hidden');
  const btn = $('#btn-scanner');
  if (btn) btn.textContent = 'Bipar com a câmera';
}

// ---------- Resumo / finalizar ----------
$('#btn-finalizar').addEventListener('click', () => {
  if (!conf) return;
  const s = summary(conf);
  let html = `<h2>Resumo da conferência</h2>
    <div class="resumo-grid">
      <div class="resumo-box ok"><div class="num">${s.totalScanned}</div><div class="rot">conferidas</div></div>
      <div class="resumo-box falta"><div class="num">${s.totalMissing}</div><div class="rot">faltando</div></div>
    </div>`;
  for (const c of s.companies) {
    html += `<div class="resumo-secao"><h3>${esc(c.name)} — ${c.scanned}/${c.total}</h3>`;
    if (c.missing.length) {
      html += `<ul>${c.missing.map((m) => `<li class="falta"><strong>${esc(m.sku)}</strong> falta ${m.remaining} de ${m.qty}<br><small>${esc(m.description)}</small></li>`).join('')}</ul>`;
    } else {
      html += '<ul><li>Tudo conferido ✓</li></ul>';
    }
    html += '</div>';
  }
  if (s.extras.length) {
    html += `<div class="resumo-secao"><h3>Bipados a mais</h3><ul>${s.extras.map((x) => `<li class="extra"><strong>${esc(x.sku)}</strong> ${x.count}x a mais</li>`).join('')}</ul></div>`;
  }
  html += `
    <div class="dialogo-acoes">
      <button id="dlg-voltar">Voltar</button>
      <button id="dlg-salvar" class="btn-primary" style="margin-top:0">Finalizar e salvar</button>
    </div>`;
  openDialog(html);
  $('#dlg-voltar').addEventListener('click', closeDialog);
  $('#dlg-salvar').addEventListener('click', () => {
    history.unshift({ startedAt: conf.startedAt, finishedAt: new Date().toISOString(), resultado: s });
    save(K.hist, history);
    conf = null;
    save(K.conf, conf);
    closeDialog();
    stopScanner();
    goto('historico');
  });
});

// ---------- Cadastro ----------
function renderCadastro() {
  const count = Object.keys(catalog).length;
  $('#cadastro-status').textContent = count
    ? `${count} códigos cadastrados.`
    : 'Nenhum código cadastrado ainda. Importe a planilha do fornecedor (colunas com SKU e código de barras).';
  renderCadastroLista();
}

function renderCadastroLista() {
  const busca = $('#cadastro-busca').value.trim().toUpperCase();
  const lista = $('#cadastro-lista');
  const entries = Object.entries(catalog)
    .filter(([ean, v]) => !busca || ean.includes(busca) || v.sku.toUpperCase().includes(busca))
    .slice(0, 50);
  lista.innerHTML = entries
    .map(([ean, v]) => `
      <li>
        <div class="item-info">
          <div class="item-sku">${esc(v.sku)}${v.manual ? ' · manual' : ''}</div>
          <div class="item-desc">${esc(ean)}</div>
        </div>
      </li>`)
    .join('') || '<li><div class="item-info"><div class="item-desc">Nada encontrado.</div></div></li>';
}

$('#cadastro-busca').addEventListener('input', renderCadastroLista);

$('#btn-exportar-cadastro').addEventListener('click', () => {
  const entries = Object.entries(catalog);
  if (!entries.length) {
    $('#cadastro-status').textContent = 'Nada para exportar: o cadastro está vazio.';
    return;
  }
  const csv = 'SKU;CODIGO_BARRAS\n' + entries.map(([ean, v]) => `${v.sku};${ean}`).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cadastro-conferencia.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
});

$('#btn-limpar-cadastro').addEventListener('click', () => {
  if (!window.confirm('Apagar TODO o cadastro de códigos? Essa ação não tem volta.')) return;
  catalog = {};
  save(K.catalog, catalog);
  renderCadastro();
});

function onlyDigits(v) {
  return String(v ?? '').replace(/\D/g, '');
}

// Importação de planilha com mapeamento de colunas
$('#input-planilha').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  if (typeof XLSX === 'undefined') {
    $('#cadastro-status').textContent = 'Leitor de planilhas não carregou. Verifique a internet e recarregue.';
    return;
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length || rows.length < 2) {
    $('#cadastro-status').textContent = 'Planilha vazia ou sem linhas de dados.';
    return;
  }
  const headers = rows[0].map((h, i) => String(h || `Coluna ${i + 1}`));
  const norm = headers.map((h) => h.toLowerCase());
  const guessSku = norm.findIndex((h) => h.includes('sku') || h.includes('referê') || h.includes('refer'));
  const guessEan = norm.findIndex((h) => h.includes('ean') || h.includes('gtin') || h.includes('barra') || h.includes('código de barras'));

  const options = (sel) => headers.map((h, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(h)}</option>`).join('');
  const mapa = $('#mapeamento');
  mapa.classList.remove('hidden');
  mapa.innerHTML = `
    <p><strong>${esc(file.name)}</strong> — ${rows.length - 1} linhas. Confirme as colunas:</p>
    <p style="margin-top:8px">Coluna do SKU:<br><select id="sel-sku" style="width:100%;font-size:16px;padding:8px">${options(guessSku >= 0 ? guessSku : 0)}</select></p>
    <p style="margin-top:8px">Coluna do código de barras:<br><select id="sel-ean" style="width:100%;font-size:16px;padding:8px">${options(guessEan >= 0 ? guessEan : 1)}</select></p>
    <div class="dialogo-acoes">
      <button id="btn-cancelar-import">Cancelar</button>
      <button id="btn-confirmar-import" class="btn-primary" style="margin-top:0">Importar</button>
    </div>`;

  $('#btn-cancelar-import').addEventListener('click', () => {
    mapa.classList.add('hidden');
    mapa.innerHTML = '';
  });
  $('#btn-confirmar-import').addEventListener('click', () => {
    const skuIdx = Number($('#sel-sku').value);
    const eanIdx = Number($('#sel-ean').value);
    let added = 0;
    let skipped = 0;
    let suspeitos = 0;
    for (let i = 1; i < rows.length; i++) {
      const sku = String(rows[i][skuIdx] ?? '').trim().toUpperCase();
      const ean = cellToEan(rows[i][eanIdx]);
      if (!sku || ean.length < 6) { skipped++; continue; }
      if (gtinValid(ean) === false) suspeitos++;
      if (catalog[ean]?.manual && catalog[ean].sku !== sku) continue;
      catalog[ean] = { sku };
      added++;
    }
    save(K.catalog, catalog);
    mapa.classList.add('hidden');
    mapa.innerHTML = '';
    let msg = `Importação concluída: ${added} códigos gravados${skipped ? `, ${skipped} linhas ignoradas` : ''}. Total: ${Object.keys(catalog).length}.`;
    if (suspeitos) msg += ` Atenção: ${suspeitos} códigos não parecem EAN válidos — confira se a coluna escolhida é mesmo a do código de barras.`;
    $('#cadastro-status').textContent = msg;
    renderCadastroLista();
  });
});

// Colar texto SKU/EAN
$('#btn-colar-cadastro').addEventListener('click', () => {
  const lines = $('#cadastro-texto').value.split(/\r?\n/);
  let added = 0;
  for (const line of lines) {
    const parts = line.split(/[;,\t]+|\s{2,}|\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const eanPart = parts.find((p) => /^\d{6,}$/.test(onlyDigits(p)) && onlyDigits(p) === p.replace(/\s/g, ''));
    const skuPart = parts.find((p) => p !== eanPart);
    if (!eanPart || !skuPart) continue;
    catalog[onlyDigits(eanPart)] = { sku: skuPart.toUpperCase(), manual: true };
    added++;
  }
  save(K.catalog, catalog);
  $('#cadastro-texto').value = '';
  $('#cadastro-status').textContent = `${added} códigos adicionados. Total: ${Object.keys(catalog).length}.`;
  renderCadastroLista();
});

// ---------- Histórico ----------
function renderHistorico() {
  const el = $('#historico-lista');
  if (!history.length) {
    el.innerHTML = '<div class="empty-state"><p>Nenhuma conferência salva ainda.</p></div>';
    return;
  }
  el.innerHTML = history
    .map((h, idx) => {
      const d = new Date(h.finishedAt);
      const data = d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const s = h.resultado;
      const falta = s.companies
        .flatMap((c) => c.missing.map((m) => `<li class="falta"><strong>${esc(m.sku)}</strong> (${esc(c.name)}) faltou ${m.remaining} de ${m.qty}</li>`))
        .join('');
      const extras = (s.extras || []).map((x) => `<li class="extra"><strong>${esc(x.sku)}</strong> ${x.count}x a mais</li>`).join('');
      return `
        <details class="card hist-item">
          <summary>${data} — ${s.totalScanned}/${s.total} ${s.totalMissing ? `(${s.totalMissing} faltando)` : '✓ completo'}</summary>
          <div class="hist-meta">${s.companies.map((c) => `${esc(c.name)}: ${c.scanned}/${c.total}`).join(' · ')}</div>
          <div class="resumo-secao"><ul>${falta || '<li>Nada faltou ✓</li>'}${extras}</ul></div>
          <button class="btn-danger-ghost" data-del-hist="${idx}" style="margin-top:8px">Excluir do histórico</button>
        </details>`;
    })
    .join('');
  el.querySelectorAll('[data-del-hist]').forEach((b) => {
    b.addEventListener('click', () => {
      if (!window.confirm('Excluir esta conferência do histórico?')) return;
      history.splice(Number(b.dataset.delHist), 1);
      save(K.hist, history);
      renderHistorico();
    });
  });
}

// ---------- Service worker ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker
    .register('sw.js')
    .then((reg) => reg.update())
    .catch(() => {});
  // Quando uma versão nova assume, recarrega uma vez para aplicá-la já.
  const tinhaControlador = !!navigator.serviceWorker.controller;
  let recarregou = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!tinhaControlador || recarregou) return;
    recarregou = true;
    location.reload();
  });
}

// Pede ao sistema para não apagar os dados do app (cadastro, histórico).
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

// ---------- Início ----------
$('#versao-app').textContent = `Conferência de Coleta — versão ${APP_VERSION}`;
goto(conf ? 'conferencia' : 'nova');
