const axios = require('axios');
const nodemailer = require('nodemailer');
const { query } = require('../models/database');
require('dotenv').config();

// ─── WhatsApp via ZAP-API (zap-api.tech) ─────────────────────────────────────
// Endpoint: POST https://zap-api.tech/v1/instances/{instanceId}/send
// Body: { phone: "5511999999999", type: "text", body: "mensagem" }
// Header: Authorization: Bearer {token}

function formatarNumero(numero) {
  const d = numero.replace(/\D/g, '');
  return d.startsWith('55') ? d : '55' + d;
}

async function enviarWhatsApp(numero, mensagem) {
  const token = process.env.ZAPAPI_TOKEN;
  const instanceId = process.env.ZAPAPI_INSTANCE;

  if (!token || !instanceId) {
    console.warn('ZAP-API não configurada — mensagem não enviada para', numero);
    return { ok: false, motivo: 'não configurado' };
  }

  try {
    const fone = formatarNumero(numero);
    const { data } = await axios.post(
      `https://zap-api.tech/v1/instances/${instanceId}/send`,
      { phone: fone, type: 'text', body: mensagem },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );
    console.log(`✅ WhatsApp enviado para ${fone}`);
    return { ok: true, data };
  } catch (err) {
    console.error('ZAP-API erro:', err.response?.data || err.message);
    return { ok: false, erro: err.response?.data || err.message };
  }
}

// ─── E-mail via Gmail/Google Workspace ───────────────────────────────────────

async function enviarEmail({ para, assunto, html, texto }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('E-mail não configurado — não enviado para', para);
    return { ok: false, motivo: 'não configurado' };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: para,
      subject: assunto,
      text: texto || '',
      html: html || ''
    });
    console.log(`✅ E-mail enviado para ${para}`);
    return { ok: true };
  } catch (err) {
    console.error('E-mail erro:', err.message);
    return { ok: false, erro: err.message };
  }
}

// ─── Template de e-mail HTML ──────────────────────────────────────────────────

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

// ─── Preencher template de mensagem ──────────────────────────────────────────

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
  const orgCor = config.org_cor || '#1a56db';
  const link = cobranca.pagbank_link || '';

  const venc = new Date(cobranca.data_vencimento + 'T12:00:00');
  const hoje = new Date();
  const diffDias = Math.ceil((venc - hoje) / (1000 * 60 * 60 * 24));
  const dataFmt = venc.toLocaleDateString('pt-BR');
  const valorDesc = `R$ ${Number(cobranca.valor_desconto).toFixed(2).replace('.', ',')}`;
  const valorCheio = `R$ ${Number(cobranca.valor_cheio).toFixed(2).replace('.', ',')}`;

  const dados = {
    nome: membro.nome.split(' ')[0],
    dias: Math.abs(diffDias),
    data: dataFmt,
    valor_desc: valorDesc,
    valor_cheio: valorCheio,
    link
  };

  const templateMap = {
    pre: config.msg_cobranca_pre,
    dia: config.msg_cobranca_dia,
    pos: config.msg_cobranca_pos
  };
  const assuntoMap = {
    pre: `Lembrete: mensalidade vence em ${dados.dias} dias`,
    dia: 'Último dia para pagar com desconto!',
    pos: 'Mensalidade em atraso — regularize agora'
  };
  const tituloMap = {
    pre: `Mensalidade vence em ${dados.dias} dias`,
    dia: 'Hoje é o último dia com desconto!',
    pos: 'Sua mensalidade está em atraso'
  };

  const msgWpp = preencherTemplate(templateMap[tipo] || '', dados);
  const msgHtml = htmlCobranca({
    titulo: tituloMap[tipo] || '',
    mensagem: msgWpp,
    link,
    orgNome,
    orgCor
  });

  if (membro.whatsapp) {
    const r = await enviarWhatsApp(membro.whatsapp, msgWpp);
    await query(
      'INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, cobranca.id, tipo, 'whatsapp', r.ok ? 'ok' : 'erro']
    );
  }

  if (membro.email) {
    const r = await enviarEmail({
      para: membro.email,
      assunto: assuntoMap[tipo] || '',
      html: msgHtml,
      texto: msgWpp
    });
    await query(
      'INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, cobranca.id, tipo, 'email', r.ok ? 'ok' : 'erro']
    );
  }
}

// ─── Notificação de aniversário ───────────────────────────────────────────────

async function notificarAniversario({ membro, config }) {
  const orgNome = config.org_nome || 'Liga Acadêmica de Urologia';
  const orgCor = config.org_cor || '#1a56db';
  const tpl = config.msg_aniversario || 'Parabéns pelo seu aniversário, {nome}! 🎉';
  const msg = preencherTemplate(tpl, { nome: membro.nome.split(' ')[0] });

  if (membro.whatsapp) {
    const r = await enviarWhatsApp(membro.whatsapp, msg);
    await query(
      'INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, null, 'aniversario', 'whatsapp', r.ok ? 'ok' : 'erro']
    );
  }

  if (membro.email) {
    const html = htmlCobranca({
      titulo: '🎂 Feliz Aniversário!',
      mensagem: msg,
      link: null,
      orgNome,
      orgCor
    });
    const r = await enviarEmail({
      para: membro.email,
      assunto: `Feliz Aniversário, ${membro.nome.split(' ')[0]}! 🎉`,
      html,
      texto: msg
    });
    await query(
      'INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, null, 'aniversario', 'email', r.ok ? 'ok' : 'erro']
    );
  }
}

module.exports = { enviarWhatsApp, enviarEmail, notificarCobranca, notificarAniversario };
