const { query } = require('../models/database');

async function logAtividade(usuarioId, acao, detalhes, req) {
  try {
    const ip = req ? (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '') : '';
    const userAgent = req ? (req.headers['user-agent'] || '') : '';
    await query(
      'INSERT INTO log_atividades (usuario_id, acao, detalhes, ip, user_agent) VALUES ($1,$2,$3,$4,$5)',
      [usuarioId, acao, detalhes, ip.substring(0,50), userAgent.substring(0,200)]
    );
  } catch(e) { /* silencioso */ }
}

module.exports = { logAtividade };
