const cron = require('node-cron');
const dayjs = require('dayjs');
const { query } = require('../models/database');
const { criarCobranca, consultarPagamento } = require('./pagbank');
const { notificarCobranca, notificarAniversario } = require('./notificacoes');

async function getConfig() {
  const r = await query('SELECT chave, valor FROM configuracoes');
  const cfg = {};
  r.rows.forEach(row => { cfg[row.chave] = row.valor; });
  return cfg;
}

// ─── CONTADOR GLOBAL DIÁRIO DE MENSAGENS WHATSAPP ────────────────────────────
let _msgCount = 0;
let _msgDate = '';
const LIMITE_DIARIO = 20; // Max seguro para nao ser banido

function resetarContadorSeNovoDia() {
  const hoje = dayjs().format('YYYY-MM-DD');
  if (_msgDate !== hoje) { _msgCount = 0; _msgDate = hoje; }
}

function podeMensagem() {
  resetarContadorSeNovoDia();
  if (_msgCount >= LIMITE_DIARIO) {
    console.log(`[WAPP] LIMITE DIÁRIO ATINGIDO (${LIMITE_DIARIO}). Bloqueando envio.`);
    return false;
  }
  return true;
}

function incrementarContador() {
  resetarContadorSeNovoDia();
  _msgCount++;
  console.log(`[WAPP] Mensagens enviadas hoje: ${_msgCount}/${LIMITE_DIARIO}`);
}

// ─── INTERVALO SEGURO ENTRE MENSAGENS ────────────────────────────────────────
const INTERV_MSG = (parseInt(process.env.WAPP_INTERVALO_MSG) || 120) * 1000;
const INTERV_LOTE = (parseInt(process.env.WAPP_INTERVALO_LOTE) || 900) * 1000;
const LOTE_TAM = parseInt(process.env.WAPP_LOTE_TAM) || 2;

async function esperarIntervalo(count) {
  await new Promise(r => setTimeout(r, INTERV_MSG));
  if (count % LOTE_TAM === 0) {
    console.log('[WAPP] Pausa entre lotes...');
    await new Promise(r => setTimeout(r, INTERV_LOTE));
  }
}

// ─── GERAR COBRANÇAS DO MÊS ──────────────────────────────────────────────────
async function gerarCobrancasMes() {
  const hoje = dayjs();
  const mes = hoje.format('YYYY-MM');
  const membros = await query('SELECT * FROM membros WHERE ativo=1');
  const config = await getConfig();

  for (const membro of membros.rows) {
    const ref = membro.id + '-' + mes;
    const existe = await query('SELECT id FROM cobrancas WHERE referencia=$1', [ref]);
    if (existe.rows.length > 0) continue;

    const diaVenc = membro.dia_vencimento || parseInt(config.dia_vencimento_padrao) || 15;
    // Vencimento sempre dia fixo do mes de referencia (nunca usar hoje.date() pois se o dia ja passou dayjs retorna data errada)
    const dataVenc = `${mes}-${String(diaVenc).padStart(2,'0')}`;
    const valorCheio = parseFloat(membro.mensalidade) || 0;
    const descPct = parseFloat(membro.desconto_pontualidade) || parseFloat(config.desconto_padrao) || 20;
    const valorDesc = +(valorCheio * (1 - descPct / 100)).toFixed(2);

    const dataVencPix = hoje.add(180, 'day').format('YYYY-MM-DD'); // PIX valido por 1 ano
    const pag = await criarCobranca({ membro, valor: valorCheio, vencimento: dataVencPix, referencia: ref });

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
    SELECT c.id, c.referencia, c.valor_cheio, c.membro_id,
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
  const dataVencPix = hoje.add(180, 'day').format('YYYY-MM-DD');
  for (const c of rows) {
    try {
      const pag = await criarCobranca({
        membro: { nome: c.nome, email: c.email, cpf: c.cpf },
        valor: c.valor_cheio,
        vencimento: dataVencPix,
        referencia: c.referencia
      });
      if (pag.ok) {
        await query(`UPDATE cobrancas SET pix_copia_cola=$1, pix_qr_code_base64=$2, pix_qr_image=$3, pagbank_charge_id=$4, pagbank_link=$5 WHERE id=$6`,
          [pag.pix_copia_cola, pag.pix_qr_code_base64, pag.pix_qr_image, pag.charge_id, pag.link, c.id]);
        console.log('[PIX-UPDATE] PIX atualizado:', c.nome, c.referencia);
      }
      await new Promise(r => setTimeout(r, 800));
    } catch(e) { console.error('[PIX-UPDATE] Erro:', c.nome, e.message); }
  }
}

// ─── VERIFICAR PAGAMENTOS ─────────────────────────────────────────────────────
async function verificarPagamentos() {
  const pbR = await query(
    "SELECT * FROM cobrancas WHERE status IN ('pendente','atrasado') AND pagbank_charge_id IS NOT NULL"
  );
  for (const cob of pbR.rows) {
    try {
      const result = await consultarPagamento(cob.pagbank_charge_id);
      if (result.ok && result.status === 'PAID') {
        await query("UPDATE cobrancas SET status='pago', data_pagamento=NOW() WHERE id=$1", [cob.id]);
        console.log('PagBank pagamento confirmado via cron:', cob.referencia);
      }
    } catch(e) { console.error('PagBank verificar erro:', cob.id, e.message); }
  }
}

// ─── ATUALIZAR ATRASADOS ──────────────────────────────────────────────────────
async function atualizarAtrasados() {
  const hoje = dayjs().format('YYYY-MM-DD');
  const r = await query(
    "UPDATE cobrancas SET status='atrasado' WHERE status='pendente' AND data_vencimento::date < $1::date",
    [hoje]
  );
  if (r.rowCount > 0) console.log(r.rowCount + ' cobranças marcadas como atrasadas');
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
      if (!podeMensagem()) break;
      const j = await query("SELECT id FROM notificacoes_log WHERE cobranca_id=$1 AND tipo='pre'", [cob.id]);
      if (j.rows.length === 0) {
        await notificarCobranca({ membro: {...cob, id: cob.membro_id}, cobranca: cob, tipo: 'pre', config });
        incrementarContador();
        count++;
        await esperarIntervalo(count);
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
      if (!podeMensagem()) break;
      const j = await query("SELECT id FROM notificacoes_log WHERE cobranca_id=$1 AND tipo='dia'", [cob.id]);
      if (j.rows.length === 0) {
        await notificarCobranca({ membro: {...cob, id: cob.membro_id}, cobranca: cob, tipo: 'dia', config });
        incrementarContador();
        count++;
        await esperarIntervalo(count);
      }
    }
  }

  // 1 dia após vencimento
  if (config.notif_pos1_ativo === '1') {
    const ontem = hoje.subtract(1, 'day').format('YYYY-MM-DD');
    const r = await query(
      "SELECT c.*, m.nome, m.email, m.whatsapp FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.data_vencimento::date=$1::date AND c.status IN ('pendente','atrasado') AND m.ativo=1",
      [ontem]
    );
    for (const cob of r.rows) {
      if (!podeMensagem()) break;
      // Verificar se já recebeu qualquer notificação hoje (evita duplicata com atrasados)
      const j = await query(
        "SELECT id FROM notificacoes_log WHERE cobranca_id=$1 AND tipo IN ('pos','atrasado') AND DATE(enviado_em)=CURRENT_DATE",
        [cob.id]
      );
      if (j.rows.length === 0) {
        await notificarCobranca({ membro: {...cob, id: cob.membro_id}, cobranca: cob, tipo: 'pos', config });
        incrementarContador();
        count++;
        await esperarIntervalo(count);
      }
    }
  }
}

// ─── NOTIFICAÇÃO DIÁRIA DE ATRASADOS ─────────────────────────────────────────
async function notificarAtrasadosDiario() {
  const config = await getConfig();
  if (config.notif_atrasados_diario !== '1') return;

  // Máx 5 atrasados por dia para não gerar padrão de spam
  const r = await query(
    "SELECT c.*, m.nome, m.email, m.whatsapp FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='atrasado' AND m.ativo=1 ORDER BY c.data_vencimento ASC"
  );

  let count = 0;
  const hoje = dayjs().format('YYYY-MM-DD');

  for (const cob of r.rows) {
    if (count >= 5) { console.log('[ATRASADOS] Limite de 5 mensagens/dia atingido.'); break; }
    if (!podeMensagem()) break;

    // Verificar se já foi notificado hoje (qualquer tipo de cobrança)
    const j = await query(
      "SELECT id FROM notificacoes_log WHERE cobranca_id=$1 AND DATE(enviado_em)=$2",
      [cob.id, hoje]
    );
    if (j.rows.length > 0) {
      console.log('[ATRASADOS] Já notificado hoje:', cob.nome);
      continue;
    }


    await notificarCobranca({ membro: {...cob, id: cob.membro_id}, cobranca: cob, tipo: 'pos', config });
    incrementarContador();
    count++;
    await esperarIntervalo(count);
    console.log('[ATRASADOS] Notificação enviada:', cob.nome, cob.referencia);
  }

  console.log('[ATRASADOS] Job concluído —', count, 'notificações enviadas de', r.rows.length, 'atrasados verificados');
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

// ─── ANIVERSÁRIOS ─────────────────────────────────────────────────────────────
async function enviarAniversarios() {
  const config = await getConfig();
  if (config.notif_aniversario_ativo !== '1') return;
  const hoje = dayjs();
  const md = hoje.format('MM-DD');
  const r = await query(
    "SELECT * FROM membros WHERE ativo=1 AND data_nascimento IS NOT NULL AND TO_CHAR(data_nascimento::date,'MM-DD')=$1",
    [md]
  );
  let count = 0;
  for (const membro of r.rows) {
    if (!podeMensagem()) break;
    const j = await query(
      "SELECT id FROM notificacoes_log WHERE membro_id=$1 AND tipo='aniversario' AND enviado_em >= CURRENT_DATE",
      [membro.id]
    );
    if (j.rows.length === 0) {
      await notificarAniversario({ membro, config });
      incrementarContador();
      count++;
      await esperarIntervalo(count);
      console.log('Parabéns enviado:', membro.nome);
    }
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
      if (!podeMensagem()) { console.log('[FREQ] Limite diário atingido, pausando.'); break; }

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
          incrementarContador();
          count++;
          await logNotificacao({ membro_id: m.id, cobranca_id: null, tipo: 'frequencia', canal: 'whatsapp', status: 'ok' });
          await esperarIntervalo(count);
        } catch(e) { console.error('Erro freq wpp:', e.message); }
      }

      if (m.email) {
        const corStatus = pct>=75?'#22c55e':pct>=50?'#f59e0b':'#ef4444';
        const alertaBox = pct>=75
          ? '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin-bottom:24px"><p style="margin:0;font-size:13px;color:#166534">🎉 Parabéns! Você está apto para o certificado anual.</p></div>'
          : pct>=50
            ? '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px 20px;margin-bottom:24px"><p style="margin:0;font-size:13px;color:#92400e">⚠️ Atenção! Você está em risco. Não falte às próximas atividades.</p></div>'
            : '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px 20px;margin-bottom:24px"><p style="margin:0;font-size:13px;color:#991b1b">❌ Você está abaixo do mínimo exigido de 75%.</p></div>';
        const logoHtml = orgLogo ? '<div style="width:80px;height:80px;border-radius:50%;background:white;margin:0 auto;padding:8px;box-sizing:border-box"><img src="'+orgLogo+'" style="width:64px;height:64px;object-fit:contain;border-radius:50%"></div>' : '';
        const html = `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td><div style="background:linear-gradient(160deg,#1a3d2b 0%,#0a1f1a 100%);padding:32px 40px;text-align:center">${logoHtml}<div style="margin-top:12px;display:inline-block;background:rgba(34,197,94,0.2);border-radius:4px;padding:4px 16px"><span style="color:#86efac;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase">RELATÓRIO DE FREQUÊNCIA</span></div></div></td></tr><tr><td style="background:white;padding:36px 40px"><h2 style="margin:0 0 8px;font-size:20px;color:#0f172a">¡Hola, ${m.nome.split(' ')[0]}!</h2><p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7">Aquí está tu reporte de frecuencia correspondiente al grupo <strong>${turma.nome}</strong>.</p><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 24px"><tr style="background:#f8fafc"><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Actividades realizadas</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:#0f172a">${m.total_atividades}</td></tr><tr><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Asistencias</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:#22c55e">${m.presencas}</td></tr><tr style="background:#f8fafc"><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Ausencias</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:#ef4444">${faltas}</td></tr><tr><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Frecuencia</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:#0f172a;font-size:16px">${pct}%</td></tr><tr style="background:#f8fafc"><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Estado</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:${corStatus}">${status}</td></tr></table>${alertaBox}<p style="margin:0;font-size:12px;color:#94a3b8">Dúvidas? Entre em contato com a secretaria da ${orgNome}.</p></td></tr><tr><td style="background:#0f172a;padding:24px 40px"><p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;font-weight:600">${orgNome}</p><p style="margin:4px 0 0;color:rgba(255,255,255,0.4);font-size:10px">Liga Académica de Urología — UCP | Ciudad del Este</p></td></tr></table></td></tr></table></body></html>`;
        try { await enviarEmail({ para: m.email, assunto: '📊 Reporte de Frecuencia — ' + turma.nome, html, texto: msg }); } catch(e) {}
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
      if (!podeMensagem()) break;

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
          incrementarContador();
          count++;
          await logNotificacao({ membro_id: d.id, cobranca_id: null, tipo: 'frequencia', canal: 'whatsapp', status: 'ok' });
          await esperarIntervalo(count);
        } catch(e) { console.error('Erro freq diretivo wpp:', e.message); }
      }

      if (d.email) {
        const corStatus = pct>=75?'#22c55e':pct>=50?'#f59e0b':'#ef4444';
        const alertaBox = pct>=75
          ? '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin-bottom:24px"><p style="margin:0;font-size:13px;color:#166534">🎉 Parabéns! Você está apto para o certificado anual da diretoria.</p></div>'
          : pct>=50
            ? '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px 20px;margin-bottom:24px"><p style="margin:0;font-size:13px;color:#92400e">⚠️ Atenção! Você está em risco. Não falte às próximas atividades.</p></div>'
            : '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px 20px;margin-bottom:24px"><p style="margin:0;font-size:13px;color:#991b1b">❌ Você está abaixo do mínimo exigido de 75%.</p></div>';
        const logoHtml = orgLogo ? '<div style="width:80px;height:80px;border-radius:50%;background:white;margin:0 auto;padding:8px;box-sizing:border-box"><img src="'+orgLogo+'" style="width:64px;height:64px;object-fit:contain;border-radius:50%"></div>' : '';
        const html = `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td><div style="background:linear-gradient(160deg,#1a3d2b 0%,#0a1f1a 100%);padding:32px 40px;text-align:center">${logoHtml}<div style="margin-top:12px;display:inline-block;background:rgba(34,197,94,0.2);border-radius:4px;padding:4px 16px"><span style="color:#86efac;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase">RELATÓRIO DE FREQUÊNCIA — DIRETORIA</span></div></div></td></tr><tr><td style="background:white;padding:36px 40px"><h2 style="margin:0 0 8px;font-size:20px;color:#0f172a">¡Hola, ${d.nome.split(' ')[0]}!</h2><p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7">Aquí está tu reporte de frecuencia correspondiente a la directiva <strong>${turma.nome}</strong>.</p><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 24px"><tr style="background:#f8fafc"><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Actividades realizadas</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:#0f172a">${d.total_atividades}</td></tr><tr><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Asistencias</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:#22c55e">${d.presencas}</td></tr><tr style="background:#f8fafc"><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Ausencias</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:#ef4444">${faltas}</td></tr><tr><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Frecuencia</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:#0f172a;font-size:16px">${pct}%</td></tr><tr style="background:#f8fafc"><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Estado</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:${corStatus}">${status}</td></tr></table>${alertaBox}<p style="margin:0;font-size:12px;color:#94a3b8">Dúvidas? Entre em contato com a presidência da ${orgNome}.</p></td></tr><tr><td style="background:#0f172a;padding:24px 40px"><p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;font-weight:600">${orgNome}</p><p style="margin:4px 0 0;color:rgba(255,255,255,0.4);font-size:10px">Liga Académica de Urología — UCP | Ciudad del Este</p></td></tr></table></td></tr></table></body></html>`;
        try { await enviarEmail({ para: d.email, assunto: '📊 Reporte de Frecuencia — Directiva ' + turma.nome, html, texto: msg }); } catch(e) {}
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
    if (!podeMensagem()) break;

    const linkPag = `${inscUrl}/pagamento/${ei.id}`;
    const msg = `*${orgNome}*\n\nHola, *${ei.nome.split(' ')[0]}*! 👋\n\nNotamos que tu inscripción en el evento:\n*${ei.evento_nome}*\n\n...aún está pendiente de pago.\n\n💳 Completa tu inscripción aquí:\n${linkPag}\n\n_¡No pierdas tu lugar!_`;

    let wppOk = false, emailOk = false;

    if (ei.whatsapp) {
      try {
        await enviarWhatsApp(ei.whatsapp, msg);
        incrementarContador();
        count++;
        wppOk = true;
        await esperarIntervalo(count);
      } catch(e) {}
    }

    if (ei.email) {
      const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif"><table width="100%"><tr><td align="center" style="padding:40px 16px"><table style="max-width:560px;width:100%"><tr><td style="background:#1a3d2b;padding:32px 40px;text-align:center"><span style="color:#ffd700;font-size:10px;font-weight:700;letter-spacing:2px">⏳ INSCRIPCIÓN PENDIENTE</span></td></tr><tr><td style="background:white;padding:36px 40px"><h2 style="color:#0f172a">¡Completa tu inscripción!</h2><p style="color:#475569">Hola, <strong>${ei.nome.split(' ')[0]}</strong>! Tu inscripción en <strong>${ei.evento_nome}</strong> está pendiente.</p><div style="text-align:center;margin:24px 0"><a href="${linkPag}" style="background:#1a3d2b;color:white;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700">Completar inscripción</a></div></td></tr></table></td></tr></table></body></html>`;
      try {
        await enviarEmail({ para: ei.email, assunto: `⏳ Completa tu inscripción — ${ei.evento_nome}`, html, texto: msg });
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

  // Notificação atrasados — às 9h (máx 5 por dia, intervalo 3 dias entre reenvios)
  cron.schedule('0 9 * * *', async () => {
    console.log('[CRON] Notificando atrasados diariamente...');
    await notificarAtrasadosDiario();
  }, { timezone: 'America/Asuncion' });

  // Rotina diária às 8h
  cron.schedule('0 8 * * *', async () => {
    try { await atualizarPixAtrasados(); } catch(e) { console.error('[PIX-UPDATE] erro cron:', e.message); }
    try { await auditarFluxoCaixa(); } catch(e) { console.error('[AUDITORIA] erro cron:', e.message); }
    console.log('Rotina diária iniciando...');
    try {
      await gerarCobrancasMes();
      await atualizarAtrasados();
      await verificarPagamentos();
      await enviarNotificacoes();
      await enviarAniversarios();
    } catch(e) { console.error('Rotina diária erro:', e.message); }
  }, { timezone: 'America/Asuncion' });

  // A cada 3min — verificar pagamentos (sem WhatsApp)
  cron.schedule('*/3 * * * *', async () => {
    try { await verificarPagamentos(); } catch(e) { console.error('Verificar pagamentos erro:', e.message); }
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

  // Instagram — verificar posts agendados a cada 5 minutos
  cron.schedule('*/5 * * * *', async () => {
    try {
      const { processarPostsAgendados, postarAniversariantesDoDia } = require('./instagram');
      await processarPostsAgendados();
    } catch(e) { console.error('[INSTAGRAM] Cron erro:', e.message); }
  }, { timezone: 'America/Asuncion' });

  // Instagram — post aniversariantes às 9h
  cron.schedule('0 9 * * *', async () => {
    try {
      const { postarAniversariantesDoDia } = require('./instagram');
      await postarAniversariantesDoDia();
    } catch(e) { console.error('[INSTAGRAM] Aniversário erro:', e.message); }
  }, { timezone: 'America/Asuncion' });

  // Encerramento automático de eventos — a cada hora
  cron.schedule('0 * * * *', async () => {
    try {
      const r = await query("UPDATE eventos SET status='encerrado' WHERE status='ativo' AND data_fim < NOW() RETURNING id, nome");
      if (r.rows.length > 0) r.rows.forEach(e => console.log('Evento encerrado automaticamente:', e.nome));
    } catch(e) { console.error('Encerramento automático erro:', e.message); }
  }, { timezone: 'America/Asuncion' });
}

async function sincronizarPagamentosMP() {
  try {
    const r = await query(
      "SELECT id, referencia, mp_payment_id FROM cobrancas WHERE status IN ('pendente','atrasado') AND mp_payment_id IS NOT NULL AND mp_payment_id != '' AND mp_payment_id != 'undefined'"
    );
    if (r.rows.length === 0) return;
    for (const cob of r.rows) {
      try {
        const token = process.env.MP_ACCESS_TOKEN;
        if (!token) break;
        const resp = await fetch('https://api.mercadopago.com/v1/payments/' + cob.mp_payment_id, {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await resp.json();
        if (data.status === 'approved') {
          await query("UPDATE cobrancas SET status='pago', data_pagamento=NOW() WHERE id=$1 AND status IN ('pendente','atrasado')", [cob.id]);
        }
        await new Promise(r => setTimeout(r, 300));
      } catch(e) { console.error('MP Sync erro:', cob.mp_payment_id, e.message); }
    }
  } catch(e) { console.error('MP Sync geral erro:', e.message); }
}

module.exports = {
  notificarAtrasadosDiario,
  iniciarAgendamentos,
  gerarCobrancasMes,
  verificarPagamentos,
  atualizarPixAtrasados,
  logNotificacao,
  enviarFrequenciaMensal,
  enviarNotificacoes,
  sincronizarPagamentosMP
};
