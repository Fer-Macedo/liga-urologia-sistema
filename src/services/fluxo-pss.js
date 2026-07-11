// Lança no fluxo de caixa o pagamento de uma inscrição de Processo Seletivo (PSS),
// evitando duplicar (mesmo padrão de fluxo-eventos.js). Categoria: "Processo Seletivo".
async function lancarPssNoFluxo(query, pagamentoId) {
  try {
    const pR = await query(
      `SELECT pg.*, c.nome AS inscrito, c.numero_lista, p.nome AS processo_nome
       FROM ps_pagamentos pg JOIN ps_candidatos c ON c.id=pg.candidato_id JOIN ps_processos p ON p.id=c.processo_id
       WHERE pg.id=$1 AND pg.status='pago' LIMIT 1`, [pagamentoId]);
    if (!pR.rows.length) return { ok: false, motivo: 'pagamento nao encontrado' };
    const pg = pR.rows[0];
    const ja = await query('SELECT id FROM fluxo_caixa WHERE observacoes ILIKE $1', ['%ps_pagamento_id:' + pg.id + '%']);
    if (ja.rows.length) return { ok: true, motivo: 'ja lancado' };
    const v = parseFloat(pg.valor) || 0;
    const liquido = pg.metodo === 'cartao' ? Math.round(v * 0.96 * 100) / 100 : Math.round(v * 0.981 * 100) / 100;
    const dataPag = new Date().toISOString().slice(0, 10);
    await query(
      `INSERT INTO fluxo_caixa (tipo,descricao,categoria,valor,data_lancamento,observacoes,criado_em) VALUES ('E',$1,'Processo Seletivo',$2,$3,$4,NOW())`,
      [('Inscrição PSS ' + pg.processo_nome + ' — ' + pg.inscrito + (pg.numero_lista ? (' (nº ' + pg.numero_lista + ')') : '')).substring(0, 200),
       liquido, dataPag, 'Pago via ' + (pg.metodo || 'pix') + '. Bruto R$ ' + v.toFixed(2) + '. ps_pagamento_id:' + pg.id]
    );
    return { ok: true, motivo: 'lancado' };
  } catch (e) {
    console.error('lancarPssNoFluxo ERRO:', e.message);
    return { ok: false, motivo: e.message };
  }
}
module.exports = { lancarPssNoFluxo };
