// ═══ COMUNICADOS SISTEMA INTERNO ════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requirePermissao } = require('../middleware/auth');

module.exports = function (router) {

router.get('/comunicados', requireAuth, requirePermissao('comunicados'), async (req, res) => {
  const r = await query('SELECT c.*, u.nome as autor_nome FROM comunicados c LEFT JOIN usuarios u ON u.id=c.autor_id ORDER BY c.criado_em DESC');
  const configR = await query('SELECT chave, valor FROM configuracoes');
  const config = configR.rows.reduce((a,r)=>{a[r.chave]=r.valor;return a},{});
  res.render('pages/comunicados', { comunicados: r.rows, config, ok: req.query.ok||null, erro: req.query.erro||null });
});

router.post('/comunicados/novo', requireAuth, requirePermissao('comunicados'), async (req, res) => {
  const { titulo, texto, destinatarios } = req.body;
  if (!titulo || !texto) return res.redirect('/comunicados?erro=Preencha+titulo+e+texto');
  await query('INSERT INTO comunicados (titulo, texto, destinatarios, autor_id) VALUES ($1,$2,$3,$4)', [titulo.trim(), texto.trim(), destinatarios||'todos', req.session.userId||null]);
  res.redirect('/comunicados?ok=Comunicado+publicado+com+sucesso');
});

router.post('/comunicados/:id/toggle', requireAuth, requirePermissao('comunicados'), async (req, res) => {
  await query('UPDATE comunicados SET ativo = NOT ativo WHERE id=$1', [req.params.id]);
  res.redirect('/comunicados');
});

router.post('/comunicados/:id/excluir', requireAuth, requirePermissao('comunicados'), async (req, res) => {
  await query('DELETE FROM comunicados WHERE id=$1', [req.params.id]);
  res.redirect('/comunicados?ok=Comunicado+excluido');
});

};
