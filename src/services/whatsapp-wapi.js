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

// ─── RESOLUÇÃO DE NÚMERO ──────────────────────────────────────────────────────
// Número brasileiro tem duas grafias: com o nono dígito (55 + DD + 9 + 8) e sem ele
// (55 + DD + 8). Qual delas o WhatsApp usa depende da idade da conta — os contatos das
// áreas estão cadastrados com o nono dígito, mas a conta pode responder pela outra.
//
// Na API Oficial isso se resolve tentando as duas: grafia errada dá erro e o laço segue.
// Aqui NÃO dá: a W-API aceita qualquer número, devolve 200 com messageId e joga fora.
// Um fallback por tentativa e erro nunca chegaria na segunda opção — o primeiro envio
// "daria certo" e a mensagem sumiria. Por isso perguntamos ANTES.
//
// ponytail: cache simples. Os destinos são as ~7 áreas e os membros em atendimento;
// sem cache seria uma consulta a mais por mensagem enviada, para um dado que não muda.
const cacheNumero = new Map();

async function resolverNumero(numero, instancia, token) {
  const bruto = String(numero).replace(/\D/g, '');
  if (cacheNumero.has(bruto)) return cacheNumero.get(bruto);
  try {
    const { data } = await axios.get(
      'https://api.w-api.app/v1/contacts/phone-exists?instanceId=' + instancia + '&phoneNumber=' + bruto,
      cabecalho(token)
    );
    // exists:false = o número não tem WhatsApp. Devolver null faz o envio virar erro
    // visível, em vez de a mensagem sumir em silêncio — que é o estrago que queremos evitar.
    const resolvido = data && data.exists ? String(data.phoneNumber || bruto).replace(/\D/g, '') : null;
    cacheNumero.set(bruto, resolvido);
    if (resolvido && resolvido !== bruto) {
      console.log('[W-API] número', bruto, 'entregue como', resolvido, '(grafia do WhatsApp)');
    }
    return resolvido;
  } catch (e) {
    // A checagem é auxiliar: se ela falhar, seguimos com o número original em vez de
    // bloquear o atendimento por causa de um diagnóstico.
    console.error('[W-API] não consegui verificar o número', bruto, '—', e.message);
    return bruto;
  }
}

// Prepara o destino de um envio. Devolve null quando o número não existe no WhatsApp.
async function _destino(numero, instancia, token) {
  const fone = await resolverNumero(numero, instancia, token);
  if (!fone) console.error('[W-API] número sem WhatsApp, envio abortado:', String(numero).replace(/\D/g, ''));
  return fone;
}

// ─── ATRASO "HUMANO" ────────────────────────────────────────────────────────
// Antes era uma fórmula fixa (tamanho × 25ms, entre 1,5s-4s) — o MESMO atraso sempre pro
// mesmo texto, o que é uma assinatura de automação tão óbvia quanto responder instantâneo.
// Pessoa de verdade varia muito: às vezes responde na hora, às vezes demora, às vezes se
// distrai no meio da conversa. Aqui tem uma base aleatória, um componente por tamanho
// (também aleatório) e, de vez em quando, uma pausa bem mais longa.
function atrasoHumano(mensagem) {
  // Mesmo padrao do GMAIL_RETRY_MS (notificacoes.js): override total pra teste nao
  // esperar segundos de verdade por uma variacao aleatoria que nao muda o resultado.
  if (process.env.WAPI_ATRASO_TESTE_MS !== undefined) return Number(process.env.WAPI_ATRASO_TESTE_MS);
  const tam = String(mensagem || '').length;
  const base = 1200 + Math.random() * 2800; // 1,2s-4s
  const porTamanho = tam * (12 + Math.random() * 18); // 12-30ms por caractere
  const distraido = Math.random() < 0.12 ? 2500 + Math.random() * 5000 : 0; // ~1 em 8 vezes
  return Math.min(Math.round(base + porTamanho + distraido), 14000);
}

// ─── LIMITE DIÁRIO DE ENVIOS (proteção anti-banimento) ───────────────────────
// O número já foi restringido/banido 3 vezes (22/07, 25/07, 02/08) mesmo só respondendo
// quem escreveu primeiro — o WhatsApp parece aplicar escrutínio extra logo após
// reconectar. Um teto diário bem mais apertado nos primeiros dias pós-reconexão (e um
// teto normal depois disso) dá uma segunda camada de segurança, independente do
// conteúdo das mensagens. Não bloqueia em silêncio: quem excede o teto fica sem
// resposta automática, mas a mensagem continua salva em /atendimentos pra alguém
// responder na mão.
const WAPI_TETO_NORMAL = parseInt(process.env.WAPI_TETO_DIARIO || '60', 10);
const WAPI_TETO_AQUECIMENTO = parseInt(process.env.WAPI_TETO_DIARIO_AQUECIMENTO || '15', 10);
const WAPI_HORAS_AQUECIMENTO = parseInt(process.env.WAPI_HORAS_AQUECIMENTO || '72', 10);

async function tetoDeHoje() {
  try {
    const { query } = require('../models/database');
    const r = await query("SELECT valor FROM configuracoes WHERE chave='wapi_reconectado_em'");
    const reconectadoEm = r.rows[0] && r.rows[0].valor ? new Date(r.rows[0].valor) : null;
    if (reconectadoEm) {
      const horasDesde = (Date.now() - reconectadoEm.getTime()) / 3600000;
      if (horasDesde < WAPI_HORAS_AQUECIMENTO) return WAPI_TETO_AQUECIMENTO;
    }
  } catch (e) { /* sem dado de reconexão, segue com o teto normal */ }
  return WAPI_TETO_NORMAL;
}

async function podeEnviarHoje() {
  try {
    const { query } = require('../models/database');
    const teto = await tetoDeHoje();
    const r = await query(
      `INSERT INTO wapi_envios_diarios (dia, total) VALUES (CURRENT_DATE, 1)
       ON CONFLICT (dia) DO UPDATE SET total = wapi_envios_diarios.total + 1
       RETURNING total`
    );
    if (r.rows[0].total > teto) {
      console.warn('[W-API] teto diário de envios atingido (' + teto + ') — proteção anti-banimento, mensagem NÃO enviada (fica salva pra resposta manual)');
      return false;
    }
    return true;
  } catch (e) {
    // Falha ao checar o teto não pode travar o atendimento inteiro.
    console.error('[W-API] falha ao checar teto diário, seguindo sem o limite:', e.message);
    return true;
  }
}

async function enviarTexto(numero, mensagem) {
  const { instancia, token } = credenciais();
  if (!instancia || !token) return semCredencial();
  if (!await podeEnviarHoje()) return { ok: false, erro: 'teto diário de envios atingido (proteção anti-banimento)' };
  try {
    const fone = await _destino(numero, instancia, token);
    if (!fone) return { ok: false, erro: 'numero sem WhatsApp: ' + numero };
    await new Promise(r => setTimeout(r, atrasoHumano(mensagem)));
    const data = await _post('/send-text', {
      phone: fone, message: mensagem
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
  if (!await podeEnviarHoje()) return { ok: false, erro: 'teto diário de envios atingido (proteção anti-banimento)' };
  try {
    const fone = await _destino(numero, instancia, token);
    if (!fone) return { ok: false, erro: 'numero sem WhatsApp: ' + numero };
    await new Promise(r => setTimeout(r, atrasoHumano(legenda)));
    const data = await _post('/send-image', {
      phone: fone, image: imagem, caption: legenda || ''
    }, instancia, token);
    console.log('[W-API] imagem enviada para', fone, '— messageId', (data && data.messageId) || '?');
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
  if (!await podeEnviarHoje()) return { ok: false, erro: 'teto diário de envios atingido (proteção anti-banimento)' };
  try {
    const fone = await _destino(numero, instancia, token);
    if (!fone) return { ok: false, erro: 'numero sem WhatsApp: ' + numero };
    await new Promise(r => setTimeout(r, atrasoHumano(fileName)));
    const data = await _post('/send-document', {
      phone: fone, document: documento,
      fileName: fileName || 'arquivo.pdf'
    }, instancia, token);
    console.log('[W-API] documento enviado para', fone, '— messageId', (data && data.messageId) || '?');
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

// Exposto para a tela de diagnóstico e para os testes: dado um número cadastrado, diz
// com que grafia o WhatsApp vai entregar — ou null se aquele número não tem WhatsApp.
async function conferirNumero(numero) {
  const { instancia, token } = credenciais();
  if (!instancia || !token) return semCredencial();
  const fone = await resolverNumero(numero, instancia, token);
  return { ok: true, existe: !!fone, numero: fone };
}

module.exports = {
  enviarTexto, enviarImagem, enviarDocumento, statusInstancia, conferirNumero,
  // exportados para teste: a variação do atraso e o teto diário são regra de
  // negócio (proteção anti-banimento), não detalhe de implementação
  atrasoHumano, podeEnviarHoje
};
