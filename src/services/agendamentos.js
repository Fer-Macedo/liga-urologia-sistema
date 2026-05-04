const cron = require('node-cron');
const dayjs = require('dayjs');
const { query } = require('../models/database');
const { criarCobranca } = require('./pagbank');
const { notificarCobranca, notificarAniversario } = require('./notificacoes');

async function getConfig() {
  const r = await query('SELECT chave, valor FROM configuracoes');
  const cfg = {};
  r.rows.forEach(function(row) { cfg[row.chave] = row.valor; });
  return cfg;
}

async function gerarCobrancasMes() {
  const hoje = dayjs();
  const mes = hoje.format('YYYY-MM');
  const membros = await query('SELECT * FROM membros WHERE ativo = 1');
  const config = await getConfig();

  for (const membro of membros.rows) {
    const ref = membro.id + '-' + mes;

    // Verifica se cobrança já existe
    const existe = await query('SELECT id FROM cobrancas WHERE referencia = $1', [ref]);
    if (existe.rows.length > 0) {
      console.log('Cobranca ja existe para ' + membro.nome + ' - ' + ref);
      continue;
    }

    const diaVenc = membro.dia_vencimento || parseInt(config.dia_vencimento_padrao) || 5;
    const dataVenc = hoje.date(diaVenc).format('YYYY-MM-DD');
    const valorCheio = membro.mensalidade;
    const descPct = membro.desconto_pontualidade || parseFloat(config.desconto_padrao) || 10;
    const valorDesc = parseFloat((valorCheio * (1 - descPct / 100)).toFixed(2));

    console.log('Gerando cobranca para ' + membro.nome + ' valor R$' + valorDesc + ' venc ' + dataVenc);

    // Cria cobrança no PagBank
    const pagResult = await criarCobranca({
      membro: membro,
      valor: valorDesc,
      vencimento: dataVenc,
      referencia: ref
    });

    if (pagResult.ok) {
      console.log('PagBank OK - link: ' + pagResult.link);
    } else {
      console.warn('PagBank falhou para ' + membro.nome + ' - cobranca criada sem link');
    }

    await query(
      'INSERT INTO cobrancas (membro_id, referencia, valor_cheio, valor_desconto, data_vencimento, status, pagbank_charge_id, pagbank_link) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        membro.id,
        ref,
        valorCheio,
        valorDesc,
        dataVenc,
        'pendente',
        pagResult.charge_id || null,
        pagResult.link || null
      ]
    );

    console.log('Cobranca salva: ' + membro.nome + ' - ' + ref + ' link: ' + (pagResult.link ? 'SIM' : 'NAO'));
  }
}

async function verificarPagamentos() {
  const { consultarCobranca } = require('./pagbank');
  const r = await query("SELECT * FROM cobrancas WHERE status='pendente' AND pagbank_charge_id IS NOT NULL");
  for (const cob of r.rows) {
    const result = await consultarCobranca(cob.pagbank_charge_id);
    if (result.ok && result.status === 'PAID') {
      await query("UPDATE cobrancas SET status='pago', data_pagamento=NOW() WHERE id=$1", [cob.id]);
      console.log('Pagamento confirmado cobranca id ' + cob.id);
    }
  }
}

async function atualizarAtrasados() {
  const hoje = dayjs().format('YYYY-MM-DD');
  const r = await query(
    "UPDATE cobrancas SET status='atrasado' WHERE status='pendente' AND data_vencimento < $1",
    [hoje]
  );
  if (r.rowCount > 0) {
    console.log(r.rowCount + ' cobrancas marcadas como atrasadas');
  }
}

async function enviarNotificacoes() {
  const config = await getConfig();
  const hoje = dayjs();

  // 3 dias antes do vencimento
  if (config.notif_pre_ativo === '1') {
    const em3 = hoje.add(3, 'day').format('YYYY-MM-DD');
    const r = await query(
      "SELECT c.*, m.nome, m.email, m.whatsapp FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.data_vencimento=$1 AND c.status='pendente'",
      [em3]
    );
    for (const cob of r.rows) {
      const j = await query("SELECT id FROM notificacoes_log WHERE cobranca_id=$1 AND tipo='pre'", [cob.id]);
      if (j.rows.length === 0) {
        await notificarCobranca({ membro: cob, cobranca: cob, tipo: 'pre', config });
        console.log('Notif PRE enviada: ' + cob.nome);
      }
    }
  }

  // No dia do vencimento
  if (config.notif_dia_ativo === '1') {
    const hj = hoje.format('YYYY-MM-DD');
    const r = await query(
      "SELECT c.*, m.nome, m.email, m.whatsapp FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.data_vencimento=$1 AND c.status='pendente'",
      [hj]
    );
    for (const cob of r.rows) {
      const j = await query("SELECT id FROM notificacoes_log WHERE cobranca_id=$1 AND tipo='dia'", [cob.id]);
      if (j.rows.length === 0) {
        await notificarCobranca({ membro: cob, cobranca: cob, tipo: 'dia', config });
        console.log('Notif DIA enviada: ' + cob.nome);
      }
    }
  }

  // 1 dia apos vencimento
  if (config.notif_pos1_ativo === '1') {
    const ontem = hoje.subtract(1, 'day').format('YYYY-MM-DD');
    const r = await query(
      "SELECT c.*, m.nome, m.email, m.whatsapp FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.data_vencimento=$1 AND c.status IN ('pendente','atrasado')",
      [ontem]
    );
    for (const cob of r.rows) {
      const j = await query(
        "SELECT id FROM notificacoes_log WHERE cobranca_id=$1 AND tipo='pos' AND enviado_em > NOW() - INTERVAL '2 days'",
        [cob.id]
      );
      if (j.rows.length === 0) {
        await notificarCobranca({ membro: cob, cobranca: cob, tipo: 'pos', config });
      }
    }
  }

  // 7 dias apos vencimento
  if (config.notif_pos7_ativo === '1') {
    const ha7 = hoje.subtract(7, 'day').format('YYYY-MM-DD');
    const r = await query(
      "SELECT c.*, m.nome, m.email, m.whatsapp FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.data_vencimento=$1 AND c.status='atrasado'",
      [ha7]
    );
    for (const cob of r.rows) {
      const j = await query(
        "SELECT id FROM notificacoes_log WHERE cobranca_id=$1 AND tipo='pos' AND enviado_em > NOW() - INTERVAL '8 days'",
        [cob.id]
      );
      if (j.rows.length === 0) {
        await notificarCobranca({ membro: cob, cobranca: cob, tipo: 'pos', config });
      }
    }
  }
}

async function enviarAniversarios() {
  const config = await getConfig();
  if (config.notif_aniversario_ativo !== '1') return;

  const hoje = dayjs();
  const md = hoje.format('MM-DD');

  const r = await query(
    "SELECT * FROM membros WHERE ativo=1 AND data_nascimento IS NOT NULL AND TO_CHAR(data_nascimento::date,'MM-DD')=$1",
    [md]
  );

  for (const membro of r.rows) {
    const j = await query(
      "SELECT id FROM notificacoes_log WHERE membro_id=$1 AND tipo='aniversario' AND enviado_em >= CURRENT_DATE",
      [membro.id]
    );
    if (j.rows.length === 0) {
      await notificarAniversario({ membro, config });
      console.log('Parabens enviado: ' + membro.nome);
    }
  }
}

function iniciarAgendamentos() {
  console.log('Agendamentos automaticos iniciados...');

  // Todo dia as 08:00 horario de Brasilia
  cron.schedule('0 8 * * *', async function() {
    console.log('Rotina diaria iniciando...');
    try {
      await gerarCobrancasMes();
      await atualizarAtrasados();
      await verificarPagamentos();
      await enviarNotificacoes();
      await enviarAniversarios();
    } catch (e) {
      console.error('Rotina diaria erro:', e.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // A cada 2 horas verifica pagamentos
  cron.schedule('0 */2 * * *', async function() {
    try { await verificarPagamentos(); } catch (e) { console.error(e.message); }
  });
}

module.exports = { iniciarAgendamentos, gerarCobrancasMes, verificarPagamentos };
