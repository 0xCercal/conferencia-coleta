import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWhatsappList } from '../js/parser.js';
import {
  createConference,
  resolveSku,
  processScan,
  acceptOtherCompany,
  adjustItem,
  companyProgress,
  summary,
} from '../js/logic.js';

const LIST = `*FERCRIS*
1 - DHTA02 Ducha Higiênica (Tana Preta Fosca)
2 - ARLN-0103 Acabamento para Registro (Linea Cromado)

*CERCAL*
1 - LEMI-0501 Lixeira Embutida (Mizu Grafite Fosca)
4 - ARLN-0103 Acabamento para Registro (Linea Cromado)`;

const CATALOG = {
  7891234500011: { sku: 'DHTA02' },
  7891234500028: { sku: 'ARLN-0103' },
  7891234500035: { sku: 'LEMI-0501' },
};

function makeConf() {
  return createConference(parseWhatsappList(LIST), '2026-07-14T08:00:00');
}

test('resolveSku encontra pelo EAN do catálogo', () => {
  assert.equal(resolveSku(CATALOG, '7891234500011', makeConf()), 'DHTA02');
});

test('resolveSku aceita SKU digitado direto (mesmo minúsculo)', () => {
  assert.equal(resolveSku({}, 'dhta02', makeConf()), 'DHTA02');
});

test('resolveSku retorna null para código desconhecido', () => {
  assert.equal(resolveSku(CATALOG, '000000000000', makeConf()), null);
});

test('bipe ok desconta unidade e sinaliza item completo', () => {
  const conf = makeConf();
  const r1 = processScan(conf, 'ARLN-0103', 0);
  assert.equal(r1.status, 'ok');
  assert.equal(r1.complete, false);
  const r2 = processScan(conf, 'ARLN-0103', 0);
  assert.equal(r2.complete, true);
});

test('bipe além da quantidade vira excesso e registra em extras', () => {
  const conf = makeConf();
  processScan(conf, 'DHTA02', 0);
  const r = processScan(conf, 'DHTA02', 0);
  assert.equal(r.status, 'excess');
  assert.deepEqual(conf.extras[0], { sku: 'DHTA02', description: 'Ducha Higiênica (Tana Preta Fosca)', count: 1 });
});

test('item pendente só na outra empresa retorna other-company sem marcar', () => {
  const conf = makeConf();
  const r = processScan(conf, 'LEMI-0501', 0);
  assert.equal(r.status, 'other-company');
  assert.equal(r.companyIdx, 1);
  assert.equal(conf.companies[1].items[0].scanned, 0);
});

test('acceptOtherCompany marca a unidade na empresa certa', () => {
  const conf = makeConf();
  const r = acceptOtherCompany(conf, 1, 'LEMI-0501');
  assert.equal(r.status, 'ok');
  assert.equal(r.complete, true);
  assert.equal(conf.companies[1].items[0].scanned, 1);
});

test('SKU nas duas empresas: aba ativa tem prioridade', () => {
  const conf = makeConf();
  const r = processScan(conf, 'ARLN-0103', 1);
  assert.equal(r.status, 'ok');
  assert.equal(r.companyIdx, 1);
  assert.equal(conf.companies[0].items[1].scanned, 0);
});

test('SKU esgotado na aba ativa transborda para a outra empresa', () => {
  const conf = makeConf();
  processScan(conf, 'ARLN-0103', 0);
  processScan(conf, 'ARLN-0103', 0);
  const r = processScan(conf, 'ARLN-0103', 0);
  assert.equal(r.status, 'other-company');
  assert.equal(r.companyIdx, 1);
});

test('produto fora da lista retorna not-in-list e registra extra', () => {
  const conf = makeConf();
  const r = processScan(conf, 'ZZZ99', 0);
  assert.equal(r.status, 'not-in-list');
  assert.equal(conf.extras.length, 1);
});

test('ajuste manual: +1, -1, tudo e zerar respeitam limites', () => {
  const conf = makeConf();
  assert.equal(adjustItem(conf, 0, 'ARLN-0103', +1).scanned, 1);
  assert.equal(adjustItem(conf, 0, 'ARLN-0103', -1).scanned, 0);
  assert.equal(adjustItem(conf, 0, 'ARLN-0103', -1).scanned, 0);
  assert.equal(adjustItem(conf, 0, 'ARLN-0103', 'all').scanned, 2);
  assert.equal(adjustItem(conf, 0, 'ARLN-0103', +1).scanned, 2);
  assert.equal(adjustItem(conf, 0, 'ARLN-0103', 'zero').scanned, 0);
});

test('companyProgress conta unidades, não linhas', () => {
  const conf = makeConf();
  processScan(conf, 'ARLN-0103', 0);
  assert.deepEqual(companyProgress(conf.companies[0]), { scanned: 1, total: 3 });
});

test('summary lista faltantes com quantidade restante', () => {
  const conf = makeConf();
  processScan(conf, 'DHTA02', 0);
  processScan(conf, 'ARLN-0103', 0);
  const s = summary(conf);
  assert.equal(s.total, 8);
  assert.equal(s.totalScanned, 2);
  assert.equal(s.totalMissing, 6);
  const fercris = s.companies[0];
  assert.deepEqual(fercris.missing, [
    { sku: 'ARLN-0103', description: 'Acabamento para Registro (Linea Cromado)', remaining: 1, qty: 2 },
  ]);
});
