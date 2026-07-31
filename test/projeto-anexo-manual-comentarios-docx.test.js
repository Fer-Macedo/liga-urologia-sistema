// Achado em produção (2026-07-30): o projeto "II Jornada de Salud del Hombre" tinha um
// pedido_correccion anexado à MÃO (a Secretaria baixou o e-mail da Coordinación e subiu o
// .docx pelo /devolver-correccion) — os comentários do Word (as caixinhas) nunca apareciam
// na tela porque a extração só rodava no Caminho B (detecção automática por e-mail). Este
// teste cobre o Caminho A (upload manual), tanto pelo /devolver-correccion quanto pelo
// /anexar genérico, para não regredir de novo.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/projeto-fluxo.js');

function montarComTimers(fn) {
  const _setTimeout = global.setTimeout, _setInterval = global.setInterval;
  const timers = [];
  global.setTimeout = (...a) => { const h = _setTimeout(...a); timers.push(h); return h; };
  global.setInterval = (...a) => { const h = _setInterval(...a); timers.push(h); return h; };
  try { return fn(); }
  finally { global.setTimeout = _setTimeout; global.setInterval = _setInterval; timers.forEach(h => { clearTimeout(h); clearInterval(h); }); }
}

async function gerarDocxComComentario() {
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('word/document.xml',
    '<w:document><w:body><w:p><w:r><w:t>Antes </w:t></w:r>' +
    '<w:commentRangeStart w:id="1"/><w:r><w:t>metodología incompleta</w:t></w:r><w:commentRangeEnd w:id="1"/>' +
    '<w:r><w:commentReference w:id="1"/></w:r></w:p></w:body></w:document>');
  zip.file('word/comments.xml',
    '<w:comments><w:comment w:id="1" w:author="Coordinación de Ligas">' +
    '<w:p><w:r><w:t>Detallar más este punto</w:t></w:r></w:p></w:comment></w:comments>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

function montarRotasManuais() {
  const inserts = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT \* FROM projetos_academicos WHERE id=\$1/.test(sql)) return { rows: [{ id: 2, etapa_atual: 'enviado_coordinacion', tipo: 'ensino', nome: 'II Jornada de Salud del Hombre' }] };
      if (/INSERT INTO projetos_anexos/.test(sql)) { inserts.push(params); return { rows: [] }; }
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q, s, n) => n() } };

  // O handler é SÍNCRONO por fora — o trabalho de verdade roda dentro do callback do
  // multer (upload.single), sem ninguém aguardar. O stub captura a promise que o
  // callback devolve, pro teste conseguir esperar o INSERT terminar.
  let arquivoParaUpload = null;
  let pendente = null;
  const rar = require.resolve(path.join(RAIZ, 'src/services/arquivos.js'));
  require.cache[rar] = { id: rar, filename: rar, loaded: true, exports: {
    upload: { single: () => (req, res, cb) => { req.file = arquivoParaUpload; pendente = cb(); } },
    uploadArquivo: async () => ({ chave: 'k1' })
  }};

  const rotas = {};
  const router = { get: () => {}, use: () => {}, post: (rota, ...fns) => { rotas[rota] = fns[fns.length - 1]; } };
  delete require.cache[require.resolve(MODULO)];
  montarComTimers(() => require(MODULO)(router));

  return {
    inserts,
    setArquivo: (a) => { arquivoParaUpload = a; },
    chamarDevolverCorrecion: async () => {
      const req = { params: { id: '2' }, body: { observacao: null }, session: { usuario: { id: 1, perfil: 'secretaria' }, msg: null, erro: null } };
      const res = { redirect: () => {} };
      rotas['/projetos/:id/devolver-correccion'](req, res);
      await pendente;
    },
    chamarAnexar: async () => {
      const req = { params: { id: '2' }, body: { tipo_anexo: 'pedido_correccion' }, session: { usuario: { id: 1, perfil: 'secretaria' }, msg: null, erro: null } };
      const res = { redirect: () => {} };
      rotas['/projetos/:id/anexar'](req, res);
      await pendente;
    }
  };
}

test('devolver-correccion (upload manual): .docx com comentário do Word já salva a coluna comentarios', async () => {
  const buffer = await gerarDocxComComentario();
  const { setArquivo, chamarDevolverCorrecion, inserts } = montarRotasManuais();
  setArquivo({ buffer, originalname: 'correcciones.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  await chamarDevolverCorrecion();
  assert.strictEqual(inserts.length, 1);
  const comentarios = JSON.parse(inserts[0][7]);
  assert.strictEqual(comentarios.length, 1);
  assert.strictEqual(comentarios[0].texto, 'Detallar más este punto');
  assert.strictEqual(comentarios[0].trecho, 'metodología incompleta');
});

test('anexar genérico (pedido_correccion manual): .docx com comentário também extrai', async () => {
  const buffer = await gerarDocxComComentario();
  const { setArquivo, chamarAnexar, inserts } = montarRotasManuais();
  setArquivo({ buffer, originalname: 'correcciones.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  await chamarAnexar();
  assert.strictEqual(inserts.length, 1);
  const comentarios = JSON.parse(inserts[0][7]);
  assert.strictEqual(comentarios.length, 1);
  assert.strictEqual(comentarios[0].autor, 'Coordinación de Ligas');
});

test('devolver-correccion: PDF (sem comentários de Word possíveis) fica com comentarios null', async () => {
  const { setArquivo, chamarDevolverCorrecion, inserts } = montarRotasManuais();
  setArquivo({ buffer: Buffer.from('%PDF-1.4 fake'), originalname: 'observaciones.pdf', mimetype: 'application/pdf' });
  await chamarDevolverCorrecion();
  assert.strictEqual(inserts[0][7], null);
});
