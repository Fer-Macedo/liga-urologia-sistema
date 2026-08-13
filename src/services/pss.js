// ═══ PROCESSO SELETIVO (PSS) — REGRAS DE NEGÓCIO ═════════════════════════════
// Confirmação de inscrição e e-mails do PSS. Fica aqui (e não junto das rotas) porque
// o webhook do PagBank, que vive em routes/index.js, também precisa confirmar inscrição
// quando o pagamento cai. Rotas: routes/processo-seletivo.js
const { query } = require('../models/database');
const { enviarEmail } = require('./notificacoes');
const { lancarPssNoFluxo } = require('./fluxo-pss');

// Check-in de presença: mesmo padrão já usado em eventos.js (evento_inscricoes.qrcode +
// api.qrserver.com, sem lib nova), mas com múltiplas ocasiões por candidato (ps_checkins)
// em vez de 1 checkin_em só, porque o PSS tem vários dias de presença (aula magna, prova...).
const OCASIOES_PSS = { aula_magna: 'Aula Magna', prova: 'Prueba', entrevista: 'Entrevista' };

async function _garantirQrcodePss(c) {
  if (c.qrcode) return c.qrcode;
  const qrcode = 'PSS-' + c.processo_id + '-' + c.id + '-' + Date.now();
  await query("UPDATE ps_candidatos SET qrcode=$2 WHERE id=$1", [c.id, qrcode]);
  return qrcode;
}

async function listarCandidatosCheckin(processoId) {
  const r = await query(
    `SELECT c.id, c.nome, c.email, c.numero_lista, c.qrcode,
       COALESCE(json_agg(k.ocasiao) FILTER (WHERE k.id IS NOT NULL), '[]') AS ocasioes_feitas
     FROM ps_candidatos c
     LEFT JOIN ps_checkins k ON k.candidato_id=c.id
     WHERE c.processo_id=$1 AND c.pagamento_status='confirmado'
     GROUP BY c.id ORDER BY c.numero_lista`,
    [processoId]
  );
  return r.rows;
}

async function buscarCandidatoCheckin(processoId, termo) {
  const t = '%' + String(termo || '').toLowerCase() + '%';
  const r = await query(
    `SELECT c.id, c.nome, c.numero_lista, c.qrcode,
       COALESCE(json_agg(k.ocasiao) FILTER (WHERE k.id IS NOT NULL), '[]') AS ocasioes_feitas
     FROM ps_candidatos c
     LEFT JOIN ps_checkins k ON k.candidato_id=c.id
     WHERE c.processo_id=$1 AND c.pagamento_status='confirmado'
       AND (LOWER(c.nome) LIKE $2 OR c.qrcode=$3 OR CAST(c.numero_lista AS TEXT)=$3)
     GROUP BY c.id LIMIT 1`,
    [processoId, t, String(termo || '')]
  );
  return r.rows[0] || null;
}

// Idempotente (UNIQUE candidato_id+ocasiao): reenviar o mesmo checkin não duplica nem falha.
async function marcarPresencaPss(candidatoId, ocasiao, usuarioId) {
  if (!OCASIOES_PSS[ocasiao]) throw new Error('Ocasião inválida.');
  await query(
    `INSERT INTO ps_checkins (candidato_id, ocasiao, checkin_por) VALUES ($1,$2,$3)
     ON CONFLICT (candidato_id, ocasiao) DO NOTHING`,
    [candidatoId, ocasiao, usuarioId || null]
  );
}

// Próximo número de inscrição (1..999) do processo. ponytail: MAX+1 (sequencial, sem
// reuso). Volume baixo -> corrida de concorrência ignorada; se virar problema, usar lock.
async function _pssProximoNumero(processoId) {
  const m = await query("SELECT COALESCE(MAX(numero_lista),0)+1 AS n FROM ps_candidatos WHERE processo_id=$1", [processoId]);
  return m.rows[0].n;
}
// Confirma a inscrição (pago OU isento), atribui número, lança fluxo e envia e-mail. Idempotente.
async function confirmarInscricaoPss(candidatoId, opts = {}) {
  const c = (await query("SELECT * FROM ps_candidatos WHERE id=$1", [candidatoId])).rows[0];
  if (!c) return;
  if (c.pagamento_status === 'confirmado' && c.numero_lista) return; // já confirmado
  let numero = c.numero_lista || await _pssProximoNumero(c.processo_id);
  await query("UPDATE ps_candidatos SET pagamento_status='confirmado', status='confirmado', numero_lista=$2, valor_pago=COALESCE($3,valor_pago), confirmado_em=NOW() WHERE id=$1",
    [candidatoId, numero, (opts.valorPago != null ? opts.valorPago : null)]);
  if (opts.orderId || opts.metodo) {
    await query("UPDATE ps_pagamentos SET status='pago', pago_em=NOW(), pagbank_order_id=COALESCE($2,pagbank_order_id), metodo=COALESCE($3,metodo) WHERE candidato_id=$1 AND status!='pago'",
      [candidatoId, opts.orderId || null, opts.metodo || null]);
  }
  try {
    const pg = await query("SELECT id FROM ps_pagamentos WHERE candidato_id=$1 AND status='pago' ORDER BY id DESC LIMIT 1", [candidatoId]);
    if (pg.rows[0]) { await lancarPssNoFluxo(query, pg.rows[0].id); }
  } catch (e) { console.error('lancar fluxo pss:', e.message); }
  await enviarEmailConfirmacaoPss(candidatoId);
}
async function enviarEmailConfirmacaoPss(candidatoId) {
  try {
    const c = (await query("SELECT c.*, p.nome AS processo_nome, p.data_prova, p.local_prova FROM ps_candidatos c JOIN ps_processos p ON p.id=c.processo_id WHERE c.id=$1", [candidatoId])).rows[0];
    if (!c || !c.email) return;
    const dataStr = c.data_prova ? new Date(c.data_prova).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
    const num = String(c.numero_lista || '').padStart(3, '0');
    const qrcode = await _garantirQrcodePss(c);
    const corpo = '<p>Estimado/a <strong>' + (c.nome || '').split(' ')[0] + '</strong>,</p><p>Confirmamos su inscripción al proceso selectivo <strong>' + c.processo_nome + '</strong>.</p>'
      + '<div style="text-align:center;margin:20px 0;padding:20px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0"><p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px">Su número de inscripción</p><p style="margin:0;font-size:44px;font-weight:900;color:#1a3d2b;letter-spacing:4px">' + num + '</p><p style="margin:8px 0 0;font-size:12px;color:#94a3b8">Guarde este número. Deberá completarlo en la hoja de respuestas el día del examen.</p></div>'
      + (dataStr ? ('<p><strong>Fecha del examen:</strong> ' + dataStr + (c.local_prova ? (' — ' + c.local_prova) : '') + '</p>') : '')
      + '<div style="text-align:center;margin:20px 0"><p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px">Su código de asistencia</p><img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=' + encodeURIComponent(qrcode) + '" alt="QR Code" style="width:160px;height:160px;border-radius:8px"><p style="margin:8px 0 0;font-size:12px;color:#94a3b8">Presente este código QR en cada día del proceso (aula magna, prueba, entrevista) para registrar su presencia.</p></div>'
      + '<p style="margin-top:16px">Atentamente,<br><strong>Comité Organizador — LAURO</strong></p>';
    await enviarEmail({ para: c.email, assunto: 'Inscripción confirmada — ' + c.processo_nome, titulo: 'Inscripción confirmada', html: corpo, faixaLabel: 'INSCRIPCIÓN CONFIRMADA' });
    await query("UPDATE ps_candidatos SET email_confirmacao_enviado=true WHERE id=$1", [candidatoId]);
  } catch (e) { console.error('enviarEmailConfirmacaoPss ERRO:', e.message); }
}
// Lembrete a quem se inscreveu mas não concluiu o pagamento (oferece ajuda). Mesmo padrão de e-mail.
async function enviarLembretePss(candidatoId) {
  try {
    const c = (await query("SELECT c.*, p.nome AS processo_nome FROM ps_candidatos c JOIN ps_processos p ON p.id=c.processo_id WHERE c.id=$1", [candidatoId])).rows[0];
    if (!c || !c.email || c.pagamento_status === 'confirmado') return false;
    const link = (process.env.INSCRICAO_URL || 'https://inscricao.lauroucpcde.com') + '/pss/pagamento/' + c.id;
    const corpo = '<p>Estimado/a <strong>' + (c.nome || '').split(' ')[0] + '</strong>,</p>'
      + '<p>Notamos que iniciaste tu inscripción al proceso selectivo <strong>' + c.processo_nome + '</strong>, pero el pago aún no fue confirmado.</p>'
      + '<p>Podés concluir tu inscripción de forma rápida en el siguiente enlace:</p>'
      + '<div style="text-align:center;margin:20px 0"><a href="' + link + '" style="display:inline-block;background:#1a3d2b;color:#fff;padding:13px 30px;border-radius:8px;text-decoration:none;font-weight:700">Concluir mi inscripción</a></div>'
      + '<p>Si tuviste algún inconveniente con el pago o necesitás ayuda, respondé este correo y con gusto te asistimos.</p>'
      + '<p style="margin-top:16px">Atentamente,<br><strong>Comité Organizador — LAURO</strong></p>';
    await enviarEmail({ para: c.email, assunto: 'Complete su inscripción — ' + c.processo_nome, titulo: '¿Necesitás ayuda para concluir tu inscripción?', html: corpo, faixaLabel: 'INSCRIPCIÓN PENDIENTE' });
    return true;
  } catch (e) { console.error('enviarLembretePss ERRO:', e.message); return false; }
}
// E-mail de boas-vindas ao selecionado (aprovado na entrevista). Mesma arte unificada.
async function enviarEmailBoasVindasPss(candidatoId) {
  try {
    const c = (await query("SELECT c.*, p.nome AS processo_nome FROM ps_candidatos c JOIN ps_processos p ON p.id=c.processo_id WHERE c.id=$1", [candidatoId])).rows[0];
    if (!c || !c.email) return false;
    const primeiro = (c.nome || '').split(' ')[0];
    const corpo = '<p>Estimado/a <strong>' + primeiro + '</strong>,</p>'
      + '<p>¡Felicitaciones! Nos complace informarte que fuiste <strong>seleccionado/a</strong> para integrar la <strong>Liga Académica de Urología — LAURO</strong>, tras aprobar todas las etapas del proceso selectivo, incluyendo la entrevista.</p>'
      + '<p>A partir de ahora formás parte de nuestra comunidad académica. En breve te contactaremos con los detalles de la <strong>jornada de inducción</strong> y los próximos pasos para el inicio de tu trayectoria como ligante.</p>'
      + '<p>¡Te damos la más cordial bienvenida!</p>'
      + '<p style="margin-top:16px">Atentamente,<br><strong>Dirección — LAURO</strong></p>';
    await enviarEmail({ para: c.email, assunto: '¡Bienvenido/a a la LAURO!', titulo: '¡Felicitaciones! Fuiste seleccionado/a', html: corpo, faixaLabel: 'BIENVENIDO A LA LAURO' });
    await query("UPDATE ps_candidatos SET boas_vindas_enviado=NOW() WHERE id=$1", [candidatoId]);
    return true;
  } catch (e) { console.error('enviarEmailBoasVindasPss ERRO:', e.message); return false; }
}

// ── Página pública de inscrição ──

module.exports = {
  _pssProximoNumero,
  confirmarInscricaoPss,
  enviarEmailConfirmacaoPss,
  enviarLembretePss,
  enviarEmailBoasVindasPss,
  OCASIOES_PSS,
  listarCandidatosCheckin,
  buscarCandidatoCheckin,
  marcarPresencaPss
};
