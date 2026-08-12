// 11/08/2026: o campo "Email de confirmação personalizado" nascia vazio em todo evento
// novo — quem criava tinha que lembrar de copiar e colar o texto de um evento anterior
// (e às vezes esquecia, deixando o evento sem confirmação visível pra editar/revisar).
// Esse texto tem regra fixa (placeholders {nombre}/{evento}) e deve vir pronto desde a
// criação, não só como fallback silencioso no envio.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');
const { TEXTO_CONFIRMACAO_PADRAO } = require(path.join(RAIZ, 'src/services/eventos-email.js'));

function montar() {
  const inserts = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/INSERT INTO eventos/.test(sql)) { inserts.push({ sql, params }); return { rows: [] }; }
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };
  const re = require.resolve(path.join(RAIZ, 'src/services/email.js'));
  require.cache[re] = { id: re, filename: re, loaded: true, exports: { enviarEmail: async () => {}, emailBonito: () => '' } };
  const rar = require.resolve(path.join(RAIZ, 'src/services/arquivos.js'));
  require.cache[rar] = { id: rar, filename: rar, loaded: true, exports: { upload: { single: () => (req,res,cb) => cb() }, uploadArquivo: async () => ({ chave: 'x' }) } };
  const rpg = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  require.cache[rpg] = { id: rpg, filename: rpg, loaded: true, exports: { criarPixEvento: async () => ({}), consultarPagamento: async () => ({}), obterChavePublica: async () => ({}), pagarComCartao: async () => ({}) } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, inserts };
}

test('criar evento já preenche email_inscricao com o texto padrão', async () => {
  const { rotas, inserts } = montar();
  const req = { body: { nome: 'Congresso Teste' }, session: { usuario: { id: 1 } } };
  const res = { redirect: () => {} };
  await rotas['POST /eventos'](req, res);
  assert.strictEqual(inserts.length, 1);
  const idxEmailInscricao = inserts[0].sql.match(/\(([^)]+)\)\s*VALUES/)[1].split(',').indexOf('email_inscricao');
  assert.strictEqual(inserts[0].params[idxEmailInscricao], TEXTO_CONFIRMACAO_PADRAO);
  assert.match(TEXTO_CONFIRMACAO_PADRAO, /\{nombre\}/);
  assert.match(TEXTO_CONFIRMACAO_PADRAO, /\{evento\}/);
});
