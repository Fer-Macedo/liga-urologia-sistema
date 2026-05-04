const axios = require('axios');
const nodemailer = require('nodemailer');
const { query } = require('../models/database');
require('dotenv').config();
 
function formatarNumero(numero) {
  const d = numero.replace(/\D/g, '');
  return d.startsWith('55') ? d : '55' + d;
}
 
async function enviarWhatsApp(numero, mensagem) {
  const token = process.env.ZAPAPI_TOKEN;
  const instanceId = process.env.ZAPAPI_INSTANCE;
 
  if (!token || !instanceId) {
    console.warn('W-API: ZAPAPI_TOKEN ou ZAPAPI_INSTANCE nao configurado');
    return { ok: false };
  }
 
  const fone = formatarNumero(numero);
  console.log('W-API enviando para ' + fone + ' instancia ' + instanceId);
 
  try {
    const { data, status } = await axios.post(
      'https://api.w-api.app/v1/message/send-text?instanceId=' + instanceId,
      {
        phone: fone,
        message: mensagem,
        instanceId: instanceId,
        delayMessage: 1
      },
      {
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      }
    );
    console.log('WhatsApp OK ' + status + ': ' + JSON.stringify(data).substring(0, 100));
    return { ok: true, data };
  } catch (err) {
    const s = err.response ? err.response.status : 'sem resposta';
    const d = JSON.stringify(err.response ? err.response.data : err.message).substring(0, 300);
    console.error('W-API ERRO ' + s + ': ' + d);
    return { ok: false };
  }
}
 
async function enviarEmail(opts) {
  const para = opts.para;
  const assunto = opts.assunto;
  const html = opts.html;
  const texto = opts.texto;
 
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('Email nao configurado');
    return { ok: false };
  }
 
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
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
 
    console.log('Email enviado para ' + para);
    return { ok: true };
  } catch (err) {
    console.error('Email erro: ' + err.message);
    return { ok: false };
  }
}
 
function htmlCobranca(opts) {
  const titulo = opts.titulo;
  const mensagem = opts.mensagem;
  const link = opts.link;
  const orgNome = opts.orgNome;
  const orgCor = opts.orgCor || '#1a56db';
 
  const botao = link
    ? '<a href="' + link + '" style="display:inline-block;background:' + orgCor + ';color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold">Pagar agora</a>'
    : '';
 
  return '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:30px">'
    + '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">'
    + '<div style="background:' + orgCor + ';padding:24px 32px"><h1 style="color:white;margin:0;font-size:20px">' + orgNome + '</h1></div>'
    + '<div style="padding:32px">'
    + '<h2 style="margin:0 0 16px">' + titulo + '</h2>'
    + '<p style="color:#444;line-height:1.6;margin:0 0 24px">' + mensagem + '</p>'
    + botao
    + '</div></div></body></html>';
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
  const config = opts.config;
 
  const orgNome = config.org_nome || 'Liga Academica de Urologia';
  const orgCor = config.org_cor || '#1a56db';
  const link = cobranca.pagbank_link || '';
 
  const venc = new Date(cobranca.data_vencimento + 'T12:00:00');
  const diffDias = Math.ceil((venc - new Date()) / (1000 * 60 * 60 * 24));
 
  const dados = {
    nome: membro.nome.split(' ')[0],
    dias: Math.abs(diffDias),
    data: venc.toLocaleDateString('pt-BR'),
    valor_desc: 'R$ ' + Number(cobranca.valor_desconto).toFixed(2).replace('.', ','),
    valor_cheio: 'R$ ' + Number(cobranca.valor_cheio).toFixed(2).replace('.', ','),
    link: link
  };
 
  const tplMap = {
    pre: config.msg_cobranca_pre,
    dia: config.msg_cobranca_dia,
    pos: config.msg_cobranca_pos
  };
 
  const assuntoMap = {
    pre: 'Mensalidade vence em ' + dados.dias + ' dias',
    dia: 'Ultimo dia com desconto!',
    pos: 'Mensalidade em atraso'
  };
 
  const tituloMap = {
    pre: 'Mensalidade vence em ' + dados.dias + ' dias',
    dia: 'Hoje e o ultimo dia com desconto!',
    pos: 'Sua mensalidade esta em atraso'
  };
 
  const msgWpp = preencherTemplate(tplMap[tipo] || '', dados);
  const msgHtml = htmlCobranca({
    titulo: tituloMap[tipo] || '',
    mensagem: msgWpp,
    link: link,
    orgNome: orgNome,
    orgCor: orgCor
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
 
async function notificarAniversario(opts) {
  const membro = opts.membro;
  const config = opts.config;
 
  const orgNome = config.org_nome || 'Liga Academica de Urologia';
  const orgCor = config.org_cor || '#1a56db';
  const tpl = config.msg_aniversario || 'Parabens pelo seu aniversario, {nome}!';
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
      titulo: 'Feliz Aniversario!',
      mensagem: msg,
      link: null,
      orgNome: orgNome,
      orgCor: orgCor
    });
    const r = await enviarEmail({
      para: membro.email,
      assunto: 'Feliz Aniversario, ' + membro.nome.split(' ')[0] + '!',
      html: html,
      texto: msg
    });
    await query(
      'INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, null, 'aniversario', 'email', r.ok ? 'ok' : 'erro']
    );
  }
}
 
module.exports = { enviarWhatsApp, enviarEmail, notificarCobranca, notificarAniversario };
