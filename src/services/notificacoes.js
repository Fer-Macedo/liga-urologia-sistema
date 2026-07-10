const axios = require('axios');
const nodemailer = require('nodemailer');
const { query } = require('../models/database');
require('dotenv').config();

// ─── FILA DE ENVIO WHATSAPP ───────────────────────────────────────────────────
// Evita banimento enviando em lotes com intervalos seguros
// Configurações: WAPP_LOTE_TAM (padrão 5), WAPP_INTERVALO_MSG (padrão 30s), WAPP_INTERVALO_LOTE (padrão 120s)

const filaEnvio = [];
let filaProcessando = false;

// MODO AQUECIMENTO: suspende disparos proativos de WhatsApp (cobrança, frequência, etc)
// Manter true até o número estar aquecido (~10 dias). Só o assistente virtual funciona.
const WAPP_SOMENTE_RESPOSTA = process.env.WAPP_SOMENTE_RESPOSTA === 'true';

const LOTE_TAM         = parseInt(process.env.WAPP_LOTE_TAM)        || 3;   // msgs por lote (padrao conservador)
const INTERVALO_MSG    = parseInt(process.env.WAPP_INTERVALO_MSG)    || 60;  // segundos-base entre mensagens
const INTERVALO_LOTE   = parseInt(process.env.WAPP_INTERVALO_LOTE)  || 300; // segundos-base entre lotes

function sleep(segundos) {
  return new Promise(r => setTimeout(r, segundos * 1000));
}

const LIMITE_DIARIO = parseInt(process.env.WAPP_LIMITE_DIARIO) || 50;
const HORA_INICIO   = parseInt(process.env.WAPP_HORA_INICIO)   || 8;
const HORA_FIM      = parseInt(process.env.WAPP_HORA_FIM)      || 20;
let enviosHoje = 0;
let ultimoResetDia = new Date().toDateString();
// DISJUNTOR ANTI-BAN: se a W-API falhar em sequencia (sessao caida/banida), para de
// enviar por um tempo em vez de martelar os mesmos numeros — martelar sessao morta
// e acelerador de banimento. Retoma sozinho apos a pausa.
const FALHAS_LIMITE = parseInt(process.env.WAPP_FALHAS_LIMITE) || 5;
const PAUSA_FALHAS_MIN = parseInt(process.env.WAPP_PAUSA_FALHAS_MIN) || 60;
let falhasSeguidas = 0;
let envioPausadoAte = 0;
function resetarContadorDiario() {
  const hoje = new Date().toDateString();
  if (hoje !== ultimoResetDia) { enviosHoje = 0; ultimoResetDia = hoje; console.log('[FILA WAPP] Contador diário resetado'); }
}
function dentroHorarioPermitido() {
  const hora = parseInt(new Date().toLocaleString('pt-BR', { timeZone: 'America/Asuncion', hour: 'numeric', hour12: false }));
  return hora >= HORA_INICIO && hora < HORA_FIM;
}
async function processarFila() {
  if (filaProcessando || filaEnvio.length === 0) return;
  filaProcessando = true;
  resetarContadorDiario();
  if (Date.now() < envioPausadoAte) {
    const faltamMin = Math.ceil((envioPausadoAte - Date.now()) / 60000);
    console.warn(`[FILA WAPP] DISJUNTOR ativo (muitas falhas seguidas). Enviando de novo em ~${faltamMin}min. ${filaEnvio.length} na fila.`);
    filaProcessando = false;
    setTimeout(processarFila, Math.min(envioPausadoAte - Date.now(), 30 * 60 * 1000) + 1000);
    return;
  }
  if (!dentroHorarioPermitido()) {
    console.log(`[FILA WAPP] Fora do horário (${HORA_INICIO}h-${HORA_FIM}h). Tentando em 30min...`);
    filaProcessando = false;
    setTimeout(processarFila, 30 * 60 * 1000);
    return;
  }
  // PROTECAO ANTI-SPAM: nunca processar mais de LOTE_TAM msgs sem pausa
  if (filaEnvio.length > LOTE_TAM) {
    console.log(`[FILA WAPP] Fila grande (${filaEnvio.length} msgs) - processando em lotes com pausa obrigatoria`);
  }
  console.log(`[FILA WAPP] Iniciando ${filaEnvio.length} msg(s) | lote=${LOTE_TAM} | hoje=${enviosHoje}/${LIMITE_DIARIO}`);
  let enviados = 0, erros = 0;
  while (filaEnvio.length > 0) {
    resetarContadorDiario();
    if (enviosHoje >= LIMITE_DIARIO) { console.warn(`[FILA WAPP] Limite diário ${LIMITE_DIARIO} atingido. ${filaEnvio.length} msg(s) pendentes.`); break; }
    if (!dentroHorarioPermitido()) { console.log('[FILA WAPP] Saiu do horário. Pausando.'); break; }
    const lote = filaEnvio.splice(0, LOTE_TAM);
    for (let i = 0; i < lote.length; i++) {
      const { numero, mensagem, resolve } = lote[i];
      if (enviosHoje >= LIMITE_DIARIO) { filaEnvio.unshift(...lote.slice(i)); resolve({ ok: false }); break; }
      try {
        const result = await _enviarWhatsAppDireto(numero, mensagem);
        resolve(result);
        if (result.ok) { enviados++; enviosHoje++; falhasSeguidas = 0; }
        else { erros++; falhasSeguidas++; }
      } catch(e) { resolve({ ok: false }); erros++; falhasSeguidas++; }
      // DISJUNTOR: falhas seguidas = sessao provavelmente caida/banida — pausa e para de martelar
      if (falhasSeguidas >= FALHAS_LIMITE) {
        envioPausadoAte = Date.now() + PAUSA_FALHAS_MIN * 60 * 1000;
        falhasSeguidas = 0;
        console.error(`[FILA WAPP] DISJUNTOR DISPARADO: ${FALHAS_LIMITE} falhas seguidas. Pausando envios por ${PAUSA_FALHAS_MIN}min. Verifique se o numero foi banido/desconectado. ${filaEnvio.length + lote.length - i - 1} msg(s) pendentes.`);
        filaEnvio.unshift(...lote.slice(i + 1));
        filaProcessando = false;
        setTimeout(processarFila, PAUSA_FALHAS_MIN * 60 * 1000 + 1000);
        return;
      }
      if (i < lote.length - 1) {
        // Intervalo com jitter amplo (ate +60%) — espacamento fixo parece robo e e detectado.
        const intervalo = INTERVALO_MSG + Math.floor(Math.random() * Math.max(20, INTERVALO_MSG * 0.6));
        console.log(`[FILA WAPP] Aguardando ${intervalo}s... (${enviosHoje}/${LIMITE_DIARIO} hoje)`);
        await sleep(intervalo);
      }
    }
    if (filaEnvio.length > 0 && enviosHoje < LIMITE_DIARIO && dentroHorarioPermitido()) {
      // Pausa entre lotes com jitter (ate +40%) — evita cadencia previsivel.
      const intervaloLote = INTERVALO_LOTE + Math.floor(Math.random() * Math.max(60, INTERVALO_LOTE * 0.4));
      console.log(`[FILA WAPP] Lote ok. Aguardando ${intervaloLote}s... (${filaEnvio.length} restantes)`);
      await sleep(intervaloLote);
    }
  }
  console.log(`[FILA WAPP] Sessão ok — ${enviados} enviados, ${erros} erros, ${enviosHoje}/${LIMITE_DIARIO} hoje`);
  filaProcessando = false;
}

function formatarNumero(numero) {
  // Remove tudo que nao for numero
  let n = (numero || '').replace(/[^0-9]/g, '');
  // Remove espacos e caracteres especiais
  if (!n) return '';
  return n;
}

// Envia direto para a W-API (sem fila)
async function _enviarWhatsAppDireto(numero, mensagem) {
  const instanceId = process.env.WAPI_INSTANCE_ID;
  const token = process.env.WAPI_TOKEN;
  if (!token || !instanceId) { console.warn('W-API nao configurada'); return { ok: false }; }
  const fone = formatarNumero(numero);
  try {
    const url = 'https://api.w-api.app/v1/message/send-text?instanceId=' + instanceId;
    const { data, status } = await axios.post(
      url,
      { phone: fone, message: mensagem },
      { headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, timeout: 20000 }
    );
    console.log('WhatsApp W-API OK ' + fone + ' — ' + status);
    return { ok: true, data };
  } catch (err) {
    console.error('W-API ERRO ' + fone + ': ' + (err.response ? err.response.status : err.message));
    return { ok: false };
  }
}

// Adiciona à fila (para disparos em massa — cobranças, eventos, etc)
async function enviarWhatsAppFila(numero, mensagem) {
  return new Promise(resolve => {
    filaEnvio.push({ numero, mensagem, resolve });
    // Inicia processamento se ainda não está rodando
    setTimeout(processarFila, 100);
  });
}

// Envio imediato SEM fila (para mensagens urgentes/individuais)
async function enviarWhatsApp(numero, mensagem, opts = {}) {
  // PROTECAO ANTI-BAN: enquanto aquecemos o numero, so o assistente virtual (lauro.js, fora
  // desta funcao) e o aniversario (notificarAniversario, com opts.aniversario=true) ficam liberados.
  // Todo o resto (cobranca, eventos, certificados, avisos em massa etc) fica suspenso aqui, na raiz,
  // para nao depender de cada chamador lembrar de checar a flag.
  if (WAPP_SOMENTE_RESPOSTA && !opts.aniversario) {
    return { ok: false, blocked: true, motivo: 'whatsapp em modo aquecimento — somente assistente e aniversario liberados' };
  }
  // PROTECAO: verificar se envio externo esta permitido
  try {
    const cfg = await query('SELECT valor FROM configuracoes WHERE chave=$1',['wapp_somente_cron']);
    if (cfg.rows.length && cfg.rows[0].valor === '1' && opts.externo) {
      console.warn('[WAPP BLOQUEADO] Envio externo bloqueado - use apenas o cron automatico');
      return { ok: false, blocked: true };
    }
  } catch(e) {}
  if (opts.urgente) {
    // Urgente = direto, sem esperar fila (ex: confirmação de inscrição individual)
    return await _enviarWhatsAppDireto(numero, mensagem);
  }
  // Padrão: passa pela fila para segurança
  return await enviarWhatsAppFila(numero, mensagem);
}

// Info da fila (para exibir no painel admin)
function statusFila() {
  return {
    na_fila: filaEnvio.length,
    processando: filaProcessando,
    config: { lote_tam: LOTE_TAM, intervalo_msg: INTERVALO_MSG, intervalo_lote: INTERVALO_LOTE }
  };
}


// [função enviarWhatsApp substituída pela versão com fila acima]

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
const RODAPE_SOCIAL = '<a href="https://instagram.com/lauroucp.cde" title="Instagram" style="text-decoration:none;display:inline-block;margin-left:14px"><img src="https://sistema.lauroucpcde.com/img/email-instagram.png" alt="Instagram" width="22" height="22" style="display:inline-block;vertical-align:middle;border:0"></a><a href="https://wa.me/595994868368" title="WhatsApp" style="text-decoration:none;display:inline-block;margin-left:14px"><img src="https://sistema.lauroucpcde.com/img/email-whatsapp.png" alt="WhatsApp" width="22" height="22" style="display:inline-block;vertical-align:middle;border:0"></a>';

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
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f1f5f9"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:40px 16px"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td>'+cab+'</td></tr><tr><td style="background:white;padding:36px 40px"><div style="border-left:3px solid '+faixaCor+';padding-left:14px;margin-bottom:24px"><p style="margin:0;font-size:11px;font-weight:700;color:'+faixaCor+';letter-spacing:1.5px;text-transform:uppercase">'+faixaLabel+'</p><h2 style="margin:4px 0 0;font-size:18px;font-weight:700;color:#0f172a;line-height:1.3">'+titulo+'</h2></div><p style="margin:0 0 28px;font-size:14px;color:#475569;line-height:1.7">'+mensagem+'</p><div style="height:1px;background:#e2e8f0;margin:0 0 24px"></div><p style="margin:0 0 16px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:2px;text-transform:uppercase">Opcoes de pagamento</p>'+spix+scartao+'<div style="background:#f0fdf4;border-radius:8px;padding:20px;margin-top:16px;border:1px solid #86efac;text-align:center"><p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#166534">🎓 Portal do Membro LAURO</p><p style="margin:0 0 14px;font-size:12px;color:#374151;line-height:1.6">Acesse o portal e acompanhe sua frequência, pagamentos, comunicados e atividades da Liga — tudo em um só lugar!</p><a href="https://membro.lauroucpcde.com" style="display:inline-block;background:#166534;color:white;padding:11px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px">Acessar Portal do Membro</a></div>'+'<div style="background:#f8fafc;border-radius:8px;padding:16px 20px;margin-top:12px;border:1px solid #e2e8f0"><p style="margin:0;font-size:12px;color:#64748b;line-height:1.7">Em caso de duvidas ou para confirmar o pagamento, entre em contato com a Diretoria Financeira respondendo este e-mail ou via WhatsApp.</p></div></td></tr><tr><td style="background:#0f172a;padding:24px 40px"><table width="100%" cellpadding="0" cellspacing="0"><tr><td><p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;font-weight:600">'+orgNome+'</p><p style="margin:4px 0 0;color:rgba(255,255,255,0.4);font-size:10px">Mensagem automatica</p></td><td align="right" valign="middle">'+RODAPE_SOCIAL+'<p style="margin:8px 0 0;color:rgba(255,255,255,0.3);font-size:9px;letter-spacing:1.5px;text-transform:uppercase">Powered by PagBank</p></td></tr></table></td></tr></table></td></tr></table></body></html>';
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
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f1f5f9"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:40px 16px"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td>'+cab+'</td></tr><tr><td style="background:white;padding:36px 40px">'+tituloHtml+'<div style="margin:0 0 8px;font-size:14px;color:#475569;line-height:1.7">'+mensagem+'</div>'+ctaHtml+'</td></tr><tr><td style="background:#0f172a;padding:24px 40px"><table width="100%" cellpadding="0" cellspacing="0"><tr><td><p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;font-weight:600">'+orgNome+'</p><p style="margin:4px 0 0;color:rgba(255,255,255,0.4);font-size:10px">Mensagem automatica</p></td><td align="right" valign="middle">'+RODAPE_SOCIAL+'</td></tr></table></td></tr></table></td></tr></table></body></html>';
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

  // ── WhatsApp (suspenso no modo aquecimento — WAPP_SOMENTE_RESPOSTA=true)
  // Disparo de cobranca por WhatsApp fica 100% suspenso enquanto aquecemos o numero.
  // Excecao unica liberada: aniversario (notificarAniversario, abaixo) e o assistente virtual (lauro.js).
  if (membro.whatsapp && opts.canal !== 'email' && !WAPP_SOMENTE_RESPOSTA) {
    // ANTI-BAN: nao reenviar a MESMA cobranca de atraso por WhatsApp todo dia ao mesmo
    // numero (padrao de spam). Limita a 1 msg a cada 3 dias no WhatsApp. O EMAIL continua
    // diario (abaixo), entao o atrasado segue sendo cobrado todo dia por email.
    let podeWpp = true;
    if (tipo === 'pos') {
      const recente = await query(
        "SELECT 1 FROM notificacoes_log WHERE cobranca_id=$1 AND canal='whatsapp' AND tipo='pos' AND status='ok' AND enviado_em >= NOW() - INTERVAL '3 days' LIMIT 1",
        [cobranca.id]
      );
      if (recente.rows.length) podeWpp = false;
    }

    if (podeWpp) {
      // Uma unica mensagem (texto + PIX embutido)
      const r1 = await enviarWhatsApp(membro.whatsapp, msgWppMap[tipo] || '');
      await query(
        'INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
        [membro.id, cobranca.id, tipo, 'whatsapp', r1.ok ? 'ok' : 'erro']
      );
    }
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
    const r = await enviarWhatsApp(membro.whatsapp, msgWpp, { aniversario: true });
    await query(
      'INSERT INTO notificacoes_log (membro_id,cobranca_id,tipo,canal,status) VALUES ($1,$2,$3,$4,$5)',
      [membroId, null, logTipo, 'whatsapp', r.ok ? 'ok' : 'erro']
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

module.exports = { enviarWhatsApp, enviarWhatsAppFila, enviarEmail, notificarCobranca, notificarAniversario, statusFila, htmlCobranca, htmlSimples };
