// Achado em produção (2026-08-02): baixar um anexo de projeto vinha com um nome de arquivo
// gerado pelo sistema (a chave do R2, tipo "1785585919973-f5a9005e087de8d2.docx") em vez do
// nome exigido pela Coordinación (LAURO_Proyecto de <Ensino|Extensão>_<projeto>.docx), que já
// estava salvo certinho em nome_original — a rota só não pedia pro navegador usar esse nome.
// Causa: getUrlAssinada (desligamento.js) não fixa Content-Disposition; gerarUrlDownload
// (arquivos.js) fixa. A rota usava a função errada.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/projeto-fluxo.js');

// projeto-fluxo.js arma setTimeout/setInterval reais ao ser exigido (poller de e-mail) —
// captura e limpa pra nao travar o processo do teste.
function montarComTimers(fn) {
  const _setTimeout = global.setTimeout, _setInterval = global.setInterval;
  const timers = [];
  global.setTimeout = (...a) => { const h = _setTimeout(...a); timers.push(h); return h; };
  global.setInterval = (...a) => { const h = _setInterval(...a); timers.push(h); return h; };
  try { return fn(); }
  finally { global.setTimeout = _setTimeout; global.setInterval = _setInterval; timers.forEach(h => { clearTimeout(h); clearInterval(h); }); }
}

function montar() {
  let nomeUsado = null, chaveUsada = null;
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql) => {
      if (/SELECT \* FROM projetos_anexos WHERE id=\$1 AND projeto_id=\$2/.test(sql)) {
        return { rows: [{ id: 24, arquivo_chave: 'projetos-docs/1785585919973-f5a9005e087de8d2.docx', nome_original: 'LAURO_Proyecto de Ensino_II Jornada de Salud del Hombre.docx' }] };
      }
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q, s, n) => n() } };
  const rar = require.resolve(path.join(RAIZ, 'src/services/arquivos.js'));
  require.cache[rar] = { id: rar, filename: rar, loaded: true, exports: {
    upload: { single: () => (q, s, n) => n() }, uploadArquivo: async () => ({}),
    gerarUrlDownload: async (chave, nome) => { chaveUsada = chave; nomeUsado = nome; return 'https://r2/signed-url-com-nome'; }
  }};

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas[rota] = fns[fns.length - 1]; }, post: () => {} };
  delete require.cache[require.resolve(MODULO)];
  montarComTimers(() => require(MODULO)(router));
  return { rotas, nomeUsado: () => nomeUsado, chaveUsada: () => chaveUsada };
}

test('download do anexo: usa gerarUrlDownload com o nome_original (não o getUrlAssinada sem nome)', async () => {
  const { rotas, nomeUsado, chaveUsada } = montar();
  const req = { params: { id: '2', anexoId: '24' } };
  let redirecionouPara = null;
  const res = { redirect: (url) => { redirecionouPara = url; }, status: () => res, send: () => {} };
  await rotas['/projetos/:id/anexo/:anexoId'](req, res);
  assert.strictEqual(nomeUsado(), 'LAURO_Proyecto de Ensino_II Jornada de Salud del Hombre.docx',
    'tem que forçar o nome exigido pela Coordinación, não deixar o navegador cair pro nome da chave do R2');
  assert.strictEqual(chaveUsada(), 'projetos-docs/1785585919973-f5a9005e087de8d2.docx');
  assert.strictEqual(redirecionouPara, 'https://r2/signed-url-com-nome');
});
