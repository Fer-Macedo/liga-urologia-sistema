// CAUSA RAIZ do carrossel que não publicava (22/07 e 23/07/2026).
//
// O container criado por POST /media NÃO fica pronto na hora: a Meta ainda baixa e
// processa a mídia. Publicar antes disso devolve:
//     "Cannot Publish: The media is not ready for publishing" — código 9007
//
// O `publicarStory` JÁ esperava o status virar FINISHED (com um comentário citando o
// 9007). O `publicarCarrossel` e o `publicarFoto` NÃO esperavam — publicavam na linha
// seguinte. Funcionava por sorte quando o processamento era rápido (o carrossel de 19/07
// passou); falhava quando demorava. Quanto mais slides, mais demora — o de 22/07 tinha 7.
//
// A correção do bug morava em UM lugar e faltava nos outros dois. Agora é uma função só,
// `esperarProcessar`, usada por todos.
process.env.IG_RETRY_MS = '1';
process.env.IG_POLL_MS = '1';   // sem isso o teste espera segundos de relógio real

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/instagram.js');

// Registra a ORDEM real das chamadas à Meta, que é o que importa aqui.
function montar({ prontoDepoisDe = 0, statusFinal = 'FINISHED' } = {}) {
  const chamadas = [];
  let consultas = 0;

  const rax = require.resolve('axios');
  require.cache[rax] = { id: rax, filename: rax, loaded: true, exports: {
    post: async (url) => {
      if (/media_publish/.test(url)) { chamadas.push('PUBLICAR'); return { data: { id: 'MEDIA_OK' } }; }
      chamadas.push('CRIAR');
      return { data: { id: 'CONTAINER' } };
    },
    get: async () => {
      consultas++;
      chamadas.push('CONFERIR');
      const pronto = consultas > prontoDepoisDe;
      return { data: { status_code: pronto ? statusFinal : 'IN_PROGRESS' } };
    }
  }};

  delete require.cache[require.resolve(MODULO)];
  return { mod: require(MODULO), chamadas };
}

// A regressão exata: publicar sem conferir se ficou pronto.
test('carrossel: confere se ficou pronto ANTES de publicar', async () => {
  const { mod, chamadas } = montar();
  await mod.publicarCarrossel({ imageUrls: ['a', 'b'], legenda: 'x' });
  const iConferir = chamadas.indexOf('CONFERIR');
  const iPublicar = chamadas.indexOf('PUBLICAR');
  assert.ok(iConferir >= 0, 'sem conferir, a Meta responde 9007 "media is not ready"');
  assert.ok(iConferir < iPublicar, 'a conferência tem que vir ANTES do publicar');
});

test('carrossel: espera o tempo que for preciso, não desiste na 1ª consulta', async () => {
  const { mod, chamadas } = montar({ prontoDepoisDe: 3 });
  await mod.publicarCarrossel({ imageUrls: ['a'], legenda: 'x' });
  assert.strictEqual(chamadas.filter(c => c === 'CONFERIR').length, 4, 'insiste até ficar FINISHED');
  assert.ok(chamadas.includes('PUBLICAR'), 'e aí publica');
});

// O mesmo descuido existia na foto do feed.
test('foto do feed: também confere antes de publicar', async () => {
  const { mod, chamadas } = montar();
  await mod.publicarFoto({ imageUrl: 'a', legenda: 'x' });
  assert.ok(chamadas.indexOf('CONFERIR') < chamadas.indexOf('PUBLICAR'));
});

test('story: continua conferindo (não podia perder isso na unificação)', async () => {
  const { mod, chamadas } = montar();
  await mod.publicarStory({ imageUrl: 'a' });
  assert.ok(chamadas.indexOf('CONFERIR') < chamadas.indexOf('PUBLICAR'));
});

test('reel: também confere antes de publicar', async () => {
  const { mod, chamadas } = montar();
  await mod.publicarReel({ videoUrl: 'a', legenda: 'x' });
  assert.ok(chamadas.indexOf('CONFERIR') < chamadas.indexOf('PUBLICAR'));
});

// Mídia recusada: não adianta insistir nem tentar publicar.
test('se a Meta recusa a mídia (ERROR), nem tenta publicar', async () => {
  const { mod, chamadas } = montar({ statusFinal: 'ERROR' });
  await assert.rejects(
    () => mod.publicarCarrossel({ imageUrls: ['a'], legenda: 'x' }),
    /recusou a midia/,
    'tem que falhar com motivo claro'
  );
  assert.ok(!chamadas.includes('PUBLICAR'), 'publicar mídia recusada é pedir erro obscuro');
});
