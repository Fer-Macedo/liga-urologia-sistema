// As miniaturas dos posts do Instagram no dashboard de marketing quebravam: a URL do R2
// gravada no banco é ASSINADA e expira em 24h. A correção regenera a URL a partir da CHAVE
// (permanente) a cada abertura. Quando a chave não foi gravada (stories antigas), ela é
// extraída do próprio endereço. Este teste prende essa extração — a parte não-óbvia.
const { test } = require('node:test');
const assert = require('node:assert');

// réplica fiel do chaveDeUrl usado no route de marketing
const chaveDeUrl = (u) => { try { return decodeURIComponent(new URL(u).pathname.replace(/^\/+/, '')); } catch (e) { return null; } };

test('extrai a chave do R2 de uma URL assinada (virtual-hosted)', () => {
  const u = 'https://liga-urologia-files.abc123.r2.cloudflarestorage.com/instagram-posts/1784438034120-9a64c6a198adf2db.png?X-Amz-Expires=86400&X-Amz-Signature=xyz';
  assert.strictEqual(chaveDeUrl(u), 'instagram-posts/1784438034120-9a64c6a198adf2db.png');
});

test('a chave não leva a query string da assinatura junto', () => {
  const chave = chaveDeUrl('https://x.r2.cloudflarestorage.com/pasta/arq.png?X-Amz-Signature=abc');
  assert.ok(!/X-Amz/.test(chave), 'a parte da assinatura não pode virar parte da chave');
});

test('URL inválida devolve null (não quebra o dashboard)', () => {
  assert.strictEqual(chaveDeUrl('não é url'), null);
  assert.strictEqual(chaveDeUrl(''), null);
  assert.strictEqual(chaveDeUrl(undefined), null);
});

test('decodifica caracteres escapados no caminho', () => {
  assert.strictEqual(chaveDeUrl('https://x.r2.cloudflarestorage.com/pasta/arq%20final.png'), 'pasta/arq final.png');
});
