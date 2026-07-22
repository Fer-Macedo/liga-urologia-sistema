// ═══ COBRANÇAS (tela + webhook PagBank + disparos manuais) ══════════════════
const express = require('express');
const dayjs = require('dayjs');
const { query } = require('../models/database');
const { requireAuth, requireAdmin, requireFinanceiro, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');
const { criarCobranca, processarWebhook, consultarPagamento, detectarMetodo, extrairValorPago } = require('../services/pagbank');
const { confirmarInscricaoPss } = require('../services/pss');

module.exports = function (router) {

// ─── COBRANÇAS ─────────────────────────────────────────────────────────────────

router.get('/cobrancas', requireAuth, requirePermissao('cobrancas'), async (req, res) => {
  const config = await getConfig();
  const filtro = req.query.filtro || 'todas';
  const periodo = req.query.periodo || 'mes';
  const dataInicio = req.query.data_inicio || null;
  const dataFim = req.query.data_fim || null;
  const hoje = dayjs();

  let dtInicio, dtFim;
  if (dataInicio && dataFim) {
    // Reformata via dayjs para YYYY-MM-DD canonico — impede SQL injection na
    // interpolacao de periodoWhere (a saida de .format() e sempre uma data limpa).
    const di = dayjs(dataInicio), df = dayjs(dataFim);
    if (di.isValid() && df.isValid()) {
      dtInicio = di.format('YYYY-MM-DD'); dtFim = df.format('YYYY-MM-DD');
    } else {
      dtInicio = hoje.startOf('month').format('YYYY-MM-DD');
      dtFim = hoje.endOf('month').format('YYYY-MM-DD');
    }
  } else if (periodo === '30') {
    dtInicio = hoje.subtract(30,'day').format('YYYY-MM-DD'); dtFim = hoje.format('YYYY-MM-DD');
  } else if (periodo === '60') {
    dtInicio = hoje.subtract(60,'day').format('YYYY-MM-DD'); dtFim = hoje.format('YYYY-MM-DD');
  } else if (periodo === '90') {
    dtInicio = hoje.subtract(90,'day').format('YYYY-MM-DD'); dtFim = hoje.format('YYYY-MM-DD');
  } else if (periodo === '120') {
    dtInicio = hoje.subtract(120,'day').format('YYYY-MM-DD'); dtFim = hoje.format('YYYY-MM-DD');
  } else if (periodo === 'todos') {
    dtInicio = null; dtFim = null;
  } else {
    dtInicio = hoje.startOf('month').format('YYYY-MM-DD');
    dtFim = hoje.endOf('month').format('YYYY-MM-DD');
  }

  const periodoWhere = dtInicio && dtFim
    ? ` AND c.data_vencimento::date BETWEEN '${dtInicio}' AND '${dtFim}'`
    : '';

  const [tPagas, tPendentes, tAtrasadas, tTodas] = await Promise.all([
    query(`SELECT COUNT(*) n, COALESCE(SUM(c.valor_desconto),0) soma FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='pago' AND m.ativo=1${periodoWhere}`),
    query(`SELECT COUNT(*) n FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='pendente' AND m.ativo=1${periodoWhere}`),
    query(`SELECT COUNT(*) n FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='atrasado' AND m.ativo=1${periodoWhere}`),
    query(`SELECT COUNT(*) n FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE m.ativo=1${periodoWhere}`),
  ]);

  const membroId = req.query.membro ? parseInt(req.query.membro) : null;
  const busca = (req.query.busca || '').trim();
  // Busca por nome do membro ignora o filtro de periodo - o historico completo (pago/cancelado/etc)
  // deve aparecer independente do mes selecionado, senao some quando a pessoa foi reativada
  // e nao tem cobranca no periodo atual.
  let whereClause = busca ? 'm.ativo=1' : `m.ativo=1${periodoWhere}`;
  if (membroId) whereClause = `c.membro_id=${membroId}${periodoWhere}`;
  if (busca) whereClause += ' AND m.nome ILIKE $1';
  if (filtro === 'pagas') whereClause += " AND c.status='pago'";
  else if (filtro === 'pendentes') whereClause += " AND c.status='pendente'";
  else if (filtro === 'atrasadas') whereClause += " AND c.status='atrasado'";

  const [r, membroR] = await Promise.all([
    busca
      ? query(`SELECT c.*, m.nome, m.whatsapp, m.email FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE ${whereClause} ORDER BY c.data_vencimento DESC, m.nome ASC LIMIT 500`, ['%'+busca+'%'])
      : query(`SELECT c.*, m.nome, m.whatsapp, m.email FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE ${whereClause} ORDER BY c.data_vencimento DESC, m.nome ASC LIMIT 500`),
    membroId ? query('SELECT nome FROM membros WHERE id=$1', [membroId]) : Promise.resolve({ rows: [] })
  ]);
  const membroFiltro = membroR.rows[0] || null;
  res.render('pages/cobrancas', {
    config, usuario: req.session.usuario, cobrancas: r.rows, filtro, dayjs,
    msg: req.flash('msg'), erro: req.flash('erro'),
    totalPagas: parseInt(tPagas.rows[0].n), somaPagas: parseFloat(tPagas.rows[0].soma),
    totalPendentes: parseInt(tPendentes.rows[0].n),
    totalAtrasadas: parseInt(tAtrasadas.rows[0].n),
    totalTodas: parseInt(tTodas.rows[0].n),
    membroId: membroId || null, membroFiltro, busca,
    periodo, dtInicio: dtInicio||'', dtFim: dtFim||'',
    dataInicio: dataInicio||'', dataFim: dataFim||'',
  });
});

router.post('/cobrancas/:id/confirmar', requireAuth, requireFinanceiro, async (req, res) => {
  try {
    const metodo = ['pix','cartao','dinheiro'].includes(req.body.metodo) ? req.body.metodo : 'pix';
    await query("UPDATE cobrancas SET status='pago', data_pagamento=NOW(), metodo_pagamento=COALESCE(metodo_pagamento,$2), valor_pago=COALESCE(valor_pago, CASE WHEN data_vencimento::date >= CURRENT_DATE THEN valor_desconto ELSE valor_cheio END) WHERE id=$1 AND status!='pago'", [req.params.id, metodo]);
    try { const { lancarMensalidadeNoFluxo } = require('../services/fluxo-mensalidade'); await lancarMensalidadeNoFluxo(query, req.params.id); } catch(e) { console.error('lancar fluxo (baixa manual):', e.message); }
    // req.flash, nao req.session.msg: o render de /cobrancas le req.flash('msg') (que o
    // connect-flash guarda em req.session.flash). Escrever em req.session.msg fazia a
    // mensagem "Pagamento confirmado" ser engolida no redirect — o irmao /pago ja usava flash.
    req.flash('msg', 'Pagamento confirmado manualmente!');
  } catch(e) { req.flash('erro', 'Erro ao confirmar: '+e.message); }
  const ref = req.headers.referer || '/cobrancas';
  res.redirect(ref);
});

router.post('/cobrancas/:id/pago', requireAuth, requireFinanceiro, async (req, res) => {
  // AND status!='pago': sem o guard, um duplo-clique/repost reescrevia data_pagamento=NOW()
  // numa cobranca ja paga, corrompendo a data original. O irmao /confirmar ja tinha o guard.
  await query("UPDATE cobrancas SET status='pago', data_pagamento=NOW(), metodo_pagamento=COALESCE(metodo_pagamento,'pix'), valor_pago=COALESCE(valor_pago, CASE WHEN data_vencimento::date >= CURRENT_DATE THEN valor_desconto ELSE valor_cheio END) WHERE id=$1 AND status!='pago'", [req.params.id]);
  try { const { lancarMensalidadeNoFluxo } = require('../services/fluxo-mensalidade'); await lancarMensalidadeNoFluxo(query, req.params.id); } catch(e) { console.error('lancar fluxo (baixa manual 2):', e.message); }
  req.flash('msg', 'Pagamento registrado!');
  res.redirect('/cobrancas');
});

router.post('/cobrancas/gerar', requireAuth, requireFinanceiro, async (req, res) => {
  const { gerarCobrancasMes } = require('../services/agendamentos');
  await gerarCobrancasMes();
  req.flash('msg', 'Cobranças do mês geradas!');
  res.redirect('/cobrancas');
});

router.post('/cobrancas/nova', requireAuth, requireFinanceiro, async (req, res) => {
  const { membro_id, referencia, valor_cheio, valor_desconto, data_vencimento } = req.body;
  const mr = await query('SELECT * FROM membros WHERE id=$1', [membro_id]);
  const membro = mr.rows[0];
  if (!membro) { req.flash('erro', 'Membro não encontrado'); return res.redirect('/cobrancas'); }
  const existe = await query('SELECT id FROM cobrancas WHERE referencia=$1', [referencia]);
  if (existe.rows.length > 0) { req.flash('erro', 'Já existe uma cobrança com essa referência ("' + referencia + '")'); return res.redirect('/cobrancas'); }
  const pag = await criarCobranca({ membro, valor: parseFloat(valor_desconto), vencimento: data_vencimento, referencia });
  await query(
    'INSERT INTO cobrancas (membro_id,referencia,valor_cheio,valor_desconto,data_vencimento,pagbank_charge_id,pagbank_link) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [membro_id, referencia, parseFloat(valor_cheio), parseFloat(valor_desconto), data_vencimento, pag.charge_id||null, pag.link||null]
  );
  req.flash('msg', 'Cobrança criada!');
  res.redirect('/cobrancas');
});


// ─── WEBHOOK PAGBANK ──────────────────────────────────────────────────────────

router.post('/webhook/pagbank', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    let body;
    try { body = JSON.parse(req.body.toString()); }
    catch (e) { return res.sendStatus(200); }

    console.log('PagBank Webhook recebido:', JSON.stringify(body).substring(0, 300));

    // metodo e valorPago sao `let`: quando a API reconfirma, os valores dela substituem os
    // do corpo (que qualquer um pode escrever).
    let { orderId, referencia, status, pago, metodo, valorPago } = processarWebhook(body);

    if (!referencia) return res.sendStatus(200);

    // SEGURANCA: o corpo do webhook e publico e forjavel — qualquer um poderia enviar um
    // POST com status=PAID e dar baixa numa cobranca sem ter pago. Antes de confiar, a gente
    // reconfirma o pagamento direto na API do PagBank (autenticada com o nosso token). Uma
    // order forjada nao existe la, ou nao esta paga, entao a reconsulta derruba a fraude.
    // Fail-closed: sem orderId ou sem confirmacao, NAO da baixa.
    let pagoConfirmado = false;
    if (pago) {
      if (!orderId) {
        console.warn('PagBank webhook: pago=true sem orderId — baixa ignorada (nao da pra reconfirmar).');
      } else {
        const conf = await consultarPagamento(orderId);
        pagoConfirmado = conf.ok && conf.status === 'PAID';
        if (!pagoConfirmado) console.warn('PagBank webhook: reconfirmacao NAO retornou PAID para', orderId, '— baixa ignorada (possivel forja).');
        // Confirmar que a order esta paga NAO basta: o corpo diz de quem e a cobranca.
        // Sem amarrar order -> referencia, qualquer um manda {orderId: <uma order paga
        // qualquer, ate a dele>, referencia: <cobranca da vitima>} e quita a divida do
        // outro. A referencia tem que vir da API, nunca do corpo.
        if (pagoConfirmado) {
          const refReal = conf.data && conf.data.reference_id;
          if (refReal !== referencia) {
            console.warn('PagBank webhook: order', orderId, 'pertence a', refReal, 'e nao a', referencia, '— baixa ignorada (forja).');
            pagoConfirmado = false;
          } else {
            // Valor e metodo tambem saem da API: os do corpo sao forjaveis.
            const chargesReais = (conf.data && conf.data.charges) || [];
            metodo = detectarMetodo(chargesReais) || metodo;
            const v = extrairValorPago(chargesReais);
            if (v !== null) valorPago = v;
          }
        }
      }
    }

    // Pagamento de MENSALIDADE
    if (pagoConfirmado && referencia.startsWith('mensalidade-')) {
      const r = await query(
        "UPDATE cobrancas SET status='pago', data_pagamento=NOW(), pagbank_charge_id=$1, metodo_pagamento=COALESCE($3,metodo_pagamento), valor_pago=COALESCE($4, CASE WHEN data_vencimento::date >= CURRENT_DATE THEN valor_desconto ELSE valor_cheio END) WHERE referencia=$2 AND status!='pago' RETURNING id",
        [orderId, referencia, metodo, valorPago]
      );
      if (r.rowCount > 0) {
        console.log('PagBank mensalidade confirmada:', referencia, orderId, 'metodo:', metodo);
        try {
          const { lancarMensalidadeNoFluxo } = require('../services/fluxo-mensalidade');
          await lancarMensalidadeNoFluxo(query, r.rows[0].id);
        } catch(e) { console.error('lancar fluxo (webhook2):', e.message); }
      }
    }

    // Pagamento de MENSALIDADE (formato {membro_id}-{ano}-{mes}, ex: 56-2026-05)
    if (pagoConfirmado && /^\d+-\d{4}-\d{2}$/.test(referencia)) {
      const r = await query(
        "UPDATE cobrancas SET status='pago', data_pagamento=NOW(), metodo_pagamento=COALESCE($2,metodo_pagamento), valor_pago=COALESCE($3, CASE WHEN data_vencimento::date >= CURRENT_DATE THEN valor_desconto ELSE valor_cheio END) WHERE referencia=$1 AND status!='pago' RETURNING id",
        [referencia, metodo, valorPago]
      );
      if (r.rowCount > 0) {
        console.log('PagBank mensalidade confirmada via webhook:', referencia, orderId, 'metodo:', metodo);
        try {
          const { lancarMensalidadeNoFluxo } = require('../services/fluxo-mensalidade');
          await lancarMensalidadeNoFluxo(query, r.rows[0].id);
        } catch(e) { console.error('lancar fluxo (webhook):', e.message); }
      }
    }

    // Pagamento de INGRESSO DE EVENTO
    if (pagoConfirmado && referencia.startsWith('evento-insc-')) {
      const partes = referencia.split('-');
      const inscricaoId = partes[2];
      if (inscricaoId) {
        const upd = await query(
          "UPDATE evento_inscricoes SET status='confirmado' WHERE id=$1 AND status!='confirmado' RETURNING id",
          [inscricaoId]
        );
        await query(
          "UPDATE evento_pagamentos SET status='pago', pago_em=NOW(), pagbank_order_id=$1 WHERE inscricao_id=$2 AND status!='pago'",
          [orderId, inscricaoId]
        );
        // Enviar email de confirmação apenas se acabou de confirmar (evita duplicado)
        if (upd.rowCount > 0) {
          const { enviarEmailConfirmacaoEvento } = require('../services/eventos-email');
          await enviarEmailConfirmacaoEvento(inscricaoId);
          console.log('PagBank ingresso confirmado via webhook — insc:', inscricaoId, orderId);
          try {
            const { lancarEventoNoFluxo } = require('../services/fluxo-eventos');
            await lancarEventoNoFluxo(query, inscricaoId);
          } catch(ef){ console.error('lancar fluxo evento webhook:', ef.message); }
        }
      }
    }

    // Pagamento de INSCRIÇÃO DE PROCESSO SELETIVO (pss-cand-<id>)
    if (pagoConfirmado && referencia.startsWith('pss-cand-')) {
      const candId = referencia.split('-')[2];
      if (candId) {
        const jc = await query("SELECT pagamento_status FROM ps_candidatos WHERE id=$1", [candId]);
        if (jc.rows[0] && jc.rows[0].pagamento_status !== 'confirmado') {
          await confirmarInscricaoPss(candId, { orderId, valorPago, metodo });
          console.log('PagBank inscrição PSS confirmada via webhook — cand:', candId, orderId);
        }
      }
    }

  } catch (e) { console.error('PagBank Webhook erro:', e.message); }
  res.sendStatus(200);
});


// Le a Sidebar de verdade e extrai a lista de modulos/paginas que existem nela (id da
// permissao + nome exibido) - usado na tela de Usuarios para montar a lista de permissoes
// assinaveis. Isso evita a lista de permissoes ficar desatualizada ou com nome diferente do
// que aparece na Sidebar: toda vez que um item novo e adicionado la (com o devido
// temPerm('id')), ele passa a aparecer aqui automaticamente, sem precisar editar mais nada.
// POST /admin/disparar-cobrancas-vencidas (só vencidas, a partir do dia 16, com intervalo seguro)
router.post('/admin/disparar-cobrancas-vencidas', requireAuth, requireFinanceiro, async (req, res) => {
  const hoje = new Date().toISOString().split('T')[0];
  const config = (await query('SELECT chave, valor FROM configuracoes')).rows.reduce((a,r)=>{a[r.chave]=r.valor;return a},{});
  const { notificarCobranca } = require('../services/notificacoes');
  // Buscar cobranças vencidas (data_vencimento < hoje) e não pagas, sem notificação pos já enviada
  const r = await query(`
    SELECT c.*, m.nome, m.email, m.whatsapp FROM cobrancas c
    JOIN membros m ON m.id=c.membro_id
    WHERE c.data_vencimento::date < $1
    AND c.status='pendente'
    AND m.ativo=1
    AND NOT EXISTS (
      SELECT 1 FROM notificacoes_log nl
      WHERE nl.cobranca_id=c.id AND nl.tipo='pos' AND nl.canal='email' AND nl.status='ok'
    )
    ORDER BY c.data_vencimento ASC, m.nome ASC
  `, [hoje]);
  let enfileirados = 0;
  // Enviar em background com intervalo de 8s entre emails (evita spam e bloqueio)
  res.json({ ok: true, total: r.rows.length, msg: `Iniciando envio de ${r.rows.length} cobranças vencidas por email. Serão enviadas com intervalo de 8s cada.` });
  for (const cob of r.rows) {
    try {
      await notificarCobranca({ membro: {...cob, id: cob.membro_id}, cobranca: cob, tipo: 'pos', config, canal: 'email' });
      enfileirados++;
      console.log(`[COBRANCA-VENCIDA] Email enviado: ${cob.nome} (${enfileirados}/${r.rows.length})`);
    } catch(e) {
      console.error(`[COBRANCA-VENCIDA] Erro ao enviar para ${cob.nome}:`, e.message);
    }
    // Intervalo de 8s entre cada email para não sobrecarregar servidor SMTP
    if (enfileirados < r.rows.length) await new Promise(r => setTimeout(r, 8000));
  }
  console.log(`[COBRANCA-VENCIDA] Concluído: ${enfileirados}/${r.rows.length} emails enviados`);
});

// POST /admin/disparar-cobrancas-pre (disparo seguro via sistema)
router.post('/admin/disparar-cobrancas-pre', requireAuth, requireFinanceiro, async (req, res) => {
  const { data_vencimento } = req.body;
  if (!data_vencimento) return res.json({ erro: 'data_vencimento obrigatoria' });
  const config = (await query('SELECT chave, valor FROM configuracoes')).rows.reduce((a,r)=>{a[r.chave]=r.valor;return a},{});
  const { notificarCobranca } = require('../services/notificacoes');
  const r = await query(`SELECT c.*, m.nome, m.email, m.whatsapp FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.data_vencimento::date=$1 AND c.status='pendente' AND m.ativo=1 AND NOT EXISTS (SELECT 1 FROM notificacoes_log nl WHERE nl.cobranca_id=c.id AND nl.tipo='pre' AND nl.canal='whatsapp' AND nl.status='ok') ORDER BY m.nome`,[data_vencimento]);
  let enfileirados=0;
  for (const cob of r.rows) {
    await notificarCobranca({ membro: {...cob, id: cob.membro_id}, cobranca: cob, tipo: 'pre', config, canal: 'whatsapp' });
    enfileirados++;
  }
  res.json({ ok: true, enfileirados, msg: 'Mensagens enfileiradas com seguranca. Serao enviadas com intervalos de 90s.' });
});


};
