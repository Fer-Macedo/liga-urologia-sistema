// O adaptador da W-API é o transporte do atendimento. O que não pode acontecer:
// mandar mensagem sem credencial e dizer que deu certo (o membro fica sem resposta e
// ninguém percebe), ou deixar o formato do número quebrar o envio.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/whatsapp-wapi.js');

function comAxios({ falha = false, credenciais = true } = {}) {
  const posts = [];
  const ax = require.resolve('axios');
  require.cache[ax] = { id: ax, filename: ax, loaded: true, exports: {
    post: async (url, corpo, cfg) => {
      posts.push({ url, corpo, cfg });
      if (falha) { const e = new Error('recusado'); e.response = { data: { error: 'instancia desconectada' } }; throw e; }
      return { data: { messageId: 'abc123' } };
    },
    get: async (url, cfg) => { posts.push({ url, cfg }); return { data: { connected: true } }; }
  }};

  if (credenciais) {
    process.env.WAPI_INSTANCE_ID = 'INST1';
    process.env.WAPI_TOKEN = 'TOK1';
  } else {
    delete process.env.WAPI_INSTANCE_ID;
    delete process.env.WAPI_TOKEN;
  }

  delete require.cache[require.resolve(MODULO)];
  return { mod: require(MODULO), posts };
}

test('envia texto no formato que a W-API espera', async () => {
  const { mod, posts } = comAxios();
  const r = await mod.enviarTexto('+595 99431-6286', 'olá');
  assert.strictEqual(r.ok, true);
  assert.match(posts[0].url, /\/send-text\?instanceId=INST1$/);
  assert.strictEqual(posts[0].corpo.phone, '595994316286', 'o número vai só com dígitos');
  assert.strictEqual(posts[0].corpo.message, 'olá');
  assert.strictEqual(posts[0].cfg.headers.Authorization, 'Bearer TOK1');
});

// Se isso devolvesse ok:true, o canal-assistente não cairia para a API Oficial e o
// membro ficaria sem resposta nenhuma — falha silenciosa, a pior espécie.
test('sem credencial devolve erro, nunca sucesso silencioso', async () => {
  const { mod, posts } = comAxios({ credenciais: false });
  const r = await mod.enviarTexto('595994316286', 'olá');
  assert.strictEqual(r.ok, false);
  assert.match(r.erro, /credenciais/);
  assert.strictEqual(posts.length, 0, 'não pode nem tentar chamar a API');
});

test('erro da W-API vira ok:false com o motivo preservado', async () => {
  const { mod } = comAxios({ falha: true });
  const r = await mod.enviarTexto('595994316286', 'olá');
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.erro, { error: 'instancia desconectada' });
});

test('imagem e documento usam seus próprios endpoints', async () => {
  const { mod, posts } = comAxios();
  await mod.enviarImagem('595994316286', 'data:image/png;base64,AAA', 'legenda');
  await mod.enviarDocumento('595994316286', 'data:application/pdf;base64,BBB', 'ata.pdf');
  assert.match(posts[0].url, /\/send-image\?/);
  assert.strictEqual(posts[0].corpo.caption, 'legenda');
  assert.match(posts[1].url, /\/send-document\?/);
  assert.strictEqual(posts[1].corpo.fileName, 'ata.pdf');
});

test('documento sem nome ganha um padrão em vez de ir vazio', async () => {
  const { mod, posts } = comAxios();
  await mod.enviarDocumento('595994316286', 'data:application/pdf;base64,BBB', null);
  assert.strictEqual(posts[0].corpo.fileName, 'arquivo.pdf');
});
