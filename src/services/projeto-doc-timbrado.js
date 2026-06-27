// ═══ GERADOR DEFINITIVO DE PROJETOS (Node.js) ═══
// Usa o MEMBRETE TIMBRADO da UCP como base e injeta o conteúdo do projeto no corpo,
// preservando o timbrado de fundo (headers/footers) em todas as páginas.
// Resultado: .docx idêntico ao modelo da universidade, editável, pronto para anexar.
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const FONTE = 'Segoe UI';
const SZ_CORPO = 24;       // meio-pontos => 12pt
const SZ_TITULO = 24;
const SZ_CAPA = 30;        // 16pt

// ── utilidades ──
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function romano(n) {
  const v = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let r = '', x = n;
  for (const [val, sym] of v) { while (x >= val) { r += sym; x -= val; } }
  return r;
}
function fmtData(s) {
  if (!s) return '';
  try {
    const d = new Date(s);
    if (isNaN(d)) return String(s);
    return d.toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch (e) { return String(s); }
}
function jload(v, def) {
  if (v == null) return def || [];
  if (Array.isArray(v) || typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (e) { return def || []; }
}

// ── geração de XML de parágrafos ──
// run: {t, b} (texto, negrito)
function runXml(t, bold, size) {
  const sz = size || SZ_CORPO;
  return '<w:r><w:rPr>' +
    (bold ? '<w:b/><w:bCs/>' : '') +
    '<w:rFonts w:ascii="' + FONTE + '" w:hAnsi="' + FONTE + '" w:eastAsia="Segoe UI" w:cs="Segoe UI"/>' +
    '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/>' +
    '</w:rPr><w:t xml:space="preserve">' + esc(t) + '</w:t></w:r>';
}
// align: left|center|both|right ; runs: [{t,b}]
function parXml(runs, align, size, opts) {
  opts = opts || {};
  const al = { left: 'left', center: 'center', both: 'both', justify: 'both', right: 'right' }[align] || 'left';
  let ppr = '<w:pPr>';
  ppr += '<w:jc w:val="' + al + '"/>';
  ppr += '<w:spacing w:after="' + (opts.after != null ? opts.after : 120) + '" w:line="360" w:lineRule="auto"/>';
  if (opts.tab) ppr += '<w:tabs><w:tab w:val="left" w:pos="360"/></w:tabs>';
  ppr += '</w:pPr>';
  let body = '';
  for (const r of runs) body += runXml(r.t, r.b, size);
  return '<w:p>' + ppr + body + '</w:p>';
}
function vazio(n) {
  let s = '';
  for (let i = 0; i < (n || 1); i++) s += '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';
  return s;
}
function tituloSec(n, texto) {
  // "I.<tab>TÍTULO" negrito
  return '<w:p><w:pPr><w:jc w:val="both"/><w:spacing w:before="200" w:after="80" w:line="360" w:lineRule="auto"/>' +
    '<w:tabs><w:tab w:val="left" w:pos="480"/></w:tabs></w:pPr>' +
    runXml(romano(n) + '.', true, SZ_TITULO) +
    '<w:r><w:rPr><w:b/><w:rFonts w:ascii="' + FONTE + '" w:hAnsi="' + FONTE + '"/><w:sz w:val="' + SZ_TITULO + '"/></w:rPr><w:tab/></w:r>' +
    runXml(texto, true, SZ_TITULO) + '</w:p>';
}
function quebraPagina() {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

// ── tabela do cronograma ──
function cronogramaXml(crono) {
  crono = crono || [];
  if (!crono.length) {
    return parXml([{ t: 'Horas complementares totales del proyecto: 0h', b: true }], 'both', SZ_CORPO);
  }
  const cabs = ['ACTIVIDADES', 'DISERTANTE', 'FECHA', 'HORARIO', 'HORAS'];
  const cellHdr = (t) => '<w:tc><w:tcPr><w:tcBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/></w:tcBorders><w:shd w:val="clear" w:fill="EFEFEF"/></w:tcPr>' +
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' + runXml(t, true, 20) + '</w:p></w:tc>';
  const cell = (t) => '<w:tc><w:tcPr><w:tcBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/></w:tcBorders></w:tcPr>' +
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' + runXml(t, false, 20) + '</w:p></w:tc>';
  let rows = '<w:tr>' + cabs.map(cellHdr).join('') + '</w:tr>';
  let total = 0;
  for (const it of crono) {
    const horario = it.hora_inicio ? (it.hora_inicio + '–' + (it.hora_fim || '')) : '';
    const horas = it.horas_total ? (it.horas_total + 'h') : '';
    rows += '<w:tr>' + [it.atividade || '', it.responsavel || '', fmtData(it.data), horario, horas].map(cell).join('') + '</w:tr>';
    const h = parseFloat(it.horas_total || 0); if (!isNaN(h)) total += h;
  }
  const tbl = '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>' +
    '<w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>' +
    rows + '</w:tbl>';
  return tbl + vazio(1) + parXml([{ t: 'Horas complementares totales del proyecto: ' + (total % 1 === 0 ? total : total.toFixed(1)) + 'h', b: true }], 'both', SZ_CORPO);
}


// ── XML de uma imagem inline de assinatura (centralizada) ──
function imagemAssinaturaXml(rId, larguraEmu, alturaEmu, idNum, nome) {
  return '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr>' +
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="' + larguraEmu + '" cy="' + alturaEmu + '"/>' +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:docPr id="' + idNum + '" name="' + nome + '"/>' +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:nvPicPr><pic:cNvPr id="' + idNum + '" name="' + nome + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="' + rId + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + larguraEmu + '" cy="' + alturaEmu + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
}

// ── monta todo o corpo do projeto ──
function montarCorpo(p, cfg) {
  cfg = cfg || {};
  const ehEns = p.tipo === 'ensino';
  let x = '';
  const linhas = (txt) => String(txt || '').split('\n').filter(s => s.trim());

  // CAPA
  x += parXml([{ t: 'Universidad Central del Paraguay', b: true }], 'center');
  x += parXml([{ t: 'Facultad de Ciencias de la Salud', b: true }], 'center');
  x += parXml([{ t: 'Carrera de Medicina', b: true }], 'center');
  x += vazio(3);
  x += parXml([{ t: ehEns ? 'PROYECTO DE ENSEÑANZA' : 'PROYECTO DE EXTENSIÓN', b: true }], 'center', SZ_CAPA);
  x += vazio(2);
  x += parXml([{ t: 'Nombre: ', b: true }, { t: p.nome || '', b: false }], 'left');
  x += parXml([{ t: 'Responsable: ', b: true }, { t: 'Liga Académica de Urología – LAURO', b: false }], 'left');
  x += vazio(11);
  x += parXml([{ t: 'Ciudad del Este – PY', b: true }], 'center', SZ_CORPO, { after: 0 });
  x += parXml([{ t: String(new Date().getFullYear()), b: true }], 'center', SZ_CORPO, { after: 0 });
  x += quebraPagina();

  let n = 0;
  const sec = (t) => { n += 1; return tituloSec(n, t); };

  const objEsp = jload(p.objetivos_especificos, []);
  const temario = jload(p.temario, []);
  const integrantes = jload(p.integrantes, []);
  const pub = jload(p.publico_alvo, []);
  const pubmap = { ligantes: 'Estudiantes de la liga (LAURO)', ucp: 'Estudiantes de la UCP', otras_universidades: 'Estudiantes de otras universidades', profesionales: 'Profesionales del área', comunidad: 'Comunidad general' };

  // IDENTIFICACIÓN
  x += sec('IDENTIFICACIÓN');
  x += parXml([{ t: 'Nombre del Proyecto: ', b: true }, { t: p.nome || '', b: false }], 'left');
  if (ehEns) {
    const local = (p.local || '') + (p.plataforma ? ' (' + p.plataforma + ')' : '');
    let fecha = fmtData(p.data_execucao_inicio);
    if (p.data_execucao_fim) fecha += ' al ' + fmtData(p.data_execucao_fim);
    if (p.horario_inicio) fecha += ' | ' + p.horario_inicio + (p.horario_fim ? ' – ' + p.horario_fim : '');
    x += parXml([{ t: 'Local: ', b: true }, { t: local, b: false }], 'left');
    x += parXml([{ t: 'Fecha: ', b: true }, { t: fecha, b: false }], 'left');
    x += parXml([{ t: 'Docente Responsable del Proyecto: ', b: true }, { t: p.docente_responsavel || '', b: false }], 'left');
    x += parXml([{ t: 'Liga Responsable: ', b: true }, { t: 'Liga Académica de Urología – LAURO', b: false }], 'left');
  } else {
    let fecha = fmtData(p.data_execucao_inicio);
    if (p.data_execucao_fim) fecha += ' al ' + fmtData(p.data_execucao_fim);
    x += parXml([{ t: 'Fecha de Ejecución: ', b: true }, { t: fecha, b: false }], 'left');
    x += parXml([{ t: 'Lugar de Ejecución: ', b: true }, { t: p.lugar_execucao || p.local || '', b: false }], 'left');
    x += parXml([{ t: 'Responsable del Proyecto: ', b: true }, { t: p.docente_responsavel || '', b: false }], 'left');
    x += parXml([{ t: 'Liga Responsable: ', b: true }, { t: 'Liga Académica de Urología – LAURO', b: false }], 'left');
  }

  x += sec('ANTECEDENTES Y JUSTIFICACIÓN DEL PROYECTO');
  for (const l of linhas(p.antecedentes)) x += parXml([{ t: l, b: false }], 'both');

  x += sec('OBJETIVO GENERAL');
  for (const l of linhas(p.objetivo_geral)) x += parXml([{ t: l, b: false }], 'both');

  x += sec('OBJETIVOS ESPECÍFICOS');
  for (const o of objEsp) x += parXml([{ t: '- ' + o, b: false }], 'both');

  if (ehEns) {
    x += sec('TEMARIO Y PROGRAMA');
    for (const t of temario) {
      x += parXml([{ t: 'Título: ', b: true }, { t: t.titulo || '', b: false }], 'left');
      x += parXml([{ t: 'Descripción del contenido: ', b: true }, { t: t.descricao || '', b: false }], 'left');
      x += parXml([{ t: 'Duración estimada: ', b: true }, { t: t.duracao_min ? (t.duracao_min + ' minutos') : '', b: false }], 'left');
      x += parXml([{ t: 'Nombre del ponente: ', b: true }, { t: t.ponente || '', b: false }], 'left');
      x += parXml([{ t: 'Perfil del ponente: ', b: true }, { t: t.perfil_ponente || '', b: false }], 'left');
      x += vazio(1);
    }
    x += sec('PÚBLICO OBJETIVO');
    x += parXml([{ t: pub.map(z => pubmap[z] || z).join(', ') + '.', b: false }], 'both');
    x += sec('METODOLOGÍA');
    for (const l of linhas(p.metodologia)) x += parXml([{ t: l, b: false }], 'both');
    x += sec('INSCRIPCIÓN');
    if (p.inscricao_gratuita) {
      x += parXml([{ t: 'Inscripción gratuita.', b: false }], 'both');
    } else {
      let vs; try { vs = Number(p.inscricao_valor || 0).toLocaleString('es-PY'); } catch (e) { vs = String(p.inscricao_valor || 0); }
      let txt = 'Inscripción con costo de Gs. ' + vs;
      if (p.inscricao_valor_brl) { try { txt += ' (R$ ' + Number(p.inscricao_valor_brl).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ')'; } catch (e) {} }
      x += parXml([{ t: txt + '.', b: false }], 'both');
    }
    if (p.inscricao_inicio) x += parXml([{ t: 'Período de inscripciones: ' + fmtData(p.inscricao_inicio) + ' al ' + fmtData(p.inscricao_fim) + '.', b: false }], 'both');
    x += sec('CRONOGRAMA');
    x += cronogramaXml(p.cronograma);
    x += sec('RECURSOS');
    for (const l of linhas(p.recursos_necessarios)) x += parXml([{ t: l, b: false }], 'both');
    x += sec('REFERENCIAS');
    for (const l of linhas(p.referencias)) x += parXml([{ t: l, b: false }], 'both');
  } else {
    x += sec('ACTIVIDADES POR REALIZAR');
    for (const l of linhas(p.atividades_realizar)) x += parXml([{ t: l, b: false }], 'both');
    x += sec('INTEGRANTES DEL PROYECTO');
    if (integrantes.length) {
      x += parXml([{ t: '- Responsable Principal: ', b: true }, { t: String(integrantes[0]), b: false }], 'left');
      if (integrantes.length > 1) {
        x += parXml([{ t: '- Equipo de Trabajo:', b: true }], 'left');
        for (const o of integrantes.slice(1)) x += parXml([{ t: '  ' + o, b: false }], 'left');
      }
    }
    x += sec('METODOLOGÍA');
    for (const l of linhas(p.metodologia)) x += parXml([{ t: l, b: false }], 'both');
    x += sec('RECURSOS NECESARIOS');
    for (const l of linhas(p.recursos_necessarios)) x += parXml([{ t: l, b: false }], 'both');
    x += sec('CRONOGRAMA');
    x += cronogramaXml(p.cronograma);
    x += sec('RESULTADOS ESPERADOS');
    for (const l of linhas(p.resultados_esperados)) x += parXml([{ t: l, b: false }], 'both');
  }

  // ASSINATURAS
  x += quebraPagina();
  x += parXml([{ t: (p.nome || '').toUpperCase(), b: true }], 'center');
  x += parXml([{ t: 'LIGA ACADÉMICA DE UROLOGÍA – LAURO', b: true }], 'center');
  // firma(nome, cargo, imgInfo) — padrão do modelo: imagem -> traço -> nome -> cargo (compacto)
  const firma = (nome, cargo, imgInfo) =>
    (imgInfo
      ? imagemAssinaturaXml(imgInfo.rId, imgInfo.w, imgInfo.h, imgInfo.id, imgInfo.nome)
      : vazio(2)) +
    parXml([{ t: '________________________________________', b: true }], 'center', SZ_CORPO, { after: 0 }) +
    parXml([{ t: nome || '(nombre)', b: true }], 'center', SZ_CORPO, { after: 0 }) +
    parXml([{ t: cargo, b: true }], 'center', SZ_CORPO, { after: 240 });
  const directorNome = p.tipo === 'extension' ? (cfg.director_extension_nome || '') : (cfg.director_ensino_nome || '');
  const F = cfg._firmas || {};
  x += firma(cfg.presidente_nome || '', 'Presidente', F.presidente);
  x += firma(directorNome, 'Director responsable del proyecto', F.director);
  x += firma(cfg.secretario_nome || '', 'Secretario', F.secretario);
  x += firma(cfg.orientador_nome || p.docente_orientador || '', 'Docente Orientador', F.orientador);

  x += quebraPagina();
  x += parXml([{ t: (p.nome || '').toUpperCase(), b: true }], 'center');
  x += parXml([{ t: 'LIGA ACADÉMICA DE UROLOGÍA – LAURO', b: true }], 'center');
  x += firma('Fernanda Carnelossi', 'Coordinación de Ligas');
  x += firma('Dra. Lilian Ramírez', 'Coordinadora de Extensión - Filial CDE');
  x += firma('Dr. Seidel Guerra', 'Coordinador General de Investigación, Extensión e Innovación – Filial CDE');
  x += firma('Dr. Sergio Marmori', 'Director de Carrera – Filial CDE');

  return x;
}

// ── função principal: gera o .docx a partir do membrete ──
// membreteBuffer: Buffer do .docx timbrado ; p: dados do projeto
// retorna Buffer do .docx final
async function gerarProjetoTimbrado(membreteBuffer, p, cfg) {
  cfg = cfg || {};
  const zip = await JSZip.loadAsync(membreteBuffer);
  const docXmlPath = 'word/document.xml';
  let docXml = await zip.file(docXmlPath).async('string');

  // Extrai o sectPr (com referências ao header/footer do timbrado) para reusar
  // Procura o sectPr de seção principal (que tem headerReference). Se houver mais de um,
  // pega o que referencia header. Senão, o último.
  const sectMatches = docXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g) || [];
  let sectPrincipal = '';
  for (const s of sectMatches) {
    if (s.indexOf('headerReference') !== -1) { sectPrincipal = s; break; }
  }
  if (!sectPrincipal && sectMatches.length) sectPrincipal = sectMatches[sectMatches.length - 1];

  // Normaliza para UMA coluna (o membrete pode vir com 2 colunas, o que espreme o texto)
  sectPrincipal = sectPrincipal.replace(/<w:cols[^>]*\/>/g, '<w:cols w:space="720"/>');
  sectPrincipal = sectPrincipal.replace(/<w:cols[^>]*>[\s\S]*?<\/w:cols>/g, '<w:cols w:space="720"/>');

  // ── Preparar as IMAGENS DE ASSINATURA da liga (se cadastradas) ──
  // Baixa do R2, injeta no pacote .docx e prepara os rId para o corpo.
  cfg._firmas = {};
  try {
    const { imagemBase64 } = require('./desligamento');
    // mapa cargo -> chave da imagem no R2
    const dirChave = p.tipo === 'extension' ? cfg.assinatura_director_extension_chave : cfg.assinatura_director_ensino_chave;
    const mapa = {
      presidente: cfg.assinatura_presidente_chave,
      director:   dirChave,
      secretario: cfg.assinatura_secretario_chave,
      orientador: cfg.assinatura_orientador_chave
    };
    // localizar/garantir o document.xml.rels e o [Content_Types].xml
    let relsPath = 'word/_rels/document.xml.rels';
    let relsXml = zip.file(relsPath) ? await zip.file(relsPath).async('string') : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    let ctPath = '[Content_Types].xml';
    let ctXml = await zip.file(ctPath).async('string');
    // garante que PNG tem content-type default
    if (ctXml.indexOf('Extension="png"') === -1) {
      ctXml = ctXml.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
    }
    let idx = 9000; // ids altos para não colidir
    for (const cargo of Object.keys(mapa)) {
      const chave = mapa[cargo];
      if (!chave) continue;
      const dataUri = await imagemBase64(chave);
      if (!dataUri) continue;
      const b64 = dataUri.split(',')[1];
      if (!b64) continue;
      const buf = Buffer.from(b64, 'base64');
      idx++;
      const nomeImg = 'firma_' + cargo + '.png';
      const mediaPath = 'word/media/' + nomeImg;
      zip.file(mediaPath, buf);
      const rId = 'rIdFirma' + idx;
      relsXml = relsXml.replace('</Relationships>',
        '<Relationship Id="' + rId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + nomeImg + '"/></Relationships>');
      // Ler dimensões REAIS do PNG (bytes 16-23: largura e altura em pixels)
      let pxW = 300, pxH = 100;
      try {
        if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') {
          pxW = buf.readUInt32BE(16);
          pxH = buf.readUInt32BE(20);
        }
      } catch (e) {}
      // Normalizar pela ALTURA (~1.7cm), preservando a proporção real de cada assinatura.
      // Isso mantém todas num tamanho harmônico e faz caber tudo numa página, sem esticar.
      const ALTURA_ALVO = Math.round(1.7 * 360000); // 1.7 cm
      const proporcao = pxW / pxH; // largura/altura real da imagem
      let h = ALTURA_ALVO;
      let w = Math.round(h * proporcao);
      // trava de segurança: se ficar largo demais (>6cm), limita pela largura
      const MAX_W = Math.round(6 * 360000);
      if (w > MAX_W) { w = MAX_W; h = Math.round(w / proporcao); }
      cfg._firmas[cargo] = { rId: rId, w: w, h: h, id: idx, nome: nomeImg };
    }
    zip.file(relsPath, relsXml);
    zip.file(ctPath, ctXml);
  } catch (e) { /* se falhar, segue sem imagens (linhas em branco) */ }

  // Monta o novo corpo
  const corpo = montarCorpo(p, cfg);

  // Novo conteúdo do <w:body>: o corpo do projeto + o sectPr principal (timbrado) no final
  const novoBody = '<w:body>' + corpo + sectPrincipal + '</w:body>';

  // Substitui o body inteiro
  docXml = docXml.replace(/<w:body>[\s\S]*<\/w:body>/, novoBody);

  zip.file(docXmlPath, docXml);
  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return out;
}

module.exports = { gerarProjetoTimbrado };
