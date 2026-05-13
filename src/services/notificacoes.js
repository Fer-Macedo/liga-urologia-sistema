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

// ─── HTML DE COBRANÇA ─────────────────────────────────────────────────────────
// Suporta PIX copia-e-cola (PagBank) e link de checkout para cartão

function htmlCobranca(opts) {
  const titulo=opts.titulo||'';
  const mensagem=opts.mensagem||'';
  const linkCartao=opts.linkCartao||null;
  const pixCode=opts.pixCode||null;
  const orgNome=opts.orgNome||'Liga Academica de Urologia';
  const orgCor=opts.orgCor||'#1a56db';
  const orgLogo=opts.orgLogo||null;
  const corEsc='#0a1f5c';
  const isPos=titulo.includes('atraso');
  const isDia=titulo.includes('HOJE')||titulo.includes('ltimo dia');
  const isPre=!isPos&&!isDia;
  const faixaCor=isPos?'#b91c1c':isDia?'#b45309':orgCor;
  const faixaBg=isPos?'#fef2f2':isDia?'#fffbeb':'#eff6ff';
  const faixaLabel=isPos?'MENSALIDADE EM ATRASO':isDia?'VENCIMENTO HOJE':'LEMBRETE DE COBRANCA';
  const logoHtml=orgLogo
    ?'<img src="'+orgLogo+'" alt="'+orgNome+'" style="max-height:60px;max-width:200px;object-fit:contain;display:block;margin:0 auto">'
    :'<span style="color:white;font-size:20px;font-weight:800;letter-spacing:-0.5px">'+orgNome+'</span>';
  const cab='<div style="background:linear-gradient(160deg,'+orgCor+' 0%,'+corEsc+' 100%);padding:36px 40px;text-align:center">'
    +logoHtml
    +'<div style="margin-top:16px;display:inline-block;background:rgba(255,255,255,0.15);border-radius:4px;padding:4px 16px">'
    +'<span style="color:rgba(255,255,255,0.9);font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase">'+faixaLabel+'</span>'
    +'</div></div>';
  const spix=pixCode
    ?'<div style="margin:0 0 16px;border-radius:12px;overflow:hidden;border:1.5px solid #d1fae5">'
     +'<div style="background:#065f46;padding:12px 20px;display:flex;align-items:center;justify-content:space-between">'
     +'<span style="color:white;font-weight:700;font-size:13px;letter-spacing:0.5px;text-transform:uppercase">Pagamento via PIX</span>'
     +'<span style="background:rgba(255,255,255,0.15);color:white;font-size:10px;padding:2px 10px;border-radius:3px;font-weight:600">RECOMENDADO</span>'
     +'</div>'
     +'<div style="background:#f0fdf4;padding:20px">'
     +'<p style="margin:0 0 10px;font-size:12px;color:#374151;line-height:1.6">Abra o aplicativo do seu banco, acesse a opcao <strong>PIX</strong>, selecione <strong>Pix Copia e Cola</strong> e insira o codigo abaixo:</p>'
     +'<div style="background:white;border:1px solid #a7f3d0;border-radius:8px;padding:12px;font-family:monospace;font-size:10px;color:#065f46;word-break:break-all;line-height:1.6;margin-bottom:10px">'+pixCode+'</div>'
     +'<p style="margin:0;font-size:11px;color:#6b7280">O codigo tambem foi enviado separadamente pelo WhatsApp para facilitar a copia.</p>'
     +'</div></div>'
    :'<div style="margin:0 0 16px;border-radius:12px;background:#f8fafc;border:1.5px solid #e2e8f0;padding:16px 20px">'
     +'<p style="margin:0;font-size:12px;color:#64748b;line-height:1.6">Para pagamento via <strong>PIX</strong>, entre em contato com a secretaria financeira pelo WhatsApp.</p>'
     +'</div>';
  const scartao=linkCartao
    ?'<div style="margin:0 0 16px;border-radius:12px;overflow:hidden;border:1.5px solid #bfdbfe"><div style="background:#1e3a8a;padding:12px 20px"><span style="color:white;font-weight:700;font-size:13px;letter-spacing:0.5px;text-transform:uppercase">Pagamento com Cartao de Credito</span></div><div style="background:#eff6ff;padding:20px;text-align:center"><p style="margin:0 0 16px;font-size:12px;color:#374151;line-height:1.6">Clique no botao abaixo para ser redirecionado ao ambiente seguro de pagamento:</p><a href="'+linkCartao+'" style="display:inline-block;background:'+orgCor+';color:white;padding:13px 40px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.5px;text-transform:uppercase">Pagar com Cartao</a><p style="margin:12px 0 0;font-size:10px;color:#94a3b8">Ambiente seguro — processado pelo PagBank</p></div></div>'
    :'';
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f1f5f9"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:40px 16px"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td>'+cab+'</td></tr><tr><td style="background:white;padding:36px 40px"><div style="border-left:3px solid '+faixaCor+';padding-left:14px;margin-bottom:24px"><p style="margin:0;font-size:11px;font-weight:700;color:'+faixaCor+';letter-spacing:1.5px;text-transform:uppercase">'+faixaLabel+'</p><h2 style="margin:4px 0 0;font-size:18px;font-weight:700;color:#0f172a;line-height:1.3">'+titulo+'</h2></div><p style="margin:0 0 28px;font-size:14px;color:#475569;line-height:1.7">'+mensagem+'</p><div style="height:1px;background:#e2e8f0;margin:0 0 24px"></div><p style="margin:0 0 16px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:2px;text-transform:uppercase">Opcoes de pagamento</p>'+spix+scartao+'<div style="background:#f8fafc;border-radius:8px;padding:16px 20px;margin-top:8px;border:1px solid #e2e8f0"><p style="margin:0;font-size:12px;color:#64748b;line-height:1.7">Em caso de duvidas ou para confirmar o pagamento, entre em contato com a secretaria financeira respondendo este e-mail ou via WhatsApp.</p></div></td></tr><tr><td style="background:#0f172a;padding:24px 40px"><table width="100%" cellpadding="0" cellspacing="0"><tr><td><p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;font-weight:600">'+orgNome+'</p><p style="margin:4px 0 0;color:rgba(255,255,255,0.4);font-size:10px">Mensagem automatica</p></td><td align="right"><p style="margin:0;color:rgba(255,255,255,0.3);font-size:9px;letter-spacing:1.5px;text-transform:uppercase">Powered by PagBank</p></td></tr></table></td></tr></table></td></tr></table></body></html>';
}

function preencherTemplate(tpl, dados) {
  return (tpl || '')
    .replace(/{nome}/g,        dados.nome        || '')
    .replace(/{dias}/g,        dados.dias        || '')
    .replace(/{data}/g,        dados.data        || '')
    .replace(/{valor_desc}/g,  dados.valor_desc  || '')
    .replace(/{valor_cheio}/g, dados.valor_cheio || '')
    .replace(/{link}/g,        dados.link        || '');
}

// ─── NOTIFICAR COBRANÇA ───────────────────────────────────────────────────────
// Usa campos PagBank: pix_copia_cola, checkout_link (pagbank_link)
// Compatível com cobranças antigas do MP (sem PIX/link — só envia o texto)

async function notificarCobranca(opts) {
  const membro   = opts.membro;
  const cobranca = opts.cobranca;
  const tipo     = opts.tipo;
  const config   = opts.config || await getConfig();

  const orgNome  = config.org_nome || 'Liga Academica de Urologia';
  const orgCor   = config.org_cor  || '#1a56db';
  const orgLogo  = config.org_logo || null;

  // ── Campos PagBank (novos) — com fallback para campos antigos do MP
  const pixCode    = cobranca.pix_copia_cola  || null;   // PagBank
  const linkCartao = cobranca.checkout_link   ||         // PagBank
                     cobranca.pagbank_link    || null;   // fallback

  const venc = new Date(cobranca.data_vencimento + 'T12:00:00');
  const diffDias = Math.ceil((venc - new Date()) / (1000 * 60 * 60 * 24));

  const dados = {
    nome:        membro.nome.split(' ')[0],
    dias:        Math.abs(diffDias),
    data:        venc.toLocaleDateString('pt-BR'),
    valor_desc:  'R$ ' + Number(cobranca.valor_desconto).toFixed(2).replace('.', ','),
    valor_cheio: 'R$ ' + Number(cobranca.valor_cheio).toFixed(2).replace('.', ','),
  };

  const assuntoMap = {
    pre: 'Lembrete: mensalidade vence em ' + dados.dias + ' dias — ' + orgNome,
    dia: 'HOJE: último dia com desconto! — ' + orgNome,
    pos: 'Mensalidade em atraso — ' + orgNome
  };

  const tituloMap = {
    pre: '⚠️ Sua mensalidade vence em ' + dados.dias + ' dias!',
    dia: '⏰ Hoje é o último dia com desconto!',
    pos: '❗ Mensalidade em atraso'
  };

  const cabWpp    = '*' + orgNome + '* 🏥\n\n';
  const cartaoWpp = linkCartao ? '💳 *Cartão:* ' + linkCartao + '\n\n' : '';

  const msgWppMap = {
    pre: cabWpp
      + 'Olá, *' + dados.nome + '*! 👋\n\n'
      + '⚠️ Sua mensalidade vence em *' + dados.dias + ' dias* (' + dados.data + ').\n\n'
      + '💰 Com desconto: *' + dados.valor_desc + '*\n'
      + '💰 Sem desconto: ' + dados.valor_cheio + '\n\n'
      + (pixCode ? '⚡ *PIX:* Código enviado na mensagem seguinte — é só copiar!\n\n' : '')
      + cartaoWpp
      + 'Dúvidas? Estamos à disposição! 😊',

    dia: cabWpp
      + 'Olá, *' + dados.nome + '*! 👋\n\n'
      + '⏰ *HOJE* é o último dia com desconto!\n\n'
      + '💰 Com desconto: *' + dados.valor_desc + '*\n'
      + '💰 Sem desconto: ' + dados.valor_cheio + '\n\n'
      + (pixCode ? '⚡ *PIX:* Código enviado na mensagem seguinte — é só copiar!\n\n' : '')
      + cartaoWpp
      + 'Não perca o desconto! 🙏',

    pos: cabWpp
      + 'Olá, *' + dados.nome + '*!\n\n'
      + '❗ Sua mensalidade está *em atraso* desde ' + dados.data + '.\n\n'
      + '💰 Valor: *' + dados.valor_cheio + '*\n\n'
      + (pixCode ? '⚡ *PIX:* Código enviado na mensagem seguinte — é só copiar!\n\n' : '')
      + cartaoWpp
      + 'Por favor, regularize sua situação. 🙏'
  };

  // ── WhatsApp
  if (membro.whatsapp) {
    let wppOk = false;

    // Mensagem 1 — principal com instruções
    const r1 = await enviarWhatsApp(membro.whatsapp, msgWppMap[tipo] || '');
    if (r1.ok) wppOk = true;

    // Mensagem 2 — só o código PIX (facilita copiar no celular)
    if (pixCode) {
      await new Promise(res => setTimeout(res, 2500));
      await enviarWhatsApp(membro.whatsapp, pixCode);
    }

    await query(
      'INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, cobranca.id, tipo, 'whatsapp', wppOk ? 'ok' : 'erro']
    );
  }

  // ── Email
  if (membro.email) {
    const msgHtml = htmlCobranca({
      titulo:     tituloMap[tipo] || '',
      mensagem:   'Prezado(a) ' + dados.nome + ', segue abaixo as opções para pagamento da sua mensalidade de ' + dados.valor_desc + ' (com desconto de pontualidade).',
      linkCartao,
      pixCode,
      orgNome,
      orgCor,
      orgLogo
    });

    const r = await enviarEmail({
      para:    membro.email,
      assunto: assuntoMap[tipo] || '',
      html:    msgHtml,
      texto:   msgWppMap[tipo] || ''
    });

    await query(
      'INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, cobranca.id, tipo, 'email', r.ok ? 'ok' : 'erro']
    );
  }
}

// ─── NOTIFICAR ANIVERSÁRIO ────────────────────────────────────────────────────

async function notificarAniversario(opts) {
  const membro = opts.membro;
  const config = opts.config || await getConfig();
  const orgNome = config.org_nome || 'Liga Academica de Urologia';
  const orgCor  = config.org_cor  || '#1a56db';
  const orgLogo = config.org_logo || null;
  const tpl = config.msg_aniversario || 'Parabéns pelo seu aniversário, {nome}! 🎉';
  const msg = preencherTemplate(tpl, { nome: membro.nome.split(' ')[0] });

  const msgWpp = '🎂 *' + orgNome + '*\n\nOlá, *' + membro.nome.split(' ')[0] + '*!\n\n' + msg + '\n\nCom carinho de toda a equipe! 💙';

  if (membro.whatsapp) {
    const r = await enviarWhatsApp(membro.whatsapp, msgWpp);
    await query(
      'INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, null, 'aniversario', 'whatsapp', r.ok ? 'ok' : 'erro']
    );
  }

  if (membro.email) {
    const html = htmlCobranca({
      titulo:    '🎂 Feliz Aniversário, ' + membro.nome.split(' ')[0] + '!',
      mensagem:  msg,
      linkCartao: null,
      pixCode:    null,
      orgNome, orgCor, orgLogo
    });
    const r = await enviarEmail({
      para:    membro.email,
      assunto: 'Feliz Aniversário! 🎉 — ' + orgNome,
      html,
      texto:   msgWpp
    });
    await query(
      'INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membro.id, null, 'aniversario', 'email', r.ok ? 'ok' : 'erro']
    );
  }
}

module.exports = { enviarWhatsApp, enviarEmail, notificarCobranca, notificarAniversario };
