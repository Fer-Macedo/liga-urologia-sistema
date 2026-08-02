// O número do assistente já foi restringido/banido 3 vezes em menos de 2 semanas
// (22/07, 25/07, 02/08), mesmo respondendo só quem escreveu primeiro. Duas camadas a
// mais de proteção, pedidas explicitamente pelo usuário em 2026-08-02:
//   1. Atraso de resposta com variação real (não mais uma fórmula fixa — sempre o mesmo
//      atraso pro mesmo texto é uma assinatura de robô tão óbvia quanto responder na hora).
//   2. Teto diário de envios, mais apertado logo após reconectar (é justo nos primeiros
//      dias pós-reconexão que a restrição virou banimento total, 3 vezes seguidas).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/whatsapp-wapi.js');

function montar({ totalHoje = 0, reconectadoEm = null } = {}) {
  const posts = [];
  const inserts = [];
  const ax = require.resolve('axios');
  require.cache[ax] = { id: ax, filename: ax, loaded: true, exports: {
    post: async (url, corpo, cfg) => { posts.push({ url, corpo }); return { data: { messageId: 'abc123' } }; },
    get: async (url) => {
      if (/phone-exists/.test(url)) {
        const bruto = (url.match(/phoneNumber=(\d+)/) || [])[1];
        return { data: { exists: true, phoneNumber: bruto } };
      }
      return { data: { connected: true } };
    }
  }};

  let total = totalHoje;
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT valor FROM configuracoes WHERE chave='wapi_reconectado_em'/.test(sql)) {
        return { rows: reconectadoEm ? [{ valor: reconectadoEm }] : [] };
      }
      if (/INSERT INTO wapi_envios_diarios/.test(sql)) {
        total += 1;
        inserts.push(total);
        return { rows: [{ total }] };
      }
      return { rows: [] };
    }
  }};

  process.env.WAPI_INSTANCE_ID = 'INST1';
  process.env.WAPI_TOKEN = 'TOK1';
  delete require.cache[require.resolve(MODULO)];
  return { mod: require(MODULO), posts, inserts };
}

test('atrasoHumano: varia entre chamadas (não é mais uma fórmula fixa)', async () => {
  delete process.env.WAPI_ATRASO_TESTE_MS;
  const { mod } = montar();
  const valores = new Set();
  for (let i = 0; i < 20; i++) valores.add(mod.atrasoHumano('mesma mensagem sempre'));
  assert.ok(valores.size > 1, 'a mesma mensagem tem que gerar atrasos diferentes entre chamadas');
  process.env.WAPI_ATRASO_TESTE_MS = '1';
});

test('atrasoHumano: fica dentro de uma faixa humana razoável (1,2s a 14s)', async () => {
  delete process.env.WAPI_ATRASO_TESTE_MS;
  const { mod } = montar();
  for (let i = 0; i < 30; i++) {
    const v = mod.atrasoHumano('texto de tamanho médio para o teste');
    assert.ok(v >= 1200 && v <= 14000, 'atraso ' + v + 'ms fora da faixa esperada');
  }
  process.env.WAPI_ATRASO_TESTE_MS = '1';
});

test('podeEnviarHoje: dentro do teto normal, permite', async () => {
  const { mod } = montar({ totalHoje: 5 });
  assert.strictEqual(await mod.podeEnviarHoje(), true);
});

test('podeEnviarHoje: acima do teto normal (60), bloqueia', async () => {
  const { mod } = montar({ totalHoje: 60 });
  assert.strictEqual(await mod.podeEnviarHoje(), false);
});

test('podeEnviarHoje: reconectou há poucas horas → teto de aquecimento bem mais baixo', async () => {
  const { mod } = montar({ totalHoje: 20, reconectadoEm: new Date().toISOString() });
  assert.strictEqual(await mod.podeEnviarHoje(), false,
    'com 20 envios e teto de aquecimento (15), tem que bloquear mesmo estando bem abaixo do teto normal (60)');
});

test('podeEnviarHoje: reconectou há muitos dias → volta ao teto normal', async () => {
  const antigo = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(); // 10 dias atrás
  const { mod } = montar({ totalHoje: 20, reconectadoEm: antigo });
  assert.strictEqual(await mod.podeEnviarHoje(), true,
    'passado o período de aquecimento, 20 envios tem que caber no teto normal');
});

test('podeEnviarHoje: falha ao consultar o banco não trava o atendimento (degrada pra permitir)', async () => {
  const { mod } = montar();
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq].exports.query = async () => { throw new Error('banco fora do ar'); };
  assert.strictEqual(await mod.podeEnviarHoje(), true);
});

test('enviarTexto: acima do teto, nem tenta chamar a W-API', async () => {
  const { mod, posts } = montar({ totalHoje: 60 });
  const r = await mod.enviarTexto('595994316286', 'oi');
  assert.strictEqual(r.ok, false);
  assert.match(r.erro, /teto diário/);
  assert.strictEqual(posts.length, 0, 'não pode nem tentar enviar acima do teto');
});
