// ═══ SERVIÇO DE EMAIL DOS PROJETOS (Gmail API, thread única por projeto) ═══
// Envia emails pela conta oficial da liga, mantendo toda a conversa de um projeto
// na MESMA thread do Gmail (como a coordenação exige).
const { google } = require('googleapis');

// Monta um email no formato RFC 2822 (MIME) com anexos, codificado em base64url
function montarMime({ from, to, subject, corpoHtml, anexos, inReplyTo, references }) {
  const boundary = 'lauro_' + Date.now().toString(36);
  let headers = '';
  headers += 'From: ' + from + '\r\n';
  headers += 'To: ' + to + '\r\n';
  headers += 'Subject: =?UTF-8?B?' + Buffer.from(subject).toString('base64') + '?=\r\n';
  if (inReplyTo) headers += 'In-Reply-To: ' + inReplyTo + '\r\n';
  if (references) headers += 'References: ' + references + '\r\n';
  headers += 'MIME-Version: 1.0\r\n';
  headers += 'Content-Type: multipart/mixed; boundary="' + boundary + '"\r\n\r\n';

  let body = '';
  // Parte do texto/HTML
  body += '--' + boundary + '\r\n';
  body += 'Content-Type: text/html; charset="UTF-8"\r\n';
  body += 'Content-Transfer-Encoding: base64\r\n\r\n';
  body += Buffer.from(corpoHtml, 'utf8').toString('base64') + '\r\n\r\n';

  // Anexos
  for (const a of (anexos || [])) {
    body += '--' + boundary + '\r\n';
    body += 'Content-Type: ' + (a.mimetype || 'application/octet-stream') + '; name="' + a.nome + '"\r\n';
    body += 'Content-Disposition: attachment; filename="' + a.nome + '"\r\n';
    body += 'Content-Transfer-Encoding: base64\r\n\r\n';
    body += a.buffer.toString('base64') + '\r\n\r\n';
  }
  body += '--' + boundary + '--';

  const mensagem = headers + body;
  // base64url
  return Buffer.from(mensagem, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Envia (ou continua) o email de um projeto.
// authClient: cliente OAuth da liga (getClientAtualizado)
// pool: conexão pg
// opts: { projetoId, to, from, subject, corpoHtml, anexos }
// Se já existe thread para o projeto, envia NA MESMA thread (mantém o fio).
async function enviarEmailProjeto(authClient, pool, opts) {
  const gmail = google.gmail({ version: 'v1', auth: authClient });
  const { projetoId, to, from, subject, corpoHtml, anexos } = opts;

  // Busca a thread existente do projeto
  const tRes = await pool.query('SELECT * FROM projetos_email_thread WHERE projeto_id=$1 ORDER BY id DESC LIMIT 1', [projetoId]);
  const threadInfo = tRes.rows[0];

  let inReplyTo = null, references = null, threadId = null, assunto = subject;
  if (threadInfo && threadInfo.gmail_thread_id) {
    threadId = threadInfo.gmail_thread_id;
    inReplyTo = threadInfo.gmail_message_id;
    references = threadInfo.gmail_message_id;
    // Reusa o assunto original com "Re:" para manter o fio visual
    assunto = threadInfo.assunto ? (threadInfo.assunto.startsWith('Re:') ? threadInfo.assunto : 'Re: ' + threadInfo.assunto) : subject;
  }

  const raw = montarMime({ from, to, subject: assunto, corpoHtml, anexos, inReplyTo, references });

  const sendReq = { userId: 'me', requestBody: { raw } };
  if (threadId) sendReq.requestBody.threadId = threadId;

  const sent = await gmail.users.messages.send(sendReq);
  const messageId = sent.data.id;
  const newThreadId = sent.data.threadId;

  // Pega o header Message-ID real da mensagem enviada (para o próximo In-Reply-To)
  let rfcMessageId = messageId;
  try {
    const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'metadata', metadataHeaders: ['Message-ID'] });
    const h = (msg.data.payload.headers || []).find(x => x.name.toLowerCase() === 'message-id');
    if (h) rfcMessageId = h.value;
  } catch (e) { /* usa o id interno como fallback */ }

  // Salva/atualiza a thread do projeto
  if (threadInfo) {
    await pool.query('UPDATE projetos_email_thread SET gmail_thread_id=$1, gmail_message_id=$2, updated_at=NOW() WHERE id=$3',
      [newThreadId, rfcMessageId, threadInfo.id]);
  } else {
    await pool.query('INSERT INTO projetos_email_thread (projeto_id, gmail_thread_id, gmail_message_id, assunto) VALUES ($1,$2,$3,$4)',
      [projetoId, newThreadId, rfcMessageId, subject]);
  }

  return { messageId, threadId: newThreadId, assunto };
}

module.exports = { enviarEmailProjeto };
