// O e-mail do Momento Revalida sai 2x por semana. Quando uma questão anterior foi enviada
// mas ninguém confirmou a publicação, o alerta vai NO TOPO desse mesmo e-mail — não num
// e-mail separado, que só faria a equipe ignorar os dois.
// Estes testes fixam: aparece quando há pendência, some quando não há.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/revalida-quadro.js');

const QUESTAO = {
  id: 9, fonte: 'Revalida INEP 2024.1 — questão 52', gabarito: 'B',
  caso: 'Caso de teste', legenda: 'Legenda de teste',
  alternativas: [{ letra: 'A', texto: 'a' }, { letra: 'B', texto: 'b' }]
};

// devolve o HTML do e-mail que teria sido enviado, sem enviar nada
async function emailGerado({ pendentes = [] } = {}) {
  const enviados = [];
  const stub = (rel, exports) => {
    const r = require.resolve(path.join(RAIZ, rel));
    require.cache[r] = { id: r, filename: r, loaded: true, exports };
  };
  stub('src/models/database.js', {
    query: async (sql) => {
      if (/SELECT \* FROM revalida_questoes/.test(sql) || /status='aprovada'/.test(sql)) return { rows: [QUESTAO] };
      if (/publicado_em IS NULL AND id/.test(sql)) return { rows: pendentes };
      if (/FROM usuarios/.test(sql)) return { rows: [{ email: 'equipe@teste' }] };
      return { rows: [] };
    }
  });
  stub('src/services/notificacoes.js', {
    enviarEmail: async (o) => { enviados.push(o); return { ok: true }; }
  });
  stub('src/services/instagram-analise.js', {});
  // O puppeteer e substituido por um duble: o teste e sobre o corpo do e-mail, nao sobre a
  // arte, e subir um Chrome de verdade a cada caso tornaria a suite lenta e fragil.
  const pup = require.resolve('puppeteer');
  require.cache[pup] = { id: pup, filename: pup, loaded: true, exports: {
    launch: async () => ({
      newPage: async () => ({ setViewport: async () => {}, setContent: async () => {}, screenshot: async () => Buffer.alloc(10) }),
      close: async () => {}
    })
  }};
  const chr = require.resolve('@sparticuz/chromium');
  require.cache[chr] = { id: chr, filename: chr, loaded: true, exports: { args: [], executablePath: async () => '/bin/true' } };

  delete require.cache[require.resolve(MODULO)];
  return { mod: require(MODULO), enviados };
}

test('sem pendência: o e-mail NÃO traz o bloco de alerta', async () => {
  const { mod, enviados } = await emailGerado({ pendentes: [] });
  await mod.enviarQuadroRevalida();
  assert.strictEqual(enviados.length, 1);
  assert.doesNotMatch(enviados[0].html, /Publicação anterior em aberto/);
  assert.doesNotMatch(enviados[0].assunto, /⚠️/, 'assunto limpo quando não há pendência');
});

test('com pendência: alerta no topo, com a data e a fonte', async () => {
  const { mod, enviados } = await emailGerado({
    pendentes: [{ fonte: 'Revalida INEP 2022.2 — questão 2', enviado: '17/07' }]
  });
  await mod.enviarQuadroRevalida();
  const html = enviados[0].html;
  assert.match(html, /Publicação anterior em aberto/);
  assert.match(html, /17\/07/, 'precisa dizer quando foi enviada');
  assert.match(html, /questão 2/, 'precisa identificar qual questão');
  assert.match(html, /Marcar como publicado/, 'precisa dizer o que fazer');
  assert.match(enviados[0].assunto, /⚠️/, 'assunto sinaliza a pendência');
  // o alerta tem que vir ANTES do conteúdo normal, senão passa despercebido
  assert.ok(html.indexOf('Publicação anterior em aberto') < html.indexOf('Como publicar'),
    'o alerta deve estar no topo do e-mail');
});

test('mais de uma pendência: todas aparecem', async () => {
  const { mod, enviados } = await emailGerado({
    pendentes: [
      { fonte: 'Questão A', enviado: '14/07' },
      { fonte: 'Questão B', enviado: '17/07' }
    ]
  });
  await mod.enviarQuadroRevalida();
  assert.match(enviados[0].html, /14\/07/);
  assert.match(enviados[0].html, /17\/07/);
});
