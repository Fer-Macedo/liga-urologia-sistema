// ═══ AUTH (login, logout, recuperação de senha, proteção força bruta) ═══════
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { authenticator } = require('otplib');
const { query } = require('../models/database');
const { getConfig } = require('../services/config');
const { limiterLogin } = require('../services/rate-limiters');

// Termina o login de verdade: regenera a sessão (evita fixation) e carrega as permissões.
// Compartilhado entre o login direto (sem 2FA) e o login após confirmar o código do 2FA.
function completarLogin(req, usuario) {
  return new Promise((resolve) => {
    const dadosUsuario = { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil };
    req.session.regenerate(async (err) => {
      if (err) console.error('Session regenerate erro:', err);
      req.session.usuario = dadosUsuario;
      try {
        const pR = await query('SELECT modulo FROM usuario_permissoes WHERE usuario_id=$1', [usuario.id]);
        req.session.permissoesAtivas = pR.rows.map(r => r.modulo);
      } catch(e) { req.session.permissoesAtivas = []; }
      resolve();
    });
  });
}

module.exports = function (router) {

// ─── PROTEÇÃO FORÇA BRUTA ─────────────────────────────────────────────────────
// Em tabela (login_tentativas), não em memória — sobrevive a restart/deploy e
// funciona igual com mais de um processo do app rodando.

async function verificarBloqueio(ip) {
  const r = await query('SELECT bloqueado_ate FROM login_tentativas WHERE ip=$1', [ip]);
  const t = r.rows[0];
  if (!t || !t.bloqueado_ate) return false;
  if (new Date() < new Date(t.bloqueado_ate)) return true;
  await query('DELETE FROM login_tentativas WHERE ip=$1', [ip]);
  return false;
}

// Retorna o total de tentativas do IP após incrementar.
async function registrarTentativa(ip) {
  const r = await query(
    `INSERT INTO login_tentativas (ip, tentativas) VALUES ($1, 1)
     ON CONFLICT (ip) DO UPDATE SET tentativas = login_tentativas.tentativas + 1
     RETURNING tentativas`,
    [ip]
  );
  const count = r.rows[0].tentativas;
  if (count >= 5) {
    await query('UPDATE login_tentativas SET bloqueado_ate=$1 WHERE ip=$2', [new Date(Date.now() + 15 * 60 * 1000), ip]);
    console.warn('IP bloqueado por tentativas: ' + ip);
  }
  return count;
}

async function limparTentativas(ip) { await query('DELETE FROM login_tentativas WHERE ip=$1', [ip]); }

router.get('/', (req, res) => res.redirect('/dashboard'));

router.get('/login', async (req, res) => {
  if (req.session?.usuario) return res.redirect('/dashboard');
  res.render('pages/login', { config: await getConfig(), erro: req.flash('erro'), msg: req.flash('msg') });
});

router.post('/login', limiterLogin, async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;

  if (await verificarBloqueio(ip)) {
    req.flash('erro', 'Muitas tentativas incorretas. Aguarde 15 minutos.');
    return res.redirect('/login');
  }

  const { email, senha } = req.body;

  if (!email || !senha || email.length > 100 || senha.length > 100) {
    req.flash('erro', 'Dados inválidos.');
    return res.redirect('/login');
  }

  const r = await query('SELECT * FROM usuarios WHERE email = $1 AND ativo = 1', [email.toLowerCase().trim()]);
  const usuario = r.rows[0];

  if (!usuario || !bcrypt.compareSync(senha, usuario.senha)) {
    const count = await registrarTentativa(ip);
    const restantes = Math.max(0, 5 - count);
    req.flash('erro', 'E-mail ou senha incorretos. ' + (restantes > 0 ? restantes + ' tentativas restantes.' : 'IP bloqueado por 15 minutos.'));
    return res.redirect('/login');
  }

  await limparTentativas(ip);

  if (usuario.mfa_ativo) {
    req.session.mfaPendingUserId = usuario.id;
    return res.redirect('/login/verificar');
  }

  console.log('LOGIN: ' + usuario.email + ' | IP: ' + ip + ' | ' + new Date().toISOString());
  await completarLogin(req, usuario);
  res.redirect('/dashboard');
});

// ─── VERIFICAÇÃO DO 2FA (só quando a conta tem mfa_ativo) ─────────────────────

router.get('/login/verificar', async (req, res) => {
  if (!req.session.mfaPendingUserId) return res.redirect('/login');
  res.render('pages/login-mfa', { config: await getConfig(), erro: req.flash('erro') });
});

router.post('/login/verificar', limiterLogin, async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userId = req.session.mfaPendingUserId;
  if (!userId) return res.redirect('/login');

  if (await verificarBloqueio(ip)) {
    req.flash('erro', 'Muitas tentativas incorretas. Aguarde 15 minutos.');
    return res.redirect('/login/verificar');
  }

  const r = await query('SELECT * FROM usuarios WHERE id=$1 AND ativo=1', [userId]);
  const usuario = r.rows[0];
  const codigo = (req.body.codigo || '').replace(/\D/g, '');

  if (!usuario || !usuario.mfa_ativo || !codigo || !authenticator.verify({ token: codigo, secret: usuario.mfa_secret })) {
    await registrarTentativa(ip);
    req.flash('erro', 'Código inválido.');
    return res.redirect('/login/verificar');
  }

  await limparTentativas(ip);
  delete req.session.mfaPendingUserId;
  console.log('LOGIN (2FA): ' + usuario.email + ' | IP: ' + ip + ' | ' + new Date().toISOString());
  await completarLogin(req, usuario);
  res.redirect('/dashboard');
});

router.get('/logout', (req, res) => {
  console.log('LOGOUT: ' + (req.session?.usuario?.email || '?') + ' | ' + new Date().toISOString());
  req.session.destroy();
  res.redirect('/login');
});

// ─── RECUPERAÇÃO DE SENHA ─────────────────────────────────────────────────────

router.get('/recuperar-senha', async (req, res) => {
  res.render('pages/recuperar-senha', {
    config: await getConfig(), enviado: false,
    msg: req.flash('msg'), erro: req.flash('erro')
  });
});

router.post('/recuperar-senha', async (req, res) => {
  const config = await getConfig();
  const email = (req.body.email || '').toLowerCase().trim();
  const r = await query('SELECT * FROM usuarios WHERE email=$1 AND ativo=1', [email]);
  const usuario = r.rows[0];

  if (usuario) {
    const token = crypto.randomBytes(32).toString('hex');
    await query('INSERT INTO tokens_senha (token, usuario_id, expira) VALUES ($1,$2,$3)',
      [token, usuario.id, new Date(Date.now() + 30 * 60 * 1000)]);

    const { enviarEmail } = require('../services/notificacoes');
    const appUrl = process.env.APP_URL || 'https://liga-urologia.onrender.com';
    const link = appUrl + '/nova-senha?token=' + token;
    const orgNome = config.org_nome || 'Liga Academica de Urologia';

    await enviarEmail({
      para: usuario.email,
      assunto: 'Recuperação de senha — ' + orgNome,
      texto: 'Clique no link para redefinir sua senha:\n' + link + '\n\nExpira em 30 minutos.',
      faixaLabel: 'RECUPERAÇÃO DE SENHA',
      html: '<h2 style="margin:0 0 16px">Recuperação de senha</h2><p style="color:#444;margin:0 0 24px">Olá, <strong>' + usuario.nome + '</strong>!<br><br>Clique no botão abaixo para criar uma nova senha:</p><div style="text-align:center;margin:24px 0"><a href="' + link + '" style="display:inline-block;background:#1a56db;color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold">🔒 Redefinir minha senha</a></div><p style="color:#888;font-size:12px">Este link expira em <strong>30 minutos</strong>.<br>Se não solicitou, ignore este e-mail.</p>'
    });

    console.log('RECUPERACAO SENHA: ' + email + ' | ' + new Date().toISOString());
  }

  res.render('pages/recuperar-senha', { config, enviado: true, msg: [], erro: [] });
});

router.get('/nova-senha', async (req, res) => {
  const config = await getConfig();
  const token = req.query.token || '';
  const dados = (await query('SELECT usuario_id, expira FROM tokens_senha WHERE token=$1', [token])).rows[0];
  const tokenValido = !!(dados && new Date() < new Date(dados.expira));
  res.render('pages/nova-senha', { config, token, tokenValido, erro: req.flash('erro') });
});

router.post('/nova-senha', async (req, res) => {
  const config = await getConfig();
  const { token, nova_senha, confirmar_senha } = req.body;
  const dados = (await query('SELECT usuario_id, expira FROM tokens_senha WHERE token=$1', [token])).rows[0];

  if (!dados || new Date() > new Date(dados.expira)) {
    req.flash('erro', 'Link expirado ou inválido. Solicite um novo.');
    return res.redirect('/recuperar-senha');
  }
  if (nova_senha !== confirmar_senha) {
    return res.render('pages/nova-senha', { config, token, tokenValido: true, erro: ['As senhas não coincidem.'] });
  }
  if (nova_senha.length < 8) {
    return res.render('pages/nova-senha', { config, token, tokenValido: true, erro: ['A senha deve ter pelo menos 8 caracteres.'] });
  }

  await query('UPDATE usuarios SET senha=$1 WHERE id=$2', [bcrypt.hashSync(nova_senha, 10), dados.usuario_id]);
  await query('DELETE FROM tokens_senha WHERE token=$1', [token]);

  console.log('SENHA REDEFINIDA: userId ' + dados.usuario_id + ' | ' + new Date().toISOString());
  req.flash('msg', 'Senha redefinida com sucesso! Faça login com a nova senha.');
  res.redirect('/login');
});


};
