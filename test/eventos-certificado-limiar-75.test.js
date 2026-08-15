// 15/08/2026: o botão "Emitir" na tela de presenças só aparecia pra quem batia 75%, mas a rota
// que gera o certificado nunca conferia nada — dava pra emitir digitando a URL direto pra
// qualquer inscrito. Corrigido pra checar de verdade no servidor, mas SÓ quando o evento tem
// dado de frequência configurado — evento sem controle de presença continua liberado, senão
// certificado de evento presencial simples (sem essa checagem nunca usada) quebraria.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar({ evento, inscricao, diasFechados = [], presencasOnlineDias = [], presencasOnline = [], presencasTempo = [] }) {
  const inseridos = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT \* FROM evento_inscricoes WHERE id=\$1/.test(sql)) return { rows: [inscricao] };
      if (/FROM evento_inscricoes WHERE evento_id=\$1 AND status='confirmado'/.test(sql)) return { rows: [inscricao] };
      if (/SELECT \* FROM eventos WHERE id=\$1/.test(sql)) return { rows: [evento] };
      if (/SELECT duracao_minutos FROM eventos WHERE id=\$1/.test(sql)) return { rows: [{ duracao_minutos: evento.duracao_minutos||null }] };
      if (/SELECT id, titulo, data, horario, duracao_minutos FROM evento_programacao/.test(sql)) return { rows: diasFechados };
      if (/SELECT id as presenca_id, inscricao_id, tempo_total_segundos FROM evento_presencas_online/.test(sql)) return { rows: presencasOnline };
      if (/FROM evento_presencas_online_dias epod/.test(sql)) return { rows: presencasOnlineDias };
      if (/FROM evento_presencas_tempo WHERE evento_id=\$1 GROUP BY/.test(sql)) return { rows: presencasTempo };
      if (/INSERT INTO evento_certificados/.test(sql)) { inseridos.push(params); return { rows: [{ id: 1 }] }; }
      if (/UPDATE evento_certificados/.test(sql)) return { rows: [] };
      return { rows: [] };
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
  const rdl = require.resolve(path.join(RAIZ, 'src/services/desligamento.js'));
  require.cache[rdl] = { id: rdl, filename: rdl, loaded: true, exports: { imagemBase64: async () => null, getUrlAssinada: async () => 'https://x' } };
  const rnt = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rnt] = { id: rnt, filename: rnt, loaded: true, exports: { enviarWhatsApp: async () => {}, enviarEmail: async () => {} } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, inseridos };
}

function resSend() { const r = {}; r.status = (c) => { r._status = c; return r; }; r.send = (b) => { r._body = b; if(!r._status) r._status=200; return r; }; return r; }
function resRedirect() { const r = {}; r.redirect = (u) => { r._redirect = u; return r; }; return r; }

test('evento COM controle de presença, inscrito abaixo de 75%: certificado individual é BLOQUEADO (403)', async () => {
  const { rotas } = montar({
    evento: { id: 5, nome: 'Jornada', data_inicio: null, cert_bg_chave: null },
    inscricao: { id: 42, nome: 'Fulano', email: 'f@x.com', whatsapp: null },
    diasFechados: [{ id: 10, titulo: 'Día 1', duracao_minutos: 180 }],
    presencasOnline: [{ presenca_id: 99, inscricao_id: 42, tempo_total_segundos: 0 }],
    presencasOnlineDias: [{ presenca_id: 99, programacao_id: 10, tempo_total_segundos: 3600 }] // 33%
  });
  const res = resSend();
  await rotas['GET /eventos/:id/inscricoes/:iid/certificado']({ params: { id: '5', iid: '42' } }, res);
  assert.strictEqual(res._status, 403);
  assert.match(res._body, /33%/);
});

test('evento COM controle de presença, inscrito com 75%+: certificado é emitido normalmente', async () => {
  const { rotas } = montar({
    evento: { id: 5, nome: 'Jornada', data_inicio: null, cert_bg_chave: null },
    inscricao: { id: 42, nome: 'Fulano', email: 'f@x.com', whatsapp: null },
    diasFechados: [{ id: 10, titulo: 'Día 1', duracao_minutos: 60 }],
    presencasOnline: [{ presenca_id: 99, inscricao_id: 42, tempo_total_segundos: 0 }],
    presencasOnlineDias: [{ presenca_id: 99, programacao_id: 10, tempo_total_segundos: 3600 }] // 100%
  });
  const res = resSend();
  await rotas['GET /eventos/:id/inscricoes/:iid/certificado']({ params: { id: '5', iid: '42' } }, res);
  assert.strictEqual(res._status, 200);
  assert.match(res._body, /Fulano/);
});

test('evento SEM NENHUM controle de presença configurado: certificado continua liberado (comportamento de sempre)', async () => {
  const { rotas } = montar({
    evento: { id: 6, nome: 'Congresso presencial simples', data_inicio: null, cert_bg_chave: null, duracao_minutos: null },
    inscricao: { id: 50, nome: 'Ciclana', email: 'c@x.com', whatsapp: null },
    diasFechados: [],
    presencasOnline: [],
    presencasOnlineDias: []
  });
  const res = resSend();
  await rotas['GET /eventos/:id/inscricoes/:iid/certificado']({ params: { id: '6', iid: '50' } }, res);
  assert.strictEqual(res._status, 200, 'evento sem tracking nenhum não pode ficar bloqueado — regressão real se travar');
});

test('emitir-todos: pula quem não bateu 75% quando o evento tem controle de presença', async () => {
  const { rotas, inseridos } = montar({
    evento: { id: 5, nome: 'Jornada' },
    inscricao: { id: 42 }, // usado só pelo SELECT confirmado — ver mock abaixo
    diasFechados: [{ id: 10, titulo: 'Día 1', duracao_minutos: 60 }],
    presencasOnline: [{ presenca_id: 99, inscricao_id: 42, tempo_total_segundos: 0 }],
    presencasOnlineDias: [{ presenca_id: 99, programacao_id: 10, tempo_total_segundos: 900 }] // 25%
  });
  await rotas['POST /eventos/:id/certificados/emitir-todos']({ params: { id: '5' }, session: {} }, resRedirect());
  assert.strictEqual(inseridos.length, 0, '25% não bate o mínimo, não deve emitir');
});

test('emitir-todos: emite pra quem bateu 75%+', async () => {
  const { rotas, inseridos } = montar({
    evento: { id: 5, nome: 'Jornada' },
    inscricao: { id: 42 },
    diasFechados: [{ id: 10, titulo: 'Día 1', duracao_minutos: 60 }],
    presencasOnline: [{ presenca_id: 99, inscricao_id: 42, tempo_total_segundos: 0 }],
    presencasOnlineDias: [{ presenca_id: 99, programacao_id: 10, tempo_total_segundos: 3600 }] // 100%
  });
  await rotas['POST /eventos/:id/certificados/emitir-todos']({ params: { id: '5' }, session: {} }, resRedirect());
  assert.strictEqual(inseridos.length, 1);
  assert.strictEqual(inseridos[0][0], 42);
});

test('emitir-todos: evento sem tracking nenhum emite pra todo mundo confirmado (comportamento de sempre)', async () => {
  const { rotas, inseridos } = montar({
    evento: { id: 6, nome: 'Congresso simples', duracao_minutos: null },
    inscricao: { id: 50 },
    diasFechados: [],
    presencasOnline: [],
    presencasOnlineDias: []
  });
  await rotas['POST /eventos/:id/certificados/emitir-todos']({ params: { id: '6' }, session: {} }, resRedirect());
  assert.strictEqual(inseridos.length, 1);
});
