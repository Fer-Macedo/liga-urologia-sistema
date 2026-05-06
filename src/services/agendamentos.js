const cron = require('node-cron');
const dayjs = require('dayjs');
const { query } = require('../models/database');
const { criarCobranca } = require('./mercadopago');
const { notificarCobranca, notificarAniversario } = require('./notificacoes');

async function getConfig() {
  const r = await query('SELECT chave, valor FROM configuracoes');
  const cfg = {};
  r.rows.forEach(row => { cfg[row.chave] = row.valor; });
  return cfg;
}

async function gerarCobrancasMes() {
  const hoje = dayjs();
  const mes = hoje.format('YYYY-MM');
  const membros = await query('SELECT * FROM membros WHERE ativo=1');
  const config = await getConfig();

  for (const membro of membros.rows) {
    const ref = membro.id + '-' + mes;
    const existe = await query('SELECT id FROM cobrancas WHERE referencia=$1', [ref]);
    if (existe.rows.length > 0) continue;

    const diaVenc = membro.dia_vencimento || parseInt(config.dia_vencimento_padrao) || 16;
    const dataVenc = hoje.date(diaVenc).format('YYYY-MM-DD');
    const valorCheio = membro.mensalidade;
    const descPct = membro.desconto_pontualidade || parseFloat(config.desconto_padrao) || 20;
    const valorDesc = +(valorCheio * (1 - descPct / 100)).toFixed(2);

    const pag = await criarCobranca({ membro, valor: valorDesc, vencimento: dataVenc, referencia: ref });

    await query(
      'INSERT INTO cobrancas (membro_id,referencia,valor_cheio,valor_desconto,data_vencimento,status,mp_payment_id,pagbank_link,pix_qr_code,pix_qr_code_base64) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [membro.id, ref, valorCheio, valorDesc, dataVenc, 'pendente',
       pag.payment_id||null, pag.link||null,
       pag.qr_code||null, pag.qr_code_base64||null]
    );
    console.log('Cobranca MP gerada:', membro.nome, ref);
  }
}

async function verificarPagamentos() {
  const { consultarPagamento } = require('./mercadopago');
  const r = await query("SELECT * FROM cobrancas WHERE status='pendente' AND mp_payment_id IS NOT NULL");
  for (const cob of r.rows) {
    const result = await consultarPagamento(cob.mp_payment_id);
    if (result.ok && result.status === 'approved') {
      await query("UPDATE cobrancas SET status='pago', data_pagamento=NOW() WHERE id=$1", [cob.id]);
      console.log('Pagamento confirmado via cron:', cob.id);
    }
  }
}

async function atualizarAtrasados() {
  const hoje = dayjs().format('YYYY-MM-DD');
  const r = await query("UPDATE cobrancas SET status='atrasado' WHERE status='pendente' AND data_vencimento < $1", [hoje]);
  if (r.rowCount > 0) console.log(r.rowCount + ' cobrancas marcadas como atrasadas');
}

async function enviarNotificacoes() {
  const config = await getConfig();
  const hoje = dayjs();

  if (config.notif_pre_ativo === '1') {
    const em3 = hoje.add(3, 'day').format('YYYY-MM-DD');
    const r = await query(
      "SELECT c.*, m.nome, m.email, m.whatsapp FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.data_vencimento=$1 AND c.status='pendente'", [em3]
    );
    for (const cob of r.rows) {
      const j = await query("SELECT id FROM notificacoes_log WHERE cobranca_id=$1 AND tipo='pre'", [cob.id]);
      if (j.rows.length === 0) await notificarCobranca({ membro: cob, cobranca: cob, tipo: 'pre', config });
    }
  }

  if (config.notif_dia_ativo === '1') {
    const hj = hoje.format('YYYY-MM-DD');
    const r = await query(
      "SELECT c.*, m.nome, m.email, m.whatsapp FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.data_vencimento=$1 AND c.status='pendente'", [hj]
    );
    for (const cob of r.rows) {
      const j = await query("SELECT id FROM notificacoes_log WHERE cobranca_id=$1 AND tipo='dia'", [cob.id]);
      if (j.rows.length === 0) await notificarCobranca({ membro: cob, cobranca: cob, tipo: 'dia', config });
    }
  }

  if (config.notif_pos1_ativo === '1') {
    const ontem = hoje.subtract(1, 'day').format('YYYY-MM-DD');
    const r = await query(
      "SELECT c.*, m.nome, m.email, m.whatsapp FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.data_vencimento=$1 AND c.status IN ('pendente','atrasado')", [ontem]
    );
    for (const cob of r.rows) {
      const j = await query(
        "SELECT id FROM notificacoes_log WHERE cobranca_id=$1 AND tipo='pos' AND enviado_em > NOW() - INTERVAL '2 days'", [cob.id]
      );
      if (j.rows.length === 0) await notificarCobranca({ membro: cob, cobranca: cob, tipo: 'pos', config });
    }
  }
}

async function enviarAniversarios() {
  const config = await getConfig();
  if (config.notif_aniversario_ativo !== '1') return;
  const hoje = dayjs();
  const md = hoje.format('MM-DD');
  const r = await query(
    "SELECT * FROM membros WHERE ativo=1 AND data_nascimento IS NOT NULL AND TO_CHAR(data_nascimento::date,'MM-DD')=$1", [md]
  );
  for (const membro of r.rows) {
    const j = await query(
      "SELECT id FROM notificacoes_log WHERE membro_id=$1 AND tipo='aniversario' AND enviado_em >= CURRENT_DATE", [membro.id]
    );
    if (j.rows.length === 0) {
      await notificarAniversario({ membro, config });
      console.log('Parabens enviado:', membro.nome);
    }
  }
}

async function logNotificacao({ membro_id, cobranca_id, tipo, canal, status }) {
  await query(
    'INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
    [membro_id, cobranca_id||null, tipo, canal, status]
  );
}

function iniciarAgendamentos() {
  console.log('Agendamentos MP iniciados...');

  cron.schedule('0 8 * * *', async () => {
    console.log('Rotina diaria iniciando...');
    try {
      await gerarCobrancasMes();
      await atualizarAtrasados();
      await verificarPagamentos();
      await enviarNotificacoes();
      await enviarAniversarios();
    } catch (e) { console.error('Rotina diaria erro:', e.message); }
  }, { timezone: 'America/Sao_Paulo' });

  cron.schedule('0 */2 * * *', async () => {
    try { await verificarPagamentos(); } catch (e) { console.error(e.message); }
  });

  // Ultimo dia do mes as 18:00 — envia frequencia para todos os membros
  cron.schedule('0 18 28-31 * *', async () => {
    const hoje = new Date();
    const amanha = new Date(hoje);
    amanha.setDate(hoje.getDate() + 1);
    if (amanha.getDate() === 1) { // confirma que e o ultimo dia do mes
      console.log('Ultimo dia do mes — enviando frequencia automatica...');
      try { await enviarFrequenciaMensal(); } catch (e) { console.error('Erro freq mensal:', e.message); }
    }
  }, { timezone: 'America/Sao_Paulo' });
}

// Envia frequencia automaticamente no ultimo dia de cada mes
async function enviarFrequenciaMensal() {
  console.log('Enviando frequencia mensal automatica...');
  const { enviarWhatsApp, enviarEmail } = require('./notificacoes');
  const config = await getConfig();
  const orgNome = config.org_nome || 'Liga Academica de Urologia';
  const orgLogo = config.org_logo || null;

  const turmas = await query('SELECT * FROM turmas WHERE ativo=1');
  for (const turma of turmas.rows) {
    const membros = await query(
      `SELECT m.*, tm.data_entrada,
        (SELECT COUNT(*) FROM atividades a WHERE a.turma_id=$1) as total_atividades,
        (SELECT COUNT(*) FROM presencas p JOIN atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1 AND p.membro_id=m.id AND p.presente=1) as presencas
       FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id WHERE tm.turma_id=$1`,
      [turma.id]
    );

    for (const m of membros.rows) {
      const pct = m.total_atividades > 0 ? Math.round((m.presencas / m.total_atividades) * 100) : 0;
      const faltas = m.total_atividades - m.presencas;
      const status = pct >= 75 ? 'APTO ✅' : pct >= 50 ? 'EM RISCO ⚠️' : 'NÃO APTO ❌';

      const msg = '*' + orgNome + '* 📊\n\n'
        + 'Olá, *' + m.nome.split(' ')[0] + '*!\n\n'
        + '📊 *Relatório de Frequência — ' + turma.nome + '*\n\n'
        + '📅 Atividades realizadas: *' + m.total_atividades + '*\n'
        + '✅ Presenças: *' + m.presencas + '*\n'
        + '❌ Faltas: *' + faltas + '*\n'
        + '📈 Frequência: *' + pct + '%*\n'
        + '🎓 Status: *' + status + '*\n\n'
        + (pct >= 75 ? 'Parabéns! Você está apto para o certificado! 🎉' 
           : pct >= 50 ? 'Atenção! Você está em risco. Não falte às próximas atividades! ⚠️'
           : 'Atenção! Você está abaixo do mínimo exigido (75%). ❌') + '\n\n'
        + 'Dúvidas? Entre em contato com a secretaria.';

      if (m.whatsapp) { try { await enviarWhatsApp(m.whatsapp, msg); } catch(e) { console.error('Erro freq wpp:', e.message); } }

      if (m.email) {
        const html = '<!DOCTYPE html><html><body style="font-family:Arial;background:#f4f4f4;padding:20px">'
          + '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden">'
          + (orgLogo ? '<div style="background:#1a56db;padding:20px;text-align:center"><img src="' + orgLogo + '" style="max-height:70px"></div>'
                     : '<div style="background:#1a56db;padding:20px"><h1 style="color:white;margin:0">' + orgNome + '</h1></div>')
          + '<div style="padding:28px"><h2>📊 Frequência — ' + turma.nome + '</h2>'
          + '<p>Olá, <strong>' + m.nome.split(' ')[0] + '</strong>!</p>'
          + '<table style="width:100%;border-collapse:collapse;margin:16px 0">'
          + '<tr style="background:#f4f4f4"><td style="padding:10px;border:1px solid #e5e7eb">Atividades realizadas</td><td style="padding:10px;border:1px solid #e5e7eb;text-align:center"><strong>' + m.total_atividades + '</strong></td></tr>'
          + '<tr><td style="padding:10px;border:1px solid #e5e7eb">✅ Presenças</td><td style="padding:10px;border:1px solid #e5e7eb;text-align:center;color:#22c55e;font-weight:bold">' + m.presencas + '</td></tr>'
          + '<tr style="background:#f4f4f4"><td style="padding:10px;border:1px solid #e5e7eb">❌ Faltas</td><td style="padding:10px;border:1px solid #e5e7eb;text-align:center;color:#ef4444;font-weight:bold">' + faltas + '</td></tr>'
          + '<tr><td style="padding:10px;border:1px solid #e5e7eb">📈 Frequência</td><td style="padding:10px;border:1px solid #e5e7eb;text-align:center"><strong>' + pct + '%</strong></td></tr>'
          + '<tr style="background:#f4f4f4"><td style="padding:10px;border:1px solid #e5e7eb">🎓 Status</td><td style="padding:10px;border:1px solid #e5e7eb;text-align:center;color:' + (pct>=75?'#22c55e':pct>=50?'#f59e0b':'#ef4444') + ';font-weight:bold">' + status + '</td></tr>'
          + '</table><p style="color:#666;font-size:13px">Mínimo de 75% de presença para o certificado de 1 ano.</p></div></div></body></html>';
        try { await enviarEmail({ para: m.email, assunto: 'Relatório de Frequência — ' + turma.nome, html, texto: msg }); } catch(e) {}
      }

      await new Promise(res => setTimeout(res, 1500));
    }
    console.log('Frequencia enviada para turma:', turma.nome);
  }
}

module.exports = { iniciarAgendamentos, gerarCobrancasMes, verificarPagamentos, logNotificacao, enviarFrequenciaMensal };
