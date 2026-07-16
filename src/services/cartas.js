// Compartilhado entre carta-cobranca e carta-notificacao: numeração/ordinal e
// geração de PDF do corpo da carta (extraídas do HTML) são idênticas nos dois.
const { query } = require('../models/database');

async function gerarPDFBuffer(html, timbradoB64, assinaturaB64, nomeAssinatura, cargoAssinatura) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 0 });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = 595.28, H = 841.89;
      const ML = 62, MR = 62, MT = 148, textW = W - ML - MR;

      // Timbrado como fundo
      if (timbradoB64) {
        try {
          const imgBuf = Buffer.from(timbradoB64.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
          doc.image(imgBuf, 0, 0, { width: W, height: H });
        } catch(e) {}
      }

      // Extrair partes do HTML com regex
      // Extrair título e subtítulo das divs específicas
      const tituloMatch = html.match(/<div class="titulo">([^<]*)<\/div>/i);
      const subtituloMatch = html.match(/<div class="subtitulo">([^<]*)<\/div>/i);
      const titulo = tituloMatch ? tituloMatch[1].trim() : 'Carta de Cobro — LAURO';
      const subtitulo = subtituloMatch ? subtituloMatch[1].trim() : 'Pago Mensual Vencido';

      // Extrair só o bloco .corpo do HTML
      const corpoMatch = html.match(/<div class="corpo">([\s\S]*?)<\/div>\s*<div class="assinaturas"/i);
      const corpoHtml = corpoMatch ? corpoMatch[1] : html;

      const corpo = corpoHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi,'')
        .replace(/<strong>([^<]+)<\/strong>/gi,'§BOLD§$1§END§')
        .replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>/gi,'\n').replace(/<\/div>/gi,'\n')
        .replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&')
        .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&[a-z]+;/gi,' ')
        .replace(/\n\s*\n\s*\n/g,'\n\n').trim();

      let y = MT;

      // Titulo
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#000').text(titulo.toUpperCase(), ML, y, { width: textW, align: 'center' });
      y += 18;
      doc.fontSize(11).font('Helvetica-Bold').text(subtitulo.toUpperCase(), ML, y, { width: textW, align: 'center' });
      y += 36;

      // Corpo com negrito inline
      const partes = corpo.split('\n');
      for (const linha of partes) {
        if (!linha.trim()) { y += 6; continue; }
        const segmentos = linha.split(/§BOLD§|§END§/);
        let x = ML;
        let primeiroSeg = true;
        const alts = [];
        for (let i = 0; i < segmentos.length; i++) {
          if (!segmentos[i]) continue;
          alts.push({ text: segmentos[i], bold: i % 2 === 1 });
        }
        // Linha simples com negrito
        if (alts.length === 1) {
          doc.fontSize(10).font('Helvetica').fillColor('#000').text(alts[0].text, ML, y, { width: textW, align: 'justify', lineGap: 2 });
          y = doc.y + 4;
        } else {
          // Linha com mistura bold/normal — renderiza toda em bold onde necessário
          const textoCompleto = alts.map(a => a.text).join('');
          const temBold = alts.some(a => a.bold);
          doc.fontSize(10).font(temBold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#000').text(textoCompleto, ML, y, { width: textW, align: 'justify', lineGap: 2 });
          y = doc.y + 4;
        }
      }

      // Assinatura
      y += 16;
      const assinX = W / 2 - 80;
      if (assinaturaB64) {
        try {
          const aBuf = Buffer.from(assinaturaB64.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
          doc.image(aBuf, assinX, y, { width: 160, height: 50, fit: [160, 50] });
          y += 54;
        } catch(e) { y += 10; }
      }
      doc.moveTo(assinX, y).lineTo(assinX + 160, y).lineWidth(1).stroke('#000');
      y += 4;
      if (nomeAssinatura) {
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#000').text(nomeAssinatura.toUpperCase(), assinX - 20, y, { width: 200, align: 'center' });
        y = doc.y + 2;
      }
      if (cargoAssinatura) {
        doc.fontSize(8).font('Helvetica').text(cargoAssinatura, assinX - 20, y, { width: 200, align: 'center' });
      }

      doc.end();
    } catch(e) { reject(e); }
  });
}

function ordinalEspanhol(n) {
  const map = ['Primera','Segunda','Tercera','Cuarta','Quinta','Sexta','Septima','Octava','Novena','Decima'];
  return n <= 10 ? map[n-1] : n + 'a';
}

async function calcularOrdinalPessoa(mid, lid, did) {
  // Conta quantas cartas (cobranca + notificacao) ja existem para essa pessoa ANTES desta
  let total = 0;
  if (mid) {
    const r1 = await query('SELECT COUNT(*) n FROM cartas_cobranca WHERE membro_id=$1',[mid]);
    const r2 = await query('SELECT COUNT(*) n FROM cartas_notificacao WHERE membro_id=$1',[mid]);
    total = parseInt(r1.rows[0].n||0) + parseInt(r2.rows[0].n||0);
  } else if (lid) {
    const r1 = await query('SELECT COUNT(*) n FROM cartas_cobranca WHERE ligante_id=$1',[lid]);
    const r2 = await query('SELECT COUNT(*) n FROM cartas_notificacao WHERE ligante_id=$1',[lid]);
    total = parseInt(r1.rows[0].n||0) + parseInt(r2.rows[0].n||0);
  } else if (did) {
    const r = await query('SELECT COUNT(*) n FROM cartas_notificacao WHERE diretivo_id=$1',[did]);
    total = parseInt(r.rows[0].n||0);
  }
  return total + 1; // +1 porque esta carta sera a proxima
}

module.exports = { gerarPDFBuffer, ordinalEspanhol, calcularOrdinalPessoa };
