// 13/08/2026: pagamento em dinheiro (ex: Edilson Ferreira) aparecia na aba Financeiro do evento
// rotulado como "Cartão" — o valor/taxa líquida já estavam certos (calcularLiquidoEvento já
// tratava 'dinheiro' à parte), mas o badge de método era um ternário binário
// (pix ? 'PIX' : 'Cartão') que jogava QUALQUER método que não fosse pix pra "Cartão".
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const ejs = require('ejs');
const fs = require('fs');

const ARQUIVO = path.join(__dirname, '..', 'views/pages/evento-detalhe.ejs');

function renderizar(pagamentos) {
  const evento = { id: 1, nome: 'Congresso', cor_tema: '#1a3d2b', vagas_total: 100, total_inscritos: 0 };
  const calcularLiquidoEvento = (v, metodo) => metodo === 'dinheiro' ? v : (metodo === 'cartao' ? v * 0.96 : v * 0.981);
  const locals = {
    config: {}, usuario: { nome: 'Teste', perfil: 'admin' }, msg: [], erro: [],
    evento, lotes: [], inscricoes: [], pagamentos, certificados: [],
    stats: { total: 0, confirmados: 0, checkins: 0, receita: 0 },
    campos: [], programacao: [], palestrantes: [], patrocinadores: [], cupons: [], prefixoCupomEvento: 'LAURO',
    calcularLiquidoEvento, formatarNome: (n) => n
  };
  return ejs.render(fs.readFileSync(ARQUIVO, 'utf8'), locals, { filename: ARQUIVO });
}

test('aba Financeiro: pagamento em dinheiro mostra "Dinheiro", não "Cartão"', () => {
  const html = renderizar([
    { id: 1, inscrito_nome: 'Edilson Ferreira', valor: '12.00', metodo: 'dinheiro', status: 'pago', pago_em: new Date() }
  ]);
  const iTab = html.indexOf('id="tab-financeiro"');
  const trecho = html.slice(iTab, html.indexOf('id="tab-online"'));
  assert.match(trecho, />Dinheiro</, 'deve rotular pagamento em dinheiro como "Dinheiro"');
  assert.ok(!/>Cartão</.test(trecho), 'não deve rotular dinheiro como Cartão');
});

test('aba Financeiro: pix e cartão continuam corretos', () => {
  const html = renderizar([
    { id: 1, inscrito_nome: 'A', valor: '10.00', metodo: 'pix', status: 'pago', pago_em: new Date() },
    { id: 2, inscrito_nome: 'B', valor: '10.00', metodo: 'cartao', status: 'pago', pago_em: new Date() }
  ]);
  const iTab = html.indexOf('id="tab-financeiro"');
  const trecho = html.slice(iTab, html.indexOf('id="tab-online"'));
  assert.match(trecho, />PIX</);
  assert.match(trecho, />Cartão</);
});

test('aba Pagamentos: pagamento em dinheiro mostra "Dinheiro", não "—"', () => {
  const html = renderizar([
    { id: 1, inscrito_nome: 'Edilson Ferreira', valor: '12.00', metodo: 'dinheiro', status: 'pago', pago_em: new Date() }
  ]);
  const iTab = html.indexOf('id="tab-pagamentos"');
  const trecho = html.slice(iTab, iTab + 4000);
  assert.match(trecho, />Dinheiro</);
});
