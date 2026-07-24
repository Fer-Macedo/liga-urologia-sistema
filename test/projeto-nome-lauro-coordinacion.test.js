// NORMA OBRIGATÓRIA da Coordinación de Ligas (2026-07-24, corrigida no mesmo dia): todo
// documento de projeto (ensino/extensão), baixado e/ou enviado a ela, tem que se chamar
// "LAURO_Proyecto de <Ensino|Extensão>_<nome do projeto>" — eles recebem projetos de várias
// ligas ao mesmo tempo e precisam identificar origem, tipo e projeto só pelo nome do arquivo.
//
// A regra tem que valer nos DOIS caminhos que alimentam o e-mail da Coordinación:
//   1. Upload manual (Opção 2: "corrigir fora do sistema") — o nome vem do PRÓPRIO
//      arquivo da pessoa, sem relação nenhuma com o padrão exigido.
//   2. O envio em si (enviar-coordinacion) — rede de segurança que RECONSTRÓI o nome no
//      formato exato, mesmo para documentos antigos já salvos fora do padrão.
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

// ─── UPLOAD MANUAL (/projetos/:id/anexar) ─────────────────────────────────────

function montarAnexar({ tipo = 'documento_final', nomeArquivo = 'Proyecto corregido final.docx', projTipo = 'ensino', projNome = 'Jornada X' } = {}) {
  const inserts = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT \* FROM projetos_academicos WHERE id=\$1/.test(sql)) return { rows: [{ id: 2, etapa_atual: 'rascunho', tipo: projTipo, nome: projNome }] };
      if (/INSERT INTO projetos_anexos/.test(sql)) { inserts.push(params); return { rows: [] }; }
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q, s, n) => n() } };
  // O handler de /anexar e SINCRONO por fora — o trabalho de verdade roda dentro do
  // callback do multer (upload.single), sem ninguem aguardar. Para o teste conseguir
  // esperar o INSERT terminar, o stub captura a promise que o callback devolve.
  let pendente = null;
  const rar = require.resolve(path.join(RAIZ, 'src/services/arquivos.js'));
  require.cache[rar] = { id: rar, filename: rar, loaded: true, exports: {
    upload: { single: () => (req, res, cb) => { req.file = { buffer: Buffer.from('x'), originalname: nomeArquivo, mimetype: 'application/pdf' }; pendente = cb(); } },
    uploadArquivo: async () => ({ chave: 'k1' })
  }};

  let handler = null;
  const router = { get: () => {}, use: () => {}, post: (rota, ...fns) => { if (rota === '/projetos/:id/anexar') handler = fns[fns.length - 1]; } };
  delete require.cache[require.resolve(MODULO)];
  montarComTimers(() => require(MODULO)(router));

  const chamar = async () => {
    const req = { params: { id: '2' }, body: { tipo_anexo: tipo }, session: { usuario: { id: 1, perfil: 'presidencia' }, msg: null } };
    const res = { redirect: () => {} };
    handler(req, res);
    await pendente;
    return inserts[0];
  };
  return { chamar };
}

test('upload manual do documento final (ensino): sai no formato exigido, extensão preservada', async () => {
  const { chamar } = montarAnexar({ tipo: 'documento_final', nomeArquivo: 'Proyecto corregido final.docx', projTipo: 'ensino', projNome: 'Jornada X' });
  const params = await chamar();
  const nomeSalvo = params[3]; // (projeto_id,tipo,arquivo_chave,nome_original,...)
  assert.strictEqual(nomeSalvo, 'LAURO_Proyecto de Ensino_Jornada X.docx',
    'o nome do arquivo da pessoa é descartado — o que vale é o padrão exigido pela Coordinación');
});

test('upload manual do documento final (extensão): usa o rótulo certo', async () => {
  const { chamar } = montarAnexar({ tipo: 'documento_final', nomeArquivo: 'v2.pdf', projTipo: 'extensao', projNome: 'Campanha X' });
  const params = await chamar();
  assert.strictEqual(params[3], 'LAURO_Proyecto de Extensão_Campanha X.pdf');
});

test('upload manual de correção da Presidencia: também segue o padrão', async () => {
  const { chamar } = montarAnexar({ tipo: 'correcao_presidencia', nomeArquivo: 'v2.docx' });
  const params = await chamar();
  assert.strictEqual(params[3], 'LAURO_Proyecto de Ensino_Jornada X.docx');
});

test('pedido_correccion (o que a Coordinación NOS manda): mantém o nome original', async () => {
  const { chamar } = montarAnexar({ tipo: 'pedido_correccion', nomeArquivo: 'observaciones_coordinacion.pdf' });
  const params = await chamar();
  assert.strictEqual(params[3], 'observaciones_coordinacion.pdf',
    'não é algo que devolvemos a eles — renomear aqui não tem por quê');
});

// ─── ENVIO REAL (/projetos/:id/enviar-coordinacion) ───────────────────────────

function montarEnvio({ nomeSalvo = 'Proyecto_antigo_sem_prefixo.docx', projTipo = 'ensino', projNome = 'Jornada X' } = {}) {
  let nomeUsadoNoEmail = null;
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql) => {
      if (/SELECT \* FROM projetos_academicos WHERE id=\$1/.test(sql)) return { rows: [{ id: 2, etapa_atual: 'aguardando_secretaria', tipo: projTipo, nome: projNome }] };
      if (/FROM projetos_anexos WHERE projeto_id=\$1 AND tipo IN/.test(sql)) return { rows: [{ arquivo_chave: 'k1', nome_original: nomeSalvo, mimetype: 'application/pdf' }] };
      if (/FROM projetos_email_thread WHERE projeto_id/.test(sql)) return { rows: [] };
      if (/SELECT chave,valor FROM configuracoes/.test(sql)) return { rows: [{ chave: 'email_coordenacion_ligas', valor: 'coord@ligas.edu.py' }] };
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q, s, n) => n() } };
  const rar = require.resolve(path.join(RAIZ, 'src/services/arquivos.js'));
  require.cache[rar] = { id: rar, filename: rar, loaded: true, exports: { upload: { single: () => (q, s, n) => n() }, uploadArquivo: async () => ({}) } };
  const rgd = require.resolve(path.join(RAIZ, 'src/services/google-drive.js'));
  require.cache[rgd] = { id: rgd, filename: rgd, loaded: true, exports: { getClientAtualizado: async () => ({}) } };
  const rpe = require.resolve(path.join(RAIZ, 'src/services/projeto-email.js'));
  require.cache[rpe] = { id: rpe, filename: rpe, loaded: true, exports: {
    enviarEmailProjeto: async (client, pool, opts) => { nomeUsadoNoEmail = opts.anexos[0].nome; return { threadId: 't1' }; }
  }};
  const rdl = require.resolve(path.join(RAIZ, 'src/services/desligamento.js'));
  require.cache[rdl] = { id: rdl, filename: rdl, loaded: true, exports: { imagemBase64: () => '' } };
  // R2: stub via aws-sdk client mockado no proprio require do modulo (S3Client é
  // instanciado dentro da rota, então basta garantir que o GetObjectCommand devolva um
  // Body iterável vazio).
  const rs3 = require.resolve('@aws-sdk/client-s3');
  const realS3 = require('@aws-sdk/client-s3');
  require.cache[rs3] = { id: rs3, filename: rs3, loaded: true, exports: Object.assign({}, realS3, {
    S3Client: class { async send() { return { Body: (async function* () { yield Buffer.from('x'); })() }; } }
  }) };

  let handler = null;
  const router = { get: () => {}, use: () => {}, post: (rota, ...fns) => { if (rota === '/projetos/:id/enviar-coordinacion') handler = fns[fns.length - 1]; } };
  delete require.cache[require.resolve(MODULO)];
  montarComTimers(() => require(MODULO)(router));

  const chamar = async () => {
    const req = { params: { id: '2' }, session: { usuario: { id: 1, perfil: 'secretaria' } } };
    let corpo = null;
    const res = { json: (d) => { corpo = d; }, status: () => res };
    await handler(req, res);
    return corpo;
  };
  return { chamar, nomeUsadoNoEmail: () => nomeUsadoNoEmail };
}

test('envio à Coordinación: documento antigo fora do padrão é reconstruído no formato exigido', async () => {
  const { chamar, nomeUsadoNoEmail } = montarEnvio({ nomeSalvo: 'Proyecto_antigo_sem_prefixo.docx', projTipo: 'ensino', projNome: 'Jornada X' });
  const r = await chamar();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(nomeUsadoNoEmail(), 'LAURO_Proyecto de Ensino_Jornada X.docx',
    'rede de segurança: mesmo um anexo antigo, gerado antes da norma, tem que sair no formato exato');
});

test('envio à Coordinación: preserva a extensão do arquivo original ao reconstruir o nome', async () => {
  const { chamar, nomeUsadoNoEmail } = montarEnvio({ nomeSalvo: 'qualquer_coisa.pdf', projTipo: 'extensao', projNome: 'Campanha X' });
  await chamar();
  assert.strictEqual(nomeUsadoNoEmail(), 'LAURO_Proyecto de Extensão_Campanha X.pdf');
});
