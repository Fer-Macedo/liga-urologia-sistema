// Assistente de IA do Portal Cientifico — revisao pre-submissao, PICO e sugestao de periodico.
// Reaproveita a mesma integracao Anthropic (Claude) ja usada no assistente virtual (lauro.js),
// registrando o custo na mesma tabela anthropic_uso.
const axios = require('axios');

const MODEL = 'claude-sonnet-4-5';
const CUSTO_ENTRADA_POR_1K = 0.003;
const CUSTO_SAIDA_POR_1K = 0.015;

// `messages` (opcional) permite conversa com historico; sem ele, mantem o
// comportamento antigo de uma unica mensagem via `content`.
async function chamarClaude(query, { system, content, contexto, maxTokens, messages }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, erro: 'Assistente de IA nao configurado.' };
  try {
    const resp = await axios.post('https://api.anthropic.com/v1/messages', {
      model: MODEL,
      max_tokens: maxTokens || 1200,
      system,
      messages: messages || [{ role: 'user', content }]
    }, {
      headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': apiKey },
      timeout: 45000
    });
    const texto = resp.data.content && resp.data.content[0] ? resp.data.content[0].text : '';
    try {
      const uso = resp.data.usage || {};
      const tIn = uso.input_tokens || 0, tOut = uso.output_tokens || 0;
      const custo = (tIn * CUSTO_ENTRADA_POR_1K / 1000) + (tOut * CUSTO_SAIDA_POR_1K / 1000);
      await query('INSERT INTO anthropic_uso (contexto,modelo,tokens_entrada,tokens_saida,custo_estimado) VALUES ($1,$2,$3,$4,$5)',
        [contexto, MODEL, tIn, tOut, custo]);
    } catch(e) {}
    return { ok: true, texto };
  } catch(e) {
    console.error('cientifico-ia erro:', e.response ? JSON.stringify(e.response.data).substring(0,300) : e.message);
    return { ok: false, erro: 'Nao foi possivel completar a analise agora. Tente novamente em instantes.' };
  }
}

const SISTEMA_REVISAO = `Voce e um revisor cientifico senior, treinado com base numa aula de produção cientifica de residencia medica. Sua funcao e dar um pre-check em um trabalho ANTES de ser submetido a equipe do Cientifico da Liga Academica de Urologia (LAURO) — voce NAO substitui a correcao humana, apenas ajuda o autor a chegar com o trabalho mais redondo.

Avalie o documento usando estes criterios (todos vindos da aula "Producao Cientifica: como escrever e publicar artigos medicos"):
- Estrutura IMRaD (Introducao, Metodos, Resultados, Discussao) esta completa e na ordem certa?
- Introducao mostra claramente a lacuna cientifica e a justificativa?
- Metodologia: criterios de inclusao/exclusao objetivos, calculo amostral presente, aprovacao do CEP mencionada?
- Resultados: valores de p vem acompanhados de IC95%? Ha fluxograma CONSORT/PRISMA se aplicavel?
- Discussao: comeca pelo achado principal, compara com a literatura, discute limitacoes e nao repete os resultados?
- Erros classicos: tratar "tendencia" para p>0,05, confundir correlacao com causalidade, titulo vago, resumo fora da estrutura classica.
- Referencias: estilo consistente (Vancouver e o padrao em saude).

REGRAS OBRIGATORIAS PARA EVITAR RESPOSTAS GENERICAS:
- Baseie cada ponto SOMENTE no que esta escrito de fato no documento enviado. Nunca suponha, invente ou generalize algo que nao esteja no texto.
- Cada item em "pontos_fortes" e "pontos_atencao" deve citar ou parafrasear um trecho especifico do documento (ex: "a secao de metodologia nao menciona calculo amostral" — nao "geralmente e importante calcular a amostra").
- Se um criterio nao puder ser avaliado por falta de informacao no documento, diga isso explicitamente (ex: "nao foi possivel verificar X pois o documento nao aborda isso") em vez de assumir.
- Nunca de conselhos genericos de "boas praticas cientificas" desconectados do conteudo real do documento avaliado.

Responda em portugues, em formato JSON estrito, sem nenhum texto fora do JSON, neste formato exato:
{
  "resumo": "1-2 frases resumindo o estado geral do trabalho",
  "pontos_fortes": ["..."],
  "pontos_atencao": ["..."],
  "estrutura_imrad": { "introducao": "ok|atencao|ausente", "metodos": "ok|atencao|ausente", "resultados": "ok|atencao|ausente", "discussao": "ok|atencao|ausente" },
  "sugestao_periodicos": ["nome de periodico 1", "nome de periodico 2"]
}
Se o documento nao parecer um trabalho cientifico, responda com pontos_atencao explicando isso e os demais campos vazios.`;

// Analisa um trabalho (PDF em base64) e devolve feedback estruturado antes da submissao oficial
async function revisarTrabalho(query, { base64Pdf, tituloProjeto, tipoTrabalho }) {
  const content = [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
    { type: 'text', text: `Projeto: ${tituloProjeto || 'sem titulo'}. Tipo de trabalho: ${tipoTrabalho || 'nao informado'}. Avalie este documento.` }
  ];
  const r = await chamarClaude(query, { system: SISTEMA_REVISAO, content, contexto: 'cientifico-revisor', maxTokens: 1500 });
  if (!r.ok) return r;
  try {
    const parsed = JSON.parse(r.texto.replace(/```json|```/g, '').trim());
    return { ok: true, revisao: parsed };
  } catch(e) {
    return { ok: false, erro: 'Resposta da IA em formato inesperado.' };
  }
}

const SISTEMA_PICO = `Voce ajuda pesquisadores a estruturar a pergunta de pesquisa no formato PICO (Population, Intervention, Comparison, Outcome), como ensinado na aula de producao cientifica da residencia medica. Dado um resumo livre da ideia do estudo, devolva em portugues, em JSON estrito, sem texto fora do JSON:
{
  "populacao": "...",
  "intervencao": "...",
  "comparacao": "...",
  "desfecho": "...",
  "pergunta_formatada": "uma frase unica, em linguagem cientifica, juntando os 4 elementos como pergunta de pesquisa"
}
Se a comparacao nao se aplicar ao desenho do estudo (ex: estudo descritivo), diga isso no campo comparacao em vez de inventar.`;

// Refina uma ideia de pesquisa em linguagem livre para o formato PICO
async function refinarPico(query, { ideiaLivre }) {
  const r = await chamarClaude(query, { system: SISTEMA_PICO, content: ideiaLivre, contexto: 'cientifico-pico', maxTokens: 500 });
  if (!r.ok) return r;
  try {
    const parsed = JSON.parse(r.texto.replace(/```json|```/g, '').trim());
    return { ok: true, pico: parsed };
  } catch(e) {
    return { ok: false, erro: 'Resposta da IA em formato inesperado.' };
  }
}

const SISTEMA_APOIO_REVISOR = `Voce e um assistente que da apoio TECNICO a um revisor humano da equipe Cientifica da LAURO (Liga Academica de Urologia), que vai decidir se aprova ou devolve um trabalho cientifico. Voce NAO decide nada — sua funcao e levantar pontos objetivos para o revisor considerar, com base na aula "Producao Cientifica: como escrever e publicar artigos medicos".

Avalie o documento nestes eixos:
1. Perguntas essenciais de qualidade: O objetivo esta claro? A metodologia e adequada? A amostra parece suficiente? Ha indicio de vies? A analise estatistica parece correta? Os resultados respondem a pergunta de pesquisa?
2. Pontos criticos pelo desenho do estudo (identifique o desenho e aponte o risco especifico): Coorte -> perda de seguimento; Caso-controle -> vies de memoria; Transversal -> confundir associacao com causalidade; Ensaio clinico (RCT) -> intention-to-treat vs. por protocolo.
3. Documentacao etica: ha mencao a aprovacao de CEP, numero CAAE ou TCLE no texto? Se for ensaio clinico, ha registro (ReBEC/ClinicalTrials.gov)?
4. Relato estatistico: valores de p aparecem acompanhados de IC95%? Ha fluxograma CONSORT/PRISMA quando aplicavel?
5. Erros classicos que costumam reprovar manuscritos (cheque se aparecem): calculo amostral ausente, discussao que so repete os resultados, introducao sem lacuna clara, titulo vago.

REGRAS OBRIGATORIAS PARA EVITAR RESPOSTAS GENERICAS:
- Fundamente cada afirmacao SOMENTE no conteudo real do documento enviado. Nunca suponha, generalize ou invente algo que nao esteja escrito no texto.
- Em "alertas" e no "resumo_para_revisor", cite ou parafraseie trechos concretos do documento (ex: "a secao de metodos nao cita numero de CAAE" — nao "e importante ter aprovacao etica").
- Se um item nao puder ser avaliado por falta de informacao no proprio documento, use o valor apropriado (ex: "nao_se_aplica" ou explique a limitacao) em vez de supor.
- Nao ofereca opiniao sobre o merito cientifico da pesquisa (isso e decisao do revisor humano) — apenas aponte fatos objetivos e verificaveis no texto.

Responda em portugues, em JSON estrito, sem texto fora do JSON:
{
  "desenho_estudo_identificado": "ex: coorte retrospectiva, caso-controle, transversal, RCT, serie de casos, revisao...",
  "risco_especifico_desenho": "o ponto critico relevante para esse desenho, conforme os pontos 2 acima",
  "qualidade": { "objetivo_claro": "sim|nao|parcial", "metodologia_adequada": "sim|nao|parcial", "amostra_suficiente": "sim|nao|parcial", "indicio_vies": "sim|nao|parcial", "estatistica_correta": "sim|nao|parcial", "resultados_respondem_pergunta": "sim|nao|parcial" },
  "documentacao_etica": "presente|ausente|nao_se_aplica",
  "relato_estatistico_ok": "sim|nao|nao_se_aplica",
  "alertas": ["lista curta de pontos que merecem atencao do revisor antes de decidir"],
  "resumo_para_revisor": "2-3 frases resumindo o estado geral, em tom neutro, para apoiar (nao substituir) a decisao humana"
}`;

// Gera um apoio tecnico para o revisor humano (equipe Cientifica) antes de aprovar/devolver
async function apoioRevisor(query, { base64Pdf, tituloProjeto, tipoTrabalho }) {
  const content = [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
    { type: 'text', text: `Projeto: ${tituloProjeto || 'sem titulo'}. Tipo de trabalho: ${tipoTrabalho || 'nao informado'}. Gere o apoio tecnico para o revisor.` }
  ];
  const r = await chamarClaude(query, { system: SISTEMA_APOIO_REVISOR, content, contexto: 'cientifico-apoio-revisor', maxTokens: 1200 });
  if (!r.ok) return r;
  try {
    const parsed = JSON.parse(r.texto.replace(/```json|```/g, '').trim());
    return { ok: true, apoio: parsed };
  } catch(e) {
    return { ok: false, erro: 'Resposta da IA em formato inesperado.' };
  }
}

// Wrapper simples de texto-para-texto, reutilizado por outros modulos do Cientifico (ex: busca de literatura)
async function chamarClaudeTexto(query, { prompt, contexto, maxTokens }) {
  return await chamarClaude(query, { system: 'Voce e um assistente cientifico objetivo e honesto.', content: prompt, contexto, maxTokens });
}

// ── Leitura de cartao de resposta (OMR) por foto ────────────────────────────
const SISTEMA_OMR = `Você lê CARTÕES DE RESPOSTA (hoja de respuestas / gabarito OMR) de provas de múltipla escolha a partir de uma FOTO. Cada questão está numerada e tem bolhas com as letras A, B, C, D. A bolha MARCADA é a que está preenchida/escurecida (coberta a caneta ou lápis).

Sua tarefa: para cada questão de 1 até N, identificar qual letra foi marcada.
Regras rígidas:
- Retorne APENAS a letra da bolha realmente preenchida (A, B, C ou D).
- Se NENHUMA bolha estiver preenchida na questão, retorne null.
- Se houver MAIS DE UMA preenchida (rasura/dúbio), retorne null.
- NUNCA invente: em qualquer dúvida, retorne null.
- Ignore as letras impressas dentro das bolhas — o que importa é qual bolha está pintada por cima.

Além das questões, leia também:
- FILA: no bloco "Conjunto de examen" há bolhas A, B, C — retorne a letra da que estiver PREENCHIDA. Se nada preenchido, use o valor escrito em "PRUEBA FILA".
- NÚMERO DE REGISTRO: um bloco com 3 colunas de bolhas 0-9. Em cada coluna há UM dígito preenchido. Leia as 3 colunas da esquerda para a direita e forme o número de 3 dígitos (ex.: "047"). Se não der pra ler com certeza, retorne null.
- INCERTAS: liste os números das questões em que você NÃO teve certeza absoluta da marcação (bolha fraca, rasura, dúvida) — para revisão humana.

Responda em JSON ESTRITO, sem nenhum texto fora do JSON, exatamente neste formato:
{ "fila": "A|B|C ou null", "numero_registro": "3 dígitos como texto (ex: 047) ou null", "respostas": { "1": "A", "2": null, "3": "C" }, "incertas": [10, 14] }
Inclua TODAS as questões de 1 até N no objeto respostas, mesmo as que forem null.`;

async function lerCartaoResposta(query, { base64Img, mediaType, totalQuestoes }) {
  const content = [
    { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: base64Img } },
    { type: 'text', text: 'Este cartão tem ' + totalQuestoes + ' questões (numeradas de 1 a ' + totalQuestoes + '). Leia as bolhas preenchidas e devolva o JSON.' }
  ];
  const r = await chamarClaude(query, { system: SISTEMA_OMR, content, contexto: 'ps-cartao-omr', maxTokens: 1500 });
  if (!r.ok) return r;
  try {
    const parsed = JSON.parse(r.texto.replace(/```json|```/g, '').trim());
    return { ok: true, leitura: parsed };
  } catch(e) {
    return { ok: false, erro: 'Não consegui interpretar o cartão. Tente uma foto mais nítida e reta.' };
  }
}

module.exports = { revisarTrabalho, refinarPico, chamarClaudeTexto, apoioRevisor, lerCartaoResposta, chamarClaude };
