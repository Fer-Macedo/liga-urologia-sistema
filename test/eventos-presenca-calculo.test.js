// 15/08/2026: transmissão online de evento de vários dias precisa de % por dia E % geral
// (soma de todos os dias fechados), com a duração de cada dia preenchida só DEPOIS que a aula
// termina (não dá pra prever antes). Este teste cobre a lógica pura de cálculo (sem banco).
const { test } = require('node:test');
const assert = require('node:assert');
const { calcularPercentual, LIMIAR_FREQUENCIA } = require('../src/services/eventos-presenca');

test('LIMIAR_FREQUENCIA continua 75%', () => {
  assert.strictEqual(LIMIAR_FREQUENCIA, 75);
});

test('evento de vários dias: soma os dias FECHADOS (com duração preenchida) pro percentual geral', () => {
  const dados = {
    diasFechados: [
      { id: 10, titulo: 'Día 1', data: '2026-08-17', duracao_minutos: 180 }, // 10800s
      { id: 11, titulo: 'Día 2', data: '2026-08-18', duracao_minutos: 180 }  // 10800s
    ],
    duracaoEventoMinutos: null,
    presencaPorInscricao: { 5: { presenca_id: 99, tempoLegado: 0 } },
    segundosPorDia: { 99: { 10: 9000, 11: 5400 } }, // dia1: 83%, dia2: 50%
    presencialPorInscricao: {}
  };
  const r = calcularPercentual(5, dados);
  assert.strictEqual(r.porDia.length, 2);
  assert.strictEqual(r.porDia[0].pct, 83);
  assert.strictEqual(r.porDia[1].pct, 50);
  // geral: (9000+5400) / (10800+10800) = 14400/21600 = 66.67% -> 67
  assert.strictEqual(r.pctGeral, 67);
  assert.strictEqual(r.apto, false, '67% não bate 75%');
});

test('dia ainda ABERTO (sem duracao_minutos) não entra na conta nem como numerador nem denominador', () => {
  const dados = {
    diasFechados: [{ id: 10, titulo: 'Día 1', data: '2026-08-17', duracao_minutos: 180 }], // só o fechado aparece aqui
    duracaoEventoMinutos: null,
    presencaPorInscricao: { 5: { presenca_id: 99, tempoLegado: 0 } },
    // segundos acumulados no dia 2 (id 11, ainda aberto) já existem no banco, mas não devem contar
    segundosPorDia: { 99: { 10: 10800, 11: 999999 } },
    presencialPorInscricao: {}
  };
  const r = calcularPercentual(5, dados);
  assert.strictEqual(r.porDia.length, 1, 'só o dia fechado deve aparecer na quebra por dia');
  assert.strictEqual(r.pctGeral, 100, 'só considera o dia 1 (100%), ignora os 999999s do dia ainda aberto');
});

test('sem nenhum dia fechado: cai no fallback legado (evento.duracao_minutos + tempo_total_segundos)', () => {
  const dados = {
    diasFechados: [],
    duracaoEventoMinutos: 120, // 7200s
    presencaPorInscricao: { 5: { presenca_id: 99, tempoLegado: 5400 } }, // 75%
    segundosPorDia: {},
    presencialPorInscricao: {}
  };
  const r = calcularPercentual(5, dados);
  assert.strictEqual(r.porDia.length, 0);
  assert.strictEqual(r.pctGeral, 75);
  assert.strictEqual(r.apto, true, '75% exato bate o limiar');
});

test('presença física (catraca) maior que online: usa a maior das duas (GREATEST), não soma', () => {
  const dados = {
    diasFechados: [{ id: 10, titulo: 'Día 1', data: '2026-08-17', duracao_minutos: 60 }], // 3600s
    duracaoEventoMinutos: null,
    presencaPorInscricao: { 5: { presenca_id: 99, tempoLegado: 0 } },
    segundosPorDia: { 99: { 10: 900 } }, // 25% online
    presencialPorInscricao: { 5: 3600 } // 100% presencial
  };
  const r = calcularPercentual(5, dados);
  assert.strictEqual(r.pctGeral, 100, 'deve usar o presencial (maior), não somar 900+3600');
});

test('pessoa nunca abriu o link (sem linha em evento_presencas_online): calcula com 0 segundos, não quebra', () => {
  const dados = {
    diasFechados: [{ id: 10, titulo: 'Día 1', data: '2026-08-17', duracao_minutos: 60 }],
    duracaoEventoMinutos: null,
    presencaPorInscricao: {}, // ninguém
    segundosPorDia: {},
    presencialPorInscricao: {}
  };
  const r = calcularPercentual(999, dados);
  assert.strictEqual(r.pctGeral, 0);
  assert.strictEqual(r.apto, false);
});

test('sem duração nenhuma configurada (nem por dia, nem no evento): pctGeral fica null, não 0 nem 100', () => {
  const dados = {
    diasFechados: [],
    duracaoEventoMinutos: null,
    presencaPorInscricao: { 5: { presenca_id: 99, tempoLegado: 500 } },
    segundosPorDia: {},
    presencialPorInscricao: {}
  };
  const r = calcularPercentual(5, dados);
  assert.strictEqual(r.pctGeral, null, 'sem denominador não dá pra afirmar 0% nem 100% — precisa ficar indefinido');
  assert.strictEqual(r.temDadosSuficientes, false);
  assert.strictEqual(r.apto, false);
});

test('74% não é apto, 75% é — limiar exato', () => {
  const base = {
    diasFechados: [{ id: 10, titulo: 'D', data: '2026-08-17', duracao_minutos: 100 }], // 6000s
    duracaoEventoMinutos: null,
    presencialPorInscricao: {}
  };
  const r74 = calcularPercentual(1, { ...base, presencaPorInscricao: { 1: { presenca_id: 1, tempoLegado: 0 } }, segundosPorDia: { 1: { 10: 4440 } } }); // 74%
  const r75 = calcularPercentual(1, { ...base, presencaPorInscricao: { 1: { presenca_id: 1, tempoLegado: 0 } }, segundosPorDia: { 1: { 10: 4500 } } }); // 75%
  assert.strictEqual(r74.pctGeral, 74);
  assert.strictEqual(r74.apto, false);
  assert.strictEqual(r75.pctGeral, 75);
  assert.strictEqual(r75.apto, true);
});
