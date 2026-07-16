// ═══ WHATSAPP OFICIAL (Meta Cloud API) ═══════════════════════════════════════
// Webhook que recebe mensagens/eventos da API oficial — formato de payload
// diferente do webhook antigo da W-API (index.js, /webhook/whatsapp).
// Ver memória "project_whatsapp_ban_causa_raiz" pro histórico da migração.
// Dedup por messageId (a Meta reentrega webhook em retry) — evita o Lauro responder duplicado.
const mensagensVistas = new Set();
// Freio ANTI-LOOP (nao anti-pessoa), mesmo padrao do webhook antigo da W-API: so corta
// rajada robotica do MESMO numero em 1 min, conversa humana normal nunca chega perto.
const numeroRate = new Map();
function numeroThrottle(numero) {
  const agora = Date.now();
  const arr = (numeroRate.get(numero) || []).filter(t => agora - t < 60000);
  arr.push(agora);
  numeroRate.set(numero, arr);
  if (numeroRate.size > 3000) numeroRate.clear();
  return arr.length <= 20;
}

module.exports = function (router) {

  // Verificação do webhook — handshake exigido pela Meta ao configurar a URL no painel.
  router.get('/webhook/whatsapp-oficial', (req, res) => {
    const modo = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const desafio = req.query['hub.challenge'];
    if (modo === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(desafio);
    }
    res.sendStatus(403);
  });

  // Recebe mensagens/eventos de status da API oficial.
  router.post('/webhook/whatsapp-oficial', (req, res) => {
    try {
      const entrada = req.body.entry && req.body.entry[0];
      const valor = entrada && entrada.changes && entrada.changes[0] && entrada.changes[0].value;
      const mensagem = valor && valor.messages && valor.messages[0];
      if (mensagem) {
        const numero = mensagem.from;
        const texto = mensagem.type === 'text' ? mensagem.text.body : '';
        console.log('[WHATSAPP OFICIAL] mensagem recebida:', numero, '-', texto || ('[' + mensagem.type + ']'));

        if (mensagem.id) {
          if (mensagensVistas.has(mensagem.id)) return res.sendStatus(200);
          mensagensVistas.add(mensagem.id);
          if (mensagensVistas.size > 1000) mensagensVistas.clear();
        }
        if (!numeroThrottle(numero)) {
          console.warn('[WHATSAPP OFICIAL] Freio anti-loop (msgs demais do mesmo número):', numero);
          return res.sendStatus(200);
        }
        if (mensagem.type === 'text') {
          const { processarMensagemOficial } = require('../services/lauro');
          processarMensagemOficial(numero, texto, null);
        } else {
          console.warn('[WHATSAPP OFICIAL] Tipo de mensagem ainda não suportado neste canal:', mensagem.type);
        }
      }
    } catch (e) { console.error('[WHATSAPP OFICIAL] erro no webhook:', e.message); }
    res.sendStatus(200);
  });

};
