// 11/08/2026: já existia lembrete automático (cron a cada hora) pra inscrição de evento
// pendente há 2-48h, mas sem jeito de disparar na hora quando a equipe percebe que alguém
// específico ainda não pagou. Extraído o envio de UMA inscrição pra função reutilizável
// (enviarLembreteInscricaoPendente), usada tanto pelo cron quanto por um botão manual novo
// em evento-detalhe.ejs — e confirmando que o WhatsApp sai pela API oficial, nunca pela W-API
// (W-API é só pro assistente responder, disparo é regra fixa do projeto).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

function montarAgendamentos({ inscricao, whatsappLanca, emailLanca } = {}) {
  const chamadasWhatsapp = [];
  const chamadasEmail = [];
  const inserts = [];

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT chave,valor FROM configuracoes/.test(sql)) return { rows: [] };
      if (/SELECT ei\.id, ei\.nome, ei\.email, ei\.whatsapp, e\.nome as evento_nome/.test(sql)) {
        return { rows: inscricao && inscricao.id === params[0] ? [inscricao] : [] };
      }
      if (/INSERT INTO notificacoes_log/.test(sql)) { inserts.push(params); return { rows: [] }; }
      return { rows: [] };
    }
  }};
  const rpg = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  require.cache[rpg] = { id: rpg, filename: rpg, loaded: true, exports: {
    criarCobranca: async () => ({}), consultarPagamento: async () => ({}), consultarCheckout: async () => ({}),
    detectarMetodo: () => 'pix', extrairDataPagamento: () => null, extrairValorPago: () => 0
  }};
  const rnt = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rnt] = { id: rnt, filename: rnt, loaded: true, exports: {
    notificarCobranca: async () => {}, notificarAniversario: async () => {},
    enviarWhatsApp: async (numero, msg) => { chamadasWhatsapp.push({ numero, msg }); if (whatsappLanca) throw new Error(whatsappLanca); },
    enviarEmail: async (opts) => { chamadasEmail.push(opts); if (emailLanca) throw new Error(emailLanca); }
  }};
  const rwo = require.resolve(path.join(RAIZ, 'src/services/whatsapp-oficial.js'));
  require.cache[rwo] = { id: rwo, filename: rwo, loaded: true, exports: { enviarTexto: async () => { throw new Error('não deveria ser chamado — agendamentos.js usa notificacoes.enviarWhatsApp, não whatsapp-oficial direto'); } } };

  delete require.cache[require.resolve(path.join(RAIZ, 'src/services/agendamentos.js'))];
  const mod = require(path.join(RAIZ, 'src/services/agendamentos.js'));
  return { mod, chamadasWhatsapp, chamadasEmail, inserts };
}

const inscricaoBase = { id: 42, nome: 'Ana Paula Souza', email: 'ana@example.com', whatsapp: '595994000000', evento_nome: 'Congresso 2026' };

test('envia WhatsApp + e-mail e registra os dois no log', async () => {
  const { mod, chamadasWhatsapp, chamadasEmail, inserts } = montarAgendamentos({ inscricao: inscricaoBase });
  const r = await mod.enviarLembreteInscricaoPendente(42);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(chamadasWhatsapp.length, 1);
  assert.strictEqual(chamadasWhatsapp[0].numero, '595994000000');
  assert.match(chamadasWhatsapp[0].msg, /Congresso 2026/);
  assert.strictEqual(chamadasEmail.length, 1);
  assert.strictEqual(chamadasEmail[0].para, 'ana@example.com');
  assert.strictEqual(inserts.length, 2, 'um log pra whatsapp, um pra email');
});

test('inscrição inexistente devolve ok:false sem tentar enviar nada', async () => {
  const { mod, chamadasWhatsapp, chamadasEmail } = montarAgendamentos({ inscricao: null });
  const r = await mod.enviarLembreteInscricaoPendente(999);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(chamadasWhatsapp.length, 0);
  assert.strictEqual(chamadasEmail.length, 0);
});

test('sem WhatsApp cadastrado, ainda manda o e-mail e conta como sucesso', async () => {
  const semWpp = Object.assign({}, inscricaoBase, { whatsapp: null });
  const { mod, chamadasWhatsapp, chamadasEmail } = montarAgendamentos({ inscricao: semWpp });
  const r = await mod.enviarLembreteInscricaoPendente(42);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(chamadasWhatsapp.length, 0);
  assert.strictEqual(chamadasEmail.length, 1);
});

test('WhatsApp falha mas email vai — ainda é sucesso parcial (ok:true)', async () => {
  const { mod } = montarAgendamentos({ inscricao: inscricaoBase, whatsappLanca: 'erro de rede' });
  const r = await mod.enviarLembreteInscricaoPendente(42);
  assert.strictEqual(r.ok, true, 'email sozinho já basta pra contar como enviado');
  assert.strictEqual(r.wppOk, false);
  assert.strictEqual(r.emailOk, true);
});

test('os dois canais falham — ok:false, sem log nenhum gravado', async () => {
  const { mod, inserts } = montarAgendamentos({ inscricao: inscricaoBase, whatsappLanca: 'erro', emailLanca: 'erro' });
  const r = await mod.enviarLembreteInscricaoPendente(42);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(inserts.length, 0);
});
