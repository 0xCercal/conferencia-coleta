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
  undoLastScan,
  isSkuOutlet,
  limparOutlet,
} from './logic.js';

// Mantenha em sincronia com o CACHE do sw.js a cada publicação.
const APP_VERSION = 'v29';

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

// Limpeza única de SKUs de outlet: quem importou antes da v26 tem códigos
// apontando para o SKU de outlet, que nunca aparece na lista do dia.
let outletRemovidos = 0;
if (!localStorage.getItem('cc_outlet_limpo')) {
  outletRemovidos = limparOutlet(catalog).length;
  if (outletRemovidos) save(K.catalog, catalog);
  localStorage.setItem('cc_outlet_limpo', '1');
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function plural(n, um, varios) {
  return `${n} ${n === 1 ? um : varios}`;
}

function onlyDigits(v) {
  return String(v ?? '').replace(/\D/g, '');
}

// ---------- Navegação ----------
const VIEWS = ['nova', 'conferencia', 'cadastro', 'historico'];

function goto(view) {
  VIEWS.forEach((v) => $(`#view-${v}`).classList.toggle('hidden', v !== view));
  $$('#navbar button').forEach((b) => {
    const ativo = b.dataset.goto === view;
    b.classList.toggle('active', ativo);
    if (ativo) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  fecharTeclado();
  $('#views').scrollTop = 0;
  if (view === 'nova') renderNova();
  if (view === 'conferencia') renderConferencia();
  if (view === 'cadastro') renderCadastro();
  if (view === 'historico') renderHistorico();
  if (view !== 'conferencia') stopScanner();
  atualizarNav();
}

// Ponto na aba Conferir enquanto existe conferência em andamento.
function atualizarNav() {
  $('#navbar [data-goto="conferencia"]').classList.toggle('tem-conf', !!conf);
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
  showUltimoBipe('ok', `${company.name} completa! (${total}/${total})`, 'Todos os itens desta empresa foram conferidos.', '★');
  return true;
}

let flashTimer = null;
function flash(ok) {
  const el = $('#flash');
  el.className = ok ? 'ok' : 'erro';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.className = ''; }, 350);
}

const ICONES_BIPE = { ok: '✓', erro: '✕', aviso: '!', neutro: '↺' };

function showUltimoBipe(tipo, titulo, detalhe, icone) {
  const el = $('#ultimo-bipe');
  el.className = tipo;
  el.innerHTML =
    `<span class="bipe-ico" aria-hidden="true">${icone || ICONES_BIPE[tipo] || ''}</span>` +
    `<span class="bipe-texto"><strong>${esc(titulo)}</strong>${detalhe ? `<span>${esc(detalhe)}</span>` : ''}</span>`;
  // Reinicia a animação a cada bipe: dois bipes iguais seguidos ainda "piscam".
  void el.offsetWidth;
  el.classList.add('pulso');
}

function limparUltimoBipe() {
  const el = $('#ultimo-bipe');
  el.className = 'hidden';
  el.innerHTML = '';
}

// ---------- Folha de diálogo ----------
function openDialog(html, classe = '') {
  const d = $('#dialogo');
  d.className = classe;
  d.innerHTML = html;
  d.scrollTop = 0;
  $('#overlay').classList.remove('hidden');
}
function closeDialog() {
  if (tecladoAlvo && $('#dialogo').contains(tecladoAlvo)) fecharTeclado();
  $('#overlay').classList.add('hidden');
  $('#dialogo').innerHTML = '';
}
$('#overlay').addEventListener('click', (e) => {
  if (e.target.id === 'overlay') closeDialog();
});

// ---------- Confirmação (substitui o confirm() do navegador) ----------
function confirmar({ titulo, mensagem, acao = 'Confirmar', perigo = false }) {
  return new Promise((resolve) => {
    const box = $('#confirmacao');
    box.innerHTML = `
      <div class="confirm-card" role="alertdialog" aria-modal="true">
        <h2>${esc(titulo)}</h2>
        <p>${esc(mensagem)}</p>
        <div class="confirm-acoes">
          <button type="button" data-r="0">Cancelar</button>
          <button type="button" data-r="1" class="${perigo ? 'btn-perigo' : 'btn-primary'}">${esc(acao)}</button>
        </div>
      </div>`;
    box.classList.remove('hidden');
    const fim = (ok) => {
      box.classList.add('hidden');
      box.innerHTML = '';
      box.onclick = null;
      resolve(ok);
    };
    box.onclick = (e) => {
      const b = e.target.closest('button[data-r]');
      if (b) fim(b.dataset.r === '1');
      else if (e.target === box) fim(false);
    };
  });
}

// ---------- Aviso rápido ----------
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('visivel');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visivel'), 3200);
}

// ---------- Nova conferência ----------
let parsedNova = null;

function renderNova() {
  const el = $('#nova-andamento');
  if (!conf) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  const s = summary(conf);
  el.innerHTML = `
    <div>
      <strong>${conf.isTest ? 'Teste em andamento' : 'Conferência em andamento'}</strong>
      <span>${s.totalScanned} de ${plural(s.total, 'unidade conferida', 'unidades conferidas')}</span>
    </div>
    <button type="button" class="btn-tonal btn-compacto" data-goto="conferencia">Continuar</button>`;
  el.classList.remove('hidden');
}

// A prévia acompanha o texto: colou, já mostra o que foi entendido.
function atualizarPreviaNova() {
  const text = $('#nova-texto').value;
  const preview = $('#nova-preview');
  const btn = $('#btn-iniciar');
  $('#btn-limpar-lista').classList.toggle('hidden', !text);
  parsedNova = null;

  if (!text.trim()) {
    preview.classList.add('hidden');
    preview.innerHTML = '';
    btn.disabled = true;
    return;
  }

  const parsed = parseWhatsappList(text);
  preview.classList.remove('hidden');
  if (!parsed.companies.length) {
    preview.innerHTML = '<div class="aviso-linhas"><strong>Nenhum item reconhecido</strong>O formato esperado é "1 - SKU" por linha, com o nome da empresa entre asteriscos.</div>';
    btn.disabled = true;
    return;
  }

  parsedNova = parsed;
  let html = parsed.companies
    .map((c) => {
      const units = c.items.reduce((s, i) => s + i.qty, 0);
      return `
        <div class="empresa-resumo">
          <div><strong>${esc(c.name)}</strong>${c.date ? `<span class="chip">${esc(c.date)}</span>` : ''}</div>
          <span class="empresa-num">${plural(c.items.length, 'produto', 'produtos')} · ${units} un.</span>
        </div>`;
    })
    .join('');
  if (parsed.unparsed.length) {
    html += `<div class="aviso-linhas"><strong>${plural(parsed.unparsed.length, 'linha ignorada', 'linhas ignoradas')}</strong>${parsed.unparsed.map(esc).join('<br>')}</div>`;
  }
  preview.innerHTML = html;
  btn.disabled = false;
}

$('#nova-texto').addEventListener('input', atualizarPreviaNova);

$('#btn-limpar-lista').addEventListener('click', () => {
  $('#nova-texto').value = '';
  atualizarPreviaNova();
});

$('#btn-colar').addEventListener('click', async () => {
  try {
    const texto = await navigator.clipboard.readText();
    if (!texto.trim()) {
      toast('A área de transferência está vazia');
      return;
    }
    $('#nova-texto').value = texto;
    atualizarPreviaNova();
  } catch {
    toast('Toque e segure na caixa de texto e escolha Colar');
    $('#nova-texto').focus();
  }
});

const AVISO_SUBSTITUIR = {
  titulo: 'Substituir a conferência atual?',
  mensagem: 'Há uma conferência em andamento. Ao começar outra, tudo que já foi bipado nela será descartado.',
  acao: 'Substituir',
  perigo: true,
};

function iniciarConferencia(parsed, teste) {
  enrichDescriptions(parsed, descricoes);
  if (!teste) save('cc_descricoes', descricoes);
  conf = createConference(parsed, new Date().toISOString());
  if (teste) conf.isTest = true;
  save(K.conf, conf);
  ultimaAssociacao = null;
  limparUltimoBipe();
  $('#nova-texto').value = '';
  atualizarPreviaNova();
  goto('conferencia');
}

$('#btn-iniciar').addEventListener('click', async () => {
  const parsed = parsedNova;
  if (!parsed) return;
  if (conf && !(await confirmar(AVISO_SUBSTITUIR))) return;
  iniciarConferencia(parsed, false);
});

// ---------- Conferência de teste ----------
// Lista fictícia com SKUs reais do fornecedor: dá para bipar produtos de
// verdade sem sujar o histórico.
const LISTA_TESTE = `*FERCRIS* — teste
1 - TB119 Torneira Monocomando Alta para Banheiro
2 - TC70 Torneira Monocomando Gourmet de Cozinha
1 - DD14 Dosador para Detergente Embutido Inox 500 ml

*CERCAL* — teste
3 - TC72 Torneira Monocomando Gourmet de Cozinha Inox (Maldivas Escovada)
1 - VC07 Válvula Click de Inox para Cubas (Cromada)`;

$('#btn-teste').addEventListener('click', async () => {
  if (conf && !(await confirmar(AVISO_SUBSTITUIR))) return;
  iniciarConferencia(parseWhatsappList(LISTA_TESTE), true);
});

// ---------- Conferência ----------
function dataDaConferencia() {
  const daLista = conf.companies.map((c) => c.date).find(Boolean);
  return daLista || new Date(conf.startedAt).toLocaleDateString('pt-BR');
}

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
  $('#badge-teste').classList.toggle('hidden', !conf.isTest);

  const s = summary(conf);
  $('#conf-resumo').textContent = `${dataDaConferencia()} · ${s.totalScanned} de ${plural(s.total, 'unidade', 'unidades')}`;

  const abas = $('#conf-abas');
  abas.innerHTML = '';
  conf.companies.forEach((c, idx) => {
    const { scanned, total } = companyProgress(c);
    const pct = total ? Math.round((scanned / total) * 100) : 0;
    const completa = total > 0 && scanned >= total;
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(idx === conf.active));
    b.className = idx === conf.active ? 'active' : '';
    b.innerHTML =
      `<span class="tab-nome">${esc(c.name)}</span>` +
      `<span class="tab-prog">${completa ? '✓ ' : ''}${scanned}/${total}</span>` +
      `<span class="tab-bar"><span style="width:${pct}%"></span></span>`;
    b.addEventListener('click', () => {
      conf.active = idx;
      save(K.conf, conf);
      renderConferencia();
    });
    abas.appendChild(b);
  });

  $('#btn-desfazer').classList.toggle('hidden', !conf.lastScan);

  // Depois de reabrir o app, mostra de novo qual foi o último bipe.
  if ($('#ultimo-bipe').classList.contains('hidden') && conf.lastScan && !conf.lastScan.extra) {
    const emp = conf.companies[conf.lastScan.companyIdx];
    const it = emp && emp.items.find((i) => i.sku === conf.lastScan.sku);
    if (it) showUltimoBipe('neutro', `Último bipe: ${it.sku} (${it.scanned}/${it.qty})`, it.description);
  }

  const lista = $('#conf-lista');
  lista.innerHTML = '';
  const company = conf.companies[conf.active];
  // Pendentes primeiro; conferidos descem para o fim (ordem original dentro de cada grupo).
  const pendentes = company.items.filter((i) => i.scanned < i.qty);
  const conferidos = company.items.filter((i) => i.scanned >= i.qty);

  const rotulo = (texto, classe = 'lista-rotulo') => {
    const li = document.createElement('li');
    li.className = classe;
    li.textContent = texto;
    lista.appendChild(li);
  };
  const linha = (item) => {
    const feito = item.scanned >= item.qty;
    const pct = item.qty ? Math.round((item.scanned / item.qty) * 100) : 0;
    const li = document.createElement('li');
    li.className = feito ? 'done' : item.scanned > 0 ? 'partial' : '';
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-label', `${item.sku}, ${item.scanned} de ${item.qty}. Ajustar`);
    li.innerHTML = `
      <span class="item-estado" style="--pct:${pct}%" aria-hidden="true"></span>
      <div class="item-info">
        <div class="item-sku">${esc(item.sku)}</div>
        ${item.description ? `<div class="item-desc">${esc(item.description)}</div>` : ''}
      </div>
      <div class="item-count">${item.scanned}/${item.qty}</div>`;
    const abrir = () => openItemDialog(conf.active, item.sku);
    li.addEventListener('click', abrir);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === li) abrir();
    });
    lista.appendChild(li);
  };

  if (!pendentes.length && conferidos.length) rotulo('Todos os itens desta empresa foram conferidos', 'lista-ok');
  if (pendentes.length) rotulo(`Pendentes · ${pendentes.length}`);
  pendentes.forEach(linha);
  if (conferidos.length) rotulo(`Conferidos · ${conferidos.length}`);
  conferidos.forEach(linha);

  atualizarNav();
}

function openItemDialog(companyIdx, sku) {
  const item = conf.companies[companyIdx].items.find((i) => i.sku === sku);
  if (!item) return;
  openDialog(`
    <h2 class="mono">${esc(item.sku)}</h2>
    ${item.description ? `<p>${esc(item.description)}</p>` : ''}
    <div class="stepper">
      <button type="button" id="dlg-menos" aria-label="Uma unidade a menos">−</button>
      <div class="stepper-valor"><strong id="dlg-valor">${item.scanned}</strong><span>de ${plural(item.qty, 'unidade', 'unidades')}</span></div>
      <button type="button" id="dlg-mais" aria-label="Uma unidade a mais">+</button>
    </div>
    <div class="dialogo-acoes">
      <button type="button" id="dlg-zero">Zerar</button>
      <button type="button" id="dlg-tudo" class="btn-primary">Marcar tudo</button>
    </div>
    <button type="button" id="dlg-fechar" class="btn-texto" style="width:100%">Fechar</button>`);

  const atualizar = () => {
    $('#dlg-valor').textContent = item.scanned;
    $('#dlg-menos').disabled = item.scanned <= 0;
    $('#dlg-mais').disabled = item.scanned >= item.qty;
  };
  // −/+ ajustam com a folha aberta; "Marcar tudo" e "Zerar" já fecham.
  const aplicar = (action, fechar) => {
    adjustItem(conf, companyIdx, sku, action);
    save(K.conf, conf);
    renderConferencia();
    if (fechar) closeDialog();
    else atualizar();
  };
  $('#dlg-menos').addEventListener('click', () => aplicar(-1, false));
  $('#dlg-mais').addEventListener('click', () => aplicar(+1, false));
  $('#dlg-tudo').addEventListener('click', () => aplicar('all', true));
  $('#dlg-zero').addEventListener('click', () => aplicar('zero', true));
  $('#dlg-fechar').addEventListener('click', closeDialog);
  atualizar();
}

// ---------- Bipagem ----------
let unknownPending = '';
let unknownPendingTime = 0;
// Associação código↔SKU criada pelo último bipe, para o desfazer poder apagá-la.
let ultimaAssociacao = null;

function handleCode(code, fromCamera = false) {
  if (!conf) return;
  // Bipe novo: a associação anterior deixa de ser a "última".
  ultimaAssociacao = null;
  if (gtinValid(code) === false) {
    flash(false);
    beep(false);
    showUltimoBipe('erro', 'Leitura inválida — bipe de novo', `O código ${code} tem dígito verificador errado.`);
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
      return;
    }
    unknownPending = '';
    openUnknownDialog(code);
    return;
  }
  applyScan(sku);
}

function cartaoItem(item) {
  return `<div class="sheet-item"><strong>${esc(item.sku)}</strong>${item.description ? `<span>${esc(item.description)}</span>` : ''}</div>`;
}

function applyScan(sku) {
  const r = processScan(conf, sku);
  save(K.conf, conf);

  if (r.status === 'ok') {
    flash(true);
    if (!celebrarSeCompleta(r.company)) {
      beep(true);
      showUltimoBipe('ok', `${r.item.sku} conferido (${r.item.scanned}/${r.item.qty})${r.complete ? ' — completo' : ''}`, r.item.description);
    }
  } else if (r.status === 'excess') {
    beep(false);
    const previsto = r.item.qty === 1 ? 'A lista prevê 1 unidade, já conferida.' : `A lista prevê ${r.item.qty} unidades, todas já conferidas.`;
    showUltimoBipe('aviso', `${r.item.sku}: bipe além do previsto`, r.item.description);
    openDialog(`
      <h2>Bipe além do previsto</h2>
      ${cartaoItem(r.item)}
      <p>${previsto} O que aconteceu?</p>
      <div class="pilha">
        <button type="button" id="dlg-duplicado" class="btn-primary">Foi bipe duplicado — ignorar</button>
        <button type="button" id="dlg-extra" class="btn-secondary">Veio 1 unidade a mais — registrar</button>
      </div>`);
    $('#dlg-duplicado').addEventListener('click', () => {
      closeDialog();
      showUltimoBipe('ok', `${r.item.sku}: bipe duplicado ignorado`, r.item.description);
    });
    $('#dlg-extra').addEventListener('click', () => {
      confirmExtra(conf, r.item.sku, r.item.description);
      save(K.conf, conf);
      closeDialog();
      showUltimoBipe('aviso', `${r.item.sku}: 1 unidade a mais registrada`, 'Vai aparecer no resumo como bipado a mais.');
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
  renderConferencia();
}

function openOtherCompanyDialog(r) {
  openDialog(`
    <h2>Produto de outra empresa</h2>
    ${cartaoItem(r.item)}
    <p>Este item está na lista da <strong>${esc(r.company.name)}</strong> (${r.item.scanned}/${r.item.qty} conferidas).</p>
    <div class="dialogo-acoes">
      <button type="button" id="dlg-cancelar">Cancelar</button>
      <button type="button" id="dlg-marcar" class="btn-primary">Marcar na ${esc(r.company.name)}</button>
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
    }
    renderConferencia();
  });
  $('#dlg-cancelar').addEventListener('click', closeDialog);
}

function openUnknownDialog(code) {
  // Itens pendentes, com os da empresa aberta primeiro (o mais provável).
  const ordem = [conf.active, ...conf.companies.map((_, i) => i).filter((i) => i !== conf.active)];
  const pendentes = [];
  ordem.forEach((idx) => {
    const c = conf.companies[idx];
    if (!c) return;
    c.items.forEach((i) => {
      if (i.scanned < i.qty) pendentes.push({ companyIdx: idx, companyName: c.name, item: i });
    });
  });
  const opcoes = pendentes.length
    ? pendentes.map((p, n) => `
        <button type="button" class="opcao-sku" data-n="${n}">
          <span class="op-sku">${esc(p.item.sku)}</span>
          <span class="chip">${esc(p.companyName)}</span>
          ${p.item.description ? `<small>${esc(p.item.description)}</small>` : ''}
        </button>`).join('')
    : '';
  const parecidos = fuzzyMatches(catalog, code);
  const avisoParecido = parecidos.length
    ? `<div class="aviso-linhas"><strong>Pode ser leitura imperfeita</strong>
        Esse código é parecido com ${parecidos.map((p) => `${esc(p.sku)} (${esc(p.ean)})`).join(' e ')}, que já está no cadastro. O mais seguro é cancelar e bipar de novo.</div>`
    : '';
  openDialog(`
    <div class="sheet-cab">
      <h2>Código não cadastrado</h2>
      <p>De qual produto é o código <strong class="mono">${esc(code)}</strong>? A escolha fica salva no cadastro.</p>
      ${avisoParecido}
      ${pendentes.length ? '<input id="dlg-filtro" type="search" inputmode="none" data-teclado autocomplete="off" placeholder="Buscar SKU ou nome do produto" aria-label="Buscar SKU ou nome do produto" />' : ''}
    </div>
    <div class="sheet-corpo">
      ${pendentes.length
        ? `<div class="opcoes">${opcoes}</div><p id="dlg-sem-resultado" class="hint centro hidden">Nenhum item pendente corresponde à busca.</p>`
        : '<p>Não há itens pendentes na lista de hoje para associar.</p>'}
    </div>
    <div class="sheet-rodape"><button type="button" id="dlg-cancelar">Cancelar</button></div>`, 'em-colunas');

  $$('#dialogo .opcao-sku').forEach((b) => {
    b.addEventListener('click', () => {
      const p = pendentes[Number(b.dataset.n)];
      const codigo = String(code).trim();
      catalog[codigo] = { sku: p.item.sku, manual: true };
      save(K.catalog, catalog);
      // Guardado para que o desfazer possa apagar a associação recém-criada.
      ultimaAssociacao = { codigo, sku: p.item.sku };
      closeDialog();
      applyScan(p.item.sku);
    });
  });
  const filtro = $('#dlg-filtro');
  if (filtro) {
    filtro.addEventListener('input', () => {
      const termo = filtro.value.trim().toUpperCase();
      let visiveis = 0;
      $$('#dialogo .opcao-sku').forEach((b) => {
        const p = pendentes[Number(b.dataset.n)];
        const alvo = `${p.item.sku} ${p.item.description}`.toUpperCase();
        const mostra = !termo || alvo.includes(termo);
        b.classList.toggle('hidden', !mostra);
        if (mostra) visiveis++;
      });
      $('#dlg-sem-resultado').classList.toggle('hidden', visiveis > 0);
    });
  }
  $('#dlg-cancelar').addEventListener('click', closeDialog);
}

$('#btn-desfazer').addEventListener('click', () => {
  if (!conf) return;
  const associacao = ultimaAssociacao;
  const r = undoLastScan(conf);
  save(K.conf, conf);
  if (!r) {
    showUltimoBipe('aviso', 'Nada para desfazer', '');
  } else if (r.extra) {
    showUltimoBipe('aviso', `${r.sku}: unidade extra desfeita`, 'Saiu do resumo de bipados a mais.');
  } else {
    let detalhe = r.item.description;
    // O bipe veio de uma associação criada agora: apaga junto, senão o
    // código erradamente associado continuaria valendo para sempre.
    if (associacao && associacao.sku === r.item.sku && catalog[associacao.codigo]) {
      delete catalog[associacao.codigo];
      save(K.catalog, catalog);
      detalhe = `Associação do código ${associacao.codigo} também foi apagada.`;
    }
    showUltimoBipe('aviso', `${r.item.sku} desfeito (${r.item.scanned}/${r.item.qty})`, detalhe);
  }
  ultimaAssociacao = null;
  renderConferencia();
});

// Entrada manual
$('#form-manual').addEventListener('submit', (e) => {
  e.preventDefault();
  ensureAudio();
  const code = $('#input-manual').value.trim();
  if (!code) return;
  $('#input-manual').value = '';
  fecharTeclado();
  handleCode(code);
});

// ---------- Teclado do app ----------
// Com o leitor Bluetooth conectado, o iOS considera que já existe teclado e
// não abre o virtual. Este teclado é do app, então funciona sempre — inclusive
// em campos criados depois, como a busca da folha de "código não cadastrado".
let tecladoAlvo = null;

(function montarTeclas() {
  $$('#teclado .teclado-linha').forEach((linha) => {
    for (const ch of linha.dataset.teclas) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = ch;
      b.dataset.tecla = ch;
      linha.appendChild(b);
    }
  });
})();

function abrirTeclado(input) {
  tecladoAlvo = input;
  const teclado = $('#teclado');
  $('#teclado-alvo-nome').textContent = input.getAttribute('placeholder') || '';
  teclado.classList.remove('hidden');
  // Quem está por baixo (tela ou folha) recua a altura exata do teclado.
  document.body.style.setProperty('--teclado-h', `${teclado.offsetHeight}px`);
  document.body.classList.add('teclado-aberto');
  input.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function fecharTeclado() {
  tecladoAlvo = null;
  $('#teclado').classList.add('hidden');
  document.body.classList.remove('teclado-aberto');
}

function escreverNoAlvo(transformar) {
  if (!tecladoAlvo) return;
  tecladoAlvo.value = transformar(tecladoAlvo.value);
  tecladoAlvo.dispatchEvent(new Event('input', { bubbles: true }));
}

function alvoDeTeclado(e) {
  const t = e.target;
  return t instanceof HTMLInputElement && t.hasAttribute('data-teclado') ? t : null;
}
document.addEventListener('focusin', (e) => {
  const input = alvoDeTeclado(e);
  if (input) abrirTeclado(input);
});
document.addEventListener('click', (e) => {
  const input = alvoDeTeclado(e);
  if (input) abrirTeclado(input);
});

$('#teclado').addEventListener('mousedown', (e) => e.preventDefault());

$('#teclado').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'teclado-fechar' || b.dataset.acao === 'ok') {
    const alvo = tecladoAlvo;
    fecharTeclado();
    if (b.dataset.acao === 'ok' && alvo && alvo.id === 'input-manual' && alvo.value.trim()) {
      $('#form-manual').dispatchEvent(new Event('submit', { cancelable: true }));
    }
    return;
  }
  if (b.dataset.tecla) escreverNoAlvo((v) => v + b.dataset.tecla);
  else if (b.dataset.acao === 'apagar') escreverNoAlvo((v) => v.slice(0, -1));
  else if (b.dataset.acao === 'limpar') escreverNoAlvo(() => '');
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
    showUltimoBipe('erro', 'Leitor não carregou', 'Verifique a internet e abra o app de novo.');
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
        // conta do CSS, que fixa a altura no próprio vídeo.
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
    b.type = 'button';
    b.textContent = `${z}x`;
    b.dataset.zoom = z;
    b.addEventListener('click', () => aplicarZoom(z));
    controle.appendChild(b);
  }
  controle.classList.remove('hidden');
}

async function aplicarZoom(valor) {
  if (!scanner || !scannerOn) return;
  const cards = $$('#zoom-controle button');
  let efetivo = valor;
  if (cards.length) {
    const niveis = cards.map((b) => Number(b.dataset.zoom));
    efetivo = niveis.reduce((melhor, z) => (Math.abs(z - valor) < Math.abs(melhor - valor) ? z : melhor), niveis[0]);
    cards.forEach((b) => b.classList.toggle('active', Number(b.dataset.zoom) === efetivo));
  }
  localStorage.setItem('cc_zoom', String(efetivo));
  try {
    await scanner.applyVideoConstraints({ advanced: [{ zoom: efetivo }] });
  } catch { /* aparelho sem suporte a zoom via web */ }
}

// Fechar o bloco da câmera desliga a câmera.
$('#camera-bloco').addEventListener('toggle', () => {
  if (!$('#camera-bloco').open) stopScanner();
});

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
function htmlFaltantes(c) {
  if (!c.missing.length) return '<ul><li class="tudo-ok">Tudo conferido</li></ul>';
  return `<ul>${c.missing
    .map((m) => `<li class="falta"><strong class="mono">${esc(m.sku)}</strong> — falta ${m.remaining} de ${m.qty}${m.description ? `<small>${esc(m.description)}</small>` : ''}</li>`)
    .join('')}</ul>`;
}

function htmlExtras(extras) {
  if (!extras || !extras.length) return '';
  return `<div class="resumo-secao"><div class="resumo-cab"><h3>Bipados a mais</h3></div><ul>${extras
    .map((x) => `<li class="extra"><strong class="mono">${esc(x.sku)}</strong> — ${x.count} a mais</li>`)
    .join('')}</ul></div>`;
}

function abrirResumo() {
  if (!conf) return;
  const s = summary(conf);
  const totalExtras = s.extras.reduce((n, x) => n + x.count, 0);
  let html = `<div class="sheet-cab"><h2>Resumo da conferência</h2></div><div class="sheet-corpo">
    <div class="resumo-grid">
      <div class="resumo-box ok"><div class="num">${s.totalScanned}</div><div class="rot">conferidas</div></div>
      <div class="resumo-box ${s.totalMissing ? 'falta' : ''}"><div class="num">${s.totalMissing}</div><div class="rot">faltando</div></div>
      ${totalExtras ? `<div class="resumo-box extra"><div class="num">${totalExtras}</div><div class="rot">a mais</div></div>` : ''}
    </div>`;
  for (const c of s.companies) {
    const pct = c.total ? Math.round((c.scanned / c.total) * 100) : 0;
    html += `<div class="resumo-secao">
      <div class="resumo-cab"><h3>${esc(c.name)}</h3><span>${c.scanned}/${c.total}</span></div>
      <div class="barra"><span style="width:${pct}%"></span></div>
      ${htmlFaltantes(c)}
    </div>`;
  }
  html += htmlExtras(s.extras);
  if (conf.isTest) html += '<p class="hint">Conferência de teste: o resultado não será salvo no histórico.</p>';
  html += `</div>
    <div class="sheet-rodape">
      <div class="dialogo-acoes">
        <button type="button" id="dlg-voltar">Voltar</button>
        <button type="button" id="dlg-salvar" class="btn-primary">${conf.isTest ? 'Encerrar teste' : 'Finalizar e salvar'}</button>
      </div>
      <button type="button" id="dlg-descartar" class="btn-texto" style="width:100%;color:var(--erro-fg)">Descartar conferência</button>
    </div>`;
  openDialog(html, 'em-colunas');

  const encerrar = (destino) => {
    conf = null;
    save(K.conf, conf);
    ultimaAssociacao = null;
    limparUltimoBipe();
    closeDialog();
    stopScanner();
    goto(destino);
  };

  $('#dlg-voltar').addEventListener('click', closeDialog);
  $('#dlg-descartar').addEventListener('click', async () => {
    const ok = await confirmar({
      titulo: 'Descartar a conferência?',
      mensagem: 'Tudo que foi bipado será perdido e nada será salvo no histórico.',
      acao: 'Descartar',
      perigo: true,
    });
    if (!ok) return;
    encerrar('nova');
    toast('Conferência descartada');
  });
  $('#dlg-salvar').addEventListener('click', () => {
    const eraTeste = conf.isTest;
    if (!eraTeste) {
      history.unshift({ startedAt: conf.startedAt, finishedAt: new Date().toISOString(), resultado: s });
      save(K.hist, history);
    }
    encerrar(eraTeste ? 'nova' : 'historico');
    toast(eraTeste ? 'Teste encerrado' : 'Conferência salva no histórico');
  });
}

$('#btn-finalizar').addEventListener('click', abrirResumo);
$('#btn-resumo-topo').addEventListener('click', abrirResumo);

// ---------- Cadastro ----------
function setCadastroStatus(msg) {
  const el = $('#cadastro-status');
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
}

function renderCadastro() {
  if (outletRemovidos) {
    setCadastroStatus(`${plural(outletRemovidos, 'código de outlet foi removido', 'códigos de outlet foram removidos')} do cadastro nesta versão.`);
    outletRemovidos = 0;
  }
  renderResumoCadastro();
  renderAvisoBackup();
  renderCadastroLista();
}

function renderResumoCadastro() {
  const total = Object.keys(catalog).length;
  const manuais = Object.values(catalog).filter((v) => v.manual).length;
  $('#cadastro-resumo').textContent = total
    ? `${plural(total, 'código', 'códigos')}${manuais ? ` · ${plural(manuais, 'manual', 'manuais')}` : ''}`
    : 'Nenhum código cadastrado';
}

// O armazenamento do app na tela de início é apagado se o app for removido
// de lá. O aviso cobra um backup enquanto ainda dá tempo.
const DIAS_BACKUP = 7;

function diasDesdeBackup() {
  const ultimo = Number(localStorage.getItem('cc_ultimo_backup')) || 0;
  return ultimo ? Math.floor((Date.now() - ultimo) / 86400000) : null;
}

function renderAvisoBackup() {
  const el = $('#aviso-backup');
  const dias = diasDesdeBackup();
  $('#backup-info').textContent =
    dias === null ? 'Nenhum backup feito ainda' : dias === 0 ? 'Último backup: hoje' : `Último backup: há ${plural(dias, 'dia', 'dias')}`;

  if (!Object.keys(catalog).length || (dias !== null && dias < DIAS_BACKUP)) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <div>
      <strong>Faça um backup do cadastro</strong>
      <span>${dias === null ? 'Nenhum backup foi feito ainda.' : `O último foi há ${dias} dias.`} Sem ele, remover o app do iPhone apaga tudo.</span>
    </div>
    <button type="button" id="btn-backup-agora" class="btn-compacto">Fazer agora</button>`;
  el.classList.remove('hidden');
}

const LIMITE_LISTA = 50;

function renderCadastroLista() {
  const busca = $('#cadastro-busca').value.trim().toUpperCase();
  const lista = $('#cadastro-lista');
  const nota = $('#cadastro-lista-nota');
  const todos = Object.entries(catalog).filter(([ean, v]) => !busca || ean.includes(busca) || v.sku.toUpperCase().includes(busca));

  if (!todos.length) {
    lista.innerHTML = `<li class="lista-vazia">${
      busca ? 'Nenhum código corresponde à busca.' : 'Importe a planilha do fornecedor para o app reconhecer os códigos de barras.'
    }</li>`;
    nota.classList.add('hidden');
    return;
  }

  lista.innerHTML = todos
    .slice(0, LIMITE_LISTA)
    .map(([ean, v]) => `
      <li>
        <div class="item-info">
          <div class="item-sku">${esc(v.sku)}${v.manual ? '<span class="chip">manual</span>' : ''}</div>
          <div class="item-desc mono">${esc(ean)}</div>
        </div>
        <button type="button" class="btn-apagar-codigo" data-ean="${esc(ean)}" aria-label="Apagar o código de ${esc(v.sku)}">✕</button>
      </li>`)
    .join('');

  // A lista mostra só os primeiros; sem este aviso parecia que faltavam códigos.
  nota.textContent = todos.length > LIMITE_LISTA ? `Mostrando ${LIMITE_LISTA} de ${todos.length}. Use a busca para achar os demais.` : '';
  nota.classList.toggle('hidden', todos.length <= LIMITE_LISTA);
}

$('#cadastro-busca').addEventListener('input', renderCadastroLista);

$('#cadastro-lista').addEventListener('click', async (e) => {
  const b = e.target.closest('.btn-apagar-codigo');
  if (!b) return;
  const ean = b.dataset.ean;
  const sku = catalog[ean] && catalog[ean].sku;
  const ok = await confirmar({
    titulo: 'Apagar este código?',
    mensagem: `${sku} · ${ean}. O app voltará a perguntar o produto quando ele for bipado.`,
    acao: 'Apagar',
    perigo: true,
  });
  if (!ok) return;
  delete catalog[ean];
  save(K.catalog, catalog);
  renderResumoCadastro();
  renderCadastroLista();
  toast(`Código de ${sku} apagado`);
});

function exportarBackup() {
  const entries = Object.entries(catalog);
  if (!entries.length) {
    toast('Nada para exportar: o cadastro está vazio');
    return;
  }
  const csv = 'SKU;CODIGO_BARRAS\n' + entries.map(([ean, v]) => `${v.sku};${ean}${v.manual ? ';manual' : ''}`).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cadastro-conferencia.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  localStorage.setItem('cc_ultimo_backup', String(Date.now()));
  renderAvisoBackup();
  toast(`Backup exportado com ${plural(entries.length, 'código', 'códigos')}`);
}

$('#btn-exportar-cadastro').addEventListener('click', exportarBackup);
$('#aviso-backup').addEventListener('click', (e) => {
  if (e.target.closest('#btn-backup-agora')) exportarBackup();
});

// Restauração do backup gerado pelo próprio app: formato conhecido, sem
// diálogo de mapeamento de colunas.
$('#input-backup').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  const texto = await file.text();
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length || !/sku/i.test(linhas[0])) {
    setCadastroStatus('Arquivo não reconhecido. Use um arquivo gerado por "Exportar backup".');
    return;
  }
  let add = 0;
  let outlet = 0;
  for (const linha of linhas.slice(1)) {
    const [sku, ean, marca] = linha.split(';').map((p) => (p || '').trim());
    const codigo = onlyDigits(ean);
    if (!sku || codigo.length < 6) continue;
    if (isSkuOutlet(sku)) { outlet++; continue; }
    catalog[codigo] = marca === 'manual' ? { sku: sku.toUpperCase(), manual: true } : { sku: sku.toUpperCase() };
    add++;
  }
  save(K.catalog, catalog);
  setCadastroStatus(`Backup restaurado: ${add} códigos${outlet ? `, ${outlet} de outlet descartados` : ''}. Total: ${Object.keys(catalog).length}.`);
  renderResumoCadastro();
  renderAvisoBackup();
  renderCadastroLista();
});

$('#btn-limpar-cadastro').addEventListener('click', async () => {
  const total = Object.keys(catalog).length;
  if (!total) {
    toast('O cadastro já está vazio');
    return;
  }
  const ok = await confirmar({
    titulo: 'Apagar todo o cadastro?',
    mensagem: `${plural(total, 'código será apagado', 'códigos serão apagados')}, incluindo os aprendidos bipando. Sem um backup, essa ação não tem volta.`,
    acao: 'Apagar tudo',
    perigo: true,
  });
  if (!ok) return;
  catalog = {};
  save(K.catalog, catalog);
  setCadastroStatus('');
  renderCadastro();
  toast('Cadastro apagado');
});

// Importação de planilha com mapeamento de colunas
$('#input-planilha').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  if (typeof XLSX === 'undefined') {
    setCadastroStatus('O leitor de planilhas não carregou. Verifique a internet e abra o app de novo.');
    return;
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length || rows.length < 2) {
    setCadastroStatus('Planilha vazia ou sem linhas de dados.');
    return;
  }
  const headers = rows[0].map((h, i) => String(h || `Coluna ${i + 1}`));
  const norm = headers.map((h) => h.toLowerCase());
  const guessSku = norm.findIndex((h) => h.includes('sku') || h.includes('referê') || h.includes('refer'));
  const guessEan = norm.findIndex((h) => h.includes('ean') || h.includes('gtin') || h.includes('barra') || h.includes('código de barras'));

  const options = (sel) => headers.map((h, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(h)}</option>`).join('');
  const mapa = $('#mapeamento');
  const fecharMapa = () => {
    mapa.classList.add('hidden');
    mapa.innerHTML = '';
  };
  setCadastroStatus('');
  mapa.classList.remove('hidden');
  mapa.innerHTML = `
    <div><strong>${esc(file.name)}</strong><p class="hint">${plural(rows.length - 1, 'linha', 'linhas')}. Confirme quais colunas usar.</p></div>
    <label class="campo-rotulo">Coluna do SKU
      <select id="sel-sku">${options(guessSku >= 0 ? guessSku : 0)}</select>
    </label>
    <label class="campo-rotulo">Coluna do código de barras
      <select id="sel-ean">${options(guessEan >= 0 ? guessEan : 1)}</select>
    </label>
    <div class="dialogo-acoes">
      <button type="button" id="btn-cancelar-import">Cancelar</button>
      <button type="button" id="btn-confirmar-import" class="btn-primary">Importar</button>
    </div>`;
  mapa.scrollIntoView({ block: 'center', behavior: 'smooth' });

  $('#btn-cancelar-import').addEventListener('click', fecharMapa);
  $('#btn-confirmar-import').addEventListener('click', () => {
    const skuIdx = Number($('#sel-sku').value);
    const eanIdx = Number($('#sel-ean').value);
    let added = 0;
    let skipped = 0;
    let suspeitos = 0;
    let outlet = 0;
    for (let i = 1; i < rows.length; i++) {
      const sku = String(rows[i][skuIdx] ?? '').trim().toUpperCase();
      const ean = cellToEan(rows[i][eanIdx]);
      if (!sku || ean.length < 6) { skipped++; continue; }
      // Outlet divide o código com o SKU normal e atrapalharia a bipagem.
      if (isSkuOutlet(sku)) { outlet++; continue; }
      if (gtinValid(ean) === false) suspeitos++;
      if (catalog[ean]?.manual && catalog[ean].sku !== sku) continue;
      catalog[ean] = { sku };
      added++;
    }
    save(K.catalog, catalog);
    fecharMapa();
    let msg = `Importação concluída: ${added} códigos gravados${skipped ? `, ${skipped} linhas ignoradas` : ''}${outlet ? `, ${outlet} de outlet descartados` : ''}. Total: ${Object.keys(catalog).length}.`;
    if (suspeitos) msg += ` Atenção: ${suspeitos} códigos não parecem EAN válidos — confira se a coluna escolhida é mesmo a do código de barras.`;
    setCadastroStatus(msg);
    renderResumoCadastro();
    renderAvisoBackup();
    renderCadastroLista();
  });
});

// Colar texto SKU/EAN
$('#btn-colar-cadastro').addEventListener('click', () => {
  const lines = $('#cadastro-texto').value.split(/\r?\n/);
  let added = 0;
  let outlet = 0;
  for (const line of lines) {
    const parts = line.split(/[;,\t]+|\s{2,}|\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const eanPart = parts.find((p) => /^\d{6,}$/.test(onlyDigits(p)) && onlyDigits(p) === p.replace(/\s/g, ''));
    const skuPart = parts.find((p) => p !== eanPart);
    if (!eanPart || !skuPart) continue;
    if (isSkuOutlet(skuPart)) { outlet++; continue; }
    catalog[onlyDigits(eanPart)] = { sku: skuPart.toUpperCase(), manual: true };
    added++;
  }
  save(K.catalog, catalog);
  $('#cadastro-texto').value = '';
  setCadastroStatus(`${added} códigos adicionados${outlet ? `, ${outlet} de outlet descartados` : ''}. Total: ${Object.keys(catalog).length}.`);
  renderResumoCadastro();
  renderAvisoBackup();
  renderCadastroLista();
});

// ---------- Histórico ----------
function dataRelativa(iso) {
  const d = new Date(iso);
  const meiaNoite = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((meiaNoite(new Date()) - meiaNoite(d)) / 86400000);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dia = dias === 0 ? 'Hoje' : dias === 1 ? 'Ontem' : d.toLocaleDateString('pt-BR');
  return `${dia} · ${hora}`;
}

function renderHistorico() {
  const el = $('#historico-lista');
  $('#historico-resumo').textContent = history.length ? plural(history.length, 'conferência salva', 'conferências salvas') : '';
  if (!history.length) {
    el.innerHTML = `
      <div class="empty-state">
        <svg class="empty-ico" viewBox="0 0 12 12" aria-hidden="true"><g fill="currentColor" shape-rendering="crispEdges"><rect x="4" y="1" width="4" height="1"/><rect x="4" y="10" width="4" height="1"/><rect x="1" y="4" width="1" height="4"/><rect x="10" y="4" width="1" height="4"/><rect x="2" y="2" width="2" height="1"/><rect x="8" y="2" width="2" height="1"/><rect x="2" y="9" width="2" height="1"/><rect x="8" y="9" width="2" height="1"/><rect x="5" y="3" width="1" height="3"/><rect x="6" y="6" width="2" height="1"/></g></svg>
        <h2>Nenhuma conferência salva</h2>
        <p>As conferências finalizadas aparecem aqui, com o que faltou em cada uma.</p>
      </div>`;
    return;
  }
  el.innerHTML = history
    .map((h, idx) => {
      const s = h.resultado;
      const pct = s.total ? Math.round((s.totalScanned / s.total) * 100) : 0;
      const chip = s.totalMissing
        ? `<span class="chip chip-falta">${plural(s.totalMissing, 'faltando', 'faltando')}</span>`
        : '<span class="chip chip-ok">Completa</span>';
      const secoes = s.companies
        .filter((c) => c.missing.length)
        .map((c) => `<div class="resumo-secao"><div class="resumo-cab"><h3>${esc(c.name)}</h3><span>${c.scanned}/${c.total}</span></div>${htmlFaltantes(c)}</div>`)
        .join('');
      return `
        <details class="card hist-item">
          <summary>
            <div class="hist-linha"><strong>${dataRelativa(h.finishedAt)}</strong>${chip}</div>
            <div class="barra"><span style="width:${pct}%"></span></div>
            <div class="hist-meta">${s.totalScanned}/${s.total} unidades · ${s.companies.map((c) => `${esc(c.name)} ${c.scanned}/${c.total}`).join(' · ')}</div>
          </summary>
          <div class="hist-detalhe">
            ${secoes || '<div class="resumo-secao"><ul><li class="tudo-ok">Nada faltou nesta conferência</li></ul></div>'}
            ${htmlExtras(s.extras)}
            <button type="button" class="btn-texto" data-del-hist="${idx}" style="width:100%;color:var(--erro-fg)">Excluir do histórico</button>
          </div>
        </details>`;
    })
    .join('');
}

$('#historico-lista').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-del-hist]');
  if (!b) return;
  const idx = Number(b.dataset.delHist);
  const ok = await confirmar({
    titulo: 'Excluir do histórico?',
    mensagem: `A conferência de ${dataRelativa(history[idx].finishedAt)} será apagada.`,
    acao: 'Excluir',
    perigo: true,
  });
  if (!ok) return;
  history.splice(idx, 1);
  save(K.hist, history);
  renderHistorico();
  toast('Conferência excluída do histórico');
});

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

// ---------- Tema ----------
// A barra do sistema acompanha o fundo do tema em uso.
function sincronizarCorDoSistema() {
  const cor = getComputedStyle(document.documentElement).getPropertyValue('--fundo').trim();
  if (cor) $('#meta-tema').setAttribute('content', cor);
}

function aplicarTema(valor) {
  if (valor === 'auto') delete document.documentElement.dataset.tema;
  else document.documentElement.dataset.tema = valor;
  localStorage.setItem('cc_tema', valor);
  $$('#tema-opcoes button').forEach((b) => {
    const ativo = b.dataset.tema === valor;
    b.classList.toggle('active', ativo);
    b.setAttribute('aria-pressed', String(ativo));
  });
  sincronizarCorDoSistema();
}

$$('#tema-opcoes button').forEach((b) => {
  b.addEventListener('click', () => aplicarTema(b.dataset.tema));
});

if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mq.addEventListener) mq.addEventListener('change', sincronizarCorDoSistema);
}

aplicarTema(localStorage.getItem('cc_tema') || 'auto');

// ---------- Início ----------
$('#versao-app').textContent = `Conferência de Coleta · versão ${APP_VERSION}`;
goto(conf ? 'conferencia' : 'nova');
