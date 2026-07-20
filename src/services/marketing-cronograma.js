// Cronograma de conteúdo sugerido pela IA — e a resposta da equipe.
//
// A ideia é conversa, não monólogo: a IA propõe temas com data, a equipe aceita,
// recusa ou comenta, e o comentário volta para a IA na próxima geração. Assim o
// cronograma vai se ajustando ao que a liga realmente quer publicar, em vez de
// repetir sugestões que já foram descartadas.
//
// Terça e sexta às 6h ja sao do Momento Revalida Brasil (revalida-quadro.js), entao
// a IA e instruida a nao propor nada nesses dias.
const { query } = require('../models/database');
const { chamarClaude } = require('./cientifico-ia');

const SISTEMA = `Você é o estrategista de conteúdo da LAURO — Liga Acadêmica de Urologia da
Universidad Central del Paraguay, em Ciudad del Este. O Instagram é @lauroucp.cde.

Seu trabalho é propor um CRONOGRAMA de publicações para as próximas 2 semanas.

Contexto obrigatório:
- O público é misto: estudantes de medicina da fronteira (muitos brasileiros) e a comunidade geral.
- As publicações voltadas ao público geral saem em ESPANHOL (exigência da universidade).
- Terça e sexta já estão ocupadas pelo quadro "Momento Revalida Brasil" — NÃO proponha nada nesses dias.
- Formatos possíveis: "feed" (post único), "carrossel" (vários slides) e "story".
- Temas: urologia e saúde, atividades da liga, datas de saúde, bastidores acadêmicos.

Regras:
- Cada sugestão precisa de uma justificativa curta e concreta, ligada aos dados da conta ou ao calendário.
- Nada de tema genérico ("poste sobre saúde"). Seja específico: o assunto e o ângulo.
- Não repita temas que a equipe já recusou. Se a equipe pediu algo nos comentários, atenda.
- Considere o hemisfério sul: julho é INVERNO em Ciudad del Este.
- Nunca sugira comprar seguidores, bots ou qualquer prática que viole os termos do Instagram.

Responda APENAS com um array JSON válido, sem texto ao redor, no formato:
[{"data":"AAAA-MM-DD","tema":"...","formato":"feed|carrossel|story","justificativa":"..."}]
Entre 4 e 8 sugestões. Datas a partir de amanhã, nunca em terça ou sexta.`;

function contexto(analise, historico, pedido) {
  const linhas = [];
  if (analise && analise.resumo7d) {
    const r = analise.resumo7d, r28 = analise.resumo28d || {};
    linhas.push(`Conta @${(analise.conta || {}).username || 'lauroucp.cde'}`);
    linhas.push(`Últimos 7 dias — alcance: ${r.alcance}, interações: ${r.interacoes}, novos seguidores: ${r.novosSeguidores}`);
    if (r28.alcance) linhas.push(`Últimos 28 dias — alcance: ${r28.alcance}, novos seguidores: ${r28.novosSeguidores}`);
  }
  const recusadas = historico.filter(h => h.status === 'recusada');
  const aceitas = historico.filter(h => h.status === 'aceita');
  if (aceitas.length) linhas.push(`Temas que a equipe ACEITOU antes: ${aceitas.map(h => h.tema).join(' | ')}`);
  if (recusadas.length) {
    linhas.push(`Temas que a equipe RECUSOU (não repetir): ${recusadas.map(h => h.tema + (h.comentario_equipe ? ` — motivo: ${h.comentario_equipe}` : '')).join(' | ')}`);
  }
  const comentarios = historico.filter(h => h.comentario_equipe && h.status !== 'recusada');
  if (comentarios.length) linhas.push(`Comentários da equipe: ${comentarios.map(h => h.comentario_equipe).join(' | ')}`);
  if (pedido) linhas.push(`PEDIDO DIRETO DA EQUIPE para esta rodada: ${pedido}`);
  linhas.push(`Hoje é ${new Date().toISOString().slice(0, 10)}.`);
  return linhas.join('\n');
}

async function gerarCronograma(criadoPor, pedido) {
  let analise = null;
  try { analise = await require('./instagram-analise').analiseConta(); } catch (e) { /* segue sem dados da conta */ }

  const hist = await query(
    "SELECT tema, status, comentario_equipe FROM marketing_sugestoes WHERE status <> 'sugerida' ORDER BY id DESC LIMIT 30"
  );
  const r = await chamarClaude(query, {
    system: SISTEMA, content: contexto(analise, hist.rows, pedido),
    contexto: 'marketing-cronograma', maxTokens: 2000
  });
  if (!r.ok) return r;

  let sugestoes;
  try {
    const limpo = (r.texto || '').replace(/```json|```/g, '').trim();
    sugestoes = JSON.parse(limpo.slice(limpo.indexOf('['), limpo.lastIndexOf(']') + 1));
  } catch (e) { return { ok: false, erro: 'A IA respondeu num formato inesperado. Tente gerar de novo.' }; }
  if (!Array.isArray(sugestoes) || !sugestoes.length) return { ok: false, erro: 'Nenhuma sugestão foi gerada.' };

  const validas = sugestoes.filter(s => s && s.data && s.tema && /^\d{4}-\d{2}-\d{2}$/.test(s.data));
  let gravadas = 0;
  for (const s of validas) {
    // terça=2, sexta=5 pertencem ao Momento Revalida — descarta se a IA insistir
    const diaSemana = new Date(s.data + 'T12:00:00').getDay();
    if (diaSemana === 2 || diaSemana === 5) continue;
    const ja = await query('SELECT id FROM marketing_sugestoes WHERE data_sugerida=$1 AND tema=$2', [s.data, s.tema]);
    if (ja.rows.length) continue;
    await query(
      'INSERT INTO marketing_sugestoes (data_sugerida, tema, formato, justificativa, criado_por) VALUES ($1,$2,$3,$4,$5)',
      [s.data, s.tema, (s.formato || 'feed').toLowerCase(), s.justificativa || '', criadoPor || 'sistema']
    );
    gravadas++;
  }
  return { ok: true, gravadas, descartadas: validas.length - gravadas };
}

async function listarSugestoes() {
  const r = await query(
    `SELECT id, to_char(data_sugerida,'DD/MM') AS dia, to_char(data_sugerida,'YYYY-MM-DD') AS data_iso,
            tema, formato, justificativa, status, comentario_equipe, respondido_por,
            to_char(respondido_em,'DD/MM HH24:MI') AS respondido
     FROM marketing_sugestoes ORDER BY data_sugerida, id`
  );
  return r.rows;
}

async function responderSugestao(id, status, comentario, usuario) {
  if (!['aceita', 'recusada', 'sugerida'].includes(status)) return { ok: false, erro: 'Status inválido.' };
  await query(
    'UPDATE marketing_sugestoes SET status=$1, comentario_equipe=$2, respondido_por=$3, respondido_em=NOW() WHERE id=$4',
    [status, comentario || null, usuario || null, id]
  );
  return { ok: true };
}

module.exports = { gerarCronograma, listarSugestoes, responderSugestao };
