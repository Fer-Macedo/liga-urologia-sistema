const axios = require('axios');
const nodemailer = require('nodemailer');
const { query } = require('../models/database');
require('dotenv').config();

const megaApi = axios.create({
  baseURL: process.env.MEGAAPI_BASE_URL || 'https://api.mega-api.app.br',
  headers: { 'Authorization': `Bearer ${process.env.MEGAAPI_TOKEN}`, 'Content-Type': 'application/json' }
});

function formatarNumero(numero) {
  const d = numero.replace(/\D/g,'');
  return d.startsWith('55') ? d : '55' + d;
}

async function enviarWhatsApp(numero, mensagem) {
  if (!process.env.MEGAAPI_TOKEN || !process.env.MEGAAPI_INSTANCE) return { ok: false };
  try {
    const { data } = await megaApi.post(`/instance/${process.env.MEGAAPI_INSTANCE}/send-text`,
      { number: formatarNumero(numero), text: mensagem, delayMessage: 1 }
    );
    return { ok: true, data };
  } catch (err) {
    console.error('WhatsApp erro:', err.response?.data || err.message);
    return { ok: false };
  }
}

async function enviarEmail({ para, assunto, html, texto }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return { ok: false };
  try {
    const t = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    await t.sendMail({ from: process.env.EMAIL_FROM || process.env.EMAIL_USER, to: para, subject: assunto, text: texto||'', html: html||'' });
    return { ok: true };
  } catch (err) {
    console.error('Email erro:', err.message);
    return { ok: false };
  }
}

function preencherTemplate(tpl, dados) {
  return (tpl||'').replace(/{nome}/g,dados.nome||'').replace(/{dias}/g,dados.dias||'').replace(/{data}/g,dados.data||'').replace(/{valor_desc}/g,dados.valor_desc||'').replace(/{valor_cheio}/g,dados.valor_cheio||'').replace(/{link}/g,dados.link||'');
}

function htmlCobranca({ membro, titulo, mensagem, link, orgNome, orgCor }) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:30px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
    <div style="background:${orgCor||'#1a56db'};padding:24px 32px"><h1 style="color:white;margin:0;font-size:20px">${orgNome}</h1></div>
    <div style="padding:32px">
      <h2 style="margin:0 0 16px">${titulo}</h2>
      <p style="color:#444;line-height:1.6;margin:0 0 24px">${mensagem}</p>
      ${link?`<a href="${link}" style="display:inline-block;background:${orgCor||'#1a56db'};color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold">Pagar agora</a>`:''}
    </div>
    <div style="padding:16px 32px;border-top:1px solid #eee"><p style="color:#888;font-size:12px;margin:0">Mensagem automática da Liga Acadêmica de Urologia</p></div>
  </div></body></html>`;
}

async function notificarCobranca({ membro, cobranca, tipo, config }) {
  const orgNome = config.org_nome || 'Liga Acadêmica de Urologia';
  const orgCor = config.org_cor || '#1a56db';
  const link = cobranca.pagbank_link || '';
  const venc = new Date(cobranca.data_vencimento + 'T12:00:00');
  const hoje = new Date();
  const diffDias = Math.ceil((venc - hoje) / (1000*60*60*24));
  const dataFmt = venc.toLocaleDateString('pt-BR');
  const valorDesc = `R$ ${Number(cobranca.valor_desconto).toFixed(2).replace('.',',')}`;
  const valorCheio = `R$ ${Number(cobranca.valor_cheio).toFixed(2).replace('.',',')}`;
  const dados = { nome: membro.nome.split(' ')[0], dias: Math.abs(diffDias), data: dataFmt, valor_desc: valorDesc, valor_cheio: valorCheio, link };

  const templateMap = { pre: config.msg_cobranca_pre, dia: config.msg_cobranca_dia, pos: config.msg_cobranca_pos };
  const assuntoMap = { pre: `Lembrete: mensalidade vence em ${dados.dias} dias`, dia: 'Último dia para pagar com desconto!', pos: 'Mensalidade em atraso — regularize agora' };
  const tituloMap = { pre: `Mensalidade vence em ${dados.dias} dias`, dia: 'Hoje é o último dia com desconto!', pos: 'Sua mensalidade está em atraso' };

  const msgWpp = preencherTemplate(templateMap[tipo] || '', dados);
  const msgHtml = htmlCobranca({ membro, titulo: tituloMap[tipo]||'', mensagem: msgWpp, link, orgNome, orgCor });

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
  const orgCor = config.org_cor || '#1a56db';
  const msg = preencherTemplate(config.msg_aniversario || 'Parabéns {nome}! 🎉', { nome: membro.nome.split(' ')[0] });

  if (membro.whatsapp) {
    const r = await enviarWhatsApp(membro.whatsapp, msg);
    await query('INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, null, 'aniversario', 'whatsapp', r.ok?'ok':'erro']);
  }
  if (membro.email) {
    const html = htmlCobranca({ membro, titulo:'🎂 Feliz Aniversário!', mensagem: msg, link: null, orgNome, orgCor });
    const r = await enviarEmail({ para: membro.email, assunto: `Feliz Aniversário, ${membro.nome.split(' ')[0]}! 🎉`, html, texto: msg });
    await query('INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, null, 'aniversario', 'email', r.ok?'ok':'erro']);
  }
}

module.exports = { enviarWhatsApp, enviarEmail, notificarCobranca, notificarAniversario };
