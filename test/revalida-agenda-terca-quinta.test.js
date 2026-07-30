// 2026-07-30 (quinta-feira): o usuário perguntou por que o Momento Revalida não saiu
// "hoje", já que o combinado era terça e quinta. O código estava configurado para terça
// e SEXTA ('0 6 * * 2,5') desde que foi criado — nunca teve envio programado pra quinta.
// Não era bug: terça (28/07) funcionou normal, enviou certinho. Confirmado com o usuário
// que o agendamento correto é terça e quinta; corrigido aqui.
//
// O alerta de pendências (2 dias antes de cada envio, pra dar tempo de aprovar questão)
// também mudou: domingo+quarta (2 dias antes de terça/sexta) vira domingo+terça (2 dias
// antes de terça/quinta).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/agendamentos.js');

function capturarCrons() {
  const agendados = []; // { pattern, corpoDoJob }
  const rc = require.resolve('node-cron');
  require.cache[rc] = { id: rc, filename: rc, loaded: true, exports: {
    // so REGISTRA — nunca invoca o callback, entao os requires lazy dentro dele
    // (enviarQuadroRevalida, enviarAlertaPendencias, etc.) nunca rodam neste teste.
    schedule: (pattern, fn) => { agendados.push({ pattern, corpo: fn.toString() }); return { stop: () => {} }; }
  }};
  delete require.cache[require.resolve(MODULO)];
  const mod = require(MODULO);
  mod.iniciarAgendamentos();
  return agendados;
}

test('Momento Revalida: terça e quinta às 6h (não mais terça e sexta)', () => {
  const agendados = capturarCrons();
  const revalida = agendados.find(a => a.corpo.includes('enviarQuadroRevalida'));
  assert.ok(revalida, 'o cron do Momento Revalida precisa existir');
  assert.strictEqual(revalida.pattern, '0 6 * * 2,4',
    '2=terça, 4=quinta (cron: 0=dom,1=seg,2=ter,3=qua,4=qui,5=sex,6=sab) — não pode voltar a ser 2,5 (terça/sexta)');
});

test('alerta de pendências: domingo e terça às 8h (2 dias antes de cada envio)', () => {
  const agendados = capturarCrons();
  const alerta = agendados.find(a => a.corpo.includes('enviarAlertaPendencias'));
  assert.ok(alerta, 'o cron do alerta de pendências precisa existir');
  assert.strictEqual(alerta.pattern, '0 8 * * 0,2',
    'domingo(0) é 2 dias antes de terça, terça(2) é 2 dias antes de quinta');
});
