// Achado em 2026-08-05, na mesma investigação das inscrições presas em pendente: a página
// de pagamento do PSS só oferecia PIX — nunca existiu opção de cartão de crédito (existe em
// eventos.js e no portal do membro, mas nunca foi replicada pro processo seletivo). Quem só
// tinha cartão simplesmente não conseguia se inscrever. POST /pss/pagamento/:cid/cartao
// replica o mesmo padrão já usado em eventos.js.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/processo-seletivo.js');

function montar({ candidato, chargesResposta, erroAxios = null, confirmarImpl } = {}) {
  const queries = [];
  const confirmacoes = [];

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/SELECT c\.\*, p\.nome AS processo_nome FROM ps_candidatos c JOIN ps_processos/.test(sql)) {
        return { rows: [candidato] };
      }
      if (/INSERT INTO ps_pagamentos/.test(sql)) return { rows: [] };
      if (/SELECT numero_lista FROM ps_candidatos WHERE id=\$1/.test(sql)) {
        return { rows: [{ numero_lista: candidato.numero_lista_pos_confirmacao || candidato.numero_lista }] };
      }
      return { rows: [] };
    }
  }};

  const rax = require.resolve('axios');
  require.cache[rax] = { id: rax, filename: rax, loaded: true, exports: {
    post: async () => {
      if (erroAxios) { const e = new Error(erroAxios); e.response = { data: { message: erroAxios } }; throw e; }
      return { data: { id: 'ORDE_CARTAO_1', charges: chargesResposta || [] } };
    }
  }};

  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };
  const rar = require.resolve(path.join(RAIZ, 'src/services/arquivos.js'));
  require.cache[rar] = { id: rar, filename: rar, loaded: true, exports: { upload: { single: () => (q,s,n)=>n() }, uploadArquivo: async () => ({}) } };
  const rdl = require.resolve(path.join(RAIZ, 'src/services/desligamento.js'));
  require.cache[rdl] = { id: rdl, filename: rdl, loaded: true, exports: { getUrlAssinada: async () => 'https://x' } };
  const rnt = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rnt] = { id: rnt, filename: rnt, loaded: true, exports: { enviarEmail: async () => {} } };
  const rpss = require.resolve(path.join(RAIZ, 'src/services/pss.js'));
  require.cache[rpss] = { id: rpss, filename: rpss, loaded: true, exports: {
    _pssProximoNumero: async () => 5,
    confirmarInscricaoPss: confirmarImpl || (async (candId, opts) => { confirmacoes.push({ candId, opts }); }),
    enviarEmailConfirmacaoPss: async () => {}, enviarLembretePss: async () => {}, enviarEmailBoasVindasPss: async () => {}
  }};
  const rpg = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  require.cache[rpg] = { id: rpg, filename: rpg, loaded: true, exports: { criarPixPss: async () => ({}) } };

  const rotas = {};
  const router = { get: () => {}, post: (rota, ...fns) => { rotas[rota] = fns[fns.length - 1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, queries, confirmacoes };
}

const candidatoBase = {
  id: 12, nome: 'Ana Paula', email: 'ana@example.com', processo_id: 4, processo_nome: 'Proceso Selectivo 2026.2',
  valor_pago: 25, pagamento_status: 'pendente', numero_lista: null
};

function reqCartao(overrides) {
  return { params: { cid: '12' }, body: Object.assign({
    num: '4111111111111111', nome: 'ANA PAULA', mes: 12, ano: 2029, cvv: '123', cpf: '12345678909'
  }, overrides) };
}

function resJson() {
  const r = { _json: null };
  r.json = (data) => { r._json = data; return r; };
  return r;
}

test('cartão aprovado: confirma a inscrição pelo mesmo confirmarInscricaoPss do PIX (mesmo e-mail/QR)', async () => {
  const { rotas, confirmacoes } = montar({
    candidato: candidatoBase,
    chargesResposta: [{ status: 'PAID' }]
  });
  const res = resJson();
  await rotas['/pss/pagamento/:cid/cartao'](reqCartao(), res);
  assert.strictEqual(res._json.ok, true);
  assert.strictEqual(confirmacoes.length, 1);
  assert.strictEqual(confirmacoes[0].candId, 12);
  assert.strictEqual(confirmacoes[0].opts.metodo, 'cartao');
  assert.strictEqual(confirmacoes[0].opts.valorPago, 25);
});

test('cartão recusado: não confirma e devolve o motivo traduzido', async () => {
  const { rotas, confirmacoes } = montar({
    candidato: candidatoBase,
    chargesResposta: [{ status: 'DECLINED', payment_response: { message: 'insufficient funds' } }]
  });
  const res = resJson();
  await rotas['/pss/pagamento/:cid/cartao'](reqCartao(), res);
  assert.strictEqual(res._json.ok, false);
  assert.match(res._json.erro, /Saldo insuficiente/);
  assert.strictEqual(confirmacoes.length, 0, 'recusado não pode virar inscrição confirmada');
});

test('erro de rede/API do PagBank: mensagem genérica, não quebra a rota', async () => {
  const { rotas } = montar({ candidato: candidatoBase, erroAxios: 'timeout' });
  const res = resJson();
  await rotas['/pss/pagamento/:cid/cartao'](reqCartao(), res);
  assert.strictEqual(res._json.ok, false);
  assert.match(res._json.erro, /Erro ao processar cartão/);
});

test('candidato já confirmado antes (reenvio do form): não cobra de novo, só confirma que já está ok', async () => {
  const { rotas, confirmacoes } = montar({
    candidato: Object.assign({}, candidatoBase, { pagamento_status: 'confirmado', numero_lista: 7 })
  });
  const res = resJson();
  await rotas['/pss/pagamento/:cid/cartao'](reqCartao(), res);
  assert.strictEqual(res._json.ok, true);
  assert.strictEqual(res._json.numero, 7);
  assert.strictEqual(confirmacoes.length, 0, 'já estava confirmado — não pode gerar uma segunda cobrança');
});
