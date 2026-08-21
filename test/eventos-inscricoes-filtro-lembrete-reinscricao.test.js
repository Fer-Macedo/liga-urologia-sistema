// 12/08/2026: 3 correções relatadas juntas na aba Inscritos de um evento —
// 1) qualquer ação de linha (Confirmar/Excluir/Lembrete/Reenviar e-mail) voltava pra "Todos",
//    perdendo o filtro (ex: Pendentes) que o admin usava pra disparar lembretes um a um;
// 2) faltava um botão pra disparar o lembrete de pagamento pra TODOS os pendentes de uma vez;
// 3) quem começava a se inscrever mas não concluía o pagamento (status 'pendente') era barrado
//    ao tentar se inscrever de novo com "já existe uma inscrição", sem jeito de retomar.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar({ queryImpl, enviarConfirmacaoImpl } = {}) {
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: { query: queryImpl || (async () => ({ rows: [] })) } };
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };
  const re = require.resolve(path.join(RAIZ, 'src/services/email.js'));
  require.cache[re] = { id: re, filename: re, loaded: true, exports: { enviarEmail: async () => {}, emailBonito: () => '' } };
  const rev = require.resolve(path.join(RAIZ, 'src/services/eventos-email.js'));
  require.cache[rev] = { id: rev, filename: rev, loaded: true, exports: { enviarEmailConfirmacaoEvento: enviarConfirmacaoImpl || (async () => {}), TEXTO_CONFIRMACAO_PADRAO: 'x' } };
  const rpg = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  require.cache[rpg] = { id: rpg, filename: rpg, loaded: true, exports: { criarPixEvento: async () => ({}), consultarPagamento: async () => ({}), obterChavePublica: async () => ({}), pagarComCartao: async () => ({}) } };
  const rag = require.resolve(path.join(RAIZ, 'src/services/agendamentos.js'));
  require.cache[rag] = { id: rag, filename: rag, loaded: true, exports: { enviarLembreteInscricaoPendente: async () => ({ ok: true }) } };
  const rfx = require.resolve(path.join(RAIZ, 'src/services/fluxo-eventos.js'));
  require.cache[rfx] = { id: rfx, filename: rfx, loaded: true, exports: { lancarEventoNoFluxo: async () => ({ ok: true }), calcularLiquidoEvento: (v) => v } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas };
}

function resRedirect() { const r = {}; r.redirect = (url) => { r._redirect = url; return r; }; return r; }

test('confirmar inscrição preserva o filtro de status/tipo/lote da querystring no redirect', async () => {
  const { rotas } = montar({ queryImpl: async (sql) => {
    if (/SELECT \* FROM evento_inscricoes WHERE id=\$1/.test(sql)) return { rows: [{ id: 42, isento: true, lote_id: null, status: 'pendente' }] };
    return { rows: [] };
  }});
  const req = { params: { id: '5', iid: '42' }, query: { status: 'pendente', tipo: 'externo' }, session: {} };
  const res = resRedirect();
  await rotas['POST /eventos/:id/inscricoes/:iid/confirmar'](req, res);
  assert.strictEqual(res._redirect, '/eventos/5?tab=inscritos&status=pendente&tipo=externo');
});

test('confirmar sem filtro na querystring volta só pra aba inscritos, sem parâmetros extras', async () => {
  const { rotas } = montar({ queryImpl: async (sql) => {
    if (/SELECT \* FROM evento_inscricoes WHERE id=\$1/.test(sql)) return { rows: [{ id: 42, isento: true, lote_id: null, status: 'pendente' }] };
    return { rows: [] };
  }});
  const req = { params: { id: '5', iid: '42' }, query: {}, session: {} };
  const res = resRedirect();
  await rotas['POST /eventos/:id/inscricoes/:iid/confirmar'](req, res);
  assert.strictEqual(res._redirect, '/eventos/5?tab=inscritos');
});

test('lembrete a todos os pendentes: dispara em segundo plano pra cada pendente e responde na hora', async () => {
  const enviados = [];
  const { rotas } = montar({ queryImpl: async (sql, params) => {
    if (/SELECT id FROM evento_inscricoes WHERE evento_id=\$1 AND status='pendente'/.test(sql)) {
      return { rows: [{ id: 10 }, { id: 11 }] };
    }
    return { rows: [] };
  }});
  const rag = require.resolve(path.join(RAIZ, 'src/services/agendamentos.js'));
  require.cache[rag].exports.enviarLembreteInscricaoPendente = async (id) => { enviados.push(id); return { ok: true }; };

  const req = { params: { id: '5' }, query: { status: 'pendente' }, session: {} };
  const res = resRedirect();
  await rotas['POST /eventos/:id/inscricoes/lembrete-pendentes'](req, res);
  assert.strictEqual(res._redirect, '/eventos/5?tab=inscritos&status=pendente');
  assert.ok(req.session.msg[0].includes('2 pendente'));
  await new Promise(r => setTimeout(r, 20));
  assert.deepStrictEqual(enviados, [10, 11]);
});

test('lembrete a todos os pendentes: sem nenhum pendente, avisa e não dispara nada', async () => {
  const { rotas } = montar({ queryImpl: async (sql) => {
    if (/SELECT id FROM evento_inscricoes WHERE evento_id=\$1 AND status='pendente'/.test(sql)) return { rows: [] };
    return { rows: [] };
  }});
  const req = { params: { id: '5' }, query: {}, session: {} };
  const res = resRedirect();
  await rotas['POST /eventos/:id/inscricoes/lembrete-pendentes'](req, res);
  assert.deepStrictEqual(req.session.msg, ['Não há inscrições pendentes neste evento.']);
});

test('confirmação em massa: dispara o e-mail com QR Code pra cada confirmado e responde na hora', async () => {
  const enviados = [];
  const { rotas } = montar({
    queryImpl: async (sql) => {
      if (/SELECT id FROM evento_inscricoes WHERE evento_id=\$1 AND status='confirmado'/.test(sql)) {
        return { rows: [{ id: 20 }, { id: 21 }, { id: 22 }] };
      }
      return { rows: [] };
    },
    enviarConfirmacaoImpl: async (id) => { enviados.push(id); }
  });

  const req = { params: { id: '5' }, query: { status: 'confirmado' }, session: {} };
  const res = resRedirect();
  await rotas['POST /eventos/:id/inscricoes/confirmacoes-massa'](req, res);
  assert.strictEqual(res._redirect, '/eventos/5?tab=inscritos&status=confirmado');
  assert.ok(req.session.msg[0].includes('3 inscrito'));
  await new Promise(r => setTimeout(r, 20));
  assert.deepStrictEqual(enviados, [20, 21, 22]);
});

test('confirmação em massa: sem nenhum confirmado, avisa e não dispara nada', async () => {
  const { rotas } = montar({ queryImpl: async (sql) => {
    if (/SELECT id FROM evento_inscricoes WHERE evento_id=\$1 AND status='confirmado'/.test(sql)) return { rows: [] };
    return { rows: [] };
  }});
  const req = { params: { id: '5' }, query: {}, session: {} };
  const res = resRedirect();
  await rotas['POST /eventos/:id/inscricoes/confirmacoes-massa'](req, res);
  assert.deepStrictEqual(req.session.msg, ['Não há inscrições confirmadas neste evento.']);
});

test('reinscrição de quem ficou pendente: NÃO bloqueia, redireciona pra retomar o pagamento existente', async () => {
  const { rotas } = montar({ queryImpl: async (sql, params) => {
    if (/SELECT \* FROM eventos WHERE id=\$1/.test(sql)) return { rows: [{ id: 5, nome: 'Evento X' }] };
    if (/SELECT \* FROM evento_lotes WHERE id=\$1/.test(sql)) return { rows: [{ id: 1, preco: '50' }] };
    if (/SELECT id, status FROM evento_inscricoes WHERE evento_id=\$1 AND LOWER\(TRIM\(email\)\)=\$2/.test(sql)) {
      return { rows: [{ id: 777, status: 'pendente' }] };
    }
    return { rows: [] };
  }});
  const req = { params: { id: '5' }, body: { nome: 'João', email: 'joao@x.com', lote_id: '1' } };
  const res = resRedirect();
  await rotas['POST /inscricao/:id'](req, res);
  assert.strictEqual(res._redirect, '/pagamento/777');
});

test('reinscrição de quem já está confirmado: continua bloqueando (é duplicata de verdade)', async () => {
  const { rotas } = montar({ queryImpl: async (sql) => {
    if (/SELECT \* FROM eventos WHERE id=\$1/.test(sql)) return { rows: [{ id: 5, nome: 'Evento X' }] };
    if (/SELECT \* FROM evento_lotes WHERE id=\$1/.test(sql)) return { rows: [{ id: 1, preco: '50' }] };
    if (/SELECT id, status FROM evento_inscricoes WHERE evento_id=\$1 AND LOWER\(TRIM\(email\)\)=\$2/.test(sql)) {
      return { rows: [{ id: 777, status: 'confirmado' }] };
    }
    return { rows: [] };
  }});
  const req = { params: { id: '5' }, body: { nome: 'João', email: 'joao@x.com', lote_id: '1' } };
  let rendered = null;
  const res = { render: (view, data) => { rendered = { view, data }; } };
  await rotas['POST /inscricao/:id'](req, res);
  assert.ok(rendered);
  assert.strictEqual(rendered.data.sucesso, false);
  assert.ok(rendered.data.erro.includes('Já existe uma inscrição'));
});
