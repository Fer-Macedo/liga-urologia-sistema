// Integração com a API Oficial da Meta (WhatsApp Cloud API) — substitui a W-API
// (gateway não-oficial que causava banimento estrutural). Ver memória do projeto
// "project_whatsapp_ban_causa_raiz" pro histórico completo.
const axios = require('axios');
const FormData = require('form-data');

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

function limparNumero(numero) {
  return (numero || '').replace(/\D/g, '');
}

// Número BR com 9º dígito (55 + DDD 2 + 9 + 8 dígitos = 13). A Meta às vezes só entrega
// sem o 9 (base dela pode estar desatualizada pra alguns números) — gera a variante
// alternativa pra tentar em seguida, em vez de falhar direto.
function variantesBR(fone) {
  if (fone.startsWith('55') && fone.length === 13 && fone[4] === '9') {
    return [fone, fone.slice(0, 4) + fone.slice(5)];
  }
  if (fone.startsWith('55') && fone.length === 12) {
    return [fone, fone.slice(0, 4) + '9' + fone.slice(4)];
  }
  return [fone];
}

async function _post(payload) {
  const { data } = await axios.post(
    `${GRAPH_BASE}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    payload,
    { headers: { Authorization: 'Bearer ' + process.env.WHATSAPP_OFICIAL_TOKEN, 'Content-Type': 'application/json' }, timeout: 20000 }
  );
  return data;
}

async function _enviarComFallbackBR(numero, montarPayload) {
  const variantes = variantesBR(limparNumero(numero));
  let ultimoErro;
  for (const fone of variantes) {
    try {
      const payload = await montarPayload(fone);
      const data = await _post(payload);
      return { ok: true, data };
    } catch (e) {
      ultimoErro = e.response ? e.response.data : e.message;
    }
  }
  console.error('[WHATSAPP OFICIAL] erro envio:', JSON.stringify(ultimoErro));
  return { ok: false, erro: ultimoErro };
}

// Extrai bytes de uma data URI (data:mime;base64,....), ou baixa de uma URL http(s).
async function _prepararMidia(entrada, mimeTypePadrao) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(entrada || '');
  if (m) return { buffer: Buffer.from(m[2], 'base64'), mimeType: m[1] };
  const resp = await axios.get(entrada, { responseType: 'arraybuffer', timeout: 20000 });
  const mimeType = (resp.headers['content-type'] || mimeTypePadrao || 'application/octet-stream').split(';')[0];
  return { buffer: Buffer.from(resp.data), mimeType };
}

// Sobe a mídia pro servidor da Meta (obrigatório antes de referenciar num envio) e
// retorna o media id gerado.
async function _uploadMidia(buffer, mimeType) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', buffer, { filename: 'arquivo', contentType: mimeType });
  const { data } = await axios.post(
    `${GRAPH_BASE}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/media`,
    form,
    { headers: { Authorization: 'Bearer ' + process.env.WHATSAPP_OFICIAL_TOKEN, ...form.getHeaders() }, timeout: 30000 }
  );
  return data.id;
}

// Mensagem de modelo aprovado (proativa — cobrança, aniversário). Não depende de janela de 24h.
async function enviarTemplate(numero, templateName, idioma, componentes) {
  return _enviarComFallbackBR(numero, (fone) => ({
    messaging_product: 'whatsapp',
    to: fone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: idioma || 'pt_BR' },
      ...(componentes ? { components: componentes } : {})
    }
  }));
}

// Texto livre (resposta do assistente Lauro) — só entrega dentro da janela de 24h
// aberta quando o cliente manda mensagem primeiro.
async function enviarTexto(numero, mensagem) {
  return _enviarComFallbackBR(numero, (fone) => ({
    messaging_product: 'whatsapp',
    to: fone,
    type: 'text',
    text: { body: mensagem }
  }));
}

// Imagem/documento — aceita data URI (data:mime;base64,...) ou uma URL http(s) direta.
async function enviarImagem(numero, imagemOuUrl, legenda) {
  return _enviarComFallbackBR(numero, async (fone) => {
    const { buffer, mimeType } = await _prepararMidia(imagemOuUrl, 'image/jpeg');
    const mediaId = await _uploadMidia(buffer, mimeType);
    return { messaging_product: 'whatsapp', to: fone, type: 'image', image: { id: mediaId, caption: legenda || '' } };
  });
}

async function enviarDocumento(numero, documentoOuUrl, fileName) {
  return _enviarComFallbackBR(numero, async (fone) => {
    const { buffer, mimeType } = await _prepararMidia(documentoOuUrl, 'application/pdf');
    const mediaId = await _uploadMidia(buffer, mimeType);
    return { messaging_product: 'whatsapp', to: fone, type: 'document', document: { id: mediaId, filename: fileName || 'arquivo' } };
  });
}

module.exports = { enviarTemplate, enviarTexto, enviarImagem, enviarDocumento };
