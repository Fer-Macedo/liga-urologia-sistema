// Achado em produção (2026-08-01): a página pública de inscrição do PSS não exigia que o
// candidato confirmasse ter lido o edital nem a política de privacidade (LGPD) antes de se
// inscrever. Adicionado o checkbox na tela (required no HTML) E a validação aqui no servidor
// — um checkbox só no HTML pode ser burlado com um POST direto, então a garantia de verdade
// tem que estar na rota.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/processo-seletivo.js');

function montar({ editalChave = 'edital-key-1' } = {}) {
  const queries = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      queries.push(sql);
      if (/SELECT \* FROM ps_processos WHERE id=\$1/.test(sql)) {
        return { rows: [{ id: 4, nome: 'Proceso Selectivo 2026.2', inscricoes_abertas: true, edital_chave: editalChave, valor_inscricao: 25 }] };
      }
      if (/SELECT id FROM ps_candidatos WHERE processo_id=\$1/.test(sql)) {
        return { rows: [] };
      }
      if (/INSERT INTO ps_candidatos/.test(sql)) {
        return { rows: [{ id: 99 }] };
      }
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
  return { rotas, queries };
}

function reqBase(overrides) {
  return { params: { id: '4' }, body: Object.assign({
    nome: 'Juan Pérez', email: 'juan@example.com', whatsapp_pais: '+595', whatsapp: '981234567',
    data_nascimento: '2000-01-01', catraca: '123', documento_tipo: 'CI', documento: '1234567',
    semestre_atual: '3', turma: 'A', cupom_codigo: ''
  }, overrides) };
}

test('edital exigido e não marcado: rejeita e nunca chega a checar duplicidade/gravar', async () => {
  const { rotas, queries } = montar({ editalChave: 'edital-key-1' });
  const req = reqBase({ aceite_lgpd: 'on' }); // sem aceite_edital
  let status = null, body = null;
  const res = { status: (s) => { status = s; return res; }, render: (view, data) => { body = data; } };
  await rotas['/pss/:id/inscricao'](req, res);
  assert.match(body.erro, /Bases del Edital/);
  assert.ok(!queries.some(sql => /ps_candidatos WHERE processo_id/.test(sql)), 'não pode nem checar duplicidade sem o aceite');
});

test('edital exigido e marcado, mas LGPD não marcado: rejeita', async () => {
  const { rotas } = montar({ editalChave: 'edital-key-1' });
  const req = reqBase({ aceite_edital: 'on' }); // sem aceite_lgpd
  let body = null;
  const res = { status: () => res, render: (view, data) => { body = data; } };
  await rotas['/pss/:id/inscricao'](req, res);
  assert.match(body.erro, /Política de Privacidad/);
});

test('sem edital cadastrado: só exige o LGPD (edital não bloqueia)', async () => {
  const { rotas } = montar({ editalChave: null });
  const req = reqBase({}); // nem aceite_edital nem aceite_lgpd
  let body = null;
  const res = { status: () => res, render: (view, data) => { body = data; } };
  await rotas['/pss/:id/inscricao'](req, res);
  assert.match(body.erro, /Política de Privacidad/, 'como não há edital, o erro tem que ser só do LGPD');
});

test('edital marcado + LGPD marcado: passa da validação e chega a checar duplicidade', async () => {
  const { rotas, queries } = montar({ editalChave: 'edital-key-1' });
  const req = reqBase({ aceite_edital: 'on', aceite_lgpd: 'on' });
  let body = null, redirecionou = null;
  const res = { status: () => res, send: () => {}, render: (view, data) => { body = data; }, redirect: (url) => { redirecionou = url; } };
  await rotas['/pss/:id/inscricao'](req, res);
  assert.ok(!body || !/Bases del Edital|Política de Privacidad/.test(body.erro || ''), 'com os dois marcados, não pode cair no erro de aceite');
  assert.ok(queries.some(sql => /ps_candidatos WHERE processo_id/.test(sql)), 'passou da validação e foi checar duplicidade');
  assert.strictEqual(redirecionou, '/pss/pagamento/99', 'seguiu o fluxo normal até o pagamento');
});
