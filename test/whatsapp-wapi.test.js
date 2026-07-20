// O adaptador da W-API é o transporte do atendimento. O que não pode acontecer:
// mandar mensagem sem credencial e dizer que deu certo (o membro fica sem resposta e
// ninguém percebe), ou deixar o formato do número quebrar o envio.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/whatsapp-wapi.js');

// `resolve` controla o que o phone-exists responde: por padrão o número existe e o
// WhatsApp o entrega sem o nono dígito (caso real dos contatos das áreas).
function comAxios({ falha = false, credenciais = true, existe = true, resolvido = null, checagemFalha = false } = {}) {
  const posts = [];
  const gets = [];
  const ax = require.resolve('axios');
  require.cache[ax] = { id: ax, filename: ax, loaded: true, exports: {
    post: async (url, corpo, cfg) => {
      posts.push({ url, corpo, cfg });
      if (falha) { const e = new Error('recusado'); e.response = { data: { error: 'instancia desconectada' } }; throw e; }
      return { data: { messageId: 'abc123' } };
    },
    get: async (url, cfg) => {
      gets.push({ url, cfg });
      if (/phone-exists/.test(url)) {
        if (checagemFalha) throw new Error('rede fora');
        const bruto = (url.match(/phoneNumber=(\d+)/) || [])[1];
        return { data: { exists: existe, phoneNumber: resolvido || bruto } };
      }
      return { data: { connected: true } };
    }
  }};

  if (credenciais) {
    process.env.WAPI_INSTANCE_ID = 'INST1';
    process.env.WAPI_TOKEN = 'TOK1';
  } else {
    delete process.env.WAPI_INSTANCE_ID;
    delete process.env.WAPI_TOKEN;
  }

  delete require.cache[require.resolve(MODULO)];
  return { mod: require(MODULO), posts, gets };
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

// ─── GRAFIA DO NÚMERO BRASILEIRO ─────────────────────────────────────────────
// Os contatos das áreas estão cadastrados com o nono dígito (5579 9 99444808), mas o
// WhatsApp de contas antigas responde sem ele. Na W-API a grafia errada NÃO dá erro:
// devolve 200 com messageId e descarta. Por isso perguntamos antes de enviar.

test('número com nono dígito é entregue na grafia que o WhatsApp usa', async () => {
  const { mod, posts } = comAxios({ resolvido: '557999444808' });
  await mod.enviarTexto('5579999444808', 'aviso de atendimento');
  assert.strictEqual(posts[0].corpo.phone, '557999444808',
    'tem que enviar na grafia resolvida, não na cadastrada');
});

// Sem isso a mensagem sumiria em silêncio — exatamente o prejuízo que isso veio evitar.
test('número sem WhatsApp vira erro visível, não some calado', async () => {
  const { mod, posts } = comAxios({ existe: false });
  const r = await mod.enviarTexto('5541999999999', 'aviso');
  assert.strictEqual(r.ok, false);
  assert.match(r.erro, /sem WhatsApp/);
  assert.strictEqual(posts.length, 0, 'não pode nem tentar enviar');
});

// A checagem é auxiliar: se ela cair, o atendimento não pode parar junto.
test('falha na checagem não bloqueia o envio', async () => {
  const { mod, posts } = comAxios({ checagemFalha: true });
  const r = await mod.enviarTexto('5579999444808', 'aviso');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(posts[0].corpo.phone, '5579999444808', 'segue com o número original');
});

test('a grafia resolvida vale para imagem e documento também', async () => {
  const { mod, posts } = comAxios({ resolvido: '557999444808' });
  await mod.enviarImagem('5579999444808', 'data:image/png;base64,AAA', '');
  await mod.enviarDocumento('5579999444808', 'data:application/pdf;base64,BBB', 'ata.pdf');
  assert.strictEqual(posts[0].corpo.phone, '557999444808');
  assert.strictEqual(posts[1].corpo.phone, '557999444808');
});

// Numa conversa longa seria uma consulta a mais por mensagem, para um dado que não muda.
test('a consulta de grafia é feita uma vez por número', async () => {
  const { mod, gets } = comAxios({ resolvido: '557999444808' });
  await mod.enviarTexto('5579999444808', 'a');
  await mod.enviarTexto('5579999444808', 'b');
  await mod.enviarTexto('5579999444808', 'c');
  assert.strictEqual(gets.filter(g => /phone-exists/.test(g.url)).length, 1);
});

test('conferirNumero diz a grafia real — para a tela de diagnóstico', async () => {
  const { mod } = comAxios({ resolvido: '557999444808' });
  const r = await mod.conferirNumero('5579999444808');
  assert.deepStrictEqual(r, { ok: true, existe: true, numero: '557999444808' });
});
