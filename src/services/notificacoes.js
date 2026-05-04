const axios = require('axios');
const nodemailer = require('nodemailer');
const { query } = require('../models/database');
require('dotenv').config();
 
function formatarNumero(numero) {
  const d = numero.replace(/\D/g, '');
  return d.startsWith('55') ? d : '55' + d;
}
 
// ─── WhatsApp via ZAP-API ─────────────────────────────────────────────────────
 
async function enviarWhatsApp(numero, mensagem) {
  const token      = process.env.ZAPAPI_TOKEN;
  const instanceId = process.env.ZAPAPI_INSTANCE;
 
  if (!token || !instanceId) {
    console.warn('ZAP-API não configurada');
    return { ok: false };
  }
 
  const fone = formatarNumero(numero);
 
  // O log mostrou status 307 redirect para /login — o token precisa ir como
  // cookie de sessão E como Bearer. Tentamos as duas formas.
  const tentativas = [
    // Tentativa 1: Bearer padrão com maxRedirects para seguir o 307
    {
      url: `https://zap-api.tech/v1/instances/${instanceId}/send`,
      config: {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        maxRedirects: 5
      },
      body: { phone: fone, type: 'text', body: mensagem }
    },
    // Tentativa 2: token como query param
    {
      url: `https://zap-api.tech/v1/instances/${instanceId}/send?token=${token}`,
      config: {
        headers: { 'Content-Type': 'application/json' },
        maxRedirects: 5
      },
      body: { phone: fone, type: 'text', body: mensagem }
    },
    // Tentativa 3: token no header X-API-Key
    {
      url: `https://zap-api.tech/v1/instances/${instanceId}/send`,
      config: {
        headers: {
          'X-API-Key': token,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        maxRedirects: 5
      },
      body: { phone: fone, type: 'text', body: mensagem }
    }
  ];
 
  for (const t of tentativas) {
    try {
      const { data, status } = await axios.post(t.url, t.body, t.config);
      console.log(`✅ WhatsApp enviado para ${fone} (status ${status})`);
      return { ok: true, data };
    } catch (err) {
      const status = err.response?.status;
      const detail = JSON.stringify(err.response?.data || err.message).substring(0, 200);
      console.warn(`ZAP-API tentativa falhou ${status}: ${detail}`);
    }
  }
 
  // Última tentativa: verificar se a instância está conectada
  try {
    const { data } = await axios.get(
      `https://zap-api.tech/v1/instances/${instanceId}`,
      { headers: { 'Authorization': `Bearer ${token}` }, maxRedirects: 5 }
    );
    console.log(`ZAP-API status da instância: ${JSON.stringify(data).substring(0, 200)}`);
  } catch (err) {
    console.error(`ZAP-API verificação da instância: ${err.response?.status} ${JSON.stringify(err.response?.data || err.message).substring(0,100)}`);
  }
 
  return { ok: false };
}
 
// ─── E-mail ───────────────────────────────────────────────────────────────────
 
async function enviarEmail({ para, assunto, html, texto }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('E-mail não configurado');
    return { ok: false };
  }
 
  const configs = [
    { host: 'smtp.gmail.com', port: 587, secure: false },
    { host: 'smtp.gmail.com', port: 465, secure: true },
  ];
 
  for (const cfg of configs) {
    try {
      const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        connectionTimeout: 15000,
        tls: { rejectUnauthorized: false }
      });
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: para,
        subject: assunto,
        text: texto || '',
        html: html || ''
      });
      console.log(`✅ E-mail enviado para ${para} porta ${cfg.port}`);
      return { ok: true };
    } catch (err) {
      console.warn(`E-mail porta ${cfg.port}: ${err.message}`);
    }
  }
  return { ok: false };
}
 
// ─── Helpers ──────────────────────────────────────────────────────────────────
 
function htmlCobranca({ titulo, mensagem, link, orgNome, orgCor }) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:30px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
    <div style="background:${orgCor||'#1a56db'};padding:24px 32px"><h1 style="color:white;margin:0;font-size:20px">${orgNome}</h1></div>
    <div style="padding:32px">
      <h2 style="margin:0 0 16px">${titulo}</h2>
      <p style="color:#444;line-height:1.6;margin:0 0 24px">${mensagem}</p>
      ${link?`<a href="${link}" style="display:inline-block;background:${orgCor||'#1a56db'};color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold">Pagar agora</a>`:''}
    </div>
  </div></body></html>`;
}
 
function preencherTemplate(tpl, dados) {
  return (tpl||'').replace(/{nome}/g,dados.nome||'').replace(/{dias}/g,dados.dias||'').replace(/{data}/g,dados.data||'').replace(/{valor_desc}/g,dados.valor_desc||'').replace(/{valor_cheio}/g,dados.valor_cheio||'').replace(/{link}/g,dados.link||'');
}
 
async function notificarCobranca({ membro, cobranca, tipo, config }) {
  const orgNome = config.org_nome || 'Liga Acadêmica de Urologia';
  const orgCor  = config.org_cor  || '#1a56db';
  const link    = cobranca.pagbank_link || '';
  const venc    = new Date(cobranca.data_vencimento + 'T12:00:00');
  const diffDias = Math.ceil((venc - new Date()) / (1000*60*60*24));
  const dados = {
    nome: membro.nome.split(' ')[0],
    dias: Math.abs(diffDias),
    data: venc.toLocaleDateString('pt-BR'),
    valor_desc:  `R$ ${Number(cobranca.valor_desconto).toFixed(2).replace('.',',')}`,
    valor_cheio: `R$ ${Number(cobranca.valor_cheio).toFixed(2).replace('.',',')}`,
    link
  };
  const tplMap     = { pre: config.msg_cobranca_pre, dia: config.msg_cobranca_dia, pos: config.msg_cobranca_pos };
  const assuntoMap = { pre:`Mensalidade vence em ${dados.dias} dias`, dia:'Último dia com desconto!', pos:'Mensalidade em atraso' };
  const tituloMap  = { pre:`Mensalidade vence em ${dados.dias} dias`, dia:'Hoje é o último dia!', pos:'Mensalidade em atraso' };
  const msgWpp  = preencherTemplate(tplMap[tipo]||'', dados);
  const msgHtml = htmlCobranca({ titulo: tituloMap[tipo]||'', mensagem: msgWpp, link, orgNome, orgCor });
 
  if (membro.whatsapp) {
    const r = await enviarWhatsApp(membro.whatsapp, msgWpp);
    await query('INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, cobranca.id, tipo, 'whatsapp', r.ok?'ok':'erro']);
  }
  if (membro.email) {
    const r = await enviarEmail({ para: membro.email, assunto: assuntoMap[tipo]||'', html: msgHtml, texto: msgWpp });
    await query('INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, cobranca.id, tipo, 'email', r.ok?'ok':'erro']);
  }
}
 
async function notificarAniversario({ membro, config }) {
  const orgNome = config.org_nome || 'Liga Acadêmica de Urologia';
  const orgCor  = config.org_cor  || '#1a56db';
  const msg = preencherTemplate(config.msg_aniversario||'Parabéns {nome}! 🎉', { nome: membro.nome.split(' ')[0] });
  if (membro.whatsapp) {
    const r = await enviarWhatsApp(membro.whatsapp, msg);
    await query('INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, null, 'aniversario', 'whatsapp', r.ok?'ok':'erro']);
  }
  if (membro.email) {
    const html = htmlCobranca({ titulo:'🎂 Feliz Aniversário!', mensagem: msg, link: null, orgNome, orgCor });
    const r = await enviarEmail({ para: membro.email, assunto:`Feliz Aniversário, ${membro.nome.split(' ')[0]}! 🎉`, html, texto: msg });
    await query('INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, null, 'aniversario', 'email', r.ok?'ok':'erro']);
  }
}
 
module.exports = { enviarWhatsApp, enviarEmail, notificarCobranca, notificarAniversario };
