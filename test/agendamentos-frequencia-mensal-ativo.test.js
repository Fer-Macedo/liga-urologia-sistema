// 21/08/2026: BUG REAL em produção, achado ao investigar duplicatas de cadastro financeiro —
// enviarFrequenciaMensal (relatório mensal de frequência) filtrava m.ativo=1 do lado dos
// diretivos, mas NUNCA filtrava isso do lado dos ligantes. Um ligante inativado (ex: virou
// diretivo, ou foi desligado da liga) continua em turma_membros pra sempre — sem o filtro, ele
// seguia recebendo o relatório de frequência de LIGANTE indefinidamente, mesmo não sendo mais
// ligante ativo nenhum. Caso real: Hugo Fernando Carvalho Massaferro, inativado como ligante
// ao virar diretivo, mas ficou preso em turma_membros.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/agendamentos.js');

function montar({ membros = [], diretivos = [] } = {}) {
  const wppEnviados = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT \* FROM turmas WHERE ativo=1/.test(sql)) return { rows: [{ id: 1, nome: 'Turma A' }] };
      if (/SELECT \* FROM diretivo_turmas WHERE ativo=1/.test(sql)) return { rows: [] };
      if (/FROM turma_membros tm JOIN membros m ON m\.id=tm\.membro_id WHERE tm\.turma_id=\$1 AND m\.ativo=1/.test(sql)) {
        return { rows: membros.filter(m => m.ativo === 1) };
      }
      if (/SELECT id FROM notificacoes_log WHERE membro_id=\$1 AND tipo='frequencia'/.test(sql)) return { rows: [] };
      if (/INSERT INTO notificacoes_log/.test(sql)) return { rows: [] };
      if (/SELECT chave, valor FROM configuracoes/.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  }};
  const rn = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rn] = { id: rn, filename: rn, loaded: true, exports: {
    enviarWhatsApp: async (numero) => { wppEnviados.push(numero); },
    enviarEmail: async () => {},
    notificarCobranca: async () => {},
    notificarAniversario: async () => {}
  }};
  const rpg = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  require.cache[rpg] = { id: rpg, filename: rpg, loaded: true, exports: {
    criarCobranca: async () => ({}), consultarPagamento: async () => ({}), consultarCheckout: async () => ({}),
    detectarMetodo: () => '', extrairDataPagamento: () => null, extrairValorPago: () => 0
  }};

  delete require.cache[require.resolve(MODULO)];
  const mod = require(MODULO);
  return { mod, wppEnviados };
}

test('ligante ATIVO em turma_membros recebe o relatório mensal de frequência', async () => {
  const { mod, wppEnviados } = montar({
    membros: [{ id: 1, nome: 'Ana Ligante', whatsapp: '595111', email: null, ativo: 1 }]
  });
  await mod.enviarFrequenciaMensal();
  assert.ok(wppEnviados.includes('595111'), 'ligante ativo tem que receber o relatório');
});

test('ligante INATIVO (ex: virou diretivo) NÃO recebe mais o relatório de frequência de ligante', async () => {
  const { mod, wppEnviados } = montar({
    membros: [{ id: 2, nome: 'Hugo Ex-Ligante', whatsapp: '595222', email: null, ativo: 0 }]
  });
  await mod.enviarFrequenciaMensal();
  assert.ok(!wppEnviados.includes('595222'), 'ligante inativo não deveria mais receber o relatório de ligante');
});

test('mistura: só o ligante ativo recebe, o inativo fica de fora', async () => {
  const { mod, wppEnviados } = montar({
    membros: [
      { id: 1, nome: 'Ana Ligante', whatsapp: '595111', email: null, ativo: 1 },
      { id: 2, nome: 'Hugo Ex-Ligante', whatsapp: '595222', email: null, ativo: 0 }
    ]
  });
  await mod.enviarFrequenciaMensal();
  assert.deepStrictEqual(wppEnviados, ['595111']);
});
