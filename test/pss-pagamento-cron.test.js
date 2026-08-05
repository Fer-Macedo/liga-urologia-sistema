// Achado em 2026-08-05: duas candidatas (Maria Eduarda, Laura) pagaram o PIX da inscrição
// no PSS e ficaram "pendente" pra sempre. Conferido direto na API do PagBank: as duas
// tinham charges com status PAID, minutos depois de gerar o PIX. O webhook só chegou UMA
// vez (na criação da order, pago:false) — nunca de novo no pagamento. E o cron de 3 em 3
// min (verificarPagamentos) só olhava a tabela `cobrancas` (mensalidades): ps_pagamentos
// não tinha rede de segurança nenhuma. verificarPagamentosPss fecha essa lacuna.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/agendamentos.js');

function montar({ pendentes = [], statusNaApi = 'PAID' } = {}) {
  const confirmacoes = [];
  const consultados = [];

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql) => {
      if (/SELECT p\.candidato_id, p\.pagbank_order_id FROM ps_pagamentos/.test(sql)) {
        return { rows: pendentes };
      }
      return { rows: [], rowCount: 0 };
    }
  }};

  const rp = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  require.cache[rp] = { id: rp, filename: rp, loaded: true, exports: {
    criarCobranca: async () => ({ ok: false }),
    consultarPagamento: async (orderId) => {
      consultados.push(orderId);
      if (statusNaApi !== 'PAID') return { ok: true, status: statusNaApi, data: {} };
      return { ok: true, status: 'PAID', data: { charges: [
        { status: 'PAID', amount: { value: 2500 }, payment_method: { type: 'PIX' } }
      ] } };
    },
    consultarCheckout: async () => ({ ok: false }),
    detectarMetodo: () => 'pix',
    extrairDataPagamento: () => null,
    extrairValorPago: (chs) => { const p = (chs||[]).find(c => c.status==='PAID'); return p ? p.amount.value/100 : null; }
  }};

  const rn = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rn] = { id: rn, filename: rn, loaded: true, exports: { notificarCobranca: async()=>{}, notificarAniversario: async()=>{} } };

  const rps = require.resolve(path.join(RAIZ, 'src/services/pss.js'));
  require.cache[rps] = { id: rps, filename: rps, loaded: true, exports: {
    confirmarInscricaoPss: async (candId, opts) => { confirmacoes.push({ candId, opts }); }
  }};

  delete require.cache[require.resolve(MODULO)];
  return { mod: require(MODULO), confirmacoes, consultados };
}

test('verificarPagamentosPss: candidato com PIX pago na API é confirmado', async () => {
  const { mod, confirmacoes } = montar({ pendentes: [{ candidato_id: 9, pagbank_order_id: 'ORDE_1' }] });
  await mod.verificarPagamentosPss();
  assert.strictEqual(confirmacoes.length, 1, 'o webhook perdido não pode significar candidato esquecido para sempre');
  assert.strictEqual(confirmacoes[0].candId, 9);
  assert.strictEqual(confirmacoes[0].opts.orderId, 'ORDE_1');
  assert.strictEqual(confirmacoes[0].opts.valorPago, 25);
  assert.strictEqual(confirmacoes[0].opts.metodo, 'pix');
});

test('verificarPagamentosPss: consulta cada order pendente na API do PagBank', async () => {
  const { mod, consultados } = montar({ pendentes: [
    { candidato_id: 9, pagbank_order_id: 'ORDE_1' },
    { candidato_id: 11, pagbank_order_id: 'ORDE_2' }
  ] });
  await mod.verificarPagamentosPss();
  assert.deepStrictEqual(consultados, ['ORDE_1', 'ORDE_2']);
});

test('verificarPagamentosPss: ainda não pago na API — não confirma', async () => {
  const { mod, confirmacoes } = montar({
    pendentes: [{ candidato_id: 9, pagbank_order_id: 'ORDE_1' }],
    statusNaApi: 'PENDING'
  });
  await mod.verificarPagamentosPss();
  assert.strictEqual(confirmacoes.length, 0, 'confirmar sem pagamento real seria pior que o bug');
});

test('verificarPagamentosPss: nenhum pendente — não quebra e não consulta nada', async () => {
  const { mod, consultados } = montar({ pendentes: [] });
  await mod.verificarPagamentosPss();
  assert.strictEqual(consultados.length, 0);
});

// A API real do PagBank devolve rel:"QRCODE.PNG" (ponto). O código procurava "QRCODE_PNG"
// (underline) nos 3 lugares que geram PIX — a imagem do QR nunca existiu, só o copia-e-cola.
test('criarCobranca/criarPixEvento/criarPixPss: procuram o rel real da API (QRCODE.PNG, com ponto)', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(RAIZ, 'src/services/pagbank.js'), 'utf8');
  const ocorrencias = src.match(/l\.rel === '[^']+'/g).filter(m => /QRCODE/.test(m));
  assert.strictEqual(ocorrencias.length, 3, 'as 3 funções de PIX geram o link da imagem do QR');
  ocorrencias.forEach(o => assert.match(o, /QRCODE\.PNG/, 'a API usa ponto, não underline — ' + o));
});
