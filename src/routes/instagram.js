// ═══ INSTAGRAM (OAuth + painel + API) ═══════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth } = require('../middleware/auth');

module.exports = function (router) {

// ─── INSTAGRAM OAUTH ──────────────────────────────────────────────────────────
router.get("/auth/instagram/connect", requireAuth, (req, res) => {
  const APP_ID = process.env.META_APP_ID;
  const REDIRECT_URI = process.env.META_REDIRECT_URI;
  const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=instagram_business_basic,instagram_business_content_publish&response_type=code`;
  res.redirect(url);
});

router.get("/auth/instagram/callback", async (req, res) => {
  const { code } = req.query;
  const APP_ID = process.env.META_APP_ID;
  const APP_SECRET = process.env.META_APP_SECRET;
  const REDIRECT_URI = process.env.META_REDIRECT_URI;
  try {
    const axios = require("axios");
    const tokenRes = await axios.get("https://graph.facebook.com/v19.0/oauth/access_token", {
      params: { client_id: APP_ID, client_secret: APP_SECRET, redirect_uri: REDIRECT_URI, code }
    });
    const accessToken = tokenRes.data.access_token;
    const pagesRes = await axios.get("https://graph.facebook.com/v19.0/me/accounts", {
      params: { access_token: accessToken }
    });
    const page = pagesRes.data.data[0];
    const pageToken = page.access_token;
    const pageId = page.id;
    const igRes = await axios.get(`https://graph.facebook.com/v19.0/${pageId}`, {
      params: { fields: "instagram_business_account", access_token: pageToken }
    });
    const igId = igRes.data.instagram_business_account?.id;
    res.send(`<h2>Conectado!</h2><p><b>Page Token:</b><br><textarea rows="4" cols="80">${pageToken}</textarea></p><p><b>Instagram ID:</b> ${igId}</p>`);
  } catch(err) {
    res.send("<h2>Erro</h2><pre>" + JSON.stringify(err.response?.data || err.message, null, 2) + "</pre>");
  }
});

// ─── INSTAGRAM ────────────────────────────────────────────────────────────────
const ig = require("../services/instagram");

router.get("/instagram", requireAuth, async (req, res) => {
  try {
    const posts = await query("SELECT * FROM instagram_posts ORDER BY criado_em DESC LIMIT 50");
    const config = await query("SELECT chave,valor FROM configuracoes WHERE chave LIKE 'instagram%'").then(r => { const c={}; r.rows.forEach(x=>c[x.chave]=x.valor); return c; });
    let feedPosts = [];
    try { feedPosts = await ig.buscarMetricas(); } catch(e) {}
    res.render("pages/instagram", { posts: posts.rows, config, feedPosts, ok: req.query.ok||null, erro: req.query.erro||null });
  } catch(e) { res.redirect("/dashboard?erro=Erro+ao+carregar+Instagram"); }
});

router.post("/instagram/publicar", requireAuth, async (req, res) => {
  const { tipo, midia_url, legenda, midias, agendar, agendado_para } = req.body;
  try {
    if (agendar === "1" && agendado_para) {
      await ig.agendarPost({ tipo, midiaUrl: midia_url, midias: midias ? JSON.parse(midias) : null, legenda, agendadoPara: agendado_para, criadoPor: req.session.userId||null });
      return res.redirect("/instagram?ok=Post+agendado+com+sucesso");
    }
    if (tipo === "feed") await ig.publicarFoto({ imageUrl: midia_url, legenda });
    else if (tipo === "carousel") { const urls = JSON.parse(midias).map(m=>m.url); await ig.publicarCarrossel({ imageUrls: urls, legenda }); }
    else if (tipo === "story") await ig.publicarStory({ imageUrl: midia_url });
    else if (tipo === "reel") await ig.publicarReel({ videoUrl: midia_url, legenda });
    await query("INSERT INTO instagram_posts (tipo,midia_url,midias,legenda,status,publicado_em) VALUES ($1,$2,$3,$4,'publicado',NOW())", [tipo, midia_url||null, midias||null, legenda||null]);
    res.redirect("/instagram?ok=Publicado+com+sucesso+no+Instagram");
  } catch(e) {
    res.redirect("/instagram?erro=" + encodeURIComponent(e.message));
  }
});

router.post("/instagram/agendar/:id/excluir", requireAuth, async (req, res) => {
  await query("DELETE FROM instagram_posts WHERE id=$1 AND status='agendado'", [req.params.id]);
  res.redirect("/instagram?ok=Post+agendado+excluido");
});

router.get("/instagram/metricas/:id", requireAuth, async (req, res) => {
  try {
    const insights = await ig.buscarInsights(req.params.id);
    res.json({ ok: true, insights });
  } catch(e) { res.json({ ok: false, erro: e.message }); }
});

router.post("/instagram/config", requireAuth, async (req, res) => {
  const { instagram_aniversario_ativo, instagram_aniversario_imagem } = req.body;
  await query("INSERT INTO configuracoes (chave,valor) VALUES ('instagram_aniversario_ativo',$1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [instagram_aniversario_ativo||'0']);
  await query("INSERT INTO configuracoes (chave,valor) VALUES ('instagram_aniversario_imagem',$1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [instagram_aniversario_imagem||'']);
  res.redirect("/instagram?ok=Configuracoes+salvas");
});
// ─── FIM INSTAGRAM ────────────────────────────────────────────────────────────

// ─── INSTAGRAM API ROUTES ─────────────────────────────────────────────────────
router.get("/api/instagram/feed", requireAuth, async (req, res) => {
  try { const ig = require("../services/instagram"); const feed = await ig.buscarFeedCompleto(); res.json({ ok: true, feed }); } catch(e) { res.json({ ok: false, erro: e.message }); }
});

router.get("/api/instagram/perfil", requireAuth, async (req, res) => {
  try { const ig = require("../services/instagram"); const perfil = await ig.buscarPerfil(); res.json({ ok: true, perfil }); } catch(e) { res.json({ ok: false, erro: e.message }); }
});

router.get("/api/instagram/comentarios/:mediaId", requireAuth, async (req, res) => {
  try { const ig = require("../services/instagram"); const comentarios = await ig.buscarComentarios(req.params.mediaId); res.json({ ok: true, comentarios }); } catch(e) { res.json({ ok: false, erro: e.message }); }
});

router.post("/api/instagram/comentarios/:mediaId/responder", requireAuth, async (req, res) => {
  try { const ig = require("../services/instagram"); const r = await ig.responderComentario(req.params.mediaId, req.body.texto); res.json({ ok: true, data: r }); } catch(e) { res.json({ ok: false, erro: e.message }); }
});

router.get("/api/instagram/insights/:mediaId", requireAuth, async (req, res) => {
  try { const ig = require("../services/instagram"); const insights = await ig.buscarInsights(req.params.mediaId); res.json({ ok: true, insights }); } catch(e) { res.json({ ok: false, erro: e.message }); }
});
// ─── FIM INSTAGRAM API ────────────────────────────────────────────────────────

};
