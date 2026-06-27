// ═══ LANÇAMENTO AUTOMÁTICO DE MENSALIDADES NO FLUXO DE CAIXA ═══
// Quando uma cobrança recebe baixa (vira 'pago'), esta função lança o valor
// LÍQUIDO (descontada a taxa do PagBank) no fluxo de caixa, com nome do ligante,
// data de pagamento e mês de referência. Evita duplicação via flag lancado_fluxo.

// Taxas do PagBank (mesmas já usadas no sistema)
const TAXA_PIX = 0.019;     // 1,90% (conforme extrato PagBank)
const TAXA_CARTAO = 0.04;   // 4%
const TAXA_BOLETO = 0.019;  // trata como pix por padrão

function calcularLiquido(valorBruto, metodo) {
  let taxa = TAXA_PIX; // padrão pix (maioria)
  if (metodo === 'cartao') taxa = TAXA_CARTAO;
  else if (metodo === 'boleto') taxa = TAXA_BOLETO;
  const liquido = valorBruto * (1 - taxa);
  return Math.round(liquido * 100) / 100;
}

// Converte a referência (ex: "57-2026-05") no mês legível (ex: "05/2026")
function mesReferencia(referencia) {
  if (!referencia) return '';
  const m = String(referencia).match(/(\d{4})-(\d{2})$/);
  if (m) return m[2] + '/' + m[1];
  return String(referencia);
}

// Lança UMA cobrança paga no fluxo de caixa. Idempotente (não duplica).
// query: função de consulta ao banco ; cobrancaId: id da cobrança paga
async function lancarMensalidadeNoFluxo(query, cobrancaId) {
  try {
    // Busca a cobrança + dados do ligante; só lança se estiver paga e ainda não lançada
    const r = await query(`
      SELECT c.id, c.referencia, c.valor_cheio, c.valor_desconto, c.data_pagamento,
             c.data_vencimento, c.metodo_pagamento, c.lancado_fluxo, c.status,
             m.nome AS ligante_nome
      FROM cobrancas c
      JOIN membros m ON m.id = c.membro_id
      WHERE c.id = $1`, [cobrancaId]);
    if (!r.rows.length) return { ok: false, motivo: 'cobranca_nao_encontrada' };
    const c = r.rows[0];
    if (c.status !== 'pago') return { ok: false, motivo: 'nao_paga' };
    if (c.lancado_fluxo) return { ok: false, motivo: 'ja_lancada' };

    // valor bruto conforme a data de pagamento:
    // - pago ATÉ o vencimento (dia 15 do mês) => valor COM desconto (valor_desconto)
    // - pago DEPOIS do vencimento => valor CHEIO (valor_cheio)
    const vCheio = parseFloat(c.valor_cheio) || 0;
    const vDesc = parseFloat(c.valor_desconto != null ? c.valor_desconto : c.valor_cheio) || 0;
    let bruto = vDesc; // padrão: com desconto
    try {
      if (c.data_pagamento) {
        const pag = new Date(c.data_pagamento);
        const pagDia = new Date(pag.getFullYear(), pag.getMonth(), pag.getDate());
        // Vencimento fixo = dia 15 do mesmo mes do pagamento
        const diaVenc = new Date(pag.getFullYear(), pag.getMonth(), 15);
        // Se pagou DEPOIS do dia 15 => valor cheio
        if (pagDia > diaVenc) bruto = vCheio;
      }
    } catch (e) {}
    const metodo = c.metodo_pagamento || 'pix';
    const liquido = calcularLiquido(bruto, metodo);

    // data do lançamento = data de pagamento (quando o dinheiro entrou)
    const dataPag = c.data_pagamento ? new Date(c.data_pagamento) : new Date();
    const dataLanc = dataPag.toISOString().slice(0, 10); // YYYY-MM-DD

    // mês de referência da mensalidade (pode ser diferente do mês de pagamento)
    const mesRef = mesReferencia(c.referencia);
    const metodoLabel = metodo === 'cartao' ? 'Cartão' : (metodo === 'boleto' ? 'Boleto' : 'PIX');

    const descricao = 'Mensalidade ' + (c.ligante_nome || 'Ligante') + ' — ref. ' + mesRef;
    const obs = 'Pago em ' + dataLanc + ' via ' + metodoLabel +
                '. Bruto R$ ' + bruto.toFixed(2) + ', líquido R$ ' + liquido.toFixed(2) +
                ' (taxa PagBank descontada). Referente ao mês ' + mesRef + '.';

    await query(`
      INSERT INTO fluxo_caixa (tipo, descricao, categoria, valor, data_lancamento, observacoes, origem_cobranca_id, criado_em)
      VALUES ('E', $1, 'Mensalidades', $2, $3, $4, $5, NOW())`,
      [descricao, liquido, dataLanc, obs, c.id]);

    // marca como lançada para não duplicar
    await query('UPDATE cobrancas SET lancado_fluxo = true WHERE id = $1', [c.id]);

    return { ok: true, liquido, bruto, metodo, mesRef };
  } catch (e) {
    console.error('lancarMensalidadeNoFluxo ERRO:', e.message);
    return { ok: false, motivo: e.message };
  }
}

module.exports = { lancarMensalidadeNoFluxo, calcularLiquido, mesReferencia };
