// O número do atendimento estava escrito à mão em 20 lugares. Agora tem uma fonte só.
// O que estes testes protegem: a página nunca pode ficar sem link de contato — nem com
// o banco fora do ar, nem com a chave ausente — e trocar o número na tela tem que
// refletir na hora, não depois que o cache de 60s vencer.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/contato.js');

function comBanco({ valor, falha = false } = {}) {
  let consultas = 0;
  const r = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[r] = { id: r, filename: r, loaded: true, exports: {
    query: async () => {
      consultas++;
      if (falha) throw new Error('banco fora do ar');
      return { rows: valor === undefined ? [] : [{ valor }] };
    }
  }};
  delete require.cache[require.resolve(MODULO)];
  return { mod: require(MODULO), contar: () => consultas };
}

test('lê o número da configuração', async () => {
  const { mod } = comBanco({ valor: '595994316286' });
  assert.strictEqual(await mod.whatsappAtendimento(), '595994316286');
});

test('limpa a formatação — só dígitos chegam no link do wa.me', async () => {
  const { mod } = comBanco({ valor: '+595 (994) 31-6286' });
  assert.strictEqual(await mod.whatsappAtendimento(), '595994316286');
});

test('chave ausente no banco → cai no padrão, nunca em vazio', async () => {
  const { mod } = comBanco({ valor: undefined });
  assert.strictEqual(await mod.whatsappAtendimento(), mod.PADRAO);
});

test('valor em branco → cai no padrão', async () => {
  const { mod } = comBanco({ valor: '   ' });
  assert.strictEqual(await mod.whatsappAtendimento(), mod.PADRAO);
});

test('banco fora do ar não deixa a página sem contato', async () => {
  const { mod } = comBanco({ falha: true });
  assert.strictEqual(await mod.whatsappAtendimento(), mod.PADRAO);
});

test('o cache evita uma consulta por request', async () => {
  const { mod, contar } = comBanco({ valor: '595994316286' });
  for (let i = 0; i < 5; i++) await mod.whatsappAtendimento();
  assert.strictEqual(contar(), 1, 'cinco leituras deveriam custar uma consulta só');
});

test('salvar nas Configurações reflete na hora, sem esperar o cache vencer', async () => {
  const { mod, contar } = comBanco({ valor: '595994316286' });
  await mod.whatsappAtendimento();
  mod.limparCache();
  await mod.whatsappAtendimento();
  assert.strictEqual(contar(), 2, 'limparCache deve forçar nova leitura');
});

// O rodapé dos e-mails monta HTML de forma síncrona e não pode fazer I/O.
test('a versão síncrona devolve o padrão antes do boot e o valor real depois', async () => {
  const { mod } = comBanco({ valor: '595994316286' });
  assert.strictEqual(mod.whatsappAtendimentoSync(), mod.PADRAO, 'cache frio → padrão');
  await mod.aquecer();
  assert.strictEqual(mod.whatsappAtendimentoSync(), '595994316286', 'depois do boot → banco');
});
