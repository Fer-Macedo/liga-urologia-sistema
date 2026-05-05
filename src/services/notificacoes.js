const axios = require('axios');
const nodemailer = require('nodemailer');
const { query } = require('../models/database');
require('dotenv').config();

function formatarNumero(numero) {
  const d = numero.replace(/\D/g, '');
  if (d.length > 11) return d;
  if (d.length >= 10) return '55' + d;
  return d;
}

// ─── WhatsApp via W-API ───────────────────────────────────────────────────────

async function enviarWhatsApp(numero, mensagem) {
  const token = process.env.ZAPAPI_TOKEN;
  const instanceId = process.env.ZAPAPI_INSTANCE;
  if (!token || !instanceId) { console.warn('W-API nao configurada'); return { ok: false }; }
  const fone = formatarNumero(numero);
  console.log('W-API enviando para ' + fone + ' instancia ' + instanceId);
  try {
    const { data, status } = await axios.post(
      'https://api.w-api.app/v1/message/send-text?instanceId=' + instanceId,
      { phone: fone, message: mensagem, instanceId: instanceId, delayMessage: 1 },
      { headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    console.log('WhatsApp OK ' + status + ': ' + JSON.stringify(data).substring(0, 100));
    return { ok: true, data };
  } catch (err) {
    console.error('W-API ERRO: ' + (err.response ? err.response.status : err.message));
    return { ok: false };
  }
}

// ─── E-mail ───────────────────────────────────────────────────────────────────

async function enviarEmail(opts) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return { ok: false };
  try {
    const t = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 587, secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      connectionTimeout: 15000, tls: { rejectUnauthorized: false }
    });
    await t.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: opts.para, subject: opts.assunto,
      text: opts.texto || '', html: opts.html || ''
    });
    console.log('Email enviado para ' + opts.para);
    return { ok: true };
  } catch (err) {
    console.error('Email erro: ' + err.message);
    return { ok: false };
  }
}

// ─── Template HTML com Logo ───────────────────────────────────────────────────

async function getConfig() {
  try {
    const r = await query('SELECT chave, valor FROM configuracoes');
    const cfg = {};
    r.rows.forEach(function(row) { cfg[row.chave] = row.valor; });
    return cfg;
  } catch(e) { return {}; }
}

function htmlCobranca(opts) {
  const titulo = opts.titulo || '';
  const mensagem = opts.mensagem || '';
  const link = opts.link || null;
  const pixText = opts.pixText || null;
  const orgNome = opts.orgNome || 'Liga Academica de Urologia';
  const orgCor = opts.orgCor || '#1a56db';
  const orgLogo = opts.orgLogo || null;

  // Cabecalho com logo ou nome
  const cabecalho = orgLogo
    ? '<div style="background:' + orgCor + ';padding:20px 32px;text-align:center">'
      + '<img src="' + orgLogo + '" alt="' + orgNome + '" style="max-height:70px;max-width:200px;object-fit:contain;display:inline-block">'
      + '</div>'
    : '<div style="background:' + orgCor + ';padding:24px 32px">'
      + '<h1 style="color:white;margin:0;font-size:20px;font-family:Arial,sans-serif">' + orgNome + '</h1>'
      + '</div>';

  const botaoPagar = link
    ? '<div style="text-align:center;margin:20px 0">'
      + '<a href="' + link + '" style="display:inline-block;background:' + orgCor + ';color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:16px">💳 Pagar agora</a>'
      + '</div>'
    : '';

  const secaoPix = pixText
    ? '<div style="background:#f0faf0;border:2px solid #22c55e;border-radius:8px;padding:16px;margin:16px 0">'
      + '<p style="margin:0 0 8px;font-weight:bold;color:#166534;font-size:14px">📋 Pix Copia e Cola:</p>'
      + '<p style="margin:0 0 10px;font-size:11px;color:#166534;word-break:break-all;font-family:monospace;background:#dcfce7;padding:8px;border-radius:4px">' + pixText + '</p>'
      + '<p style="margin:0;font-size:12px;color:#166534">Abra seu banco → Pix → Copia e Cola → cole o código acima</p>'
      + '</div>'
    : '';

  const secaoQR = link && link.includes('qrcode')
    ? '<div style="text-align:center;margin:16px 0">'
      + '<p style="color:#374151;font-size:13px;margin-bottom:8px">📱 Ou escaneie o QR Code:</p>'
      + '<img src="' + link + '" alt="QR Code PIX" style="width:180px;height:180px;border:2px solid #e5e7eb;border-radius:8px">'
      + '</div>'
    : '';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
    + '<body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px">'
    + '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1)">'
    + cabecalho
    + '<div style="padding:28px 32px">'
    + '<h2 style="margin:0 0 12px;color:#111827;font-size:18px">' + titulo + '</h2>'
    + '<p style="color:#374151;line-height:1.6;margin:0 0 16px">' + mensagem + '</p>'
    + secaoPix
    + secaoQR
    + botaoPagar
    + '</div>'
    + '<div style="padding:14px 32px;border-top:1px solid #e5e7eb;background:#f9fafb;text-align:center">'
    + '<p style="color:#9ca3af;font-size:12px;margin:0">Mensagem automática — ' + orgNome + '</p>'
    + '</div>'
    + '</div></body></html>';
}

function preencherTemplate(tpl, dados) {
  return (tpl || '')
    .replace(/{nome}/g, dados.nome || '')
    .replace(/{dias}/g, dados.dias || '')
    .replace(/{data}/g, dados.data || '')
    .replace(/{valor_desc}/g, dados.valor_desc || '')
    .replace(/{valor_cheio}/g, dados.valor_cheio || '')
    .replace(/{link}/g, dados.link || '');
}

function montarMensagemWhatsapp(tipo, dados, orgNome, pixText) {
  const cabecalho = '*' + orgNome + '* 🏥\n\n';

  const templates = {
    pre: cabecalho
      + 'Olá, *' + dados.nome + '*! 👋\n\n'
      + '⚠️ Sua mensalidade vence em *' + dados.dias + ' dias* (' + dados.data + ').\n\n'
      + '💰 Valor com desconto: *' + dados.valor_desc + '*\n'
      + '(Após o vencimento: ' + dados.valor_cheio + ')\n\n'
      + (pixText ? '📋 *Pix Copia e Cola:*\n`' + pixText + '`\n\n' : '')
      + (dados.link ? '🔗 *Link de pagamento:*\n' + dados.link + '\n\n' : '')
      + 'Qualquer dúvida, estamos à disposição! 😊',

    dia: cabecalho
      + 'Olá, *' + dados.nome + '*! 👋\n\n'
      + '⏰ *HOJE* é o último dia para pagar com desconto!\n\n'
      + '💰 Valor com desconto: *' + dados.valor_desc + '*\n'
      + '(Após hoje: ' + dados.valor_cheio + ')\n\n'
      + (pixText ? '📋 *Pix Copia e Cola:*\n`' + pixText + '`\n\n' : '')
      + (dados.link ? '🔗 *Link de pagamento:*\n' + dados.link + '\n\n' : '')
      + 'Não perca o desconto! 🙏',

    pos: cabecalho
      + 'Olá, *' + dados.nome + '*!\n\n'
      + '❗ Sua mensalidade está *em atraso* desde ' + dados.data + '.\n\n'
      + '💰 Valor: *' + dados.valor_cheio + '*\n\n'
      + (pixText ? '📋 *Pix Copia e Cola:*\n`' + pixText + '`\n\n' : '')
      + (dados.link ? '🔗 *Link de pagamento:*\n' + dados.link + '\n\n' : '')
      + 'Por favor, regularize sua situação. 🙏'
  };

  return templates[tipo] || '';
}

// ─── Notificação de cobrança ──────────────────────────────────────────────────

async function notificarCobranca(opts) {
  const membro = opts.membro;
  const cobranca = opts.cobranca;
  const tipo = opts.tipo;
  const config = opts.config || await getConfig();

  const orgNome = config.org_nome || 'Liga Academica de Urologia';
  const orgCor = config.org_cor || '#1a56db';
  const orgLogo = config.org_logo || null;
  const link = cobranca.pagbank_link || null;
  const pixText = cobranca.pix_text || null;

  const venc = new Date(cobranca.data_vencimento + 'T12:00:00');
  const diffDias = Math.ceil((venc - new Date()) / (1000 * 60 * 60 * 24));

  const dados = {
    nome: membro.nome.split(' ')[0],
    dias: Math.abs(diffDias),
    data: venc.toLocaleDateString('pt-BR'),
    valor_desc: 'R$ ' + Number(cobranca.valor_desconto).toFixed(2).replace('.', ','),
    valor_cheio: 'R$ ' + Number(cobranca.valor_cheio).toFixed(2).replace('.', ','),
    link: link || ''
  };

  const assuntoMap = {
    pre: 'Lembrete: mensalidade vence em ' + dados.dias + ' dias — ' + orgNome,
    dia: 'HOJE: último dia com desconto! — ' + orgNome,
    pos: 'Mensalidade em atraso — ' + orgNome
  };
  const tituloMap = {
    pre: 'Sua mensalidade vence em ' + dados.dias + ' dias!',
    dia: 'Hoje é o último dia com desconto!',
    pos: 'Mensalidade em atraso'
  };

  const msgWpp = montarMensagemWhatsapp(tipo, dados, orgNome, pixText);
  const msgHtml = htmlCobranca({
    titulo: tituloMap[tipo] || '',
    mensagem: 'Prezado(a) ' + dados.nome + ', segue abaixo as informações para pagamento da sua mensalidade.',
    link: link,
    pixText: pixText,
    orgNome: orgNome,
    orgCor: orgCor,
    orgLogo: orgLogo
  });

  if (membro.whatsapp) {
    const r = await enviarWhatsApp(membro.whatsapp, msgWpp);
    await query('INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, cobranca.id, tipo, 'whatsapp', r.ok ? 'ok' : 'erro']);
  }
  if (membro.email) {
    const r = await enviarEmail({ para: membro.email, assunto: assuntoMap[tipo] || '', html: msgHtml, texto: msgWpp });
    await query('INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, cobranca.id, tipo, 'email', r.ok ? 'ok' : 'erro']);
  }
}

// ─── Notificação de aniversário ───────────────────────────────────────────────

async function notificarAniversario(opts) {
  const membro = opts.membro;
  const config = opts.config || await getConfig();
  const orgNome = config.org_nome || 'Liga Academica de Urologia';
  const orgCor = config.org_cor || '#1a56db';
  const orgLogo = config.org_logo || null;
  const tpl = config.msg_aniversario || 'Parabens pelo seu aniversario, {nome}! 🎉';
  const msg = preencherTemplate(tpl, { nome: membro.nome.split(' ')[0] });

  const msgWpp = '🎂 *' + orgNome + '*\n\n'
    + 'Olá, *' + membro.nome.split(' ')[0] + '*!\n\n'
    + msg + '\n\nCom carinho de toda a equipe! 💙';

  if (membro.whatsapp) {
    const r = await enviarWhatsApp(membro.whatsapp, msgWpp);
    await query('INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, null, 'aniversario', 'whatsapp', r.ok ? 'ok' : 'erro']);
  }
  if (membro.email) {
    const html = htmlCobranca({
      titulo: '🎂 Feliz Aniversário, ' + membro.nome.split(' ')[0] + '!',
      mensagem: msg,
      link: null, pixText: null,
      orgNome: orgNome, orgCor: orgCor, orgLogo: orgLogo
    });
    const r = await enviarEmail({
      para: membro.email,
      assunto: 'Feliz Aniversário, ' + membro.nome.split(' ')[0] + '! 🎉 — ' + orgNome,
      html: html, texto: msgWpp
    });
    await query('INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, null, 'aniversario', 'email', r.ok ? 'ok' : 'erro']);
  }
}

module.exports = { enviarWhatsApp, enviarEmail, notificarCobranca, notificarAniversario };
