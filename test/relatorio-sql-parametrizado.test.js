// Os relatórios de ligantes e diretivos filtravam concatenando o valor na string SQL com
// escape manual de aspas (`'${v.replace(/'/g,"''")}'`). O risco é baixo porque os valores
// vêm de dropdowns fixos, mas escape manual é a forma errada — um caractere esquecido e
// vira injeção. Estes testes prendem: o valor do filtro NÃO entra na string, vai como
// parâmetro; a coluna e o ORDER BY (que não podem ser parâmetro) só saem de listas fixas.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

function montarRota(arquivo, rotaAlvo) {
  const capturado = { sql: null, params: null };
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT \* FROM (ligantes|diretivos)/.test(sql)) { capturado.sql = sql; capturado.params = params; }
      return { rows: [] };
    }
  }};
  const rc = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rc] = { id: rc, filename: rc, loaded: true, exports: { getConfig: async () => ({}) } };

  const mid = (req, res, next) => next();
  const requireX = () => mid;
  let handler = null;
  const router = {
    get: (rota, ...fns) => { if (rota === rotaAlvo) handler = fns[fns.length - 1]; },
    post: () => {}, use: () => {}
  };
  // as rotas chamam requireAuth/requirePermissao — stubados no require do módulo de auth
  const ra = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[ra] = { id: ra, filename: ra, loaded: true, exports: {
    requireAuth: mid, requirePermissao: requireX, requireMembro: mid, requireAdmin: mid
  }};

  delete require.cache[require.resolve(path.join(RAIZ, arquivo))];
  require(path.join(RAIZ, arquivo))(router);

  const chamar = async (query) => {
    await handler(
      { query, session: {} },
      { render: () => {}, redirect: () => {} }
    );
    return capturado;
  };
  return { chamar };
}

test('ligantes: o valor do filtro vai como parâmetro, não na string SQL', async () => {
  const { chamar } = montarRota('src/routes/ligantes.js', '/ligantes/relatorio');
  const c = await chamar({ sexo: 'M', semestre: "6'; DROP TABLE ligantes;--" });
  assert.ok(c.sql, 'a query do relatório deveria rodar');
  assert.doesNotMatch(c.sql, /DROP TABLE/, 'nada do usuário pode aparecer na string SQL');
  assert.doesNotMatch(c.sql, /'M'/, 'o valor não pode estar interpolado');
  assert.match(c.sql, /sexo = \$\d/, 'o filtro precisa usar placeholder');
  assert.ok(c.params.includes('M'), 'o valor precisa ir pelo array de parâmetros');
  assert.ok(c.params.some(p => /DROP TABLE/.test(String(p))), 'o payload malicioso fica inerte como parâmetro');
});

test('ligantes: ORDER BY inválido cai no padrão, nunca interpola', async () => {
  const { chamar } = montarRota('src/routes/ligantes.js', '/ligantes/relatorio');
  const c = await chamar({ ordem: 'nome; DELETE FROM ligantes' });
  assert.match(c.sql, /ORDER BY nome ASC$/, 'ordem fora do whitelist volta ao padrão');
  assert.doesNotMatch(c.sql, /DELETE/);
});

test('diretivos: o valor do filtro vai como parâmetro', async () => {
  const { chamar } = montarRota('src/routes/diretivos.js', '/diretivos/relatorio');
  const c = await chamar({ cargo: "Presidente'--" });
  assert.ok(c.sql);
  assert.doesNotMatch(c.sql, /Presidente/, 'valor não interpolado');
  assert.match(c.sql, /cargo = \$\d/);
  assert.ok(c.params.includes("Presidente'--"));
});

test('sem filtros: nenhum parâmetro, sem WHERE quebrado', async () => {
  const { chamar } = montarRota('src/routes/ligantes.js', '/ligantes/relatorio');
  const c = await chamar({});
  assert.doesNotMatch(c.sql, /WHERE/, 'sem filtro não deve haver WHERE');
  assert.deepStrictEqual(c.params, []);
});
