const PDFDocument = require('pdfkit');
const fs = require('fs');
const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
const out = fs.createWriteStream('/var/www/liga-urologia/teste-margem.pdf');
doc.pipe(out);

const W = 595.28, H = 841.89;
const ML = 56, textW = W - ML - 56;
const MT = 156;
const maxY = H - 99.2; // 3.5cm do final

// Linha vermelha mostrando onde é o maxY
doc.rect(0, maxY, W, 1).fill('red');
// Linha azul mostrando onde começa o texto
doc.rect(0, MT, W, 1).fill('blue');

let y = MT;
const linhas = [
  'CAPÍTULO I','DENOMINACIÓN Y OBJETO',
  'Artículo 1° – La Liga Académica de Urología – LAURO es una organización académica vinculada a la Universidad Central del Paraguay.',
  '','CAPÍTULO II','DERECHOS DEL MIEMBRO','Artículo 2° – Son derechos del miembro:',
  '1. Participar en actividades académicas, científicas y eventos organizados por LAURO.',
  '2. Participar en asambleas con voz y voto.',
  '3. Integrar proyectos de investigación.',
  '4. Recibir certificación, siempre que cumpla con los requisitos mínimos.',
  '5. Presentar propuestas, críticas y sugerencias al directorio.',
  '','CAPÍTULO III','DEBERES Y OBLIGACIONES DEL MIEMBRO','Artículo 3° – Son obligaciones del miembro:',
  '1. Participar activamente en las actividades de la liga.',
  '2. Mantener una asistencia mínima del 75%, bajo pena de sanción.',
  '3. Cumplir con las funciones asignadas en su cargo.',
  '4. Respetar normas internas, decisiones del directorio y reglamentos vigentes.',
  '5. Mantener conducta ética, profesional y respetuosa.',
  '6. Registrar sus datos en plataformas académicas exigidas (ej.: ORCID).',
  '7. Cumplir con las obligaciones financieras.',
  '8. Conservar la imagen institucional de LAURO.',
  '','CAPÍTULO IV',
];

for (const txt of linhas) {
  if (!txt) { y += 5; continue; }
  const isBold = /^(CAPÍTULO|Artículo|DENOMINACIÓN|DERECHOS|DEBERES)/.test(txt);
  const font = isBold ? 'Helvetica-Bold' : 'Helvetica';
  const alt = doc.fontSize(10).font(font).heightOfString(txt, { width: textW, lineGap: 1 });
  if (y + alt > maxY) {
    doc.addPage({ size: 'A4', margin: 0 });
    doc.rect(0, maxY, W, 1).fill('red');
    doc.rect(0, MT, W, 1).fill('blue');
    y = MT;
  }
  doc.fontSize(10).font(font).fillColor('black').text(txt, ML, y, { width: textW, lineGap: 1 });
  y = doc.y + (isBold ? 3 : 5);
}

doc.end();
out.on('finish', () => console.log('PDF gerado: teste-margem.pdf'));
