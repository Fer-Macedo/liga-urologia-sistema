// 17/08/2026: evento de vários dias (ex: jornada de 4 dias) tinha só 1 check-out pro evento
// INTEIRO — a mesma pessoa não podia confirmar presença em cada dia separadamente, e o painel
// só tinha um botão Abrir/Encerrar geral. Corrigido reaproveitando resolverDiaTransmissao (o
// mesmo resolvedor de dia já usado pela transmissão online): cada item de Programação com data
// ganha seu próprio checkout_aberto/checkout_fecha_em, e o check-out só é aceito quando o dia
// resolvido é HOJE de verdade. Evento sem nenhum item de Programação com data continua no modo
// legado (1 check-out pro evento inteiro), sem quebrar nada que já existia.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar({ evento, hojeProgramacao, proximaProgramacao, inscricao, checkoutExistente, mock } = {}) {
  const inserts = [];
  const updates = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (mock) { const r = mock(sql, params); if (r !== undefined) return r; }
      if (/SELECT \* FROM eventos WHERE id=\$1/.test(sql)) return { rows: evento ? [evento] : [] };
      if (/WHERE evento_id=\$1 AND data=CURRENT_DATE/.test(sql)) return { rows: hojeProgramacao ? [hojeProgramacao] : [] };
      if (/WHERE evento_id=\$1 AND data IS NOT NULL ORDER BY ABS/.test(sql)) return { rows: proximaProgramacao ? [proximaProgramacao] : [] };
      if (/SELECT id, nome, status, isento, email, rg FROM evento_inscricoes/.test(sql)) return { rows: inscricao ? [inscricao] : [] };
      if (/SELECT id FROM evento_checkouts WHERE evento_id=\$1 AND inscricao_id=\$2 AND programacao_id IS NOT DISTINCT FROM \$3/.test(sql)) {
        return { rows: checkoutExistente ? [{ id: 1 }] : [] };
      }
      if (/SELECT id FROM evento_checkouts WHERE evento_id=\$1 AND programacao_id IS NOT DISTINCT FROM \$4/.test(sql)) {
        return { rows: checkoutExistente ? [{ id: 1 }] : [] };
      }
      if (/INSERT INTO evento_checkouts/.test(sql)) { inserts.push(params); return { rows: [] }; }
      if (/UPDATE evento_programacao SET checkout_aberto/.test(sql)) { updates.push({ sql, params }); return { rows: [] }; }
      if (/UPDATE eventos SET checkout_aberto/.test(sql)) { updates.push({ sql, params }); return { rows: [] }; }
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
  require.cache[rnt] = { id: rnt, filename: rnt, loaded: true, exports: { enviarWhatsApp: async () => {}, enviarEmail: async () => {}, htmlSimples: (opts) => '<!DOCTYPE html><html><body data-faixa="'+(opts.faixaLabel||'')+'">'+opts.mensagem+'</body></html>' } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, inserts, updates };
}

function resRender() { const r = {}; r.render = (view, locals) => { r._view = view; r._locals = locals; return r; }; r.status = (c) => ({ send: (b) => { r._status = c; r._body = b; } }); return r; }
function resRedirect() { const r = {}; r.redirect = (u) => { r._redirect = u; return r; }; return r; }

const EVENTO = { id: 5, nome: 'Jornada', checkout_aberto: false, checkout_fecha_em: null };

test('GET /checkout/:id: dia de hoje com checkout aberto — aberto=true', async () => {
  const { rotas } = montar({
    evento: EVENTO,
    hojeProgramacao: { id: 10, titulo: 'Día 2', checkout_aberto: true, checkout_fecha_em: null }
  });
  const res = resRender();
  await rotas['GET /checkout/:id']({ params: { id: '5' } }, res);
  assert.strictEqual(res._locals.aberto, true);
  // 17/08/2026: a página pública NUNCA deve mostrar o título de dia específico — só o nome
  // real do evento. Mostrar "Promoción y Prevención de la Salud del Hombre" (título do dia 1)
  // como se fosse o nome do evento confundiu o cliente, que achou que era outro evento.
  assert.strictEqual(res._locals.tituloDia, undefined, 'tituloDia não pode mais existir nesta rota');
});

test('GET /checkout/:id: dia de hoje existe mas está com checkout ENCERRADO — aberto=false', async () => {
  const { rotas } = montar({
    evento: EVENTO,
    hojeProgramacao: { id: 10, titulo: 'Día 2', checkout_aberto: false, checkout_fecha_em: null }
  });
  const res = resRender();
  await rotas['GET /checkout/:id']({ params: { id: '5' } }, res);
  assert.strictEqual(res._locals.aberto, false);
});

test('GET /checkout/:id: dia resolvido NÃO é hoje (preview) — aberto=false mesmo com checkout_aberto=true no banco', async () => {
  const { rotas } = montar({
    evento: EVENTO,
    hojeProgramacao: null,
    proximaProgramacao: { id: 11, titulo: 'Día 1', checkout_aberto: true, checkout_fecha_em: null, data: '2026-08-17' }
  });
  const res = resRender();
  await rotas['GET /checkout/:id']({ params: { id: '5' } }, res);
  assert.strictEqual(res._locals.aberto, false, 'só é hoje que conta, dia fora da data não abre check-out de verdade');
});

test('GET /checkout/:id: evento SEM nenhum item de Programação com data — modo legado, usa evento.checkout_aberto', async () => {
  const { rotas } = montar({
    evento: { id: 6, nome: 'Palestra única', checkout_aberto: true, checkout_fecha_em: null },
    hojeProgramacao: null, proximaProgramacao: null
  });
  const res = resRender();
  await rotas['GET /checkout/:id']({ params: { id: '6' } }, res);
  assert.strictEqual(res._locals.aberto, true);
});

test('POST /checkout/:id: dia de hoje aberto — grava o check-out com o programacao_id do dia', async () => {
  const { rotas, inserts } = montar({
    evento: EVENTO,
    hojeProgramacao: { id: 10, titulo: 'Día 2', checkout_aberto: true, checkout_fecha_em: null },
    inscricao: { id: 42, nome: 'Fulano de Tal', email: 'f@x.com', status: 'confirmado', isento: false, rg: '123456' }
  });
  const res = resRender();
  await rotas['POST /checkout/:id']({ params: { id: '5' }, body: { email: 'f@x.com', documento: '123456', aval_resposta_0: '5', aval_resposta_1: '5', aval_resposta_2: '5', aval_resposta_3: '5' }, headers: {}, ip: '1.2.3.4' }, res);
  assert.strictEqual(inserts.length, 1);
  const [eventoId, programacaoId, inscricaoId] = inserts[0];
  assert.strictEqual(eventoId, '5');
  assert.strictEqual(programacaoId, 10, 'check-out fica marcado com o dia certo');
  assert.strictEqual(inscricaoId, 42);
  assert.strictEqual(res._locals.sucesso, true);
});

test('POST /checkout/:id: dia fechado (checkout_aberto=false) recusa com mensagem de encerrado', async () => {
  const { rotas, inserts } = montar({
    evento: EVENTO,
    hojeProgramacao: { id: 10, titulo: 'Día 2', checkout_aberto: false, checkout_fecha_em: null },
    inscricao: { id: 42, nome: 'Fulano', email: 'f@x.com', status: 'confirmado', isento: false, rg: '123456' }
  });
  const res = resRender();
  await rotas['POST /checkout/:id']({ params: { id: '5' }, body: { email: 'f@x.com', documento: '123456' }, headers: {}, ip: '1.2.3.4' }, res);
  assert.strictEqual(inserts.length, 0);
  assert.strictEqual(res._locals.aberto, false);
  assert.ok(res._locals.erro);
});

test('POST /checkout/:id: mesma pessoa, mesmo dia, 2ª tentativa — bloqueia como já confirmado (dedup por dia)', async () => {
  const { rotas, inserts } = montar({
    evento: EVENTO,
    hojeProgramacao: { id: 10, titulo: 'Día 2', checkout_aberto: true, checkout_fecha_em: null },
    inscricao: { id: 42, nome: 'Fulano', email: 'f@x.com', status: 'confirmado', isento: false, rg: '123456' },
    checkoutExistente: true
  });
  const res = resRender();
  await rotas['POST /checkout/:id']({ params: { id: '5' }, body: { email: 'f@x.com', documento: '123456', aval_resposta_0: '5', aval_resposta_1: '5', aval_resposta_2: '5', aval_resposta_3: '5' }, headers: {}, ip: '1.2.3.4' }, res);
  assert.strictEqual(inserts.length, 0);
  assert.strictEqual(res._locals.jaConfirmado, true);
});

test('POST /checkout/:id: sem nenhum item de Programação — modo legado grava programacao_id nulo (e exige avaliação, como qualquer check-out)', async () => {
  const { rotas, inserts } = montar({
    evento: { id: 6, nome: 'Palestra única', checkout_aberto: true, checkout_fecha_em: null },
    hojeProgramacao: null, proximaProgramacao: null,
    inscricao: { id: 50, nome: 'Ciclana', email: 'c@x.com', status: 'confirmado', isento: false, rg: '999' }
  });
  const res = resRender();
  await rotas['POST /checkout/:id']({ params: { id: '6' }, body: { email: 'c@x.com', documento: '999', aval_resposta_0: '5', aval_resposta_1: '5', aval_resposta_2: '5', aval_resposta_3: '5' }, headers: {}, ip: '1.2.3.4' }, res);
  assert.strictEqual(inserts.length, 1);
  assert.strictEqual(inserts[0][1], null, 'evento sem Programação por data não tem dia — programacao_id fica null');
});

test('POST /eventos/:id/programacao/:pid/checkout-toggle: abre o check-out DAQUELE dia (não mexe no evento inteiro)', async () => {
  const { rotas, updates } = montar({ evento: EVENTO });
  const req = { params: { id: '5', pid: '10' }, body: { acao: 'abrir', fecha_em: '' }, session: {} };
  await rotas['POST /eventos/:id/programacao/:pid/checkout-toggle'](req, resRedirect());
  assert.strictEqual(updates.length, 1);
  assert.match(updates[0].sql, /UPDATE evento_programacao SET checkout_aberto=true/);
  assert.deepStrictEqual(updates[0].params, [null, '10', '5']);
});

test('POST /eventos/:id/programacao/:pid/checkout-toggle: encerra o check-out daquele dia', async () => {
  const { rotas, updates } = montar({ evento: EVENTO });
  const req = { params: { id: '5', pid: '10' }, body: { acao: 'encerrar' }, session: {} };
  await rotas['POST /eventos/:id/programacao/:pid/checkout-toggle'](req, resRedirect());
  assert.strictEqual(updates.length, 1);
  assert.match(updates[0].sql, /UPDATE evento_programacao SET checkout_aberto=false/);
  assert.deepStrictEqual(updates[0].params, ['10', '5']);
});

test('GET /eventos/:id/checkout-relatorio: traz a contagem por dia (porDia)', async () => {
  const { rotas } = montar({
    evento: EVENTO,
    mock: (sql, params) => {
      if (/SELECT id, nome, checkout_aberto, checkout_fecha_em, avaliacao_perguntas FROM eventos/.test(sql)) return { rows: [EVENTO] };
      if (/SELECT id, nome, email, cpf, status, isento FROM evento_inscricoes/.test(sql)) return { rows: [
        { id: 1, nome: 'A', email: 'a@x.com', status: 'confirmado', isento: false },
        { id: 2, nome: 'B', email: 'b@x.com', status: 'confirmado', isento: false }
      ] };
      if (/SELECT inscricao_id, email, cpf, nome_informado, criado_em, programacao_id, aval_respostas/.test(sql)) return { rows: [
        { inscricao_id: 1, email: 'a@x.com', cpf: null, nome_informado: 'A', criado_em: new Date(), programacao_id: 10, aval_respostas: null, aval_sugestoes: null },
        { inscricao_id: 1, email: 'a@x.com', cpf: null, nome_informado: 'A', criado_em: new Date(), programacao_id: 11, aval_respostas: null, aval_sugestoes: null },
        { inscricao_id: 2, email: 'b@x.com', cpf: null, nome_informado: 'B', criado_em: new Date(), programacao_id: 10, aval_respostas: null, aval_sugestoes: null }
      ] };
      if (/SELECT id, titulo, data FROM evento_programacao WHERE evento_id=\$1 AND data IS NOT NULL/.test(sql)) return { rows: [
        { id: 10, titulo: 'Día 1', data: '2026-08-17' },
        { id: 11, titulo: 'Día 2', data: '2026-08-18' }
      ] };
      return undefined;
    }
  });
  const res = { json: (b) => { res._body = b; } };
  await rotas['GET /eventos/:id/checkout-relatorio']({ params: { id: '5' } }, res);
  assert.strictEqual(res._body.ok, true);
  assert.deepStrictEqual(res._body.porDia.map(d => d.total), [2, 1], 'Día 1 teve 2 check-outs (A e B), Día 2 só 1 (A)');
  assert.strictEqual(res._body.resumo.aptos, 2, 'A e B fizeram check-out em pelo menos 1 dia cada');
});

test('schema: evento_checkouts tem CREATE TABLE no código e as colunas de check-out por dia existem', () => {
  const src = require('fs').readFileSync(path.join(RAIZ, 'src/models/database.js'), 'utf8');
  assert.match(src, /CREATE TABLE IF NOT EXISTS evento_checkouts \(/, 'evento_checkouts precisa ter CREATE TABLE no código');
  assert.match(src, /ALTER TABLE evento_programacao ADD COLUMN IF NOT EXISTS checkout_aberto BOOLEAN/);
  assert.match(src, /ALTER TABLE evento_programacao ADD COLUMN IF NOT EXISTS checkout_fecha_em TIMESTAMP/);
  assert.match(src, /ALTER TABLE evento_checkouts ADD COLUMN IF NOT EXISTS programacao_id INTEGER/);
});

// 17/08/2026: pedido do usuário — baixar o QR Code do link de check-out (o link é o MESMO nos
// 4 dias, o servidor resolve sozinho qual dia é hoje) pra colocar fixo na apresentação.
function resBuffer() {
  const r = { _headers: {} };
  r.set = (k, v) => { r._headers[k] = v; return r; };
  r.status = (c) => { r._status = c; return r; };
  r.send = (b) => { r._body = b; return r; };
  return r;
}

test('GET /eventos/:id/checkout-qrcode: baixa o PNG do QR do link público (mesmo link, sem depender do dia)', async () => {
  const { rotas } = montar({ evento: EVENTO });
  const chamadas = [];
  global.fetch = async (url) => {
    chamadas.push(url);
    return { ok: true, arrayBuffer: async () => Buffer.from('fake-png-bytes') };
  };
  try {
    const res = resBuffer();
    await rotas['GET /eventos/:id/checkout-qrcode']({ params: { id: '5' } }, res);
    assert.strictEqual(res._headers['Content-Type'], 'image/png');
    assert.match(res._headers['Content-Disposition'], /attachment; filename="checkout-qr-evento-5\.png"/);
    assert.match(chamadas[0], /data=https%3A%2F%2Finscricao\.lauroucpcde\.com%2Fcheckout%2F5/, 'pede o QR do mesmo link público mostrado no painel');
    assert.ok(Buffer.isBuffer(res._body));
  } finally { delete global.fetch; }
});

test('GET /eventos/:id/checkout-qrcode: serviço externo fora do ar devolve 502, não quebra', async () => {
  const { rotas } = montar({ evento: EVENTO });
  global.fetch = async () => ({ ok: false });
  try {
    const res = resBuffer();
    await rotas['GET /eventos/:id/checkout-qrcode']({ params: { id: '5' } }, res);
    assert.strictEqual(res._status, 502);
  } finally { delete global.fetch; }
});

// 17/08/2026: BUG GRAVE relatado pelo usuário — a página pública de check-out mostrava o
// título do dia (ex: "Promoción y Prevención de la Salud del Hombre") junto da frase de
// confirmação, e isso pareceu pro cliente o nome de um evento DIFERENTE do real ("II Jornada
// de Salud del Hombre"). A página só pode mostrar o nome real do evento — nunca o título do
// dia — em nenhum evento, agora nem no futuro.
test('página pública de check-out: NUNCA mostra o título do dia, só o nome real do evento', () => {
  const ejs = require('ejs');
  const fs = require('fs');
  const ARQUIVO = path.join(RAIZ, 'views/pages/evento-checkout-publico.ejs');
  const html = ejs.render(fs.readFileSync(ARQUIVO, 'utf8'), {
    evento: { id: 5, nome: 'II Jornada de Salud del Hombre' }, config: {},
    aberto: true, sucesso: false, jaConfirmado: false, erro: null, nome: null,
    tituloDia: 'Promoción y Prevención de la Salud del Hombre' // mesmo se alguém reintroduzir a variável...
  }, { filename: ARQUIVO });
  assert.match(html, /II Jornada de Salud del Hombre/, 'precisa mostrar o nome real do evento');
  assert.ok(!html.includes('Promoción y Prevención de la Salud del Hombre'), 'NUNCA pode mostrar o título do dia — confunde o cliente com outro evento');
});

// 17/08/2026: pedido do usuário — avaliação obrigatória (4 notas de 1-6 + sugestão livre)
// embutida no check-out.
// 17/08/2026 (2ª rodada): antes valia só no check-out do ÚLTIMO DIA; agora é obrigatória em
// TODO dia do evento (cada resposta já sai marcada com o dia — programacao_id — pra ficar
// organizada por data).
test('POST /checkout/:id: dia comum (não é o último) SEM alguma nota de avaliação — recusa, não grava check-out', async () => {
  const { rotas, inserts } = montar({
    evento: EVENTO,
    hojeProgramacao: { id: 10, titulo: 'Día 2', checkout_aberto: true, checkout_fecha_em: null, data: '2026-08-18' },
    inscricao: { id: 42, nome: 'Fulano', email: 'f@x.com', status: 'confirmado', isento: false, rg: '123456' }
  });
  const res = resRender();
  await rotas['POST /checkout/:id']({ params: { id: '5' }, body: { email: 'f@x.com', documento: '123456', aval_resposta_0: '5', aval_resposta_1: '4' /* faltam as perguntas 2 e 3 */ }, headers: {}, ip: '1.2.3.4' }, res);
  assert.strictEqual(inserts.length, 0, 'avaliação agora é obrigatória em QUALQUER dia, não só no último');
  assert.ok(res._locals.erro);
});

test('POST /checkout/:id: dia comum com avaliação completa — grava check-out + as notas, marcado com o dia', async () => {
  const { rotas, inserts } = montar({
    evento: EVENTO,
    hojeProgramacao: { id: 10, titulo: 'Día 2', checkout_aberto: true, checkout_fecha_em: null, data: '2026-08-18' },
    inscricao: { id: 42, nome: 'Fulano', email: 'f@x.com', status: 'confirmado', isento: false, rg: '123456' }
  });
  const res = resRender();
  await rotas['POST /checkout/:id']({ params: { id: '5' }, body: { email: 'f@x.com', documento: '123456', aval_resposta_0: '6', aval_resposta_1: '5', aval_resposta_2: '6', aval_resposta_3: '4', aval_sugestoes: 'Mais tiempo para preguntas' }, headers: {}, ip: '1.2.3.4' }, res);
  assert.strictEqual(inserts.length, 1);
  const [, programacaoId, , , , , , avalRespostas, avalSugestoes] = inserts[0];
  assert.strictEqual(programacaoId, 10, 'a resposta fica marcada com o dia — organizada por data do evento');
  assert.deepStrictEqual(JSON.parse(avalRespostas), [6, 5, 6, 4], 'perguntas padrão (4), respostas na mesma ordem');
  assert.strictEqual(avalSugestoes, 'Mais tiempo para preguntas');
  assert.strictEqual(res._locals.sucesso, true);
});

test('POST /checkout/:id: dia final (último) também exige a avaliação — não é mais um caso especial', async () => {
  const { rotas, inserts } = montar({
    evento: EVENTO,
    hojeProgramacao: { id: 11, titulo: 'Día 4', checkout_aberto: true, checkout_fecha_em: null, data: '2026-08-20' },
    inscricao: { id: 42, nome: 'Fulano', email: 'f@x.com', status: 'confirmado', isento: false, rg: '123456' }
  });
  const res = resRender();
  await rotas['POST /checkout/:id']({ params: { id: '5' }, body: { email: 'f@x.com', documento: '123456' }, headers: {}, ip: '1.2.3.4' }, res);
  assert.strictEqual(inserts.length, 0, 'sem avaliação, nenhum dia grava check-out — inclusive o último');
  assert.ok(res._locals.erro);
});

// 17/08/2026: perguntas agora são configuráveis por evento (pedido do usuário: dá pra
// adicionar/excluir), então não são mais colunas fixas — viram um array de respostas na
// mesma ordem/tamanho da lista de perguntas vigente.
test('página pública: sempre mostra o bloco de avaliação obrigatória (perguntas dinâmicas), em qualquer dia', () => {
  const ejs = require('ejs');
  const fs = require('fs');
  const ARQUIVO = path.join(RAIZ, 'views/pages/evento-checkout-publico.ejs');
  const perguntas = ['Pergunta customizada 1', 'Pergunta customizada 2'];
  const base = { evento: { id: 5, nome: 'Jornada' }, config: {}, aberto: true, sucesso: false, jaConfirmado: false, erro: null, nome: null };
  const comAval = ejs.render(fs.readFileSync(ARQUIVO, 'utf8'), { ...base, perguntasAvaliacao: perguntas }, { filename: ARQUIVO });
  const semAval = ejs.render(fs.readFileSync(ARQUIVO, 'utf8'), { ...base, perguntasAvaliacao: [] }, { filename: ARQUIVO });
  assert.match(comAval, /Pergunta customizada 1/, 'mostra as perguntas configuradas pro evento');
  assert.match(comAval, /aval_resposta_0/, 'radios indexados por pergunta (0..N-1), não um name fixo compartilhado');
  assert.ok(!semAval.includes('aval_resposta_0'), 'sem perguntas configuradas, não mostra avaliação nenhuma');
});

test('GET /eventos/:id/checkout-relatorio: calcula a distribuição das notas e o % de resposta POR DIA', async () => {
  const { rotas } = montar({
    evento: EVENTO,
    mock: (sql) => {
      if (/SELECT id, nome, checkout_aberto, checkout_fecha_em, avaliacao_perguntas FROM eventos/.test(sql)) return { rows: [EVENTO] };
      if (/SELECT id, nome, email, cpf, status, isento FROM evento_inscricoes/.test(sql)) return { rows: [] };
      if (/SELECT inscricao_id, email, cpf, nome_informado, criado_em, programacao_id, aval_respostas/.test(sql)) return { rows: [
        { inscricao_id: 1, email: 'a@x.com', cpf: null, nome_informado: 'A', criado_em: new Date(), programacao_id: 11, aval_respostas: JSON.stringify([6, 5, 6, 4]), aval_sugestoes: 'Excelente evento' },
        { inscricao_id: 2, email: 'b@x.com', cpf: null, nome_informado: 'B', criado_em: new Date(), programacao_id: 11, aval_respostas: null, aval_sugestoes: null }, // fez check-out mas não respondeu
        { inscricao_id: 3, email: 'c@x.com', cpf: null, nome_informado: 'C', criado_em: new Date(), programacao_id: 10, aval_respostas: JSON.stringify([1, 1, 1, 1]), aval_sugestoes: null } // Día 1, entra na SEÇÃO do Día 1
      ] };
      if (/SELECT id, titulo, data FROM evento_programacao WHERE evento_id=\$1 AND data IS NOT NULL/.test(sql)) return { rows: [
        { id: 10, titulo: 'Día 1', data: '2026-08-17' },
        { id: 11, titulo: 'Día 4', data: '2026-08-20' }
      ] };
      return undefined;
    }
  });
  const res = { json: (b) => { res._body = b; } };
  await rotas['GET /eventos/:id/checkout-relatorio']({ params: { id: '5' } }, res);
  assert.strictEqual(res._body.perguntas.length, 4, 'perguntas padrão do evento (não customizadas)');
  const [dia1, dia4] = res._body.avaliacaoPorDia;
  assert.strictEqual(dia1.titulo, 'Día 1');
  assert.strictEqual(dia1.total, 1);
  assert.strictEqual(dia1.respondidas, 1);
  assert.deepStrictEqual(dia1.respostas[0].notas, [1, 1, 1, 1], 'a resposta de C fica na seção do próprio dia, não misturada com a do Día 4');
  assert.strictEqual(dia4.titulo, 'Día 4');
  assert.strictEqual(dia4.total, 2);
  assert.strictEqual(dia4.respondidas, 1);
  assert.strictEqual(dia4.percentual, 50);
  assert.deepStrictEqual(dia4.distribuicoes[0], [0, 0, 0, 0, 0, 1], 'pergunta 0 (tema): nota 6 (índice 5) recebeu 1 resposta no Día 4');
  assert.deepStrictEqual(dia4.sugestoes, ['Excelente evento']);
  assert.strictEqual(dia4.respostas[0].nome, 'A');
});

// 17/08/2026: pedido do usuário — dá pra adicionar/excluir perguntas por evento. O check-out
// tem que se adaptar ao TAMANHO configurado, não ficar preso em 4.
test('POST /checkout/:id: evento com perguntas customizadas (2, não as 4 padrão) — exige e grava só essas 2', async () => {
  const eventoCustom = { id: 5, nome: 'Jornada', checkout_aberto: false, checkout_fecha_em: null, avaliacao_perguntas: JSON.stringify(['Pergunta única A', 'Pergunta única B']) };
  const { rotas, inserts } = montar({
    evento: eventoCustom,
    hojeProgramacao: { id: 10, titulo: 'Día 4', checkout_aberto: true, checkout_fecha_em: null, data: '2026-08-20' },
    inscricao: { id: 42, nome: 'Fulano', email: 'f@x.com', status: 'confirmado', isento: false, rg: '123456' }
  });
  const res = resRender();
  await rotas['POST /checkout/:id']({ params: { id: '5' }, body: { email: 'f@x.com', documento: '123456', aval_resposta_0: '3', aval_resposta_1: '5' }, headers: {}, ip: '1.2.3.4' }, res);
  assert.strictEqual(inserts.length, 1);
  assert.deepStrictEqual(JSON.parse(inserts[0][7]), [3, 5], 'só 2 notas — do tamanho da lista customizada, não 4');
});

test('POST /checkout/:id: evento com perguntas customizadas — resposta 3ª pergunta (que não existe) não engana a validação', async () => {
  const eventoCustom = { id: 5, nome: 'Jornada', checkout_aberto: false, checkout_fecha_em: null, avaliacao_perguntas: JSON.stringify(['Pergunta única A', 'Pergunta única B']) };
  const { rotas, inserts } = montar({
    evento: eventoCustom,
    hojeProgramacao: { id: 10, titulo: 'Día 4', checkout_aberto: true, checkout_fecha_em: null, data: '2026-08-20' },
    inscricao: { id: 42, nome: 'Fulano', email: 'f@x.com', status: 'confirmado', isento: false, rg: '123456' }
  });
  const res = resRender();
  await rotas['POST /checkout/:id']({ params: { id: '5' }, body: { email: 'f@x.com', documento: '123456', aval_resposta_0: '3' /* falta a pergunta 1 */ }, headers: {}, ip: '1.2.3.4' }, res);
  assert.strictEqual(inserts.length, 0);
  assert.ok(res._locals.erro);
});

test('POST /eventos/:id/avaliacao-perguntas: salva a lista customizada (trim, remove vazias)', async () => {
  const updates = [];
  const { rotas } = montar({ evento: EVENTO, mock: (sql, params) => {
    if (/UPDATE eventos SET avaliacao_perguntas=\$1/.test(sql)) { updates.push(params); return { rows: [] }; }
    return undefined;
  }});
  const req = { params: { id: '5' }, body: { 'perguntas[]': ['  Pergunta A  ', '', 'Pergunta B'] }, session: {} };
  await rotas['POST /eventos/:id/avaliacao-perguntas'](req, resRedirect());
  assert.strictEqual(updates.length, 1);
  assert.deepStrictEqual(JSON.parse(updates[0][0]), ['Pergunta A', 'Pergunta B'], 'espaços cortados, linha vazia descartada');
  assert.strictEqual(updates[0][1], '5');
});

test('POST /eventos/:id/avaliacao-perguntas: lista vazia grava null (volta a usar as perguntas padrão)', async () => {
  const updates = [];
  const { rotas } = montar({ evento: EVENTO, mock: (sql, params) => {
    if (/UPDATE eventos SET avaliacao_perguntas=\$1/.test(sql)) { updates.push(params); return { rows: [] }; }
    return undefined;
  }});
  const req = { params: { id: '5' }, body: { 'perguntas[]': [''] }, session: {} };
  await rotas['POST /eventos/:id/avaliacao-perguntas'](req, resRedirect());
  assert.strictEqual(updates[0][0], null);
});

// 17/08/2026 (2ª rodada): avaliação passou a valer em todo dia, então o export ganhou uma
// coluna "Dia" e traz as respostas de TODOS os dias, não só do último.
test('GET /eventos/:id/avaliacao-export: gera CSV com coluna "Dia" e as perguntas como cabeçalho, respostas de todos os dias', async () => {
  const eventoCustom = { nome: 'Jornada Teste', avaliacao_perguntas: JSON.stringify(['Tema', 'Tempo']) };
  const { rotas } = montar({
    mock: (sql) => {
      if (/SELECT nome, avaliacao_perguntas FROM eventos WHERE id=\$1/.test(sql)) return { rows: [eventoCustom] };
      if (/SELECT id, titulo, data FROM evento_programacao WHERE evento_id=\$1 AND data IS NOT NULL ORDER BY data/.test(sql)) return { rows: [{ id: 11, titulo: 'Día 4', data: '2026-08-20' }] };
      if (/SELECT nome_informado, email, criado_em, programacao_id, aval_respostas, aval_sugestoes FROM evento_checkouts/.test(sql)) return { rows: [
        { nome_informado: 'Ana Confirmada', email: 'ana@x.com', criado_em: new Date('2026-08-20T20:00:00Z'), programacao_id: 11, aval_respostas: JSON.stringify([6, 5]), aval_sugestoes: 'Muy bueno' }
      ] };
      return undefined;
    }
  });
  const res = { _headers: {}, setHeader: function(k,v){ this._headers[k]=v; }, send: function(b){ this._body = b; } };
  await rotas['GET /eventos/:id/avaliacao-export']({ params: { id: '5' } }, res);
  assert.match(res._headers['Content-Type'], /text\/csv/);
  assert.match(res._headers['Content-Disposition'], /attachment; filename="avaliacao-Jornada_Teste\.csv"/);
  assert.match(res._body, /Dia;Nome;Email;Tema;Tempo;Sugestões;Respondido em/, 'cabeçalho usa as perguntas configuradas, com a coluna Dia na frente');
  assert.match(res._body, /Día 4.*Ana Confirmada.*ana@x\.com.*"6".*"5".*Muy bueno/);
});

// 17/08/2026: pedido do usuário — poder ver a página que o participante vai ver, sem precisar
// abrir o check-out de verdade. Reaproveita a MESMA página pública (evento-checkout-publico),
// só que forçando aberto=true — mas como é o mesmo formulário/rota real, um envio acidental
// durante a visualização não pode gravar um check-out ou avaliação falsos.
test('GET /eventos/:id/checkout-preview: renderiza a página pública com aberto forçado, sem gravar nada', async () => {
  const { rotas } = montar({ evento: { ...EVENTO, avaliacao_perguntas: JSON.stringify(['Pergunta única']) } });
  const res = resRender();
  await rotas['GET /eventos/:id/checkout-preview']({ params: { id: '5' } }, res);
  assert.strictEqual(res._locals.aberto, true);
  assert.strictEqual(res._locals.previa, true);
  assert.deepStrictEqual(res._locals.perguntasAvaliacao, ['Pergunta única']);
});

test('POST /checkout/:id: campo previa=1 (enviado da tela de prévia) NUNCA grava, mesmo com dados válidos', async () => {
  const { rotas, inserts } = montar({
    evento: EVENTO,
    hojeProgramacao: { id: 10, titulo: 'Día 4', checkout_aberto: true, checkout_fecha_em: null, data: '2026-08-20' },
    inscricao: { id: 42, nome: 'Fulano', email: 'f@x.com', status: 'confirmado', isento: false, rg: '123456' }
  });
  const res = resRender();
  await rotas['POST /checkout/:id']({ params: { id: '5' }, body: { previa: '1', email: 'f@x.com', documento: '123456', aval_resposta_0: '6', aval_resposta_1: '5', aval_resposta_2: '6', aval_resposta_3: '4' }, headers: {}, ip: '1.2.3.4' }, res);
  assert.strictEqual(inserts.length, 0, 'previa nunca grava, nem com todos os campos preenchidos certinho');
  assert.strictEqual(res._locals.previa, true);
});

// 17/08/2026 (3ª rodada): pedido do usuário — com o check-out valendo em todo dia, ele quer
// saber DE QUAL DIA foi cada check-out. Cada apto agora carrega {programacao_id, label} de
// cada dia em que fez check-out — o id é o que permite desfazer check-out de UM dia só (4ª
// rodada), não só mostrar o texto.
test('GET /eventos/:id/checkout-relatorio: cada apto vem com {programacao_id, label} de cada dia em que fez check-out', async () => {
  const { rotas } = montar({
    evento: EVENTO,
    mock: (sql) => {
      if (/SELECT id, nome, checkout_aberto, checkout_fecha_em, avaliacao_perguntas FROM eventos/.test(sql)) return { rows: [EVENTO] };
      if (/SELECT id, nome, email, cpf, status, isento FROM evento_inscricoes/.test(sql)) return { rows: [
        { id: 1, nome: 'A', email: 'a@x.com', status: 'confirmado', isento: false }
      ] };
      if (/SELECT inscricao_id, email, cpf, nome_informado, criado_em, programacao_id, aval_respostas/.test(sql)) return { rows: [
        { inscricao_id: 1, email: 'a@x.com', cpf: null, nome_informado: 'A', criado_em: new Date(), programacao_id: 10, aval_respostas: null, aval_sugestoes: null },
        { inscricao_id: 1, email: 'a@x.com', cpf: null, nome_informado: 'A', criado_em: new Date(), programacao_id: 11, aval_respostas: null, aval_sugestoes: null }
      ] };
      if (/SELECT id, titulo, data FROM evento_programacao WHERE evento_id=\$1 AND data IS NOT NULL/.test(sql)) return { rows: [
        { id: 10, titulo: 'Día 1', data: '2026-08-17' },
        { id: 11, titulo: 'Día 2', data: '2026-08-18' }
      ] };
      return undefined;
    }
  });
  const res = { json: (b) => { res._body = b; } };
  await rotas['GET /eventos/:id/checkout-relatorio']({ params: { id: '5' } }, res);
  const a = res._body.aptos[0];
  assert.strictEqual(a.dias.length, 2, 'A fez check-out em 2 dias diferentes');
  assert.ok(a.dias.some(d => d.programacao_id === 10 && d.label.includes('Día 1')));
  assert.ok(a.dias.some(d => d.programacao_id === 11 && d.label.includes('Día 2')));
});

// 17/08/2026 (4ª rodada): pedido do usuário — "Remover" apagava TODOS os check-outs da pessoa
// de uma vez (todos os dias juntos); agora só apaga o dia informado no corpo da requisição.
test('POST /eventos/:id/inscricao/:inscricao_id/desfazer-checkout: com programacao_id, apaga só o check-out DAQUELE dia', async () => {
  const deletes = [];
  const { rotas } = montar({ evento: EVENTO, mock: (sql, params) => {
    if (/DELETE FROM evento_checkouts/.test(sql)) { deletes.push({ sql, params }); return { rows: [] }; }
    return undefined;
  }});
  const res = { json: (b) => { res._body = b; } };
  await rotas['POST /eventos/:id/inscricao/:inscricao_id/desfazer-checkout']({ params: { id: '5', inscricao_id: '42' }, body: { programacao_id: 11 } }, res);
  assert.strictEqual(deletes.length, 1);
  assert.match(deletes[0].sql, /AND programacao_id=\$3/, 'delete escopado ao dia — não apaga os outros dias da mesma pessoa');
  assert.deepStrictEqual(deletes[0].params, ['5', '42', 11]);
  assert.strictEqual(res._body.ok, true);
});

test('POST /eventos/:id/inscricao/:inscricao_id/desfazer-checkout: sem programacao_id (evento legado), apaga só o check-out único (programacao_id NULL)', async () => {
  const deletes = [];
  const { rotas } = montar({ evento: EVENTO, mock: (sql, params) => {
    if (/DELETE FROM evento_checkouts/.test(sql)) { deletes.push({ sql, params }); return { rows: [] }; }
    return undefined;
  }});
  const res = { json: (b) => { res._body = b; } };
  await rotas['POST /eventos/:id/inscricao/:inscricao_id/desfazer-checkout']({ params: { id: '6', inscricao_id: '50' }, body: {} }, res);
  assert.strictEqual(deletes.length, 1);
  assert.match(deletes[0].sql, /AND programacao_id IS NULL/, 'sem dia informado, só mexe no check-out legado (sem dia)');
  assert.deepStrictEqual(deletes[0].params, ['6', '50']);
});

// 17/08/2026 (3ª rodada): pedido do usuário — o export de aptos ganhou coluna "Dia" e passou a
// trazer uma linha POR CHECK-OUT (uma pessoa com check-out em vários dias aparece em várias
// linhas, cada uma marcada com o dia certo — antes ficava ambíguo, sem coluna nenhuma pra isso).
test('GET /eventos/:id/checkout-export: uma linha por check-out, com coluna Dia', async () => {
  const { rotas } = montar({
    mock: (sql) => {
      if (/SELECT nome FROM eventos WHERE id=\$1/.test(sql)) return { rows: [{ nome: 'Jornada Teste' }] };
      if (/SELECT id, titulo, data FROM evento_programacao WHERE evento_id=\$1 AND data IS NOT NULL/.test(sql)) return { rows: [
        { id: 10, titulo: 'Día 1', data: '2026-08-17' },
        { id: 11, titulo: 'Día 2', data: '2026-08-18' }
      ] };
      if (/FROM evento_inscricoes i\s+JOIN evento_checkouts c/.test(sql)) return { rows: [
        { nome: 'Ana', email: 'ana@x.com', cpf: '1', rg: '1', catraca: null, tipo_participante: 'externo', isento: false, programacao_id: 10, checkout_em: '17/08/2026 10:00' },
        { nome: 'Ana', email: 'ana@x.com', cpf: '1', rg: '1', catraca: null, tipo_participante: 'externo', isento: false, programacao_id: 11, checkout_em: '18/08/2026 10:00' }
      ] };
      return undefined;
    }
  });
  const res = { _headers: {}, setHeader: function(k,v){ this._headers[k]=v; }, send: function(b){ this._body = b; } };
  await rotas['GET /eventos/:id/checkout-export']({ params: { id: '5' } }, res);
  assert.match(res._body, /Dia;Nome Completo;Email;CPF;RG;Catraca;Tipo Participante;Pagamento;Check-out em/);
  const linhas = res._body.split('\n').filter(l => l.includes('Ana'));
  assert.strictEqual(linhas.length, 2, 'Ana aparece 2 vezes — uma linha por dia de check-out, não deduplicado');
  assert.match(linhas[0], /Día 1/);
  assert.match(linhas[1], /Día 2/);
});

// 17/08/2026 (3ª rodada): pedido do usuário — "quero visualizar a tela de como a pessoa vai
// visualizar no email a confirmação de check-out daquele dia". Usa o wrap real (htmlSimples)
// pra ser fiel ao e-mail de verdade, e mostra o rótulo do dia resolvido.
test('GET /eventos/:id/checkout-email-preview: monta o e-mail completo (com wrap) e mostra o dia resolvido', async () => {
  const { rotas } = montar({
    evento: EVENTO,
    hojeProgramacao: { id: 10, titulo: 'Día 2', checkout_aberto: true, checkout_fecha_em: null, data: '2026-08-18' }
  });
  const res = { _headers: {}, send: function(b){ this._body = b; } };
  await rotas['GET /eventos/:id/checkout-email-preview']({ params: { id: '5' } }, res);
  assert.match(res._body, /<!DOCTYPE html>/, 'usa o wrap completo do e-mail (htmlSimples), não só o fragmento');
  assert.match(res._body, /data-faixa="ASISTENCIA CONFIRMADA"/);
  assert.match(res._body, /Día 2/, 'mostra o dia resolvido, pra diferenciar de qual check-out é a confirmação');
});
