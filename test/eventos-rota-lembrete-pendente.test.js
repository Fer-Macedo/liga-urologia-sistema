// Rota manual: POST /eventos/:id/inscricoes/:iid/lembrete-pendente — botão "Lembrete" que
// só aparece pra inscrições com status='pendente' em evento-detalhe.ejs.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar(respostaLembrete) {
  const chamadas = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: { query: async () => ({ rows: [] }) } };
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };
  const re = require.resolve(path.join(RAIZ, 'src/services/email.js'));
  require.cache[re] = { id: re, filename: re, loaded: true, exports: { enviarEmail: async () => {}, emailBonito: () => '' } };
  const rev = require.resolve(path.join(RAIZ, 'src/services/eventos-email.js'));
  require.cache[rev] = { id: rev, filename: rev, loaded: true, exports: { enviarEmailConfirmacaoEvento: async () => {}, TEXTO_CONFIRMACAO_PADRAO: 'x' } };
  const rpg = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  require.cache[rpg] = { id: rpg, filename: rpg, loaded: true, exports: { criarPixEvento: async () => ({}), consultarPagamento: async () => ({}), obterChavePublica: async () => ({}), pagarComCartao: async () => ({}) } };
  const rag = require.resolve(path.join(RAIZ, 'src/services/agendamentos.js'));
  require.cache[rag] = { id: rag, filename: rag, loaded: true, exports: {
    enviarLembreteInscricaoPendente: async (id) => { chamadas.push(id); return respostaLembrete; }
  }};

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, chamadas };
}

function resRedirect() {
  const r = { _redirect: null };
  r.redirect = (url) => { r._redirect = url; return r; };
  return r;
}

test('botão manual chama enviarLembreteInscricaoPendente com o id certo e confirma sucesso', async () => {
  const { rotas, chamadas } = montar({ ok: true, wppOk: true, emailOk: true });
  const req = { params: { id: '3', iid: '42' }, session: {} };
  const res = resRedirect();
  await rotas['POST /eventos/:id/inscricoes/:iid/lembrete-pendente'](req, res);
  assert.deepStrictEqual(chamadas, ['42']);
  assert.deepStrictEqual(req.session.msg, ['Lembrete de pagamento enviado!']);
  assert.strictEqual(res._redirect, '/eventos/3?tab=inscritos');
});

test('falha no envio (sem WhatsApp nem e-mail) mostra erro, não sucesso falso', async () => {
  const { rotas } = montar({ ok: false, motivo: 'Não foi possível enviar (sem WhatsApp/e-mail cadastrado?).' });
  const req = { params: { id: '3', iid: '42' }, session: {} };
  const res = resRedirect();
  await rotas['POST /eventos/:id/inscricoes/:iid/lembrete-pendente'](req, res);
  assert.strictEqual(req.session.msg, undefined);
  assert.ok(req.session.erro && req.session.erro[0].includes('WhatsApp'));
});
