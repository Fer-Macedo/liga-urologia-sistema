// 18/08/2026: achado em produção — lote programado pra fechar às 18:59 continuava aceitando
// inscrição às 20h+ na página pública. O campo data_fim (e data_inicio) do lote nunca era
// comparado com a hora real em lugar nenhum — só aparecia como texto informativo ("Disponible
// hasta X") na tela, sem nenhuma checagem de verdade nem no GET (pra esconder da lista) nem no
// POST (pra bloquear o cadastro, que é o que realmente importa — alguém que já tinha a página
// aberta antes do prazo, ou que forjasse o POST direto, continuava conseguindo se inscrever).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar({ evento, lotes = [], inserts } = {}) {
  const inscricaoInserts = inserts || [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT e\.\*, .* FROM eventos e WHERE id=\$1/.test(sql)) return { rows: evento ? [evento] : [] };
      if (/SELECT \* FROM eventos WHERE id=\$1/.test(sql)) return { rows: evento ? [evento] : [] };
      if (/SELECT l\.\*, .* FROM evento_lotes l WHERE l\.evento_id=\$1/.test(sql)) return { rows: lotes };
      if (/SELECT \* FROM evento_lotes WHERE id=\$1/.test(sql)) {
        const l = lotes.find(x => x.id === parseInt(params[0]));
        return { rows: l ? [l] : [] };
      }
      if (/SELECT id, status FROM evento_inscricoes/.test(sql)) return { rows: [] }; // sem duplicata
      if (/INSERT INTO evento_inscricoes/.test(sql)) { inscricaoInserts.push(params); return { rows: [{ id: 999 }] }; }
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };
  const re = require.resolve(path.join(RAIZ, 'src/services/email.js'));
  require.cache[re] = { id: re, filename: re, loaded: true, exports: { enviarEmail: async () => {}, emailBonito: () => '' } };
  const rev = require.resolve(path.join(RAIZ, 'src/services/eventos-email.js'));
  require.cache[rev] = { id: rev, filename: rev, loaded: true, exports: { enviarEmailConfirmacaoEvento: async () => {}, TEXTO_CONFIRMACAO_PADRAO: 'x' } };
  const rpg = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  require.cache[rpg] = { id: rpg, filename: rpg, loaded: true, exports: { criarPixEvento: async () => ({}), consultarPagamento: async () => ({}), obterChavePublica: async () => ({}), pagarComCartao: async () => ({}) } };
  const rrl = require.resolve(path.join(RAIZ, 'src/services/rate-limiters.js'));
  require.cache[rrl] = { id: rrl, filename: rrl, loaded: true, exports: { limiterPagamentoCartao: (q,s,n)=>n() } };
  const rfx = require.resolve(path.join(RAIZ, 'src/services/fluxo-eventos.js'));
  require.cache[rfx] = { id: rfx, filename: rfx, loaded: true, exports: { calcularLiquidoEvento: (v) => v } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, inscricaoInserts };
}

function resRender() { const r = {}; r.render = (view, locals) => { r._view = view; r._locals = locals; return r; }; r.status = (c) => ({ send: (b) => { r._status = c; r._body = b; } }); return r; }

const EVENTO = { id: 5, nome: 'Jornada', status: 'ativo', total_inscritos: 0, vagas_total: 0 };

test('GET /inscricao/:id: lote com data_fim no passado NÃO aparece na lista', async () => {
  const { rotas } = montar({
    evento: EVENTO,
    lotes: [{ id: 7, nome: 'Estudiantes UCP', preco: 12, ativo: true, data_inicio: '2026-08-11T00:00:00', data_fim: '2026-08-18T18:59:00' }]
  });
  const res = resRender();
  await rotas['GET /inscricao/:id']({ params: { id: '5' }, query: {} }, res);
  assert.strictEqual(res._locals.lotes.length, 0, 'lote expirado não pode aparecer pra seleção');
});

test('GET /inscricao/:id: evento tem lote(s) cadastrado(s) mas TODOS expiraram — encerrado=true', async () => {
  const { rotas } = montar({
    evento: EVENTO,
    lotes: [
      { id: 7, nome: 'A', preco: 12, ativo: true, data_inicio: '2026-08-11T00:00:00', data_fim: '2026-08-18T18:59:00' },
      { id: 8, nome: 'B', preco: 15, ativo: true, data_inicio: '2026-08-11T00:00:00', data_fim: '2026-08-18T18:59:00' }
    ]
  });
  const res = resRender();
  await rotas['GET /inscricao/:id']({ params: { id: '5' }, query: {} }, res);
  assert.strictEqual(res._locals.encerrado, true, 'sem nenhum lote válido, a inscrição precisa aparecer como encerrada');
});

test('GET /inscricao/:id: lote com data_fim no futuro aparece normalmente', async () => {
  const { rotas } = montar({
    evento: EVENTO,
    lotes: [{ id: 9, nome: 'Válido', preco: 12, ativo: true, data_inicio: '2026-08-11T00:00:00', data_fim: '2099-01-01T00:00:00' }]
  });
  const res = resRender();
  await rotas['GET /inscricao/:id']({ params: { id: '5' }, query: {} }, res);
  assert.strictEqual(res._locals.lotes.length, 1);
  assert.strictEqual(res._locals.encerrado, false);
});

test('GET /inscricao/:id: lote sem data_fim/data_inicio (null) continua aparecendo — comportamento anterior preservado', async () => {
  const { rotas } = montar({
    evento: EVENTO,
    lotes: [{ id: 10, nome: 'Sem prazo', preco: 12, ativo: true, data_inicio: null, data_fim: null }]
  });
  const res = resRender();
  await rotas['GET /inscricao/:id']({ params: { id: '5' }, query: {} }, res);
  assert.strictEqual(res._locals.lotes.length, 1);
});

test('GET /inscricao/:id: lote com ativo=false não aparece, mesmo com datas válidas', async () => {
  const { rotas } = montar({
    evento: EVENTO,
    lotes: [{ id: 11, nome: 'Desativado', preco: 12, ativo: false, data_inicio: null, data_fim: null }]
  });
  const res = resRender();
  await rotas['GET /inscricao/:id']({ params: { id: '5' }, query: {} }, res);
  assert.strictEqual(res._locals.lotes.length, 0);
});

test('POST /inscricao/:id: lote expirado BLOQUEIA o cadastro de verdade — não insere, mesmo enviando o lote_id direto', async () => {
  const { rotas, inscricaoInserts } = montar({
    evento: EVENTO,
    lotes: [{ id: 7, nome: 'Estudiantes UCP', preco: 0, ativo: true, data_inicio: '2026-08-11T00:00:00', data_fim: '2026-08-18T18:59:00' }]
  });
  const req = { params: { id: '5' }, body: { nome: 'Fulano', email: 'f@x.com', lote_id: '7' } };
  const res = resRender();
  await rotas['POST /inscricao/:id'](req, res);
  assert.strictEqual(inscricaoInserts.length, 0, 'lote fora da janela não pode gravar inscrição nenhuma');
  assert.strictEqual(res._locals.encerrado, true);
});

test('POST /inscricao/:id: lote dentro da janela continua funcionando normalmente (não regride)', async () => {
  const { rotas, inscricaoInserts } = montar({
    evento: EVENTO,
    lotes: [{ id: 9, nome: 'Válido', preco: 0, ativo: true, data_inicio: '2026-08-11T00:00:00', data_fim: '2099-01-01T00:00:00' }]
  });
  const req = { params: { id: '5' }, body: { nome: 'Fulano', email: 'f@x.com', lote_id: '9' } };
  const res = resRender();
  await rotas['POST /inscricao/:id'](req, res);
  assert.strictEqual(inscricaoInserts.length, 1, 'lote válido continua aceitando inscrição normalmente');
  assert.strictEqual(res._locals.sucesso, true);
});

test('POST /inscricao/:id: lote desativado (ativo=false) bloqueia mesmo com datas OK', async () => {
  const { rotas, inscricaoInserts } = montar({
    evento: EVENTO,
    lotes: [{ id: 12, nome: 'Desativado', preco: 0, ativo: false, data_inicio: null, data_fim: null }]
  });
  const req = { params: { id: '5' }, body: { nome: 'Fulano', email: 'f@x.com', lote_id: '12' } };
  const res = resRender();
  await rotas['POST /inscricao/:id'](req, res);
  assert.strictEqual(inscricaoInserts.length, 0);
  assert.strictEqual(res._locals.encerrado, true);
});
