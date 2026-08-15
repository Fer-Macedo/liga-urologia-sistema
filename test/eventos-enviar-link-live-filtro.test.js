// 15/08/2026: pedido explícito — testar a transmissão só com Ligantes/Diretivos antes de abrir
// pro público geral (evento com centenas de inscritos, erro em produção teria repercussão
// ruim). Casa CPF normalizado (só dígitos) ou e-mail — mesma lógica da correção de cadastro
// duplicado desta sessão, porque CPF pode estar formatado diferente entre as tabelas.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar({ inscritos, ligantes = [], diretivos = [] }) {
  const wppEnviados = [], emailEnviados = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT \* FROM eventos WHERE id=\$1/.test(sql)) return { rows: [{ id: 5, nome: 'Jornada' }] };
      if (/SELECT \* FROM evento_inscricoes WHERE evento_id=\$1 AND status='confirmado'/.test(sql)) return { rows: inscritos };
      if (/SELECT cpf, email FROM ligantes/.test(sql)) return { rows: ligantes };
      if (/SELECT cpf, email FROM diretivos/.test(sql)) return { rows: diretivos };
      if (/SELECT token FROM evento_presencas_online/.test(sql)) return { rows: [] };
      if (/INSERT INTO evento_presencas_online/.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({ org_nome: 'LAURO' }) } };
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
  require.cache[rnt] = { id: rnt, filename: rnt, loaded: true, exports: {
    enviarWhatsApp: async (numero, msg) => { wppEnviados.push(numero); },
    enviarEmail: async (opts) => { emailEnviados.push(opts.para); }
  }};

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, wppEnviados, emailEnviados };
}

function resJson() { const r = {}; r.json = (b) => { r._body = b; return r; }; return r; }

const INSCRITOS = [
  { id: 1, nome: 'Ana Externa', email: 'ana@x.com', whatsapp: '595111', cpf: '', status: 'confirmado' },
  { id: 2, nome: 'Bruno Ligante', email: 'bruno@x.com', whatsapp: '595222', cpf: '111.222.333-44', status: 'confirmado' },
  { id: 3, nome: 'Carla Diretiva', email: 'carla@x.com', whatsapp: '595333', cpf: '555.666.777-88', status: 'confirmado' }
];
const LIGANTES = [{ cpf: '11122233344', email: 'bruno@x.com' }]; // mesmo CPF do Bruno, sem pontuação
const DIRETIVOS = [{ cpf: '55566677788', email: 'carla@x.com' }];

test('filtro "todos": envia pra todo mundo confirmado, sem checar ligante/diretivo', async () => {
  const { rotas, wppEnviados } = montar({ inscritos: INSCRITOS, ligantes: LIGANTES, diretivos: DIRETIVOS });
  const res = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: { filtro: 'todos' } }, res);
  assert.strictEqual(wppEnviados.length, 3);
});

test('filtro "ligantes": só quem bate CPF/email com a tabela ligantes, mesmo com CPF formatado diferente', async () => {
  const { rotas, wppEnviados } = montar({ inscritos: INSCRITOS, ligantes: LIGANTES, diretivos: DIRETIVOS });
  const res = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: { filtro: 'ligantes' } }, res);
  assert.strictEqual(wppEnviados.length, 1);
  assert.strictEqual(wppEnviados[0], '595222', 'só o Bruno (é ligante)');
});

test('filtro "diretivos": só quem bate com a tabela diretivos', async () => {
  const { rotas, wppEnviados } = montar({ inscritos: INSCRITOS, ligantes: LIGANTES, diretivos: DIRETIVOS });
  const res = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: { filtro: 'diretivos' } }, res);
  assert.strictEqual(wppEnviados.length, 1);
  assert.strictEqual(wppEnviados[0], '595333', 'só a Carla (é diretiva)');
});

test('filtro "membros": ligantes OU diretivos, exclui só o externo puro', async () => {
  const { rotas, wppEnviados } = montar({ inscritos: INSCRITOS, ligantes: LIGANTES, diretivos: DIRETIVOS });
  const res = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: { filtro: 'membros' } }, res);
  assert.strictEqual(wppEnviados.length, 2);
  assert.ok(!wppEnviados.includes('595111'), 'Ana (externa pura) não deve receber no filtro "membros"');
});

test('sem filtro no body (undefined): comporta como "todos" (retrocompatível)', async () => {
  const { rotas, wppEnviados } = montar({ inscritos: INSCRITOS, ligantes: [], diretivos: [] });
  const res = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: {} }, res);
  assert.strictEqual(wppEnviados.length, 3);
});

test('conta WhatsApp e e-mail SEPARADAMENTE (antes só contava WhatsApp, mensagem final mentia)', async () => {
  const { rotas, emailEnviados } = montar({ inscritos: INSCRITOS, ligantes: [], diretivos: [] });
  const res = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: { filtro: 'todos' } }, res);
  assert.strictEqual(emailEnviados.length, 3);
  assert.match(res._body.msg, /3 WhatsApp e 3 e-mails/);
});
