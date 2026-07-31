// Meio-termo decidido com o usuário (2026-07-30): a decisão OFICIAL (aprovar/devolver para
// correção) continua sempre humana — Secretaria, com Presidência/Admin de apoio (mesma
// permissão que já existia nas rotas /devolver-correccion e /aprobar-final). O que ficou
// automático é o trabalho de ANTES da decisão: baixar o anexo que a Coordinación mandou e
// ler o e-mail pra saber do que se trata, sem abrir o Gmail.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/projeto-email-detect.js');

// Helper: monta um payload Gmail simplificado — multipart com texto (base64url) + 1 anexo.
function payloadComTextoEAnexo(texto, anexo) {
  const b64url = s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  const parts = [{ mimeType: 'text/plain', body: { data: b64url(texto) } }];
  if (anexo) parts.push({ filename: anexo.filename, mimeType: anexo.mimeType || 'application/pdf', body: { attachmentId: 'ATT1' } });
  return { mimeType: 'multipart/mixed', parts };
}

function montar({ ultimaMsgId = 'MSG_NOVO', deQuem = 'coordinacion@ligas.edu.py', payload = null, anexoBytes = 'PDFCONTEUDO' } = {}) {
  const anexosSalvos = [];
  const updates = [];
  const pool = {
    query: async (sql, params) => {
      if (/SELECT \* FROM projetos_email_thread WHERE gmail_thread_id/.test(sql)) {
        return { rows: [{ id: 1, projeto_id: 2, gmail_thread_id: 'THREAD_1', ultima_msg_vista: 'MSG_ANTIGO' }] };
      }
      if (/UPDATE projetos_email_thread SET tem_resposta_nova=true/.test(sql)) { updates.push({ sql, params }); return { rows: [] }; }
      if (/UPDATE projetos_email_thread SET tem_resposta_nova=false/.test(sql)) { updates.push({ sql, params }); return { rows: [] }; }
      if (/INSERT INTO projetos_anexos/.test(sql)) { anexosSalvos.push(params); return { rows: [] }; }
      return { rows: [] };
    }
  };

  const rar = require.resolve(path.join(RAIZ, 'src/services/arquivos.js'));
  require.cache[rar] = { id: rar, filename: rar, loaded: true, exports: {
    uploadArquivo: async (buffer, nome, mime) => ({ chave: 'k-' + nome })
  }};

  const rgg = require.resolve('googleapis');
  require.cache[rgg] = { id: rgg, filename: rgg, loaded: true, exports: {
    google: {
      gmail: () => ({
        users: {
          threads: { get: async () => ({ data: { messages: [
            { id: 'MSG_ANTIGO', payload: { headers: [{ name: 'From', value: 'lauro@lauro.org' }] } },
            { id: ultimaMsgId, payload: { headers: [
              { name: 'From', value: deQuem }, { name: 'Message-ID', value: '<resp@coord>' }
            ] } }
          ] } }) },
          messages: {
            get: async () => ({ data: { payload: payload || payloadComTextoEAnexo('Sem conteúdo de teste', null) } }),
            attachments: { get: async () => ({ data: { data: Buffer.from(anexoBytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_') } }) }
          }
        }
      })
    }
  }};

  delete require.cache[require.resolve(MODULO)];
  return { mod: require(MODULO), pool, anexosSalvos, updates };
}

test('resposta com anexo: salva com tipo pedido_correccion, sem usuário (veio da Coordinación)', async () => {
  const payload = payloadComTextoEAnexo('Seguem las correcciones solicitadas.', { filename: 'correcciones.pdf' });
  const { mod, pool, anexosSalvos } = montar({ payload });
  await mod.verificarRespostas({}, pool, 'lauro@lauro.org');
  assert.strictEqual(anexosSalvos.length, 1, 'o anexo da resposta tem que ser salvo sozinho, sem a Secretaria baixar/subir na mão');
  const [projetoId, tipo, , nome, , , enviadoPor] = anexosSalvos[0];
  assert.strictEqual(projetoId, 2);
  assert.strictEqual(tipo, 'pedido_correccion');
  assert.strictEqual(nome, 'correcciones.pdf');
  assert.strictEqual(enviadoPor, null, 'ninguém da liga fez esse upload — veio direto da Coordinación');
});

test('texto com sinal de correção: sugestão vira "correcao"', async () => {
  const payload = payloadComTextoEAnexo('Favor revisar el cronograma antes de continuar.', null);
  const { mod, pool, updates } = montar({ payload });
  await mod.verificarRespostas({}, pool, 'lauro@lauro.org');
  const upd = updates.find(u => /tem_resposta_nova=true/.test(u.sql));
  assert.strictEqual(upd.params[3], 'correcao');
});

test('texto com sinal de aprovação: sugestão vira "aprovado"', async () => {
  const payload = payloadComTextoEAnexo('El proyecto fue aprobado por la Coordinación.', null);
  const { mod, pool, updates } = montar({ payload });
  await mod.verificarRespostas({}, pool, 'lauro@lauro.org');
  const upd = updates.find(u => /tem_resposta_nova=true/.test(u.sql));
  assert.strictEqual(upd.params[3], 'aprovado');
});

// A parte que mais importa: quando o sinal é ambíguo (ou nenhum), o sistema NUNCA arrisca
// uma sugestão errada numa decisão oficial — melhor não sugerir nada.
test('texto ambíguo (aprovação E correção juntas): não arrisca, sugestão fica nula', async () => {
  const payload = payloadComTextoEAnexo('El proyecto fue aprobado, pero favor revisar el anexo 2.', null);
  const { mod, pool, updates } = montar({ payload });
  await mod.verificarRespostas({}, pool, 'lauro@lauro.org');
  const upd = updates.find(u => /tem_resposta_nova=true/.test(u.sql));
  assert.strictEqual(upd.params[3], null);
});

test('texto sem nenhum sinal: sugestão fica nula, mas o resumo é salvo', async () => {
  const payload = payloadComTextoEAnexo('Gracias por el envío, quedamos a la espera.', null);
  const { mod, pool, updates } = montar({ payload });
  await mod.verificarRespostas({}, pool, 'lauro@lauro.org');
  const upd = updates.find(u => /tem_resposta_nova=true/.test(u.sql));
  assert.strictEqual(upd.params[3], null);
  assert.match(upd.params[4], /espera/);
});

test('resumo é salvo e cortado em 500 caracteres', async () => {
  const payload = payloadComTextoEAnexo('X'.repeat(800), null);
  const { mod, pool, updates } = montar({ payload });
  await mod.verificarRespostas({}, pool, 'lauro@lauro.org');
  const upd = updates.find(u => /tem_resposta_nova=true/.test(u.sql));
  assert.strictEqual(upd.params[4].length, 500);
});

// Quando a LIGA escreve de novo (reenvio de correção), a sugestão antiga não pode
// continuar valendo pra próxima rodada de resposta da Coordinación.
test('quando a liga responde de novo, a sugestão e o resumo antigos são apagados', async () => {
  const { mod, pool, updates } = montar({ deQuem: 'lauro@lauro.org', ultimaMsgId: 'MSG_NOSSO' });
  await mod.verificarRespostas({}, pool, 'lauro@lauro.org');
  const upd = updates.find(u => /tem_resposta_nova=false/.test(u.sql));
  assert.ok(upd, 'tem que atualizar o "visto" quando a última mensagem é nossa');
  assert.match(upd.sql, /sugestao_status=NULL/);
  assert.match(upd.sql, /resposta_resumo=NULL/);
});

// Sem anexo, não tenta baixar nada (não quebra, não gera lixo).
test('resposta sem anexo: não tenta salvar nenhum arquivo', async () => {
  const payload = payloadComTextoEAnexo('Todo en orden, sin observaciones.', null);
  const { mod, pool, anexosSalvos } = montar({ payload });
  await mod.verificarRespostas({}, pool, 'lauro@lauro.org');
  assert.strictEqual(anexosSalvos.length, 0);
});
