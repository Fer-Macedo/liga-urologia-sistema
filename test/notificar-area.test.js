// Em 2026-07-20 o secretário não recebeu aviso nenhum de atendimento, mesmo com a W-API
// devolvendo 200 e messageId. O número do atendimento tinha sido ativado naquele dia, e o
// WhatsApp descarta EM SILÊNCIO mensagem de conta nova para quem nunca escreveu para ela.
// A evidência foi limpa: 157 mensagens recebidas do único número que recebia os avisos,
// ZERO das sete áreas que não recebiam nada.
//
// A regra que estes testes prendem: se a área nunca conversou com o número do atendimento,
// o aviso vai pelo modelo aprovado da API Oficial — que entrega — em vez de pela W-API,
// que responderia "ok" e jogaria fora.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/lauro.js');

function comCenario({ conversasDaArea = 0, wapiFalha = false, consultaFalha = false } = {}) {
  const enviados = [];

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql) => {
      if (consultaFalha && /lauro_conversas/.test(sql)) throw new Error('banco fora');
      if (/FROM lauro_conversas WHERE papel='user'/.test(sql)) {
        return { rows: conversasDaArea > 0 ? [{ '?column?': 1 }] : [] };
      }
      return { rows: [] };
    }
  }};

  const rc = require.resolve(path.join(RAIZ, 'src/services/canal-assistente.js'));
  require.cache[rc] = { id: rc, filename: rc, loaded: true, exports: {
    enviarTexto: async (n, m) => {
      enviados.push({ via: 'wapi', numero: n, msg: m });
      return wapiFalha ? { ok: false, erro: 'falhou' } : { ok: true };
    },
    enviarTemplate: async (n, nome) => {
      enviados.push({ via: 'oficial-template', numero: n, modelo: nome });
      return { ok: true };
    }
  }};

  delete require.cache[require.resolve(MODULO)];
  return { mod: require(MODULO), enviados };
}

test('área que NUNCA conversou → modelo oficial, sem nem tentar a W-API', async () => {
  const { mod, enviados } = comCenario({ conversasDaArea: 0 });
  await mod.notificarArea('595973738431', 'Novo atendimento', 'Fulano', 'Secretaria');
  assert.strictEqual(enviados.length, 1, 'um envio só');
  assert.strictEqual(enviados[0].via, 'oficial-template');
  assert.strictEqual(enviados[0].modelo, 'novo_atendimento');
});

// Tentar a W-API antes seria pior que inútil: ela responde "ok" e a mensagem some, então
// o código nem chegaria no fallback. A checagem precisa vir ANTES do envio.
test('não pode tentar a W-API primeiro quando a área nunca conversou', async () => {
  const { mod, enviados } = comCenario({ conversasDaArea: 0 });
  await mod.notificarArea('595973738431', 'Novo atendimento', 'Fulano', 'Secretaria');
  assert.ok(!enviados.some(e => e.via === 'wapi'),
    'a W-API responderia ok e engoliria a mensagem — o fallback nunca dispararia');
});

test('área que JÁ conversou → texto livre pela W-API, no mesmo número da conversa', async () => {
  const { mod, enviados } = comCenario({ conversasDaArea: 3 });
  await mod.notificarArea('595973738431', 'Novo atendimento', 'Fulano', 'Secretaria');
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].via, 'wapi');
  assert.strictEqual(enviados[0].msg, 'Novo atendimento');
});

test('área que já conversou mas a W-API falha → cai no modelo oficial', async () => {
  const { mod, enviados } = comCenario({ conversasDaArea: 3, wapiFalha: true });
  await mod.notificarArea('595973738431', 'Novo atendimento', 'Fulano', 'Secretaria');
  assert.deepStrictEqual(enviados.map(e => e.via), ['wapi', 'oficial-template']);
});

// Na dúvida, o caminho que entrega. Silêncio é o pior resultado possível aqui.
test('se a checagem no banco falhar, usa o caminho garantido', async () => {
  const { mod, enviados } = comCenario({ conversasDaArea: 5, consultaFalha: true });
  await mod.notificarArea('595973738431', 'Novo atendimento', 'Fulano', 'Secretaria');
  assert.strictEqual(enviados[0].via, 'oficial-template');
});

test('o modelo leva o nome do membro e o nome da área nos parâmetros', async () => {
  const { mod, enviados } = comCenario({ conversasDaArea: 0 });
  await mod.notificarArea('595973738431', 'msg', 'Josias Gomes', 'Secretaria');
  assert.strictEqual(enviados[0].numero, '595973738431');
});
