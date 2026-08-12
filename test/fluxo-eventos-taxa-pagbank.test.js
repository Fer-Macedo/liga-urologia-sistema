// 11/08/2026: aba financeiro de eventos e o relatório em PDF calculavam a taxa PIX com
// 1,8%, divergindo da taxa real do PagBank (1,9%, conforme extrato: R$12,00 vira R$11,77)
// já usada corretamente no lançamento real do fluxo de caixa (fluxo-eventos.js). Duas fontes
// de verdade divergentes = a tela mentia sobre o valor líquido de verdade recebido.
const { test } = require('node:test');
const assert = require('node:assert');
const { calcularLiquidoEvento } = require('../src/services/fluxo-eventos');

test('PIX de R$12,00 rende R$11,77 líquidos, igual ao extrato real do PagBank', () => {
  assert.strictEqual(calcularLiquidoEvento(12, 'pix'), 11.77);
});

test('cartão desconta 4%', () => {
  assert.strictEqual(calcularLiquidoEvento(100, 'cartao'), 96);
});

test('PIX desconta 1,9%, não 1,8%', () => {
  assert.strictEqual(calcularLiquidoEvento(100, 'pix'), 98.1);
});
