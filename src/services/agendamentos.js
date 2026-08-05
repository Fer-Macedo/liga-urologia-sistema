const cron = require('node-cron');
const dayjs = require('dayjs');
const { query } = require('../models/database');
const { criarCobranca, consultarPagamento, consultarCheckout, detectarMetodo, extrairDataPagamento, extrairValorPago } = require('./pagbank');
const { notificarCobranca, notificarAniversario } = require('./notificacoes');

async function getConfig() {
  const r = await query('SELECT chave, valor FROM configuracoes');
  const cfg = {};
  r.rows.forEach(row => { cfg[row.chave] = row.valor; });
  return cfg;
}


// ─── GERAR COBRANÇAS DO MÊS ──────────────────────────────────────────────────
async function gerarCobrancasMes() {
  const hoje = dayjs();
  const mes = hoje.format('YYYY-MM');
  const membros = await query('SELECT * FROM membros WHERE ativo=1');
  const config = await getConfig();

  for (const membro of membros.rows) {
    const ref = membro.id + '-' + mes;
    // Checa por membro_id + mes (nao so pela string da referencia): se o membro teve o
    // cadastro duplicado corrigido no passado, cobrancas antigas ficaram com a referencia
    // no formato do ID anterior (ex: "38-2026-07" para o membro que hoje e o ID 61) e um
    // match exato em referencia=$1 nunca as encontra, gerando cobranca nova todo mes.
    const existe = await query("SELECT id FROM cobrancas WHERE membro_id=$1 AND referencia LIKE $2", [membro.id, '%-' + mes]);
    if (existe.rows.length > 0) continue;

    const diaVenc = membro.dia_vencimento || parseInt(config.dia_vencimento_padrao) || 15;
    // Vencimento sempre dia fixo do mes de referencia (nunca usar hoje.date() pois se o dia ja passou dayjs retorna data errada)
    const dataVenc = `${mes}-${String(diaVenc).padStart(2,'0')}`;
    const valorCheio = parseFloat(membro.mensalidade) || 0;
    // Primeiro valor numerico valido, aceitando ZERO. Com `||`, um desconto de 0% (que e
    // parseFloat('0')=0, falsy) era tratado como ausente e virava 20% — o membro que
    // deveria pagar cheio ganhava desconto. So cai no proximo quando o anterior e NaN.
    const primeiroNum = (...vs) => { for (const v of vs) { const n = parseFloat(v); if (!Number.isNaN(n)) return n; } return 20; };
    const descPct = primeiroNum(membro.desconto_pontualidade, config.desconto_padrao);
    const valorDesc = +(valorCheio * (1 - descPct / 100)).toFixed(2);

    // O PIX de desconto DEVE expirar no vencimento — o PagBank nao deixa cancelar um PIX
    // ja emitido, so expirar. Se o PIX de desconto tivesse validade longa, a pessoa pagaria
    // o valor com desconto mesmo depois do dia do vencimento (perda de receita). Se a
    // cobranca ja nasce vencida (ex: membro cadastrado depois do dia de vencimento), ela ja
    // sai com o valor cheio e PIX de validade longa.
    const jaVenceu = hoje.isAfter(dayjs(dataVenc).endOf('day'));
    const valorPix = jaVenceu ? valorCheio : valorDesc;
    const expPix = jaVenceu ? hoje.add(179, 'day').format('YYYY-MM-DD') : dataVenc; // 180 exato e rejeitado pelo PagBank
    const pag = await criarCobranca({ membro, valor: valorPix, vencimento: expPix, referencia: ref });

    await query(
      `INSERT INTO cobrancas
         (membro_id, referencia, valor_cheio, valor_desconto, data_vencimento,
          status, pagbank_charge_id, pagbank_link, pix_copia_cola, pix_qr_image)
       VALUES ($1,$2,$3,$4,$5,'pendente',$6,$7,$8,$9)`,
      [membro.id, ref, valorCheio, valorDesc, dataVenc,
       pag.charge_id || null, pag.checkout_link || pag.link || null,
       pag.pix_copia_cola || null, pag.pix_qr_image || null]
    );
    console.log('Cobrança PagBank gerada:', membro.nome, ref, pag.ok ? '✅' : '⚠️ sem gateway');
  }
}

// ─── ATUALIZAR PIX EXPIRADOS (roda diariamente) ──────────────────────────────
async function atualizarPixAtrasados() {
  const hoje = require('dayjs')();
  // Busca cobranças atrasadas sem PIX ou com vencimento_pix passado
  const { rows } = await query(`
    SELECT c.id, c.referencia, c.valor_cheio, c.valor_desconto, c.data_vencimento, c.membro_id,
           to_char(c.data_vencimento::date,'YYYY-MM-DD') as venc_ymd,
           m.nome, m.email, m.cpf
    FROM cobrancas c
    JOIN membros m ON m.id = c.membro_id
    WHERE c.status IN ('pendente','atrasado')
    AND (c.pix_copia_cola IS NULL OR c.pagbank_charge_id IS NULL)
    AND c.referencia NOT LIKE '%-test'
    ORDER BY m.nome
  `);
  if (!rows.length) return;
  console.log('[PIX-UPDATE] Atualizando', rows.length, 'cobranças sem PIX...');
  const { criarCobranca } = require('./pagbank');
  const dataVencPix = hoje.add(179, 'day').format('YYYY-MM-DD'); // 180 exato e rejeitado pelo PagBank
  for (const c of rows) {
    try {
      // Ate o vencimento cobra o valor com desconto de pontualidade; depois, valor cheio.
      // O PIX de desconto DEVE expirar no vencimento (senao a pessoa paga o desconto depois
      // do prazo — mesmo vazamento corrigido na geracao). So o PIX cheio (ja vencido) tem
      // validade longa. Usa venc_ymd (string YYYY-MM-DD do banco, sem drift de fuso).
      const jaVenceu = require('dayjs')(c.data_vencimento).endOf('day').isBefore(hoje);
      const valorPix = (!jaVenceu && c.valor_desconto != null) ? c.valor_desconto : c.valor_cheio;
      const expPix = jaVenceu ? dataVencPix : (c.venc_ymd || dataVencPix);
      const pag = await criarCobranca({
        membro: { nome: c.nome, email: c.email, cpf: c.cpf },
        valor: valorPix,
        vencimento: expPix,
        referencia: c.referencia
      });
      if (pag.ok) {
        // O link que sai daqui SUBSTITUI o anterior. Guardar o antigo e o que permite
        // achar depois um pagamento feito no link velho — sem isso, vira dinheiro sem dono.
        await query(`UPDATE cobrancas SET pix_copia_cola=$1, pix_qr_code_base64=$2, pix_qr_image=$3, pagbank_charge_id=$4,
                       pagbank_links_antigos = CASE
                         WHEN pagbank_link IS NULL OR pagbank_link = $5 THEN pagbank_links_antigos
                         ELSE COALESCE(pagbank_links_antigos || E'\\n', '') || pagbank_link END,
                       pagbank_link=$5
                     WHERE id=$6`,
          [pag.pix_copia_cola, pag.pix_qr_code_base64, pag.pix_qr_image, pag.charge_id, pag.link, c.id]);
        console.log('[PIX-UPDATE] PIX atualizado:', c.nome, c.referencia);
      }
      await new Promise(r => setTimeout(r, 800));
    } catch(e) { console.error('[PIX-UPDATE] Erro:', c.nome, e.message); }
  }
}

// ─── VERIFICAR PAGAMENTOS ─────────────────────────────────────────────────────
async function verificarPagamentos() {
  // Duas portas de entrada, porque sao dois objetos diferentes no PagBank:
  //   PIX    -> o pedido guardado em pagbank_charge_id
  //   CARTAO -> um pedido NOVO, pendurado no checkout do pagbank_link
  // Conferir so a primeira e o que deixou R$75 pagos no cartao passarem batido enquanto a
  // cobranca diaria continuava saindo. O link tambem entra no filtro pelo mesmo motivo.
  const pbR = await query(
    "SELECT * FROM cobrancas WHERE status IN ('pendente','atrasado') AND (pagbank_charge_id IS NOT NULL OR pagbank_link IS NOT NULL)"
  );
  for (const cob of pbR.rows) {
    try {
      let result = { ok: false };
      if (cob.pagbank_charge_id) result = await consultarPagamento(cob.pagbank_charge_id);
      const links = [cob.pagbank_link, ...String(cob.pagbank_links_antigos || '').split('\n')].filter(Boolean);
      for (const link of links) {
        if (result.ok && result.status === 'PAID') break;
        result = await consultarCheckout(link);
      }
      if (result.ok && result.status === 'PAID') {
        const charges = result.data.charges || (result.data.status ? [result.data] : []);
        const paga = charges.find(c => c.status === 'PAID');
        const valorPago = (paga && paga.amount && typeof paga.amount.value === 'number') ? paga.amount.value / 100 : null;
        const metodo = detectarMetodo(charges);
        // Data = quando o dinheiro ENTROU (paid_at do PagBank), nao quando o cron percebeu.
        // Com NOW(), um pagamento so notado dias depois entra no fluxo de caixa na data
        // errada — o de 17/07 do Rafael tinha sido lancado em 22/07.
        const pagoEm = extrairDataPagamento(charges);
        await query(
          "UPDATE cobrancas SET status='pago', data_pagamento=COALESCE($4::timestamptz, NOW()), metodo_pagamento=COALESCE($3,metodo_pagamento,'pix'), valor_pago=COALESCE($2, CASE WHEN data_vencimento::date >= CURRENT_DATE THEN valor_desconto ELSE valor_cheio END) WHERE id=$1",
          [cob.id, valorPago, metodo, pagoEm]
        );
        console.log('PagBank pagamento confirmado via cron:', cob.referencia);
        try {
          const { lancarMensalidadeNoFluxo } = require('./fluxo-mensalidade');
          await lancarMensalidadeNoFluxo(query, cob.id);
        } catch(e) { console.error('lancar fluxo (cron verificarPagamentos):', e.message); }
      }
    } catch(e) { console.error('PagBank verificar erro:', cob.id, e.message); }
  }
}

// Mesma rede de segurança do verificarPagamentos, mas para inscrições do processo seletivo:
// achado em 2026-08-05 que duas candidatas pagaram o PIX e ficaram "pendente" pra sempre —
// o webhook do PagBank só chegou 1x (na criação da order), nunca no pagamento em si, e
// ps_pagamentos não tinha reconciliação nenhuma (só cobrancas tinha).
async function verificarPagamentosPss() {
  const r = await query(
    `SELECT p.candidato_id, p.pagbank_order_id FROM ps_pagamentos p
     JOIN ps_candidatos c ON c.id=p.candidato_id
     WHERE p.status='pendente' AND p.pagbank_order_id IS NOT NULL AND c.pagamento_status!='confirmado'`
  );
  for (const pag of r.rows) {
    try {
      const conf = await consultarPagamento(pag.pagbank_order_id);
      if (conf.ok && conf.status === 'PAID') {
        const charges = conf.data.charges || [];
        const valorPago = extrairValorPago(charges);
        const metodo = detectarMetodo(charges);
        const { confirmarInscricaoPss } = require('./pss');
        await confirmarInscricaoPss(pag.candidato_id, { orderId: pag.pagbank_order_id, valorPago, metodo });
        console.log('PagBank inscrição PSS confirmada via cron:', pag.candidato_id, pag.pagbank_order_id);
      }
    } catch(e) { console.error('PagBank verificar PSS erro:', pag.candidato_id, e.message); }
  }
}

// ─── ATUALIZAR ATRASADOS ──────────────────────────────────────────────────────
async function atualizarAtrasados() {
  const hoje = dayjs().format('YYYY-MM-DD');
  // Ao vencer, zera os dados do PIX de desconto (ja expirado no PagBank): isso (1) some com
  // o QR/copia-e-cola velho no portal, evitando o membro tentar pagar um PIX morto, e (2)
  // dispara o atualizarPixAtrasados a gerar um PIX NOVO com valor cheio. Mantem o
  // pagbank_charge_id ate a regeneracao, pra nao cegar o verificarPagamentos no intervalo.
  const r = await query(
    "UPDATE cobrancas SET status='atrasado', pix_copia_cola=NULL, pix_qr_code_base64=NULL, pix_qr_image=NULL WHERE status='pendente' AND data_vencimento::date < $1::date",
    [hoje]
  );
  if (r.rowCount > 0) console.log(r.rowCount + ' cobranças marcadas como atrasadas (PIX de desconto invalidado)');
}

// ─── NOTIFICAÇÕES DE COBRANÇA ─────────────────────────────────────────────────
async function enviarNotificacoes() {
  const config = await getConfig();
  const hoje = dayjs();
  let count = 0;

  // Pré-vencimento (3 dias antes)
  if (config.notif_pre_ativo === '1') {
    const em3 = hoje.add(3, 'day').format('YYYY-MM-DD');
    const r = await query(
      "SELECT c.*, m.nome, m.email, m.whatsapp FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.data_vencimento::date=$1::date AND c.status='pendente' AND m.ativo=1",
      [em3]
    );
    for (const cob of r.rows) {
      const j = await query("SELECT id FROM notificacoes_log WHERE cobranca_id=$1 AND tipo='pre'", [cob.id]);
      if (j.rows.length === 0) {
        await notificarCobranca({ membro: {...cob, id: cob.membro_id}, cobranca: cob, tipo: 'pre', config });
        count++;
      }
    }
  }

  // No dia do vencimento
  if (config.notif_dia_ativo === '1') {
    const hj = hoje.format('YYYY-MM-DD');
    const r = await query(
      "SELECT c.*, m.nome, m.email, m.whatsapp FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.data_vencimento=$1 AND c.status='pendente' AND m.ativo=1",
      [hj]
    );
    for (const cob of r.rows) {
      const j = await query("SELECT id FROM notificacoes_log WHERE cobranca_id=$1 AND tipo='dia'", [cob.id]);
      if (j.rows.length === 0) {
        await notificarCobranca({ membro: {...cob, id: cob.membro_id}, cobranca: cob, tipo: 'dia', config });
        count++;
      }
    }
  }

  // Cobranca de atrasados (1 dia apos vencimento em diante) fica a cargo de notificarAtrasadosDiario(),
  // que roda todo dia sem parar ate o pagamento - superset do antigo aviso unico de "1 dia apos".
}

// ─── NOTIFICAÇÃO DIÁRIA DE ATRASADOS ─────────────────────────────────────────
async function notificarAtrasadosDiario() {
  console.log('[ATRASADOS]', new Date().toISOString(), 'função iniciada');
  const config = await getConfig();
  if (config.notif_atrasados_diario !== '1') return;

  // Cobrança por e-mail é diária e sem limite: todo atrasado recebe todo dia até pagar.
  // (o limite de mensagens/intervalo do WhatsApp não se aplica aqui — email não tem risco de banimento)
  const r = await query(
    "SELECT c.*, m.nome, m.email, m.whatsapp FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='atrasado' AND m.ativo=1 ORDER BY c.data_vencimento ASC"
  );

  let count = 0;
  const hoje = dayjs().format('YYYY-MM-DD');
  console.log('[ATRASADOS]', new Date().toISOString(), 'iniciando loop —', r.rows.length, 'atrasados a verificar');

  for (const cob of r.rows) {
    // Verificar se já foi notificado hoje (evita duplicar se o cron rodar 2x no mesmo dia)
    const j = await query(
      "SELECT id FROM notificacoes_log WHERE cobranca_id=$1 AND DATE(enviado_em)=$2",
      [cob.id, hoje]
    );
    if (j.rows.length > 0) {
      console.log('[ATRASADOS] Já notificado hoje:', cob.nome);
      continue;
    }

    // E-mail de atraso é diário; WhatsApp vai no MÁXIMO 1x por semana por cobrança.
    // Disparo diário de WhatsApp em massa é o que derruba o número (banimento) — o e-mail
    // não tem esse risco, então cobra todo dia; o WhatsApp cobra semanalmente. Se já mandou
    // WhatsApp com sucesso nos últimos 7 dias, hoje sai só o e-mail (canal='email').
    const wppRecente = await query(
      "SELECT id FROM notificacoes_log WHERE cobranca_id=$1 AND canal='whatsapp' AND tipo='pos' AND status='ok' AND enviado_em > NOW() - INTERVAL '7 days' LIMIT 1",
      [cob.id]
    );
    const canalAtraso = wppRecente.rows.length ? 'email' : undefined; // undefined = email + whatsapp
    await notificarCobranca({ membro: {...cob, id: cob.membro_id}, cobranca: cob, tipo: 'pos', config, canal: canalAtraso });
    count++;
    console.log('[ATRASADOS] Notificação enviada:', cob.nome, cob.referencia, canalAtraso === 'email' ? '(só email)' : '(email + whatsapp semanal)');
  }

  console.log('[ATRASADOS]', new Date().toISOString(), 'Job concluído —', count, 'notificações enviadas de', r.rows.length, 'atrasados verificados');
}

// ─── AUDITORIA FLUXO CAIXA ────────────────────────────────────────────────────
// Roda diariamente e lança no fluxo qualquer mensalidade paga sem lancado_fluxo
async function auditarFluxoCaixa() {
  try {
    const pendentes = await query(`
      SELECT c.id FROM cobrancas c
      WHERE c.status = 'pago' AND c.lancado_fluxo = false
    `);
    if (!pendentes.rows.length) return;
    console.log('[AUDITORIA] Mensalidades sem fluxo encontradas:', pendentes.rows.length);
    const { lancarMensalidadeNoFluxo } = require('./fluxo-mensalidade');
    for (const row of pendentes.rows) {
      const result = await lancarMensalidadeNoFluxo(query, row.id);
      console.log('[AUDITORIA] Lancado id=' + row.id + ':', JSON.stringify(result));
    }
    console.log('[AUDITORIA] Fluxo caixa auditado — ' + pendentes.rows.length + ' lancamentos corrigidos.');
  } catch(e) {
    console.error('[AUDITORIA] Erro auditarFluxoCaixa:', e.message);
  }
}

// Roda diariamente e lança no fluxo qualquer inscricao de evento paga que ainda nao foi lancada
async function auditarFluxoCaixaEventos() {
  try {
    const pendentes = await query(`SELECT inscricao_id FROM evento_pagamentos WHERE status='pago'`);
    if (!pendentes.rows.length) return;
    const { lancarEventoNoFluxo } = require('./fluxo-eventos');
    let lancados = 0;
    for (const row of pendentes.rows) {
      const result = await lancarEventoNoFluxo(query, row.inscricao_id);
      if (result.ok && result.motivo === 'lancado') lancados++;
    }
    if (lancados > 0) console.log('[AUDITORIA] Fluxo caixa eventos auditado — ' + lancados + ' lancamentos corrigidos.');
  } catch(e) {
    console.error('[AUDITORIA] Erro auditarFluxoCaixaEventos:', e.message);
  }
}

// ─── ANIVERSÁRIOS ─────────────────────────────────────────────────────────────
async function enviarAniversarios() {
  const config = await getConfig();
  if (config.notif_aniversario_ativo !== '1') return;
  const hoje = dayjs();
  const md = hoje.format('MM-DD');

  // Aniversariantes de hoje: membros + ligantes + diretivos (antes so cobria membros,
  // entao ligante/diretivo nunca recebia a mensagem de parabens — so o story do Instagram).
  const membrosR   = await query("SELECT id, nome, whatsapp, email, 'membro'   AS _tipo FROM membros   WHERE ativo=1 AND data_nascimento IS NOT NULL AND TO_CHAR(data_nascimento::date,'MM-DD')=$1", [md]);
  const ligantesR  = await query("SELECT id, nome, whatsapp, email, 'ligante'  AS _tipo FROM ligantes  WHERE ativo=1 AND pendente=false AND data_nascimento IS NOT NULL AND TO_CHAR(data_nascimento::date,'MM-DD')=$1", [md]);
  const diretivosR = await query("SELECT id, nome, whatsapp, email, 'diretivo' AS _tipo FROM diretivos WHERE ativo=1 AND pendente=false AND data_nascimento IS NOT NULL AND TO_CHAR(data_nascimento::date,'MM-DD')=$1", [md]);

  // A MESMA pessoa pode estar em mais de uma tabela (ex.: ligante que tambem e membro).
  // Deduplica por pessoa (whatsapp > email > tipo+id) para nao mandar 2x. Membro vem
  // primeiro, entao prevalece (mantem o comportamento/log ja existente para membros).
  const vistos = new Set();
  const todos = [...membrosR.rows, ...ligantesR.rows, ...diretivosR.rows].filter(p => {
    const chave = (p.whatsapp && p.whatsapp.replace(/[^0-9]/g, '')) || (p.email && p.email.toLowerCase()) || (p._tipo + p.id);
    if (vistos.has(chave)) return false;
    vistos.add(chave); return true;
  });

  let count = 0;
  for (const pessoa of todos) {
    // Dedup por (membro_id + tipo): tipo='aniversario' p/ membro (compat) e
    // 'aniversario_ligante'/'_diretivo' p/ os demais — evita colisao de id entre tabelas.
    const logTipo = pessoa._tipo === 'membro' ? 'aniversario' : 'aniversario_' + pessoa._tipo;
    const j = await query(
      "SELECT id FROM notificacoes_log WHERE membro_id=$1 AND tipo=$2 AND enviado_em >= CURRENT_DATE",
      [pessoa.id, logTipo]
    );
    if (j.rows.length) continue;

    await notificarAniversario({ membro: pessoa, config, membroId: pessoa.id, logTipo });
    count++;
    console.log('Parabéns enviado:', pessoa.nome, '(' + pessoa._tipo + ')');
  }
}

// ─── FREQUÊNCIA MENSAL ────────────────────────────────────────────────────────
async function enviarFrequenciaMensal() {
  console.log('Enviando frequência mensal automática...');
  const { enviarWhatsApp, enviarEmail } = require('./notificacoes');
  const config = await getConfig();
  const orgNome = config.org_nome || 'Liga Academica de Urologia';
  const orgLogo = config.org_logo || null;
  let count = 0;
  // Bloco comum aos e-mails de ligantes e diretivos: estimula o acesso ao Portal de
  // Membros, onde da pra ver o detalhamento da frequencia (nao so o resumo do e-mail)
  // e os demais servicos do portal.
  const portalPromo = '<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px 20px;margin-bottom:16px"><p style="margin:0 0 10px;font-size:13px;color:#0c4a6e;line-height:1.6">📋 Accedé al <strong>Portal de Membros</strong> para ver el detalle completo de tu frecuencia y los demás servicios disponibles.</p><a href="https://membro.lauroucpcde.com" style="display:inline-block;background:#0F6E56;color:#fff;padding:10px 22px;text-decoration:none;font-weight:700;font-size:13px;border-radius:6px">Acceder al Portal</a></div>';

  const turmas = await query('SELECT * FROM turmas WHERE ativo=1');
  for (const turma of turmas.rows) {
    const membros = await query(
      `SELECT m.*, tm.data_entrada,
        (SELECT COUNT(*) FROM atividades a WHERE a.turma_id=$1) as total_atividades,
        (SELECT COUNT(*) FROM presencas p JOIN atividades a ON a.id=p.atividade_id
         WHERE a.turma_id=$1 AND p.membro_id=m.id AND p.presente=1) as presencas
       FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id WHERE tm.turma_id=$1`,
      [turma.id]
    );

    for (const m of membros.rows) {
      const pct = m.total_atividades > 0 ? Math.round((m.presencas / m.total_atividades) * 100) : 0;
      const faltas = m.total_atividades - m.presencas;
      const status = pct >= 75 ? 'APTO ✅' : pct >= 50 ? 'EM RISCO ⚠️' : 'NÃO APTO ❌';

      const jaEnviouHoje = await query(
        "SELECT id FROM notificacoes_log WHERE membro_id=$1 AND tipo='frequencia' AND DATE(enviado_em)=CURRENT_DATE",
        [m.id]
      );
      if (jaEnviouHoje.rows.length > 0) continue;

      const msg = '*' + orgNome + '* 📊\n\n'
        + '¡Hola, *' + m.nome.split(' ')[0] + '*!\n\n'
        + '📊 *Reporte de Frecuencia — ' + turma.nome + '*\n\n'
        + '📅 Actividades realizadas: *' + m.total_atividades + '*\n'
        + '✅ Asistencias: *' + m.presencas + '*\n'
        + '❌ Ausencias: *' + faltas + '*\n'
        + '📈 Frecuencia: *' + pct + '%*\n'
        + '🎓 Estado: *' + status + '*\n\n'
        + (pct >= 75 ? '¡Felicitaciones! Estás apto para el certificado. 🎉'
          : pct >= 50 ? '¡Atención! Estás en riesgo. No faltes a las próximas actividades. ⚠️'
          : 'Estás por debajo del mínimo requerido (75%). ❌')
        + '\n\n¿Dudas? Comunícate con la secretaría.';

      if (m.whatsapp) {
        try {
          await enviarWhatsApp(m.whatsapp, msg);
          count++;
          await logNotificacao({ membro_id: m.id, cobranca_id: null, tipo: 'frequencia', canal: 'whatsapp', status: 'ok' });
        } catch(e) { console.error('Erro freq wpp:', e.message); }
      }

      if (m.email) {
        const corStatus = pct>=75?'#22c55e':pct>=50?'#f59e0b':'#ef4444';
        const alertaBox = pct>=75
          ? '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin-bottom:24px"><p style="margin:0;font-size:13px;color:#166534">🎉 Parabéns! Você está apto para o certificado anual.</p></div>'
          : pct>=50
            ? '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px 20px;margin-bottom:24px"><p style="margin:0;font-size:13px;color:#92400e">⚠️ Atenção! Você está em risco. Não falte às próximas atividades.</p></div>'
            : '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px 20px;margin-bottom:24px"><p style="margin:0;font-size:13px;color:#991b1b">❌ Você está abaixo do mínimo exigido de 75%.</p></div>';
        const html = `<h2 style="margin:0 0 8px;font-size:20px;color:#0f172a">¡Hola, ${m.nome.split(' ')[0]}!</h2><p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7">Aquí está tu reporte de frecuencia correspondiente al grupo <strong>${turma.nome}</strong>.</p><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 24px"><tr style="background:#f8fafc"><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Actividades realizadas</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:#0f172a">${m.total_atividades}</td></tr><tr><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Asistencias</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:#22c55e">${m.presencas}</td></tr><tr style="background:#f8fafc"><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Ausencias</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:#ef4444">${faltas}</td></tr><tr><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Frecuencia</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:#0f172a;font-size:16px">${pct}%</td></tr><tr style="background:#f8fafc"><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Estado</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:${corStatus}">${status}</td></tr></table>${alertaBox}${portalPromo}<p style="margin:0;font-size:12px;color:#94a3b8">Dúvidas? Entre em contato com a secretaria da ${orgNome}.</p>`;
        try { await enviarEmail({ para: m.email, assunto: '📊 Reporte de Frecuencia — ' + turma.nome, html, texto: msg, faixaLabel: 'RELATÓRIO DE FREQUÊNCIA' }); } catch(e) {}
      }
    }
    console.log('Frequência enviada para turma:', turma.nome);
  }

  // Diretivos
  const diretivaTurmas = await query('SELECT * FROM diretivo_turmas WHERE ativo=1');
  for (const turma of diretivaTurmas.rows) {
    const diretivos = await query(
      `SELECT d.*, dtm.data_entrada,
        (SELECT COUNT(*) FROM diretivo_atividades da WHERE da.turma_id=$1) as total_atividades,
        (SELECT COUNT(*) FROM diretivo_presencas dp JOIN diretivo_atividades da ON da.id=dp.atividade_id
         WHERE da.turma_id=$1 AND dp.diretivo_id=d.id AND dp.presente=1) as presencas
       FROM diretivo_turma_membros dtm JOIN diretivos d ON d.id=dtm.diretivo_id
       WHERE dtm.turma_id=$1 AND d.ativo=1`,
      [turma.id]
    );

    for (const d of diretivos.rows) {
      const pct = d.total_atividades > 0 ? Math.round((d.presencas / d.total_atividades) * 100) : 0;
      const faltas = d.total_atividades - d.presencas;
      const status = pct >= 75 ? 'APTO ✅' : pct >= 50 ? 'EM RISCO ⚠️' : 'NÃO APTO ❌';

      const jaEnviouHoje = await query(
        "SELECT id FROM notificacoes_log WHERE membro_id=$1 AND tipo='frequencia' AND DATE(enviado_em)=CURRENT_DATE",
        [d.id]
      );
      if (jaEnviouHoje.rows.length > 0) continue;

      const msg = '*' + orgNome + '* 📊\n\n'
        + '¡Hola, *' + d.nome.split(' ')[0] + '*!\n\n'
        + '📊 *Reporte de Frecuencia — Directiva ' + turma.nome + '*\n\n'
        + '📅 Actividades realizadas: *' + d.total_atividades + '*\n'
        + '✅ Asistencias: *' + d.presencas + '*\n'
        + '❌ Ausencias: *' + faltas + '*\n'
        + '📈 Frecuencia: *' + pct + '%*\n'
        + '🎓 Estado: *' + status + '*\n\n'
        + (pct >= 75 ? '¡Felicitaciones! Estás apto para el certificado. 🎉'
          : pct >= 50 ? '¡Atención! Estás en riesgo. No faltes a las próximas actividades. ⚠️'
          : 'Estás por debajo del mínimo requerido (75%). ❌')
        + '\n\n¿Dudas? Comunícate con la presidencia.';

      if (d.whatsapp) {
        try {
          await enviarWhatsApp(d.whatsapp, msg);
          count++;
          await logNotificacao({ membro_id: d.id, cobranca_id: null, tipo: 'frequencia', canal: 'whatsapp', status: 'ok' });
        } catch(e) { console.error('Erro freq diretivo wpp:', e.message); }
      }

      if (d.email) {
        const corStatus = pct>=75?'#22c55e':pct>=50?'#f59e0b':'#ef4444';
        const alertaBox = pct>=75
          ? '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin-bottom:24px"><p style="margin:0;font-size:13px;color:#166534">🎉 Parabéns! Você está apto para o certificado anual da diretoria.</p></div>'
          : pct>=50
            ? '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px 20px;margin-bottom:24px"><p style="margin:0;font-size:13px;color:#92400e">⚠️ Atenção! Você está em risco. Não falte às próximas atividades.</p></div>'
            : '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px 20px;margin-bottom:24px"><p style="margin:0;font-size:13px;color:#991b1b">❌ Você está abaixo do mínimo exigido de 75%.</p></div>';
        const html = `<h2 style="margin:0 0 8px;font-size:20px;color:#0f172a">¡Hola, ${d.nome.split(' ')[0]}!</h2><p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7">Aquí está tu reporte de frecuencia correspondiente a la directiva <strong>${turma.nome}</strong>.</p><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 24px"><tr style="background:#f8fafc"><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Actividades realizadas</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:#0f172a">${d.total_atividades}</td></tr><tr><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Asistencias</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:#22c55e">${d.presencas}</td></tr><tr style="background:#f8fafc"><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Ausencias</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:#ef4444">${faltas}</td></tr><tr><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Frecuencia</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:#0f172a;font-size:16px">${pct}%</td></tr><tr style="background:#f8fafc"><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Estado</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:${corStatus}">${status}</td></tr></table>${alertaBox}${portalPromo}<p style="margin:0;font-size:12px;color:#94a3b8">Dúvidas? Entre em contato com a presidência da ${orgNome}.</p>`;
        try { await enviarEmail({ para: d.email, assunto: '📊 Reporte de Frecuencia — Directiva ' + turma.nome, html, texto: msg, faixaLabel: 'RELATÓRIO DE FREQUÊNCIA — DIRETORIA' }); } catch(e) {}
      }
    }
    console.log('Frequência enviada para diretivo_turma:', turma.nome);
  }
}

// ─── LEMBRETE INSCRIÇÕES PENDENTES ───────────────────────────────────────────
async function lembrarInscricoesPendentes() {
  const { enviarWhatsApp, enviarEmail } = require('./notificacoes');
  const config = await query('SELECT chave,valor FROM configuracoes').then(r => { const c={}; r.rows.forEach(x=>c[x.chave]=x.valor); return c; });
  const orgNome = config.org_nome || 'LAURO - Liga Académica de Urología';
  const appUrl = process.env.APP_URL || 'https://sistema.lauroucpcde.com';
  const inscUrl = appUrl.replace('sistema','inscricao');

  const r = await query(`
    SELECT ei.id, ei.nome, ei.email, ei.whatsapp, e.nome as evento_nome, ep.pix_copia_cola
    FROM evento_inscricoes ei
    JOIN eventos e ON e.id=ei.evento_id
    LEFT JOIN evento_pagamentos ep ON ep.inscricao_id=ei.id
    WHERE ei.status='pendente'
    AND ei.isento=false
    AND ei.criado_em < NOW() - INTERVAL '2 hours'
    AND ei.criado_em > NOW() - INTERVAL '48 hours'
    AND NOT EXISTS (
      SELECT 1 FROM notificacoes_log nl
      WHERE nl.tipo='lembrete_inscricao'
      AND nl.canal IN ('whatsapp','email')
      AND nl.cobranca_id=ei.id
      AND nl.enviado_em > NOW() - INTERVAL '20 hours'
    )
    LIMIT 5
  `);

  const cancelR = await query(`
    UPDATE evento_inscricoes
    SET status='cancelado'
    WHERE status='pendente'
    AND isento=false
    AND criado_em < NOW() - INTERVAL '48 hours'
    RETURNING id, nome, email
  `);
  if (cancelR.rows.length > 0) {
    console.log('[LEMBRETE] Inscrições canceladas por timeout:', cancelR.rows.length);
  }

  console.log('[LEMBRETE] Inscrições pendentes para notificar:', r.rows.length);

  let count = 0;
  for (const ei of r.rows) {
    const linkPag = `${inscUrl}/pagamento/${ei.id}`;
    const msg = `*${orgNome}*\n\nHola, *${ei.nome.split(' ')[0]}*! 👋\n\nNotamos que tu inscripción en el evento:\n*${ei.evento_nome}*\n\n...aún está pendiente de pago.\n\n💳 Completa tu inscripción aquí:\n${linkPag}\n\n_¡No pierdas tu lugar!_`;

    let wppOk = false, emailOk = false;

    if (ei.whatsapp) {
      try {
        await enviarWhatsApp(ei.whatsapp, msg);
        count++;
        wppOk = true;
      } catch(e) {}
    }

    if (ei.email) {
      const html = `<h2 style="color:#0f172a">¡Completa tu inscripción!</h2><p style="color:#475569">Hola, <strong>${ei.nome.split(' ')[0]}</strong>! Tu inscripción en <strong>${ei.evento_nome}</strong> está pendiente.</p><div style="text-align:center;margin:24px 0"><a href="${linkPag}" style="background:#1a3d2b;color:white;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700">Completar inscripción</a></div>`;
      try {
        await enviarEmail({ para: ei.email, assunto: `⏳ Completa tu inscripción — ${ei.evento_nome}`, html, texto: msg, faixaLabel: '⏳ INSCRIPCIÓN PENDIENTE' });
        emailOk = true;
      } catch(e) {}
    }

    if (wppOk || emailOk) {
      if (wppOk) await query("INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES (NULL,$1,'lembrete_inscricao','whatsapp','ok')", [ei.id]);
      if (emailOk) await query("INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES (NULL,$1,'lembrete_inscricao','email','ok')", [ei.id]);
      console.log('[LEMBRETE] Enviado para:', ei.nome);
    }
  }
}

// ─── LOG DE NOTIFICAÇÕES ──────────────────────────────────────────────────────
async function logNotificacao({ membro_id, cobranca_id, tipo, canal, status }) {
  await query(
    'INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
    [membro_id, cobranca_id || null, tipo, canal, status]
  );
}

// ─── INICIAR AGENDAMENTOS ─────────────────────────────────────────────────────
function iniciarAgendamentos() {
  console.log('Agendamentos PagBank iniciados...');

  // Notificação atrasados — às 9h (e-mail diário sem limite; WhatsApp com intervalo de 3 dias, anti-ban)
  cron.schedule('0 9 * * *', async () => {
    console.log('[CRON]', new Date().toISOString(), 'Atrasados: cron disparado');
    await notificarAtrasadosDiario();
  }, { timezone: 'America/Asuncion' });

  // Rotina diária às 8h
  cron.schedule('0 8 * * *', async () => {
    console.log('Rotina diária iniciando...');
    try {
      await gerarCobrancasMes();
      await atualizarAtrasados();     // marca atrasado + invalida o PIX de desconto vencido
      await atualizarPixAtrasados();  // gera PIX novo com valor CHEIO p/ as que venceram (ordem importa: depois do atualizarAtrasados)
      await verificarPagamentos();
      await enviarNotificacoes();
      await enviarAniversarios();
    } catch(e) { console.error('Rotina diária erro:', e.message); }
    try { await auditarFluxoCaixa(); } catch(e) { console.error('[AUDITORIA] erro cron:', e.message); }
    try { await auditarFluxoCaixaEventos(); } catch(e) { console.error('[AUDITORIA] erro cron eventos:', e.message); }
  }, { timezone: 'America/Asuncion' });

  // A cada 3min — verificar pagamentos (sem WhatsApp)
  cron.schedule('*/3 * * * *', async () => {
    try { await verificarPagamentos(); } catch(e) { console.error('Verificar pagamentos erro:', e.message); }
    try { await verificarPagamentosPss(); } catch(e) { console.error('Verificar pagamentos PSS erro:', e.message); }
  }, { timezone: 'America/Asuncion' });

  // Último dia do mês às 20h — frequência mensal
  cron.schedule('0 20 28-31 * *', async () => {
    const hoje = new Date();
    const amanha = new Date(hoje);
    amanha.setDate(hoje.getDate() + 1);
    if (amanha.getDate() === 1) {
      console.log('Último dia do mês — enviando frequência automática...');
      try { await enviarFrequenciaMensal(); } catch(e) { console.error('Erro freq mensal:', e.message); }
    }
  }, { timezone: 'America/Asuncion' });

  // Lembretes inscrições pendentes — a cada hora (máx 5 por vez)
  cron.schedule('0 * * * *', async () => {
    try { await lembrarInscricoesPendentes(); } catch(e) { console.error('Lembrete inscrições erro:', e.message); }
  }, { timezone: 'America/Asuncion' });

  // Vigia da W-API — a cada 5 minutos. A instância cai sem avisar ninguém, e instância
  // caída = quem escreve pra liga nao recebe resposta e a mensagem nem chega no sistema.
  // Só avisa na transição para desconectado, senão viraria e-mail repetido.
  cron.schedule('*/5 * * * *', async () => {
    try { await require('./wapi-vigia').verificar(); } catch(e) { console.error('[VIGIA W-API] erro:', e.message); }
  }, { timezone: 'America/Asuncion' });

  // Instagram — verificar posts agendados a cada 5 minutos
  cron.schedule('*/5 * * * *', async () => {
    try {
      const { processarPostsAgendados, postarAniversariantesDoDia } = require('./instagram');
      await processarPostsAgendados();
    } catch(e) { console.error('[INSTAGRAM] Cron erro:', e.message); }
  }, { timezone: 'America/Asuncion' });

  // Marketing — publicar posts agendados (marketing_posts) a cada 5 minutos
  cron.schedule('*/5 * * * *', async () => {
    try {
      const { processarPostsMarketingAgendados } = require('./marketing-publish');
      await processarPostsMarketingAgendados();
    } catch(e) { console.error('[MARKETING] Cron erro:', e.message); }
  }, { timezone: 'America/Asuncion' });

  // Instagram — post aniversariantes às 9h
  cron.schedule('0 9 * * *', async () => {
    try {
      const { postarAniversariantesDoDia } = require('./instagram');
      await postarAniversariantesDoDia();
    } catch(e) { console.error('[INSTAGRAM] Aniversário erro:', e.message); }
  }, { timezone: 'America/Asuncion' });

  // Instagram — story de aniversário de ligantes/diretivos às 6h
  cron.schedule('0 6 * * *', async () => {
    try {
      const { postarStoriesAniversarioDoDia } = require('./instagram');
      await postarStoriesAniversarioDoDia();
    } catch(e) { console.error('[INSTAGRAM] Story aniversário erro:', e.message); }
  }, { timezone: 'America/Asuncion' });

  // Lembrete WhatsApp p/ equipe (marketing/presidencia/admin) — vespera do aniversario, às 19h
  cron.schedule('0 19 * * *', async () => {
    try {
      const { enviarLembreteAniversarioEquipe } = require('./aniversario-lembrete');
      await enviarLembreteAniversarioEquipe('antes');
    } catch(e) { console.error('[LEMBRETE ANIVERSARIO] erro (antes):', e.message); }
  }, { timezone: 'America/Asuncion' });

  // Lembrete WhatsApp p/ equipe (marketing/presidencia/admin) — dia do aniversario, às 6h
  cron.schedule('0 6 * * *', async () => {
    try {
      const { enviarLembreteAniversarioEquipe } = require('./aniversario-lembrete');
      await enviarLembreteAniversarioEquipe('dia');
    } catch(e) { console.error('[LEMBRETE ANIVERSARIO] erro (dia):', e.message); }
  }, { timezone: 'America/Asuncion' });

  // Alerta de pendencias do marketing — domingo e terca as 8h, dois dias antes de cada
  // envio do Momento Revalida (terca e quinta), dando margem para aprovar a tempo.
  // So dispara e-mail se houver pendencia: alerta que chega sempre vira ruido ignorado.
  cron.schedule('0 8 * * 0,2', async () => {
    try {
      const { enviarAlertaPendencias } = require('./marketing-alerta');
      await enviarAlertaPendencias();
    } catch(e) { console.error('[ALERTA MKT] Cron erro:', e.message); }
  }, { timezone: 'America/Asuncion' });

  // Momento Revalida Brasil — quadro dos stories, terça e quinta às 6h.
  // Nao publica sozinho: a API do Instagram nao cria enquete, entao manda as artes
  // por e-mail para a equipe publicar pelo app encaixando o adesivo.
  cron.schedule('0 6 * * 2,4', async () => {
    try {
      const { enviarQuadroRevalida } = require('./revalida-quadro');
      await enviarQuadroRevalida();
    } catch(e) { console.error('[REVALIDA] Cron erro:', e.message); }
  }, { timezone: 'America/Asuncion' });

  // Instagram — plano de ação estratégico (IA) da conta, segunda e quinta às 8h (marketing/presidência/admin)
  cron.schedule('0 8 * * 1,4', async () => {
    try {
      const { enviarRelatorioEstrategico } = require('./instagram-estrategia');
      await enviarRelatorioEstrategico();
    } catch(e) { console.error('[IG ESTRATEGIA] relatório semanal erro:', e.message); }
  }, { timezone: 'America/Asuncion' });

  // Encerramento automático de eventos — a cada hora
  cron.schedule('0 * * * *', async () => {
    try {
      const r = await query("UPDATE eventos SET status='encerrado' WHERE status='ativo' AND data_fim < NOW() RETURNING id, nome");
      if (r.rows.length > 0) r.rows.forEach(e => console.log('Evento encerrado automaticamente:', e.nome));
    } catch(e) { console.error('Encerramento automático erro:', e.message); }
  }, { timezone: 'America/Asuncion' });
}

module.exports = {
  notificarAtrasadosDiario,
  iniciarAgendamentos,
  gerarCobrancasMes,
  verificarPagamentos,
  verificarPagamentosPss,
  atualizarPixAtrasados,
  logNotificacao,
  enviarFrequenciaMensal,
  enviarNotificacoes
};
