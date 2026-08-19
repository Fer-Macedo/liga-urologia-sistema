// BUG REAL em produção 19/08/2026: o assistente pergunta "qual seu nome?" a quem não é
// reconhecido no cadastro, mas se a pessoa ignora a pergunta e já manda a reclamação/dúvida
// (ex: "Não consegui fazer o check-out hoje, meu celular travou..."), a mensagem INTEIRA era
// salva como se fosse o nome — e isso aparecia em /atendimentos no lugar do nome/número real.
// pareceNome() (src/services/lauro.js) filtra isso: só aceita como nome um texto curto e com
// poucas palavras; qualquer outra coisa cai direto no atendimento normal (a IA responde já
// nessa mesma mensagem, sem travar pedindo o nome de novo).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/lauro.js');

const AREA_SECRETARIA = '595973738431';
const MEMBRO = '5511988887777';

function montar() {
  const enviados = [];
  let iaChamada = false;

  const rax = require.resolve('axios');
  require.cache[rax] = { id: rax, filename: rax, loaded: true, exports: {
    post: async (url) => {
      if (/anthropic/.test(String(url))) iaChamada = true;
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
      if (/FROM lauro_atendimentos WHERE numero_membro=\$1 AND status='aguardando'/.test(sql)) {
        return { rows: [] };
      }
      return { rows: [] }; // nomes (membros/ligantes), salvarConversa etc — ninguém reconhecido
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

test('pergunta o nome, pessoa ignora e já manda a reclamação: não vira "nome", atendimento segue normal', async () => {
  const { mod, iaFoiChamada, enviados } = montar();
  await mod.recarregarContatos();
  await mod.processarMensagem(MEMBRO, 'ola', null); // 1ª: pede o nome
  const reclamacao = 'Não consegui fazer o check-out hoje, meu celular travou bem na hora e não sei o que fazer';
  await mod.processarMensagem(MEMBRO, reclamacao, null); // 2ª: não é nome, é a reclamação

  assert.strictEqual(iaFoiChamada(), true, 'já deveria acionar a IA nessa mesma mensagem, sem travar pedindo o nome de novo');
  assert.ok(!enviados.some(e => e.numero === MEMBRO && e.msg.includes(reclamacao)),
    'a reclamação inteira não pode ter sido "ecoada" de volta como se fosse o nome capturado');
});

test('nome de verdade (poucas palavras) continua sendo capturado normalmente', async () => {
  const { mod, iaFoiChamada, enviados } = montar();
  await mod.recarregarContatos();
  await mod.processarMensagem(MEMBRO, 'ola', null);
  await mod.processarMensagem(MEMBRO, 'Maria da Silva Santos', null); // nome com 4 palavras

  assert.strictEqual(iaFoiChamada(), false, 'nome de verdade não deve cair direto na IA nessa mensagem');
  assert.ok(enviados.some(e => e.numero === MEMBRO && e.msg.includes('Maria da Silva Santos')),
    'o nome deveria ter sido usado na saudação de boas-vindas');
});
