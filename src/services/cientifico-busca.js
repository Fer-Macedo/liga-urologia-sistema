// Busca de literatura cientifica real (PubMed + Semantic Scholar, ambas APIs publicas e
// gratuitas) combinada com o Claude para sintese/polimento — reproduz o efeito do
// Elicit (busca + sintese), ResearchRabbit (artigos relacionados) e Writefull (polimento),
// sem depender de assinatura paga de nenhuma dessas ferramentas.
const axios = require('axios');
const { chamarClaudeTexto } = require('./cientifico-ia');

// PubMed indexa titulos/resumos quase exclusivamente em ingles. Uma busca em portugues
// nao falha com erro - o "term mapping" automatico do NCBI so tenta encaixar cada palavra
// (ex: "de" vira "drug effects", "em" vira "embryology") e combina tudo com AND, entao
// praticamente nunca acha nada. Por isso traduzimos o termo para ingles antes de buscar.
async function traduzirTermoBusca(query, termo) {
  try {
    const prompt = `Traduza o termo de busca cientifica abaixo do portugues para o ingles, em linguagem simples e objetiva, adequada para busca no PubMed (sem aspas, sem explicacao, responda so com o termo traduzido em uma linha):\n\n${termo}`;
    const r = await chamarClaudeTexto(query, { prompt, contexto: 'cientifico-busca-traducao', maxTokens: 60 });
    if (r.ok && r.texto) return r.texto.trim().replace(/^["']|["']$/g, '');
  } catch (e) { console.error('traduzirTermoBusca erro:', e.message); }
  return termo;
}

// Busca artigos reais no PubMed (NCBI E-utilities, gratuito, sem chave obrigatoria)
async function buscarPubMed(query, termo, limite) {
  limite = limite || 8;
  try {
    const termoIngles = await traduzirTermoBusca(query, termo);
    const searchResp = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', {
      params: { db: 'pubmed', term: termoIngles, retmax: limite, retmode: 'json', sort: 'relevance' },
      timeout: 15000
    });
    const ids = (searchResp.data.esearchresult && searchResp.data.esearchresult.idlist) || [];
    if (!ids.length) return { ok: true, artigos: [], termo_traduzido: termoIngles };
    const summaryResp = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi', {
      params: { db: 'pubmed', id: ids.join(','), retmode: 'json' },
      timeout: 15000
    });
    const result = summaryResp.data.result || {};
    const artigos = ids.map(id => {
      const a = result[id];
      if (!a) return null;
      return {
        pmid: id,
        titulo: a.title || '',
        autores: (a.authors || []).slice(0, 3).map(x => x.name).join(', ') + ((a.authors || []).length > 3 ? ' et al.' : ''),
        revista: a.fulljournalname || a.source || '',
        ano: (a.pubdate || '').split(' ')[0] || '',
        link: 'https://pubmed.ncbi.nlm.nih.gov/' + id + '/'
      };
    }).filter(Boolean);
    return { ok: true, artigos, termo_traduzido: termoIngles };
  } catch(e) {
    console.error('buscarPubMed erro:', e.message);
    return { ok: false, erro: 'Nao foi possivel buscar no PubMed agora.' };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Artigos relacionados via Semantic Scholar (API publica e gratuita)
// O tier sem chave de API e compartilhado por todo mundo e esbarra em 429 (Too Many
// Requests) com frequencia - nao e um erro do nosso lado. Tenta novamente com pausas
// crescentes antes de desistir.
async function artigosRelacionados(termo, limite) {
  limite = limite || 8;
  const ATRASOS = [0, 3000, 7000];
  let ultimoErro = null;
  for (const atraso of ATRASOS) {
    if (atraso) await sleep(atraso);
    try {
      const searchResp = await axios.get('https://api.semanticscholar.org/graph/v1/paper/search', {
        params: { query: termo, limit: limite, fields: 'title,authors,year,venue,externalIds,abstract' },
        timeout: 15000,
        headers: process.env.SEMANTIC_SCHOLAR_API_KEY ? { 'x-api-key': process.env.SEMANTIC_SCHOLAR_API_KEY } : {}
      });
      const artigos = (searchResp.data.data || []).map(p => ({
        titulo: p.title || '',
        autores: (p.authors || []).slice(0, 3).map(a => a.name).join(', ') + ((p.authors || []).length > 3 ? ' et al.' : ''),
        revista: p.venue || '',
        ano: p.year || '',
        link: p.externalIds && p.externalIds.DOI ? 'https://doi.org/' + p.externalIds.DOI : (p.externalIds && p.externalIds.PubMed ? 'https://pubmed.ncbi.nlm.nih.gov/' + p.externalIds.PubMed + '/' : '')
      }));
      return { ok: true, artigos };
    } catch(e) {
      ultimoErro = e;
      if (e.response && e.response.status === 429) continue; // tenta de novo
      break; // outro tipo de erro, nao adianta insistir
    }
  }
  const e = ultimoErro;
  console.error('artigosRelacionados erro:', e && e.message);
  const foi429 = e && e.response && e.response.status === 429;
  return {
    ok: false,
    erro: foi429
      ? 'O servico de artigos relacionados esta sobrecarregado no momento (limite da API gratuita). Tente novamente em 1 minuto.'
      : 'Nao foi possivel buscar artigos relacionados agora.'
  };
}

// Usa o Claude para sintetizar os achados de uma lista de artigos reais (titulo/autores/ano)
async function sintetizarAchados(query, { tema, artigos }) {
  const listaTexto = artigos.map((a, i) => `${i + 1}. ${a.titulo} (${a.autores}, ${a.ano}, ${a.revista})`).join('\n');
  const prompt = `Voce e um assistente de revisao de literatura cientifica. Com base APENAS na lista de artigos abaixo (titulo, autores e ano — sem acesso ao texto completo), escreva uma sintese curta (max 150 palavras) em portugues sobre o que essa lista sugere em relacao ao tema "${tema}": padroes, lacunas ou direcoes de pesquisa aparentes pelos titulos. Seja honesto sobre a limitacao de nao ter lido o conteudo completo dos artigos.\n\nArtigos encontrados:\n${listaTexto}`;
  return await chamarClaudeTexto(query, { prompt, contexto: 'cientifico-sintese-literatura', maxTokens: 400 });
}

// Poli o texto cientifico (equivalente ao Writefull) e sugere titulo
async function polirTexto(query, texto) {
  const prompt = `Voce e um editor de texto cientifico especializado (equivalente a ferramentas como Writefull). Reescreva o texto abaixo em tom cientifico formal, impessoal, com frases curtas (15-20 palavras) e paragrafos de 3-5 frases, mantendo o significado original. Depois sugira 2 opcoes de titulo cientifico para esse trecho.\n\nResponda em JSON estrito, sem texto fora do JSON:\n{"texto_polido": "...", "sugestoes_titulo": ["...", "..."]}\n\nTexto original:\n${texto}`;
  const r = await chamarClaudeTexto(query, { prompt, contexto: 'cientifico-polidor', maxTokens: 1200 });
  if (!r.ok) return r;
  try {
    const parsed = JSON.parse(r.texto.replace(/```json|```/g, '').trim());
    return { ok: true, resultado: parsed };
  } catch(e) {
    return { ok: false, erro: 'Resposta da IA em formato inesperado.' };
  }
}

module.exports = { buscarPubMed, artigosRelacionados, sintetizarAchados, polirTexto };
