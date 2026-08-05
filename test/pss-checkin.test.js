// Check-in de presença do PSS (aula magna, prova, entrevista): QR gerado sob demanda no
// e-mail de confirmação (services/pss.js:_garantirQrcodePss), staff registra presença por
// ocasião via ps_checkins (UNIQUE candidato_id+ocasiao, idempotente).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/pss.js');

function montar({ candidato, checkinsExistentes = [] } = {}) {
  const queries = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/SELECT c\.\*, p\.nome AS processo_nome, p\.data_prova, p\.local_prova FROM ps_candidatos/.test(sql)) {
        return { rows: [candidato] };
      }
      if (/SELECT c\.id, c\.nome, c\.numero_lista, c\.qrcode/.test(sql)) {
        if (!candidato) return { rows: [] };
        return { rows: [{ id: candidato.id, nome: candidato.nome, numero_lista: candidato.numero_lista, qrcode: candidato.qrcode, ocasioes_feitas: checkinsExistentes }] };
      }
      if (/INSERT INTO ps_checkins/.test(sql)) return { rows: [] };
      if (/UPDATE ps_candidatos SET qrcode/.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  }};
  const rn = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rn] = { id: rn, filename: rn, loaded: true, exports: {
    enviarEmail: async () => ({ ok: true })
  }};
  const rf = require.resolve(path.join(RAIZ, 'src/services/fluxo-pss.js'));
  require.cache[rf] = { id: rf, filename: rf, loaded: true, exports: {
    lancarPssNoFluxo: async () => {}
  }};

  delete require.cache[require.resolve(MODULO)];
  return { mod: require(MODULO), queries };
}

const candidatoBase = {
  id: 10, nome: 'Josias Gomes Ferreira', email: 'josiaspuc@gmail.com',
  processo_id: 4, processo_nome: 'Proceso Selectivo 2026.2',
  numero_lista: 1, pagamento_status: 'confirmado', data_prova: null, local_prova: null, qrcode: null
};

test('enviarEmailConfirmacaoPss: gera qrcode e embute a imagem no e-mail quando ainda não existe', async () => {
  const { mod, queries } = montar({ candidato: candidatoBase });
  await mod.enviarEmailConfirmacaoPss(10);
  const gerouQrcode = queries.some(q => /UPDATE ps_candidatos SET qrcode/.test(q.sql));
  assert.ok(gerouQrcode, 'candidato sem qrcode precisa ganhar um na primeira confirmação');
});

test('marcarPresencaPss: rejeita ocasião fora da lista permitida', async () => {
  const { mod } = montar({ candidato: candidatoBase });
  await assert.rejects(() => mod.marcarPresencaPss(10, 'churrasco', 1), /Ocasião inválida/);
});

test('marcarPresencaPss: insere check-in idempotente (ON CONFLICT DO NOTHING) para candidato+ocasião', async () => {
  const { mod, queries } = montar({ candidato: candidatoBase });
  await mod.marcarPresencaPss(10, 'aula_magna', 7);
  const ins = queries.find(q => /INSERT INTO ps_checkins/.test(q.sql));
  assert.ok(ins, 'precisa ter tentado inserir o check-in');
  assert.match(ins.sql, /ON CONFLICT \(candidato_id, ocasiao\) DO NOTHING/);
  assert.deepStrictEqual(ins.params, [10, 'aula_magna', 7]);
});

test('buscarCandidatoCheckin: encontra candidato confirmado e retorna as ocasiões já feitas', async () => {
  const { mod } = montar({ candidato: candidatoBase, checkinsExistentes: ['aula_magna'] });
  const c = await mod.buscarCandidatoCheckin(4, 'Josias');
  assert.ok(c);
  assert.strictEqual(c.nome, 'Josias Gomes Ferreira');
  assert.deepStrictEqual(c.ocasioes_feitas, ['aula_magna']);
});

test('buscarCandidatoCheckin: candidato inexistente retorna null (não quebra a rota)', async () => {
  const { mod } = montar({ candidato: null });
  const c = await mod.buscarCandidatoCheckin(4, 'ninguem');
  assert.strictEqual(c, null);
});
