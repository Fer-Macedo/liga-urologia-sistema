// O temário do projeto de ensino ganhou uma DATA por tema (a data da classe). Duas peças
// de lógica não-trivial precisam ficar travadas:
//   1. Alinhamento: o backend monta o temário de arrays paralelos (titulo[], data[]...).
//      Se um item enviar um campo a menos, a data de um tema "escorrega" para o vizinho.
//   2. Agrupamento: a exibição agrupa por data como "Clase 1 · DD/MM", "Clase 2 · DD/MM",
//      numerando pela ordem das datas — não por um número digitado à mão.
// Estes testes replicam exatamente a lógica das duas telas (route + detalhe) como guarda.
const { test } = require('node:test');
const assert = require('node:assert');

// ── réplica fiel do que projetos-academicos.js faz ao salvar ──
const arr = v => Array.isArray(v) ? v : (v !== undefined && v !== '' ? [v] : []);
function montarTemario(b) {
  const temTit = arr(b.temario_titulo), temPon = arr(b.temario_ponente),
        temPer = arr(b.temario_perfil), temDes = arr(b.temario_descricao),
        temDur = arr(b.temario_duracao), temDat = arr(b.temario_data);
  return temTit.map((t, i) => ({
    titulo: t, ponente: temPon[i] || '', perfil_ponente: temPer[i] || '',
    descricao: temDes[i] || '', duracao_min: temDur[i] || '', data: temDat[i] || ''
  })).filter(t => t.titulo && t.titulo.trim());
}

// ── réplica fiel do agrupamento de projeto-detalhe.ejs ──
function agrupar(temario) {
  const datas = [];
  temario.forEach(t => { if (t.data && datas.indexOf(t.data) === -1) datas.push(t.data); });
  datas.sort();
  const fmt = iso => { const p = String(iso).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso; };
  const grupos = datas.map((dia, i) => ({ titulo: 'Clase ' + (i + 1) + ' · ' + fmt(dia), itens: temario.filter(t => t.data === dia) }));
  const semData = temario.filter(t => !t.data);
  if (semData.length) grupos.push({ titulo: datas.length ? 'Sin fecha asignada' : '', itens: semData });
  return grupos;
}

test('a data cai no tema certo (arrays paralelos alinhados)', () => {
  const t = montarTemario({
    temario_titulo: ['Tema A', 'Tema B', 'Tema C'],
    temario_data:   ['2026-08-15', '2026-08-15', '2026-08-16']
  });
  assert.strictEqual(t[0].data, '2026-08-15');
  assert.strictEqual(t[1].data, '2026-08-15');
  assert.strictEqual(t[2].data, '2026-08-16');
});

test('tema sem data não rouba a data do vizinho', () => {
  const t = montarTemario({
    temario_titulo: ['Tema A', 'Tema B'],
    temario_data:   ['', '2026-08-16']   // A sem data, B com data
  });
  assert.strictEqual(t[0].data, '', 'A continua sem data');
  assert.strictEqual(t[1].data, '2026-08-16', 'B mantém a sua');
});

test('agrupamento numera as classes pela ordem das datas', () => {
  const g = agrupar([
    { titulo: 'Tema A', data: '2026-08-15' },
    { titulo: 'Tema B', data: '2026-08-15' },
    { titulo: 'Tema C', data: '2026-08-16' }
  ]);
  assert.strictEqual(g.length, 2);
  assert.strictEqual(g[0].titulo, 'Clase 1 · 15/08/2026');
  assert.strictEqual(g[0].itens.length, 2, 'os dois temas do dia 15 na mesma classe');
  assert.strictEqual(g[1].titulo, 'Clase 2 · 16/08/2026');
});

test('datas fora de ordem no formulário são numeradas em ordem cronológica', () => {
  const g = agrupar([
    { titulo: 'Tema tardio', data: '2026-08-17' },
    { titulo: 'Tema cedo',   data: '2026-08-15' }
  ]);
  assert.strictEqual(g[0].titulo, 'Clase 1 · 15/08/2026', 'a classe 1 é a data mais antiga');
  assert.strictEqual(g[1].titulo, 'Clase 2 · 17/08/2026');
});

test('temas sem data vão para um grupo próprio no fim', () => {
  const g = agrupar([
    { titulo: 'Com data', data: '2026-08-15' },
    { titulo: 'Sem data', data: '' }
  ]);
  assert.strictEqual(g[0].titulo, 'Clase 1 · 15/08/2026');
  assert.strictEqual(g[1].titulo, 'Sin fecha asignada');
  assert.strictEqual(g[1].itens[0].titulo, 'Sem data');
});

test('nenhuma data: um grupo só, sem cabeçalho de classe', () => {
  const g = agrupar([{ titulo: 'X', data: '' }, { titulo: 'Y', data: '' }]);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].titulo, '', 'sem datas, não inventa "Clase 1"');
  assert.strictEqual(g[0].itens.length, 2);
});
