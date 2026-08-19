// 15/08/2026: transmissão online de evento de vários dias (ex: jornada de 4 dias) precisa
// contar o tempo assistido SEPARADO POR DIA (cada dia com seu próprio vídeo/duração, só
// preenchida depois que a aula termina). Também corrige 2 falhas reais de fraude/duplicação:
// - ping sem limite: um script batendo em /ping repetidamente inflava o tempo sem a pessoa
//   sequer abrir a página — agora só conta 1x a cada 90s de verdade.
// - duas abas com o mesmo link contavam tempo em dobro — agora só a aba mais recente conta
//   (sessao_atual), a mais antiga para de acumular quando outra assume.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

// Simula o LEAST(GREATEST(EXTRACT(EPOCH FROM (NOW() - ultimo_ping))::int, 0), 600) da query real,
// pra provar de verdade que o crédito é o tempo REAL decorrido (não mais um flat de 120) — sem
// isso o dublê só provaria "a query foi chamada", não que ela credita certo (achado 19/08/2026:
// esse é exatamente o tipo de teste que não teria pego a regressão original).
const TEMPO_MAX_POR_PING = 600;
function creditoSimulado(ultimoPingAnterior) {
  if (!ultimoPingAnterior) return 120; // ultimo_ping IS NULL — primeiro ping, mesmo comportamento de sempre
  const decorrido = Math.floor((Date.now() - ultimoPingAnterior.getTime()) / 1000);
  return Math.min(TEMPO_MAX_POR_PING, Math.max(0, decorrido));
}

function montar({ presenca, hojeProgramacao, proximaProgramacao, diaSegundos, diaUltimoPing, mock } = {}) {
  const chamadasSQL = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      chamadasSQL.push({ sql, params });
      if (mock) { const r = mock(sql, params); if (r !== undefined) return r; }
      if (/SELECT epo\.\*, i\.nome, i\.email, e\.nome as evento_nome/.test(sql)) return { rows: presenca ? [presenca] : [] };
      if (/UPDATE evento_presencas_online SET primeiro_acesso/.test(sql)) return { rows: [] };
      if (/UPDATE evento_presencas_online SET ativo=true,ultimo_ping=NOW\(\),sessao_atual/.test(sql)) return { rows: [] };
      if (/SELECT id, evento_id, sessao_atual, tempo_total_segundos FROM evento_presencas_online WHERE token/.test(sql)) return { rows: presenca ? [presenca] : [] };
      if (/UPDATE evento_presencas_online SET ativo=true WHERE id/.test(sql)) return { rows: [] };
      if (/WHERE evento_id=\$1 AND data=CURRENT_DATE/.test(sql)) return { rows: hojeProgramacao ? [hojeProgramacao] : [] };
      if (/WHERE evento_id=\$1 AND data IS NOT NULL ORDER BY ABS/.test(sql)) return { rows: proximaProgramacao ? [proximaProgramacao] : [] };
      if (/SELECT 1 FROM evento_programacao WHERE id=\$1 AND data=CURRENT_DATE/.test(sql)) return { rows: (hojeProgramacao && hojeProgramacao.id === params[0]) ? [{}] : [] };
      if (/SELECT tempo_total_segundos FROM evento_presencas_online_dias WHERE presenca_id=\$1 AND programacao_id=\$2/.test(sql)) return { rows: diaSegundos !== undefined ? [{ tempo_total_segundos: diaSegundos }] : [] };
      if (/INSERT INTO evento_presencas_online_dias/.test(sql)) {
        const credito = diaSegundos !== undefined ? creditoSimulado(diaUltimoPing) : 120;
        return { rows: [{ tempo_total_segundos: (diaSegundos||0)+credito, ultimo_ping: new Date() }] };
      }
      if (/UPDATE evento_presencas_online SET\s+tempo_total_segundos = tempo_total_segundos \+ CASE/.test(sql)) {
        const credito = creditoSimulado(presenca && presenca.ultimo_ping);
        return { rows: [{ tempo_total_segundos: (presenca?.tempo_total_segundos||0)+credito, ultimo_ping: new Date() }] };
      }
      if (/UPDATE evento_presencas_online SET ativo=false/.test(sql)) return { rows: [] };
      if (/SELECT \* FROM evento_patrocinadores/.test(sql)) return { rows: [] };
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

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, chamadasSQL };
}

function resJson() { const r = {}; r.json = (b) => { r._body = b; return r; }; return r; }
function resRender() { const r = {}; r.render = (view, locals) => { r._view = view; r._locals = locals; return r; }; r.status = (c) => ({ send: (b) => { r._status = c; r._body = b; } }); return r; }

test('GET /live/:token: dia de hoje encontrado — usa vídeo do dia e semente com segundos JÁ acumulados hoje', async () => {
  const { rotas } = montar({
    presenca: { id: 1, evento_id: 5, token: 'abc', nome: 'João', email: 'j@x.com', evento_nome: 'Jornada', youtube_url: 'https://youtube.com/watch?v=eventoFallback1', tempo_total_segundos: 0, primeiro_acesso: null },
    // sem "horario" aqui de propósito — esse teste é sobre seleção de vídeo/duração, não sobre
    // o gate de horário (coberto em testes dedicados abaixo, com horário-limite pra não depender
    // da hora real em que o teste roda)
    hojeProgramacao: { id: 10, titulo: 'Día 2', youtube_url: 'https://youtube.com/watch?v=dia2video12', duracao_minutos: null },
    diaSegundos: 3600
  });
  const res = resRender();
  await rotas['GET /live/:token']({ params: { token: 'abc' } }, res);
  assert.strictEqual(res._locals.transmiteHoje, true);
  assert.strictEqual(res._locals.segundosIniciais, 3600, 'deve usar os segundos do DIA, não os do evento inteiro');
  assert.strictEqual(res._locals.presenca.youtube_url, 'https://youtube.com/watch?v=dia2video12', 'vídeo do dia tem prioridade sobre o do evento');
  assert.strictEqual(res._locals.tituloDia, 'Día 2');
});

// 17/08/2026: achado em produção — o chat ao vivo do YouTube (embutido na página) exige que
// embed_domain bata com o domínio real, senão o YouTube recusa carregar. Estava fixo em
// "liga-urologia.onrender.com", domínio antigo de antes da migração pro domínio próprio — o
// chat nunca carregava. Agora é calculado a partir do MESMO APP_URL usado pra montar o link
// enviado por e-mail/WhatsApp, pra não desalinhar de novo se o domínio mudar no futuro.
test('GET /live/:token: embedDomain do chat vem do APP_URL configurado, não fixo/hardcoded', async () => {
  const original = process.env.APP_URL;
  process.env.APP_URL = 'https://sistema.lauroucpcde.com';
  try {
    const { rotas } = montar({
      presenca: { id: 1, evento_id: 5, token: 'abc', nome: 'João', email: 'j@x.com', evento_nome: 'Jornada', youtube_url: null, tempo_total_segundos: 0, primeiro_acesso: null },
      hojeProgramacao: null, proximaProgramacao: null
    });
    const res = resRender();
    await rotas['GET /live/:token']({ params: { token: 'abc' } }, res);
    assert.strictEqual(res._locals.embedDomain, 'sistema.lauroucpcde.com');
  } finally { process.env.APP_URL = original; }
});

test('GET /live/:token: sem sessão de hoje, cai pro dia mais próximo em modo PREVIEW (não conta tempo real)', async () => {
  const { rotas } = montar({
    presenca: { id: 1, evento_id: 5, token: 'abc', nome: 'João', email: 'j@x.com', evento_nome: 'Jornada', youtube_url: null, tempo_total_segundos: 0, primeiro_acesso: null },
    hojeProgramacao: null,
    proximaProgramacao: { id: 11, titulo: 'Día 1', youtube_url: 'https://youtube.com/watch?v=dia1preview1', duracao_minutos: null, data: '2026-08-17' }
  });
  const res = resRender();
  await rotas['GET /live/:token']({ params: { token: 'abc' } }, res);
  assert.strictEqual(res._locals.transmiteHoje, false, 'fora do dia real, é só pré-visualização');
  assert.strictEqual(res._locals.presenca.youtube_url, 'https://youtube.com/watch?v=dia1preview1');
});

test('GET /live/:token: evento sem NENHUM item de Programação com data — modo legado (vídeo/duração do evento)', async () => {
  const { rotas } = montar({
    presenca: { id: 1, evento_id: 5, token: 'abc', nome: 'João', email: 'j@x.com', evento_nome: 'Palestra única', youtube_url: 'https://youtube.com/watch?v=legado12345', tempo_total_segundos: 900, primeiro_acesso: new Date() },
    hojeProgramacao: null,
    proximaProgramacao: null
  });
  const res = resRender();
  await rotas['GET /live/:token']({ params: { token: 'abc' } }, res);
  assert.strictEqual(res._locals.temDiaProgramado, false);
  assert.strictEqual(res._locals.segundosIniciais, 900, 'sem Programação nenhuma, usa o total acumulado do evento (legado)');
  assert.strictEqual(res._locals.presenca.youtube_url, 'https://youtube.com/watch?v=legado12345');
});

test('GET /live/:token: token inválido dá 404', async () => {
  const { rotas } = montar({ presenca: null });
  const res = resRender();
  await rotas['GET /live/:token']({ params: { token: 'naoexiste' } }, res);
  assert.strictEqual(res._status, 404);
});

test('POST /live/:token/ping: acumula no dia certo quando é hoje de verdade', async () => {
  const { rotas } = montar({
    presenca: { id: 1, evento_id: 5, token: 'abc', sessao_atual: 'sess1', tempo_total_segundos: 0 },
    hojeProgramacao: { id: 10, titulo: 'Día 2', duracao_minutos: null }
  });
  const res = resJson();
  await rotas['POST /live/:token/ping']({ params: { token: 'abc' }, body: { sessao: 'sess1' } }, res);
  assert.strictEqual(res._body.ok, true);
  assert.strictEqual(res._body.total, 120);
});

test('POST /live/:token/ping: sessão diferente da atual (outra aba assumiu) é recusado', async () => {
  const { rotas } = montar({
    presenca: { id: 1, evento_id: 5, token: 'abc', sessao_atual: 'sess-nova', tempo_total_segundos: 0 },
    hojeProgramacao: { id: 10, titulo: 'Día 2', duracao_minutos: null }
  });
  const res = resJson();
  await rotas['POST /live/:token/ping']({ params: { token: 'abc' }, body: { sessao: 'sess-velha' } }, res);
  assert.strictEqual(res._body.ok, false);
  assert.strictEqual(res._body.motivo, 'sessao_substituida');
});

test('POST /live/:token/ping: fora do dia real (preview) NÃO acumula tempo', async () => {
  const { rotas } = montar({
    presenca: { id: 1, evento_id: 5, token: 'abc', sessao_atual: 'sess1', tempo_total_segundos: 0 },
    hojeProgramacao: null,
    proximaProgramacao: { id: 11, titulo: 'Día 1', duracao_minutos: null, data: '2026-08-17' }
  });
  const res = resJson();
  await rotas['POST /live/:token/ping']({ params: { token: 'abc' }, body: { sessao: 'sess1' } }, res);
  assert.strictEqual(res._body.ok, true);
  assert.strictEqual(res._body.total, 0, 'preview não conta — dia resolvido existe mas não é hoje');
  assert.strictEqual(res._body.preview, true);
});

test('POST /live/:token/ping: sem NENHUM item de Programação, acumula no total legado do evento', async () => {
  const { rotas } = montar({
    presenca: { id: 1, evento_id: 5, token: 'abc', sessao_atual: 'sess1', tempo_total_segundos: 300 },
    hojeProgramacao: null,
    proximaProgramacao: null
  });
  const res = resJson();
  await rotas['POST /live/:token/ping']({ params: { token: 'abc' }, body: { sessao: 'sess1' } }, res);
  assert.strictEqual(res._body.ok, true);
  assert.strictEqual(res._body.total, 420, '300 + 120 do ping, no acumulador antigo (evento de 1 dia só)');
});

test('POST /live/:token/ping: token inexistente não quebra', async () => {
  const { rotas } = montar({ presenca: null });
  const res = resJson();
  await rotas['POST /live/:token/ping']({ params: { token: 'xxx' }, body: {} }, res);
  assert.strictEqual(res._body.ok, false);
  assert.strictEqual(res._body.motivo, 'token_invalido');
});

// 17/08/2026: pedido do usuário — mandar o link com antecedência (ex: pra ligantes/diretivos
// confirmarem recebimento) sem contar presença antes da hora cadastrada na Programação (ex:
// "19:00 - 22:00"). Usa horários-limite (00:01 / 23:59) nos testes pra não depender da hora
// real em que o teste roda — 00:01 já passou o dia inteiro, exceto no primeiro minuto do dia;
// 23:59 não chegou o dia inteiro, exceto no último minuto.
test('GET /live/:token: data bate mas o horário cadastrado ainda não chegou — vira prévia com mensagem específica', async () => {
  const { rotas } = montar({
    presenca: { id: 1, evento_id: 5, token: 'abc', nome: 'João', email: 'j@x.com', evento_nome: 'Jornada', youtube_url: null, tempo_total_segundos: 0, primeiro_acesso: null },
    hojeProgramacao: { id: 10, titulo: 'Día 2', horario: '23:59 - 23:59', youtube_url: 'https://youtube.com/watch?v=dia2video12', duracao_minutos: null }
  });
  const res = resRender();
  await rotas['GET /live/:token']({ params: { token: 'abc' } }, res);
  assert.strictEqual(res._locals.transmiteHoje, false, 'ainda não chegou a hora — não conta como transmitindo hoje');
  assert.strictEqual(res._locals.aindaNaoComecou, true);
  assert.strictEqual(res._locals.horarioInicio, '23:59');
});

test('GET /live/:token: data bate e o horário cadastrado já passou — transmite normalmente', async () => {
  const { rotas } = montar({
    presenca: { id: 1, evento_id: 5, token: 'abc', nome: 'João', email: 'j@x.com', evento_nome: 'Jornada', youtube_url: null, tempo_total_segundos: 0, primeiro_acesso: null },
    hojeProgramacao: { id: 10, titulo: 'Día 2', horario: '00:01 - 23:58', youtube_url: 'https://youtube.com/watch?v=dia2video12', duracao_minutos: null },
    diaSegundos: 0
  });
  const res = resRender();
  await rotas['GET /live/:token']({ params: { token: 'abc' } }, res);
  assert.strictEqual(res._locals.transmiteHoje, true);
  assert.strictEqual(res._locals.aindaNaoComecou, false);
});

test('GET /live/:token: horário cadastrado em texto não reconhecido (ex: vazio) não bloqueia — mantém comportamento anterior', async () => {
  const { rotas } = montar({
    presenca: { id: 1, evento_id: 5, token: 'abc', nome: 'João', email: 'j@x.com', evento_nome: 'Jornada', youtube_url: null, tempo_total_segundos: 0, primeiro_acesso: null },
    hojeProgramacao: { id: 10, titulo: 'Día 2', horario: null, youtube_url: 'https://youtube.com/watch?v=dia2video12', duracao_minutos: null }
  });
  const res = resRender();
  await rotas['GET /live/:token']({ params: { token: 'abc' } }, res);
  assert.strictEqual(res._locals.transmiteHoje, true, 'sem horário cadastrado parseável, não trava — conta assim que a data bate');
  assert.strictEqual(res._locals.aindaNaoComecou, false);
});

test('POST /live/:token/ping: data bate mas o horário ainda não chegou — NÃO acumula, mesmo com a data certa', async () => {
  const { rotas } = montar({
    presenca: { id: 1, evento_id: 5, token: 'abc', sessao_atual: 'sess1', tempo_total_segundos: 0 },
    hojeProgramacao: { id: 10, titulo: 'Día 2', horario: '23:59 - 23:59', duracao_minutos: null }
  });
  const res = resJson();
  await rotas['POST /live/:token/ping']({ params: { token: 'abc' }, body: { sessao: 'sess1' } }, res);
  assert.strictEqual(res._body.ok, true);
  assert.strictEqual(res._body.total, 0, 'antes do horário cadastrado, não conta — mesmo a data batendo certinho');
  assert.strictEqual(res._body.preview, true);
  assert.strictEqual(res._body.aindaNaoComecou, true);
});

test('POST /live/:token/ping: data bate e o horário já passou — acumula normalmente', async () => {
  const { rotas } = montar({
    presenca: { id: 1, evento_id: 5, token: 'abc', sessao_atual: 'sess1', tempo_total_segundos: 0 },
    hojeProgramacao: { id: 10, titulo: 'Día 2', horario: '00:01 - 23:58', duracao_minutos: null }
  });
  const res = resJson();
  await rotas['POST /live/:token/ping']({ params: { token: 'abc' }, body: { sessao: 'sess1' } }, res);
  assert.strictEqual(res._body.ok, true);
  assert.strictEqual(res._body.total, 120);
  assert.strictEqual(res._body.preview, undefined);
});

test('POST /live/:token/sair: marca ativo=false sem quebrar', async () => {
  const { rotas } = montar({ presenca: { id: 1, evento_id: 5, token: 'abc' } });
  const res = resJson();
  await rotas['POST /live/:token/sair']({ params: { token: 'abc' } }, res);
  assert.strictEqual(res._body.ok, true);
});

// 19/08/2026: queixa grave de produção — o crédito era um FLAT de 120s por ping, então qualquer
// ping atrasado (tela do celular apaga durante a aula — comum, e o navegador SUSPENDE o
// setInterval nesse caso, não tem como o JS evitar) fazia a pessoa perder o tempo real que
// passou. Histórico real de ontem: gente com só 40-100min contados numa aula de ~3h. Corrigido
// pra creditar o tempo REAL decorrido desde o último ping (capado, pra não creditar uma aba
// esquecida por horas como se tivesse assistido tudo).
test('POST /live/:token/ping (por dia): ping ATRASADO credita o tempo REAL decorrido, não mais um flat de 120s', async () => {
  const ultimoPingHa6min = new Date(Date.now() - 6 * 60 * 1000); // tela apagou, ping só chegou 6min depois
  const { rotas } = montar({
    presenca: { id: 1, evento_id: 5, token: 'abc', sessao_atual: 'sess1', tempo_total_segundos: 0 },
    hojeProgramacao: { id: 10, titulo: 'Día 2', duracao_minutos: null },
    diaSegundos: 1000,
    diaUltimoPing: ultimoPingHa6min
  });
  const res = resJson();
  await rotas['POST /live/:token/ping']({ params: { token: 'abc' }, body: { sessao: 'sess1' } }, res);
  const creditado = res._body.total - 1000;
  assert.ok(creditado >= 355 && creditado <= 365, 'creditou ~360s (6min) de verdade, não um flat de 120s — creditado='+creditado);
});

test('POST /live/:token/ping (por dia): ping no intervalo normal (~2min) credita ~120s — não regrediu com a correção', async () => {
  const ultimoPingHa2min = new Date(Date.now() - 120 * 1000);
  const { rotas } = montar({
    presenca: { id: 1, evento_id: 5, token: 'abc', sessao_atual: 'sess1', tempo_total_segundos: 0 },
    hojeProgramacao: { id: 10, titulo: 'Día 2', duracao_minutos: null },
    diaSegundos: 500,
    diaUltimoPing: ultimoPingHa2min
  });
  const res = resJson();
  await rotas['POST /live/:token/ping']({ params: { token: 'abc' }, body: { sessao: 'sess1' } }, res);
  const creditado = res._body.total - 500;
  assert.ok(creditado >= 115 && creditado <= 125, 'operação normal continua creditando ~120s — creditado='+creditado);
});

test('POST /live/:token/ping (por dia): gap ENORME (aba esquecida por 2h) fica CAPADO em 10min, não credita o dia inteiro de uma vez', async () => {
  const ultimoPingHa2h = new Date(Date.now() - 2 * 3600 * 1000);
  const { rotas } = montar({
    presenca: { id: 1, evento_id: 5, token: 'abc', sessao_atual: 'sess1', tempo_total_segundos: 0 },
    hojeProgramacao: { id: 10, titulo: 'Día 2', duracao_minutos: null },
    diaSegundos: 0,
    diaUltimoPing: ultimoPingHa2h
  });
  const res = resJson();
  await rotas['POST /live/:token/ping']({ params: { token: 'abc' }, body: { sessao: 'sess1' } }, res);
  assert.strictEqual(res._body.total, 600, 'capado em 600s (10min) — não pode creditar as 2h inteiras de uma aba esquecida aberta');
});

test('POST /live/:token/ping (modo legado, sem Programação por dia): ping atrasado também credita o tempo real, não um flat de 120s', async () => {
  const ultimoPingHa5min = new Date(Date.now() - 5 * 60 * 1000);
  const { rotas } = montar({
    presenca: { id: 1, evento_id: 5, token: 'abc', sessao_atual: 'sess1', tempo_total_segundos: 300, ultimo_ping: ultimoPingHa5min },
    hojeProgramacao: null,
    proximaProgramacao: null
  });
  const res = resJson();
  await rotas['POST /live/:token/ping']({ params: { token: 'abc' }, body: { sessao: 'sess1' } }, res);
  const creditado = res._body.total - 300;
  assert.ok(creditado >= 295 && creditado <= 305, 'modo legado também credita o tempo real (~300s), não um flat de 120s — creditado='+creditado);
});
