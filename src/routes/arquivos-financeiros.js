// ═══ ARQUIVOS FINANCEIROS ═══════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');

module.exports = function (router) {

router.get('/financeiro-arquivos', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const pastaAtual = req.query.pasta || null;
  const [pastasR, arquivosR] = await Promise.all([
    query('SELECT * FROM financeiro_pastas ORDER BY nome'),
    query('SELECT * FROM financeiro_arquivos WHERE pasta_id' + (pastaAtual ? '=$1 ORDER BY criado_em DESC' : ' IS NULL ORDER BY criado_em DESC'), pastaAtual ? [pastaAtual] : [])
  ]);
  res.render('pages/financeiro-arquivos', { config, usuario: req.session.usuario, msg, erro, pastas: pastasR.rows, arquivos: arquivosR.rows, pastaAtual });
});

router.post('/financeiro-arquivos/pasta', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  const { nome, pai_id } = req.body;
  const pasta_id = pai_id && pai_id !== '' ? pai_id : null;
  await query('INSERT INTO financeiro_pastas (nome, pai_id, criado_por) VALUES ($1,$2,$3)', [nome, pasta_id, req.session.usuario.id]);
  req.session.msg = ['Pasta criada com sucesso!'];
  res.redirect(pasta_id ? '/financeiro-arquivos?pasta=' + pasta_id : '/financeiro-arquivos');
});

router.post('/financeiro-arquivos/upload', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.array('arquivos', 20)(req, res, async (err) => {
      if (!req.files || req.files.length===0) { req.session.erro=['Nenhum arquivo.']; return res.redirect('/financeiro-arquivos'); }
      const pasta_id = req.body.pasta_id && req.body.pasta_id !== '' ? req.body.pasta_id : null;
      for (const file of req.files) { const nome = req.body.nome || file.originalname; const r = await uploadArquivo(file.buffer, file.originalname, file.mimetype, 'financeiro'); await query('INSERT INTO financeiro_arquivos (nome,tipo,chave_r2,mimetype,tamanho,pasta_id,enviado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)', [nome, 'upload', r.chave, file.mimetype, file.size, pasta_id, req.session.usuario.id]); }
      req.session.msg = ['Arquivo enviado com sucesso!'];
      res.redirect('/financeiro-arquivos' + (pasta_id ? '?pasta='+pasta_id : ''));
    });
  } catch(e) { req.session.erro=['Erro: '+e.message]; res.redirect('/financeiro-arquivos'); }
});

router.post('/financeiro-arquivos/google', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  const { nome, google_url, google_tipo, pasta_id } = req.body;
  const pid = pasta_id && pasta_id !== '' ? pasta_id : null;
  let embed = google_url;
  if (google_url.includes('docs.google.com')) embed = google_url.replace(/\/edit.*$/, '/edit?embedded=true&rm=minimal');
  else if (google_url.includes('drive.google.com/file')) { const m = google_url.match(/\/d\/([^/]+)/); if (m) embed = 'https://drive.google.com/file/d/' + m[1] + '/preview'; }
  await query('INSERT INTO financeiro_arquivos (nome,tipo,google_url,google_embed,pasta_id,enviado_por) VALUES ($1,$2,$3,$4,$5,$6)', [nome, 'google', google_url, embed, pid, req.session.usuario.id]);
  req.session.msg = ['Link do Google adicionado!'];
  res.redirect('/financeiro-arquivos' + (pid ? '?pasta='+pid : ''));
});

router.get('/financeiro-arquivos/:id/visualizar', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  try {
    const r = await query('SELECT * FROM financeiro_arquivos WHERE id=$1', [req.params.id]);
    const a = r.rows[0];
    if (!a || !a.chave_r2) return res.status(404).send('Não encontrado');
    const { getUrlAssinada } = require('../services/desligamento');
    res.redirect(await getUrlAssinada(a.chave_r2));
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.get('/financeiro-arquivos/:id/download', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  try {
    const r = await query('SELECT * FROM financeiro_arquivos WHERE id=$1', [req.params.id]);
    const a = r.rows[0];
    if (!a || !a.chave_r2) return res.status(404).send('Não encontrado');
    const { getUrlAssinada } = require('../services/desligamento');
    res.redirect(await getUrlAssinada(a.chave_r2));
  } catch(e) { res.status(500).send('Erro'); }
});

router.post('/financeiro-arquivos/:id/deletar', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  const r = await query('SELECT pasta_id FROM financeiro_arquivos WHERE id=$1', [req.params.id]);
  const pid = r.rows[0]?.pasta_id;
  await query('DELETE FROM financeiro_arquivos WHERE id=$1', [req.params.id]);
  req.session.msg = ['Arquivo excluído!'];
  res.redirect('/financeiro-arquivos' + (pid ? '?pasta='+pid : ''));
});

router.post('/financeiro-pastas/:id/deletar', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  await query('DELETE FROM financeiro_arquivos WHERE pasta_id=$1', [req.params.id]);
  await query('DELETE FROM financeiro_pastas WHERE id=$1', [req.params.id]);
  req.session.msg = ['Pasta excluída!'];
  res.redirect('/financeiro-arquivos');
});

router.post('/financeiro-arquivos/deletar-multiplos', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  try {
    const ids = req.body.ids ? (Array.isArray(req.body.ids) ? req.body.ids : [req.body.ids]) : [];
    const pasta_id = req.body.pasta_id || null;
    for (const id of ids) { await query('DELETE FROM financeiro_arquivos WHERE id=$1', [id]); }
    req.session.msg = [ids.length + ' arquivo(s) excluído(s)!'];
    res.redirect('/financeiro-arquivos' + (pasta_id ? '?pasta=' + pasta_id : ''));
  } catch(e) { req.session.erro=['Erro: '+e.message]; res.redirect('/financeiro-arquivos'); }
});

router.post('/financeiro-arquivos/:id/mover', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  try { await query('UPDATE financeiro_arquivos SET pasta_id=$1 WHERE id=$2', [req.body.pasta_id||null, req.params.id]); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ erro: e.message }); }
});

router.post('/financeiro-pastas/:id/mover', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  try {
    const pai_id = req.body.pai_id || null;
    if (String(pai_id) === String(req.params.id)) return res.status(400).json({ erro: 'Não pode mover para si mesmo' });
    await query('UPDATE financeiro_pastas SET pai_id=$1 WHERE id=$2', [pai_id, req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

router.get('/financeiro-arquivos/:id/url', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  try {
    const r = await query('SELECT chave_r2 FROM financeiro_arquivos WHERE id=$1', [req.params.id]);
    const a = r.rows[0];
    if (!a || !a.chave_r2) return res.status(404).json({ erro: 'Nao encontrado' });
    const { getUrlAssinada } = require('../services/desligamento');
    res.json({ url: await getUrlAssinada(a.chave_r2) });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

};
