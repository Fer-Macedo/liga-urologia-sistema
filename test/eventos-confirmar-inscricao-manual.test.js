// 12/08/2026: caso real (Edilson Ferreira) — admin clicou "Confirmar" numa inscrição paga
// em dinheiro, e o botão só trocava o status da inscrição. Não registrava o pagamento, não
// lançava no fluxo de caixa e não mandava e-mail de confirmação — os 3 sintomas relatados
// vinham dessa única causa. Também corrige calcularLiquidoEvento: dinheiro caía no ramo do
// PIX e descontava 1,9% de um pagamento sem taxa de gateway nenhuma.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar({ inscricao, pagamentoExistente, lotePreco = 50 } = {}) {
  const updates = [];
  const inserts = [];
  const emails = [];
  let fluxoChamadas = 0;

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT \* FROM evento_inscricoes WHERE id=\$1/.test(sql)) return { rows: inscricao ? [inscricao] : [] };
      if (/UPDATE evento_inscricoes SET status='confirmado'/.test(sql)) { updates.push({ sql, params }); return { rows: [] }; }
      if (/SELECT preco FROM evento_lotes WHERE id=\$1/.test(sql)) return { rows: [{ preco: lotePreco }] };
      if (/SELECT id, status FROM evento_pagamentos WHERE inscricao_id=\$1 ORDER BY criado_em DESC/.test(sql)) {
        return { rows: pagamentoExistente ? [pagamentoExistente] : [] };
      }
      if (/UPDATE evento_pagamentos SET valor=\$1, metodo='dinheiro'/.test(sql)) { updates.push({ sql, params }); return { rows: [] }; }
      if (/INSERT INTO evento_pagamentos/.test(sql)) { inserts.push(params); return { rows: [] }; }
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
  require.cache[rev] = { id: rev, filename: rev, loaded: true, exports: {
    enviarEmailConfirmacaoEvento: async (id) => { emails.push(id); },
    TEXTO_CONFIRMACAO_PADRAO: 'texto padrao'
  }};
  const rfx = require.resolve(path.join(RAIZ, 'src/services/fluxo-eventos.js'));
  require.cache[rfx] = { id: rfx, filename: rfx, loaded: true, exports: {
    lancarEventoNoFluxo: async () => { fluxoChamadas++; return { ok: true }; },
    calcularLiquidoEvento: (v, m) => v
  }};

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, updates, inserts, emails, fluxoChamadas: () => fluxoChamadas };
}

function resRedirect() { const r = {}; r.redirect = () => r; return r; }
function req(params) { return { params, session: {} }; }

test('inscrição pendente, com lote, sem pagamento algum: registra em dinheiro, lança no fluxo, manda e-mail', async () => {
  const { rotas, inserts, emails, fluxoChamadas } = montar({
    inscricao: { id: 294, isento: false, lote_id: 3, status: 'pendente' },
    pagamentoExistente: null
  });
  await rotas['POST /eventos/:id/inscricoes/:iid/confirmar'](req({ id: '5', iid: '294' }), resRedirect());
  assert.strictEqual(inserts.length, 1, 'deve inserir um novo pagamento');
  assert.strictEqual(inserts[0][0], '294');
  assert.strictEqual(inserts[0][1], 50);
  assert.strictEqual(fluxoChamadas(), 1, 'deve lançar no fluxo de caixa');
  assert.deepStrictEqual(emails, ['294'], 'deve mandar o e-mail de confirmação');
});

test('inscrição com pagamento pendente já existente (caso Edilson): converte pra dinheiro/pago em vez de duplicar', async () => {
  const { rotas, updates, inserts, fluxoChamadas } = montar({
    inscricao: { id: 294, isento: false, lote_id: 3, status: 'pendente' },
    pagamentoExistente: { id: 236, status: 'pendente' }
  });
  await rotas['POST /eventos/:id/inscricoes/:iid/confirmar'](req({ id: '5', iid: '294' }), resRedirect());
  assert.strictEqual(inserts.length, 0, 'não deve inserir um segundo pagamento');
  const upd = updates.find(u => /UPDATE evento_pagamentos/.test(u.sql));
  assert.ok(upd, 'deve atualizar o pagamento existente');
  assert.strictEqual(upd.params[0], 50);
  assert.strictEqual(upd.params[1], 236);
  assert.strictEqual(fluxoChamadas(), 1);
});

test('pagamento já estava pago: não duplica lançamento no fluxo, mas ainda confirma e manda e-mail', async () => {
  const { rotas, updates, inserts, emails, fluxoChamadas } = montar({
    inscricao: { id: 294, isento: false, lote_id: 3, status: 'confirmado' },
    pagamentoExistente: { id: 236, status: 'pago' }
  });
  await rotas['POST /eventos/:id/inscricoes/:iid/confirmar'](req({ id: '5', iid: '294' }), resRedirect());
  assert.strictEqual(inserts.length, 0);
  assert.ok(!updates.some(u => /UPDATE evento_pagamentos/.test(u.sql)), 'não deve reescrever um pagamento já pago');
  assert.strictEqual(fluxoChamadas(), 0);
  assert.deepStrictEqual(emails, ['294']);
});

test('inscrição isenta: não mexe em pagamento nem fluxo, só confirma e manda e-mail', async () => {
  const { rotas, inserts, fluxoChamadas, emails } = montar({
    inscricao: { id: 300, isento: true, lote_id: 3, status: 'pendente' }
  });
  await rotas['POST /eventos/:id/inscricoes/:iid/confirmar'](req({ id: '5', iid: '300' }), resRedirect());
  assert.strictEqual(inserts.length, 0);
  assert.strictEqual(fluxoChamadas(), 0);
  assert.deepStrictEqual(emails, ['300']);
});

test('calcularLiquidoEvento: dinheiro não desconta taxa nenhuma (valor integral)', () => {
  delete require.cache[require.resolve(path.join(RAIZ, 'src/services/fluxo-eventos.js'))];
  const { calcularLiquidoEvento } = require(path.join(RAIZ, 'src/services/fluxo-eventos.js'));
  assert.strictEqual(calcularLiquidoEvento(100, 'dinheiro'), 100);
  assert.strictEqual(calcularLiquidoEvento(100, 'pix'), 98.1);
  assert.strictEqual(calcularLiquidoEvento(100, 'cartao'), 96);
});
