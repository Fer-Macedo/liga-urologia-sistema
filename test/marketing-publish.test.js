// Regressão: o publicador de marketing_posts marcava o post como "publicado" mesmo
// quando nenhum canal publicava — bastava faltar credencial para o if ser pulado em
// silêncio, sem erro na lista. Um post que não foi a lugar nenhum ficava registrado
// como publicado. Estes testes fixam a regra: só vira "publicado" se algo publicou.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/marketing-publish.js');

// substitui uma dependência por um dublê antes de carregar o módulo sob teste
function stub(rel, exports) {
  const r = require.resolve(path.join(RAIZ, rel));
  require.cache[r] = { id: r, filename: r, loaded: true, exports };
}

// roda o publicador com banco e APIs simulados; devolve o status gravado
async function publicar(post, { comCredencialFacebook = false } = {}) {
  let statusGravado = null;
  stub('src/models/database.js', {
    query: async (sql, p) => {
      if (/SELECT \* FROM marketing_posts/.test(sql)) return { rows: [post] };
      if (/marketing_config/.test(sql)) {
        return comCredencialFacebook
          ? { rows: [{ chave: 'facebook_token', valor: 't' }, { chave: 'facebook_id', valor: '1' }] }
          : { rows: [] };
      }
      if (/^UPDATE marketing_posts/.test(sql)) { statusGravado = p[0]; return { rows: [] }; }
      return { rows: [] };
    }
  });
  stub('src/services/arquivos.js', { gerarUrlInline: async () => 'https://exemplo/img.jpg' });
  stub('src/services/instagram.js', {
    publicarFoto: async ({ imageUrl }) => {
      if (!imageUrl) throw new Error('sem imagem');
      return { id: '123' };
    }
  });
  delete require.cache[require.resolve(MODULO)];
  const { publicarPostMarketing } = require(MODULO);
  const r = await publicarPostMarketing(1);
  return { status: statusGravado, ...r };
}

const base = { id: 1, conteudo: 'texto', imagem_chave: null };

test('Instagram com imagem publica e marca como publicado', async () => {
  const r = await publicar({ ...base, redes: ['instagram'], imagem_chave: 'x.jpg' });
  assert.strictEqual(r.status, 'publicado');
  assert.strictEqual(r.ok, true);
});

test('Instagram sem imagem falha — a API exige mídia no post de feed', async () => {
  const r = await publicar({ ...base, redes: ['instagram'] });
  assert.strictEqual(r.status, 'erro');
  assert.match(r.erros[0], /imagem/i);
});

test('Facebook sem credencial vira erro, nunca publicado em silêncio', async () => {
  const r = await publicar({ ...base, redes: ['facebook'] });
  assert.strictEqual(r.status, 'erro');
  assert.match(r.erros[0], /credencial/i);
});

test('WhatsApp continua desativado', async () => {
  const r = await publicar({ ...base, redes: ['whatsapp'] });
  assert.strictEqual(r.status, 'erro');
  assert.match(r.erros[0], /desativado/i);
});

test('post sem nenhum canal não pode virar publicado', async () => {
  const r = await publicar({ ...base, redes: [] });
  assert.strictEqual(r.status, 'erro');
});

test('canal que publica + canal que falha = parcial, não publicado', async () => {
  const r = await publicar({ ...base, redes: ['instagram', 'facebook'], imagem_chave: 'x.jpg' });
  assert.strictEqual(r.status, 'parcial');
  assert.strictEqual(r.ok, false);
});
