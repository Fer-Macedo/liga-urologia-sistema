const cron = require('node-cron');
const dayjs = require('dayjs');
const { query } = require('../models/database');
const { criarCobranca } = require('./pagbank');
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
  const membros = await query('SELECT * FROM membros WHERE ativo = 1');
  const config = await getConfig();

  for (const membro of membros.rows) {
    const ref = `${membro.id}-${mes}`;
    const existe = await query('SELECT id FROM cobrancas WHERE referencia = $1', [ref]);
    if (existe.rows.length > 0) continue;

    const diaVenc = membro.dia_vencimento || parseInt(config.dia_vencimento_padrao) || 5;
    const dataVenc = hoje.date(diaVenc).format('YYYY-MM-DD');
    const valorCheio = membro.mensalidade;
    const descPct = membro.desconto_pontualidade || parseFloat(config.desconto_padrao) || 10;
    const valorDesc = +(valorCheio * (1 - descPct / 100)).toFixed(2);

    const pagResult = await criarCobranca({ membro, valor: valorDesc, vencimento: dataVenc, referencia: ref });

    await query(
      'INSERT INTO cobrancas (membro_id,referencia,valor_cheio,valor_desconto,data_vencimento,status,pagbank_charge_id,pagbank_link) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [membro.id, ref, valorCheio, valorDesc, dataVenc, 'pendente', pagResult.charge_id||null, pagResult.link||null]
    );
    console.log(`✅ Cobrança gerada: ${membro.nome} - ${ref}`);
  }
}

async function verificarPagamentos() {
  const { consultarCobranca } = require('./pagbank');
  const r = await query("SELECT * FROM cobrancas WHERE status='pendente' AND pagbank_charge_id IS NOT NULL");
  for (const cob of r.rows) {
    const result = await consultarCobranca(cob.pagbank_charge_id);
    if (result.ok && result.status === 'PAID') {
      await query("UPDATE cobrancas SET status='pago', data_pagamento=NOW() WHERE id=$1", [cob.id]);
      console.log(`💰 Pagamento confirmado: ${cob.id}`);
    }
  }
}

async function atualizarAtrasados() {
  const hoje = dayjs().format('YYYY-MM-DD');
  const r = await query("UPDATE cobrancas SET status='atrasado' WHERE status='pendente' AND data_vencimento < $1", [hoje]);
  if (r.rowCount > 0) console.log(`⚠️  ${r.rowCount} cobranças marcadas como atrasadas`);
}

async function enviarNotificacoes() {
  const config = await getConfig();
  const hoje = dayjs();

  if (config.notif_pre_ativo === '1') {
    const em3 = hoje.add(3,'day').format('YYYY-MM-DD');
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
    const ontem = hoje.subtract(1,'day').format('YYYY-MM-DD');
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

  if (config.notif_pos7_ativo === '1') {
    const ha7 = hoje.subtract(7,'day').format('YYYY-MM-DD');
    const r = await query(
      "SELECT c.*, m.nome, m.email, m.whatsapp FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.data_vencimento=$1 AND c.status='atrasado'", [ha7]
    );
    for (const cob of r.rows) {
      const j = await query(
        "SELECT id FROM notificacoes_log WHERE cobranca_id=$1 AND tipo='pos' AND enviado_em > NOW() - INTERVAL '8 days'", [cob.id]
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
      console.log(`🎂 Parabéns enviado: ${membro.nome}`);
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
  console.log('⏰ Agendamentos automáticos iniciados...');
  cron.schedule('0 8 * * *', async () => {
    console.log('🔄 Rotina diária...');
    try {
      await gerarCobrancasMes();
      await atualizarAtrasados();
      await verificarPagamentos();
      await enviarNotificacoes();
      await enviarAniversarios();
    } catch (e) { console.error('Rotina diária erro:', e.message); }
  }, { timezone: 'America/Sao_Paulo' });

  cron.schedule('0 */2 * * *', async () => {
    try { await verificarPagamentos(); } catch (e) {}
  });
}

module.exports = { iniciarAgendamentos, gerarCobrancasMes, verificarPagamentos, logNotificacao };
