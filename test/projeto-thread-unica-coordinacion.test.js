// A Coordinación de Ligas exige que TODA a conversa de um projeto — nosso primeiro envio,
// as correções que ela pede, o que devolvemos — fique numa ÚNICA thread de e-mail, do
// primeiro envio até o projeto ser aprovado. Cada projeto tem a sua própria thread; vários
// projetos rodando ao mesmo tempo nunca se misturam.
//
// A base do mecanismo (enviarEmailProjeto reusa gmail_thread_id/threadId no send, o
// detector projeto-email-detect só lê e nunca envia por conta própria) já estava correta.
// A varredura achou duas lacunas:
//   1. projetos_email_thread não tinha UNIQUE em projeto_id — a garantia de "uma thread só"
//      dependia inteiramente do código (SELECT antes de INSERT), sem trava no banco. Uma
//      corrida (duplo clique, duas abas) podia criar DUAS threads para o mesmo projeto —
//      exatamente o que a norma proíbe — e ninguém perceberia.
//   2. Quando a Coordinación respondia, o Message-ID guardado para o próximo In-Reply-To
//      continuava sendo o NOSSO último e-mail, não o dela — a thread ainda ficava correta
//      graças ao threadId explícito no send, mas o cabeçalho de resposta ficava desatualizado.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

// ─── enviarEmailProjeto: upsert atômico, nunca duas threads pro mesmo projeto ──

function montarEnvioEmail({ threadExistente = null } = {}) {
  const upserts = [];
  const pool = {
    query: async (sql, params) => {
      if (/SELECT \* FROM projetos_email_thread WHERE projeto_id/.test(sql)) {
        return { rows: threadExistente ? [threadExistente] : [] };
      }
      if (/INSERT INTO projetos_email_thread/.test(sql)) {
        upserts.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
  const authClient = {};
  const rg = require.resolve('googleapis');
  require.cache[rg] = { id: rg, filename: rg, loaded: true, exports: {
    google: {
      gmail: () => ({
        users: {
          messages: {
            send: async (req) => ({ data: { id: 'MSG_NOVO', threadId: req.requestBody.threadId || 'THREAD_NOVO' } }),
            get: async () => ({ data: { payload: { headers: [{ name: 'Message-ID', value: '<msg-novo@lauro>' }] } } })
          }
        }
      })
    }
  }};
  delete require.cache[require.resolve(path.join(RAIZ, 'src/services/projeto-email.js'))];
  const { enviarEmailProjeto } = require(path.join(RAIZ, 'src/services/projeto-email.js'));
  return { enviarEmailProjeto, authClient, pool, upserts };
}

test('primeiro envio: usa ON CONFLICT (upsert), não INSERT puro', async () => {
  const { enviarEmailProjeto, authClient, pool, upserts } = montarEnvioEmail();
  await enviarEmailProjeto(authClient, pool, { projetoId: 2, to: 'coord@ligas.edu.py', from: 'lauro@x.com', subject: 'Proyecto X', corpoHtml: '<p>x</p>', anexos: [] });
  assert.strictEqual(upserts.length, 1);
  assert.match(upserts[0].sql, /ON CONFLICT \(projeto_id\) DO UPDATE/,
    'sem upsert atômico, uma corrida (duplo clique) pode criar DUAS threads pro mesmo projeto');
});

test('reenvio (correção): reusa o threadId existente — nunca abre thread nova', async () => {
  const { enviarEmailProjeto, authClient, pool } = montarEnvioEmail({
    threadExistente: { id: 1, gmail_thread_id: 'THREAD_ANTIGO', gmail_message_id: '<msg-antigo@coord>', assunto: 'Proyecto X' }
  });
  let threadIdEnviado = null;
  const rg = require.resolve('googleapis');
  const origSend = require.cache[rg].exports.google.gmail().users.messages.send;
  // troca o send pra capturar o threadId realmente passado a API
  require.cache[rg].exports.google.gmail = () => ({
    users: {
      messages: {
        send: async (req) => { threadIdEnviado = req.requestBody.threadId; return { data: { id: 'MSG_2', threadId: req.requestBody.threadId } }; },
        get: async () => ({ data: { payload: { headers: [{ name: 'Message-ID', value: '<msg-2@lauro>' }] } } })
      }
    }
  });
  await enviarEmailProjeto(authClient, pool, { projetoId: 2, to: 'coord@ligas.edu.py', from: 'lauro@x.com', subject: 'Proyecto X', corpoHtml: '<p>corrección</p>', anexos: [] });
  assert.strictEqual(threadIdEnviado, 'THREAD_ANTIGO', 'reenvio tem que continuar a MESMA thread, nunca abrir outra');
});

// ─── projeto-email-detect: mantém o Message-ID fresco na resposta da Coordinación ──

function montarDetector({ ultimaMsgId = 'GMAIL_MSG_2', deQuem = 'coordinacion@ligas.edu.py', messageIdHeader = '<resposta@coord>' } = {}) {
  const updates = [];
  const pool = {
    query: async (sql, params) => {
      if (/SELECT \* FROM projetos_email_thread WHERE gmail_thread_id/.test(sql)) {
        return { rows: [{ id: 1, projeto_id: 2, gmail_thread_id: 'THREAD_1', ultima_msg_vista: 'GMAIL_MSG_1' }] };
      }
      if (/UPDATE projetos_email_thread SET tem_resposta_nova=true/.test(sql)) { updates.push({ sql, params }); return { rows: [] }; }
      return { rows: [] };
    }
  };
  const rg = require.resolve('googleapis');
  require.cache[rg] = { id: rg, filename: rg, loaded: true, exports: {
    google: {
      gmail: () => ({
        users: { threads: { get: async () => ({ data: { messages: [
          { id: 'GMAIL_MSG_1', payload: { headers: [{ name: 'From', value: 'lauro@lauro.org' }] } },
          { id: ultimaMsgId, payload: { headers: [
            { name: 'From', value: deQuem },
            ...(messageIdHeader ? [{ name: 'Message-ID', value: messageIdHeader }] : [])
          ] } }
        ] } }) } }
      })
    }
  }};
  delete require.cache[require.resolve(path.join(RAIZ, 'src/services/projeto-email-detect.js'))];
  const { verificarRespostas } = require(path.join(RAIZ, 'src/services/projeto-email-detect.js'));
  return { verificarRespostas, pool, updates };
}

test('resposta da coordenação atualiza o Message-ID para o próximo In-Reply-To', async () => {
  const { verificarRespostas, pool, updates } = montarDetector();
  await verificarRespostas({}, pool, 'lauro@lauro.org');
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].params[2], '<resposta@coord>',
    'sem isso, o próximo envio nosso referenciaria o NOSSO último e-mail, não a resposta dela');
});

test('sem cabeçalho Message-ID na resposta: não perde a referência (mantém a anterior)', async () => {
  const { verificarRespostas, pool, updates } = montarDetector({ messageIdHeader: null });
  await verificarRespostas({}, pool, 'lauro@lauro.org');
  assert.strictEqual(updates[0].params[2], null, 'COALESCE no UPDATE mantém o valor anterior quando o header falta');
});
