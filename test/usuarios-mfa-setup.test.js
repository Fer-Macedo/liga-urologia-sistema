// Segurança 2026-08-08: fluxo de configuração do 2FA em /perfil — gerar segredo, confirmar
// com um código válido antes de ativar de fato, e exigir a senha atual pra desativar.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/usuarios.js');

function montar({ usuario } = {}) {
  const updates = [];

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT \* FROM usuarios WHERE id=\$1/.test(sql)) return { rows: usuario ? [usuario] : [] };
      if (/UPDATE usuarios SET mfa_secret=\$1, mfa_ativo=true/.test(sql)) {
        updates.push({ tipo: 'ativar', secret: params[0], userId: params[1] });
        if (usuario) { usuario.mfa_secret = params[0]; usuario.mfa_ativo = true; }
        return { rows: [] };
      }
      if (/UPDATE usuarios SET mfa_secret=NULL, mfa_ativo=false/.test(sql)) {
        updates.push({ tipo: 'desativar', userId: params[0] });
        if (usuario) { usuario.mfa_secret = null; usuario.mfa_ativo = false; }
        return { rows: [] };
      }
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({ org_nome: 'LAURO Teste' }) } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET ' + rota] = fns[fns.length - 1]; }, post: (rota, ...fns) => { rotas['POST ' + rota] = fns[fns.length - 1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, updates };
}

function resRedirect() {
  const r = { _redirect: null };
  r.redirect = (url) => { r._redirect = url; return r; };
  return r;
}
function resJson() {
  const r = { _json: null };
  r.json = (d) => { r._json = d; return r; };
  return r;
}

const senha = bcrypt.hashSync('senhaAtual123', 10);
function usuarioBase() { return { id: 3, nome: 'Fer', email: 'fer@liga.org.br', senha, perfil: 'admin', mfa_secret: null, mfa_ativo: false }; }

test('POST /mfa/iniciar gera um segredo novo e devolve a URL otpauth pra montar o QR', async () => {
  const { rotas } = montar({ usuario: usuarioBase() });
  const req = { session: { usuario: { id: 3, email: 'fer@liga.org.br' } }, body: {} };
  const res = resJson();
  await rotas['POST /mfa/iniciar'](req, res);
  assert.strictEqual(res._json.ok, true);
  assert.ok(res._json.secret.length >= 16, 'segredo TOTP tem que ter tamanho razoável');
  assert.ok(res._json.otpauthUrl.startsWith('otpauth://totp/'), 'precisa ser uma URI otpauth válida pro QR');
  assert.strictEqual(req.session.mfaSetupSecret, res._json.secret, 'segredo pendente fica na sessão até confirmar');
});

test('POST /mfa/confirmar com código certo ativa o 2FA', async () => {
  const { rotas, updates } = montar({ usuario: usuarioBase() });
  const secret = authenticator.generateSecret();
  const req = { session: { usuario: { id: 3 }, mfaSetupSecret: secret }, body: { codigo: authenticator.generate(secret) }, flash: () => {} };
  const res = resRedirect();
  await rotas['POST /mfa/confirmar'](req, res);
  assert.strictEqual(res._redirect, '/perfil');
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].tipo, 'ativar');
  assert.strictEqual(updates[0].secret, secret);
  assert.strictEqual(req.session.mfaSetupSecret, undefined, 'segredo pendente tem que sumir da sessão após confirmar');
});

test('POST /mfa/confirmar com código errado NÃO ativa nada', async () => {
  const { rotas, updates } = montar({ usuario: usuarioBase() });
  const secret = authenticator.generateSecret();
  const req = { session: { usuario: { id: 3 }, mfaSetupSecret: secret }, body: { codigo: '000000' }, flash: () => {} };
  const res = resRedirect();
  await rotas['POST /mfa/confirmar'](req, res);
  assert.strictEqual(updates.length, 0, 'código errado não pode ativar o 2FA');
});

test('POST /mfa/confirmar sem ter chamado /mfa/iniciar antes (sem segredo pendente) é recusado', async () => {
  const { rotas, updates } = montar({ usuario: usuarioBase() });
  const req = { session: { usuario: { id: 3 } }, body: { codigo: '123456' }, flash: () => {} };
  await rotas['POST /mfa/confirmar'](req, resRedirect());
  assert.strictEqual(updates.length, 0);
});

test('POST /mfa/desativar exige a senha atual certa', async () => {
  const usuario = Object.assign(usuarioBase(), { mfa_ativo: true, mfa_secret: 'ALGUMSECRETO' });
  const { rotas, updates } = montar({ usuario });
  const req = { session: { usuario: { id: 3 } }, body: { senha_confirmacao: 'senhaErrada' }, flash: () => {} };
  await rotas['POST /mfa/desativar'](req, resRedirect());
  assert.strictEqual(updates.length, 0, 'senha errada não pode desativar o 2FA de ninguém');
});

test('POST /mfa/desativar com a senha certa desliga o 2FA', async () => {
  const usuario = Object.assign(usuarioBase(), { mfa_ativo: true, mfa_secret: 'ALGUMSECRETO' });
  const { rotas, updates } = montar({ usuario });
  const req = { session: { usuario: { id: 3 } }, body: { senha_confirmacao: 'senhaAtual123' }, flash: () => {} };
  const res = resRedirect();
  await rotas['POST /mfa/desativar'](req, res);
  assert.strictEqual(res._redirect, '/perfil');
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].tipo, 'desativar');
});
