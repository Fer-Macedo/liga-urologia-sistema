// 21/08/2026: mesma queixa recorrente relatada pelo usuário — candidato começa a se inscrever
// no processo seletivo, não conclui o pagamento, e ao voltar pra terminar recebe "já existe uma
// inscrição" e fica travado (só saída era o admin excluir manualmente o cadastro pendente pra
// pessoa refazer tudo). Mesma correção já feita em eventos (POST /inscricao/:id, 12/08/2026):
// só quem já está 'confirmado' é duplicata de verdade; quem ficou 'pendente' é redirecionado
// pra retomar o pagamento existente, sem criar um segundo cadastro.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/processo-seletivo.js');

function montar({ dup = null } = {}) {
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT \* FROM ps_processos WHERE id=\$1/.test(sql)) {
        return { rows: [{ id: 4, nome: 'Proceso Selectivo 2026.2', inscricoes_abertas: true, edital_chave: null, valor_inscricao: 25 }] };
      }
      if (/SELECT id, status FROM ps_candidatos WHERE processo_id=\$1/.test(sql)) {
        return { rows: dup ? [dup] : [] };
      }
      if (/INSERT INTO ps_candidatos/.test(sql)) return { rows: [{ id: 99 }] };
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q, s, n) => n(), requirePermissao: () => (q, s, n) => n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };
  const rar = require.resolve(path.join(RAIZ, 'src/services/arquivos.js'));
  require.cache[rar] = { id: rar, filename: rar, loaded: true, exports: { upload: { single: () => (q, s, n) => n() }, uploadArquivo: async () => ({}) } };
  const rdl = require.resolve(path.join(RAIZ, 'src/services/desligamento.js'));
  require.cache[rdl] = { id: rdl, filename: rdl, loaded: true, exports: { getUrlAssinada: async () => 'https://x' } };
  const rnt = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rnt] = { id: rnt, filename: rnt, loaded: true, exports: { enviarEmail: async () => {} } };
  const rpss = require.resolve(path.join(RAIZ, 'src/services/pss.js'));
  require.cache[rpss] = { id: rpss, filename: rpss, loaded: true, exports: {
    _pssProximoNumero: async () => 1, confirmarInscricaoPss: async () => {},
    enviarEmailConfirmacaoPss: async () => {}, enviarLembretePss: async () => {}, enviarEmailBoasVindasPss: async () => {}
  }};
  const rpg = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  require.cache[rpg] = { id: rpg, filename: rpg, loaded: true, exports: {
    criarPixPss: async () => ({ order_id: 'ord1', pix_copia_cola: 'copia', pix_qr_image: 'img' })
  }};

  const rotas = {};
  const router = { get: () => {}, post: (rota, ...fns) => { rotas[rota] = fns[fns.length - 1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas };
}

function reqBase(overrides) {
  return { params: { id: '4' }, body: Object.assign({
    nome: 'Juan Pérez', email: 'juan@example.com', whatsapp_pais: '+595', whatsapp: '981234567',
    data_nascimento: '2000-01-01', catraca: '123', documento_tipo: 'CI', documento: '1234567',
    semestre_atual: '3', turma: 'A', cupom_codigo: '', aceite_lgpd: 'on'
  }, overrides) };
}

test('candidato com inscrição PENDENTE (não concluiu pagamento) é redirecionado pra retomar, não bloqueado', async () => {
  const { rotas } = montar({ dup: { id: 55, status: 'pendente' } });
  const req = reqBase({});
  let redirecionou = null;
  const res = { status: () => res, send: () => {}, render: () => {}, redirect: (url) => { redirecionou = url; } };
  await rotas['/pss/:id/inscricao'](req, res);
  assert.strictEqual(redirecionou, '/pss/pagamento/55', 'reaproveita o cadastro pendente existente, não cria outro nem bloqueia');
});

test('candidato já CONFIRMADO continua barrado (é duplicata de verdade)', async () => {
  const { rotas } = montar({ dup: { id: 55, status: 'confirmado' } });
  const req = reqBase({});
  let body = null;
  const res = { status: () => res, render: (view, data) => { body = data; } };
  await rotas['/pss/:id/inscricao'](req, res);
  assert.match(body.erro, /Já existe uma inscrição/);
});

test('sem nenhuma inscrição prévia: segue o fluxo normal, cria e manda pro pagamento', async () => {
  const { rotas } = montar({ dup: null });
  const req = reqBase({});
  let redirecionou = null;
  const res = { status: () => res, send: () => {}, render: () => {}, redirect: (url) => { redirecionou = url; } };
  await rotas['/pss/:id/inscricao'](req, res);
  assert.strictEqual(redirecionou, '/pss/pagamento/99');
});
