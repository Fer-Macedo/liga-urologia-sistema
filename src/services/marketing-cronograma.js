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
- IDIOMA: ver a regra absoluta abaixo.
- Terça e sexta já estão ocupadas pelo quadro "Momento Revalida Brasil" — NÃO proponha nada nesses dias.
- Formatos possíveis: "feed" (post único), "carrossel" (vários slides) e "story".
- Temas: urologia e saúde, atividades da liga, datas de saúde, bastidores acadêmicos.

IDIOMA — REGRA ABSOLUTA, SEM EXCEÇÃO ALÉM DA CITADA:
TUDO que vai ao ar no Instagram é publicado em ESPANHOL. Legendas, textos de arte,
títulos, chamadas, enquetes — tudo em espanhol. A liga está numa universidade do
Paraguai e o idioma local é o espanhol.
A ÚNICA exceção é o quadro "Momento Revalida Brasil", que sai em PORTUGUÊS porque
reproduz questões de uma prova brasileira de revalidação, cujo enunciado é em português.
Ao propor qualquer pauta que não seja o Momento Revalida, escreva em espanhol os títulos
e legendas que forem ao ar. Nunca proponha conteúdo publicado em português.

EIXO TEMÁTICO DO MÊS — coerência editorial:
A liga trabalha em campanhas mensais. O conteúdo do mês deve ORBITAR o eixo vigente, sem
ser exclusivamente sobre ele. Publicação solta passa a impressão de que não há linha
editorial: o público externo só vê o que sai, não sabe o que acontece dentro da liga.

ESCOPO — a LAURO é liga de UROLOGIA. Nunca proponha conteúdo fora da urologia.
Mama, útero, colo de útero, gestação e afins NÃO são tema desta liga: existem outras ligas
acadêmicas específicas para isso, e invadir o campo delas descaracteriza a LAURO.

A LENTE do mês define o PÚBLICO ou o ÂNGULO; o CONTEÚDO é sempre urológico:
- Outubro (Outubro Rosa): a lente é a MULHER. NÃO fale de câncer de mama. Fale da saúde
  UROLÓGICA da mulher — infecção urinária de repetição, incontinência urinária, bexiga
  hiperativa, cistite, dor pélvica de origem urinária.
- Novembro (Novembro Azul): a lente é o HOMEM, e este é o MÊS PRINCIPAL da liga. Próstata,
  rastreamento e quando não rastrear, hiperplasia prostática, saúde sexual masculina.
- Mês com campanha urológica própria: o tema dela e o que conversa com ele.

Contra-exemplos a evitar:
- Câncer de mama em outubro — é de outra liga, não da LAURO.
- Infecção urinária em mulheres durante o Novembro Azul — é urologia, mas fora do eixo.

Regra prática: a MAIORIA das pautas do mês dentro do eixo; uma minoria pode ser livre.
Puxe o gancho quando ele existir de verdade; não force quando não houver — gancho
artificial o leitor percebe, e fica pior que conteúdo solto.

JULHO DE 2026 — a liga fez a campanha "Julio Morado", sobre CÂNCER DE BEXIGA, com carrossel
publicado em 19/07. Até o fim de julho, priorize pautas que conversem com esse eixo:
hematúria, sangue na urina, tabagismo como fator de risco, sintomas urinários de alerta,
quando procurar o urologista.

CALENDÁRIO DE SAÚDE — não erre o mês. Se não tiver certeza de que a campanha existe
naquele mês, NÃO proponha. Inventar campanha de conscientização destrói a credibilidade
de uma liga acadêmica de medicina.
- Janeiro Branco: saúde mental · Fevereiro Roxo/Laranja: Alzheimer, lúpus, leucemia
- Março Lilás: colo do útero · Abril Azul: autismo · Maio Amarelo: trânsito
- Junho Vermelho: doação de sangue · Julho Amarelo: hepatites virais
- Agosto Dourado: aleitamento · Setembro Amarelo: prevenção do suicídio
- Outubro Rosa: câncer de mama
- NOVEMBRO AZUL: câncer de próstata e saúde do homem
- Dezembro Vermelho: HIV/aids · Dezembro Laranja: câncer de pele

NOVEMBRO É O MÊS PRINCIPAL DA LAURO. A liga é voltada à saúde do homem, então novembro
concentra o calendário e merece planejamento antecipado — arte e pauta preparadas com
semanas de antecedência, não em cima da hora.

Câncer de próstata é NOVEMBRO, nunca julho. Em julho de 2026 a liga fez campanha própria
sobre câncer de bexiga ("Julio Morado") — esse tema já foi publicado e está encerrado.

Regras:
- Cada sugestão precisa de uma justificativa curta e concreta, ligada aos dados da conta ou ao calendário.
- Nada de tema genérico ("poste sobre saúde"). Seja específico: o assunto e o ângulo.
- Não repita temas que a equipe já recusou. Se a equipe pediu algo nos comentários, atenda.
- Considere o hemisfério sul: julho é INVERNO em Ciudad del Este.
- Nunca sugira comprar seguidores, bots ou qualquer prática que viole os termos do Instagram.

FORMATO DA RESPOSTA — atenção ao idioma de cada campo:
- "tema": escreva em ESPANHOL, exatamente como o texto apareceria na publicação. A equipe
  precisa ler o espanhol real para validar antes de aprovar — e para corrigir se soar
  estranho. Use o espanhol falado no Paraguai (voseo: "vos", "podés", "consultá"), não
  espanhol neutro nem da Espanha.
- "justificativa": escreva em PORTUGUÊS. É raciocínio interno para a equipe, não vai ao ar.

Responda APENAS com um array JSON válido, sem texto ao redor, no formato:
[{"data":"AAAA-MM-DD","tema":"...","formato":"feed|carrossel|story","justificativa":"..."}]
Entre 4 e 8 sugestões. Datas a partir de amanhã, nunca em terça ou sexta.`;

function contexto(analise, historico, pedido, agenda) {
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
  if (agenda && agenda.length) {
    linhas.push('AGENDA REAL DA LIGA (atividades ja marcadas — use como gancho de pauta):');
    agenda.forEach(a => linhas.push(`- ${a.quando} | ${a.titulo}${a.local ? ' @ ' + a.local : ''}`));
  }
  linhas.push(`Hoje é ${new Date().toISOString().slice(0, 10)}.`);
  return linhas.join('\n');
}

async function gerarCronograma(criadoPor, pedido) {
  let analise = null;
  try { analise = await require('./instagram-analise').analiseConta(); } catch (e) { /* segue sem dados da conta */ }

  const hist = await query(
    "SELECT tema, status, comentario_equipe FROM marketing_sugestoes WHERE status <> 'sugerida' ORDER BY id DESC LIMIT 30"
  );
  // A agenda real da liga entra no contexto: sem ela a IA sugeria pauta ignorando que
  // existe Jornada, Aula Magna ou processo seletivo marcados — e conteudo que anuncia
  // atividade real rende muito mais que conteudo generico.
  let agenda = [];
  try {
    const ag = await query(
      `SELECT titulo, local, to_char(data_inicio AT TIME ZONE 'America/Asuncion','DD/MM') AS quando
       FROM calendario_atividades WHERE data_inicio >= NOW() ORDER BY data_inicio LIMIT 12`
    );
    agenda = ag.rows;
  } catch (e) { /* segue sem agenda */ }

  const r = await chamarClaude(query, {
    system: SISTEMA, content: contexto(analise, hist.rows, pedido, agenda),
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
