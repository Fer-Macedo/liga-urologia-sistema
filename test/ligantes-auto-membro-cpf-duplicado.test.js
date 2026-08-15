// 15/08/2026: aprovar um ligante cria automaticamente um "membro" (financeiro) se ainda não
// existir um com o mesmo CPF/email. A checagem comparava CPF como string exata — mas
// ligantes guarda CPF sem pontuação ("09822795661") e membros antigos guardavam com pontuação
// ("098.227.956-61"). Mesmo CPF, strings diferentes, a checagem nunca batia: 3 pessoas reais
// (Lucas, Rafael, Hugo) ganharam um segundo cadastro de membro duplicado por causa disso.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/ligantes.js');

function montar({ ligante, membroExistente }) {
  const inserts = [];
  const dedupChamadas = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/UPDATE ligantes SET pendente=false/.test(sql)) return { rows: [] };
      if (/SELECT 1 FROM portal_cientifico_senhas/.test(sql)) return { rows: [{ x: 1 }] }; // já tem senha, pula o INSERT
      if (/SELECT \* FROM ligantes WHERE id=\$1/.test(sql)) return { rows: [ligante] };
      if (/SELECT id FROM membros WHERE/.test(sql)) {
        dedupChamadas.push(params);
        const [cpfNorm, emailNorm] = params;
        const bate = membroExistente && (
          (cpfNorm && membroExistente.cpf && membroExistente.cpf.replace(/\D/g, '') === cpfNorm) ||
          (emailNorm && membroExistente.email && membroExistente.email.trim().toLowerCase() === emailNorm)
        );
        return { rows: bate ? [{ id: membroExistente.id }] : [] };
      }
      if (/INSERT INTO membros/.test(sql)) { inserts.push(params); return { rows: [] }; }
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requireSecretaria: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };
  const rlog = require.resolve(path.join(RAIZ, 'src/services/log-atividade.js'));
  require.cache[rlog] = { id: rlog, filename: rlog, loaded: true, exports: { logAtividade: async () => {} } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, inserts, dedupChamadas };
}

function resRedirect() { const r = {}; r.redirect = (url) => { r._redirect = url; return r; }; return r; }
function req(id) { return { params: { id }, session: { usuario: { id: 1 } } }; }

test('CPF com pontuação no membro existente X CPF sem pontuação no ligante: reconhece como o MESMO CPF, não duplica', async () => {
  const { rotas, inserts } = montar({
    ligante: { id: 42, nome: 'Lucas Dos Santos Pereira', cpf: '09822795661', email: 'lucasdsantos.med@gmail.com' },
    membroExistente: { id: 38, cpf: '098.227.956-61', email: 'outro@email.com' }
  });
  await rotas['GET /ligantes/:id/aprovar'](req('42'), resRedirect());
  assert.strictEqual(inserts.length, 0, 'CPF é o mesmo pessoa — não deve criar um segundo membro');
});

test('sem membro existente algum: cria o membro normalmente', async () => {
  const { rotas, inserts } = montar({
    ligante: { id: 99, nome: 'Pessoa Nova', cpf: '11122233344', email: 'nova@email.com' },
    membroExistente: null
  });
  await rotas['GET /ligantes/:id/aprovar'](req('99'), resRedirect());
  assert.strictEqual(inserts.length, 1, 'sem duplicata nenhuma, deve criar o membro');
  assert.strictEqual(inserts[0][0], 'Pessoa Nova');
});

test('email igual (case/espaço diferente) também é reconhecido como a mesma pessoa', async () => {
  const { rotas, inserts } = montar({
    ligante: { id: 7, nome: 'Fulano', cpf: '', email: '  Fulano@Email.com  ' },
    membroExistente: { id: 5, cpf: null, email: 'fulano@email.com' }
  });
  await rotas['GET /ligantes/:id/aprovar'](req('7'), resRedirect());
  assert.strictEqual(inserts.length, 0);
});

test('checagem de duplicata normaliza o CPF ANTES de mandar pro banco (não confia só na query SQL)', async () => {
  const { rotas, dedupChamadas } = montar({
    ligante: { id: 1, nome: 'X', cpf: '098.227.956-61', email: '' },
    membroExistente: null
  });
  await rotas['GET /ligantes/:id/aprovar'](req('1'), resRedirect());
  assert.strictEqual(dedupChamadas[0][0], '09822795661', 'CPF deve chegar só com dígitos, sem pontuação, na query');
});

// Segunda camada de defesa: mesmo se a checagem em código falhar por algum outro motivo
// futuro, o banco em si não pode aceitar dois membros com o mesmo CPF.
test('banco tem UNIQUE(cpf) em membros — segunda trava contra duplicata, além da checagem em código', () => {
  const src = require('fs').readFileSync(path.join(RAIZ, 'src/models/database.js'), 'utf8');
  assert.match(src, /ALTER TABLE membros ADD CONSTRAINT membros_cpf_key UNIQUE \(cpf\)/);
});
