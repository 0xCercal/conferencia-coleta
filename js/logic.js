// Lógica pura da conferência: criação, bipagem e resumo.
// Nenhuma dependência de DOM ou storage — testável em Node.

export function createConference(parsed, startedAt) {
  return {
    startedAt,
    active: 0,
    extras: [],
    companies: parsed.companies.map((c) => ({
      name: c.name,
      items: c.items.map((i) => ({ sku: i.sku, description: i.description, qty: i.qty, scanned: 0 })),
    })),
  };
}

// Valida o dígito verificador de códigos GTIN (EAN-8, UPC-A, EAN-13, GTIN-14).
// Retorna true/false quando o código tem formato GTIN; null quando não se aplica
// (ex: Code 128 alfanumérico), caso em que não dá para validar.
export function gtinValid(code) {
  const c = String(code || '').trim();
  if (!/^\d{8}$/.test(c) && !/^\d{12,14}$/.test(c)) return null;
  const digits = c.split('').map(Number);
  const check = digits.pop();
  let sum = 0;
  let weight = 3;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += digits[i] * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10 === check;
}

// Variantes equivalentes do código: UPC-A (12 dígitos) é o EAN-13 sem o zero
// à esquerda — cobre leitores/planilhas que divergem nesse detalhe.
export function codeVariants(code) {
  const c = String(code || '').trim();
  const variants = [c];
  if (/^\d{12}$/.test(c)) variants.push('0' + c);
  if (/^\d{13}$/.test(c) && c.startsWith('0')) variants.push(c.slice(1));
  return variants;
}

// Converte o código lido (EAN do catálogo ou SKU digitado) em SKU, ou null.
export function resolveSku(catalog, code, conf) {
  const c = String(code || '').trim();
  if (!c) return null;
  for (const variant of codeVariants(c)) {
    if (catalog[variant]) return catalog[variant].sku;
  }
  const upper = c.toUpperCase();
  if (conf && conf.companies.some((co) => co.items.some((i) => i.sku === upper))) return upper;
  return null;
}

export function processScan(conf, sku, activeIdx = conf.active) {
  const company = conf.companies[activeIdx];
  const item = company ? company.items.find((i) => i.sku === sku) : null;

  if (item && item.scanned < item.qty) {
    item.scanned++;
    return { status: 'ok', item, company, companyIdx: activeIdx, complete: item.scanned === item.qty };
  }

  for (let idx = 0; idx < conf.companies.length; idx++) {
    if (idx === activeIdx) continue;
    const other = conf.companies[idx].items.find((i) => i.sku === sku && i.scanned < i.qty);
    if (other) {
      return { status: 'other-company', item: other, company: conf.companies[idx], companyIdx: idx };
    }
  }

  if (item) {
    addExtra(conf, sku, item.description);
    return { status: 'excess', item, company, companyIdx: activeIdx };
  }

  addExtra(conf, sku, '');
  return { status: 'not-in-list', sku };
}

// Confirmação do caso "produto da outra empresa": marca 1 unidade lá.
export function acceptOtherCompany(conf, companyIdx, sku) {
  const item = conf.companies[companyIdx].items.find((i) => i.sku === sku);
  if (!item || item.scanned >= item.qty) return null;
  item.scanned++;
  return { status: 'ok', item, company: conf.companies[companyIdx], companyIdx, complete: item.scanned === item.qty };
}

function addExtra(conf, sku, description) {
  const existing = conf.extras.find((e) => e.sku === sku);
  if (existing) existing.count++;
  else conf.extras.push({ sku, description, count: 1 });
}

// Ajuste manual: delta em unidades ('all' completa, 'zero' zera).
export function adjustItem(conf, companyIdx, sku, action) {
  const item = conf.companies[companyIdx].items.find((i) => i.sku === sku);
  if (!item) return null;
  if (action === 'all') item.scanned = item.qty;
  else if (action === 'zero') item.scanned = 0;
  else item.scanned = Math.min(item.qty, Math.max(0, item.scanned + action));
  return item;
}

export function companyProgress(company) {
  const total = company.items.reduce((s, i) => s + i.qty, 0);
  const scanned = company.items.reduce((s, i) => s + Math.min(i.scanned, i.qty), 0);
  return { scanned, total };
}

export function summary(conf) {
  const companies = conf.companies.map((c) => {
    const { scanned, total } = companyProgress(c);
    return {
      name: c.name,
      scanned,
      total,
      missing: c.items
        .filter((i) => i.scanned < i.qty)
        .map((i) => ({ sku: i.sku, description: i.description, remaining: i.qty - i.scanned, qty: i.qty })),
    };
  });
  const totalScanned = companies.reduce((s, c) => s + c.scanned, 0);
  const total = companies.reduce((s, c) => s + c.total, 0);
  const totalMissing = total - totalScanned;
  return { companies, totalScanned, total, totalMissing, extras: conf.extras };
}
