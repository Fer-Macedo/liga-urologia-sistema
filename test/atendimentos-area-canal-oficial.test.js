// Achado em produção (2026-08-01): toda vez que a Secretaria/área respondia um atendimento
// pelo painel, o sistema também mandava uma CÓPIA da mensagem para o numero_area — e essa
// cópia saía pelo MESMO canal do assistente (W-API quando ASSISTENTE_CANAL=wapi). Mandar
// mensagem que PARTE da liga por automação não-oficial é exatamente o padrão que restringiu
// o número em 2026-07-22 e o baniu em 2026-07-25 (ver lauro.js/notificarArea, já corrigido
// pra esse outro caso). Este arquivo cobre o caminho que ainda faltava: a cópia pro
// numero_area agora tem que sair SEMPRE pela API Oficial, nunca pelo canal do assistente.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/atendimentos.js');

function montar({ numeroArea = '595994111222', origem = 'wapi' } = {}) {
  const oficialChamadas = [];
  const laurodiretas = [];

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT numero_membro, area, idioma, numero_area, origem FROM lauro_atendimentos/.test(sql)) {
        return { rows: [{ numero_membro: '595991234567', area: 'secretaria', idioma: 'es', numero_area: numeroArea, origem }] };
      }
      if (/SELECT numero_membro, area, numero_area FROM lauro_atendimentos/.test(sql)) {
        return { rows: [{ numero_membro: '595991234567', area: 'secretaria', numero_area: numeroArea }] };
      }
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: {
    requireAuth: (q, s, n) => n(), requirePermissao: () => (q, s, n) => n()
  }};
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };

  const rl = require.resolve(path.join(RAIZ, 'src/services/lauro.js'));
  require.cache[rl] = { id: rl, filename: rl, loaded: true, exports: {
    enviarMensagemDireta: async (numero, msg) => { laurodiretas.push({ tipo: 'texto', numero, msg }); },
    enviarImagem: async (numero, img, legenda) => { laurodiretas.push({ tipo: 'imagem', numero }); },
    enviarDocumento: async (numero, doc, nome) => { laurodiretas.push({ tipo: 'documento', numero }); }
  }};
  const rwo = require.resolve(path.join(RAIZ, 'src/services/whatsapp-oficial.js'));
  require.cache[rwo] = { id: rwo, filename: rwo, loaded: true, exports: {
    enviarTexto: async (numero, msg) => { oficialChamadas.push({ tipo: 'texto', numero, msg }); return { ok: true }; },
    enviarImagem: async (numero, img, legenda) => { oficialChamadas.push({ tipo: 'imagem', numero }); return { ok: true }; },
    enviarDocumento: async (numero, doc, nome) => { oficialChamadas.push({ tipo: 'documento', numero }); return { ok: true }; }
  }};
  // O handler de upload é SÍNCRONO por fora — o trabalho de verdade roda dentro do
  // callback do multer, sem ninguém aguardar. O stub captura a promise que o callback
  // devolve, pro teste conseguir esperar o envio terminar.
  const pendentes = {};
  const rar = require.resolve(path.join(RAIZ, 'src/services/arquivos.js'));
  require.cache[rar] = { id: rar, filename: rar, loaded: true, exports: {
    upload: { single: () => (req, res, cb) => { req.file = req.__fakeFile; pendentes.p = cb(); } },
    uploadArquivo: async () => ({ chave: 'k1' })
  }};

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET ' + rota] = fns[fns.length - 1]; }, post: (rota, ...fns) => { rotas['POST ' + rota] = fns[fns.length - 1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);

  return { rotas, oficialChamadas, laurodiretas, pendentes };
}

test('responder atendimento com numero_area: cópia da área sai pela API Oficial, não pelo canal do assistente', async () => {
  const { rotas, oficialChamadas, laurodiretas } = montar({ numeroArea: '595994111222' });
  const req = { params: { id: '1' }, body: { mensagem: 'Olá, como posso ajudar?' }, session: { usuario: { id: 1, perfil: 'secretaria' } } };
  let corpo = null;
  const res = { json: (d) => { corpo = d; } };
  await rotas['POST /atendimentos/:id/responder'](req, res);

  assert.strictEqual(corpo.ok, true);
  assert.strictEqual(laurodiretas.length, 1, 'só o membro deve sair pelo canal do assistente');
  assert.strictEqual(laurodiretas[0].numero, '595991234567');
  assert.strictEqual(oficialChamadas.length, 1, 'a cópia da área tem que sair, só que pela Oficial');
  assert.strictEqual(oficialChamadas[0].numero, '595994111222');
  assert.strictEqual(oficialChamadas[0].tipo, 'texto');
});

test('responder atendimento sem numero_area: não tenta mandar cópia nenhuma', async () => {
  const { rotas, oficialChamadas, laurodiretas } = montar({ numeroArea: null });
  const req = { params: { id: '1' }, body: { mensagem: 'Tudo certo!' }, session: { usuario: { id: 1, perfil: 'secretaria' } } };
  const res = { json: () => {} };
  await rotas['POST /atendimentos/:id/responder'](req, res);

  assert.strictEqual(laurodiretas.length, 1);
  assert.strictEqual(oficialChamadas.length, 0, 'sem numero_area cadastrado, não há cópia a enviar');
});

test('responder com arquivo (imagem) e numero_area: cópia da área também sai pela Oficial', async () => {
  const { rotas, oficialChamadas, laurodiretas, pendentes } = montar({ numeroArea: '595994111222' });
  const req = {
    params: { id: '1' }, session: { usuario: { id: 1, perfil: 'secretaria' } },
    __fakeFile: { buffer: Buffer.from('fakeimg'), originalname: 'foto.jpg', mimetype: 'image/jpeg' }
  };
  let corpo = null;
  const res = { json: (d) => { corpo = d; } };
  rotas['POST /atendimentos/:id/responder-arquivo'](req, res);
  await pendentes.p;

  assert.strictEqual(corpo.ok, true);
  assert.strictEqual(laurodiretas.filter(c => c.tipo === 'imagem').length, 1);
  assert.strictEqual(oficialChamadas.filter(c => c.tipo === 'imagem' && c.numero === '595994111222').length, 1,
    'a imagem enviada à área tem que ir pela Oficial, nunca pelo W-API');
});
