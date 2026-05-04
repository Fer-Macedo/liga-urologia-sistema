const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const dayjs = require('dayjs');
const { query } = require('../models/database');
const { requireAuth, requireAdmin, requireFinanceiro } = require('../middleware/auth');
const { criarCobranca } = require('../services/pagbank');
const { notificarCobranca } = require('../services/notificacoes');

async function getConfig() {
  const r = await query('SELECT chave, valor FROM configuracoes');
  const cfg = {};
  r.rows.forEach(row => { cfg[row.chave] = row.valor; });
  return cfg;
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

router.get('/', (req, res) => res.redirect('/dashboard'));

router.get('/login', async (req, res) => {
  if (req.session?.usuario) return res.redirect('/dashboard');
  res.render('pages/login', { config: await getConfig(), erro: req.flash('erro') });
});

router.post('/login', async (req, res) => {
  const { email, senha } = req.body;
  const r = await query('SELECT * FROM usuarios WHERE email = $1 AND ativo = 1', [email]);
  const usuario = r.rows[0];
  if (!usuario || !bcrypt.compareSync(senha, usuario.senha)) {
    req.flash('erro', 'E-mail ou senha incorretos.');
    return res.redirect('/login');
  }
  req.session.usuario = { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil };
  res.redirect('/dashboard');
});

router.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

router.get('/dashboard', requireAuth, async (req, res) => {
  const config = await getConfig();
  const hoje = dayjs();
  const mes = hoje.format('YYYY-MM');
  const mesStr = `%-${mes}`;
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

router.get('/membros', requireAuth, async (req, res) => {
  const config = await getConfig();
  const filtro = req.query.filtro || 'todos';
  let where = '';
  if (filtro === 'ativos') where = 'WHERE m.ativo=1';
  else if (filtro === 'inativos') where = 'WHERE m.ativo=0';
  const membros = await query(
    `SELECT m.*, (SELECT status FROM cobrancas WHERE membro_id=m.id ORDER BY criado_em DESC LIMIT 1) as ultimo_status
     FROM membros m ${where} ORDER BY m.nome`
  );
  res.render('pages/membros', { config, usuario: req.session.usuario, membros: membros.rows, filtro, msg: req.flash('msg'), erro: req.flash('erro') });
});

router.post('/membros', requireAuth, requireFinanceiro, async (req, res) => {
  const { nome, cpf, email, whatsapp, data_nascimento, dia_vencimento, mensalidade, desconto_pontualidade, observacoes } = req.body;
  await query(
    'INSERT INTO membros (nome,cpf,email,whatsapp,data_nascimento,dia_vencimento,mensalidade,desconto_pontualidade,observacoes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [nome, cpf||null, email||null, whatsapp||null, data_nascimento||null, parseInt(dia_vencimento)||5, parseFloat(mensalidade)||100, parseFloat(desconto_pontualidade)||10, observacoes||null]
  );
  req.flash('msg', `Membro ${nome} cadastrado!`);
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

router.get('/cobrancas', requireAuth, async (req, res) => {
  const config = await getConfig();
  const filtro = req.query.filtro || 'todas';
  let where = '';
  if (filtro === 'pagas') where = "WHERE c.status='pago'";
  else if (filtro === 'pendentes') where = "WHERE c.status='pendente'";
  else if (filtro === 'atrasadas') where = "WHERE c.status='atrasado'";
  const r = await query(
    `SELECT c.*, m.nome, m.whatsapp, m.email FROM cobrancas c
     JOIN membros m ON m.id=c.membro_id ${where} ORDER BY c.data_vencimento DESC LIMIT 100`
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

router.get('/aniversarios', requireAuth, async (req, res) => {
  const config = await getConfig();
  const hoje = dayjs().format('MM-DD');
  const r = await query(
    "SELECT *, TO_CHAR(data_nascimento::date,'MM-DD') as md FROM membros WHERE ativo=1 AND data_nascimento IS NOT NULL ORDER BY TO_CHAR(data_nascimento::date,'MM-DD')"
  );
  res.render('pages/aniversarios', { config, usuario: req.session.usuario, aniversariantes: r.rows, hoje, dayjs, msg: req.flash('msg') });
});

// ─── NOTIFICAÇÕES ──────────────────────────────────────────────────────────────

router.get('/notificacoes', requireAuth, requireAdmin, async (req, res) => {
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

router.get('/configuracoes', requireAuth, requireAdmin, async (req, res) => {
  res.render('pages/configuracoes', { config: await getConfig(), usuario: req.session.usuario, msg: req.flash('msg'), erro: req.flash('erro') });
});

router.post('/configuracoes', requireAuth, requireAdmin, async (req, res) => {
  const campos = ['org_nome','org_cor','mensalidade_padrao','desconto_padrao','dia_vencimento_padrao','multa_atraso'];
  for (const c of campos) {
    if (req.body[c] !== undefined) {
      await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', [c, req.body[c]]);
    }
  }
  req.flash('msg', 'Configurações salvas!');
  res.redirect('/configuracoes');
});

// ─── USUÁRIOS ──────────────────────────────────────────────────────────────────

router.get('/usuarios', requireAuth, requireAdmin, async (req, res) => {
  const config = await getConfig();
  const r = await query('SELECT id,nome,email,perfil,ativo,criado_em FROM usuarios ORDER BY criado_em');
  res.render('pages/usuarios', { config, usuario: req.session.usuario, usuarios: r.rows, msg: req.flash('msg'), erro: req.flash('erro') });
});

router.post('/usuarios', requireAuth, requireAdmin, async (req, res) => {
  const { nome, email, senha, perfil } = req.body;
  const hash = bcrypt.hashSync(senha, 10);
  try {
    await query('INSERT INTO usuarios (nome,email,senha,perfil) VALUES ($1,$2,$3,$4)', [nome, email, hash, perfil]);
    req.flash('msg', `Usuário ${nome} criado!`);
  } catch (e) {
    req.flash('erro', 'E-mail já cadastrado.');
  }
  res.redirect('/usuarios');
});

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

router.post('/minha-senha', requireAuth, async (req, res) => {
  const r = await query('SELECT * FROM usuarios WHERE id=$1', [req.session.usuario.id]);
  const usuario = r.rows[0];
  if (!bcrypt.compareSync(req.body.senha_atual, usuario.senha)) {
    req.flash('erro', 'Senha atual incorreta.');
    return res.redirect('/dashboard');
  }
  await query('UPDATE usuarios SET senha=$1 WHERE id=$2', [bcrypt.hashSync(req.body.nova_senha, 10), usuario.id]);
  req.flash('msg', 'Senha alterada!');
  res.redirect('/dashboard');
});

// ─── WEBHOOK PAGBANK ──────────────────────────────────────────────────────────

router.post('/webhook/pagbank', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const body = JSON.parse(req.body.toString());
    if (body.charges?.[0]?.status === 'PAID') {
      const chargeId = body.charges[0].id;
      await query("UPDATE cobrancas SET status='pago', data_pagamento=NOW() WHERE pagbank_charge_id=$1", [chargeId]);
    }
  } catch (e) { console.error('Webhook erro:', e.message); }
  res.sendStatus(200);
});

module.exports = router;
