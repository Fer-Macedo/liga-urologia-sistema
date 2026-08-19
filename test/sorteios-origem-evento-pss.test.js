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

function montar({ sorteio, eventoInscritos, pssCandidatos, membros, diretivos, mock } = {}) {
  const inserts = [];
  const updates = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (mock) { const r = mock(sql, params); if (r !== undefined) return r; }
      if (/SELECT status, ganhador_nome FROM sorteios WHERE id=\$1/.test(sql)) return { rows: sorteio ? [{ status: sorteio.status, ganhador_nome: sorteio.ganhador_nome || null }] : [] };
      if (/SELECT \* FROM sorteios WHERE id=\$1/.test(sql)) return { rows: sorteio ? [sorteio] : [] };
      if (/SELECT nome FROM membros WHERE ativo=1/.test(sql)) return { rows: membros || [] };
      if (/SELECT nome FROM diretivos WHERE ativo=1/.test(sql)) return { rows: diretivos || [] };
      if (/SELECT nome FROM evento_inscricoes WHERE evento_id=\$1 AND status='confirmado'/.test(sql)) return { rows: eventoInscritos || [] };
      if (/SELECT nome FROM ps_candidatos WHERE processo_id=\$1 AND status='confirmado'/.test(sql)) return { rows: pssCandidatos || [] };
      if (/SELECT nome FROM eventos WHERE id=\$1/.test(sql)) return { rows: [{ nome: 'II Jornada de Salud del Hombre' }] };
      if (/SELECT nome FROM ps_processos WHERE id=\$1/.test(sql)) return { rows: [{ nome: 'PSS 2026.2' }] };
      if (/INSERT INTO sorteios/.test(sql)) { inserts.push(params); return { rows: [{ id: 99 }] }; }
      if (/UPDATE sorteios SET tipo=\$1/.test(sql)) { updates.push(params); return { rows: [] }; }
      if (/UPDATE sorteios SET status='sorteado', ganhador_nome=\$1/.test(sql)) { updates.push(params); return { rows: [] }; }
      if (/UPDATE sorteios SET ganhador_nome=\$1 WHERE id=\$2/.test(sql)) { updates.push(params); return { rows: [] }; }
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
  return { rotas, inserts, updates };
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

// 19/08/2026: pedido do usuário — sorteio EXTERNO (link público) captura email/Instagram/
// WhatsApp no formulário de inscrição, mas isso nunca chegava na tela pro admin conseguir falar
// com o ganhador depois. contatosExternos leva esses 3 campos até a view, por nome, sem alterar
// "participantes" (continua só os nomes — é o que a roleta/animação do sorteio usa).
test('GET /sorteios/:id: sorteio EXTERNO leva email/Instagram/WhatsApp de cada participante pra view (contatosExternos)', async () => {
  const { rotas } = montar({
    sorteio: { id: 7, tipo: 'externo', publico_alvo: null, origem_tipo: null, origem_id: null, ganhador_nome: null },
    mock: (sql) => {
      if (/SELECT \* FROM sorteio_participantes WHERE sorteio_id=\$1/.test(sql)) return { rows: [
        { id: 1, nome: 'Ana Externa', email: 'ana@x.com', instagram: '@ana.ext', whatsapp: '+595994316286' },
        { id: 2, nome: 'Bruno Externo', email: 'bruno@x.com', instagram: 'bruno.ext', whatsapp: '+595994316287' }
      ] };
      return undefined;
    }
  });
  const res = resRender();
  await rotas['GET /sorteios/:id'](reqBase({ params: { id: '7' } }), res);
  assert.deepStrictEqual(res._locals.participantes, ['Ana Externa', 'Bruno Externo'], 'participantes continua só nomes (usado pela roleta)');
  assert.deepStrictEqual(res._locals.contatosExternos['Ana Externa'], { email: 'ana@x.com', instagram: '@ana.ext', whatsapp: '+595994316286' });
  assert.deepStrictEqual(res._locals.contatosExternos['Bruno Externo'], { email: 'bruno@x.com', instagram: 'bruno.ext', whatsapp: '+595994316287' });
});

test('GET /sorteios/:id: sorteio INTERNO não tem contatosExternos (fica vazio — só externo captura esses campos)', async () => {
  const { rotas } = montar({
    sorteio: { id: 5, tipo: 'interno', publico_alvo: 'evento', origem_tipo: 'evento', origem_id: 5, ganhador_nome: null },
    eventoInscritos: [{ nome: 'Ana Confirmada' }]
  });
  const res = resRender();
  await rotas['GET /sorteios/:id'](reqBase({ params: { id: '5' } }), res);
  assert.deepStrictEqual(res._locals.contatosExternos, {});
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

// 17/08/2026: usuário criou um sorteio "Externo" achando que dava pra escolher o evento (o
// seletor só aparece pra "Interno"), e não tinha nenhum jeito de editar o que já tinha criado
// — só dava pra excluir e recomeçar. Corrigido: botão "Editar" reaproveita o mesmo formulário.
test('POST /sorteios/:id/editar: troca de Externo pra Interno com evento — corrige sem precisar recriar', async () => {
  const { rotas, updates } = montar({ sorteio: { status: 'rascunho' } });
  const req = reqBase({ params: { id: '7' }, body: { tipo: 'interno', nome: 'Sorteio da Jornada', qtd_ganhadores: '1', publico_alvo: 'evento', origem_id: '5' } });
  await rotas['POST /sorteios/:id/editar'](req, resRedirect());
  assert.strictEqual(updates.length, 1);
  const p = updates[0];
  assert.strictEqual(p[0], 'interno', 'tipo corrigido pra interno');
  assert.strictEqual(p[8], 'evento', 'origem_tipo');
  assert.strictEqual(p[9], 5, 'origem_id');
  assert.strictEqual(p[10], '7', 'WHERE id do sorteio certo');
});

test('POST /sorteios/:id/editar: sorteio já sorteado recusa edição (precisa resetar antes)', async () => {
  const { rotas, updates } = montar({ sorteio: { status: 'sorteado' } });
  const req = reqBase({ params: { id: '7' }, body: { tipo: 'interno', nome: 'X', qtd_ganhadores: '1', publico_alvo: 'ligantes' } });
  await rotas['POST /sorteios/:id/editar'](req, resRedirect());
  assert.strictEqual(updates.length, 0, 'não altera um sorteio já com ganhador definido');
});

test('POST /sorteios/:id/editar: sorteio inexistente não quebra', async () => {
  const { rotas, updates } = montar({ sorteio: null });
  const req = reqBase({ params: { id: '999' }, body: { tipo: 'interno', nome: 'X', qtd_ganhadores: '1', publico_alvo: 'ligantes' } });
  await rotas['POST /sorteios/:id/editar'](req, resRedirect());
  assert.strictEqual(updates.length, 0);
});

// BUG REAL em produção 17/08/2026: o formulário deixou salvar publico_alvo='evento' com
// tipo='externo' ao mesmo tempo (a seção "Qual evento" não era travada pelo tipo escolhido).
// A tela mostrava "Público: Inscritos de evento — Jornada" certinho, mas a busca de
// participantes olha só pro `tipo` pra decidir de onde puxar gente — como ficou 'externo',
// caiu na tabela sorteio_participantes (vazia) e deu "Sem participantes". Corrigido: o
// servidor NUNCA confia no campo tipo do formulário quando publico_alvo é um valor que só
// existe pra sorteio interno — força tipo='interno' sempre, nesses casos.
test('POST /sorteios/criar: publico_alvo=evento força tipo=interno mesmo se o form mandou "externo"', async () => {
  const { rotas, inserts } = montar({});
  const req = reqBase({ body: { tipo: 'externo', nome: 'Sorteio da Jornada', qtd_ganhadores: '1', publico_alvo: 'evento', origem_id: '5' } });
  await rotas['POST /sorteios/criar'](req, resRedirect());
  assert.strictEqual(inserts[0][0], 'interno', 'tipo tem que ser interno — é o publico_alvo que manda, não o campo tipo do form');
});

test('POST /sorteios/:id/editar: mesma proteção na edição — publico_alvo=pss força tipo=interno', async () => {
  const { rotas, updates } = montar({ sorteio: { status: 'rascunho' } });
  const req = reqBase({ params: { id: '9' }, body: { tipo: 'externo', nome: 'Sorteio PSS', qtd_ganhadores: '1', publico_alvo: 'pss', origem_id: '3' } });
  await rotas['POST /sorteios/:id/editar'](req, resRedirect());
  assert.strictEqual(updates[0][0], 'interno');
});

test('POST /sorteios/criar: publico_alvo realmente vazio (sorteio externo de verdade) mantém tipo=externo', async () => {
  const { rotas, inserts } = montar({});
  const req = reqBase({ body: { tipo: 'externo', nome: 'Giveaway Instagram', qtd_ganhadores: '1', instagram_liga: '@lauro_urologia' } });
  await rotas['POST /sorteios/criar'](req, resRedirect());
  assert.strictEqual(inserts[0][0], 'externo', 'sorteio externo de verdade (sem publico_alvo) não deve ser forçado pra interno');
});

// 19/08/2026 (3ª rodada): pedido do usuário — sorteio com mais de 1 prêmio sorteava todos os
// ganhadores de uma vez só; com ~500 pessoas era comum o 1º sorteado não atender/não estar
// presente, e o nome errado ficava registrado como ganhador junto do certo. Agora cada prêmio é
// confirmado individualmente via /confirmar-ganhador, que ANEXA ao ganhador_nome já existente.
test('POST /sorteios/:id/confirmar-ganhador: 1º de 2 prêmios — anexa sem fechar o sorteio', async () => {
  const { rotas, updates } = montar({
    sorteio: { id: 20, tipo: 'interno', publico_alvo: 'ligantes', qtd_ganhadores: 2, ganhador_nome: null },
    membros: [{ nome: 'Ana' }, { nome: 'Bruno' }]
  });
  const req = reqBase({ params: { id: '20' }, body: { nome: 'Ana' } });
  await rotas['POST /sorteios/:id/confirmar-ganhador'](req, resRedirect());
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0][0], 'Ana', 'ganhador_nome vira só "Ana" (1º prêmio)');
  assert.strictEqual(updates[0].length, 2, 'UPDATE parcial não mexe em status/sorteado_em/sorteado_por');
});

test('POST /sorteios/:id/confirmar-ganhador: 2º de 2 prêmios — completa e fecha o sorteio (status=sorteado)', async () => {
  const { rotas, updates } = montar({
    sorteio: { id: 20, tipo: 'interno', publico_alvo: 'ligantes', qtd_ganhadores: 2, ganhador_nome: 'Ana' },
    membros: [{ nome: 'Ana' }, { nome: 'Bruno' }]
  });
  const req = reqBase({ params: { id: '20' }, body: { nome: 'Bruno' } });
  await rotas['POST /sorteios/:id/confirmar-ganhador'](req, resRedirect());
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0][0], 'Ana|Bruno', 'anexa ao que já tinha, pipe-separado');
  assert.strictEqual(updates[0][1], 1, 'sorteado_por = usuário da sessão');
});

test('POST /sorteios/:id/confirmar-ganhador: recusa nome que não está na lista de participantes desse sorteio', async () => {
  const { rotas, updates } = montar({
    sorteio: { id: 20, tipo: 'interno', publico_alvo: 'ligantes', qtd_ganhadores: 2, ganhador_nome: null },
    membros: [{ nome: 'Ana' }]
  });
  const req = reqBase({ params: { id: '20' }, body: { nome: 'Alguém de Fora' } });
  await rotas['POST /sorteios/:id/confirmar-ganhador'](req, resRedirect());
  assert.strictEqual(updates.length, 0, 'não grava nome que não pertence ao sorteio');
});

test('POST /sorteios/:id/confirmar-ganhador: recusa a mesma pessoa duas vezes no mesmo sorteio', async () => {
  const { rotas, updates } = montar({
    sorteio: { id: 20, tipo: 'interno', publico_alvo: 'ligantes', qtd_ganhadores: 2, ganhador_nome: 'Ana' },
    membros: [{ nome: 'Ana' }, { nome: 'Bruno' }]
  });
  const req = reqBase({ params: { id: '20' }, body: { nome: 'Ana' } });
  await rotas['POST /sorteios/:id/confirmar-ganhador'](req, resRedirect());
  assert.strictEqual(updates.length, 0, 'Ana já ganhou o 1º prêmio — não pode ganhar de novo');
});

test('POST /sorteios/:id/confirmar-ganhador: sorteio já com todos os prêmios confirmados recusa novo nome', async () => {
  const { rotas, updates } = montar({
    sorteio: { id: 20, tipo: 'interno', publico_alvo: 'ligantes', qtd_ganhadores: 2, ganhador_nome: 'Ana|Bruno' },
    membros: [{ nome: 'Ana' }, { nome: 'Bruno' }, { nome: 'Carla' }]
  });
  const req = reqBase({ params: { id: '20' }, body: { nome: 'Carla' } });
  await rotas['POST /sorteios/:id/confirmar-ganhador'](req, resRedirect());
  assert.strictEqual(updates.length, 0);
});

test('POST /sorteios/:id/confirmar-ganhador: nome vazio recusa sem tocar no banco', async () => {
  const { rotas, updates } = montar({
    sorteio: { id: 20, tipo: 'interno', publico_alvo: 'ligantes', qtd_ganhadores: 1, ganhador_nome: null }
  });
  const req = reqBase({ params: { id: '20' }, body: { nome: '  ' } });
  await rotas['POST /sorteios/:id/confirmar-ganhador'](req, resRedirect());
  assert.strictEqual(updates.length, 0);
});

// Registro manual usa a MESMA rota — só muda quem escolhe o nome (o admin, num <select>, em vez
// da roleta). Sorteio externo com Instagram: confere que o nome escolhido bate com quem realmente
// se inscreveu (sorteio_participantes), não só com uma lista arbitrária.
test('POST /sorteios/:id/confirmar-ganhador: registro manual funciona igual pra sorteio externo', async () => {
  const { rotas, updates } = montar({
    sorteio: { id: 21, tipo: 'externo', publico_alvo: null, qtd_ganhadores: 1, ganhador_nome: null },
    mock: (sql) => {
      if (/SELECT \* FROM sorteio_participantes WHERE sorteio_id=\$1/.test(sql)) return { rows: [
        { nome: 'Laisa de Oliveira', email: 'laisa@x.com', instagram: '@laisa', whatsapp: '+595419200409' }
      ] };
      return undefined;
    }
  });
  const req = reqBase({ params: { id: '21' }, body: { nome: 'Laisa de Oliveira' } });
  await rotas['POST /sorteios/:id/confirmar-ganhador'](req, resRedirect());
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0][0], 'Laisa de Oliveira');
});

// 19/08/2026 (3ª rodada): sorteio com mais de 1 prêmio fica ganhador_nome parcialmente
// preenchido (1 de 2 confirmado) MAS status ainda 'rascunho' — editar nesse meio-tempo
// corromperia o progresso. Bloqueia igual já bloqueava pra status='sorteado'.
// BUG REAL em produção 19/08/2026: "Luciane Costa Rodrigues" aparecia certinho no select de
// registro manual, mas confirmar dava "Participante não encontrado". Causa: o nome dela no
// cadastro do evento tinha um espaço sobrando no final ("Luciane Costa Rodrigues ") — o
// confirmar-ganhador dava trim() no nome recebido do form, mas comparava contra a lista de
// participantes SEM trim, então o nome trimado nunca batia com o da lista (com espaço).
// buscarParticipantesSorteio agora normaliza (trim) todo nome na fonte.
test('POST /sorteios/:id/confirmar-ganhador: nome com espaço sobrando no cadastro do evento ainda é reconhecido', async () => {
  const { rotas, updates } = montar({
    sorteio: { id: 12, tipo: 'interno', publico_alvo: 'evento', origem_tipo: 'evento', origem_id: 5, qtd_ganhadores: 2, ganhador_nome: 'João Ricardo Rique' },
    eventoInscritos: [{ nome: 'João Ricardo Rique' }, { nome: 'Luciane Costa rodrigues ' }]
  });
  const req = reqBase({ params: { id: '12' }, body: { nome: 'Luciane Costa rodrigues' } });
  await rotas['POST /sorteios/:id/confirmar-ganhador'](req, resRedirect());
  assert.strictEqual(updates.length, 1, 'reconhece o nome mesmo com o espaço sobrando no cadastro original');
  assert.strictEqual(updates[0][0], 'João Ricardo Rique|Luciane Costa rodrigues');
});

test('POST /sorteios/:id/editar: recusa edição com ganhador parcial mesmo status ainda "rascunho"', async () => {
  const { rotas, updates } = montar({ sorteio: { status: 'rascunho', ganhador_nome: 'Ana' } });
  const req = reqBase({ params: { id: '20' }, body: { tipo: 'interno', nome: 'X', qtd_ganhadores: '2', publico_alvo: 'ligantes' } });
  await rotas['POST /sorteios/:id/editar'](req, resRedirect());
  assert.strictEqual(updates.length, 0, 'não deixa editar com 1 de 2 prêmios já confirmados');
});
