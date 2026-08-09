// ═══ USUÁRIOS DO PAINEL (+ meu perfil + auditoria) ══════════════════════════
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');
const { query } = require('../models/database');
const { requireAuth, requireAdmin, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');

function extrairModulosDaSidebar() {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../views/partials/sidebar.ejs'), 'utf8');
  const re = /<% if \(temPerm\('([a-z0-9-]+)'\)\) \{ %>[\s\S]*?<a href="[^"]*" class="nav-item[^"]*"[^>]*>\s*<span class="nav-icon">[\s\S]*?<\/span>\s*<span[^>]*>([^<]+)<\/span>/g;
  const vistos = new Set();
  const modulos = [];
  let m;
  while ((m = re.exec(src))) {
    if (vistos.has(m[1])) continue;
    vistos.add(m[1]);
    modulos.push({ id: m[1], label: m[2].trim() });
  }
  // Itens de admin da Sidebar nao usam temPerm (sao liberados so por isAdmin), mas ainda
  // fazem sentido como permissao assinavel para outros perfis, entao entram manualmente.
  ['usuarios', 'auditoria', 'configuracoes'].forEach(id => {
    if (!vistos.has(id)) modulos.push({ id, label: id.charAt(0).toUpperCase() + id.slice(1) });
  });
  return modulos;
}

module.exports = function (router) {

// ─── USUÁRIOS ──────────────────────────────────────────────────────────────────

router.post('/usuarios/:id/toggle', requireAuth, requireAdmin, async (req, res) => {
  const r = await query('SELECT * FROM usuarios WHERE id=$1', [req.params.id]);
  const u = r.rows[0];
  if (u && u.perfil !== 'admin') {
    await query('UPDATE usuarios SET ativo=$1 WHERE id=$2', [u.ativo ? 0 : 1, u.id]);
  }
  res.redirect('/usuarios');
});

router.post('/usuarios/:id/senha', requireAuth, requireAdmin, async (req, res) => {
  const hash = bcrypt.hashSync(req.body.nova_senha, 10);
  await query('UPDATE usuarios SET senha=$1 WHERE id=$2', [hash, req.params.id]);
  req.flash('msg', 'Senha alterada!');
  res.redirect('/usuarios');
});

router.post('/usuarios/:id/telefone', requireAuth, requireAdmin, async (req, res) => {
  await query('UPDATE usuarios SET telefone=$1 WHERE id=$2', [req.body.telefone || null, req.params.id]);
  req.flash('msg', 'Telefone atualizado!');
  res.redirect('/usuarios');
});

// ─── MEU PERFIL ───────────────────────────────────────────────────────────────

// Meu Perfil. O botao do dashboard apontava para /perfil desde sempre, mas a pagina nunca
// existiu — dava 404. As acoes (/minha-senha e /meu-email) ja estavam prontas logo abaixo;
// faltava so a tela para chegar ate elas.
router.get('/perfil', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT criado_em, mfa_ativo FROM usuarios WHERE id=$1', [req.session.usuario.id]);
    const c = r.rows[0] && r.rows[0].criado_em;
    res.render('pages/perfil', {
      config: await getConfig(), usuario: req.session.usuario,
      msg: req.flash('msg'), erro: req.flash('erro'),
      criadoEm: c ? new Date(c).toLocaleDateString('pt-BR') : null,
      mfaAtivo: !!(r.rows[0] && r.rows[0].mfa_ativo)
    });
  } catch (e) { console.error(e); req.flash('erro', e.message); res.redirect('/dashboard'); }
});

// ─── AUTENTICAÇÃO EM DUAS ETAPAS (TOTP) ────────────────────────────────────────
// Opcional, por conta — cada usuário liga pra si mesmo em /perfil. Não é obrigatório
// por perfil porque forçar de uma vez trancaria contas existentes que nunca configuraram.

router.post('/mfa/iniciar', requireAuth, async (req, res) => {
  const secret = authenticator.generateSecret();
  req.session.mfaSetupSecret = secret;
  const config = await getConfig();
  const emissor = (config.org_nome || 'LAURO').substring(0, 30);
  const otpauthUrl = authenticator.keyuri(req.session.usuario.email, emissor, secret);
  res.json({ ok: true, secret, otpauthUrl });
});

router.post('/mfa/confirmar', requireAuth, async (req, res) => {
  const secret = req.session.mfaSetupSecret;
  const codigo = (req.body.codigo || '').replace(/\D/g, '');
  if (!secret || !codigo || !authenticator.verify({ token: codigo, secret })) {
    req.flash('erro', 'Código inválido. Escaneie o QR de novo e tente outra vez.');
    return res.redirect('/perfil');
  }
  await query('UPDATE usuarios SET mfa_secret=$1, mfa_ativo=true WHERE id=$2', [secret, req.session.usuario.id]);
  delete req.session.mfaSetupSecret;
  req.flash('msg', 'Autenticação em duas etapas ativada!');
  res.redirect('/perfil');
});

router.post('/mfa/desativar', requireAuth, async (req, res) => {
  const r = await query('SELECT * FROM usuarios WHERE id=$1', [req.session.usuario.id]);
  const usuario = r.rows[0];
  if (!usuario || !bcrypt.compareSync(req.body.senha_confirmacao || '', usuario.senha)) {
    req.flash('erro', 'Senha atual incorreta.');
    return res.redirect('/perfil');
  }
  await query('UPDATE usuarios SET mfa_secret=NULL, mfa_ativo=false WHERE id=$1', [usuario.id]);
  req.flash('msg', 'Autenticação em duas etapas desativada.');
  res.redirect('/perfil');
});

router.post('/minha-senha', requireAuth, async (req, res) => {
  const { senha_atual, nova_senha, confirmar_senha } = req.body;

  if (!nova_senha || nova_senha.length < 8) {
    req.flash('erro', 'A nova senha deve ter pelo menos 8 caracteres.');
    return res.redirect('/perfil');
  }
  if (nova_senha !== confirmar_senha) {
    req.flash('erro', 'A nova senha e a confirmação não coincidem.');
    return res.redirect('/perfil');
  }

  const r = await query('SELECT * FROM usuarios WHERE id=$1', [req.session.usuario.id]);
  const usuario = r.rows[0];

  if (!usuario || !bcrypt.compareSync(senha_atual, usuario.senha)) {
    req.flash('erro', 'Senha atual incorreta.');
    return res.redirect('/perfil');
  }

  const novoHash = bcrypt.hashSync(nova_senha, 10);
  await query('UPDATE usuarios SET senha=$1 WHERE id=$2', [novoHash, usuario.id]);

  console.log('SENHA ALTERADA: ' + usuario.email + ' | ' + new Date().toISOString());
  req.flash('msg', 'Senha alterada com sucesso! Faça login novamente.');
  req.session.destroy();
  res.redirect('/login');
});

router.post('/meu-email', requireAuth, async (req, res) => {
  const { novo_email, senha_confirmacao } = req.body;

  if (!novo_email || !novo_email.includes('@')) {
    req.flash('erro', 'E-mail inválido.');
    return res.redirect('/perfil');
  }

  const r = await query('SELECT * FROM usuarios WHERE id=$1', [req.session.usuario.id]);
  const usuario = r.rows[0];

  if (!usuario || !bcrypt.compareSync(senha_confirmacao, usuario.senha)) {
    req.flash('erro', 'Senha incorreta. Não foi possível alterar o e-mail.');
    return res.redirect('/perfil');
  }

  const emailExiste = await query('SELECT id FROM usuarios WHERE email=$1 AND id!=$2', [novo_email.toLowerCase().trim(), usuario.id]);
  if (emailExiste.rows.length > 0) {
    req.flash('erro', 'Este e-mail já está em uso.');
    return res.redirect('/perfil');
  }

  await query('UPDATE usuarios SET email=$1 WHERE id=$2', [novo_email.toLowerCase().trim(), usuario.id]);
  req.session.usuario.email = novo_email.toLowerCase().trim();

  console.log('EMAIL ALTERADO: ' + usuario.email + ' -> ' + novo_email + ' | ' + new Date().toISOString());
  req.flash('msg', 'E-mail alterado com sucesso!');
  res.redirect('/perfil');
});

router.get('/usuarios', requireAuth, requirePermissao('usuarios'), async (req, res) => {
  const config = await getConfig();
  const r = await query('SELECT id,nome,email,perfil,ativo,criado_em,telefone FROM usuarios ORDER BY criado_em');

  const permR = await query('SELECT usuario_id, modulo FROM usuario_permissoes');
  const permissoesUsuarios = {};
  permR.rows.forEach(function(row) {
    if (!permissoesUsuarios[row.usuario_id]) permissoesUsuarios[row.usuario_id] = [];
    permissoesUsuarios[row.usuario_id].push(row.modulo);
  });

  const modulosSidebar = extrairModulosDaSidebar();

  res.render('pages/usuarios', {
    config, usuario: req.session.usuario,
    usuarios: r.rows, permissoesUsuarios, modulosSidebar,
    msg: req.flash('msg'), erro: req.flash('erro')
  });
});

router.post('/usuarios/:id/permissoes', requireAuth, requireAdmin, async (req, res) => {
  const userId = req.params.id;
  const modulos = [].concat(req.body.modulos || []);
  await query('DELETE FROM usuario_permissoes WHERE usuario_id=$1', [userId]);
  for (const modulo of modulos) {
    await query('INSERT INTO usuario_permissoes (usuario_id,modulo) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, modulo]);
  }
  req.flash('msg', 'Permissões atualizadas!');
  res.redirect('/usuarios');
});

router.post('/usuarios', requireAuth, requireAdmin, async (req, res) => {
  const { nome, email, senha, perfil, telefone } = req.body;
  const modulosInicial = [].concat(req.body.modulos_inicial || []);
  const hash = bcrypt.hashSync(senha, 10);
  try {
    const r = await query('INSERT INTO usuarios (nome,email,senha,perfil,telefone) VALUES ($1,$2,$3,$4,$5) RETURNING id', [nome, email, hash, perfil, telefone || null]);
    const novoId = r.rows[0].id;
    const PADRAO = {
      secretaria:  ['dashboard', 'frequencia', 'aniversarios'],
      financeiro:  ['dashboard', 'membros', 'cobrancas', 'aniversarios', 'notificacoes'],
      marketing:   ['dashboard', 'marketing', 'aniversarios'],
      ensino:      ['dashboard', 'projetos', 'frequencia', 'aniversarios'],
      extensao:    ['dashboard', 'projetos', 'eventos', 'aniversarios'],
      cientifico:  ['dashboard', 'projetos', 'eventos', 'aniversarios'],
      visualizador:['dashboard']
    };
    const perms = modulosInicial.length > 0 ? modulosInicial : (PADRAO[perfil] || ['dashboard']);
    for (const modulo of perms) {
      await query('INSERT INTO usuario_permissoes (usuario_id,modulo) VALUES ($1,$2) ON CONFLICT DO NOTHING', [novoId, modulo]);
    }
    req.flash('msg', 'Usuário ' + nome + ' criado com sucesso!');
  } catch (e) {
    req.flash('erro', 'E-mail já cadastrado.');
  }
  res.redirect('/usuarios');
});

// ─── EXCLUIR USUÁRIO ─────────────────────────────────────────────────────────
router.post('/usuarios/:id/excluir', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const u = await query('SELECT nome, perfil FROM usuarios WHERE id=$1', [id]);
    if (!u.rows.length) { req.flash('erro', 'Usuário não encontrado.'); return res.redirect('/usuarios'); }
    if (u.rows[0].perfil === 'admin') { req.flash('erro', 'Não é possível excluir o administrador principal.'); return res.redirect('/usuarios'); }
    await query('DELETE FROM usuario_permissoes WHERE usuario_id=$1', [id]);
    await query('DELETE FROM usuarios WHERE id=$1', [id]);
    req.flash('msg', 'Usuário ' + u.rows[0].nome + ' excluído com sucesso.');
  } catch(e) {
    req.flash('erro', 'Erro ao excluir usuário: ' + e.message);
  }
  res.redirect('/usuarios');
});

// Webhook antigo da W-API (/webhook/whatsapp) removido em 2026-07-15 — assinatura
// cancelada, canal substituído pelo webhook oficial em routes/whatsapp-oficial.js.


router.get('/auditoria', requireAuth, requireAdmin, async (req, res) => {
  const config = await getConfig();
  const pagina = parseInt(req.query.pagina) || 1;
  const limite = 50;
  const offset = (pagina - 1) * limite;
  const filtroUsuario = req.query.usuario || '';
  const filtroAcao = req.query.acao || '';
  let where = 'WHERE 1=1';
  const params = [];
  if (filtroUsuario) { params.push('%'+filtroUsuario+'%'); where += ' AND u.nome ILIKE $'+params.length; }
  if (filtroAcao) { params.push(filtroAcao); where += ' AND l.acao = $'+params.length; }
  params.push(limite); params.push(offset);
  const r = await query(`SELECT l.*, u.nome as usuario_nome, u.email as usuario_email, u.perfil FROM log_atividades l LEFT JOIN usuarios u ON l.usuario_id = u.id ${where} ORDER BY l.criado_em DESC LIMIT $${params.length-1} OFFSET $${params.length}`, params);
  const total = await query(`SELECT COUNT(*) FROM log_atividades l LEFT JOIN usuarios u ON l.usuario_id = u.id ${where}`, params.slice(0,-2));
  res.render('pages/auditoria', { config, usuario: req.session.usuario, logs: r.rows, pagina, limite, total: parseInt(total.rows[0].count), filtroUsuario, filtroAcao });
});










};
