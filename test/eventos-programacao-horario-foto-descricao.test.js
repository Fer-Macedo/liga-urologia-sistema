// 13/08/2026: 3 correções na Programação do evento —
// 1) horário era um texto livre (aceitava qualquer coisa); agora são dois campos <input
//    type="time"> (início/fim), o próprio navegador só aceita números de hora válidos, e o
//    servidor monta a string "HH:MM - HH:MM" como sempre foi exibida;
// 2) descrição era um <input> de uma linha; agora é um editor rico (Quill), igual à bio de
//    palestrante, permitindo negrito/fonte/tamanho;
// 3) não existia campo de foto pro item de programação; agora tem, seguindo o mesmo padrão
//    de upload+foto_chave já usado em evento_palestrantes.
// Tudo isso já aparecia na página pública (evento-inscricao-publica.ejs) — só faltava a foto
// e a descrição precisava virar HTML não-escapado pra respeitar a formatação do Quill.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const ejs = require('ejs');
const fs = require('fs');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar() {
  const inserts = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT COUNT\(\*\) FROM evento_programacao/.test(sql)) return { rows: [{ count: '0' }] };
      if (/INSERT INTO evento_programacao/.test(sql)) { inserts.push(params); return { rows: [] }; }
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rar = require.resolve(path.join(RAIZ, 'src/services/arquivos.js'));
  require.cache[rar] = { id: rar, filename: rar, loaded: true, exports: {
    upload: { single: () => (q,s,n)=>n() },
    uploadArquivo: async () => ({ chave: 'programacao/foto-teste.jpg' })
  }};
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };
  const re = require.resolve(path.join(RAIZ, 'src/services/email.js'));
  require.cache[re] = { id: re, filename: re, loaded: true, exports: { enviarEmail: async () => {}, emailBonito: () => '' } };
  const rev = require.resolve(path.join(RAIZ, 'src/services/eventos-email.js'));
  require.cache[rev] = { id: rev, filename: rev, loaded: true, exports: { enviarEmailConfirmacaoEvento: async () => {}, TEXTO_CONFIRMACAO_PADRAO: 'x' } };
  const rpg = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  require.cache[rpg] = { id: rpg, filename: rpg, loaded: true, exports: { criarPixEvento: async () => ({}), consultarPagamento: async () => ({}), obterChavePublica: async () => ({}), pagarComCartao: async () => ({}) } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, inserts };
}

// A rota chama upload.single(...)(req,res,cb) sem "await" (é o padrão multer real: o callback
// roda quando o parse do multipart termina, de forma assíncrona e independente do retorno da
// própria rota) — então o teste precisa esperar o res.redirect() de fato acontecer, não só o
// retorno da chamada da rota.
function resRedirectAsync() {
  let resolve;
  const done = new Promise(r => { resolve = r; });
  const r = { done };
  r.redirect = (url) => { r._redirect = url; resolve(); return r; };
  return r;
}

test('POST programação: combina horario_inicio/horario_fim numa string única "HH:MM - HH:MM"', async () => {
  const { rotas, inserts } = montar();
  const req = { params: { id: '5' }, body: { horario_inicio: '08:00', horario_fim: '09:30', titulo: 'Abertura', descricao: '<p><strong>importante</strong></p>', local: 'Auditório' }, session: {} };
  const res = resRedirectAsync();
  rotas['POST /eventos/:id/programacao'](req, res);
  await res.done;
  assert.strictEqual(inserts.length, 1);
  const [, horario, titulo, descricao, local, fotoChave] = inserts[0];
  assert.strictEqual(horario, '08:00 - 09:30');
  assert.strictEqual(titulo, 'Abertura');
  assert.strictEqual(descricao, '<p><strong>importante</strong></p>', 'descrição rica (HTML do Quill) deve ser salva como veio');
  assert.strictEqual(local, 'Auditório');
  assert.strictEqual(fotoChave, null, 'sem arquivo enviado, foto_chave fica nulo');
});

test('POST programação: com foto enviada, grava foto_chave', async () => {
  const { rotas, inserts } = montar();
  const req = { params: { id: '5' }, file: { buffer: Buffer.from('x'), originalname: 'a.jpg', mimetype: 'image/jpeg' }, body: { horario_inicio: '10:00', horario_fim: '11:00', titulo: 'Palestra', descricao: '', local: '' }, session: {} };
  const res = resRedirectAsync();
  rotas['POST /eventos/:id/programacao'](req, res);
  await res.done;
  const [, , , , , fotoChave] = inserts[0];
  assert.strictEqual(fotoChave, 'programacao/foto-teste.jpg');
});

test('GET foto da programação: sem foto_chave, 404', async () => {
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: { query: async () => ({ rows: [{ foto_chave: null }] }) } };
  const { rotas } = montar();
  const req = { params: { id: '99' } };
  const res = { status: (c) => ({ send: (b) => { res._status = c; } }) };
  await rotas['GET /eventos/programacao/:id/foto'](req, res);
  assert.strictEqual(res._status, 404);
});

test('página pública: descrição vira HTML não-escapado (respeita negrito/fonte do Quill)', () => {
  const ARQUIVO = path.join(RAIZ, 'views/pages/evento-inscricao-publica.ejs');
  const html = ejs.render(fs.readFileSync(ARQUIVO, 'utf8'), {
    evento: { id: 1, nome: 'Congresso', cor_tema: '#1a3d2b' },
    lotes: [], sucesso: false, qrcode: null, campos: [], codigoInscricao: null,
    config: {}, programacao: [{ id: 1, horario: '08:00 - 09:00', titulo: 'Abertura', local: '', descricao: '<strong>Traga documento</strong>', foto_chave: 'x' }],
    palestrantes: [], patrocinadores: [], pixData: null, cupomUrl: null, erro: null, encerrado: false
  }, { filename: ARQUIVO });
  assert.match(html, /<strong>Traga documento<\/strong>/, 'HTML do Quill deve renderizar formatado, não escapado');
  assert.match(html, /\/eventos\/programacao\/1\/foto/, 'foto do item de programação deve aparecer na página pública');
});
