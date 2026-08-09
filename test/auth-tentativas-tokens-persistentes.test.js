// Auditoria de segurança 2026-08-08: bloqueio de força bruta e tokens de "esqueci senha"
// viviam em objeto JS em memória — zerava a cada restart/deploy e não escalava com mais de
// um processo. Movidos pras tabelas login_tentativas e tokens_senha (src/models/database.js).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const bcrypt = require('bcryptjs');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/auth.js');

function montar({ usuario, emailsEnviados } = {}) {
  const loginTentativas = new Map(); // ip -> { tentativas, bloqueado_ate }
  const tokensSenha = new Map();     // token -> { usuario_id, expira }
  const senhasAtualizadas = [];
  const emails = emailsEnviados || [];

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT \* FROM usuarios WHERE email/.test(sql)) {
        const email = params[0];
        return { rows: usuario && usuario.email === email ? [usuario] : [] };
      }
      if (/SELECT modulo FROM usuario_permissoes/.test(sql)) return { rows: [] };
      if (/UPDATE usuarios SET senha/.test(sql)) { senhasAtualizadas.push({ id: params[1], senha: params[0] }); return { rows: [] }; }

      if (/SELECT bloqueado_ate FROM login_tentativas WHERE ip=\$1/.test(sql)) {
        const t = loginTentativas.get(params[0]);
        return { rows: t ? [{ bloqueado_ate: t.bloqueado_ate }] : [] };
      }
      if (/INSERT INTO login_tentativas/.test(sql)) {
        const ip = params[0];
        const atual = loginTentativas.get(ip) || { tentativas: 0, bloqueado_ate: null };
        atual.tentativas += 1;
        loginTentativas.set(ip, atual);
        return { rows: [{ tentativas: atual.tentativas }] };
      }
      if (/UPDATE login_tentativas SET bloqueado_ate/.test(sql)) {
        const [bloqueadoAte, ip] = params;
        const atual = loginTentativas.get(ip) || { tentativas: 0 };
        atual.bloqueado_ate = bloqueadoAte;
        loginTentativas.set(ip, atual);
        return { rows: [] };
      }
      if (/DELETE FROM login_tentativas WHERE ip=\$1/.test(sql)) { loginTentativas.delete(params[0]); return { rows: [] }; }

      if (/INSERT INTO tokens_senha/.test(sql)) {
        const [token, usuarioId, expira] = params;
        tokensSenha.set(token, { usuario_id: usuarioId, expira });
        return { rows: [] };
      }
      if (/SELECT usuario_id, expira FROM tokens_senha WHERE token=\$1/.test(sql)) {
        const t = tokensSenha.get(params[0]);
        return { rows: t ? [t] : [] };
      }
      if (/DELETE FROM tokens_senha WHERE token=\$1/.test(sql)) { tokensSenha.delete(params[0]); return { rows: [] }; }

      return { rows: [] };
    }
  }};
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };
  const rrl = require.resolve(path.join(RAIZ, 'src/services/rate-limiters.js'));
  require.cache[rrl] = { id: rrl, filename: rrl, loaded: true, exports: { limiterLogin: (q, s, n) => n() } };
  const rnt = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rnt] = { id: rnt, filename: rnt, loaded: true, exports: { enviarEmail: async (opts) => { emails.push(opts); } } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET ' + rota] = fns[fns.length - 1]; }, post: (rota, ...fns) => { rotas['POST ' + rota] = fns[fns.length - 1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, loginTentativas, tokensSenha, senhasAtualizadas, emails };
}

function reqLogin(email, senha, ip) {
  return { ip: ip || '203.0.113.9', connection: {}, body: { email, senha }, flash: () => {}, session: {} };
}

function resRedirect() {
  const r = { _redirect: null };
  r.redirect = (url) => { r._redirect = url; return r; };
  return r;
}

const senhaCerta = bcrypt.hashSync('senhaCorreta123', 10);
const usuarioBase = { id: 7, nome: 'Admin', email: 'admin@liga.org.br', senha: senhaCerta, perfil: 'admin' };

test('5 tentativas erradas bloqueiam o IP por 15 minutos', async () => {
  const { rotas, loginTentativas } = montar({ usuario: usuarioBase });
  const ip = '198.51.100.4';
  for (let i = 0; i < 5; i++) {
    await rotas['POST /login'](reqLogin('admin@liga.org.br', 'senhaErrada', ip), resRedirect());
  }
  const estado = loginTentativas.get(ip);
  assert.strictEqual(estado.tentativas, 5);
  assert.ok(estado.bloqueado_ate, 'IP tem que ficar marcado como bloqueado após a 5ª tentativa');
});

test('IP bloqueado é recusado mesmo com a senha certa', async () => {
  const { rotas, loginTentativas } = montar({ usuario: usuarioBase });
  const ip = '198.51.100.5';
  loginTentativas.set(ip, { tentativas: 5, bloqueado_ate: new Date(Date.now() + 10 * 60 * 1000) });
  const req = reqLogin('admin@liga.org.br', 'senhaCorreta123', ip);
  let redirecionouSemLogar = false;
  req.session.regenerate = () => { redirecionouSemLogar = true; }; // não deveria nem chegar aqui
  const res = resRedirect();
  await rotas['POST /login'](req, res);
  assert.strictEqual(res._redirect, '/login');
  assert.strictEqual(redirecionouSemLogar, false, 'bloqueado não pode logar mesmo acertando a senha');
});

test('bloqueio expirado libera o IP de novo', async () => {
  const { rotas, loginTentativas } = montar({ usuario: usuarioBase });
  const ip = '198.51.100.6';
  loginTentativas.set(ip, { tentativas: 5, bloqueado_ate: new Date(Date.now() - 1000) }); // já passou
  const req = reqLogin('admin@liga.org.br', 'senhaCorreta123', ip);
  req.session.regenerate = (cb) => cb(null);
  await rotas['POST /login'](req, resRedirect());
  assert.strictEqual(req.session.usuario.email, 'admin@liga.org.br', 'bloqueio vencido não pode continuar barrando login válido');
});

test('login certo limpa as tentativas anteriores', async () => {
  const { rotas, loginTentativas } = montar({ usuario: usuarioBase });
  const ip = '198.51.100.7';
  loginTentativas.set(ip, { tentativas: 3, bloqueado_ate: null });
  const req = reqLogin('admin@liga.org.br', 'senhaCorreta123', ip);
  req.session.regenerate = (cb) => cb(null);
  await rotas['POST /login'](req, resRedirect());
  assert.strictEqual(loginTentativas.has(ip), false, 'sucesso zera o histórico de tentativas do IP');
});

test('token de recuperação de senha: emitido, usado uma vez, some depois', async () => {
  const { rotas, tokensSenha, emails } = montar({ usuario: usuarioBase });
  const reqPost = { body: { email: 'admin@liga.org.br' }, flash: () => {} };
  const resRender = { render: (view, dados) => { resRender._dados = dados; } };
  await rotas['POST /recuperar-senha'](reqPost, resRender);
  assert.strictEqual(emails.length, 1, 'e-mail de recuperação tem que sair');
  assert.strictEqual(tokensSenha.size, 1, 'token tem que ficar salvo pra ser validado depois');

  const [token] = tokensSenha.keys();
  const resNova = { render: (view, dados) => { resNova._dados = dados; } };
  await rotas['GET /nova-senha']({ query: { token }, flash: () => {} }, resNova);
  assert.strictEqual(resNova._dados.tokenValido, true);
});

test('token expirado não permite redefinir a senha', async () => {
  const { rotas, tokensSenha, senhasAtualizadas } = montar({ usuario: usuarioBase });
  tokensSenha.set('TOKEN_VENCIDO', { usuario_id: usuarioBase.id, expira: new Date(Date.now() - 1000) });
  const req = { body: { token: 'TOKEN_VENCIDO', nova_senha: 'NovaSenha123', confirmar_senha: 'NovaSenha123' }, flash: () => {} };
  const res = resRedirect();
  await rotas['POST /nova-senha'](req, res);
  assert.strictEqual(res._redirect, '/recuperar-senha');
  assert.strictEqual(senhasAtualizadas.length, 0, 'token vencido não pode trocar senha de ninguém');
});

test('token usado uma vez não pode ser reaproveitado', async () => {
  const { rotas, tokensSenha, senhasAtualizadas } = montar({ usuario: usuarioBase });
  tokensSenha.set('TOKEN_VALIDO', { usuario_id: usuarioBase.id, expira: new Date(Date.now() + 10 * 60 * 1000) });
  const reqBody = { token: 'TOKEN_VALIDO', nova_senha: 'NovaSenha123', confirmar_senha: 'NovaSenha123' };

  await rotas['POST /nova-senha']({ body: reqBody, flash: () => {} }, { redirect: () => {}, render: () => {} });
  assert.strictEqual(senhasAtualizadas.length, 1);
  assert.strictEqual(tokensSenha.has('TOKEN_VALIDO'), false, 'token usado precisa sumir da tabela');

  // segunda tentativa com o mesmo token: já não existe mais
  const res2 = resRedirect();
  await rotas['POST /nova-senha']({ body: reqBody, flash: () => {} }, res2);
  assert.strictEqual(res2._redirect, '/recuperar-senha');
  assert.strictEqual(senhasAtualizadas.length, 1, 'reuso do token não pode trocar a senha de novo');
});
