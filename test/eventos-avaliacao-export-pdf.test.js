// 19/08/2026: pedido do usuário — o export de avaliação (CSV) não carrega os gráficos, mas a
// coordenação da universidade exige o relatório COM os gráficos pra usar como métrica. Gera um
// PDF no servidor (Chromium headless, mesmo padrão de carta-cobranca.js/imprimir): HTML com
// Chart.js de verdade, um gráfico de barra por pergunta, por dia. O puppeteer é substituído por
// um dublê — testar HTML/dados que chegam nele, não abrir um Chrome de verdade a cada teste.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar({ evento, diasProgramacao = [], checkouts = [], mock } = {}) {
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (mock) { const r = mock(sql, params); if (r !== undefined) return r; }
      if (/SELECT nome, avaliacao_perguntas FROM eventos WHERE id=\$1/.test(sql)) return { rows: evento ? [evento] : [] };
      if (/SELECT id, titulo, data FROM evento_programacao WHERE evento_id=\$1 AND data IS NOT NULL/.test(sql)) return { rows: diasProgramacao };
      if (/SELECT programacao_id, aval_respostas, aval_sugestoes FROM evento_checkouts/.test(sql)) return { rows: checkouts };
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };
  const re = require.resolve(path.join(RAIZ, 'src/services/email.js'));
  require.cache[re] = { id: re, filename: re, loaded: true, exports: { enviarEmail: async () => {}, emailBonito: () => '' } };
  const rpg = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  require.cache[rpg] = { id: rpg, filename: rpg, loaded: true, exports: { criarPixEvento: async () => ({}), consultarPagamento: async () => ({}), obterChavePublica: async () => ({}), pagarComCartao: async () => ({}) } };
  const rev = require.resolve(path.join(RAIZ, 'src/services/eventos-email.js'));
  require.cache[rev] = { id: rev, filename: rev, loaded: true, exports: { enviarEmailConfirmacaoEvento: async () => {}, TEXTO_CONFIRMACAO_PADRAO: 'x' } };
  const rrl = require.resolve(path.join(RAIZ, 'src/services/rate-limiters.js'));
  require.cache[rrl] = { id: rrl, filename: rrl, loaded: true, exports: { limiterPagamentoCartao: (q,s,n)=>n() } };
  const rfx = require.resolve(path.join(RAIZ, 'src/services/fluxo-eventos.js'));
  require.cache[rfx] = { id: rfx, filename: rfx, loaded: true, exports: { calcularLiquidoEvento: (v) => v } };
  const rnt = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rnt] = { id: rnt, filename: rnt, loaded: true, exports: { enviarWhatsApp: async () => {}, enviarEmail: async () => {}, htmlSimples: () => '' } };

  // Dublê do puppeteer-core + @sparticuz/chromium — captura o HTML que teria virado PDF em vez
  // de abrir um Chrome de verdade.
  const chamadas = { setContentHtml: null, pdfOpcoes: null };
  const rpp = require.resolve('puppeteer-core');
  require.cache[rpp] = { id: rpp, filename: rpp, loaded: true, exports: {
    launch: async () => ({
      newPage: async () => ({
        setContent: async (html) => { chamadas.setContentHtml = html; },
        pdf: async (opcoes) => { chamadas.pdfOpcoes = opcoes; return Buffer.from('%PDF-fake'); }
      }),
      close: async () => {}
    })
  }};
  const rchr = require.resolve('@sparticuz/chromium');
  require.cache[rchr] = { id: rchr, filename: rchr, loaded: true, exports: { args: [], setHeadlessMode: false, setGraphicsMode: false, executablePath: async () => '/bin/true' } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, chamadas };
}

function resPdf() {
  const r = { _headers: {} };
  r.setHeader = (k, v) => { r._headers[k] = v; };
  r.end = (b) => { r._body = b; };
  r.status = (c) => { r._status = c; return { send: (b) => { r._body = b; } }; };
  return r;
}

const EVENTO = { nome: 'Jornada Teste' };

test('GET /eventos/:id/avaliacao-export-pdf: gera PDF com um gráfico por pergunta, por dia, com os mesmos rótulos/cores do painel', async () => {
  const { rotas, chamadas } = montar({
    evento: { nome: 'Jornada Teste', avaliacao_perguntas: JSON.stringify(['Tema', 'Tempo']) },
    diasProgramacao: [
      { id: 10, titulo: 'Día 1', data: '2026-08-17' },
      { id: 11, titulo: 'Día 2', data: '2026-08-18' }
    ],
    checkouts: [
      { programacao_id: 10, aval_respostas: JSON.stringify([6, 5]), aval_sugestoes: 'Muy bueno' },
      { programacao_id: 10, aval_respostas: JSON.stringify([5, 4]), aval_sugestoes: null },
      { programacao_id: 11, aval_respostas: JSON.stringify([3, 3]), aval_sugestoes: null }
    ]
  });
  const res = resPdf();
  await rotas['GET /eventos/:id/avaliacao-export-pdf']({ params: { id: '5' } }, res);

  assert.strictEqual(res._headers['Content-Type'], 'application/pdf');
  assert.match(res._headers['Content-Disposition'], /attachment; filename="avaliacao-Jornada_Teste\.pdf"/);
  assert.ok(Buffer.isBuffer(res._body), 'o corpo da resposta precisa ser um Buffer (não Uint8Array cru, senão o Express serializa como JSON)');

  const html = chamadas.setContentHtml;
  assert.match(html, /Jornada Teste/, 'título do relatório traz o nome do evento');
  assert.match(html, /17\/08\/2026/);
  assert.match(html, /18\/08\/2026/);
  assert.match(html, /Tema/);
  assert.match(html, /Tempo/);
  assert.match(html, /chart\.js@4\.4\.0/, 'usa o mesmo Chart.js do painel');
  assert.match(html, /c_0_0/, 'canvas do dia 0, pergunta 0');
  assert.match(html, /c_0_1/, 'canvas do dia 0, pergunta 1');
  assert.match(html, /c_1_0/, 'canvas do dia 1, pergunta 0');
  assert.match(html, /Péssimo.*Ruim.*Regular.*Bom.*Muito bom.*Excelente/, 'mesmos rótulos de nota do painel');
  // distribuição real: dia 1 (programacao_id=10) teve notas [6,5] e [5,4] -> pergunta 0: nota 6→1, nota 5→1
  assert.match(html, /\[0,0,0,0,1,1\]/, 'contagem por nota da pergunta 0 no dia 1 bate com os check-outs');
  assert.match(html, /Muy bueno/, 'sugestão do dia 1 aparece no relatório');
});

test('GET /eventos/:id/avaliacao-export-pdf: evento legado (sem Programação por data) vira um dia único com o nome do evento', async () => {
  const { rotas, chamadas } = montar({
    evento: { nome: 'Palestra Única', avaliacao_perguntas: null },
    diasProgramacao: [],
    checkouts: [
      { programacao_id: null, aval_respostas: JSON.stringify([4, 4, 4, 4]), aval_sugestoes: null }
    ]
  });
  const res = resPdf();
  await rotas['GET /eventos/:id/avaliacao-export-pdf']({ params: { id: '6' } }, res);
  assert.match(chamadas.setContentHtml, /Palestra Única/);
  assert.match(chamadas.setContentHtml, /1 resposta\(s\) registrada\(s\)/);
});

test('GET /eventos/:id/avaliacao-export-pdf: dia sem nenhuma resposta mostra "Nenhuma resposta ainda", sem gráfico vazio', async () => {
  const { rotas, chamadas } = montar({
    evento: EVENTO,
    diasProgramacao: [{ id: 10, titulo: 'Día 1', data: '2026-08-17' }],
    checkouts: []
  });
  const res = resPdf();
  await rotas['GET /eventos/:id/avaliacao-export-pdf']({ params: { id: '5' } }, res);
  assert.match(chamadas.setContentHtml, /Nenhuma resposta ainda/);
  assert.ok(!chamadas.setContentHtml.includes('c_0_0'), 'não desenha canvas sem dado nenhum pra mostrar');
});

test('GET /eventos/:id/avaliacao-export-pdf: evento não encontrado devolve 404, não tenta gerar PDF', async () => {
  const { rotas, chamadas } = montar({ evento: null });
  const res = resPdf();
  await rotas['GET /eventos/:id/avaliacao-export-pdf']({ params: { id: '999' } }, res);
  assert.strictEqual(res._status, 404);
  assert.strictEqual(chamadas.setContentHtml, null, 'nem chegou a abrir o Chromium');
});
