// Duas baixas manuais de cobrança (/pago e /confirmar) tinham cada uma um defeito próprio:
//  - /pago reescrevia data_pagamento=NOW() num duplo-clique, corrompendo a data de uma
//    cobrança JÁ paga — faltava o guard AND status!='pago' que o irmão /confirmar tinha.
//  - /confirmar gravava a mensagem de sucesso em req.session.msg, mas o render lê
//    req.flash('msg') — a mensagem "Pagamento confirmado" sumia no redirect.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/cobrancas.js');

function montar() {
  const updates = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql) => { if (/UPDATE cobrancas SET status='pago'/.test(sql)) updates.push(sql); return { rows: [], rowCount: 1 }; }
  }};
  // dependências do módulo, stubadas para não puxar banco/pagbank de verdade
  for (const [rel, exp] of [
    ['src/middleware/auth.js', { requireAuth: (q,s,n)=>n(), requireAdmin:(q,s,n)=>n(), requireFinanceiro:(q,s,n)=>n(), requirePermissao:()=> (q,s,n)=>n() }],
    ['src/services/config.js', { getConfig: async () => ({}) }],
    ['src/services/pagbank.js', { criarCobranca: async()=>({}), processarWebhook: async()=>({}), consultarPagamento: async()=>({}) }],
    ['src/services/pss.js', { confirmarInscricaoPss: async()=>({}) }],
    ['src/services/fluxo-mensalidade.js', { lancarMensalidadeNoFluxo: async()=>({}) }]
  ]) {
    const r = require.resolve(path.join(RAIZ, rel));
    require.cache[r] = { id: r, filename: r, loaded: true, exports: exp };
  }

  const rotas = {};
  const router = { get: (r,...f)=>{rotas['GET '+r]=f[f.length-1];}, post: (r,...f)=>{rotas['POST '+r]=f[f.length-1];}, use: ()=>{} };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);

  const req = (id) => {
    const flashes = [];
    const r = { params: { id }, body: {}, headers: {}, session: {}, flash: (k,v)=>flashes.push([k,v]) };
    return { r, res: { redirect: ()=>{}, render: ()=>{} }, flashes, updates };
  };
  return { rotas, req };
}

test('/pago tem o guard AND status!=\'pago\' (não reescreve cobrança já paga)', async () => {
  const { rotas, req } = montar();
  const ctx = req('5');
  await rotas['POST /cobrancas/:id/pago'](ctx.r, ctx.res);
  assert.strictEqual(ctx.updates.length, 1);
  assert.match(ctx.updates[0], /AND status!='pago'/, 'sem o guard, duplo-clique corrompe data_pagamento');
});

test('/confirmar também mantém o guard AND status!=\'pago\'', async () => {
  const { rotas, req } = montar();
  const ctx = req('5');
  await rotas['POST /cobrancas/:id/confirmar'](ctx.r, ctx.res);
  assert.match(ctx.updates[0], /AND status!='pago'/);
});

test('/confirmar usa req.flash, não req.session.msg (a mensagem sobrevive ao redirect)', async () => {
  const { rotas, req } = montar();
  const ctx = req('5');
  await rotas['POST /cobrancas/:id/confirmar'](ctx.r, ctx.res);
  const msg = ctx.flashes.find(([k]) => k === 'msg');
  assert.ok(msg, 'a confirmação precisa ir por req.flash');
  assert.match(msg[1], /confirmad/i);
  assert.strictEqual(ctx.r.session.msg, undefined, 'não pode escrever em req.session.msg (o render lê flash)');
});
