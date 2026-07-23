const axios = require('axios');
const { query } = require('../models/database');

const IG_ID = process.env.INSTAGRAM_BUSINESS_ID;
const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const BASE = 'https://graph.instagram.com/v21.0';
// Espera entre as tentativas de publicacao. Configuravel so para o teste nao ficar 60s
// parado esperando relogio de verdade.
const ESPERA_RETENTATIVA_MS = Number(process.env.IG_RETRY_MS || 20000);
// Intervalo entre as consultas de "ja ficou pronto?". Tambem so e reduzido no teste.
const ESPERA_PROCESSAMENTO_MS = Number(process.env.IG_POLL_MS || 3000);

// O container criado por /media NAO fica pronto na hora: a Meta ainda baixa e processa a
// midia. Publicar antes disso devolve 9007 "The media is not ready for publishing".
// O story ja esperava; o carrossel NAO — e foi assim que o post de 22/07 morreu (7 slides
// demoram mais que os poucos segundos que davam certo por sorte antes).
// Uma funcao so, usada por todos, para a correcao nao viver em um lugar e faltar noutro.
async function esperarProcessar(containerId, oQue, tentativasMax = 20, intervaloMs = ESPERA_PROCESSAMENTO_MS) {
  let status = 'IN_PROGRESS';
  for (let i = 0; i < tentativasMax && status !== 'FINISHED'; i++) {
    await new Promise(r => setTimeout(r, intervaloMs));
    const check = await axios.get(`${BASE}/${containerId}`, {
      params: { fields: 'status_code', access_token: TOKEN }
    });
    status = check.data.status_code;
    if (status === 'ERROR') throw new Error('O Instagram recusou a midia do ' + oQue + ' (status ERROR)');
  }
  if (status !== 'FINISHED') throw new Error('O ' + oQue + ' nao ficou pronto a tempo (status ' + status + ')');
  return status;
}

// ─── PUBLICAR FOTO NO FEED ────────────────────────────────────────────────────
async function publicarFoto({ imageUrl, legenda }) {
  // 1. Criar container de mídia
  const container = await axios.post(`${BASE}/${IG_ID}/media`, {
    image_url: imageUrl,
    caption: legenda,
    access_token: TOKEN
  });
  const containerId = container.data.id;

  // Mesma espera do carrossel e do story: sem ela a Meta responde 9007.
  await esperarProcessar(containerId, 'post');

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

  // Aguarda o Instagram terminar de montar o carrossel — MESMA espera que o story ja
  // tinha. Sem ela o media_publish sai antes da hora e a Meta responde 9007 "The media
  // is not ready for publishing". Foi o que derrubou o carrossel de 22/07: publicar na
  // hora funciona quando o processamento e rapido (o de 19/07 passou por sorte) e falha
  // quando demora. Quanto mais slides, mais demora — este tinha 7.
  await esperarProcessar(carousel.data.id, 'carrossel');

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

  await esperarProcessar(container.data.id, 'story');

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

  // Video demora bem mais que imagem: mais tentativas e intervalo maior.
  await esperarProcessar(container.data.id, 'reel', 30, ESPERA_PROCESSAMENTO_MS * 5 / 3);

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
// A URL assinada do R2 vale 24h. Um post agendado para daqui a uma semana publicaria
// com link expirado e a Meta nao conseguiria baixar a imagem. Por isso a URL e
// REGENERADA na hora da publicacao, a partir da chave do arquivo, que e permanente.
// Sem isso o agendamento so funcionava dentro de 24h.
// O axios resume tudo em "Request failed with status code 400" e joga fora o corpo da
// resposta — que e justamente onde a Meta explica o motivo. Com isso, o carrossel de
// 22/07 falhou e ficou impossivel saber por que: o log e o painel so tinham o numero.
// Aqui a gente extrai a mensagem real (error.message / error_user_msg) para gravar.
function motivoDaFalha(e) {
  const d = e && e.response && e.response.data;
  const err = d && (d.error || d);
  if (err && (err.message || err.error_user_msg)) {
    const partes = [err.error_user_msg || err.message];
    if (err.code) partes.push('codigo ' + err.code + (err.error_subcode ? '/' + err.error_subcode : ''));
    if (err.error_user_title) partes.unshift(err.error_user_title + ':');
    return partes.join(' — ').slice(0, 500);
  }
  if (d) return (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 500);
  return String((e && e.message) || e).slice(0, 500);
}

async function urlFresca(chave, urlAntiga, mime) {
  if (!chave) return urlAntiga;   // registros antigos, salvos antes de guardarmos a chave
  try {
    const { gerarUrlInline } = require('./arquivos');
    return await gerarUrlInline(chave, mime || 'image/png');
  } catch (e) {
    console.error('[INSTAGRAM] Falha ao regenerar URL de', chave, '-', e.message);
    return urlAntiga;
  }
}

// Avisa quem cuida do Instagram que uma publicacao agendada NAO saiu. Sem isso a falha e
// silenciosa: a data passa, o post fica marcado 'erro' no painel e ninguem fica sabendo.
async function avisarFalhaDePublicacao(post, motivo) {
  const { enviarEmail } = require('./notificacoes');
  const dest = await query(
    "SELECT DISTINCT email FROM usuarios WHERE ativo=1 AND email IS NOT NULL AND email <> '' AND perfil IN ('marketing','presidencia','admin')"
  );
  if (!dest.rows.length) { console.error('[INSTAGRAM] sem e-mail de marketing/admin — falha NAO avisada.'); return; }
  const quando = post.agendado_para ? new Date(post.agendado_para).toLocaleString('pt-BR', { timeZone: 'America/Asuncion' }) : '-';
  const trecho = String(post.legenda || '').slice(0, 120).replace(/[<>]/g, '');
  await enviarEmail({
    para: dest.rows.map(x => x.email).join(','),
    assunto: '⚠️ Publicação do Instagram não saiu',
    titulo: 'Publicação não saiu',
    faixaLabel: 'ALERTA',
    html: `<p>A publicação agendada para <strong>${quando}</strong> (${post.tipo}) <strong>não foi publicada</strong>.</p>
           <p><strong>Motivo informado pelo Instagram:</strong><br>${String(motivo).replace(/[<>]/g, '')}</p>
           <p style="color:#64748b;font-size:13px">Início da legenda: “${trecho}…”</p>
           <p>O conteúdo continua salvo no painel, em <strong>Marketing → Dashboard</strong>. Depois de resolver a causa, reagende por lá.</p>`
  });
  console.log('[INSTAGRAM] equipe avisada da falha do post', post.id);
}

// A publicacao ja esta no ar? Compara com o que a conta realmente tem, nao com o nosso
// banco. Serve de trava contra post duplicado quando a chamada anterior publicou mas a
// resposta se perdeu — sem isso, uma nova tentativa postaria a mesma arte duas vezes.
async function jaEstaNoInstagram(legenda) {
  const inicio = String(legenda || '').trim().slice(0, 60);
  if (inicio.length < 15) return false;   // legenda curta demais para servir de assinatura
  try {
    const recentes = await buscarMetricas();
    return recentes.some(m => String(m.caption || '').trim().slice(0, 60) === inicio);
  } catch (e) {
    // Nao deu para conferir: assume que NAO esta no ar. Repetir um post e chato; deixar
    // de publicar por causa de uma consulta que falhou e pior.
    console.error('[INSTAGRAM] nao consegui conferir duplicidade:', e.message);
    return false;
  }
}

async function processarPostsAgendados() {
  const r = await query(
    "SELECT * FROM instagram_posts WHERE status='agendado' AND agendado_para <= NOW()"
  );

  for (const post of r.rows) {
    // Ate 3 tentativas, com espera crescente. O carrossel de 22/07 morreu numa falha
    // PASSAGEIRA da Meta: o mesmo conteudo, mesmo token e mesmas imagens funcionaram
    // perfeitamente depois. Uma tentativa unica transforma soluco em post perdido.
    let ultimoMotivo = null;
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      if (tentativa > 1) {
        await new Promise(s => setTimeout(s, tentativa * ESPERA_RETENTATIVA_MS));   // 20s, depois 40s
        if (await jaEstaNoInstagram(post.legenda)) {
          await query("UPDATE instagram_posts SET status='publicado', publicado_em=NOW() WHERE id=$1", [post.id]);
          console.log('[INSTAGRAM] post', post.id, 'ja estava no ar — marcado como publicado, sem repetir.');
          ultimoMotivo = null;
          break;
        }
        console.warn('[INSTAGRAM] post', post.id, '— tentativa', tentativa, 'apos falha:', ultimoMotivo);
      }
      try {
        let resultado;

        if (post.tipo === 'feed') {
          const url = await urlFresca(post.midia_chave, post.midia_url);
          resultado = await publicarFoto({ imageUrl: url, legenda: post.legenda });
        } else if (post.tipo === 'carousel') {
          const urls = [];
          for (const m of post.midias) urls.push(await urlFresca(m.chave, m.url));
          resultado = await publicarCarrossel({ imageUrls: urls, legenda: post.legenda });
        } else if (post.tipo === 'story') {
          const url = await urlFresca(post.midia_chave, post.midia_url);
          resultado = await publicarStory({ imageUrl: url });
        } else if (post.tipo === 'reel') {
          const url = await urlFresca(post.midia_chave, post.midia_url, 'video/mp4');
          resultado = await publicarReel({ videoUrl: url, legenda: post.legenda });
        }

        await query(
          "UPDATE instagram_posts SET status='publicado', publicado_em=NOW(), instagram_media_id=$1 WHERE id=$2",
          [resultado.media_id, post.id]
        );
        console.log('[INSTAGRAM] Post publicado:', post.id, post.tipo, tentativa > 1 ? '(na tentativa ' + tentativa + ')' : '');
        ultimoMotivo = null;
        break;
      } catch(e) {
        ultimoMotivo = motivoDaFalha(e);
      }
    }

    if (ultimoMotivo) {
      await query(
        "UPDATE instagram_posts SET status='erro', erro_msg=$1 WHERE id=$2",
        ['apos 3 tentativas: ' + ultimoMotivo, post.id]
      );
      console.error('[INSTAGRAM] Erro ao publicar post:', post.id, ultimoMotivo);
      // Post agendado que falha calado nao e publicado por ninguem: a data passa e so se
      // descobre olhando o painel por acaso. Avisa a equipe na hora.
      await avisarFalhaDePublicacao(post, ultimoMotivo).catch(() => {});
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
        console.error('[INSTAGRAM] Erro post aniversário:', motivoDaFalha(e));
      }
    }
  }
}

// Aniversariantes (ligantes + diretivos) num dado dia MM-DD, ja com os campos
// necessarios para gerar a arte. Fonte unica usada pelo Story e pelo email da equipe.
async function aniversariantesDoDia(md) {
  const r = await query(
    `SELECT id, nome, cargo, sexo, NULL as semestre, COALESCE(foto_site_chave, foto_chave) as foto_chave, 'diretivo' as tipo
       FROM diretivos WHERE ativo=1 AND pendente=false AND data_nascimento IS NOT NULL AND TO_CHAR(data_nascimento::date,'MM-DD')=$1
     UNION ALL
     SELECT id, nome, NULL as cargo, NULL as sexo, semestre, COALESCE(foto_site_chave, foto_chave) as foto_chave, 'ligante' as tipo
       FROM ligantes WHERE ativo=1 AND pendente=false AND data_nascimento IS NOT NULL AND TO_CHAR(data_nascimento::date,'MM-DD')=$1`,
    [md]
  );
  return r.rows;
}

// Gera a arte de aniversario de uma pessoa. Regra do rotulo (Ligante x cargo do
// diretivo) mora AQUI, num lugar so, pra Story e email nunca divergirem.
async function gerarArteAniversarioPessoa(pessoa, templateBuffer) {
  const { baixarArquivoBuffer } = require('./arquivos');
  const { gerarArteAniversario, nomeCurto } = require('./aniversario-arte');
  const { rotuloAniversario } = require('./cargo-genero');
  const fotoBuffer = await baixarArquivoBuffer(pessoa.foto_chave);
  return gerarArteAniversario({ templateBuffer, fotoBuffer, nome: nomeCurto(pessoa.nome), cargo: rotuloAniversario(pessoa) });
}

// ─── AUTOMAÇÃO: STORY DE ANIVERSÁRIO DE LIGANTES/DIRETIVOS ───────────────────
async function postarStoriesAniversarioDoDia() {
  const cfg = await query("SELECT chave,valor FROM configuracoes WHERE chave IN ('aniversario_story_ativo','aniversario_template_chave')")
    .then(r => { const c = {}; r.rows.forEach(x => c[x.chave] = x.valor); return c; });
  if (cfg.aniversario_story_ativo !== '1' || !cfg.aniversario_template_chave) return;

  const dayjs = require('dayjs');
  const hoje = dayjs().format('MM-DD');
  const hojeData = dayjs().format('YYYY-MM-DD');

  const rows = await aniversariantesDoDia(hoje);
  if (!rows.length) return;

  const { baixarArquivoBuffer, uploadArquivo, gerarUrlInline } = require('./arquivos');
  const templateBuffer = await baixarArquivoBuffer(cfg.aniversario_template_chave);
  const puladosSemFoto = [];

  for (const pessoa of rows) {
    try {
      const jaPostou = await query(
        'SELECT id FROM aniversario_stories_postados WHERE pessoa_tipo=$1 AND pessoa_id=$2 AND data=$3',
        [pessoa.tipo, pessoa.id, hojeData]
      );
      if (jaPostou.rows.length > 0) continue;
      if (!pessoa.foto_chave) { puladosSemFoto.push(pessoa); continue; }

      const arteBuffer = await gerarArteAniversarioPessoa(pessoa, templateBuffer);

      const upload = await uploadArquivo(arteBuffer, `aniversario-${pessoa.tipo}-${pessoa.id}.jpg`, 'image/jpeg', 'aniversario-stories');
      const imageUrl = await gerarUrlInline(upload.chave, 'image/jpeg');

      await publicarStory({ imageUrl });
      await query(
        'INSERT INTO aniversario_stories_postados (pessoa_tipo, pessoa_id, data) VALUES ($1,$2,$3)',
        [pessoa.tipo, pessoa.id, hojeData]
      );
      console.log('[INSTAGRAM] Story de aniversário publicado:', pessoa.tipo, pessoa.nome);
    } catch (e) {
      console.error('[INSTAGRAM] Erro story aniversário:', pessoa.nome, motivoDaFalha(e));
    }
  }

  if (puladosSemFoto.length > 0) {
    try { await alertarAniversariantesSemFoto(puladosSemFoto); }
    catch (e) { console.error('[INSTAGRAM] Erro ao alertar equipe sobre foto faltando:', e.message); }
  }
}

// Avisa a equipe de marketing/presidencia/admin quando um aniversariante do dia
// nao teve o Story gerado por falta de foto cadastrada - sem isso, o story
// dessa pessoa simplesmente nao sai e ninguem fica sabendo.
// WhatsApp suspenso aqui (aviso interno, nao e a excecao de "assistente virtual"/
// "parabens ao aniversariante") ate segunda ordem — vai só por email.
async function alertarAniversariantesSemFoto(pessoas) {
  const destinatarios = await query(
    `SELECT DISTINCT u.email FROM usuarios u
     LEFT JOIN usuario_permissoes p ON p.usuario_id=u.id AND p.modulo='marketing'
     WHERE u.ativo=1 AND u.email IS NOT NULL AND u.email <> ''
       AND (u.perfil IN ('admin','presidencia','marketing') OR p.id IS NOT NULL)`
  );
  if (!destinatarios.rows.length) return;

  const nomes = pessoas.map(p => `• ${p.nome} (${p.tipo === 'diretivo' ? 'Diretivo' : 'Ligante'})`).join('\n');
  const assunto = 'Story de aniversário não publicado';
  const html = `<p>Essa(s) pessoa(s) faz(em) aniversário hoje, mas não têm foto cadastrada no perfil — o Story automático não foi gerado:</p><p>${nomes.replace(/\n/g, '<br>')}</p><p>Cadastre a foto e publique manualmente hoje; a automação não tenta novamente depois.</p>`;

  const { enviarEmail } = require('./notificacoes');
  for (const d of destinatarios.rows) {
    try { await enviarEmail({ para: d.email, assunto, html, titulo: assunto, faixaLabel: 'ANIVERSÁRIO' }); }
    catch (e) { console.error('[INSTAGRAM] Erro ao enviar alerta de foto faltando:', e.message); }
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
  postarStoriesAniversarioDoDia,
  aniversariantesDoDia,
  gerarArteAniversarioPessoa,
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
