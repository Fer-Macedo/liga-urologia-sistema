// ═══ GERADOR VIA GOOGLE DOCS API NATIVA ═══
// Cria um Google Doc nativo (editável pela faculdade), com timbrado no cabeçalho
// que se repete em todas as páginas. Sem conversão de .docx — o documento já nasce nativo.
const { google } = require('googleapis');

// Converte número arábico em romano maiúsculo (I, II, III...)
function romano(n) {
  const v = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let r = '', x = n;
  for (const [val, sym] of v) { while (x >= val) { r += sym; x -= val; } }
  return r;
}

const FONTE = 'Poppins';      // fonte próxima da Gotham, disponível no Google Docs
const SZ_CORPO = 11;          // pt
const SZ_TITULO = 11;
const SZ_CAPA_TITULO = 15;

// ─────────────────────────────────────────────────────────────────────────────
// Construção do conteúdo como uma lista de "blocos" que viram requests da API.
// Cada bloco: { text, bold, italic, align, size, bullet, space }
// ─────────────────────────────────────────────────────────────────────────────
function montarBlocos(p, totalH, ehInforme) {
  const fmtD = d => d ? new Date(d).toLocaleDateString('es-PY') : '';
  const blocos = [];
  const add = (text, o = {}) => blocos.push(Object.assign({ text: (text || '') + '\n' }, o));

  const objEsp = Array.isArray(p.objetivos_especificos) ? p.objetivos_especificos : JSON.parse(p.objetivos_especificos || '[]');
  const temario = Array.isArray(p.temario) ? p.temario : JSON.parse(p.temario || '[]');
  const intArr = Array.isArray(p.integrantes) ? p.integrantes : JSON.parse(p.integrantes || '[]');
  const pubAlvo = Array.isArray(p.publico_alvo) ? p.publico_alvo : JSON.parse(p.publico_alvo || '[]');
  const pubMap = { ligantes: 'Estudiantes de la liga (LAURO)', ucp: 'Estudiantes de la UCP', otras_universidades: 'Estudiantes de otras universidades', profesionales: 'Profesionales del área', comunidad: 'Comunidad general' };
  const ehEns = p.tipo === 'ensino';

  if (ehInforme) return montarInforme(p, totalH, add, blocos, fmtD);

  // ── CAPA ──
  add('Universidad Central del Paraguay', { bold: true, align: 'CENTER' });
  add('Facultad de Ciencias de la Salud', { bold: true, align: 'CENTER' });
  add('Carrera de Medicina', { bold: true, align: 'CENTER' });
  add('', {}); add('', {}); add('', {});
  add(ehEns ? 'PROYECTO DE ENSEÑANZA' : 'PROYECTO DE EXTENSIÓN', { bold: true, align: 'CENTER', size: SZ_CAPA_TITULO });
  add('', {}); add('', {});
  add('', { runs: [{ t: 'Nombre: ', bold: true }, { t: p.nome || '', bold: false }] });
  add('', { runs: [{ t: 'Responsable: ', bold: true }, { t: 'Liga Académica de Urología – LAURO', bold: false }] });
  add('', {}); add('', {}); add('', {}); add('', {}); add('', {});
  add('Ciudad del Este – PY', { bold: true, align: 'CENTER' });
  add(String(new Date().getFullYear()), { bold: true, align: 'CENTER' });
  blocos.push({ pageBreak: true });

  // ── Seções (numeração romana) ──
  let n = 0;
  const sec = (t) => add('', { sectitle: romano(++n) + '.  ' + t });

  sec('IDENTIFICACIÓN');
  add('', { runs: [{ t: 'Nombre del Proyecto: ', bold: true }, { t: p.nome || '' }] });
  if (ehEns) {
    add('', { runs: [{ t: 'Local: ', bold: true }, { t: (p.local || '') + (p.plataforma ? ' (' + p.plataforma + ')' : '') }] });
    add('', { runs: [{ t: 'Fecha: ', bold: true }, { t: fmtD(p.data_execucao_inicio) + (p.data_execucao_fim ? ' al ' + fmtD(p.data_execucao_fim) : '') + (p.horario_inicio ? ' | ' + p.horario_inicio + (p.horario_fim ? ' – ' + p.horario_fim : '') : '') }] });
    add('', { runs: [{ t: 'Docente Responsable del Proyecto: ', bold: true }, { t: p.docente_responsavel || '' }] });
    add('', { runs: [{ t: 'Liga Responsable: ', bold: true }, { t: 'Liga Académica de Urología – LAURO' }] });
  } else {
    add('', { runs: [{ t: 'Fecha de Ejecución: ', bold: true }, { t: fmtD(p.data_execucao_inicio) + (p.data_execucao_fim ? ' al ' + fmtD(p.data_execucao_fim) : '') }] });
    add('', { runs: [{ t: 'Lugar de Ejecución: ', bold: true }, { t: p.lugar_execucao || p.local || '' }] });
    add('', { runs: [{ t: 'Responsable del Proyecto: ', bold: true }, { t: p.docente_responsavel || '' }] });
    add('', { runs: [{ t: 'Liga Responsable: ', bold: true }, { t: 'Liga Académica de Urología – LAURO' }] });
  }
  add('', {});

  sec('ANTECEDENTES Y JUSTIFICACIÓN DEL PROYECTO');
  (p.antecedentes || '').split('\n').filter(s => s.trim()).forEach(s => add(s.trim(), { align: 'JUSTIFIED' }));
  add('', {});

  sec('OBJETIVO GENERAL');
  (p.objetivo_geral || '').split('\n').filter(s => s.trim()).forEach(s => add(s.trim(), { align: 'JUSTIFIED' }));
  add('', {});

  sec('OBJETIVOS ESPECÍFICOS');
  objEsp.forEach(o => add('- ' + o, { align: 'JUSTIFIED' }));
  add('', {});

  if (ehEns) {
    sec('TEMARIO Y PROGRAMA');
    temario.forEach(t => {
      add('', { runs: [{ t: 'Título: ', bold: true }, { t: t.titulo || '' }] });
      add('', { runs: [{ t: 'Descripción del contenido: ', bold: true }, { t: t.descricao || '' }] });
      add('', { runs: [{ t: 'Duración estimada: ', bold: true }, { t: t.duracao_min ? t.duracao_min + ' minutos' : '' }] });
      add('', { runs: [{ t: 'Nombre del ponente: ', bold: true }, { t: t.ponente || '' }] });
      add('', { runs: [{ t: 'Perfil del ponente: ', bold: true }, { t: t.perfil_ponente || '' }] });
      add('', {});
    });
    sec('PÚBLICO OBJETIVO');
    add(pubAlvo.map(x => pubMap[x] || x).join(', ') + '.', { align: 'JUSTIFIED' });
    add('', {});
    sec('METODOLOGÍA');
    (p.metodologia || '').split('\n').filter(s => s.trim()).forEach(s => add(s.trim(), { align: 'JUSTIFIED' }));
    add('', {});
    sec('INSCRIPCIÓN');
    add(p.inscricao_gratuita ? 'Inscripción gratuita.' : 'Inscripción con costo de Gs. ' + Number(p.inscricao_valor || 0).toLocaleString('es-PY') + (p.inscricao_valor_brl ? ' (R$ ' + Number(p.inscricao_valor_brl).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ')' : '') + '.', { align: 'JUSTIFIED' });
    if (p.inscricao_inicio) add('Período de inscripciones: ' + fmtD(p.inscricao_inicio) + ' al ' + fmtD(p.inscricao_fim) + '.', { align: 'JUSTIFIED' });
    add('', {});
    sec('CRONOGRAMA');
    blocos.push({ cronograma: true, p, totalH });
    add('', {});
    sec('RECURSOS');
    (p.recursos_necessarios || '').split('\n').filter(s => s.trim()).forEach(s => add(s.trim(), { align: 'JUSTIFIED' }));
    add('', {});
    sec('REFERENCIAS');
    (p.referencias || '').split('\n').filter(s => s.trim()).forEach(s => add(s.trim(), { align: 'JUSTIFIED' }));
  } else {
    sec('ACTIVIDADES POR REALIZAR');
    (p.atividades_realizar || '').split('\n').filter(s => s.trim()).forEach(s => add(s.trim(), { align: 'JUSTIFIED' }));
    add('', {});
    sec('INTEGRANTES DEL PROYECTO');
    if (intArr.length) {
      add('', { runs: [{ t: '- Responsable Principal: ', bold: true }, { t: intArr[0] }] });
      if (intArr.length > 1) { add('- Equipo de Trabajo:', { bold: true }); intArr.slice(1).forEach(o => add(o)); }
    }
    add('', {});
    sec('METODOLOGÍA');
    (p.metodologia || '').split('\n').filter(s => s.trim()).forEach(s => add(s.trim(), { align: 'JUSTIFIED' }));
    add('', {});
    sec('RECURSOS NECESARIOS');
    (p.recursos_necessarios || '').split('\n').filter(s => s.trim()).forEach(s => add(s.trim(), { align: 'JUSTIFIED' }));
    add('', {});
    sec('CRONOGRAMA');
    blocos.push({ cronograma: true, p, totalH });
    add('', {});
    sec('RESULTADOS ESPERADOS');
    (p.resultados_esperados || '').split('\n').filter(s => s.trim()).forEach(s => add(s.trim(), { align: 'JUSTIFIED' }));
  }

  // ── Assinaturas ──
  blocos.push({ pageBreak: true });
  add((p.nome || '').toUpperCase(), { bold: true, align: 'CENTER' });
  add('LIGA ACADÉMICA DE UROLOGÍA – LAURO', { bold: true, align: 'CENTER' });
  const firma = (nome, cargo) => { add('', {}); add('', {}); add('__________________________', { bold: true, align: 'CENTER' }); add(nome || '(nombre)', { bold: true, align: 'CENTER' }); add(cargo, { bold: true, align: 'CENTER' }); };
  firma('', 'Presidente');
  firma('', 'Director responsable del proyecto');
  firma('', 'Secretario');
  firma(p.docente_orientador || '', 'Docente Orientador');

  blocos.push({ pageBreak: true });
  add((p.nome || '').toUpperCase(), { bold: true, align: 'CENTER' });
  add('LIGA ACADÉMICA DE UROLOGÍA – LAURO', { bold: true, align: 'CENTER' });
  firma('Fernanda Carnelossi', 'Coordinación de Ligas');
  firma('Dra. Lilian Ramírez', 'Coordinadora de Extensión - Filial CDE');
  firma('Dr. Seidel Guerra', 'Coordinador General de Investigación, Extensión e Innovación – Filial CDE');
  firma('Dr. Sergio Marmori', 'Director de Carrera – Filial CDE');

  return blocos;
}

function montarInforme(p, totalH, add, blocos, fmtD) {
  const hoje = new Date();
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  add('INFORME FINAL ACADÉMICO DE HORAS COMPENSATORIAS', { bold: true, align: 'CENTER' });
  add('SEGÚN MALLA CURRICULAR DE LA UNIVERSIDAD CENTRAL DEL PARAGUAY', { bold: true, align: 'CENTER' });
  add('', {});
  add('Ciudad del Este, ' + hoje.getDate() + ' de ' + meses[hoje.getMonth()] + ' de ' + hoje.getFullYear() + '.', { align: 'JUSTIFIED' });
  add('', {});
  add('A: Dr. Sergio Marmori – Director de Carrera');
  add('A: Dr. Raquel Cáceres – Directora Académica');
  add('A: Dra. Lilian Raquel Ramírez – Coordinadora de Extensión y Vinculación con el medio');
  add('B: Liga Académica de Urología – LAURO');
  add('', {});
  add('', { runs: [{ t: 'Nombre del Proyecto: ', bold: true }, { t: p.nome || '' }] });
  add('', { runs: [{ t: 'Local: ', bold: true }, { t: p.local || p.lugar_execucao || '' }] });
  add('', { runs: [{ t: 'Fecha: ', bold: true }, { t: fmtD(p.data_execucao_inicio) + (p.data_execucao_fim ? ' al ' + fmtD(p.data_execucao_fim) : '') }] });
  add('', { runs: [{ t: 'Total de horas del proyecto: ', bold: true }, { t: totalH + ' horas' }] });
  add('', {});
  let n = 0; const sec = (t) => add('', { sectitle: romano(++n) + '.  ' + t });
  sec('CONCEPTO');
  (p.informe_conceito || '').split('\n').filter(s => s.trim()).forEach(s => add(s.trim(), { align: 'JUSTIFIED' }));
  add('', {});
  sec('ANÁLISIS DE INVOLUCRADOS');
  add('2.1- Actividades Realizadas', { bold: true });
  (p.informe_atividades || '').split('\n').filter(s => s.trim()).forEach(s => add(s.trim(), { align: 'JUSTIFIED' }));
  add('2.2- Resultados', { bold: true });
  (p.informe_resultados || '').split('\n').filter(s => s.trim()).forEach(s => add(s.trim(), { align: 'JUSTIFIED' }));
  add('2.3- Aprendizajes Adquiridos', { bold: true });
  (p.informe_aprendizados || '').split('\n').filter(s => s.trim()).forEach(s => add(s.trim(), { align: 'JUSTIFIED' }));
  add('', {});
  sec('ANÁLISIS DE PROBLEMAS');
  (p.informe_problemas || '').split('\n').filter(s => s.trim()).forEach(s => add(s.trim(), { align: 'JUSTIFIED' }));
  add('', {});
  sec('CONCLUSIÓN');
  (p.informe_conclusao || '').split('\n').filter(s => s.trim()).forEach(s => add(s.trim(), { align: 'JUSTIFIED' }));
  return blocos;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cria o Google Doc nativo via API e insere todo o conteúdo.
// authClient: cliente OAuth já autenticado (getClientAtualizado)
// timbradoUrl: URL pública do timbrado (R2) para o cabeçalho
// ─────────────────────────────────────────────────────────────────────────────
async function gerarGoogleDoc(authClient, p, totalH, ehInforme, timbradoUrl) {
  const docs = google.docs({ version: 'v1', auth: authClient });
  const drive = google.drive({ version: 'v3', auth: authClient });

  const tipoLabel = ehInforme ? 'INFORME FINAL' : (p.tipo === 'ensino' ? 'ENSEÑANZA' : 'EXTENSIÓN');
  const titulo = '[LAURO] ' + tipoLabel + ' – ' + (p.nome || 'Proyecto');

  // 1. Cria o documento vazio
  const created = await docs.documents.create({ requestBody: { title: titulo } });
  const docId = created.data.documentId;

  // 2. Monta os blocos de conteúdo
  const blocos = montarBlocos(p, totalH, ehInforme);

  // 3. Constrói os requests de inserção de texto (de trás pra frente para manter índices)
  //    Estratégia: insere todo o texto sequencialmente no índice 1, acumulando.
  let requests = [];
  let cursor = 1; // índice onde inserir (após o início do corpo)
  const formatRanges = []; // { start, end, bold, italic, align, size }

  // Função que insere um parágrafo e registra formatação
  function inserirParagrafo(texto, opts) {
    const start = cursor;
    requests.push({ insertText: { location: { index: cursor }, text: texto } });
    cursor += texto.length;
    const end = cursor;
    formatRanges.push({ start, end, opts });
  }

  // Processa blocos em ordem, acumulando texto
  const ops = []; // operações de formatação de parágrafo (alinhamento) e texto (bold/size)
  for (const b of blocos) {
    if (b.pageBreak) {
      requests.push({ insertText: { location: { index: cursor }, text: '\n' } });
      // marca para page break depois
      ops.push({ type: 'pagebreak', index: cursor });
      cursor += 1;
      continue;
    }
    if (b.cronograma) {
      ops.push({ type: 'cronograma', index: cursor, p: b.p, totalH: b.totalH });
      continue; // a tabela é inserida em fase separada
    }
    // Texto do parágrafo
    let texto, runs;
    if (b.sectitle) {
      texto = b.sectitle + '\n';
      runs = [{ t: b.sectitle, bold: true }];
    } else if (b.runs) {
      texto = b.runs.map(r => r.t).join('') + '\n';
      runs = b.runs;
    } else {
      texto = b.text;
      runs = [{ t: texto.replace(/\n$/, ''), bold: !!b.bold }];
    }
    const pStart = cursor;
    requests.push({ insertText: { location: { index: cursor }, text: texto } });
    // formatação por run (bold/size)
    let runCursor = cursor;
    for (const r of runs) {
      const rEnd = runCursor + r.t.length;
      if (r.t.length > 0) {
        ops.push({ type: 'textstyle', start: runCursor, end: rEnd, bold: r.bold !== undefined ? r.bold : !!b.bold, size: b.size || SZ_CORPO });
      }
      runCursor = rEnd;
    }
    const pEnd = cursor + texto.length;
    ops.push({ type: 'parastyle', start: pStart, end: pEnd, align: b.align || (b.sectitle ? 'JUSTIFIED' : 'START'), size: b.size || SZ_CORPO });
    cursor += texto.length;
  }

  // 4. Insere todo o texto
  await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests } });

  // 5. Aplica formatação (texto e parágrafo) e page breaks
  const fmtReqs = [];
  for (const op of ops) {
    if (op.type === 'textstyle') {
      fmtReqs.push({
        updateTextStyle: {
          range: { startIndex: op.start, endIndex: op.end },
          textStyle: { bold: !!op.bold, weightedFontFamily: { fontFamily: FONTE }, fontSize: { magnitude: op.size, unit: 'PT' } },
          fields: 'bold,weightedFontFamily,fontSize'
        }
      });
    } else if (op.type === 'parastyle') {
      fmtReqs.push({
        updateParagraphStyle: {
          range: { startIndex: op.start, endIndex: op.end },
          paragraphStyle: { alignment: op.align, lineSpacing: 150 },
          fields: 'alignment,lineSpacing'
        }
      });
    }
  }
  if (fmtReqs.length) {
    // batchUpdate aceita até muitos requests; dividir em lotes de 400 por segurança
    for (let i = 0; i < fmtReqs.length; i += 400) {
      await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: fmtReqs.slice(i, i + 400) } });
    }
  }

  // 6. Insere o timbrado no cabeçalho (repete em todas as páginas)
  if (timbradoUrl) {
    try {
      // Cria o header
      const headerRes = await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: { requests: [{ createHeader: { type: 'DEFAULT' } }] }
      });
      const headerId = headerRes.data.replies[0].createHeader.headerId;
      // Insere a imagem no header
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: [{
            insertInlineImage: {
              location: { segmentId: headerId, index: 0 },
              uri: timbradoUrl,
              objectSize: { width: { magnitude: 460, unit: 'PT' }, height: { magnitude: 650, unit: 'PT' } }
            }
          }]
        }
      });
    } catch (e) {
      console.error('Aviso: timbrado no header falhou:', e.message);
    }
  }

  // 7. Torna o documento acessível (qualquer um com link pode ver/editar)
  await drive.permissions.create({ fileId: docId, requestBody: { role: 'writer', type: 'anyone' } });

  const file = await drive.files.get({ fileId: docId, fields: 'id, name, webViewLink' });
  return { fileId: docId, webViewLink: file.data.webViewLink, name: file.data.name };
}

module.exports = { gerarGoogleDoc };
