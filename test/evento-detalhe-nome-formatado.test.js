// 13/08/2026: mesma regra já aplicada em Inscritos/PSS — nomes de participante chegam com
// grafia inconsistente (TUDO MAIÚSCULO, tudo minúsculo, misto) porque cada um digita do seu
// jeito no formulário público. Aplica formatarNome() nas abas Financeiro, Pagamentos e
// Certificados do evento também, sem alterar o valor gravado no banco.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const ejs = require('ejs');
const fs = require('fs');

const RAIZ = path.join(__dirname, '..');
const ARQUIVO = path.join(RAIZ, 'views/pages/evento-detalhe.ejs');
const { formatarNome } = require(path.join(RAIZ, 'src/services/nomes.js'));

function renderizar(locaisExtras) {
  const evento = { id: 1, nome: 'Congresso', cor_tema: '#1a3d2b', vagas_total: 100, total_inscritos: 0 };
  const calcularLiquidoEvento = (v, metodo) => metodo === 'dinheiro' ? v : (metodo === 'cartao' ? v * 0.96 : v * 0.981);
  const locals = {
    config: {}, usuario: { nome: 'Teste', perfil: 'admin' }, msg: [], erro: [],
    evento, lotes: [], inscricoes: [], pagamentos: [], certificados: [],
    stats: { total: 0, confirmados: 0, checkins: 0, receita: 0 },
    campos: [], programacao: [], palestrantes: [], patrocinadores: [], cupons: [], prefixoCupomEvento: 'LAURO',
    calcularLiquidoEvento, formatarNome, ...locaisExtras
  };
  return ejs.render(fs.readFileSync(ARQUIVO, 'utf8'), locals, { filename: ARQUIVO });
}

test('aba Financeiro: nome TUDO MAIÚSCULO aparece com Primeira Letra Maiúscula', () => {
  const html = renderizar({ pagamentos: [
    { id: 1, inscrito_nome: 'EDILSON FERREIRA', valor: '12.00', metodo: 'dinheiro', status: 'pago', pago_em: new Date() }
  ]});
  const iTab = html.indexOf('id="tab-financeiro"');
  const trecho = html.slice(iTab, html.indexOf('id="tab-online"'));
  assert.match(trecho, />Edilson Ferreira</);
  assert.ok(!trecho.includes('EDILSON FERREIRA'));
});

test('aba Pagamentos: nome tudo minúsculo aparece formatado', () => {
  const html = renderizar({ pagamentos: [
    { id: 1, inscrito_nome: 'joão gonçalves', valor: '10.00', metodo: 'pix', status: 'pago', pago_em: new Date() }
  ]});
  const iTab = html.indexOf('id="tab-pagamentos"');
  const trecho = html.slice(iTab, iTab + 4000);
  assert.match(trecho, />João Gonçalves</);
});

test('aba Certificados: nome misto aparece formatado', () => {
  const html = renderizar({ certificados: [
    { id: 1, inscrito_nome: 'MaRiA d\'ávila', emitido_em: new Date(), enviado_email: true, enviado_wpp: false }
  ]});
  const iTab = html.indexOf('Emitido em');
  const trecho = html.slice(iTab, iTab + 2000);
  assert.match(trecho, />Maria D&#39;ávila</);
});
