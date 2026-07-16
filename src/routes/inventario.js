// ═══ INVENTÁRIO PATRIMONIAL ═════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');

module.exports = function (router) {

// ─── INVENTÁRIO PATRIMONIAL ───────────────────────────────────────────────────

router.get('/inventario', requireAuth, requirePermissao('inventario'), async (req, res) => {
  const config = await getConfig();
  const busca = req.query.busca || '';
  const categoria = req.query.categoria || '';
  const estado = req.query.estado || '';
  const situacao = req.query.situacao || 'ativos';
  const params = [];
  let where = situacao === 'inativos' ? 'WHERE i.ativo=0' : situacao === 'todos' ? 'WHERE 1=1' : 'WHERE i.ativo=1';
  let idx = 1;
  if (busca) { where += ' AND (i.nome ILIKE $' + idx + ' OR i.codigo ILIKE $' + idx + ' OR i.responsavel ILIKE $' + idx + ')'; params.push('%' + busca + '%'); idx++; }
  if (categoria) { where += ' AND i.categoria_id=$' + idx; params.push(categoria); idx++; }
  if (estado) { where += ' AND i.estado=$' + idx; params.push(estado); idx++; }
  const [itens, categorias, stats] = await Promise.all([
    query('SELECT i.*, c.nome as categoria_nome, c.cor as categoria_cor FROM inventario_itens i LEFT JOIN inventario_categorias c ON c.id=i.categoria_id ' + where + ' ORDER BY i.criado_em DESC', params),
    query('SELECT * FROM inventario_categorias ORDER BY nome'),
    query("SELECT COUNT(*) FILTER (WHERE i.ativo=1) as total, COUNT(*) FILTER (WHERE i.estado='danificado' AND i.ativo=1) as danificados, COUNT(*) FILTER (WHERE i.estado='perdido' AND i.ativo=1) as perdidos, COALESCE(SUM(i.valor_estimado) FILTER (WHERE i.ativo=1),0) as valor_total, COALESCE(SUM(i.valor_estimado_brl) FILTER (WHERE i.ativo=1),0) as valor_total_brl, (SELECT COUNT(*) FROM (SELECT DISTINCT ON (item_id) item_id, tipo FROM inventario_movimentacoes ORDER BY item_id, criado_em DESC) t WHERE t.tipo='emprestimo') as emprestados FROM inventario_itens i")
  ]);
  res.render('pages/inventario', { config, usuario: req.session.usuario, itens: itens.rows, categorias: categorias.rows, stats: stats.rows[0], busca, categoria, estado, situacao, msg: req.flash('msg'), erro: req.flash('erro') });
});

router.post('/inventario', requireAuth, requirePermissao('inventario'), async (req, res) => {
  const { nome, descricao, categoria_id, estado, localizacao, valor_estimado, valor_estimado_brl, data_aquisicao, responsavel, observacoes, codigo_etiqueta } = req.body;
  const ano = new Date().getFullYear();
  const last = await query('SELECT codigo FROM inventario_itens WHERE codigo LIKE $1 ORDER BY codigo DESC LIMIT 1', ['LIG-' + ano + '-%']);
  let seq = 1;
  if (last.rows.length) { const p = last.rows[0].codigo.split('-'); seq = (parseInt(p[2]) || 0) + 1; }
  const codigo = 'LIG-' + ano + '-' + String(seq).padStart(3, '0');
  await query('INSERT INTO inventario_itens (codigo,nome,descricao,categoria_id,estado,localizacao,valor_estimado,valor_estimado_brl,data_aquisicao,responsavel,observacoes,codigo_etiqueta) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [codigo, nome, descricao || null, categoria_id || null, estado || 'otimo', localizacao || null, valor_estimado || null, valor_estimado_brl || null, data_aquisicao || null, responsavel || null, observacoes || null, codigo_etiqueta || null]);
  req.flash('msg', 'Item ' + codigo + ' cadastrado com sucesso!');
  res.redirect('/inventario');
});

router.post('/inventario/:id/editar', requireAuth, requirePermissao('inventario'), async (req, res) => {
  const { nome, descricao, categoria_id, estado, localizacao, valor_estimado, valor_estimado_brl, data_aquisicao, responsavel, observacoes, codigo_etiqueta } = req.body;
  await query('UPDATE inventario_itens SET nome=$1,descricao=$2,categoria_id=$3,estado=$4,localizacao=$5,valor_estimado=$6,valor_estimado_brl=$7,data_aquisicao=$8,responsavel=$9,observacoes=$10,codigo_etiqueta=$11,atualizado_em=NOW() WHERE id=$12',
    [nome, descricao || null, categoria_id || null, estado, localizacao || null, valor_estimado || null, valor_estimado_brl || null, data_aquisicao || null, responsavel || null, observacoes || null, codigo_etiqueta || null, req.params.id]);
  req.flash('msg', 'Item atualizado com sucesso!');
  res.redirect('/inventario');
});

router.post('/inventario/:id/movimentacao', requireAuth, requirePermissao('inventario'), async (req, res) => {
  const { tipo, descricao, responsavel, data_mov } = req.body;
  await query('INSERT INTO inventario_movimentacoes (item_id,tipo,descricao,responsavel,data_mov) VALUES ($1,$2,$3,$4,$5)',
    [req.params.id, tipo, descricao || null, responsavel || null, data_mov || null]);
  req.flash('msg', 'Movimentação registrada!');
  res.redirect('/inventario');
});

router.post('/inventario/:id/desativar', requireAuth, requirePermissao('inventario'), async (req, res) => {
  await query('UPDATE inventario_itens SET ativo=0 WHERE id=$1', [req.params.id]);
  req.flash('msg', 'Item removido do inventário.');
  res.redirect('/inventario');
});

router.get('/inventario/:id/dados', requireAuth, requirePermissao('inventario'), async (req, res) => {
  const [item, hist, cats] = await Promise.all([
    query('SELECT i.*, c.nome as categoria_nome FROM inventario_itens i LEFT JOIN inventario_categorias c ON c.id=i.categoria_id WHERE i.id=$1', [req.params.id]),
    query('SELECT * FROM inventario_movimentacoes WHERE item_id=$1 ORDER BY criado_em DESC LIMIT 30', [req.params.id]),
    query('SELECT * FROM inventario_categorias ORDER BY nome')
  ]);
  if (!item.rows.length) return res.json({ erro: 'Nao encontrado' });
  res.json({ item: item.rows[0], historico: hist.rows, categorias: cats.rows });
});

};
