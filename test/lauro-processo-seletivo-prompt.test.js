// Achado em produção (2026-08-03): o assistente dizia "não há processo seletivo aberto"
// mesmo com um processo real cadastrado (inscrições abertas, link, data de prova) — porque
// o prompt só tinha um texto ESTÁTICO mandando "acompanhar o Instagram", nunca consultava
// ps_processos de verdade. Mesmo bug, além disso, no prompt em espanhol: a regra dele
// mandava confiar numa lista de eventos que nunca era incluída no prompt em si.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/lauro.js');

function montar({ processos = [] } = {}) {
  let promptCapturado = null;
  const rax = require.resolve('axios');
  require.cache[rax] = { id: rax, filename: rax, loaded: true, exports: {
    // Além da chamada à Anthropic, o processarMensagem manda a resposta de volta (canal
    // oficial/W-API), que também passa por axios.post — sem essa checagem, essa segunda
    // chamada (sem "system") sobrescreveria a captura com undefined.
    post: async (url, corpo) => {
      if (corpo && typeof corpo.system === 'string') promptCapturado = corpo.system;
      return { data: { content: [{ text: 'ok' }], usage: {}, messages: [{ id: 'wamid.1' }] } };
    },
    get: async () => ({ data: {} })
  }};

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql) => {
      if (/FROM ps_processos/.test(sql)) return { rows: processos };
      if (/FROM eventos/.test(sql)) return { rows: [] };
      if (/FROM lauro_conhecimento/.test(sql)) return { rows: [] };
      if (/FROM lauro_atendimentos/.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  }};

  delete require.cache[require.resolve(MODULO)];
  return { mod: require(MODULO), prompt: () => promptCapturado };
}

test('processo seletivo aberto: a IA recebe nome, link e data reais no prompt (PT)', async () => {
  const { mod, prompt } = montar({
    processos: [{ id: 4, nome: 'Proceso Selectivo 2026.2', semestre: '2026.2', data_prova: '2026-08-27',
      local_prova: 'Sede do Lago', vagas: 40, valor_inscricao: 25, inscricoes_abertas: true, edital_chave: 'x.pdf' }]
  });
  const numero = '595990000001';
  await mod.processarMensagem(numero, 'Boa tarde', null); // 1a msg (>=3 chars): auto-detecta PT, pede nome
  await mod.processarMensagem(numero, 'Fernando', null); // 2a msg: da o nome
  await mod.processarMensagem(numero, 'Quero saber sobre o processo seletivo', null); // aqui chama o Claude
  const p = prompt();
  assert.ok(p, 'o prompt tem que ter sido enviado pra API');
  assert.match(p, /Proceso Selectivo 2026\.2/);
  assert.match(p, /INSCRICOES ABERTAS/);
  assert.match(p, /https:\/\/inscricao\.lauroucpcde\.com\/pss\/4\/inscricao/);
  assert.match(p, /PROCESSOS SELETIVOS DISPONÍVEIS/, 'a secao dinamica tem que existir no prompt PT');
});

test('sem processo seletivo cadastrado: o prompt diz isso claramente, não inventa', async () => {
  const { mod, prompt } = montar({ processos: [] });
  const numero = '595990000003';
  await mod.processarMensagem(numero, 'Boa tarde', null);
  await mod.processarMensagem(numero, 'Fernando', null);
  await mod.processarMensagem(numero, 'Tem processo seletivo?', null);
  assert.match(prompt(), /Nenhum processo seletivo aberto no momento/);
});

test('a seção de processo seletivo também chega no prompt em espanhol (bug do getEventosAtivos ausente)', async () => {
  const { mod, prompt } = montar({
    processos: [{ id: 4, nome: 'Proceso Selectivo 2026.2', semestre: '2026.2', data_prova: '2026-08-27',
      local_prova: 'Sede do Lago', vagas: 40, valor_inscricao: 25, inscricoes_abertas: true, edital_chave: null }]
  });
  const numero = '595990000002';
  await mod.processarMensagem(numero, 'hola', null);           // auto-detecta español
  await mod.processarMensagem(numero, 'Fernando', null);       // pede nome, essa msg responde
  await mod.processarMensagem(numero, '¿Hay proceso selectivo abierto?', null); // aqui chama o Claude
  const p = prompt();
  assert.ok(p, 'o prompt tem que ter sido enviado pra API em espanhol tambem');
  assert.match(p, /Proceso Selectivo 2026\.2/, 'o prompt ES precisa ter os dados reais do processo');
  assert.match(p, /PROCESSOS SELETIVOS DISPONÍVEIS/, 'a secao dinamica tem que existir tambem no prompt ES');
  assert.match(p, /EVENTOS DISPONÍVEIS PARA INSCRIÇÃO/, 'o prompt ES antes nao tinha NENHUMA secao de eventos');
});
