// Integracao com a Canva Connect API (OAuth 2.0 + PKCE) - usada na aba de Marketing
// para conectar a conta Canva da Liga e listar/gerar designs.
const axios = require('axios');
const crypto = require('crypto');
const { query } = require('../models/database');

const AUTH_URL = 'https://www.canva.com/api/oauth/authorize';
const TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token';
const SCOPES = ['design:content:read', 'design:content:write', 'design:meta:read', 'asset:read', 'brandtemplate:content:read', 'brandtemplate:meta:read'];

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function gerarPkce() {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function montarUrlAutorizacao({ challenge, state, redirectUri }) {
  const params = new URLSearchParams({
    code_challenge_method: 'S256',
    response_type: 'code',
    client_id: process.env.CANVA_CLIENT_ID,
    scope: SCOPES.join(' '),
    code_challenge: challenge,
    redirect_uri: redirectUri,
    state
  });
  return AUTH_URL + '?' + params.toString();
}

async function trocarCodigoPorToken({ code, verifier, redirectUri }) {
  const resp = await axios.post(TOKEN_URL, new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri
  }), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(process.env.CANVA_CLIENT_ID + ':' + process.env.CANVA_CLIENT_SECRET).toString('base64')
    }
  });
  await salvarTokens(resp.data);
  return resp.data;
}

async function salvarTokens(dados) {
  const expiraEm = new Date(Date.now() + (dados.expires_in || 3600) * 1000).toISOString();
  const pares = [
    ['canva_access_token', dados.access_token],
    ['canva_refresh_token', dados.refresh_token],
    ['canva_token_expira', expiraEm]
  ];
  for (const [chave, valor] of pares) {
    if (valor) await query('INSERT INTO marketing_config (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', [chave, valor]);
  }
}

// Guarda a renovação em andamento. O Canva rotaciona o refresh_token a cada uso e revoga a
// "lineage" INTEIRA se o mesmo refresh_token for usado 2x — então NUNCA renovar em paralelo.
// Se já há uma renovação rodando, todos os chamadores esperam a MESMA (sem disparar outra).
let _refreshCanvaEmAndamento = null;

async function getTokenValido() {
  const r = await query("SELECT chave,valor FROM marketing_config WHERE chave LIKE 'canva_%'");
  const cfg = {}; r.rows.forEach(row => cfg[row.chave] = row.valor);
  if (!cfg.canva_access_token) return null;
  const expira = cfg.canva_token_expira ? new Date(cfg.canva_token_expira) : null;
  if (expira && expira.getTime() - Date.now() < 60000 && cfg.canva_refresh_token) {
    // Serializa: só a primeira chamada renova; as outras aguardam o mesmo resultado.
    // (A checagem e a atribuição abaixo são síncronas — sem await entre elas — então no
    // event loop do Node não há como dois chamadores dispararem duas renovações.)
    if (!_refreshCanvaEmAndamento) {
      const refreshToken = cfg.canva_refresh_token;
      _refreshCanvaEmAndamento = (async () => {
        try {
          const resp = await axios.post(TOKEN_URL, new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
          }), {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: 'Basic ' + Buffer.from(process.env.CANVA_CLIENT_ID + ':' + process.env.CANVA_CLIENT_SECRET).toString('base64')
            }
          });
          await salvarTokens(resp.data);
          return resp.data.access_token;
        } catch(e) {
          const dados = e.response && e.response.data;
          console.error('Canva refresh token erro:', dados ? JSON.stringify(dados).substring(0,300) : e.message);
          // Token revogado/inválido: apaga os tokens mortos pra parar de tentar renovar e a
          // tela mostrar "desconectado" (pedindo reconexão), em vez de erro repetido.
          if (dados && dados.error === 'invalid_grant') {
            try { await query("DELETE FROM marketing_config WHERE chave IN ('canva_access_token','canva_refresh_token','canva_token_expira')"); } catch(_) {}
          }
          return null;
        } finally {
          _refreshCanvaEmAndamento = null;
        }
      })();
    }
    return _refreshCanvaEmAndamento;
  }
  return cfg.canva_access_token;
}

async function estaConectado() {
  const token = await getTokenValido();
  return !!token;
}

async function listarDesigns() {
  const token = await getTokenValido();
  if (!token) return { ok: false, erro: 'Canva nao conectado.' };
  try {
    const resp = await axios.get('https://api.canva.com/rest/v1/designs', {
      headers: { Authorization: 'Bearer ' + token }
    });
    return { ok: true, designs: resp.data.items || [] };
  } catch(e) {
    console.error('Canva listarDesigns erro:', e.response ? JSON.stringify(e.response.data).substring(0,300) : e.message);
    return { ok: false, erro: 'Nao foi possivel listar os designs do Canva.' };
  }
}

// Formatos disponiveis na tela de criacao - a API do Canva so aceita presets fixos
// (doc, email, presentation, whiteboard); qualquer formato de rede social precisa
// ser criado como design_type "custom" com largura/altura em pixels.
const FORMATOS = {
  InstagramPost: { width: 1080, height: 1080 },
  InstagramStory: { width: 1080, height: 1920 },
  InstagramReel: { width: 1080, height: 1920 },
  InstagramPortrait: { width: 1080, height: 1350 },
  FacebookPost: { width: 1200, height: 630 },
  FacebookCover: { width: 820, height: 312 },
  FacebookStory: { width: 1080, height: 1920 },
  TwitterPost: { width: 1600, height: 900 },
  YoutubeThumbnail: { width: 1280, height: 720 },
  YoutubeBanner: { width: 2560, height: 1440 },
  LinkedinPost: { width: 1200, height: 627 },
  WhatsappStatus: { width: 1080, height: 1920 },
  Poster: { width: 1080, height: 1350 },
  Flyer: { width: 1240, height: 1754 },
  Presentation: { preset: 'presentation' },
  Doc: { preset: 'doc' },
  Whiteboard: { preset: 'whiteboard' }
};

// Cria um novo design e devolve a URL de edicao no Canva. Para "Personalizado",
// passe custom={width,height} diretamente (ignora o mapa FORMATOS).
async function criarDesign(tipoNome, custom) {
  const token = await getTokenValido();
  if (!token) return { ok: false, erro: 'Canva nao conectado.' };
  const formato = (custom && custom.width && custom.height) ? custom : (FORMATOS[tipoNome] || FORMATOS.InstagramPost);
  const design_type = formato.preset
    ? { type: 'preset', name: formato.preset }
    : { type: 'custom', width: formato.width, height: formato.height };
  try {
    const resp = await axios.post('https://api.canva.com/rest/v1/designs', {
      design_type
    }, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
    const d = resp.data.design;
    return { ok: true, designId: d.id, editUrl: d.urls && d.urls.edit_url };
  } catch(e) {
    console.error('Canva criarDesign erro:', e.response ? JSON.stringify(e.response.data).substring(0,300) : e.message);
    return { ok: false, erro: 'Nao foi possivel criar o design no Canva.' };
  }
}

// Exporta um design como PNG e aguarda o job terminar (poll simples, ate ~20s)
async function exportarDesign(designId) {
  const token = await getTokenValido();
  if (!token) return { ok: false, erro: 'Canva nao conectado.' };
  try {
    const criar = await axios.post('https://api.canva.com/rest/v1/exports', {
      design_id: designId, format: { type: 'png' }
    }, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
    const jobId = criar.data.job.id;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const status = await axios.get('https://api.canva.com/rest/v1/exports/' + jobId, {
        headers: { Authorization: 'Bearer ' + token }
      });
      const job = status.data.job;
      if (job.status === 'success') return { ok: true, urls: job.urls || [] };
      if (job.status === 'failed') return { ok: false, erro: 'Exportacao falhou no Canva.' };
    }
    return { ok: false, erro: 'Exportacao demorou demais - tente novamente em instantes.' };
  } catch(e) {
    console.error('Canva exportarDesign erro:', e.response ? JSON.stringify(e.response.data).substring(0,300) : e.message);
    return { ok: false, erro: 'Nao foi possivel exportar o design do Canva.' };
  }
}

// Exporta um design e importa a imagem final direto para a biblioteca de midias do Marketing
async function importarDesignParaMidia(designId, nome) {
  const exportado = await exportarDesign(designId);
  if (!exportado.ok || !exportado.urls.length) return { ok: false, erro: exportado.erro || 'Sem arquivo exportado.' };
  const imgResp = await axios.get(exportado.urls[0], { responseType: 'arraybuffer' });
  const { uploadArquivo } = require('./arquivos');
  const r = await uploadArquivo(Buffer.from(imgResp.data), (nome || 'canva-design') + '.png', 'image/png', 'marketing');
  await query('INSERT INTO marketing_midias (nome, chave, tipo) VALUES ($1,$2,$3)', [nome || 'Design do Canva', r.chave, 'image/png']);
  return { ok: true };
}

async function desconectar() {
  await query("DELETE FROM marketing_config WHERE chave LIKE 'canva_%'");
}

module.exports = { gerarPkce, montarUrlAutorizacao, trocarCodigoPorToken, getTokenValido, estaConectado, listarDesigns, criarDesign, exportarDesign, importarDesignParaMidia, desconectar };
