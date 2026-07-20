// Ao gerar a cobrança do mês, o desconto de pontualidade vinha de
// `parseFloat(membro.desconto_pontualidade) || parseFloat(config.desconto_padrao) || 20`.
// Com `||`, um desconto configurado como 0% (parseFloat('0')=0, que é falsy) era tratado
// como ausente e virava 20% — o membro que deveria pagar cheio ganhava desconto. É dinheiro.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/agendamentos.js');

// Roda gerarCobrancasMes para UM membro e devolve o valor_desconto que seria gravado.
async function valorDescontoGravado({ mensalidade, descontoMembro, descontoPadrao }) {
  let capturado = null;
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT \* FROM membros/.test(sql)) {
        return { rows: [{ id: 1, mensalidade, desconto_pontualidade: descontoMembro, dia_vencimento: 10 }] };
      }
      if (/SELECT chave, valor FROM configuracoes/.test(sql)) {
        return { rows: descontoPadrao == null ? [] : [{ chave: 'desconto_padrao', valor: descontoPadrao }] };
      }
      if (/SELECT id FROM cobrancas WHERE membro_id/.test(sql)) return { rows: [] }; // não existe ainda
      if (/INSERT INTO cobrancas/.test(sql)) { capturado = params; return { rows: [] }; }
      return { rows: [] };
    }
  }};
  // PagBank stubado: o teste é sobre o cálculo do desconto, não sobre a emissão do PIX.
  const rp = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  require.cache[rp] = { id: rp, filename: rp, loaded: true, exports: {
    criarCobranca: async () => ({ ok: false })
  }};

  delete require.cache[require.resolve(MODULO)];
  await require(MODULO).gerarCobrancasMes();
  // INSERT: ($1 membro_id, $2 ref, $3 valor_cheio, $4 valor_desconto, ...)
  return { valorCheio: capturado[2], valorDesc: capturado[3] };
}

test('desconto de 0% é respeitado: valor com desconto = valor cheio', async () => {
  const r = await valorDescontoGravado({ mensalidade: '100', descontoMembro: '0', descontoPadrao: '20' });
  assert.strictEqual(r.valorCheio, 100);
  assert.strictEqual(r.valorDesc, 100, '0% de desconto não pode virar 20%');
});

test('desconto normal do membro é aplicado', async () => {
  const r = await valorDescontoGravado({ mensalidade: '100', descontoMembro: '15', descontoPadrao: '20' });
  assert.strictEqual(r.valorDesc, 85);
});

test('sem desconto no membro, usa o padrão da configuração', async () => {
  const r = await valorDescontoGravado({ mensalidade: '100', descontoMembro: null, descontoPadrao: '10' });
  assert.strictEqual(r.valorDesc, 90);
});

test('padrão da config em 0% também é respeitado', async () => {
  const r = await valorDescontoGravado({ mensalidade: '100', descontoMembro: null, descontoPadrao: '0' });
  assert.strictEqual(r.valorDesc, 100, '0% no padrão não pode virar 20%');
});

test('sem membro nem config, cai no default histórico de 20%', async () => {
  const r = await valorDescontoGravado({ mensalidade: '100', descontoMembro: null, descontoPadrao: null });
  assert.strictEqual(r.valorDesc, 80);
});
