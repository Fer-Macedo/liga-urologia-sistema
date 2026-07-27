// O calendário mostrava o aniversário de todo mundo um dia adiantado (ex: Ellen, nascida
// 27/07, aparecia no dia 26/07). Causa: getAniversarios() reconstruía a data com
// Date.UTC(ano, mes, dia) — meia-noite UTC — enquanto TODO o resto do calendário
// (atividades criadas na tela) guarda hora LOCAL, e a grade lê o dia com getFullYear/
// getMonth/getDate LOCAIS. Meia-noite UTC cai no fim da tarde do dia ANTERIOR em
// America/Asuncion (o fuso do servidor), então o aniversário "vazava" para o dia de trás.
// O bug era universal (todo aniversário de todo mundo), não específico de uma pessoa.
process.env.TZ = 'America/Asuncion'; // mesmo fuso do servidor, para o teste ser fiel

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/calendario.js');

function montar({ nascimento = '2001-07-27' } = {}) {
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql) => {
      if (/FROM calendario_atividades/.test(sql)) return { rows: [] };
      if (/FROM membros/.test(sql)) {
        return { rows: [{ nome: 'Ellen Cordeiro Nunes', data_nascimento: nascimento, tipo: 'membro' }] };
      }
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: {
    requireAuth: (q, s, n) => n(), requirePermissao: () => (q, s, n) => n()
  }};
  const rc = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rc] = { id: rc, filename: rc, loaded: true, exports: { getConfig: async () => ({}) } };

  let handler = null;
  const router = { get: (rota, ...fns) => { if (rota === '/calendario') handler = fns[fns.length - 1]; }, post: () => {}, delete: () => {} };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);

  const chamar = async () => {
    const req = { session: { usuario: { id: 1, perfil: 'admin' } }, flash: () => [] };
    let dados = null;
    const res = { render: (view, d) => { dados = d; }, send: (msg) => { throw new Error('rota respondeu erro: ' + msg); } };
    await handler(req, res);
    return dados.atividades;
  };
  return { chamar };
}

// Reproduz EXATAMENTE o que a grade do calendario.ejs faz para bucketar um evento no dia
// certo (views/pages/calendario.ejs:566): new Date(e.data_inicio) + getters LOCAIS.
function diaNaGrade(dataInicioIso) {
  const ini = new Date(dataInicioIso);
  return new Date(ini.getFullYear(), ini.getMonth(), ini.getDate());
}

test('aniversário de 27/07 cai no dia 27 na grade do calendário, não no 26', async () => {
  const { chamar } = montar({ nascimento: '2001-07-27' });
  const atividades = await chamar();
  const anivs2026 = atividades.filter(a => diaNaGrade(a.data_inicio).getFullYear() === 2026);
  assert.ok(anivs2026.length >= 1, 'tem que gerar pelo menos o aniversário do ano corrente');
  const dia = diaNaGrade(anivs2026[0].data_inicio);
  assert.strictEqual(dia.getDate(), 27, 'o aniversário de 27/07 não pode aparecer no dia 26 — era esse o bug relatado');
  assert.strictEqual(dia.getMonth(), 6, 'julho (0-indexado = 6)');
});

test('funciona também em janeiro (virada de ano, mesmo mecanismo)', async () => {
  const { chamar } = montar({ nascimento: '1999-01-05' });
  const atividades = await chamar();
  const alvo = atividades.find(a => diaNaGrade(a.data_inicio).getMonth() === 0);
  assert.ok(alvo, 'tem que existir um aniversário gerado em janeiro');
  assert.strictEqual(diaNaGrade(alvo.data_inicio).getDate(), 5);
});

test('gera o aniversário para o ano anterior, o atual e o seguinte', async () => {
  const { chamar } = montar();
  const atividades = await chamar();
  const anos = new Set(atividades.map(a => diaNaGrade(a.data_inicio).getFullYear()));
  assert.ok(anos.size >= 3, 'precisa cobrir ano-1, ano e ano+1 para o calendário navegar entre meses/anos sem sumir o aniversário');
});
