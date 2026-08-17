// 17/08/2026: evento de vários dias (ex: jornada de 4 dias) tinha só 1 check-out pro evento
// INTEIRO — a mesma pessoa não podia confirmar presença em cada dia separadamente, e o painel
// só tinha um botão Abrir/Encerrar geral. Corrigido reaproveitando resolverDiaTransmissao (o
// mesmo resolvedor de dia já usado pela transmissão online): cada item de Programação com data
// ganha seu próprio checkout_aberto/checkout_fecha_em, e o check-out só é aceito quando o dia
// resolvido é HOJE de verdade. Evento sem nenhum item de Programação com data continua no modo
// legado (1 check-out pro evento inteiro), sem quebrar nada que já existia.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar({ evento, hojeProgramacao, proximaProgramacao, inscricao, checkoutExistente, mock } = {}) {
  const inserts = [];
  const updates = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (mock) { const r = mock(sql, params); if (r !== undefined) return r; }
      if (/SELECT \* FROM eventos WHERE id=\$1/.test(sql)) return { rows: evento ? [evento] : [] };
      if (/WHERE evento_id=\$1 AND data=CURRENT_DATE/.test(sql)) return { rows: hojeProgramacao ? [hojeProgramacao] : [] };
      if (/WHERE evento_id=\$1 AND data IS NOT NULL ORDER BY ABS/.test(sql)) return { rows: proximaProgramacao ? [proximaProgramacao] : [] };
      if (/SELECT id, nome, status, isento, email, rg FROM evento_inscricoes/.test(sql)) return { rows: inscricao ? [inscricao] : [] };
      if (/SELECT id FROM evento_checkouts WHERE evento_id=\$1 AND inscricao_id=\$2 AND programacao_id IS NOT DISTINCT FROM \$3/.test(sql)) {
        return { rows: checkoutExistente ? [{ id: 1 }] : [] };
      }
      if (/SELECT id FROM evento_checkouts WHERE evento_id=\$1 AND programacao_id IS NOT DISTINCT FROM \$4/.test(sql)) {
        return { rows: checkoutExistente ? [{ id: 1 }] : [] };
      }
      if (/INSERT INTO evento_checkouts/.test(sql)) { inserts.push(params); return { rows: [] }; }
      if (/UPDATE evento_programacao SET checkout_aberto/.test(sql)) { updates.push({ sql, params }); return { rows: [] }; }
      if (/UPDATE eventos SET checkout_aberto/.test(sql)) { updates.push({ sql, params }); return { rows: [] }; }
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
  const rnt = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rnt] = { id: rnt, filename: rnt, loaded: true, exports: { enviarWhatsApp: async () => {}, enviarEmail: async () => {} } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, inserts, updates };
}

function resRender() { const r = {}; r.render = (view, locals) => { r._view = view; r._locals = locals; return r; }; r.status = (c) => ({ send: (b) => { r._status = c; r._body = b; } }); return r; }
function resRedirect() { const r = {}; r.redirect = (u) => { r._redirect = u; return r; }; return r; }

const EVENTO = { id: 5, nome: 'Jornada', checkout_aberto: false, checkout_fecha_em: null };

test('GET /checkout/:id: dia de hoje com checkout aberto — aberto=true', async () => {
  const { rotas } = montar({
    evento: EVENTO,
    hojeProgramacao: { id: 10, titulo: 'Día 2', checkout_aberto: true, checkout_fecha_em: null }
  });
  const res = resRender();
  await rotas['GET /checkout/:id']({ params: { id: '5' } }, res);
  assert.strictEqual(res._locals.aberto, true);
  // 17/08/2026: a página pública NUNCA deve mostrar o título de dia específico — só o nome
  // real do evento. Mostrar "Promoción y Prevención de la Salud del Hombre" (título do dia 1)
  // como se fosse o nome do evento confundiu o cliente, que achou que era outro evento.
  assert.strictEqual(res._locals.tituloDia, undefined, 'tituloDia não pode mais existir nesta rota');
});

test('GET /checkout/:id: dia de hoje existe mas está com checkout ENCERRADO — aberto=false', async () => {
  const { rotas } = montar({
    evento: EVENTO,
    hojeProgramacao: { id: 10, titulo: 'Día 2', checkout_aberto: false, checkout_fecha_em: null }
  });
  const res = resRender();
  await rotas['GET /checkout/:id']({ params: { id: '5' } }, res);
  assert.strictEqual(res._locals.aberto, false);
});

test('GET /checkout/:id: dia resolvido NÃO é hoje (preview) — aberto=false mesmo com checkout_aberto=true no banco', async () => {
  const { rotas } = montar({
    evento: EVENTO,
    hojeProgramacao: null,
    proximaProgramacao: { id: 11, titulo: 'Día 1', checkout_aberto: true, checkout_fecha_em: null, data: '2026-08-17' }
  });
  const res = resRender();
  await rotas['GET /checkout/:id']({ params: { id: '5' } }, res);
  assert.strictEqual(res._locals.aberto, false, 'só é hoje que conta, dia fora da data não abre check-out de verdade');
});

test('GET /checkout/:id: evento SEM nenhum item de Programação com data — modo legado, usa evento.checkout_aberto', async () => {
  const { rotas } = montar({
    evento: { id: 6, nome: 'Palestra única', checkout_aberto: true, checkout_fecha_em: null },
    hojeProgramacao: null, proximaProgramacao: null
  });
  const res = resRender();
  await rotas['GET /checkout/:id']({ params: { id: '6' } }, res);
  assert.strictEqual(res._locals.aberto, true);
});

test('POST /checkout/:id: dia de hoje aberto — grava o check-out com o programacao_id do dia', async () => {
  const { rotas, inserts } = montar({
    evento: EVENTO,
    hojeProgramacao: { id: 10, titulo: 'Día 2', checkout_aberto: true, checkout_fecha_em: null },
    inscricao: { id: 42, nome: 'Fulano de Tal', email: 'f@x.com', status: 'confirmado', isento: false, rg: '123456' }
  });
  const res = resRender();
  await rotas['POST /checkout/:id']({ params: { id: '5' }, body: { email: 'f@x.com', documento: '123456' }, headers: {}, ip: '1.2.3.4' }, res);
  assert.strictEqual(inserts.length, 1);
  const [eventoId, programacaoId, inscricaoId] = inserts[0];
  assert.strictEqual(eventoId, '5');
  assert.strictEqual(programacaoId, 10, 'check-out fica marcado com o dia certo');
  assert.strictEqual(inscricaoId, 42);
  assert.strictEqual(res._locals.sucesso, true);
});

test('POST /checkout/:id: dia fechado (checkout_aberto=false) recusa com mensagem de encerrado', async () => {
  const { rotas, inserts } = montar({
    evento: EVENTO,
    hojeProgramacao: { id: 10, titulo: 'Día 2', checkout_aberto: false, checkout_fecha_em: null },
    inscricao: { id: 42, nome: 'Fulano', email: 'f@x.com', status: 'confirmado', isento: false, rg: '123456' }
  });
  const res = resRender();
  await rotas['POST /checkout/:id']({ params: { id: '5' }, body: { email: 'f@x.com', documento: '123456' }, headers: {}, ip: '1.2.3.4' }, res);
  assert.strictEqual(inserts.length, 0);
  assert.strictEqual(res._locals.aberto, false);
  assert.ok(res._locals.erro);
});

test('POST /checkout/:id: mesma pessoa, mesmo dia, 2ª tentativa — bloqueia como já confirmado (dedup por dia)', async () => {
  const { rotas, inserts } = montar({
    evento: EVENTO,
    hojeProgramacao: { id: 10, titulo: 'Día 2', checkout_aberto: true, checkout_fecha_em: null },
    inscricao: { id: 42, nome: 'Fulano', email: 'f@x.com', status: 'confirmado', isento: false, rg: '123456' },
    checkoutExistente: true
  });
  const res = resRender();
  await rotas['POST /checkout/:id']({ params: { id: '5' }, body: { email: 'f@x.com', documento: '123456' }, headers: {}, ip: '1.2.3.4' }, res);
  assert.strictEqual(inserts.length, 0);
  assert.strictEqual(res._locals.jaConfirmado, true);
});

test('POST /checkout/:id: sem nenhum item de Programação — modo legado grava programacao_id nulo', async () => {
  const { rotas, inserts } = montar({
    evento: { id: 6, nome: 'Palestra única', checkout_aberto: true, checkout_fecha_em: null },
    hojeProgramacao: null, proximaProgramacao: null,
    inscricao: { id: 50, nome: 'Ciclana', email: 'c@x.com', status: 'confirmado', isento: false, rg: '999' }
  });
  const res = resRender();
  await rotas['POST /checkout/:id']({ params: { id: '6' }, body: { email: 'c@x.com', documento: '999' }, headers: {}, ip: '1.2.3.4' }, res);
  assert.strictEqual(inserts.length, 1);
  assert.strictEqual(inserts[0][1], null, 'evento sem Programação por data não tem dia — programacao_id fica null');
});

test('POST /eventos/:id/programacao/:pid/checkout-toggle: abre o check-out DAQUELE dia (não mexe no evento inteiro)', async () => {
  const { rotas, updates } = montar({ evento: EVENTO });
  const req = { params: { id: '5', pid: '10' }, body: { acao: 'abrir', fecha_em: '' }, session: {} };
  await rotas['POST /eventos/:id/programacao/:pid/checkout-toggle'](req, resRedirect());
  assert.strictEqual(updates.length, 1);
  assert.match(updates[0].sql, /UPDATE evento_programacao SET checkout_aberto=true/);
  assert.deepStrictEqual(updates[0].params, [null, '10', '5']);
});

test('POST /eventos/:id/programacao/:pid/checkout-toggle: encerra o check-out daquele dia', async () => {
  const { rotas, updates } = montar({ evento: EVENTO });
  const req = { params: { id: '5', pid: '10' }, body: { acao: 'encerrar' }, session: {} };
  await rotas['POST /eventos/:id/programacao/:pid/checkout-toggle'](req, resRedirect());
  assert.strictEqual(updates.length, 1);
  assert.match(updates[0].sql, /UPDATE evento_programacao SET checkout_aberto=false/);
  assert.deepStrictEqual(updates[0].params, ['10', '5']);
});

test('GET /eventos/:id/checkout-relatorio: traz a contagem por dia (porDia)', async () => {
  const { rotas } = montar({
    evento: EVENTO,
    mock: (sql, params) => {
      if (/SELECT id, nome, checkout_aberto, checkout_fecha_em FROM eventos/.test(sql)) return { rows: [EVENTO] };
      if (/SELECT id, nome, email, cpf, status, isento FROM evento_inscricoes/.test(sql)) return { rows: [
        { id: 1, nome: 'A', email: 'a@x.com', status: 'confirmado', isento: false },
        { id: 2, nome: 'B', email: 'b@x.com', status: 'confirmado', isento: false }
      ] };
      if (/SELECT inscricao_id, email, cpf, nome_informado, criado_em, programacao_id FROM evento_checkouts/.test(sql)) return { rows: [
        { inscricao_id: 1, email: 'a@x.com', cpf: null, nome_informado: 'A', criado_em: new Date(), programacao_id: 10 },
        { inscricao_id: 1, email: 'a@x.com', cpf: null, nome_informado: 'A', criado_em: new Date(), programacao_id: 11 },
        { inscricao_id: 2, email: 'b@x.com', cpf: null, nome_informado: 'B', criado_em: new Date(), programacao_id: 10 }
      ] };
      if (/SELECT id, titulo, data FROM evento_programacao WHERE evento_id=\$1 AND data IS NOT NULL/.test(sql)) return { rows: [
        { id: 10, titulo: 'Día 1', data: '2026-08-17' },
        { id: 11, titulo: 'Día 2', data: '2026-08-18' }
      ] };
      return undefined;
    }
  });
  const res = { json: (b) => { res._body = b; } };
  await rotas['GET /eventos/:id/checkout-relatorio']({ params: { id: '5' } }, res);
  assert.strictEqual(res._body.ok, true);
  assert.deepStrictEqual(res._body.porDia.map(d => d.total), [2, 1], 'Día 1 teve 2 check-outs (A e B), Día 2 só 1 (A)');
  assert.strictEqual(res._body.resumo.aptos, 2, 'A e B fizeram check-out em pelo menos 1 dia cada');
});

test('schema: evento_checkouts tem CREATE TABLE no código e as colunas de check-out por dia existem', () => {
  const src = require('fs').readFileSync(path.join(RAIZ, 'src/models/database.js'), 'utf8');
  assert.match(src, /CREATE TABLE IF NOT EXISTS evento_checkouts \(/, 'evento_checkouts precisa ter CREATE TABLE no código');
  assert.match(src, /ALTER TABLE evento_programacao ADD COLUMN IF NOT EXISTS checkout_aberto BOOLEAN/);
  assert.match(src, /ALTER TABLE evento_programacao ADD COLUMN IF NOT EXISTS checkout_fecha_em TIMESTAMP/);
  assert.match(src, /ALTER TABLE evento_checkouts ADD COLUMN IF NOT EXISTS programacao_id INTEGER/);
});

// 17/08/2026: pedido do usuário — baixar o QR Code do link de check-out (o link é o MESMO nos
// 4 dias, o servidor resolve sozinho qual dia é hoje) pra colocar fixo na apresentação.
function resBuffer() {
  const r = { _headers: {} };
  r.set = (k, v) => { r._headers[k] = v; return r; };
  r.status = (c) => { r._status = c; return r; };
  r.send = (b) => { r._body = b; return r; };
  return r;
}

test('GET /eventos/:id/checkout-qrcode: baixa o PNG do QR do link público (mesmo link, sem depender do dia)', async () => {
  const { rotas } = montar({ evento: EVENTO });
  const chamadas = [];
  global.fetch = async (url) => {
    chamadas.push(url);
    return { ok: true, arrayBuffer: async () => Buffer.from('fake-png-bytes') };
  };
  try {
    const res = resBuffer();
    await rotas['GET /eventos/:id/checkout-qrcode']({ params: { id: '5' } }, res);
    assert.strictEqual(res._headers['Content-Type'], 'image/png');
    assert.match(res._headers['Content-Disposition'], /attachment; filename="checkout-qr-evento-5\.png"/);
    assert.match(chamadas[0], /data=https%3A%2F%2Finscricao\.lauroucpcde\.com%2Fcheckout%2F5/, 'pede o QR do mesmo link público mostrado no painel');
    assert.ok(Buffer.isBuffer(res._body));
  } finally { delete global.fetch; }
});

test('GET /eventos/:id/checkout-qrcode: serviço externo fora do ar devolve 502, não quebra', async () => {
  const { rotas } = montar({ evento: EVENTO });
  global.fetch = async () => ({ ok: false });
  try {
    const res = resBuffer();
    await rotas['GET /eventos/:id/checkout-qrcode']({ params: { id: '5' } }, res);
    assert.strictEqual(res._status, 502);
  } finally { delete global.fetch; }
});

// 17/08/2026: BUG GRAVE relatado pelo usuário — a página pública de check-out mostrava o
// título do dia (ex: "Promoción y Prevención de la Salud del Hombre") junto da frase de
// confirmação, e isso pareceu pro cliente o nome de um evento DIFERENTE do real ("II Jornada
// de Salud del Hombre"). A página só pode mostrar o nome real do evento — nunca o título do
// dia — em nenhum evento, agora nem no futuro.
test('página pública de check-out: NUNCA mostra o título do dia, só o nome real do evento', () => {
  const ejs = require('ejs');
  const fs = require('fs');
  const ARQUIVO = path.join(RAIZ, 'views/pages/evento-checkout-publico.ejs');
  const html = ejs.render(fs.readFileSync(ARQUIVO, 'utf8'), {
    evento: { id: 5, nome: 'II Jornada de Salud del Hombre' }, config: {},
    aberto: true, sucesso: false, jaConfirmado: false, erro: null, nome: null,
    tituloDia: 'Promoción y Prevención de la Salud del Hombre' // mesmo se alguém reintroduzir a variável...
  }, { filename: ARQUIVO });
  assert.match(html, /II Jornada de Salud del Hombre/, 'precisa mostrar o nome real do evento');
  assert.ok(!html.includes('Promoción y Prevención de la Salud del Hombre'), 'NUNCA pode mostrar o título do dia — confunde o cliente com outro evento');
});
