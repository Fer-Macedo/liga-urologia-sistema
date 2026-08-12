// 11/08/2026: o ícone de método de pagamento (cartão/PIX) no fluxo de caixa só acendia
// pra mensalidades — a consulta buscava metodo_pagamento só via JOIN com cobrancas. Lançamentos
// de eventos guardam o método como texto dentro de observacoes ("Pago via cartao...", gerado
// por fluxo-eventos.js), então nunca preenchiam esse campo e o ícone não aparecia.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/fluxo-caixa.js');

function montar(linhas) {
  let sqlUsado = null;
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql) => {
      if (/SELECT f\.\*/.test(sql)) { sqlUsado = sql; return { rows: linhas || [] }; }
      return { rows: [{ total_e: 0, total_s: 0 }] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas[rota] = fns[fns.length-1]; }, post: () => {} };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, getSql: () => sqlUsado };
}

test('a consulta do fluxo de caixa extrai o método de pagamento também de lançamentos de eventos', async () => {
  const { rotas, getSql } = montar([]);
  const res = { render: (view, dados) => { res._dados = dados; } };
  await rotas['/fluxo-caixa']({ session: { usuario: {} }, query: {}, flash: () => {} }, res);
  const sql = getSql();
  assert.match(sql, /COALESCE\(c\.metodo_pagamento/, 'ainda tem que puxar o método de mensalidades normalmente');
  assert.match(sql, /substring\(f\.observacoes from 'Pago via/, 'tem que extrair o método de eventos a partir das observações');
});
