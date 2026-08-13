// 13/08/2026: 4 correções na Programação do evento —
// 1) horário era um texto livre (aceitava qualquer coisa); agora são dois campos <input
//    type="time"> (início/fim), o próprio navegador só aceita números de hora válidos, e o
//    servidor monta a string "HH:MM - HH:MM" como sempre foi exibida;
// 2) descrição era um <input> de uma linha; agora é um editor rico (Quill), igual à bio de
//    palestrante, permitindo negrito/fonte/tamanho;
// 3) não existia campo de foto pro item de programação; agora tem, seguindo o mesmo padrão
//    de upload+foto_chave já usado em evento_palestrantes.
// 4) não dava pra vincular um item da programação a palestrante(s) já cadastrado(s); agora dá
//    (evento_programacao.palestrante_ids, INTEGER[]), e na página pública clicar no nome do
//    palestrante dentro da programação abre o modal de biografia dele (togPales).
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
  const updates = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT COUNT\(\*\) FROM evento_programacao/.test(sql)) return { rows: [{ count: '0' }] };
      if (/INSERT INTO evento_programacao/.test(sql)) { inserts.push(params); return { rows: [] }; }
      if (/UPDATE evento_programacao/.test(sql)) { updates.push({ sql, params }); return { rows: [] }; }
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
  return { rotas, inserts, updates };
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

test('POST programação: combina horario_inicio/horario_fim numa string única "HH:MM - HH:MM", e grava a data', async () => {
  const { rotas, inserts } = montar();
  const req = { params: { id: '5' }, body: { data: '2026-08-17', horario_inicio: '08:00', horario_fim: '09:30', titulo: 'Abertura', descricao: '<p><strong>importante</strong></p>', local: 'Auditório' }, session: {} };
  const res = resRedirectAsync();
  rotas['POST /eventos/:id/programacao'](req, res);
  await res.done;
  assert.strictEqual(inserts.length, 1);
  const [, data, horario, titulo, descricao, local, fotoChave] = inserts[0];
  assert.strictEqual(data, '2026-08-17', 'sem data não dava pra saber qual dia é cada item, num evento de vários dias');
  assert.strictEqual(horario, '08:00 - 09:30');
  assert.strictEqual(titulo, 'Abertura');
  assert.strictEqual(descricao, '<p><strong>importante</strong></p>', 'descrição rica (HTML do Quill) deve ser salva como veio');
  assert.strictEqual(local, 'Auditório');
  assert.strictEqual(fotoChave, null, 'sem arquivo enviado, foto_chave fica nulo');
});

test('POST programação: com foto enviada, grava foto_chave', async () => {
  const { rotas, inserts } = montar();
  const req = { params: { id: '5' }, file: { buffer: Buffer.from('x'), originalname: 'a.jpg', mimetype: 'image/jpeg' }, body: { data: '2026-08-17', horario_inicio: '10:00', horario_fim: '11:00', titulo: 'Palestra', descricao: '', local: '' }, session: {} };
  const res = resRedirectAsync();
  rotas['POST /eventos/:id/programacao'](req, res);
  await res.done;
  const [, , , , , , fotoChave] = inserts[0];
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
    config: {}, programacao: [{ id: 1, horario: '08:00 - 09:00', titulo: 'Abertura', local: '', descricao: '<strong>Traga documento</strong>', foto_chave: 'x', palestrante_ids: [] }],
    palestrantes: [], patrocinadores: [], pixData: null, cupomUrl: null, erro: null, encerrado: false
  }, { filename: ARQUIVO });
  assert.match(html, /<strong>Traga documento<\/strong>/, 'HTML do Quill deve renderizar formatado, não escapado');
  assert.match(html, /\/eventos\/programacao\/1\/foto/, 'foto do item de programação deve aparecer na página pública');
});

test('POST programação: seleção de palestrantes (checkboxes) vira array de IDs', async () => {
  const { rotas, inserts } = montar();
  const req = { params: { id: '5' }, body: { horario_inicio: '08:00', horario_fim: '09:00', titulo: 'Mesa redonda', descricao: '', local: '', palestrante_ids: ['3', '7'] }, session: {} };
  const res = resRedirectAsync();
  rotas['POST /eventos/:id/programacao'](req, res);
  await res.done;
  const [, , , , , , , palestranteIds] = inserts[0];
  assert.deepStrictEqual(palestranteIds, [3, 7]);
});

test('POST programação: um único palestrante marcado (Express manda string, não array)', async () => {
  const { rotas, inserts } = montar();
  const req = { params: { id: '5' }, body: { horario_inicio: '08:00', horario_fim: '09:00', titulo: 'Palestra solo', descricao: '', local: '', palestrante_ids: '4' }, session: {} };
  const res = resRedirectAsync();
  rotas['POST /eventos/:id/programacao'](req, res);
  await res.done;
  const [, , , , , , , palestranteIds] = inserts[0];
  assert.deepStrictEqual(palestranteIds, [4]);
});

test('POST programação: nenhum palestrante marcado vira array vazio', async () => {
  const { rotas, inserts } = montar();
  const req = { params: { id: '5' }, body: { horario_inicio: '08:00', horario_fim: '09:00', titulo: 'Sem palestrante', descricao: '', local: '' }, session: {} };
  const res = resRedirectAsync();
  rotas['POST /eventos/:id/programacao'](req, res);
  await res.done;
  const [, , , , , , , palestranteIds] = inserts[0];
  assert.deepStrictEqual(palestranteIds, []);
});

test('página pública: clicar no palestrante de um item de programação abre a bio dele (togPales pelo índice certo)', () => {
  const ARQUIVO = path.join(RAIZ, 'views/pages/evento-inscricao-publica.ejs');
  const html = ejs.render(fs.readFileSync(ARQUIVO, 'utf8'), {
    evento: { id: 1, nome: 'Congresso', cor_tema: '#1a3d2b' },
    lotes: [], sucesso: false, qrcode: null, campos: [], codigoInscricao: null,
    config: {},
    programacao: [{ id: 1, horario: '08:00 - 09:00', titulo: 'Mesa redonda', local: '', descricao: '', foto_chave: null, palestrante_ids: [55] }],
    palestrantes: [{ id: 40, nome: 'Dra. Fulana', bio: '' }, { id: 55, nome: 'Dr. Beltrano', bio: '' }],
    patrocinadores: [], pixData: null, cupomUrl: null, erro: null, encerrado: false
  }, { filename: ARQUIVO });
  // Dr. Beltrano é o SEGUNDO da lista (índice 1) — o link deve chamar togPales(1), não togPales(0)
  assert.match(html, /togPales\(1\)[^>]*>Con: Dr\. Beltrano/);
  assert.ok(!html.includes('🎤'), 'sem emoji em lugar nenhum do sistema (regra do projeto)');
  // o nome só pode aparecer DENTRO do painel colapsável (prog-desc), nunca exposto no cabeçalho
  // sempre visível (prog-item-hd) — só deve aparecer quando a pessoa abre o item
  const iHd = html.indexOf('prog-item-hd');
  const iHdFim = html.indexOf('</div>', html.indexOf('prog-titulo', iHd));
  const cabecalho = html.slice(iHd, iHdFim);
  assert.ok(!cabecalho.includes('Beltrano'), 'nome do palestrante não pode estar exposto no cabeçalho sempre visível');
  const iDesc = html.indexOf('prog-desc-inner');
  assert.ok(html.slice(iDesc).includes('Beltrano'), 'nome do palestrante deve estar dentro do painel que só abre ao clicar');
});

test('admin: formulário "Adicionar item" lista um checkbox por palestrante já cadastrado', () => {
  const ARQUIVO = path.join(RAIZ, 'views/pages/evento-detalhe.ejs');
  const evento = { id: 1, nome: 'Congresso', cor_tema: '#1a3d2b', vagas_total: 100, total_inscritos: 0 };
  const html = ejs.render(fs.readFileSync(ARQUIVO, 'utf8'), {
    config: {}, usuario: { nome: 'Teste', perfil: 'admin' }, msg: [], erro: [],
    evento, lotes: [], inscricoes: [], pagamentos: [], certificados: [],
    stats: { total: 0, confirmados: 0, checkins: 0, receita: 0 },
    campos: [], programacao: [], palestrantes: [{ id: 40, nome: 'Dra. Fulana' }, { id: 55, nome: 'Dr. Beltrano' }],
    patrocinadores: [], cupons: [], calcularLiquidoEvento: () => 0, formatarNome: (n) => n
  }, { filename: ARQUIVO });
  assert.match(html, /<input type="checkbox" name="palestrante_ids" value="40"[^>]*>\s*Dra\. Fulana/);
  assert.match(html, /<input type="checkbox" name="palestrante_ids" value="55"[^>]*>\s*Dr\. Beltrano/);
});

test('admin: item de programação já vinculado mostra o nome do palestrante na lista', () => {
  const ARQUIVO = path.join(RAIZ, 'views/pages/evento-detalhe.ejs');
  const evento = { id: 1, nome: 'Congresso', cor_tema: '#1a3d2b', vagas_total: 100, total_inscritos: 0 };
  const html = ejs.render(fs.readFileSync(ARQUIVO, 'utf8'), {
    config: {}, usuario: { nome: 'Teste', perfil: 'admin' }, msg: [], erro: [],
    evento, lotes: [], inscricoes: [], pagamentos: [], certificados: [],
    stats: { total: 0, confirmados: 0, checkins: 0, receita: 0 },
    campos: [],
    programacao: [{ id: 1, horario: '08:00 - 09:00', titulo: 'Mesa redonda', local: '', descricao: '', foto_chave: null, palestrante_ids: [55] }],
    palestrantes: [{ id: 40, nome: 'Dra. Fulana' }, { id: 55, nome: 'Dr. Beltrano' }],
    patrocinadores: [], cupons: [], calcularLiquidoEvento: () => 0, formatarNome: (n) => n
  }, { filename: ARQUIVO });
  const iTab = html.indexOf('id="tab-programacao"');
  const trecho = html.slice(iTab, html.indexOf('Adicionar item'));
  assert.match(trecho, /Com: Dr\. Beltrano/);
  assert.ok(!trecho.includes('🎤'), 'sem emoji em lugar nenhum do sistema (regra do projeto)');
  assert.ok(!trecho.includes('Dra. Fulana'), 'só o palestrante vinculado a ESTE item deve aparecer');
});

test('página pública: programação sem palestrante vinculado não quebra (array vazio)', () => {
  const ARQUIVO = path.join(RAIZ, 'views/pages/evento-inscricao-publica.ejs');
  const html = ejs.render(fs.readFileSync(ARQUIVO, 'utf8'), {
    evento: { id: 1, nome: 'Congresso', cor_tema: '#1a3d2b' },
    lotes: [], sucesso: false, qrcode: null, campos: [], codigoInscricao: null,
    config: {},
    programacao: [{ id: 1, horario: '08:00 - 09:00', titulo: 'Abertura', local: '', descricao: '', foto_chave: null, palestrante_ids: [] }],
    palestrantes: [], patrocinadores: [], pixData: null, cupomUrl: null, erro: null, encerrado: false
  }, { filename: ARQUIVO });
  assert.ok(!html.includes('togPales(NaN)'));
});

// 13/08/2026: só dava pra Excluir um item de programação já salvo, sem jeito de corrigir
// horário/título/descrição/palestrantes depois. Adiciona edição de verdade, no mesmo padrão
// já usado pra editar palestrante (modal + rota POST /editar).
test('POST programação/:pid/editar: atualiza data, horário, título, descrição e palestrantes', async () => {
  const { rotas, updates } = montar();
  const req = { params: { id: '5', pid: '9' }, body: { data: '2026-08-18', horario_inicio: '14:00', horario_fim: '15:30', titulo: 'Novo título', descricao: '<em>editado</em>', local: 'Sala B', palestrante_ids: ['3', '7'] }, session: {} };
  const res = resRedirectAsync();
  rotas['POST /eventos/:id/programacao/:pid/editar'](req, res);
  await res.done;
  assert.strictEqual(updates.length, 1);
  const upd = updates[0];
  assert.match(upd.sql, /UPDATE evento_programacao SET data=\$1,horario=\$2,titulo=\$3,descricao=\$4,local=\$5,palestrante_ids=\$6/);
  assert.strictEqual(upd.params[0], '2026-08-18');
  assert.strictEqual(upd.params[1], '14:00 - 15:30');
  assert.strictEqual(upd.params[2], 'Novo título');
  assert.strictEqual(upd.params[3], '<em>editado</em>');
  assert.strictEqual(upd.params[4], 'Sala B');
  assert.deepStrictEqual(upd.params[5], [3, 7]);
  assert.strictEqual(upd.params[6], '9');
});

test('POST programação/:pid/editar: com nova foto, também atualiza foto_chave', async () => {
  const { rotas, updates } = montar();
  const req = { params: { id: '5', pid: '9' }, file: { buffer: Buffer.from('x'), originalname: 'b.jpg', mimetype: 'image/jpeg' }, body: { data: '2026-08-18', horario_inicio: '08:00', horario_fim: '09:00', titulo: 'T', descricao: '', local: '' }, session: {} };
  const res = resRedirectAsync();
  rotas['POST /eventos/:id/programacao/:pid/editar'](req, res);
  await res.done;
  assert.match(updates[0].sql, /foto_chave=\$6/);
  assert.strictEqual(updates[0].params[5], 'programacao/foto-teste.jpg');
});

test('admin: cada item de programação tem um botão Editar, e prog-data traz os dados pro JS pré-preencher o modal', () => {
  const ARQUIVO = path.join(RAIZ, 'views/pages/evento-detalhe.ejs');
  const evento = { id: 1, nome: 'Congresso', cor_tema: '#1a3d2b', vagas_total: 100, total_inscritos: 0 };
  const html = ejs.render(fs.readFileSync(ARQUIVO, 'utf8'), {
    config: {}, usuario: { nome: 'Teste', perfil: 'admin' }, msg: [], erro: [],
    evento, lotes: [], inscricoes: [], pagamentos: [], certificados: [],
    stats: { total: 0, confirmados: 0, checkins: 0, receita: 0 },
    campos: [],
    // data como Date local (new Date(ano,mes-1,dia)) — é assim que o driver pg entrega uma
    // coluna DATE de volta; usar string ISO aqui mascararia o bug de fuso (parse de string
    // "YYYY-MM-DD" é UTC, parse de Date já construído é local) que motivou essa regra.
    programacao: [{ id: 9, data: new Date(2026, 7, 18), horario: '14:00 - 15:30', titulo: 'Mesa redonda', local: 'Sala B', descricao: '<em>editado</em>', foto_chave: null, palestrante_ids: [55] }],
    palestrantes: [{ id: 55, nome: 'Dr. Beltrano' }],
    patrocinadores: [], cupons: [], calcularLiquidoEvento: () => 0, formatarNome: (n) => n
  }, { filename: ARQUIVO });
  assert.match(html, /onclick="editarProgramacao\(9\)"/);
  // a data formatada (18\/08) precisa aparecer na lista — sem isso, 2 itens no mesmo horário
  // em dias diferentes de um evento de vários dias ficam indistinguíveis
  const iTab = html.indexOf('id="tab-programacao"');
  assert.match(html.slice(iTab, html.indexOf('Adicionar item')), /18\/08 · 14:00 - 15:30/);
  const iData = html.indexOf('id="prog-data"');
  const trecho = html.slice(iData, html.indexOf('</script>', iData));
  const dados = JSON.parse(trecho.slice(trecho.indexOf('>') + 1));
  assert.deepStrictEqual(dados, [{ id: 9, data: '2026-08-18', horario: '14:00 - 15:30', titulo: 'Mesa redonda', local: 'Sala B', descricao: '<em>editado</em>', palestranteIds: [55] }]);
});
