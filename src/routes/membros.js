// ═══ MEMBROS (CRUD + aniversários) ══════════════════════════════════════════
const dayjs = require('dayjs');
const { query } = require('../models/database');
const { requireAuth, requireFinanceiro, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');

module.exports = function (router) {

// ─── MEMBROS ──────────────────────────────────────────────────────────────────

router.get('/membros', requireAuth, requirePermissao('membros'), async (req, res) => {
  const config = await getConfig();
  const filtro = req.query.filtro || 'todos';
  let where = '';
  if (filtro === 'ativos') where = 'WHERE m.ativo=1';
  else if (filtro === 'inativos') where = 'WHERE m.ativo=0';
  const [membros, statsR] = await Promise.all([
    query('SELECT m.*, CASE WHEN m.ativo=0 THEN \'cancelado\' WHEN EXISTS(SELECT 1 FROM cobrancas WHERE membro_id=m.id AND status=\'atrasado\') THEN \'atrasado\' WHEN EXISTS(SELECT 1 FROM cobrancas WHERE membro_id=m.id AND status IN (\'pago\',\'em_dia\') AND referencia LIKE \'%-\'||TO_CHAR(NOW(),\'YYYY-MM\')) THEN \'pago\' ELSE \'pendente\' END as ultimo_status FROM membros m ' + where + ' ORDER BY m.nome'),
    query(`SELECT
      COUNT(*) as total,
      SUM(CASE WHEN m.ativo=1 THEN 1 ELSE 0 END) as ativos,
      SUM(CASE WHEN m.ativo=0 THEN 1 ELSE 0 END) as inativos,
      SUM(CASE WHEN m.ativo=1 AND EXISTS(SELECT 1 FROM cobrancas WHERE membro_id=m.id AND status IN ('pago','em_dia') AND referencia LIKE '%-'||TO_CHAR(NOW(),'YYYY-MM')) THEN 1 ELSE 0 END) as em_dia,
      SUM(CASE WHEN m.ativo=1 AND EXISTS(SELECT 1 FROM cobrancas WHERE membro_id=m.id AND status='atrasado' AND membro_id IN (SELECT id FROM membros WHERE ativo=1)) THEN 1 ELSE 0 END) as atrasados
      FROM membros m`)
  ]);
  const st = statsR.rows[0];
  res.render('pages/membros', {
    config, usuario: req.session.usuario, membros: membros.rows, filtro,
    msg: req.flash('msg'), erro: req.flash('erro'),
    total: parseInt(st.total)||0,
    ativos: parseInt(st.ativos)||0,
    inativos: parseInt(st.inativos)||0,
    emDia: parseInt(st.em_dia)||0,
    atrasados: parseInt(st.atrasados)||0
  });
});

router.post('/membros', requireAuth, requireFinanceiro, async (req, res) => {
  const { nome, cpf, email, whatsapp, data_nascimento, dia_vencimento, mensalidade, desconto_pontualidade, observacoes } = req.body;
  await query(
    'INSERT INTO membros (nome,cpf,email,whatsapp,data_nascimento,dia_vencimento,mensalidade,desconto_pontualidade,observacoes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [nome, cpf||null, email||null, whatsapp||null, data_nascimento||null, parseInt(dia_vencimento)||15, parseFloat(mensalidade)||25, parseFloat(desconto_pontualidade)||20, observacoes||null]
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
  const { nome, cpf, email, whatsapp, data_nascimento, dia_vencimento, mensalidade, desconto_pontualidade, ativo, observacoes, motivo_inativacao } = req.body;
  const membroAtual = await query('SELECT ativo FROM membros WHERE id=$1', [req.params.id]);
  const eraAtivo = membroAtual.rows[0]?.ativo;
  const novoAtivo = (ativo === '1' || ativo === 1) ? 1 : 0;
  await query(
    'UPDATE membros SET nome=$1,cpf=$2,email=$3,whatsapp=$4,data_nascimento=$5,dia_vencimento=$6,mensalidade=$7,desconto_pontualidade=$8,ativo=$9,observacoes=$10 WHERE id=$11',
    [nome, cpf||null, email||null, whatsapp||null, data_nascimento||null, parseInt(dia_vencimento)||15, parseFloat(mensalidade)||25, parseFloat(desconto_pontualidade)||20, novoAtivo, observacoes||null, req.params.id]
  );
  if (eraAtivo == 1 && novoAtivo === 0) {
    await query("UPDATE cobrancas SET status='cancelado' WHERE membro_id=$1 AND status IN ('pendente','atrasado')", [req.params.id]);
    if (motivo_inativacao) {
      await query('INSERT INTO inativacoes_log (tipo, referencia_id, motivo, usuario_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', ['membro', req.params.id, motivo_inativacao, req.session.usuario.id]).catch(()=>{});
    }
  }
  req.flash('msg', novoAtivo === 0 ? 'Membro inativado e cobranças pendentes canceladas!' : 'Membro atualizado!');
  res.redirect('/membros');
});

// ─── ANIVERSÁRIOS ─────────────────────────────────────────────────────────────

router.get('/aniversarios', requireAuth, requirePermissao('aniversarios'), async (req, res) => {
  const config = await getConfig();
  const hoje = dayjs().format('MM-DD');
  const r = await query(
    "SELECT * FROM (SELECT id, nome, whatsapp, data_nascimento::text, TO_CHAR(data_nascimento::date,'MM-DD') as md, TO_CHAR(data_nascimento::date,'MM-DD') as aniv, 'ligante' as tipo, foto_chave FROM ligantes WHERE ativo=1 AND data_nascimento IS NOT NULL UNION ALL SELECT id, nome, whatsapp, data_nascimento::text, TO_CHAR(data_nascimento::date,'MM-DD') as md, TO_CHAR(data_nascimento::date,'MM-DD') as aniv, 'diretivo' as tipo, foto_chave FROM diretivos WHERE ativo=1 AND data_nascimento IS NOT NULL) t ORDER BY md"
  );
  res.render('pages/aniversarios', { config, usuario: req.session.usuario, aniversariantes: r.rows, hoje, dayjs, msg: req.flash('msg') });
});


};
