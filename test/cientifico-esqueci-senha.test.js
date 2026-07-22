// INCIDENTE 2026-07-22: quem pedia "esqueci a senha" no portal científico ficava TRANCADO
// FORA. A rota trocava a senha no banco e SÓ DEPOIS chamava enviarEmail — que nem existia
// nesse arquivo (era importado dentro de outra função). Resultado:
//   1. senha antiga destruída;
//   2. ReferenceError: enviarEmail is not defined;
//   3. rota async sem try/catch -> requisição pendurada (nginx registrava 499);
//   4. e-mail nunca enviado.
// A presidência (Leyriane) ficou sem acesso. Estes testes prendem as três regras do conserto.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/cientifico.js');

function montar({ achaMembro = true, emailFunciona = true, temLinhaSenha = true } = {}) {
  const acoes = [];   // { tipo: 'email'|'update'|'insert' }

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/FROM ligantes WHERE LOWER\(email\)/.test(sql)) {
        return { rows: achaMembro ? [{ id: 9, nome: 'Fulana', email: 'f@teste.com' }] : [] };
      }
      if (/FROM diretivos WHERE LOWER\(email\)/.test(sql)) return { rows: [] };
      if (/UPDATE portal_cientifico_senhas/.test(sql)) {
        acoes.push({ tipo: 'update' });
        return { rows: [], rowCount: temLinhaSenha ? 1 : 0 };
      }
      if (/INSERT INTO portal_cientifico_senhas/.test(sql)) { acoes.push({ tipo: 'insert' }); return { rows: [] }; }
      return { rows: [] };
    }
  }};
  const rn = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rn] = { id: rn, filename: rn, loaded: true, exports: {
    enviarEmail: async (o) => { acoes.push({ tipo: 'email', para: o.para, texto: o.texto }); return { ok: emailFunciona }; },
    htmlSimples: () => ''
  }};
  const rc = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rc] = { id: rc, filename: rc, loaded: true, exports: { getConfig: async () => ({}) } };
  const rl = require.resolve(path.join(RAIZ, 'src/services/rate-limiters.js'));
  require.cache[rl] = { id: rl, filename: rl, loaded: true, exports: {
    limiterLogin: (q, s, n) => n(), limiterEsqueciSenha: (q, s, n) => n()
  }};
  const ra = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[ra] = { id: ra, filename: ra, loaded: true, exports: {
    requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: ()=>(q,s,n)=>n(), requireMembro: (q,s,n)=>n()
  }};

  let handler = null;
  const router = {
    get: () => {}, use: () => {},
    post: (rota, ...fns) => { if (rota === '/portal/esqueci-senha') handler = fns[fns.length - 1]; }
  };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);

  const pedir = async () => {
    let destino = null;
    const req = { body: { email: 'f@teste.com' }, session: {} };
    await handler(req, { redirect: (u) => { destino = u; }, render: () => {} });
    return { destino, acoes, req };
  };
  return { pedir };
}

// A regressão exata: a rota tem que RESPONDER, nunca pendurar.
test('a rota sempre responde (nunca pendura a requisição)', async () => {
  const { pedir } = montar();
  const r = await pedir();
  assert.strictEqual(r.destino, '/portal/esqueci-senha', 'sem resposta o navegador fica girando até desistir (499)');
});

test('o e-mail é enviado ANTES de trocar a senha', async () => {
  const { pedir } = montar();
  const { acoes } = await pedir();
  const iEmail = acoes.findIndex(a => a.tipo === 'email');
  const iUpd = acoes.findIndex(a => a.tipo === 'update');
  assert.ok(iEmail >= 0, 'o e-mail precisa ser enviado');
  assert.ok(iUpd >= 0, 'a senha precisa ser trocada');
  assert.ok(iEmail < iUpd, 'trocar a senha antes de enviar tranca a pessoa fora se o envio falhar');
});

// O coração do incidente: se o e-mail não sai, a senha antiga TEM que continuar valendo.
test('e-mail falhou → a senha NÃO é alterada (ninguém fica trancado fora)', async () => {
  const { pedir } = montar({ emailFunciona: false });
  const { acoes, destino } = await pedir();
  assert.ok(acoes.some(a => a.tipo === 'email'), 'tentou enviar');
  assert.ok(!acoes.some(a => a.tipo === 'update' || a.tipo === 'insert'),
    'sem e-mail entregue, a senha antiga tem que continuar valendo');
  assert.strictEqual(destino, '/portal/esqueci-senha', 'e ainda assim responde');
});

// Quem nunca acessou o portal não tem linha: o UPDATE não acha nada e a senha some.
test('sem linha de senha, cria uma (INSERT) em vez de perder a senha nova', async () => {
  const { pedir } = montar({ temLinhaSenha: false });
  const { acoes } = await pedir();
  assert.ok(acoes.some(a => a.tipo === 'insert'), 'precisa criar a linha quando o UPDATE não acha nada');
});

test('e-mail não cadastrado: não envia nem altera nada, e responde igual', async () => {
  const { pedir } = montar({ achaMembro: false });
  const { acoes, destino } = await pedir();
  assert.strictEqual(acoes.length, 0);
  assert.strictEqual(destino, '/portal/esqueci-senha', 'mesma resposta, para não revelar quem é cadastrado');
});
