// Canal de SAÍDA do assistente virtual (Lauro).
//
// Por que existe: o sistema passa a ter dois canais de WhatsApp com papéis distintos.
//
//   Disparos (cobrança, aniversário, avisos) → API Oficial da Meta, número antigo
//   Assistente virtual (quem escreve pra liga) → W-API, número novo do Paraguai
//
// O `lauro.js` chamava `whatsapp-oficial` diretamente em 4 pontos, o que amarrava o
// cérebro do assistente ao transporte. Agora ele fala com este módulo e não sabe — nem
// precisa saber — por onde a resposta sai. Trocar o canal do assistente é mexer aqui, e
// só aqui, sem risco de acertar os disparos por tabela.
//
// ponytail: enquanto a W-API não tem credenciais do número novo, tudo cai na oficial.
// O seletor já está no lugar; quando as credenciais chegarem, é este arquivo que muda.

// Qual provedor atende o assistente. 'oficial' | 'wapi'
function provedor() {
  return (process.env.ASSISTENTE_CANAL || 'oficial').toLowerCase();
}

// Carrega o módulo do provedor escolhido. Se o canal estiver configurado como 'wapi'
// mas o adaptador não estiver disponível, cai na oficial em vez de derrubar o
// atendimento — e grita no log, porque silêncio aqui significa membro sem resposta.
function transporte() {
  if (provedor() === 'wapi') {
    try {
      return require('./whatsapp-wapi');
    } catch (e) {
      console.error('[CANAL] ASSISTENTE_CANAL=wapi mas o adaptador falhou, usando a API oficial:', e.message);
    }
  }
  return require('./whatsapp-oficial');
}

async function enviarTexto(numero, mensagem) {
  return await transporte().enviarTexto(numero, mensagem);
}

async function enviarImagem(numero, imagem, legenda) {
  return await transporte().enviarImagem(numero, imagem, legenda);
}

async function enviarDocumento(numero, documento, fileName) {
  return await transporte().enviarDocumento(numero, documento, fileName);
}

// Modelos aprovados são um recurso da API Oficial: a W-API não tem esse conceito.
// O aviso de novo atendimento para a área precisa entregar mesmo fora da janela de
// 24h, então esta função vai SEMPRE pela oficial, independente do canal do assistente.
async function enviarTemplate(numero, nome, idioma, componentes) {
  return await require('./whatsapp-oficial').enviarTemplate(numero, nome, idioma, componentes);
}

module.exports = { enviarTexto, enviarImagem, enviarDocumento, enviarTemplate, provedor };
