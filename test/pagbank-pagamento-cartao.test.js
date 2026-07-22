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
function montar({ pagoNoCheckout = null, linksAntigos = null } = {}) {
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
        { status: 'PAID', amount: { value: 2500 }, payment_method: { type: 'CREDIT_CARD' } }
      ] } };
    },
    detectarMetodo: () => 'cartao'
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
