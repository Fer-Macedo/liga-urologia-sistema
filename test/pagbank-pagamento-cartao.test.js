// INCIDENTE 2026-07-22 (Rafael Nardy Klein): pagou a mensalidade TRÊS vezes no cartão
// (14, 17 e 21/07, R$25 cada) e o sistema seguiu marcando junho e julho como ATRASADO,
// mandando cobrança todo dia. O dinheiro estava no PagBank o tempo todo.
//
// Duas falhas independentes, e as duas tinham que acontecer para o dinheiro sumir:
//
//   1. O AVISO DO PAGBANK ERA JOGADO FORA. O express.json global rodava ANTES da rota do
//      webhook e consumia o corpo da requisição. O express.raw da rota via req._body=true
//      e pulava; req.body chegava como objeto, req.body.toString() virava "[object Object]",
//      o JSON.parse estourava e a rota respondia 200 — "recebido, obrigado" — descartando.
//      Prova: "PagBank Webhook recebido" nunca apareceu no log, nem uma vez.
//
//   2. O CONFERIDOR OLHAVA NO LUGAR ERRADO. O cron de 3 em 3 minutos consultava só o
//      pagbank_charge_id, que é o pedido do PIX. Pagamento no CARTÃO cria um pedido NOVO,
//      pendurado no checkout do link, que nada amarra de volta à cobrança. Consultar o
//      pedido do PIX devolvia "sem cobranças" para sempre.
//
// Havia ainda uma terceira: ao regerar o PIX do atrasado, o link antigo era SOBRESCRITO —
// quem pagasse no link velho virava dinheiro sem dono (o PagBank não deixa buscar pedido
// por referência). Por isso o pagamento de 14/07 ficou irrastreável.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const RAIZ = path.join(__dirname, '..');

// ─── FALHA 1: O CORPO CRU DO WEBHOOK ──────────────────────────────────────────

test('o webhook do PagBank lê o corpo ANTES do express.json', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'src/server.js'), 'utf8');
  const iRaw = src.indexOf("app.use('/webhook/pagbank', express.raw(");
  const iJson = src.indexOf('app.use(express.json(');
  assert.ok(iRaw !== -1, 'o corpo cru do webhook precisa ser montado no server.js');
  assert.ok(iJson !== -1, 'o express.json global continua existindo');
  assert.ok(iRaw < iJson,
    'se o json rodar primeiro ele consome o corpo e TODA notificação do PagBank é descartada');
});

// Prova funcional da mecânica, com o express de verdade — nas duas ordens.
async function pedirWebhook(ordemCerta) {
  const express = require('express');
  const app = express();
  if (ordemCerta) app.use('/webhook/pagbank', express.raw({ type: '*/*' }));
  app.use(express.json());
  let lido = null;
  app.post('/webhook/pagbank', express.raw({ type: '*/*' }), (req, res) => {
    try { lido = JSON.parse(req.body.toString()); } catch (e) { lido = 'FALHOU: ' + e.name; }
    res.sendStatus(200);
  });
  const srv = app.listen(0);
  const porta = srv.address().port;
  await fetch('http://127.0.0.1:' + porta + '/webhook/pagbank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference_id: '47-2026-06', charges: [{ status: 'PAID' }] })
  });
  srv.close();
  return lido;
}

test('com o corpo cru antes do json, o webhook consegue ler a notificação', async () => {
  const lido = await pedirWebhook(true);
  assert.strictEqual(lido.reference_id, '47-2026-06', 'a referência da cobrança tem que chegar');
});

// A regressão exata que fez R$75 sumirem — se alguém reverter a ordem, isto volta.
test('com o json primeiro, a notificação é descartada (o bug do Rafael)', async () => {
  const lido = await pedirWebhook(false);
  assert.match(String(lido), /FALHOU/, 'era assim que toda notificação do PagBank morria');
});

// ─── FALHA 2: O CONFERIDOR AUTOMÁTICO ─────────────────────────────────────────

const MODULO = path.join(RAIZ, 'src/services/agendamentos.js');

// Reproduz o cenário real: o pedido do PIX está limpo, o pagamento está no checkout.
function montar({ pagoNoCheckout = null, linksAntigos = null, pagoEm = '2026-07-17T14:47:48.000-03:00' } = {}) {
  const updates = [];
  const consultados = [];

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT \* FROM cobrancas WHERE status IN/.test(sql)) {
        return { rows: [{
          id: 174, referencia: '47-2026-07', valor_cheio: 25, valor_desconto: 20,
          data_vencimento: '2026-07-15',
          pagbank_charge_id: 'ORDE_PIX_LIMPO',
          pagbank_link: 'https://pagamento.pagbank.com.br/pagamento?code=LINK-ATUAL',
          pagbank_links_antigos: linksAntigos
        }] };
      }
      if (/UPDATE cobrancas SET status='pago'/.test(sql)) { updates.push({ sql, params }); return { rowCount: 1, rows: [] }; }
      return { rows: [], rowCount: 0 };
    }
  }};

  const rp = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  require.cache[rp] = { id: rp, filename: rp, loaded: true, exports: {
    criarCobranca: async () => ({ ok: false }),
    // O pedido do PIX nunca foi pago: foi no cartão, por outro caminho.
    consultarPagamento: async (id) => { consultados.push(id); return { ok: true, status: 'PENDING', data: {} }; },
    consultarCheckout: async (link) => {
      const code = String(link).split('code=').pop();
      consultados.push(code);
      if (code !== pagoNoCheckout) return { ok: true, status: 'PENDING' };
      return { ok: true, status: 'PAID', data: { charges: [
        { status: 'PAID', amount: { value: 2500 }, paid_at: pagoEm, payment_method: { type: 'CREDIT_CARD' } }
      ] } };
    },
    detectarMetodo: () => 'cartao',
    extrairDataPagamento: (chs) => { const p = (chs||[]).find(c => c.status==='PAID' && c.paid_at); return p ? p.paid_at : null; }
  }};

  const rn = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rn] = { id: rn, filename: rn, loaded: true, exports: { notificarCobranca: async()=>{}, notificarAniversario: async()=>{} } };
  const rf = require.resolve(path.join(RAIZ, 'src/services/fluxo-mensalidade.js'));
  require.cache[rf] = { id: rf, filename: rf, loaded: true, exports: { lancarMensalidadeNoFluxo: async()=>{} } };

  delete require.cache[require.resolve(MODULO)];
  return { mod: require(MODULO), updates, consultados };
}

test('pagamento no CARTÃO dá baixa, mesmo com o pedido do PIX limpo', async () => {
  const { mod, updates } = montar({ pagoNoCheckout: 'LINK-ATUAL' });
  await mod.verificarPagamentos();
  assert.strictEqual(updates.length, 1, 'a cobrança tinha que ser baixada');
  assert.match(updates[0].sql, /status='pago'/);
});

test('o valor e o método vêm do que foi realmente pago no cartão', async () => {
  const { mod, updates } = montar({ pagoNoCheckout: 'LINK-ATUAL' });
  await mod.verificarPagamentos();
  assert.ok(updates[0].params.includes(25), 'valor_pago = R$25 (o que caiu no PagBank)');
  assert.ok(updates[0].params.includes('cartao'), 'método = cartão, não "pix" por omissão');
});

// O caso do pagamento de 14/07: pago num link que depois foi regerado e substituído.
test('pagamento feito num link ANTIGO também é encontrado', async () => {
  const { mod, updates } = montar({
    pagoNoCheckout: 'LINK-VELHO',
    linksAntigos: 'https://pagamento.pagbank.com.br/pagamento?code=LINK-VELHO'
  });
  await mod.verificarPagamentos();
  assert.strictEqual(updates.length, 1, 'sem isso o dinheiro fica sem dono para sempre');
});

// O estado exato de antes do conserto: consultava só o pedido do PIX e parava ali.
test('não basta consultar o pedido do PIX — o checkout tem que ser consultado', async () => {
  const { mod, consultados } = montar({ pagoNoCheckout: 'LINK-ATUAL' });
  await mod.verificarPagamentos();
  assert.ok(consultados.includes('LINK-ATUAL'),
    'pagamento no cartão nasce num pedido próprio, pendurado no checkout');
});

test('ninguém pagou: a cobrança continua em aberto', async () => {
  const { mod, updates } = montar({ pagoNoCheckout: null });
  await mod.verificarPagamentos();
  assert.strictEqual(updates.length, 0, 'baixa sem pagamento seria pior que o bug');
});

// ─── FALHA 3: O LINK ANTIGO SENDO DESTRUÍDO ───────────────────────────────────

test('ao regerar o link, o anterior é guardado em vez de sobrescrito', () => {
  const src = fs.readFileSync(MODULO, 'utf8');
  const i = src.indexOf('[PIX-UPDATE] PIX atualizado');
  const trecho = src.slice(Math.max(0, i - 1400), i);
  assert.match(trecho, /pagbank_links_antigos/,
    'sobrescrever o link apaga a única pista de um pagamento feito nele');
});

// ─── O RISCO NOVO: ressuscitar o webhook reabre uma porta ─────────────────────
// Enquanto o webhook estava morto, a falta de amarração order->referência era inofensiva
// (o handler não processava nada). Com ele vivo, vira exploração real: bastava mandar
// { orderId: <qualquer pedido pago, até o meu de R$5>, referencia: <cobrança da vítima> }
// para quitar a dívida de outro membro. A referência tem que vir da API, não do corpo.

const ROTA = path.join(RAIZ, 'src/routes/cobrancas.js');

function montarWebhook({ refDaApi = '47-2026-07', chargesDaApi = null } = {}) {
  const updates = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/UPDATE cobrancas SET status='pago'/.test(sql)) { updates.push({ sql, params }); return { rowCount: 1, rows: [{ id: 174 }] }; }
      return { rows: [], rowCount: 0 };
    }
  }};
  const rp = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  delete require.cache[rp];          // os testes acima deixaram um dublê no lugar
  const real = require(rp);          // aqui a gente quer o processarWebhook de verdade
  require.cache[rp] = { id: rp, filename: rp, loaded: true, exports: Object.assign({}, real, {
    criarCobranca: async () => ({ ok: false }),
    consultarPagamento: async () => ({ ok: true, status: 'PAID', data: {
      reference_id: refDaApi,
      charges: chargesDaApi || [{ status: 'PAID', amount: { value: 500 }, payment_method: { type: 'PIX' } }]
    } })
  })};
  const rf = require.resolve(path.join(RAIZ, 'src/services/fluxo-mensalidade.js'));
  require.cache[rf] = { id: rf, filename: rf, loaded: true, exports: { lancarMensalidadeNoFluxo: async()=>{} } };
  const ra = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[ra] = { id: ra, filename: ra, loaded: true, exports: {
    requireAuth:(q,s,n)=>n(), requireAdmin:(q,s,n)=>n(), requirePermissao:()=>(q,s,n)=>n(), requireMembro:(q,s,n)=>n()
  }};

  let handler = null;
  const router = { get: () => {}, use: () => {},
    post: (rota, ...fns) => { if (rota === '/webhook/pagbank') handler = fns[fns.length - 1]; },
    delete: () => {}, put: () => {} };
  delete require.cache[require.resolve(ROTA)];
  require(ROTA)(router);

  const notificar = async (corpo) => {
    await handler({ body: Buffer.from(JSON.stringify(corpo)) }, { sendStatus: () => {}, json: () => {}, redirect: () => {} });
    return updates;
  };
  return { notificar };
}

test('webhook honesto: a order confere com a referência e a baixa acontece', async () => {
  const { notificar } = montarWebhook({ refDaApi: '47-2026-07' });
  const u = await notificar({ id: 'ORDE_REAL', reference_id: '47-2026-07', status: 'PAID' });
  assert.strictEqual(u.length, 1, 'pagamento legítimo tem que dar baixa');
});

// A exploração: uma order paga DE VERDADE, apontada para a cobrança de outra pessoa.
test('forja: order paga de outro dono NÃO quita a cobrança da vítima', async () => {
  const { notificar } = montarWebhook({ refDaApi: 'evento-insc-99' });   // a API diz a verdade
  const u = await notificar({ id: 'ORDE_DO_ATACANTE', reference_id: '47-2026-07', status: 'PAID' });
  assert.strictEqual(u.length, 0, 'confirmar que a order está paga NÃO basta — tem que ser DELA');
});

test('valor e método vêm da API, não do corpo forjável', async () => {
  const { notificar } = montarWebhook({
    refDaApi: '47-2026-07',
    chargesDaApi: [{ status: 'PAID', amount: { value: 2500 }, payment_method: { type: 'CREDIT_CARD' } }]
  });
  const u = await notificar({ id: 'ORDE_REAL', reference_id: '47-2026-07', status: 'PAID',
                              charges: [{ status: 'PAID', amount: { value: 100 }, payment_method: { type: 'PIX' } }] });
  assert.ok(u[0].params.includes(25), 'R$25 (o que a API confirma), não R$1 do corpo');
  assert.ok(u[0].params.includes('cartao'), 'cartão (o que a API confirma), não "pix" do corpo');
});

// ─── A DATA DO DINHEIRO ───────────────────────────────────────────────────────
// O cron gravava data_pagamento=NOW() — a hora em que ELE percebeu. Enquanto o webhook
// esteve morto, pagamento notado dias depois entrava no fluxo de caixa na data errada:
// o pagamento do Rafael de 17/07 foi lançado em 22/07, 5 dias fora. O fluxo é caixa
// (dinheiro que entrou no dia), então a data tem que ser o paid_at do PagBank.

test('a baixa usa a data em que o dinheiro entrou, não a data de hoje', async () => {
  const { mod, updates } = montar({ pagoNoCheckout: 'LINK-ATUAL', pagoEm: '2026-07-17T14:47:48.000-03:00' });
  await mod.verificarPagamentos();
  assert.ok(updates[0].params.includes('2026-07-17T14:47:48.000-03:00'),
    'sem isso o caixa registra receita no dia errado');
  assert.doesNotMatch(updates[0].sql, /data_pagamento=NOW\(\)/,
    'NOW() puro é a data em que percebemos, não a em que o dinheiro entrou');
});

test('sem paid_at, cai no NOW() em vez de gravar data vazia', async () => {
  const { mod, updates } = montar({ pagoNoCheckout: 'LINK-ATUAL', pagoEm: null });
  await mod.verificarPagamentos();
  assert.match(updates[0].sql, /COALESCE\(\$4::timestamptz, NOW\(\)\)/,
    'cobrança paga sem data é pior que data aproximada');
});
