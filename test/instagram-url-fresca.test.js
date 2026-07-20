// Regressao: o publicador usava a URL assinada guardada no agendamento. Ela expira em
// 24h, entao qualquer post agendado para daqui a mais de um dia publicava com link morto
// e a Meta nao conseguia baixar a imagem. Agora a URL e regenerada a partir da chave.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/instagram.js');

function stub(rel, exports) {
  const r = require.resolve(path.join(RAIZ, rel));
  require.cache[r] = { id: r, filename: r, loaded: true, exports };
}

// roda o processador com um post agendado e devolve as URLs que chegaram na API
async function publicar(post, { falharUrl = false } = {}) {
  const recebidas = [];
  let statusGravado = null;
  stub('src/models/database.js', {
    query: async (sql, p) => {
      if (/SELECT \* FROM instagram_posts/.test(sql)) return { rows: [post] };
      if (/^UPDATE instagram_posts SET status='publicado'/.test(sql)) { statusGravado = 'publicado'; return { rows: [] }; }
      if (/^UPDATE instagram_posts SET status='erro'/.test(sql)) { statusGravado = 'erro'; return { rows: [] }; }
      return { rows: [] };
    }
  });
  stub('src/services/arquivos.js', {
    gerarUrlInline: async (chave) => {
      if (falharUrl) throw new Error('R2 fora do ar');
      return `https://r2/${chave}?assinatura=NOVA`;
    }
  });
  stub('src/services/canva.js', {});
  delete require.cache[require.resolve(MODULO)];
  const ig = require(MODULO);
  // intercepta a chamada real a Meta
  const axios = require('axios');
  const postOriginal = axios.post;
  axios.post = async (url, body) => {
    // o container do carrossel tambem bate em /media, mas sem image_url
    if (/\/media$/.test(url)) { if (body.image_url) recebidas.push(body.image_url); return { data: { id: 'c1' } }; }
    if (/media_publish$/.test(url)) return { data: { id: 'm1' } };
    return { data: {} };
  };
  try { await ig.processarPostsAgendados(); } finally { axios.post = postOriginal; }
  return { recebidas, statusGravado };
}

test('carrossel agendado usa URL regenerada, não a guardada', async () => {
  const r = await publicar({
    id: 1, tipo: 'carousel', legenda: 'x',
    midias: [
      { chave: 'instagram-posts/a.png', url: 'https://r2/a.png?assinatura=VELHA' },
      { chave: 'instagram-posts/b.png', url: 'https://r2/b.png?assinatura=VELHA' }
    ]
  });
  assert.strictEqual(r.recebidas.length, 2);
  r.recebidas.forEach(u => assert.match(u, /assinatura=NOVA/, 'deveria usar a URL nova'));
  r.recebidas.forEach(u => assert.doesNotMatch(u, /VELHA/, 'não pode usar a URL expirada'));
});

test('post de feed usa URL regenerada a partir da chave', async () => {
  const r = await publicar({
    id: 2, tipo: 'feed', legenda: 'x',
    midia_chave: 'instagram-posts/c.png', midia_url: 'https://r2/c.png?assinatura=VELHA'
  });
  assert.match(r.recebidas[0], /assinatura=NOVA/);
});

test('registro antigo sem chave continua usando a URL guardada', async () => {
  const r = await publicar({
    id: 3, tipo: 'feed', legenda: 'x',
    midia_chave: null, midia_url: 'https://r2/antigo.png?assinatura=VELHA'
  });
  assert.match(r.recebidas[0], /antigo\.png/, 'não pode quebrar posts antigos');
});

test('se o R2 falhar ao assinar, cai para a URL guardada em vez de quebrar', async () => {
  const r = await publicar({
    id: 4, tipo: 'feed', legenda: 'x',
    midia_chave: 'instagram-posts/d.png', midia_url: 'https://r2/d.png?assinatura=VELHA'
  }, { falharUrl: true });
  assert.match(r.recebidas[0], /VELHA/, 'deve degradar para a URL antiga, não lançar');
});
