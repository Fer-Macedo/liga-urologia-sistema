// 11/08/2026: "gerar cupons para ligantes" dizia filtrar só quem está "em dia", mas o
// cálculo de atraso era descartado — TODO ligante ativo recebia cupom, inadimplente
// inclusive. Regra combinada com o usuário: ligante com 2+ mensalidades atrasadas NÃO
// recebe; com 0 ou 1 atrasada, recebe normalmente. Ligante não tem cobrança própria — o
// vínculo com o financeiro (membros/cobrancas) é por CPF ou e-mail, mesmo padrão já usado
// em ligantes.js pra sincronizar as duas tabelas.
//
// Achado no mesmo dia, na prática: o formulário postava pra /cupons/gerar-ligantes, que era
// uma rota MORTA (nunca respondia nada) — o nginx esperava até o timeout e devolvia 504.
// A rota "-v2" (com a lógica de verdade) nunca era alcançada. Corrigido consolidando as duas
// na rota certa e movendo o envio (cupom + WhatsApp/email de cada pessoa) pra depois da
// resposta HTTP já ter saído — 48+ envios sequenciais também já estourava o tempo sozinho.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar({ ligantes, atrasosPorCpfOuEmail, jaExistentes }) {
  const cupomInserts = [];
  const existentes = new Map((jaExistentes || []).map(e => [e.ligante_id, e.codigo])); // simula unicidade real do banco
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT id, nome, email, whatsapp, cpf, 'ligante' as tipo FROM ligantes/.test(sql)) {
        return { rows: ligantes };
      }
      if (/FROM cobrancas c JOIN membros m ON m\.id = c\.membro_id/.test(sql)) {
        const [cpf, email] = params;
        const chave = (cpf && cpf !== '') ? cpf : email;
        return { rows: [{ n: String(atrasosPorCpfOuEmail[chave] || 0) }] };
      }
      if (/SELECT \* FROM eventos WHERE id=\$1/.test(sql)) return { rows: [{ id: 1, nome: 'Congresso Teste' }] };
      if (/SELECT chave,valor FROM configuracoes/.test(sql)) return { rows: [] };
      if (/'diretivo' as tipo FROM diretivos/.test(sql)) return { rows: [] };
      if (/SELECT codigo FROM evento_cupons WHERE evento_id=\$1 AND ligante_id=\$2/.test(sql)) {
        const [, ligId] = params;
        return existentes.has(ligId) ? { rows: [{ codigo: existentes.get(ligId) }] } : { rows: [] };
      }
      if (/INSERT INTO evento_cupons/.test(sql)) {
        cupomInserts.push(params);
        const [, codigo, ligId] = params;
        if (existentes.has(ligId)) return { rows: [] }; // ON CONFLICT ... DO NOTHING
        existentes.set(ligId, codigo);
        return { rows: [{ codigo }] };
      }
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
  const rnt = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rnt] = { id: rnt, filename: rnt, loaded: true, exports: { enviarWhatsApp: async () => {}, enviarEmail: async () => {} } };

  const rotas = {};
  const router = { get: () => {}, post: (rota, ...fns) => { rotas[rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, cupomInserts };
}

function resRedirect() {
  const r = { _redirect: null };
  r.redirect = (url) => { r._redirect = url; return r; };
  return r;
}

const ligantes = [
  { id: 1, nome: 'Zero atrasos', email: 'zero@x.com', whatsapp: null, cpf: '11111111111', tipo: 'ligante' },
  { id: 2, nome: 'Um atraso', email: 'um@x.com', whatsapp: null, cpf: '22222222222', tipo: 'ligante' },
  { id: 3, nome: 'Dois atrasos', email: 'dois@x.com', whatsapp: null, cpf: '33333333333', tipo: 'ligante' },
  { id: 4, nome: 'Tres atrasos', email: 'tres@x.com', whatsapp: null, cpf: '44444444444', tipo: 'ligante' }
];

function esperarSegundoPlano() { return new Promise(r => setTimeout(r, 30)); }

test('a rota responde na hora (não fica presa esperando os envios) — era a causa do 504', async () => {
  const { rotas } = montar({ ligantes, atrasosPorCpfOuEmail: {} });
  const req = { params: { id: '1' }, body: { prefixo: 'TESTE', destino: 'ligantes', enviar_wpp: 'off', enviar_email: 'off' }, session: {} };
  const res = resRedirect();
  await rotas['/eventos/:id/cupons/gerar-ligantes'](req, res);
  assert.strictEqual(res._redirect, '/eventos/1?tab=cupons', 'responde e redireciona antes de mandar qualquer WhatsApp/e-mail');
  assert.ok(req.session.msg[0].includes('segundo plano'), 'avisa que o envio continua em segundo plano');
  await esperarSegundoPlano();
});

test('0 ou 1 mensalidade atrasada recebe cupom; 2+ não recebe', async () => {
  const { rotas, cupomInserts } = montar({
    ligantes,
    atrasosPorCpfOuEmail: { '11111111111': 0, '22222222222': 1, '33333333333': 2, '44444444444': 3 }
  });
  const req = { params: { id: '1' }, body: { prefixo: 'TESTE', destino: 'ligantes', enviar_wpp: 'off', enviar_email: 'off' }, session: {} };
  const res = resRedirect();
  await rotas['/eventos/:id/cupons/gerar-ligantes'](req, res);
  await esperarSegundoPlano();

  const idsComCupom = cupomInserts.map(p => p[2]); // [eventoId, codigo, ligante_id]
  assert.deepStrictEqual(idsComCupom.sort(), [1, 2], 'só quem tem 0 ou 1 atraso pode receber cupom');
});

test('quem já tem cupom pro evento não ganha um segundo — reaproveita o código existente', async () => {
  const { rotas, cupomInserts } = montar({
    ligantes: [ligantes[0]],
    atrasosPorCpfOuEmail: { '11111111111': 0 },
    jaExistentes: [{ ligante_id: 1, codigo: 'TESTE-JAEXISTE' }]
  });
  const req = { params: { id: '1' }, body: { prefixo: 'TESTE', destino: 'ligantes', enviar_wpp: 'off', enviar_email: 'off' }, session: {} };
  await rotas['/eventos/:id/cupons/gerar-ligantes'](req, resRedirect());
  await esperarSegundoPlano();
  assert.strictEqual(cupomInserts.length, 0, 'não insere linha nova pra quem já tinha cupom nesse evento');
});
