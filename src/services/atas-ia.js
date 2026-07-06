// Transcricao e resumo de reunioes gravadas — usado na tela de Atas de Reuniao.
// Transcricao de audio: OpenAI Whisper API (Claude nao aceita audio diretamente).
// Resumo/redacao da ata: Claude (Anthropic), reaproveitando o mesmo padrao dos outros modulos de IA.
const axios = require('axios');
const FormData = require('form-data');

const MODEL_CLAUDE = 'claude-sonnet-4-5';
const CUSTO_ENTRADA_POR_1K = 0.003;
const CUSTO_SAIDA_POR_1K = 0.015;

async function transcreverAudio(buffer, filename, mimetype) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, erro: 'Transcricao de audio nao configurada (falta OPENAI_API_KEY).' };
  try {
    const form = new FormData();
    form.append('file', buffer, { filename: filename || 'audio.webm', contentType: mimetype || 'audio/webm' });
    form.append('model', 'whisper-1');
    form.append('language', 'pt');
    const resp = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${apiKey}` },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 300000
    });
    return { ok: true, texto: resp.data.text || '' };
  } catch (e) {
    console.error('atas-ia transcricao erro:', e.response ? JSON.stringify(e.response.data).substring(0,300) : e.message);
    return { ok: false, erro: 'Nao foi possivel transcrever o audio agora. Tente novamente.' };
  }
}

const SISTEMA_ATA = `Voce e um secretario que redige atas de reuniao da LAURO (Liga Academica de Urologia) a partir da transcricao de uma gravacao real da reuniao. A transcricao pode ter erros de reconhecimento de fala, hesitacoes e repeticoes — use o bom senso para interpretar o sentido, mas NUNCA invente decisoes, nomes ou numeros que nao estejam na transcricao.

Gere dois campos a partir da transcricao:
- "pauta": lista numerada dos temas realmente tratados na reuniao, na ordem em que apareceram (use apenas o que foi de fato discutido, nao um modelo generico).
- "corpo": o desenvolvimento da ata em paragrafos corridos, organizados por tema, em tom formal de ata (terceiro pessoa, ex: "O Presidente informou que..."), cobrindo os pontos discutidos, decisoes tomadas e responsaveis quando mencionados.

Se a transcricao for curta demais ou nao parecer uma reuniao, diga isso no campo "corpo" em vez de inventar conteudo.

Responda em portugues, em JSON estrito, sem texto fora do JSON:
{ "pauta": "1. ...\\n2. ...", "corpo": "texto corrido..." }`;

async function gerarAtaDeTranscricao(query, { transcricao, tipoReuniao }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, erro: 'Assistente de IA nao configurado.' };
  try {
    const resp = await axios.post('https://api.anthropic.com/v1/messages', {
      model: MODEL_CLAUDE,
      max_tokens: 2000,
      system: SISTEMA_ATA,
      messages: [{ role: 'user', content: `Tipo de reuniao: ${tipoReuniao||'ordinaria'}. Transcricao da gravacao:\n\n${transcricao}` }]
    }, {
      headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': apiKey },
      timeout: 60000
    });
    const texto = resp.data.content && resp.data.content[0] ? resp.data.content[0].text : '';
    try {
      const uso = resp.data.usage || {};
      const tIn = uso.input_tokens || 0, tOut = uso.output_tokens || 0;
      const custo = (tIn * CUSTO_ENTRADA_POR_1K / 1000) + (tOut * CUSTO_SAIDA_POR_1K / 1000);
      await query('INSERT INTO anthropic_uso (contexto,modelo,tokens_entrada,tokens_saida,custo_estimado) VALUES ($1,$2,$3,$4,$5)',
        [ 'atas-transcricao', MODEL_CLAUDE, tIn, tOut, custo ]);
    } catch(e) {}
    const parsed = JSON.parse(texto.replace(/```json|```/g, '').trim());
    return { ok: true, pauta: parsed.pauta || '', corpo: parsed.corpo || '' };
  } catch (e) {
    console.error('atas-ia geracao erro:', e.response ? JSON.stringify(e.response.data).substring(0,300) : e.message);
    return { ok: false, erro: 'Nao foi possivel gerar a ata a partir da transcricao agora.' };
  }
}

module.exports = { transcreverAudio, gerarAtaDeTranscricao };
