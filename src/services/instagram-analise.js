// src/services/instagram-analise.js
// Análise de desempenho da conta do Instagram (@lauroucp.cde) via API oficial da Meta:
// resumo (seguidores, alcance, visitas, interações), série de crescimento, público
// (idade/gênero/cidade), melhores posts e recomendações por regra. Alimenta o painel da
// aba Marketing (GET /marketing/instagram/analise) e o relatório semanal por e-mail.
require('dotenv').config();
const axios = require('axios');

const IG_ID = process.env.INSTAGRAM_BUSINESS_ID;
const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const BASE = 'https://graph.instagram.com/v21.0';

const seg = ms => Math.floor(ms / 1000);
const somaSerie = s => s.reduce((a, b) => a + (b.valor || 0), 0);

// Chamada tolerante: uma métrica indisponível não pode derrubar o painel inteiro.
async function igData(path, params) {
  try {
    const r = await axios.get(`${BASE}${path}`, { params: { ...params, access_token: TOKEN } });
    return r.data.data || [];
  } catch (e) { return []; }
}

// Série diária de uma métrica (reach, follower_count) no intervalo [sinceMs, untilMs].
async function serieDiaria(metric, sinceMs, untilMs) {
  const d = await igData(`/${IG_ID}/insights`, { metric, period: 'day', since: seg(sinceMs), until: seg(untilMs) });
  const m = d.find(x => x.name === metric);
  return (m && m.values) ? m.values.map(v => ({ data: (v.end_time || '').slice(0, 10), valor: v.value || 0 })) : [];
}

// Agregado (total_value) de uma métrica no intervalo.
async function totalValor(metric, sinceMs, untilMs) {
  const d = await igData(`/${IG_ID}/insights`, { metric, period: 'day', metric_type: 'total_value', since: seg(sinceMs), until: seg(untilMs) });
  const m = d.find(x => x.name === metric);
  return m && m.total_value ? (m.total_value.value || 0) : 0;
}

// Demografia dos seguidores por dimensão (age | gender | city).
async function demografia(breakdown) {
  const d = await igData(`/${IG_ID}/insights`, { metric: 'follower_demographics', period: 'lifetime', metric_type: 'total_value', breakdown });
  const bd = d[0] && d[0].total_value && d[0].total_value.breakdowns && d[0].total_value.breakdowns[0];
  const res = bd ? bd.results : [];
  return res.map(r => ({ chave: r.dimension_values[0], valor: r.value })).sort((a, b) => b.valor - a.valor);
}

async function perfil() {
  try {
    const r = await axios.get(`${BASE}/${IG_ID}`, { params: { fields: 'username,followers_count,follows_count,media_count', access_token: TOKEN } });
    return r.data;
  } catch (e) { return {}; }
}

async function midiasRecentes() {
  return igData(`/${IG_ID}/media`, {
    fields: 'id,caption,media_type,timestamp,like_count,comments_count,permalink,thumbnail_url,media_url',
    limit: 30
  });
}

// Recomendações por regra — grounded no que os dados dizem, sem chute e sem promessa de robô.
function recomendacoes({ perfil, novos7, interac7, midias }) {
  const recs = [];
  const agora = Date.now();
  const posts7 = midias.filter(m => (agora - new Date(m.timestamp).getTime()) < 7 * 86400 * 1000);
  const temReel = midias.slice(0, 12).some(m => m.media_type === 'VIDEO');

  if (posts7.length < 3) recs.push(`Frequência baixa: ${posts7.length} post(s) nos últimos 7 dias. O ideal é 3–5/semana para o alcance não cair.`);
  if (!temReel) recs.push('Sem Reels recentes. Reels são o formato que mais alcança quem ainda não te segue — priorize 1–2 por semana.');
  if (novos7 <= 0) recs.push('A conta não ganhou seguidores líquidos essa semana. Combine Reels com chamada para seguir na legenda e nos Stories.');
  else recs.push(`+${novos7} seguidores em 7 dias. Repita os formatos dos posts de maior alcance — o que funcionou, funciona de novo.`);

  const seguidores = perfil.followers_count || 0;
  if (seguidores > 0) {
    const taxa = (interac7 / seguidores) * 100;
    if (taxa < 1) recs.push(`Engajamento semanal baixo (~${taxa.toFixed(1)}% dos seguidores). Use enquetes nos Stories e CTAs na legenda ("salve", "marque um colega").`);
  }
  return recs;
}

async function analiseConta() {
  const agora = Date.now();
  const since28 = agora - 28 * 86400 * 1000;
  const since7 = agora - 7 * 86400 * 1000;

  const [p, serieSeg, serieAlc, visitas7, interac7, engaj7, idade, genero, cidade, midias] = await Promise.all([
    perfil(),
    serieDiaria('follower_count', since28, agora),
    serieDiaria('reach', since28, agora),
    totalValor('profile_views', since7, agora),
    totalValor('total_interactions', since7, agora),
    totalValor('accounts_engaged', since7, agora),
    demografia('age'),
    demografia('gender'),
    demografia('city'),
    midiasRecentes()
  ]);

  const novos7 = somaSerie(serieSeg.slice(-7));
  const novos28 = somaSerie(serieSeg);
  const alcance7 = somaSerie(serieAlc.slice(-7));
  const alcance28 = somaSerie(serieAlc);

  const topPosts = midias
    .map(m => ({
      permalink: m.permalink, tipo: m.media_type, thumb: m.thumbnail_url || m.media_url,
      legenda: (m.caption || '').replace(/\s+/g, ' ').slice(0, 90),
      likes: m.like_count || 0, comentarios: m.comments_count || 0,
      engaj: (m.like_count || 0) + (m.comments_count || 0)
    }))
    .sort((a, b) => b.engaj - a.engaj).slice(0, 5);

  const mapGenero = g => g === 'M' ? 'Masculino' : g === 'F' ? 'Feminino' : g === 'U' ? 'Não informado' : g;

  return {
    conta: { username: p.username, seguidores: p.followers_count, seguindo: p.follows_count, posts: p.media_count },
    resumo7d: { novosSeguidores: novos7, alcance: alcance7, visitas: visitas7, interacoes: interac7, engajados: engaj7 },
    resumo28d: { novosSeguidores: novos28, alcance: alcance28 },
    serieSeguidores: serieSeg,
    publico: { idade, genero: genero.map(g => ({ chave: mapGenero(g.chave), valor: g.valor })), cidades: cidade.slice(0, 6) },
    topPosts,
    recomendacoes: recomendacoes({ perfil: p, novos7, interac7, midias }),
    geradoEm: new Date().toISOString()
  };
}

// CLI: `node src/services/instagram-analise.js` roda a análise e imprime (útil pra testar).
if (require.main === module) {
  analiseConta().then(a => { console.log(JSON.stringify(a, null, 2)); process.exit(0); }).catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { analiseConta };
