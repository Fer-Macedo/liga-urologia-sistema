// 12/08/2026: campos padrão (catraca, RG, semestre...) eram fixos pra sempre — faz sentido
// pra UCP hoje, mas o sistema é pra virar SaaS pra outras ligas/universidades no futuro, que
// não necessariamente usam catraca. Agora dá pra excluir campo padrão POR EVENTO (menos
// nome/email, que o sistema inteiro depende deles).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar() {
  const updates = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/UPDATE eventos SET campos_padrao_desativados/.test(sql)) { updates.push(params); return { rows: [] }; }
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };

  const rotas = {};
  const router = { get: () => {}, post: (rota, ...fns) => { rotas[rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, updates };
}

function req(chave) { return { params: { id: '5', chave }, session: {} }; }
function resRedirect() { const r = {}; r.redirect = () => r; return r; }

test('exclui um campo padrão permitido (ex: catraca)', async () => {
  const { rotas, updates } = montar();
  await rotas['/eventos/:id/campos-padrao/:chave/deletar'](req('catraca'), resRedirect());
  assert.strictEqual(updates.length, 1);
  assert.deepStrictEqual(updates[0], ['catraca', '5']);
});

test('nome não pode ser excluído — nunca chega a atualizar o banco', async () => {
  const { rotas, updates } = montar();
  const r = req('nome');
  r.session = {};
  await rotas['/eventos/:id/campos-padrao/:chave/deletar'](r, resRedirect());
  assert.strictEqual(updates.length, 0);
  assert.ok(r.session.erro && r.session.erro.length, 'deve registrar mensagem de erro');
});

test('email não pode ser excluído', async () => {
  const { rotas, updates } = montar();
  await rotas['/eventos/:id/campos-padrao/:chave/deletar'](req('email'), resRedirect());
  assert.strictEqual(updates.length, 0);
});

test('chave desconhecida (não é campo padrão de verdade) é recusada', async () => {
  const { rotas, updates } = montar();
  await rotas['/eventos/:id/campos-padrao/:chave/deletar'](req('nao-existe'), resRedirect());
  assert.strictEqual(updates.length, 0);
});

test('todos os campos exclusíveis esperados funcionam', async () => {
  for (const chave of ['whatsapp','data_nascimento','rg','semestre','turma','catraca','instituicao']) {
    const { rotas, updates } = montar();
    await rotas['/eventos/:id/campos-padrao/:chave/deletar'](req(chave), resRedirect());
    assert.strictEqual(updates.length, 1, chave + ' deveria ser exclusível');
  }
});
