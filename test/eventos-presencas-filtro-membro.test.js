// 19/08/2026: pedido do usuário — filtro por Ligantes/Diretivos/Ligantes+Diretivos na tela de
// presenças (/eventos/:id/presencas), igual já existe pro envio do link da live. A rota agora
// classifica cada inscrito (classificarPorTipoMembro, extraído de filtrarPorTipoMembro) e passa
// _ligante/_diretivo pra view — sem filtrar nada fora, a tela precisa mostrar todo mundo e deixar
// o filtro ser feito client-side (como já é com Status/Tipo).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar({ inscritos, ligantes = [], diretivos = [] }) {
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql) => {
      if (/SELECT \* FROM eventos WHERE id=\$1/.test(sql)) return { rows: [{ id: 5, nome: 'Jornada' }] };
      if (/SELECT \* FROM evento_inscricoes WHERE evento_id=\$1 AND status='confirmado'/.test(sql)) return { rows: inscritos };
      if (/SELECT cpf, email, nome FROM ligantes WHERE ativo=1 AND pendente=false/.test(sql)) return { rows: ligantes };
      if (/SELECT cpf, email, nome FROM diretivos WHERE ativo=1 AND pendente=false/.test(sql)) return { rows: diretivos };
      return { rows: [] };
    }
  }};
  const rep = require.resolve(path.join(RAIZ, 'src/services/eventos-presenca.js'));
  require.cache[rep] = { id: rep, filename: rep, loaded: true, exports: {
    buscarDadosPresenca: async () => ({ diasFechados: [] }),
    calcularPercentual: () => ({ segundosPresencial: 0, segundosOnlineTotal: 0, pctGeral: null, porDia: [], temDadosSuficientes: false, apto: false }),
    LIMIAR_FREQUENCIA: 75
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
  require.cache[rnt] = { id: rnt, filename: rnt, loaded: true, exports: { enviarWhatsApp: async () => {}, enviarEmail: async () => {} } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas };
}

function resRender() { const r = {}; r.render = (view, locals) => { r._view = view; r._locals = locals; return r; }; return r; }
function reqBase(extra) { return Object.assign({ session: { usuario: { id: 1 } }, flash: () => [] }, extra); }

const INSCRITOS = [
  { id: 1, nome: 'Ana Externa', email: 'ana@x.com', cpf: '', status: 'confirmado' },
  { id: 2, nome: 'Bruno Ligante', email: 'bruno@x.com', cpf: '111.222.333-44', status: 'confirmado' },
  { id: 3, nome: 'Carla Diretiva', email: 'carla@x.com', cpf: '555.666.777-88', status: 'confirmado' }
];
const LIGANTES = [{ cpf: '11122233344', email: 'bruno@x.com', nome: 'Bruno Ligante' }];
const DIRETIVOS = [{ cpf: '55566677788', email: 'carla@x.com', nome: 'Carla Diretiva' }];

test('GET /eventos/:id/presencas: classifica cada inscrito (_ligante/_diretivo) sem tirar ninguém da lista', async () => {
  const { rotas } = montar({ inscritos: INSCRITOS, ligantes: LIGANTES, diretivos: DIRETIVOS });
  const res = resRender();
  await rotas['GET /eventos/:id/presencas'](reqBase({ params: { id: '5' } }), res);
  assert.strictEqual(res._locals.inscricoes.length, 3, 'a tela mostra todo mundo — não filtra no servidor');
  const ana = res._locals.inscricoes.find(i => i.nome === 'Ana Externa');
  const bruno = res._locals.inscricoes.find(i => i.nome === 'Bruno Ligante');
  const carla = res._locals.inscricoes.find(i => i.nome === 'Carla Diretiva');
  assert.deepStrictEqual({ _ligante: ana._ligante, _diretivo: ana._diretivo }, { _ligante: false, _diretivo: false });
  assert.deepStrictEqual({ _ligante: bruno._ligante, _diretivo: bruno._diretivo }, { _ligante: true, _diretivo: false });
  assert.deepStrictEqual({ _ligante: carla._ligante, _diretivo: carla._diretivo }, { _ligante: false, _diretivo: true });
});

test('GET /eventos/:id/presencas: continua trazendo o cálculo de presença de cada um (não quebrou com a classificação)', async () => {
  const { rotas } = montar({ inscritos: [INSCRITOS[0]], ligantes: [], diretivos: [] });
  const res = resRender();
  await rotas['GET /eventos/:id/presencas'](reqBase({ params: { id: '5' } }), res);
  assert.ok(res._locals.inscricoes[0].presenca, 'campo presenca continua presente em cada inscrito');
});
