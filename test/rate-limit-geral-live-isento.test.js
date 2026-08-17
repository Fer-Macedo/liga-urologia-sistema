// 15/08/2026: "/live/:token/ping" bate a cada 2min por pessoa assistindo a transmissão online.
// Sem essa isenção, várias pessoas atrás do MESMO IP (rede da faculdade, dormitório, operadora
// de celular) somam no mesmo teto de 600 req/15min e começam a ser recusadas — exatamente o
// mesmo bug real já achado num teste de carga em /checkout (12/08/2026: 100 simultâneos do
// mesmo IP, 11 recusados por esse limite compartilhado, mesmo sendo pessoas distintas).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const RAIZ = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(RAIZ, 'src/routes/index.js'), 'utf8');

// Reconstrói a mesma função a partir do arquivo real (não redigita a lógica à mão) pra testar
// o comportamento de verdade, sem precisar montar o router inteiro (index.js sobe todos os
// módulos do sistema no require, pesado demais só pra testar uma função de 4 linhas).
function extrairFuncao(nome) {
  const inicio = src.indexOf('function ' + nome);
  assert.ok(inicio !== -1, nome + ' precisa existir em src/routes/index.js');
  const fimChave = src.indexOf('\n}', inicio) + 2;
  const corpo = src.slice(inicio, fimChave);
  const fn = new Function('req', corpo + '\nreturn ' + nome + '(req);');
  return fn;
}

const deveSkip = extrairFuncao('deveSkipLimiteGeral');

test('/live/:token e /live/:token/ping ficam isentos do limite geral por IP', () => {
  assert.strictEqual(deveSkip({ path: '/live/abc123token' }), true);
  assert.strictEqual(deveSkip({ path: '/live/abc123token/ping' }), true);
  assert.strictEqual(deveSkip({ path: '/live/abc123token/sair' }), true);
});

test('rotas normais continuam sob o limite geral (não isenta tudo por engano)', () => {
  assert.strictEqual(deveSkip({ path: '/eventos/5' }), false);
  assert.strictEqual(deveSkip({ path: '/api/contato-site' }), false);
});

test('isenções pré-existentes continuam funcionando (checkout/inscricao/webhook)', () => {
  assert.strictEqual(deveSkip({ path: '/checkout/5' }), true);
  assert.strictEqual(deveSkip({ path: '/inscricao/5' }), true);
  assert.strictEqual(deveSkip({ path: '/webhook/pagbank' }), true);
});

test('admin autenticado (sessão com usuário) sempre isento, em qualquer rota', () => {
  assert.strictEqual(deveSkip({ path: '/eventos/5', session: { usuario: { id: 1 } } }), true);
});

// 17/08/2026: inscrição pública de sorteio Externo — mesma classe de risco do checkout
// (várias pessoas atrás do mesmo IP se inscrevendo pro sorteio ao mesmo tempo).
test('/participar/:id (inscrição pública de sorteio) fica isento do limite geral por IP', () => {
  assert.strictEqual(deveSkip({ path: '/participar/9' }), true);
});
