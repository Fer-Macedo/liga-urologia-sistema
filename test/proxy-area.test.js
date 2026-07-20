// O assistente vira proxy quando quem escreve é um número de ÁREA: em vez de atender como
// se fosse um membro, ele repassa a resposta ao membro que está esperando.
//
// O reconhecimento comparava string com string. Como o contato da área é cadastrado com o
// nono dígito (5541991796180) e o WhatsApp entrega sem ele (554191796180), só as áreas
// paraguaias eram reconhecidas — as quatro brasileiras caíam no fluxo de membro e o
// assistente começava a perguntar idioma e nome para a própria diretoria.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/lauro.js');

// Devolve true se a mensagem foi tratada como vinda de uma ÁREA (caminho do proxy).
async function tratadaComoArea(numeroQueEscreveu) {
  let consultouAtendimentoDaArea = false;

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      // consulta que SÓ acontece no caminho do proxy de área
      if (/FROM lauro_atendimentos WHERE numero_area=/.test(sql)) {
        consultouAtendimentoDaArea = true;
        return { rows: [] };
      }
      if (/SELECT area, numero FROM lauro_contatos/.test(sql)) {
        return { rows: [
          { area: 'financeiro', numero: '5541991796180' },  // brasileiro, com nono dígito
          { area: 'secretaria', numero: '595973738431' }     // paraguaio
        ] };
      }
      return { rows: [] };
    }
  }};
  const rc = require.resolve(path.join(RAIZ, 'src/services/canal-assistente.js'));
  require.cache[rc] = { id: rc, filename: rc, loaded: true, exports: {
    enviarTexto: async () => ({ ok: true }), enviarTemplate: async () => ({ ok: true }),
    enviarImagem: async () => ({ ok: true }), enviarDocumento: async () => ({ ok: true })
  }};

  delete require.cache[require.resolve(MODULO)];
  const mod = require(MODULO);
  await mod.recarregarContatos();
  try { await mod.processarMensagem(numeroQueEscreveu, 'oi', null); } catch (e) {}
  return consultouAtendimentoDaArea;
}

test('área paraguaia é reconhecida (grafia idêntica)', async () => {
  assert.strictEqual(await tratadaComoArea('595973738431'), true);
});

// A regressão real: o financeiro escrevia e o assistente o tratava como um desconhecido.
test('área brasileira é reconhecida mesmo chegando sem o nono dígito', async () => {
  assert.strictEqual(await tratadaComoArea('554191796180'), true,
    'cadastrado como 5541991796180, o WhatsApp entrega como 554191796180');
});

test('área brasileira também é reconhecida na grafia cadastrada', async () => {
  assert.strictEqual(await tratadaComoArea('5541991796180'), true);
});

// Cuidado ao escolher o número deste caso: `CONTATOS` tem padrões embutidos no lauro.js
// (inclusive presidencia: 557999444808), então um número "qualquer" pode ser área de fato.
test('número de fora não é confundido com área', async () => {
  assert.strictEqual(await tratadaComoArea('5511987654321'), false);
});

// O nono dígito não pode aproximar números diferentes: 554199... e 554191... são pessoas
// distintas, e confundi-las mandaria a conversa de um membro para a diretoria errada.
test('número parecido com o de uma área não é confundido com ela', async () => {
  assert.strictEqual(await tratadaComoArea('5541991796181'), false);
});
