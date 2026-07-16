// ═══ PALESTRANTES ═══════════════════════════════════════════════════════════
const crypto = require('crypto');
const { query } = require('../models/database');
const { requireAuth, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');

module.exports = function (router) {

router.get('/palestrantes', requireAuth, requirePermissao('palestrantes'), async (req, res) => {
  try {
    const statusFiltro = req.query.status || 'todos';
    let whereClause = '';
    if (statusFiltro === 'pendente') whereClause = 'WHERE pendente=true';
    else if (statusFiltro === 'aprovado') whereClause = 'WHERE pendente=false AND preenchido_em IS NOT NULL';
    const [rAll, rPend, rStats] = await Promise.all([
      query(`SELECT * FROM palestrantes ${whereClause} ORDER BY criado_em DESC`),
      query('SELECT COUNT(*) as total FROM palestrantes WHERE pendente=true'),
      query('SELECT COUNT(*) as total, SUM(CASE WHEN preenchido_em IS NOT NULL THEN 1 ELSE 0 END) as completos FROM palestrantes')
    ]);
    const statsTotal = parseInt(rStats.rows[0].total) || 0;
    const statsCompletos = parseInt(rStats.rows[0].completos) || 0;
    const statsAguardando = statsTotal - statsCompletos;
    res.render('pages/palestrantes', {
      config: await getConfig(), usuario: req.session.usuario,
      paginaAtual: 'palestrantes',
      palestrantes: rAll.rows,
      statusFiltro,
      pendentesCount: parseInt(rPend.rows[0].total) || 0,
      statsTotal, statsCompletos, statsAguardando,
      msg: req.flash('msg'), erro: req.flash('erro')
    });
  } catch(e) { res.send('ERRO: ' + e.message); }
});


router.post('/palestrantes/gerar-link', requireAuth, async (req, res) => {
  try {
    const { nome_completo, email, whatsapp } = req.body;
    const token = require('crypto').randomBytes(32).toString('hex');
    await query(
      `INSERT INTO palestrantes (token_form,nome_completo,email,whatsapp,criado_por) VALUES ($1,$2,$3,$4,$5)`,
      [token, nome_completo||null, email||null, whatsapp||null, req.session.usuario.id]
    );
    req.flash('msg', ['link:' + token]);
    res.redirect('/palestrantes');
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/palestrantes'); }
});

router.post('/palestrantes/novo', requireAuth, async (req, res) => {
  try {
    const { nome_completo, email, whatsapp, cpf, rg_ci, especialidade, instituicao,
      endereco_pais, endereco_cep, endereco_rua, endereco_numero, endereco_complemento,
      endereco_bairro, endereco_cidade, endereco_estado, observacoes } = req.body;
    const token = crypto.randomBytes(32).toString('hex');
    await query(
      `INSERT INTO palestrantes (token_form,nome_completo,email,whatsapp,cpf,rg_ci,especialidade,instituicao,
        endereco_pais,endereco_cep,endereco_rua,endereco_numero,endereco_complemento,
        endereco_bairro,endereco_cidade,endereco_estado,observacoes,criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [token,nome_completo||null,email||null,whatsapp||null,cpf||null,rg_ci||null,especialidade||null,
       instituicao||null,endereco_pais||'Brasil',endereco_cep||null,endereco_rua||null,
       endereco_numero||null,endereco_complemento||null,endereco_bairro||null,
       endereco_cidade||null,endereco_estado||null,observacoes||null,req.session.usuario.id]
    );
    req.flash('msg', ['Palestrante criado! Copie o link e envie para ele.']);
    res.redirect('/palestrantes');
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/palestrantes'); }
});

router.post('/palestrantes/:id/editar', requireAuth, async (req, res) => {
  try {
    const { nome_completo, email, whatsapp, cpf, rg_ci, especialidade, instituicao,
      endereco_pais, endereco_cep, endereco_rua, endereco_numero, endereco_complemento,
      endereco_bairro, endereco_cidade, endereco_estado, observacoes } = req.body;
    await query(
      `UPDATE palestrantes SET nome_completo=$1,email=$2,whatsapp=$3,cpf=$4,rg_ci=$5,especialidade=$6,
        instituicao=$7,endereco_pais=$8,endereco_cep=$9,endereco_rua=$10,endereco_numero=$11,
        endereco_complemento=$12,endereco_bairro=$13,endereco_cidade=$14,endereco_estado=$15,
        observacoes=$16 WHERE id=$17`,
      [nome_completo||null,email||null,whatsapp||null,cpf||null,rg_ci||null,especialidade||null,
       instituicao||null,endereco_pais||'Brasil',endereco_cep||null,endereco_rua||null,
       endereco_numero||null,endereco_complemento||null,endereco_bairro||null,
       endereco_cidade||null,endereco_estado||null,observacoes||null,req.params.id]
    );
    req.flash('msg', ['Dados atualizados!']);
    res.redirect('/palestrantes');
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/palestrantes'); }
});

router.post('/palestrantes/:id/excluir', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM palestrantes WHERE id=$1', [req.params.id]);
    req.flash('msg', ['Palestrante excluído.']);
    res.redirect('/palestrantes');
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/palestrantes'); }
});

// FORMULÁRIO PÚBLICO — palestrante preenche
router.get('/palestrante/form/:token', async (req, res) => {
  try {
    const r = await query('SELECT * FROM palestrantes WHERE token_form=$1', [req.params.token]);
    if(!r.rows.length) return res.status(404).send('<h2>Link inválido ou expirado.</h2>');
    res.render('pages/form-palestrante', {
      config: await getConfig(),
      palestrante: r.rows[0],
      enviado: false,
      erro: null
    });
  } catch(e) { res.send('ERRO: ' + e.message); }
});

router.post('/palestrante/form/:token', async (req, res) => {
  try {
    const r = await query('SELECT * FROM palestrantes WHERE token_form=$1', [req.params.token]);
    if(!r.rows.length) return res.status(404).send('<h2>Link inválido.</h2>');
    const { nome_completo, email, whatsapp, rg_ci, especialidade, instituicao,
      endereco_pais, endereco_cep, endereco_rua, endereco_numero, endereco_complemento,
      endereco_bairro, endereco_cidade, endereco_estado } = req.body;
    await query(
      `UPDATE palestrantes SET nome_completo=$1,email=$2,whatsapp=$3,rg_ci=$4,especialidade=$5,
        instituicao=$6,endereco_pais=$7,endereco_cep=$8,endereco_rua=$9,endereco_numero=$10,
        endereco_complemento=$11,endereco_bairro=$12,endereco_cidade=$13,endereco_estado=$14,
        preenchido_em=NOW() WHERE token_form=$15`,
      [nome_completo||null,email||null,whatsapp||null,rg_ci||null,especialidade||null,
       instituicao||null,endereco_pais||'Brasil',endereco_cep||null,endereco_rua||null,
       endereco_numero||null,endereco_complemento||null,endereco_bairro||null,
       endereco_cidade||null,endereco_estado||null,req.params.token]
    );
    const updated = await query('SELECT * FROM palestrantes WHERE token_form=$1', [req.params.token]);
    res.render('pages/form-palestrante', {
      config: await getConfig(),
      palestrante: updated.rows[0],
      enviado: true,
      erro: null
    });
  } catch(e) { res.send('ERRO: ' + e.message); }
});

};
