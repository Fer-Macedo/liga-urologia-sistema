// O sistema tem dois canais de WhatsApp com papéis diferentes: os disparos vão pela API
// Oficial, o atendimento (assistente + aba /atendimentos) vai pela W-API. O risco é os
// dois se cruzarem — uma resposta de atendimento saindo pelo número dos disparos, ou o
// aviso à área deixando de entregar. Estes testes prendem as regras de roteamento.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/canal-assistente.js');

// Os dois transportes viram dublês que só registram por onde a mensagem saiu.
// `wapiQuebrado` simula o adaptador fora do ar: o require lança ao ser lido.
function comCanais({ canal, wapiQuebrado = false } = {}) {
  const chamadas = [];
  const duble = (nome) => ({
    enviarTexto: async (n, m) => { chamadas.push({ via: nome, tipo: 'texto', n, m }); return { ok: true }; },
    enviarImagem: async (n) => { chamadas.push({ via: nome, tipo: 'imagem', n }); return { ok: true }; },
    enviarDocumento: async (n) => { chamadas.push({ via: nome, tipo: 'documento', n }); return { ok: true }; },
    enviarTemplate: async (n, t) => { chamadas.push({ via: nome, tipo: 'template', n, t }); return { ok: true }; }
  });

  const rOf = require.resolve(path.join(RAIZ, 'src/services/whatsapp-oficial.js'));
  require.cache[rOf] = { id: rOf, filename: rOf, loaded: true, exports: duble('oficial') };

  const rWa = require.resolve(path.join(RAIZ, 'src/services/whatsapp-wapi.js'));
  if (wapiQuebrado) {
    require.cache[rWa] = { id: rWa, filename: rWa, loaded: true,
      get exports() { throw new Error('adaptador indisponível'); } };
  } else {
    require.cache[rWa] = { id: rWa, filename: rWa, loaded: true, exports: duble('wapi') };
  }

  if (canal) process.env.ASSISTENTE_CANAL = canal;
  else delete process.env.ASSISTENTE_CANAL;

  delete require.cache[require.resolve(MODULO)];
  return { mod: require(MODULO), chamadas };
}

test('sem configuração, o atendimento responde pela API oficial', async () => {
  const { mod, chamadas } = comCanais({});
  await mod.enviarTexto('595991', 'oi');
  assert.strictEqual(chamadas[0].via, 'oficial');
});

test('com ASSISTENTE_CANAL=wapi, texto/imagem/documento saem pela W-API', async () => {
  const { mod, chamadas } = comCanais({ canal: 'wapi' });
  await mod.enviarTexto('595991', 'oi');
  await mod.enviarImagem('595991', 'data:image/png;base64,AAA', 'legenda');
  await mod.enviarDocumento('595991', 'data:application/pdf;base64,BBB', 'ata.pdf');
  assert.deepStrictEqual(chamadas.map(c => c.via), ['wapi', 'wapi', 'wapi'],
    'nada do atendimento pode vazar para o número dos disparos');
});

// O aviso à área (secretaria, financeiro) é atendimento, não disparo: tem que sair do
// mesmo número com quem a pessoa está conversando.
test('o aviso à área sai pela W-API junto com o resto do atendimento', async () => {
  const { mod, chamadas } = comCanais({ canal: 'wapi' });
  await mod.enviarTexto('595992010423', 'Novo atendimento aguardando');
  assert.strictEqual(chamadas[0].via, 'wapi');
});

// Modelo aprovado é recurso exclusivo da API Oficial — a W-API não tem esse conceito.
// Aqui ele é só rede de segurança: se a W-API cair, o aviso à área ainda entrega.
test('o modelo aprovado vai pela oficial mesmo com o atendimento na W-API', async () => {
  const { mod, chamadas } = comCanais({ canal: 'wapi' });
  await mod.enviarTemplate('595991', 'novo_atendimento', 'pt_BR', []);
  assert.strictEqual(chamadas[0].via, 'oficial');
  assert.strictEqual(chamadas[0].tipo, 'template');
});

// Canal configurado como wapi + adaptador fora do ar não pode virar silêncio: membro
// escrevendo pra liga e não recebendo resposta é pior do que responder pelo outro número.
test('W-API indisponível cai na oficial em vez de derrubar o atendimento', async () => {
  const { mod, chamadas } = comCanais({ canal: 'wapi', wapiQuebrado: true });
  await mod.enviarTexto('595991', 'oi');
  assert.strictEqual(chamadas[0].via, 'oficial');
});

test('provedor() reflete a configuração', () => {
  assert.strictEqual(comCanais({}).mod.provedor(), 'oficial');
  assert.strictEqual(comCanais({ canal: 'WAPI' }).mod.provedor(), 'wapi');
});
