// Gera um arquivo .docx a partir de texto puro, para o membro poder colar/escrever
// o trabalho direto na plataforma e enviar como nova versao, sem precisar abrir o
// Word por fora e depois anexar o arquivo manualmente.
const { Document, Packer, Paragraph, HeadingLevel, TextRun } = require('docx');

async function gerarDocxDeTexto(titulo, texto) {
  const paragrafos = String(texto).split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: titulo || 'Trabalho Cientifico', heading: HeadingLevel.TITLE }),
        ...paragrafos.map(p => new Paragraph({
          children: [new TextRun(p)],
          spacing: { after: 200 }
        }))
      ]
    }]
  });
  return Packer.toBuffer(doc);
}

module.exports = { gerarDocxDeTexto };
