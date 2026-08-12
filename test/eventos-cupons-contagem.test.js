// 11/08/2026: cupom gerado em segundo plano (fix anterior do 504) tinha um efeito colateral
// — a tela de cupons carregava ANTES dos 43 cupons existirem de verdade, mostrando só o que
// já havia antes. GET /eventos/:id/cupons/contagem alimenta um polling no navegador que
// recarrega a página sozinha quando percebe que a contagem parou de subir (geração terminou).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar(totalCupons) {
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql) => {
      if (/SELECT COUNT\(\*\) AS n FROM evento_cupons WHERE evento_id=\$1/.test(sql)) return { rows: [{ n: String(totalCupons) }] };
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas[rota] = fns[fns.length-1]; }, post: () => {} };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas };
}

test('GET /cupons/contagem devolve o total atual de cupons do evento', async () => {
  const { rotas } = montar(43);
  const res = { _json: null, json: function(d){ this._json = d; } };
  await rotas['/eventos/:id/cupons/contagem']({ params: { id: '5' } }, res);
  assert.deepStrictEqual(res._json, { total: 43 });
});
