// ─── LAURO — Atendente Virtual com IA (Claude) ───────────────────────────────
const axios = require('axios');
const { query } = require('../models/database');

let CONTATOS = {
  secretaria:  '595973738431',
  financeiro:  '5561993270096',
  cientifico:  '5551993604017',
  extensao:    '5545988069822',
  ensino:      '595972867030',
  marketing:   '595993285645',
  presidencia: '557999444808'
};

// Sessoes em memoria { numero: { idioma, historico[], ts } }
const sessoes = {};
const TIMEOUT = 30 * 60 * 1000;

function getSessao(numero) {
  const agora = Date.now();
  if (!sessoes[numero] || (agora - sessoes[numero].ts) > TIMEOUT) {
    sessoes[numero] = { idioma: null, historico: [], ts: agora, etapa: 'idioma', nome: null };
  }
  sessoes[numero].ts = agora;
  return sessoes[numero];
}

// Busca eventos ativos do banco
async function getEventosAtivos() {
  try {
    const agora = new Date();
    const r = await query(`
      SELECT id, nome, descricao, data_inicio, data_fim, local, endereco, tipo_evento, carga_horaria, termos_texto
      FROM eventos
      WHERE (
        (status IN ('ativo','publicado') AND publico=true)
        OR (status='encerrado' AND (data_fim IS NULL OR data_fim > NOW() - INTERVAL '6 months'))
      )
      ORDER BY data_inicio ASC
    `);
    if (r.rows.length === 0) return 'Nenhum evento disponivel no momento.';
    const futuros = [];
    const passados = [];
    r.rows.forEach(e => {
      const inicio = e.data_inicio ? new Date(e.data_inicio).toLocaleDateString('pt-BR') : '';
      const fim = e.data_fim ? new Date(e.data_fim).toLocaleDateString('pt-BR') : '';
      const jaOcorreu = (e.data_fim && new Date(e.data_fim) < agora) || e.status === 'encerrado';
      const link = 'https://sistema.lauroucpcde.com/inscricao/' + e.id;
      const _termos = (e.termos_texto || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
      const _termosResumo = _termos ? (_termos.length > 1100 ? _termos.slice(0, 1100) + '…' : _termos) : '';
      const info = 'Evento: ' + e.nome + '\nStatus: ' + (jaOcorreu ? 'JA OCORREU' : 'ABERTO PARA INSCRICAO') +
        '\nData: ' + inicio + (fim && fim !== inicio ? ' a ' + fim : '') +
        '\nLocal: ' + (e.local || '') + (e.endereco ? ' - ' + e.endereco : '') +
        '\nTipo: ' + (e.tipo_evento || 'presencial') +
        '\nCarga horaria: ' + (e.carga_horaria || 0) + 'h' +
        '\nDescricao: ' + (e.descricao || '') +
        (jaOcorreu ? '' : '\nLink de inscricao: ' + link) +
        (_termosResumo ? '\nTERMOS E POLITICA DO EVENTO (aceitos OBRIGATORIAMENTE pelo participante ao concluir a inscricao): ' + _termosResumo + '\nOnde reler os termos: ' + link : '');
      if (jaOcorreu) passados.push(info);
      else futuros.push(info);
    });
    let resultado = '';
    if (futuros.length > 0) resultado += 'EVENTOS ABERTOS PARA INSCRICAO:\n\n' + futuros.join('\n\n---\n\n');
    if (passados.length > 0) resultado += '\n\nEVENTOS JA REALIZADOS:\n\n' + passados.join('\n\n---\n\n');
    return resultado || 'Nenhum evento disponivel no momento.';
  } catch(e) {
    return 'Nenhum evento disponivel no momento.';
  }
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
  const pt = '💚💙 *Lauro* - Liga Academica de Urologia\n\nOla! Como posso te ajudar? Escolha com quem deseja falar:\n\n1️⃣ - Secretaria\n2️⃣ - Financeiro\n3️⃣ - Cientifico\n4️⃣ - Extensao\n5️⃣ - Ensino\n6️⃣ - Marketing\n7️⃣ - Presidencia';
  const es = '💚💙 *Lauro* - Liga Academica de Urologia\n\nHola! Como puedo ayudarte? Elige con quien deseas hablar:\n\n1️⃣ - Secretaria\n2️⃣ - Finanzas\n3️⃣ - Cientifico\n4️⃣ - Extension\n5️⃣ - Ensenanza\n6️⃣ - Marketing\n7️⃣ - Presidencia';
  return idioma === 'es' ? es : pt;
}

// Chama a API do Claude
function _ultimos8(num) {
  const d = (num || '').replace(/\D/g, '');
  return d.slice(-8);
}

async function getFrequenciaPorWhatsapp(numero) {
  try {
    const alvo = _ultimos8(numero);
    if (alvo.length < 8) return null;

    const membros = await query("SELECT id, nome, whatsapp FROM membros WHERE whatsapp IS NOT NULL AND whatsapp != '' AND ativo=1");
    const m = membros.rows.find(x => _ultimos8(x.whatsapp) === alvo);
    if (m) {
      const turmas = await query("SELECT t.id, t.nome FROM turmas t JOIN turma_membros tm ON tm.turma_id=t.id WHERE tm.membro_id=$1 AND t.ativo=1", [m.id]);
      let saida = 'TIPO: Ligante\nNOME COMPLETO: ' + m.nome + '\n';
      for (const t of turmas.rows) {
        const ativs = await query("SELECT a.descricao, a.data_atividade, (SELECT presente FROM presencas p WHERE p.atividade_id=a.id AND p.membro_id=$2) as presente FROM atividades a WHERE a.turma_id=$1 ORDER BY a.data_atividade", [t.id, m.id]);
        const total = ativs.rows.length;
        const presencas = ativs.rows.filter(a => a.presente === 1).length;
        const faltas = ativs.rows.filter(a => a.presente !== 1);
        const pct = total > 0 ? Math.round((presencas/total)*100) : 0;
        saida += '\nTURMA: ' + t.nome + ' — Frequência ' + pct + '% (' + presencas + ' presenças de ' + total + ' atividades)\n';
        saida += 'LISTA COMPLETA DE ATIVIDADES:\n';
        ativs.rows.forEach(at => { const data = at.data_atividade ? new Date(at.data_atividade).toLocaleDateString('pt-BR') : ''; saida += '  - ' + at.descricao + ' (' + data + ') — ' + (at.presente === 1 ? 'PRESENTE ✅' : 'FALTA ❌') + '\n'; });
        if (faltas.length === 0) saida += '(Nenhuma falta — frequência perfeita!)\n';
      }
      return saida;
    }

    const diretivos = await query("SELECT id, nome, whatsapp FROM diretivos WHERE whatsapp IS NOT NULL AND whatsapp != '' AND ativo=1");
    const d = diretivos.rows.find(x => _ultimos8(x.whatsapp) === alvo);
    if (d) {
      const turmas = await query("SELECT t.id, t.nome FROM diretivo_turmas t JOIN diretivo_turma_membros tm ON tm.turma_id=t.id WHERE tm.diretivo_id=$1 AND t.ativo=1", [d.id]);
      let saida = 'TIPO: Diretivo\nNOME COMPLETO: ' + d.nome + '\n';
      for (const t of turmas.rows) {
        const ativs = await query("SELECT a.descricao, a.data_atividade, (SELECT presente FROM diretivo_presencas p WHERE p.atividade_id=a.id AND p.diretivo_id=$2) as presente FROM diretivo_atividades a WHERE a.turma_id=$1 ORDER BY a.data_atividade", [t.id, d.id]);
        const total = ativs.rows.length;
        const presencas = ativs.rows.filter(a => a.presente === 1).length;
        const faltas = ativs.rows.filter(a => a.presente !== 1);
        const pct = total > 0 ? Math.round((presencas/total)*100) : 0;
        saida += '\nDIRETORIA: ' + t.nome + ' — Frequência ' + pct + '% (' + presencas + ' presenças de ' + total + ' atividades)\n';
        saida += 'LISTA COMPLETA DE ATIVIDADES:\n';
        ativs.rows.forEach(at => { const data = at.data_atividade ? new Date(at.data_atividade).toLocaleDateString('pt-BR') : ''; saida += '  - ' + at.descricao + ' (' + data + ') — ' + (at.presente === 1 ? 'PRESENTE ✅' : 'FALTA ❌') + '\n'; });
        if (faltas.length === 0) saida += '(Nenhuma falta — frequência perfeita!)\n';
      }
      return saida;
    }
    return null;
  } catch(e) { console.error('getFrequenciaPorWhatsapp erro:', e.message); return null; }
}

async function chamarClaude(sessao, mensagemUsuario, idioma, numero) {
  // ── REEMBOLSO/ESTORNO: trava + confirmacao antes de transferir ──
  const _msg = (mensagemUsuario || '');
  const _ehEs = (idioma === 'es');
  const _reRefund = /reembols|estorn|devolu(c|ç)|charge\s*back|cancelar?\s+(minha|a|la|mi)?\s*inscri|cancelament|anula|me\s+devuelv|quiero\s+(mi\s+)?dinero|quero\s+(o\s+)?(meu\s+)?dinheiro|reintegr/i;
  const _reNao = _ehEs ? /\b(no|nada|ya est[aá]|est[aá] bien|gracias|olvid)\b/i : /\b(n[ãa]o|nao)\b|nada mais|era s[óo] isso|s[óo] isso|obrigad|esquece|tudo certo|tudo bem/i;
  const _reSim = _ehEs ? /\b(s[ií]|quiero|dale|claro|por favor|me gustar[ií]a|hablar|ok|okey|okay)\b/i : /\b(sim|quero|pode|claro|isso|aceito|ok|okay|por favor|prefiro|falar)\b/i;

  if (sessao.aguardandoSecretaria) {
    const _querTermo = /(ver|mostrar|envi|mand|link|onde|qual|quais|ler|le[ée]r|conhecer|copia)/i.test(_msg) && /(termo|termos|pol[ií]tica|regra|regras|contrato|documento|t[ée]rmino|regl)/i.test(_msg);
    const _resolve = !((_msg.indexOf('?') >= 0) || _reRefund.test(_msg) || _querTermo);
    if (_resolve && _reNao.test(_msg)) {
      sessao.aguardandoSecretaria = false;
      return _ehEs ? '¡Perfecto! Cualquier otra cosa, quedo a tu disposición. 😊' : 'Perfeito! Qualquer outra coisa, é só me chamar. 😊';
    }
    if (_resolve && _reSim.test(_msg)) {
      sessao.aguardandoSecretaria = false;
      return _ehEs ? 'Listo, te derivo a la Secretaría para verificar tu caso. DIRECIONAR:secretaria' : 'Combinado, vou te encaminhar para a Secretaria verificar o seu caso. DIRECIONAR:secretaria';
    }
    // pedido de termo / pergunta / ambiguo: mantem aguardando=true e segue para a IA (mostra o termo e repergunta)
  }

  if (_reRefund.test(_msg)) {
    sessao.aguardandoSecretaria = true;
    return _ehEs
      ? 'Entiendo tu situación. Sin embargo, según los Términos y la Política del evento —que cada participante acepta de forma OBLIGATORIA antes de concluir la inscripción— nuestras inscripciones NO son reembolsables bajo ninguna circunstancia. Esas reglas quedan registradas en el Término de Aceptación que marcaste al inscribirte. ¿Quieres que derive tu caso a la Secretaría para verificarlo, o era solo esta consulta?'
      : 'Entendo a sua situação. Porém, conforme os Termos e a Política do evento — que todo participante aceita de forma OBRIGATÓRIA antes de concluir a inscrição — nossas inscrições NÃO são reembolsáveis em nenhuma hipótese. Essas regras ficam registradas no Termo de Aceite que você marcou ao se inscrever. Quer que eu encaminhe o seu caso para a Secretaria verificar, ou era só essa dúvida?';
  }

  const baseConhecimento = await getBaseConhecimento();
  const eventosAtivos = await getEventosAtivos();
  const freqPessoal = numero ? await getFrequenciaPorWhatsapp(numero) : null;

  const _dataHj=new Date().toLocaleDateString('pt-BR',{timeZone:'America/Asuncion'});
  const _horaHj=new Date().toLocaleTimeString('pt-BR',{timeZone:'America/Asuncion',hour:'2-digit',minute:'2-digit'});
  const sistemaPT = `Data de hoje: ${_dataHj}. Hora atual em Assuncao/PY: ${_horaHj}. Use SEMPRE o cumprimento correto conforme a hora: 'bom dia' das 5h-12h, 'boa tarde' das 12h-18h, 'boa noite' das 18h-5h. Eventos com datas APOS hoje ainda NAO aconteceram. Eventos com datas ANTES de hoje JA ACONTECERAM — NUNCA diga que um evento ainda nao aconteceu se a data ja passou. SEMPRE compare a data do evento com a DATA DE HOJE antes de qualquer afirmacao sobre status do evento. Se o sistema marcar o evento como JA OCORREU, confie nessa informacao. Você é o Lauro, atendente virtual da Liga Acadêmica de Urologia, uma liga acadêmica que atua no Paraguai com maioria de alunos brasileiros.

Seu perfil:
- Nome: Lauro
- Personalidade: simpático, prestativo, descontraído mas profissional
- Você deve parecer uma pessoa real, não um robô
- Use emojis com moderação para parecer mais humano
- Escreva de forma natural, como se estivesse numa conversa de WhatsApp
- Nunca diga que é um bot ou assistente virtual — aja como se fosse uma pessoa real da equipe

INFORMAÇÕES DA LIGA:
- Mensalidade: R$ 25,00 (R$ 20,00 com 20% de desconto pagando até dia 15 de cada mês)
- Certificados UCP CDE: aparecem no portal da UCP na aba Eventos automaticamente
- Certificados externos: enviados via link no grupo do WhatsApp do evento
- Prazo certificados: até 90 dias após o término do evento, porém normalmente são lançados muito antes
- Acompanhe o grupo do WhatsApp do evento — a equipe da Liga avisa quando o certificado for lançado
- Certificados de eventos presenciais: é necessário ter assinado a lista de presença no evento
- Certificados de eventos on-line: é necessário ter preenchido o check-out ao final da aula
- Frequência mínima 75%: obrigatório para TODOS os certificados — eventos individuais e certificado anual da Liga. O participante precisa ter pelo menos 75% de presença para ter direito ao certificado
- Relatório de frequência: enviado automaticamente no último dia de cada mês
- Formas de pagamento: PIX ou Cartão de crédito

PROCESSO SELETIVO:
- A Liga realiza processos seletivos semestralmente para novos membros
- Para saber a data do próximo processo seletivo ou prova de ingresso, acompanhe nosso Instagram: @lauroucp.cde (https://instagram.com/lauroucp.cde)
- Todos os nossos eventos abertos e processos seletivos também podem ser acompanhados em: https://linktr.ee/lauroucp.cde

EVENTO ANUAL INSTITUCIONAL — DESAFIO RUN AZUL:
- Corrida de rua aberta ao público e à comunidade acadêmica em geral
- Faz alusão ao mês mundial de combate ao câncer de próstata e à saúde do homem
- Ocorre anualmente no mês de Novembro (calendário acadêmico da UCP)
- Local: entorno do Lago de la República em Ciudad del Este, largada da frente da sede do Lago (UCP)
- Faz parte do calendário institucional da Universidad Central del Paraguay (UCP)
- Mais informações em breve — dúvidas direcionar para: DIRECIONAR:secretaria

EVENTOS DISPONÍVEIS PARA INSCRIÇÃO:
${eventosAtivos}

ÁREAS DE CONTATO (quando precisar direcionar):
- Secretaria, Financeiro, Científico, Extensão, Ensino, Marketing, Presidência

BASE DE CONHECIMENTO ADICIONAL:
${baseConhecimento || 'Nenhuma informação adicional cadastrada ainda.'}

DADOS DE FREQUÊNCIA DO MEMBRO (identificado pelo WhatsApp):
${freqPessoal || 'Não foi possível identificar este número no cadastro de membros/diretivos. Se perguntarem sobre frequência/faltas pessoais, direcione para a Secretaria (DIRECIONAR:secretaria) pois você não tem acesso aos dados dessa pessoa.'}
IMPORTANTE sobre frequência: quando o membro perguntar sobre faltas/presenças/frequência DELE, use EXCLUSIVAMENTE os dados acima. Nunca invente. Liste as atividades faltadas com nome e data quando ele pedir. Se os dados acima disserem que não foi identificado, direcione para a Secretaria.

REGRAS IMPORTANTES:
1. Responda SEMPRE em português (o usuário escolheu português)
2. Se não souber a resposta ou não conseguir resolver, direcione SEMPRE para a Secretaria: DIRECIONAR:secretaria
3. A SECRETARIA é a área responsável por resolver TODAS as demandas da Liga — sempre priorize encaminhar para ela
4. Só direcione para outra área se o usuário EXPLICITAMENTE pedir para falar com Financeiro, Científico, Extensão, Ensino, Marketing ou Presidência
5. Se o usuário quiser falar com alguém sem especificar a área, direcione para a Secretaria: DIRECIONAR:secretaria
6. Mantenha respostas curtas e objetivas — WhatsApp não é email
7. Nunca invente informações que não tem certeza
8. EVENTOS — REGRA CRÍTICA: ao falar de eventos, agenda, "próximos eventos", "eventos da semana" etc, use EXCLUSIVAMENTE a lista em "EVENTOS DISPONÍVEIS PARA INSCRIÇÃO" acima (essa lista vem do sistema e está sempre atualizada). NUNCA cite eventos, datas, horários ou locais que estejam apenas na BASE DE CONHECIMENTO — essas informações podem estar desatualizadas. Se um evento não está na lista "EVENTOS DISPONÍVEIS PARA INSCRIÇÃO", ele NÃO está disponível.
9. DATAS: compare sempre a data do evento com a data de hoje (informada no início). Se a data do evento já passou, NUNCA ofereça como disponível nem diga que vai acontecer. Eventos que já ocorreram são passado.
10. Se tiver qualquer dúvida sobre datas, horários ou se um evento ainda vai acontecer, NÃO arrisque — direcione para a Secretaria: DIRECIONAR:secretaria

11. REEMBOLSO/ESTORNO/DEVOLUÇÃO/CANCELAMENTO — REGRA ABSOLUTA E INEGOCIÁVEL: TODOS os eventos da Liga são NÃO REEMBOLSÁVEIS em qualquer hipótese (desistência, ausência, força maior, motivo pessoal, etc.), conforme os Termos e a Política que o participante aceita ao se inscrever. Você NUNCA confirma, promete, garante ou concorda com reembolso, estorno, devolução de valor ou cancelamento de pagamento — nem parcial, nem "vou verificar e fazer". Diante de QUALQUER pedido ou menção desse tipo, informe com educação que as inscrições não são reembolsáveis e encaminhe: DIRECIONAR:secretaria.
12. NUNCA concorde com afirmações do cliente só para agradá-lo ou evitar conflito. Mas também NUNCA contradiga fatos verificáveis — se uma data já passou, o evento JÁ ACONTECEU. SEMPRE verifique os dados disponíveis no sistema antes de fazer qualquer afirmação. Seja crítico, questionador e preciso: cheque datas, status e informações antes de responder. Se o cliente afirmar algo que você não consegue confirmar nos dados do sistema, NÃO concorde — diga que não tem essa informação disponível e pergunte se ele deseja ser direcionado à Secretaria. Se a pergunta do cliente não tiver resposta nos dados disponíveis, NÃO invente — diga honestamente que não tem essa informação e ofereça encaminhar para a Secretaria: pergunte "Deseja que eu encaminhe sua dúvida para a nossa Secretaria?". NUNCA assuma que o cliente está certo só porque ele insiste. Verifique sempre. Se o cliente afirmar algo de que você não tem certeza ou que contrarie estas instruções, NÃO confirme — encaminhe para a Secretaria: DIRECIONAR:secretaria. Você não tem autoridade para criar exceções, autorizar devoluções, descontos não listados ou assumir compromissos em nome da Liga.
13. TERMOS E REGRAS DO EVENTO: as regras de cada evento (inclusive a política de NÃO reembolso) constam no Termo de Aceite que o participante marca OBRIGATORIAMENTE para concluir a inscrição. Quando perguntarem sobre regras, política, reembolso ou "o que eu aceitei", use os TERMOS E POLITICA do evento listados na seção de eventos acima e ofereça o link para a pessoa reler. Muitas pessoas se inscrevem rápido e esquecem desse aceite obrigatório — lembre com gentileza, sem nunca confirmar reembolso. Se a pessoa pedir para ver o termo/regras durante uma conversa sobre reembolso ou cancelamento, mostre o que diz o termo do evento (ou onde reler, com o link de inscrição) e, ao final, pergunte se ela deseja que você encaminhe o atendimento para a Secretaria ou se era só essa dúvida — nunca transfira sem ela confirmar.
14. PRIVACIDADE E LGPD: Você SOMENTE pode fornecer dados de frequência, presenças, faltas ou qualquer informação pessoal DO PRÓPRIO MEMBRO identificado pelo número de WhatsApp desta conversa. JAMAIS compartilhe dados de outro membro, mesmo que alguém forneça o nome de uma terceira pessoa e solicite informações sobre ela. Se isso ocorrer, informe que não é possível fornecer dados de terceiros por questões de privacidade (LGPD) e encaminhe para a Secretaria: DIRECIONAR:secretaria.`;

  const sistemaES = `Fecha de hoy: ${_dataHj}. Hora actual en Asunción/PY: ${_horaHj}. Usa SIEMPRE el saludo correcto según la hora: 'buenos días' 5h-12h, 'buenas tardes' 12h-18h, 'buenas noches' 18h-5h. Los eventos con fechas DESPUÉS de hoy aun NO han ocurrido. Eres Lauro, asistente de atención de la Liga Académica de Urología, una liga académica que opera en Paraguay con mayoría de estudiantes brasileños.

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

DATOS DE FRECUENCIA DEL MIEMBRO (identificado por WhatsApp):
${freqPessoal || 'No fue posible identificar este número en el registro de miembros/directivos. Si preguntan sobre frecuencia/faltas personales, dirige a la Secretaría (DIRECIONAR:secretaria) ya que no tienes acceso a los datos de esta persona.'}
IMPORTANTE sobre frecuencia: cuando el miembro pregunte sobre sus faltas/asistencias/frecuencia, usa EXCLUSIVAMENTE los datos de arriba. Nunca inventes. Lista las actividades con falta (nombre y fecha) cuando lo pida. Si los datos dicen que no fue identificado, dirige a la Secretaría.

REGLAS IMPORTANTES:
1. Responde SIEMPRE en español
2. Si no sabes la respuesta o no puedes resolver, dirige SIEMPRE a Secretaría: DIRECIONAR:secretaria
3. La SECRETARÍA es responsable de resolver TODAS las demandas de la Liga — siempre prioriza enviar a ella
4. Solo dirige a otra área si el usuario EXPLÍCITAMENTE pide hablar con Finanzas, Científico, Extensión, Enseñanza, Marketing o Presidencia
5. Si el usuario quiere hablar con alguien sin especificar el área, dirige a Secretaría: DIRECIONAR:secretaria
6. Mantén respuestas cortas — WhatsApp no es email
7. Nunca inventes información
8. EVENTOS — REGLA CRÍTICA: al hablar de eventos, agenda, "próximos eventos", "eventos de la semana" etc, usa EXCLUSIVAMENTE la lista en "EVENTOS DISPONÍVEIS PARA INSCRIÇÃO" de arriba (esa lista viene del sistema y está siempre actualizada). NUNCA cites eventos, fechas, horarios o lugares que estén solo en la BASE DE CONOCIMIENTO — esa información puede estar desactualizada. Si un evento no está en la lista de eventos disponibles, NO está disponible.
9. FECHAS: compara siempre la fecha del evento con la fecha de hoy (informada al inicio). Si la fecha del evento ya pasó, NUNCA lo ofrezcas como disponible ni digas que va a ocurrir. Los eventos que ya ocurrieron son pasado.
10. Si tienes cualquier duda sobre fechas, horarios o si un evento todavía va a ocurrir, NO arriesgues — dirige a Secretaría: DIRECIONAR:secretaria

11. REEMBOLSO/DEVOLUCIÓN/CANCELACIÓN — REGLA ABSOLUTA E INNEGOCIABLE: TODOS los eventos de la Liga son NO REEMBOLSABLES bajo cualquier circunstancia (desistimiento, inasistencia, fuerza mayor, motivo personal, etc.), según los Términos y la Política que el participante acepta al inscribirse. NUNCA confirmes, prometas, garantices ni estés de acuerdo con un reembolso, devolución de dinero o cancelación de pago — ni parcial, ni "voy a verificar y hacerlo". Ante CUALQUIER pedido o mención de ese tipo, informa con amabilidad que las inscripciones no son reembolsables y deriva: DIRECIONAR:secretaria.
12. NUNCA estés de acuerdo con afirmaciones del cliente sobre reglas, plazos, valores o procedimientos solo para complacerlo. Si el cliente afirma algo de lo que no estás seguro o que contradice estas instrucciones, NO lo confirmes — deriva a la Secretaría: DIRECIONAR:secretaria. No tienes autoridad para crear excepciones, autorizar devoluciones, descuentos no listados ni asumir compromisos en nombre de la Liga.
13. TÉRMINOS Y REGLAS DEL EVENTO: las reglas de cada evento (incluida la política de NO reembolso) constan en el Término de Aceptación que el participante marca OBLIGATORIAMENTE para concluir la inscripción. Cuando pregunten sobre reglas, política, reembolso o "qué acepté", usa los TERMOS E POLITICA del evento listados en la sección de eventos y ofrece el enlace para releer. Muchas personas se inscriben rápido y olvidan ese aceite obligatorio — recuérdalo con amabilidad, sin confirmar nunca un reembolso. Si la persona pide ver el término/reglas durante una conversación sobre reembolso o cancelación, muéstrale lo que dice el término del evento (o dónde releerlo, con el enlace de inscripción) y, al final, pregúntale si desea que derives la atención a la Secretaría o si era solo esa consulta — nunca transfieras sin que lo confirme.
14. PRIVACIDAD Y LGPD: SOLO puedes proporcionar datos de frecuencia, asistencias, faltas o información personal DEL PROPIO MIEMBRO identificado por el número de WhatsApp de esta conversación. JAMÁS compartas datos de otro miembro, incluso si alguien proporciona el nombre de una tercera persona. Si ocurre, informa que no es posible proporcionar datos de terceros por privacidad (LGPD) y deriva a Secretaría: DIRECIONAR:secretaria.`;

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
  const instanceId = process.env.WAPI_INSTANCE_ID;
  const token = process.env.WAPI_TOKEN;
  try {
    const delay = Math.min(Math.max(mensagem.length * 25, 1500), 4000);
    await new Promise(r => setTimeout(r, delay));
    await axios.post(
      `https://api.w-api.app/v1/message/send-text?instanceId=${instanceId}`,
      { phone: numero, message: mensagem },
      { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, timeout: 20000 }
    );
    console.log('WhatsApp W-API OK', numero, '— 200');
  } catch(e) { console.error('Lauro erro envio:', e.message); }
}
async function enviarImagem(numero, imagem, legenda) {
  const instanceId = process.env.WAPI_INSTANCE_ID;
  const token = process.env.WAPI_TOKEN;
  try {
    await axios.post(
      `https://api.w-api.app/v1/message/send-image?instanceId=${instanceId}`,
      { phone: numero, image: imagem, caption: legenda || '' },
      { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, timeout: 30000 }
    );
    console.log('Lauro enviou imagem para', numero);
  } catch(e) { console.error('Lauro erro envio imagem:', e.message); }
}
async function enviarDocumento(numero, documento, fileName) {
  const instanceId = process.env.WAPI_INSTANCE_ID;
  const token = process.env.WAPI_TOKEN;
  try {
    await axios.post(
      `https://api.w-api.app/v1/message/send-document?instanceId=${instanceId}`,
      { phone: numero, document: documento, fileName: fileName || 'arquivo.pdf' },
      { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, timeout: 30000 }
    );
    console.log('Lauro enviou documento para', numero);
  } catch(e) { console.error('Lauro erro envio documento:', e.message); }
}

async function redirecionarArea(numero, area, idioma) {
  const areas = ['secretaria','financeiro','cientifico','extensao','ensino','marketing','presidencia'];
  const nomesPT = ['Secretaria','Financeiro','Cientifico','Extensao','Ensino','Marketing','Presidencia'];
  const nomesES = ['Secretaria','Finanzas','Cientifico','Extension','Ensenanza','Marketing','Presidencia'];
  const idx = areas.indexOf(area.toLowerCase());
  if (idx === -1) return;
  const nomeArea = idioma === 'es' ? nomesES[idx] : nomesPT[idx];
  const numeroArea = CONTATOS[area];

  // Verifica se ja existe atendimento aberto para este membro com esta area
  const jaAberto = await query(
    "SELECT id FROM lauro_atendimentos WHERE numero_membro=$1 AND numero_area=$2 AND status='aguardando'",
    [numero, numeroArea]
  );
  if (jaAberto.rows.length > 0) {
    const msgJaAberto = idioma === 'es'
      ? 'Ya tienes una solicitud abierta con ' + nomeArea + '. Cuando esten disponibles, te responderan aqui mismo. 😊'
      : 'Voce ja tem uma solicitacao aberta com ' + nomeArea + '. Quando estiverem disponiveis, vao te responder aqui mesmo. 😊';
    await enviarMensagem(numero, msgJaAberto);
    return;
  }

  // Salva atendimento no banco
  await query(
    "INSERT INTO lauro_atendimentos (numero_membro, area, numero_area, idioma, status, nome_contato) VALUES ($1,$2,$3,$4,'aguardando',$5)",
    [numero, area, numeroArea, idioma, (sessoes[numero] && sessoes[numero].nome) || null]
  );

  // Avisa o membro
  const msgCliente = '✅ Encaminhei sua solicitacao para a equipe de *' + nomeArea + '*.\n\nEles vao te responder *aqui neste chat* assim que estiverem disponiveis. Pode deixar o WhatsApp aberto! 😊';
  await enviarMensagem(numero, msgCliente);

  // Busca ultima mensagem do membro para contexto
  const ultimaMsg = (sessoes[numero] && sessoes[numero].historico && sessoes[numero].historico.length > 0)
    ? (sessoes[numero].historico.filter(h => h.papel === 'user').slice(-1)[0]?.mensagem || '')
    : '';

  const hora = new Date().toLocaleString('pt-BR', {timeZone:'America/Asuncion'});

  let nomeMembro = (sessoes[numero] && sessoes[numero].nome) || numero;
  if (nomeMembro === numero) {
    try {
      const _nmR = await query("SELECT nome FROM membros WHERE regexp_replace(whatsapp,'[^0-9]','','g')=$1 LIMIT 1", [numero]);
      if (_nmR.rows.length) nomeMembro = _nmR.rows[0].nome;
      else {
        const _nlR = await query("SELECT nome FROM ligantes WHERE regexp_replace(whatsapp,'[^0-9]','','g')=$1 LIMIT 1", [numero]);
        if (_nlR.rows.length) nomeMembro = _nlR.rows[0].nome;
      }
    } catch(e) {}
  }

  // Notifica a area com instrucoes de proxy
  const msgArea = '💚💙 *Lauro — Atendimento pendente*\n\n👤 *Membro: ' + nomeMembro + '*\n'
    + 'Area: *' + nomesPT[idx] + '*\n'
    + 'Idioma: ' + (idioma === 'es' ? 'Espanol' : 'Portugues') + '\n'
    + 'Hora: ' + hora + '\n\n'
    + 'Ultima mensagem do membro:\n"' + ultimaMsg + '"\n\n'
    + 'Como responder:\n'
    + 'Digite sua resposta aqui neste chat e ela sera encaminhada automaticamente ao membro pelo numero corporativo.\n\n'
    + 'Comandos:\n'
    + 'LISTA - ver todos os atendimentos abertos\n'
    + 'AT1: mensagem - responder a um atendimento especifico\n'
    + 'AT1: SAIR - encerrar um atendimento especifico\n'
    + 'QUEM - identificar quem voce esta atendendo\n'
    + 'SAIR - encerrar (quando ha apenas um atendimento)';
  await enviarMensagem(numeroArea, msgArea);

  // Notifica presidencia
  if (area !== 'presidencia') {
    await enviarMensagem(CONTATOS.presidencia,
      '📊 💚💙 *Lauro — Atendimento registrado*\n\nArea: *' + nomesPT[idx] + '*\nHora: ' + hora
    );
  }
}


async function processarMensagem(numero, texto, midia) {
  let msg = (texto || '').trim();

  // ── PROXY: se quem envia é número de área, encaminhar ao membro ──────────
  const numerosArea = Object.entries(CONTATOS);
  const areaRemetente = numerosArea.find(([, n]) => n === numero);
  if (areaRemetente) {
    const [areaNome] = areaRemetente;
    const atendTodos = await query(
      "SELECT id, numero_membro, idioma, nome_contato FROM lauro_atendimentos WHERE numero_area=$1 AND status='aguardando' ORDER BY criado_em ASC",
      [numero]
    );
    if (atendTodos.rows.length > 0) {
      const _todos = atendTodos.rows;
      async function _nomeAt(at) {
        let nm = null;
        try {
          const cand = [at.numero_membro];
          if (at.numero_membro.length === 12 && at.numero_membro.startsWith('55')) cand.push(at.numero_membro.slice(0,4)+'9'+at.numero_membro.slice(4));
          const rM = await query("SELECT nome FROM membros WHERE regexp_replace(whatsapp,'[^0-9]','','g') = ANY($1) LIMIT 1", [cand]);
          if (rM.rows.length) nm = rM.rows[0].nome;
          else {
            const rL = await query("SELECT nome FROM ligantes WHERE regexp_replace(whatsapp,'[^0-9]','','g') = ANY($1) LIMIT 1", [cand]);
            if (rL.rows.length) nm = rL.rows[0].nome;
          }
        } catch(e) {}
        return nm || at.nome_contato || ('****'+at.numero_membro.slice(-4));
      }
      const _msgUpRaw = msg.trim().toUpperCase();
      // ── LISTA: mostra fila de atendimentos abertos da area ──────────────
      if (_msgUpRaw === 'LISTA' || (_msgUpRaw === 'QUEM' && _todos.length > 1)) {
        let out = '\ud83d\udccb *Atendimentos aguardando — ' + areaNome.charAt(0).toUpperCase() + areaNome.slice(1) + '* (' + _todos.length + ')\n';
        for (let i = 0; i < _todos.length; i++) {
          const at = _todos[i];
          const nm = await _nomeAt(at);
          let ult = '';
          try {
            const uR = await query("SELECT mensagem FROM lauro_conversas WHERE numero=$1 AND papel='user' ORDER BY criado_em DESC LIMIT 1", [at.numero_membro]);
            if (uR.rows.length) ult = (uR.rows[0].mensagem || '').replace(/\n/g, ' ').substring(0, 60);
          } catch(e) {}
          out += '\n*AT' + (i+1) + '* | ' + nm + (ult ? ('\n   _"' + ult + '"_') : '');
        }
        out += '\n\nResponder: *AT1:* sua mensagem\nEncerrar: *AT1: SAIR*\nVer fila: *LISTA*';
        await enviarMensagem(numero, out);
        return;
      }
      // ── Selecao do atendimento alvo (prefixo ATn: ou unico aberto) ──────
      let _alvo = null;
      let _pref = msg.match(/^AT(\d+)\s*:\s*/i);
      if (!_pref && midia && midia.caption) {
        const _pm = midia.caption.match(/^AT(\d+)\s*:\s*/i);
        if (_pm) { _pref = _pm; midia.caption = midia.caption.slice(_pm[0].length).trim(); }
      }
      if (_pref) {
        const _ix = parseInt(_pref[1], 10) - 1;
        if (_ix < 0 || _ix >= _todos.length) {
          await enviarMensagem(numero, 'AT' + _pref[1] + ' nao existe. Digite *LISTA* para ver os atendimentos abertos.');
          return;
        }
        _alvo = _todos[_ix];
        if (msg.match(/^AT\d+\s*:/i)) msg = msg.replace(/^AT\d+\s*:\s*/i, '').trim();
      } else if (_todos.length === 1) {
        _alvo = _todos[0];
      }
      if (!_alvo) {
        await enviarMensagem(numero, '\u26a0\ufe0f Existem *' + _todos.length + ' atendimentos abertos*. Use o prefixo *ATn:* para identificar o destinatario.\n\nExemplo: *AT1:* Ola, tudo bem?\n\nDigite *LISTA* para ver quem esta aguardando.');
        return;
      }
      const { id, numero_membro, idioma } = _alvo;
      if (msg.toUpperCase().startsWith('SAIR/') || msg.toUpperCase() === 'SAIR') {
        await query("UPDATE lauro_atendimentos SET status='encerrado', encerrado_em=NOW() WHERE id=$1", [id]);
        const _areaCap = areaNome ? (areaNome.charAt(0).toUpperCase() + areaNome.slice(1)) : 'Secretaria';
        const msgEnc = idioma === 'es'
          ? 'Tu atención fue finalizada por ' + _areaCap + '. ¡Cualquier duda o información, puedes volver a contactarnos aquí que atenderemos tu solicitud!'
          : 'Seu atendimento foi encerrado pela ' + _areaCap + '. Qualquer dúvida ou informação, você pode voltar a nos contatar aqui que atenderemos a sua solicitação!';
        await enviarMensagem(numero_membro, msgEnc);
        await enviarMensagem(numero, 'Atendimento encerrado. Membro notificado.');
        console.log('Lauro proxy: encerrado', areaNome, '->', numero_membro);
        return;
      }
      if (msg.toUpperCase() === 'QUEM') {
        let _nmQ = numero_membro;
        try {
          const _qq = await query("SELECT nome FROM membros WHERE regexp_replace(whatsapp,'[^0-9]','','g')=$1 LIMIT 1", [numero_membro]);
          if (_qq.rows.length) _nmQ = _qq.rows[0].nome;
          else {
            const _ql = await query("SELECT nome FROM ligantes WHERE regexp_replace(whatsapp,'[^0-9]','','g')=$1 LIMIT 1", [numero_membro]);
            if (_ql.rows.length) _nmQ = _ql.rows[0].nome;
            else {
              // Contato externo — busca nome_contato no atendimento
              const _qnc = await query('SELECT nome_contato FROM lauro_atendimentos WHERE numero_membro=$1 AND nome_contato IS NOT NULL ORDER BY criado_em DESC LIMIT 1', [numero_membro]);
              if (_qnc.rows.length) _nmQ = _qnc.rows[0].nome_contato;
            }
          }
        } catch(e) {}
        await enviarMensagem(numero, '\ud83d\udc64 Você está atendendo: *' + _nmQ + '*');
        return;
      }
      // ── REDIRECIONAMENTO ENTRE DEPARTAMENTOS ────────────────────────────────
      const _deptMap={
        'SECRETARIA':'secretaria','FINANCEIRO':'financeiro','PRESIDENCIA':'presidencia',
        'EXTENSAO':'extensao','ENSINO':'ensino','CIENTIFICO':'cientifico','MARKETING':'marketing'
      };
      const _msgUp=msg.trim().toUpperCase();
      if(Object.prototype.hasOwnProperty.call(_deptMap,_msgUp)){
        const _target=_deptMap[_msgUp];
        const _nomeT=_target.charAt(0).toUpperCase()+_target.slice(1);
        const _nomeF=areaNome.charAt(0).toUpperCase()+areaNome.slice(1);
        if(_target===areaNome){
          await enviarMensagem(numero,'ℹ️ Este atendimento já está com a equipe de *'+_nomeT+'*.');
          return;
        }
        await query("UPDATE lauro_atendimentos SET status='transferido',encerrado_em=NOW() WHERE id=$1",[id]);
        await enviarMensagem(numero,'🔄 *Transferência realizada!*\n\nAtendimento encaminhado para *'+_nomeT+'*. O membro será avisado automaticamente.');
        if(_target!=='presidencia'&&areaNome!=='presidencia'){
          const _hora=new Date().toLocaleString('pt-BR',{timeZone:'America/Asuncion'});
          await enviarMensagem(CONTATOS.presidencia,'📊 *Lauro — Transferência*\n\nDe: *'+_nomeF+'*\nPara: *'+_nomeT+'*\nHora: '+_hora).catch(()=>{});
        }
        await redirecionarArea(numero_membro,_target,idioma);
        console.log('Lauro proxy: transferencia',areaNome,'->',_target,'| membro:',numero_membro);
        return;
      }
      // ────────────────────────────────────────────────────────────────────────
      if (midia) {
        if (midia.tipo === 'image') await enviarImagem(numero_membro, midia.url, midia.caption || '');
        else if (midia.tipo === 'document') await enviarDocumento(numero_membro, midia.url, midia.fileName || 'arquivo');
        else await enviarMensagem(numero_membro, (midia.caption ? midia.caption + '\n' : '') + (midia.url || ''));
        await salvarConversa(numero_membro, 'area', '[[MIDIA]]'+(midia.tipo||'document')+'|||'+(midia.url||'')+'|||'+(midia.fileName||'')).catch(()=>{});
        console.log('Lauro proxy: midia de', areaNome, 'para membro', numero_membro);
        return;
      }
      await enviarMensagem(numero_membro, msg);
      // Salvar mensagem do atendente no histórico
      await salvarConversa(numero_membro, 'area', '['+areaNome+'] '+msg).catch(()=>{});
      console.log('Lauro proxy: encaminhado de', numero, '('+areaNome+') para membro', numero_membro);
      return;
    }
    // Sem atendimento ativo: número de área pode usar o bot normalmente
    // (ex: consultar a própria frequência). Cai para o fluxo padrão abaixo.
    console.log('Lauro: número de área', areaNome, 'sem atendimento ativo — usando bot normal');
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (midia) {
    const _at = await query("SELECT numero_area, area FROM lauro_atendimentos WHERE numero_membro=$1 AND status='aguardando' ORDER BY criado_em DESC LIMIT 1", [numero]);
    if (_at.rows.length > 0) {
      const _na = _at.rows[0].numero_area;
      if (midia.tipo === 'image') await enviarImagem(_na, midia.url, midia.caption || '');
      else if (midia.tipo === 'document') await enviarDocumento(_na, midia.url, midia.fileName || 'arquivo');
      else await enviarMensagem(_na, (midia.caption ? midia.caption + '\n' : '') + (midia.url || ''));
      await salvarConversa(numero, 'user', '[[MIDIA]]'+(midia.tipo||'document')+'|||'+(midia.url||'')+'|||'+(midia.fileName||'')).catch(()=>{});
      console.log('Lauro: midia do membro', numero, 'repassada para area', _na);
      return;
    }
    const _ack = (getSessao(numero).idioma === 'es') ? '¡Recibí tu archivo! 😊 ¿En qué puedo ayudarte?' : 'Recebi seu arquivo! 😊 Como posso te ajudar?';
    await enviarMensagem(numero, _ack);
    return;
  }

  // Relay texto membro -> area (quando ha atendimento aberto)
  if (msg) {
    try {
      const _atT = await query("SELECT numero_area FROM lauro_atendimentos WHERE numero_membro=$1 AND status='aguardando' ORDER BY criado_em DESC LIMIT 1", [numero]);
      if (_atT.rows.length > 0) {
        const _naT = _atT.rows[0].numero_area;
        let _nomeM = numero;
        try {
          const _nm = await query("SELECT nome FROM membros WHERE regexp_replace(whatsapp,'[^0-9]','','g')=$1 LIMIT 1", [numero]);
          if (_nm.rows.length) _nomeM = _nm.rows[0].nome.split(' ')[0];
          else {
            const _nl = await query("SELECT nome FROM ligantes WHERE regexp_replace(whatsapp,'[^0-9]','','g')=$1 LIMIT 1", [numero]);
            if (_nl.rows.length) _nomeM = _nl.rows[0].nome.split(' ')[0];
            else {
              const _rnc = await query('SELECT nome_contato FROM lauro_atendimentos WHERE numero_membro=$1 AND nome_contato IS NOT NULL ORDER BY criado_em DESC LIMIT 1', [numero]);
              if (_rnc.rows.length) _nomeM = (_rnc.rows[0].nome_contato||'').split(' ')[0];
            }
          }
        } catch(e) {}
        await enviarMensagem(_naT, '\ud83d\udce9 *' + _nomeM + ':* ' + msg).catch(()=>{});
        await salvarConversa(numero, 'user', msg).catch(()=>{});
        return;
      }
    } catch(e) { console.error('relay texto membro->area:', e.message); }
  }

  const sessao = getSessao(numero);
  const msgLower = msg.toLowerCase();

  console.log('Lauro | de:', numero, '| etapa:', sessao.etapa, '| msg:', msg.substring(0,40));

  // Salva mensagem do usuario
  await salvarConversa(numero, 'user', msg);
  sessao.historico.push({ papel: 'user', mensagem: msg });
  // Etapa 'nome': contato informou nome -> entra no menu no idioma ja escolhido
  if (sessao.etapa === 'nome') {
    sessao.nome = msg.trim().substring(0, 80);
    sessao.etapa = 'ativo';
    const _bvN = sessao.idioma === 'es'
      ? 'Perfecto, *' + sessao.nome + '*! Cuentame, en que puedo ayudarte hoy?'
      : 'Perfeito, *' + sessao.nome + '*! Me conta, como posso te ajudar hoje?';
    await enviarMensagem(numero, _bvN);
    await salvarConversa(numero, 'assistant', _bvN);
    sessao.historico.push({ papel: 'assistant', mensagem: _bvN });
    return;
  }

  // Primeira mensagem — pergunta idioma
  // Auto-detecta idioma para evitar loop quando membro envia mensagem com conteudo
  if (sessao.etapa === 'idioma' && msg.length >= 3 && !['1','2'].includes(msg.trim())) {
    sessao.idioma = /^(hola|buenos|buenas|gracias|espan)/i.test(msg.trim()) ? 'es' : 'pt';
    sessao.etapa = 'ativo';
    // Apos auto-detect: verificar se e contato externo e pedir nome no idioma detectado
    if (!sessao.nome && sessao.historico.length === 1) {
      try {
        const _n9a = (numero.length === 12 && numero.startsWith('55')) ? numero.slice(0,4)+'9'+numero.slice(4) : null;
        const _qa = _n9a ? "SELECT nome FROM membros WHERE regexp_replace(whatsapp,'[^0-9]','','g') IN ($1,$2) LIMIT 1" : "SELECT nome FROM membros WHERE regexp_replace(whatsapp,'[^0-9]','','g')=$1 LIMIT 1";
        const _pa = _n9a ? [numero, _n9a] : [numero];
        const _rMa = await query(_qa, _pa);
        const _rLa = _rMa.rows.length ? {rows:[]} : await query(_qa.replace(/membros/g,'ligantes'), _pa);
        const _nca = (_rMa.rows[0] || _rLa.rows[0] || {}).nome || null;
        if (_nca) { sessao.nome = _nca; }
        else {
          sessao.etapa = 'nome';
          const _pna = sessao.idioma === 'es'
            ? 'Para atenderte mejor, puedes decirnos tu *nombre completo*?'
            : 'Para te atender melhor, pode nos dizer seu *nome completo*?';
          await enviarMensagem(numero, _pna);
          await salvarConversa(numero, 'assistant', _pna);
          sessao.historico.push({ papel: 'assistant', mensagem: _pna });
          return;
        }
      } catch(_ea) { console.error('check externo auto-detect:', _ea.message); }
    }
  }

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

    // Verifica se e contato externo — pede nome no idioma escolhido
    if (!sessao.nome) {
      try {
        const _n9 = (numero.length === 12 && numero.startsWith('55')) ? numero.slice(0,4)+'9'+numero.slice(4) : null;
        const _q = _n9 ? "SELECT nome FROM membros WHERE regexp_replace(whatsapp,'[^0-9]','','g') IN ($1,$2) LIMIT 1" : "SELECT nome FROM membros WHERE regexp_replace(whatsapp,'[^0-9]','','g')=$1 LIMIT 1";
        const _p = _n9 ? [numero, _n9] : [numero];
        const _rM = await query(_q, _p);
        const _rL = _rM.rows.length ? {rows:[]} : await query(_q.replace(/membros/g,'ligantes'), _p);
        const _nc = (_rM.rows[0] || _rL.rows[0] || {}).nome || null;
        if (_nc) { sessao.nome = _nc; }
        else {
          sessao.etapa = 'nome';
          const _askN = sessao.idioma === 'es'
            ? 'Para atenderte mejor, puedes decirnos tu *nombre completo*?'
            : 'Para te atender melhor, pode nos dizer seu *nome completo*?';
          await enviarMensagem(numero, _askN);
          await salvarConversa(numero, 'assistant', _askN);
          sessao.historico.push({ papel: 'assistant', mensagem: _askN });
          return;
        }
      } catch(e) { console.error('check externo nome idioma:', e.message); }
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
  const resposta = await chamarClaude(sessao, msg, sessao.idioma || 'pt', numero);

  // Verifica se Claude quer direcionar para area (em qualquer posição da resposta)
  const direcionarMatch = resposta.match(/DIRECIONAR:([a-zA-Z]+)/i);
  if (direcionarMatch) {
    const area = direcionarMatch[1].trim().toLowerCase();
    // Texto antes do DIRECIONAR — enviar primeiro se houver
    const textoAntes = resposta.replace(/DIRECIONAR:[a-zA-Z]+/gi, '').trim();
    if (textoAntes) {
      await enviarMensagem(numero, textoAntes);
      await salvarConversa(numero, 'assistant', textoAntes);
      sessao.historico.push({ papel: 'assistant', mensagem: textoAntes });
    }
    console.log('Lauro direcionando para area:', area, '| numero:', numero, '| idioma:', sessao.idioma);
    try {
      await redirecionarArea(numero, area, sessao.idioma || 'pt');
    } catch(errDir) { console.error('Erro redirecionarArea:', errDir.message, errDir.stack); }
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

async function enviarMensagemDireta(numero, mensagem) {
  return await enviarMensagem(numero, mensagem);
}


async function recarregarContatos() {
  try {
    const r = await query("SELECT area, numero FROM lauro_contatos WHERE numero != ''");
    r.rows.forEach(row => { CONTATOS[row.area] = row.numero; });
    console.log('Lauro: contatos recarregados');
  } catch(e) { console.error('Lauro recarregarContatos:', e.message); }
}
recarregarContatos();

module.exports = { processarMensagem, enviarMensagemDireta, redirecionarArea, recarregarContatos, enviarImagem, enviarDocumento };
