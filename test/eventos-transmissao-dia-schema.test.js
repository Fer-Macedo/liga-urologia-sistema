// 15/08/2026: formulário rápido da aba Online/Live pra configurar cada dia (URL + duração,
// preenchida só depois que a aula termina) sem passar pelo modal grande de edição.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar() {
  const updates = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/UPDATE evento_programacao SET youtube_url=\$1, duracao_minutos=\$2/.test(sql)) { updates.push(params); return { rows: [] }; }
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
  require.cache[rev] = { id: rev, filename: rev, loaded: true, exports: { enviarEmailConfirmacaoEvento: async () => {}, TEXTO_CONFIRMACAO_PADRAO: 'x' } };
  const rrl = require.resolve(path.join(RAIZ, 'src/services/rate-limiters.js'));
  require.cache[rrl] = { id: rrl, filename: rrl, loaded: true, exports: { limiterPagamentoCartao: (q,s,n)=>n() } };
  const rfx = require.resolve(path.join(RAIZ, 'src/services/fluxo-eventos.js'));
  require.cache[rfx] = { id: rfx, filename: rfx, loaded: true, exports: { calcularLiquidoEvento: (v) => v } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, updates };
}

function resRedirect() { const r = {}; r.redirect = (u) => { r._redirect = u; return r; }; return r; }

test('POST programacao/:pid/transmissao: grava url e duração do dia', async () => {
  const { rotas, updates } = montar();
  const req = { params: { id: '5', pid: '10' }, body: { youtube_url: 'https://youtube.com/watch?v=xyz', duracao_minutos: '185' }, session: {} };
  await rotas['POST /eventos/:id/programacao/:pid/transmissao'](req, resRedirect());
  assert.deepStrictEqual(updates[0], ['https://youtube.com/watch?v=xyz', 185, '10', '5']);
});

test('POST programacao/:pid/transmissao: duração vazia vira null, não NaN nem string vazia', async () => {
  const { rotas, updates } = montar();
  const req = { params: { id: '5', pid: '10' }, body: { youtube_url: '', duracao_minutos: '' }, session: {} };
  await rotas['POST /eventos/:id/programacao/:pid/transmissao'](req, resRedirect());
  assert.strictEqual(updates[0][1], null);
});

test('schema: todas as tabelas usadas pela transmissão por dia têm CREATE TABLE no código (não só no banco)', () => {
  const src = require('fs').readFileSync(path.join(RAIZ, 'src/models/database.js'), 'utf8');
  ['eventos', 'evento_programacao', 'evento_inscricoes', 'evento_certificados', 'evento_presencas_online', 'evento_presencas_tempo', 'evento_presencas_online_dias'].forEach(t => {
    assert.match(src, new RegExp('CREATE TABLE IF NOT EXISTS ' + t + ' \\('), t + ' precisa ter CREATE TABLE no código');
  });
});

test('schema: evento_programacao tem youtube_url e duracao_minutos, evento_presencas_online tem sessao_atual', () => {
  const src = require('fs').readFileSync(path.join(RAIZ, 'src/models/database.js'), 'utf8');
  assert.match(src, /ALTER TABLE evento_programacao ADD COLUMN IF NOT EXISTS youtube_url TEXT/);
  assert.match(src, /ALTER TABLE evento_programacao ADD COLUMN IF NOT EXISTS duracao_minutos INTEGER/);
  assert.match(src, /ALTER TABLE evento_presencas_online ADD COLUMN IF NOT EXISTS sessao_atual TEXT/);
});
