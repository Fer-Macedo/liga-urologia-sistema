// Achado pelo usuário em 2026-08-05, olhando o print do dashboard: "Arrecadado (líq.)"
// mostrava R$75,00 pra 3 confirmados de R$25 — mas é a soma BRUTA de valor_pago, sem
// descontar a taxa do PagBank. O mesmo cálculo já existe (e está certo) em
// fluxo-pss.js:calcularLiquidoPss, usado pra lançar o valor real no fluxo de caixa —
// o dashboard e o relatório PDF só não usavam. cartão desconta 4%, PIX 1,9%.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/processo-seletivo.js');

function montar({ candidatos, pagamentos = [] }) {
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT p\.\*,[\s\S]*FROM ps_processos p ORDER BY p\.id DESC/.test(sql)) {
        return { rows: [{ id: 4, nome: 'Proceso Selectivo 2026.2', status: 'aberto', total_inscritos: candidatos.length, confirmados: candidatos.filter(c=>c.pagamento_status==='confirmado').length }] };
      }
      if (/SELECT \* FROM ps_processos WHERE id=\$1/.test(sql)) return { rows: [{ id: 4, nome: 'Proceso Selectivo 2026.2' }] };
      if (/SELECT \* FROM ps_candidatos WHERE processo_id=\$1/.test(sql)) return { rows: candidatos };
      if (/SELECT ec\.\*, c\.nome AS usado_nome FROM ps_cupons/.test(sql)) return { rows: [] };
      if (/SELECT candidato_id, metodo FROM ps_pagamentos WHERE candidato_id = ANY/.test(sql)) {
        const ids = params[0];
        return { rows: pagamentos.filter(p => ids.includes(p.candidato_id)) };
      }
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };
  const rar = require.resolve(path.join(RAIZ, 'src/services/arquivos.js'));
  require.cache[rar] = { id: rar, filename: rar, loaded: true, exports: { upload: { single: () => (q,s,n)=>n() }, uploadArquivo: async () => ({}) } };
  const rdl = require.resolve(path.join(RAIZ, 'src/services/desligamento.js'));
  require.cache[rdl] = { id: rdl, filename: rdl, loaded: true, exports: { getUrlAssinada: async () => 'https://x' } };
  const rnt = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rnt] = { id: rnt, filename: rnt, loaded: true, exports: { enviarEmail: async () => {} } };
  const rpss = require.resolve(path.join(RAIZ, 'src/services/pss.js'));
  require.cache[rpss] = { id: rpss, filename: rpss, loaded: true, exports: {
    _pssProximoNumero: async () => 1, confirmarInscricaoPss: async () => {},
    enviarEmailConfirmacaoPss: async () => {}, enviarLembretePss: async () => {}, enviarEmailBoasVindasPss: async () => {}
  }};
  const rpg = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  require.cache[rpg] = { id: rpg, filename: rpg, loaded: true, exports: { criarPixPss: async () => ({}) } };

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas[rota] = fns[fns.length - 1]; }, post: () => {} };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas };
}

function resRender() {
  const r = { _data: null };
  r.render = (view, data) => { r._data = data; };
  r.status = () => r;
  r.send = () => {};
  return r;
}

test('dashboard: "Arrecadado (líq.)" desconta a taxa do PagBank (PIX 1,9%, cartão 4%), não soma o bruto', async () => {
  const candidatos = [
    { id: 9, nome: 'Maria', pagamento_status: 'confirmado', valor_pago: 25, criado_em: null },
    { id: 11, nome: 'Laura', pagamento_status: 'confirmado', valor_pago: 25, criado_em: null },
    { id: 12, nome: 'Lucas', pagamento_status: 'confirmado', valor_pago: 0, criado_em: null }, // isento
  ];
  const pagamentos = [
    { candidato_id: 9, metodo: 'pix' },
    { candidato_id: 11, metodo: 'cartao' },
  ];
  const { rotas } = montar({ candidatos, pagamentos });
  const res = resRender();
  await rotas['/inscricoes-pss']({ query: { processo: '4' }, session: {} }, res);

  // esperado: 25*0.981 (pix, 24.53) + 25*0.96 (cartao, 24.00) + 0 (isento) = 48.53
  assert.strictEqual(res._data.resumo.arrecadado, 48.53, 'nao pode ser 75 (a soma bruta) nem ignorar o metodo de pagamento');
  assert.strictEqual(res._data.resumo.confirmados, 3);
});

test('dashboard: sem confirmados, arrecadado líquido é 0 (não quebra nem consulta ps_pagamentos à toa)', async () => {
  const candidatos = [{ id: 20, nome: 'Pendente', pagamento_status: 'pendente', valor_pago: 25, criado_em: null }];
  const { rotas } = montar({ candidatos, pagamentos: [] });
  const res = resRender();
  await rotas['/inscricoes-pss']({ query: { processo: '4' }, session: {} }, res);
  assert.strictEqual(res._data.resumo.arrecadado, 0);
  assert.strictEqual(res._data.resumo.pendentes, 1);
});

test('relatorio: mesma correção — usa o líquido, não o bruto de valor_pago', async () => {
  const candidatos = [{ id: 9, nome: 'Maria', pagamento_status: 'confirmado', valor_pago: 25, documento: null, email: null, criado_em: null }];
  const pagamentos = [{ candidato_id: 9, metodo: 'pix' }];
  const { rotas } = montar({ candidatos, pagamentos });
  const res = resRender();
  await rotas['/inscricoes-pss/relatorio']({ query: { processo: '4' } }, res);
  assert.strictEqual(res._data.arrecadado, 24.53);
});
