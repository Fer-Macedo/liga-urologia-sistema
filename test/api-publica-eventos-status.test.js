// 14/08/2026: banner do evento sumiu do site público (lauroucpcde.com) mesmo com um evento
// realmente aberto (status='ativo', publico=true) cadastrado. Causa raiz: /api/eventos-publicos
// filtrava WHERE status='publicado' — um valor que NUNCA existe no sistema (os únicos status
// reais de um evento são rascunho/ativo/encerrado/cancelado, conferido no próprio <select> de
// evento-detalhe.ejs). A query sempre devolvia lista vazia, para QUALQUER evento, sempre.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/api-publica.js');

function montar(eventosNoBanco) {
  const sqlExecutadas = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      sqlExecutadas.push(sql);
      if (/FROM eventos WHERE status='ativo' AND publico=true/.test(sql)) {
        return { rows: eventosNoBanco.filter(e => e.status === 'ativo' && e.publico && (!e.checkout_fecha_em || e.checkout_fecha_em > new Date())) };
      }
      if (/FROM eventos WHERE status IN \('ativo','encerrado'\)/.test(sql)) {
        return { rows: [{ total: eventosNoBanco.filter(e => e.status === 'ativo' || e.status === 'encerrado').length }] };
      }
      if (/FROM ligantes/.test(sql)) return { rows: [{ total: 0 }] };
      return { rows: [] };
    }
  }};
  const rar = require.resolve(path.join(RAIZ, 'src/services/arquivos.js'));
  require.cache[rar] = { id: rar, filename: rar, loaded: true, exports: { gerarUrlInline: async (chave) => 'https://cdn/' + chave } };
  const rrl = require.resolve(path.join(RAIZ, 'src/services/rate-limiters.js'));
  require.cache[rrl] = { id: rrl, filename: rrl, loaded: true, exports: {
    limiterApiPublica: (q,s,n) => n(), limiterContato: (q,s,n) => n()
  }};

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, sqlExecutadas };
}

function resJson() { const r = {}; r.json = (body) => { r._body = body; return r; }; return r; }

test('/api/eventos-publicos: evento status=ativo e publico=true aparece na lista', async () => {
  const { rotas } = montar([
    { id: 5, nome: 'II Jornada de Salud del Hombre', status: 'ativo', publico: true, checkout_fecha_em: null, banner_chave: 'eventos/banner.jpg' }
  ]);
  const res = resJson();
  await rotas['GET /api/eventos-publicos']({}, res);
  assert.strictEqual(res._body.length, 1, 'evento ativo e público precisa aparecer no site');
  assert.strictEqual(res._body[0].nome, 'II Jornada de Salud del Hombre');
  assert.strictEqual(res._body[0].banner_chave, 'https://cdn/eventos/banner.jpg');
});

test('/api/eventos-publicos: evento rascunho, encerrado ou cancelado NÃO aparece', async () => {
  const { rotas } = montar([
    { id: 1, nome: 'Rascunho', status: 'rascunho', publico: true, checkout_fecha_em: null },
    { id: 2, nome: 'Encerrado', status: 'encerrado', publico: true, checkout_fecha_em: null },
    { id: 3, nome: 'Cancelado', status: 'cancelado', publico: true, checkout_fecha_em: null }
  ]);
  const res = resJson();
  await rotas['GET /api/eventos-publicos']({}, res);
  assert.deepStrictEqual(res._body, []);
});

test('/api/eventos-publicos: nunca filtra por status=\'publicado\' — esse valor não existe no sistema', async () => {
  const src = require('fs').readFileSync(MODULO, 'utf8');
  assert.ok(!src.includes("status='publicado'"), "status='publicado' nunca é atribuído a nenhum evento (só rascunho/ativo/encerrado/cancelado) — filtrar por ele sempre devolve lista vazia, seja qual for o estado real dos eventos");
});

test('/api/stats-publicas: conta eventos ativo+encerrado, não o status inexistente "publicado"', async () => {
  const { rotas } = montar([
    { id: 1, status: 'ativo' }, { id: 2, status: 'encerrado' }, { id: 3, status: 'rascunho' }
  ]);
  const res = resJson();
  await rotas['GET /api/stats-publicas']({}, res);
  assert.strictEqual(res._body.eventos, 2);
});
