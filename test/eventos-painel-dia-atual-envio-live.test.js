// 18/08/2026: pedido do usuário — antes de clicar em "Enviar links de acesso" não dava pra saber
// qual dia seria enviado (evento de 4 dias, cada um com seu próprio vídeo/tema). O painel
// (GET /eventos/:id) agora resolve o mesmo dia que a página /live e o e-mail usam e manda pro
// template como "diaAtualEnvioLive", com {dia, numero, total, hoje} — hoje=false sinaliza que
// o dia resolvido é só o mais próximo (nenhum item de Programação bate com a data de hoje),
// pra template mostrar um aviso vermelho em vez do verde de "está tudo certo".
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar({ hojeProgramacao, proximaProgramacao, diasComData = [] } = {}) {
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT \* FROM eventos WHERE id=\$1/.test(sql)) return { rows: [{ id: 5, nome: 'Jornada' }] };
      if (/WHERE evento_id=\$1 AND data=CURRENT_DATE/.test(sql)) return { rows: hojeProgramacao ? [hojeProgramacao] : [] };
      if (/WHERE evento_id=\$1 AND data IS NOT NULL ORDER BY ABS/.test(sql)) return { rows: proximaProgramacao ? [proximaProgramacao] : [] };
      if (/SELECT id FROM evento_programacao WHERE evento_id=\$1 AND data IS NOT NULL ORDER BY data/.test(sql)) return { rows: diasComData };
      // qualquer outra contagem/soma do painel (getEventoStats etc.) — valor neutro, não
      // interessa pro que este teste verifica (o dia resolvido pro envio de link)
      return { rows: [{ count: '0', total: '0' }] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };
  const re = require.resolve(path.join(RAIZ, 'src/services/email.js'));
  require.cache[re] = { id: re, filename: re, loaded: true, exports: { enviarEmail: async () => {}, emailBonito: () => '' } };
  const rpg = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  require.cache[rpg] = { id: rpg, filename: rpg, loaded: true, exports: { criarPixEvento: async () => ({}), consultarPagamento: async () => ({}), obterChavePublica: async () => ({}), pagarComCartao: async () => ({}) } };
  const rev = require.resolve(path.join(RAIZ, 'src/services/eventos-email.js'));
  require.cache[rev] = { id: rev, filename: rev, loaded: true, exports: { enviarEmailConfirmacaoEvento: async () => {}, TEXTO_CONFIRMACAO_PADRAO: 'x' } };
  const rrl = require.resolve(path.join(RAIZ, 'src/services/rate-limiters.js'));
  require.cache[rrl] = { id: rrl, filename: rrl, loaded: true, exports: { limiterPagamentoCartao: (q,s,n)=>n() } };
  const rfx = require.resolve(path.join(RAIZ, 'src/services/fluxo-eventos.js'));
  require.cache[rfx] = { id: rfx, filename: rfx, loaded: true, exports: { calcularLiquidoEvento: (v) => v } };
  const rnm = require.resolve(path.join(RAIZ, 'src/services/nomes.js'));
  require.cache[rnm] = { id: rnm, filename: rnm, loaded: true, exports: { formatarNome: (n) => n } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas };
}

function resRender() {
  const r = {};
  r.render = (view, locals) => { r._view = view; r._locals = locals; return r; };
  r.redirect = (u) => { r._redirect = u; return r; };
  return r;
}

test('GET /eventos/:id: dia de hoje bate com a Programação — diaAtualEnvioLive.hoje=true, com número/total/tema certos', async () => {
  const { rotas } = montar({
    hojeProgramacao: { id: 10, titulo: 'Principales Enfermedades Urológicas y Atención Clínica del Hombre', data: '2026-08-18' },
    diasComData: [{ id: 9 }, { id: 10 }, { id: 11 }, { id: 12 }]
  });
  const res = resRender();
  await rotas['GET /eventos/:id']({ params: { id: '5' }, session: {} }, res);
  const d = res._locals.diaAtualEnvioLive;
  assert.ok(d, 'diaAtualEnvioLive precisa vir pro template');
  assert.strictEqual(d.hoje, true);
  assert.strictEqual(d.numero, 2, 'é o 2º dia da lista ordenada por data');
  assert.strictEqual(d.total, 4);
  assert.strictEqual(d.dia.titulo, 'Principales Enfermedades Urológicas y Atención Clínica del Hombre');
});

test('GET /eventos/:id: hoje NÃO é dia de nenhuma aula — diaAtualEnvioLive.hoje=false (dia mais próximo, não o de hoje)', async () => {
  const { rotas } = montar({
    hojeProgramacao: null,
    proximaProgramacao: { id: 9, titulo: 'Promoción y Prevención de la Salud del Hombre', data: '2026-08-17' },
    diasComData: [{ id: 9 }, { id: 10 }, { id: 11 }, { id: 12 }]
  });
  const res = resRender();
  await rotas['GET /eventos/:id']({ params: { id: '5' }, session: {} }, res);
  const d = res._locals.diaAtualEnvioLive;
  assert.strictEqual(d.hoje, false, 'não é hoje de verdade — é só o dia mais próximo, o painel precisa avisar');
  assert.strictEqual(d.numero, 1);
});

test('GET /eventos/:id: evento sem NENHUM dia com data (legado) — diaAtualEnvioLive.dia é null, sem quebrar', async () => {
  const { rotas } = montar({ hojeProgramacao: null, proximaProgramacao: null, diasComData: [] });
  const res = resRender();
  await rotas['GET /eventos/:id']({ params: { id: '5' }, session: {} }, res);
  const d = res._locals.diaAtualEnvioLive;
  assert.strictEqual(d.dia, null);
  assert.strictEqual(d.hoje, false);
});
