// ═══ WHATSAPP OFICIAL (Meta Cloud API) ═══════════════════════════════════════
// Webhook que recebe mensagens/eventos da API oficial — formato de payload
// diferente do webhook antigo da W-API (index.js, /webhook/whatsapp).
// Ver memória "project_whatsapp_ban_causa_raiz" pro histórico da migração.
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
        console.log('[WHATSAPP OFICIAL] mensagem recebida:', mensagem.from, '-', mensagem.type === 'text' ? mensagem.text.body : ('[' + mensagem.type + ']'));
      }
    } catch (e) { console.error('[WHATSAPP OFICIAL] erro no webhook:', e.message); }
    res.sendStatus(200);
  });

};
