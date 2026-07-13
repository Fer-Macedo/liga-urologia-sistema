// Configurações do sistema (tabela `configuracoes`, chave/valor).
// Extraído de routes/index.js para que os módulos de rota possam usá-lo sem
// depender do index (o que criaria dependência circular).
const { query } = require('../models/database');

async function getConfig() {
  const r = await query('SELECT chave, valor FROM configuracoes');
  const cfg = {};
  r.rows.forEach(row => { cfg[row.chave] = row.valor; });
  return cfg;
}

module.exports = { getConfig };
