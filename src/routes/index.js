const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const dayjs = require('dayjs');
const { query } = require('../models/database');
const { requireAuth, requireAdmin, requireFinanceiro, requireSecretaria, requirePermissao } = require('../middleware/auth');
const { criarCobranca, consultarPagamento } = require('../services/mercadopago');
const { notificarCobranca } = require('../services/notificacoes');

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
    query("SELECT * FROM membros WHERE ativo=1 AND data_nascimento IS NOT NULL ORDER BY TO_CHAR(data_nascimento::date,'MM-DD') LIMIT 6")
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
    "SELECT *, TO_CHAR(data_nascimento::date,'MM-DD') as md FROM membros WHERE ativo=1 AND data_nascimento IS NOT NULL ORDER BY TO_CHAR(data_nascimento::date,'MM-DD')"
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
  const campos = ['org_nome','org_cor','mensalidade_padrao','desconto_padrao','dia_vencimento_padrao','multa_atraso'];
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
  req.flash('msg', 'Configurações salvas!');
  res.redirect('/configuracoes');
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
  const atividades = await query('SELECT tipo,descricao,data_atividade FROM atividades WHERE turma_id=$1 ORDER BY data_atividade', [req.params.turmaId]);

  let linhas = membros.rows.map(m => {
    const pct = m.total_atividades > 0 ? Math.round((m.presencas / m.total_atividades) * 100) : 0;
    const status = pct >= 75 ? 'APTO' : pct >= 50 ? 'EM RISCO' : 'NÃO APTO';
    const cor = pct >= 75 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
    return `<tr><td style="padding:10px;border:1px solid #e5e7eb">${m.nome}</td><td style="padding:10px;border:1px solid #e5e7eb;text-align:center">${m.presencas}</td><td style="padding:10px;border:1px solid #e5e7eb;text-align:center">${m.total_atividades}</td><td style="padding:10px;border:1px solid #e5e7eb;text-align:center"><strong>${pct}%</strong></td><td style="padding:10px;border:1px solid #e5e7eb;text-align:center;color:${cor};font-weight:bold">${status}</td></tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Relatório — ${turma.nome}</title>
    <style>body{font-family:Arial,sans-serif;padding:30px}h1{color:#1a56db}table{width:100%;border-collapse:collapse}th{background:#1a56db;color:white;padding:12px;text-align:left}@media print{.no-print{display:none}}</style>
    </head><body>
    <div class="no-print" style="margin-bottom:20px"><button onclick="window.print()" style="background:#1a56db;color:white;border:none;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:14px">🖨️ Imprimir / Salvar PDF</button></div>
    <h1>Relatório de Frequência — ${turma.nome}</h1>
    <p><strong>Período:</strong> ${new Date(turma.data_inicio+'T12:00:00').toLocaleDateString('pt-BR')} ${turma.data_fim?'— '+new Date(turma.data_fim+'T12:00:00').toLocaleDateString('pt-BR'):''}</p>
    <p><strong>Total de atividades:</strong> ${atividades.rows.length} &nbsp;|&nbsp; <strong>Critério:</strong> Mínimo 75% de presença</p>
    <p><strong>Gerado em:</strong> ${new Date().toLocaleString('pt-BR')}</p><br>
    <table><thead><tr><th>Membro</th><th>Presenças</th><th>Total</th><th>Frequência</th><th>Status</th></tr></thead><tbody>${linhas}</tbody></table>
    <br><h3>Atividades realizadas:</h3>
    <table><thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th></tr></thead><tbody>
    ${atividades.rows.map(a=>`<tr><td style="padding:8px;border:1px solid #e5e7eb">${new Date(a.data_atividade+'T12:00:00').toLocaleDateString('pt-BR')}</td><td style="padding:8px;border:1px solid #e5e7eb">${a.tipo}</td><td style="padding:8px;border:1px solid #e5e7eb">${a.descricao}</td></tr>`).join('')}
    </tbody></table></body></html>`;
  res.send(html);
});

router.post('/frequencia/turma/:id/enviar', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const { enviarWhatsApp, enviarEmail } = require('../services/notificacoes');
  const turmaR = await query('SELECT * FROM turmas WHERE id=$1', [req.params.id]);
  const turma = turmaR.rows[0];
  const membros = await query(
    `SELECT m.*, tm.data_entrada,
      (SELECT COUNT(*) FROM atividades a WHERE a.turma_id=$1) as total_atividades,
      (SELECT COUNT(*) FROM presencas p JOIN atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1 AND p.membro_id=m.id AND p.presente=1) as presencas
     FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id WHERE tm.turma_id=$1`, [req.params.id]
  );
  const orgNome = config.org_nome || 'Liga Academica de Urologia';
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

module.exports = router;
