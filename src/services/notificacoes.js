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

async function enviarWhatsApp(numero, mensagem) {
  const token = process.env.ZAPAPI_TOKEN;
  const instanceId = process.env.ZAPAPI_INSTANCE;
  if (!token || !instanceId) { console.warn('W-API nao configurada'); return { ok: false }; }
  const fone = formatarNumero(numero);
  console.log('W-API enviando para ' + fone);
  try {
    const { data, status } = await axios.post(
      'https://api.w-api.app/v1/message/send-text?instanceId=' + instanceId,
      { phone: fone, message: mensagem, instanceId: instanceId, delayMessage: 1 },
      { headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    console.log('WhatsApp OK ' + status);
    return { ok: true, data };
  } catch (err) {
    console.error('W-API ERRO: ' + (err.response ? err.response.status : err.message));
    return { ok: false };
  }
}

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
  const linkCartao = opts.linkCartao || null;
  const pixCode = opts.pixCode || null;
  const pixBase64 = opts.pixBase64 || null;
  const orgNome = opts.orgNome || 'Liga Academica de Urologia';
  const orgCor = opts.orgCor || '#1a56db';
  const orgLogo = opts.orgLogo || null;

  const cabecalho = orgLogo
    ? '<div style="background:' + orgCor + ';padding:20px 32px;text-align:center">'
      + '<img src="' + orgLogo + '" alt="' + orgNome + '" style="max-height:70px;max-width:200px;object-fit:contain;display:inline-block">'
      + '</div>'
    : '<div style="background:' + orgCor + ';padding:24px 32px">'
      + '<h1 style="color:white;margin:0;font-size:20px;font-family:Arial,sans-serif">' + orgNome + '</h1>'
      + '</div>';

  // Secao PIX com QR Code e copia e cola
  const secaoPix = pixCode
    ? '<div style="background:#f0faf0;border:2px solid #22c55e;border-radius:8px;padding:20px;margin:16px 0;text-align:center">'
      + '<p style="margin:0 0 12px;font-weight:bold;color:#166534;font-size:15px">💚 Pagar com PIX</p>'
      + (pixBase64
        ? '<img src="data:image/png;base64,' + pixBase64 + '" alt="QR Code PIX" style="width:180px;height:180px;border:2px solid #22c55e;border-radius:8px;margin:0 auto 12px;display:block">'
        : '')
      + '<p style="margin:0 0 6px;font-size:12px;color:#166534;font-weight:600">📋 Pix Copia e Cola:</p>'
      + '<div style="background:#dcfce7;border:1px solid #86efac;border-radius:6px;padding:10px;margin:0 0 8px;font-size:10px;word-break:break-all;font-family:monospace;color:#166534;text-align:left">' + pixCode + '</div>'
      + '<p style="margin:0;font-size:11px;color:#166534">Abra seu banco → Pix → Copia e Cola → cole o código acima</p>'
      + '</div>'
    : '';

  // Secao cartão de crédito
  const secaoCartao = linkCartao
    ? '<div style="background:#eff6ff;border:2px solid #3b82f6;border-radius:8px;padding:20px;margin:16px 0;text-align:center">'
      + '<p style="margin:0 0 12px;font-weight:bold;color:#1e40af;font-size:15px">💳 Pagar com Cartão de Crédito</p>'
      + '<p style="margin:0 0 12px;font-size:12px;color:#1e40af">Clique no botão abaixo para pagar com cartão</p>'
      + '<a href="' + linkCartao + '" style="display:inline-block;background:#1e40af;color:white;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px">💳 Pagar com cartão</a>'
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
    + secaoCartao
    + '</div>'
    + '<div style="padding:14px 32px;border-top:1px solid #e5e7eb;background:#f9fafb;text-align:center">'
    + '<p style="color:#9ca3af;font-size:12px;margin:0">Mensagem automática — ' + orgNome + '</p>'
    + '</div>'
    + '</div></body></html>';
}

function montarMensagemWhatsapp(tipo, dados, orgNome, pixCode, linkCartao) {
  const cabecalho = '*' + orgNome + '* 🏥\n\n';

  // Secao PIX
  const secaoPix = pixCode
    ? '━━━━━━━━━━━━━━━━━━━━\n'
      + '💚 *PAGAR COM PIX*\n'
      + '━━━━━━━━━━━━━━━━━━━━\n'
      + '📋 *Pix Copia e Cola:*\n'
      + pixCode + '\n\n'
      + '👆 Copie o código acima e cole no seu banco em:\nPix → Pix Copia e Cola\n\n'
    : '';

  // Secao cartão
  const secaoCartao = linkCartao
    ? '━━━━━━━━━━━━━━━━━━━━\n'
      + '💳 *PAGAR COM CARTÃO*\n'
      + '━━━━━━━━━━━━━━━━━━━━\n'
      + '🔗 Acesse o link abaixo:\n'
      + linkCartao + '\n\n'
    : '';

  const templates = {
    pre: cabecalho
      + 'Olá, *' + dados.nome + '*! 👋\n\n'
      + '⚠️ Sua mensalidade vence em *' + dados.dias + ' dias* (' + dados.data + ').\n\n'
      + '💰 Valor com desconto: *' + dados.valor_desc + '*\n'
      + '(Após o vencimento: ' + dados.valor_cheio + ')\n\n'
      + secaoPix
      + secaoCartao
      + 'Qualquer dúvida, estamos à disposição! 😊',

    dia: cabecalho
      + 'Olá, *' + dados.nome + '*! 👋\n\n'
      + '⏰ *HOJE* é o último dia para pagar com desconto!\n\n'
      + '💰 Valor com desconto: *' + dados.valor_desc + '*\n'
      + '(Após hoje: ' + dados.valor_cheio + ')\n\n'
      + secaoPix
      + secaoCartao
      + 'Não perca o desconto! 🙏',

    pos: cabecalho
      + 'Olá, *' + dados.nome + '*!\n\n'
      + '❗ Sua mensalidade está *em atraso* desde ' + dados.data + '.\n\n'
      + '💰 Valor: *' + dados.valor_cheio + '*\n\n'
      + secaoPix
      + secaoCartao
      + 'Por favor, regularize sua situação. 🙏'
  };

  return templates[tipo] || '';
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

async function notificarCobranca(opts) {
  const membro = opts.membro;
  const cobranca = opts.cobranca;
  const tipo = opts.tipo;
  const config = opts.config || await getConfig();

  const orgNome = config.org_nome || 'Liga Academica de Urologia';
  const orgCor = config.org_cor || '#1a56db';
  const orgLogo = config.org_logo || null;

  // Pega PIX e link cartão das colunas corretas do MP
  const pixCode = cobranca.pix_qr_code || cobranca.pix_text || null;
  const pixBase64 = cobranca.pix_qr_code_base64 || null;
  const linkCartao = cobranca.pagbank_link || null;

  const venc = new Date(cobranca.data_vencimento + 'T12:00:00');
  const diffDias = Math.ceil((venc - new Date()) / (1000 * 60 * 60 * 24));

  const dados = {
    nome: membro.nome.split(' ')[0],
    dias: Math.abs(diffDias),
    data: venc.toLocaleDateString('pt-BR'),
    valor_desc: 'R$ ' + Number(cobranca.valor_desconto).toFixed(2).replace('.', ','),
    valor_cheio: 'R$ ' + Number(cobranca.valor_cheio).toFixed(2).replace('.', ','),
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

  const msgsWpp = montarMensagensWhatsapp(tipo, dados, orgNome, pixCode, linkCartao);
  const msgHtml = htmlCobranca({
    titulo: tituloMap[tipo] || '',
    mensagem: 'Prezado(a) ' + dados.nome + ', segue abaixo as opções para pagamento da sua mensalidade.',
    linkCartao, pixCode, pixBase64,
    orgNome, orgCor, orgLogo
  });

  if (membro.whatsapp) {
    let wppOk = false;
    for (const msg of msgsWpp) {
      if (!msg) continue;
      const r = await enviarWhatsApp(membro.whatsapp, msg);
      if (r.ok) wppOk = true;
      await new Promise(res => setTimeout(res, 1500)); // aguarda 1.5s entre mensagens
    }
    await query('INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, cobranca.id, tipo, 'whatsapp', wppOk ? 'ok' : 'erro']);
  }
  if (membro.email) {
    const r = await enviarEmail({ para: membro.email, assunto: assuntoMap[tipo] || '', html: msgHtml, texto: msgsWpp.join('

') });
    await query('INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, cobranca.id, tipo, 'email', r.ok ? 'ok' : 'erro']);
  }
}

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
      linkCartao: null, pixCode: null, pixBase64: null,
      orgNome, orgCor, orgLogo
    });
    const r = await enviarEmail({
      para: membro.email,
      assunto: 'Feliz Aniversário, ' + membro.nome.split(' ')[0] + '! 🎉 — ' + orgNome,
      html, texto: msgWpp
    });
    await query('INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, null, 'aniversario', 'email', r.ok ? 'ok' : 'erro']);
  }
}

module.exports = { enviarWhatsApp, enviarEmail, notificarCobranca, notificarAniversario };
