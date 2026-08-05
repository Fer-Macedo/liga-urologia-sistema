// Achado em produção (2026-08-05): candidato pagou/usou cupom, inscrição foi confirmada
// (numero_lista atribuído, status='confirmado'), mas NUNCA recebeu o e-mail de confirmação
// — email_confirmacao_enviado ficava false pra sempre. Causa: as 3 funções de e-mail deste
// arquivo (confirmação, lembrete de pendência, boas-vindas ao aprovado) chamavam uma função
// "emailBonito" que nunca existiu nesse módulo (ReferenceError, engolido pelo try/catch) —
// e mesmo corrigindo isso, usavam nomes de parâmetro errados (to/subject/from em vez de
// para/assunto) pro enviarEmail() real. As 3 nunca funcionaram desde que foram escritas.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/pss.js');

function montar({ candidato } = {}) {
  const emailsEnviados = [];
  const queries = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/SELECT c\.\*, p\.nome AS processo_nome, p\.data_prova, p\.local_prova FROM ps_candidatos/.test(sql)) {
        return { rows: [candidato] };
      }
      if (/SELECT c\.\*, p\.nome AS processo_nome FROM ps_candidatos/.test(sql)) {
        return { rows: [candidato] };
      }
      if (/SELECT \* FROM ps_candidatos WHERE id=\$1/.test(sql)) {
        return { rows: [candidato] };
      }
      if (/SELECT id FROM ps_pagamentos/.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  }};
  const rn = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rn] = { id: rn, filename: rn, loaded: true, exports: {
    enviarEmail: async (opts) => { emailsEnviados.push(opts); return { ok: true }; }
  }};
  const rf = require.resolve(path.join(RAIZ, 'src/services/fluxo-pss.js'));
  require.cache[rf] = { id: rf, filename: rf, loaded: true, exports: {
    lancarPssNoFluxo: async () => {}
  }};

  delete require.cache[require.resolve(MODULO)];
  return { mod: require(MODULO), emailsEnviados, queries };
}

const candidatoBase = {
  id: 10, nome: 'Josias Gomes Ferreira', email: 'josiaspuc@gmail.com',
  processo_id: 4, processo_nome: 'Proceso Selectivo 2026.2',
  numero_lista: 1, pagamento_status: 'pendente', data_prova: null, local_prova: null
};

test('enviarEmailConfirmacaoPss: usa os parâmetros reais do enviarEmail (para/assunto), não to/subject/from', async () => {
  const { mod, emailsEnviados } = montar({ candidato: candidatoBase });
  await mod.enviarEmailConfirmacaoPss(10);
  assert.strictEqual(emailsEnviados.length, 1, 'tem que ter tentado enviar — antes o ReferenceError impedia até isso');
  const e = emailsEnviados[0];
  assert.strictEqual(e.para, 'josiaspuc@gmail.com');
  assert.strictEqual(e.to, undefined, 'to não é o parâmetro certo, não pode ser usado');
  assert.match(e.assunto, /Inscripción confirmada/);
  assert.strictEqual(e.subject, undefined);
  assert.ok(e.html && !/emailBonito|<!doctype/i.test(e.html), 'html tem que ser o fragmento puro, sem wrapper manual');
  assert.strictEqual(e.faixaLabel, 'INSCRIPCIÓN CONFIRMADA');
});

test('confirmarInscricaoPss (fluxo isento/cupom): marca email_confirmacao_enviado=true no final', async () => {
  const { mod, queries } = montar({ candidato: candidatoBase });
  await mod.confirmarInscricaoPss(10, {});
  const marcouFlag = queries.some(q => /UPDATE ps_candidatos SET email_confirmacao_enviado=true/.test(q.sql));
  assert.ok(marcouFlag, 'sem o bug, o e-mail é enviado e a flag é marcada — antes ficava sempre false (ReferenceError engolido)');
});

test('enviarLembretePss: mesmos parâmetros corretos', async () => {
  const { mod, emailsEnviados } = montar({ candidato: candidatoBase });
  const ok = await mod.enviarLembretePss(10);
  assert.strictEqual(ok, true);
  assert.strictEqual(emailsEnviados[0].para, 'josiaspuc@gmail.com');
  assert.strictEqual(emailsEnviados[0].faixaLabel, 'INSCRIPCIÓN PENDIENTE');
});

test('enviarEmailBoasVindasPss: mesmos parâmetros corretos', async () => {
  const { mod, emailsEnviados } = montar({ candidato: candidatoBase });
  const ok = await mod.enviarEmailBoasVindasPss(10);
  assert.strictEqual(ok, true);
  assert.strictEqual(emailsEnviados[0].para, 'josiaspuc@gmail.com');
  assert.strictEqual(emailsEnviados[0].faixaLabel, 'BIENVENIDO A LA LAURO');
});
