// Transcricao e resumo de reunioes gravadas — usado na tela de Atas de Reuniao.
// Transcricao de audio: OpenAI Whisper API (Claude nao aceita audio diretamente).
// Resumo/redacao da ata: Claude (Anthropic), reaproveitando o mesmo padrao dos outros modulos de IA.
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const MODEL_CLAUDE = 'claude-sonnet-4-5';
const CUSTO_ENTRADA_POR_1K = 0.003;
const CUSTO_SAIDA_POR_1K = 0.015;
const LIMITE_WHISPER_BYTES = 25 * 1024 * 1024; // limite real da API

// Comprime o audio para mp3 mono em baixa taxa (voz nao perde inteligibilidade abaixo de
// 25MB, mesmo em gravacoes longas) - resolve o limite de 25MB do Whisper e normaliza
// formatos variados (webm do navegador, m4a do iPhone, etc) num unico formato aceito.
function comprimirAudio(buffer, filename) {
  return new Promise((resolve) => {
    const tmpIn = path.join(os.tmpdir(), `ata-audio-in-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(filename||'')||'.dat'}`);
    const tmpOut = tmpIn + '.mp3';
    fs.writeFile(tmpIn, buffer, (errW) => {
      if (errW) { console.error('[atas-ia] comprimirAudio: erro ao escrever tmp:', errW.message); return resolve(null); }
      execFile('ffmpeg', ['-y', '-i', tmpIn, '-ac', '1', '-ar', '16000', '-b:a', '32k', tmpOut], { timeout: 280000 }, (errC, stdout, stderr) => {
        fs.unlink(tmpIn, () => {});
        if (errC) {
          console.error('[atas-ia] comprimirAudio: ffmpeg falhou:', errC.message, '| stderr:', (stderr||'').slice(-500));
          fs.unlink(tmpOut, () => {});
          return resolve(null);
        }
        fs.readFile(tmpOut, (errR, data) => {
          fs.unlink(tmpOut, () => {});
          if (errR) { console.error('[atas-ia] comprimirAudio: erro ao ler saida:', errR.message); return resolve(null); }
          console.log('[atas-ia] comprimirAudio: ok,', buffer.length, '->', data.length, 'bytes');
          resolve(data);
        });
      });
    });
  });
}

async function transcreverAudio(buffer, filename, mimetype) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, erro: 'Transcricao de audio nao configurada (falta OPENAI_API_KEY).' };
  try {
    let envioBuffer = buffer, envioNome = filename || 'audio.webm', envioMime = mimetype || 'audio/webm';
    // Sempre comprime: normaliza formato e evita estourar o limite de 25MB do Whisper,
    // mesmo em gravacoes longas. Se a compressao falhar por algum motivo, envia o original.
    const comprimido = await comprimirAudio(buffer, filename);
    if (comprimido && comprimido.length > 0) {
      envioBuffer = comprimido;
      envioNome = 'audio-comprimido.mp3';
      envioMime = 'audio/mpeg';
    } else if (buffer.length > LIMITE_WHISPER_BYTES) {
      return { ok: false, erro: 'O audio e muito grande (acima de 25MB) e nao foi possivel comprimir automaticamente. Tente um arquivo menor ou grave em qualidade mais baixa.' };
    }
    const form = new FormData();
    form.append('file', envioBuffer, { filename: envioNome, contentType: envioMime });
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

const SISTEMA_ATA = `Voce e um secretario experiente que redige atas de reuniao da LAURO (Liga Academica de Urologia) a partir da transcricao bruta (fiel, palavra por palavra) de uma gravacao real. A transcricao tem erros de reconhecimento de fala, hesitacoes ("eh", "ne", "entao"), repeticoes, frases incompletas e desvios de assunto — seu trabalho e reescrever tudo isso em uma ATA de verdade, NUNCA entregar a transcricao literal ou quase literal.

REGRAS OBRIGATORIAS DE REDACAO:
- Nunca copie frases inteiras da transcricao. Reescreva cada ideia com suas proprias palavras, em portugues formal e correto, corrigindo gramatica e pontuacao.
- Remova hesitacoes, repeticoes, vicios de linguagem e desvios de assunto sem importancia.
- Agrupe o conteudo POR TEMA (nao por ordem cronologica literal de fala) — se um assunto foi comentado em varios momentos espalhados da reuniao, junte tudo num unico paragrafo coerente sobre aquele tema.
- Condense: se algo foi dito de forma longa e repetitiva, resuma no essencial (a decisao, o motivo, o responsavel), sem perder informacao real.
- Escreva em terceira pessoa e tom formal de ata (ex: "O Presidente informou que...", "Foi decidido que...", "Ficou definido que [responsavel] ira...").
- Preserve QUALQUER decisao, numero, data, nome ou valor mencionado — nunca invente, mas tambem nunca omita um fato concreto so para encurtar.

Gere dois campos a partir da transcricao:
- "pauta": lista numerada dos temas realmente tratados na reuniao (um item por tema, nao por frase) — use apenas o que foi de fato discutido, nao um modelo generico.
- "corpo": o desenvolvimento da ata em paragrafos corridos, um paragrafo por tema da pauta, seguindo as regras de redacao acima.

Se a transcricao for curta demais ou nao parecer uma reuniao, diga isso no campo "corpo" em vez de inventar conteudo.

Responda em portugues, em JSON estrito, sem texto fora do JSON:
{ "pauta": "1. ...\\n2. ...", "corpo": "texto corrido..." }`;

async function gerarAtaDeTranscricao(query, { transcricao, tipoReuniao }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, erro: 'Assistente de IA nao configurado.' };
  try {
    const resp = await axios.post('https://api.anthropic.com/v1/messages', {
      model: MODEL_CLAUDE,
      max_tokens: 4000,
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
