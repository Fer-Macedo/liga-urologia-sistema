// Busca de literatura cientifica real (PubMed + Semantic Scholar, ambas APIs publicas e
// gratuitas) combinada com o Claude para sintese/polimento — reproduz o efeito do
// Elicit (busca + sintese), ResearchRabbit (artigos relacionados) e Writefull (polimento),
// sem depender de assinatura paga de nenhuma dessas ferramentas.
const axios = require('axios');
const { chamarClaudeTexto } = require('./cientifico-ia');

// Busca artigos reais no PubMed (NCBI E-utilities, gratuito, sem chave obrigatoria)
async function buscarPubMed(termo, limite) {
  limite = limite || 8;
  try {
    const searchResp = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', {
      params: { db: 'pubmed', term: termo, retmax: limite, retmode: 'json', sort: 'relevance' },
      timeout: 15000
    });
    const ids = (searchResp.data.esearchresult && searchResp.data.esearchresult.idlist) || [];
    if (!ids.length) return { ok: true, artigos: [] };
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
    return { ok: true, artigos };
  } catch(e) {
    console.error('buscarPubMed erro:', e.message);
    return { ok: false, erro: 'Nao foi possivel buscar no PubMed agora.' };
  }
}

// Artigos relacionados via Semantic Scholar (API publica e gratuita)
async function artigosRelacionados(termo, limite) {
  limite = limite || 8;
  try {
    const searchResp = await axios.get('https://api.semanticscholar.org/graph/v1/paper/search', {
      params: { query: termo, limit: limite, fields: 'title,authors,year,venue,externalIds,abstract' },
      timeout: 15000
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
    console.error('artigosRelacionados erro:', e.message);
    return { ok: false, erro: 'Nao foi possivel buscar artigos relacionados agora.' };
  }
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
