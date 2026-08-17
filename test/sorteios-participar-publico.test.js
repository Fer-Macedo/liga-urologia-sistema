// 17/08/2026: pedido do usuário — sorteio "Externo" tinha os campos (Instagram, requisitos)
// e a tabela pronta (sorteio_participantes), mas NUNCA existiu a página pública de inscrição
// nem a rota pra receber ela — lacuna real, não bug. Implementado /participar/:id (pública) +
// link/QR no painel do sorteio, reaproveitando o mesmo padrão já usado no check-out de eventos
// (dedup por e-mail, fecha quando o sorteio é realizado, rate-limit dedicado).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/sorteios.js');

function montar({ sorteio, participanteExistente, mock } = {}) {
  const inserts = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (mock) { const r = mock(sql, params); if (r !== undefined) return r; }
      if (/SELECT \* FROM sorteios WHERE id=\$1/.test(sql)) return { rows: sorteio ? [sorteio] : [] };
      if (/SELECT id FROM sorteio_participantes WHERE sorteio_id=\$1 AND LOWER\(email\)=\$2/.test(sql)) {
        return { rows: participanteExistente ? [{ id: 1 }] : [] };
      }
      if (/INSERT INTO sorteio_participantes/.test(sql)) { inserts.push(params); return { rows: [] }; }
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, inserts };
}

function resRender() { const r = { _headers: {} }; r.render = (view, locals) => { r._view = view; r._locals = locals; return r; }; r.status = (c) => { r._status = c; return r; }; r.send = (b) => { r._body = b; return r; }; r.set = (k, v) => { r._headers[k] = v; return r; }; return r; }

const EXTERNO = { id: 9, nome: 'Sorteio de Natal', tipo: 'externo', status: 'rascunho', tarefas: '["Seguir a liga no Instagram","Marcar a liga na postagem"]' };
const INTERNO = { id: 5, nome: 'Sorteio dos Ligantes', tipo: 'interno', status: 'rascunho', tarefas: null };

test('GET /participar/:id: sorteio Externo aberto — mostra os requisitos', async () => {
  const { rotas } = montar({ sorteio: EXTERNO });
  const res = resRender();
  await rotas['GET /participar/:id']({ params: { id: '9' } }, res);
  assert.strictEqual(res._locals.aberto, true);
  assert.deepStrictEqual(res._locals.tarefas, ['Seguir a liga no Instagram', 'Marcar a liga na postagem']);
});

test('GET /participar/:id: sorteio já sorteado — inscrições fechadas', async () => {
  const { rotas } = montar({ sorteio: { ...EXTERNO, status: 'sorteado' } });
  const res = resRender();
  await rotas['GET /participar/:id']({ params: { id: '9' } }, res);
  assert.strictEqual(res._locals.aberto, false);
});

test('GET /participar/:id: sorteio Interno não tem página pública — 404 (só Externo se inscreve por link)', async () => {
  const { rotas } = montar({ sorteio: INTERNO });
  const res = resRender();
  await rotas['GET /participar/:id']({ params: { id: '5' } }, res);
  assert.strictEqual(res._status, 404);
});

test('GET /participar/:id: sorteio inexistente — 404, não quebra', async () => {
  const { rotas } = montar({ sorteio: null });
  const res = resRender();
  await rotas['GET /participar/:id']({ params: { id: '999' } }, res);
  assert.strictEqual(res._status, 404);
});

test('POST /participar/:id: inscrição válida grava em sorteio_participantes', async () => {
  const { rotas, inserts } = montar({ sorteio: EXTERNO });
  const req = { params: { id: '9' }, body: { nome: 'Maria Silva', email: 'maria@x.com', instagram: '@maria', whatsapp: '595111' } };
  const res = resRender();
  await rotas['POST /participar/:id'](req, res);
  assert.strictEqual(inserts.length, 1);
  assert.deepStrictEqual(inserts[0], ['9', 'Maria Silva', 'maria@x.com', '@maria', '595111']);
  assert.strictEqual(res._locals.sucesso, true);
});

test('POST /participar/:id: falta nome ou email — recusa sem gravar', async () => {
  const { rotas, inserts } = montar({ sorteio: EXTERNO });
  const req = { params: { id: '9' }, body: { nome: '', email: 'maria@x.com' } };
  const res = resRender();
  await rotas['POST /participar/:id'](req, res);
  assert.strictEqual(inserts.length, 0);
  assert.ok(res._locals.erro);
});

test('POST /participar/:id: mesmo e-mail 2ª vez — não duplica, avisa que já está participando', async () => {
  const { rotas, inserts } = montar({ sorteio: EXTERNO, participanteExistente: true });
  const req = { params: { id: '9' }, body: { nome: 'Maria Silva', email: 'maria@x.com' } };
  const res = resRender();
  await rotas['POST /participar/:id'](req, res);
  assert.strictEqual(inserts.length, 0);
  assert.strictEqual(res._locals.jaInscrito, true);
});

test('POST /participar/:id: sorteio já sorteado recusa nova inscrição', async () => {
  const { rotas, inserts } = montar({ sorteio: { ...EXTERNO, status: 'sorteado' } });
  const req = { params: { id: '9' }, body: { nome: 'Maria Silva', email: 'maria@x.com' } };
  const res = resRender();
  await rotas['POST /participar/:id'](req, res);
  assert.strictEqual(inserts.length, 0);
  assert.strictEqual(res._locals.aberto, false);
});

test('GET /sorteios/:id/qrcode: baixa o PNG do link público de inscrição', async () => {
  const { rotas } = montar({});
  const chamadas = [];
  global.fetch = async (url) => { chamadas.push(url); return { ok: true, arrayBuffer: async () => Buffer.from('fake-png') }; };
  try {
    const res = resRender();
    await rotas['GET /sorteios/:id/qrcode']({ params: { id: '9' } }, res);
    assert.match(chamadas[0], /data=https%3A%2F%2Finscricao\.lauroucpcde\.com%2Fparticipar%2F9/);
    assert.ok(Buffer.isBuffer(res._body));
  } finally { delete global.fetch; }
});
