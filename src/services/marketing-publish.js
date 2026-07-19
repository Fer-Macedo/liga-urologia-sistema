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
  if (!post) return { ok: false, erros: ['Post não encontrado'] };
  const redes = post.redes || [];
  const erros = [];
  let publicou = 0;

  if (redes.includes('instagram')) {
    try {
      // Publica pelo MESMO serviço que já publica de verdade (Login do Instagram, token do
      // .env, graph.instagram.com). O código antigo montava a chamada à mão contra
      // graph.facebook.com usando marketing_config.instagram_token — token que a Meta
      // rejeita com "Cannot parse access token" — e ainda por cima sem image_url, que a
      // API exige num post de feed. Nunca poderia ter funcionado.
      if (!post.imagem_chave) throw new Error('o Instagram exige uma imagem no post');
      const { gerarUrlInline } = require('./arquivos');
      const imageUrl = await gerarUrlInline(post.imagem_chave, 'image/jpeg');
      const { publicarFoto } = require('./instagram');
      await publicarFoto({ imageUrl, legenda: post.conteudo });
      publicou++;
    } catch(e) { erros.push('Instagram: ' + (e.response?.data?.error?.message || e.message)); }
  }

  if (redes.includes('facebook')) {
    const cfg = await getMktConfig();
    if (!cfg.facebook_token || !cfg.facebook_id) {
      // Antes o if exigia as credenciais para entrar: sem elas o canal era pulado em
      // silêncio, nenhum erro entrava na lista e o post terminava marcado como publicado
      // sem ter ido a lugar nenhum. Agora falta de credencial é erro, não omissão.
      erros.push('Facebook: sem credencial cadastrada — nada foi publicado.');
    } else {
      try {
        const axios = require('axios');
        await axios.post(`https://graph.facebook.com/v21.0/${cfg.facebook_id}/feed`, { message: post.conteudo, access_token: cfg.facebook_token });
        publicou++;
      } catch(e) { erros.push('Facebook: ' + (e.response?.data?.error?.message || e.message)); }
    }
  }

  // ⛔ Canal WhatsApp DESATIVADO (decisão da presidência, 2026-07-19). O código anterior
  // varria ligantes + diretivos e disparava para TODOS, um a um, sem confirmação nem
  // intervalo — o padrão de envio em massa que derruba número por spam.
  if (redes.includes('whatsapp')) {
    erros.push('WhatsApp: canal desativado.');
    console.warn('[MARKETING] Campanha pediu WhatsApp, mas o canal está desativado.');
  }

  if (!redes.length) erros.push('Nenhum canal selecionado.');

  // Só vira "publicado" se algum canal publicou de fato.
  const status = publicou > 0 && erros.length === 0 ? 'publicado' : (publicou > 0 ? 'parcial' : 'erro');
  await query('UPDATE marketing_posts SET status=$1, publicado_em=NOW() WHERE id=$2', [status, postId]);
  if (erros.length) console.error('[MARKETING] Post', postId, '->', status, '|', erros.join(' | '));
  return { ok: publicou > 0 && erros.length === 0, erros, publicou };
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
