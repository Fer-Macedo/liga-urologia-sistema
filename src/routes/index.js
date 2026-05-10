const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const xss = require('xss');
const router = express.Router();

// ─── SEGURANÇA ────────────────────────────────────────────────────────────────
router.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Rate limit geral
const limiterGeral = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: 'Muitas requisições. Tente novamente em 15 minutos.',
  standardHeaders: true,
  legacyHeaders: false
});
router.use(limiterGeral);

// Rate limit para login
const limiterLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Muitas tentativas de login. Aguarde 15 minutos.'
});

// Sanitiza inputs contra XSS
router.use((req, res, next) => {
  if (req.body) {
    for (const key in req.body) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = xss(req.body[key]);
      }
    }
  }
  next();
});
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const dayjs = require('dayjs');
const { query } = require('../models/database');
const { requireAuth, requireAdmin, requireFinanceiro, requireSecretaria, requirePermissao } = require('../middleware/auth');
const { criarCobranca, consultarPagamento } = require('../services/mercadopago');
const { notificarCobranca } = require('../services/notificacoes');

// ─── LOG DE ATIVIDADES ───────────────────────────────────────────────────────
async function logAtividade(usuarioId, acao, detalhes, req) {
  try {
    const ip = req ? (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '') : '';
    const userAgent = req ? (req.headers['user-agent'] || '') : '';
    await query(
      'INSERT INTO log_atividades (usuario_id, acao, detalhes, ip, user_agent) VALUES ($1,$2,$3,$4,$5)',
      [usuarioId, acao, detalhes, ip.substring(0,50), userAgent.substring(0,200)]
    );
  } catch(e) { /* silencioso */ }
}

async function getConfig() {
  const r = await query('SELECT chave, valor FROM configuracoes');
  const cfg = {};
  r.rows.forEach(row => { cfg[row.chave] = row.valor; });
  return cfg;
}

// ─── PROTEÇÃO FORÇA BRUTA ─────────────────────────────────────────────────────
const tentativas = {};

function verificarBloqueio(ip) {
  const t = tentativas[ip];
  if (!t) return false;
  if (t.bloqueadoAte && new Date() < t.bloqueadoAte) return true;
  if (t.bloqueadoAte && new Date() >= t.bloqueadoAte) { delete tentativas[ip]; return false; }
  return false;
}

function registrarTentativa(ip) {
  if (!tentativas[ip]) tentativas[ip] = { count: 0 };
  tentativas[ip].count++;
  if (tentativas[ip].count >= 5) {
    tentativas[ip].bloqueadoAte = new Date(Date.now() + 15 * 60 * 1000);
    console.warn('IP bloqueado por tentativas: ' + ip);
  }
}

function limparTentativas(ip) { delete tentativas[ip]; }

// ─── TOKENS RECUPERAÇÃO SENHA ─────────────────────────────────────────────────
const tokensSenha = {}; // { token: { userId, expira } }

// ─── AUTH ─────────────────────────────────────────────────────────────────────

router.get('/', (req, res) => res.redirect('/dashboard'));

router.get('/login', async (req, res) => {
  if (req.session?.usuario) return res.redirect('/dashboard');
  res.render('pages/login', { config: await getConfig(), erro: req.flash('erro'), msg: req.flash('msg') });
});

router.post('/login', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;

  if (verificarBloqueio(ip)) {
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
    registrarTentativa(ip);
    const t = tentativas[ip];
    const restantes = t ? Math.max(0, 5 - t.count) : 5;
    req.flash('erro', 'E-mail ou senha incorretos. ' + (restantes > 0 ? restantes + ' tentativas restantes.' : 'IP bloqueado por 15 minutos.'));
    return res.redirect('/login');
  }

  limparTentativas(ip);
  console.log('LOGIN: ' + usuario.email + ' | IP: ' + ip + ' | ' + new Date().toISOString());

  const dadosUsuario = { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil };

  req.session.regenerate((err) => {
    if (err) console.error('Session regenerate erro:', err);
    req.session.usuario = dadosUsuario;
    res.redirect('/dashboard');
  });
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
    tokensSenha[token] = { userId: usuario.id, expira: new Date(Date.now() + 30 * 60 * 1000) };

    const { enviarEmail } = require('../services/notificacoes');
    const appUrl = process.env.APP_URL || 'https://liga-urologia.onrender.com';
    const link = appUrl + '/nova-senha?token=' + token;
    const orgNome = config.org_nome || 'Liga Academica de Urologia';

    await enviarEmail({
      para: usuario.email,
      assunto: 'Recuperação de senha — ' + orgNome,
      texto: 'Clique no link para redefinir sua senha:\n' + link + '\n\nExpira em 30 minutos.',
      html: '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:30px"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden"><div style="background:#1a56db;padding:24px 32px"><h1 style="color:white;margin:0;font-size:20px">' + orgNome + '</h1></div><div style="padding:32px"><h2 style="margin:0 0 16px">Recuperação de senha</h2><p style="color:#444;margin:0 0 24px">Olá, <strong>' + usuario.nome + '</strong>!<br><br>Clique no botão abaixo para criar uma nova senha:</p><div style="text-align:center;margin:24px 0"><a href="' + link + '" style="display:inline-block;background:#1a56db;color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold">🔒 Redefinir minha senha</a></div><p style="color:#888;font-size:12px">Este link expira em <strong>30 minutos</strong>.<br>Se não solicitou, ignore este e-mail.</p></div></div></body></html>'
    });

    console.log('RECUPERACAO SENHA: ' + email + ' | ' + new Date().toISOString());
  }

  res.render('pages/recuperar-senha', { config, enviado: true, msg: [], erro: [] });
});

router.get('/nova-senha', async (req, res) => {
  const config = await getConfig();
  const token = req.query.token || '';
  const dados = tokensSenha[token];
  const tokenValido = !!(dados && new Date() < dados.expira);
  res.render('pages/nova-senha', { config, token, tokenValido, erro: req.flash('erro') });
});

router.post('/nova-senha', async (req, res) => {
  const config = await getConfig();
  const { token, nova_senha, confirmar_senha } = req.body;
  const dados = tokensSenha[token];

  if (!dados || new Date() > dados.expira) {
    req.flash('erro', 'Link expirado ou inválido. Solicite um novo.');
    return res.redirect('/recuperar-senha');
  }
  if (nova_senha !== confirmar_senha) {
    return res.render('pages/nova-senha', { config, token, tokenValido: true, erro: ['As senhas não coincidem.'] });
  }
  if (nova_senha.length < 8) {
    return res.render('pages/nova-senha', { config, token, tokenValido: true, erro: ['A senha deve ter pelo menos 8 caracteres.'] });
  }

  await query('UPDATE usuarios SET senha=$1 WHERE id=$2', [bcrypt.hashSync(nova_senha, 10), dados.userId]);
  delete tokensSenha[token];

  console.log('SENHA REDEFINIDA: userId ' + dados.userId + ' | ' + new Date().toISOString());
  req.flash('msg', 'Senha redefinida com sucesso! Faça login com a nova senha.');
  res.redirect('/login');
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

router.get('/dashboard', requireAuth, async (req, res) => {
  const config = await getConfig();
  const hoje = dayjs();
  const mes = hoje.format('YYYY-MM');
  const mesStr = '%-' + mes;
  const [total, pagos, pendentes, atrasados, recTot, pendTot, atrTot, recentes, aniversariantes] = await Promise.all([
    query("SELECT COUNT(*) n FROM membros WHERE ativo=1"),
    query("SELECT COUNT(*) n FROM cobrancas WHERE status='pago' AND referencia LIKE $1", [mesStr]),
    query("SELECT COUNT(*) n FROM cobrancas WHERE status='pendente' AND referencia LIKE $1", [mesStr]),
    query("SELECT COUNT(*) n FROM cobrancas WHERE status='atrasado'"),
    query("SELECT COALESCE(SUM(valor_desconto),0) v FROM cobrancas WHERE status='pago' AND referencia LIKE $1", [mesStr]),
    query("SELECT COALESCE(SUM(valor_cheio),0) v FROM cobrancas WHERE status='pendente' AND referencia LIKE $1", [mesStr]),
    query("SELECT COALESCE(SUM(valor_cheio),0) v FROM cobrancas WHERE status='atrasado'"),
    query("SELECT c.*, m.nome FROM cobrancas c JOIN membros m ON m.id=c.membro_id ORDER BY c.criado_em DESC LIMIT 8"),
    query("SELECT * FROM (SELECT nome, whatsapp, data_nascimento::text, TO_CHAR(data_nascimento::date,'MM-DD') as aniv, 'membro' as tipo FROM membros WHERE ativo=1 AND data_nascimento IS NOT NULL UNION ALL SELECT nome, whatsapp, data_nascimento::text, TO_CHAR(data_nascimento::date,'MM-DD') as aniv, 'diretivo' as tipo FROM diretivos WHERE ativo=1 AND data_nascimento IS NOT NULL) t ORDER BY CASE WHEN aniv >= TO_CHAR(NOW(),'MM-DD') THEN 0 ELSE 1 END, aniv LIMIT 8")
  ]);

  const stats = {
    total: total.rows[0].n, pagos: pagos.rows[0].n, pendentes: pendentes.rows[0].n,
    atrasados: atrasados.rows[0].n, totalRecebido: recTot.rows[0].v,
    totalPendente: pendTot.rows[0].v, totalAtrasado: atrTot.rows[0].v
  };

  res.render('pages/dashboard', {
    config, usuario: req.session.usuario, stats,
    recentes: recentes.rows, aniversariantes: aniversariantes.rows,
    dayjs, msg: req.flash('msg'), erro: req.flash('erro')
  });
});

// ─── MEMBROS ──────────────────────────────────────────────────────────────────

router.get('/membros', requireAuth, requirePermissao('membros'), async (req, res) => {
  const config = await getConfig();
  const filtro = req.query.filtro || 'todos';
  let where = '';
  if (filtro === 'ativos') where = 'WHERE m.ativo=1';
  else if (filtro === 'inativos') where = 'WHERE m.ativo=0';
  const membros = await query(
    'SELECT m.*, (SELECT status FROM cobrancas WHERE membro_id=m.id ORDER BY criado_em DESC LIMIT 1) as ultimo_status FROM membros m ' + where + ' ORDER BY m.nome'
  );
  res.render('pages/membros', { config, usuario: req.session.usuario, membros: membros.rows, filtro, msg: req.flash('msg'), erro: req.flash('erro') });
});

router.post('/membros', requireAuth, requireFinanceiro, async (req, res) => {
  const { nome, cpf, email, whatsapp, data_nascimento, dia_vencimento, mensalidade, desconto_pontualidade, observacoes } = req.body;
  await query(
    'INSERT INTO membros (nome,cpf,email,whatsapp,data_nascimento,dia_vencimento,mensalidade,desconto_pontualidade,observacoes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [nome, cpf||null, email||null, whatsapp||null, data_nascimento||null, parseInt(dia_vencimento)||5, parseFloat(mensalidade)||100, parseFloat(desconto_pontualidade)||10, observacoes||null]
  );
  req.flash('msg', 'Membro ' + nome + ' cadastrado!');
  res.redirect('/membros');
});

router.get('/membros/:id/editar', requireAuth, requireFinanceiro, async (req, res) => {
  const config = await getConfig();
  const r = await query('SELECT * FROM membros WHERE id=$1', [req.params.id]);
  const membro = r.rows[0];
  if (!membro) return res.redirect('/membros');
  res.render('pages/membro-editar', { config, usuario: req.session.usuario, membro, msg: req.flash('msg'), erro: req.flash('erro') });
});

router.post('/membros/:id/editar', requireAuth, requireFinanceiro, async (req, res) => {
  const { nome, cpf, email, whatsapp, data_nascimento, dia_vencimento, mensalidade, desconto_pontualidade, ativo, observacoes } = req.body;
  await query(
    'UPDATE membros SET nome=$1,cpf=$2,email=$3,whatsapp=$4,data_nascimento=$5,dia_vencimento=$6,mensalidade=$7,desconto_pontualidade=$8,ativo=$9,observacoes=$10 WHERE id=$11',
    [nome, cpf||null, email||null, whatsapp||null, data_nascimento||null, parseInt(dia_vencimento)||5, parseFloat(mensalidade)||100, parseFloat(desconto_pontualidade)||10, ativo?1:0, observacoes||null, req.params.id]
  );
  req.flash('msg', 'Membro atualizado!');
  res.redirect('/membros');
});

// ─── COBRANÇAS ─────────────────────────────────────────────────────────────────

router.get('/cobrancas', requireAuth, requirePermissao('cobrancas'), async (req, res) => {
  const config = await getConfig();
  const filtro = req.query.filtro || 'todas';
  let where = '';
  if (filtro === 'pagas') where = "WHERE c.status='pago'";
  else if (filtro === 'pendentes') where = "WHERE c.status='pendente'";
  else if (filtro === 'atrasadas') where = "WHERE c.status='atrasado'";
  const r = await query(
    'SELECT c.*, m.nome, m.whatsapp, m.email FROM cobrancas c JOIN membros m ON m.id=c.membro_id ' + where + ' ORDER BY c.data_vencimento DESC LIMIT 100'
  );
  res.render('pages/cobrancas', { config, usuario: req.session.usuario, cobrancas: r.rows, filtro, dayjs, msg: req.flash('msg'), erro: req.flash('erro') });
});

router.post('/cobrancas/:id/pago', requireAuth, requireFinanceiro, async (req, res) => {
  await query("UPDATE cobrancas SET status='pago', data_pagamento=NOW() WHERE id=$1", [req.params.id]);
  req.flash('msg', 'Pagamento registrado!');
  res.redirect('/cobrancas');
});

router.post('/cobrancas/:id/notificar', requireAuth, requireFinanceiro, async (req, res) => {
  const config = await getConfig();
  const r = await query('SELECT c.*, m.* FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.id=$1', [req.params.id]);
  const cob = r.rows[0];
  if (!cob) return res.redirect('/cobrancas');
  const tipo = dayjs(cob.data_vencimento).isBefore(dayjs()) ? 'pos' : 'dia';
  await notificarCobranca({ membro: cob, cobranca: cob, tipo, config });
  req.flash('msg', 'Notificação enviada!');
  res.redirect('/cobrancas');
});

router.post('/cobrancas/gerar', requireAuth, requireFinanceiro, async (req, res) => {
  const { gerarCobrancasMes } = require('../services/agendamentos');
  await gerarCobrancasMes();
  req.flash('msg', 'Cobranças do mês geradas!');
  res.redirect('/cobrancas');
});

router.post('/cobrancas/nova', requireAuth, requireFinanceiro, async (req, res) => {
  const { membro_id, referencia, valor_cheio, valor_desconto, data_vencimento } = req.body;
  const mr = await query('SELECT * FROM membros WHERE id=$1', [membro_id]);
  const membro = mr.rows[0];
  if (!membro) { req.flash('erro', 'Membro não encontrado'); return res.redirect('/cobrancas'); }
  const pag = await criarCobranca({ membro, valor: parseFloat(valor_desconto), vencimento: data_vencimento, referencia });
  await query(
    'INSERT INTO cobrancas (membro_id,referencia,valor_cheio,valor_desconto,data_vencimento,pagbank_charge_id,pagbank_link) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [membro_id, referencia, parseFloat(valor_cheio), parseFloat(valor_desconto), data_vencimento, pag.charge_id||null, pag.link||null]
  );
  req.flash('msg', 'Cobrança criada!');
  res.redirect('/cobrancas');
});

// ─── ANIVERSÁRIOS ─────────────────────────────────────────────────────────────

router.get('/aniversarios', requireAuth, requirePermissao('aniversarios'), async (req, res) => {
  const config = await getConfig();
  const hoje = dayjs().format('MM-DD');
  const r = await query(
    "SELECT * FROM (SELECT nome, whatsapp, data_nascimento::text, TO_CHAR(data_nascimento::date,'MM-DD') as md, TO_CHAR(data_nascimento::date,'MM-DD') as aniv, 'membro' as tipo FROM membros WHERE ativo=1 AND data_nascimento IS NOT NULL UNION ALL SELECT nome, whatsapp, data_nascimento::text, TO_CHAR(data_nascimento::date,'MM-DD') as md, TO_CHAR(data_nascimento::date,'MM-DD') as aniv, 'diretivo' as tipo FROM diretivos WHERE ativo=1 AND data_nascimento IS NOT NULL) t ORDER BY md"
  );
  res.render('pages/aniversarios', { config, usuario: req.session.usuario, aniversariantes: r.rows, hoje, dayjs, msg: req.flash('msg') });
});

// ─── NOTIFICAÇÕES ──────────────────────────────────────────────────────────────

router.get('/notificacoes', requireAuth, requirePermissao('notificacoes'), async (req, res) => {
  res.render('pages/notificacoes', { config: await getConfig(), usuario: req.session.usuario, msg: req.flash('msg') });
});

router.post('/notificacoes', requireAuth, requireAdmin, async (req, res) => {
  const campos = ['notif_pre_ativo','notif_dia_ativo','notif_pos1_ativo','notif_pos7_ativo','notif_aniversario_ativo',
    'msg_cobranca_pre','msg_cobranca_dia','msg_cobranca_pos','msg_aniversario'];
  for (const c of campos) {
    const val = req.body[c] !== undefined ? (req.body[c] === 'on' ? '1' : req.body[c]) : '0';
    await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', [c, val]);
  }
  req.flash('msg', 'Configurações salvas!');
  res.redirect('/notificacoes');
});

// ─── CONFIGURAÇÕES ─────────────────────────────────────────────────────────────

router.get('/configuracoes', requireAuth, requirePermissao('configuracoes'), async (req, res) => {
  res.render('pages/configuracoes', { config: await getConfig(), usuario: req.session.usuario, msg: req.flash('msg'), erro: req.flash('erro') });
});

router.post('/configuracoes', requireAuth, requireAdmin, async (req, res) => {
  const campos = ['org_nome','org_cor','mensalidade_padrao','desconto_padrao','dia_vencimento_padrao','multa_atraso','presidente_nome','secretario_nome','financeiro_nome'];
  for (const c of campos) {
    if (req.body[c] !== undefined) {
      await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', [c, req.body[c]]);
    }
  }
  const camposNotif = ['notif_pre_ativo','notif_dia_ativo','notif_pos1_ativo','notif_aniversario_ativo',
    'msg_cobranca_pre','msg_cobranca_dia','msg_cobranca_pos','msg_aniversario'];
  for (const c of camposNotif) {
    if (req.body[c] !== undefined) {
      const val = req.body[c] === 'on' ? '1' : req.body[c];
      await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', [c, val]);
    }
  }
  const {upload:upCfg, uploadArquivo:upArqCfg} = require('../services/arquivos');
  upCfg.fields([{name:'assinatura_presidente'},{name:'assinatura_secretario'},{name:'assinatura_financeiro'},{name:'timbrado'}])(req, res, async(err)=>{
    for(const campo of ['assinatura_presidente','assinatura_secretario','assinatura_financeiro','timbrado']){
      if(req.files && req.files[campo] && req.files[campo][0]){
        const ff=req.files[campo][0];
        const r=await upArqCfg(ff.buffer,ff.originalname,ff.mimetype,campo);
        await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2',[campo+'_chave',r.chave]);
      }
    }
    req.flash('msg', 'Configurações salvas!');
    res.redirect('/configuracoes');
  });
});

router.post('/configuracoes/logo-url', requireAuth, requireAdmin, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.json({ ok: false });
  await query("INSERT INTO configuracoes (chave,valor) VALUES ('org_logo',$1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [url]);
  res.json({ ok: true });
});

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

// ─── MEU PERFIL ───────────────────────────────────────────────────────────────

router.post('/minha-senha', requireAuth, async (req, res) => {
  const { senha_atual, nova_senha, confirmar_senha } = req.body;

  if (!nova_senha || nova_senha.length < 8) {
    req.flash('erro', 'A nova senha deve ter pelo menos 8 caracteres.');
    return res.redirect('/dashboard');
  }
  if (nova_senha !== confirmar_senha) {
    req.flash('erro', 'A nova senha e a confirmação não coincidem.');
    return res.redirect('/dashboard');
  }

  const r = await query('SELECT * FROM usuarios WHERE id=$1', [req.session.usuario.id]);
  const usuario = r.rows[0];

  if (!usuario || !bcrypt.compareSync(senha_atual, usuario.senha)) {
    req.flash('erro', 'Senha atual incorreta.');
    return res.redirect('/dashboard');
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
    return res.redirect('/dashboard');
  }

  const r = await query('SELECT * FROM usuarios WHERE id=$1', [req.session.usuario.id]);
  const usuario = r.rows[0];

  if (!usuario || !bcrypt.compareSync(senha_confirmacao, usuario.senha)) {
    req.flash('erro', 'Senha incorreta. Não foi possível alterar o e-mail.');
    return res.redirect('/dashboard');
  }

  const emailExiste = await query('SELECT id FROM usuarios WHERE email=$1 AND id!=$2', [novo_email.toLowerCase().trim(), usuario.id]);
  if (emailExiste.rows.length > 0) {
    req.flash('erro', 'Este e-mail já está em uso.');
    return res.redirect('/dashboard');
  }

  await query('UPDATE usuarios SET email=$1 WHERE id=$2', [novo_email.toLowerCase().trim(), usuario.id]);
  req.session.usuario.email = novo_email.toLowerCase().trim();

  console.log('EMAIL ALTERADO: ' + usuario.email + ' -> ' + novo_email + ' | ' + new Date().toISOString());
  req.flash('msg', 'E-mail alterado com sucesso!');
  res.redirect('/dashboard');
});

// ─── WEBHOOK PAGBANK ──────────────────────────────────────────────────────────

router.post('/webhook/mercadopago', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    let body;
    try { body = JSON.parse(req.body.toString()); } 
    catch (e) { return res.sendStatus(200); }

    console.log('MP Webhook:', JSON.stringify(body).substring(0, 200));

    // Notificacao de pagamento
    if (body.type === 'payment' && body.data?.id) {
      const paymentId = body.data.id;
      const { consultarPagamento } = require('../services/mercadopago');
      const result = await consultarPagamento(paymentId);

      if (result.ok && result.status === 'approved') {
        const ref = result.data.external_reference;
        if (ref) {
          const r = await query(
            "UPDATE cobrancas SET status='pago', data_pagamento=NOW(), mp_payment_id=$1 WHERE referencia=$2 AND status!='pago'",
            [String(paymentId), ref]
          );
          if (r.rowCount > 0) console.log('MP Pagamento confirmado:', ref, paymentId);
        }
      }
    }
  } catch (e) { console.error('MP Webhook erro:', e.message); }
  res.sendStatus(200);
});



// ─── FREQUÊNCIA ───────────────────────────────────────────────────────────────

router.get('/frequencia', requireAuth, requirePermissao('frequencia'), async (req, res) => {
  const config = await getConfig();
  const turmaId = req.query.turma;
  const turmasR = await query('SELECT * FROM turmas WHERE ativo=1 ORDER BY data_inicio DESC');
  const turmas = turmasR.rows;
  let turmaAtual = null, atividades = [], membrosFrequencia = [], todosMembros = [];
  let resumo = { aptos: 0, risco: 0, inaptos: 0 };

  if (turmaId) {
    const tr = await query('SELECT * FROM turmas WHERE id=$1', [turmaId]);
    turmaAtual = tr.rows[0];
    if (turmaAtual) {
      const atR = await query(
        `SELECT a.*,
          (SELECT COUNT(*) FROM presencas p WHERE p.atividade_id=a.id AND p.presente=1) as presentes,
          (SELECT COUNT(*) FROM turma_membros tm WHERE tm.turma_id=a.turma_id) as total_membros
         FROM atividades a WHERE a.turma_id=$1 ORDER BY a.data_atividade DESC`, [turmaId]
      );
      for (const at of atR.rows) {
        const membR = await query(
          `SELECT m.id as membro_id, m.nome,
            COALESCE((SELECT p.presente FROM presencas p WHERE p.atividade_id=$1 AND p.membro_id=m.id),0) as presente
           FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id
           WHERE tm.turma_id=$2 ORDER BY m.nome`, [at.id, turmaId]
        );
        at.membros = membR.rows;
        atividades.push(at);
      }
      const mfR = await query(
        `SELECT m.id as membro_id, m.nome, m.whatsapp, m.email, tm.data_entrada,
          (SELECT COUNT(*) FROM atividades a WHERE a.turma_id=$1) as total_atividades,
          (SELECT COUNT(*) FROM presencas p JOIN atividades a ON a.id=p.atividade_id
           WHERE a.turma_id=$1 AND p.membro_id=m.id AND p.presente=1) as presencas
         FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id
         WHERE tm.turma_id=$1 ORDER BY m.nome`, [turmaId]
      );
      membrosFrequencia = mfR.rows;
      membrosFrequencia.forEach(m => {
        const pct = m.total_atividades > 0 ? (m.presencas / m.total_atividades) * 100 : 0;
        if (pct >= 75) resumo.aptos++;
        else if (pct >= 50) resumo.risco++;
        else resumo.inaptos++;
      });
    }
  }

  const tmR = await query('SELECT * FROM membros WHERE ativo=1 ORDER BY nome');
  todosMembros = tmR.rows;

  res.render('pages/frequencia', {
    config, usuario: req.session.usuario,
    turmas, turmaAtual, atividades, membrosFrequencia, todosMembros, resumo,
    msg: req.flash('msg'), erro: req.flash('erro')
  });
});

router.post('/frequencia/turma', requireAuth, requireSecretaria, async (req, res) => {
  const { nome, data_inicio, data_fim } = req.body;
  await query('INSERT INTO turmas (nome,data_inicio,data_fim) VALUES ($1,$2,$3)', [nome, data_inicio, data_fim||null]);
  req.flash('msg', 'Turma ' + nome + ' criada!');
  res.redirect('/frequencia');
});

router.post('/frequencia/atividade', requireAuth, requireSecretaria, async (req, res) => {
  const turma_id = req.body.turma_id_sel || req.body.turma_id;
  const { tipo, descricao, data_atividade } = req.body;
  const r = await query(
    'INSERT INTO atividades (turma_id,tipo,descricao,data_atividade) VALUES ($1,$2,$3,$4) RETURNING id',
    [turma_id, tipo, descricao, data_atividade]
  );
  const membros = await query('SELECT membro_id FROM turma_membros WHERE turma_id=$1', [turma_id]);
  for (const m of membros.rows) {
    await query('INSERT INTO presencas (atividade_id,membro_id,presente) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [r.rows[0].id, m.membro_id]);
  }
  req.flash('msg', 'Atividade criada!');
  res.redirect('/frequencia?turma=' + turma_id);
});

router.post('/frequencia/atividade/:id/presenca', requireAuth, requireSecretaria, async (req, res) => {
  const atId = req.params.id;
  const presentes = [].concat(req.body.presentes || []);
  const at = await query('SELECT turma_id FROM atividades WHERE id=$1', [atId]);
  if (!at.rows[0]) return res.redirect('/frequencia');
  const turmaId = at.rows[0].turma_id;
  const membros = await query('SELECT membro_id FROM turma_membros WHERE turma_id=$1', [turmaId]);
  for (const m of membros.rows) {
    const presente = presentes.includes(String(m.membro_id)) ? 1 : 0;
    await query(
      'INSERT INTO presencas (atividade_id,membro_id,presente) VALUES ($1,$2,$3) ON CONFLICT (atividade_id,membro_id) DO UPDATE SET presente=$3',
      [atId, m.membro_id, presente]
    );
  }
  req.flash('msg', 'Presenças salvas!');
  res.redirect('/frequencia?turma=' + turmaId);
});

router.post('/frequencia/atividade/:id/deletar', requireAuth, requireSecretaria, async (req, res) => {
  const at = await query('SELECT turma_id FROM atividades WHERE id=$1', [req.params.id]);
  const turmaId = at.rows[0]?.turma_id;
  await query('DELETE FROM presencas WHERE atividade_id=$1', [req.params.id]);
  await query('DELETE FROM atividades WHERE id=$1', [req.params.id]);
  req.flash('msg', 'Atividade excluída!');
  res.redirect('/frequencia?turma=' + turmaId);
});

router.post('/frequencia/turma/:id/adicionar-membro', requireAuth, requireSecretaria, async (req, res) => {
  const { membro_id, data_entrada } = req.body;
  await query('INSERT INTO turma_membros (turma_id,membro_id,data_entrada) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.params.id, membro_id, data_entrada]);
  const ats = await query('SELECT id FROM atividades WHERE turma_id=$1', [req.params.id]);
  for (const at of ats.rows) {
    await query('INSERT INTO presencas (atividade_id,membro_id,presente) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [at.id, membro_id]);
  }
  req.flash('msg', 'Membro adicionado à turma!');
  res.redirect('/frequencia?turma=' + req.params.id);
});

router.post('/frequencia/turma/:id/remover-membro', requireAuth, requireSecretaria, async (req, res) => {
  const { membro_id } = req.body;
  await query('DELETE FROM turma_membros WHERE turma_id=$1 AND membro_id=$2', [req.params.id, membro_id]);
  req.flash('msg', 'Membro removido da turma!');
  res.redirect('/frequencia?turma=' + req.params.id);
});

router.get('/frequencia/relatorio/:turmaId', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const turmaR = await query('SELECT * FROM turmas WHERE id=$1', [req.params.turmaId]);
  const turma = turmaR.rows[0];
  if (!turma) return res.redirect('/frequencia');

  const membros = await query(
    `SELECT m.nome, m.email, tm.data_entrada,
      (SELECT COUNT(*) FROM atividades a WHERE a.turma_id=$1) as total_atividades,
      (SELECT COUNT(*) FROM presencas p JOIN atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1 AND p.membro_id=m.id AND p.presente=1) as presencas
     FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id WHERE tm.turma_id=$1 ORDER BY m.nome`,
    [req.params.turmaId]
  );

  const atividades = await query(
    'SELECT id, tipo, descricao, data_atividade FROM atividades WHERE turma_id=$1 ORDER BY data_atividade',
    [req.params.turmaId]
  );

  // Busca presencas de cada membro por atividade
  const presencasDetalhe = {};
  for (const at of atividades.rows) {
    const pr = await query('SELECT membro_id, presente FROM presencas WHERE atividade_id=$1', [at.id]);
    presencasDetalhe[at.id] = {};
    pr.rows.forEach(p => { presencasDetalhe[at.id][p.membro_id] = p.presente; });
  }

  const orgNome = config.org_nome || 'Liga Academica de Urologia';
  const orgCor = config.org_cor || '#1a56db';
  const orgLogo = config.org_logo || null;

  const logoHtml = orgLogo
    ? '<img src="' + orgLogo + '" alt="' + orgNome + '" style="max-height:80px;max-width:220px;object-fit:contain">'
    : '<h2 style="margin:0;color:' + orgCor + '">' + orgNome + '</h2>';

  let linhasMembros = membros.rows.map(m => {
    const pct = m.total_atividades > 0 ? Math.round((m.presencas / m.total_atividades) * 100) : 0;
    const faltas = m.total_atividades - m.presencas;
    const status = pct >= 75 ? 'APTO' : pct >= 50 ? 'EM RISCO' : 'NÃO APTO';
    const cor = pct >= 75 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
    return '<tr><td style="padding:10px;border:1px solid #e5e7eb">' + m.nome + '</td>'
      + '<td style="padding:10px;border:1px solid #e5e7eb;text-align:center;color:#22c55e;font-weight:600">' + m.presencas + '</td>'
      + '<td style="padding:10px;border:1px solid #e5e7eb;text-align:center;color:#ef4444;font-weight:600">' + faltas + '</td>'
      + '<td style="padding:10px;border:1px solid #e5e7eb;text-align:center">' + m.total_atividades + '</td>'
      + '<td style="padding:10px;border:1px solid #e5e7eb;text-align:center"><strong>' + pct + '%</strong></td>'
      + '<td style="padding:10px;border:1px solid #e5e7eb;text-align:center;color:' + cor + ';font-weight:bold">' + status + '</td></tr>';
  }).join('');

  // Tabela de atividades com presencas por membro coloridas
  let linhasAtividades = '';
  for (const m of membros.rows) {
    let cols = '<td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">' + m.nome + '</td>';
    for (const at of atividades.rows) {
      const presente = presencasDetalhe[at.id] && presencasDetalhe[at.id][m.id] ? 1 : 0;
      const bg = presente ? '#dcfce7' : '#fee2e2';
      const texto = presente ? '✅' : '❌';
      cols += '<td style="padding:8px;border:1px solid #e5e7eb;text-align:center;background:' + bg + '">' + texto + '</td>';
    }
    linhasAtividades += '<tr>' + cols + '</tr>';
  }

  let headerAtividades = '<th style="padding:10px;background:'+orgCor+';color:white;text-align:left;min-width:160px">Membro</th>';
  for (const at of atividades.rows) {
    const data = new Date(at.data_atividade).toLocaleDateString('pt-BR',{timeZone:'UTC'});
    headerAtividades += '<th style="padding:8px;background:'+orgCor+';color:white;text-align:center;font-size:11px;min-width:90px"><strong>' + data + '</strong><br><span style="font-weight:400;font-size:10px">' + at.tipo + '</span><br><span style="font-weight:400;font-size:10px">' + at.descricao.substring(0,15) + '</span></th>';
  }

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Relatório — ${turma.nome}</title>
    <style>body{font-family:Arial,sans-serif;padding:30px;color:#111}table{width:100%;border-collapse:collapse}@media print{.no-print{display:none}}h3{color:#1a56db}</style>
    </head><body>
    <div class="no-print" style="margin-bottom:20px">
      <button onclick="window.print()" style="background:#1a56db;color:white;border:none;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:14px">🖨️ Imprimir / Salvar PDF</button>
    </div>
    <div style="text-align:center;margin-bottom:24px;padding-bottom:16px;border-bottom:3px solid #1a56db">
      ${logoHtml}
      <h1 style="margin:12px 0 4px;font-size:20px">Relatório de Frequência</h1>
      <p style="margin:0;color:#6b7280">Turma: <strong>${turma.nome}</strong> &nbsp;|&nbsp; Período: ${new Date(turma.data_inicio).toLocaleDateString('pt-BR',{timeZone:'UTC'})} ${turma.data_fim ? '— '+new Date(turma.data_fim+'T12:00:00').toLocaleDateString('pt-BR') : ''}</p>
      <p style="margin:4px 0 0;color:#6b7280">Total de atividades: <strong>${atividades.rows.length}</strong> &nbsp;|&nbsp; Critério: <strong>mínimo 75% de presença</strong> &nbsp;|&nbsp; Gerado em: ${new Date().toLocaleString('pt-BR')}</p>
    </div>
    <h3>📋 Resumo por membro</h3>
    <table><thead><tr>
      <th style="padding:10px;background:#1a56db;color:white;text-align:left">Membro</th>
      <th style="padding:10px;background:#1a56db;color:white;text-align:center">✅ Presenças</th>
      <th style="padding:10px;background:#1a56db;color:white;text-align:center">❌ Faltas</th>
      <th style="padding:10px;background:#1a56db;color:white;text-align:center">Total</th>
      <th style="padding:10px;background:#1a56db;color:white;text-align:center">Frequência</th>
      <th style="padding:10px;background:#1a56db;color:white;text-align:center">Status</th>
    </tr></thead><tbody>${linhasMembros}</tbody></table>
    <br><h3>📅 Presenças por atividade</h3>
    <div style="overflow-x:auto">
    <table><thead><tr>${headerAtividades}</tr></thead><tbody>${linhasAtividades}</tbody></table>
    </div>
    </body></html>`;

  res.send(html);
});

router.post('/frequencia/turma/:id/enviar', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const { enviarWhatsApp, enviarEmail } = require('../services/notificacoes');
  const turmaR = await query('SELECT * FROM turmas WHERE id=$1', [req.params.id]);
  const turma = turmaR.rows[0];

  // Filtra por membros selecionados (se nenhum, envia para todos)
  const membrosSelecionados = [].concat(req.body.membros_ids || []);

  let sqlFiltro = '';
  let params = [req.params.id];
  if (membrosSelecionados.length > 0) {
    sqlFiltro = ' AND m.id = ANY($2::int[])';
    params.push(membrosSelecionados.map(Number));
  }

  const membros = await query(
    `SELECT m.*, tm.data_entrada,
      (SELECT COUNT(*) FROM atividades a WHERE a.turma_id=$1) as total_atividades,
      (SELECT COUNT(*) FROM presencas p JOIN atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1 AND p.membro_id=m.id AND p.presente=1) as presencas
     FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id WHERE tm.turma_id=$1` + sqlFiltro, params
  );
  const orgNome = config.org_nome || 'Liga Academica de Urologia';
  const orgLogo = config.org_logo || null;
  let enviados = 0;
  for (const m of membros.rows) {
    const pct = m.total_atividades > 0 ? Math.round((m.presencas / m.total_atividades) * 100) : 0;
    const status = pct >= 75 ? 'APTO ✅' : pct >= 50 ? 'EM RISCO ⚠️' : 'NÃO APTO ❌';
    const msgWpp = `*${orgNome}* 📊\n\nOlá, *${m.nome.split(' ')[0]}*!\n\nSeu relatório de frequência da turma *${turma.nome}*:\n\n📅 Atividades realizadas: *${m.total_atividades}*\n✅ Suas presenças: *${m.presencas}*\n📊 Frequência: *${pct}%*\n🎓 Status: *${status}*\n\n${pct >= 75 ? 'Parabéns! Você está apto para o certificado! 🎉' : pct >= 50 ? 'Atenção! Você está em risco. Não falte às próximas atividades! ⚠️' : 'Atenção! Você está abaixo do mínimo exigido (75%). Participe mais! ❌'}\n\nQualquer dúvida, entre em contato com a secretaria.`;
    if (m.whatsapp) { try { await enviarWhatsApp(m.whatsapp, msgWpp); enviados++; } catch(e) {} }
    if (m.email) {
      const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden"><div style="background:#1a56db;padding:20px 32px"><h1 style="color:white;margin:0;font-size:18px">${orgNome}</h1></div><div style="padding:28px"><h2>📊 Relatório de Frequência — ${turma.nome}</h2><p>Olá, <strong>${m.nome.split(' ')[0]}</strong>!</p><table style="width:100%;border-collapse:collapse;margin:16px 0"><tr style="background:#f4f4f4"><td style="padding:10px;border:1px solid #e5e7eb">Atividades realizadas</td><td style="padding:10px;border:1px solid #e5e7eb;text-align:center"><strong>${m.total_atividades}</strong></td></tr><tr><td style="padding:10px;border:1px solid #e5e7eb">Suas presenças</td><td style="padding:10px;border:1px solid #e5e7eb;text-align:center"><strong>${m.presencas}</strong></td></tr><tr style="background:#f4f4f4"><td style="padding:10px;border:1px solid #e5e7eb">Frequência</td><td style="padding:10px;border:1px solid #e5e7eb;text-align:center"><strong>${pct}%</strong></td></tr><tr><td style="padding:10px;border:1px solid #e5e7eb">Status</td><td style="padding:10px;border:1px solid #e5e7eb;text-align:center;color:${pct>=75?'#22c55e':pct>=50?'#f59e0b':'#ef4444'};font-weight:bold">${status}</td></tr></table><p style="color:#666;font-size:13px">O certificado de 1 ano de liga requer mínimo de 75% de frequência.</p></div></div></body></html>`;
      try { await enviarEmail({ para: m.email, assunto: 'Relatório de Frequência — ' + turma.nome, html, texto: msgWpp }); } catch(e) {}
    }
  }
  res.json({ ok: true, msg: 'Frequência enviada para ' + enviados + ' membros!' });
});

// ─── PERMISSÕES DE USUÁRIO ────────────────────────────────────────────────────

// Sobrescreve rota GET /usuarios para incluir permissoes
router.get('/usuarios', requireAuth, requirePermissao('usuarios'), async (req, res) => {
  const config = await getConfig();
  const r = await query('SELECT id,nome,email,perfil,ativo,criado_em FROM usuarios ORDER BY criado_em');

  // Busca permissoes de todos os usuarios
  const permR = await query('SELECT usuario_id, modulo FROM usuario_permissoes');
  const permissoesUsuarios = {};
  permR.rows.forEach(function(row) {
    if (!permissoesUsuarios[row.usuario_id]) permissoesUsuarios[row.usuario_id] = [];
    permissoesUsuarios[row.usuario_id].push(row.modulo);
  });

  res.render('pages/usuarios', {
    config, usuario: req.session.usuario,
    usuarios: r.rows, permissoesUsuarios,
    msg: req.flash('msg'), erro: req.flash('erro')
  });
});

// Salvar permissoes
router.post('/usuarios/:id/permissoes', requireAuth, requireAdmin, async (req, res) => {
  const userId = req.params.id;
  const modulos = [].concat(req.body.modulos || []);

  // Remove permissoes antigas
  await query('DELETE FROM usuario_permissoes WHERE usuario_id=$1', [userId]);

  // Insere novas permissoes
  for (const modulo of modulos) {
    await query(
      'INSERT INTO usuario_permissoes (usuario_id,modulo) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [userId, modulo]
    );
  }

  req.flash('msg', 'Permissões atualizadas!');
  res.redirect('/usuarios');
});

// Criar usuario com permissoes iniciais
router.post('/usuarios', requireAuth, requireAdmin, async (req, res) => {
  const { nome, email, senha, perfil } = req.body;
  const modulosInicial = [].concat(req.body.modulos_inicial || []);
  const hash = bcrypt.hashSync(senha, 10);

  try {
    const r = await query(
      'INSERT INTO usuarios (nome,email,senha,perfil) VALUES ($1,$2,$3,$4) RETURNING id',
      [nome, email, hash, perfil]
    );
    const novoId = r.rows[0].id;

    // Se nao vieram modulos, usa padrao do perfil
    const PADRAO = {
      secretaria:  ['dashboard', 'frequencia', 'aniversarios'],
      financeiro:  ['dashboard', 'membros', 'cobrancas', 'aniversarios', 'notificacoes'],
      visualizador:['dashboard']
    };
    const perms = modulosInicial.length > 0 ? modulosInicial : (PADRAO[perfil] || ['dashboard']);

    for (const modulo of perms) {
      await query(
        'INSERT INTO usuario_permissoes (usuario_id,modulo) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [novoId, modulo]
      );
    }

    req.flash('msg', 'Usuário ' + nome + ' criado com sucesso!');
  } catch (e) {
    req.flash('erro', 'E-mail já cadastrado.');
  }
  res.redirect('/usuarios');
});


// ─── WEBHOOK WHATSAPP — LAURO ─────────────────────────────────────────────────
router.post('/webhook/whatsapp', async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') return res.sendStatus(200);
    console.log('Webhook WA recebido:', JSON.stringify(body).substring(0, 200));
    if (body.fromMe === true) return res.sendStatus(200);
    if (body.isGroup === true) return res.sendStatus(200);
    const numero = (body.sender && body.sender.id ? body.sender.id : '').replace(/[^0-9]/g, '');
    const texto = body.msgContent && body.msgContent.conversation ? body.msgContent.conversation : (body.msgContent && body.msgContent.extendedTextMessage ? body.msgContent.extendedTextMessage.text : '');
    if (numero.length < 5 || texto.length < 1) return res.sendStatus(200);
    console.log('Lauro processando:', numero, '-', texto);
    const { processarMensagem } = require('../services/lauro');
    processarMensagem(numero, texto);
  } catch(e) { console.error('Webhook WA erro:', e.message); }
  res.sendStatus(200);
});


// ─── DIRETIVOS ────────────────────────────────────────────────────────────────

// Formulário público de cadastro (sem login)
router.get('/cadastro-diretivo', async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];
  res.render('pages/cadastro-diretivo-publico', { config, msg, erro, form: {}, appUrl: process.env.APP_URL || '' });
});

router.post('/cadastro-diretivo', async (req, res) => {
  try {
    const { nome, rg, cpf, email, catraca, cargo, semestre_turma, orcid, data_nascimento,
            whatsapp, instagram, graduacao, ano_ingresso, onde_reside, transporte_proprio,
            tipo_transporte, experiencia_urologia } = req.body;
    const disponibilidade = [].concat(req.body.disponibilidade || []).join(', ');
    if (!nome || !email) { req.session.erro = ['Nome e e-mail são obrigatórios.']; return res.redirect('/cadastro-diretivo'); }
    await query(
      `INSERT INTO diretivos (nome,rg,cpf,email,catraca,cargo,semestre_turma,orcid,data_nascimento,
        whatsapp,instagram,graduacao,ano_ingresso,onde_reside,transporte_proprio,tipo_transporte,
        disponibilidade,experiencia_urologia,cadastrado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())`,
      [nome,rg,cpf,email,catraca,cargo,semestre_turma,orcid,data_nascimento||null,
       whatsapp,instagram,graduacao,ano_ingresso,onde_reside,transporte_proprio,
       tipo_transporte,disponibilidade,experiencia_urologia]
    );
    req.session.msg = ['Cadastro realizado com sucesso! Obrigado, ' + nome.split(' ')[0] + '!'];
    res.redirect('/cadastro-diretivo');
  } catch(e) {
    console.error('Erro cadastro diretivo:', e.message);
    req.session.erro = ['Erro ao cadastrar. Tente novamente.'];
    res.redirect('/cadastro-diretivo');
  }
});

// Painel de diretivos (com login)
router.get('/diretivos', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];
  const r = await query('SELECT * FROM diretivos WHERE ativo=1 ORDER BY cargo, nome');
  res.render('pages/diretivos', {
    config, msg, erro,
    diretivos: r.rows,
    usuario: req.session.usuario,
    appUrl: process.env.APP_URL || 'https://liga-urologia.onrender.com'
  });
});

router.post('/diretivos', requireAuth, requireSecretaria, async (req, res) => {
  const { nome, rg, cpf, email, whatsapp, cargo, semestre_turma, data_nascimento, onde_reside, disponibilidade } = req.body;
  await query(
    'INSERT INTO diretivos (nome,rg,cpf,email,whatsapp,cargo,semestre_turma,data_nascimento,onde_reside,disponibilidade) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [nome,rg,cpf,email,whatsapp,cargo,semestre_turma,data_nascimento||null,onde_reside,disponibilidade]
  );
  req.session.msg = ['Diretivo cadastrado com sucesso!'];
  res.redirect('/diretivos');
});

router.post('/diretivos/:id/editar', requireAuth, requireSecretaria, async (req, res) => {
  const { nome,rg,cpf,email,whatsapp,instagram,catraca,cargo,semestre_turma,data_nascimento,
          onde_reside,disponibilidade,ano_ingresso,orcid,graduacao,experiencia_urologia,
          transporte_proprio,tipo_transporte } = req.body;
  await query(
    `UPDATE diretivos SET nome=$1,rg=$2,cpf=$3,email=$4,whatsapp=$5,instagram=$6,catraca=$7,
     cargo=$8,semestre_turma=$9,data_nascimento=$10,onde_reside=$11,disponibilidade=$12,
     ano_ingresso=$13,orcid=$14,graduacao=$15,experiencia_urologia=$16,
     transporte_proprio=$17,tipo_transporte=$18 WHERE id=$19`,
    [nome,rg,cpf,email,whatsapp,instagram,catraca,cargo,semestre_turma,data_nascimento||null,
     onde_reside,disponibilidade,ano_ingresso,orcid,graduacao,experiencia_urologia,
     transporte_proprio,tipo_transporte,req.params.id]
  );
  req.session.msg = ['Diretivo atualizado com sucesso!'];
  res.redirect('/diretivos');
});

router.post('/diretivos/:id/toggle', requireAuth, requireAdmin, async (req, res) => {
  await query('UPDATE diretivos SET ativo=0 WHERE id=$1', [req.params.id]);
  req.session.msg = ['Diretivo removido.'];
  res.redirect('/diretivos');
});



// ─── FREQUÊNCIA DIRETIVOS ─────────────────────────────────────────────────────

router.get('/frequencia-diretivos', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];

  const turmasR = await query('SELECT * FROM diretivo_turmas WHERE ativo=1 ORDER BY nome');
  const turmas = turmasR.rows;

  let turmaAtual = null;
  let atividades = [];
  let membrosFrequencia = [];
  let resumo = { aptos:0, risco:0, inaptos:0 };
  let todosDiretivos = [];

  const turmaId = req.query.turma;
  if (turmaId) {
    const tR = await query('SELECT * FROM diretivo_turmas WHERE id=$1', [turmaId]);
    turmaAtual = tR.rows[0] || null;
  }
  if (!turmaAtual && turmas.length > 0) turmaAtual = turmas[0];

  const todosR = await query('SELECT id, nome FROM diretivos WHERE ativo=1 ORDER BY nome');
  todosDiretivos = todosR.rows;

  if (turmaAtual) {
    const atR = await query(
      `SELECT a.*, 
        (SELECT COUNT(*) FROM diretivo_presencas p WHERE p.atividade_id=a.id AND p.presente=1) as presentes,
        (SELECT COUNT(*) FROM diretivo_turma_membros tm WHERE tm.turma_id=a.turma_id) as total_membros
       FROM diretivo_atividades a WHERE a.turma_id=$1 ORDER BY a.data_atividade DESC`,
      [turmaAtual.id]
    );
    for (const at of atR.rows) {
      const mR = await query(
        `SELECT d.id as diretivo_id, d.nome, COALESCE(p.presente,0) as presente
         FROM diretivo_turma_membros tm
         JOIN diretivos d ON d.id=tm.diretivo_id
         LEFT JOIN diretivo_presencas p ON p.atividade_id=$1 AND p.diretivo_id=d.id
         WHERE tm.turma_id=$2 ORDER BY d.nome`,
        [at.id, turmaAtual.id]
      );
      at.membros = mR.rows;
      atividades.push(at);
    }

    const mfR = await query(
      `SELECT d.id as membro_id, d.nome, d.cargo, tm.data_entrada,
        (SELECT COUNT(*) FROM diretivo_atividades a WHERE a.turma_id=$1) as total_atividades,
        (SELECT COUNT(*) FROM diretivo_presencas p JOIN diretivo_atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1 AND p.diretivo_id=d.id AND p.presente=1) as presencas
       FROM diretivo_turma_membros tm JOIN diretivos d ON d.id=tm.diretivo_id WHERE tm.turma_id=$1 ORDER BY d.nome`,
      [turmaAtual.id]
    );
    membrosFrequencia = mfR.rows;
    membrosFrequencia.forEach(m => {
      const pct = m.total_atividades > 0 ? Math.round((m.presencas/m.total_atividades)*100) : 0;
      if (pct >= 75) resumo.aptos++; else if (pct >= 50) resumo.risco++; else resumo.inaptos++;
    });
  }

  res.render('pages/frequencia-diretivos', {
    config, msg, erro, usuario: req.session.usuario,
    turmas: turmas.sort((a,b) => a.nome.localeCompare(b.nome)),
    turmaAtual, atividades, membrosFrequencia, resumo, todosDiretivos
  });
});

router.post('/frequencia-diretivos/turma', requireAuth, requireSecretaria, async (req, res) => {
  const { nome, data_inicio, data_fim } = req.body;
  await query('INSERT INTO diretivo_turmas (nome,data_inicio,data_fim) VALUES ($1,$2,$3)',
    [nome, data_inicio, data_fim||null]);
  req.session.msg = ['Turma criada com sucesso!'];
  res.redirect('/frequencia-diretivos');
});

router.post('/frequencia-diretivos/atividade', requireAuth, requireSecretaria, async (req, res) => {
  const turma_id = req.body.turma_id_sel || req.body.turma_id;
  const { tipo, descricao, data_atividade } = req.body;
  const r = await query(
    'INSERT INTO diretivo_atividades (turma_id,tipo,descricao,data_atividade) VALUES ($1,$2,$3,$4) RETURNING id',
    [turma_id, tipo, descricao, data_atividade]
  );
  const membros = await query('SELECT diretivo_id FROM diretivo_turma_membros WHERE turma_id=$1', [turma_id]);
  for (const m of membros.rows) {
    await query('INSERT INTO diretivo_presencas (atividade_id,diretivo_id,presente) VALUES ($1,$2,0) ON CONFLICT DO NOTHING',
      [r.rows[0].id, m.diretivo_id]);
  }
  req.session.msg = ['Atividade criada!'];
  res.redirect('/frequencia-diretivos?turma=' + turma_id);
});

router.post('/frequencia-diretivos/atividade/:id/presenca', requireAuth, requireSecretaria, async (req, res) => {
  const atR = await query('SELECT * FROM diretivo_atividades WHERE id=$1', [req.params.id]);
  const at = atR.rows[0];
  if (!at) return res.redirect('/frequencia-diretivos');
  const membros = await query('SELECT diretivo_id FROM diretivo_turma_membros WHERE turma_id=$1', [at.turma_id]);
  const presentes = [].concat(req.body.presentes || []).map(Number);
  for (const m of membros.rows) {
    await query(
      'INSERT INTO diretivo_presencas (atividade_id,diretivo_id,presente) VALUES ($1,$2,$3) ON CONFLICT (atividade_id,diretivo_id) DO UPDATE SET presente=$3',
      [at.id, m.diretivo_id, presentes.includes(m.diretivo_id) ? 1 : 0]
    );
  }
  req.session.msg = ['Presenças salvas!'];
  res.redirect('/frequencia-diretivos?turma=' + at.turma_id);
});

router.post('/frequencia-diretivos/atividade/:id/deletar', requireAuth, requireSecretaria, async (req, res) => {
  const atR = await query('SELECT turma_id FROM diretivo_atividades WHERE id=$1', [req.params.id]);
  const turma_id = atR.rows[0]?.turma_id;
  await query('DELETE FROM diretivo_presencas WHERE atividade_id=$1', [req.params.id]);
  await query('DELETE FROM diretivo_atividades WHERE id=$1', [req.params.id]);
  req.session.msg = ['Atividade removida!'];
  res.redirect('/frequencia-diretivos?turma=' + turma_id);
});

router.post('/frequencia-diretivos/turma/:id/adicionar-membro', requireAuth, requireSecretaria, async (req, res) => {
  const { diretivo_id, data_entrada } = req.body;
  await query('INSERT INTO diretivo_turma_membros (turma_id,diretivo_id,data_entrada) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [req.params.id, diretivo_id, data_entrada]);
  const ats = await query('SELECT id FROM diretivo_atividades WHERE turma_id=$1', [req.params.id]);
  for (const at of ats.rows) {
    await query('INSERT INTO diretivo_presencas (atividade_id,diretivo_id,presente) VALUES ($1,$2,0) ON CONFLICT DO NOTHING',
      [at.id, diretivo_id]);
  }
  req.session.msg = ['Diretivo adicionado à turma!'];
  res.redirect('/frequencia-diretivos?turma=' + req.params.id);
});

router.post('/frequencia-diretivos/turma/:id/remover-membro', requireAuth, requireSecretaria, async (req, res) => {
  await query('DELETE FROM diretivo_turma_membros WHERE turma_id=$1 AND diretivo_id=$2',
    [req.params.id, req.body.diretivo_id]);
  req.session.msg = ['Diretivo removido da turma!'];
  res.redirect('/frequencia-diretivos?turma=' + req.params.id);
});

router.get('/frequencia-diretivos/relatorio/:turmaId', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const turmaR = await query('SELECT * FROM diretivo_turmas WHERE id=$1', [req.params.turmaId]);
  const turma = turmaR.rows[0];
  if (!turma) return res.redirect('/frequencia-diretivos');

  const membros = await query(
    `SELECT d.id, d.nome, d.cargo,
      (SELECT COUNT(*) FROM diretivo_atividades a WHERE a.turma_id=$1) as total_atividades,
      (SELECT COUNT(*) FROM diretivo_presencas p JOIN diretivo_atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1 AND p.diretivo_id=d.id AND p.presente=1) as presencas
     FROM diretivo_turma_membros tm JOIN diretivos d ON d.id=tm.diretivo_id WHERE tm.turma_id=$1 ORDER BY d.nome`,
    [req.params.turmaId]
  );
  const atividades = await query(
    'SELECT id, tipo, descricao, data_atividade FROM diretivo_atividades WHERE turma_id=$1 ORDER BY data_atividade',
    [req.params.turmaId]
  );
  const pd = {};
  for (const at of atividades.rows) {
    const pr = await query('SELECT diretivo_id, presente FROM diretivo_presencas WHERE atividade_id=$1', [at.id]);
    pd[at.id] = {};
    pr.rows.forEach(p => { pd[at.id][p.diretivo_id] = p.presente; });
  }

  const orgNome = config.org_nome || 'Liga Urologia';
  const orgCor = config.org_cor || '#1a56db';
  const orgLogo = config.org_logo || null;
  const logoHtml = orgLogo ? '<div style="text-align:center;margin-bottom:16px"><img src="' + orgLogo + '" style="max-height:90px;object-fit:contain"></div>' : '';

  let linhasMembros = membros.rows.map(m => {
    const pct = m.total_atividades > 0 ? Math.round((m.presencas/m.total_atividades)*100) : 0;
    const faltas = Number(m.total_atividades) - Number(m.presencas);
    const status = pct>=75?'APTO':pct>=50?'EM RISCO':'NAO APTO';
    const cor = pct>=75?'#22c55e':pct>=50?'#f59e0b':'#ef4444';
    return '<tr><td style="padding:10px;border:1px solid #e5e7eb">' + m.nome + '</td>'
      + '<td style="padding:10px;border:1px solid #e5e7eb;font-size:11px;color:#6b7280">' + (m.cargo||'') + '</td>'
      + '<td style="padding:10px;border:1px solid #e5e7eb;text-align:center;color:#22c55e;font-weight:600">' + m.presencas + '</td>'
      + '<td style="padding:10px;border:1px solid #e5e7eb;text-align:center;color:#ef4444;font-weight:600">' + faltas + '</td>'
      + '<td style="padding:10px;border:1px solid #e5e7eb;text-align:center">' + m.total_atividades + '</td>'
      + '<td style="padding:10px;border:1px solid #e5e7eb;text-align:center"><strong>' + pct + '%</strong></td>'
      + '<td style="padding:10px;border:1px solid #e5e7eb;text-align:center;color:' + cor + ';font-weight:bold">' + status + '</td></tr>';
  }).join('');

  let headerAt = '<th style="padding:10px;background:'+orgCor+';color:white;text-align:left;min-width:150px">Membro</th>'
    + '<th style="padding:10px;background:'+orgCor+';color:white;text-align:left">Cargo</th>';
  for (const at of atividades.rows) {
    const dt = new Date(at.data_atividade).toLocaleDateString('pt-BR',{timeZone:'UTC'});
    headerAt += '<th style="padding:8px;background:'+orgCor+';color:white;text-align:center;font-size:11px;min-width:80px">'+dt+'<br>'+at.tipo+'<br>'+at.descricao.substring(0,12)+'</th>';
  }
  let linhasAt = '';
  for (const m of membros.rows) {
    let cols = '<td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">' + m.nome + '</td>'
      + '<td style="padding:8px;border:1px solid #e5e7eb;font-size:11px;color:#6b7280">' + (m.cargo||'') + '</td>';
    for (const at of atividades.rows) {
      const presente = pd[at.id] && pd[at.id][m.id] ? 1 : 0;
      cols += '<td style="padding:8px;border:1px solid #e5e7eb;text-align:center;background:'+(presente?'#dcfce7':'#fee2e2')+';color:'+(presente?'#166534':'#991b1b')+';font-weight:600">'+(presente?'SIM':'NAO')+'</td>';
    }
    linhasAt += '<tr>' + cols + '</tr>';
  }

  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Relatório Diretivos</title>'
    + '<style>body{font-family:Arial,sans-serif;padding:30px}table{width:100%;border-collapse:collapse}h3{color:'+orgCor+'}@media print{.no-print{display:none}}</style>'
    + '</head><body>'
    + '<div class="no-print" style="margin-bottom:20px"><button onclick="window.print()" style="background:'+orgCor+';color:white;border:none;padding:10px 24px;border-radius:6px;cursor:pointer">Imprimir / Salvar PDF</button></div>'
    + logoHtml
    + '<div style="text-align:center;padding-bottom:16px;border-bottom:3px solid '+orgCor+';margin-bottom:24px">'
    + '<h1 style="margin:0 0 6px;color:'+orgCor+'">Relatório de Frequência — Diretivos</h1>'
    + '<p style="margin:0;color:#6b7280">Turma: <strong>'+turma.nome+'</strong> | Total atividades: <strong>'+atividades.rows.length+'</strong> | Mínimo 75% | '+new Date().toLocaleString('pt-BR')+'</p>'
    + '</div>'
    + '<h3>Resumo por diretivo</h3>'
    + '<table><thead><tr>'
    + '<th style="padding:10px;background:'+orgCor+';color:white;text-align:left">Nome</th>'
    + '<th style="padding:10px;background:'+orgCor+';color:white;text-align:left">Cargo</th>'
    + '<th style="padding:10px;background:'+orgCor+';color:white;text-align:center">Presenças</th>'
    + '<th style="padding:10px;background:'+orgCor+';color:white;text-align:center">Faltas</th>'
    + '<th style="padding:10px;background:'+orgCor+';color:white;text-align:center">Total</th>'
    + '<th style="padding:10px;background:'+orgCor+';color:white;text-align:center">Frequência</th>'
    + '<th style="padding:10px;background:'+orgCor+';color:white;text-align:center">Status</th>'
    + '</tr></thead><tbody>'+linhasMembros+'</tbody></table>'
    + '<br><h3>Presenças por atividade</h3>'
    + '<div style="overflow-x:auto"><table><thead><tr>'+headerAt+'</tr></thead><tbody>'+linhasAt+'</tbody></table></div>'
    + '</body></html>';

  res.send(html);
});




// ─── LOG DE ATIVIDADES — Painel ──────────────────────────────────────────────

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
  const r = await query(`
    SELECT l.*, u.nome as usuario_nome, u.email as usuario_email, u.perfil
    FROM log_atividades l
    LEFT JOIN usuarios u ON l.usuario_id = u.id
    ${where}
    ORDER BY l.criado_em DESC
    LIMIT $${params.length-1} OFFSET $${params.length}
  `, params);

  const total = await query(`SELECT COUNT(*) FROM log_atividades l LEFT JOIN usuarios u ON l.usuario_id = u.id ${where}`, params.slice(0,-2));

  res.render('pages/auditoria', {
    config, usuario: req.session.usuario,
    logs: r.rows,
    pagina, limite,
    total: parseInt(total.rows[0].count),
    filtroUsuario, filtroAcao
  });
});

// ─── ARQUIVOS — Cloudflare R2 com Pastas ─────────────────────────────────────

router.get('/arquivos', requireAuth, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];
  const pastaId = req.query.pasta || null;
  const lixeiraMode = req.query.lixeira === '1';

  const [pastasR, arquivosR, lixeiraR] = await Promise.all([
    query('SELECT * FROM arquivo_pastas WHERE lixeira=0 OR lixeira IS NULL ORDER BY nome'),
    lixeiraMode
      ? query('SELECT * FROM arquivos WHERE lixeira=1 ORDER BY criado_em DESC')
      : pastaId
        ? query('SELECT * FROM arquivos WHERE pasta_id=$1 AND (lixeira=0 OR lixeira IS NULL) ORDER BY nome_original', [pastaId])
        : query('SELECT * FROM arquivos WHERE pasta_id IS NULL AND (lixeira=0 OR lixeira IS NULL) ORDER BY nome_original'),
    query('SELECT COUNT(*) n FROM arquivos WHERE lixeira=1')
  ]);

  const todasPastas = pastasR.rows;
  let pastaAtual = pastaId ? todasPastas.find(p => p.id == pastaId) || null : null;

  // Formata tamanho
  const arquivos = arquivosR.rows.map(a => {
    const kb = (a.tamanho || 0) / 1024;
    a.tamanho_fmt = kb < 1024 ? kb.toFixed(0) + ' KB' : (kb/1024).toFixed(1) + ' MB';
    const ext = (a.nome_original || '').split('.').pop().toLowerCase();
    const icons = { pdf:'📑', doc:'📝', docx:'📝', xls:'📊', xlsx:'📊', ppt:'📣', pptx:'📣', jpg:'🖼️', jpeg:'🖼️', png:'🖼️', gif:'🖼️', mp4:'🎬', mp3:'🎵', zip:'📦', rar:'📦' };
    a.icone = a.tipo === 'google' ? '🔗' : (icons[ext] || '📄');
    return a;
  });

  res.render('pages/arquivos', {
    config, usuario: req.session.usuario, msg, erro,
    todasPastas, pastas: todasPastas, pastaAtual, arquivos,
    lixeiraMode, lixeiraCount: parseInt(lixeiraR.rows[0].n)
  });
});


router.get('/cadastro-ligante', async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];
  res.render('pages/cadastro-ligante-publico', { config, msg, erro, form: {} });
});

router.post('/cadastro-ligante', async (req, res) => {
  const config = await getConfig();
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('foto')(req, res, async (err) => {
      const form = req.body;
      const campos = ['nome','data_nascimento','sexo','email','whatsapp','rg','semestre','turma','porque_lauro','apresentacao'];
      const faltando = campos.filter(c => !form[c] || form[c].trim() === '');
      if (faltando.length > 0) {
        req.session.erro = ['Preencha todos os campos obrigatórios.'];
        return res.render('pages/cadastro-ligante-publico', { config, msg: [], erro: req.session.erro, form });
      }

      let foto_chave = null;
      if (req.file) {
        const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'ligantes');
        foto_chave = r.chave;
      }

      await query(`INSERT INTO ligantes (
        nome, data_nascimento, sexo, email, email_alternativo, whatsapp, rg, cpf,
        semestre, turma, catraca, orcid, tem_formacao, qual_formacao,
        habilidades, aceita_cargo, qual_cargo, contribuicao_grupo,
        ideia_inovadora, tema_interesse, porque_lauro, apresentacao,
        foto_chave, criado_em
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW())`,
      [
        form.nome, form.data_nascimento, form.sexo, form.email, form.email_alternativo||null,
        form.whatsapp, form.rg, form.cpf||null, form.semestre, form.turma,
        form.catraca||null, form.orcid||null, form.tem_formacao||null, form.qual_formacao||null,
        form.habilidades||null, form.aceita_cargo||null, form.qual_cargo||null,
        form.contribuicao_grupo||null, form.ideia_inovadora||null, form.tema_interesse||null,
        form.porque_lauro, form.apresentacao, foto_chave
      ]);

      req.session.msg = ['Cadastro realizado com sucesso! Bem-vindo(a) à LAURO! 🎉'];
      res.redirect('/cadastro-ligante');
    });
  } catch(e) {
    console.error('Erro cadastro ligante:', e.message);
    req.session.erro = ['Erro ao salvar cadastro. Tente novamente.'];
    res.redirect('/cadastro-ligante');
  }
});

// Lista de ligantes (interno)
router.get('/ligantes', requireAuth, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg = [];
  const erro = req.session.erro||[]; req.session.erro = [];
  const r = await query('SELECT * FROM ligantes ORDER BY nome ASC');
  const ligantes = r.rows;
  const total = ligantes.length;
  const ativos = ligantes.filter(l => l.ativo != 0).length;
  const inativos = ligantes.filter(l => l.ativo == 0).length;
  res.render('pages/ligantes', { config, usuario: req.session.usuario, ligantes, msg, erro, total, ativos, inativos });
});

router.post('/ligantes/:id/toggle', requireAuth, async (req, res) => {
  const r = await query('SELECT ativo FROM ligantes WHERE id=$1', [req.params.id]);
  const atual = r.rows[0]?.ativo;
  await query('UPDATE ligantes SET ativo=$1 WHERE id=$2', [atual == 0 ? 1 : 0, req.params.id]);
  await logAtividade(req.session.usuario.id, 'LIGANTE_STATUS', 'Status alterado ID: ' + req.params.id, req);
  req.session.msg = ['Status atualizado com sucesso!'];
  res.redirect('/ligantes');
});



router.get('/ligantes/:id/foto', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT foto_chave FROM ligantes WHERE id=$1', [req.params.id]);
    const ligante = r.rows[0];
    if (!ligante || !ligante.foto_chave) return res.status(404).send('Foto não encontrada');
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const R2 = new S3Client({ region:'auto', endpoint:process.env.R2_ENDPOINT, credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY } });
    const url = await getSignedUrl(R2, new GetObjectCommand({ Bucket: process.env.R2_BUCKET||'liga-urologia-files', Key: ligante.foto_chave }), { expiresIn: 3600 });
    res.redirect(url);
  } catch(e) { res.status(500).send('Erro'); }
});



// ─── DESLIGAMENTOS ────────────────────────────────────────────────────────────

router.get('/desligamentos', requireAuth, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];

  const [deslig, membros, ligR] = await Promise.all([
    query(`SELECT d.*, COALESCE(m.nome,l.nome) as membro_nome, COALESCE(m.email,l.email) as membro_email FROM desligamentos d LEFT JOIN membros m ON m.id=d.membro_id LEFT JOIN ligantes l ON l.id=d.ligante_id ORDER BY d.criado_em DESC`),
    query(`SELECT id, nome, cargo FROM membros WHERE ativo=1 ORDER BY nome`),
    query(`SELECT id, nome, email, turma, semestre, rg, catraca FROM ligantes ORDER BY nome`)
  ]);

  res.render('pages/desligamentos', { config, usuario: req.session.usuario, msg, erro,
    desligamentos: deslig.rows, membros: membros.rows, ligantes: ligR.rows });
});

router.post('/desligamentos/configurar', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.fields([
      { name: 'timbrado', maxCount: 1 },
      { name: 'assinatura_presidente', maxCount: 1 },
      { name: 'assinatura_secretario', maxCount: 1 }
    ])(req, res, async (err) => {
      const campos = ['presidente_nome', 'secretario_nome'];
      for (const campo of campos) {
        if (req.body[campo]) {
          await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', [campo, req.body[campo]]);
        }
      }
      const arquivos_cfg = [
        { field: 'timbrado', chave_cfg: 'timbrado_chave', pasta: 'timbrado' },
        { field: 'assinatura_presidente', chave_cfg: 'assinatura_presidente_chave', pasta: 'assinaturas' },
        { field: 'assinatura_secretario', chave_cfg: 'assinatura_secretario_chave', pasta: 'assinaturas' }
      ];
      for (const a of arquivos_cfg) {
        if (req.files && req.files[a.field] && req.files[a.field][0]) {
          const file = req.files[a.field][0];
          const r = await uploadArquivo(file.buffer, file.originalname, file.mimetype, a.pasta);
          await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', [a.chave_cfg, r.chave]);
        }
      }
      req.session.msg = ['Configurações salvas com sucesso!'];
      res.redirect('/desligamentos');
    });
  } catch(e) {
    req.session.erro = ['Erro ao salvar configurações: ' + e.message];
    res.redirect('/desligamentos');
  }
});

router.post('/desligamentos', requireAuth, async (req, res) => {
  try {
    const { membro_id, ligante_id, data_solicitacao, motivo, tipo_membro } = req.body;
    const mid = membro_id && membro_id !== '' && membro_id !== 'null' ? parseInt(membro_id) : null;
    const lid = ligante_id && ligante_id !== '' && ligante_id !== 'null' ? parseInt(ligante_id) : null;
    await query(
      'INSERT INTO desligamentos (membro_id, ligante_id, data_solicitacao, motivo, tipo_membro, criado_por) VALUES ($1,$2,$3,$4,$5,$6)',
      [mid, lid, data_solicitacao || new Date(), motivo || null, tipo_membro || 'LIGANTE', req.session.usuario.id]
    );
    await logAtividade(req.session.usuario.id, 'DESLIGAMENTO_CRIADO', 'Desligamento criado', req);
    req.session.msg = ['Documento de desligamento criado! Clique em 📧 para enviar por email.'];
    res.redirect('/desligamentos');
  } catch(e) {
    req.session.erro = ['Erro ao criar desligamento: ' + e.message];
    res.redirect('/desligamentos');
  }
});

router.get('/desligamentos/:id/visualizar', requireAuth, async (req, res) => {
  try {
    const rd = await query('SELECT * FROM desligamentos WHERE id=$1', [req.params.id]);
    if (!rd.rows[0]) return res.status(404).send('Não encontrado');
    const desl = rd.rows[0];
    let pessoa = {};
    if (desl.membro_id) {
      const rm = await query('SELECT * FROM membros WHERE id=$1', [desl.membro_id]);
      pessoa = rm.rows[0] || {};
    } else if (desl.ligante_id) {
      const rl = await query('SELECT * FROM ligantes WHERE id=$1', [desl.ligante_id]);
      pessoa = rl.rows[0] || {};
    }
    const d = { ...desl, ...pessoa };

    const config = await getConfig();
    const { gerarHTMLDesligamento, imagemBase64 } = require('../services/desligamento');

    // Carrega imagens em base64 para funcionar no HTML sem problemas de CORS/expiração
    config.timbrado_b64 = await imagemBase64(config.timbrado_chave);
    config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
    config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);

    const html = gerarHTMLDesligamento(d, config, d.data_solicitacao, d.tipo_membro);
    res.send(html);
  } catch(e) {
    res.status(500).send('Erro: ' + e.message);
  }
});

router.post('/desligamentos/:id/enviar', requireAuth, async (req, res) => {
  try {
    const rd = await query('SELECT * FROM desligamentos WHERE id=$1', [req.params.id]);
    if (!rd.rows[0]) { req.session.erro = ['Nao encontrado.']; return res.redirect('/desligamentos'); }
    const desl = rd.rows[0];
    let pessoa = {};
    if (desl.membro_id) { const rm = await query('SELECT * FROM membros WHERE id=$1', [desl.membro_id]); pessoa = rm.rows[0] || {}; }
    else if (desl.ligante_id) { const rl = await query('SELECT * FROM ligantes WHERE id=$1', [desl.ligante_id]); pessoa = rl.rows[0] || {}; }
    const d = { ...desl, ...pessoa };
    if (!d.email) { req.session.erro = ['Email nao cadastrado.']; return res.redirect('/desligamentos'); }
    const config = await getConfig();
    const { gerarHTMLDesligamento, imagemBase64 } = require('../services/desligamento');
    config.timbrado_b64 = await imagemBase64(config.timbrado_chave);
    config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
    config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
    const html = gerarHTMLDesligamento(d, config, d.data_solicitacao, d.tipo_membro);
    // Gera PDF com puppeteer
    const htmlPdf = require('html-pdf-node');
    const pdfBuffer = await htmlPdf.generatePdf({ content: html }, { format: 'A4', printBackground: true });
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST, port: process.env.EMAIL_PORT,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: d.email,
      subject: 'Carta de Rescisión — Liga Académica de Urología LAURO',
      html: `<p>Estimado/a <strong>${d.nome}</strong>,</p>
<p>Adjunto encontrará su Carta de Rescisión de la Liga Académica de Urología - LAURO.</p>
<p><strong>Instrucciones:</strong></p>
<ol>
<li>Imprima el documento adjunto</li>
<li>Firme en el espacio indicado</li>
<li>Escanee o fotografíe el documento firmado</li>
<li><strong>Responda este mismo email</strong> con el documento firmado adjunto</li>
</ol>
<p>Atentamente,<br>Secretaría — LAURO<br>Liga Académica de Urología</p>`,
      attachments: [{ filename: 'carta-rescision-LAURO.pdf', content: pdfBuffer, contentType: 'application/pdf' }]
    });
    await query('UPDATE desligamentos SET status=$1, enviado_em=NOW() WHERE id=$2', ['enviado', req.params.id]);
    await logAtividade(req.session.usuario.id, 'DESLIGAMENTO_ENVIADO', 'Email enviado para: ' + d.email, req);
    req.session.msg = ['Email enviado com sucesso para ' + d.email + '!'];
    res.redirect('/desligamentos');
  } catch(e) {
    req.session.erro = ['Erro ao enviar email: ' + e.message];
    res.redirect('/desligamentos');
  }
});

router.post('/desligamentos/:id/assinado', requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('pdf_assinado')(req, res, async (err) => {
      if (!req.file) { req.session.erro = ['Nenhum arquivo enviado.']; return res.redirect('/desligamentos'); }
      const r = await uploadArquivo(req.file.buffer, 'desligamento-assinado-' + req.params.id + '.pdf', req.file.mimetype, 'desligamentos');
      await query('UPDATE desligamentos SET pdf_assinado_chave=$1, status=$2, assinado_em=NOW() WHERE id=$3',
        [r.chave, 'assinado', req.params.id]);

      // Marca membro como desligado
      const d = await query('SELECT membro_id FROM desligamentos WHERE id=$1', [req.params.id]);
      if (d.rows[0]) {
        await query('UPDATE membros SET ativo=0, status=$1 WHERE id=$2', ['desligado', d.rows[0].membro_id]);
      }

      await logAtividade(req.session.usuario.id, 'DESLIGAMENTO_ASSINADO', 'Documento assinado anexado', req);
      req.session.msg = ['Documento assinado anexado e membro marcado como desligado!'];
      res.redirect('/desligamentos');
    });
  } catch(e) {
    req.session.erro = ['Erro: ' + e.message];
    res.redirect('/desligamentos');
  }
});

router.get('/desligamentos/:id/assinado', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT pdf_assinado_chave FROM desligamentos WHERE id=$1', [req.params.id]);
    const d = r.rows[0];
    if (!d || !d.pdf_assinado_chave) return res.status(404).send('Não encontrado');
    const { getUrlAssinada } = require('../services/desligamento');
    const url = await getUrlAssinada(d.pdf_assinado_chave);
    res.redirect(url);
  } catch(e) { res.status(500).send('Erro'); }
});



router.get('/ligantes/:id/editar', requireAuth, async (req, res) => {
  const config = await getConfig();
  const r = await query('SELECT * FROM ligantes WHERE id=$1', [req.params.id]);
  const ligante = r.rows[0];
  if (!ligante) { req.session.erro = ['Ligante não encontrado.']; return res.redirect('/ligantes'); }
  res.render('pages/ligante-editar', { config, usuario: req.session.usuario, ligante,
    msg: req.session.msg||[], erro: req.session.erro||[] });
  req.session.msg = []; req.session.erro = [];
});

router.post('/ligantes/:id/editar', requireAuth, async (req, res) => {
  const b = req.body;
  await query(`UPDATE ligantes SET nome=$1, data_nascimento=$2, sexo=$3, email=$4,
    email_alternativo=$5, whatsapp=$6, rg=$7, cpf=$8, semestre=$9, turma=$10,
    catraca=$11, orcid=$12, tem_formacao=$13, qual_formacao=$14, habilidades=$15,
    aceita_cargo=$16, qual_cargo=$17, contribuicao_grupo=$18, ideia_inovadora=$19,
    tema_interesse=$20, porque_lauro=$21, apresentacao=$22 WHERE id=$23`,
    [b.nome, b.data_nascimento||null, b.sexo, b.email, b.email_alternativo||null,
     b.whatsapp, b.rg, b.cpf||null, b.semestre, b.turma, b.catraca||null,
     b.orcid||null, b.tem_formacao||null, b.qual_formacao||null, b.habilidades||null,
     b.aceita_cargo||null, b.qual_cargo||null, b.contribuicao_grupo||null,
     b.ideia_inovadora||null, b.tema_interesse||null, b.porque_lauro, b.apresentacao,
     req.params.id]);
  await logAtividade(req.session.usuario.id, 'LIGANTE_EDITADO', 'Ligante editado: ' + b.nome, req);
  req.session.msg = ['Ligante atualizado com sucesso!'];
  res.redirect('/ligantes');
});

router.post('/ligantes/:id/deletar', requireAuth, requireAdmin, async (req, res) => {
  const r = await query('SELECT nome FROM ligantes WHERE id=$1', [req.params.id]);
  await query('DELETE FROM ligantes WHERE id=$1', [req.params.id]);
  await logAtividade(req.session.usuario.id, 'LIGANTE_DELETADO', 'Ligante excluído: ' + (r.rows[0]?.nome||''), req);
  req.session.msg = ['Ligante excluído com sucesso!'];
  res.redirect('/ligantes');
});



router.post('/desligamentos/:id/substituir', requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('pdf_assinado')(req, res, async (err) => {
      if (!req.file) { req.session.erro = ['Nenhum arquivo enviado.']; return res.redirect('/desligamentos'); }
      const r = await uploadArquivo(req.file.buffer, 'desligamento-assinado-' + req.params.id + '.pdf', req.file.mimetype, 'desligamentos');
      await query('UPDATE desligamentos SET pdf_assinado_chave=$1, status=$2, assinado_em=NOW() WHERE id=$3',
        [r.chave, 'assinado', req.params.id]);
      await logAtividade(req.session.usuario.id, 'DESLIGAMENTO_SUBSTITUIDO', 'Documento substituido ID: ' + req.params.id, req);
      req.session.msg = ['Documento substituído com sucesso!'];
      res.redirect('/desligamentos');
    });
  } catch(e) {
    req.session.erro = ['Erro: ' + e.message];
    res.redirect('/desligamentos');
  }
});

router.post('/desligamentos/:id/deletar', requireAuth, requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM desligamentos WHERE id=$1', [req.params.id]);
    await logAtividade(req.session.usuario.id, 'DESLIGAMENTO_DELETADO', 'Desligamento apagado ID: ' + req.params.id, req);
    req.session.msg = ['Desligamento apagado com sucesso!'];
    res.redirect('/desligamentos');
  } catch(e) {
    req.session.erro = ['Erro: ' + e.message];
    res.redirect('/desligamentos');
  }
});



// ─── RELATÓRIO LIGANTES ───────────────────────────────────────────────────────
router.get('/ligantes/relatorio', requireAuth, async (req, res) => {
  const config = await getConfig();
  const q = req.query;

  const filtros = {
    status:       q.status       || 'todos',
    sexo:         q.sexo         || 'todos',
    semestre:     q.semestre     || 'todos',
    turma:        q.turma        || 'todos',
    aceita_cargo: q.aceita_cargo || 'todos',
    tem_formacao: q.tem_formacao || 'todos',
    ordem:        q.ordem        || 'nome',
    colunas:      q.colunas ? (Array.isArray(q.colunas) ? q.colunas : [q.colunas]) : ['nome','email','whatsapp','semestre','turma','rg','catraca','status']
  };

  let where = [];
  if (filtros.status === 'ativo')    where.push("ativo = 1");
  if (filtros.status === 'inativo')  where.push("ativo = 0");
  if (filtros.sexo !== 'todos')      where.push(`sexo = '${filtros.sexo.replace(/'/g,"''")}'`);
  if (filtros.semestre !== 'todos')  where.push(`semestre = '${filtros.semestre.replace(/'/g,"''")}'`);
  if (filtros.turma !== 'todos')     where.push(`turma = '${filtros.turma.replace(/'/g,"''")}'`);
  if (filtros.aceita_cargo !== 'todos') where.push(`aceita_cargo = '${filtros.aceita_cargo.replace(/'/g,"''")}'`);
  if (filtros.tem_formacao !== 'todos') where.push(`tem_formacao = '${filtros.tem_formacao.replace(/'/g,"''")}'`);

  const ordens = {
    nome: 'nome ASC', nome_desc: 'nome DESC',
    idade: 'data_nascimento DESC', idade_desc: 'data_nascimento ASC',
    semestre: 'semestre ASC', turma: 'turma ASC', criado_em: 'criado_em DESC'
  };
  const orderBy = ordens[filtros.ordem] || 'nome ASC';
  const sql = `SELECT * FROM ligantes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy}`;

  const [r, todos] = await Promise.all([query(sql), query('SELECT DISTINCT semestre FROM ligantes WHERE semestre IS NOT NULL ORDER BY semestre'), ]);
  const turmasR = await query('SELECT DISTINCT turma FROM ligantes WHERE turma IS NOT NULL ORDER BY turma');
  const semestresR = await query('SELECT DISTINCT semestre FROM ligantes WHERE semestre IS NOT NULL ORDER BY semestre');

  const labelColuna = (col) => ({
    nome:'Nome', email:'E-mail', whatsapp:'WhatsApp', sexo:'Sexo',
    data_nascimento:'Nascimento', semestre:'Semestre', turma:'Turma',
    catraca:'Catraca', rg:'RG/CI', cpf:'CPF', orcid:'ORCID',
    tem_formacao:'Formação', aceita_cargo:'Aceita cargo',
    habilidades:'Habilidades', status:'Status', criado_em:'Cadastro'
  }[col] || col);

  res.render('pages/ligantes-relatorio', {
    config, usuario: req.session.usuario,
    ligantes: r.rows,
    filtros,
    semestres: semestresR.rows.map(x => x.semestre).filter(Boolean),
    turmas: turmasR.rows.map(x => x.turma).filter(Boolean),
    colunasVisiveis: filtros.colunas,
    labelColuna,
    msg: req.session.msg||[], erro: req.session.erro||[]
  });
  req.session.msg = []; req.session.erro = [];
});



// ─── ARQUIVOS FINANCEIROS ─────────────────────────────────────────────────────

router.get('/financeiro-arquivos', requireAuth, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const pastaAtual = req.query.pasta || null;

  const [pastasR, arquivosR] = await Promise.all([
    query('SELECT * FROM financeiro_pastas ORDER BY nome'),
    query('SELECT * FROM financeiro_arquivos WHERE pasta_id' + (pastaAtual ? '=$1 ORDER BY criado_em DESC' : ' IS NULL ORDER BY criado_em DESC'), pastaAtual ? [pastaAtual] : [])
  ]);

  res.render('pages/financeiro-arquivos', {
    config, usuario: req.session.usuario, msg, erro,
    pastas: pastasR.rows, arquivos: arquivosR.rows, pastaAtual
  });
});

router.post('/financeiro-arquivos/pasta', requireAuth, async (req, res) => {
  const { nome, pai_id } = req.body;
  const pasta_id = pai_id && pai_id !== '' ? pai_id : null;
  await query('INSERT INTO financeiro_pastas (nome, pai_id, criado_por) VALUES ($1,$2,$3)',
    [nome, pasta_id, req.session.usuario.id]);
  req.session.msg = ['Pasta criada com sucesso!'];
  const url = pasta_id ? '/financeiro-arquivos?pasta=' + pasta_id : '/financeiro-arquivos';
  res.redirect(url);
});

router.post('/financeiro-arquivos/upload', requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.array('arquivos', 20)(req, res, async (err) => {
      if (!req.files || req.files.length===0) { req.session.erro=['Nenhum arquivo.']; return res.redirect('/financeiro-arquivos'); }
      const pasta_id = req.body.pasta_id && req.body.pasta_id !== '' ? req.body.pasta_id : null;
      for (const file of req.files) {
        const nome = req.body.nome || file.originalname;
        const r = await uploadArquivo(file.buffer, file.originalname, file.mimetype, 'financeiro');
        await query('INSERT INTO financeiro_arquivos (nome,tipo,chave_r2,mimetype,tamanho,pasta_id,enviado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [nome, 'upload', r.chave, file.mimetype, file.size, pasta_id, req.session.usuario.id]);
      }
      req.session.msg = ['Arquivo enviado com sucesso!'];
      res.redirect('/financeiro-arquivos' + (pasta_id ? '?pasta='+pasta_id : ''));
    });
  } catch(e) {
    req.session.erro = ['Erro: ' + e.message];
    res.redirect('/financeiro-arquivos');
  }
});

router.post('/financeiro-arquivos/google', requireAuth, async (req, res) => {
  const { nome, google_url, google_tipo, pasta_id } = req.body;
  const pid = pasta_id && pasta_id !== '' ? pasta_id : null;

  // Gera URL de embed
  let embed = google_url;
  if (google_url.includes('docs.google.com')) {
    embed = google_url.replace(/\/edit.*$/, '/edit?embedded=true&rm=minimal');
  } else if (google_url.includes('drive.google.com/file')) {
    const m = google_url.match(/\/d\/([^/]+)/);
    if (m) embed = 'https://drive.google.com/file/d/' + m[1] + '/preview';
  }

  await query('INSERT INTO financeiro_arquivos (nome,tipo,google_url,google_embed,pasta_id,enviado_por) VALUES ($1,$2,$3,$4,$5,$6)',
    [nome, 'google', google_url, embed, pid, req.session.usuario.id]);
  req.session.msg = ['Link do Google adicionado!'];
  res.redirect('/financeiro-arquivos' + (pid ? '?pasta='+pid : ''));
});

router.get('/financeiro-arquivos/:id/visualizar', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM financeiro_arquivos WHERE id=$1', [req.params.id]);
    const a = r.rows[0];
    if (!a || !a.chave_r2) return res.status(404).send('Não encontrado');
    const { getUrlAssinada } = require('../services/desligamento');
    const url = await getUrlAssinada(a.chave_r2);
    if (a.mimetype && (a.mimetype.includes('image') || a.mimetype.includes('pdf'))) {
      res.redirect(url);
    } else {
      res.redirect(url);
    }
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.get('/financeiro-arquivos/:id/download', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM financeiro_arquivos WHERE id=$1', [req.params.id]);
    const a = r.rows[0];
    if (!a || !a.chave_r2) return res.status(404).send('Não encontrado');
    const { getUrlAssinada } = require('../services/desligamento');
    const url = await getUrlAssinada(a.chave_r2);
    res.redirect(url);
  } catch(e) { res.status(500).send('Erro'); }
});

router.post('/financeiro-arquivos/:id/deletar', requireAuth, async (req, res) => {
  const r = await query('SELECT pasta_id FROM financeiro_arquivos WHERE id=$1', [req.params.id]);
  const pid = r.rows[0]?.pasta_id;
  await query('DELETE FROM financeiro_arquivos WHERE id=$1', [req.params.id]);
  req.session.msg = ['Arquivo excluído!'];
  res.redirect('/financeiro-arquivos' + (pid ? '?pasta='+pid : ''));
});

router.post('/financeiro-pastas/:id/deletar', requireAuth, async (req, res) => {
  await query('DELETE FROM financeiro_arquivos WHERE pasta_id=$1', [req.params.id]);
  await query('DELETE FROM financeiro_pastas WHERE id=$1', [req.params.id]);
  req.session.msg = ['Pasta excluída!'];
  res.redirect('/financeiro-arquivos');
});



router.post('/financeiro-arquivos/deletar-multiplos', requireAuth, async (req, res) => {
  try {
    const ids = req.body.ids ? (Array.isArray(req.body.ids) ? req.body.ids : [req.body.ids]) : [];
    const pasta_id = req.body.pasta_id || null;
    for (const id of ids) {
      await query('DELETE FROM financeiro_arquivos WHERE id=$1', [id]);
    }
    req.session.msg = [ids.length + ' arquivo(s) excluído(s)!'];
    res.redirect('/financeiro-arquivos' + (pasta_id ? '?pasta=' + pasta_id : ''));
  } catch(e) {
    req.session.erro = ['Erro: ' + e.message];
    res.redirect('/financeiro-arquivos');
  }
});



// Mover arquivo para pasta
router.post('/financeiro-arquivos/:id/mover', requireAuth, async (req, res) => {
  try {
    const pasta_id = req.body.pasta_id || null;
    await query('UPDATE financeiro_arquivos SET pasta_id=$1 WHERE id=$2', [pasta_id, req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// Mover pasta para outra pasta
router.post('/financeiro-pastas/:id/mover', requireAuth, async (req, res) => {
  try {
    const pai_id = req.body.pai_id || null;
    if (String(pai_id) === String(req.params.id)) return res.status(400).json({ erro: 'Não pode mover para si mesmo' });
    await query('UPDATE financeiro_pastas SET pai_id=$1 WHERE id=$2', [pai_id, req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});



// Arquivos — novas rotas
router.post('/arquivos/google', requireAuth, async (req, res) => {
  const { nome, google_url, pasta_id } = req.body;
  const pid = pasta_id && pasta_id !== '' ? pasta_id : null;
  let embed = google_url;
  if (google_url && google_url.includes('docs.google.com')) {
    embed = google_url.replace(/\/edit.*$/, '/edit?embedded=true&rm=minimal');
  } else if (google_url && google_url.includes('drive.google.com/file')) {
    const m = google_url.match(/\/d\/([^/]+)/);
    if (m) embed = 'https://drive.google.com/file/d/' + m[1] + '/preview';
  }
  await query('INSERT INTO arquivos (nome_original, tipo, google_url, google_embed, pasta_id, enviado_por) VALUES ($1,$2,$3,$4,$5,$6)',
    [nome, 'google', google_url, embed, pid, req.session.usuario.id]);
  req.session.msg = ['Link Google adicionado!'];
  res.redirect('/arquivos' + (pid ? '?pasta=' + pid : ''));
});

router.post('/arquivos/:id/renomear', requireAuth, async (req, res) => {
  await query('UPDATE arquivos SET nome_original=$1 WHERE id=$2', [req.body.nome, req.params.id]);
  res.json({ ok: true });
});

router.post('/arquivos/:id/mover', requireAuth, async (req, res) => {
  const pid = req.body.pasta_id || null;
  await query('UPDATE arquivos SET pasta_id=$1 WHERE id=$2', [pid, req.params.id]);
  res.json({ ok: true });
});

router.post('/arquivos/pasta/:id/mover', requireAuth, async (req, res) => {
  const pid = req.body.pasta_pai_id || null;
  await query('UPDATE arquivo_pastas SET pasta_pai_id=$1 WHERE id=$2', [pid, req.params.id]);
  res.json({ ok: true });
});

router.post('/arquivos/:id/lixeira', requireAuth, async (req, res) => {
  await query('UPDATE arquivos SET lixeira=1 WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

router.post('/arquivos/:id/restaurar', requireAuth, async (req, res) => {
  await query('UPDATE arquivos SET lixeira=0 WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

router.post('/arquivos/lixeira/esvaziar', requireAuth, requireAdmin, async (req, res) => {
  await query('DELETE FROM arquivos WHERE lixeira=1');
  res.json({ ok: true });
});

router.post('/arquivos/pasta/:id/lixeira', requireAuth, async (req, res) => {
  await query('UPDATE arquivo_pastas SET lixeira=1 WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

router.post('/arquivos/pasta/:id/editar', requireAuth, async (req, res) => {
  const { nome, icone, cor } = req.body;
  await query('UPDATE arquivo_pastas SET nome=$1, icone=$2, cor=$3 WHERE id=$4',
    [nome, icone || '📁', cor || null, req.params.id]);
  req.session.msg = ['Pasta atualizada!'];
  const pasta = await query('SELECT pasta_pai_id FROM arquivo_pastas WHERE id=$1', [req.params.id]);
  const pid = pasta.rows[0]?.pasta_pai_id;
  res.redirect('/arquivos' + (pid ? '?pasta=' + pid : '?pasta=' + req.params.id));
});



router.get("/arquivos/:id/visualizar", requireAuth, async (req, res) => {
  try {
    const r = await query("SELECT * FROM arquivos WHERE id=$1", [req.params.id]);
    const a = r.rows[0];
    if (!a) return res.status(404).send("Nao encontrado");
    if (a.tipo === "google" && a.google_embed) return res.redirect(a.google_embed);
    const { getUrlAssinada } = require("../services/desligamento");
    const url = await getUrlAssinada(a.chave_r2);
    res.redirect(url);
  } catch(e) { res.status(500).send("Erro: " + e.message); }
});

router.get("/arquivos/:id/download", requireAuth, async (req, res) => {
  try {
    const r = await query("SELECT * FROM arquivos WHERE id=$1", [req.params.id]);
    const a = r.rows[0];
    if (!a || !a.chave_r2) return res.status(404).send("Nao encontrado");
    const { getUrlAssinada } = require("../services/desligamento");
    const url = await getUrlAssinada(a.chave_r2);
    res.redirect(url);
  } catch(e) { res.status(500).send("Erro"); }
});

router.post("/arquivos/:id/deletar", requireAuth, async (req, res) => {
  await query("DELETE FROM arquivos WHERE id=$1", [req.params.id]);
  req.session.msg = ["Arquivo excluido!"];
  res.redirect("/arquivos");
});

router.post("/arquivos/:id/substituir", requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require("../services/arquivos");
    upload.single("arquivo")(req, res, async (err) => {
      if (!req.file) { req.session.erro = ["Sem arquivo"]; return res.redirect("/arquivos"); }
      const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, "liga");
      await query("UPDATE arquivos SET chave_r2=$1,mimetype=$2,tamanho=$3,nome_original=$4 WHERE id=$5",
        [r.chave, req.file.mimetype, req.file.size, req.file.originalname, req.params.id]);
      req.session.msg = ["Substituido!"];
      res.redirect("/arquivos");
    });
  } catch(e) { req.session.erro = [e.message]; res.redirect("/arquivos"); }
});

router.post("/arquivos/upload", requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require("../services/arquivos");
    upload.single("arquivo")(req, res, async (err) => {
      if (!req.file) return res.status(400).json({ erro: "Sem arquivo" });
      const pid = req.body.pasta_id || null;
      const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, "liga");
      await query("INSERT INTO arquivos (nome_original,chave_r2,mimetype,tamanho,pasta_id,enviado_por,ativo) VALUES ($1,$2,$3,$4,$5,$6,1)",
        [req.file.originalname, r.chave, req.file.mimetype, req.file.size, pid||null, req.session.usuario.id]);
      res.json({ ok: true });
    });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});


// ─── GOOGLE DRIVE INTEGRATION ─────────────────────────────────────────────────

router.get("/google/auth", requireAuth, requireAdmin, (req, res) => {
  const { getAuthUrl } = require("../services/google-drive");
  const url = getAuthUrl();
  res.redirect(url);
});

router.get("/google/callback", requireAuth, async (req, res) => {
  try {
    const { getTokens } = require("../services/google-drive");
    const tokens = await getTokens(req.query.code);
    // Salva tokens nas configuracoes
    await query("INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2",
      ["google_tokens", JSON.stringify(tokens)]);
    req.session.msg = ["Google Drive conectado com sucesso!"];
    res.redirect("/configuracoes");
  } catch(e) {
    req.session.erro = ["Erro ao conectar Google Drive: " + e.message];
    res.redirect("/configuracoes");
  }
});

router.post("/arquivos/upload-drive", requireAuth, async (req, res) => {
  try {
    const { upload } = require("../services/arquivos");
    const { uploadParaDrive } = require("../services/google-drive");

    upload.single("arquivo")(req, res, async (err) => {
      if (!req.file) return res.status(400).json({ erro: "Sem arquivo" });

      // Busca tokens do Google
      const tokensR = await query("SELECT valor FROM configuracoes WHERE chave='google_tokens'");
      if (!tokensR.rows[0]) return res.status(400).json({ erro: "Google Drive nao conectado. Va em Configuracoes e conecte." });

      const tokens = JSON.parse(tokensR.rows[0].valor);
      const pasta_id = req.body.pasta_id || null;

      // Faz upload para o Google Drive
      const result = await uploadParaDrive(tokens, req.file.buffer, req.file.originalname, req.file.mimetype);

      // Salva referencia no banco
      await query("INSERT INTO arquivos (nome_original, tipo, google_url, google_embed, pasta_id, enviado_por, ativo) VALUES ($1,$2,$3,$4,$5,$6,1)",
        [req.file.originalname, "google", result.webViewLink, result.embedUrl, pasta_id||null, req.session.usuario.id]);

      res.json({ ok: true, embedUrl: result.embedUrl });
    });
  } catch(e) {
    res.status(500).json({ erro: e.message });
  }
});


router.get("/arquivos/:id/url", requireAuth, async (req, res) => {
  try {
    const r = await query("SELECT chave_r2 FROM arquivos WHERE id=$1", [req.params.id]);
    const a = r.rows[0];
    if (!a || !a.chave_r2) return res.status(404).json({ erro: "Nao encontrado" });
    const { getUrlAssinada } = require("../services/desligamento");
    const url = await getUrlAssinada(a.chave_r2);
    res.json({ url });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});


router.get('/financeiro-arquivos/:id/url', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT chave_r2 FROM financeiro_arquivos WHERE id=$1', [req.params.id]);
    const a = r.rows[0];
    if (!a || !a.chave_r2) return res.status(404).json({ erro: 'Nao encontrado' });
    const { getUrlAssinada } = require('../services/desligamento');
    const url = await getUrlAssinada(a.chave_r2);
    res.json({ url });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});


router.get('/desligamentos/:id/imprimir', requireAuth, async (req, res) => {
  try {
    const rd = await query('SELECT * FROM desligamentos WHERE id=$1', [req.params.id]);
    if (!rd.rows[0]) return res.status(404).send('Nao encontrado');
    const desl = rd.rows[0];
    let pessoa = {};
    if (desl.membro_id) { const rm = await query('SELECT * FROM membros WHERE id=$1', [desl.membro_id]); pessoa = rm.rows[0] || {}; }
    else if (desl.ligante_id) { const rl = await query('SELECT * FROM ligantes WHERE id=$1', [desl.ligante_id]); pessoa = rl.rows[0] || {}; }
    const d = { ...desl, ...pessoa };
    const config = await getConfig();
    const { gerarHTMLDesligamento, imagemBase64 } = require('../services/desligamento');
    config.timbrado_b64 = await imagemBase64(config.timbrado_chave);
    config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
    config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
    let html = gerarHTMLDesligamento(d, config, d.data_solicitacao, d.tipo_membro);
    html = html.replace('</body>', '<script>window.onload=function(){window.print()}</script></body>');
    res.send(html);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});


router.post('/desligamentos/:id/reenviar', requireAuth, async (req, res) => {
  try {
    const rd = await query('SELECT * FROM desligamentos WHERE id=$1', [req.params.id]);
    if (!rd.rows[0]) { req.session.erro=['Nao encontrado.']; return res.redirect('/desligamentos'); }
    const desl = rd.rows[0];
    let pessoa = {};
    if (desl.membro_id) { const rm = await query('SELECT * FROM membros WHERE id=$1',[desl.membro_id]); pessoa=rm.rows[0]||{}; }
    else if (desl.ligante_id) { const rl = await query('SELECT * FROM ligantes WHERE id=$1',[desl.ligante_id]); pessoa=rl.rows[0]||{}; }
    const d = {...desl,...pessoa};
    if (!d.email) { req.session.erro=['Email nao cadastrado.']; return res.redirect('/desligamentos'); }
    const config = await getConfig();
    const {gerarHTMLDesligamento,imagemBase64} = require('../services/desligamento');
    config.timbrado_b64 = await imagemBase64(config.timbrado_chave);
    config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
    config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
    const html = gerarHTMLDesligamento(d, config, d.data_solicitacao, d.tipo_membro);
    const htmlPdf = require('html-pdf-node');
    const pdfBuffer = await htmlPdf.generatePdf({ content: html }, { format: 'A4', printBackground: true });
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({host:process.env.EMAIL_HOST,port:process.env.EMAIL_PORT,auth:{user:process.env.EMAIL_USER,pass:process.env.EMAIL_PASS}});
    await transporter.sendMail({
      from: process.env.EMAIL_USER, to: d.email,
      subject: 'Carta de Rescisión — LAURO (Reenvío)',
      html: `<p>Estimado/a <strong>${d.nome}</strong>,</p><p>Reenviamos su Carta de Rescisión de la LAURO.</p><ol><li>Imprima el documento</li><li>Firme en el espacio indicado</li><li>Escanee el documento firmado</li><li><strong>Responda este mismo email</strong> con el documento firmado adjunto</li></ol><p>Atentamente,<br>Secretaría — LAURO</p>`,
      attachments: [{filename:'carta-rescision-LAURO.pdf',content:pdfBuffer,contentType:'application/pdf'}]
    });
    await query('UPDATE desligamentos SET status=$1, enviado_em=NOW() WHERE id=$2', ['enviado', req.params.id]);
    req.session.msg=['Email reenviado para '+d.email+'!'];
    res.redirect('/desligamentos');
  } catch(e) { req.session.erro=['Erro: '+e.message]; res.redirect('/desligamentos'); }
});


// ─── DESVINCULAÇÕES ────────────────────────────────────────────────────────────

router.get('/desvinculacoes', requireAuth, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];
  const [desvR, ligR] = await Promise.all([
    query(`SELECT d.*, l.nome as ligante_nome, l.email as ligante_email FROM desvinculacoes d LEFT JOIN ligantes l ON l.id=d.ligante_id ORDER BY d.criado_em DESC`),
    query('SELECT id,nome,email FROM ligantes WHERE ativo=1 ORDER BY nome')
  ]);
  res.render('pages/desvinculacoes', { config, usuario: req.session.usuario, msg, erro, desvinculacoes: desvR.rows, ligantes: ligR.rows });
});

router.post('/desvinculacoes', requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.fields([{name:'adv1'},{name:'adv2'},{name:'adv3'}])(req, res, async (err) => {
      const { ligante_id, data_solicitacao, motivo, num_advertencias } = req.body;
      const lid = ligante_id && ligante_id !== '' ? parseInt(ligante_id) : null;
      let adv1=null, adv2=null, adv3=null;
      if (req.files && req.files.adv1 && req.files.adv1[0]) {
        const f = req.files.adv1[0];
        const r = await uploadArquivo(f.buffer, f.originalname, f.mimetype, 'advertencias');
        adv1 = r.chave;
      }
      if (req.files && req.files.adv2 && req.files.adv2[0]) {
        const f = req.files.adv2[0];
        const r = await uploadArquivo(f.buffer, f.originalname, f.mimetype, 'advertencias');
        adv2 = r.chave;
      }
      if (req.files && req.files.adv3 && req.files.adv3[0]) {
        const f = req.files.adv3[0];
        const r = await uploadArquivo(f.buffer, f.originalname, f.mimetype, 'advertencias');
        adv3 = r.chave;
      }
      await query('INSERT INTO desvinculacoes (ligante_id, data_solicitacao, motivo, num_advertencias, adv1_chave, adv2_chave, adv3_chave, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [lid, data_solicitacao || new Date(), motivo || null, parseInt(num_advertencias)||3, adv1, adv2, adv3, req.session.usuario.id]);
      req.session.msg = ['Desvinculação criada!'];
      res.redirect('/desvinculacoes');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/desvinculacoes'); }
});

router.get('/desvinculacoes/:id/adv/:num', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT adv'+req.params.num+'_chave as chave FROM desvinculacoes WHERE id=$1', [req.params.id]);
    const chave = r.rows[0]?.chave;
    if (!chave) return res.status(404).send('Não encontrado');
    const { getUrlAssinada } = require('../services/desligamento');
    const url = await getUrlAssinada(chave);
    res.redirect(url);
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});

async function gerarHTMLDesvinculacao(ligante, config, data) {
  const { imagemBase64 } = require('../services/desligamento');
  const timbrado = config.timbrado_b64 || null;
  const presidente = config.assinatura_presidente_b64 || null;
  const secretario = config.assinatura_secretario_b64 || null;
  const nomePresidente = (config.financeiro_nome || config.presidente_nome || 'MANUEL FERNANDO MACEDO NETO').toUpperCase();
  const nomeSecretario = (config.secretario_nome || 'KAUÊ TEIXEIRA LACERDA').toUpperCase();
  const d = new Date(data);
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const dataStr = d.getDate() + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear();

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'Times New Roman',serif; font-size:11pt; color:#000; }
.pagina { width:210mm; height:297mm; position:relative; overflow:hidden; }
.bg { position:absolute; top:0; left:0; width:210mm; height:297mm; z-index:0; }
.bg img { width:210mm; height:297mm; display:block; }
.texto { position:absolute; top:52mm; left:22mm; width:166mm; height:203mm; z-index:1; display:flex; flex-direction:column; }
.titulo { font-size:11pt; font-weight:bold; margin-bottom:10px; }
.corpo { text-align:justify; line-height:1.5; flex:1; }
.corpo p { margin-bottom:7px; }
.corpo ul { margin:5px 0 7px 20px; }
.corpo ul li { margin-bottom:3px; }
.assinaturas { display:flex; flex-direction:column; gap:10px; align-items:center; }
.assinatura-bloco { text-align:center; width:70%; }
.assinatura-img-wrap { height:50px; display:flex; align-items:flex-end; justify-content:center; margin-bottom:3px; }
.assinatura-img { max-height:50px; max-width:130px; object-fit:contain; }
.linha { border-top:1.5px solid #000; width:90%; margin:0 auto 3px; }
.assinatura-nome { font-weight:bold; font-size:8.5pt; text-transform:uppercase; }
.assinatura-cargo { font-size:8pt; margin-top:2px; }
</style>
</head>
<body>
<div class="pagina">
  <div class="bg">${timbrado ? `<img src="${timbrado}">` : ''}</div>
  <div class="texto">
    <div class="titulo">Liga Académica de Urología - LAURO<br>Universidad Central del Paraguay</div>
    <div class="corpo">
      <p>Ciudad del Este, ${dataStr}.</p>
      <p>Al(la) Sr(a). <strong>${ligante.nome}</strong></p>
      <p><strong>Asunto: Carta de desvinculación de la Liga Académica de Urología - LAURO</strong></p>
      <p>Estimado(a) ${ligante.nome.split(' ')[0]},</p>
      <p>De acuerdo con el Estatuto y el Reglamento Interno de la Liga Académica de Urología, los miembros (ligantes) deben cumplir con criterios indispensables para mantener su condición de activos, entre ellos:</p>
      <ul>
        <li>Participación regular en las actividades de la Liga;</li>
        <li>Estar en posesión del uniforme de la Liga;</li>
        <li>Estar al día con las mensualidades, según lo estipulado en el contrato firmado en la entrevista de ingreso.</li>
      </ul>
      <p>Sin embargo, tras la evaluación y registro, se constató que Vd. no cumplió con dichos criterios durante el período de su participación. Señalamos que, a lo largo del proceso, se emitieron ${ligante.num_advertencias || 3} advertencia(s) por escrito, las cuales no fueron debidamente atendidas.</p>
      <p>En vista de lo expuesto y en conformidad con nuestras normas estatutarias y reglamentarias, comunicamos que, a partir de esta fecha, Vd. queda desvinculado(a) de la Liga Académica de Urología.</p>
      <p>Agradecemos la colaboración prestada hasta el momento y nos ponemos a disposición para cualquier aclaración que sea necesaria.</p>
      <p>Atentamente,</p>
    </div>
    <div class="assinaturas">
      <div class="assinatura-bloco">
        <div class="assinatura-img-wrap">${presidente ? `<img src="${presidente}" class="assinatura-img">` : ''}</div>
        <div class="linha"></div>
        <div class="assinatura-nome">${nomePresidente}</div>
        <div class="assinatura-cargo">PRESIDENTE — LAURO</div>
      </div>
      <div class="assinatura-bloco">
        <div class="assinatura-img-wrap">${secretario ? `<img src="${secretario}" class="assinatura-img">` : ''}</div>
        <div class="linha"></div>
        <div class="assinatura-nome">${nomeSecretario}</div>
        <div class="assinatura-cargo">SECRETÁRIO — LAURO</div>
      </div>
    </div>
  </div>
</div>
</body>
</html>`;
}

async function prepararConfigDesvinc(config) {
  const { imagemBase64 } = require('../services/desligamento');
  config.timbrado_b64 = await imagemBase64(config.timbrado_chave);
  config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
  config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
  return config;
}

router.get('/desvinculacoes/:id/visualizar', requireAuth, async (req, res) => {
  try {
    const rd = await query('SELECT * FROM desvinculacoes WHERE id=$1', [req.params.id]);
    if (!rd.rows[0]) return res.status(404).send('Não encontrado');
    const desl = rd.rows[0];
    const rl = await query('SELECT * FROM ligantes WHERE id=$1', [desl.ligante_id]);
    const ligante = {...(rl.rows[0] || {}), num_advertencias: desl.num_advertencias || 3};
    const config = await prepararConfigDesvinc(await getConfig());
    const html = await gerarHTMLDesvinculacao(ligante, config, desl.data_solicitacao);
    res.send(html);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.get('/desvinculacoes/:id/imprimir', requireAuth, async (req, res) => {
  try {
    const rd = await query('SELECT * FROM desvinculacoes WHERE id=$1', [req.params.id]);
    if (!rd.rows[0]) return res.status(404).send('Não encontrado');
    const rl = await query('SELECT * FROM ligantes WHERE id=$1', [rd.rows[0].ligante_id]);
    const ligante = {...(rl.rows[0] || {}), num_advertencias: rd.rows[0].num_advertencias || 3};
    const config = await prepararConfigDesvinc(await getConfig());
    let html = await gerarHTMLDesvinculacao(ligante, config, rd.rows[0].data_solicitacao);
    html = html.replace('</body>', '<script>window.onload=function(){window.print()}</script></body>');
    res.send(html);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

async function enviarEmailDesvinc(id, req, res, reenvio) {
  try {
    const rd = await query('SELECT * FROM desvinculacoes WHERE id=$1', [id]);
    if (!rd.rows[0]) { req.session.erro=['Não encontrado.']; return res.redirect('/desvinculacoes'); }
    const desl = rd.rows[0];
    const rl = await query('SELECT * FROM ligantes WHERE id=$1', [desl.ligante_id]);
    const ligante = rl.rows[0] || {};
    if (!ligante.email) { req.session.erro=['Email não cadastrado.']; return res.redirect('/desvinculacoes'); }
    const config = await prepararConfigDesvinc(await getConfig());
    const html = await gerarHTMLDesvinculacao(ligante, config, desl.data_solicitacao);
    const htmlPdf = require('html-pdf-node');
    const pdfBuffer = await htmlPdf.generatePdf({ content: html }, { format: 'A4', printBackground: true });
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({ host: process.env.EMAIL_HOST, port: process.env.EMAIL_PORT, auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
    await transporter.sendMail({
      from: process.env.EMAIL_USER, to: ligante.email,
      subject: 'Carta de Desvinculación — Liga Académica de Urología LAURO' + (reenvio ? ' (Reenvío)' : ''),
      html: `<p>Estimado(a) <strong>${ligante.nome}</strong>,</p><p>Adjunto encontrará su Carta de Desvinculación de la Liga Académica de Urología - LAURO.</p><p>En caso de dudas, responda este mismo email.</p><p>Atentamente,<br>Secretaría — LAURO</p>`,
      attachments: [{ filename: 'carta-desvinculacion-LAURO.pdf', content: pdfBuffer, contentType: 'application/pdf' }]
    });
    await query('UPDATE desvinculacoes SET status=$1, enviado_em=NOW() WHERE id=$2', ['enviado', id]);
    req.session.msg = ['Email enviado para ' + ligante.email + '!'];
    res.redirect('/desvinculacoes');
  } catch(e) { req.session.erro=['Erro: ' + e.message]; res.redirect('/desvinculacoes'); }
}

router.post('/desvinculacoes/:id/enviar', requireAuth, (req, res) => enviarEmailDesvinc(req.params.id, req, res, false));
router.post('/desvinculacoes/:id/reenviar', requireAuth, (req, res) => enviarEmailDesvinc(req.params.id, req, res, true));

router.post('/desvinculacoes/:id/deletar', requireAuth, requireAdmin, async (req, res) => {
  await query('DELETE FROM desvinculacoes WHERE id=$1', [req.params.id]);
  req.session.msg = ['Desvinculação excluída!'];
  res.redirect('/desvinculacoes');
});


router.post('/desvinculacoes/:id/editar', requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.fields([{name:'adv1'},{name:'adv2'},{name:'adv3'}])(req, res, async (err) => {
      const { num_advertencias } = req.body;
      let updates = ['num_advertencias=$1'];
      let vals = [parseInt(num_advertencias)||3];
      let idx = 2;
      for (const num of [1,2,3]) {
        const key = 'adv'+num;
        if (req.files && req.files[key] && req.files[key][0]) {
          const f = req.files[key][0];
          const r = await uploadArquivo(f.buffer, f.originalname, f.mimetype, 'advertencias');
          updates.push('adv'+num+'_chave=$'+idx);
          vals.push(r.chave);
          idx++;
        }
      }
      vals.push(req.params.id);
      await query('UPDATE desvinculacoes SET '+updates.join(',')+' WHERE id=$'+idx, vals);
      req.session.msg = ['Desvinculação atualizada!'];
      res.redirect('/desvinculacoes');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/desvinculacoes'); }
});


// ─── CARTA DE COBRANÇA ────────────────────────────────────────────────────────

function gerarHTMLCartaCobranca(pessoa, config, carta) {
  const timbrado = config.timbrado_b64 || null;
  const presidente = config.assinatura_presidente_b64 || null;
  const nomePresidente = (config.financeiro_nome || config.presidente_nome || 'MANUEL FERNANDO MACEDO NETO').toUpperCase();
  const d = new Date(carta.data || new Date());
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const dataStr = d.getDate() + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear();
  const mesRef = carta.mes_referencia || '___________';
  const venc = carta.vencimento ? new Date(carta.vencimento).toLocaleDateString('es-PY') : '___________';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'Times New Roman',serif; font-size:11pt; color:#000; }
.pagina { width:210mm; height:297mm; position:relative; overflow:hidden; }
.bg { position:absolute; top:0; left:0; width:210mm; height:297mm; z-index:0; }
.bg img { width:210mm; height:297mm; display:block; }
.texto { position:absolute; top:52mm; left:22mm; width:166mm; height:203mm; z-index:1; display:flex; flex-direction:column; }
.titulo { font-size:13pt; font-weight:bold; text-align:center; margin-bottom:6px; text-transform:uppercase; }
.subtitulo { font-size:11pt; font-weight:bold; text-align:center; margin-bottom:14px; text-transform:uppercase; }
.corpo { text-align:justify; line-height:1.55; flex:1; }
.corpo p { margin-bottom:8px; }
.assinaturas { display:flex; flex-direction:column; gap:10px; align-items:center; margin-top:10px; }
.assinatura-bloco { text-align:center; width:70%; }
.assinatura-img-wrap { height:50px; display:flex; align-items:flex-end; justify-content:center; margin-bottom:3px; }
.assinatura-img { max-height:50px; max-width:130px; object-fit:contain; }
.linha { border-top:1.5px solid #000; width:90%; margin:0 auto 3px; }
.assinatura-nome { font-weight:bold; font-size:8.5pt; text-transform:uppercase; }
.assinatura-cargo { font-size:8pt; margin-top:2px; }
</style>
</head>
<body>
<div class="pagina">
  <div class="bg">${timbrado ? `<img src="${timbrado}">` : ''}</div>
  <div class="texto">
    <div class="titulo">Carta de Cobro — LAURO</div>
    <div class="subtitulo">Pago Mensual Vencido</div>
    <div class="corpo">
      <p>Ciudad del Este/PY, ${dataStr}.</p>
      <p>Estimado/a señor/a <strong>${pessoa.nome || '___________'}</strong>,</p>
      <p>Esperamos que este mensaje le encuentre bien.</p>
      <p>Nos ponemos en contacto con usted en nombre de LAURO – Liga Académica de Urología para recordarle que su cuota de membresía está vencida. Como ya le informamos, las cuotas de membresía vencen el día 15 de cada mes.</p>
      <p>Hasta la fecha, no hemos recibido el pago de la cuota mensual correspondiente al mes de <strong>${mesRef}</strong>, cuyo vencimiento fue el <strong>${venc}</strong>. Solicitamos amablemente que se abone la deuda lo antes posible para evitar cualquier restricción en la participación en las actividades de la Liga.</p>
      <p>Si ya ha realizado el pago, ignore este mensaje o, si es posible, envíenos el comprobante de pago para su verificación.</p>
      <p>Estamos a su disposición para responder cualquier pregunta o proporcionar aclaraciones.</p>
      <p>Atentamente,</p>
    </div>
    <div class="assinaturas">
      <div class="assinatura-bloco">
        <div class="assinatura-img-wrap">${presidente ? `<img src="${presidente}" class="assinatura-img">` : ''}</div>
        <div class="linha"></div>
        <div class="assinatura-nome">${nomePresidente}</div>
        <div class="assinatura-cargo">Director(a) Financiero(a)<br>LAURO – Liga Académica de Urología</div>
      </div>
    </div>
  </div>
</div>
</body>
</html>`;
}

async function prepararConfigCobranca(config) {
  const { imagemBase64 } = require('../services/desligamento');
  config.timbrado_b64 = await imagemBase64(config.timbrado_chave);
  config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
  return config;
}

async function buscarPessoaCarta(carta) {
  let pessoa = {};
  if (carta.membro_id) {
    const r = await query('SELECT * FROM membros WHERE id=$1', [carta.membro_id]);
    pessoa = r.rows[0] || {};
  } else if (carta.ligante_id) {
    const r = await query('SELECT * FROM ligantes WHERE id=$1', [carta.ligante_id]);
    pessoa = r.rows[0] || {};
  }
  return pessoa;
}

router.get('/carta-cobranca', requireAuth, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];
  const [cartasR, membrosR, ligantesR] = await Promise.all([
    query(`SELECT c.*, COALESCE(m.nome,l.nome) as pessoa_nome, COALESCE(m.email,l.email) as pessoa_email FROM cartas_cobranca c LEFT JOIN membros m ON m.id=c.membro_id LEFT JOIN ligantes l ON l.id=c.ligante_id ORDER BY c.criado_em DESC`),
    query('SELECT id,nome,email FROM membros WHERE ativo=1 ORDER BY nome'),
    query('SELECT id,nome,email FROM ligantes WHERE ativo=1 ORDER BY nome')
  ]);
  res.render('pages/carta-cobranca', { config, usuario: req.session.usuario, msg, erro, cartas: cartasR.rows, membros: membrosR.rows, ligantes: ligantesR.rows });
});

router.post('/carta-cobranca', requireAuth, async (req, res) => {
  const { membro_id, ligante_id, mes_referencia, vencimento } = req.body;
  const mid = membro_id && membro_id !== '' ? parseInt(membro_id) : null;
  const lid = ligante_id && ligante_id !== '' ? parseInt(ligante_id) : null;
  await query('INSERT INTO cartas_cobranca (membro_id, ligante_id, mes_referencia, vencimento, criado_por) VALUES ($1,$2,$3,$4,$5)',
    [mid, lid, mes_referencia, vencimento || null, req.session.usuario.id]);
  req.session.msg = ['Carta criada!'];
  res.redirect('/carta-cobranca');
});

router.get('/carta-cobranca/:id/visualizar', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM cartas_cobranca WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).send('Nao encontrado');
    const carta = r.rows[0];
    const pessoa = await buscarPessoaCarta(carta);
    const config = await prepararConfigCobranca(await getConfig());
    const html = gerarHTMLCartaCobranca(pessoa, config, carta);
    res.send(html);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.get('/carta-cobranca/:id/imprimir', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM cartas_cobranca WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).send('Nao encontrado');
    const carta = r.rows[0];
    const pessoa = await buscarPessoaCarta(carta);
    const config = await prepararConfigCobranca(await getConfig());
    let html = gerarHTMLCartaCobranca(pessoa, config, carta);
    html = html.replace('</body>', '<script>window.onload=function(){window.print()}</script></body>');
    res.send(html);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

async function enviarCartaCobranca(id, req, res, reenvio) {
  try {
    const r = await query('SELECT * FROM cartas_cobranca WHERE id=$1', [id]);
    if (!r.rows[0]) { req.session.erro=['Nao encontrado.']; return res.redirect('/carta-cobranca'); }
    const carta = r.rows[0];
    const pessoa = await buscarPessoaCarta(carta);
    if (!pessoa.email) { req.session.erro=['Email nao cadastrado.']; return res.redirect('/carta-cobranca'); }
    const config = await prepararConfigCobranca(await getConfig());
    const html = gerarHTMLCartaCobranca(pessoa, config, carta);
    const htmlPdf = require('html-pdf-node');
    const pdfBuffer = await htmlPdf.generatePdf({ content: html }, { format: 'A4', printBackground: true });
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({ host: process.env.EMAIL_HOST, port: process.env.EMAIL_PORT, auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
    await transporter.sendMail({
      from: process.env.EMAIL_USER, to: pessoa.email,
      subject: 'Carta de Cobro — LAURO' + (reenvio ? ' (Reenvío)' : ''),
      html: `<p>Estimado(a) <strong>${pessoa.nome}</strong>,</p><p>Adjunto encontrará su Carta de Cobro de la Liga Académica de Urología - LAURO.</p><p>Si ya realizó el pago, por favor envíenos el comprobante respondiendo este email.</p><p>Atentamente,<br>Dirección Financiera — LAURO</p>`,
      attachments: [{ filename: 'carta-cobro-LAURO.pdf', content: pdfBuffer, contentType: 'application/pdf' }]
    });
    await query('UPDATE cartas_cobranca SET status=$1, enviado_em=NOW() WHERE id=$2', ['enviado', id]);
    req.session.msg = ['Email enviado para ' + pessoa.email + '!'];
    res.redirect('/carta-cobranca');
  } catch(e) { req.session.erro=['Erro: ' + e.message]; res.redirect('/carta-cobranca'); }
}

router.post('/carta-cobranca/:id/enviar', requireAuth, (req, res) => enviarCartaCobranca(req.params.id, req, res, false));
router.post('/carta-cobranca/:id/reenviar', requireAuth, (req, res) => enviarCartaCobranca(req.params.id, req, res, true));

router.post('/carta-cobranca/:id/deletar', requireAuth, async (req, res) => {
  await query('DELETE FROM cartas_cobranca WHERE id=$1', [req.params.id]);
  req.session.msg = ['Carta excluída!'];
  res.redirect('/carta-cobranca');
});

module.exports = router;
