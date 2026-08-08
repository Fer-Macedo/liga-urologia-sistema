// Auditoria de segurança 2026-08-08: /contato-evento/:id montava o e-mail que a liga recebe
// concatenando nome/email/mensagem SEM escapar — alguém preenchendo o formulário público
// conseguia injetar HTML de verdade (link disfarçado, imagem, etc) dentro do e-mail. E a
// rota (junto com /inscricao/:id e /checkout/:id) não tinha rate-limit nenhum.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar() {
  const emailsEnviados = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: { query: async () => ({ rows: [] }) } };
  const re = require.resolve(path.join(RAIZ, 'src/services/email.js'));
  require.cache[re] = { id: re, filename: re, loaded: true, exports: {
    enviarEmail: async (opts) => { emailsEnviados.push(opts); },
    emailBonito: () => ''
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };
  const rpg = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  require.cache[rpg] = { id: rpg, filename: rpg, loaded: true, exports: { criarPixEvento: async () => ({}), consultarPagamento: async () => ({}) } };
  const rev = require.resolve(path.join(RAIZ, 'src/services/eventos-email.js'));
  require.cache[rev] = { id: rev, filename: rev, loaded: true, exports: { enviarEmailConfirmacaoEvento: async () => {} } };

  const rotas = {};
  const middlewaresPorRota = {};
  const router = { get: (rota, ...fns) => { rotas[rota] = fns[fns.length - 1]; middlewaresPorRota[rota] = fns; }, post: (rota, ...fns) => { rotas[rota] = fns[fns.length - 1]; middlewaresPorRota[rota] = fns; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, middlewaresPorRota, emailsEnviados };
}

function resFake() {
  const r = {};
  r.send = (v) => { r._sent = v; return r; };
  r.status = () => r;
  return r;
}

test('contato-evento: nome/email/mensagem vem escapados no HTML do e-mail', async () => {
  const { rotas, emailsEnviados } = montar();
  const req = { params: { id: '4' }, body: { nome: '<img src=x onerror=alert(1)>', email: 'a@b.com', mensagem: 'oi <script>roubaCookie()</script>' } };
  await rotas['/contato-evento/:id'](req, resFake());
  assert.strictEqual(emailsEnviados.length, 1);
  const html = emailsEnviados[0].html;
  assert.ok(!html.includes('<img src=x onerror'), 'nome não pode virar HTML de verdade no e-mail');
  assert.ok(!html.includes('<script>roubaCookie'), 'mensagem não pode virar HTML de verdade no e-mail');
  assert.ok(html.includes('&lt;img'), 'o texto original deve aparecer escapado, não sumir');
});

test('contato-evento, inscricao e checkout: têm rate-limit aplicado (não são só a função da rota)', async () => {
  const { middlewaresPorRota } = montar();
  ['/contato-evento/:id', '/inscricao/:id', '/checkout/:id'].forEach(rota => {
    assert.ok(middlewaresPorRota[rota].length > 1, rota + ' precisa ter um middleware de rate-limit antes do handler');
  });
});
