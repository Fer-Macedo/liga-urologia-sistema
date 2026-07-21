// REGRA CRÍTICA: assim que um atendimento é direcionado a uma área, o assistente virtual
// PARA de responder e vira só mensageiro (proxy). Se a IA respondesse junto com a área,
// o membro receberia duas respostas — a da pessoa da área e a do robô. Já aconteceu uma
// vez e foi corrigido; estes testes prendem a regra pra nunca mais voltar.
//
// Os testes provam as duas metades:
//   1. Membro com atendimento aberto escreve  -> vai pra ÁREA, a IA (Anthropic) NÃO é chamada.
//   2. Área responde                          -> vai pro MEMBRO, a IA NÃO é chamada.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/lauro.js');

const AREA_SECRETARIA = '595973738431';   // paraguaio (bate com o contato padrão)
const MEMBRO = '5511988887777';

function montar({ membroComAtendimento = false, areaComAtendimento = false } = {}) {
  const enviados = [];      // { numero, msg }
  let iaChamada = false;

  // axios TEM que ser stubado ANTES de o lauro.js ser carregado (ele faz require no topo).
  const rax = require.resolve('axios');
  require.cache[rax] = { id: rax, filename: rax, loaded: true, exports: {
    post: async (url) => {
      if (/anthropic/.test(String(url))) iaChamada = true;   // <- a IA foi acionada
      return { data: { content: [{ text: 'RESPOSTA DA IA' }], usage: { input_tokens: 1, output_tokens: 1 } } };
    },
    get: async () => ({ data: {} })
  }};

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql) => {
      if (/SELECT area, numero FROM lauro_contatos/.test(sql)) {
        return { rows: [{ area: 'secretaria', numero: AREA_SECRETARIA }] };
      }
      // membro -> área: existe atendimento aberto para este membro?
      if (/FROM lauro_atendimentos WHERE numero_membro=\$1 AND status='aguardando'/.test(sql)) {
        return { rows: membroComAtendimento ? [{ numero_area: AREA_SECRETARIA, area: 'secretaria' }] : [] };
      }
      // área -> membros: fila de atendimentos aguardando desta área
      if (/FROM lauro_atendimentos WHERE numero_area=\$1 AND status='aguardando'/.test(sql)) {
        return { rows: areaComAtendimento ? [{ id: 1, numero_membro: MEMBRO, idioma: 'pt', nome_contato: 'Fulano' }] : [] };
      }
      return { rows: [] };  // nomes, salvarConversa, etc.
    }
  }};

  const rc = require.resolve(path.join(RAIZ, 'src/services/canal-assistente.js'));
  require.cache[rc] = { id: rc, filename: rc, loaded: true, exports: {
    enviarTexto:    async (n, m) => { enviados.push({ numero: n, msg: m }); return { ok: true }; },
    enviarTemplate: async () => ({ ok: true }),
    enviarImagem:   async (n) => { enviados.push({ numero: n, msg: '[img]' }); return { ok: true }; },
    enviarDocumento:async (n) => { enviados.push({ numero: n, msg: '[doc]' }); return { ok: true }; }
  }};

  delete require.cache[require.resolve(MODULO)];
  const mod = require(MODULO);
  return { mod, enviados, iaFoiChamada: () => iaChamada };
}

test('membro com atendimento aberto: mensagem vai pra ÁREA e a IA NÃO responde', async () => {
  const { mod, enviados, iaFoiChamada } = montar({ membroComAtendimento: true });
  await mod.recarregarContatos();
  await mod.processarMensagem(MEMBRO, 'ainda preciso de ajuda com meu pagamento', null);

  assert.strictEqual(iaFoiChamada(), false, 'a IA NÃO pode ser chamada com atendimento aberto');
  const foiPraArea = enviados.some(e => e.numero === AREA_SECRETARIA);
  assert.ok(foiPraArea, 'a mensagem do membro tem que ser repassada para a área');
  const respondeuAoMembro = enviados.some(e => e.numero === MEMBRO);
  assert.ok(!respondeuAoMembro, 'o robô NÃO pode mandar resposta ao membro nesse momento');
});

test('área responde: mensagem vai pro MEMBRO e a IA NÃO responde', async () => {
  const { mod, enviados, iaFoiChamada } = montar({ areaComAtendimento: true });
  await mod.recarregarContatos();
  await mod.processarMensagem(AREA_SECRETARIA, 'Olá! Já resolvi seu pagamento, tudo certo.', null);

  assert.strictEqual(iaFoiChamada(), false, 'a resposta da área não pode acionar a IA');
  const foiProMembro = enviados.some(e => e.numero === MEMBRO && /resolvi/.test(e.msg));
  assert.ok(foiProMembro, 'a resposta da área tem que chegar ao membro');
});

// A prova de que NÃO é "a IA está desligada": sem atendimento aberto, a IA responde normal.
// Passa pelo onboarding (idioma -> nome -> ativo) até a 3ª mensagem, que aciona a IA.
test('sem atendimento aberto: a IA volta a responder o membro', async () => {
  const { mod, iaFoiChamada } = montar({ membroComAtendimento: false });
  await mod.recarregarContatos();
  await mod.processarMensagem(MEMBRO, 'ola', null);                          // 1ª: idioma
  await mod.processarMensagem(MEMBRO, 'Fulano de Tal', null);                // 2ª: nome
  await mod.processarMensagem(MEMBRO, 'qual o valor da mensalidade?', null); // 3ª: aciona a IA
  assert.strictEqual(iaFoiChamada(), true, 'sem atendimento aberto, a IA tem que atender');
});
