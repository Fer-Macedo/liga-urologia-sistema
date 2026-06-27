const axios = require('axios');
const { query } = require('../models/database');

const IG_ID = process.env.INSTAGRAM_BUSINESS_ID;
const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const BASE = 'https://graph.instagram.com/v21.0';

// ─── PUBLICAR FOTO NO FEED ────────────────────────────────────────────────────
async function publicarFoto({ imageUrl, legenda }) {
  // 1. Criar container de mídia
  const container = await axios.post(`${BASE}/${IG_ID}/media`, {
    image_url: imageUrl,
    caption: legenda,
    access_token: TOKEN
  });
  const containerId = container.data.id;

  // 2. Publicar
  const pub = await axios.post(`${BASE}/${IG_ID}/media_publish`, {
    creation_id: containerId,
    access_token: TOKEN
  });

  return { ok: true, media_id: pub.data.id };
}

// ─── PUBLICAR CARROSSEL ───────────────────────────────────────────────────────
async function publicarCarrossel({ imageUrls, legenda }) {
  // 1. Criar container para cada imagem
  const childIds = [];
  for (const url of imageUrls) {
    const r = await axios.post(`${BASE}/${IG_ID}/media`, {
      image_url: url,
      is_carousel_item: true,
      access_token: TOKEN
    });
    childIds.push(r.data.id);
  }

  // 2. Criar container do carrossel
  const carousel = await axios.post(`${BASE}/${IG_ID}/media`, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption: legenda,
    access_token: TOKEN
  });

  // 3. Publicar
  const pub = await axios.post(`${BASE}/${IG_ID}/media_publish`, {
    creation_id: carousel.data.id,
    access_token: TOKEN
  });

  return { ok: true, media_id: pub.data.id };
}

// ─── PUBLICAR STORY ───────────────────────────────────────────────────────────
async function publicarStory({ imageUrl }) {
  const container = await axios.post(`${BASE}/${IG_ID}/media`, {
    image_url: imageUrl,
    media_type: 'STORIES',
    access_token: TOKEN
  });

  const pub = await axios.post(`${BASE}/${IG_ID}/media_publish`, {
    creation_id: container.data.id,
    access_token: TOKEN
  });

  return { ok: true, media_id: pub.data.id };
}

// ─── PUBLICAR REEL ────────────────────────────────────────────────────────────
async function publicarReel({ videoUrl, legenda }) {
  const container = await axios.post(`${BASE}/${IG_ID}/media`, {
    media_type: 'REELS',
    video_url: videoUrl,
    caption: legenda,
    access_token: TOKEN
  });

  // Aguarda processamento do vídeo
  let status = 'IN_PROGRESS';
  let tentativas = 0;
  while (status === 'IN_PROGRESS' && tentativas < 20) {
    await new Promise(r => setTimeout(r, 5000));
    const check = await axios.get(`${BASE}/${container.data.id}`, {
      params: { fields: 'status_code', access_token: TOKEN }
    });
    status = check.data.status_code;
    tentativas++;
  }

  if (status !== 'FINISHED') throw new Error('Processamento do vídeo falhou: ' + status);

  const pub = await axios.post(`${BASE}/${IG_ID}/media_publish`, {
    creation_id: container.data.id,
    access_token: TOKEN
  });

  return { ok: true, media_id: pub.data.id };
}

// ─── BUSCAR MÉTRICAS ──────────────────────────────────────────────────────────
async function buscarMetricas() {
  const r = await axios.get(`${BASE}/${IG_ID}/media`, {
    params: {
      fields: 'id,caption,media_type,timestamp,like_count,comments_count,thumbnail_url,media_url',
      limit: 20,
      access_token: TOKEN
    }
  });
  return r.data.data || [];
}

async function buscarInsights(mediaId) {
  try {
    const r = await axios.get(`${BASE}/${mediaId}/insights`, {
      params: {
        metric: 'impressions,reach,likes,comments,shares,saved',
        access_token: TOKEN
      }
    });
    return r.data.data || [];
  } catch(e) {
    return [];
  }
}

// ─── AGENDAR POST ─────────────────────────────────────────────────────────────
async function agendarPost({ tipo, midiaUrl, midias, legenda, agendadoPara, criadoPor }) {
  const r = await query(
    `INSERT INTO instagram_posts (tipo, midia_url, midias, legenda, agendado_para, criado_por, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'agendado') RETURNING id`,
    [tipo, midiaUrl || null, midias ? JSON.stringify(midias) : null, legenda, agendadoPara, criadoPor || null]
  );
  return r.rows[0].id;
}

// ─── PROCESSAR POSTS AGENDADOS ────────────────────────────────────────────────
async function processarPostsAgendados() {
  const r = await query(
    "SELECT * FROM instagram_posts WHERE status='agendado' AND agendado_para <= NOW()"
  );

  for (const post of r.rows) {
    try {
      let resultado;

      if (post.tipo === 'feed') {
        resultado = await publicarFoto({ imageUrl: post.midia_url, legenda: post.legenda });
      } else if (post.tipo === 'carousel') {
        const urls = post.midias.map(m => m.url);
        resultado = await publicarCarrossel({ imageUrls: urls, legenda: post.legenda });
      } else if (post.tipo === 'story') {
        resultado = await publicarStory({ imageUrl: post.midia_url });
      } else if (post.tipo === 'reel') {
        resultado = await publicarReel({ videoUrl: post.midia_url, legenda: post.legenda });
      }

      await query(
        "UPDATE instagram_posts SET status='publicado', publicado_em=NOW(), instagram_media_id=$1 WHERE id=$2",
        [resultado.media_id, post.id]
      );
      console.log('[INSTAGRAM] Post publicado:', post.id, post.tipo);
    } catch(e) {
      await query(
        "UPDATE instagram_posts SET status='erro', erro_msg=$1 WHERE id=$2",
        [e.message, post.id]
      );
      console.error('[INSTAGRAM] Erro ao publicar post:', post.id, e.message);
    }
  }
}

// ─── AUTOMAÇÃO: POST DE ANIVERSARIANTE ───────────────────────────────────────
async function postarAniversariantesDoDia() {
  const config = await query('SELECT chave,valor FROM configuracoes').then(r => {
    const c = {}; r.rows.forEach(x => c[x.chave] = x.valor); return c;
  });
  if (config.instagram_aniversario_ativo !== '1') return;

  const hoje = require('dayjs')().format('MM-DD');
  const r = await query(
    "SELECT * FROM membros WHERE ativo=1 AND data_nascimento IS NOT NULL AND TO_CHAR(data_nascimento::date,'MM-DD')=$1",
    [hoje]
  );

  for (const membro of r.rows) {
    const jaPostou = await query(
      "SELECT id FROM instagram_posts WHERE legenda LIKE $1 AND DATE(criado_em)=CURRENT_DATE AND status='publicado'",
      ['%' + membro.nome + '%']
    );
    if (jaPostou.rows.length > 0) continue;

    const legenda = `🎂 Feliz aniversário, ${membro.nome.split(' ')[0]}!\n\n` +
      `A Liga Acadêmica de Urologia — LAURO UCP CDE deseja a você um dia muito especial! 🎉\n\n` +
      `#LAURO #LigaAcademica #Urologia #UCP #Aniversario`;

    if (config.instagram_aniversario_imagem) {
      try {
        await publicarFoto({ imageUrl: config.instagram_aniversario_imagem, legenda });
        await query(
          "INSERT INTO instagram_posts (tipo, midia_url, legenda, status, publicado_em) VALUES ('feed', $1, $2, 'publicado', NOW())",
          [config.instagram_aniversario_imagem, legenda]
        );
        console.log('[INSTAGRAM] Post aniversário publicado:', membro.nome);
      } catch(e) {
        console.error('[INSTAGRAM] Erro post aniversário:', e.message);
      }
    }
  }
}

module.exports = {
  publicarFoto,
  publicarCarrossel,
  publicarStory,
  publicarReel,
  buscarMetricas,
  buscarInsights,
  agendarPost,
  processarPostsAgendados,
  postarAniversariantesDoDia,
  buscarFeedCompleto,
  buscarComentarios,
  responderComentario,
  buscarPerfil
};

// ─── BUSCAR FEED COMPLETO (posts feitos pelo celular também) ─────────────────
async function buscarFeedCompleto() {
  try {
    const r = await axios.get(`${BASE}/${IG_ID}/media`, {
      params: {
        fields: 'id,caption,media_type,timestamp,like_count,comments_count,thumbnail_url,media_url,permalink',
        limit: 30,
        access_token: TOKEN
      }
    });
    return r.data.data || [];
  } catch(e) { console.error('[IG] buscarFeed erro:', e.message); return []; }
}

// ─── BUSCAR COMENTÁRIOS DE UM POST ───────────────────────────────────────────
async function buscarComentarios(mediaId) {
  try {
    const r = await axios.get(`${BASE}/${mediaId}/comments`, {
      params: {
        fields: 'id,text,timestamp,username,replies{id,text,timestamp,username}',
        access_token: TOKEN
      }
    });
    return r.data.data || [];
  } catch(e) { return []; }
}

// ─── RESPONDER COMENTÁRIO ─────────────────────────────────────────────────────
async function responderComentario(mediaId, texto) {
  const r = await axios.post(`${BASE}/${mediaId}/replies`, {
    message: texto,
    access_token: TOKEN
  });
  return r.data;
}

// ─── BUSCAR INSIGHTS DA CONTA ─────────────────────────────────────────────────
async function buscarInsightsConta() {
  try {
    const r = await axios.get(`${BASE}/${IG_ID}/insights`, {
      params: {
        metric: 'impressions,reach,profile_views,follower_count',
        period: 'day',
        access_token: TOKEN
      }
    });
    return r.data.data || [];
  } catch(e) { return []; }
}

// ─── BUSCAR PERFIL ────────────────────────────────────────────────────────────
async function buscarPerfil() {
  try {
    const r = await axios.get(`${BASE}/${IG_ID}`, {
      params: {
        fields: 'id,name,username,biography,followers_count,follows_count,media_count,profile_picture_url,website',
        access_token: TOKEN
      }
    });
    return r.data;
  } catch(e) { return {}; }
}

module.exports.buscarFeedCompleto = buscarFeedCompleto;
module.exports.buscarComentarios = buscarComentarios;
module.exports.responderComentario = responderComentario;
module.exports.buscarInsightsConta = buscarInsightsConta;
module.exports.buscarPerfil = buscarPerfil;
