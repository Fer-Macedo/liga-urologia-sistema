// O sistema passa a ter dois canais de WhatsApp com papéis diferentes: os disparos vão
// pela API Oficial, o assistente virtual vai pela W-API. O risco é os dois se cruzarem —
// uma resposta do assistente saindo pelo número dos disparos, ou pior, o aviso à área
// deixando de entregar. Estes testes prendem as regras de roteamento.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/canal-assistente.js');
const WAPI = path.join(RAIZ, 'src/services/whatsapp-wapi.js');

// O adaptador da W-API ainda não existe (falta credencial do número novo). Para exercitar
// o seletor, o teste cria um adaptador de mentira em disco e apaga no fim — não dá para
// simular pelo require.cache, porque o require falha na resolução antes de olhar o cache.
function criarAdaptadorFalso() {
  if (fs.existsSync(WAPI)) return false;
  fs.writeFileSync(WAPI, `
    module.exports = {
      enviarTexto: async () => ({ ok: true, via: 'wapi' }),
      enviarImagem: async () => ({ ok: true, via: 'wapi' }),
      enviarDocumento: async () => ({ ok: true, via: 'wapi' })
    };
  `);
  return true;
}
function removerAdaptadorFalso(criado) { if (criado) fs.unlinkSync(WAPI); }

// O transporte oficial vira um dublê que só registra por onde a mensagem saiu.
function comCanais({ canal } = {}) {
  const chamadas = [];
  const rOf = require.resolve(path.join(RAIZ, 'src/services/whatsapp-oficial.js'));
  require.cache[rOf] = { id: rOf, filename: rOf, loaded: true, exports: {
    enviarTexto: async (n, m) => { chamadas.push({ via: 'oficial', tipo: 'texto', n, m }); return { ok: true }; },
    enviarImagem: async (n) => { chamadas.push({ via: 'oficial', tipo: 'imagem', n }); return { ok: true }; },
    enviarDocumento: async (n) => { chamadas.push({ via: 'oficial', tipo: 'documento', n }); return { ok: true }; },
    enviarTemplate: async (n, t) => { chamadas.push({ via: 'oficial', tipo: 'template', n, t }); return { ok: true }; }
  }};

  if (canal) process.env.ASSISTENTE_CANAL = canal;
  else delete process.env.ASSISTENTE_CANAL;

  delete require.cache[require.resolve(MODULO)];
  if (fs.existsSync(WAPI)) delete require.cache[WAPI];
  return { mod: require(MODULO), chamadas };
}

test('sem configuração, o assistente responde pela API oficial', async () => {
  const { mod, chamadas } = comCanais({});
  await mod.enviarTexto('595991', 'oi');
  assert.strictEqual(chamadas[0].via, 'oficial');
});

test('com ASSISTENTE_CANAL=wapi, texto/imagem/documento saem pela W-API', async () => {
  const criado = criarAdaptadorFalso();
  try {
    const { mod, chamadas } = comCanais({ canal: 'wapi' });
    const r1 = await mod.enviarTexto('595991', 'oi');
    const r2 = await mod.enviarImagem('595991', 'http://x/i.png', 'legenda');
    const r3 = await mod.enviarDocumento('595991', 'http://x/d.pdf', 'd.pdf');
    assert.deepStrictEqual([r1.via, r2.via, r3.via], ['wapi', 'wapi', 'wapi']);
    assert.strictEqual(chamadas.length, 0, 'nada do assistente pode vazar para a oficial');
  } finally { removerAdaptadorFalso(criado); }
});

// Modelo aprovado é recurso exclusivo da API Oficial. Se ele fosse pela W-API, o aviso
// de novo atendimento à secretaria pararia de entregar fora da janela de 24h — que foi
// exatamente o bug que o modelo novo_atendimento veio consertar.
test('o modelo aprovado vai pela oficial mesmo com o assistente na W-API', async () => {
  const criado = criarAdaptadorFalso();
  try {
    const { mod, chamadas } = comCanais({ canal: 'wapi' });
    await mod.enviarTemplate('595991', 'novo_atendimento', 'pt_BR', []);
    assert.strictEqual(chamadas[0].via, 'oficial');
    assert.strictEqual(chamadas[0].tipo, 'template');
  } finally { removerAdaptadorFalso(criado); }
});

// Canal configurado como wapi + adaptador fora do ar não pode virar silêncio: membro
// escrevendo pra liga e não recebendo resposta é pior do que responder pelo outro número.
test('W-API indisponível cai na oficial em vez de derrubar o atendimento', async () => {
  const { mod, chamadas } = comCanais({ canal: 'wapi' }); // sem criar o adaptador
  await mod.enviarTexto('595991', 'oi');
  assert.strictEqual(chamadas[0].via, 'oficial');
});

test('provedor() reflete a configuração', () => {
  assert.strictEqual(comCanais({}).mod.provedor(), 'oficial');
  assert.strictEqual(comCanais({ canal: 'WAPI' }).mod.provedor(), 'wapi');
});
