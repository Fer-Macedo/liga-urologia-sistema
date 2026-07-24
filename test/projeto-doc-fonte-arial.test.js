// Padrão obrigatório: todo documento de projeto gerado pelo sistema tem que sair em Arial —
// os dois geradores usavam fontes diferentes ("Segoe UI" no timbrado, "Poppins" no gerador
// de Google Doc/informe final), nenhuma delas Arial. Trava dupla:
//   1. checagem estática do código-fonte — pega regressão na hora, antes de gerar nada;
//   2. geração real (gerarDocx) — confere Arial de fato nos bytes do .docx produzido.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const RAIZ = path.join(__dirname, '..');

// ─── checagem estática (os dois geradores) ────────────────────────────────────

test('projeto-doc-timbrado.js: a constante de fonte é Arial', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'src/services/projeto-doc-timbrado.js'), 'utf8');
  assert.match(src, /const FONTE = 'Arial'/);
});

test('projeto-doc-timbrado.js: nenhum "Segoe UI" sobrando (nem hardcoded fora da constante)', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'src/services/projeto-doc-timbrado.js'), 'utf8');
  assert.doesNotMatch(src, /Segoe UI/, 'w:eastAsia/w:cs estavam hardcoded em "Segoe UI", ignorando a constante FONTE');
});

test('projeto-doc.js: a constante de fonte é Arial', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'src/services/projeto-doc.js'), 'utf8');
  assert.match(src, /const FONTE = 'Arial'/);
});

test('projeto-doc.js: nenhum "Poppins" sobrando', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'src/services/projeto-doc.js'), 'utf8');
  assert.doesNotMatch(src, /Poppins/);
});

// ─── geração real: confere Arial nos bytes do .docx produzido ────────────────

test('gerarDocx: o .docx gerado usa Arial de verdade, não Poppins', async () => {
  const { gerarDocx } = require(path.join(RAIZ, 'src/services/projeto-doc.js'));
  const p = {
    nome: 'Proyecto de prueba', tipo: 'ensino',
    objetivo_geral: 'Objetivo de prueba.', objetivos_especificos: ['Uno', 'Dos'],
    antecedentes: 'Antecedentes.', metodologia: 'Metodología.',
    atividades_realizar: 'Actividades.', resultados_esperados: 'Resultados.',
    recursos_necessarios: 'Recursos.', referencias: 'Referencias.',
    integrantes: [], temario: [], map: [],
    docente_responsavel: 'Dr. Fulano', publico_alvo: ['ligantes'],
    data_execucao_inicio: '2026-08-01', data_execucao_fim: '2026-08-05',
    horario_inicio: '19:00', horario_fim: '21:00',
    local: 'Auditorio', lugar_execucao: 'UCP', plataforma: null,
    inscricao_inicio: '2026-07-01', inscricao_fim: '2026-07-30'
  };
  const buffer = await gerarDocx(p, 0, false, {});
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml').async('string');
  assert.match(documentXml, /Arial/, 'o .docx real tem que carregar Arial nos runs de texto');
  assert.doesNotMatch(documentXml, /Poppins/, 'não pode sobrar a fonte antiga no arquivo gerado');
});
