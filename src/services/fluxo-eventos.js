// Valor líquido (já descontada a taxa do PagBank) de um pagamento de evento. Mesma taxa usada
// no lançamento real do fluxo de caixa: cartão 4%, PIX 1,9% (conforme extrato PagBank).
// Exportada para os paineis de eventos (aba financeiro, relatório em PDF) não mostrarem
// o bruto rotulado como "líquido" nem duplicarem a taxa com um número diferente.
function calcularLiquidoEvento(bruto, metodo) {
  const v = parseFloat(bruto) || 0;
  return metodo === 'cartao' ? Math.round(v * 0.96 * 100) / 100 : Math.round(v * 0.981 * 100) / 100;
}

// Lança no fluxo de caixa o pagamento de uma inscrição de evento, evitando duplicar
// (mesmo padrao usado em fluxo-mensalidade.js para mensalidades)
async function lancarEventoNoFluxo(query, inscricaoId) {
  try {
    const epR = await query(
      `SELECT ep.*, ei.nome as inscrito, e.nome as evento_nome
       FROM evento_pagamentos ep JOIN evento_inscricoes ei ON ei.id=ep.inscricao_id JOIN eventos e ON e.id=ei.evento_id
       WHERE ep.inscricao_id=$1 AND ep.status='pago' LIMIT 1`,
      [inscricaoId]
    );
    if (!epR.rows.length) return { ok: false, motivo: 'pagamento nao encontrado' };
    const ep = epR.rows[0];
    const jaExiste = await query('SELECT id FROM fluxo_caixa WHERE observacoes ILIKE $1', ['%inscricao_id:' + ep.id + '%']);
    if (jaExiste.rows.length) return { ok: true, motivo: 'ja lancado' };

    const v = parseFloat(ep.valor) || 0;
    const liquido = calcularLiquidoEvento(v, ep.metodo);
    const dataPag = new Date().toISOString().slice(0, 10);
    await query(
      `INSERT INTO fluxo_caixa (tipo,descricao,categoria,valor,data_lancamento,observacoes,criado_em) VALUES ('E',$1,'Eventos',$2,$3,$4,NOW())`,
      [('Ingresso ' + ep.evento_nome + ' — ' + ep.inscrito).substring(0, 200), liquido, dataPag,
       'Pago via ' + (ep.metodo || 'pix') + '. Bruto R$ ' + v.toFixed(2) + '. inscricao_id:' + ep.id]
    );
    return { ok: true, motivo: 'lancado' };
  } catch (e) {
    console.error('lancarEventoNoFluxo ERRO:', e.message);
    return { ok: false, motivo: e.message };
  }
}

module.exports = { lancarEventoNoFluxo, calcularLiquidoEvento };
