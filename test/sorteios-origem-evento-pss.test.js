// 17/08/2026: pedido do usuário — integrar a aba de Sorteios com eventos e processos
// seletivos, pra puxar os inscritos automaticamente em vez de digitar nome por nome. Regra
// explícita: só quem CONCLUIU a inscrição (status='confirmado') entra no sorteio — pendente
// fica de fora. A lista é resolvida NA HORA (não fixada na criação), pra quem concluir depois
// já entrar sozinho na próxima vez que a roleta for aberta.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/sorteios.js');

function montar({ sorteio, eventoInscritos, pssCandidatos, mock } = {}) {
  const inserts = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (mock) { const r = mock(sql, params); if (r !== undefined) return r; }
      if (/SELECT \* FROM sorteios WHERE id=\$1/.test(sql)) return { rows: sorteio ? [sorteio] : [] };
      if (/SELECT nome FROM evento_inscricoes WHERE evento_id=\$1 AND status='confirmado'/.test(sql)) return { rows: eventoInscritos || [] };
      if (/SELECT nome FROM ps_candidatos WHERE processo_id=\$1 AND status='confirmado'/.test(sql)) return { rows: pssCandidatos || [] };
      if (/SELECT nome FROM eventos WHERE id=\$1/.test(sql)) return { rows: [{ nome: 'II Jornada de Salud del Hombre' }] };
      if (/SELECT nome FROM ps_processos WHERE id=\$1/.test(sql)) return { rows: [{ nome: 'PSS 2026.2' }] };
      if (/INSERT INTO sorteios/.test(sql)) { inserts.push(params); return { rows: [{ id: 99 }] }; }
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, inserts };
}

function resRender() { const r = {}; r.render = (view, locals) => { r._view = view; r._locals = locals; return r; }; return r; }
function resRedirect() { const r = {}; r.redirect = (u) => { r._redirect = u; return r; }; return r; }
function reqBase(extra) { return Object.assign({ session: { usuario: { id: 1 } }, flash: () => [] }, extra); }

test('GET /sorteios/:id: publico_alvo=evento só traz quem CONCLUIU (status confirmado já filtrado na query)', async () => {
  const { rotas } = montar({
    sorteio: { id: 5, tipo: 'interno', publico_alvo: 'evento', origem_tipo: 'evento', origem_id: 5, ganhador_nome: null },
    eventoInscritos: [{ nome: 'Ana Confirmada' }, { nome: 'Bruno Confirmado' }]
  });
  const res = resRender();
  await rotas['GET /sorteios/:id'](reqBase({ params: { id: '5' } }), res);
  assert.deepStrictEqual(res._locals.participantes, ['Ana Confirmada', 'Bruno Confirmado']);
  assert.strictEqual(res._locals.origemNome, 'II Jornada de Salud del Hombre');
});

test('GET /sorteios/:id: publico_alvo=pss resolve participantes de ps_candidatos confirmados', async () => {
  const { rotas } = montar({
    sorteio: { id: 6, tipo: 'interno', publico_alvo: 'pss', origem_tipo: 'pss', origem_id: 3, ganhador_nome: null },
    pssCandidatos: [{ nome: 'Carla Candidata' }]
  });
  const res = resRender();
  await rotas['GET /sorteios/:id'](reqBase({ params: { id: '6' } }), res);
  assert.deepStrictEqual(res._locals.participantes, ['Carla Candidata']);
  assert.strictEqual(res._locals.origemNome, 'PSS 2026.2');
});

test('GET /sorteios/:id: evento sem ninguém concluído ainda — lista vazia, não quebra', async () => {
  const { rotas } = montar({
    sorteio: { id: 5, tipo: 'interno', publico_alvo: 'evento', origem_tipo: 'evento', origem_id: 5, ganhador_nome: null },
    eventoInscritos: []
  });
  const res = resRender();
  await rotas['GET /sorteios/:id'](reqBase({ params: { id: '5' } }), res);
  assert.deepStrictEqual(res._locals.participantes, []);
});

test('POST /sorteios/criar: publico_alvo=evento grava origem_tipo e origem_id (não guarda lista fixa)', async () => {
  const { rotas, inserts } = montar({});
  const req = reqBase({ body: { tipo: 'interno', nome: 'Sorteio da Jornada', qtd_ganhadores: '1', publico_alvo: 'evento', origem_id: '5' } });
  await rotas['POST /sorteios/criar'](req, resRedirect());
  assert.strictEqual(inserts.length, 1);
  // ordem dos params no INSERT: tipo,nome,descricao,qtd_ganhadores,publico_alvo,participantes_manual,instagram_liga,tarefas,criado_por,origem_tipo,origem_id
  const p = inserts[0];
  assert.strictEqual(p[4], 'evento', 'publico_alvo salvo');
  assert.strictEqual(p[5], null, 'não guarda snapshot fixo de participantes — resolve na hora');
  assert.strictEqual(p[9], 'evento', 'origem_tipo');
  assert.strictEqual(p[10], 5, 'origem_id');
});

test('POST /sorteios/criar: publico_alvo=pss grava origem_tipo=pss', async () => {
  const { rotas, inserts } = montar({});
  const req = reqBase({ body: { tipo: 'interno', nome: 'Sorteio PSS', qtd_ganhadores: '1', publico_alvo: 'pss', origem_id: '3' } });
  await rotas['POST /sorteios/criar'](req, resRedirect());
  const p = inserts[0];
  assert.strictEqual(p[9], 'pss');
  assert.strictEqual(p[10], 3);
});

test('POST /sorteios/criar: publico_alvo normal (ligantes) não seta origem_tipo/origem_id', async () => {
  const { rotas, inserts } = montar({});
  const req = reqBase({ body: { tipo: 'interno', nome: 'Sorteio Ligantes', qtd_ganhadores: '1', publico_alvo: 'ligantes' } });
  await rotas['POST /sorteios/criar'](req, resRedirect());
  const p = inserts[0];
  assert.strictEqual(p[9], null);
  assert.strictEqual(p[10], null);
});

test('GET /sorteios: traz eventosDisponiveis e processosDisponiveis com contagem de concluídos', async () => {
  const { rotas } = montar({
    mock: (sql) => {
      if (/FROM eventos e ORDER BY/.test(sql)) return { rows: [{ id: 5, nome: 'Jornada', concluidos: '57' }] };
      if (/FROM ps_processos p ORDER BY/.test(sql)) return { rows: [{ id: 3, nome: 'PSS 2026.2', concluidos: '13' }] };
      if (/SELECT \* FROM sorteios ORDER BY/.test(sql)) return { rows: [] };
      if (/FROM membros WHERE ativo=1/.test(sql)) return { rows: [] };
      if (/FROM diretivos WHERE ativo=1/.test(sql)) return { rows: [] };
      return undefined;
    }
  });
  const res = resRender();
  await rotas['GET /sorteios'](reqBase({}), res);
  assert.deepStrictEqual(res._locals.eventosDisponiveis, [{ id: 5, nome: 'Jornada', concluidos: '57' }]);
  assert.deepStrictEqual(res._locals.processosDisponiveis, [{ id: 3, nome: 'PSS 2026.2', concluidos: '13' }]);
});
