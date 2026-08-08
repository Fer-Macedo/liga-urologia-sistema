// Auditoria de segurança 2026-08-08: POST /pagamento/:inscricaoId/cartao mandava número/CVV
// do cartão em texto puro pro nosso servidor antes de chegar no PagBank (mesmo padrão do PSS,
// já corrigido em pss-pagamento-cartao.test.js). Corrigido pra tokenizar no navegador
// (PagSeguro.encryptCard) — o servidor só recebe encryptedCard, nunca PAN/CVV. Esta rota nunca
// teve teste antes; este arquivo cobre o fluxo novo.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

const inscricaoBase = { id: 30, lote_id: 3, nome: 'Carlos Souza', email: 'carlos@example.com', evento_id: 4, evento_nome: 'Congresso 2026', status: 'pendente' };
const loteBase = { id: 3, nome: 'Lote 1', preco: 150 };

function montar({ inscricao = inscricaoBase, lote = loteBase, pagarResposta, obterChaveResposta, confirmarEmailChamadas } = {}) {
  const queries = [];
  const emailsConfirmacao = confirmarEmailChamadas || [];
  const chamadasPagar = [];

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/FROM evento_inscricoes i JOIN eventos e/.test(sql)) return { rows: inscricao ? [inscricao] : [] };
      if (/FROM evento_lotes WHERE id=\$1/.test(sql)) return { rows: lote ? [lote] : [] };
      if (/INSERT INTO evento_pagamentos/.test(sql)) return { rows: [] };
      if (/UPDATE evento_inscricoes SET status='confirmado'/.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };
  const re = require.resolve(path.join(RAIZ, 'src/services/email.js'));
  require.cache[re] = { id: re, filename: re, loaded: true, exports: { enviarEmail: async () => {}, emailBonito: () => '' } };
  const rev = require.resolve(path.join(RAIZ, 'src/services/eventos-email.js'));
  require.cache[rev] = { id: rev, filename: rev, loaded: true, exports: { enviarEmailConfirmacaoEvento: async (id) => { emailsConfirmacao.push(id); } } };
  const rpg = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  require.cache[rpg] = { id: rpg, filename: rpg, loaded: true, exports: {
    criarPixEvento: async () => ({}), consultarPagamento: async () => ({}),
    obterChavePublica: async () => obterChaveResposta || { ok: true, publicKey: 'PUBKEY_TESTE' },
    pagarComCartao: async (args) => { chamadasPagar.push(args); return pagarResposta; }
  }};

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas[rota] = fns[fns.length - 1]; }, post: (rota, ...fns) => { rotas[rota] = fns[fns.length - 1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, queries, emailsConfirmacao, chamadasPagar };
}

function reqCartao(overrides) {
  return { params: { inscricaoId: '30' }, body: Object.assign({
    encryptedCard: 'ENC_XYZ789', holder_name: 'CARLOS SOUZA', holder_cpf: '12345678909'
  }, overrides) };
}

function resJson() {
  const r = { _json: null, _status: 200 };
  r.json = (data) => { r._json = data; return r; };
  r.status = (c) => { r._status = c; return r; };
  return r;
}

test('cartão aprovado: confirma a inscrição e envia o e-mail', async () => {
  const { rotas, emailsConfirmacao } = montar({
    pagarResposta: { ok: true, aprovado: true, charge_id: 'CHAR_1', status: 'PAID' }
  });
  const res = resJson();
  await rotas['/pagamento/:inscricaoId/cartao'](reqCartao(), res);
  assert.strictEqual(res._json.ok, true);
  assert.deepStrictEqual(emailsConfirmacao, ['30']);
});

test('cartão recusado: não confirma e devolve mensagem amigável', async () => {
  const { rotas, emailsConfirmacao } = montar({
    pagarResposta: { ok: true, aprovado: false, status: 'insufficient funds' }
  });
  const res = resJson();
  await rotas['/pagamento/:inscricaoId/cartao'](reqCartao(), res);
  assert.strictEqual(res._json.ok, false);
  assert.match(res._json.erro, /Saldo insuficiente/);
  assert.strictEqual(emailsConfirmacao.length, 0, 'recusado não pode confirmar a inscrição');
});

test('erro do gateway: mensagem genérica, não quebra a rota', async () => {
  const { rotas } = montar({ pagarResposta: { ok: false, erro: 'Não foi possível processar o pagamento. Verifique os dados do cartão.' } });
  const res = resJson();
  await rotas['/pagamento/:inscricaoId/cartao'](reqCartao(), res);
  assert.strictEqual(res._json.ok, false);
});

test('inscrição inexistente: erro claro, não tenta cobrar', async () => {
  const { rotas, chamadasPagar } = montar({ inscricao: null });
  const res = resJson();
  await rotas['/pagamento/:inscricaoId/cartao'](reqCartao(), res);
  assert.strictEqual(res._json.ok, false);
  assert.strictEqual(chamadasPagar.length, 0);
});

// ─── SEGURANÇA: cartão tokenizado no navegador, servidor nunca vê PAN/CVV ─────

test('sem encryptedCard, a rota recusa antes de chegar no PagBank (não aceita cartão em texto puro)', async () => {
  const { rotas, chamadasPagar } = montar({});
  const res = resJson();
  await rotas['/pagamento/:inscricaoId/cartao']({ params: { inscricaoId: '30' }, body: { num: '4111111111111111', cvv: '123', mes: 12, ano: 2029 } }, res);
  assert.strictEqual(res._json.ok, false);
  assert.strictEqual(chamadasPagar.length, 0, 'sem encryptedCard não pode nem tentar cobrar');
});

test('a cobrança é feita só com encryptedCard — número/CVV nunca são repassados ao pagbank.js', async () => {
  const { rotas, chamadasPagar } = montar({
    pagarResposta: { ok: true, aprovado: true, charge_id: 'CHAR_1', status: 'PAID' }
  });
  const res = resJson();
  await rotas['/pagamento/:inscricaoId/cartao'](reqCartao(), res);
  assert.strictEqual(chamadasPagar.length, 1);
  assert.strictEqual(chamadasPagar[0].encryptedCard, 'ENC_XYZ789');
  assert.strictEqual(chamadasPagar[0].num, undefined);
  assert.strictEqual(chamadasPagar[0].cvv, undefined);
});

test('GET /pagamento/chave-publica devolve a chave pública p/ tokenizar no navegador', async () => {
  const { rotas } = montar({});
  const res = resJson();
  await rotas['/pagamento/chave-publica']({}, res);
  assert.strictEqual(res._json.ok, true);
  assert.strictEqual(res._json.publicKey, 'PUBKEY_TESTE');
});

// O mock de rotas acima é um mapa plano (rota -> handler) — não reproduz a ordem real de
// registro do Express, então não pega o bug de "/pagamento/:inscricaoId" (registrada antes)
// engolindo "/pagamento/chave-publica" como se "chave-publica" fosse o :inscricaoId. Esse bug
// aconteceu de verdade (produção, 2026-08-08) — este teste usa um Router real pra não repetir.
test('com o Router real do Express, /pagamento/chave-publica não é engolida por /pagamento/:inscricaoId', async () => {
  montar({});
  const express = require('express');
  const realRouter = express.Router();
  require(MODULO)(realRouter);
  const app = express();
  app.use(express.json());
  app.use(realRouter);
  const srv = app.listen(0);
  try {
    const porta = srv.address().port;
    const r = await fetch('http://127.0.0.1:' + porta + '/pagamento/chave-publica');
    const data = await r.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.publicKey, 'PUBKEY_TESTE');
  } finally {
    srv.close();
  }
});
