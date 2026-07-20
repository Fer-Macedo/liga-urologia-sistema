// A queda da W-API é silenciosa: instância desconectada simplesmente para de chamar o
// webhook, sem erro nenhum do lado do sistema. Foi assim no primeiro teste do número novo.
// Esta vigia existe para isso — e o que ela NÃO pode fazer é virar e-mail repetido, senão
// a equipe passa a ignorar.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/wapi-vigia.js');

function comCenario({ canal = 'wapi' } = {}) {
  const emails = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async () => ({ rows: [{ email: 'presidencia@teste' }] })
  }};
  const rn = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rn] = { id: rn, filename: rn, loaded: true, exports: {
    enviarEmail: async (o) => { emails.push(o); return { ok: true }; }
  }};

  let resposta = { ok: true, data: { connected: true } };
  const rw = require.resolve(path.join(RAIZ, 'src/services/whatsapp-wapi.js'));
  require.cache[rw] = { id: rw, filename: rw, loaded: true, exports: {
    statusInstancia: async () => resposta
  }};

  process.env.ASSISTENTE_CANAL = canal;
  delete require.cache[require.resolve(MODULO)];
  const mod = require(MODULO);
  return {
    mod, emails,
    conectado: () => { resposta = { ok: true, data: { connected: true } }; },
    caiu: () => { resposta = { ok: true, data: { connected: false } }; },
    consultaFalhou: () => { resposta = { ok: false, erro: 'timeout' }; }
  };
}

test('conectado o tempo todo → nenhum e-mail', async () => {
  const { mod, emails, conectado } = comCenario();
  conectado();
  await mod.verificar();
  await mod.verificar();
  assert.strictEqual(emails.length, 0);
});

test('ao cair, avisa a presidência com o passo a passo de reconectar', async () => {
  const { mod, emails, conectado, caiu } = comCenario();
  conectado();
  await mod.verificar();
  caiu();
  await mod.verificar();
  assert.strictEqual(emails.length, 1);
  assert.match(emails[0].assunto, /desconectado/i);
  assert.match(emails[0].html, /painel\.w-api\.app/, 'precisa dizer onde reconectar');
  assert.match(emails[0].html, /QR Code/, 'precisa dizer como reconectar');
});

// Alerta que chega a cada 5 minutos vira papel de parede e ninguém lê mais.
test('caída por muito tempo → um e-mail só, não um a cada verificação', async () => {
  const { mod, emails, conectado, caiu } = comCenario();
  conectado();
  await mod.verificar();
  caiu();
  for (let i = 0; i < 10; i++) await mod.verificar();
  assert.strictEqual(emails.length, 1);
});

test('cair, voltar e cair de novo → dois avisos', async () => {
  const { mod, emails, conectado, caiu } = comCenario();
  conectado(); await mod.verificar();
  caiu();      await mod.verificar();
  conectado(); await mod.verificar();
  caiu();      await mod.verificar();
  assert.strictEqual(emails.length, 2);
});

// A W-API fora do ar ou rede ruim não é o mesmo que celular desconectado. Tratar como
// queda geraria alarme falso a cada oscilação.
test('falha ao consultar não dispara alerta', async () => {
  const { mod, emails, conectado, consultaFalhou } = comCenario();
  conectado();
  await mod.verificar();
  consultaFalhou();
  await mod.verificar();
  assert.strictEqual(emails.length, 0);
});

test('primeira verificação já desconectado não alerta — sem estado anterior não há queda', async () => {
  const { mod, emails, caiu } = comCenario();
  caiu();
  await mod.verificar();
  assert.strictEqual(emails.length, 0);
});

test('com o atendimento na API oficial, a vigia nem consulta', async () => {
  const { mod, emails, caiu } = comCenario({ canal: 'oficial' });
  caiu();
  const r = await mod.verificar();
  assert.strictEqual(r.checado, false);
  assert.strictEqual(emails.length, 0);
});
