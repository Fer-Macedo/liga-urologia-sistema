const axios = require('axios');
const nodemailer = require('nodemailer');
const { query } = require('../models/database');
require('dotenv').config();

function formatarNumero(numero) {
  const d = numero.replace(/\D/g, '');
  return d.startsWith('55') ? d : '55' + d;
}

// ─── WhatsApp via ZAP-API ─────────────────────────────────────────────────────
// Endpoint oficial do site: POST /v1/instances/{instanceId}/send
// Body: { phone, type: "text", body }
// O erro 405 pode ser porque o Render bloqueia saída — testamos com axios e https nativo

async function enviarWhatsApp(numero, mensagem) {
  const token      = process.env.ZAPAPI_TOKEN;
  const instanceId = process.env.ZAPAPI_INSTANCE;

  if (!token || !instanceId) {
    console.warn('ZAP-API não configurada');
    return { ok: false };
  }

  const fone = formatarNumero(numero);
  const url  = `https://zap-api.tech/v1/instances/${instanceId}/send`;
  const body = JSON.stringify({ phone: fone, type: 'text', body: mensagem });

  // Tentativa 1: axios padrão
  try {
    const { data } = await axios({
      method: 'POST',
      url,
      data: body,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'liga-urologia/1.0'
      },
      timeout: 20000
    });
    console.log(`✅ WhatsApp enviado para ${fone}`);
    return { ok: true, data };
  } catch (err) {
    const status = err.response?.status;
    const detail = JSON.stringify(err.response?.data || err.message);
    console.error(`ZAP-API axios erro ${status}: ${detail}`);
  }

  // Tentativa 2: https nativo do Node.js (contorna restrições do axios no Render)
  return new Promise((resolve) => {
    const https = require('https');
    const options = {
      hostname: 'zap-api.tech',
      port: 443,
      path: `/v1/instances/${instanceId}/send`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`✅ WhatsApp (https nativo) enviado para ${fone}`);
          resolve({ ok: true });
        } else {
          console.error(`ZAP-API https nativo status ${res.statusCode}: ${data}`);
          resolve({ ok: false, status: res.statusCode, data });
        }
      });
    });

    req.on('error', (e) => {
      console.error(`ZAP-API https nativo erro: ${e.message}`);
      resolve({ ok: false, erro: e.message });
    });

    req.setTimeout(20000, () => {
      req.destroy();
      console.error('ZAP-API timeout');
      resolve({ ok: false, erro: 'timeout' });
    });

    req.write(body);
    req.end();
  });
}

// ─── E-mail via Nodemailer ────────────────────────────────────────────────────
// Render bloqueia portas SMTP padrão (25, 465, 587) no plano free.
// Solução: usar porta 2525 (alternativa não bloqueada pelo Render) ou
// o serviço SendGrid/Mailgun que usa HTTPS.
// Por ora tentamos todas as portas possíveis.

async function enviarEmail({ para, assunto, html, texto }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('E-mail não configurado');
    return { ok: false };
  }

  const configs = [
    { host: 'smtp.gmail.com', port: 587, secure: false },
    { host: 'smtp.gmail.com', port: 465, secure: true  },
    { host: 'smtp.gmail.com', port: 2525, secure: false },
  ];

  for (const cfg of configs) {
    try {
      const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 20000,
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

  console.error(`E-mail: falhou para ${para} — Render pode estar bloqueando SMTP`);
  console.error('DICA: O plano gratuito do Render bloqueia conexões SMTP. Considere usar SendGrid ou Resend.');
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
      ${link ? `<a href="${link}" style="display:inline-block;background:${orgCor||'#1a56db'};color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold">Pagar agora</a>` : ''}
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
