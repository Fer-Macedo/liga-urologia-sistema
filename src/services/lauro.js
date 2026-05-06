// ─── LAURO — Atendente Virtual da Liga Acadêmica de Urologia ─────────────────
const axios = require('axios');

// Números dos responsáveis por área
const CONTATOS = {
  secretaria:  '595973738431',
  financeiro:  '5561993270096',
  cientifico:  '5551993604017',
  extensao:    '5545988069822',
  ensino:      '595972867030',
  marketing:   '595993285645',
  presidencia: '5579999444808'
};

// Estado das conversas (em memória)
// { numero: { etapa, idioma, tentativas, ts } }
const sessoes = {};

const TIMEOUT_SESSAO = 30 * 60 * 1000; // 30 minutos

function getSessao(numero) {
  const agora = Date.now();
  if (!sessoes[numero] || (agora - sessoes[numero].ts) > TIMEOUT_SESSAO) {
    sessoes[numero] = { etapa: 'idioma', idioma: null, tentativas: 0, ts: agora };
  }
  sessoes[numero].ts = agora;
  return sessoes[numero];
}

function resetSessao(numero) {
  sessoes[numero] = { etapa: 'idioma', idioma: null, tentativas: 0, ts: Date.now() };
}

// Mensagens bilíngues
const MSG = {
  pt: {
    boas_vindas: `Olá! 👋 Bem-vindo à *Liga Acadêmica de Urologia*! 🏥

Sou o *Lauro*, seu assistente virtual.

Para melhor te atender, em qual idioma prefere ser atendido?

1️⃣ Português
2️⃣ Español`,

    menu_principal: `Olá! Sou o *Lauro*, assistente virtual da *Liga Acadêmica de Urologia* 🏥

Como posso te ajudar hoje?

1️⃣ Certificados
2️⃣ Financeiro / Mensalidades
3️⃣ Atividades e Eventos
4️⃣ Frequência
5️⃣ Outras dúvidas
6️⃣ Falar com um responsável`,

    certificado: `📜 *Informações sobre Certificados*

Os certificados são emitidos pela coordenação após o encerramento das atividades do semestre.

📌 *Alunos da UCP CDE:*
O certificado aparecerá diretamente no *Portal da UCP* na aba *Eventos*. Não é necessário solicitar.

📌 *Alunos externos:*
Enviaremos o link para download no *grupo do WhatsApp do evento* assim que os certificados forem disponibilizados pela coordenação.

⏳ *Prazo:* Os certificados são disponibilizados em até *30 dias* após o encerramento do evento/semestre.

Posso te ajudar com mais alguma coisa?

1️⃣ Voltar ao menu
2️⃣ Falar com a Secretaria`,

    financeiro: `💰 *Financeiro / Mensalidades*

Para questões financeiras, como pagamento de mensalidades, boletos ou cobranças, nossa equipe pode te ajudar.

O que você precisa?

1️⃣ Informações sobre mensalidade
2️⃣ Problema com pagamento
3️⃣ Falar com o Financeiro
4️⃣ Voltar ao menu`,

    mensalidade_info: `💰 *Informações sobre Mensalidade*

📌 *Valor:* R$ 25,00 (com desconto de 20% pagando até o dia 16: R$ 20,00)
📌 *Vencimento:* Todo dia 16 de cada mês
📌 *Formas de pagamento:* PIX ou Cartão de crédito

Você recebe mensalmente um link de pagamento por WhatsApp e e-mail.

Precisa de mais alguma informação?

1️⃣ Falar com o Financeiro
2️⃣ Voltar ao menu`,

    atividades: `📅 *Atividades e Eventos*

A Liga realiza diversas atividades ao longo do semestre:

🔬 Aulas Presenciais e On-line
🌐 Extensão
👥 Reuniões
🎉 Bienvenidas
🏆 Expoligas

Para informações sobre próximas atividades ou inscrições, entre em contato com nossa equipe.

1️⃣ Falar com Ensino
2️⃣ Falar com Extensão
3️⃣ Voltar ao menu`,

    frequencia: `📊 *Frequência*

Para ser aprovado e receber o certificado de 1 ano de liga, você precisa ter *mínimo de 75% de presença* nas atividades.

Você recebe automaticamente todo último dia do mês um relatório com sua frequência por WhatsApp e e-mail.

Dúvidas sobre sua frequência?

1️⃣ Falar com a Secretaria
2️⃣ Voltar ao menu`,

    outras_duvidas: `💬 *Outras dúvidas*

Não encontrou o que procurava? Nossa equipe pode te ajudar!

Com qual área deseja falar?

1️⃣ Secretaria
2️⃣ Financeiro
3️⃣ Científico
4️⃣ Extensão
5️⃣ Ensino
6️⃣ Marketing
7️⃣ Presidência
8️⃣ Voltar ao menu`,

    menu_responsaveis: `👥 *Falar com um responsável*

Escolha a área:

1️⃣ Secretaria
2️⃣ Financeiro
3️⃣ Científico
4️⃣ Extensão
5️⃣ Ensino
6️⃣ Marketing
7️⃣ Presidência
8️⃣ Voltar ao menu`,

    redirecionando: (area) => `✅ Certo! Estou te redirecionando para o responsável pela área de *${area}*.

Em instantes você será atendido. 😊

_Mensagem automática — Liga Acadêmica de Urologia_`,

    aviso_presidencia: (nome, numero, area) => `📬 *Notificação de Atendimento*\n\nUm membro foi redirecionado para a área de *${area}*.\n\n👤 Número: ${numero}`,

    nao_entendi: `Desculpe, não entendi sua mensagem. 😅

Por favor, escolha uma das opções do menu digitando o *número* correspondente.

Digite *menu* para ver as opções novamente.`,

    encerramento: `Foi um prazer te atender! 😊

Se precisar de mais ajuda, é só me chamar.

Atenciosamente,
*Lauro* — Assistente Virtual
*Liga Acadêmica de Urologia* 🏥`
  },

  es: {
    boas_vindas: `¡Hola! 👋 ¡Bienvenido a la *Liga Académica de Urología*! 🏥

Soy *Lauro*, tu asistente virtual.

¿En qué idioma prefiere ser atendido?

1️⃣ Português
2️⃣ Español`,

    menu_principal: `¡Hola! Soy *Lauro*, asistente virtual de la *Liga Académica de Urología* 🏥

¿Cómo puedo ayudarte hoy?

1️⃣ Certificados
2️⃣ Finanzas / Mensualidades
3️⃣ Actividades y Eventos
4️⃣ Frecuencia / Asistencia
5️⃣ Otras consultas
6️⃣ Hablar con un responsable`,

    certificado: `📜 *Información sobre Certificados*

Los certificados son emitidos por la coordinación al finalizar las actividades del semestre.

📌 *Estudiantes de UCP CDE:*
El certificado aparecerá directamente en el *Portal UCP* en la pestaña *Eventos*. No es necesario solicitarlo.

📌 *Estudiantes externos:*
Enviaremos el enlace de descarga al *grupo de WhatsApp del evento* cuando los certificados sean disponibilizados por la coordinación.

⏳ *Plazo:* Los certificados se disponibilizan en hasta *30 días* después del cierre del evento/semestre.

¿Puedo ayudarte con algo más?

1️⃣ Volver al menú
2️⃣ Hablar con Secretaría`,

    financeiro: `💰 *Finanzas / Mensualidades*

Para cuestiones financieras, nuestro equipo puede ayudarte.

¿Qué necesitas?

1️⃣ Información sobre mensualidad
2️⃣ Problema con pago
3️⃣ Hablar con Finanzas
4️⃣ Volver al menú`,

    mensalidade_info: `💰 *Información sobre Mensualidad*

📌 *Valor:* R$ 25,00 (con descuento del 20% pagando hasta el día 16: R$ 20,00)
📌 *Vencimiento:* Cada día 16 del mes
📌 *Formas de pago:* PIX o Tarjeta de crédito

Recibes mensualmente un enlace de pago por WhatsApp y correo electrónico.

¿Necesitas más información?

1️⃣ Hablar con Finanzas
2️⃣ Volver al menú`,

    atividades: `📅 *Actividades y Eventos*

La Liga realiza diversas actividades durante el semestre:

🔬 Clases Presenciales y On-line
🌐 Extensión
👥 Reuniones
🎉 Bienvenidas
🏆 Expoligas

Para información sobre próximas actividades o inscripciones, contacta a nuestro equipo.

1️⃣ Hablar con Enseñanza
2️⃣ Hablar con Extensión
3️⃣ Volver al menú`,

    frequencia: `📊 *Frecuencia / Asistencia*

Para ser aprobado y recibir el certificado de 1 año de liga, necesitas tener *mínimo 75% de asistencia* en las actividades.

Recibes automáticamente cada último día del mes un reporte con tu frecuencia por WhatsApp y correo.

¿Dudas sobre tu frecuencia?

1️⃣ Hablar con Secretaría
2️⃣ Volver al menú`,

    outras_duvidas: `💬 *Otras consultas*

¿No encontraste lo que buscabas? ¡Nuestro equipo puede ayudarte!

¿Con qué área deseas hablar?

1️⃣ Secretaría
2️⃣ Finanzas
3️⃣ Científico
4️⃣ Extensión
5️⃣ Enseñanza
6️⃣ Marketing
7️⃣ Presidencia
8️⃣ Volver al menú`,

    menu_responsaveis: `👥 *Hablar con un responsable*

Elige el área:

1️⃣ Secretaría
2️⃣ Finanzas
3️⃣ Científico
4️⃣ Extensión
5️⃣ Enseñanza
6️⃣ Marketing
7️⃣ Presidencia
8️⃣ Volver al menú`,

    redirecionando: (area) => `✅ ¡Entendido! Te estoy redirigiendo al responsable del área de *${area}*.

En breve serás atendido. 😊

_Mensaje automático — Liga Académica de Urología_`,

    aviso_presidencia: (nome, numero, area) => `📬 *Notificación de Atención*\n\nUn miembro fue redirigido al área de *${area}*.\n\n👤 Número: ${numero}`,

    nao_entendi: `Disculpa, no entendí tu mensaje. 😅

Por favor, elige una de las opciones del menú escribiendo el *número* correspondiente.

Escribe *menu* para ver las opciones nuevamente.`,

    encerramento: `¡Fue un placer atenderte! 😊

Si necesitas más ayuda, solo escríbeme.

Atentamente,
*Lauro* — Asistente Virtual
*Liga Académica de Urología* 🏥`
  }
};

const AREAS = {
  pt: ['secretaria', 'financeiro', 'cientifico', 'extensao', 'ensino', 'marketing', 'presidencia'],
  es: ['secretaria', 'financeiro', 'cientifico', 'extensao', 'ensino', 'marketing', 'presidencia']
};

const NOMES_AREAS = {
  pt: ['Secretaria', 'Financeiro', 'Científico', 'Extensão', 'Ensino', 'Marketing', 'Presidência'],
  es: ['Secretaría', 'Finanzas', 'Científico', 'Extensión', 'Enseñanza', 'Marketing', 'Presidencia']
};

async function enviarMensagem(numero, mensagem) {
  const token = process.env.ZAPAPI_TOKEN;
  const instanceId = process.env.ZAPAPI_INSTANCE;
  try {
    await axios.post(
      'https://api.w-api.app/v1/message/send-text?instanceId=' + instanceId,
      { phone: numero, message: mensagem, instanceId, delayMessage: 1 },
      { headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    console.log('Lauro enviou para', numero);
  } catch (e) {
    console.error('Lauro erro envio:', e.message);
  }
}

async function processarMensagem(numero, texto) {
  const sessao = getSessao(numero);
  const msg = texto.trim().toLowerCase();
  const idioma = sessao.idioma || 'pt';
  const t = MSG[idioma];

  console.log('Lauro recebeu de', numero, '| etapa:', sessao.etapa, '| msg:', msg);

  // Comando menu em qualquer etapa
  if (msg === 'menu' || msg === 'menú') {
    sessao.etapa = 'menu';
    await enviarMensagem(numero, t.menu_principal);
    return;
  }

  // ─── ETAPA: IDIOMA ────────────────────────────────────────────────────────
  if (sessao.etapa === 'idioma') {
    if (msg === '1' || msg.includes('portugu')) {
      sessao.idioma = 'pt';
      sessao.etapa = 'menu';
      await enviarMensagem(numero, MSG.pt.menu_principal);
    } else if (msg === '2' || msg.includes('espa') || msg.includes('españ')) {
      sessao.idioma = 'es';
      sessao.etapa = 'menu';
      await enviarMensagem(numero, MSG.es.menu_principal);
    } else {
      // Primeira mensagem — envia boas vindas
      await enviarMensagem(numero, MSG.pt.boas_vindas);
    }
    return;
  }

  // ─── ETAPA: MENU PRINCIPAL ────────────────────────────────────────────────
  if (sessao.etapa === 'menu') {
    if (msg === '1') {
      sessao.etapa = 'certificado';
      await enviarMensagem(numero, t.certificado);
    } else if (msg === '2') {
      sessao.etapa = 'financeiro';
      await enviarMensagem(numero, t.financeiro);
    } else if (msg === '3') {
      sessao.etapa = 'atividades';
      await enviarMensagem(numero, t.atividades);
    } else if (msg === '4') {
      sessao.etapa = 'frequencia';
      await enviarMensagem(numero, t.frequencia);
    } else if (msg === '5') {
      sessao.etapa = 'outras';
      await enviarMensagem(numero, t.outras_duvidas);
    } else if (msg === '6') {
      sessao.etapa = 'responsaveis';
      await enviarMensagem(numero, t.menu_responsaveis);
    } else {
      await enviarMensagem(numero, t.nao_entendi);
    }
    return;
  }

  // ─── ETAPA: CERTIFICADO ───────────────────────────────────────────────────
  if (sessao.etapa === 'certificado') {
    if (msg === '1') {
      sessao.etapa = 'menu';
      await enviarMensagem(numero, t.menu_principal);
    } else if (msg === '2') {
      sessao.etapa = 'menu';
      await redirecionarArea(numero, 'secretaria', idioma);
    } else {
      await enviarMensagem(numero, t.nao_entendi);
    }
    return;
  }

  // ─── ETAPA: FINANCEIRO ────────────────────────────────────────────────────
  if (sessao.etapa === 'financeiro') {
    if (msg === '1') {
      sessao.etapa = 'menu';
      await enviarMensagem(numero, t.mensalidade_info);
    } else if (msg === '2' || msg === '3') {
      sessao.etapa = 'menu';
      await redirecionarArea(numero, 'financeiro', idioma);
    } else if (msg === '4') {
      sessao.etapa = 'menu';
      await enviarMensagem(numero, t.menu_principal);
    } else {
      await enviarMensagem(numero, t.nao_entendi);
    }
    return;
  }

  // ─── ETAPA: ATIVIDADES ────────────────────────────────────────────────────
  if (sessao.etapa === 'atividades') {
    if (msg === '1') {
      sessao.etapa = 'menu';
      await redirecionarArea(numero, 'ensino', idioma);
    } else if (msg === '2') {
      sessao.etapa = 'menu';
      await redirecionarArea(numero, 'extensao', idioma);
    } else if (msg === '3') {
      sessao.etapa = 'menu';
      await enviarMensagem(numero, t.menu_principal);
    } else {
      await enviarMensagem(numero, t.nao_entendi);
    }
    return;
  }

  // ─── ETAPA: FREQUÊNCIA ────────────────────────────────────────────────────
  if (sessao.etapa === 'frequencia') {
    if (msg === '1') {
      sessao.etapa = 'menu';
      await redirecionarArea(numero, 'secretaria', idioma);
    } else if (msg === '2') {
      sessao.etapa = 'menu';
      await enviarMensagem(numero, t.menu_principal);
    } else {
      await enviarMensagem(numero, t.nao_entendi);
    }
    return;
  }

  // ─── ETAPA: OUTRAS / RESPONSÁVEIS ────────────────────────────────────────
  if (sessao.etapa === 'outras' || sessao.etapa === 'responsaveis') {
    const idx = parseInt(msg) - 1;
    if (idx >= 0 && idx <= 6) {
      const area = AREAS.pt[idx];
      sessao.etapa = 'menu';
      await redirecionarArea(numero, area, idioma);
    } else if (msg === '8') {
      sessao.etapa = 'menu';
      await enviarMensagem(numero, t.menu_principal);
    } else {
      await enviarMensagem(numero, t.nao_entendi);
    }
    return;
  }

  // Fallback
  await enviarMensagem(numero, t.nao_entendi);
}

async function redirecionarArea(numeroCliente, area, idioma) {
  const t = MSG[idioma];
  const idx = AREAS.pt.indexOf(area);
  const nomeArea = NOMES_AREAS[idioma][idx];
  const numeroArea = CONTATOS[area];

  // Mensagem para o cliente
  await enviarMensagem(numeroCliente, t.redirecionando(nomeArea));

  // Notifica o responsável da área
  const msgResponsavel = idioma === 'pt'
    ? `📬 *Nova solicitação de atendimento*\n\nUm membro entrou em contato e foi direcionado para *${nomeArea}*.\n\n👤 Número: wa.me/${numeroCliente}\n\n_Por favor, entre em contato para dar continuidade ao atendimento._`
    : `📬 *Nueva solicitud de atención*\n\nUn miembro contactó y fue dirigido a *${nomeArea}*.\n\n👤 Número: wa.me/${numeroCliente}\n\n_Por favor, contacte para continuar la atención._`;

  await enviarMensagem(numeroArea, msgResponsavel);

  // Sempre notifica a presidência (exceto se já é a própria presidência)
  if (area !== 'presidencia') {
    const msgPresidencia = `📊 *Lauro — Registro de Atendimento*\n\n👤 Número: wa.me/${numeroCliente}\n📁 Direcionado para: *${NOMES_AREAS['pt'][idx]}*\n🕐 Horário: ${new Date().toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo'})}`;
    await enviarMensagem(CONTATOS.presidencia, msgPresidencia);
  }
}

module.exports = { processarMensagem, getSessao, resetSessao };
