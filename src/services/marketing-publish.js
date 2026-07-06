// Publica um post de marketing (marketing_posts) nas redes marcadas - reaproveitado
// pela rota manual (/marketing/:id/publicar) e pelo cron de posts agendados.
const { query } = require('../models/database');

async function getMktConfig() {
  const r = await query('SELECT chave,valor FROM marketing_config');
  const cfg = {}; r.rows.forEach(row => cfg[row.chave] = row.valor); return cfg;
}

async function publicarPostMarketing(postId) {
  const r = await query('SELECT * FROM marketing_posts WHERE id=$1', [postId]);
  const post = r.rows[0];
  if (!post) return { ok: false, erro: 'Post não encontrado' };
  const mktConfig = await getMktConfig();
  const redes = post.redes || [];
  const erros = [];
  if (redes.includes('instagram') && mktConfig.instagram_token && mktConfig.instagram_id) {
    try {
      const axios = require('axios');
      const mediaRes = await axios.post(`https://graph.facebook.com/v18.0/${mktConfig.instagram_id}/media`, { caption: post.conteudo, access_token: mktConfig.instagram_token });
      await axios.post(`https://graph.facebook.com/v18.0/${mktConfig.instagram_id}/media_publish`, { creation_id: mediaRes.data.id, access_token: mktConfig.instagram_token });
    } catch(e) { erros.push('Instagram: ' + e.message); }
  }
  if (redes.includes('facebook') && mktConfig.facebook_token && mktConfig.facebook_id) {
    try {
      const axios = require('axios');
      await axios.post(`https://graph.facebook.com/v18.0/${mktConfig.facebook_id}/feed`, { message: post.conteudo, access_token: mktConfig.facebook_token });
    } catch(e) { erros.push('Facebook: ' + e.message); }
  }
  if (redes.includes('whatsapp')) {
    try {
      const { enviarWhatsApp } = require('./notificacoes');
      const pessoas = await query('SELECT whatsapp FROM ligantes WHERE ativo=1 AND whatsapp IS NOT NULL UNION SELECT whatsapp FROM diretivos WHERE ativo=1 AND whatsapp IS NOT NULL');
      for (const p of pessoas.rows) { if (p.whatsapp) await enviarWhatsApp(p.whatsapp, post.conteudo).catch(()=>{}); }
    } catch(e) { erros.push('WhatsApp: ' + e.message); }
  }
  await query('UPDATE marketing_posts SET status=$1, publicado_em=NOW() WHERE id=$2', [erros.length === 0 ? 'publicado' : 'erro', postId]);
  return { ok: erros.length === 0, erros };
}

async function processarPostsMarketingAgendados() {
  const r = await query("SELECT id FROM marketing_posts WHERE status='agendado' AND agendado_para<=NOW()");
  for (const row of r.rows) {
    try {
      const res = await publicarPostMarketing(row.id);
      console.log('[MARKETING] Post agendado publicado:', row.id, res.ok ? 'ok' : res.erros.join(', '));
    } catch(e) { console.error('[MARKETING] Erro ao publicar post agendado:', row.id, e.message); }
  }
}

module.exports = { publicarPostMarketing, processarPostsMarketingAgendados };
