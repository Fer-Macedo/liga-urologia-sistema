// Assistente de IA do Portal Cientifico — revisao pre-submissao, PICO e sugestao de periodico.
// Reaproveita a mesma integracao Anthropic (Claude) ja usada no assistente virtual (lauro.js),
// registrando o custo na mesma tabela anthropic_uso.
const axios = require('axios');

const MODEL = 'claude-sonnet-4-5';
const CUSTO_ENTRADA_POR_1K = 0.003;
const CUSTO_SAIDA_POR_1K = 0.015;

async function chamarClaude(query, { system, content, contexto, maxTokens }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, erro: 'Assistente de IA nao configurado.' };
  try {
    const resp = await axios.post('https://api.anthropic.com/v1/messages', {
      model: MODEL,
      max_tokens: maxTokens || 1200,
      system,
      messages: [{ role: 'user', content }]
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

// Wrapper simples de texto-para-texto, reutilizado por outros modulos do Cientifico (ex: busca de literatura)
async function chamarClaudeTexto(query, { prompt, contexto, maxTokens }) {
  return await chamarClaude(query, { system: 'Voce e um assistente cientifico objetivo e honesto.', content: prompt, contexto, maxTokens });
}

module.exports = { revisarTrabalho, refinarPico, chamarClaudeTexto };
