// Achado em produção (2026-08-04): a tela de "Datos enviados!" sempre saía em espanhol,
// mesmo quando o palestrante escolhia Brasil (português) e preenchia o endereço todo em
// PT. Causa: a tela de sucesso é montada NO SERVIDOR (enviado=true), então o JS de
// tradução do formulário (que só roda durante o preenchimento) nunca chega a rodar nela —
// o texto ficava fixo no HTML original, em espanhol. Corrigido enviando o idioma
// escolhido num campo oculto e usando-o no render do servidor.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/palestrantes.js');

function montar() {
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql) => {
      if (/SELECT \* FROM palestrantes WHERE token_form/.test(sql)) {
        return { rows: [{ token_form: 'tok1', nome_completo: 'Dr. Gabriel Pereira' }] };
      }
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q, s, n) => n(), requirePermissao: () => (q, s, n) => n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({ org_nome: 'LAURO' }) } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET ' + rota] = fns[fns.length - 1]; }, post: (rota, ...fns) => { rotas['POST ' + rota] = fns[fns.length - 1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas };
}

async function postar(rotas, body) {
  const req = { params: { token: 'tok1' }, body };
  let dados = null;
  const res = { render: (view, d) => { dados = d; } };
  await rotas['POST /palestrante/form/:token'](req, res);
  return dados;
}

test('idioma=pt explícito no campo oculto: tela de sucesso em português', async () => {
  const { rotas } = montar();
  const d = await postar(rotas, { nome_completo: 'Dr. Gabriel Pereira', endereco_pais: 'Brasil', idioma: 'pt' });
  assert.strictEqual(d.idioma, 'pt');
});

test('idioma=es explícito: tela de sucesso em espanhol', async () => {
  const { rotas } = montar();
  const d = await postar(rotas, { nome_completo: 'Dr. Juan García', endereco_pais: 'Paraguay', idioma: 'es' });
  assert.strictEqual(d.idioma, 'es');
});

test('sem o campo idioma (fallback): Brasil vira pt', async () => {
  const { rotas } = montar();
  const d = await postar(rotas, { nome_completo: 'Dr. Gabriel Pereira', endereco_pais: 'Brasil' });
  assert.strictEqual(d.idioma, 'pt', 'sem o campo oculto, tem que inferir pelo país — é exatamente o caso real que gerou o bug');
});

test('sem o campo idioma: Paraguay vira es', async () => {
  const { rotas } = montar();
  const d = await postar(rotas, { nome_completo: 'Dr. Juan García', endereco_pais: 'Paraguay' });
  assert.strictEqual(d.idioma, 'es');
});

test('idioma com valor inválido/lixo: cai no fallback pelo país, não quebra', async () => {
  const { rotas } = montar();
  const d = await postar(rotas, { nome_completo: 'Dr. Gabriel Pereira', endereco_pais: 'Brasil', idioma: 'xx' });
  assert.strictEqual(d.idioma, 'pt');
});
