// VARREDURA ANTES DE RECONECTAR (2026-07-22). O número já foi restringido DUAS vezes pela
// mesma mecânica: automação não-oficial iniciando conversa. A política "a W-API só
// RESPONDE" já existia, mas a varredura achou quatro furos por onde ela ainda iniciava:
//
//   1. areaJaConversou não tinha limite de TEMPO. Bastava a pessoa ter escrito uma vez,
//      meses atrás, e o robô podia cutucá-la para sempre. Pelo WhatsApp, fora da janela
//      de 24h a mensagem não é resposta — é conversa nova.
//   2. Aviso "atendimento registrado" à presidência, a CADA atendimento aberto.
//   3. Aviso de transferência à presidência.
//   4. Alerta de créditos da IA à presidência.
//   5. O repasse de reserva (quando o banco falha) pulava a guarda inteira.
//
// Os avisos internos agora saem por e-mail fora da janela — mesmo caminho do vigia da W-API.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/lauro.js');
const AREA = '595973738431';

function montar({ escreveuRecente = false } = {}) {
  const enviados = [];   // { via: 'wapi'|'email', destino }
  const consultas = [];

  const rax = require.resolve('axios');
  require.cache[rax] = { id: rax, filename: rax, loaded: true, exports: {
    post: async () => ({ data: { content: [{ text: 'ok' }], usage: {} } }), get: async () => ({ data: {} })
  }};

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      consultas.push(sql);
      if (/FROM lauro_conversas WHERE papel='user'/.test(sql)) {
        return { rows: escreveuRecente ? [{ '?column?': 1 }] : [] };
      }
      if (/FROM usuarios/.test(sql)) return { rows: [{ email: 'presidencia@lauro.org' }] };
      if (/SELECT area, numero FROM lauro_contatos/.test(sql)) return { rows: [{ area: 'presidencia', numero: AREA }] };
      return { rows: [] };
    }
  }};

  const rc = require.resolve(path.join(RAIZ, 'src/services/canal-assistente.js'));
  require.cache[rc] = { id: rc, filename: rc, loaded: true, exports: {
    enviarTexto: async (n) => { enviados.push({ via: 'wapi', destino: n }); return { ok: true }; },
    enviarTemplate: async (n) => { enviados.push({ via: 'oficial-template', destino: n }); return { ok: true }; },
    enviarImagem: async (n) => { enviados.push({ via: 'wapi', destino: n }); return { ok: true }; },
    enviarDocumento: async (n) => { enviados.push({ via: 'wapi', destino: n }); return { ok: true }; }
  }};

  const rn = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rn] = { id: rn, filename: rn, loaded: true, exports: {
    enviarEmail: async (o) => { enviados.push({ via: 'email', destino: o.para }); return { ok: true }; }
  }};

  delete require.cache[require.resolve(MODULO)];
  return { mod: require(MODULO), enviados, consultas };
}

// A regressão nº 1: guarda sem limite de tempo é uma licença permanente para cutucar.
test('a janela é de 24h — "escreveu alguma vez na vida" não vale', async () => {
  const { mod, consultas } = montar({ escreveuRecente: true });
  await mod.areaJaConversou(AREA);
  const c = consultas.find(s => /lauro_conversas/.test(s));
  assert.match(c, /INTERVAL '24 hours'/,
    'sem limite de tempo, uma mensagem antiga autoriza conversa nova para sempre');
});

test('quem escreveu nas últimas 24h: pode receber resposta', async () => {
  assert.strictEqual(await montar({ escreveuRecente: true }).mod.areaJaConversou(AREA), true);
});

test('quem não escreveu na janela: não pode ser abordado', async () => {
  assert.strictEqual(await montar({ escreveuRecente: false }).mod.areaJaConversou(AREA), false);
});

// Os avisos internos: o que mais disparava, porque roda a cada atendimento aberto.
test('aviso de créditos fora da janela vai por E-MAIL, não pela W-API', async () => {
  const { mod, enviados } = montar({ escreveuRecente: false });
  await mod.recarregarContatos();
  await mod.avisarPresidencia('Creditos da IA', 'Os creditos acabaram');
  assert.ok(!enviados.some(e => e.via === 'wapi'), 'iniciar conversa pela W-API é o que derrubou o número');
  assert.ok(enviados.some(e => e.via === 'email'), 'o aviso não pode simplesmente sumir');
});

test('dentro da janela, o aviso pode ir por WhatsApp', async () => {
  const { mod, enviados } = montar({ escreveuRecente: true });
  await mod.recarregarContatos();
  await mod.avisarPresidencia('Creditos da IA', 'Os creditos acabaram');
  assert.ok(enviados.some(e => e.via === 'wapi'), 'responder dentro de 24h é permitido');
  assert.ok(!enviados.some(e => e.via === 'email'), 'não duplica o aviso nos dois canais');
});

// O aviso à área continua sendo o modelo oficial, em qualquer situação.
test('o aviso de atendimento novo à área nunca sai pela W-API', async () => {
  for (const janela of [true, false]) {
    const { mod, enviados } = montar({ escreveuRecente: janela });
    await mod.notificarArea(AREA, 'Novo atendimento', 'Fulano', 'Secretaria');
    assert.ok(!enviados.some(e => e.via === 'wapi'));
    assert.ok(enviados.some(e => e.via === 'oficial-template'));
  }
});
