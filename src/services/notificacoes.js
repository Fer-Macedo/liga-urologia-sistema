const axios = require('axios');
const nodemailer = require('nodemailer');
const { query } = require('../models/database');
require('dotenv').config();
 
// ─── WhatsApp via ZAP-API ────────────────────────────────────────────────────
 
function formatarNumero(numero) {
  const d = numero.replace(/\D/g, '');
  return d.startsWith('55') ? d : '55' + d;
}
 
async function enviarWhatsApp(numero, mensagem) {
  const token = process.env.ZAPAPI_TOKEN;
  const instanceId = process.env.ZAPAPI_INSTANCE;
 
  if (!token || !instanceId) {
    console.warn('ZAP-API não configurada');
    return { ok: false };
  }
 
  const fone = formatarNumero(numero);
 
  // Tenta endpoint v1 principal
  const endpoints = [
    {
      url: `https://zap-api.tech/v1/instances/${instanceId}/messages`,
      body: { to: fone, type: 'text', text: mensagem }
    },
    {
      url: `https://zap-api.tech/v1/instances/${instanceId}/send`,
      body: { phone: fone, type: 'text', body: mensagem }
    },
    {
      url: `https://zap-api.tech/v1/messages`,
      body: { instanceId, to: fone, type: 'text', text: mensagem }
    }
  ];
 
  for (const ep of endpoints) {
    try {
      const { data } = await axios.post(ep.url, ep.body, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });
      console.log(`✅ WhatsApp enviado para ${fone} via ${ep.url}`);
      return { ok: true, data };
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.message || err.message;
      console.warn(`ZAP-API tentativa falhou (${ep.url}): ${status} ${msg}`);
      if (status !== 404 && status !== 405) break;
    }
  }
 
  console.error(`ZAP-API: todos os endpoints falharam para ${fone}`);
  return { ok: false };
}
 
// ─── E-mail ───────────────────────────────────────────────────────────────────
 
async function enviarEmail({ para, assunto, html, texto }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('E-mail não configurado');
    return { ok: false };
  }
 
  // Tenta porta 587 (TLS) e 465 (SSL) como fallback
  const configs = [
    { host: 'smtp.gmail.com', port: 587, secure: false },
    { host: 'smtp.gmail.com', port: 465, secure: true },
    { host: 'smtp.gmail.com', port: 25,  secure: false }
  ];
 
  for (const cfg of configs) {
    try {
      const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        tls: { rejectUnauthorized: false }
      });
 
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: para,
        subject: assunto,
        text: texto || '',
        html: html || ''
      });
 
      console.log(`✅ E-mail enviado para ${para} via porta ${cfg.port}`);
      return { ok: true };
    } catch (err) {
      console.warn(`E-mail porta ${cfg.port} falhou: ${err.message}`);
    }
  }
 
  console.error(`E-mail: todas as portas falharam para ${para}`);
  return { ok: false };
}
 
// ─── Template HTML ────────────────────────────────────────────────────────────
 
function htmlCobranca({ titulo, mensagem, link, orgNome, orgCor }) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:30px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
    <div style="background:${orgCor||'#1a56db'};padding:24px 32px">
      <h1 style="color:white;margin:0;font-size:20px">${orgNome}</h1>
    </div>
    <div style="padding:32px">
      <h2 style="margin:0 0 16px">${titulo}</h2>
      <p style="color:#444;line-height:1.6;margin:0 0 24px">${mensagem}</p>
      ${link ? `<a href="${link}" style="display:inline-block;background:${orgCor||'#1a56db'};color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold">Pagar agora</a>` : ''}
    </div>
    <div style="padding:16px 32px;border-top:1px solid #eee">
      <p style="color:#888;font-size:12px;margin:0">Mensagem automática — ${orgNome}</p>
    </div>
  </div></body></html>`;
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
 
// ─── Notificação de cobrança ──────────────────────────────────────────────────
 
async function notificarCobranca({ membro, cobranca, tipo, config }) {
  const orgNome = config.org_nome || 'Liga Acadêmica de Urologia';
  const orgCor  = config.org_cor  || '#1a56db';
  const link    = cobranca.pagbank_link || '';
 
  const venc = new Date(cobranca.data_vencimento + 'T12:00:00');
  const diffDias = Math.ceil((venc - new Date()) / (1000 * 60 * 60 * 24));
  const dataFmt  = venc.toLocaleDateString('pt-BR');
  const valorDesc  = `R$ ${Number(cobranca.valor_desconto).toFixed(2).replace('.', ',')}`;
  const valorCheio = `R$ ${Number(cobranca.valor_cheio).toFixed(2).replace('.', ',')}`;
 
  const dados = {
    nome: membro.nome.split(' ')[0],
    dias: Math.abs(diffDias),
    data: dataFmt,
    valor_desc: valorDesc,
    valor_cheio: valorCheio,
    link
  };
 
  const tplMap    = { pre: config.msg_cobranca_pre, dia: config.msg_cobranca_dia, pos: config.msg_cobranca_pos };
  const assuntoMap = { pre: `Lembrete: mensalidade vence em ${dados.dias} dias`, dia: 'Último dia para pagar com desconto!', pos: 'Mensalidade em atraso' };
  const tituloMap  = { pre: `Mensalidade vence em ${dados.dias} dias`, dia: 'Hoje é o último dia com desconto!', pos: 'Sua mensalidade está em atraso' };
 
  const msgWpp  = preencherTemplate(tplMap[tipo] || '', dados);
  const msgHtml = htmlCobranca({ titulo: tituloMap[tipo] || '', mensagem: msgWpp, link, orgNome, orgCor });
 
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
 
async function notificarAniversario({ membro, config }) {
  const orgNome = config.org_nome || 'Liga Acadêmica de Urologia';
  const orgCor  = config.org_cor  || '#1a56db';
  const msg = preencherTemplate(config.msg_aniversario || 'Parabéns {nome}! 🎉', { nome: membro.nome.split(' ')[0] });
 
  if (membro.whatsapp) {
    const r = await enviarWhatsApp(membro.whatsapp, msg);
    await query('INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, null, 'aniversario', 'whatsapp', r.ok ? 'ok' : 'erro']);
  }
 
  if (membro.email) {
    const html = htmlCobranca({ titulo: '🎂 Feliz Aniversário!', mensagem: msg, link: null, orgNome, orgCor });
    const r = await enviarEmail({ para: membro.email, assunto: `Feliz Aniversário, ${membro.nome.split(' ')[0]}! 🎉`, html, texto: msg });
    await query('INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, null, 'aniversario', 'email', r.ok ? 'ok' : 'erro']);
  }
}
 
module.exports = { enviarWhatsApp, enviarEmail, notificarCobranca, notificarAniversario };
