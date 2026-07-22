// POLÍTICA "A W-API SÓ RESPONDE, NUNCA INICIA" (decidida em 2026-07-22).
//
// O WhatsApp restringiu o número novo por "envio de spam". Não foi volume: 37 mensagens em
// 2 dias, 9 destinos, só 1 conversa iniciada por nós. A causa foi conta NOVA + automação
// não-oficial (W-API) + 5 mensagens seguidas a um contato que nunca respondeu.
//
// Estes testes prendem a regra: tudo que PARTE de nós sai pela API Oficial (modelo
// aprovado); a W-API só fala com quem já escreveu.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/lauro.js');

function comCenario({ areaJaEscreveu = false, consultaFalha = false } = {}) {
  const enviados = [];

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql) => {
      if (consultaFalha && /lauro_conversas/.test(sql)) throw new Error('banco fora');
      if (/FROM lauro_conversas WHERE papel='user'/.test(sql)) {
        return { rows: areaJaEscreveu ? [{ '?column?': 1 }] : [] };
      }
      return { rows: [] };
    }
  }};

  const rc = require.resolve(path.join(RAIZ, 'src/services/canal-assistente.js'));
  require.cache[rc] = { id: rc, filename: rc, loaded: true, exports: {
    enviarTexto: async (n, m) => { enviados.push({ via: 'wapi', numero: n, msg: m }); return { ok: true }; },
    enviarTemplate: async (n, nome) => { enviados.push({ via: 'oficial-template', numero: n, modelo: nome }); return { ok: true }; }
  }};

  delete require.cache[require.resolve(MODULO)];
  return { mod: require(MODULO), enviados };
}

// O aviso de atendimento novo PARTE de nós — é uma conversa iniciada. Nunca pela W-API.
test('aviso à área SEMPRE pelo modelo oficial, mesmo se a área já escreveu', async () => {
  const { mod, enviados } = comCenario({ areaJaEscreveu: true });
  await mod.notificarArea('595973738431', 'Novo atendimento', 'Fulano', 'Secretaria');
  assert.strictEqual(enviados.length, 1, 'um envio só');
  assert.strictEqual(enviados[0].via, 'oficial-template');
  assert.strictEqual(enviados[0].modelo, 'novo_atendimento');
});

test('área que nunca escreveu: também pelo modelo oficial', async () => {
  const { mod, enviados } = comCenario({ areaJaEscreveu: false });
  await mod.notificarArea('595973738431', 'Novo atendimento', 'Fulano', 'Secretaria');
  assert.strictEqual(enviados[0].via, 'oficial-template');
});

// A regressão que causou a restrição: o aviso saindo pela W-API.
test('o aviso à área NUNCA pode sair pela W-API', async () => {
  for (const jaEscreveu of [true, false]) {
    const { mod, enviados } = comCenario({ areaJaEscreveu: jaEscreveu });
    await mod.notificarArea('554191796180', 'Novo atendimento', 'Fulano', 'Financeiro');
    assert.ok(!enviados.some(e => e.via === 'wapi'),
      'iniciar conversa pela W-API é o que fez o WhatsApp restringir o número');
  }
});

test('areaJaConversou: reconhece quem escreveu e quem não escreveu', async () => {
  assert.strictEqual(await comCenario({ areaJaEscreveu: true }).mod.areaJaConversou('595973738431'), true);
  assert.strictEqual(await comCenario({ areaJaEscreveu: false }).mod.areaJaConversou('595973738431'), false);
});

// Na dúvida, o caminho seguro: assume que não escreveu (não arrisca a W-API).
test('se o banco falhar, areaJaConversou responde "não escreveu"', async () => {
  const { mod } = comCenario({ areaJaEscreveu: true, consultaFalha: true });
  assert.strictEqual(await mod.areaJaConversou('595973738431'), false);
});
