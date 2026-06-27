const PDFDocument = require('pdfkit');
const doc = new PDFDocument({ size: 'A4', margin: 0 });
const textW = 595.28 - 56 - 56;
let y = 162;
const maxY = 841.89 - 99.2 - 80;
const itens = [
  ['CAPÍTULO I','bold'],['DENOMINACIÓN Y OBJETO','bold'],
  ['Artículo 1 – La Liga Académica de Urología – LAURO es una organización académica vinculada a la Universidad Central del Paraguay.','normal'],
  ['',''],['CAPÍTULO II','bold'],['DERECHOS DEL MIEMBRO','bold'],
  ['Artículo 2 – Son derechos del miembro:','bold'],
  ['1. Participar en actividades académicas, científicas y eventos organizados por LAURO.','normal'],
  ['2. Participar en asambleas con voz y voto.','normal'],
  ['3. Integrar proyectos de investigación.','normal'],
  ['4. Recibir certificación, siempre que cumpla con los requisitos mínimos.','normal'],
  ['5. Presentar propuestas, críticas y sugerencias al directorio.','normal'],
  ['',''],['CAPÍTULO III','bold'],['DEBERES Y OBLIGACIONES DEL MIEMBRO','bold'],
  ['Artículo 3 – Son obligaciones del miembro:','bold'],
  ['1. Participar activamente en las actividades de la liga.','normal'],
  ['2. Mantener una asistencia mínima del 75%, bajo pena de sanción.','normal'],
  ['3. Cumplir con las funciones asignadas en su cargo.','normal'],
  ['4. Respetar normas internas, decisiones del directorio y reglamentos vigentes.','normal'],
  ['5. Mantener conducta ética, profesional y respetuosa.','normal'],
  ['6. Registrar sus datos en plataformas académicas exigidas (ej.: ORCID).','normal'],
  ['7. Cumplir con las obligaciones financieras.','normal'],
  ['8. Conservar la imagen institucional de LAURO.','normal'],
];
for(const [txt,tipo] of itens){
  if(txt===''){y+=5;continue;}
  const font = tipo==='bold'?'Helvetica-Bold':'Helvetica';
  const alt = doc.fontSize(10).font(font).heightOfString(txt,{width:textW,lineGap:1});
  const quebra = (y+alt+40) > maxY;
  console.log((quebra?'*** QUEBRA *** ':'') + 'y='+y.toFixed(0)+' fim='+(y+alt).toFixed(0)+' maxY='+maxY.toFixed(0)+' | '+txt.substring(0,50));
  y += alt + (tipo==='bold'?3:5);
}
doc.end();
