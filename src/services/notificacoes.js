const nodemailer = require('nodemailer');
const { query } = require('../models/database');
require('dotenv').config();

// Envio de WhatsApp 100% pela API Oficial da Meta (Cloud API) — ver whatsapp-oficial.js.
// A W-API (gateway não-oficial, causa raiz de banimentos recorrentes) foi removida e a
// assinatura cancelada em 2026-07-15. Ver memória "project_whatsapp_ban_causa_raiz".
async function enviarWhatsApp(numero, mensagem) {
  const { enviarTexto } = require('./whatsapp-oficial');
  return await enviarTexto(numero, mensagem);
}

async function enviarEmail(opts) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return { ok: false };
  try {
    // PADRAO: todo email cujo html seja um fragmento (sem <!doctype>/<html>) e
    // automaticamente embrulhado no layout padrao do sistema (mesmo da cobranca).
    let html = opts.html || '';
    if (html && !/<!doctype|<html[\s>]/i.test(html)) {
      html = htmlSimples({
        titulo: opts.titulo || '', mensagem: html,
        faixaLabel: opts.faixaLabel || 'AVISO', cta: opts.cta || null,
        config: opts.config || await getConfig()
      });
    }
    const t = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 587, secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      connectionTimeout: 15000, tls: { rejectUnauthorized: false }
    });
    await t.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: opts.para, subject: opts.assunto,
      text: opts.texto || '', html: html,
      attachments: opts.anexos || undefined
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

// Icones sociais do rodape (Instagram + WhatsApp), usados em TODOS os emails.
// PNGs servidos pelo proprio sistema; URL absoluta para funcionar no cliente de email.
// Virou funcao porque o numero do WhatsApp deixou de ser fixo: vem de `configuracoes`.
function rodapeSocial() {
  const wa = require('./contato').whatsappAtendimentoSync();
  return '<a href="https://instagram.com/lauroucp.cde" title="Instagram" style="text-decoration:none;display:inline-block;margin-left:14px"><img src="https://sistema.lauroucpcde.com/img/email-instagram.png" alt="Instagram" width="22" height="22" style="display:inline-block;vertical-align:middle;border:0"></a><a href="https://wa.me/' + wa + '" title="WhatsApp" style="text-decoration:none;display:inline-block;margin-left:14px"><img src="https://sistema.lauroucpcde.com/img/email-whatsapp.png" alt="WhatsApp" width="22" height="22" style="display:inline-block;vertical-align:middle;border:0"></a>';
}

// ─── HTML DE COBRANÇA ─────────────────────────────────────────────────────────
// Suporta PIX copia-e-cola (PagBank) e link de checkout para cartão

function htmlCobranca(opts) {
  const titulo=opts.titulo||'';
  const mensagem=opts.mensagem||'';
  const linkCartao=opts.linkCartao||null;
  const pixCode=opts.pixCode||null;
  const qrBase64=opts.qrBase64||null;
  const qrUrl=opts.qrUrl||null;
  const orgNome=opts.orgNome||'Liga Academica de Urologia';
  const orgCor=opts.orgCor||'#1a56db';
  const orgLogo=opts.orgLogo||null;
  const corEsc='#0a1f5c';
  const tipoCob=opts.tipoCob||'pre';
  const isPos=tipoCob==='pos';
  const isDia=tipoCob==='dia';
  const isPre=tipoCob==='pre';
  const faixaCor=isPos?'#b91c1c':isDia?'#b45309':orgCor;
  const faixaBg=isPos?'#fef2f2':isDia?'#fffbeb':'#eff6ff';
  const faixaLabel=isPos?'MENSALIDADE EM ATRASO':isDia?'VENCIMENTO HOJE':'LEMBRETE DE COBRANCA';
  const logoHtml=orgLogo
    ?'<img src="'+orgLogo+'" alt="'+orgNome+'" style="max-height:84px;max-width:230px;object-fit:contain;display:block;margin:0 auto">'
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
     +((qrUrl||qrBase64)?'<div style="text-align:center;margin-bottom:16px"><img src="'+(qrUrl||('data:image/png;base64,'+qrBase64))+'" alt="QR Code PIX" style="width:180px;height:180px;display:block;margin:0 auto"><p style="margin:8px 0 0;font-size:11px;color:#065f46">Escaneie o QR Code acima</p></div>':'')
     +'<p style="margin:0 0 10px;font-size:12px;color:#374151;line-height:1.6">Abra o aplicativo do seu banco, acesse a opcao <strong>PIX</strong>, selecione <strong>Pix Copia e Cola</strong> e insira o codigo abaixo:</p>'
     +'<div style="background:white;border:1px solid #a7f3d0;border-radius:8px;padding:12px;font-family:monospace;font-size:10px;color:#065f46;word-break:break-all;line-height:1.6;margin-bottom:10px">'+pixCode+'</div>'
     +'<p style="margin:0 0 8px;font-size:11px;color:#6b7280">Voce tambem pode acessar o portal do membro para visualizar e pagar:</p>'
     +'<div style="text-align:center"><a href="https://membro.lauroucpcde.com" style="display:inline-block;background:#0F6E56;color:white;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:700;font-size:12px">Acessar Portal do Membro</a></div>'
     +'</div></div>'
    :'<div style="margin:0 0 16px;border-radius:12px;background:#f8fafc;border:1.5px solid #e2e8f0;padding:16px 20px">'
     +'<p style="margin:0;font-size:12px;color:#64748b;line-height:1.6">Para pagamento via <strong>PIX</strong>, entre em contato com a Diretoria Financeira pelo WhatsApp.</p>'
     +'</div>';
  const scartao=linkCartao
    ?'<div style="margin:0 0 16px;border-radius:12px;overflow:hidden;border:1.5px solid #bfdbfe"><div style="background:#1e3a8a;padding:12px 20px"><span style="color:white;font-weight:700;font-size:13px;letter-spacing:0.5px;text-transform:uppercase">Pagamento com Cartao de Credito</span></div><div style="background:#eff6ff;padding:20px;text-align:center"><p style="margin:0 0 16px;font-size:12px;color:#374151;line-height:1.6">Clique no botao abaixo para ser redirecionado ao ambiente seguro de pagamento:</p><a href="'+linkCartao+'" style="display:inline-block;background:'+orgCor+';color:white;padding:13px 40px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.5px;text-transform:uppercase">Pagar com Cartao</a><p style="margin:12px 0 0;font-size:10px;color:#94a3b8">Ambiente seguro — processado pelo PagBank</p></div></div>'
    :'';
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f1f5f9"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:40px 16px"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td>'+cab+'</td></tr><tr><td style="background:white;padding:36px 40px"><div style="border-left:3px solid '+faixaCor+';padding-left:14px;margin-bottom:24px"><p style="margin:0;font-size:11px;font-weight:700;color:'+faixaCor+';letter-spacing:1.5px;text-transform:uppercase">'+faixaLabel+'</p><h2 style="margin:4px 0 0;font-size:18px;font-weight:700;color:#0f172a;line-height:1.3">'+titulo+'</h2></div><p style="margin:0 0 28px;font-size:14px;color:#475569;line-height:1.7">'+mensagem+'</p><div style="height:1px;background:#e2e8f0;margin:0 0 24px"></div><p style="margin:0 0 16px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:2px;text-transform:uppercase">Opcoes de pagamento</p>'+spix+scartao+'<div style="background:#f0fdf4;border-radius:8px;padding:20px;margin-top:16px;border:1px solid #86efac;text-align:center"><p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#166534">🎓 Portal do Membro LAURO</p><p style="margin:0 0 14px;font-size:12px;color:#374151;line-height:1.6">Acesse o portal e acompanhe sua frequência, pagamentos, comunicados e atividades da Liga — tudo em um só lugar!</p><a href="https://membro.lauroucpcde.com" style="display:inline-block;background:#166534;color:white;padding:11px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px">Acessar Portal do Membro</a></div>'+'<div style="background:#f8fafc;border-radius:8px;padding:16px 20px;margin-top:12px;border:1px solid #e2e8f0"><p style="margin:0;font-size:12px;color:#64748b;line-height:1.7">Em caso de duvidas ou para confirmar o pagamento, entre em contato com a Diretoria Financeira respondendo este e-mail ou via WhatsApp.</p></div></td></tr><tr><td style="background:#0f172a;padding:24px 40px"><table width="100%" cellpadding="0" cellspacing="0"><tr><td><p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;font-weight:600">'+orgNome+'</p><p style="margin:4px 0 0;color:rgba(255,255,255,0.4);font-size:10px">Mensagem automatica</p></td><td align="right" valign="middle">'+rodapeSocial()+'<p style="margin:8px 0 0;color:rgba(255,255,255,0.3);font-size:9px;letter-spacing:1.5px;text-transform:uppercase">Powered by PagBank</p></td></tr></table></td></tr></table></td></tr></table></body></html>';
}

// ─── EMAIL SIMPLES (aviso generico, mesmo layout visual da cobranca) ─────────
function htmlSimples(opts) {
  const titulo=opts.titulo||'';
  const mensagem=opts.mensagem||'';
  const cta=opts.cta||null; // {label,url}
  const faixaLabel=opts.faixaLabel||'AVISO';
  const config=opts.config||{};
  const orgNome=config.org_nome||'Liga Academica de Urologia';
  const orgCor=config.org_cor||'#1a56db';
  const orgLogo=config.org_logo||null;
  const corEsc='#0a1f5c';
  const logoHtml=orgLogo
    ?'<img src="'+orgLogo+'" alt="'+orgNome+'" style="max-height:84px;max-width:230px;object-fit:contain;display:block;margin:0 auto">'
    :'<span style="color:white;font-size:20px;font-weight:800;letter-spacing:-0.5px">'+orgNome+'</span>';
  const cab='<div style="background:linear-gradient(160deg,'+orgCor+' 0%,'+corEsc+' 100%);padding:36px 40px;text-align:center">'
    +logoHtml
    +'<div style="margin-top:16px;display:inline-block;background:rgba(255,255,255,0.15);border-radius:4px;padding:4px 16px">'
    +'<span style="color:rgba(255,255,255,0.9);font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase">'+faixaLabel+'</span>'
    +'</div></div>';
  const ctaHtml=cta
    ?'<div style="text-align:center;margin-top:8px"><a href="'+cta.url+'" style="display:inline-block;background:'+orgCor+';color:white;padding:12px 32px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px">'+cta.label+'</a></div>'
    :'';
  const tituloHtml=titulo
    ?'<div style="border-left:3px solid '+orgCor+';padding-left:14px;margin-bottom:24px"><h2 style="margin:0;font-size:18px;font-weight:700;color:#0f172a;line-height:1.3">'+titulo+'</h2></div>'
    :'';
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f1f5f9"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:40px 16px"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td>'+cab+'</td></tr><tr><td style="background:white;padding:36px 40px">'+tituloHtml+'<div style="margin:0 0 8px;font-size:14px;color:#475569;line-height:1.7">'+mensagem+'</div>'+ctaHtml+'</td></tr><tr><td style="background:#0f172a;padding:24px 40px"><table width="100%" cellpadding="0" cellspacing="0"><tr><td><p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;font-weight:600">'+orgNome+'</p><p style="margin:4px 0 0;color:rgba(255,255,255,0.4);font-size:10px">Mensagem automatica</p></td><td align="right" valign="middle">'+rodapeSocial()+'</td></tr></table></td></tr></table></td></tr></table></body></html>';
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

  const cabWpp = '*' + orgNome + '* 🏥\n\n';
  // Direciona ao Portal do Membro em vez de mandar PIX/link no WhatsApp: mensagem mais
  // curta, um unico link de canal proprio (que eles ja conhecem), sem codigo solto —
  // melhor para o membro e menor risco de ban. PIX/cartao completos ficam no e-mail.
  const portalWpp = '💳 Para pagar e ver o boleto/PIX, acesse o *Portal do Membro*:\nhttps://membro.lauroucpcde.com\n\n';

  const msgWppMap = {
    pre: cabWpp
      + 'Olá, *' + dados.nome + '*! 👋\n\n'
      + '⚠️ Sua mensalidade vence em *' + dados.dias + ' dias* (' + dados.data + ').\n\n'
      + '💰 Com desconto: *' + dados.valor_desc + '*\n'
      + '💰 Sem desconto: ' + dados.valor_cheio + '\n\n'
      + portalWpp
      + 'Dúvidas? Estamos à disposição! 😊',

    dia: cabWpp
      + 'Olá, *' + dados.nome + '*! 👋\n\n'
      + '⏰ *HOJE* é o último dia com desconto!\n\n'
      + '💰 Com desconto: *' + dados.valor_desc + '*\n'
      + '💰 Sem desconto: ' + dados.valor_cheio + '\n\n'
      + portalWpp
      + 'Não perca o desconto! 🙏',

    pos: cabWpp
      + 'Olá, *' + dados.nome + '*!\n\n'
      + '❗ Sua mensalidade está *em atraso* desde ' + dados.data + '.\n\n'
      + '💰 Valor: *' + dados.valor_cheio + '*\n\n'
      + portalWpp
      + 'Por favor, regularize sua situação pelo portal. 🙏'
  };

  // ── WhatsApp (API Oficial da Meta). Cobrança é mensagem iniciada pela empresa —
  // precisa de modelo aprovado (submetido em 2026-07-15, status pendente de aprovação
  // da Meta). Até aprovar, isso falha e o e-mail acima/abaixo segue como canal garantido.
  if (membro.whatsapp && opts.canal !== 'email') {
    const { enviarTemplate } = require('./whatsapp-oficial');
    const TEMPLATE_COBRANCA = { pre: 'cobranca_pre_vencimento', dia: 'cobranca_vencimento_hoje', pos: 'cobranca_atraso' };
    const paramsPorTipo = {
      pre: [dados.nome, orgNome, String(dados.dias), dados.data, dados.valor_desc, dados.valor_cheio],
      dia: [dados.nome, orgNome, dados.valor_desc, dados.valor_cheio],
      pos: [dados.nome, orgNome, dados.data, dados.valor_cheio]
    };
    const componentes = [{ type: 'body', parameters: paramsPorTipo[tipo].map(text => ({ type: 'text', text })) }];
    const r1 = await enviarTemplate(membro.whatsapp, TEMPLATE_COBRANCA[tipo], 'pt_BR', componentes);
    const wamid1 = r1.ok && r1.data && r1.data.messages && r1.data.messages[0] ? r1.data.messages[0].id : null;
    await query(
      'INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status,wamid,entrega) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [membro.id, cobranca.id, tipo, 'whatsapp', r1.ok ? 'ok' : 'erro', wamid1, r1.ok ? 'sent' : null]
    );
  }

  // ── Email
  if (membro.email && opts.canal !== 'whatsapp') {
    const msgHtml = htmlCobranca({
      titulo:     tituloMap[tipo] || '',
      mensagem:   'Prezado(a) ' + dados.nome + ', segue abaixo as opcoes para pagamento da sua mensalidade de ' + dados.valor_desc + ' (com desconto de pontualidade).',
      linkCartao,
      pixCode,
      qrUrl: cobranca.pix_qr_image || null,
      orgNome,
      orgCor,
      orgLogo,
      tipoCob: tipo
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
  // membro_id nao tem FK, entao guarda o id da pessoa (membro/ligante/diretivo). A dedup
  // usa (membro_id + tipo): tipo='aniversario' p/ membro, 'aniversario_ligante'/'_diretivo'
  // p/ os demais — evita colisao de id entre tabelas sem precisar de coluna nova.
  const membroId = opts.membroId !== undefined ? opts.membroId : membro.id;
  const logTipo  = opts.logTipo || 'aniversario';

  const msgWpp = '🎂 *' + orgNome + '*\n\nOlá, *' + membro.nome.split(' ')[0] + '*!\n\n' + msg + '\n\nCom carinho de toda a equipe! 💙';

  if (membro.whatsapp) {
    // Aniversário também é mensagem iniciada pela empresa — modelo aprovado
    // (submetido em 2026-07-15, aguardando aprovação da Meta).
    const { enviarTemplate } = require('./whatsapp-oficial');
    const componentes = [{ type: 'body', parameters: [
      { type: 'text', text: membro.nome.split(' ')[0] },
      { type: 'text', text: orgNome }
    ] }];
    const r = await enviarTemplate(membro.whatsapp, 'aniversario_parabens', 'pt_BR', componentes);
    const wamidAniv = r.ok && r.data && r.data.messages && r.data.messages[0] ? r.data.messages[0].id : null;
    await query(
      'INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status,wamid,entrega) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [membroId, null, logTipo, 'whatsapp', r.ok ? 'ok' : 'erro', wamidAniv, r.ok ? 'sent' : null]
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
      [membroId, null, logTipo, 'email', r.ok ? 'ok' : 'erro']
    );
  }
}

module.exports = { enviarWhatsApp, enviarEmail, notificarCobranca, notificarAniversario, htmlCobranca, htmlSimples };
