// Cálculo de frequência (presença) de eventos com transmissão online — dividido em dois passos
// pra não fazer N+1 query em eventos com centenas de inscritos:
//   1) buscarDadosPresenca(query, eventoId) — 4 queries fixas, carrega TUDO do evento de uma vez.
//   2) calcularPercentual(inscricaoId, dados) — pura, sem acessar banco, roda em loop por pessoa.
//
// Eventos de vários dias (ex: jornada de 4 dias) têm um item de evento_programacao por dia,
// cada um com seu youtube_url e duracao_minutos — a duração só é preenchida DEPOIS que a aula
// termina (não dá pra saber antes quanto tempo vai durar). Por isso só entram na conta os dias
// que já têm duracao_minutos preenchido ("dia fechado"); dias ainda abertos não contam nem no
// numerador nem no denominador até alguém preencher a duração real.
//
// Eventos antigos de um dia só (sem nenhum item de Programação com duração preenchida) caem no
// fallback legado: evento.duracao_minutos + evento_presencas_online.tempo_total_segundos, do
// jeito que já funcionava antes dessa mudança.

const LIMIAR_FREQUENCIA = 75; // % — mesmo limiar usado em toda a tela de presenças e no PDF

async function buscarDadosPresenca(query, eventoId) {
  const [evR, diasR, presR, diasSegR, presencialR] = await Promise.all([
    query('SELECT duracao_minutos FROM eventos WHERE id=$1', [eventoId]),
    query('SELECT id, titulo, data, horario, duracao_minutos FROM evento_programacao WHERE evento_id=$1 AND duracao_minutos IS NOT NULL ORDER BY data ASC NULLS LAST, ordem ASC', [eventoId]),
    query('SELECT id as presenca_id, inscricao_id, tempo_total_segundos FROM evento_presencas_online WHERE evento_id=$1', [eventoId]),
    query(
      `SELECT epod.presenca_id, epod.programacao_id, epod.tempo_total_segundos
       FROM evento_presencas_online_dias epod
       JOIN evento_presencas_online epo ON epo.id=epod.presenca_id
       WHERE epo.evento_id=$1`,
      [eventoId]
    ),
    query(
      `SELECT inscricao_id, SUM(EXTRACT(EPOCH FROM (COALESCE(saida_em,NOW())-entrada_em))) as segundos
       FROM evento_presencas_tempo WHERE evento_id=$1 GROUP BY inscricao_id`,
      [eventoId]
    )
  ]);

  const presencaPorInscricao = {};
  presR.rows.forEach(p => { presencaPorInscricao[p.inscricao_id] = { presenca_id: p.presenca_id, tempoLegado: p.tempo_total_segundos || 0 }; });

  const segundosPorDia = {}; // presenca_id -> { programacao_id: segundos }
  diasSegR.rows.forEach(d => {
    if (!segundosPorDia[d.presenca_id]) segundosPorDia[d.presenca_id] = {};
    segundosPorDia[d.presenca_id][d.programacao_id] = d.tempo_total_segundos || 0;
  });

  const presencialPorInscricao = {};
  presencialR.rows.forEach(p => { presencialPorInscricao[p.inscricao_id] = Math.round(parseFloat(p.segundos) || 0); });

  return {
    diasFechados: diasR.rows,
    duracaoEventoMinutos: evR.rows[0]?.duracao_minutos || null,
    presencaPorInscricao,
    segundosPorDia,
    presencialPorInscricao
  };
}

function calcularPercentual(inscricaoId, dados) {
  const { diasFechados, duracaoEventoMinutos, presencaPorInscricao, segundosPorDia, presencialPorInscricao } = dados;
  const presenca = presencaPorInscricao[inscricaoId];
  const segundosDoDia = presenca ? (segundosPorDia[presenca.presenca_id] || {}) : {};
  const segundosPresencial = presencialPorInscricao[inscricaoId] || 0;

  let porDia, segundosOnlineTotal, duracaoTotalSeg;

  if (diasFechados.length > 0) {
    porDia = diasFechados.map(dia => {
      const segundos = segundosDoDia[dia.id] || 0;
      const duracaoSeg = dia.duracao_minutos * 60;
      return { programacao_id: dia.id, titulo: dia.titulo, data: dia.data, segundos, duracaoSeg, pct: Math.min(100, Math.round(segundos / duracaoSeg * 100)) };
    });
    segundosOnlineTotal = porDia.reduce((soma, d) => soma + d.segundos, 0);
    duracaoTotalSeg = porDia.reduce((soma, d) => soma + d.duracaoSeg, 0);
  } else {
    // Fallback legado: evento de um dia só, sem Programação com duração preenchida.
    porDia = [];
    segundosOnlineTotal = presenca?.tempoLegado || 0;
    duracaoTotalSeg = duracaoEventoMinutos ? duracaoEventoMinutos * 60 : 0;
  }

  const segundosContados = Math.max(segundosPresencial, segundosOnlineTotal);
  const temDadosSuficientes = duracaoTotalSeg > 0;
  const pctGeral = temDadosSuficientes ? Math.min(100, Math.round(segundosContados / duracaoTotalSeg * 100)) : null;
  const apto = pctGeral !== null && pctGeral >= LIMIAR_FREQUENCIA;

  return { porDia, pctGeral, apto, segundosOnlineTotal, segundosPresencial, duracaoTotalSeg, temDadosSuficientes };
}

module.exports = { LIMIAR_FREQUENCIA, buscarDadosPresenca, calcularPercentual };
