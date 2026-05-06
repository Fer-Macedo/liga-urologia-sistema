// ─── LAURO — Atendente Virtual com IA (Claude) ───────────────────────────────
const axios = require('axios');
const { query } = require('../models/database');

const CONTATOS = {
  secretaria:  '595973738431',
  financeiro:  '5561993270096',
  cientifico:  '5551993604017',
  extensao:    '5545988069822',
  ensino:      '595972867030',
  marketing:   '595993285645',
  presidencia: '5579999444808'
};

// Sessoes em memoria { numero: { idioma, historico[], ts } }
const sessoes = {};
const TIMEOUT = 30 * 60 * 1000;

function getSessao(numero) {
  const agora = Date.now();
  if (!sessoes[numero] || (agora - sessoes[numero].ts) > TIMEOUT) {
    sessoes[numero] = { idioma: null, historico: [], ts: agora, etapa: 'idioma' };
  }
  sessoes[numero].ts = agora;
  return sessoes[numero];
}

// Busca base de conhecimento do banco
async function getBaseConhecimento() {
  try {
    const r = await query('SELECT pergunta, resposta FROM lauro_conhecimento WHERE ativo=1 ORDER BY criado_em DESC');
    return r.rows.map(k => `P: ${k.pergunta}\nR: ${k.resposta}`).join('\n\n');
  } catch(e) {
    return '';
  }
}

// Salva aprendizado novo no banco
async function salvarAprendizado(pergunta, resposta) {
  try {
    await query(
      'INSERT INTO lauro_conhecimento (pergunta, resposta, ativo) VALUES ($1, $2, 1) ON CONFLICT DO NOTHING',
      [pergunta.substring(0, 500), resposta.substring(0, 2000)]
    );
  } catch(e) { console.error('Erro salvar aprendizado:', e.message); }
}

// Salva conversa no banco
async function salvarConversa(numero, papel, mensagem) {
  try {
    await query(
      'INSERT INTO lauro_conversas (numero, papel, mensagem) VALUES ($1, $2, $3)',
      [numero, papel, mensagem.substring(0, 2000)]
    );
  } catch(e) {}
}

// Envia alerta para presidencia quando creditos estao acabando
async function alertarCreditos(tipo) {
  const zerado = 'Atencao: Os creditos da API do Claude acabaram! O Lauro esta em modo basico. Recarregue em console.anthropic.com/settings/billing';
  const baixo = 'Atencao: Os creditos da API do Claude estao baixos! Recarregue em breve em console.anthropic.com/settings/billing';
  const msg = tipo === 'zerado' ? zerado : baixo;
  try { await enviarMensagem(CONTATOS.presidencia, msg); } catch(e) {}
}

// Menu de fallback quando IA nao esta disponivel
function menuFallback(idioma) {
  const pt = '💚💙 *Lauro* - Liga Academica de Urologia\n\nOla! Como posso te ajudar? Escolha com quem deseja falar:\n\n1 - Secretaria\n2 - Financeiro\n3 - Cientifico\n4 - Extensao\n5 - Ensino\n6 - Marketing\n7 - Presidencia';
  const es = '💚💙 *Lauro* - Liga Academica de Urologia\n\nHola! Como puedo ayudarte? Elige con quien deseas hablar:\n\n1 - Secretaria\n2 - Finanzas\n3 - Cientifico\n4 - Extension\n5 - Ensenanza\n6 - Marketing\n7 - Presidencia';
  return idioma === 'es' ? es : pt;
}

// Chama a API do Claude
async function chamarClaude(sessao, mensagemUsuario, idioma) {
  const baseConhecimento = await getBaseConhecimento();

  const sistemaPT = `Você é o Lauro, atendente virtual da Liga Acadêmica de Urologia, uma liga acadêmica que atua no Paraguai com maioria de alunos brasileiros.

Seu perfil:
- Nome: Lauro
- Personalidade: simpático, prestativo, descontraído mas profissional
- Você deve parecer uma pessoa real, não um robô
- Use emojis com moderação para parecer mais humano
- Escreva de forma natural, como se estivesse numa conversa de WhatsApp
- Nunca diga que é um bot ou assistente virtual — aja como se fosse uma pessoa real da equipe

INFORMAÇÕES DA LIGA:
- Mensalidade: R$ 25,00 (R$ 20,00 com 20% de desconto pagando até dia 16)
- Certificados UCP CDE: aparecem no portal da UCP na aba Eventos automaticamente
- Certificados externos: enviados via link no grupo do WhatsApp do evento
- Prazo certificados: até 90 dias após o término do evento, porém normalmente são lançados muito antes
- Acompanhe o grupo do WhatsApp do evento — a equipe da Liga avisa quando o certificado for lançado
- Certificados de eventos presenciais: é necessário ter assinado a lista de presença no evento
- Certificados de eventos on-line: é necessário ter preenchido o check-out ao final da aula
- NÃO há percentual mínimo de frequência para certificado de eventos — basta confirmar a presença
- Frequência mínima 75%: aplica-se apenas ao certificado anual da Liga (membros e diretivos), NÃO para certificados de eventos
- Relatório de frequência: enviado automaticamente no último dia de cada mês
- Formas de pagamento: PIX ou Cartão de crédito

ÁREAS DE CONTATO (quando precisar direcionar):
- Secretaria, Financeiro, Científico, Extensão, Ensino, Marketing, Presidência

BASE DE CONHECIMENTO ADICIONAL:
${baseConhecimento || 'Nenhuma informação adicional cadastrada ainda.'}

REGRAS IMPORTANTES:
1. Responda SEMPRE em português (o usuário escolheu português)
2. Se não souber a resposta, diga que vai verificar e ofereça falar com a equipe
3. Se o usuário quiser falar com alguém, pergunte com qual área e responda APENAS com: DIRECIONAR:nomearea (ex: DIRECIONAR:financeiro)
4. Se a pergunta for nova e você aprender algo útil, salve mentalmente
5. Mantenha respostas curtas e objetivas — WhatsApp não é email
6. Nunca invente informações que não tem certeza`;

  const sistemaES = `Eres Lauro, asistente de atención de la Liga Académica de Urología, una liga académica que opera en Paraguay con mayoría de estudiantes brasileños.

Tu perfil:
- Nombre: Lauro  
- Personalidad: simpático, servicial, desenfadado pero profesional
- Debes parecer una persona real, no un robot
- Usa emojis con moderación
- Escribe de forma natural, como si estuvieras en una conversación de WhatsApp
- Nunca digas que eres un bot — actúa como si fueras una persona real del equipo

INFORMACIÓN DE LA LIGA:
- Mensualidad: R$ 25,00 (R$ 20,00 con 20% de descuento pagando hasta el día 16)
- Certificados UCP CDE: aparecen en el portal UCP en la pestaña Eventos automáticamente
- Certificados externos: enviados por enlace en el grupo de WhatsApp del evento
- Plazo certificados: hasta 90 días después del cierre del evento, aunque normalmente se lanzan mucho antes
- Sigue el grupo de WhatsApp del evento — el equipo de la Liga avisa cuando el certificado esté disponible
- Certificados de eventos presenciales: es necesario haber firmado la lista de asistencia
- Certificados de eventos online: es necesario haber completado el check-out al final de la clase
- NO hay porcentaje mínimo de asistencia para certificados de eventos — solo confirmar la presencia
- Asistencia mínima 75%: aplica solo al certificado anual de la Liga (miembros y directivos), NO para certificados de eventos
- Reporte de asistencia: enviado automáticamente el último día de cada mes

ÁREAS DE CONTACTO: Secretaría, Finanzas, Científico, Extensión, Enseñanza, Marketing, Presidencia

BASE DE CONOCIMIENTO ADICIONAL:
${baseConhecimento || 'Sin información adicional registrada aún.'}

REGLAS IMPORTANTES:
1. Responde SIEMPRE en español
2. Si no sabes la respuesta, ofrece hablar con el equipo
3. Si el usuario quiere hablar con alguien, responde SOLO con: DIRECIONAR:nomearea
4. Mantén respuestas cortas — WhatsApp no es email
5. Nunca inventes información`;

  const sistema = idioma === 'es' ? sistemaES : sistemaPT;

  // Monta historico para contexto (ultimas 10 mensagens)
  const historico = sessao.historico.slice(-10).map(h => ({
    role: h.papel === 'user' ? 'user' : 'assistant',
    content: h.mensagem
  }));

  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-5',
      max_tokens: 500,
      system: sistema,
      messages: [...historico, { role: 'user', content: mensagemUsuario }]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': process.env.ANTHROPIC_API_KEY
      },
      timeout: 30000
    });

    return response.data.content[0].text;
  } catch(e) {
    const errMsg = JSON.stringify(e.response?.data || e.message || '');
    console.error('Erro Claude:', errMsg);
    
    // Verifica se e erro de credito
    if (errMsg.includes('credit') || errMsg.includes('balance') || errMsg.includes('quota')) {
      // Alerta a presidencia
      alertarCreditos('zerado');
      // Retorna menu de fallback
      return 'FALLBACK_MENU';
    }
    // Fallback apenas se nao for erro temporario
    return 'FALLBACK_MENU';
  }
}

async function enviarMensagem(numero, mensagem) {
  const token = process.env.ZAPAPI_TOKEN;
  const instanceId = process.env.ZAPAPI_INSTANCE;
  try {
    const delay = Math.min(Math.max(mensagem.length * 25, 1500), 4000);
    await new Promise(r => setTimeout(r, delay));
    await axios.post(
      'https://api.w-api.app/v1/message/send-text?instanceId=' + instanceId,
      { phone: numero, message: mensagem, instanceId, delayMessage: 2 },
      { headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    console.log('Lauro enviou para', numero);
  } catch(e) { console.error('Lauro erro envio:', e.message); }
}

async function redirecionarArea(numero, area, idioma) {
  const areas = ['secretaria','financeiro','cientifico','extensao','ensino','marketing','presidencia'];
  const nomesPT = ['Secretaria','Financeiro','Científico','Extensão','Ensino','Marketing','Presidência'];
  const nomesES = ['Secretaría','Finanzas','Científico','Extensión','Enseñanza','Marketing','Presidencia'];
  const idx = areas.indexOf(area.toLowerCase());
  if (idx === -1) return;
  const nomeArea = idioma === 'es' ? nomesES[idx] : nomesPT[idx];
  const numeroArea = CONTATOS[area];

  const msgCliente = idioma === 'es'
    ? `¡Perfecto! Ya avisé al equipo de *${nomeArea}* sobre tu contacto 📲\n\nEn breve alguien del equipo se pondrá en contacto contigo. Si necesitas algo más, ¡estoy aquí!\n\n💚💙 *Lauro — Liga Académica de Urología* 🏥`
    : `Perfeito! Já avisei o pessoal de *${nomeArea}* sobre o seu contato 📲\n\nEm breve alguém da equipe vai entrar em contato com você. Qualquer coisa, pode me chamar!\n\n💚💙 *Lauro — Liga Acadêmica de Urologia* 🏥`;

  await enviarMensagem(numero, msgCliente);

  const hora = new Date().toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo'});
  const msgArea = `Olá! Venho através do WhatsApp do 💚💙 *Lauro* 🤖

Um membro solicitou atendimento de *${nomesPT[idx]}*.

📱 Contato: wa.me/${numero}
🌐 Idioma: ${idioma === "es" ? "Español" : "Português"}
🕐 ${hora}

_Por favor entre em contato com o membro para dar continuidade ao atendimento._`;
  await enviarMensagem(numeroArea, msgArea);

  if (area !== 'presidencia') {
    await enviarMensagem(CONTATOS.presidencia,
      `📊 💚💙 *Lauro — Atendimento registrado*\n\n📱 Número: wa.me/${numero}\n📁 Área: *${nomesPT[idx]}*\n🕐 ${hora}`
    );
  }
}

async function processarMensagem(numero, texto) {
  const sessao = getSessao(numero);
  const msg = texto.trim();
  const msgLower = msg.toLowerCase();

  console.log('Lauro | de:', numero, '| etapa:', sessao.etapa, '| msg:', msg.substring(0,40));

  // Salva mensagem do usuario
  await salvarConversa(numero, 'user', msg);
  sessao.historico.push({ papel: 'user', mensagem: msg });

  // Primeira mensagem — pergunta idioma
  if (sessao.etapa === 'idioma') {
    if (msgLower === '1' || msgLower.includes('portugu') || msgLower.includes('brasil')) {
      sessao.idioma = 'pt';
      sessao.etapa = 'ativo';
    } else if (msgLower === '2' || msgLower.includes('espan') || msgLower.includes('españ')) {
      sessao.idioma = 'es';
      sessao.etapa = 'ativo';
    } else {
      const boasVindas = `Oi! 😊 Tudo bem? Aqui é o 💚💙 *Lauro*, da *Liga Acadêmica de Urologia*!\n\nAntes de começar, me diz: prefere que eu te atenda em português ou espanhol?\n\n1️⃣ Português 🇧🇷\n2️⃣ Español 🇵🇾`;
      await enviarMensagem(numero, boasVindas);
      await salvarConversa(numero, 'assistant', boasVindas);
      sessao.historico.push({ papel: 'assistant', mensagem: boasVindas });
      return;
    }

    const boasVindas = sessao.idioma === 'es'
      ? `¡Perfecto! 😊 Cuéntame, ¿en qué puedo ayudarte hoy?`
      : `Perfeito! 😊 Me conta, como posso te ajudar hoje?`;
    await enviarMensagem(numero, boasVindas);
    await salvarConversa(numero, 'assistant', boasVindas);
    sessao.historico.push({ papel: 'assistant', mensagem: boasVindas });
    return;
  }

  // Modo fallback — sem creditos IA
  if (sessao.etapa === 'fallback') {
    const areas = ['secretaria','financeiro','cientifico','extensao','ensino','marketing','presidencia'];
    const idx = parseInt(msg) - 1;
    if (idx >= 0 && idx <= 6) {
      sessao.etapa = 'ativo';
      await redirecionarArea(numero, areas[idx], sessao.idioma || 'pt');
    } else {
      await enviarMensagem(numero, menuFallback(sessao.idioma || 'pt'));
    }
    return;
  }

  // Detecta pedido de atendente humano
  const pedidoHumano = ['atendente', 'humano', 'pessoa', 'responsavel', 'falar com', 'quero falar', 'equipe', 'agente'];
  if (pedidoHumano.some(p => msgLower.includes(p))) {
    const menuHumano = menuFallback(sessao.idioma || 'pt');
    await enviarMensagem(numero, menuHumano);
    await salvarConversa(numero, 'assistant', menuHumano);
    sessao.historico.push({ papel: 'assistant', mensagem: menuHumano });
    sessao.etapa = 'fallback';
    return;
  }

  // Conversa ativa — usa Claude
  const resposta = await chamarClaude(sessao, msg, sessao.idioma || 'pt');

  // Verifica se Claude quer direcionar para area
  if (resposta.startsWith('DIRECIONAR:')) {
    const area = resposta.replace('DIRECIONAR:', '').trim().toLowerCase();
    await redirecionarArea(numero, area, sessao.idioma || 'pt');
    const msgLog = `[Direcionado para ${area}]`;
    await salvarConversa(numero, 'assistant', msgLog);
    sessao.historico.push({ papel: 'assistant', mensagem: msgLog });
    return;
  }

  // Verifica se e fallback (sem creditos)
  if (resposta === 'FALLBACK_MENU') {
    const msgFallback = menuFallback(sessao.idioma || 'pt');
    await enviarMensagem(numero, msgFallback);
    await salvarConversa(numero, 'assistant', msgFallback);
    sessao.historico.push({ papel: 'assistant', mensagem: msgFallback });
    sessao.etapa = 'fallback';
    return;
  }

  // Envia resposta normal
  await enviarMensagem(numero, resposta);
  await salvarConversa(numero, 'assistant', resposta);
  sessao.historico.push({ papel: 'assistant', mensagem: resposta });
}

module.exports = { processarMensagem };
