// O alerta de marketing só vale se ficar em silêncio quando está tudo certo. Alerta que
// chega sempre vira papel de parede. Estes testes fixam as duas metades da regra: dispara
// quando falta, cala quando não falta.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/marketing-alerta.js');

// cenário: quantas questões aprovadas na fila, posts agendados, dias sem publicar,
// sugestões paradas
function comCenario({ aprovadas = 2, agendados = 2, diasSemPostar = 1, sugestoesParadas = 0 } = {}) {
  const r = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[r] = {
    id: r, filename: r, loaded: true,
    exports: {
      query: async (sql) => {
        if (/FROM revalida_questoes/.test(sql)) return { rows: [{ c: String(aprovadas) }] };
        if (/FROM instagram_posts WHERE status='agendado'/.test(sql)) return { rows: [{ c: String(agendados) }] };
        if (/MAX\(publicado_em\)/.test(sql)) return { rows: [{ d: diasSemPostar }] };
        if (/FROM marketing_sugestoes/.test(sql)) return { rows: [{ c: String(sugestoesParadas) }] };
        return { rows: [] };
      }
    }
  };
  delete require.cache[require.resolve(MODULO)];
  return require(MODULO);
}

test('tudo em ordem → nenhuma pendência (o silêncio é a resposta)', async () => {
  const { levantarPendencias } = comCenario({ aprovadas: 3, agendados: 2, diasSemPostar: 1 });
  assert.strictEqual((await levantarPendencias()).length, 0);
});

test('fila do Revalida vazia → alerta com a data do próximo envio', async () => {
  const { levantarPendencias } = comCenario({ aprovadas: 0 });
  const p = await levantarPendencias();
  const rev = p.find(x => /Revalida/.test(x.titulo));
  assert.ok(rev, 'deveria alertar sobre o Revalida');
  assert.match(rev.texto, /às 6h/, 'precisa dizer quando é o envio');
  assert.match(rev.texto, /\d{2}\/\d{2}/, 'precisa trazer a data');
});

test('apenas 1 questão na fila → avisa que a fila vai esvaziar', async () => {
  const { levantarPendencias } = comCenario({ aprovadas: 1 });
  const p = await levantarPendencias();
  assert.ok(p.find(x => /apenas 1 questão/.test(x.titulo)));
});

test('nada agendado nos próximos 10 dias → alerta', async () => {
  const { levantarPendencias } = comCenario({ agendados: 0 });
  const p = await levantarPendencias();
  assert.ok(p.find(x => /Nenhuma publicação agendada/.test(x.titulo)));
});

test('7 dias ou mais sem publicar → alerta de cadência', async () => {
  const { levantarPendencias } = comCenario({ diasSemPostar: 9 });
  const p = await levantarPendencias();
  const c = p.find(x => /dias sem publicar/.test(x.titulo));
  assert.ok(c);
  assert.match(c.titulo, /^9 dias/);
});

test('6 dias sem publicar ainda não alerta — o limite é 7', async () => {
  const { levantarPendencias } = comCenario({ diasSemPostar: 6 });
  const p = await levantarPendencias();
  assert.ok(!p.find(x => /dias sem publicar/.test(x.titulo)));
});

test('sugestão parada há mais de 5 dias → alerta', async () => {
  const { levantarPendencias } = comCenario({ sugestoesParadas: 3 });
  const p = await levantarPendencias();
  assert.ok(p.find(x => /3 sugestão/.test(x.titulo)));
});

test('conta sem publicação nenhuma não quebra o alerta', async () => {
  const { levantarPendencias } = comCenario({ diasSemPostar: null });
  await assert.doesNotReject(() => levantarPendencias());
});

test('vários problemas juntos → todos são listados', async () => {
  const { levantarPendencias } = comCenario({ aprovadas: 0, agendados: 0, diasSemPostar: 12, sugestoesParadas: 2 });
  const p = await levantarPendencias();
  assert.strictEqual(p.length, 4, 'deveria listar as 4 pendências');
  p.forEach(x => assert.ok(x.acao, 'toda pendência precisa dizer onde resolver'));
});
