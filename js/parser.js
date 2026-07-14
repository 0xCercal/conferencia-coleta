// Parser da lista de coleta recebida por WhatsApp.
// Formato esperado:
//   *EMPRESA*
//   <quantidade> - <SKU> <descrição>
export function parseWhatsappList(text) {
  const companies = [];
  const unparsed = [];
  let current = null;

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const companyMatch = line.match(/^\*{1,2}\s*([^*]+?)\s*\*{1,2}$/);
    if (companyMatch) {
      current = { name: companyMatch[1].toUpperCase(), items: [] };
      companies.push(current);
      continue;
    }

    const itemMatch = line.match(/^(\d+)\s*[-–—]\s*(\S+)(?:\s+(.*))?$/);
    if (itemMatch) {
      if (!current) {
        current = { name: 'GERAL', items: [] };
        companies.push(current);
      }
      const qty = parseInt(itemMatch[1], 10);
      const sku = itemMatch[2].toUpperCase();
      const description = (itemMatch[3] || '').trim();
      const existing = current.items.find((i) => i.sku === sku);
      if (existing) {
        existing.qty += qty;
      } else {
        current.items.push({ sku, description, qty });
      }
      continue;
    }

    unparsed.push(line);
  }

  return {
    companies: companies.filter((c) => c.items.length > 0),
    unparsed,
  };
}
