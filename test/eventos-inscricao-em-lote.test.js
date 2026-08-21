// 21/08/2026: pedido do usuário — evento INTERNO (não divulgado publicamente): em vez de
// cadastrar ligante por ligante no formulário manual, deixa inscrever de uma vez todos os
// ligantes ativos, todos os diretivos ativos, ou uma seleção específica de cada (nem todo
// evento interno é pra liga inteira — às vezes só parte participa).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar({ ligantes = [], diretivos = [], jaInscritos = [] } = {}) {
  const inserts = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT nome, email, whatsapp, cpf FROM ligantes WHERE ativo=1 AND pendente=false/.test(sql)) return { rows: ligantes };
      if (/SELECT nome, email, whatsapp, cpf FROM diretivos WHERE ativo=1 AND pendente=false/.test(sql)) return { rows: diretivos };
      if (/SELECT LOWER\(email\) as email FROM evento_inscricoes WHERE evento_id=\$1/.test(sql)) {
        return { rows: jaInscritos.map(e => ({ email: e.toLowerCase() })) };
      }
      if (/INSERT INTO evento_inscricoes/.test(sql)) { inserts.push(params); return { rows: [] }; }
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, inserts };
}

function resRedirect() { const r = {}; r.redirect = (u) => { r._redirect = u; return r; }; return r; }
function reqBase(extra) { return Object.assign({ session: {} }, extra); }

const LIGANTES = [
  { nome: 'Ana Ligante', email: 'ana@x.com', whatsapp: '595111', cpf: '111' },
  { nome: 'Bruno Ligante', email: 'bruno@x.com', whatsapp: '595222', cpf: '222' }
];
const DIRETIVOS = [
  { nome: 'Carla Diretiva', email: 'carla@x.com', whatsapp: '595333', cpf: '333' }
];

test('modo=todos_ligantes: cadastra todos os ligantes ativos como confirmado por padrão', async () => {
  const { rotas, inserts } = montar({ ligantes: LIGANTES });
  const req = reqBase({ params: { id: '5' }, body: { modo: 'todos_ligantes' } });
  await rotas['POST /eventos/:id/inscricoes/em-lote'](req, resRedirect());
  assert.strictEqual(inserts.length, 2);
  assert.strictEqual(inserts[0][1], 'Ana Ligante');
  assert.strictEqual(inserts[0][5], 'ligante', 'tipo_participante = ligante');
  assert.strictEqual(inserts[0][6], 'confirmado', 'status padrão');
});

test('modo=todos_diretivos: cadastra todos os diretivos ativos', async () => {
  const { rotas, inserts } = montar({ diretivos: DIRETIVOS });
  const req = reqBase({ params: { id: '5' }, body: { modo: 'todos_diretivos' } });
  await rotas['POST /eventos/:id/inscricoes/em-lote'](req, resRedirect());
  assert.strictEqual(inserts.length, 1);
  assert.strictEqual(inserts[0][1], 'Carla Diretiva');
  assert.strictEqual(inserts[0][5], 'diretivo');
});

// 21/08/2026: BUG REAL em produção — o body-parser deste projeto usa
// express.urlencoded({extended:true}) (lib "qs"), que tira os colchetes da chave ao montar o
// array: um campo HTML "ligantes_selecionados[]" chega em req.body.ligantes_selecionados (SEM
// colchetes), nunca em req.body['ligantes_selecionados[]']. A rota lia a chave errada — nenhuma
// seleção nunca era reconhecida, mesmo com checkboxes marcados. Este teste usa o body do jeito
// que o "qs" de verdade entrega (chave sem colchetes, valor em array), pra não mascarar o bug
// de novo como a versão anterior deste teste mascarou.
test('modo=selecao: só cadastra quem foi marcado, ligantes e diretivos juntos', async () => {
  const { rotas, inserts } = montar({ ligantes: LIGANTES, diretivos: DIRETIVOS });
  const req = reqBase({ params: { id: '5' }, body: {
    modo: 'selecao',
    ligantes_selecionados: ['Bruno Ligante'],
    diretivos_selecionados: ['Carla Diretiva']
  } });
  await rotas['POST /eventos/:id/inscricoes/em-lote'](req, resRedirect());
  assert.strictEqual(inserts.length, 2);
  const nomes = inserts.map(i => i[1]).sort();
  assert.deepStrictEqual(nomes, ['Bruno Ligante', 'Carla Diretiva'], 'Ana Ligante NÃO foi selecionada, não entra');
});

test('modo=selecao com apenas 1 pessoa marcada: qs entrega o valor como array de 1 item, não string solta', async () => {
  const { rotas, inserts } = montar({ ligantes: LIGANTES });
  const req = reqBase({ params: { id: '5' }, body: {
    modo: 'selecao',
    ligantes_selecionados: ['Ana Ligante'] // é assim que o qs entrega, mesmo com 1 só marcado
  } });
  await rotas['POST /eventos/:id/inscricoes/em-lote'](req, resRedirect());
  assert.strictEqual(inserts.length, 1);
  assert.strictEqual(inserts[0][1], 'Ana Ligante');
});

test('status=pendente: grava a inscrição como pendente em vez de confirmado', async () => {
  const { rotas, inserts } = montar({ ligantes: LIGANTES });
  const req = reqBase({ params: { id: '5' }, body: { modo: 'todos_ligantes', status: 'pendente' } });
  await rotas['POST /eventos/:id/inscricoes/em-lote'](req, resRedirect());
  assert.strictEqual(inserts[0][6], 'pendente');
  assert.strictEqual(inserts[1][6], 'pendente');
});

test('não duplica quem já está inscrito (mesmo e-mail, case-insensitive)', async () => {
  const { rotas, inserts } = montar({ ligantes: LIGANTES, jaInscritos: ['ANA@x.com'] });
  const req = reqBase({ params: { id: '5' }, body: { modo: 'todos_ligantes' } });
  await rotas['POST /eventos/:id/inscricoes/em-lote'](req, resRedirect());
  assert.strictEqual(inserts.length, 1, 'Ana já estava inscrita — só Bruno entra');
  assert.strictEqual(inserts[0][1], 'Bruno Ligante');
});

test('seleção vazia (nenhum nome marcado): não insere nada, avisa erro', async () => {
  const { rotas, inserts } = montar({ ligantes: LIGANTES, diretivos: DIRETIVOS });
  const req = reqBase({ params: { id: '5' }, body: { modo: 'selecao' } });
  await rotas['POST /eventos/:id/inscricoes/em-lote'](req, resRedirect());
  assert.strictEqual(inserts.length, 0);
  assert.ok(req.session.erro && req.session.erro.length, 'avisa que ninguém foi selecionado');
});
