const { getConfig } = require('./config');

async function enviarEmail({from, to, subject, html, attachments, faixaLabel, titulo}) {
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromAddr = from || 'LAURO <lauroucpcde@lauroucpcde.com>';
  // PADRAO: html que seja fragmento (sem <!doctype>/<html>) e embrulhado no layout padrao.
  if (html && !/<!doctype|<html[\s>]/i.test(html)) {
    const { htmlSimples } = require('./notificacoes');
    html = htmlSimples({ titulo: titulo || '', mensagem: html, faixaLabel: faixaLabel || 'AVISO', config: await getConfig() });
  }
  const opts = { from: fromAddr, to, subject, html };
  if(attachments && attachments.length) opts.attachments = attachments;
  console.log('ENVIANDO EMAIL opts.attachments:', opts.attachments ? opts.attachments.length : 0);
  const result = await resend.emails.send(opts);
  console.log('RESEND RAW:', JSON.stringify(result));
  // O SDK do Resend NÃO lança exceção em erro da API (domínio não verificado, quota,
  // etc.) — só devolve { data: null, error: {...} }. Sem essa checagem, todo chamador
  // (que espera try/catch) via "sucesso" mesmo com o e-mail nunca saindo (11/08/2026).
  if (result && result.error) {
    throw new Error(result.error.message || 'Falha ao enviar e-mail via Resend.');
  }
  return result;
}

// Retorna um FRAGMENTO (titulo + corpo). O layout padrao do sistema (mesmo da
// cobranca) e aplicado automaticamente no envio por enviarEmail(). Mantido para
// nao precisar alterar as ~7 chamadas existentes.
function emailBonito(titulo, corpo, logo) {
  var tit = titulo ? '<h2 style="margin:0 0 18px;font-size:18px;font-weight:700;color:#0f172a;line-height:1.3">'+titulo+'</h2>' : '';
  return tit + corpo;
}

module.exports = { enviarEmail, emailBonito };
