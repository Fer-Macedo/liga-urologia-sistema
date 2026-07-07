// Integracao com a Canva Connect API (OAuth 2.0 + PKCE) - usada na aba de Marketing
// para conectar a conta Canva da Liga e listar/gerar designs.
const axios = require('axios');
const crypto = require('crypto');
const { query } = require('../models/database');

const AUTH_URL = 'https://www.canva.com/api/oauth/authorize';
const TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token';
const SCOPES = ['design:content:read', 'design:content:write', 'asset:read', 'brandtemplate:content:read', 'brandtemplate:meta:read'];

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

async function getTokenValido() {
  const r = await query("SELECT chave,valor FROM marketing_config WHERE chave LIKE 'canva_%'");
  const cfg = {}; r.rows.forEach(row => cfg[row.chave] = row.valor);
  if (!cfg.canva_access_token) return null;
  const expira = cfg.canva_token_expira ? new Date(cfg.canva_token_expira) : null;
  if (expira && expira.getTime() - Date.now() < 60000 && cfg.canva_refresh_token) {
    // Token perto de expirar - renova usando o refresh token
    try {
      const resp = await axios.post(TOKEN_URL, new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: cfg.canva_refresh_token
      }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(process.env.CANVA_CLIENT_ID + ':' + process.env.CANVA_CLIENT_SECRET).toString('base64')
        }
      });
      await salvarTokens(resp.data);
      return resp.data.access_token;
    } catch(e) {
      console.error('Canva refresh token erro:', e.response ? JSON.stringify(e.response.data).substring(0,300) : e.message);
      return null;
    }
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

async function desconectar() {
  await query("DELETE FROM marketing_config WHERE chave LIKE 'canva_%'");
}

module.exports = { gerarPkce, montarUrlAutorizacao, trocarCodigoPorToken, getTokenValido, estaConectado, listarDesigns, desconectar };
