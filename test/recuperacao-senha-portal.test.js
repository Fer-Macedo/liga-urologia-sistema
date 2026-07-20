// Em 2026-07-20 nenhum código de recuperação de senha do portal do membro funcionava —
// não para um usuário, para TODOS, desde sempre. A validade era calculada no Node
// (`Date.now() + 15min`) e conferida contra o `NOW()` do banco. Como o PostgreSQL roda em
// Europe/Berlin e o Node em outro fuso, a coluna `timestamp without time zone` guardava
// horas de relógios diferentes e o código nascia expirado ~5h antes de ser criado.
//
// Estes testes prendem a regra: quem calcula a validade é o BANCO, sempre. Enquanto o
// fuso do banco não for resolvido, qualquer volta ao cálculo no Node quebra tudo de novo.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/portal-membro.js');

// Monta a rota com o banco dublado e devolve as consultas que ela fez.
function montar({ achaUsuario = true } = {}) {
  const consultas = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      consultas.push({ sql, params });
      if (/FROM ligantes/.test(sql)) return { rows: achaUsuario ? [{ id: 7 }] : [] };
      if (/FROM diretivos/.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  }};
  const rn = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rn] = { id: rn, filename: rn, loaded: true, exports: { enviarEmail: async () => ({ ok: true }) } };
  const rc = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rc] = { id: rc, filename: rc, loaded: true, exports: { getConfig: async () => ({}) } };

  let handler = null;
  const router = {
    get: () => {}, use: () => {},
    post: (rota, ...fns) => { if (rota === '/membro/esqueci-senha') handler = fns[fns.length - 1]; }
  };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);

  const pedir = async (email) => {
    await handler({ body: { email }, session: {} }, { render: () => {}, redirect: () => {} });
    return consultas;
  };
  return { pedir };
}

test('a validade do código é calculada pelo banco, não pelo Node', async () => {
  const { pedir } = montar();
  const consultas = await pedir('josias@teste.com');
  const insert = consultas.find(c => /INSERT INTO recuperacao_senha_portal/.test(c.sql));
  assert.ok(insert, 'deveria gravar o pedido de recuperação');
  assert.match(insert.sql, /NOW\(\) \+ INTERVAL/,
    'a expiração precisa sair do relógio do banco — ver o bug do fuso Europe/Berlin');
});

// A regressão exata que causou o incidente: uma Date do Node indo como parâmetro.
test('nenhuma data do Node é enviada como parâmetro do INSERT', async () => {
  const { pedir } = montar();
  const consultas = await pedir('josias@teste.com');
  const insert = consultas.find(c => /INSERT INTO recuperacao_senha_portal/.test(c.sql));
  const datas = (insert.params || []).filter(p => p instanceof Date);
  assert.strictEqual(datas.length, 0,
    'data calculada no Node numa coluna sem fuso é o que fez o código nascer expirado');
});

test('códigos anteriores são invalidados antes de gerar um novo', async () => {
  const { pedir } = montar();
  const consultas = await pedir('josias@teste.com');
  const iUpdate = consultas.findIndex(c => /UPDATE recuperacao_senha_portal SET usado=true WHERE email/.test(c.sql));
  const iInsert = consultas.findIndex(c => /INSERT INTO recuperacao_senha_portal/.test(c.sql));
  assert.ok(iUpdate >= 0 && iInsert >= 0);
  assert.ok(iUpdate < iInsert, 'invalidar os antigos tem que vir antes de criar o novo');
});

test('o código gravado tem 6 dígitos', async () => {
  const { pedir } = montar();
  const consultas = await pedir('josias@teste.com');
  const insert = consultas.find(c => /INSERT INTO recuperacao_senha_portal/.test(c.sql));
  assert.match(String(insert.params[3]), /^\d{6}$/);
});

// E-mail desconhecido não pode gerar registro nenhum, nem revelar que não existe.
test('e-mail não cadastrado não grava pedido de recuperação', async () => {
  const { pedir } = montar({ achaUsuario: false });
  const consultas = await pedir('ninguem@teste.com');
  assert.ok(!consultas.some(c => /INSERT INTO recuperacao_senha_portal/.test(c.sql)));
});
