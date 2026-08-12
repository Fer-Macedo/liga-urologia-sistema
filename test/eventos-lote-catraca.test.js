// 11/08/2026: a exigência de catraca (UCP) era um botão manual separado do lote, sem
// nenhuma ligação com o lote escolhido — quem marcava o lote "Estudante Externo" mas
// esquecia de clicar em "Externo" no botão à parte continuava sendo cobrado de um número
// de catraca que não tinha. Agora "exige_catraca" é uma propriedade do próprio lote,
// configurada pelo admin ao criar/editar, e a página pública deriva o campo daí sozinha.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar() {
  const inserts = [];
  const updates = [];

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT COUNT\(\*\) FROM evento_lotes WHERE evento_id/.test(sql)) return { rows: [{ count: '0' }] };
      if (/INSERT INTO evento_lotes/.test(sql)) { inserts.push(params); return { rows: [] }; }
      if (/UPDATE evento_lotes SET/.test(sql)) { updates.push(params); return { rows: [] }; }
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };
  const re = require.resolve(path.join(RAIZ, 'src/services/email.js'));
  require.cache[re] = { id: re, filename: re, loaded: true, exports: { enviarEmail: async () => {}, emailBonito: () => '' } };
  const rpg = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  require.cache[rpg] = { id: rpg, filename: rpg, loaded: true, exports: { criarPixEvento: async () => ({}), consultarPagamento: async () => ({}), obterChavePublica: async () => ({}), pagarComCartao: async () => ({}) } };
  const rev = require.resolve(path.join(RAIZ, 'src/services/eventos-email.js'));
  require.cache[rev] = { id: rev, filename: rev, loaded: true, exports: { enviarEmailConfirmacaoEvento: async () => {} } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, inserts, updates };
}

function resRedirect() {
  const r = {};
  r.redirect = () => r;
  return r;
}
function req(body, params) {
  return { body, params, session: {} };
}

test('criar lote com a caixa marcada salva exige_catraca=true', async () => {
  const { rotas, inserts } = montar();
  await rotas['POST /eventos/:id/lotes'](req({ nome: 'Lote UCP', preco: '50', vagas: '100', exige_catraca: 'on' }, { id: '1' }), resRedirect());
  assert.strictEqual(inserts.length, 1);
  assert.strictEqual(inserts[0][7], true);
});

test('criar lote sem marcar a caixa salva exige_catraca=false (checkbox desmarcado não vem no body)', async () => {
  const { rotas, inserts } = montar();
  await rotas['POST /eventos/:id/lotes'](req({ nome: 'Lote Externo', preco: '60', vagas: '50' }, { id: '1' }), resRedirect());
  assert.strictEqual(inserts.length, 1);
  assert.strictEqual(inserts[0][7], false);
});

test('editar lote com a caixa marcada salva exige_catraca=true', async () => {
  const { rotas, updates } = montar();
  await rotas['POST /eventos/:id/lotes/:lid/editar'](req({ nome: 'Lote UCP', preco: '50', vagas: '100', exige_catraca: 'on' }, { id: '1', lid: '10' }), resRedirect());
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0][5], true);
});

test('editar lote desmarcando a caixa salva exige_catraca=false', async () => {
  const { rotas, updates } = montar();
  await rotas['POST /eventos/:id/lotes/:lid/editar'](req({ nome: 'Lote Externo', preco: '60', vagas: '50' }, { id: '1', lid: '11' }), resRedirect());
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0][5], false);
});
