const express = require('express');
const router = express.Router();
const axios = require('axios');

const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;
const REDIRECT_URI = process.env.META_REDIRECT_URI;

// Rota 1: Inicia o fluxo OAuth
router.get('/connect', (req, res) => {
  const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement&response_type=code`;
  res.redirect(url);
});

// Rota 2: Callback após autorização
router.get('/callback', async (req, res) => {
  const { code } = req.query;
  try {
    // Troca o code pelo token
    const tokenRes = await axios.get(`https://graph.facebook.com/v19.0/oauth/access_token`, {
      params: { client_id: APP_ID, client_secret: APP_SECRET, redirect_uri: REDIRECT_URI, code }
    });
    const accessToken = tokenRes.data.access_token;

    // Busca páginas do usuário
    const pagesRes = await axios.get(`https://graph.facebook.com/v19.0/me/accounts`, {
      params: { access_token: accessToken }
    });
    const page = pagesRes.data.data[0];
    const pageToken = page.access_token;
    const pageId = page.id;

    // Busca Instagram Business ID
    const igRes = await axios.get(`https://graph.facebook.com/v19.0/${pageId}`, {
      params: { fields: 'instagram_business_account', access_token: pageToken }
    });
    const igId = igRes.data.instagram_business_account?.id;

    res.send(`
      <h2>✅ Conectado com sucesso!</h2>
      <p><b>Page Access Token:</b><br><textarea rows="4" cols="80">${pageToken}</textarea></p>
      <p><b>Instagram Business ID:</b> ${igId}</p>
      <p>Copie esses valores e cole na aba Integrações do sistema LAURO.</p>
    `);
  } catch (err) {
    res.send(`<h2>❌ Erro:</h2><pre>${JSON.stringify(err.response?.data || err.message, null, 2)}</pre>`);
  }
});

module.exports = router;
