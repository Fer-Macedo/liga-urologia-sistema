// 12/08/2026: nova aba "Lista de Assinatura" no evento — mesmo papel timbrado + bloco de
// assinaturas já usado em /lista-assinaturas, mas com os inscritos do evento. gerarHTMLLista
// foi extraída pra src/services/lista-assinatura.js justamente pra ser reaproveitada aqui.
// Ganhou 2 rotas (visualizar/imprimir), espelhando o padrão que /lista-assinaturas já tinha.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar({ evento, inscricoes = [] } = {}) {
  const queries = [];
  let chamadaGerar = null;

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/SELECT \* FROM eventos WHERE id=\$1/.test(sql)) return { rows: evento ? [evento] : [] };
      if (/SELECT nome, rg, catraca FROM evento_inscricoes WHERE evento_id=\$1/.test(sql)) return { rows: inscricoes };
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };
  const rdes = require.resolve(path.join(RAIZ, 'src/services/desligamento.js'));
  require.cache[rdes] = { id: rdes, filename: rdes, loaded: true, exports: { imagemBase64: async () => null } };
  const rla = require.resolve(path.join(RAIZ, 'src/services/lista-assinatura.js'));
  require.cache[rla] = { id: rla, filename: rla, loaded: true, exports: {
    gerarHTMLLista: async (titulo, dataStr, descricao, pessoas, config) => {
      chamadaGerar = { titulo, dataStr, descricao, pessoas, config };
      return '<html><body>ok</body></html>';
    }
  }};

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas[rota] = fns[fns.length-1]; }, post: () => {} };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, queries, chamadaGerar: () => chamadaGerar };
}

function resFake() {
  const r = {};
  r._status = 200; r._body = null;
  r.status = (c) => { r._status = c; return r; };
  r.send = (b) => { r._body = b; return r; };
  return r;
}

const eventoBase = { id: 5, nome: 'II Jornada de Salud del Hombre', data_inicio: '2026-08-17' };
const ROTA_VER = '/eventos/:id/lista-assinatura/visualizar';
const ROTA_IMP = '/eventos/:id/lista-assinatura/imprimir';

test('sem filtro de status: traz todos os inscritos, ordenados', async () => {
  const { rotas, queries, chamadaGerar } = montar({ evento: eventoBase, inscricoes: [{ nome: 'ana', rg: '1', catraca: 'A' }] });
  await rotas[ROTA_VER]({ params: { id: '5' }, query: {} }, resFake());
  const q = queries.find(q => /evento_inscricoes/.test(q.sql));
  assert.ok(!/AND status=/.test(q.sql), 'sem filtro não deve ter AND status');
  assert.match(q.sql, /ORDER BY LOWER\(nome\) ASC/);
  assert.strictEqual(chamadaGerar().descricao, null);
});

test('status=confirmado filtra pelo status confirmado', async () => {
  const { queries, rotas } = montar({ evento: eventoBase, inscricoes: [] });
  await rotas[ROTA_VER]({ params: { id: '5' }, query: { status: 'confirmado' } }, resFake());
  const q = queries.find(q => /evento_inscricoes/.test(q.sql));
  assert.match(q.sql, /AND status=\$2/);
  assert.deepStrictEqual(q.params, ['5', 'confirmado']);
});

test('status=pendente filtra pelo status pendente e rotula "Pendientes" no cabeçalho', async () => {
  const { rotas, chamadaGerar } = montar({ evento: eventoBase, inscricoes: [] });
  await rotas[ROTA_VER]({ params: { id: '5' }, query: { status: 'pendente' } }, resFake());
  assert.strictEqual(chamadaGerar().descricao, 'Pendientes');
});

test('valor de status desconhecido é ignorado (não filtra, não quebra)', async () => {
  const { queries, rotas } = montar({ evento: eventoBase, inscricoes: [] });
  await rotas[ROTA_VER]({ params: { id: '5' }, query: { status: 'lixo' } }, resFake());
  const q = queries.find(q => /evento_inscricoes/.test(q.sql));
  assert.ok(!/AND status=/.test(q.sql));
});

test('nome do inscrito é normalizado (Primeira Letra Maiúscula) antes de ir pro documento', async () => {
  const { rotas, chamadaGerar } = montar({
    evento: eventoBase,
    inscricoes: [{ nome: 'JOÃO DA SILVA', rg: '123', catraca: '45' }]
  });
  await rotas[ROTA_VER]({ params: { id: '5' }, query: {} }, resFake());
  assert.strictEqual(chamadaGerar().pessoas[0].nome, 'João Da Silva');
  assert.strictEqual(chamadaGerar().pessoas[0].rg, '123');
  assert.strictEqual(chamadaGerar().pessoas[0].catraca, '45');
});

test('evento inexistente devolve 404 tanto em visualizar quanto em imprimir', async () => {
  const { rotas, chamadaGerar } = montar({ evento: null });
  const r1 = resFake();
  await rotas[ROTA_VER]({ params: { id: '999' }, query: {} }, r1);
  assert.strictEqual(r1._status, 404);
  const r2 = resFake();
  await rotas[ROTA_IMP]({ params: { id: '999' }, query: {} }, r2);
  assert.strictEqual(r2._status, 404);
  assert.strictEqual(chamadaGerar(), null);
});

test('visualizar devolve o documento SEM disparar impressão automática', async () => {
  const { rotas } = montar({ evento: eventoBase, inscricoes: [] });
  const res = resFake();
  await rotas[ROTA_VER]({ params: { id: '5' }, query: {} }, res);
  assert.ok(!/window\.print\(\)/.test(res._body), 'visualizar não deve chamar print() sozinho');
});

test('imprimir devolve o mesmo documento COM o script de impressão automática', async () => {
  const { rotas } = montar({ evento: eventoBase, inscricoes: [] });
  const res = resFake();
  await rotas[ROTA_IMP]({ params: { id: '5' }, query: {} }, res);
  assert.match(res._body, /window\.print\(\)/);
});
