// 11/08/2026: GET /pagamento/:inscricaoId/confirmado (página que aparece quando alguém que
// já pagou revisita o link) dava 500 — renderizava 'pages/evento-confirmado', mas esse
// arquivo nunca existiu. 13 ocorrências nos logs de produção. Corrigido criando a view.
// Este teste sobe um Express real com o view engine real (não um res.render fake), pra
// pegar de verdade um "Failed to lookup view" se a página voltar a sumir.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

const inscricaoConfirmada = {
  id: 30, nome: 'Carlos Souza', evento_id: 4, evento_nome: 'Congresso 2026',
  cor_tema: '#1a3d2b', banner_chave: null, local: 'Asunción', data_inicio: '2026-09-10',
  qrcode: 'LAURO-4-999', status: 'confirmado'
};

function montar() {
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql) => {
      if (/FROM evento_inscricoes i JOIN eventos e/.test(sql)) return { rows: [inscricaoConfirmada] };
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({ org_nome: 'LAURO' }) } };

  delete require.cache[require.resolve(MODULO)];
  const express = require('express');
  const realRouter = express.Router();
  require(MODULO)(realRouter);
  const app = express();
  app.set('views', path.join(RAIZ, 'views'));
  app.set('view engine', 'ejs');
  app.use(realRouter);
  return app;
}

test('GET /pagamento/:id/confirmado renderiza a página de verdade, não 500 por view faltando', async () => {
  const app = montar();
  const srv = app.listen(0);
  try {
    const porta = srv.address().port;
    const r = await fetch('http://127.0.0.1:' + porta + '/pagamento/30/confirmado');
    const html = await r.text();
    assert.strictEqual(r.status, 200);
    assert.ok(!/Failed to lookup view/.test(html), 'view não deveria estar faltando: ' + html.slice(0, 200));
    assert.ok(html.includes('Congresso 2026'));
    assert.ok(html.includes('LAURO-4-999'));
  } finally {
    srv.close();
  }
});
