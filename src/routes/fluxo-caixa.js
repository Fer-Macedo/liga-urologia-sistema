// ═══ FLUXO DE CAIXA ═════════════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');

module.exports = function (router) {

router.get('/fluxo-caixa', requireAuth, requirePermissao('fluxo-caixa'), async (req, res) => {
  try {
    const mesesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const hoje = new Date();
    const mesAtual = req.query.mes || `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`;
    const [ano, mes] = mesAtual.split('-').map(Number);
    const mesNome = mesesNomes[mes-1] + ' ' + ano;

    const lancamentos = await query(
      `SELECT f.*,
        COALESCE(c.metodo_pagamento, substring(f.observacoes from 'Pago via (\\w+)')) AS metodo_pagamento
       FROM fluxo_caixa f LEFT JOIN cobrancas c ON c.id=f.origem_cobranca_id
       WHERE EXTRACT(YEAR FROM f.data_lancamento)=$1 AND EXTRACT(MONTH FROM f.data_lancamento)=$2 ORDER BY f.data_lancamento DESC, f.id DESC`,
      [ano, mes]
    );

    const entradas = lancamentos.rows.filter(l => l.tipo === 'E');
    const saidas   = lancamentos.rows.filter(l => l.tipo === 'S');
    const totalEntradas = entradas.reduce((s,l) => s + parseFloat(l.valor), 0);
    const totalSaidas   = saidas.reduce((s,l) => s + parseFloat(l.valor), 0);
    const saldo = totalEntradas - totalSaidas;

    // Saldo acumulado = tudo ate o FIM do mes visualizado
    const saldoAcumR = await query(
      `SELECT
        COALESCE(SUM(CASE WHEN tipo='E' THEN valor ELSE 0 END),0) AS total_e,
        COALESCE(SUM(CASE WHEN tipo='S' THEN valor ELSE 0 END),0) AS total_s
       FROM fluxo_caixa
       WHERE data_lancamento <= (DATE_TRUNC('month', $1::date) + INTERVAL '1 month - 1 day')`,
      [mesAtual + '-01']
    );
    const saldoAcumulado = parseFloat(saldoAcumR.rows[0].total_e) - parseFloat(saldoAcumR.rows[0].total_s);
    // Saldo anterior = acumulado ate fim do mes anterior
    const saldoAntR = await query(
      `SELECT
        COALESCE(SUM(CASE WHEN tipo='E' THEN valor ELSE 0 END),0) AS total_e,
        COALESCE(SUM(CASE WHEN tipo='S' THEN valor ELSE 0 END),0) AS total_s
       FROM fluxo_caixa
       WHERE data_lancamento < DATE_TRUNC('month', $1::date)`,
      [mesAtual + '-01']
    );
    const saldoAnterior = parseFloat(saldoAntR.rows[0].total_e) - parseFloat(saldoAntR.rows[0].total_s);

    res.render('pages/fluxo-caixa', {
      config: await getConfig(), usuario: req.session.usuario,
      lancamentos: lancamentos.rows, mesAtual, mesNome,
      totalEntradas, totalSaidas, saldo,
      saldoAcumulado, saldoAnterior,
      qtdEntradas: entradas.length, qtdSaidas: saidas.length,
      msg: req.flash('msg'), erro: req.flash('erro')
    });
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/dashboard'); }
});

router.get('/fluxo-caixa/graficos-data', requireAuth, requirePermissao('fluxo-caixa'), async (req, res) => {
  try {
    // Mensal — últimos 12 meses
    const mensal = await query(`
      SELECT TO_CHAR(data_lancamento,'YYYY-MM') as mes,
        SUM(CASE WHEN tipo='E' THEN valor ELSE 0 END) as entradas,
        SUM(CASE WHEN tipo='S' THEN valor ELSE 0 END) as saidas
      FROM fluxo_caixa
      WHERE data_lancamento >= NOW() - INTERVAL '12 months'
      GROUP BY mes ORDER BY mes`);
    // Semanal — últimas 8 semanas
    const semanal = await query(`
      SELECT TO_CHAR(DATE_TRUNC('week',data_lancamento),'DD/MM') as semana,
        SUM(CASE WHEN tipo='E' THEN valor ELSE 0 END) as entradas,
        SUM(CASE WHEN tipo='S' THEN valor ELSE 0 END) as saidas
      FROM fluxo_caixa
      WHERE data_lancamento >= NOW() - INTERVAL '8 weeks'
      GROUP BY DATE_TRUNC('week',data_lancamento), semana ORDER BY DATE_TRUNC('week',data_lancamento)`);
    // Anual — últimos 5 anos
    const anual = await query(`
      SELECT EXTRACT(YEAR FROM data_lancamento)::text as ano,
        SUM(CASE WHEN tipo='E' THEN valor ELSE 0 END) as entradas,
        SUM(CASE WHEN tipo='S' THEN valor ELSE 0 END) as saidas
      FROM fluxo_caixa
      WHERE data_lancamento >= NOW() - INTERVAL '5 years'
      GROUP BY ano ORDER BY ano`);
    // Categorias do mês atual
    const hoje = new Date();
    const categorias = await query(`
      SELECT categoria, tipo,
        SUM(valor) as total
      FROM fluxo_caixa
      WHERE EXTRACT(YEAR FROM data_lancamento)=$1 AND EXTRACT(MONTH FROM data_lancamento)=$2
        AND categoria IS NOT NULL
      GROUP BY categoria, tipo ORDER BY total DESC`,
      [hoje.getFullYear(), hoje.getMonth()+1]);
    res.json({ mensal: mensal.rows, semanal: semanal.rows, anual: anual.rows, categorias: categorias.rows });
  } catch(e) { res.json({ erro: e.message }); }
});

router.post('/fluxo-caixa/novo', requireAuth, requirePermissao('fluxo-caixa'), async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.fields([{name:'nf',maxCount:1},{name:'nf2',maxCount:1}])(req, res, async (err) => {
      if (err) { req.flash('erro', [err.message]); return res.redirect('/fluxo-caixa'); }
      const { tipo, descricao, categoria, valor, data_lancamento, observacoes } = req.body;
      let nf_chave = null, nf_nome_original = null, nf_chave2 = null, nf_nome_original2 = null;
      if (req.files && req.files['nf'] && req.files['nf'][0]) {
        const f = req.files['nf'][0];
        const r = await uploadArquivo(f.buffer, f.originalname, f.mimetype, 'fluxo-caixa');
        nf_chave = r.chave; nf_nome_original = f.originalname;
      }
      if (req.files && req.files['nf2'] && req.files['nf2'][0]) {
        const f = req.files['nf2'][0];
        const r = await uploadArquivo(f.buffer, f.originalname, f.mimetype, 'fluxo-caixa');
        nf_chave2 = r.chave; nf_nome_original2 = f.originalname;
      }
      await query(
        `INSERT INTO fluxo_caixa (tipo,descricao,categoria,valor,data_lancamento,nf_chave,nf_nome_original,nf_chave2,nf_nome_original2,observacoes,criado_por,criado_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
        [tipo, descricao, categoria, parseFloat(valor), data_lancamento, nf_chave, nf_nome_original, nf_chave2, nf_nome_original2, observacoes||null, req.session.usuario.id]
      );
      const mes = data_lancamento.substring(0,7);
      req.flash('msg', [tipo==='E'?'Entrada registrada!':'Saída registrada!']);
      res.redirect('/fluxo-caixa?mes='+mes);
    });
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/fluxo-caixa'); }
});

router.post('/fluxo-caixa/:id/editar', requireAuth, requirePermissao('fluxo-caixa'), async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.fields([{name:'nf',maxCount:1},{name:'nf2',maxCount:1}])(req, res, async (err) => {
      if (err) { req.flash('erro', [err.message]); return res.redirect('/fluxo-caixa'); }
      const { tipo, descricao, categoria, valor, data_lancamento, observacoes } = req.body;
      const atual = await query('SELECT nf_chave,nf_nome_original,nf_chave2,nf_nome_original2 FROM fluxo_caixa WHERE id=$1',[req.params.id]);
      let nf_chave = atual.rows[0]?.nf_chave;
      let nf_nome_original = atual.rows[0]?.nf_nome_original;
      let nf_chave2 = atual.rows[0]?.nf_chave2;
      let nf_nome_original2 = atual.rows[0]?.nf_nome_original2;
      if (req.files && req.files['nf'] && req.files['nf'][0]) {
        const f = req.files['nf'][0];
        const r = await uploadArquivo(f.buffer, f.originalname, f.mimetype, 'fluxo-caixa');
        nf_chave = r.chave; nf_nome_original = f.originalname;
      }
      if (req.files && req.files['nf2'] && req.files['nf2'][0]) {
        const f = req.files['nf2'][0];
        const r = await uploadArquivo(f.buffer, f.originalname, f.mimetype, 'fluxo-caixa');
        nf_chave2 = r.chave; nf_nome_original2 = f.originalname;
      }
      await query(
        `UPDATE fluxo_caixa SET tipo=$1,descricao=$2,categoria=$3,valor=$4,data_lancamento=$5,nf_chave=$6,nf_nome_original=$7,nf_chave2=$8,nf_nome_original2=$9,observacoes=$10 WHERE id=$11`,
        [tipo, descricao, categoria, parseFloat(valor), data_lancamento, nf_chave, nf_nome_original, nf_chave2, nf_nome_original2, observacoes||null, req.params.id]
      );
      const mes = data_lancamento.substring(0,7);
      req.flash('msg', ['Lançamento atualizado!']);
      res.redirect('/fluxo-caixa?mes='+mes);
    });
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/fluxo-caixa'); }
});

router.post('/fluxo-caixa/excluir-lote', requireAuth, requirePermissao('fluxo-caixa'), async (req, res) => {
  try {
    const ids = req.body.ids;
    const mesRef = req.body.mes || '';
    const lista = (Array.isArray(ids)?ids:[ids]).map(Number).filter(n=>n>0);
    if(!lista.length){ req.flash('erro',['Nenhum item selecionado']); return res.redirect(req.headers.referer||'/fluxo-caixa'); }
    for(const id of lista){ await query('DELETE FROM fluxo_caixa WHERE id=$1',[id]); }
    req.flash('msg', [lista.length+' lancamento(s) excluido(s).']);
    res.redirect('/fluxo-caixa'+(mesRef?'?mes='+mesRef:''));
  } catch(e){ req.flash('erro',[e.message]); res.redirect('/fluxo-caixa'); }
});

router.post('/fluxo-caixa/:id/excluir', requireAuth, requirePermissao('fluxo-caixa'), async (req, res) => {
  try {
    const r = await query('SELECT data_lancamento FROM fluxo_caixa WHERE id=$1',[req.params.id]);
    const mes = r.rows[0]?.data_lancamento?.toISOString?.()?.substring(0,7) || '';
    await query('DELETE FROM fluxo_caixa WHERE id=$1',[req.params.id]);
    req.flash('msg', ['Lançamento excluído.']);
    res.redirect('/fluxo-caixa'+(mes?'?mes='+mes:''));
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/fluxo-caixa'); }
});

router.get('/fluxo-caixa/:id/nf-url', requireAuth, requirePermissao('fluxo-caixa'), async (req, res) => {
  try {
    const r = await query('SELECT nf_chave,nf_nome_original FROM fluxo_caixa WHERE id=$1',[req.params.id]);
    const d = r.rows[0];
    if (!d?.nf_chave) return res.json({url:null});
    const { getUrlAssinada } = require('../services/desligamento');
    const url = await getUrlAssinada(d.nf_chave);
    res.json({url, nome: d.nf_nome_original});
  } catch(e) { res.json({url:null,erro:e.message}); }
});

// GET /fluxo-caixa/doc/:id/visualizar — proxy para visualizar documento
router.get('/fluxo-caixa/doc/visualizar', requireAuth, requirePermissao('fluxo-caixa'), async (req, res) => {
  try {
    const chave = req.query.chave;
    if (!chave) return res.status(400).send('Chave não informada');
    const { gerarUrlInline } = require('../services/arquivos');
    const url = await gerarUrlInline(chave);
    res.redirect(url);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

// GET /fluxo-caixa/doc/baixar — proxy para baixar documento
router.get('/fluxo-caixa/doc/baixar', requireAuth, requirePermissao('fluxo-caixa'), async (req, res) => {
  try {
    const { chave, nome } = req.query;
    if (!chave) return res.status(400).send('Chave não informada');
    const { gerarUrlDownload } = require('../services/arquivos');
    const url = await gerarUrlDownload(chave, nome || 'documento');
    res.redirect(url);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

};
