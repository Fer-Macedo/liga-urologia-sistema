// Gera um .docx formatado nas normas ABNT ou Vancouver a partir do texto escrito/colado
// no Editor de Documento do Portal Cientifico. O arquivo e baixado pela pessoa, que revisa,
// apaga o bloco de orientacoes no final e so entao anexa a versao final no formulario de
// upload ja existente (que segue indo para avaliacao da equipe do Cientifico).
const { Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType, convertMillimetersToTwip } = require('docx');

const SECOES_CONHECIDAS = [
  'resumo', 'abstract', 'introducao', 'introdução', 'metodos', 'métodos', 'metodologia', 'metodología',
  'materiais e metodos', 'materiais e métodos', 'resultados', 'discussao', 'discussão',
  'conclusao', 'conclusão', 'referencias', 'referências'
];

function ehTituloDeSecao(paragrafo) {
  const limpo = paragrafo.trim().toLowerCase().replace(/[:.]+$/, '');
  return paragrafo.length < 60 && SECOES_CONHECIDAS.includes(limpo);
}

const ORIENTACOES = {
  abnt: [
    'ORIENTACOES ABNT — APAGUE ESTE BLOCO ANTES DE ENVIAR',
    '- Fonte Times New Roman ou Arial, tamanho 12 (notas de rodape e citacoes longas em 10).',
    '- Espacamento entre linhas de 1,5; paragrafos justificados.',
    '- Margens: superior e esquerda 3cm; inferior e direita 2cm.',
    '- Estrutura basica: Titulo, Resumo (com palavras-chave), Introducao, Desenvolvimento (Metodos/Resultados/Discussao), Conclusao, Referencias.',
    '- Citacoes no texto no formato autor-data, ex: (SILVA, 2023) ou Silva (2023).',
    '- Referencias em ordem alfabetica ao final, seguindo o padrao ABNT NBR 6023 (SOBRENOME, Nome. Titulo. Local: Editora, Ano.).',
    '- Titulos de secao em caixa alta e negrito, numerados (1 INTRODUCAO, 2 METODOS...).'
  ],
  vancouver: [
    'ORIENTACOES VANCOUVER — APAGUE ESTE BLOCO ANTES DE ENVIAR',
    '- Fonte Times New Roman ou Arial, tamanho 12, espacamento 1,5.',
    '- Estrutura IMRAD: Introduction, Methods, Results, and Discussion (em portugues: Introducao, Metodos, Resultados, Discussao), alem de Titulo, Resumo/Abstract e Referencias.',
    '- Citacoes no texto numeradas em ordem de aparicao, em sobrescrito ou entre colchetes, ex: "...reduziu a incidencia[1]."',
    '- Referencias numeradas na mesma ordem das citacoes no texto (nao alfabetica), no formato Vancouver: Autor SC. Titulo do artigo. Abreviatura da Revista. Ano;Volume(Numero):paginas.',
    '- Ate 6 autores citados por extenso; acima disso, listar os 6 primeiros seguidos de "et al."',
    '- Tabelas e figuras numeradas sequencialmente, com legenda acima (tabelas) ou abaixo (figuras).'
  ]
};

function margensPorNorma(norma) {
  if (norma === 'abnt') {
    return { top: convertMillimetersToTwip(30), left: convertMillimetersToTwip(30), bottom: convertMillimetersToTwip(20), right: convertMillimetersToTwip(20) };
  }
  return { top: convertMillimetersToTwip(25), left: convertMillimetersToTwip(25), bottom: convertMillimetersToTwip(25), right: convertMillimetersToTwip(25) };
}

async function gerarDocumentoCientifico({ titulo, texto, norma }) {
  const normaFinal = norma === 'vancouver' ? 'vancouver' : 'abnt';
  const tituloFinal = titulo || 'Trabalho Cientifico';
  const paragrafosBrutos = String(texto).split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

  const corpo = paragrafosBrutos.map(p => {
    if (ehTituloDeSecao(p)) {
      return new Paragraph({
        text: p.toUpperCase(),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 150 }
      });
    }
    return new Paragraph({
      children: [new TextRun({ text: p, size: 24 })],
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 200, line: 360 }
    });
  });

  const orientacoes = ORIENTACOES[normaFinal].map((linha, i) => new Paragraph({
    children: [new TextRun({ text: linha, bold: i === 0, italics: i !== 0, size: 20, color: '999999' })],
    spacing: { after: 100 }
  }));

  const doc = new Document({
    sections: [{
      properties: { page: { margin: margensPorNorma(normaFinal) } },
      children: [
        new Paragraph({ text: tituloFinal, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 100 } }),
        new Paragraph({ text: 'Norma: ' + (normaFinal === 'abnt' ? 'ABNT' : 'Vancouver'), alignment: AlignmentType.CENTER, spacing: { after: 400 } }),
        ...corpo,
        new Paragraph({ text: '', spacing: { before: 600, after: 200 }, border: { top: { color: '999999', space: 4, style: 'single', size: 6 } } }),
        ...orientacoes
      ]
    }]
  });
  return Packer.toBuffer(doc);
}

module.exports = { gerarDocumentoCientifico };
