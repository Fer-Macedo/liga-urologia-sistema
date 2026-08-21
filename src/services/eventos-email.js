// Extraído de routes/index.js: chamado tanto pelas rotas de eventos quanto pelo
// webhook do PagBank (routes/index.js), que confirma pagamento de ingresso.
const { query } = require('../models/database');
const { getConfig } = require('./config');
const { enviarEmail } = require('./email');

// Texto padrão do email de confirmação (com {nombre}/{evento} pra substituir). Usado como
// fallback no envio E como valor inicial ao criar um evento (rotas/eventos.js) — antes só
// existia aqui dentro da função, então todo evento novo nascia com o campo vazio na tela de
// edição, e quem criava o evento tinha que lembrar de colar o texto de um evento anterior.
const TEXTO_CONFIRMACAO_PADRAO = '<p>Estimado/a <strong>{nombre}</strong>,</p><p>Confirmamos su inscripción al evento <strong>{evento}</strong>.</p><p>Próximamente recibirá un correo electrónico con toda la información del evento, incluyendo:</p><ul><li>Fecha y hora</li><li>Lugar</li><li>Instrucciones importantes para la participación</li></ul><p>Le recomendamos prestar atención a las instrucciones y ser puntual el día del evento. También le recomendamos unirse al grupo de WhatsApp del evento para recibir toda la información y mantenerse al día con las indicaciones del equipo organizador.</p><p>Si tiene alguna pregunta, no dude en contactarnos.</p><p>Atentamente,<br>Comité Organizador<br>Liga Académica de Urología – LAURO</p>';

async function enviarEmailConfirmacaoEvento(inscricaoId) {
  try {
    const r = await query(
      `SELECT i.*, e.nome as evento_nome, e.email_inscricao, e.wpp_grupo, e.notif_email, e.data_inicio, e.local, e.cor_tema FROM evento_inscricoes i JOIN eventos e ON e.id=i.evento_id WHERE i.id=$1`,
      [inscricaoId]
    );
    const insc = r.rows[0];
    if (!insc || !insc.email) return;
    const config = await getConfig();
    // resend
    const cor = insc.cor_tema || '#1a3d2b';
    const textoExtra = insc.email_inscricao || '';
    var _corpoConf = (textoExtra && textoExtra.replace(/<[^>]*>/g,'').trim().length) ? textoExtra : TEXTO_CONFIRMACAO_PADRAO;
    _corpoConf = _corpoConf.split('{nombre}').join((insc.nome||'').split(' ')[0]).split('{evento}').join(insc.evento_nome||'');
    const dataStr = insc.data_inicio ? new Date(insc.data_inicio).toLocaleDateString('pt-BR', {day:'2-digit',month:'long',year:'numeric',timeZone:'UTC'}) : '';
    const wppBtn = insc.wpp_grupo ? '<a href="'+insc.wpp_grupo+'" style="display:inline-block;background:#25d366;color:white;padding:12px 32px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.5px;text-transform:uppercase"><img src="https://sistema.lauroucpcde.com/img/whatsapp-white.svg" width="18" height="18" style="vertical-align:middle;margin-right:8px;display:inline" alt="">Unirse al grupo del evento</a>' : '';
    const html = '<div style="border-left:3px solid '+cor+';padding-left:14px;margin-bottom:24px"><p style="margin:0;font-size:11px;font-weight:700;color:'+cor+';letter-spacing:1.5px;text-transform:uppercase">CONFIRMACIÓN DE INSCRIPCIÓN</p><h2 style="margin:4px 0 0;font-size:20px;font-weight:700;color:#0f172a">'+insc.evento_nome+'</h2></div>'
      +_corpoConf
      +(wppBtn?'<div style="text-align:center;padding-bottom:24px">'+wppBtn+'</div>':'')
      +'<div style="text-align:center;margin:24px 0;padding:24px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0">'
      +'<p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px">Su código QR de check-in</p>'
      +'<img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data='+encodeURIComponent(insc.qrcode||insc.id)+'" style="width:160px;height:160px;border-radius:8px" alt="QR Code">'
      +'<p style="margin:12px 0 0;font-size:11px;color:#94a3b8">Presente este código QR en la entrada del evento</p>'
      +'<p style="margin:6px 0 0;font-size:12px;font-family:monospace;color:#475569;font-weight:600">'+insc.qrcode+'</p>'
      +'</div>';
    await enviarEmail({ from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>', to: insc.email, subject: 'Inscripción confirmada — ' + insc.evento_nome, html, faixaLabel: 'INSCRIPCIÓN CONFIRMADA' });
    await query('UPDATE evento_inscricoes SET confirmacao_email_enviado_em=NOW() WHERE id=$1', [inscricaoId]);
    if (insc.notif_email) {
      await enviarEmail({ from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>', to: insc.notif_email, subject: 'Pagamento confirmado — ' + insc.nome + ' | ' + insc.evento_nome, html: '<p>Confirmado: <strong>' + insc.nome + '</strong> — ' + insc.evento_nome + '</p>' }).catch(() => {});
    }
    console.log('Email confirmacao enviado:', insc.email);
  } catch(e) { console.error('enviarEmailConfirmacaoEvento ERRO:', e.message); }
}

module.exports = { enviarEmailConfirmacaoEvento, TEXTO_CONFIRMACAO_PADRAO };
