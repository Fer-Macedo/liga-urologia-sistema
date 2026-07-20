// ═══ W-API (api.w-api.app) ════════════════════════════════════════════════════
// Transporte do ASSISTENTE VIRTUAL e da aba /atendimentos — o número novo do Paraguai.
// Os disparos do sistema (cobrança, aniversário, avisos em massa) NÃO passam por aqui:
// vão pela API Oficial da Meta. Quem decide é o canal-assistente.js.
//
// Por que dois canais: a W-API é gateway não-oficial e já causou banimento quando era
// usada para disparo em massa. Como canal de ATENDIMENTO — respondendo a quem escreveu
// primeiro — o padrão de uso é o de um WhatsApp comum e não dispara os detectores.
//
// O formato abaixo foi recuperado do código que rodava antes de 2026-07-15 (commit
// d5ce7d6^), não inventado: mesmos endpoints, mesmo payload, mesmo header.
const axios = require('axios');

const BASE = 'https://api.w-api.app/v1/message';

function credenciais() {
  return { instancia: process.env.WAPI_INSTANCE_ID, token: process.env.WAPI_TOKEN };
}

function cabecalho(token) {
  return {
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    timeout: 30000
  };
}

// Sem credencial não dá para enviar. Devolver erro explícito (e não `ok:true`) é o que
// faz o canal-assistente cair para a API Oficial em vez de o membro ficar sem resposta.
function semCredencial() {
  console.error('[W-API] WAPI_INSTANCE_ID/WAPI_TOKEN ausentes — nada foi enviado.');
  return { ok: false, erro: 'W-API sem credenciais configuradas' };
}

async function _post(caminho, corpo, instancia, token) {
  const { data } = await axios.post(
    BASE + caminho + '?instanceId=' + instancia, corpo, cabecalho(token)
  );
  return data;
}

async function enviarTexto(numero, mensagem) {
  const { instancia, token } = credenciais();
  if (!instancia || !token) return semCredencial();
  try {
    // Pausa proporcional ao tamanho do texto (1,5s a 4s). Resposta instantânea é a
    // assinatura mais óbvia de robô — este atraso imita a digitação de uma pessoa.
    const espera = Math.min(Math.max(String(mensagem).length * 25, 1500), 4000);
    await new Promise(r => setTimeout(r, espera));
    const data = await _post('/send-text', {
      phone: String(numero).replace(/\D/g, ''), message: mensagem
    }, instancia, token);
    // Registrar o sucesso, e nao so o erro: sem esta linha nao ha como distinguir
    // "o sistema nao enviou" de "enviou e o WhatsApp nao entregou" — foi exatamente
    // essa cegueira que travou o diagnostico no primeiro dia do numero novo.
    console.log('[W-API] enviado para', numero, '— messageId', (data && data.messageId) || '?');
    return { ok: true, data };
  } catch (e) {
    const erro = e.response ? e.response.data : e.message;
    console.error('[W-API] erro envio texto:', JSON.stringify(erro));
    return { ok: false, erro };
  }
}

// Aceita data URI (a aba /atendimentos manda assim) ou URL http(s) — a W-API engole os dois.
async function enviarImagem(numero, imagem, legenda) {
  const { instancia, token } = credenciais();
  if (!instancia || !token) return semCredencial();
  try {
    const data = await _post('/send-image', {
      phone: String(numero).replace(/\D/g, ''), image: imagem, caption: legenda || ''
    }, instancia, token);
    return { ok: true, data };
  } catch (e) {
    const erro = e.response ? e.response.data : e.message;
    console.error('[W-API] erro envio imagem:', JSON.stringify(erro));
    return { ok: false, erro };
  }
}

async function enviarDocumento(numero, documento, fileName) {
  const { instancia, token } = credenciais();
  if (!instancia || !token) return semCredencial();
  try {
    const data = await _post('/send-document', {
      phone: String(numero).replace(/\D/g, ''), document: documento,
      fileName: fileName || 'arquivo.pdf'
    }, instancia, token);
    return { ok: true, data };
  } catch (e) {
    const erro = e.response ? e.response.data : e.message;
    console.error('[W-API] erro envio documento:', JSON.stringify(erro));
    return { ok: false, erro };
  }
}

// Usado pela tela de diagnóstico: diz se o celular ainda está pareado. A W-API cai quando
// o aparelho fica muito tempo sem internet, e sem esta checagem a queda só aparece quando
// alguém reclama que o assistente parou de responder.
async function statusInstancia() {
  const { instancia, token } = credenciais();
  if (!instancia || !token) return semCredencial();
  try {
    const { data } = await axios.get(
      'https://api.w-api.app/v1/instance/status-instance?instanceId=' + instancia,
      cabecalho(token)
    );
    return { ok: true, data };
  } catch (e) {
    const erro = e.response ? e.response.data : e.message;
    return { ok: false, erro };
  }
}

module.exports = { enviarTexto, enviarImagem, enviarDocumento, statusInstancia };
