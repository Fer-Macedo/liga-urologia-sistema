// ═══ ARQUIVOS ═══════════════════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requireAdmin, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');

module.exports = function (router) {


router.get('/arquivos', requireAuth, requirePermissao('arquivos'), async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];
  const pastaId = req.query.pasta || null;
  const lixeiraMode = req.query.lixeira === '1';
  const [pastasR, arquivosR, lixeiraR] = await Promise.all([
    query('SELECT * FROM arquivo_pastas WHERE lixeira=0 OR lixeira IS NULL ORDER BY nome'),
    lixeiraMode ? query('SELECT * FROM arquivos WHERE lixeira=1 ORDER BY criado_em DESC') : pastaId ? query('SELECT * FROM arquivos WHERE pasta_id=$1 AND (lixeira=0 OR lixeira IS NULL) ORDER BY nome_original', [pastaId]) : query('SELECT * FROM arquivos WHERE pasta_id IS NULL AND (lixeira=0 OR lixeira IS NULL) ORDER BY nome_original'),
    query('SELECT COUNT(*) n FROM arquivos WHERE lixeira=1')
  ]);
  const todasPastas = pastasR.rows;
  let pastaAtual = pastaId ? todasPastas.find(p => p.id == pastaId) || null : null;
  const arquivos = arquivosR.rows.map(a => {
    const kb = (a.tamanho || 0) / 1024;
    a.tamanho_fmt = kb < 1024 ? kb.toFixed(0) + ' KB' : (kb/1024).toFixed(1) + ' MB';
    const ext = (a.nome_original || '').split('.').pop().toLowerCase();
    const icons = { pdf:'', doc:'', docx:'', xls:'', xlsx:'', ppt:'', pptx:'', jpg:'', jpeg:'', png:'', gif:'', mp4:'', mp3:'', zip:'', rar:'' };
    a.icone = a.tipo === 'google' ? '' : (icons[ext] || '');
    return a;
  });
  res.render('pages/arquivos', { config, usuario: req.session.usuario, msg, erro, todasPastas, pastas: todasPastas, pastaAtual, arquivos, lixeiraMode, lixeiraCount: parseInt(lixeiraR.rows[0].n) });
});

router.post('/arquivos/google', requireAuth, async (req, res) => {
  const { nome, google_url, pasta_id } = req.body;
  const pid = pasta_id && pasta_id !== '' ? pasta_id : null;
  let embed = google_url;
  if (google_url && google_url.includes('docs.google.com')) embed = google_url.replace(/\/edit.*$/, '/edit?embedded=true&rm=minimal');
  else if (google_url && google_url.includes('drive.google.com/file')) { const m = google_url.match(/\/d\/([^/]+)/); if (m) embed = 'https://drive.google.com/file/d/' + m[1] + '/preview'; }
  await query('INSERT INTO arquivos (nome_original, tipo, google_url, google_embed, pasta_id, enviado_por) VALUES ($1,$2,$3,$4,$5,$6)', [nome, 'google', google_url, embed, pid, req.session.usuario.id]);
  req.session.msg = ['Link Google adicionado!'];
  res.redirect('/arquivos' + (pid ? '?pasta=' + pid : ''));
});

router.post('/arquivos/:id/renomear', requireAuth, async (req, res) => {
  await query('UPDATE arquivos SET nome_original=$1 WHERE id=$2', [req.body.nome, req.params.id]);
  res.json({ ok: true });
});

router.post('/arquivos/:id/mover', requireAuth, async (req, res) => {
  await query('UPDATE arquivos SET pasta_id=$1 WHERE id=$2', [req.body.pasta_id||null, req.params.id]);
  res.json({ ok: true });
});

router.post('/arquivos/pasta/:id/mover', requireAuth, async (req, res) => {
  await query('UPDATE arquivo_pastas SET pasta_pai_id=$1 WHERE id=$2', [req.body.pasta_pai_id||null, req.params.id]);
  res.json({ ok: true });
});

router.post('/arquivos/:id/lixeira', requireAuth, async (req, res) => { await query('UPDATE arquivos SET lixeira=1 WHERE id=$1', [req.params.id]); res.json({ ok: true }); });
router.post('/arquivos/:id/restaurar', requireAuth, async (req, res) => { await query('UPDATE arquivos SET lixeira=0 WHERE id=$1', [req.params.id]); res.json({ ok: true }); });
router.post('/arquivos/lixeira/esvaziar', requireAuth, requireAdmin, async (req, res) => { await query('DELETE FROM arquivos WHERE lixeira=1'); res.json({ ok: true }); });
router.post('/arquivos/pasta/:id/lixeira', requireAuth, async (req, res) => { await query('UPDATE arquivo_pastas SET lixeira=1 WHERE id=$1', [req.params.id]); res.json({ ok: true }); });

router.post('/arquivos/pasta/:id/editar', requireAuth, async (req, res) => {
  const { nome, icone, cor } = req.body;
  await query('UPDATE arquivo_pastas SET nome=$1, icone=$2, cor=$3 WHERE id=$4', [nome, icone||'', cor||null, req.params.id]);
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
    const { gerarUrlInline } = require("../services/arquivos");
    res.redirect(await gerarUrlInline(a.chave_r2, a.mimetype));
  } catch(e) { res.status(500).send("Erro: " + e.message); }
});

router.get("/arquivos/:id/download", requireAuth, async (req, res) => {
  try {
    const r = await query("SELECT * FROM arquivos WHERE id=$1", [req.params.id]);
    const a = r.rows[0];
    if (!a || !a.chave_r2) return res.status(404).send("Nao encontrado");
    const { gerarUrlDownload } = require("../services/arquivos");
    res.redirect(await gerarUrlDownload(a.chave_r2, a.nome_original || "arquivo"));
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
      await query("UPDATE arquivos SET chave_r2=$1,mimetype=$2,tamanho=$3,nome_original=$4 WHERE id=$5", [r.chave, req.file.mimetype, req.file.size, req.file.originalname, req.params.id]);
      req.session.msg = ["Substituido!"]; res.redirect("/arquivos");
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
      await query("INSERT INTO arquivos (nome_original,chave_r2,mimetype,tamanho,pasta_id,enviado_por,ativo) VALUES ($1,$2,$3,$4,$5,$6,1)", [req.file.originalname, r.chave, req.file.mimetype, req.file.size, pid||null, req.session.usuario.id]);
      res.json({ ok: true });
    });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

router.get("/google/auth", requireAuth, requireAdmin, (req, res) => {
  const { getAuthUrl } = require("../services/google-drive");
  res.redirect(getAuthUrl());
});

router.get("/google/callback", requireAuth, async (req, res) => {
  try {
    const { getTokens } = require("../services/google-drive");
    const tokens = await getTokens(req.query.code);
    await query("INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2", ["google_tokens", JSON.stringify(tokens)]);
    req.session.msg = ["Google Drive conectado com sucesso!"];
    res.redirect("/configuracoes");
  } catch(e) { req.session.erro = ["Erro ao conectar Google Drive: " + e.message]; res.redirect("/configuracoes"); }
});

router.post("/arquivos/upload-drive", requireAuth, async (req, res) => {
  try {
    const { upload } = require("../services/arquivos");
    const { uploadParaDrive } = require("../services/google-drive");
    upload.single("arquivo")(req, res, async (err) => {
      if (!req.file) return res.status(400).json({ erro: "Sem arquivo" });
      const tokensR = await query("SELECT valor FROM configuracoes WHERE chave='google_tokens'");
      if (!tokensR.rows[0]) return res.status(400).json({ erro: "Google Drive nao conectado. Va em Configuracoes e conecte." });
      const tokens = JSON.parse(tokensR.rows[0].valor);
      const pasta_id = req.body.pasta_id || null;
      const result = await uploadParaDrive(tokens, req.file.buffer, req.file.originalname, req.file.mimetype);
      await query("INSERT INTO arquivos (nome_original, tipo, google_url, google_embed, pasta_id, enviado_por, ativo) VALUES ($1,$2,$3,$4,$5,$6,1)", [req.file.originalname, "google", result.webViewLink, result.embedUrl, pasta_id||null, req.session.usuario.id]);
      res.json({ ok: true, embedUrl: result.embedUrl });
    });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

router.get("/arquivos/:id/url", requireAuth, async (req, res) => {
  try {
    const r = await query("SELECT chave_r2 FROM arquivos WHERE id=$1", [req.params.id]);
    const a = r.rows[0];
    if (!a || !a.chave_r2) return res.status(404).json({ erro: "Nao encontrado" });
    const { getUrlAssinada } = require("../services/desligamento");
    res.json({ url: await getUrlAssinada(a.chave_r2) });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});


};
