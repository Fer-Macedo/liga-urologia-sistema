// A Secretaria aprova o envio à Coordinación, mas às vezes a Presidencia precisa corrigir
// o documento DEPOIS de já ter aprovado (etapa 'aguardando_secretaria'). Não existia
// caminho de volta — só "Devolver para corrección", que manda para Enseñanza/Extensión,
// pulando a Presidencia. Esta rota desfaz a própria aprovação da Presidencia.
//
// Só quem aprovou pode desfazer: a Secretaria não tem autoridade para devolver uma decisão
// de quem está acima dela no fluxo.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/projeto-fluxo.js');

function montar({ etapaAtual = 'aguardando_secretaria' } = {}) {
  const updates = [];
  const historico = [];

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT \* FROM projetos_academicos WHERE id=\$1/.test(sql)) {
        return { rows: [{ id: 2, etapa_atual: etapaAtual, tipo: 'ensino' }] };
      }
      if (/UPDATE projetos_academicos SET etapa_atual='aguardando_presidencia'/.test(sql)) {
        updates.push({ sql, params }); return { rows: [] };
      }
      if (/INSERT INTO projetos_historico/.test(sql)) { historico.push(params); return { rows: [] }; }
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q, s, n) => n() } };
  const rar = require.resolve(path.join(RAIZ, 'src/services/arquivos.js'));
  require.cache[rar] = { id: rar, filename: rar, loaded: true, exports: { upload: { single: () => (q, s, n) => n() }, uploadArquivo: async () => ({}) } };

  let handler = null;
  const router = {
    get: () => {}, use: () => {},
    post: (rota, ...fns) => { if (rota === '/projetos/:id/retroceder-presidencia') handler = fns[fns.length - 1]; }
  };
  delete require.cache[require.resolve(MODULO)];
  // Montar o modulo arma um setTimeout/setInterval reais (verificação periódica de
  // e-mail da coordenação). Numa suite real isso roda para sempre — nunca some sozinho e
  // trava o processo do teste. Captura e limpa so os timers criados durante o mount.
  const _setTimeout = global.setTimeout, _setInterval = global.setInterval;
  const timers = [];
  global.setTimeout = (...a) => { const h = _setTimeout(...a); timers.push(h); return h; };
  global.setInterval = (...a) => { const h = _setInterval(...a); timers.push(h); return h; };
  try { require(MODULO)(router); }
  finally {
    global.setTimeout = _setTimeout; global.setInterval = _setInterval;
    timers.forEach(h => { clearTimeout(h); clearInterval(h); });
  }

  const chamar = async (perfil) => {
    let corpo = null, statusCode = 200;
    const req = { params: { id: '2' }, session: { usuario: { id: 1, perfil } } };
    const res = { json: (d) => { corpo = d; }, status: (c) => { statusCode = c; return res; } };
    await handler(req, res);
    return { corpo, statusCode };
  };
  return { chamar, updates, historico };
}

test('admin retrocede o projeto para aguardando_presidencia', async () => {
  const { chamar, updates } = montar();
  const r = await chamar('admin');
  assert.strictEqual(r.corpo.ok, true);
  assert.strictEqual(updates.length, 1);
  assert.ok(updates[0].sql.includes("status='pendente'"), 'volta a status pendente, igual a quem envia pela 1ª vez');
  assert.ok(updates[0].sql.includes('notif_secretaria=false'), 'a secretaria não pode continuar com o sino piscando');
});

test('presidencia também pode retroceder', async () => {
  const { chamar, updates } = montar();
  const r = await chamar('presidencia');
  assert.strictEqual(r.corpo.ok, true);
  assert.strictEqual(updates.length, 1);
});

// A secretaria não pode desfazer uma aprovação que não é dela.
test('secretaria NÃO pode retroceder para presidencia', async () => {
  const { chamar, updates } = montar();
  const r = await chamar('secretaria');
  assert.strictEqual(r.statusCode, 403);
  assert.strictEqual(updates.length, 0);
});

test('perfil de módulo (ensino/extensão) também não pode', async () => {
  const { chamar, updates } = montar();
  const r = await chamar('ensino');
  assert.strictEqual(r.statusCode, 403);
  assert.strictEqual(updates.length, 0);
});

// Trava de estado: só faz sentido retroceder de quem está mesmo em Secretaria.
test('projeto fora de aguardando_secretaria: recusa (evita corromper outra etapa)', async () => {
  const { chamar, updates } = montar({ etapaAtual: 'enviado_coordinacion' });
  const r = await chamar('admin');
  assert.strictEqual(r.statusCode, 400);
  assert.strictEqual(updates.length, 0);
});

test('fica registrado no histórico do projeto', async () => {
  const { chamar, historico } = montar();
  await chamar('admin');
  assert.strictEqual(historico.length, 1);
  assert.match(String(historico[0][3]), /Retrocedido a Presidencia/);
});
