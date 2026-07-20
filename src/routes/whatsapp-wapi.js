// ═══ WEBHOOK DE ENTRADA DA W-API ══════════════════════════════════════════════
// É por aqui que chega quem escreve para o número do atendimento. O payload da W-API
// é diferente do da Meta — por isso este webhook é separado do /webhook/whatsapp-oficial.
//
// Reconstruído a partir da versão que rodava antes de 2026-07-15 (commit d5ce7d6^),
// com os mesmos filtros: mensagem própria, grupo, broadcast, duplicata e rajada.
const { processarMensagem } = require('../services/lauro');

// A W-API reentrega o webhook em caso de retry. Sem dedup por messageId, o assistente
// responde a mesma pergunta duas vezes.
const mensagensVistas = new Set();

// Freio ANTI-LOOP, não anti-pessoa: corta só rajada robótica do MESMO número em 1 minuto.
// Conversa humana normal nunca chega perto de 20 mensagens por minuto.
const numeroRate = new Map();
function numeroThrottle(numero) {
  const agora = Date.now();
  const arr = (numeroRate.get(numero) || []).filter(t => agora - t < 60000);
  arr.push(agora);
  numeroRate.set(numero, arr);
  if (numeroRate.size > 3000) numeroRate.clear();
  return arr.length <= 20;
}

// O número real do remetente. Contas novas do WhatsApp chegam com id no formato @lid,
// que NÃO é telefone — nesses casos o número verdadeiro vem em `sender`.
function extrairNumero(body) {
  const bruto = String(
    (body.sender && body.sender.id) || body.sender || body.phone || body.senderPhone || ''
  );
  return bruto.replace('@s.whatsapp.net', '').replace(/\D/g, '');
}

function extrairTexto(body) {
  const c = body.msgContent || {};
  return String(
    c.conversation ||
    (c.extendedTextMessage && c.extendedTextMessage.text) ||
    (c.imageMessage && c.imageMessage.caption) ||
    body.text || ''
  ).trim();
}

function extrairMidia(body) {
  if (body.image && (body.image.imageUrl || body.image.url))
    return { tipo: 'image', url: body.image.imageUrl || body.image.url, caption: body.image.caption || '' };
  if (body.document && (body.document.documentUrl || body.document.url))
    return { tipo: 'document', url: body.document.documentUrl || body.document.url, fileName: body.document.fileName || 'arquivo' };
  if (body.video && (body.video.videoUrl || body.video.url))
    return { tipo: 'video', url: body.video.videoUrl || body.video.url, caption: body.video.caption || '' };
  if (body.audio && (body.audio.audioUrl || body.audio.url))
    return { tipo: 'audio', url: body.audio.audioUrl || body.audio.url };
  return null;
}

// A URL que a W-API manda é temporária. Sem copiar para o R2, a mídia some da aba de
// atendimentos depois de algumas horas e ninguém mais consegue ver o que foi enviado.
async function persistirMidia(midia) {
  if (!midia || typeof midia.url !== 'string' || !midia.url.startsWith('http')) return;
  try {
    const axios = require('axios');
    const { uploadArquivo } = require('../services/arquivos');
    const resp = await axios.get(midia.url, { responseType: 'arraybuffer', timeout: 15000 });
    const mime = ((resp.headers['content-type'] || 'application/octet-stream').split(';')[0]).trim();
    const ext = midia.fileName
      ? (midia.fileName.split('.').pop() || 'bin')
      : (mime.split('/')[1] || 'bin').replace('jpeg', 'jpg');
    const r = await uploadArquivo(Buffer.from(resp.data), 'wapp-' + Date.now() + '.' + ext, mime, 'wapp-midias');
    midia.url = r.chave;
    console.log('[W-API] mídia salva no R2:', r.chave);
  } catch (e) {
    // URL temporária mantida: melhor a mídia expirar depois do que perder a mensagem agora.
    console.error('[W-API] falha ao salvar mídia (mantendo URL temporária):', e.message);
  }
}

module.exports = function (router) {

  router.post('/webhook/whatsapp', async (req, res) => {
    // Responder 200 sempre e o quanto antes: se a W-API não recebe 200 rápido, ela
    // reenvia o mesmo evento — e reentrega vira resposta duplicada.
    try {
      const body = req.body;
      if (!body || typeof body !== 'object') return res.sendStatus(200);

      // Se WAPI_WEBHOOK_SECRET estiver definido, exige ?secret= igual na URL cadastrada
      // no painel da W-API. Sem o env, não bloqueia nada (o webhook não carrega segredo
      // nenhum, mas sem isso qualquer um que descubra a URL injeta mensagem no assistente).
      if (process.env.WAPI_WEBHOOK_SECRET && req.query.secret !== process.env.WAPI_WEBHOOK_SECRET) {
        return res.sendStatus(200);
      }

      // Mensagem que o próprio número enviou: sem este filtro o assistente responde a
      // si mesmo e entra em laço infinito.
      if (body.fromMe || (body.key && body.key.fromMe)) return res.sendStatus(200);

      const rawId = String((body.sender && body.sender.id) || body.phone || body.senderPhone || '');
      if (body.isGroup || /@g\.us|@broadcast|status@broadcast|@newsletter/i.test(rawId)) {
        return res.sendStatus(200);
      }

      const msgId = String(
        body.messageId || (body.message && body.message.id) || (body.key && body.key.id) || body.id || ''
      );
      if (msgId) {
        if (mensagensVistas.has(msgId)) return res.sendStatus(200);
        mensagensVistas.add(msgId);
        if (mensagensVistas.size > 1000) mensagensVistas.clear();
      }

      const numero = extrairNumero(body);
      const texto = extrairTexto(body);
      const midia = extrairMidia(body);
      if (numero.length < 5 || (!texto && !midia)) return res.sendStatus(200);

      if (!numeroThrottle(numero)) {
        console.warn('[W-API] freio anti-loop (mensagens demais do mesmo número):', numero);
        return res.sendStatus(200);
      }

      console.log('[W-API] processando:', numero, '-', texto || ('[' + (midia && midia.tipo) + ']'));
      await persistirMidia(midia);

      // Sem await: a resposta do assistente pode levar segundos (chamada de IA) e a
      // W-API não pode ficar esperando o 200.
      processarMensagem(numero, texto, midia);
    } catch (e) {
      console.error('[W-API] erro no webhook:', e.message);
    }
    res.sendStatus(200);
  });

};
