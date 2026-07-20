// O webhook é a porta de entrada do atendimento. Os filtros aqui não são detalhe: sem
// eles o assistente responde a si mesmo (laço infinito), responde grupo, ou responde
// duas vezes quando a W-API reentrega o evento.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/whatsapp-wapi.js');

// Monta o webhook com o lauro dublado e devolve um disparador de requisições.
function montar() {
  const processadas = [];
  const rl = require.resolve(path.join(RAIZ, 'src/services/lauro.js'));
  require.cache[rl] = { id: rl, filename: rl, loaded: true, exports: {
    processarMensagem: (numero, texto, midia) => { processadas.push({ numero, texto, midia }); }
  }};

  let handler = null;
  const router = { post: (rota, fn) => { if (rota === '/webhook/whatsapp') handler = fn; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);

  const enviar = async (body, query = {}) => {
    let status = null;
    await handler({ body, query }, { sendStatus: (s) => { status = s; } });
    return status;
  };
  return { enviar, processadas };
}

const MSG = {
  messageId: 'm1', fromMe: false, isGroup: false,
  sender: { id: '595994316286@s.whatsapp.net' },
  msgContent: { conversation: 'quero falar com a secretaria' }
};

test('mensagem normal chega no assistente', async () => {
  const { enviar, processadas } = montar();
  assert.strictEqual(await enviar(MSG), 200);
  assert.strictEqual(processadas.length, 1);
  assert.strictEqual(processadas[0].numero, '595994316286');
  assert.strictEqual(processadas[0].texto, 'quero falar com a secretaria');
});

// Sem este filtro o assistente lê a própria resposta como pergunta nova e nunca para.
test('mensagem enviada pelo próprio número é ignorada', async () => {
  const { enviar, processadas } = montar();
  await enviar({ ...MSG, fromMe: true });
  assert.strictEqual(processadas.length, 0);
});

test('grupo, broadcast e newsletter não acionam o assistente', async () => {
  const { enviar, processadas } = montar();
  await enviar({ ...MSG, messageId: 'g1', isGroup: true });
  await enviar({ ...MSG, messageId: 'g2', isGroup: false, sender: { id: '12036@g.us' } });
  await enviar({ ...MSG, messageId: 'g3', isGroup: false, sender: { id: 'status@broadcast' } });
  await enviar({ ...MSG, messageId: 'g4', isGroup: false, sender: { id: '99@newsletter' } });
  assert.strictEqual(processadas.length, 0);
});

// A W-API reentrega o evento se demorar o 200. Sem dedup, o membro recebe a resposta 2x.
test('reentrega do mesmo messageId não gera resposta duplicada', async () => {
  const { enviar, processadas } = montar();
  await enviar(MSG);
  await enviar(MSG);
  await enviar(MSG);
  assert.strictEqual(processadas.length, 1);
});

test('mensagem sem texto e sem mídia é descartada', async () => {
  const { enviar, processadas } = montar();
  await enviar({ ...MSG, msgContent: {} });
  assert.strictEqual(processadas.length, 0);
});

// Contas novas do WhatsApp chegam com id @lid, que não é telefone. Se o número saísse
// dali, o assistente responderia para um destinatário inexistente.
test('formato @lid usa o número real do campo sender', async () => {
  const { enviar, processadas } = montar();
  await enviar({
    messageId: 'lid1', fromMe: false,
    sender: '595994316286@s.whatsapp.net',
    msgContent: { conversation: 'oi' }
  });
  assert.strictEqual(processadas[0].numero, '595994316286');
});

test('imagem sem legenda ainda aciona o assistente', async () => {
  const { enviar, processadas } = montar();
  await enviar({
    messageId: 'i1', fromMe: false, sender: { id: '595994316286@s.whatsapp.net' },
    msgContent: {}, image: { imageUrl: 'https://x/i.png' }
  });
  assert.strictEqual(processadas.length, 1);
  assert.strictEqual(processadas[0].midia.tipo, 'image');
});

// O segredo é o que impede alguém que descubra a URL de injetar mensagem no assistente.
test('com segredo configurado, requisição sem o segredo é recusada', async () => {
  process.env.WAPI_WEBHOOK_SECRET = 's3cr3t';
  try {
    const { enviar, processadas } = montar();
    await enviar({ ...MSG, messageId: 'x1' }, {});
    assert.strictEqual(processadas.length, 0, 'sem o segredo não pode passar');
    await enviar({ ...MSG, messageId: 'x2' }, { secret: 's3cr3t' });
    assert.strictEqual(processadas.length, 1, 'com o segredo certo passa');
  } finally { delete process.env.WAPI_WEBHOOK_SECRET; }
});

// Rajada = laço ou robô. Conversa humana nunca passa de 20 mensagens no mesmo minuto.
test('rajada do mesmo número é freada depois de 20 mensagens', async () => {
  const { enviar, processadas } = montar();
  for (let i = 0; i < 30; i++) {
    await enviar({ ...MSG, messageId: 'r' + i });
  }
  assert.strictEqual(processadas.length, 20);
});

test('o webhook sempre responde 200, mesmo com payload lixo', async () => {
  const { enviar } = montar();
  assert.strictEqual(await enviar(null), 200);
  assert.strictEqual(await enviar('texto solto'), 200);
  assert.strictEqual(await enviar({}), 200);
});
