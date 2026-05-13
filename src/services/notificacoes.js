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
  const titulo=opts.titulo||'';const mensagem=opts.mensagem||'';const linkCartao=opts.linkCartao||null;const pixCode=opts.pixCode||null;
  const orgNome=opts.orgNome||'Liga Academica de Urologia';const orgCor=opts.orgCor||'#1a56db';const orgLogo=opts.orgLogo||null;
  const corEsc='#0f2d6e';const corCla='#e8f0fe';
  const cab=orgLogo?'<div style="background:linear-gradient(135deg,'+orgCor+','+corEsc+');padding:32px;text-align:center"><img src="'+orgLogo+'" style="max-height:64px;object-fit:contain;filter:brightness(0) invert(1)"></div>':'<div style="background:linear-gradient(135deg,'+orgCor+','+corEsc+');padding:32px;text-align:center"><div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:12px;padding:10px 24px"><span style="color:white;font-size:22px;font-weight:800">'+orgNome+'</span></div></div>';
  const isPos=titulo.includes('atraso');const isDia=titulo.includes('HOJE')||titulo.includes('ltimo dia');
  const badgeCor=isPos?'#dc2626':isDia?'#d97706':orgCor;
  const badgeBg=isPos?'#fef2f2':isDia?'#fffbeb':corCla;
  const badgeIcon=isPos?'!':isDia?'⏰':'📅';
  const spix=pixCode?'<div style="margin:24px 0;border-radius:16px;overflow:hidden;border:2px solid #22c55e"><div style="background:#16a34a;padding:14px 20px"><span style="color:white;font-weight:700;font-size:15px">PIX - Aprovacao instantanea</span></div><div style="background:#f0fdf4;padding:20px"><p style="margin:0 0 12px;font-size:13px;color:#374151">Abra o app do banco, va em PIX, Pix Copia e Cola e cole o codigo:</p><div style="background:white;border:1.5px solid #bbf7d0;border-radius:10px;padding:14px;margin-bottom:12px;word-break:break-all;font-family:monospace;font-size:11px;color:#15803d">'+pixCode+'</div><p style="margin:0;font-size:11px;color:#6b7280;text-align:center">Codigo tambem enviado pelo WhatsApp</p></div></div>':'';
  const scartao=linkCartao?'<div style="margin:20px 0;border-radius:16px;overflow:hidden;border:2px solid #3b82f6"><div style="background:#1d4ed8;padding:14px 20px"><span style="color:white;font-weight:700;font-size:15px">Cartao de Credito - Parcelamento disponivel</span></div><div style="background:#eff6ff;padding:20px;text-align:center"><p style="margin:0 0 16px;font-size:13px;color:#374151">Clique para pagar com cartao de forma segura:</p><a href="'+linkCartao+'" style="display:inline-block;background:linear-gradient(135deg,#1d4ed8,#1e40af);color:white;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Pagar com Cartao</a><p style="margin:12px 0 0;font-size:11px;color:#6b7280">Pagamento seguro via PagBank</p></div></div>':'';
  const sep=(pixCode&&linkCartao)?'<div style="text-align:center;margin:8px 0;color:#9ca3af;font-size:12px;font-weight:600">— OU —</div>':'';
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f1f5f9">'
    +'<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px"><tr><td align="center">'
    +'<table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">'
    +'<tr><td style="border-radius:20px 20px 0 0;overflow:hidden">'+cab+'</td></tr>'
    +'<tr><td style="background:white;padding:32px 36px">'
    +'<div style="display:inline-flex;align-items:center;gap:8px;background:'+badgeBg+';border-radius:999px;padding:6px 16px;margin-bottom:20px"><span>'+badgeIcon+'</span><span style="color:'+badgeCor+';font-size:13px;font-weight:700">'+titulo+'</span></div>'
    +'<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 24px">'+mensagem+'</p>'
    +'<div style="height:1px;background:linear-gradient(90deg,transparent,#e5e7eb,transparent);margin:0 0 24px"></div>'
    +((pixCode||linkCartao)?'<p style="color:#111827;font-size:13px;font-weight:700;margin:0 0 16px;text-transform:uppercase;letter-spacing:0.8px">Escolha como pagar</p>':'')
    +spix+sep+scartao
    +'<div style="background:#f8fafc;border-radius:12px;padding:16px 20px;margin-top:24px;border-left:4px solid '+orgCor+'"><p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6">Duvidas? Entre em contato com a secretaria financeira respondendo este e-mail ou via WhatsApp.</p></div>'
    +'</td></tr>'
    +'<tr><td style="background:#1e293b;border-radius:0 0 20px 20px;padding:24px 36px;text-align:center"><p style="color:rgba(255,255,255,0.9);font-size:13px;font-weight:600;margin:0 0 4px">'+orgNome+'</p><p style="color:rgba(255,255,255,0.5);font-size:11px;margin:0 0 12px">Mensagem automatica</p><span style="color:rgba(255,255,255,0.3);font-size:10px;letter-spacing:1px;text-transform:uppercase">Powered by PagBank</span></td></tr>'
    +'<tr><td style="height:32px"></td></tr></table></td></tr></table></body></html>';
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
