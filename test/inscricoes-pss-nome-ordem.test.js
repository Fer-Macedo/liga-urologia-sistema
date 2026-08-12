// 12/08/2026: nomes chegavam com grafia inconsistente (TUDO MAIÚSCULO, tudo minúsculo,
// misturado) na lista de inscritos do PSS, e a ordem era por status/data, não alfabética.
// Padroniza a exibição (primeira letra maiúscula, resto minúsculo, por palavra) sem alterar
// o valor gravado no banco, e ordena a lista por nome.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const ejs = require('ejs');

const RAIZ = path.join(__dirname, '..');
const { formatarNome } = require(path.join(RAIZ, 'src/services/nomes.js'));

test('formatarNome: maiúsculo, minúsculo e misto viram Primeira Letra Maiúscula', () => {
  assert.strictEqual(formatarNome('JOSIAS GOMES FERREIRA'), 'Josias Gomes Ferreira');
  assert.strictEqual(formatarNome('edmyla malheiros'), 'Edmyla Malheiros');
  assert.strictEqual(formatarNome('LuCaS dos SANTOS'), 'Lucas Dos Santos');
});

test('formatarNome: preserva acentos e apóstrofo', () => {
  assert.strictEqual(formatarNome("maria d'ávila"), "Maria D'ávila");
  assert.strictEqual(formatarNome('joão gonçalves'), 'João Gonçalves');
});

test('a página renderiza os nomes formatados, sem alterar o valor original em memória', async () => {
  const inscritos = [
    { id: 1, nome: 'JOSIAS GOMES FERREIRA', documento_tipo: 'CPF', documento: '123', email: 'a@a.com', criado_em: new Date(), pagamento_status: 'confirmado', valor_pago: 0, isento: true, numero_lista: 1 },
    { id: 2, nome: 'edmyla malheiros', documento_tipo: 'CPF', documento: '456', email: 'b@b.com', criado_em: new Date(), pagamento_status: 'confirmado', valor_pago: 25, isento: false, numero_lista: 2 }
  ];
  const html = await ejs.renderFile(path.join(RAIZ, 'views/pages/inscricoes-pss.ejs'), {
    config: {}, usuario: { nome: 'Admin' }, procs: [], vista: 'detalhe',
    processo: { id: 4, nome: 'Processo Teste' }, inscritos, cupons: [],
    resumo: { total: 2, confirmados: 2, pendentes: 0, arrecadado: 25 },
    inscricaoBase: 'https://x', msg: [], erro: [], formatarNome
  });
  assert.ok(html.includes('<td>Josias Gomes Ferreira</td>'));
  assert.ok(html.includes('<td>Edmyla Malheiros</td>'));
  assert.strictEqual(inscritos[0].nome, 'JOSIAS GOMES FERREIRA', 'não deve mutar o objeto original');
});

test('lista de inscritos do PSS: rota consulta ORDER BY LOWER(nome), não mais por status/data', () => {
  const src = require('fs').readFileSync(path.join(RAIZ, 'src/routes/processo-seletivo.js'), 'utf8');
  assert.match(src, /ORDER BY LOWER\(nome\) ASC/);
});
