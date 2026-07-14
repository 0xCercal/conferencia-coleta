import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWhatsappList } from '../js/parser.js';

const REAL_SAMPLE = `*FERCRIS*
1 - SGR-0501 Sifão de Inox com Copo para Banheiro (Gran Grafite Fosco)
1 - PXDOTARG Puxador para Móvel Ponto em Madeira (Argos)
2 - ARLN-0103 Acabamento para Registro Base Deca e Docol (Linea Cromado)
2 - AMAX-0601-DD Acabamento Monocomando para Registro Base Deca e Docol Baixa Pressão (Axia Ouro Fosco)
1 - VF04 Válvula Inox para Cuba Fazenda 4 1/2" Tampa e Cesto (Dourada Fosca)



*CERCAL*
1 - LEMI-0501 Lixeira Embutida de Cozinha Inox Redonda 5 Litros (Mizu Grafite Fosca)
2 - LERY-0601 Lixeira Embutida de Cozinha Inox Quadrada 5 Litros (Ryo Ouro Fosca)
4 - ARLN-0103 Acabamento para Registro Base Deca e Docol (Linea Cromado)
3 - VC07 Válvula Click de Inox para Cubas (Cromada)`;

test('parseia a mensagem real com duas empresas', () => {
  const { companies, unparsed } = parseWhatsappList(REAL_SAMPLE);
  assert.equal(companies.length, 2);
  assert.equal(companies[0].name, 'FERCRIS');
  assert.equal(companies[1].name, 'CERCAL');
  assert.equal(companies[0].items.length, 5);
  assert.equal(companies[1].items.length, 4);
  assert.equal(unparsed.length, 0);
});

test('extrai SKU, quantidade e descrição de cada linha', () => {
  const { companies } = parseWhatsappList(REAL_SAMPLE);
  const item = companies[0].items[0];
  assert.equal(item.sku, 'SGR-0501');
  assert.equal(item.qty, 1);
  assert.equal(item.description, 'Sifão de Inox com Copo para Banheiro (Gran Grafite Fosco)');
});

test('SKU com sufixo e hífens múltiplos é preservado', () => {
  const { companies } = parseWhatsappList(REAL_SAMPLE);
  const item = companies[0].items.find((i) => i.sku === 'AMAX-0601-DD');
  assert.ok(item);
  assert.equal(item.qty, 2);
});

test('descrição com aspas e fração não quebra o parser', () => {
  const { companies } = parseWhatsappList(REAL_SAMPLE);
  const item = companies[0].items.find((i) => i.sku === 'VF04');
  assert.match(item.description, /4 1\/2"/);
});

test('mesmo SKU pode aparecer em empresas diferentes com quantidades próprias', () => {
  const { companies } = parseWhatsappList(REAL_SAMPLE);
  assert.equal(companies[0].items.find((i) => i.sku === 'ARLN-0103').qty, 2);
  assert.equal(companies[1].items.find((i) => i.sku === 'ARLN-0103').qty, 4);
});

test('SKU repetido dentro da mesma empresa soma as quantidades', () => {
  const { companies } = parseWhatsappList('*X*\n1 - AB1 Coisa\n2 - AB1 Coisa');
  assert.equal(companies[0].items.length, 1);
  assert.equal(companies[0].items[0].qty, 3);
});

test('linhas não reconhecidas vão para unparsed', () => {
  const { companies, unparsed } = parseWhatsappList('*X*\n1 - AB1 Coisa\nobservação solta');
  assert.equal(companies[0].items.length, 1);
  assert.deepEqual(unparsed, ['observação solta']);
});

test('itens sem cabeçalho de empresa caem no grupo GERAL', () => {
  const { companies } = parseWhatsappList('1 - AB1 Coisa');
  assert.equal(companies[0].name, 'GERAL');
});

test('texto vazio retorna listas vazias', () => {
  const { companies, unparsed } = parseWhatsappList('');
  assert.equal(companies.length, 0);
  assert.equal(unparsed.length, 0);
});

test('aceita hífen, en-dash e em-dash como separador', () => {
  const { companies } = parseWhatsappList('*X*\n1 - AB1 Um\n2 – AB2 Dois\n3 — AB3 Três');
  assert.equal(companies[0].items.length, 3);
});
