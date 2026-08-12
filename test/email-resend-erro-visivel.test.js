// 11/08/2026: o Resend não lança exceção quando a API recusa o envio (domínio não
// verificado, quota, etc.) — só devolve { data: null, error: {...} }. enviarEmail()
// devolvia isso direto pro chamador sem checar, então todo try/catch existente (eventos,
// contratos, cartas de cobrança/notificação) "via sucesso" mesmo sem nenhum e-mail sair.
// Ficou assim por 3 dias sem ninguém perceber — ninguém recebeu confirmação de inscrição.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/email.js');

function montar(respostaResend) {
  const rr = require.resolve('resend');
  require.cache[rr] = { id: rr, filename: rr, loaded: true, exports: {
    Resend: class { constructor() {} emails = { send: async () => respostaResend }; }
  }};
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };
  delete require.cache[require.resolve(MODULO)];
  return require(MODULO);
}

test('erro do Resend (domínio não verificado) agora lança exceção, não passa por sucesso', async () => {
  const { enviarEmail } = montar({ data: null, error: { message: 'The lauroucpcde.com domain is not verified.' } });
  await assert.rejects(
    () => enviarEmail({ to: 'teste@example.com', subject: 'x', html: '<p>x</p>' }),
    /domain is not verified/
  );
});

test('envio de verdade (sem error) continua funcionando normalmente', async () => {
  const { enviarEmail } = montar({ data: { id: 'abc123' }, error: null });
  const r = await enviarEmail({ to: 'teste@example.com', subject: 'x', html: '<p>x</p>' });
  assert.strictEqual(r.data.id, 'abc123');
});
