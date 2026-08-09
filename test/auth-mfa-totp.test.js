// Segurança 2026-08-08: 2FA (TOTP) opcional por conta, ligado em /perfil. Usuário com
// mfa_ativo precisa passar por /login/verificar depois da senha certa — a senha sozinha
// não basta pra completar o login.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/auth.js');

function montar({ usuario, loginTentativasIniciais } = {}) {
  const loginTentativas = new Map(loginTentativasIniciais ? Object.entries(loginTentativasIniciais) : []);

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT \* FROM usuarios WHERE email/.test(sql)) {
        return { rows: usuario && usuario.email === params[0] ? [usuario] : [] };
      }
      if (/SELECT \* FROM usuarios WHERE id=\$1 AND ativo=1/.test(sql)) {
        return { rows: usuario && usuario.id === params[0] ? [usuario] : [] };
      }
      if (/SELECT modulo FROM usuario_permissoes/.test(sql)) return { rows: [] };

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

      return { rows: [] };
    }
  }};
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };
  const rrl = require.resolve(path.join(RAIZ, 'src/services/rate-limiters.js'));
  require.cache[rrl] = { id: rrl, filename: rrl, loaded: true, exports: { limiterLogin: (q, s, n) => n() } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET ' + rota] = fns[fns.length - 1]; }, post: (rota, ...fns) => { rotas['POST ' + rota] = fns[fns.length - 1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, loginTentativas };
}

function resRedirect() {
  const r = { _redirect: null };
  r.redirect = (url) => { r._redirect = url; return r; };
  return r;
}

function reqBase(overrides) {
  return Object.assign({ ip: '203.0.113.20', connection: {}, flash: () => {}, session: {} }, overrides);
}

const senha = bcrypt.hashSync('senhaCorreta123', 10);
const mfaSecret = authenticator.generateSecret();
const usuarioComMfa = { id: 9, nome: 'Presidencia', email: 'presidencia@liga.org.br', senha, perfil: 'admin', mfa_ativo: true, mfa_secret: mfaSecret };
const usuarioSemMfa = { id: 10, nome: 'Secretaria', email: 'secretaria@liga.org.br', senha, perfil: 'secretaria', mfa_ativo: false, mfa_secret: null };

test('conta sem 2FA: login com senha certa completa direto (sem passar por /login/verificar)', async () => {
  const { rotas } = montar({ usuario: usuarioSemMfa });
  const req = reqBase({ body: { email: usuarioSemMfa.email, senha: 'senhaCorreta123' } });
  req.session.regenerate = (cb) => cb(null);
  const res = resRedirect();
  await rotas['POST /login'](req, res);
  assert.strictEqual(res._redirect, '/dashboard');
  assert.strictEqual(req.session.usuario.email, usuarioSemMfa.email);
});

test('conta com 2FA: senha certa NÃO loga direto — vai para /login/verificar', async () => {
  const { rotas } = montar({ usuario: usuarioComMfa });
  const req = reqBase({ body: { email: usuarioComMfa.email, senha: 'senhaCorreta123' } });
  let regenerouSessao = false;
  req.session.regenerate = () => { regenerouSessao = true; };
  const res = resRedirect();
  await rotas['POST /login'](req, res);
  assert.strictEqual(res._redirect, '/login/verificar');
  assert.strictEqual(req.session.mfaPendingUserId, usuarioComMfa.id);
  assert.strictEqual(regenerouSessao, false, 'senha certa sozinha não pode completar o login de quem tem 2FA');
  assert.strictEqual(req.session.usuario, undefined);
});

test('GET /login/verificar sem mfaPendingUserId redireciona pro /login (não dá pra pular a senha)', async () => {
  const { rotas } = montar({ usuario: usuarioComMfa });
  const req = { session: {}, flash: () => {} };
  const res = resRedirect();
  await rotas['GET /login/verificar'](req, res);
  assert.strictEqual(res._redirect, '/login');
});

test('código TOTP certo completa o login', async () => {
  const { rotas } = montar({ usuario: usuarioComMfa });
  const codigo = authenticator.generate(mfaSecret);
  const req = reqBase({ body: { codigo }, session: { mfaPendingUserId: usuarioComMfa.id } });
  req.session.regenerate = (cb) => cb(null);
  const res = resRedirect();
  await rotas['POST /login/verificar'](req, res);
  assert.strictEqual(res._redirect, '/dashboard');
  assert.strictEqual(req.session.usuario.email, usuarioComMfa.email);
  assert.strictEqual(req.session.mfaPendingUserId, undefined, 'estado pendente tem que ser limpo após confirmar');
});

test('código TOTP errado não completa o login e conta como tentativa', async () => {
  const { rotas, loginTentativas } = montar({ usuario: usuarioComMfa });
  const req = reqBase({ body: { codigo: '000000' }, session: { mfaPendingUserId: usuarioComMfa.id } });
  let regenerouSessao = false;
  req.session.regenerate = () => { regenerouSessao = true; };
  const res = resRedirect();
  await rotas['POST /login/verificar'](req, res);
  assert.strictEqual(res._redirect, '/login/verificar');
  assert.strictEqual(regenerouSessao, false);
  assert.strictEqual(loginTentativas.get(req.ip).tentativas, 1, 'código errado também conta pro bloqueio de força bruta');
});

test('POST /login/verificar sem mfaPendingUserId (tentando pular a senha direto) é recusado', async () => {
  const { rotas } = montar({ usuario: usuarioComMfa });
  const codigo = authenticator.generate(mfaSecret);
  const req = reqBase({ body: { codigo }, session: {} });
  const res = resRedirect();
  await rotas['POST /login/verificar'](req, res);
  assert.strictEqual(res._redirect, '/login');
});

test('IP bloqueado por força bruta também bloqueia a tela de código do 2FA', async () => {
  const { rotas } = montar({
    usuario: usuarioComMfa,
    loginTentativasIniciais: { '203.0.113.20': { tentativas: 5, bloqueado_ate: new Date(Date.now() + 10 * 60 * 1000) } }
  });
  const codigo = authenticator.generate(mfaSecret);
  const req = reqBase({ body: { codigo }, session: { mfaPendingUserId: usuarioComMfa.id } });
  const res = resRedirect();
  await rotas['POST /login/verificar'](req, res);
  assert.strictEqual(res._redirect, '/login/verificar');
  assert.strictEqual(req.session.usuario, undefined, 'nem o código certo passa com o IP bloqueado');
});
