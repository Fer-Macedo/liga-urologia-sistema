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
      const change = entrada && entrada.changes && entrada.changes[0];
      const valor = change && change.value;

      // Aprovação/rejeição de modelo de mensagem — avisa a equipe por e-mail,
      // pra não precisar ficar checando o painel manualmente.
      if (change && change.field === 'message_template_status_update' && valor) {
        console.log('[WHATSAPP OFICIAL] status de modelo:', valor.message_template_name, '->', valor.event);
        const { enviarEmail } = require('../services/notificacoes');
        const { query } = require('../models/database');
        (async () => {
          try {
            const dest = await query("SELECT DISTINCT email FROM usuarios WHERE ativo=1 AND email IS NOT NULL AND email <> '' AND perfil IN ('admin','presidencia')");
            const aprovado = valor.event === 'APPROVED';
            const assunto = (aprovado ? '✅ Modelo aprovado' : '⚠️ Modelo ' + valor.event) + ' — ' + valor.message_template_name;
            const html = '<p>O modelo de WhatsApp <strong>' + valor.message_template_name + '</strong> (' + (valor.message_template_language || '') + ') mudou de status:</p>'
              + '<p style="font-size:18px"><strong>' + valor.event + '</strong></p>'
              + (valor.reason ? '<p>Motivo: ' + valor.reason + '</p>' : '')
              + (aprovado ? '<p>Já pode ser usado — o sistema já está configurado pra usá-lo automaticamente.</p>' : '<p>Verifique o texto do modelo no WhatsApp Manager e ajuste se necessário.</p>');
            for (const d of dest.rows) {
              await enviarEmail({ para: d.email, assunto, html, faixaLabel: 'WHATSAPP — MODELO DE MENSAGEM' });
            }
          } catch (e) { console.error('[WHATSAPP OFICIAL] erro ao notificar status de modelo:', e.message); }
        })();
        return res.sendStatus(200);
      }

      // Recibos de status das mensagens que ENVIAMOS (sent -> delivered -> read, ou failed).
      // Atualiza a coluna 'entrega' do notificacoes_log casando pelo wamid. Só avança pra frente
      // (um 'delivered' atrasado não sobrescreve um 'read' que já chegou).
      const statuses = valor && valor.statuses;
      if (statuses && statuses.length) {
        const { query } = require('../models/database');
        const rank = { sent: 1, delivered: 2, read: 3, failed: 2 };
        (async () => {
          for (const st of statuses) {
            try {
              await query(
                `UPDATE notificacoes_log SET entrega=$1, entrega_em=to_timestamp($2)
                 WHERE wamid=$3
                   AND (CASE entrega WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 WHEN 'failed' THEN 2 WHEN 'sent' THEN 1 ELSE 0 END) < $4`,
                [st.status, Number(st.timestamp) || null, st.id, rank[st.status] || 0]
              );
            } catch (e) { console.error('[WHATSAPP OFICIAL] erro status de entrega:', e.message); }
          }
        })();
        return res.sendStatus(200);
      }

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
          const { processarMensagem } = require('../services/lauro');
          processarMensagem(numero, texto, null);
        } else {
          console.warn('[WHATSAPP OFICIAL] Tipo de mensagem ainda não suportado neste canal:', mensagem.type);
        }
      }
    } catch (e) { console.error('[WHATSAPP OFICIAL] erro no webhook:', e.message); }
    res.sendStatus(200);
  });

};
