// A queda da W-API é silenciosa: instância desconectada simplesmente para de chamar o
// webhook, sem erro nenhum do lado do sistema. Foi assim no primeiro teste do número novo.
// Esta vigia existe para isso — e o que ela NÃO pode fazer é virar e-mail repetido, senão
// a equipe passa a ignorar.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/wapi-vigia.js');

function comCenario({ canal = 'wapi', semAdmin = false } = {}) {
  const emails = [];
  const consultas = [];
  // Simula a tabela configuracoes de verdade: sobrevive a recarregar o módulo (o que o
  // teste de restart abaixo faz de propósito), diferente de uma variável do processo.
  const configStore = {};
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      consultas.push(sql);
      if (/FROM usuarios/.test(sql)) return { rows: semAdmin ? [] : [{ email: 'admin@teste' }] };
      if (/SELECT valor FROM configuracoes WHERE chave='wapi_ultimo_estado_conectado'/.test(sql)) {
        const v = configStore.wapi_ultimo_estado_conectado;
        return { rows: v === undefined ? [] : [{ valor: v }] };
      }
      if (/INSERT INTO configuracoes/.test(sql)) {
        // Cada chave e uma linha propria na tabela de verdade — o mock precisa distinguir
        // por chave tambem, senao uma segunda chave (ex: wapi_reconectado_em) sobrescreve
        // por engano o valor de wapi_ultimo_estado_conectado.
        const chave = (sql.match(/VALUES\s*\('([^']+)'/) || [])[1];
        if (chave) configStore[chave] = params[0];
        return { rows: [] };
      }
      return { rows: [] };
    }
  }};
  const rn = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rn] = { id: rn, filename: rn, loaded: true, exports: {
    enviarEmail: async (o) => { emails.push(o); return { ok: true }; }
  }};

  let resposta = { ok: true, data: { connected: true } };
  const rw = require.resolve(path.join(RAIZ, 'src/services/whatsapp-wapi.js'));
  require.cache[rw] = { id: rw, filename: rw, loaded: true, exports: {
    statusInstancia: async () => resposta
  }};

  process.env.ASSISTENTE_CANAL = canal;
  delete require.cache[require.resolve(MODULO)];
  const mod = require(MODULO);
  return {
    mod, emails, consultas,
    conectado: () => { resposta = { ok: true, data: { connected: true } }; },
    caiu: () => { resposta = { ok: true, data: { connected: false } }; },
    consultaFalhou: () => { resposta = { ok: false, erro: 'timeout' }; }
  };
}

test('conectado o tempo todo → nenhum e-mail', async () => {
  const { mod, emails, conectado } = comCenario();
  conectado();
  await mod.verificar();
  await mod.verificar();
  assert.strictEqual(emails.length, 0);
});

test('ao cair, avisa o admin com o passo a passo de reconectar', async () => {
  const { mod, emails, conectado, caiu } = comCenario();
  conectado();
  await mod.verificar();
  caiu();
  await mod.verificar();
  assert.strictEqual(emails.length, 1);
  assert.match(emails[0].assunto, /desconectado/i);
  assert.match(emails[0].html, /painel\.w-api\.app/, 'precisa dizer onde reconectar');
  assert.match(emails[0].html, /QR Code/, 'precisa dizer como reconectar');
});

// Alerta que chega a cada 5 minutos vira papel de parede e ninguém lê mais.
test('caída por muito tempo → um e-mail só, não um a cada verificação', async () => {
  const { mod, emails, conectado, caiu } = comCenario();
  conectado();
  await mod.verificar();
  caiu();
  for (let i = 0; i < 10; i++) await mod.verificar();
  assert.strictEqual(emails.length, 1);
});

test('cair, voltar e cair de novo → dois avisos', async () => {
  const { mod, emails, conectado, caiu } = comCenario();
  conectado(); await mod.verificar();
  caiu();      await mod.verificar();
  conectado(); await mod.verificar();
  caiu();      await mod.verificar();
  assert.strictEqual(emails.length, 2);
});

// A W-API fora do ar ou rede ruim não é o mesmo que celular desconectado. Tratar como
// queda geraria alarme falso a cada oscilação.
test('falha ao consultar não dispara alerta', async () => {
  const { mod, emails, conectado, consultaFalhou } = comCenario();
  conectado();
  await mod.verificar();
  consultaFalhou();
  await mod.verificar();
  assert.strictEqual(emails.length, 0);
});

test('primeira verificação já desconectado não alerta — sem estado anterior não há queda', async () => {
  const { mod, emails, caiu } = comCenario();
  caiu();
  await mod.verificar();
  assert.strictEqual(emails.length, 0);
});

// A ação é escanear um QR Code: quem não tem o celular e o painel só recebe um susto que
// não pode resolver. O alerta vai só para o admin, de propósito.
test('o alerta vai só para o admin, não para a presidência', async () => {
  const { mod, emails, consultas, conectado, caiu } = comCenario();
  conectado(); await mod.verificar();
  caiu();      await mod.verificar();
  assert.strictEqual(emails[0].para, 'admin@teste');
  const consultaDest = consultas.find(s => /FROM usuarios/.test(s));
  assert.match(consultaDest, /perfil='admin'/);
  assert.doesNotMatch(consultaDest, /presidencia/);
});

// Sem destinatário o alerta some em silêncio — que é o problema que a vigia veio resolver.
test('sem admin cadastrado, registra no log em vez de falhar calado', async () => {
  const { mod, emails, conectado, caiu } = comCenario({ semAdmin: true });
  conectado(); await mod.verificar();
  caiu();
  await assert.doesNotReject(() => mod.verificar());
  assert.strictEqual(emails.length, 0);
});

test('com o atendimento na API oficial, a vigia nem consulta', async () => {
  const { mod, emails, caiu } = comCenario({ canal: 'oficial' });
  caiu();
  const r = await mod.verificar();
  assert.strictEqual(r.checado, false);
  assert.strictEqual(emails.length, 0);
});

// Todo deploy reinicia o processo (git push -> pm2 restart). Antes, "estava conectado"
// vivia numa variável do processo: um restart zerava para null e a checagem seguinte
// nunca disparava "caiu" (a lógica exige ter visto true antes). Se uma queda coincidisse
// com os minutos logo após um deploy, o alerta era perdido em silêncio.
test('reinício do processo NÃO reseta o estado — a queda ainda é detectada', async () => {
  const { mod, emails, conectado, caiu } = comCenario();
  conectado();
  await mod.verificar(); // 1ª leitura real: conectado (grava no "banco" mockado)

  // Simula um restart: descarrega e recarrega o módulo. O mock do banco (configStore)
  // NÃO é recriado — representa o Postgres de verdade, que sobrevive ao restart.
  delete require.cache[require.resolve(MODULO)];
  const mod2 = require(MODULO);

  caiu();
  await mod2.verificar();
  assert.strictEqual(emails.length, 1,
    'em memória, null->false nunca dispara "caiu" — o restart faria a queda passar batida');
});
