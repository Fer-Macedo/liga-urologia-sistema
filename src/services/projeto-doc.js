// ═══ GERADOR DE DOCUMENTOS — MODELO OFICIAL UCP ═══
// Reproduz fielmente os modelos: Proyecto de Enseñanza, Proyecto de Extensión e Informe Final
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
        Header, Footer, AlignmentType, WidthType, BorderStyle, ShadingType, PageBreak } = require('docx');

// Faixas PADRÃO do timbrado UCP (fallback, caso a liga não tenha configurado um próprio)
const TIMBRADO_HEAD_PADRAO = Buffer.from('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', 'base64');
const TIMBRADO_FOOT_PADRAO = Buffer.from('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', 'base64');

// ── Helpers de formatação (fiéis ao modelo: Gotham 12pt corpo, Segoe UI capa) ──
const runG = (t, o = {}) => new TextRun({ text: t || '', bold: !!o.b, font: 'Poppins', size: o.sz || 24 });
const runS = (t, o = {}) => new TextRun({ text: t || '', bold: o.b !== false, font: 'Poppins', size: o.sz || 24 });

// Parágrafo corpo: Gotham, justificado, interlineado 1.5 (line 360) — como o modelo
const par = (children, o = {}) => new Paragraph({
  alignment: o.center ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
  spacing: { after: o.after !== undefined ? o.after : 0, line: o.line || 360, lineRule: 'auto' },
  children: Array.isArray(children) ? children : [children]
});
const pTxt   = (t, o = {}) => par(runG(t, o), o);
const pBold  = (t, o = {}) => par(runG(t, { b: true }), o);
const pLabel = (label, value, o = {}) => par([runG(label, { b: true }), runG(value || '')], o);
const pEmpty = () => par(runG(''), { line: 240 });

// Título de seção numerado: "1. IDENTIFICACIÓN" — Gotham negrito 12, como o modelo
// Número arábico -> romano maiúsculo (I, II, III...) como no modelo UCP
function romano(n) {
  const v = [[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  let r = '', x = n;
  for (const [val, sym] of v) { while (x >= val) { r += sym; x -= val; } }
  return r;
}
// Título de seção: "I.\tIDENTIFICACIÓN" — romano, negrito, com tabulação (igual ao modelo)
const sec = (n, t) => new Paragraph({
  spacing: { before: 240, after: 80, line: 360, lineRule: 'auto' },
  tabStops: [{ type: 'left', position: 360 }],
  children: [ runG(romano(n) + '.', { b: true }), new TextRun({ text: '\t', font: 'Poppins', size: 24 }), runG(t, { b: true }) ]
});

// Texto multilinha -> vários parágrafos
const pMulti = (txt) => String(txt || '').split('\n').map(s => s.trim()).filter(Boolean).map(s => pTxt(s));

// Quebra de página
const pgBreak = () => new Paragraph({ children: [new PageBreak()] });

// ── Cabeçalho/rodapé inline — preservados pelo Google Docs.
// Recebem o buffer da imagem (timbrado configurável da liga, vindo do R2) ──
function timbradoHeader(imgHead) {
  if (!imgHead) return undefined;
  return new Header({ children: [ new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 0 },
    children: [ new ImageRun({ type: 'png', data: imgHead,
      transformation: { width: 624, height: 145 } }) ]   // largura útil A4 ~16.5cm
  }) ] });
}
function timbradoFooter(imgFoot) {
  if (!imgFoot) return undefined;
  return new Footer({ children: [ new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 0 },
    children: [ new ImageRun({ type: 'png', data: imgFoot,
      transformation: { width: 624, height: 128 } }) ]
  }) ] });
}

// Converte um data-URI base64 (vindo de imagemBase64 do R2) em Buffer
function b64ParaBuffer(dataUri) {
  if (!dataUri) return null;
  try { return Buffer.from(String(dataUri).replace(/^data:image\/[^;]+;base64,/, ''), 'base64'); }
  catch (e) { return null; }
}

// Imagens do timbrado INLINE no corpo (sobrevivem à conversão p/ Google Doc, ao contrário de header/footer)
function imgInline(buf, w, h) {
  return new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 0, before: 0 },
    children: [ new ImageRun({ type: 'png', data: buf, transformation: { width: w, height: h } }) ]
  });
}

// ── Tabela do cronograma (idêntica ao modelo) ──
function tabelaCronograma(p, totalH) {
  const bC = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
  const bds = { top: bC, bottom: bC, left: bC, right: bC };
  const cw = [2300, 1700, 1100, 1100, 1150, 1154]; // soma 8504 = largura útil A4 c/ margens do modelo
  const mg = { top: 60, bottom: 60, left: 100, right: 100 };
  const cell = (txt, w, bold, span) => new TableCell({
    borders: bds, width: { size: w, type: WidthType.DXA }, margins: mg,
    columnSpan: span,
    children: [par(runG(txt, { b: !!bold }), { line: 240 })]
  });
  const head = ['ACTIVIDADES', p.tipo === 'ensino' ? 'DISERTANTE' : 'RESPONSABLE', 'FECHA', 'HORA DE INICIO', 'HORA DE TÉRMINO', 'HORA TOTAL'];
  const fmtD = d => d ? new Date(d).toLocaleDateString('es-PY') : '';
  const rows = [
    new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, cw[i], true)) }),
    ...(p.cronograma || []).map(c => new TableRow({ children: [
      cell(c.atividade || '', cw[0]), cell(c.responsavel || '', cw[1]), cell(fmtD(c.data), cw[2]),
      cell(c.hora_inicio || '', cw[3]), cell(c.hora_fim || '', cw[4]), cell(c.horas_total ? c.horas_total + 'h' : '', cw[5])
    ] })),
    new TableRow({ children: [
      cell('Horas complementares totales del proyecto', cw[0] + cw[1] + cw[2] + cw[3] + cw[4], true, 5),
      cell(totalH + 'h', cw[5], true)
    ] })
  ];
  return new Table({ width: { size: 8504, type: WidthType.DXA }, columnWidths: cw, rows });
}

// ── Bloco de assinatura (centrado, Gotham negrito — como o modelo) ──
const firma = (nome, cargo) => [
  pEmpty(), pEmpty(),
  par(runG('__________________________', { b: true }), { center: true, line: 240 }),
  par(runG(nome || '(nombre)', { b: true }), { center: true, line: 240 }),
  par(runG(cargo, { b: true }), { center: true, line: 240 })
];

function paginaFirmas(p, institucional) {
  const out = [
    pgBreak(),
    par(runG((p.nome || '').toUpperCase(), { b: true }), { center: true, line: 240 }),
    par(runG('LIGA ACADÉMICA DE UROLOGÍA – LAURO', { b: true }), { center: true, line: 240 })
  ];
  if (!institucional) {
    out.push(
      ...firma('', 'Presidente'),
      ...firma('', 'Director responsable del proyecto'),
      ...firma('', 'Secretario'),
      ...firma(p.docente_orientador || '', 'Docente Orientador')
    );
  } else {
    out.push(
      ...firma('Fernanda Carnelossi', 'Coordinación de Ligas'),
      ...firma('Dra. Lilian Ramírez', 'Coordinadora de Extensión - Filial CDE'),
      ...firma('Dr. Seidel Guerra', 'Coordinador General de Investigación, Extensión e Innovación – Filial CDE'),
      ...firma('Dr. Sergio Marmori', 'Director de Carrera – Filial CDE')
    );
  }
  return out;
}

// ── Montagem do documento ──
function montarProjeto(p, totalH) {
  const ehEns = p.tipo === 'ensino';
  const fmtD = d => d ? new Date(d).toLocaleDateString('es-PY') : '';
  const objEsp  = Array.isArray(p.objetivos_especificos) ? p.objetivos_especificos : JSON.parse(p.objetivos_especificos || '[]');
  const temario = Array.isArray(p.temario) ? p.temario : JSON.parse(p.temario || '[]');
  const intArr  = Array.isArray(p.integrantes) ? p.integrantes : JSON.parse(p.integrantes || '[]');
  const pubAlvo = Array.isArray(p.publico_alvo) ? p.publico_alvo : JSON.parse(p.publico_alvo || '[]');
  const pubMap = { ligantes: 'Estudiantes de la liga (LAURO)', ucp: 'Estudiantes de la UCP', otras_universidades: 'Estudiantes de otras universidades', profesionales: 'Profesionales del área', comunidad: 'Comunidad general' };

  // ── CAPA (Segoe UI, como o modelo) ──
  const capa = [
    par(runS('Universidad Central del Paraguay'), { center: true, line: 240 }),
    par(runS('Facultad de Ciencias de la Salud'), { center: true, line: 240 }),
    par(runS('Carrera de Medicina'), { center: true, line: 240 }),
    pEmpty(), pEmpty(), pEmpty(), pEmpty(), pEmpty(), pEmpty(),
    par(runS(ehEns ? 'PROYECTO DE ENSEÑANZA' : 'PROYECTO DE EXTENSIÓN', { sz: 30 }), { center: true, line: 240 }),
    pEmpty(), pEmpty(), pEmpty(), pEmpty(),
    par([runS('Nombre: '), runS(p.nome || '', { b: false })]),
    par([runS('Responsable: '), runS('Liga Académica de Urología – LAURO', { b: false })]),
    pEmpty(), pEmpty(), pEmpty(), pEmpty(), pEmpty(), pEmpty(), pEmpty(),
    par(runS('Ciudad del Este – PY'), { center: true }),
    par(runS(String(new Date().getFullYear())), { center: true }),
    pgBreak()
  ];

  // ── 1. IDENTIFICACIÓN ──
  const ident = [ sec(1, 'IDENTIFICACIÓN'),
    pLabel('Nombre del Proyecto: ', p.nome || '') ];
  if (ehEns) {
    ident.push(
      pLabel('Local: ', (p.local || '') + (p.plataforma ? ' (' + p.plataforma + ')' : '')),
      pLabel('Fecha: ', fmtD(p.data_execucao_inicio) + (p.data_execucao_fim ? ' al ' + fmtD(p.data_execucao_fim) : '') + (p.horario_inicio ? ' | ' + p.horario_inicio + (p.horario_fim ? ' – ' + p.horario_fim : '') : '')),
      pLabel('Docente Responsable del Proyecto: ', p.docente_responsavel || ''),
      pLabel('Liga Responsable: ', 'Liga Académica de Urología – LAURO')
    );
  } else {
    ident.push(
      pLabel('Fecha de Ejecución: ', fmtD(p.data_execucao_inicio) + (p.data_execucao_fim ? ' al ' + fmtD(p.data_execucao_fim) : '')),
      pLabel('Lugar de Ejecución: ', p.lugar_execucao || p.local || ''),
      pLabel('Responsable del Proyecto: ', p.docente_responsavel || ''),
      pLabel('Liga Responsable: ', 'Liga Académica de Urología – LAURO')
    );
  }
  ident.push(pEmpty());

  // ── Corpo comum ──
  const corpo = [
    sec(2, 'ANTECEDENTES Y JUSTIFICACIÓN DEL PROYECTO'),
    ...pMulti(p.antecedentes), pEmpty(),
    sec(3, 'OBJETIVO GENERAL'),
    ...pMulti(p.objetivo_geral), pEmpty(),
    sec(4, 'OBJETIVOS ESPECÍFICOS'),
    ...objEsp.map(o => pTxt('- ' + o)), pEmpty()
  ];

  let especifico = [];
  if (ehEns) {
    especifico = [
      sec(5, 'TEMARIO Y PROGRAMA'),
      ...temario.flatMap(t => [
        pLabel('Título: ', t.titulo || ''),
        pLabel('Descripción del contenido: ', t.descricao || ''),
        pLabel('Duración estimada: ', t.duracao_min ? t.duracao_min + ' minutos' : ''),
        pLabel('Nombre del ponente: ', t.ponente || ''),
        pLabel('Perfil del ponente: ', t.perfil_ponente || ''),
        pEmpty()
      ]),
      sec(6, 'PÚBLICO OBJETIVO'),
      pTxt(pubAlvo.map(x => pubMap[x] || x).join(', ') + '.'), pEmpty(),
      sec(7, 'METODOLOGÍA'),
      ...pMulti(p.metodologia), pEmpty(),
      sec(8, 'INSCRIPCIÓN'),
      pTxt(p.inscricao_gratuita
        ? 'Inscripción gratuita.'
        : 'Inscripción con costo de Gs. ' + Number(p.inscricao_valor || 0).toLocaleString('es-PY') + (p.inscricao_valor_brl ? ' (R$ ' + Number(p.inscricao_valor_brl).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ')' : '') + '.'),
      ...(p.inscricao_inicio ? [pTxt('Período de inscripciones: ' + fmtD(p.inscricao_inicio) + ' al ' + fmtD(p.inscricao_fim) + '.')] : []),
      pEmpty(),
      sec(9, 'CRONOGRAMA'),
      tabelaCronograma(p, totalH), pEmpty(),
      sec(10, 'RECURSOS'),
      ...pMulti(p.recursos_necessarios), pEmpty(),
      sec(11, 'REFERENCIAS'),
      ...pMulti(p.referencias)
    ];
  } else {
    especifico = [
      sec(5, 'ACTIVIDADES POR REALIZAR'),
      ...pMulti(p.atividades_realizar), pEmpty(),
      sec(6, 'INTEGRANTES DEL PROYECTO'),
      ...(intArr.length ? [
        pLabel('- Responsable Principal: ', intArr[0]),
        ...(intArr.length > 1 ? [pBold('- Equipo de Trabajo:'), ...intArr.slice(1).map(o => pTxt(o))] : [])
      ] : []),
      pEmpty(),
      sec(7, 'METODOLOGÍA'),
      ...pMulti(p.metodologia), pEmpty(),
      sec(8, 'RECURSOS NECESARIOS'),
      ...pMulti(p.recursos_necessarios), pEmpty(),
      sec(9, 'CRONOGRAMA'),
      tabelaCronograma(p, totalH), pEmpty(),
      sec(10, 'RESULTADOS ESPERADOS'),
      ...pMulti(p.resultados_esperados), pEmpty(),
      ...(p.referencias ? [pBold('REFERENCIAS'), ...pMulti(p.referencias)] : [])
    ];
  }

  return [...capa, ...ident, ...corpo, ...especifico, ...paginaFirmas(p, false), ...paginaFirmas(p, true)];
}

function montarInforme(p, totalH) {
  const fmtD = d => d ? new Date(d).toLocaleDateString('es-PY') : '';
  const hoje = new Date();
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return [
    par(runG('INFORME FINAL ACADÉMICO DE HORAS COMPENSATORIAS', { b: true }), { center: true, line: 240 }),
    par(runG('SEGÚN MALLA CURRICULAR DE LA UNIVERSIDAD CENTRAL DEL PARAGUAY', { b: true }), { center: true, line: 240 }),
    pEmpty(),
    pTxt('Ciudad del Este, ' + hoje.getDate() + ' de ' + meses[hoje.getMonth()] + ' de ' + hoje.getFullYear() + '.'),
    pEmpty(),
    pTxt('A: Dr. Sergio Marmori – Director de Carrera'),
    pTxt('A: Dr. Raquel Cáceres – Directora Académica'),
    pTxt('A: Dra. Lilian Raquel Ramírez – Coordinadora de Extensión y Vinculación con el medio'),
    pTxt('B: Liga Académica de Urología – LAURO'),
    pEmpty(),
    pTxt('Informe Final compensatorio de horas correspondientes a la malla curricular, sobre:'),
    pEmpty(),
    pLabel('Nombre del Proyecto: ', p.nome || ''),
    pLabel('Local: ', p.local || p.lugar_execucao || ''),
    pLabel('Fecha: ', fmtD(p.data_execucao_inicio) + (p.data_execucao_fim ? ' al ' + fmtD(p.data_execucao_fim) : '')),
    pLabel('Liga: ', 'Liga Académica de Urología – LAURO'),
    pLabel('Responsable: ', p.docente_orientador || p.docente_responsavel || ''),
    pLabel('Total de horas del proyecto: ', totalH + ' horas'),
    pEmpty(),
    sec(1, 'CONCEPTO'),
    ...pMulti(p.informe_conceito), pEmpty(),
    sec(2, 'ANÁLISIS DE INVOLUCRADOS'),
    pBold('2.1- Actividades Realizadas'),
    ...pMulti(p.informe_atividades), pEmpty(),
    pBold('2.2- Resultados'),
    ...pMulti(p.informe_resultados), pEmpty(),
    pBold('2.3- Aprendizajes Adquiridos'),
    ...pMulti(p.informe_aprendizados), pEmpty(),
    sec(3, 'ANÁLISIS DE PROBLEMAS'),
    ...pMulti(p.informe_problemas), pEmpty(),
    sec(4, 'CONCLUSIÓN'),
    ...pMulti(p.informe_conclusao), pEmpty(),
    pBold('ANEXO DE FOTOS'),
    pTxt('(Agregar aquí las fotos del proyecto, mostrando la fecha y el número de participantes.)'),
    pEmpty(),
    pBold('ASISTENCIAS'),
    pTxt('(En línea: tabla con nombre y catraca. Presencial: anexo digitalizado de la lista firmada por los participantes.)'),
    ...paginaFirmas(p, false)
  ];
}

// ── Função principal: gera o .docx no formato oficial UCP ──
// config (opcional): { timbrado_head_b64, timbrado_foot_b64 } vindos do R2 via imagemBase64.
// Se a liga tiver configurado um timbrado próprio (faixas de topo/rodapé), usa-o;
// caso contrário, usa o timbrado UCP padrão embutido. Assim cada liga usa o seu, sem mexer no código.
async function gerarDocx(p, totalH, ehInforme, config = {}) {
  const children = ehInforme ? montarInforme(p, totalH) : montarProjeto(p, totalH);

  const imgHead = b64ParaBuffer(config.timbrado_head_b64) || TIMBRADO_HEAD_PADRAO;
  const imgFoot = b64ParaBuffer(config.timbrado_foot_b64) || TIMBRADO_FOOT_PADRAO;

  // Timbrado como imagem INLINE: logo no topo da 1ª página + sedes ao final.
  // (O Google Docs preserva imagens inline no corpo; descarta as de header/footer.)
  const corpoComTimbrado = [
    imgInline(imgHead, 624, 145),   // logo UCP no topo (largura útil A4)
    ...children,
    imgInline(imgFoot, 624, 128)    // barra de sedes ao final
  ];

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Poppins', size: 24 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },                       // A4, igual ao modelo
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } // 2cm, espaço para o timbrado inline
        }
      },
      children: corpoComTimbrado
    }]
  });
  return Packer.toBuffer(doc);
}

module.exports = { gerarDocx };
