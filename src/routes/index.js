const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const xss = require('xss');
async function enviarEmail({from, to, subject, html, attachments}) {
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromAddr = from || 'LAURO <lauroucpcde@lauroucpcde.com>';
  const opts = { from: fromAddr, to, subject, html };
  if(attachments && attachments.length) opts.attachments = attachments;
  console.log('ENVIANDO EMAIL opts.attachments:', opts.attachments ? opts.attachments.length : 0);
  const result = await resend.emails.send(opts);
  console.log('RESEND RAW:', JSON.stringify(result));
  return result;
}


async function gerarPDFDesvinculacao(html, timbradoB64, assinaturaPresidenteB64, assinaturaSecretarioB64, nomePresidente, nomeSecretario) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 0 });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = 595.28, H = 841.89;
      const ML = 62.4, MT = 147.4, textW = 470.5;

      // Timbrado como fundo
      if (timbradoB64) {
        try {
          const imgBuf = Buffer.from(timbradoB64.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
          doc.image(imgBuf, 0, 0, { width: W, height: H });
        } catch(e) {}
      }

      function strip(str) {
        return (str || '')
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<li[^>]*>/gi, '• ')
          .replace(/<\/li>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&[a-z]+;/gi, ' ')
          .replace(/\s+/g, ' ').trim();
      }

      // Título fixo da carta de desvinculação
      const titulo = 'CARTA DE DESVINCULACIÓN\nLIGA ACADÉMICA DE UROLOGÍA - LAURO\nUniversidad Central del Paraguay';

      // Extrair corpo — entre class="corpo"> e </div><div class="assinaturas"
      const idxCorpo = html.indexOf('class="corpo">');
      const idxCorpoFim = html.indexOf('<div class="assinaturas"', idxCorpo);
      const corpoHtml = idxCorpo > 0 && idxCorpoFim > 0
        ? html.slice(idxCorpo + 14, idxCorpoFim)
        : '';

      // Extrair todos os parágrafos e listas do corpo
      const elementos = [];
      let pos = 0;
      while (pos < corpoHtml.length) {
        // Procurar próximo <p> ou <ul>
        const pIdx = corpoHtml.indexOf('<p', pos);
        const uIdx = corpoHtml.indexOf('<ul', pos);

        if (pIdx === -1 && uIdx === -1) break;

        if (uIdx !== -1 && (pIdx === -1 || uIdx < pIdx)) {
          // É uma lista
          const endUl = corpoHtml.indexOf('</ul>', uIdx) + 5;
          const ulHtml = corpoHtml.slice(uIdx, endUl);
          // Extrair cada <li>
          const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
          let liM;
          while ((liM = liRe.exec(ulHtml)) !== null) {
            const t = strip(liM[1]);
            if (t) elementos.push('• ' + t);
          }
          pos = endUl;
        } else {
          // É um parágrafo
          const endP = corpoHtml.indexOf('</p>', pIdx) + 4;
          const pHtml = corpoHtml.slice(pIdx, endP);
          const t = strip(pHtml.replace(/<p[^>]*>/i,'').replace(/<\/p>/i,''));
          if (t) elementos.push(t);
          pos = endP;
        }
      }

      // Nomes e cargos das assinaturas diretamente dos parâmetros
      const np = (nomePresidente || 'PRESIDENTE').toUpperCase();
      const ns = (nomeSecretario || 'SECRETÁRIO').toUpperCase();

      let y = MT;

      // TÍTULO — 3 linhas: CARTA DE DESVINCULACIÓN (maior), LIGA (bold), Universidad (normal)
      const linhasTitulo = titulo.split('\n');
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#000')
        .text(linhasTitulo[0] || '', ML, y, { width: textW, align: 'center' });
      y = doc.y + 4;
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#000')
        .text(linhasTitulo[1] || '', ML, y, { width: textW, align: 'center' });
      y = doc.y + 2;
      doc.fontSize(10).font('Helvetica').fillColor('#000')
        .text(linhasTitulo[2] || '', ML, y, { width: textW, align: 'center' });
      y = doc.y + 14;

      // ELEMENTOS (parágrafos e itens de lista)
      for (const texto of elementos) {
        if (y > H - 220) break;
        const isLista = texto.startsWith('• ');
        const indent = isLista ? 10 : 0;
        doc.fontSize(11).font('Helvetica').fillColor('#000')
          .text(texto, ML + indent, y, { width: textW - indent, align: isLista ? 'left' : 'justify', lineGap: 1 });
        y = doc.y + (isLista ? 3 : 7);
      }

      // ASSINATURAS — 2 blocos lado a lado
      y += 20;
      const assinW = textW * 0.70;
      const assinX = ML + (textW - assinW) / 2;
      const colW = assinW * 0.42;
      const col1X = assinX;
      const col2X = assinX + assinW - colW;

      // Imagens
      if (assinaturaPresidenteB64) {
        try {
          const buf = Buffer.from(assinaturaPresidenteB64.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
          doc.image(buf, col1X + colW/2 - 65, y, { width: 130, height: 45, fit: [130, 45] });
        } catch(e) {}
      }
      if (assinaturaSecretarioB64) {
        try {
          const buf = Buffer.from(assinaturaSecretarioB64.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
          doc.image(buf, col2X + colW/2 - 65, y, { width: 130, height: 45, fit: [130, 45] });
        } catch(e) {}
      }
      y += 48;

      // Linhas
      doc.moveTo(col1X, y).lineTo(col1X + colW, y).lineWidth(1).stroke('#000');
      doc.moveTo(col2X, y).lineTo(col2X + colW, y).lineWidth(1).stroke('#000');
      y += 4;

      // Nomes e cargos
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#000').text(np, col1X, y, { width: colW, align: 'center' });
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#000').text(ns, col2X, y, { width: colW, align: 'center' });
      y = doc.y + 2;
      doc.fontSize(8).font('Helvetica').text('PRESIDENTE — LAURO', col1X, y, { width: colW, align: 'center' });
      doc.fontSize(8).font('Helvetica').text('SECRETÁRIO — LAURO', col2X, y, { width: colW, align: 'center' });

      doc.end();
    } catch(e) { reject(e); }
  });
}

async function gerarPDFContratoDir(d, config) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const W = 595.28, H = 841.89;
      const ML = 56, MR = 56, MT = 162, textW = W - ML - MR;
      const RODAPE = 99, maxY = H - RODAPE;
      function desenharTimbrado() {
        if (config.timbrado_b64) {
          try {
            const imgBuf = Buffer.from(config.timbrado_b64.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
            doc.image(imgBuf, 0, 0, { width: W, height: H });
          } catch(e) {}
        }
      }
      function novaPagina() { doc.addPage({ size: 'A4', margin: 0 }); desenharTimbrado(); return 142; }
      desenharTimbrado();
      let y = MT;
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#000')
        .text('CONTRATO DE DIRETIVO', ML, y, { width: textW, align: 'center' });
      y = doc.y + 2;
      doc.fontSize(11).font('Helvetica-Bold')
        .text('LIGA ACADEMICA DE UROLOGIA - LAURO', ML, y, { width: textW, align: 'center' });
      y = doc.y + 14;
      const dataIng = d.data_inicio ? new Date(d.data_inicio).toLocaleDateString('pt-BR') : '';
      doc.fontSize(10).font('Helvetica-Bold').text('DIRETIVO: ', ML, y, { continued: true });
      doc.font('Helvetica').text(d.nome || '');
      y = doc.y + 2;
      doc.font('Helvetica-Bold').text('R.G./C.I: ', ML, y, { continued: true });
      doc.font('Helvetica').text(d.rg || '');
      y = doc.y + 2;
      doc.font('Helvetica-Bold').text('Cargo: ', ML, y, { continued: true });
      doc.font('Helvetica').text(d.cargo || '');
      y = doc.y + 2;
      doc.font('Helvetica-Bold').text('Fecha de ingreso: ', ML, y, { continued: true });
      doc.font('Helvetica').text(dataIng);
      y = doc.y + 12;
      const dataFmt = new Date().toLocaleDateString('pt-BR');
      let texto = (d.texto_contrato || '')
        .replace(/\{nome\}/g, d.nome||'').replace(/\{rg\}/g, d.rg||'')
        .replace(/\{cargo\}/g, d.cargo||'').replace(/\{data\}/g, dataFmt)
        .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
        .replace(/<p[^>]*class="ql-align-center"[^>]*>/gi, '§CENTER§')
        .replace(/<p[^>]*class="ql-align-right"[^>]*>/gi, '§RIGHT§')
        .replace(/<p[^>]*>/gi, '')
        .replace(/<strong>([^<]+)<\/strong>/gi, '$1')
        .replace(/<em>([^<]+)<\/em>/gi, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/\n\s*\n\s*\n/g, '\n\n').trim();
      const linhas = texto.split('\n');
      for (const linha of linhas) {
        const isCenter = linha.startsWith('§CENTER§');
        const isRight = linha.startsWith('§RIGHT§');
        const txt = linha.replace(/§CENTER§|§RIGHT§/g, '').trim();
        if (!txt) { y += 5; continue; }
        const align = isCenter ? 'center' : isRight ? 'right' : 'justify';
        doc.fontSize(10).font('Helvetica');
        const alt = doc.heightOfString(txt, { width: textW, lineGap: 1 });
        if (y + alt > maxY) { y = novaPagina(); }
        doc.fillColor('#000').text(txt, ML, y, { width: textW, align, lineGap: 1 });
        y = doc.y + 4;
      }
      if (y + 130 > maxY) { y = novaPagina(); }
      y += 10;
      const colW = textW / 2 - 10;
      const col1X = ML, col2X = ML + colW + 20;
      const assinaturas = [
        { nome: (d.nome||'').toUpperCase(), cargo: d.cargo||'Diretivo', img: null },
        { nome: (config.presidente_nome||'PRESIDENTE').toUpperCase(), cargo: 'Presidente', img: config.assinatura_presidente_b64 }
      ];
      for (let i = 0; i < assinaturas.length; i += 2) {
        if (y > H - 80) break;
        const a1 = assinaturas[i], a2 = assinaturas[i+1];
        if (a1?.img) { try { const buf = Buffer.from(a1.img.replace(/^data:image\/[^;]+;base64,/,''),'base64'); doc.image(buf, col1X+colW/2-55, y, {width:110,height:40,fit:[110,40]}); } catch(e){} }
        if (a2?.img) { try { const buf = Buffer.from(a2.img.replace(/^data:image\/[^;]+;base64,/,''),'base64'); doc.image(buf, col2X+colW/2-55, y, {width:110,height:40,fit:[110,40]}); } catch(e){} }
        y += 43;
        doc.moveTo(col1X,y).lineTo(col1X+colW,y).lineWidth(1).stroke('#000');
        if (a2) doc.moveTo(col2X,y).lineTo(col2X+colW,y).lineWidth(1).stroke('#000');
        y += 3;
        if (a1) { doc.fontSize(8).font('Helvetica-Bold').fillColor('#000').text(a1.nome,col1X,y,{width:colW,align:'center'}); doc.fontSize(7.5).font('Helvetica').text(a1.cargo,col1X,doc.y,{width:colW,align:'center'}); }
        if (a2) { doc.fontSize(8).font('Helvetica-Bold').fillColor('#000').text(a2.nome,col2X,y,{width:colW,align:'center'}); doc.fontSize(7.5).font('Helvetica').text(a2.cargo,col2X,doc.y,{width:colW,align:'center'}); }
        y = doc.y + 10;
      }
      doc.end();
    } catch(e) { reject(e); }
  });
}


function emailBonito(titulo, corpo, logo) {
  const logoDefault = 'https://i.imgur.com/LPrFxrF.png';
  const logoUrl = logo || logoDefault;
  const logoHtml = '<img src="'+logoUrl+'" style="height:60px;object-fit:contain">';
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)"><tr><td style="background:#2b6803;padding:24px 32px;text-align:center">'+logoHtml+'</td></tr><tr><td style="padding:32px"><h2 style="color:#2b6803;font-size:18px;margin:0 0 20px 0;border-bottom:2px solid #2b6803;padding-bottom:10px">'+titulo+'</h2><div style="color:#333;font-size:14px;line-height:1.7">'+corpo+'</div><div style="margin-top:32px;padding-top:20px;border-top:1px solid #eee;text-align:center;color:#888;font-size:12px"><p style="margin:0">LAURO — Liga Académica de Urología</p><p style="margin:4px 0">Universidad Central del Paraguay — Ciudad del Este</p><p style="margin:4px 0">lauroucpcde@lauroucpcde.com</p></div></td></tr></table></td></tr></table></body></html>';
}


async function gerarPDFDesligamento(html, timbradoB64, assinaturaPresidenteB64, assinaturaSecretarioB64, nomePresidente, nomeSecretario) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 0 });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = 595.28, H = 841.89;
      const ML = 62.4, MT = 147.4, textW = 470.5;

      // Timbrado como fundo
      if (timbradoB64) {
        try {
          const imgBuf = Buffer.from(timbradoB64.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
          doc.image(imgBuf, 0, 0, { width: W, height: H });
        } catch(e) {}
      }

      function strip(str) {
        return (str || '')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&[a-z]+;/gi, ' ').trim();
      }

      // Extrair título
      const tituloMatch = html.match(/class="titulo"[^>]*>([^<]*)</i);
      const titulo = (tituloMatch ? tituloMatch[1].trim() : 'CARTA DE RESCISIÓN DE LA LIGA ACADÉMICA DE UROLOGÍA').toUpperCase();

      // Extrair data
      const dataMatch = html.match(/class="data"[^>]*>([^<]*)</i);
      const dataTexto = dataMatch ? dataMatch[1].trim() : '';

      // Extrair parágrafos — texto limpo SEM tags, strong vira texto normal
      const corpoMatch = html.match(/class="corpo"[^>]*>([\s\S]*?)<div class="data"/i);
      const corpoHtml = corpoMatch ? corpoMatch[1] : '';
      const pTags = corpoHtml.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];

      // Extrair nome membro do primeiro strong
      const nomeMembroMatch = html.match(/<strong>([^<]+)<\/strong>/i);
      const nomeMembro = nomeMembroMatch ? nomeMembroMatch[1].trim().toUpperCase() : '';

      // Extrair cargo do membro — pegar o texto dentro do primeiro assinatura-cargo
      let cargoMembro = 'LIGANTE\nEstudiante de Medicina – UCP';
      const allCargos = [...html.matchAll(/class="assinatura-cargo"[^>]*>([\s\S]*?)<\/div>/gi)];
      if (allCargos.length > 0) {
        cargoMembro = strip(allCargos[0][1]);
      }

      let y = MT;

      // TÍTULO centralizado bold
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#000')
        .text(titulo, ML, y, { width: textW, align: 'center' });
      y = doc.y + 12;

      // PARÁGRAFOS — texto limpo, fonte normal, SEM tentar inline bold
      for (const p of pTags) {
        if (y > H - 260) break;
        const textoLimpo = strip(p.replace(/<p[^>]*>/i,'').replace(/<\/p>/i,''));
        if (!textoLimpo) continue;
        doc.fontSize(11).font('Helvetica').fillColor('#000')
          .text(textoLimpo, ML, y, { width: textW, align: 'justify', lineGap: 1 });
        y = doc.y + 7;
      }

      // DATA à direita
      y += 4;
      if (dataTexto) {
        doc.fontSize(10).font('Helvetica').fillColor('#000')
          .text(dataTexto, ML, y, { width: textW, align: 'right' });
        y = doc.y + 16;
      }

      // ASSINATURAS — 3 blocos verticais centralizados
      const assinW = textW * 0.70;
      const assinX = ML + (textW - assinW) / 2;

      const blocos = [
        { nome: nomeMembro, cargo: cargoMembro, img: null },
        { nome: (nomePresidente || 'PRESIDENTE').toUpperCase(), cargo: 'PRESIDENTE', img: assinaturaPresidenteB64 },
        { nome: (nomeSecretario || 'SECRETÁRIO').toUpperCase(), cargo: 'SECRETÁRIO', img: assinaturaSecretarioB64 }
      ];

      for (const bloco of blocos) {
        if (y > H - 80) break;
        if (bloco.img) {
          try {
            const aBuf = Buffer.from(bloco.img.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
            doc.image(aBuf, assinX + assinW / 2 - 65, y, { width: 130, height: 50, fit: [130, 50] });
          } catch(e) {}
        }
        y += 54;
        doc.moveTo(assinX, y).lineTo(assinX + assinW, y).lineWidth(1).stroke('#000');
        y += 4;
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#000')
          .text(bloco.nome, assinX, y, { width: assinW, align: 'center' });
        y = doc.y + 2;
        doc.fontSize(8).font('Helvetica').fillColor('#000')
          .text(bloco.cargo, assinX, y, { width: assinW, align: 'center' });
        y = doc.y + 12;
      }

      doc.end();
    } catch(e) { reject(e); }
  });
}


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
        .replace(/<strong>([^<]+)<\/strong>/gi,'\u00a7BOLD\u00a7$1\u00a7END\u00a7')
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

const router = express.Router();

// ─── SEGURANÇA ────────────────────────────────────────────────────────────────
router.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Rate limit geral
const limiterGeral = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: 'Muitas requisições. Tente novamente em 15 minutos.',
  standardHeaders: true,
  legacyHeaders: false
});
router.use(limiterGeral);

// Rate limit para login
const limiterLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Muitas tentativas de login. Aguarde 15 minutos.'
});

// Sanitiza inputs contra XSS
router.use((req, res, next) => {
  if (req.body) {
    for (const key in req.body) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = xss(req.body[key]);
      }
    }
  }
  next();
});
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const dayjs = require('dayjs');
const { query } = require('../models/database');
const { requireAuth, requireAdmin, requireFinanceiro, requireSecretaria, requirePermissao } = require('../middleware/auth');
const { criarCobranca, consultarPagamento, criarPixEvento, processarWebhook } = require('../services/pagbank');
const { notificarCobranca } = require('../services/notificacoes');

// ─── LOG DE ATIVIDADES ───────────────────────────────────────────────────────
async function logAtividade(usuarioId, acao, detalhes, req) {
  try {
    const ip = req ? (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '') : '';
    const userAgent = req ? (req.headers['user-agent'] || '') : '';
    await query(
      'INSERT INTO log_atividades (usuario_id, acao, detalhes, ip, user_agent) VALUES ($1,$2,$3,$4,$5)',
      [usuarioId, acao, detalhes, ip.substring(0,50), userAgent.substring(0,200)]
    );
  } catch(e) { /* silencioso */ }
}

async function getConfig() {
  const r = await query('SELECT chave, valor FROM configuracoes');
  const cfg = {};
  r.rows.forEach(row => { cfg[row.chave] = row.valor; });
  return cfg;
}

// ─── PROTEÇÃO FORÇA BRUTA ─────────────────────────────────────────────────────
const tentativas = {};

function verificarBloqueio(ip) {
  const t = tentativas[ip];
  if (!t) return false;
  if (t.bloqueadoAte && new Date() < t.bloqueadoAte) return true;
  if (t.bloqueadoAte && new Date() >= t.bloqueadoAte) { delete tentativas[ip]; return false; }
  return false;
}

function registrarTentativa(ip) {
  if (!tentativas[ip]) tentativas[ip] = { count: 0 };
  tentativas[ip].count++;
  if (tentativas[ip].count >= 5) {
    tentativas[ip].bloqueadoAte = new Date(Date.now() + 15 * 60 * 1000);
    console.warn('IP bloqueado por tentativas: ' + ip);
  }
}

function limparTentativas(ip) { delete tentativas[ip]; }

// ─── TOKENS RECUPERAÇÃO SENHA ─────────────────────────────────────────────────
const tokensSenha = {}; // { token: { userId, expira } }

// ─── AUTH ─────────────────────────────────────────────────────────────────────

router.get('/', (req, res) => res.redirect('/dashboard'));

router.get('/login', async (req, res) => {
  if (req.session?.usuario) return res.redirect('/dashboard');
  res.render('pages/login', { config: await getConfig(), erro: req.flash('erro'), msg: req.flash('msg') });
});

router.post('/login', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;

  if (verificarBloqueio(ip)) {
    req.flash('erro', 'Muitas tentativas incorretas. Aguarde 15 minutos.');
    return res.redirect('/login');
  }

  const { email, senha } = req.body;

  if (!email || !senha || email.length > 100 || senha.length > 100) {
    req.flash('erro', 'Dados inválidos.');
    return res.redirect('/login');
  }

  const r = await query('SELECT * FROM usuarios WHERE email = $1 AND ativo = 1', [email.toLowerCase().trim()]);
  const usuario = r.rows[0];

  if (!usuario || !bcrypt.compareSync(senha, usuario.senha)) {
    registrarTentativa(ip);
    const t = tentativas[ip];
    const restantes = t ? Math.max(0, 5 - t.count) : 5;
    req.flash('erro', 'E-mail ou senha incorretos. ' + (restantes > 0 ? restantes + ' tentativas restantes.' : 'IP bloqueado por 15 minutos.'));
    return res.redirect('/login');
  }

  limparTentativas(ip);
  console.log('LOGIN: ' + usuario.email + ' | IP: ' + ip + ' | ' + new Date().toISOString());

  const dadosUsuario = { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil };

  req.session.regenerate((err) => {
    if (err) console.error('Session regenerate erro:', err);
    req.session.usuario = dadosUsuario;
    res.redirect('/dashboard');
  });
});

router.get('/logout', (req, res) => {
  console.log('LOGOUT: ' + (req.session?.usuario?.email || '?') + ' | ' + new Date().toISOString());
  req.session.destroy();
  res.redirect('/login');
});

// ─── RECUPERAÇÃO DE SENHA ─────────────────────────────────────────────────────

router.get('/recuperar-senha', async (req, res) => {
  res.render('pages/recuperar-senha', {
    config: await getConfig(), enviado: false,
    msg: req.flash('msg'), erro: req.flash('erro')
  });
});

router.post('/recuperar-senha', async (req, res) => {
  const config = await getConfig();
  const email = (req.body.email || '').toLowerCase().trim();
  const r = await query('SELECT * FROM usuarios WHERE email=$1 AND ativo=1', [email]);
  const usuario = r.rows[0];

  if (usuario) {
    const token = crypto.randomBytes(32).toString('hex');
    tokensSenha[token] = { userId: usuario.id, expira: new Date(Date.now() + 30 * 60 * 1000) };

    const { enviarEmail } = require('../services/notificacoes');
    const appUrl = process.env.APP_URL || 'https://liga-urologia.onrender.com';
    const link = appUrl + '/nova-senha?token=' + token;
    const orgNome = config.org_nome || 'Liga Academica de Urologia';

    await enviarEmail({
      para: usuario.email,
      assunto: 'Recuperação de senha — ' + orgNome,
      texto: 'Clique no link para redefinir sua senha:\n' + link + '\n\nExpira em 30 minutos.',
      html: '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:30px"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden"><div style="background:#1a56db;padding:24px 32px"><h1 style="color:white;margin:0;font-size:20px">' + orgNome + '</h1></div><div style="padding:32px"><h2 style="margin:0 0 16px">Recuperação de senha</h2><p style="color:#444;margin:0 0 24px">Olá, <strong>' + usuario.nome + '</strong>!<br><br>Clique no botão abaixo para criar uma nova senha:</p><div style="text-align:center;margin:24px 0"><a href="' + link + '" style="display:inline-block;background:#1a56db;color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold">🔒 Redefinir minha senha</a></div><p style="color:#888;font-size:12px">Este link expira em <strong>30 minutos</strong>.<br>Se não solicitou, ignore este e-mail.</p></div></div></body></html>'
    });

    console.log('RECUPERACAO SENHA: ' + email + ' | ' + new Date().toISOString());
  }

  res.render('pages/recuperar-senha', { config, enviado: true, msg: [], erro: [] });
});

router.get('/nova-senha', async (req, res) => {
  const config = await getConfig();
  const token = req.query.token || '';
  const dados = tokensSenha[token];
  const tokenValido = !!(dados && new Date() < dados.expira);
  res.render('pages/nova-senha', { config, token, tokenValido, erro: req.flash('erro') });
});

router.post('/nova-senha', async (req, res) => {
  const config = await getConfig();
  const { token, nova_senha, confirmar_senha } = req.body;
  const dados = tokensSenha[token];

  if (!dados || new Date() > dados.expira) {
    req.flash('erro', 'Link expirado ou inválido. Solicite um novo.');
    return res.redirect('/recuperar-senha');
  }
  if (nova_senha !== confirmar_senha) {
    return res.render('pages/nova-senha', { config, token, tokenValido: true, erro: ['As senhas não coincidem.'] });
  }
  if (nova_senha.length < 8) {
    return res.render('pages/nova-senha', { config, token, tokenValido: true, erro: ['A senha deve ter pelo menos 8 caracteres.'] });
  }

  await query('UPDATE usuarios SET senha=$1 WHERE id=$2', [bcrypt.hashSync(nova_senha, 10), dados.userId]);
  delete tokensSenha[token];

  console.log('SENHA REDEFINIDA: userId ' + dados.userId + ' | ' + new Date().toISOString());
  req.flash('msg', 'Senha redefinida com sucesso! Faça login com a nova senha.');
  res.redirect('/login');
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

router.get('/dashboard', requireAuth, async (req, res) => {
  const config = await getConfig();
  const hoje = dayjs();
  const mes = hoje.format('YYYY-MM');
  const mesStr = '%-' + mes;
  const [total, pagos, pendentes, atrasados, recTot, pendTot, atrTot, recentes, aniversariantes] = await Promise.all([
    query("SELECT COUNT(*) n FROM membros WHERE ativo=1"),
    query("SELECT COUNT(*) n FROM cobrancas WHERE status='pago' AND referencia LIKE $1", [mesStr]),
    query("SELECT COUNT(*) n FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='pendente' AND c.referencia LIKE $1 AND m.ativo=1", [mesStr]),
    query("SELECT COUNT(*) n FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='atrasado' AND m.ativo=1"),
    query("SELECT COALESCE(SUM(valor_desconto),0) v FROM cobrancas WHERE status='pago' AND referencia LIKE $1", [mesStr]),
    query("SELECT COALESCE(SUM(valor_cheio),0) v FROM cobrancas WHERE status='pendente' AND referencia LIKE $1", [mesStr]),
    query("SELECT COALESCE(SUM(valor_cheio),0) v FROM cobrancas WHERE status='atrasado'"),
    query("SELECT c.*, m.nome FROM cobrancas c JOIN membros m ON m.id=c.membro_id ORDER BY c.criado_em DESC LIMIT 8"),
    query("SELECT * FROM (SELECT nome, whatsapp, data_nascimento::text, TO_CHAR(data_nascimento::date,'MM-DD') as aniv, 'membro' as tipo FROM membros WHERE ativo=1 AND data_nascimento IS NOT NULL UNION ALL SELECT nome, whatsapp, data_nascimento::text, TO_CHAR(data_nascimento::date,'MM-DD') as aniv, 'diretivo' as tipo FROM diretivos WHERE ativo=1 AND data_nascimento IS NOT NULL) t ORDER BY CASE WHEN aniv >= TO_CHAR(NOW(),'MM-DD') THEN 0 ELSE 1 END, aniv LIMIT 8")
  ]);

  const stats = {
    total: total.rows[0].n, pagos: pagos.rows[0].n, pendentes: pendentes.rows[0].n,
    atrasados: atrasados.rows[0].n, totalRecebido: recTot.rows[0].v,
    totalPendente: pendTot.rows[0].v, totalAtrasado: atrTot.rows[0].v
  };

  res.render('pages/dashboard', {
    config, usuario: req.session.usuario, stats,
    recentes: recentes.rows, aniversariantes: aniversariantes.rows,
    dayjs, msg: req.flash('msg'), erro: req.flash('erro')
  });
});

// ─── MEMBROS ──────────────────────────────────────────────────────────────────

router.get('/membros', requireAuth, requirePermissao('membros'), async (req, res) => {
  const config = await getConfig();
  const filtro = req.query.filtro || 'todos';
  let where = '';
  if (filtro === 'ativos') where = 'WHERE m.ativo=1';
  else if (filtro === 'inativos') where = 'WHERE m.ativo=0';
  const [membros, statsR] = await Promise.all([
    query('SELECT m.*, (SELECT status FROM cobrancas WHERE membro_id=m.id ORDER BY criado_em DESC LIMIT 1) as ultimo_status FROM membros m ' + where + ' ORDER BY m.nome'),
    query(`SELECT
      COUNT(*) as total,
      SUM(CASE WHEN m.ativo=1 THEN 1 ELSE 0 END) as ativos,
      SUM(CASE WHEN m.ativo=0 THEN 1 ELSE 0 END) as inativos,
      SUM(CASE WHEN m.ativo=1 AND (SELECT status FROM cobrancas WHERE membro_id=m.id ORDER BY criado_em DESC LIMIT 1) IN ('pago','em_dia') THEN 1 ELSE 0 END) as em_dia,
      SUM(CASE WHEN m.ativo=1 AND (SELECT status FROM cobrancas WHERE membro_id=m.id ORDER BY criado_em DESC LIMIT 1) = 'atrasado' THEN 1 ELSE 0 END) as atrasados
      FROM membros m`)
  ]);
  const st = statsR.rows[0];
  res.render('pages/membros', {
    config, usuario: req.session.usuario, membros: membros.rows, filtro,
    msg: req.flash('msg'), erro: req.flash('erro'),
    total: parseInt(st.total)||0,
    ativos: parseInt(st.ativos)||0,
    inativos: parseInt(st.inativos)||0,
    emDia: parseInt(st.em_dia)||0,
    atrasados: parseInt(st.atrasados)||0
  });
});

router.post('/membros', requireAuth, requireFinanceiro, async (req, res) => {
  const { nome, cpf, email, whatsapp, data_nascimento, dia_vencimento, mensalidade, desconto_pontualidade, observacoes } = req.body;
  await query(
    'INSERT INTO membros (nome,cpf,email,whatsapp,data_nascimento,dia_vencimento,mensalidade,desconto_pontualidade,observacoes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [nome, cpf||null, email||null, whatsapp||null, data_nascimento||null, parseInt(dia_vencimento)||5, parseFloat(mensalidade)||100, parseFloat(desconto_pontualidade)||10, observacoes||null]
  );
  req.flash('msg', 'Membro ' + nome + ' cadastrado!');
  res.redirect('/membros');
});

router.get('/membros/:id/editar', requireAuth, requireFinanceiro, async (req, res) => {
  const config = await getConfig();
  const r = await query('SELECT * FROM membros WHERE id=$1', [req.params.id]);
  const membro = r.rows[0];
  if (!membro) return res.redirect('/membros');
  res.render('pages/membro-editar', { config, usuario: req.session.usuario, membro, msg: req.flash('msg'), erro: req.flash('erro') });
});

router.post('/membros/:id/editar', requireAuth, requireFinanceiro, async (req, res) => {
  const { nome, cpf, email, whatsapp, data_nascimento, dia_vencimento, mensalidade, desconto_pontualidade, ativo, observacoes, motivo_inativacao } = req.body;
  const membroAtual = await query('SELECT ativo FROM membros WHERE id=$1', [req.params.id]);
  const eraAtivo = membroAtual.rows[0]?.ativo;
  const novoAtivo = (ativo === '1' || ativo === 1) ? 1 : 0;
  await query(
    'UPDATE membros SET nome=$1,cpf=$2,email=$3,whatsapp=$4,data_nascimento=$5,dia_vencimento=$6,mensalidade=$7,desconto_pontualidade=$8,ativo=$9,observacoes=$10 WHERE id=$11',
    [nome, cpf||null, email||null, whatsapp||null, data_nascimento||null, parseInt(dia_vencimento)||15, parseFloat(mensalidade)||100, parseFloat(desconto_pontualidade)||10, novoAtivo, observacoes||null, req.params.id]
  );
  if (eraAtivo == 1 && novoAtivo === 0) {
    await query("UPDATE cobrancas SET status='cancelado' WHERE membro_id=$1 AND status IN ('pendente','atrasado')", [req.params.id]);
    if (motivo_inativacao) {
      await query('INSERT INTO inativacoes_log (tipo, referencia_id, motivo, usuario_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', ['membro', req.params.id, motivo_inativacao, req.session.usuario.id]).catch(()=>{});
    }
  }
  req.flash('msg', novoAtivo === 0 ? 'Membro inativado e cobranças pendentes canceladas!' : 'Membro atualizado!');
  res.redirect('/membros');
});

// ─── COBRANÇAS ─────────────────────────────────────────────────────────────────

router.get('/cobrancas', requireAuth, requirePermissao('cobrancas'), async (req, res) => {
  const config = await getConfig();
  const filtro = req.query.filtro || 'todas';
  let where = '';
  if (filtro === 'pagas') where = "WHERE c.status='pago' AND m.ativo=1";
  else if (filtro === 'pendentes') where = "WHERE c.status='pendente' AND m.ativo=1";
  else if (filtro === 'atrasadas') where = "WHERE c.status='atrasado' AND m.ativo=1";
  else where = "WHERE m.ativo=1"; // todas — só membros ativos
  const r = await query(
    'SELECT c.*, m.nome, m.whatsapp, m.email FROM cobrancas c JOIN membros m ON m.id=c.membro_id ' + where + ' ORDER BY c.data_vencimento DESC LIMIT 100'
  );
  res.render('pages/cobrancas', { config, usuario: req.session.usuario, cobrancas: r.rows, filtro, dayjs, msg: req.flash('msg'), erro: req.flash('erro') });
});

router.post('/cobrancas/:id/confirmar', requireAuth, requireFinanceiro, async (req, res) => {
  try {
    await query("UPDATE cobrancas SET status='pago', data_pagamento=NOW() WHERE id=$1 AND status!='pago'", [req.params.id]);
    req.session.msg = ['Pagamento confirmado manualmente!'];
  } catch(e) { req.session.erro = ['Erro ao confirmar: '+e.message]; }
  const ref = req.headers.referer || '/cobrancas';
  res.redirect(ref);
});

router.post('/cobrancas/:id/pago', requireAuth, requireFinanceiro, async (req, res) => {
  await query("UPDATE cobrancas SET status='pago', data_pagamento=NOW() WHERE id=$1", [req.params.id]);
  req.flash('msg', 'Pagamento registrado!');
  res.redirect('/cobrancas');
});

router.post('/cobrancas/:id/notificar', requireAuth, requireFinanceiro, async (req, res) => {
  const config = await getConfig();
  const r = await query('SELECT c.*, m.* FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.id=$1', [req.params.id]);
  const cob = r.rows[0];
  if (!cob) return res.redirect('/cobrancas');
  const tipo = dayjs(cob.data_vencimento).isBefore(dayjs()) ? 'pos' : 'dia';
  await notificarCobranca({ membro: cob, cobranca: cob, tipo, config });
  req.flash('msg', 'Notificação enviada!');
  res.redirect('/cobrancas');
});

router.post('/cobrancas/gerar', requireAuth, requireFinanceiro, async (req, res) => {
  const { gerarCobrancasMes } = require('../services/agendamentos');
  await gerarCobrancasMes();
  req.flash('msg', 'Cobranças do mês geradas!');
  res.redirect('/cobrancas');
});

router.post('/cobrancas/nova', requireAuth, requireFinanceiro, async (req, res) => {
  const { membro_id, referencia, valor_cheio, valor_desconto, data_vencimento } = req.body;
  const mr = await query('SELECT * FROM membros WHERE id=$1', [membro_id]);
  const membro = mr.rows[0];
  if (!membro) { req.flash('erro', 'Membro não encontrado'); return res.redirect('/cobrancas'); }
  const pag = await criarCobranca({ membro, valor: parseFloat(valor_desconto), vencimento: data_vencimento, referencia });
  await query(
    'INSERT INTO cobrancas (membro_id,referencia,valor_cheio,valor_desconto,data_vencimento,pagbank_charge_id,pagbank_link) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [membro_id, referencia, parseFloat(valor_cheio), parseFloat(valor_desconto), data_vencimento, pag.charge_id||null, pag.link||null]
  );
  req.flash('msg', 'Cobrança criada!');
  res.redirect('/cobrancas');
});

// ─── ANIVERSÁRIOS ─────────────────────────────────────────────────────────────

router.get('/aniversarios', requireAuth, requirePermissao('aniversarios'), async (req, res) => {
  const config = await getConfig();
  const hoje = dayjs().format('MM-DD');
  const r = await query(
    "SELECT * FROM (SELECT nome, whatsapp, data_nascimento::text, TO_CHAR(data_nascimento::date,'MM-DD') as md, TO_CHAR(data_nascimento::date,'MM-DD') as aniv, 'membro' as tipo FROM membros WHERE ativo=1 AND data_nascimento IS NOT NULL UNION ALL SELECT nome, whatsapp, data_nascimento::text, TO_CHAR(data_nascimento::date,'MM-DD') as md, TO_CHAR(data_nascimento::date,'MM-DD') as aniv, 'diretivo' as tipo FROM diretivos WHERE ativo=1 AND data_nascimento IS NOT NULL) t ORDER BY md"
  );
  res.render('pages/aniversarios', { config, usuario: req.session.usuario, aniversariantes: r.rows, hoje, dayjs, msg: req.flash('msg') });
});

// ─── NOTIFICAÇÕES ──────────────────────────────────────────────────────────────

router.get('/notificacoes', requireAuth, requirePermissao('notificacoes'), async (req, res) => {
  res.render('pages/notificacoes', { config: await getConfig(), usuario: req.session.usuario, msg: req.flash('msg') });
});

router.post('/notificacoes', requireAuth, requireAdmin, async (req, res) => {
  const campos = ['notif_pre_ativo','notif_dia_ativo','notif_pos1_ativo','notif_pos7_ativo','notif_aniversario_ativo',
    'msg_cobranca_pre','msg_cobranca_dia','msg_cobranca_pos','msg_aniversario'];
  for (const c of campos) {
    const val = req.body[c] !== undefined ? (req.body[c] === 'on' ? '1' : req.body[c]) : '0';
    await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', [c, val]);
  }
  req.flash('msg', 'Configurações salvas!');
  res.redirect('/notificacoes');
});

// ─── CONFIGURAÇÕES ─────────────────────────────────────────────────────────────

router.get('/configuracoes', requireAuth, requirePermissao('configuracoes'), async (req, res) => {
  res.render('pages/configuracoes', { config: await getConfig(), usuario: req.session.usuario, msg: req.flash('msg'), erro: req.flash('erro') });
});

router.post('/configuracoes', requireAuth, requireAdmin, async (req, res) => {
  const campos = ['org_nome','org_cor','mensalidade_padrao','desconto_padrao','dia_vencimento_padrao','multa_atraso','presidente_nome','vicepresidente_nome','secretario_nome','financeiro_nome'];
  for (const c of campos) {
    if (req.body[c] !== undefined) {
      await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', [c, req.body[c]]);
    }
  }
  const camposNotif = ['notif_pre_ativo','notif_dia_ativo','notif_pos1_ativo','notif_aniversario_ativo',
    'msg_cobranca_pre','msg_cobranca_dia','msg_cobranca_pos','msg_aniversario'];
  for (const c of camposNotif) {
    if (req.body[c] !== undefined) {
      const val = req.body[c] === 'on' ? '1' : req.body[c];
      await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', [c, val]);
    }
  }
  const {upload:upCfg, uploadArquivo:upArqCfg} = require('../services/arquivos');
  upCfg.fields([{name:'assinatura_presidente'},{name:'assinatura_vicepresidente'},{name:'assinatura_secretario'},{name:'assinatura_financeiro'},{name:'timbrado'}])(req, res, async(err)=>{
    for(const campo of ['assinatura_presidente','assinatura_vicepresidente','assinatura_secretario','assinatura_financeiro','timbrado']){
      if(req.files && req.files[campo] && req.files[campo][0]){
        const ff=req.files[campo][0];
        const r=await upArqCfg(ff.buffer,ff.originalname,ff.mimetype,campo);
        await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2',[campo+'_chave',r.chave]);
      }
    }
    req.flash('msg', 'Configurações salvas!');
    res.redirect('/configuracoes');
  });
});

router.post('/configuracoes/logo-url', requireAuth, requireAdmin, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.json({ ok: false });
  await query("INSERT INTO configuracoes (chave,valor) VALUES ('org_logo',$1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [url]);
  res.json({ ok: true });
});

// ─── USUÁRIOS ──────────────────────────────────────────────────────────────────

router.post('/usuarios/:id/toggle', requireAuth, requireAdmin, async (req, res) => {
  const r = await query('SELECT * FROM usuarios WHERE id=$1', [req.params.id]);
  const u = r.rows[0];
  if (u && u.perfil !== 'admin') {
    await query('UPDATE usuarios SET ativo=$1 WHERE id=$2', [u.ativo ? 0 : 1, u.id]);
  }
  res.redirect('/usuarios');
});

router.post('/usuarios/:id/senha', requireAuth, requireAdmin, async (req, res) => {
  const hash = bcrypt.hashSync(req.body.nova_senha, 10);
  await query('UPDATE usuarios SET senha=$1 WHERE id=$2', [hash, req.params.id]);
  req.flash('msg', 'Senha alterada!');
  res.redirect('/usuarios');
});

// ─── MEU PERFIL ───────────────────────────────────────────────────────────────

router.post('/minha-senha', requireAuth, async (req, res) => {
  const { senha_atual, nova_senha, confirmar_senha } = req.body;

  if (!nova_senha || nova_senha.length < 8) {
    req.flash('erro', 'A nova senha deve ter pelo menos 8 caracteres.');
    return res.redirect('/dashboard');
  }
  if (nova_senha !== confirmar_senha) {
    req.flash('erro', 'A nova senha e a confirmação não coincidem.');
    return res.redirect('/dashboard');
  }

  const r = await query('SELECT * FROM usuarios WHERE id=$1', [req.session.usuario.id]);
  const usuario = r.rows[0];

  if (!usuario || !bcrypt.compareSync(senha_atual, usuario.senha)) {
    req.flash('erro', 'Senha atual incorreta.');
    return res.redirect('/dashboard');
  }

  const novoHash = bcrypt.hashSync(nova_senha, 10);
  await query('UPDATE usuarios SET senha=$1 WHERE id=$2', [novoHash, usuario.id]);

  console.log('SENHA ALTERADA: ' + usuario.email + ' | ' + new Date().toISOString());
  req.flash('msg', 'Senha alterada com sucesso! Faça login novamente.');
  req.session.destroy();
  res.redirect('/login');
});

router.post('/meu-email', requireAuth, async (req, res) => {
  const { novo_email, senha_confirmacao } = req.body;

  if (!novo_email || !novo_email.includes('@')) {
    req.flash('erro', 'E-mail inválido.');
    return res.redirect('/dashboard');
  }

  const r = await query('SELECT * FROM usuarios WHERE id=$1', [req.session.usuario.id]);
  const usuario = r.rows[0];

  if (!usuario || !bcrypt.compareSync(senha_confirmacao, usuario.senha)) {
    req.flash('erro', 'Senha incorreta. Não foi possível alterar o e-mail.');
    return res.redirect('/dashboard');
  }

  const emailExiste = await query('SELECT id FROM usuarios WHERE email=$1 AND id!=$2', [novo_email.toLowerCase().trim(), usuario.id]);
  if (emailExiste.rows.length > 0) {
    req.flash('erro', 'Este e-mail já está em uso.');
    return res.redirect('/dashboard');
  }

  await query('UPDATE usuarios SET email=$1 WHERE id=$2', [novo_email.toLowerCase().trim(), usuario.id]);
  req.session.usuario.email = novo_email.toLowerCase().trim();

  console.log('EMAIL ALTERADO: ' + usuario.email + ' -> ' + novo_email + ' | ' + new Date().toISOString());
  req.flash('msg', 'E-mail alterado com sucesso!');
  res.redirect('/dashboard');
});

// ─── WEBHOOK MERCADO PAGO (mantido para pagamentos existentes) ────────────────

router.post('/webhook/mercadopago', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    let body;
    try { body = JSON.parse(req.body.toString()); }
    catch (e) { return res.sendStatus(200); }

    console.log('MP Webhook:', JSON.stringify(body).substring(0, 200));

    if (body.type === 'payment' && body.data?.id) {
      const paymentId = body.data.id;
      const { consultarPagamento: consultarMP } = require('../services/mercadopago');
      const result = await consultarMP(paymentId);

      if (result.ok && result.status === 'approved') {
        const ref = result.data.external_reference;
        if (ref) {
          const r = await query(
            "UPDATE cobrancas SET status='pago', data_pagamento=NOW(), mp_payment_id=$1 WHERE referencia=$2 AND status!='pago'",
            [String(paymentId), ref]
          );
          if (r.rowCount > 0) console.log('MP Pagamento confirmado:', ref, paymentId);
        }
      }
    }
  } catch (e) { console.error('MP Webhook erro:', e.message); }
  res.sendStatus(200);
});

// ─── WEBHOOK PAGBANK ──────────────────────────────────────────────────────────

router.post('/webhook/pagbank', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    let body;
    try { body = JSON.parse(req.body.toString()); }
    catch (e) { return res.sendStatus(200); }

    console.log('PagBank Webhook recebido:', JSON.stringify(body).substring(0, 300));

    const { orderId, referencia, status, pago } = processarWebhook(body);

    if (!referencia) return res.sendStatus(200);

    // Pagamento de MENSALIDADE
    if (pago && referencia.startsWith('mensalidade-')) {
      const r = await query(
        "UPDATE cobrancas SET status='pago', data_pagamento=NOW(), pagbank_charge_id=$1 WHERE referencia=$2 AND status!='pago' RETURNING id",
        [orderId, referencia]
      );
      if (r.rowCount > 0) console.log('PagBank mensalidade confirmada:', referencia, orderId);
    }

    // Pagamento de INGRESSO DE EVENTO
    if (pago && referencia.startsWith('evento-insc-')) {
      const partes = referencia.split('-');
      const inscricaoId = partes[2];
      if (inscricaoId) {
        const upd = await query(
          "UPDATE evento_inscricoes SET status='confirmado' WHERE id=$1 AND status!='confirmado' RETURNING id",
          [inscricaoId]
        );
        await query(
          "UPDATE evento_pagamentos SET status='pago', pago_em=NOW(), pagbank_order_id=$1 WHERE inscricao_id=$2 AND status!='pago'",
          [orderId, inscricaoId]
        );
        // Enviar email de confirmação apenas se acabou de confirmar (evita duplicado)
        if (upd.rowCount > 0) {
          await enviarEmailConfirmacaoEvento(inscricaoId);
          console.log('PagBank ingresso confirmado via webhook — insc:', inscricaoId, orderId);
        }
      }
    }

  } catch (e) { console.error('PagBank Webhook erro:', e.message); }
  res.sendStatus(200);
});

// ─── FREQUÊNCIA ───────────────────────────────────────────────────────────────

router.get('/frequencia', requireAuth, requirePermissao('frequencia'), async (req, res) => {
  const config = await getConfig();
  const turmaId = req.query.turma;
  const turmasR = await query('SELECT * FROM turmas WHERE ativo=1 ORDER BY data_inicio DESC');
  const turmas = turmasR.rows;
  let turmaAtual = null, atividades = [], membrosFrequencia = [], todosMembros = [];
  let resumo = { aptos: 0, risco: 0, inaptos: 0 };

  if (turmaId) {
    const tr = await query('SELECT * FROM turmas WHERE id=$1', [turmaId]);
    turmaAtual = tr.rows[0];
    if (turmaAtual) {
      const atR = await query(
        `SELECT a.*,
          (SELECT COUNT(*) FROM presencas p WHERE p.atividade_id=a.id AND p.presente=1) as presentes,
          (SELECT COUNT(*) FROM turma_membros tm WHERE tm.turma_id=a.turma_id) as total_membros
         FROM atividades a WHERE a.turma_id=$1 ORDER BY a.data_atividade DESC`, [turmaId]
      );
      for (const at of atR.rows) {
        const membR = await query(
          `SELECT m.id as membro_id, m.nome,
            COALESCE((SELECT p.presente FROM presencas p WHERE p.atividade_id=$1 AND p.membro_id=m.id),0) as presente
           FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id
           WHERE tm.turma_id=$2 ORDER BY m.nome`, [at.id, turmaId]
        );
        at.membros = membR.rows;
        atividades.push(at);
      }
      const mfR = await query(
        `SELECT m.id as membro_id, m.nome, m.whatsapp, m.email, tm.data_entrada,
          (SELECT COUNT(*) FROM atividades a WHERE a.turma_id=$1) as total_atividades,
          (SELECT COUNT(*) FROM presencas p JOIN atividades a ON a.id=p.atividade_id
           WHERE a.turma_id=$1 AND p.membro_id=m.id AND p.presente=1) as presencas
         FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id
         WHERE tm.turma_id=$1 ORDER BY m.nome`, [turmaId]
      );
      membrosFrequencia = mfR.rows;
      membrosFrequencia.forEach(m => {
        const pct = m.total_atividades > 0 ? (m.presencas / m.total_atividades) * 100 : 0;
        if (pct >= 75) resumo.aptos++;
        else if (pct >= 50) resumo.risco++;
        else resumo.inaptos++;
      });
    }
  }

  const tmR = await query('SELECT * FROM membros WHERE ativo=1 ORDER BY nome');
  todosMembros = tmR.rows;

  res.render('pages/frequencia', {
    config, usuario: req.session.usuario,
    turmas, turmaAtual, atividades, membrosFrequencia, todosMembros, resumo,
    msg: req.flash('msg'), erro: req.flash('erro')
  });
});

router.post('/frequencia/turma', requireAuth, requireSecretaria, async (req, res) => {
  const { nome, data_inicio, data_fim } = req.body;
  await query('INSERT INTO turmas (nome,data_inicio,data_fim) VALUES ($1,$2,$3)', [nome, data_inicio, data_fim||null]);
  req.flash('msg', 'Turma ' + nome + ' criada!');
  res.redirect('/frequencia');
});

router.post('/frequencia/atividade', requireAuth, requireSecretaria, async (req, res) => {
  const turma_id = req.body.turma_id_sel || req.body.turma_id;
  const { tipo, descricao, data_atividade } = req.body;
  const r = await query(
    'INSERT INTO atividades (turma_id,tipo,descricao,data_atividade) VALUES ($1,$2,$3,$4) RETURNING id',
    [turma_id, tipo, descricao, data_atividade]
  );
  const membros = await query('SELECT membro_id FROM turma_membros WHERE turma_id=$1', [turma_id]);
  for (const m of membros.rows) {
    await query('INSERT INTO presencas (atividade_id,membro_id,presente) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [r.rows[0].id, m.membro_id]);
  }
  req.flash('msg', 'Atividade criada!');
  res.redirect('/frequencia?turma=' + turma_id);
});

router.post('/frequencia/atividade/:id/presenca', requireAuth, requireSecretaria, async (req, res) => {
  const atId = req.params.id;
  const presentes = [].concat(req.body.presentes || []);
  const at = await query('SELECT turma_id FROM atividades WHERE id=$1', [atId]);
  if (!at.rows[0]) return res.redirect('/frequencia');
  const turmaId = at.rows[0].turma_id;
  const membros = await query('SELECT membro_id FROM turma_membros WHERE turma_id=$1', [turmaId]);
  for (const m of membros.rows) {
    const presente = presentes.includes(String(m.membro_id)) ? 1 : 0;
    await query(
      'INSERT INTO presencas (atividade_id,membro_id,presente) VALUES ($1,$2,$3) ON CONFLICT (atividade_id,membro_id) DO UPDATE SET presente=$3',
      [atId, m.membro_id, presente]
    );
  }
  req.flash('msg', 'Presenças salvas!');
  res.redirect('/frequencia?turma=' + turmaId);
});

router.post('/frequencia/atividade/:id/deletar', requireAuth, requireSecretaria, async (req, res) => {
  const at = await query('SELECT turma_id FROM atividades WHERE id=$1', [req.params.id]);
  const turmaId = at.rows[0]?.turma_id;
  await query('DELETE FROM presencas WHERE atividade_id=$1', [req.params.id]);
  await query('DELETE FROM atividades WHERE id=$1', [req.params.id]);
  req.flash('msg', 'Atividade excluída!');
  res.redirect('/frequencia?turma=' + turmaId);
});

router.post('/frequencia/turma/:id/adicionar-membro', requireAuth, requireSecretaria, async (req, res) => {
  const { membro_id, data_entrada } = req.body;
  await query('INSERT INTO turma_membros (turma_id,membro_id,data_entrada) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.params.id, membro_id, data_entrada]);
  const ats = await query('SELECT id FROM atividades WHERE turma_id=$1', [req.params.id]);
  for (const at of ats.rows) {
    await query('INSERT INTO presencas (atividade_id,membro_id,presente) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [at.id, membro_id]);
  }
  req.flash('msg', 'Membro adicionado à turma!');
  res.redirect('/frequencia?turma=' + req.params.id);
});

router.post('/frequencia/turma/:id/remover-membro', requireAuth, requireSecretaria, async (req, res) => {
  const { membro_id } = req.body;
  await query('DELETE FROM turma_membros WHERE turma_id=$1 AND membro_id=$2', [req.params.id, membro_id]);
  req.flash('msg', 'Membro removido da turma!');
  res.redirect('/frequencia?turma=' + req.params.id);
});

router.get('/frequencia/relatorio/:turmaId', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const turmaR = await query('SELECT * FROM turmas WHERE id=$1', [req.params.turmaId]);
  const turma = turmaR.rows[0];
  if (!turma) return res.redirect('/frequencia');
  const membros = await query(
    `SELECT m.id, m.nome, m.email, (SELECT COUNT(*) FROM atividades a WHERE a.turma_id=$1) as total_atividades, (SELECT COUNT(*) FROM presencas p JOIN atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1 AND p.membro_id=m.id AND p.presente=1) as presencas FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id WHERE tm.turma_id=$1 ORDER BY m.nome`,
    [req.params.turmaId]
  );
  const atividades = await query('SELECT id, tipo, descricao, data_atividade FROM atividades WHERE turma_id=$1 ORDER BY data_atividade', [req.params.turmaId]);
  const pd = {};
  for (const at of atividades.rows) {
    const pr = await query('SELECT membro_id, presente FROM presencas WHERE atividade_id=$1', [at.id]);
    pd[at.id] = {};
    pr.rows.forEach(p => { pd[at.id][p.membro_id] = p.presente; });
  }
  const orgNome = config.org_nome || 'Liga Academica de Urologia';
  const orgCor = config.org_cor || '#1a56db';
  const orgLogo = config.org_logo || null;
  const logoHtml = orgLogo ? `<img src="${orgLogo}" style="max-height:56px;object-fit:contain">` : `<span style="font-size:20px;font-weight:800;color:${orgCor}">${orgNome}</span>`;
  const aptos = membros.rows.filter(m => m.total_atividades > 0 && (m.presencas/m.total_atividades)*100 >= 75).length;
  const risco = membros.rows.filter(m => m.total_atividades > 0 && (m.presencas/m.total_atividades)*100 >= 50 && (m.presencas/m.total_atividades)*100 < 75).length;
  const inaptos = membros.rows.length - aptos - risco;
  const dataInicio = turma.data_inicio ? new Date(turma.data_inicio+'T12:00:00').toLocaleDateString('pt-BR') : '';
  const dataFim = turma.data_fim ? new Date(turma.data_fim+'T12:00:00').toLocaleDateString('pt-BR') : '';
  let linhasMembros = membros.rows.map(m => {
    const pct = m.total_atividades > 0 ? Math.round((m.presencas/m.total_atividades)*100) : 0;
    const faltas = Number(m.total_atividades) - Number(m.presencas);
    const status = pct>=75?'Apto':pct>=50?'Em risco':'Nao apto';
    const corS = pct>=75?'#166534':pct>=50?'#92400e':'#991b1b';
    const bgS = pct>=75?'#dcfce7':pct>=50?'#fef3c7':'#fee2e2';
    const barC = pct>=75?'#10b981':pct>=50?'#f59e0b':'#ef4444';
    return `<tr><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;font-weight:600">${m.nome}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center;color:#10b981;font-weight:700">${m.presencas}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center;color:#ef4444;font-weight:700">${faltas}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center;color:#64748b">${m.total_atividades}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center"><div style="display:flex;align-items:center;gap:8px;justify-content:center"><div style="width:80px;height:6px;background:#e2e8f0;border-radius:3px"><div style="width:${pct}%;height:100%;background:${barC};border-radius:3px"></div></div><span style="font-weight:700">${pct}%</span></div></td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center"><span style="background:${bgS};color:${corS};padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700">${status}</span></td></tr>`;
  }).join('');
  let headerAt = `<th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b">Ligante</th>`;
  for (const at of atividades.rows) {
    const dt = new Date(at.data_atividade).toLocaleDateString('pt-BR',{timeZone:'UTC',day:'2-digit',month:'2-digit'});
    headerAt += `<th style="padding:10px 8px;text-align:center;font-size:10px;font-weight:700;color:#64748b;min-width:70px">${dt}<br><span style="font-weight:400;opacity:.7">${at.tipo.substring(0,10)}</span></th>`;
  }
  let linhasAt = '';
  for (const m of membros.rows) {
    let cols = `<td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;font-weight:600">${m.nome}</td>`;
    for (const at of atividades.rows) {
      const presente = pd[at.id] && pd[at.id][m.id] ? 1 : 0;
      cols += presente
        ? `<td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:center;background:#f0fdf4;color:#10b981;font-weight:700">S</td>`
        : `<td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:center;background:#fff1f2;color:#ef4444;font-weight:700">N</td>`;
    }
    linhasAt += `<tr>${cols}</tr>`;
  }

  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:#f8fafc;padding:32px}.card{background:white;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:20px}table{width:100%;border-collapse:collapse}thead tr{background:#f8fafc}.btn{background:#1a56db;color:white;border:none;padding:10px 24px;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;margin-bottom:20px}@media print{.btn{display:none}body{background:white;padding:0}}</style></head><body>'
  const htmlDir = '<button class="btn" onclick="window.print()">Imprimir / Salvar PDF</button>'
    + '<div class="card"><div style="padding:24px 28px">' + logoHtml + '<div style="margin-top:12px">'
    + '<div style="font-size:20px;font-weight:800">' + turma.nome + '</div>'
    + '<div style="font-size:12px;color:#64748b">' + dataInicio + ' · ' + atividades.rows.length + ' atividades · Minimo 75%</div></div></div></div>'
    + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px">'
    + '<div class="card" style="padding:18px"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px">Aptos</div><div style="font-size:28px;font-weight:800;color:#10b981">' + aptos + '</div></div>'
    + '<div class="card" style="padding:18px"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px">Em risco</div><div style="font-size:28px;font-weight:800;color:#f59e0b">' + risco + '</div></div>'
    + '<div class="card" style="padding:18px"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px">Nao aptos</div><div style="font-size:28px;font-weight:800;color:#ef4444">' + inaptos + '</div></div></div>'
    + '<div class="card"><div style="padding:16px 20px;border-bottom:1px solid #f1f5f9;font-size:14px;font-weight:700">Resumo</div>'
    + '<table><thead><tr>'
    + '<th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700">Ligante</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Presencas</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Faltas</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Total</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Frequencia</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Status</th>'
    + '</tr></thead><tbody>' + linhasMembros + '</tbody></table></div>'
    + '<div class="card"><div style="padding:16px 20px;border-bottom:1px solid #f1f5f9;font-size:14px;font-weight:700">Presencas por atividade</div>'
    + '<div style="overflow-x:auto"><table><thead><tr>' + headerAt + '</tr></thead><tbody>' + linhasAt + '</tbody></table></div></div>'
    + '</body></html>';
  res.send(html);
});

router.post('/frequencia/turma/:id/enviar', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const { enviarWhatsApp, enviarEmail } = require('../services/notificacoes');
  const turmaR = await query('SELECT * FROM turmas WHERE id=$1', [req.params.id]);
  const turma = turmaR.rows[0];

  const membrosSelecionados = [].concat(req.body.membros_ids || []);

  let sqlFiltro = '';
  let params = [req.params.id];
  if (membrosSelecionados.length > 0) {
    sqlFiltro = ' AND m.id = ANY($2::int[])';
    params.push(membrosSelecionados.map(Number));
  }

  const membros = await query(
    `SELECT m.*, tm.data_entrada,
      (SELECT COUNT(*) FROM atividades a WHERE a.turma_id=$1) as total_atividades,
      (SELECT COUNT(*) FROM presencas p JOIN atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1 AND p.membro_id=m.id AND p.presente=1) as presencas
     FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id WHERE tm.turma_id=$1` + sqlFiltro, params
  );
  const orgNome = config.org_nome || 'Liga Academica de Urologia';
  let enviados = 0;
  for (const m of membros.rows) {
    const pct = m.total_atividades > 0 ? Math.round((m.presencas / m.total_atividades) * 100) : 0;
    const status = pct >= 75 ? 'APTO ✅' : pct >= 50 ? 'EM RISCO ⚠️' : 'NÃO APTO ❌';
    const msgWpp = `*${orgNome}* 📊\n\nOlá, *${m.nome.split(' ')[0]}*!\n\nSeu relatório de frequência da turma *${turma.nome}*:\n\n📅 Atividades realizadas: *${m.total_atividades}*\n✅ Suas presenças: *${m.presencas}*\n📊 Frequência: *${pct}%*\n🎓 Status: *${status}*\n\n${pct >= 75 ? 'Parabéns! Você está apto para o certificado! 🎉' : pct >= 50 ? 'Atenção! Você está em risco. Não falte às próximas atividades! ⚠️' : 'Atenção! Você está abaixo do mínimo exigido (75%). Participe mais! ❌'}\n\nQualquer dúvida, entre em contato com a secretaria.`;
    if (m.whatsapp) { try { await enviarWhatsApp(m.whatsapp, msgWpp); enviados++; } catch(e) {} }
    if (m.email) {
      const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden"><div style="background:#1a56db;padding:20px 32px"><h1 style="color:white;margin:0;font-size:18px">${orgNome}</h1></div><div style="padding:28px"><h2>📊 Relatório de Frequência — ${turma.nome}</h2><p>Olá, <strong>${m.nome.split(' ')[0]}</strong>!</p><table style="width:100%;border-collapse:collapse;margin:16px 0"><tr style="background:#f4f4f4"><td style="padding:10px;border:1px solid #e5e7eb">Atividades realizadas</td><td style="padding:10px;border:1px solid #e5e7eb;text-align:center"><strong>${m.total_atividades}</strong></td></tr><tr><td style="padding:10px;border:1px solid #e5e7eb">Suas presenças</td><td style="padding:10px;border:1px solid #e5e7eb;text-align:center"><strong>${m.presencas}</strong></td></tr><tr style="background:#f4f4f4"><td style="padding:10px;border:1px solid #e5e7eb">Frequência</td><td style="padding:10px;border:1px solid #e5e7eb;text-align:center"><strong>${pct}%</strong></td></tr><tr><td style="padding:10px;border:1px solid #e5e7eb">Status</td><td style="padding:10px;border:1px solid #e5e7eb;text-align:center;color:${pct>=75?'#22c55e':pct>=50?'#f59e0b':'#ef4444'};font-weight:bold">${status}</td></tr></table><p style="color:#666;font-size:13px">O certificado de 1 ano de liga requer mínimo de 75% de frequência.</p></div></div></body></html>`;
      try { await enviarEmail({ para: m.email, assunto: 'Relatório de Frequência — ' + turma.nome, html, texto: msgWpp }); } catch(e) {}
    }
  }
  res.json({ ok: true, msg: 'Frequência enviada para ' + enviados + ' membros!' });
});

// ─── PERMISSÕES DE USUÁRIO ────────────────────────────────────────────────────

router.get('/usuarios', requireAuth, requirePermissao('usuarios'), async (req, res) => {
  const config = await getConfig();
  const r = await query('SELECT id,nome,email,perfil,ativo,criado_em FROM usuarios ORDER BY criado_em');

  const permR = await query('SELECT usuario_id, modulo FROM usuario_permissoes');
  const permissoesUsuarios = {};
  permR.rows.forEach(function(row) {
    if (!permissoesUsuarios[row.usuario_id]) permissoesUsuarios[row.usuario_id] = [];
    permissoesUsuarios[row.usuario_id].push(row.modulo);
  });

  res.render('pages/usuarios', {
    config, usuario: req.session.usuario,
    usuarios: r.rows, permissoesUsuarios,
    msg: req.flash('msg'), erro: req.flash('erro')
  });
});

router.post('/usuarios/:id/permissoes', requireAuth, requireAdmin, async (req, res) => {
  const userId = req.params.id;
  const modulos = [].concat(req.body.modulos || []);
  await query('DELETE FROM usuario_permissoes WHERE usuario_id=$1', [userId]);
  for (const modulo of modulos) {
    await query('INSERT INTO usuario_permissoes (usuario_id,modulo) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, modulo]);
  }
  req.flash('msg', 'Permissões atualizadas!');
  res.redirect('/usuarios');
});

router.post('/usuarios', requireAuth, requireAdmin, async (req, res) => {
  const { nome, email, senha, perfil } = req.body;
  const modulosInicial = [].concat(req.body.modulos_inicial || []);
  const hash = bcrypt.hashSync(senha, 10);
  try {
    const r = await query('INSERT INTO usuarios (nome,email,senha,perfil) VALUES ($1,$2,$3,$4) RETURNING id', [nome, email, hash, perfil]);
    const novoId = r.rows[0].id;
    const PADRAO = {
      secretaria:  ['dashboard', 'frequencia', 'aniversarios'],
      financeiro:  ['dashboard', 'membros', 'cobrancas', 'aniversarios', 'notificacoes'],
      visualizador:['dashboard']
    };
    const perms = modulosInicial.length > 0 ? modulosInicial : (PADRAO[perfil] || ['dashboard']);
    for (const modulo of perms) {
      await query('INSERT INTO usuario_permissoes (usuario_id,modulo) VALUES ($1,$2) ON CONFLICT DO NOTHING', [novoId, modulo]);
    }
    req.flash('msg', 'Usuário ' + nome + ' criado com sucesso!');
  } catch (e) {
    req.flash('erro', 'E-mail já cadastrado.');
  }
  res.redirect('/usuarios');
});

// ─── WEBHOOK WHATSAPP — LAURO ─────────────────────────────────────────────────
router.post('/webhook/whatsapp', async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') return res.sendStatus(200);
    console.log('Webhook WA recebido:', JSON.stringify(body).substring(0, 200));
    if (body.fromMe === true) return res.sendStatus(200);
    if (body.isGroup === true) return res.sendStatus(200);
    const numero = (body.sender && body.sender.id ? body.sender.id : '').replace(/[^0-9]/g, '');
    const texto = body.msgContent && body.msgContent.conversation ? body.msgContent.conversation : (body.msgContent && body.msgContent.extendedTextMessage ? body.msgContent.extendedTextMessage.text : '');
    if (numero.length < 5 || texto.length < 1) return res.sendStatus(200);
    console.log('Lauro processando:', numero, '-', texto);
    const { processarMensagem } = require('../services/lauro');
    processarMensagem(numero, texto);
  } catch(e) { console.error('Webhook WA erro:', e.message); }
  res.sendStatus(200);
});

// ─── DIRETIVOS ────────────────────────────────────────────────────────────────

router.get('/cadastro-diretivo', async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];
  res.render('pages/cadastro-diretivo-publico', { config, msg, erro, form: {}, appUrl: process.env.APP_URL || '' });
});

router.post('/cadastro-diretivo', async (req, res) => {
  try {
    const { nome, rg, cpf, email, catraca, cargo, semestre_turma, orcid, data_nascimento,
            whatsapp, instagram, graduacao, ano_ingresso, onde_reside, transporte_proprio,
            tipo_transporte, experiencia_urologia } = req.body;
    const disponibilidade = [].concat(req.body.disponibilidade || []).join(', ');
    if (!nome || !email) { req.session.erro = ['Nome e e-mail são obrigatórios.']; return res.redirect('/cadastro-diretivo'); }
    await query(
      `INSERT INTO diretivos (nome,rg,cpf,email,catraca,cargo,semestre_turma,orcid,data_nascimento,
        whatsapp,instagram,graduacao,ano_ingresso,onde_reside,transporte_proprio,tipo_transporte,
        disponibilidade,experiencia_urologia,cadastrado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())`,
      [nome,rg,cpf,email,catraca,cargo,semestre_turma,orcid,data_nascimento||null,
       whatsapp,instagram,graduacao,ano_ingresso,onde_reside,transporte_proprio,
       tipo_transporte,disponibilidade,experiencia_urologia]
    );
    req.session.msg = ['Cadastro realizado com sucesso! Obrigado, ' + nome.split(' ')[0] + '!'];
    res.redirect('/cadastro-diretivo');
  } catch(e) {
    console.error('Erro cadastro diretivo:', e.message);
    req.session.erro = ['Erro ao cadastrar. Tente novamente.'];
    res.redirect('/cadastro-diretivo');
  }
});

router.get('/diretivos', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];
  const statusFiltro = req.query.status || 'ativos';
  const whereAtivo = statusFiltro === 'inativos' ? 'ativo=0' : statusFiltro === 'todos' ? '1=1' : 'ativo=1';
  const r = await query('SELECT * FROM diretivos WHERE ' + whereAtivo + ' ORDER BY cargo, nome');
  res.render('pages/diretivos', {
    config, msg, erro, diretivos: r.rows, usuario: req.session.usuario,
    appUrl: process.env.APP_URL || 'https://liga-urologia.onrender.com',
    statusFiltro
  });
});

router.post('/diretivos', requireAuth, requireSecretaria, async (req, res) => {
  const { nome, rg, cpf, email, whatsapp, cargo, semestre_turma, data_nascimento, onde_reside, disponibilidade } = req.body;
  await query('INSERT INTO diretivos (nome,rg,cpf,email,whatsapp,cargo,semestre_turma,data_nascimento,onde_reside,disponibilidade) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [nome,rg,cpf,email,whatsapp,cargo,semestre_turma,data_nascimento||null,onde_reside,disponibilidade]);
  req.session.msg = ['Diretivo cadastrado com sucesso!'];
  res.redirect('/diretivos');
});

router.post('/diretivos/:id/editar', requireAuth, requireSecretaria, async (req, res) => {
  const { nome,rg,cpf,email,whatsapp,instagram,catraca,cargo,semestre_turma,data_nascimento,
          onde_reside,disponibilidade,ano_ingresso,orcid,graduacao,experiencia_urologia,
          transporte_proprio,tipo_transporte } = req.body;
  await query(
    `UPDATE diretivos SET nome=$1,rg=$2,cpf=$3,email=$4,whatsapp=$5,instagram=$6,catraca=$7,
     cargo=$8,semestre_turma=$9,data_nascimento=$10,onde_reside=$11,disponibilidade=$12,
     ano_ingresso=$13,orcid=$14,graduacao=$15,experiencia_urologia=$16,
     transporte_proprio=$17,tipo_transporte=$18 WHERE id=$19`,
    [nome,rg,cpf,email,whatsapp,instagram,catraca,cargo,semestre_turma,data_nascimento||null,
     onde_reside,disponibilidade,ano_ingresso,orcid,graduacao,experiencia_urologia,
     transporte_proprio,tipo_transporte,req.params.id]
  );
  req.session.msg = ['Diretivo atualizado com sucesso!'];
  res.redirect('/diretivos');
});

router.get('/diretivos/:id/foto', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT foto_chave FROM diretivos WHERE id=$1', [req.params.id]);
    const d = r.rows[0];
    if (!d || !d.foto_chave) return res.status(404).send('Foto nao encontrada');
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const R2 = new S3Client({ region:'auto', endpoint:process.env.R2_ENDPOINT, credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY } });
    const url = await getSignedUrl(R2, new GetObjectCommand({ Bucket: process.env.R2_BUCKET||'liga-urologia-files', Key: d.foto_chave }), { expiresIn: 3600 });
    res.redirect(url);
  } catch(e) { res.status(500).send('Erro'); }
});

router.post('/diretivos/:id/toggle', requireAuth, requireAdmin, async (req, res) => {
  const r = await query('SELECT ativo FROM diretivos WHERE id=$1', [req.params.id]);
  const atual = r.rows[0]?.ativo;
  const novoStatus = atual == 0 ? 1 : 0;
  const motivo = req.body.motivo || null;
  await query('UPDATE diretivos SET ativo=$1 WHERE id=$2', [novoStatus, req.params.id]);
  if (novoStatus === 0 && motivo) {
    await query('INSERT INTO inativacoes_log (tipo, referencia_id, motivo, usuario_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', ['diretivo', req.params.id, motivo, req.session.usuario.id]).catch(()=>{});
  }
  req.session.msg = [novoStatus == 1 ? 'Diretivo reativado!' : 'Diretivo inativado.'];
  res.redirect('/diretivos' + (req.query.status ? '?status=' + req.query.status : ''));
});


undefined

// ─── FREQUÊNCIA DIRETIVOS ─────────────────────────────────────────────────────

router.get('/frequencia-diretivos', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];

  const turmasR = await query('SELECT * FROM diretivo_turmas WHERE ativo=1 ORDER BY nome');
  const turmas = turmasR.rows;

  let turmaAtual = null, atividades = [], membrosFrequencia = [], resumo = { aptos:0, risco:0, inaptos:0 }, todosDiretivos = [];

  const turmaId = req.query.turma;
  if (turmaId) { const tR = await query('SELECT * FROM diretivo_turmas WHERE id=$1', [turmaId]); turmaAtual = tR.rows[0] || null; }
  if (!turmaAtual && turmas.length > 0) turmaAtual = turmas[0];

  const todosR = await query('SELECT id, nome FROM diretivos WHERE ativo=1 ORDER BY nome');
  todosDiretivos = todosR.rows;

  if (turmaAtual) {
    const atR = await query(
      `SELECT a.*, 
        (SELECT COUNT(*) FROM diretivo_presencas p WHERE p.atividade_id=a.id AND p.presente=1) as presentes,
        (SELECT COUNT(*) FROM diretivo_turma_membros tm WHERE tm.turma_id=a.turma_id) as total_membros
       FROM diretivo_atividades a WHERE a.turma_id=$1 ORDER BY a.data_atividade DESC`, [turmaAtual.id]
    );
    for (const at of atR.rows) {
      const mR = await query(
        `SELECT d.id as diretivo_id, d.nome, COALESCE(p.presente,0) as presente
         FROM diretivo_turma_membros tm JOIN diretivos d ON d.id=tm.diretivo_id
         LEFT JOIN diretivo_presencas p ON p.atividade_id=$1 AND p.diretivo_id=d.id
         WHERE tm.turma_id=$2 ORDER BY d.nome`, [at.id, turmaAtual.id]
      );
      at.membros = mR.rows; atividades.push(at);
    }
    const mfR = await query(
      `SELECT d.id as membro_id, d.nome, d.cargo, tm.data_entrada,
        (SELECT COUNT(*) FROM diretivo_atividades a WHERE a.turma_id=$1) as total_atividades,
        (SELECT COUNT(*) FROM diretivo_presencas p JOIN diretivo_atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1 AND p.diretivo_id=d.id AND p.presente=1) as presencas
       FROM diretivo_turma_membros tm JOIN diretivos d ON d.id=tm.diretivo_id WHERE tm.turma_id=$1 ORDER BY d.nome`, [turmaAtual.id]
    );
    membrosFrequencia = mfR.rows;
    membrosFrequencia.forEach(m => {
      const pct = m.total_atividades > 0 ? Math.round((m.presencas/m.total_atividades)*100) : 0;
      if (pct >= 75) resumo.aptos++; else if (pct >= 50) resumo.risco++; else resumo.inaptos++;
    });
  }

  res.render('pages/frequencia-diretivos', {
    config, msg, erro, usuario: req.session.usuario,
    turmas: turmas.sort((a,b) => a.nome.localeCompare(b.nome)),
    turmaAtual, atividades, membrosFrequencia, resumo, todosDiretivos
  });
});

router.post('/frequencia-diretivos/turma', requireAuth, requireSecretaria, async (req, res) => {
  const { nome, data_inicio, data_fim } = req.body;
  await query('INSERT INTO diretivo_turmas (nome,data_inicio,data_fim) VALUES ($1,$2,$3)', [nome, data_inicio, data_fim||null]);
  req.session.msg = ['Turma criada com sucesso!'];
  res.redirect('/frequencia-diretivos');
});

router.post('/frequencia-diretivos/atividade', requireAuth, requireSecretaria, async (req, res) => {
  const turma_id = req.body.turma_id_sel || req.body.turma_id;
  const { tipo, descricao, data_atividade } = req.body;
  const r = await query('INSERT INTO diretivo_atividades (turma_id,tipo,descricao,data_atividade) VALUES ($1,$2,$3,$4) RETURNING id', [turma_id, tipo, descricao, data_atividade]);
  const membros = await query('SELECT diretivo_id FROM diretivo_turma_membros WHERE turma_id=$1', [turma_id]);
  for (const m of membros.rows) { await query('INSERT INTO diretivo_presencas (atividade_id,diretivo_id,presente) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [r.rows[0].id, m.diretivo_id]); }
  req.session.msg = ['Atividade criada!'];
  res.redirect('/frequencia-diretivos?turma=' + turma_id);
});

router.post('/frequencia-diretivos/atividade/:id/presenca', requireAuth, requireSecretaria, async (req, res) => {
  const atR = await query('SELECT * FROM diretivo_atividades WHERE id=$1', [req.params.id]);
  const at = atR.rows[0];
  if (!at) return res.redirect('/frequencia-diretivos');
  const membros = await query('SELECT diretivo_id FROM diretivo_turma_membros WHERE turma_id=$1', [at.turma_id]);
  const presentes = [].concat(req.body.presentes || []).map(Number);
  for (const m of membros.rows) {
    await query('INSERT INTO diretivo_presencas (atividade_id,diretivo_id,presente) VALUES ($1,$2,$3) ON CONFLICT (atividade_id,diretivo_id) DO UPDATE SET presente=$3', [at.id, m.diretivo_id, presentes.includes(m.diretivo_id) ? 1 : 0]);
  }
  req.session.msg = ['Presenças salvas!'];
  res.redirect('/frequencia-diretivos?turma=' + at.turma_id);
});

router.post('/frequencia-diretivos/atividade/:id/deletar', requireAuth, requireSecretaria, async (req, res) => {
  const atR = await query('SELECT turma_id FROM diretivo_atividades WHERE id=$1', [req.params.id]);
  const turma_id = atR.rows[0]?.turma_id;
  await query('DELETE FROM diretivo_presencas WHERE atividade_id=$1', [req.params.id]);
  await query('DELETE FROM diretivo_atividades WHERE id=$1', [req.params.id]);
  req.session.msg = ['Atividade removida!'];
  res.redirect('/frequencia-diretivos?turma=' + turma_id);
});

router.post('/frequencia-diretivos/turma/:id/adicionar-membro', requireAuth, requireSecretaria, async (req, res) => {
  const { diretivo_id, data_entrada } = req.body;
  await query('INSERT INTO diretivo_turma_membros (turma_id,diretivo_id,data_entrada) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.params.id, diretivo_id, data_entrada]);
  const ats = await query('SELECT id FROM diretivo_atividades WHERE turma_id=$1', [req.params.id]);
  for (const at of ats.rows) { await query('INSERT INTO diretivo_presencas (atividade_id,diretivo_id,presente) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [at.id, diretivo_id]); }
  req.session.msg = ['Diretivo adicionado à turma!'];
  res.redirect('/frequencia-diretivos?turma=' + req.params.id);
});

router.post('/frequencia-diretivos/turma/:id/remover-membro', requireAuth, requireSecretaria, async (req, res) => {
  await query('DELETE FROM diretivo_turma_membros WHERE turma_id=$1 AND diretivo_id=$2', [req.params.id, req.body.diretivo_id]);
  req.session.msg = ['Diretivo removido da turma!'];
  res.redirect('/frequencia-diretivos?turma=' + req.params.id);
});

router.get('/frequencia-diretivos/relatorio/:turmaId', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const turmaR = await query('SELECT * FROM diretivo_turmas WHERE id=$1', [req.params.turmaId]);
  const turma = turmaR.rows[0];
  if (!turma) return res.redirect('/frequencia-diretivos');
  const membros = await query(
    `SELECT d.id, d.nome, d.cargo, (SELECT COUNT(*) FROM diretivo_atividades a WHERE a.turma_id=$1) as total_atividades, (SELECT COUNT(*) FROM diretivo_presencas p JOIN diretivo_atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1 AND p.diretivo_id=d.id AND p.presente=1) as presencas FROM diretivo_turma_membros tm JOIN diretivos d ON d.id=tm.diretivo_id WHERE tm.turma_id=$1 ORDER BY d.nome`,
    [req.params.turmaId]
  );
  const atividades = await query('SELECT id, tipo, descricao, data_atividade FROM diretivo_atividades WHERE turma_id=$1 ORDER BY data_atividade', [req.params.turmaId]);
  const pd = {};
  for (const at of atividades.rows) {
    const pr = await query('SELECT diretivo_id, presente FROM diretivo_presencas WHERE atividade_id=$1', [at.id]);
    pd[at.id] = {};
    pr.rows.forEach(p => { pd[at.id][p.diretivo_id] = p.presente; });
  }
  const orgNome = config.org_nome || 'Liga Academica de Urologia';
  const orgCor = config.org_cor || '#1a56db';
  const orgLogo = config.org_logo || null;
  const logoHtml = orgLogo ? `<img src="${orgLogo}" style="max-height:56px;object-fit:contain">` : `<span style="font-size:20px;font-weight:800;color:${orgCor}">${orgNome}</span>`;
  const aptos = membros.rows.filter(m => m.total_atividades > 0 && (m.presencas/m.total_atividades)*100 >= 75).length;
  const risco = membros.rows.filter(m => m.total_atividades > 0 && (m.presencas/m.total_atividades)*100 >= 50 && (m.presencas/m.total_atividades)*100 < 75).length;
  const inaptos = membros.rows.length - aptos - risco;
  const dataInicio = turma.data_inicio ? new Date(turma.data_inicio+'T12:00:00').toLocaleDateString('pt-BR') : '';
  const dataFim = turma.data_fim ? new Date(turma.data_fim+'T12:00:00').toLocaleDateString('pt-BR') : '';
  let linhasMembros = membros.rows.map(m => {
    const pct = m.total_atividades > 0 ? Math.round((m.presencas/m.total_atividades)*100) : 0;
    const faltas = Number(m.total_atividades) - Number(m.presencas);
    const status = pct>=75?'Apto':pct>=50?'Em risco':'Nao apto';
    const corS = pct>=75?'#166534':pct>=50?'#92400e':'#991b1b';
    const bgS = pct>=75?'#dcfce7':pct>=50?'#fef3c7':'#fee2e2';
    const barC = pct>=75?'#10b981':pct>=50?'#f59e0b':'#ef4444';
    return `<tr><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;font-weight:600">${m.nome}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b">${m.cargo||''}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center;color:#10b981;font-weight:700">${m.presencas}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center;color:#ef4444;font-weight:700">${faltas}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center;color:#64748b">${m.total_atividades}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center"><div style="display:flex;align-items:center;gap:8px;justify-content:center"><div style="width:80px;height:6px;background:#e2e8f0;border-radius:3px"><div style="width:${pct}%;height:100%;background:${barC};border-radius:3px"></div></div><span style="font-weight:700">${pct}%</span></div></td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center"><span style="background:${bgS};color:${corS};padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700">${status}</span></td></tr>`;
  }).join('');
  let headerAt = `<th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b">Diretivo</th><th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b">Cargo</th>`;
  for (const at of atividades.rows) {
    const dt = new Date(at.data_atividade).toLocaleDateString('pt-BR',{timeZone:'UTC',day:'2-digit',month:'2-digit'});
    headerAt += `<th style="padding:10px 8px;text-align:center;font-size:10px;font-weight:700;color:#64748b;min-width:70px">${dt}<br><span style="font-weight:400;opacity:.7">${at.tipo.substring(0,10)}</span></th>`;
  }
  let linhasAt = '';
  for (const m of membros.rows) {
    let cols = `<td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;font-weight:600">${m.nome}</td><td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b">${m.cargo||''}</td>`;
    for (const at of atividades.rows) {
      const presente = pd[at.id] && pd[at.id][m.id] ? 1 : 0;
      cols += presente
        ? `<td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:center;background:#f0fdf4;color:#10b981;font-weight:700">S</td>`
        : `<td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:center;background:#fff1f2;color:#ef4444;font-weight:700">N</td>`;
    }
    linhasAt += `<tr>${cols}</tr>`;
  }
  const htmlDir = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:#f8fafc;padding:32px}.card{background:white;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:20px}table{width:100%;border-collapse:collapse}thead tr{background:#f8fafc}.btn{background:#1a56db;color:white;border:none;padding:10px 24px;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;margin-bottom:20px}@media print{.btn{display:none}body{background:white;padding:0}}</style></head><body>'
    + '<button class="btn" onclick="window.print()">Imprimir / Salvar PDF</button>'
    + '<div class="card"><div style="padding:24px 28px">' + logoHtml
    + '<div style="margin-top:12px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b">Relatorio de Frequencia — Diretivos</div>'
    + '<div style="font-size:20px;font-weight:800">' + turma.nome + '</div>'
    + '<div style="font-size:12px;color:#64748b">' + dataInicio + ' · ' + atividades.rows.length + ' atividades · Minimo 75%</div></div></div></div>'
    + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px">'
    + '<div class="card" style="padding:18px"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px">Aptos</div><div style="font-size:28px;font-weight:800;color:#10b981">' + aptos + '</div></div>'
    + '<div class="card" style="padding:18px"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px">Em risco</div><div style="font-size:28px;font-weight:800;color:#f59e0b">' + risco + '</div></div>'
    + '<div class="card" style="padding:18px"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px">Nao aptos</div><div style="font-size:28px;font-weight:800;color:#ef4444">' + inaptos + '</div></div></div>'
    + '<div class="card"><div style="padding:16px 20px;border-bottom:1px solid #f1f5f9;font-size:14px;font-weight:700">Resumo por diretivo</div>'
    + '<table><thead><tr>'
    + '<th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700">Diretivo</th>'
    + '<th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700">Cargo</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Presencas</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Faltas</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Total</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Frequencia</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Status</th>'
    + '</tr></thead><tbody>' + linhasMembros + '</tbody></table></div>'
    + '<div class="card"><div style="padding:16px 20px;border-bottom:1px solid #f1f5f9;font-size:14px;font-weight:700">Presencas por atividade</div>'
    + '<div style="overflow-x:auto"><table><thead><tr>' + headerAt + '</tr></thead><tbody>' + linhasAt + '</tbody></table></div></div>'
    + '</body></html>';
  res.send(htmlDir);
});

router.get('/live/:token', async (req, res) => {
  try {
    const r = await query('SELECT epo.*, i.nome, i.email, e.nome as evento_nome, e.youtube_url, e.duracao_minutos FROM evento_presencas_online epo JOIN evento_inscricoes i ON i.id=epo.inscricao_id JOIN eventos e ON e.id=epo.evento_id WHERE epo.token=$1',[req.params.token]);
    if (!r.rows[0]) return res.status(404).send('Link invalido ou expirado.');
    const p = r.rows[0];
    if (!p.primeiro_acesso) { await query("UPDATE evento_presencas_online SET primeiro_acesso=NOW(),ativo=true WHERE token=$1",[req.params.token]); }
    else { await query("UPDATE evento_presencas_online SET ativo=true,ultimo_ping=NOW() WHERE token=$1",[req.params.token]); }
    const config = await getConfig();
    const patrocR = await query('SELECT * FROM evento_patrocinadores WHERE evento_id=$1 ORDER BY id', [p.evento_id]);
    res.render('pages/evento-live', { token: req.params.token, presenca: p, config, patrocinadores: patrocR.rows });
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});
router.post('/live/:token/ping', async (req, res) => {
  try {
    const rp = await query("UPDATE evento_presencas_online SET ultimo_ping=NOW(),ativo=true,tempo_total_segundos=tempo_total_segundos+120 WHERE token=$1 RETURNING tempo_total_segundos,ultimo_ping",[req.params.token]);
    const total = rp.rows[0]?.tempo_total_segundos || 0;
    const ult = rp.rows[0]?.ultimo_ping;
    res.json({ok:true, total, ultimoPing: ult});
  } catch(e) { res.json({ok:false}); }
});
router.post('/live/:token/sair', async (req, res) => {
  try {
    await query("UPDATE evento_presencas_online SET ativo=false WHERE token=$1",[req.params.token]);
    res.json({ok:true});
  } catch(e) { res.json({ok:false}); }
});
router.post('/eventos/:id/enviar-link-live', requireAuth, async (req, res) => {
  try {
    const crypto = require('crypto');
    const { enviarWhatsApp, enviarEmail } = require('../services/notificacoes');
    const config = await getConfig();
    const appUrl = process.env.APP_URL || 'https://liga-urologia.onrender.com';
    const evR = await query('SELECT * FROM eventos WHERE id=$1',[req.params.id]);
    const ev = evR.rows[0];
    if (!ev) return res.json({ok:false,msg:'Evento nao encontrado'});
    const inscrR = await query("SELECT * FROM evento_inscricoes WHERE evento_id=$1 AND status='confirmado'",[req.params.id]);
    let enviados = 0;
    for (const insc of inscrR.rows) {
      let token = crypto.randomBytes(24).toString('hex');
      const existe = await query('SELECT token FROM evento_presencas_online WHERE inscricao_id=$1 AND evento_id=$2',[insc.id,ev.id]);
      if (existe.rows.length > 0) { token = existe.rows[0].token; }
      else { await query('INSERT INTO evento_presencas_online (inscricao_id,evento_id,token) VALUES ($1,$2,$3)',[insc.id,ev.id,token]); }
      const link = appUrl+'/live/'+token;
      const msg = (config.org_nome||'LAURO')+'\n\nOla, '+insc.nome.split(' ')[0]+'!\n\nSeu link de acesso ao evento '+ev.nome+':\n\n'+link+'\n\nAcesse para assistir e registrar sua presenca automaticamente.';
      if (insc.whatsapp) { try { await enviarWhatsApp(insc.whatsapp,msg); enviados++; await new Promise(r=>setTimeout(r,500)); } catch(e){} }
      if (insc.email) {
        const html = '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px"><h2>'+ev.nome+'</h2><p>Ola, <strong>'+insc.nome.split(' ')[0]+'</strong>!</p><p>Clique para assistir e ter sua presenca registrada:</p><div style="text-align:center;margin:24px 0"><a href="'+link+'" style="background:#1a56db;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700">Assistir ao evento</a></div><p style="font-size:12px;color:#6b7280">Link exclusivo — nao compartilhe.</p></div>';
        try { await enviarEmail({para:insc.email,assunto:'Seu link de acesso — '+ev.nome,html,texto:msg}); } catch(e){}
      }
    }
    res.json({ok:true,msg:enviados+' links enviados!'});
  } catch(e) { res.json({ok:false,msg:e.message}); }
});
router.get('/eventos/:id/presencas', requireAuth, async (req, res) => {
  try {
    const config = await getConfig();
    const evR = await query('SELECT * FROM eventos WHERE id=$1',[req.params.id]);
    const ev = evR.rows[0];
    if (!ev) return res.redirect('/eventos');
    const inscrR = await query(
      `SELECT i.*,
        COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(saida_em,NOW())-entrada_em))) FROM evento_presencas_tempo WHERE inscricao_id=i.id),0) as segundos_presencial,
        COALESCE((SELECT tempo_total_segundos FROM evento_presencas_online WHERE inscricao_id=i.id AND evento_id=$1),0) as segundos_online
       FROM evento_inscricoes i WHERE i.evento_id=$1 AND i.status='confirmado' ORDER BY i.nome`,
      [ev.id]
    );
    const duracaoSeg = (ev.duracao_minutos||0)*60;
    res.render('pages/evento-presencas',{config,evento:ev,inscricoes:inscrR.rows,duracaoSeg,usuario:req.session.usuario,msg:req.flash('msg')});
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});

router.get('/certificado/validar/:codigo', async (req, res) => {
  try {
    const r = await query(
      `SELECT ec.*, ei.nome, ei.email, e.nome as evento_nome, e.data_inicio
       FROM evento_certificados ec
       JOIN evento_inscricoes ei ON ei.id=ec.inscricao_id
       JOIN eventos e ON e.id=ei.evento_id
       WHERE ec.codigo_validacao=$1`,
      [req.params.codigo]
    );
    const cert = r.rows[0];
    const config = await getConfig();
    const orgNome = config.org_nome || 'LAURO';
    const orgLogo = config.org_logo || null;
    const orgCor = config.org_cor || '#1a56db';
    const logoHtml = orgLogo
      ? `<img src="${orgLogo}" alt="${orgNome}" style="max-height:64px;max-width:200px;object-fit:contain;display:block;margin:0 auto 12px">`
      : `<div style="font-size:20px;font-weight:800;color:${orgCor};margin-bottom:12px">${orgNome}</div>`;
    if (!cert) return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Certificado Inválido</title><style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc}.card{text-align:center;padding:40px;background:white;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,.08);max-width:440px;width:95%}</style></head><body><div class="card">${logoHtml}<div style="font-size:40px;margin-bottom:12px">❌</div><h2 style="color:#dc2626;margin-bottom:8px">Certificado Inválido</h2><p style="color:#6b7280">Este código não corresponde a nenhum certificado emitido pela ${orgNome}.</p></div></body></html>`);
    const dt = cert.data_inicio ? new Date(cert.data_inicio).toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'}) : '';
    const emitidoEm = new Date(cert.emitido_em).toLocaleDateString('pt-BR');
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Certificado Válido</title><style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0fdf4}div.card{text-align:center;padding:40px;background:white;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,.08);max-width:500px;border-top:6px solid #16a34a}</style></head><body><div class="card"><div style="font-size:48px;margin-bottom:16px">✅</div><h2 style="color:#16a34a;margin-bottom:8px">Certificado Válido</h2><p style="color:#374151;font-size:15px;margin-bottom:4px">Este certificado foi emitido para</p><h3 style="font-size:20px;color:#111827;margin-bottom:16px">${cert.nome}</h3><p style="color:#6b7280;font-size:14px">Evento: <strong>${cert.evento_nome}</strong></p><p style="color:#6b7280;font-size:14px">Realizado em: <strong>${dt}</strong></p><p style="color:#6b7280;font-size:14px">Certificado emitido em: <strong>${emitidoEm}</strong></p><p style="margin-top:20px;font-size:12px;color:#9ca3af">Verificado por ${config.org_nome||'LAURO'}</p></div></body></html>`);
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});

// ─── AVALIACAO POS-EVENTO ────────────────────────────────────────────────────
router.post('/eventos/:id/enviar-avaliacao', requireAuth, async (req, res) => {
  try {
    const crypto = require('crypto');
    const {enviarWhatsApp} = require('../services/notificacoes');
    const config = await getConfig();
    const appUrl = process.env.APP_URL||'https://liga-urologia.onrender.com';
    const evR = await query('SELECT * FROM eventos WHERE id=$1',[req.params.id]);
    const ev = evR.rows[0];
    if (!ev) return res.json({ok:false,msg:'Evento nao encontrado'});
    const inscrR = await query("SELECT * FROM evento_inscricoes WHERE evento_id=$1 AND status='confirmado'",[req.params.id]);
    let enviados = 0;
    for (const insc of inscrR.rows) {
      const token = crypto.randomBytes(20).toString('hex');
      await query('INSERT INTO evento_avaliacoes (evento_id,inscricao_id,token) VALUES ($1,$2,$3) ON CONFLICT (token) DO NOTHING',[ev.id,insc.id,token]);
      const link = appUrl+'/avaliacao/'+token;
      const msg = (config.org_nome||'LAURO')+'\n\nOla, *'+insc.nome.split(' ')[0]+'*!\n\nObrigado por participar de *'+ev.nome+'*!\n\nResponda nossa pesquisa rapida:\n'+link+'\n\nLeva menos de 2 minutos!';
      if (insc.whatsapp) { try { await enviarWhatsApp(insc.whatsapp,msg); enviados++; await new Promise(r=>setTimeout(r,400)); } catch(e){} }
    }
    res.json({ok:true,msg:enviados+' pesquisas enviadas!'});
  } catch(e) { res.json({ok:false,msg:e.message}); }
});
router.get('/avaliacao/:token', async (req, res) => {
  try {
    const r = await query('SELECT a.*, e.nome as evento_nome, e.data_inicio, i.nome as participante FROM evento_avaliacoes a JOIN eventos e ON e.id=a.evento_id LEFT JOIN evento_inscricoes i ON i.id=a.inscricao_id WHERE a.token=$1',[req.params.token]);
    if (!r.rows[0]) return res.status(404).send('Link invalido ou expirado.');
    const aval = r.rows[0];
    const config = await getConfig();
    if (aval.respondido) return res.render('pages/avaliacao-respondida',{config,aval});
    res.render('pages/avaliacao-form',{config,aval,token:req.params.token});
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});
router.post('/avaliacao/:token', async (req, res) => {
  try {
    const {nota_geral,nota_conteudo,nota_organizacao,nota_palestrantes,indicaria,gostou,melhorar,sugestoes} = req.body;
    await query(
      'UPDATE evento_avaliacoes SET nota_geral=$1,nota_conteudo=$2,nota_organizacao=$3,nota_palestrantes=$4,indicaria=$5,gostou=$6,melhorar=$7,sugestoes=$8,respondido=true,respondido_em=NOW() WHERE token=$9',
      [parseInt(nota_geral)||null,parseInt(nota_conteudo)||null,parseInt(nota_organizacao)||null,parseInt(nota_palestrantes)||null,indicaria||null,gostou||null,melhorar||null,sugestoes||null,req.params.token]
    );
    const config = await getConfig();
    res.render('pages/avaliacao-obrigado',{config});
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});
router.get('/eventos/:id/avaliacoes', requireAuth, async (req, res) => {
  try {
    const config = await getConfig();
    const evR = await query('SELECT * FROM eventos WHERE id=$1',[req.params.id]);
    const av = await query('SELECT a.*, i.nome as participante FROM evento_avaliacoes a LEFT JOIN evento_inscricoes i ON i.id=a.inscricao_id WHERE a.evento_id=$1 ORDER BY a.respondido_em DESC',[req.params.id]);
    res.render('pages/evento-avaliacoes',{config,evento:evR.rows[0],avaliacoes:av.rows,usuario:req.session.usuario});
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});

// ─── LISTA DE ESPERA ─────────────────────────────────────────────────────────
router.post('/inscricao/:id/lista-espera', async (req, res) => {
  try {
    const { nome, email, whatsapp } = req.body;
    if (!nome) return res.json({ok:false, msg:'Nome obrigatório.'});
    const evR = await query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
    const ev = evR.rows[0];
    if (!ev) return res.json({ok:false, msg:'Evento não encontrado.'});
    // Verifica se ja esta na lista
    const jaR = await query('SELECT id FROM evento_lista_espera WHERE evento_id=$1 AND (email=$2 OR whatsapp=$3)', [req.params.id, email||'', whatsapp||'']);
    if (jaR.rows.length > 0) return res.json({ok:false, msg:'Você já está na lista de espera!'});
    await query('INSERT INTO evento_lista_espera (evento_id,nome,email,whatsapp) VALUES ($1,$2,$3,$4)', [req.params.id, nome, email||null, whatsapp||null]);
    // Notifica por WhatsApp
    if (whatsapp) {
      try {
        const {enviarWhatsApp} = require('../services/notificacoes');
        const config = await getConfig();
        const msg = (config.org_nome||'LAURO')+'\n\nOla, *'+nome.split(' ')[0]+'*!\n\nVoce foi adicionado(a) a lista de espera do evento *'+ev.nome+'*.\n\nAssim que uma vaga abrir, voce sera notificado(a) automaticamente!';
        await enviarWhatsApp(whatsapp, msg);
      } catch(e) {}
    }
    res.json({ok:true, msg:'Você foi adicionado(a) à lista de espera! Avisaremos quando uma vaga abrir.'});
  } catch(e) { res.json({ok:false, msg:'Erro: '+e.message}); }
});

router.get('/eventos/:id/lista-espera', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM evento_lista_espera WHERE evento_id=$1 ORDER BY criado_em ASC', [req.params.id]);
    res.json({ok:true, espera: r.rows});
  } catch(e) { res.json({ok:false}); }
});

router.get('/auditoria', requireAuth, requireAdmin, async (req, res) => {
  const config = await getConfig();
  const pagina = parseInt(req.query.pagina) || 1;
  const limite = 50;
  const offset = (pagina - 1) * limite;
  const filtroUsuario = req.query.usuario || '';
  const filtroAcao = req.query.acao || '';
  let where = 'WHERE 1=1';
  const params = [];
  if (filtroUsuario) { params.push('%'+filtroUsuario+'%'); where += ' AND u.nome ILIKE $'+params.length; }
  if (filtroAcao) { params.push(filtroAcao); where += ' AND l.acao = $'+params.length; }
  params.push(limite); params.push(offset);
  const r = await query(`SELECT l.*, u.nome as usuario_nome, u.email as usuario_email, u.perfil FROM log_atividades l LEFT JOIN usuarios u ON l.usuario_id = u.id ${where} ORDER BY l.criado_em DESC LIMIT $${params.length-1} OFFSET $${params.length}`, params);
  const total = await query(`SELECT COUNT(*) FROM log_atividades l LEFT JOIN usuarios u ON l.usuario_id = u.id ${where}`, params.slice(0,-2));
  res.render('pages/auditoria', { config, usuario: req.session.usuario, logs: r.rows, pagina, limite, total: parseInt(total.rows[0].count), filtroUsuario, filtroAcao });
});

// ─── ARQUIVOS ─────────────────────────────────────────────────────────────────

router.get('/arquivos', requireAuth, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];
  const pastaId = req.query.pasta || null;
  const lixeiraMode = req.query.lixeira === '1';
  const [pastasR, arquivosR, lixeiraR] = await Promise.all([
    query('SELECT * FROM arquivo_pastas WHERE lixeira=0 OR lixeira IS NULL ORDER BY nome'),
    lixeiraMode ? query('SELECT * FROM arquivos WHERE lixeira=1 ORDER BY criado_em DESC') : pastaId ? query('SELECT * FROM arquivos WHERE pasta_id=$1 AND (lixeira=0 OR lixeira IS NULL) ORDER BY nome_original', [pastaId]) : query('SELECT * FROM arquivos WHERE pasta_id IS NULL AND (lixeira=0 OR lixeira IS NULL) ORDER BY nome_original'),
    query('SELECT COUNT(*) n FROM arquivos WHERE lixeira=1')
  ]);
  const todasPastas = pastasR.rows;
  let pastaAtual = pastaId ? todasPastas.find(p => p.id == pastaId) || null : null;
  const arquivos = arquivosR.rows.map(a => {
    const kb = (a.tamanho || 0) / 1024;
    a.tamanho_fmt = kb < 1024 ? kb.toFixed(0) + ' KB' : (kb/1024).toFixed(1) + ' MB';
    const ext = (a.nome_original || '').split('.').pop().toLowerCase();
    const icons = { pdf:'📑', doc:'📝', docx:'📝', xls:'📊', xlsx:'📊', ppt:'📣', pptx:'📣', jpg:'🖼️', jpeg:'🖼️', png:'🖼️', gif:'🖼️', mp4:'🎬', mp3:'🎵', zip:'📦', rar:'📦' };
    a.icone = a.tipo === 'google' ? '🔗' : (icons[ext] || '📄');
    return a;
  });
  res.render('pages/arquivos', { config, usuario: req.session.usuario, msg, erro, todasPastas, pastas: todasPastas, pastaAtual, arquivos, lixeiraMode, lixeiraCount: parseInt(lixeiraR.rows[0].n) });
});

router.get('/cadastro-ligante', async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];
  res.render('pages/cadastro-ligante-publico', { config, msg, erro, form: {} });
});

router.post('/cadastro-ligante', async (req, res) => {
  const config = await getConfig();
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('foto')(req, res, async (err) => {
      const form = req.body;
      const campos = ['nome','data_nascimento','sexo','email','whatsapp','rg','semestre','turma','porque_lauro','apresentacao'];
      const faltando = campos.filter(c => !form[c] || form[c].trim() === '');
      if (faltando.length > 0) { req.session.erro = ['Preencha todos os campos obrigatórios.']; return res.render('pages/cadastro-ligante-publico', { config, msg: [], erro: req.session.erro, form }); }
      let foto_chave = null;
      if (req.file) { const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'ligantes'); foto_chave = r.chave; }
      await query(`INSERT INTO ligantes (nome, data_nascimento, sexo, email, email_alternativo, whatsapp, rg, cpf, semestre, turma, catraca, orcid, tem_formacao, qual_formacao, habilidades, aceita_cargo, qual_cargo, contribuicao_grupo, ideia_inovadora, tema_interesse, porque_lauro, apresentacao, foto_chave, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW())`,
      [form.nome, form.data_nascimento, form.sexo, form.email, form.email_alternativo||null, form.whatsapp, form.rg, form.cpf||null, form.semestre, form.turma, form.catraca||null, form.orcid||null, form.tem_formacao||null, form.qual_formacao||null, form.habilidades||null, form.aceita_cargo||null, form.qual_cargo||null, form.contribuicao_grupo||null, form.ideia_inovadora||null, form.tema_interesse||null, form.porque_lauro, form.apresentacao, foto_chave]);
      req.session.msg = ['Cadastro realizado com sucesso! Bem-vindo(a) à LAURO! 🎉'];
      res.redirect('/cadastro-ligante');
    });
  } catch(e) { console.error('Erro cadastro ligante:', e.message); req.session.erro = ['Erro ao salvar cadastro. Tente novamente.']; res.redirect('/cadastro-ligante'); }
});

router.get('/ligantes', requireAuth, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg = [];
  const erro = req.session.erro||[]; req.session.erro = [];
  const r = await query('SELECT * FROM ligantes ' + (req.query.status === 'inativos' ? 'WHERE ativo=0' : req.query.status === 'todos' ? '' : 'WHERE ativo=1') + ' ORDER BY nome ASC');
  const ligantes = r.rows;
  const totR = await query('SELECT COUNT(*) t FROM ligantes');
  const atvR = await query('SELECT COUNT(*) t FROM ligantes WHERE ativo=1');
  const total = parseInt(totR.rows[0].t);
  const ativos = parseInt(atvR.rows[0].t);
  const inativos = total - ativos;
  const sfL = req.query.status || 'ativos';
  res.render('pages/ligantes', { config, usuario: req.session.usuario, ligantes, msg, erro, total, ativos, inativos, statusFiltro: sfL });
});

router.post('/ligantes/:id/toggle', requireAuth, async (req, res) => {
  const r = await query('SELECT ativo FROM ligantes WHERE id=$1', [req.params.id]);
  const atual = r.rows[0]?.ativo;
  const novoStatus = atual == 0 ? 1 : 0;
  const motivo = req.body.motivo || null;
  await query('UPDATE ligantes SET ativo=$1 WHERE id=$2', [novoStatus, req.params.id]);
  if (novoStatus === 0) {
    // Cancelar cobranças pendentes do membro vinculado ao email do ligante
    const ligR = await query('SELECT email FROM ligantes WHERE id=$1', [req.params.id]);
    if (ligR.rows[0]?.email) {
      await query(
        "UPDATE cobrancas SET status='cancelado' WHERE membro_id IN (SELECT id FROM membros WHERE email=$1) AND status IN ('pendente','atrasado')",
        [ligR.rows[0].email]
      );
    }
    if (motivo) {
      await query('INSERT INTO inativacoes_log (tipo, referencia_id, motivo, usuario_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', ['ligante', req.params.id, motivo, req.session.usuario.id]).catch(()=>{});
    }
  }
  await logAtividade(req.session.usuario.id, 'LIGANTE_STATUS', 'Status alterado ID: ' + req.params.id + (motivo ? ' — ' + motivo : ''), req);
  req.session.msg = [novoStatus == 1 ? 'Ligante reativado!' : 'Ligante inativado e cobranças canceladas!'];
  res.redirect('/ligantes');
});

router.get('/ligantes/:id/foto', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT foto_chave FROM ligantes WHERE id=$1', [req.params.id]);
    const ligante = r.rows[0];
    if (!ligante || !ligante.foto_chave) return res.status(404).send('Foto não encontrada');
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const R2 = new S3Client({ region:'auto', endpoint:process.env.R2_ENDPOINT, credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY } });
    const url = await getSignedUrl(R2, new GetObjectCommand({ Bucket: process.env.R2_BUCKET||'liga-urologia-files', Key: ligante.foto_chave }), { expiresIn: 3600 });
    res.redirect(url);
  } catch(e) { res.status(500).send('Erro'); }
});

// ─── DESLIGAMENTOS ────────────────────────────────────────────────────────────

router.get('/desligamentos', requireAuth, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];
  const [deslig, membros, ligR, dirR] = await Promise.all([
    query(`SELECT d.*, COALESCE(m.nome,l.nome,dir.nome) as membro_nome, COALESCE(m.email,l.email) as membro_email FROM desligamentos d LEFT JOIN membros m ON m.id=d.membro_id LEFT JOIN ligantes l ON l.id=d.ligante_id LEFT JOIN diretivos dir ON dir.id=d.diretivo_id ORDER BY d.criado_em DESC`),
    query(`SELECT id, nome, cargo FROM membros WHERE ativo=1 ORDER BY nome`),
    query(`SELECT id, nome, email, turma, semestre, rg, catraca FROM ligantes ORDER BY nome`),
    query(`SELECT id, nome, cargo FROM diretivos WHERE ativo=1 ORDER BY nome`)
  ]);
  res.render('pages/desligamentos', { config, usuario: req.session.usuario, msg, erro, desligamentos: deslig.rows, membros: membros.rows, ligantes: ligR.rows, diretivos: dirR.rows });
});

router.post('/desligamentos/configurar', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.fields([{name:'timbrado',maxCount:1},{name:'assinatura_presidente',maxCount:1},{name:'assinatura_secretario',maxCount:1}])(req, res, async (err) => {
      const campos = ['presidente_nome', 'secretario_nome'];
      for (const campo of campos) { if (req.body[campo]) { await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', [campo, req.body[campo]]); } }
      const arquivos_cfg = [{field:'timbrado',chave_cfg:'timbrado_chave',pasta:'timbrado'},{field:'assinatura_presidente',chave_cfg:'assinatura_presidente_chave',pasta:'assinaturas'},{field:'assinatura_secretario',chave_cfg:'assinatura_secretario_chave',pasta:'assinaturas'}];
      for (const a of arquivos_cfg) { if (req.files && req.files[a.field] && req.files[a.field][0]) { const file = req.files[a.field][0]; const r = await uploadArquivo(file.buffer, file.originalname, file.mimetype, a.pasta); await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', [a.chave_cfg, r.chave]); } }
      req.session.msg = ['Configurações salvas com sucesso!'];
      res.redirect('/desligamentos');
    });
  } catch(e) { req.session.erro = ['Erro ao salvar configurações: ' + e.message]; res.redirect('/desligamentos'); }
});

router.post('/desligamentos', requireAuth, async (req, res) => {
  try {
    const { membro_id, ligante_id, diretivo_id, data_solicitacao, motivo, tipo_membro } = req.body;
    const mid = membro_id && membro_id !== '' && membro_id !== 'null' ? parseInt(membro_id) : null;
    const lid = ligante_id && ligante_id !== '' && ligante_id !== 'null' ? parseInt(ligante_id) : null;
    const did = diretivo_id && diretivo_id !== '' && diretivo_id !== 'null' ? parseInt(diretivo_id) : null;
    await query('INSERT INTO desligamentos (membro_id, ligante_id, diretivo_id, data_solicitacao, motivo, tipo_membro, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)', [mid, lid, did, data_solicitacao || new Date(), motivo || null, tipo_membro || 'LIGANTE', req.session.usuario.id]);
    await logAtividade(req.session.usuario.id, 'DESLIGAMENTO_CRIADO', 'Desligamento criado', req);
    req.session.msg = ['Documento de desligamento criado! Clique em 📧 para enviar por email.'];
    res.redirect('/desligamentos');
  } catch(e) { req.session.erro = ['Erro ao criar desligamento: ' + e.message]; res.redirect('/desligamentos'); }
});

router.get('/desligamentos/:id/visualizar', requireAuth, async (req, res) => {
  try {
    const rd = await query('SELECT * FROM desligamentos WHERE id=$1', [req.params.id]);
    if (!rd.rows[0]) return res.status(404).send('Não encontrado');
    const desl = rd.rows[0];
    let pessoa = {};
    if (desl.membro_id) { const rm = await query('SELECT * FROM membros WHERE id=$1', [desl.membro_id]); pessoa = rm.rows[0] || {}; }
    else if (desl.ligante_id) { const rl = await query('SELECT * FROM ligantes WHERE id=$1', [desl.ligante_id]); pessoa = rl.rows[0] || {}; }
    else if (desl.diretivo_id) { const rd2 = await query('SELECT * FROM diretivos WHERE id=$1', [desl.diretivo_id]); pessoa = rd2.rows[0] || {}; }
    const d = { ...desl, ...pessoa };
    const config = await getConfig();
    const { gerarHTMLDesligamento, imagemBase64 } = require('../services/desligamento');
    config.timbrado_b64 = await imagemBase64(config.timbrado_chave);
    config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
    config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
    const html = gerarHTMLDesligamento(d, config, d.data_solicitacao, d.tipo_membro);
    res.send(html);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.post('/desligamentos/:id/enviar', requireAuth, async (req, res) => {
  req.setTimeout(120000); res.setTimeout(120000);
  try {
    const rd = await query('SELECT * FROM desligamentos WHERE id=$1', [req.params.id]);
    if (!rd.rows[0]) { req.session.erro=['Nao encontrado.']; return res.redirect('/desligamentos'); }
    const desl = rd.rows[0];
    let pessoa = {};
    if (desl.membro_id) { const rm = await query('SELECT * FROM membros WHERE id=$1',[desl.membro_id]); pessoa=rm.rows[0]||{}; }
    else if (desl.ligante_id) { const rl = await query('SELECT * FROM ligantes WHERE id=$1',[desl.ligante_id]); pessoa=rl.rows[0]||{}; }
    else if (desl.diretivo_id) { const rd2 = await query('SELECT * FROM diretivos WHERE id=$1',[desl.diretivo_id]); pessoa=rd2.rows[0]||{}; }
    const d = {...desl,...pessoa};
    if (!d.email) { req.session.erro=['Email nao cadastrado.']; return res.redirect('/desligamentos'); }
    const config = await getConfig();
    const { gerarHTMLDesligamento, imagemBase64 } = require('../services/desligamento');
    config.timbrado_b64 = await imagemBase64(config.timbrado_chave);
    config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
    config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
    const html = gerarHTMLDesligamento(d, config, d.data_solicitacao, d.tipo_membro);
    console.log('GERANDO PDF...');
    const pdfBuffer = await gerarPDFDesligamento(html, config.timbrado_b64, config.assinatura_presidente_b64, config.assinatura_secretario_b64, config.presidente_nome, config.secretario_nome);
    console.log('PDF GERADO:', pdfBuffer ? pdfBuffer.length : 'NULL');
    const emailRes = await enviarEmail({ from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>', to:d.email, subject:'Carta de Rescisión — Liga Académica de Urología LAURO', html:emailBonito('Carta de Rescisión — LAURO','<p>Estimado/a <strong>'+d.nome+'</strong>,</p><p>Adjunto encontrará su <strong>Carta de Rescisión</strong> de la Liga Académica de Urología - LAURO.</p><p>Por favor:</p><ol style="margin:10px 0 10px 20px"><li style="margin-bottom:6px">Imprima el documento adjunto</li><li style="margin-bottom:6px">Firme en el espacio indicado</li><li style="margin-bottom:6px">Escanee o fotografíe el documento firmado</li><li><strong>Responda este email</strong> con el documento firmado adjunto</li></ol><p style="margin-top:16px">Atentamente,<br><strong>Secretaría — LAURO</strong></p>',null), attachments:[{filename:'carta-rescision-LAURO.pdf',content:pdfBuffer.toString('base64')}]});
    console.log('RESEND RESPONSE:', JSON.stringify(emailRes));
    await query('UPDATE desligamentos SET status=$1, enviado_em=NOW() WHERE id=$2', ['enviado', req.params.id]);
    await logAtividade(req.session.usuario.id, 'DESLIGAMENTO_ENVIADO', 'Email enviado para: ' + d.email, req);
    req.session.msg = ['Email enviado com sucesso para ' + d.email + '!'];
    res.redirect('/desligamentos');
  } catch(e) { console.log('ERRO DESLIGAMENTO ENVIAR:', e.message); req.session.erro=['Erro ao enviar email: ' + e.message]; res.redirect('/desligamentos'); }
});

router.post('/desligamentos/:id/assinado', requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('pdf_assinado')(req, res, async (err) => {
      if (!req.file) { req.session.erro=['Nenhum arquivo enviado.']; return res.redirect('/desligamentos'); }
      const r = await uploadArquivo(req.file.buffer, 'desligamento-assinado-' + req.params.id + '.pdf', req.file.mimetype, 'desligamentos');
      await query('UPDATE desligamentos SET pdf_assinado_chave=$1, status=$2, assinado_em=NOW() WHERE id=$3', [r.chave, 'assinado', req.params.id]);
      const d = await query('SELECT membro_id FROM desligamentos WHERE id=$1', [req.params.id]);
      if (d.rows[0]) { await query('UPDATE membros SET ativo=0, status=$1 WHERE id=$2', ['desligado', d.rows[0].membro_id]); }
      await logAtividade(req.session.usuario.id, 'DESLIGAMENTO_ASSINADO', 'Documento assinado anexado', req);
      req.session.msg = ['Documento assinado anexado e membro marcado como desligado!'];
      res.redirect('/desligamentos');
    });
  } catch(e) { req.session.erro=['Erro: ' + e.message]; res.redirect('/desligamentos'); }
});

router.get('/desligamentos/:id/assinado', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT pdf_assinado_chave FROM desligamentos WHERE id=$1', [req.params.id]);
    const d = r.rows[0];
    if (!d || !d.pdf_assinado_chave) return res.status(404).send('Não encontrado');
    const { getUrlAssinada } = require('../services/desligamento');
    const url = await getUrlAssinada(d.pdf_assinado_chave);
    res.redirect(url);
  } catch(e) { res.status(500).send('Erro'); }
});

router.get('/ligantes/:id/editar', requireAuth, async (req, res) => {
  const config = await getConfig();
  const r = await query('SELECT * FROM ligantes WHERE id=$1', [req.params.id]);
  const ligante = r.rows[0];
  if (!ligante) { req.session.erro=['Ligante não encontrado.']; return res.redirect('/ligantes'); }
  res.render('pages/ligante-editar', { config, usuario: req.session.usuario, ligante, msg: req.session.msg||[], erro: req.session.erro||[] });
  req.session.msg = []; req.session.erro = [];
});

router.post('/ligantes/:id/editar', requireAuth, async (req, res) => {
  try {
    const {upload,uploadArquivo}=require('../services/arquivos');
    upload.single('foto')(req,res,async(err)=>{
      const b=req.body; let fk=null;
      if(req.file){const r=await uploadArquivo(req.file.buffer,req.file.originalname,req.file.mimetype,'ligantes');fk=r.chave;}
      const fu=fk?',foto_chave=$24':'';
      const p=[b.nome,b.data_nascimento||null,b.sexo,b.email,b.email_alternativo||null,b.whatsapp,b.rg,b.cpf||null,b.semestre,b.turma,b.catraca||null,b.orcid||null,b.tem_formacao||null,b.qual_formacao||null,b.habilidades||null,b.aceita_cargo||null,b.qual_cargo||null,b.contribuicao_grupo||null,b.ideia_inovadora||null,b.tema_interesse||null,b.porque_lauro,b.apresentacao,req.params.id];
      if(fk)p.push(fk);
      await query('UPDATE ligantes SET nome=$1,data_nascimento=$2,sexo=$3,email=$4,email_alternativo=$5,whatsapp=$6,rg=$7,cpf=$8,semestre=$9,turma=$10,catraca=$11,orcid=$12,tem_formacao=$13,qual_formacao=$14,habilidades=$15,aceita_cargo=$16,qual_cargo=$17,contribuicao_grupo=$18,ideia_inovadora=$19,tema_interesse=$20,porque_lauro=$21,apresentacao=$22'+fu+' WHERE id=$23',p);
      await logAtividade(req.session.usuario.id,'LIGANTE_EDITADO','Ligante editado: '+b.nome,req);
      req.session.msg=['Ligante atualizado!']; res.redirect('/ligantes');
    });
  } catch(e){req.session.erro=[e.message];res.redirect('/ligantes');}
});

router.post('/ligantes/:id/deletar', requireAuth, requireAdmin, async (req, res) => {
  const r = await query('SELECT nome FROM ligantes WHERE id=$1', [req.params.id]);
  await query('DELETE FROM ligantes WHERE id=$1', [req.params.id]);
  await logAtividade(req.session.usuario.id, 'LIGANTE_DELETADO', 'Ligante excluído: ' + (r.rows[0]?.nome||''), req);
  req.session.msg = ['Ligante excluído com sucesso!'];
  res.redirect('/ligantes');
});

router.post('/desligamentos/:id/substituir', requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('pdf_assinado')(req, res, async (err) => {
      if (!req.file) { req.session.erro=['Nenhum arquivo enviado.']; return res.redirect('/desligamentos'); }
      const r = await uploadArquivo(req.file.buffer, 'desligamento-assinado-' + req.params.id + '.pdf', req.file.mimetype, 'desligamentos');
      await query('UPDATE desligamentos SET pdf_assinado_chave=$1, status=$2, assinado_em=NOW() WHERE id=$3', [r.chave, 'assinado', req.params.id]);
      await logAtividade(req.session.usuario.id, 'DESLIGAMENTO_SUBSTITUIDO', 'Documento substituido ID: ' + req.params.id, req);
      req.session.msg = ['Documento substituído com sucesso!'];
      res.redirect('/desligamentos');
    });
  } catch(e) { req.session.erro=['Erro: ' + e.message]; res.redirect('/desligamentos'); }
});

router.post('/desligamentos/:id/deletar', requireAuth, requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM desligamentos WHERE id=$1', [req.params.id]);
    await logAtividade(req.session.usuario.id, 'DESLIGAMENTO_DELETADO', 'Desligamento apagado ID: ' + req.params.id, req);
    req.session.msg = ['Desligamento apagado com sucesso!'];
    res.redirect('/desligamentos');
  } catch(e) { req.session.erro=['Erro: ' + e.message]; res.redirect('/desligamentos'); }
});

// ─── RELATÓRIO LIGANTES ───────────────────────────────────────────────────────
router.get('/ligantes/relatorio', requireAuth, async (req, res) => {
  const config = await getConfig();
  const q = req.query;
  const filtros = { status: q.status||'todos', sexo: q.sexo||'todos', semestre: q.semestre||'todos', turma: q.turma||'todos', aceita_cargo: q.aceita_cargo||'todos', tem_formacao: q.tem_formacao||'todos', ordem: q.ordem||'nome', colunas: q.colunas ? (Array.isArray(q.colunas) ? q.colunas : [q.colunas]) : ['nome','email','whatsapp','semestre','turma','rg','catraca','status'] };
  let where = [];
  if (filtros.status === 'ativo') where.push("ativo = 1");
  if (filtros.status === 'inativo') where.push("ativo = 0");
  if (filtros.sexo !== 'todos') where.push(`sexo = '${filtros.sexo.replace(/'/g,"''")}'`);
  if (filtros.semestre !== 'todos') where.push(`semestre = '${filtros.semestre.replace(/'/g,"''")}'`);
  if (filtros.turma !== 'todos') where.push(`turma = '${filtros.turma.replace(/'/g,"''")}'`);
  if (filtros.aceita_cargo !== 'todos') where.push(`aceita_cargo = '${filtros.aceita_cargo.replace(/'/g,"''")}'`);
  if (filtros.tem_formacao !== 'todos') where.push(`tem_formacao = '${filtros.tem_formacao.replace(/'/g,"''")}'`);
  const ordens = { nome:'nome ASC', nome_desc:'nome DESC', idade:'data_nascimento DESC', idade_desc:'data_nascimento ASC', semestre:'semestre ASC', turma:'turma ASC', criado_em:'criado_em DESC' };
  const orderBy = ordens[filtros.ordem] || 'nome ASC';
  const sql = `SELECT * FROM ligantes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy}`;
  const [r, semestresR, turmasR] = await Promise.all([query(sql), query('SELECT DISTINCT semestre FROM ligantes WHERE semestre IS NOT NULL ORDER BY semestre'), query('SELECT DISTINCT turma FROM ligantes WHERE turma IS NOT NULL ORDER BY turma')]);
  const labelColuna = (col) => ({nome:'Nome',email:'E-mail',whatsapp:'WhatsApp',sexo:'Sexo',data_nascimento:'Nascimento',semestre:'Semestre',turma:'Turma',catraca:'Catraca',rg:'RG/CI',cpf:'CPF',orcid:'ORCID',tem_formacao:'Formação',aceita_cargo:'Aceita cargo',habilidades:'Habilidades',status:'Status',criado_em:'Cadastro'}[col] || col);
  res.render('pages/ligantes-relatorio', { config, usuario: req.session.usuario, ligantes: r.rows, filtros, semestres: semestresR.rows.map(x=>x.semestre).filter(Boolean), turmas: turmasR.rows.map(x=>x.turma).filter(Boolean), colunasVisiveis: filtros.colunas, labelColuna, msg: req.session.msg||[], erro: req.session.erro||[] });
  req.session.msg = []; req.session.erro = [];
});

// ─── ARQUIVOS FINANCEIROS ─────────────────────────────────────────────────────

router.get('/financeiro-arquivos', requireAuth, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const pastaAtual = req.query.pasta || null;
  const [pastasR, arquivosR] = await Promise.all([
    query('SELECT * FROM financeiro_pastas ORDER BY nome'),
    query('SELECT * FROM financeiro_arquivos WHERE pasta_id' + (pastaAtual ? '=$1 ORDER BY criado_em DESC' : ' IS NULL ORDER BY criado_em DESC'), pastaAtual ? [pastaAtual] : [])
  ]);
  res.render('pages/financeiro-arquivos', { config, usuario: req.session.usuario, msg, erro, pastas: pastasR.rows, arquivos: arquivosR.rows, pastaAtual });
});

router.post('/financeiro-arquivos/pasta', requireAuth, async (req, res) => {
  const { nome, pai_id } = req.body;
  const pasta_id = pai_id && pai_id !== '' ? pai_id : null;
  await query('INSERT INTO financeiro_pastas (nome, pai_id, criado_por) VALUES ($1,$2,$3)', [nome, pasta_id, req.session.usuario.id]);
  req.session.msg = ['Pasta criada com sucesso!'];
  res.redirect(pasta_id ? '/financeiro-arquivos?pasta=' + pasta_id : '/financeiro-arquivos');
});

router.post('/financeiro-arquivos/upload', requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.array('arquivos', 20)(req, res, async (err) => {
      if (!req.files || req.files.length===0) { req.session.erro=['Nenhum arquivo.']; return res.redirect('/financeiro-arquivos'); }
      const pasta_id = req.body.pasta_id && req.body.pasta_id !== '' ? req.body.pasta_id : null;
      for (const file of req.files) { const nome = req.body.nome || file.originalname; const r = await uploadArquivo(file.buffer, file.originalname, file.mimetype, 'financeiro'); await query('INSERT INTO financeiro_arquivos (nome,tipo,chave_r2,mimetype,tamanho,pasta_id,enviado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)', [nome, 'upload', r.chave, file.mimetype, file.size, pasta_id, req.session.usuario.id]); }
      req.session.msg = ['Arquivo enviado com sucesso!'];
      res.redirect('/financeiro-arquivos' + (pasta_id ? '?pasta='+pasta_id : ''));
    });
  } catch(e) { req.session.erro=['Erro: '+e.message]; res.redirect('/financeiro-arquivos'); }
});

router.post('/financeiro-arquivos/google', requireAuth, async (req, res) => {
  const { nome, google_url, google_tipo, pasta_id } = req.body;
  const pid = pasta_id && pasta_id !== '' ? pasta_id : null;
  let embed = google_url;
  if (google_url.includes('docs.google.com')) embed = google_url.replace(/\/edit.*$/, '/edit?embedded=true&rm=minimal');
  else if (google_url.includes('drive.google.com/file')) { const m = google_url.match(/\/d\/([^/]+)/); if (m) embed = 'https://drive.google.com/file/d/' + m[1] + '/preview'; }
  await query('INSERT INTO financeiro_arquivos (nome,tipo,google_url,google_embed,pasta_id,enviado_por) VALUES ($1,$2,$3,$4,$5,$6)', [nome, 'google', google_url, embed, pid, req.session.usuario.id]);
  req.session.msg = ['Link do Google adicionado!'];
  res.redirect('/financeiro-arquivos' + (pid ? '?pasta='+pid : ''));
});

router.get('/financeiro-arquivos/:id/visualizar', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM financeiro_arquivos WHERE id=$1', [req.params.id]);
    const a = r.rows[0];
    if (!a || !a.chave_r2) return res.status(404).send('Não encontrado');
    const { getUrlAssinada } = require('../services/desligamento');
    res.redirect(await getUrlAssinada(a.chave_r2));
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.get('/financeiro-arquivos/:id/download', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM financeiro_arquivos WHERE id=$1', [req.params.id]);
    const a = r.rows[0];
    if (!a || !a.chave_r2) return res.status(404).send('Não encontrado');
    const { getUrlAssinada } = require('../services/desligamento');
    res.redirect(await getUrlAssinada(a.chave_r2));
  } catch(e) { res.status(500).send('Erro'); }
});

router.post('/financeiro-arquivos/:id/deletar', requireAuth, async (req, res) => {
  const r = await query('SELECT pasta_id FROM financeiro_arquivos WHERE id=$1', [req.params.id]);
  const pid = r.rows[0]?.pasta_id;
  await query('DELETE FROM financeiro_arquivos WHERE id=$1', [req.params.id]);
  req.session.msg = ['Arquivo excluído!'];
  res.redirect('/financeiro-arquivos' + (pid ? '?pasta='+pid : ''));
});

router.post('/financeiro-pastas/:id/deletar', requireAuth, async (req, res) => {
  await query('DELETE FROM financeiro_arquivos WHERE pasta_id=$1', [req.params.id]);
  await query('DELETE FROM financeiro_pastas WHERE id=$1', [req.params.id]);
  req.session.msg = ['Pasta excluída!'];
  res.redirect('/financeiro-arquivos');
});

router.post('/financeiro-arquivos/deletar-multiplos', requireAuth, async (req, res) => {
  try {
    const ids = req.body.ids ? (Array.isArray(req.body.ids) ? req.body.ids : [req.body.ids]) : [];
    const pasta_id = req.body.pasta_id || null;
    for (const id of ids) { await query('DELETE FROM financeiro_arquivos WHERE id=$1', [id]); }
    req.session.msg = [ids.length + ' arquivo(s) excluído(s)!'];
    res.redirect('/financeiro-arquivos' + (pasta_id ? '?pasta=' + pasta_id : ''));
  } catch(e) { req.session.erro=['Erro: '+e.message]; res.redirect('/financeiro-arquivos'); }
});

router.post('/financeiro-arquivos/:id/mover', requireAuth, async (req, res) => {
  try { await query('UPDATE financeiro_arquivos SET pasta_id=$1 WHERE id=$2', [req.body.pasta_id||null, req.params.id]); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ erro: e.message }); }
});

router.post('/financeiro-pastas/:id/mover', requireAuth, async (req, res) => {
  try {
    const pai_id = req.body.pai_id || null;
    if (String(pai_id) === String(req.params.id)) return res.status(400).json({ erro: 'Não pode mover para si mesmo' });
    await query('UPDATE financeiro_pastas SET pai_id=$1 WHERE id=$2', [pai_id, req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

router.post('/arquivos/google', requireAuth, async (req, res) => {
  const { nome, google_url, pasta_id } = req.body;
  const pid = pasta_id && pasta_id !== '' ? pasta_id : null;
  let embed = google_url;
  if (google_url && google_url.includes('docs.google.com')) embed = google_url.replace(/\/edit.*$/, '/edit?embedded=true&rm=minimal');
  else if (google_url && google_url.includes('drive.google.com/file')) { const m = google_url.match(/\/d\/([^/]+)/); if (m) embed = 'https://drive.google.com/file/d/' + m[1] + '/preview'; }
  await query('INSERT INTO arquivos (nome_original, tipo, google_url, google_embed, pasta_id, enviado_por) VALUES ($1,$2,$3,$4,$5,$6)', [nome, 'google', google_url, embed, pid, req.session.usuario.id]);
  req.session.msg = ['Link Google adicionado!'];
  res.redirect('/arquivos' + (pid ? '?pasta=' + pid : ''));
});

router.post('/arquivos/:id/renomear', requireAuth, async (req, res) => {
  await query('UPDATE arquivos SET nome_original=$1 WHERE id=$2', [req.body.nome, req.params.id]);
  res.json({ ok: true });
});

router.post('/arquivos/:id/mover', requireAuth, async (req, res) => {
  await query('UPDATE arquivos SET pasta_id=$1 WHERE id=$2', [req.body.pasta_id||null, req.params.id]);
  res.json({ ok: true });
});

router.post('/arquivos/pasta/:id/mover', requireAuth, async (req, res) => {
  await query('UPDATE arquivo_pastas SET pasta_pai_id=$1 WHERE id=$2', [req.body.pasta_pai_id||null, req.params.id]);
  res.json({ ok: true });
});

router.post('/arquivos/:id/lixeira', requireAuth, async (req, res) => { await query('UPDATE arquivos SET lixeira=1 WHERE id=$1', [req.params.id]); res.json({ ok: true }); });
router.post('/arquivos/:id/restaurar', requireAuth, async (req, res) => { await query('UPDATE arquivos SET lixeira=0 WHERE id=$1', [req.params.id]); res.json({ ok: true }); });
router.post('/arquivos/lixeira/esvaziar', requireAuth, requireAdmin, async (req, res) => { await query('DELETE FROM arquivos WHERE lixeira=1'); res.json({ ok: true }); });
router.post('/arquivos/pasta/:id/lixeira', requireAuth, async (req, res) => { await query('UPDATE arquivo_pastas SET lixeira=1 WHERE id=$1', [req.params.id]); res.json({ ok: true }); });

router.post('/arquivos/pasta/:id/editar', requireAuth, async (req, res) => {
  const { nome, icone, cor } = req.body;
  await query('UPDATE arquivo_pastas SET nome=$1, icone=$2, cor=$3 WHERE id=$4', [nome, icone||'📁', cor||null, req.params.id]);
  req.session.msg = ['Pasta atualizada!'];
  const pasta = await query('SELECT pasta_pai_id FROM arquivo_pastas WHERE id=$1', [req.params.id]);
  const pid = pasta.rows[0]?.pasta_pai_id;
  res.redirect('/arquivos' + (pid ? '?pasta=' + pid : '?pasta=' + req.params.id));
});

router.get("/arquivos/:id/visualizar", requireAuth, async (req, res) => {
  try {
    const r = await query("SELECT * FROM arquivos WHERE id=$1", [req.params.id]);
    const a = r.rows[0];
    if (!a) return res.status(404).send("Nao encontrado");
    if (a.tipo === "google" && a.google_embed) return res.redirect(a.google_embed);
    const { getUrlAssinada } = require("../services/desligamento");
    res.redirect(await getUrlAssinada(a.chave_r2));
  } catch(e) { res.status(500).send("Erro: " + e.message); }
});

router.get("/arquivos/:id/download", requireAuth, async (req, res) => {
  try {
    const r = await query("SELECT * FROM arquivos WHERE id=$1", [req.params.id]);
    const a = r.rows[0];
    if (!a || !a.chave_r2) return res.status(404).send("Nao encontrado");
    const { getUrlAssinada } = require("../services/desligamento");
    res.redirect(await getUrlAssinada(a.chave_r2));
  } catch(e) { res.status(500).send("Erro"); }
});

router.post("/arquivos/:id/deletar", requireAuth, async (req, res) => {
  await query("DELETE FROM arquivos WHERE id=$1", [req.params.id]);
  req.session.msg = ["Arquivo excluido!"];
  res.redirect("/arquivos");
});

router.post("/arquivos/:id/substituir", requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require("../services/arquivos");
    upload.single("arquivo")(req, res, async (err) => {
      if (!req.file) { req.session.erro = ["Sem arquivo"]; return res.redirect("/arquivos"); }
      const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, "liga");
      await query("UPDATE arquivos SET chave_r2=$1,mimetype=$2,tamanho=$3,nome_original=$4 WHERE id=$5", [r.chave, req.file.mimetype, req.file.size, req.file.originalname, req.params.id]);
      req.session.msg = ["Substituido!"]; res.redirect("/arquivos");
    });
  } catch(e) { req.session.erro = [e.message]; res.redirect("/arquivos"); }
});

router.post("/arquivos/upload", requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require("../services/arquivos");
    upload.single("arquivo")(req, res, async (err) => {
      if (!req.file) return res.status(400).json({ erro: "Sem arquivo" });
      const pid = req.body.pasta_id || null;
      const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, "liga");
      await query("INSERT INTO arquivos (nome_original,chave_r2,mimetype,tamanho,pasta_id,enviado_por,ativo) VALUES ($1,$2,$3,$4,$5,$6,1)", [req.file.originalname, r.chave, req.file.mimetype, req.file.size, pid||null, req.session.usuario.id]);
      res.json({ ok: true });
    });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

router.get("/google/auth", requireAuth, requireAdmin, (req, res) => {
  const { getAuthUrl } = require("../services/google-drive");
  res.redirect(getAuthUrl());
});

router.get("/google/callback", requireAuth, async (req, res) => {
  try {
    const { getTokens } = require("../services/google-drive");
    const tokens = await getTokens(req.query.code);
    await query("INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2", ["google_tokens", JSON.stringify(tokens)]);
    req.session.msg = ["Google Drive conectado com sucesso!"];
    res.redirect("/configuracoes");
  } catch(e) { req.session.erro = ["Erro ao conectar Google Drive: " + e.message]; res.redirect("/configuracoes"); }
});

router.post("/arquivos/upload-drive", requireAuth, async (req, res) => {
  try {
    const { upload } = require("../services/arquivos");
    const { uploadParaDrive } = require("../services/google-drive");
    upload.single("arquivo")(req, res, async (err) => {
      if (!req.file) return res.status(400).json({ erro: "Sem arquivo" });
      const tokensR = await query("SELECT valor FROM configuracoes WHERE chave='google_tokens'");
      if (!tokensR.rows[0]) return res.status(400).json({ erro: "Google Drive nao conectado. Va em Configuracoes e conecte." });
      const tokens = JSON.parse(tokensR.rows[0].valor);
      const pasta_id = req.body.pasta_id || null;
      const result = await uploadParaDrive(tokens, req.file.buffer, req.file.originalname, req.file.mimetype);
      await query("INSERT INTO arquivos (nome_original, tipo, google_url, google_embed, pasta_id, enviado_por, ativo) VALUES ($1,$2,$3,$4,$5,$6,1)", [req.file.originalname, "google", result.webViewLink, result.embedUrl, pasta_id||null, req.session.usuario.id]);
      res.json({ ok: true, embedUrl: result.embedUrl });
    });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

router.get("/arquivos/:id/url", requireAuth, async (req, res) => {
  try {
    const r = await query("SELECT chave_r2 FROM arquivos WHERE id=$1", [req.params.id]);
    const a = r.rows[0];
    if (!a || !a.chave_r2) return res.status(404).json({ erro: "Nao encontrado" });
    const { getUrlAssinada } = require("../services/desligamento");
    res.json({ url: await getUrlAssinada(a.chave_r2) });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

router.get('/financeiro-arquivos/:id/url', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT chave_r2 FROM financeiro_arquivos WHERE id=$1', [req.params.id]);
    const a = r.rows[0];
    if (!a || !a.chave_r2) return res.status(404).json({ erro: 'Nao encontrado' });
    const { getUrlAssinada } = require('../services/desligamento');
    res.json({ url: await getUrlAssinada(a.chave_r2) });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

router.get('/desligamentos/:id/imprimir', requireAuth, async (req, res) => {
  try {
    const rd = await query('SELECT * FROM desligamentos WHERE id=$1', [req.params.id]);
    if (!rd.rows[0]) return res.status(404).send('Nao encontrado');
    const desl = rd.rows[0];
    let pessoa = {};
    if (desl.membro_id) { const rm = await query('SELECT * FROM membros WHERE id=$1',[desl.membro_id]); pessoa=rm.rows[0]||{}; }
    else if (desl.ligante_id) { const rl = await query('SELECT * FROM ligantes WHERE id=$1',[desl.ligante_id]); pessoa=rl.rows[0]||{}; }
    const d = {...desl,...pessoa};
    const config = await getConfig();
    const { gerarHTMLDesligamento, imagemBase64 } = require('../services/desligamento');
    config.timbrado_b64 = await imagemBase64(config.timbrado_chave);
    config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
    config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
    let html = gerarHTMLDesligamento(d, config, d.data_solicitacao, d.tipo_membro);
    html = html.replace('</body>', '<script>window.onload=function(){window.print()}</script></body>');
    res.send(html);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.post('/desligamentos/:id/reenviar', requireAuth, async (req, res) => {
  req.setTimeout(120000); res.setTimeout(120000);
  try {
    const rd = await query('SELECT * FROM desligamentos WHERE id=$1',[req.params.id]);
    if (!rd.rows[0]) { req.session.erro=['Nao encontrado.']; return res.redirect('/desligamentos'); }
    const desl = rd.rows[0]; let pessoa = {};
    if (desl.membro_id) { const rm = await query('SELECT * FROM membros WHERE id=$1',[desl.membro_id]); pessoa=rm.rows[0]||{}; }
    else if (desl.ligante_id) { const rl = await query('SELECT * FROM ligantes WHERE id=$1',[desl.ligante_id]); pessoa=rl.rows[0]||{}; }
    const d = {...desl,...pessoa};
    if (!d.email) { req.session.erro=['Email nao cadastrado.']; return res.redirect('/desligamentos'); }
    const config = await getConfig();
    const {gerarHTMLDesligamento,imagemBase64} = require('../services/desligamento');
    config.timbrado_b64 = await imagemBase64(config.timbrado_chave);
    config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
    config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
    const html = gerarHTMLDesligamento(d, config, d.data_solicitacao, d.tipo_membro);
    console.log('GERANDO PDF...');
    const pdfBuffer = await gerarPDFDesligamento(html, config.timbrado_b64, config.assinatura_presidente_b64, config.assinatura_secretario_b64, config.presidente_nome, config.secretario_nome);
    console.log('PDF GERADO:', pdfBuffer ? pdfBuffer.length : 'NULL');
    const emailRes = await enviarEmail({ from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>', to:d.email, subject:'Carta de Rescisión — LAURO (Reenvío)', html:emailBonito('Carta de Rescisión — LAURO (Reenvío)','<p>Estimado/a <strong>'+d.nome+'</strong>,</p><p>Reenviamos su <strong>Carta de Rescisión</strong> de la LAURO.</p><ol style="margin:10px 0 10px 20px"><li style="margin-bottom:6px">Imprima el documento adjunto</li><li style="margin-bottom:6px">Firme en el espacio indicado</li><li style="margin-bottom:6px">Escanee el documento firmado</li><li><strong>Responda este email</strong> con el documento firmado adjunto</li></ol><p style="margin-top:16px">Atentamente,<br><strong>Secretaría — LAURO</strong></p>',null), attachments:[{filename:'carta-rescision-LAURO.pdf',content:pdfBuffer.toString('base64')}]});
    await query('UPDATE desligamentos SET status=$1, enviado_em=NOW() WHERE id=$2', ['enviado', req.params.id]);
    req.session.msg=['Email reenviado para '+d.email+'!']; res.redirect('/desligamentos');
  } catch(e) { console.log('ERRO REENVIAR:', e.message, e.stack); req.session.erro=['Erro: '+e.message]; res.redirect('/desligamentos'); }
});

// ─── DESVINCULAÇÕES ────────────────────────────────────────────────────────────

router.get('/desvinculacoes', requireAuth, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];
  const [desvR, ligR] = await Promise.all([
    query(`SELECT d.*, l.nome as ligante_nome, l.email as ligante_email FROM desvinculacoes d LEFT JOIN ligantes l ON l.id=d.ligante_id ORDER BY d.criado_em DESC`),
    query('SELECT id,nome,email FROM ligantes WHERE ativo=1 ORDER BY nome')
  ]);
  res.render('pages/desvinculacoes', { config, usuario: req.session.usuario, msg, erro, desvinculacoes: desvR.rows, ligantes: ligR.rows });
});

router.post('/desvinculacoes', requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.fields([{name:'adv1'},{name:'adv2'},{name:'adv3'}])(req, res, async (err) => {
      const { ligante_id, data_solicitacao, motivo, num_advertencias } = req.body;
      const lid = ligante_id && ligante_id !== '' ? parseInt(ligante_id) : null;
      let adv1=null, adv2=null, adv3=null;
      for (const [key, varName] of [['adv1', 'adv1'],['adv2','adv2'],['adv3','adv3']]) {
        if (req.files && req.files[key] && req.files[key][0]) { const f=req.files[key][0]; const r=await uploadArquivo(f.buffer,f.originalname,f.mimetype,'advertencias'); if(key==='adv1')adv1=r.chave; else if(key==='adv2')adv2=r.chave; else adv3=r.chave; }
      }
      await query('INSERT INTO desvinculacoes (ligante_id, data_solicitacao, motivo, num_advertencias, adv1_chave, adv2_chave, adv3_chave, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [lid, data_solicitacao||new Date(), motivo||null, parseInt(num_advertencias)||3, adv1, adv2, adv3, req.session.usuario.id]);
      req.session.msg = ['Desvinculação criada!']; res.redirect('/desvinculacoes');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/desvinculacoes'); }
});

router.get('/desvinculacoes/:id/adv/:num', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT adv'+req.params.num+'_chave as chave FROM desvinculacoes WHERE id=$1', [req.params.id]);
    const chave = r.rows[0]?.chave;
    if (!chave) return res.status(404).send('Não encontrado');
    const { getUrlAssinada } = require('../services/desligamento');
    res.redirect(await getUrlAssinada(chave));
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});

async function gerarHTMLDesvinculacao(ligante, config, data) {
  const timbrado = config.timbrado_b64 || null;
  const presidenteSrc = config.assinatura_presidente_b64 || null;
  const secretarioSrc = config.assinatura_secretario_b64 || null;
  const nomePresidente = (config.presidente_nome || 'MANUEL FERNANDO MACEDO NETO').toUpperCase();
  const nomeSecretario = (config.secretario_nome || 'KAUÊ TEIXEIRA LACERDA').toUpperCase();
  const d = new Date(data);
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const dataStr = d.getDate() + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear();
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Times New Roman',serif;font-size:11pt;color:#000}.pagina{width:210mm;height:297mm;position:relative;overflow:hidden}.bg{position:absolute;top:0;left:0;width:210mm;height:297mm;z-index:0}.bg img{width:210mm;height:297mm;display:block}.texto{position:absolute;top:52mm;left:22mm;width:166mm;height:203mm;z-index:1;display:flex;flex-direction:column}.titulo{font-size:11pt;font-weight:bold;margin-bottom:10px}.corpo{text-align:justify;line-height:1.5;flex:1}.corpo p{margin-bottom:7px}.corpo ul{margin:5px 0 7px 20px}.corpo ul li{margin-bottom:3px}.assinaturas{display:flex;flex-direction:column;gap:10px;align-items:center}.assinatura-bloco{text-align:center;width:70%}.assinatura-img-wrap{height:50px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:3px}.assinatura-img{max-height:50px;max-width:130px;object-fit:contain}.linha{border-top:1.5px solid #000;width:90%;margin:0 auto 3px}.assinatura-nome{font-weight:bold;font-size:8.5pt;text-transform:uppercase}.assinatura-cargo{font-size:8pt;margin-top:2px}</style></head><body><div class="pagina"><div class="bg">${timbrado?`<img src="${timbrado}">`:''}</div><div class="texto"><div class="titulo">Liga Académica de Urología - LAURO<br>Universidad Central del Paraguay</div><div class="corpo"><p>Ciudad del Este, ${dataStr}.</p><p>Al(la) Sr(a). <strong>${ligante.nome}</strong></p><p><strong>Asunto: Carta de desvinculación de la Liga Académica de Urología - LAURO</strong></p><p>Estimado(a) ${ligante.nome.split(' ')[0]},</p><p>De acuerdo con el Estatuto y el Reglamento Interno de la Liga Académica de Urología, los miembros (ligantes) deben cumplir con criterios indispensables para mantener su condición de activos, entre ellos:</p><ul><li>Participación regular en las actividades de la Liga;</li><li>Estar en posesión del uniforme de la Liga;</li><li>Estar al día con las mensualidades, según lo estipulado en el contrato firmado en la entrevista de ingreso.</li></ul><p>Sin embargo, tras la evaluación y registro, se constató que Vd. no cumplió con dichos criterios durante el período de su participación. Señalamos que, a lo largo del proceso, se emitieron ${ligante.num_advertencias||3} advertencia(s) por escrito, las cuales no fueron debidamente atendidas.</p><p>En vista de lo expuesto y en conformidad con nuestras normas estatutarias y reglamentarias, comunicamos que, a partir de esta fecha, Vd. queda desvinculado(a) de la Liga Académica de Urología.</p><p>Agradecemos la colaboración prestada hasta el momento y nos ponemos a disposición para cualquier aclaración que sea necesaria.</p><p>Atentamente,</p></div><div class="assinaturas"><div class="assinatura-bloco"><div class="assinatura-img-wrap"><div style="position:abso   </div>
        ${presidenteSrc?`<img src="${presidenteSrc}" class="assinatura-img">`:''}</div><div class="linha"></div><div class="assinatura-nome">${nomePresidente}</div><div class="assinatura-cargo">PRESIDENTE — LAURO</div></div><div class="assinatura-bloco"><div class="assinatura-img-wrap">${secretarioSrc?`<img src="${secretarioSrc}" class="assinatura-img">`:''}</div><div class="linha"></div><div class="assinatura-nome">${nomeSecretario}</div><div class="assinatura-cargo">SECRETÁRIO — LAURO</div></div></div></div></div></body></html>`;
}

async function prepararConfigDesvinc(config) {
  const { imagemBase64 } = require('../services/desligamento');
  config.timbrado_b64 = await imagemBase64(config.timbrado_chave);
  config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
  config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
  return config;
}

router.get('/desvinculacoes/:id/visualizar', requireAuth, async (req, res) => {
  try {
    const rd = await query('SELECT * FROM desvinculacoes WHERE id=$1', [req.params.id]);
    if (!rd.rows[0]) return res.status(404).send('Não encontrado');
    const rl = await query('SELECT * FROM ligantes WHERE id=$1', [rd.rows[0].ligante_id]);
    const ligante = {...(rl.rows[0]||{}), num_advertencias: rd.rows[0].num_advertencias||3};
    const config = await prepararConfigDesvinc(await getConfig());
    res.send(await gerarHTMLDesvinculacao(ligante, config, rd.rows[0].data_solicitacao));
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.get('/desvinculacoes/:id/imprimir', requireAuth, async (req, res) => {
  try {
    const rd = await query('SELECT * FROM desvinculacoes WHERE id=$1', [req.params.id]);
    if (!rd.rows[0]) return res.status(404).send('Não encontrado');
    const rl = await query('SELECT * FROM ligantes WHERE id=$1', [rd.rows[0].ligante_id]);
    const ligante = {...(rl.rows[0]||{}), num_advertencias: rd.rows[0].num_advertencias||3};
    const config = await prepararConfigDesvinc(await getConfig());
    let html = await gerarHTMLDesvinculacao(ligante, config, rd.rows[0].data_solicitacao);
    html = html.replace('</body>', '<script>window.onload=function(){window.print()}</script></body>');
    res.send(html);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

async function enviarEmailDesvinc(id, req, res, reenvio) {
  try {
    const rd = await query('SELECT * FROM desvinculacoes WHERE id=$1', [id]);
    if (!rd.rows[0]) { req.session.erro=['Não encontrado.']; return res.redirect('/desvinculacoes'); }
    const rl = await query('SELECT * FROM ligantes WHERE id=$1', [rd.rows[0].ligante_id]);
    const ligante = rl.rows[0]||{};
    if (!ligante.email) { req.session.erro=['Email não cadastrado.']; return res.redirect('/desvinculacoes'); }
    const config = await prepararConfigDesvinc(await getConfig());
    const html = await gerarHTMLDesvinculacao(ligante, config, rd.rows[0].data_solicitacao);
    console.log('GERANDO PDF desvinculacao...');
    const pdfBuffer = await gerarPDFDesvinculacao(html, config.timbrado_b64, config.assinatura_presidente_b64, config.assinatura_secretario_b64, config.presidente_nome, config.secretario_nome);
    console.log('PDF GERADO:', pdfBuffer ? pdfBuffer.length : 'NULL');
    // resend
    await enviarEmail({ from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>', to:ligante.email, subject:'Carta de Desvinculación — Liga Académica de Urología LAURO'+(reenvio?' (Reenvío)':''), html:emailBonito('Carta de Desvinculación — LAURO','<p>Estimado(a) <strong>'+ligante.nome+'</strong>,</p><p>Adjunto encontrará su <strong>Carta de Desvinculación</strong> de la Liga Académica de Urología - LAURO.</p><p>En caso de dudas, responda este mismo email.</p><p style="margin-top:16px">Atentamente,<br><strong>Secretaría — LAURO</strong></p>',null), attachments:[{filename:'carta-desvinculacion-LAURO.pdf',content:pdfBuffer.toString('base64')}]});
    await query('UPDATE desvinculacoes SET status=$1, enviado_em=NOW() WHERE id=$2', ['enviado', id]);
    req.session.msg = ['Email enviado para ' + ligante.email + '!']; res.redirect('/desvinculacoes');
  } catch(e) { req.session.erro=['Erro: '+e.message]; res.redirect('/desvinculacoes'); }
}

router.post('/desvinculacoes/:id/enviar', requireAuth, (req, res) => enviarEmailDesvinc(req.params.id, req, res, false));
router.post('/desvinculacoes/:id/reenviar', requireAuth, (req, res) => enviarEmailDesvinc(req.params.id, req, res, true));

router.post('/desvinculacoes/:id/assinado', requireAuth, async (req, res) => {
  try {
    upload.single('pdf_assinado')(req, res, async (err) => {
      if (err || !req.file) { req.session.erro=['Erro no upload.']; return res.redirect('/desvinculacoes'); }
      const r = await uploadArquivo(req.file.buffer, 'desvinculacao-assinada-'+req.params.id+'.pdf', req.file.mimetype, 'desvinculacoes');
      await query('UPDATE desvinculacoes SET pdf_assinado_chave=$1, status=$2 WHERE id=$3', [r.chave, 'assinado', req.params.id]);
      req.session.msg = ['Documento assinado anexado com sucesso!'];
      res.redirect('/desvinculacoes');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/desvinculacoes'); }
});

router.get('/desvinculacoes/:id/assinado', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT pdf_assinado_chave FROM desvinculacoes WHERE id=$1', [req.params.id]);
    const d = r.rows[0];
    if (!d || !d.pdf_assinado_chave) return res.status(404).send('Nao encontrado');
    const url = await getUrlAssinada(d.pdf_assinado_chave);
    res.redirect(url);
  } catch(e) { res.status(500).send(e.message); }
});

router.post('/desvinculacoes/:id/deletar', requireAuth, requireAdmin, async (req, res) => {
  await query('DELETE FROM desvinculacoes WHERE id=$1', [req.params.id]);
  req.session.msg = ['Desvinculação excluída!']; res.redirect('/desvinculacoes');
});

router.post('/desvinculacoes/:id/editar', requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.fields([{name:'adv1'},{name:'adv2'},{name:'adv3'}])(req, res, async (err) => {
      const { num_advertencias } = req.body;
      let updates = ['num_advertencias=$1']; let vals = [parseInt(num_advertencias)||3]; let idx = 2;
      for (const num of [1,2,3]) {
        const key = 'adv'+num;
        if (req.files && req.files[key] && req.files[key][0]) { const f=req.files[key][0]; const r=await uploadArquivo(f.buffer,f.originalname,f.mimetype,'advertencias'); updates.push('adv'+num+'_chave=$'+idx); vals.push(r.chave); idx++; }
      }
      vals.push(req.params.id);
      await query('UPDATE desvinculacoes SET '+updates.join(',')+' WHERE id=$'+idx, vals);
      req.session.msg = ['Desvinculação atualizada!']; res.redirect('/desvinculacoes');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/desvinculacoes'); }
});

// ─── CARTA DE COBRANÇA ────────────────────────────────────────────────────────

function gerarHTMLCartaCobranca(pessoa, config, carta) {
  const timbrado = config.timbrado_b64 || null;
  const financeiroSrc = config.assinatura_financeiro_b64 || null;
  const nomeFinanceiro = (config.financeiro_nome || 'DIRECTOR(A) FINANCIERO(A)').toUpperCase();
  const d = new Date(carta.data || new Date());
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const dataStr = d.getDate() + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear();
  const mesRef = carta.mes_referencia || '___________';
  const venc = carta.vencimento ? new Date(carta.vencimento).toLocaleDateString('es-PY') : '___________';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Times New Roman',serif;font-size:11pt;color:#000}.pagina{width:210mm;height:297mm;position:relative;overflow:hidden}.bg{position:absolute;top:0;left:0;width:210mm;height:297mm;z-index:0}.bg img{width:210mm;height:297mm;display:block}.texto{position:absolute;top:52mm;left:22mm;width:166mm;height:203mm;z-index:1;display:flex;flex-direction:column}.titulo{font-size:13pt;font-weight:bold;text-align:center;margin-bottom:6px;text-transform:uppercase}.subtitulo{font-size:11pt;font-weight:bold;text-align:center;margin-bottom:14px;text-transform:uppercase}.corpo{text-align:justify;line-height:1.55;flex:1}.corpo p{margin-bottom:8px}.assinaturas{display:flex;flex-direction:column;gap:10px;align-items:center;margin-top:10px}.assinatura-bloco{text-align:center;width:70%}.assinatura-img-wrap{height:50px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:3px}.assinatura-img{max-height:50px;max-width:130px;object-fit:contain}.linha{border-top:1.5px solid #000;width:90%;margin:0 auto 3px}.assinatura-nome{font-weight:bold;font-size:8.5pt;text-transform:uppercase}.assinatura-cargo{font-size:8pt;margin-top:2px}</style></head><body><div class="pagina"><div class="bg">${timbrado?`<img src="${timbrado}">`:''}</div><div class="texto"><div class="titulo">Carta de Cobro — LAURO</div><div class="subtitulo">Pago Mensual Vencido</div><div class="corpo"><p>Ciudad del Este/PY, ${dataStr}.</p><p>Estimado/a señor/a <strong>${pessoa.nome||'___________'}</strong>,</p><p>Esperamos que este mensaje le encuentre bien.</p><p>Nos ponemos en contacto con usted en nombre de LAURO – Liga Académica de Urología para recordarle que su cuota de membresía está vencida. Como ya le informamos, las cuotas de membresía vencen el día 15 de cada mes.</p><p>Hasta la fecha, no hemos recibido el pago de la cuota mensual correspondiente al mes de <strong>${mesRef}</strong>, cuyo vencimiento fue el <strong>${venc}</strong>. Solicitamos amablemente que se abone la deuda lo antes posible para evitar cualquier restricción en la participación en las actividades de la Liga.</p><p>Si ya ha realizado el pago, ignore este mensaje o, si es posible, envíenos el comprobante de pago para su verificación.</p><p>Estamos a su disposición para responder cualquier pregunta o proporcionar aclaraciones.</p><p>Atentamente,</p></div><div class="assinaturas"><div class="assinatura-bloco"><div class="assinatura-img-wrap">${financeiroSrc?`<img src="${financeiroSrc}" class="assinatura-img">`:''}</div><div class="linha"></div><div class="assinatura-nome">${nomeFinanceiro}</div><div class="assinatura-cargo">Director(a) Financiero(a)<br>LAURO – Liga Académica de Urología</div></div></div></div></div></body></html>`;
}

async function prepararConfigCobranca(config) {
  const { imagemBase64 } = require('../services/desligamento');
  config.timbrado_b64 = await imagemBase64(config.timbrado_chave);
  config.assinatura_financeiro_b64 = await imagemBase64(config.assinatura_financeiro_chave);
  return config;
}

async function buscarPessoaCarta(carta) {
  let pessoa = {};
  if (carta.membro_id) { const r = await query('SELECT * FROM membros WHERE id=$1',[carta.membro_id]); pessoa=r.rows[0]||{}; }
  else if (carta.ligante_id) { const r = await query('SELECT * FROM ligantes WHERE id=$1',[carta.ligante_id]); pessoa=r.rows[0]||{}; }
  return pessoa;
}

router.get('/carta-cobranca', requireAuth, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const [cartasR, membrosR, ligantesR] = await Promise.all([
    query(`SELECT c.*, COALESCE(m.nome,l.nome) as pessoa_nome, COALESCE(m.email,l.email) as pessoa_email FROM cartas_cobranca c LEFT JOIN membros m ON m.id=c.membro_id LEFT JOIN ligantes l ON l.id=c.ligante_id ORDER BY c.criado_em DESC`),
    query('SELECT id,nome,email FROM membros WHERE ativo=1 ORDER BY nome'),
    query('SELECT id,nome,email FROM ligantes WHERE ativo=1 ORDER BY nome')
  ]);
  res.render('pages/carta-cobranca', { config, usuario: req.session.usuario, msg, erro, cartas: cartasR.rows, membros: membrosR.rows, ligantes: ligantesR.rows });
});

router.post('/carta-cobranca', requireAuth, async (req, res) => {
  const { membro_id, ligante_id, mes_referencia, vencimento } = req.body;
  const mid = membro_id && membro_id !== '' ? parseInt(membro_id) : null;
  const lid = ligante_id && ligante_id !== '' ? parseInt(ligante_id) : null;
  await query('INSERT INTO cartas_cobranca (membro_id,ligante_id,mes_referencia,vencimento,criado_por) VALUES ($1,$2,$3,$4,$5)', [mid,lid,mes_referencia,vencimento||null,req.session.usuario.id]);
  req.session.msg = ['Carta criada!']; res.redirect('/carta-cobranca');
});

router.get('/carta-cobranca/:id/visualizar', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM cartas_cobranca WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).send('Nao encontrado');
    const config = await prepararConfigCobranca(await getConfig());
    res.send(gerarHTMLCartaCobranca(await buscarPessoaCarta(r.rows[0]), config, r.rows[0]));
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});

router.get('/carta-cobranca/:id/imprimir', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM cartas_cobranca WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).send('Nao encontrado');
    const config = await prepararConfigCobranca(await getConfig());
    let html = gerarHTMLCartaCobranca(await buscarPessoaCarta(r.rows[0]), config, r.rows[0]);
    html = html.replace('</body>', '<script>window.onload=function(){window.print()}</script></body>');
    res.send(html);
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});

async function enviarCartaCobranca(id, req, res, reenvio) {
  req.setTimeout && req.setTimeout(120000);
  res.setTimeout && res.setTimeout(120000);
  try {
    const r = await query('SELECT * FROM cartas_cobranca WHERE id=$1', [id]);
    if (!r.rows[0]) { req.session.erro=['Nao encontrado.']; return res.redirect('/carta-cobranca'); }
    const pessoa = await buscarPessoaCarta(r.rows[0]);
    if (!pessoa.email) { req.session.erro=['Email nao cadastrado.']; return res.redirect('/carta-cobranca'); }
    const config = await prepararConfigCobranca(await getConfig());
    const htmlCarta = gerarHTMLCartaCobranca(pessoa, config, r.rows[0]);
    console.log('GERANDO PDF carta cobranca...');
    const pdfBuffer = await gerarPDFBuffer(htmlCarta, config.timbrado_b64, config.assinatura_financeiro_b64, config.financeiro_nome || 'DIRECTOR(A) FINANCIERO(A)', 'Director(a) Financiero(a)\nLAURO – Liga Académica de Urología');
    console.log('PDF GERADO:', pdfBuffer ? pdfBuffer.length : 'NULL');
    await enviarEmail({
      from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>',
      to: pessoa.email,
      subject: 'Carta de Cobro — LAURO' + (reenvio ? ' (Reenvío)' : ''),
      html: emailBonito('Carta de Cobro' + (reenvio ? ' (Reenvío)' : ''), '<p>Estimado(a) <strong>' + pessoa.nome + '</strong>,</p><p>Adjunto a este mensaje encontrará su <strong>Carta de Cobro</strong> de la Liga Académica de Urología – LAURO.</p><p>Le solicitamos amablemente que regularice su situación a la brevedad posible.</p><p>Si ya realizó el pago, por favor envínos el comprobante respondiendo este mismo email.</p><p>Estamos a su disposición para cualquier consulta.</p><p style="margin-top:16px">Atentamente,<br><strong>Dirección Financiera — LAURO</strong></p>'),
      attachments: [{filename: 'carta-cobro-LAURO.pdf', content: pdfBuffer.toString('base64')}]
    });
    await query('UPDATE cartas_cobranca SET status=$1, enviado_em=NOW() WHERE id=$2', ['enviado', id]);
    req.session.msg = ['Email enviado para ' + pessoa.email + '!']; res.redirect('/carta-cobranca');
  } catch(e) { console.log('ERRO carta cobranca:', e.message); req.session.erro=['Erro: '+e.message]; res.redirect('/carta-cobranca'); }
}

router.post('/carta-cobranca/:id/enviar', requireAuth, (req, res) => enviarCartaCobranca(req.params.id, req, res, false));
router.post('/carta-cobranca/:id/reenviar', requireAuth, (req, res) => enviarCartaCobranca(req.params.id, req, res, true));
router.post('/carta-cobranca/:id/deletar', requireAuth, async (req, res) => {
  await query('DELETE FROM cartas_cobranca WHERE id=$1', [req.params.id]);
  req.session.msg = ['Carta excluída!']; res.redirect('/carta-cobranca');
});

// ─── LISTA DE ASSINATURAS ─────────────────────────────────────────────────────

router.get('/lista-assinaturas', requireAuth, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const r = await query('SELECT * FROM listas_assinaturas ORDER BY criado_em DESC');
  res.render('pages/lista-assinaturas', { config, usuario: req.session.usuario, msg, erro, listas: r.rows });
});

router.post('/lista-assinaturas', requireAuth, async (req, res) => {
  const { nome, data_evento, descricao } = req.body;
  await query('INSERT INTO listas_assinaturas (nome,data_evento,descricao,criado_por) VALUES ($1,$2,$3,$4)', [nome, data_evento||null, descricao||null, req.session.usuario.id]);
  req.session.msg = ['Lista criada!']; res.redirect('/lista-assinaturas');
});

async function getPessoasLista() {
  const [ligR, dirR] = await Promise.all([query('SELECT nome, rg, catraca FROM ligantes WHERE ativo=1 ORDER BY nome'), query('SELECT nome, rg, catraca FROM diretivos WHERE ativo=1 ORDER BY nome')]);
  const todas = [...ligR.rows, ...dirR.rows];
  todas.sort((a,b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return todas;
}

async function gerarHTMLLista(lista, config) {
  const { imagemBase64 } = require('../services/desligamento');
  const timbrado = config.timbrado_b64 || null;
  const presidenteSrc = config.assinatura_presidente_b64 || null;
  const viceSrc = config.assinatura_vicepresidente_b64 || null;
  const secretarioSrc = config.assinatura_secretario_b64 || null;
  const nomePresidente = (config.presidente_nome || 'PRESIDENTE').toUpperCase();
  const nomeVice = (config.vicepresidente_nome || 'VICE-PRESIDENTE').toUpperCase();
  const nomeSecretario = (config.secretario_nome || 'SECRETÁRIO').toUpperCase();
  const pessoas = await getPessoasLista();
  const d = lista.data_evento ? new Date(lista.data_evento).toLocaleDateString('es-PY') : '___/___/______';
  const LINHAS_POR_PAGINA = 32;
  const paginas = [];
  for (let i = 0; i < pessoas.length; i += LINHAS_POR_PAGINA) { paginas.push(pessoas.slice(i, i + LINHAS_POR_PAGINA)); }
  if (paginas.length === 0) paginas.push([]);
  const bgHtml = timbrado ? `<img src="${timbrado}" style="position:fixed;top:0;left:0;width:210mm;height:297mm;z-index:0;display:block">` : '';
  const paginasHtml = paginas.map((grupo, pi) => {
    const linhas = grupo.map((p, i) => `<tr><td style="text-align:center;padding:4px 3px;border:1px solid #555">${pi*LINHAS_POR_PAGINA+i+1}</td><td style="padding:4px 6px;border:1px solid #555">${p.nome}</td><td style="text-align:center;padding:4px 3px;border:1px solid #555">${p.rg||'—'}</td><td style="text-align:center;padding:4px 3px;border:1px solid #555">${p.catraca||'—'}</td><td style="padding:4px 3px;border:1px solid #555">&nbsp;</td></tr>`).join('');
    const isUltima = pi === paginas.length - 1;
    const assinaturasHtml = isUltima ? `<div style="display:flex;justify-content:space-around;margin-top:20px;gap:10px"><div style="text-align:center;flex:1"><div style="height:45px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:3px">${presidenteSrc?`<img src="${presidenteSrc}" style="max-height:45px;max-width:120px;object-fit:contain">`:''}</div><div style="border-top:1.5px solid #000;width:90%;margin:0 auto 3px"></div><div style="font-weight:bold;font-size:8pt;text-transform:uppercase">${nomePresidente}</div><div style="font-size:7.5pt">PRESIDENTE</div></div><div style="text-align:center;flex:1"><div style="height:45px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:3px">${viceSrc?`<img src="${viceSrc}" style="max-height:45px;max-width:120px;object-fit:contain">`:''}</div><div style="border-top:1.5px solid #000;width:90%;margin:0 auto 3px"></div><div style="font-weight:bold;font-size:8pt;text-transform:uppercase">${nomeVice}</div><div style="font-size:7.5pt">VICE-PRESIDENTE</div></div><div style="text-align:center;flex:1"><div style="height:45px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:3px">${secretarioSrc?`<img src="${secretarioSrc}" style="max-height:45px;max-width:120px;object-fit:contain">`:''}</div><div style="border-top:1.5px solid #000;width:90%;margin:0 auto 3px"></div><div style="font-weight:bold;font-size:8pt;text-transform:uppercase">${nomeSecretario}</div><div style="font-size:7.5pt">SECRETÁRIO</div></div></div>` : '';
    return `<div style="position:relative;width:210mm;min-height:297mm;page-break-after:always">${bgHtml}<div style="position:relative;z-index:1;padding:45mm 18mm 25mm 18mm"><div style="text-align:center;font-size:12pt;font-weight:bold;text-transform:uppercase;margin-bottom:3px">Lista de Presencia y Firmas</div><div style="text-align:center;font-size:9.5pt;margin-bottom:12px">${lista.nome} — ${d}${lista.descricao?'<br><small>'+lista.descricao+'</small>':''}</div><table style="width:100%;border-collapse:collapse;font-size:8.5pt"><thead><tr><th style="width:5%;background:#1a3d2b;color:white;padding:5px 3px;border:1px solid #333;text-align:center">#</th><th style="width:36%;background:#1a3d2b;color:white;padding:5px 6px;border:1px solid #333">Nombre Completo</th><th style="width:16%;background:#1a3d2b;color:white;padding:5px 3px;border:1px solid #333;text-align:center">RG</th><th style="width:16%;background:#1a3d2b;color:white;padding:5px 3px;border:1px solid #333;text-align:center">Catraca</th><th style="width:27%;background:#1a3d2b;color:white;padding:5px 3px;border:1px solid #333;text-align:center">Firma</th></tr></thead><tbody>${linhas}</tbody></table>${assinaturasHtml}</div></div>`;
  }).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Times New Roman',serif;color:#000}@media print{.pagina{page-break-after:always}}</style></head><body>${paginasHtml}</body></html>`;
}

router.get('/lista-assinaturas/:id/visualizar', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM listas_assinaturas WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).send('Nao encontrado');
    const config = await getConfig();
    const { imagemBase64 } = require('../services/desligamento');
    config.timbrado_b64 = await imagemBase64(config.timbrado_chave);
    config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
    config.assinatura_vicepresidente_b64 = await imagemBase64(config.assinatura_vicepresidente_chave);
    config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
    res.send(await gerarHTMLLista(r.rows[0], config));
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.get('/lista-assinaturas/:id/imprimir', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM listas_assinaturas WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).send('Nao encontrado');
    const config = await getConfig();
    const { imagemBase64 } = require('../services/desligamento');
    config.timbrado_b64 = await imagemBase64(config.timbrado_chave);
    let html = await gerarHTMLLista(r.rows[0], config);
    html = html.replace('</body>', '<script>window.onload=function(){window.print()}</script></body>');
    res.send(html);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.post('/lista-assinaturas/:id/upload-assinada', requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('pdf_assinado')(req, res, async (err) => {
      if (!req.file) { req.session.erro=['Nenhum arquivo.']; return res.redirect('/lista-assinaturas'); }
      const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'listas-assinadas');
      await query('UPDATE listas_assinaturas SET pdf_assinado_chave=$1, status=$2 WHERE id=$3', [r.chave, 'assinado', req.params.id]);
      req.session.msg = ['Lista assinada enviada!']; res.redirect('/lista-assinaturas');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/lista-assinaturas'); }
});

router.get('/lista-assinaturas/:id/assinada', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT pdf_assinado_chave FROM listas_assinaturas WHERE id=$1', [req.params.id]);
    const chave = r.rows[0]?.pdf_assinado_chave;
    if (!chave) return res.status(404).send('Nao encontrado');
    const { getUrlAssinada } = require('../services/desligamento');
    res.redirect(await getUrlAssinada(chave));
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.post('/lista-assinaturas/:id/deletar', requireAuth, requireAdmin, async (req, res) => {
  await query('DELETE FROM listas_assinaturas WHERE id=$1', [req.params.id]);
  req.session.msg = ['Lista excluida!']; res.redirect('/lista-assinaturas');
});

// ─── MARKETING ────────────────────────────────────────────────────────────────

async function getMktConfig() {
  const r = await query('SELECT chave,valor FROM marketing_config');
  const cfg = {}; r.rows.forEach(row => cfg[row.chave] = row.valor); return cfg;
}

router.get('/marketing', requireAuth, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const [postsR, midiasR] = await Promise.all([query('SELECT * FROM marketing_posts ORDER BY criado_em DESC'), query('SELECT * FROM marketing_midias ORDER BY criado_em DESC')]);
  const mktConfig = await getMktConfig();
  const posts = postsR.rows; const total = posts.length||1;
  const igPct = Math.round(posts.filter(p=>(p.redes||[]).includes('instagram')).length/total*100);
  const fbPct = Math.round(posts.filter(p=>(p.redes||[]).includes('facebook')).length/total*100);
  const waPct = Math.round(posts.filter(p=>(p.redes||[]).includes('whatsapp')).length/total*100);
  res.render('pages/marketing', { config, usuario: req.session.usuario, msg, erro, posts, midias: midiasR.rows, mktConfig, igPct, fbPct, waPct });
});

router.post('/marketing/posts', requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('imagem')(req, res, async (err) => {
      const { titulo, conteudo, agendado_para, acao } = req.body;
      const redes = Array.isArray(req.body.redes) ? req.body.redes : (req.body.redes ? [req.body.redes] : []);
      let imagemChave = null;
      if (req.file) { const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'marketing'); imagemChave = r.chave; }
      const status = acao === 'agendar' && agendado_para ? 'agendado' : 'rascunho';
      await query('INSERT INTO marketing_posts (titulo,conteudo,imagem_chave,redes,status,agendado_para,criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)', [titulo, conteudo, imagemChave, redes, status, agendado_para||null, req.session.usuario.id]);
      req.session.msg = [status==='agendado'?'Post agendado!':'Rascunho salvo!']; res.redirect('/marketing');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/marketing'); }
});

router.post('/marketing/:id/publicar', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM marketing_posts WHERE id=$1', [req.params.id]);
    const post = r.rows[0];
    if (!post) { req.session.erro=['Post não encontrado']; return res.redirect('/marketing'); }
    const mktConfig = await getMktConfig();
    const redes = post.redes || [];
    const erros = [];
    if (redes.includes('instagram') && mktConfig.instagram_token && mktConfig.instagram_id) {
      try { const axios=require('axios'); const mediaRes=await axios.post(`https://graph.facebook.com/v18.0/${mktConfig.instagram_id}/media`,{caption:post.conteudo,access_token:mktConfig.instagram_token}); await axios.post(`https://graph.facebook.com/v18.0/${mktConfig.instagram_id}/media_publish`,{creation_id:mediaRes.data.id,access_token:mktConfig.instagram_token}); } catch(e){erros.push('Instagram: '+e.message);}
    }
    if (redes.includes('facebook') && mktConfig.facebook_token && mktConfig.facebook_id) {
      try { const axios=require('axios'); await axios.post(`https://graph.facebook.com/v18.0/${mktConfig.facebook_id}/feed`,{message:post.conteudo,access_token:mktConfig.facebook_token}); } catch(e){erros.push('Facebook: '+e.message);}
    }
    if (redes.includes('whatsapp')) {
      try {
        const wapi=require('axios');
        const pessoas=await query('SELECT whatsapp FROM ligantes WHERE ativo=1 AND whatsapp IS NOT NULL UNION SELECT whatsapp FROM diretivos WHERE ativo=1 AND whatsapp IS NOT NULL');
        for (const p of pessoas.rows) { if(p.whatsapp){await wapi.post(`${process.env.WAPI_URL}/send-text`,{phone:p.whatsapp.replace(/\D/g,''),message:post.conteudo},{headers:{Authorization:process.env.WAPI_TOKEN}}).catch(()=>{});} }
      } catch(e){erros.push('WhatsApp: '+e.message);}
    }
    await query('UPDATE marketing_posts SET status=$1, publicado_em=NOW() WHERE id=$2', [erros.length===0?'publicado':'erro', req.params.id]);
    req.session.msg = erros.length===0?['Post publicado!']:['Publicado com erros: '+erros.join(', ')];
    res.redirect('/marketing');
  } catch(e) { req.session.erro=[e.message]; res.redirect('/marketing'); }
});

router.post('/marketing/:id/deletar', requireAuth, async (req, res) => {
  await query('DELETE FROM marketing_posts WHERE id=$1', [req.params.id]);
  req.session.msg = ['Post excluído!']; res.redirect('/marketing');
});

router.post('/marketing/midias/upload', requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('midia')(req, res, async (err) => {
      if (!req.file) { req.session.erro=['Nenhum arquivo.']; return res.redirect('/marketing?tab=midias'); }
      const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'marketing-midias');
      await query('INSERT INTO marketing_midias (nome,chave,tipo,criado_por) VALUES ($1,$2,$3,$4)', [req.body.nome||req.file.originalname, r.chave, req.file.mimetype, req.session.usuario.id]);
      req.session.msg = ['Mídia enviada!']; res.redirect('/marketing');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/marketing'); }
});

router.get('/marketing/midias/:id/img', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT chave FROM marketing_midias WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).send('');
    const { getUrlAssinada } = require('../services/desligamento');
    res.redirect(await getUrlAssinada(r.rows[0].chave));
  } catch(e) { res.status(500).send(''); }
});

router.post('/marketing/midias/:id/deletar', requireAuth, async (req, res) => {
  await query('DELETE FROM marketing_midias WHERE id=$1', [req.params.id]);
  req.session.msg = ['Mídia excluída!']; res.redirect('/marketing');
});

router.post('/marketing/config/instagram', requireAuth, requireAdmin, async (req, res) => {
  const { instagram_token, instagram_id } = req.body;
  await query('INSERT INTO marketing_config (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', ['instagram_token', instagram_token]);
  await query('INSERT INTO marketing_config (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', ['instagram_id', instagram_id]);
  req.session.msg = ['Configuração Instagram salva!']; res.redirect('/marketing');
});

router.post('/marketing/config/facebook', requireAuth, requireAdmin, async (req, res) => {
  const { facebook_token, facebook_id } = req.body;
  await query('INSERT INTO marketing_config (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', ['facebook_token', facebook_token]);
  await query('INSERT INTO marketing_config (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', ['facebook_id', facebook_id]);
  req.session.msg = ['Configuração Facebook salva!']; res.redirect('/marketing');
});

router.post('/marketing/whatsapp-massa', requireAuth, async (req, res) => {
  try {
    const { destinatarios, mensagem } = req.body;
    if (!mensagem) { req.session.erro=['Mensagem obrigatória!']; return res.redirect('/marketing'); }
    let pessoas = [];
    if (destinatarios==='ligantes'||destinatarios==='todos') { const r=await query('SELECT nome,whatsapp FROM ligantes WHERE ativo=1 AND whatsapp IS NOT NULL'); pessoas=[...pessoas,...r.rows]; }
    if (destinatarios==='diretivos'||destinatarios==='todos') { const r=await query('SELECT nome,whatsapp FROM diretivos WHERE ativo=1 AND whatsapp IS NOT NULL'); pessoas=[...pessoas,...r.rows]; }
    const axios = require('axios');
    let enviados=0, erros=0;
    for (const p of pessoas) {
      if (!p.whatsapp) continue;
      try { await axios.post(process.env.WAPI_URL+'/send-text',{phone:p.whatsapp.replace(/\D/g,'')+'@c.us',message:mensagem.replace('{nome}',p.nome)},{headers:{Authorization:'Bearer '+process.env.WAPI_TOKEN}}); enviados++; await new Promise(r=>setTimeout(r,500)); } catch(e){erros++;}
    }
    req.session.msg=[`WhatsApp enviado! ${enviados} enviados, ${erros} erros.`]; res.redirect('/marketing');
  } catch(e) { req.session.erro=[e.message]; res.redirect('/marketing'); }
});

// ─── EVENTOS ──────────────────────────────────────────────────────────────────

async function getEventoStats(eventoId) {
  const [t, conf, chk, rec] = await Promise.all([
    query('SELECT COUNT(*) FROM evento_inscricoes WHERE evento_id=$1', [eventoId]),
    query("SELECT COUNT(*) FROM evento_inscricoes WHERE evento_id=$1 AND status='confirmado'", [eventoId]),
    query('SELECT COUNT(*) FROM evento_inscricoes WHERE evento_id=$1 AND checkin_em IS NOT NULL', [eventoId]),
    query("SELECT COALESCE(SUM(p.valor),0) as total FROM evento_pagamentos p JOIN evento_inscricoes i ON i.id=p.inscricao_id WHERE i.evento_id=$1 AND p.status='pago'", [eventoId])
  ]);
  return { total: parseInt(t.rows[0].count), confirmados: parseInt(conf.rows[0].count), checkins: parseInt(chk.rows[0].count), receita: rec.rows[0].total };
}

router.get('/eventos', requireAuth, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const r = await query(`SELECT e.*, (SELECT COUNT(*) FROM evento_inscricoes WHERE evento_id=e.id) as total_inscritos, (SELECT COUNT(*) FROM evento_inscricoes WHERE evento_id=e.id AND checkin_em IS NOT NULL) as total_checkins, (SELECT COUNT(*) FROM evento_inscricoes WHERE evento_id=e.id AND status='confirmado') as total_pagos, (SELECT COALESCE(SUM(p.valor),0) FROM evento_pagamentos p JOIN evento_inscricoes i ON i.id=p.inscricao_id WHERE i.evento_id=e.id AND p.status='pago') as receita FROM eventos e ORDER BY e.criado_em DESC`);
  const totalInscritos = r.rows.reduce((a,b)=>a+parseInt(b.total_inscritos||0),0);
  const totalReceita = r.rows.reduce((a,b)=>a+parseFloat(b.receita||0),0);
  const totalCheckins = r.rows.reduce((a,b)=>a+parseInt(b.total_checkins||0),0);
  res.render('pages/eventos', { config, usuario: req.session.usuario, msg, erro, eventos: r.rows, totalInscritos, totalReceita, totalCheckins });
});

router.post('/eventos', requireAuth, async (req, res) => {
  try {
    const {upload, uploadArquivo} = require('../services/arquivos');
    upload.single('banner')(req, res, async (err) => {
      const {nome,descricao,data_inicio,data_fim,local,endereco,vagas_total,status,publico,cor_tema,tipo_evento} = req.body;
      let bannerChave = null;
      if (req.file) { const r=await uploadArquivo(req.file.buffer,req.file.originalname,req.file.mimetype,'eventos'); bannerChave=r.chave; }
      await query('INSERT INTO eventos (nome,descricao,data_inicio,data_fim,local,endereco,vagas_total,status,publico,banner_chave,cor_tema,tipo_evento,criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        [nome,descricao||null,data_inicio||null,data_fim||null,local||null,endereco||null,parseInt(vagas_total)||100,status||'rascunho',publico==='true',bannerChave,cor_tema||'#1a3d2b',tipo_evento||'presencial',req.session.usuario.id]);
      req.session.msg=['Evento criado!']; res.redirect('/eventos');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/eventos'); }
});

router.get('/eventos/:id', requireAuth, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const [evR, lotesR, inscrR, pgR, certR, progR, palesR, patrocR] = await Promise.all([
    query('SELECT * FROM eventos WHERE id=$1',[req.params.id]),
    query('SELECT l.*, (SELECT COUNT(*) FROM evento_inscricoes WHERE lote_id=l.id) as inscritos FROM evento_lotes l WHERE l.evento_id=$1 ORDER BY l.ordem',[req.params.id]),
    query('SELECT i.*, l.nome as lote_nome FROM evento_inscricoes i LEFT JOIN evento_lotes l ON l.id=i.lote_id WHERE i.evento_id=$1 ORDER BY i.criado_em DESC',[req.params.id]),
    query('SELECT p.*, i.nome as inscrito_nome FROM evento_pagamentos p JOIN evento_inscricoes i ON i.id=p.inscricao_id WHERE i.evento_id=$1 ORDER BY p.criado_em DESC',[req.params.id]),
    query('SELECT c.*, i.nome as inscrito_nome FROM evento_certificados c JOIN evento_inscricoes i ON i.id=c.inscricao_id WHERE i.evento_id=$1 ORDER BY c.emitido_em DESC',[req.params.id]),
    query('SELECT * FROM evento_programacao WHERE evento_id=$1 ORDER BY ordem',[req.params.id]),
    query('SELECT * FROM evento_palestrantes WHERE evento_id=$1 ORDER BY ordem',[req.params.id]),
    query('SELECT * FROM evento_patrocinadores WHERE evento_id=$1 ORDER BY ordem',[req.params.id])
  ]);
  if (!evR.rows[0]) { req.session.erro=['Evento não encontrado']; return res.redirect('/eventos'); }
  const stats = await getEventoStats(req.params.id);
  const camposR = await query('SELECT * FROM evento_campos WHERE evento_id=$1 ORDER BY ordem',[req.params.id]);
  const cuponsR = await query('SELECT * FROM evento_cupons WHERE evento_id=$1 ORDER BY criado_em DESC',[req.params.id]);
  res.render('pages/evento-detalhe', { config, usuario: req.session.usuario, msg, erro, evento: evR.rows[0], lotes: lotesR.rows, inscricoes: inscrR.rows, pagamentos: pgR.rows, certificados: certR.rows, stats, campos: camposR.rows, programacao: progR.rows, palestrantes: palesR.rows, patrocinadores: patrocR.rows, cupons: cuponsR.rows });
});

router.post('/eventos/:id/editar', requireAuth, async (req, res) => {
  try {
    const {upload, uploadArquivo} = require('../services/arquivos');
    upload.single('banner')(req, res, async (err) => {
      const {nome,descricao,data_inicio,data_fim,local,endereco,vagas_total,status,publico,carga_horaria,duracao_minutos,youtube_url} = req.body;
      let bannerChave = null;
      if (req.file) { const r=await uploadArquivo(req.file.buffer,req.file.originalname,req.file.mimetype,'eventos'); bannerChave=r.chave; }
      const bannerUpdate = bannerChave ? ',banner_chave=$11' : '';
      const idxParam = bannerChave ? 12 : 11;
      const params = [nome,descricao||null,data_inicio||null,data_fim||null,local||null,endereco||null,parseInt(vagas_total),status,publico==='true',parseInt(carga_horaria)||null,req.params.id];
      if (bannerChave) params.splice(10,0,bannerChave);
      params.push(parseInt(duracao_minutos)||null);
      params.push(youtube_url||null);
      await query(`UPDATE eventos SET nome=$1,descricao=$2,data_inicio=$3,data_fim=$4,local=$5,endereco=$6,vagas_total=$7,status=$8,publico=$9,carga_horaria=$10${bannerUpdate},duracao_minutos=$${idxParam+1},youtube_url=$${idxParam+2} WHERE id=$${idxParam}`, params);
      req.session.msg=['Evento atualizado!']; res.redirect('/eventos/'+req.params.id);
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/eventos/'+req.params.id); }
});

router.post('/eventos/:id/deletar', requireAuth, requireAdmin, async (req, res) => {
  await query('DELETE FROM eventos WHERE id=$1',[req.params.id]);
  req.session.msg=['Evento excluído!']; res.redirect('/eventos');
});

router.get('/eventos/:id/banner', async (req, res) => {
  try {
    const r = await query('SELECT banner_chave FROM eventos WHERE id=$1',[req.params.id]);
    if (!r.rows[0]?.banner_chave) return res.status(404).send('');
    const {getUrlAssinada} = require('../services/desligamento');
    res.redirect(await getUrlAssinada(r.rows[0].banner_chave));
  } catch(e) { res.status(500).send(''); }
});

router.post('/eventos/:id/lotes', requireAuth, async (req, res) => {
  const {nome,preco,vagas,data_inicio,data_fim} = req.body;
  const ordem = await query('SELECT COUNT(*) FROM evento_lotes WHERE evento_id=$1',[req.params.id]);
  await query('INSERT INTO evento_lotes (evento_id,nome,preco,vagas,data_inicio,data_fim,ordem) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [req.params.id,nome,parseFloat(preco)||0,parseInt(vagas)||50,data_inicio||null,data_fim||null,parseInt(ordem.rows[0].count)+1]);
  req.session.msg=['Lote criado!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/lotes/:lid/deletar', requireAuth, async (req, res) => {
  await query('DELETE FROM evento_lotes WHERE id=$1',[req.params.lid]);
  req.session.msg=['Lote excluído!']; res.redirect('/eventos/'+req.params.id);
});

// INSCRIÇÕES - Página Pública
router.get('/inscricao/:id', async (req, res) => {
  try {
    const [evR, lotesR] = await Promise.all([
      query(`SELECT e.*, (SELECT COUNT(*) FROM evento_inscricoes WHERE evento_id=e.id) as total_inscritos FROM eventos e WHERE id=$1 AND status='ativo'`,[req.params.id]),
      query('SELECT l.*, (SELECT COUNT(*) FROM evento_inscricoes WHERE lote_id=l.id) as inscritos FROM evento_lotes l WHERE l.evento_id=$1 ORDER BY l.ordem',[req.params.id])
    ]);
    if (!evR.rows[0]) return res.status(404).send('Evento não encontrado ou encerrado.');
    const camposR = await query('SELECT * FROM evento_campos WHERE evento_id=$1 ORDER BY ordem',[req.params.id]);
    const [progPubR, palesPubR, patrocPubR] = await Promise.all([
      query('SELECT * FROM evento_programacao WHERE evento_id=$1 ORDER BY ordem',[req.params.id]),
      query('SELECT * FROM evento_palestrantes WHERE evento_id=$1 ORDER BY ordem',[req.params.id]),
      query('SELECT * FROM evento_patrocinadores WHERE evento_id=$1 ORDER BY ordem',[req.params.id])
    ]);
    const cfgPub = await getConfig();
    const cupomUrl = req.query.cupom ? req.query.cupom.toUpperCase() : null;
    res.render('pages/evento-inscricao-publica', { evento: evR.rows[0], lotes: lotesR.rows, sucesso: false, qrcode: null, campos: camposR.rows, codigoInscricao: null, config: cfgPub, programacao: progPubR.rows, palestrantes: palesPubR.rows, patrocinadores: patrocPubR.rows, pixData: null, cupomUrl });
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});

// INSCRIÇÕES — POST: salva dados e redireciona para pagamento
router.post('/inscricao/:id', async (req, res) => {
  try {
    const { nome, email, whatsapp, rg, cpf, instituicao, lote_id, tipo_participante, catraca, semestre, turma } = req.body;
    if (!nome || !email) return res.status(400).send('Nome e e-mail são obrigatórios.');

    const evR = await query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
    if (!evR.rows[0]) return res.status(404).send('Evento não encontrado');
    const evento = evR.rows[0];

    const loteR = await query('SELECT * FROM evento_lotes WHERE id=$1', [lote_id]);
    const lote = loteR.rows[0];

    // ── VALIDAÇÃO DE DUPLICATA — email OU rg já cadastrado neste evento
    const emailNorm = (email || '').toLowerCase().trim();
    const rgNorm    = (rg || '').replace(/\D/g, '').trim();

    const dupEmail = await query(
      "SELECT id FROM evento_inscricoes WHERE evento_id=$1 AND LOWER(TRIM(email))=$2 AND status != 'cancelado'",
      [req.params.id, emailNorm]
    );
    const dupRg = rgNorm ? await query(
      "SELECT id FROM evento_inscricoes WHERE evento_id=$1 AND REGEXP_REPLACE(rg,'[^0-9]','','g')=$2 AND status != 'cancelado'",
      [req.params.id, rgNorm]
    ) : { rows: [] };

    if (dupEmail.rows.length > 0 || dupRg.rows.length > 0) {
      const motivo = dupEmail.rows.length > 0 ? 'e-mail' : 'RG/CI';
      const config = await getConfig();
      const [camposR, progR, palesR, patrocR, lotesR] = await Promise.all([
        query('SELECT * FROM evento_campos WHERE evento_id=$1 ORDER BY ordem', [req.params.id]),
        query('SELECT * FROM evento_programacao WHERE evento_id=$1 ORDER BY ordem', [req.params.id]),
        query('SELECT * FROM evento_palestrantes WHERE evento_id=$1 ORDER BY ordem', [req.params.id]),
        query('SELECT * FROM evento_patrocinadores WHERE evento_id=$1 ORDER BY ordem', [req.params.id]),
        query('SELECT * FROM evento_lotes WHERE evento_id=$1 AND ativo=true ORDER BY ordem', [req.params.id])
      ]);
      return res.render('pages/evento-inscricao-publica', {
        evento, lotes: lotesR.rows, sucesso: false, qrcode: null,
        codigoInscricao: null, config, programacao: progR.rows,
        palestrantes: palesR.rows, patrocinadores: patrocR.rows, pixData: null,
        campos: camposR.rows,
        erro: `Já existe uma inscrição neste evento com este ${motivo}. Cada participante pode se inscrever apenas uma vez para garantir a unicidade do certificado.`
      });
    }

    const qrcode = 'LAURO-' + req.params.id + '-' + Date.now();
    const cupomCodigo = (req.body.cupom_codigo || '').toUpperCase().trim();
    let ehGratuito = !lote || parseFloat(lote.preco) === 0;
    let isento = false;
    let cupomValido = null;

    // Validar e aplicar cupom
    if (cupomCodigo) {
      const cupomR = await query('SELECT * FROM evento_cupons WHERE evento_id=$1 AND codigo=$2 AND ativo=true', [req.params.id, cupomCodigo]);
      cupomValido = cupomR.rows[0];
      if (cupomValido && cupomValido.usos_atual < cupomValido.usos_max) {
        if (cupomValido.tipo === 'percentual' && parseFloat(cupomValido.valor) === 100) {
          ehGratuito = true;
          isento = true;
        }
      }
    }

    const inscR = await query(
      'INSERT INTO evento_inscricoes (evento_id,lote_id,nome,email,whatsapp,rg,cpf,instituicao,tipo_participante,catraca,semestre,turma,status,qrcode,cupom_codigo,isento) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id',
      [req.params.id, lote_id||null, nome, emailNorm, whatsapp||null, rg||null, cpf||null, instituicao||null, tipo_participante||'externo', catraca||null, semestre||null, turma||null, ehGratuito ? 'confirmado' : 'pendente', qrcode, cupomCodigo||null, isento]
    );
    const inscricaoId = inscR.rows[0].id;

    // Marcar cupom como usado
    if (cupomValido && isento) {
      await query(
        'UPDATE evento_cupons SET usos_atual=usos_atual+1, usado_por_inscricao_id=$1 WHERE id=$2',
        [inscricaoId, cupomValido.id]
      );
    }

    // Evento gratuito → confirma direto, envia email e mostra confirmação
    if (ehGratuito) {
      await enviarEmailConfirmacaoEvento(inscricaoId);
      const config = await getConfig();
      const camposR = await query('SELECT * FROM evento_campos WHERE evento_id=$1 ORDER BY ordem', [req.params.id]);
      const [progR, palesR, patrocR] = await Promise.all([
        query('SELECT * FROM evento_programacao WHERE evento_id=$1 ORDER BY ordem', [req.params.id]),
        query('SELECT * FROM evento_palestrantes WHERE evento_id=$1 ORDER BY ordem', [req.params.id]),
        query('SELECT * FROM evento_patrocinadores WHERE evento_id=$1 ORDER BY ordem', [req.params.id])
      ]);
      return res.render('pages/evento-inscricao-publica', {
        evento, lotes: loteR.rows, sucesso: true, qrcode, campos: camposR.rows,
        codigoInscricao: qrcode, config, programacao: progR.rows,
        palestrantes: palesR.rows, patrocinadores: patrocR.rows, pixData: null, erro: null
      });
    }

    // Evento pago → gerar PIX, salvar no banco e redirecionar para /pagamento/:inscricaoId
    const pixData = await criarPixEvento({
      inscricao: { id: inscricaoId, nome, email: emailNorm, cpf },
      lote,
      eventoNome: evento.nome
    });

    await query(
      `INSERT INTO evento_pagamentos (inscricao_id, valor, metodo, status, pagbank_order_id, pix_copia_cola, pix_qr_image)
       VALUES ($1, $2, 'pix', 'pendente', $3, $4, $5)`,
      [inscricaoId, lote.preco, pixData?.order_id||null, pixData?.pix_copia_cola||null, pixData?.pix_qr_image||null]
    );

    res.redirect('/pagamento/' + inscricaoId);

  } catch(e) {
    console.error('POST /inscricao erro:', e.message);
    res.status(500).send('Erro ao processar inscrição: ' + e.message);
  }
});

// ─── PAGAMENTO DE EVENTOS ─────────────────────────────────────────────────────

// Página de pagamento (PIX + Cartão)
router.get('/pagamento/:inscricaoId', async (req, res) => {
  try {
    const inscR = await query(
      'SELECT i.*, e.nome as evento_nome FROM evento_inscricoes i JOIN eventos e ON e.id=i.evento_id WHERE i.id=$1',
      [req.params.inscricaoId]
    );
    const inscricao = inscR.rows[0];
    if (!inscricao) return res.status(404).send('Inscrição não encontrada.');
    if (inscricao.status === 'confirmado') return res.redirect('/pagamento/' + req.params.inscricaoId + '/confirmado');

    const [evR, loteR, pgR] = await Promise.all([
      query('SELECT * FROM eventos WHERE id=$1', [inscricao.evento_id]),
      query('SELECT * FROM evento_lotes WHERE id=$1', [inscricao.lote_id]),
      query('SELECT * FROM evento_pagamentos WHERE inscricao_id=$1 ORDER BY criado_em DESC LIMIT 1', [inscricao.id])
    ]);

    const pagamento = pgR.rows[0];
    const pixData = pagamento ? {
      pix_copia_cola: pagamento.pix_copia_cola || null,
      pix_qr_image:   pagamento.pix_qr_image   || null,
      order_id:       pagamento.pagbank_order_id || null
    } : null;

    const config = await getConfig();
    res.render('pages/evento-pagamento', {
      config, evento: evR.rows[0], inscricao, lote: loteR.rows[0], pixData, qrcode: inscricao.qrcode
    });
  } catch(e) {
    console.error('GET /pagamento erro:', e.message);
    res.status(500).send('Erro: ' + e.message);
  }
});

// Polling de status (PIX) — chamado pelo front a cada 4s
router.get('/pagamento/:inscricaoId/status', async (req, res) => {
  try {
    const r = await query(
      `SELECT i.status, p.pagbank_order_id
       FROM evento_inscricoes i
       LEFT JOIN evento_pagamentos p ON p.inscricao_id=i.id
       WHERE i.id=$1 ORDER BY p.criado_em DESC LIMIT 1`,
      [req.params.inscricaoId]
    );
    const row = r.rows[0];
    if (!row) return res.json({ pago: false });
    if (row.status === 'confirmado') return res.json({ pago: true });

    // Consulta em tempo real no PagBank
    if (row.pagbank_order_id) {
      const result = await consultarPagamento(row.pagbank_order_id);
      if (result.ok && result.status === 'PAID') {
        await query("UPDATE evento_inscricoes SET status='confirmado' WHERE id=$1", [req.params.inscricaoId]);
        await query("UPDATE evento_pagamentos SET status='pago', pago_em=NOW() WHERE inscricao_id=$1", [req.params.inscricaoId]);
        await enviarEmailConfirmacaoEvento(req.params.inscricaoId);
        return res.json({ pago: true });
      }
    }
    res.json({ pago: false });
  } catch(e) {
    console.error('Status polling erro:', e.message);
    res.json({ pago: false });
  }
});

// Pagamento via Cartão de Crédito
router.post('/pagamento/:inscricaoId/cartao', async (req, res) => {
  try {
    const { num, nome, mes, ano, cvv, cpf, parcelas } = req.body;

    const inscR = await query(
      'SELECT i.*, e.nome as evento_nome FROM evento_inscricoes i JOIN eventos e ON e.id=i.evento_id WHERE i.id=$1',
      [req.params.inscricaoId]
    );
    const inscricao = inscR.rows[0];
    if (!inscricao) return res.json({ ok: false, erro: 'Inscrição não encontrada.' });

    const loteR = await query('SELECT * FROM evento_lotes WHERE id=$1', [inscricao.lote_id]);
    const lote = loteR.rows[0];

    const axios = require('axios');
    const isProd = (process.env.PAGBANK_ENV || 'sandbox') === 'production';
    const BASE_URL = isProd ? 'https://api.pagseguro.com' : 'https://sandbox.api.pagseguro.com';
    const TOKEN = process.env.PAGBANK_TOKEN;

    const valorCents = Math.round(parseFloat(lote.preco) * 100);
    const referencia = 'evento-insc-' + inscricao.id;
    const cpfLimpo = (cpf || '').replace(/\D/g, '') || '12345678909';

    const { data } = await axios.post(
      BASE_URL + '/orders',
      {
        reference_id: referencia,
        customer: {
          name: inscricao.nome,
          email: inscricao.email || 'inscrito@ligaurologia.com.br',
          tax_id: cpfLimpo
        },
        items: [{
          name: ('Ingresso — ' + inscricao.evento_nome + ' — ' + lote.nome).substring(0, 100),
          quantity: 1,
          unit_amount: valorCents
        }],
        charges: [{
          reference_id: referencia,
          description: ('Ingresso — ' + inscricao.evento_nome).substring(0, 64),
          amount: { value: valorCents, currency: 'BRL' },
          payment_method: {
            type: 'CREDIT_CARD',
            installments: parseInt(parcelas) || 1,
            capture: true,
            card: {
              number: num,
              exp_month: String(mes).padStart(2, '0'),
              exp_year: String(ano),
              security_code: cvv,
              holder: { name: nome }
            }
          }
        }],
        notification_urls: [(process.env.APP_URL || 'https://liga-urologia.onrender.com') + '/webhook/pagbank']
      },
      { headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, timeout: 20000 }
    );

    const charges = data.charges || [];
    const aprovado = charges.some(c => c.status === 'PAID' || c.status === 'AUTHORIZED');

    if (aprovado) {
      await query("UPDATE evento_inscricoes SET status='confirmado' WHERE id=$1", [req.params.inscricaoId]);
      await query(
        `INSERT INTO evento_pagamentos (inscricao_id, valor, metodo, status, pagbank_order_id, pago_em)
         VALUES ($1,$2,'cartao','pago',$3,NOW())
         ON CONFLICT DO NOTHING`,
        [req.params.inscricaoId, lote.preco, data.id]
      );
      await enviarEmailConfirmacaoEvento(req.params.inscricaoId);
      return res.json({ ok: true });
    }

    const motivoCharge = charges[0];
    const motivo = motivoCharge ? (motivoCharge.payment_response?.message || motivoCharge.status || 'Recusado') : 'Pagamento não aprovado';
    console.error('PagBank cartão recusado:', motivo);
    res.json({ ok: false, erro: traduzirRecusaCartao(motivo) });

  } catch(e) {
    const detail = e.response ? JSON.stringify(e.response.data).substring(0, 300) : e.message;
    console.error('PagBank cartão ERRO:', detail);
    res.json({ ok: false, erro: 'Erro ao processar cartão. Verifique os dados e tente novamente.' });
  }
});

// Página de confirmação (já pago)
router.get('/pagamento/:inscricaoId/confirmado', async (req, res) => {
  try {
    const r = await query(
      'SELECT i.*, e.nome as evento_nome, e.cor_tema, e.banner_chave, e.local, e.data_inicio FROM evento_inscricoes i JOIN eventos e ON e.id=i.evento_id WHERE i.id=$1',
      [req.params.inscricaoId]
    );
    const inscricao = r.rows[0];
    if (!inscricao) return res.status(404).send('Não encontrado.');
    const config = await getConfig();
    res.render('pages/evento-confirmado', { config, inscricao });
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

// ─── HELPERS PAGAMENTO ────────────────────────────────────────────────────────

async function enviarEmailConfirmacaoEvento(inscricaoId) {
  try {
    const r = await query(
      `SELECT i.*, e.nome as evento_nome, e.email_inscricao, e.wpp_grupo, e.notif_email, e.data_inicio, e.local, e.cor_tema FROM evento_inscricoes i JOIN eventos e ON e.id=i.evento_id WHERE i.id=$1`,
      [inscricaoId]
    );
    const insc = r.rows[0];
    if (!insc || !insc.email) return;
    const config = await getConfig();
    // resend
    const cor = insc.cor_tema || '#1a3d2b';
    const corEsc = '#0a2018';
    const orgNome = config.org_nome || 'Liga Academica de Urologia';
    const orgLogo = config.org_logo || null;
    const textoExtra = insc.email_inscricao || '';
    const dataStr = insc.data_inicio ? new Date(insc.data_inicio).toLocaleDateString('pt-BR', {day:'2-digit',month:'long',year:'numeric',timeZone:'UTC'}) : '';
    const logoHtml = orgLogo ? '<img src="'+orgLogo+'" alt="'+orgNome+'" style="max-height:56px;max-width:180px;object-fit:contain;display:block;margin:0 auto">' : '<span style="color:white;font-size:20px;font-weight:800">'+orgNome+'</span>';
    const wppBtn = insc.wpp_grupo ? '<a href="'+insc.wpp_grupo+'" style="display:inline-block;background:#25d366;color:white;padding:12px 32px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.5px;text-transform:uppercase">Entrar no grupo do evento</a>' : '';
    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f1f5f9"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">'
      +'<tr><td style="background:linear-gradient(160deg,'+cor+' 0%,'+corEsc+' 100%);border-radius:12px 12px 0 0;padding:36px 40px;text-align:center">'+logoHtml+'<div style="margin-top:14px;display:inline-block;background:rgba(255,255,255,0.15);border-radius:4px;padding:4px 16px"><span style="color:rgba(255,255,255,0.9);font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase">INSCRICAO CONFIRMADA</span></div></td></tr>'
      +'<tr><td style="background:white;padding:36px 40px"><div style="border-left:3px solid '+cor+';padding-left:14px;margin-bottom:24px"><p style="margin:0;font-size:11px;font-weight:700;color:'+cor+';letter-spacing:1.5px;text-transform:uppercase">CONFIRMACAO DE INSCRICAO</p><h2 style="margin:4px 0 0;font-size:20px;font-weight:700;color:#0f172a">'+insc.evento_nome+'</h2></div>'
      +'<p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7">Ola, <strong>'+insc.nome.split(' ')[0]+'</strong>! Sua inscricao foi confirmada com sucesso.</p>'
      +(wppBtn?'<div style="text-align:center;padding-bottom:24px">'+wppBtn+'</div>':'')
      +'<div style="text-align:center;margin:24px 0;padding:24px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0">'
      +'<p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px">Seu QR Code de Check-in</p>'
      +'<img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data='+encodeURIComponent(insc.qrcode||insc.id)+'" style="width:160px;height:160px;border-radius:8px" alt="QR Code">'
      +'<p style="margin:12px 0 0;font-size:11px;color:#94a3b8">Apresente este QR Code na entrada do evento</p>'
      +'<p style="margin:6px 0 0;font-size:12px;font-family:monospace;color:#475569;font-weight:600">'+insc.qrcode+'</p>'
      +'</div>'
      +'</td></tr><tr><td style="background:#0f172a;border-radius:0 0 12px 12px;padding:24px 40px"><table width="100%" cellpadding="0" cellspacing="0"><tr><td><p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;font-weight:600">'+orgNome+'</p><p style="margin:4px 0 0;color:rgba(255,255,255,0.4);font-size:10px">Duvidas? Responda este e-mail.</p></td><td align="right"><p style="margin:0;color:rgba(255,255,255,0.3);font-size:9px;letter-spacing:1.5px;text-transform:uppercase">Powered by PagBank</p></td></tr></table></td></tr>'
      +'</table></td></tr></table></body></html>';
    await enviarEmail({ from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>', to: insc.email, subject: 'Inscricao confirmada — ' + insc.evento_nome, html });
    if (insc.notif_email) {
      await enviarEmail({ from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>', to: insc.notif_email, subject: 'Pagamento confirmado — ' + insc.nome + ' | ' + insc.evento_nome, html: '<p>Confirmado: <strong>' + insc.nome + '</strong> — ' + insc.evento_nome + '</p>' }).catch(() => {});
    }
    console.log('Email confirmacao enviado:', insc.email);
  } catch(e) { console.error('enviarEmailConfirmacaoEvento ERRO:', e.message); }
}

function traduzirRecusaCartao(msg) {
  const m = (msg || '').toLowerCase();
  if (m.includes('insufficient') || m.includes('saldo')) return 'Saldo insuficiente no cartão.';
  if (m.includes('expired') || m.includes('expir')) return 'Cartão expirado.';
  if (m.includes('security') || m.includes('cvv') || m.includes('cvc')) return 'CVV inválido.';
  if (m.includes('invalid') || m.includes('inválid')) return 'Dados do cartão inválidos.';
  if (m.includes('blocked') || m.includes('bloqueado')) return 'Cartão bloqueado. Contate seu banco.';
  if (m.includes('limit') || m.includes('limite')) return 'Limite do cartão excedido.';
  return 'Pagamento não aprovado. Verifique os dados ou tente outro cartão.';
}


router.post('/eventos/:id/inscricoes/manual', requireAuth, async (req, res) => {
  const {nome,email,whatsapp,cpf,lote_id,status} = req.body;
  const qrcode = 'LAURO-' + req.params.id + '-' + Date.now();
  await query('INSERT INTO evento_inscricoes (evento_id,lote_id,nome,email,whatsapp,cpf,status,qrcode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [req.params.id,lote_id||null,nome,email,whatsapp||null,cpf||null,status||'confirmado',qrcode]);
  req.session.msg=['Inscrição manual adicionada!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/inscricoes/:iid/confirmar', requireAuth, async (req, res) => {
  await query("UPDATE evento_inscricoes SET status='confirmado' WHERE id=$1",[req.params.iid]);
  req.session.msg=['Inscrição confirmada!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/inscricoes/:iid/deletar', requireAuth, async (req, res) => {
  await query('DELETE FROM evento_inscricoes WHERE id=$1',[req.params.iid]);
  // Notificar primeiro da lista de espera
  try {
    const evR = await query('SELECT * FROM eventos WHERE id=$1',[req.params.id]);
    const ev = evR.rows[0];
    const espR = await query('SELECT * FROM evento_lista_espera WHERE evento_id=$1 AND notificado=false ORDER BY criado_em ASC LIMIT 1',[req.params.id]);
    if (espR.rows[0] && ev) {
      const esp = espR.rows[0];
      const {enviarWhatsApp} = require('../services/notificacoes');
      const config = await getConfig();
      const appUrl = process.env.APP_URL||'https://liga-urologia.onrender.com';
      const msg = (config.org_nome||'LAURO')+'\n\n*Vaga disponível!*\n\nOla, *'+esp.nome.split(' ')[0]+'*! Uma vaga abriu no evento *'+ev.nome+'*.\n\nAcesse agora para garantir sua vaga:\n'+appUrl+'/inscricao/'+ev.id;
      if (esp.whatsapp) await enviarWhatsApp(esp.whatsapp, msg);
      await query('UPDATE evento_lista_espera SET notificado=true, notificado_em=NOW() WHERE id=$1',[esp.id]);
    }
  } catch(e) {}
  req.session.msg=['Inscrição excluída!']; res.redirect('/eventos/'+req.params.id);
});

router.get('/eventos/:id/checkin', requireAuth, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const [evR, inscrR] = await Promise.all([
    query('SELECT * FROM eventos WHERE id=$1',[req.params.id]),
    query('SELECT i.*, l.nome as lote_nome FROM evento_inscricoes i LEFT JOIN evento_lotes l ON l.id=i.lote_id WHERE i.evento_id=$1 ORDER BY i.nome',[req.params.id])
  ]);
  const stats = await getEventoStats(req.params.id);
  res.render('pages/evento-checkin', { config, usuario: req.session.usuario, msg, erro:[], evento: evR.rows[0], inscricoes: inscrR.rows, stats });
});

// ─── CHECK-IN COM TEMPO (ENTRADA/SAIDA) ──────────────────────────────────────
router.post('/eventos/:id/checkin/buscar', requireAuth, async (req, res) => {
  try {
    const {busca} = req.body;
    const r = await query("SELECT * FROM evento_inscricoes WHERE evento_id=$1 AND (LOWER(nome) LIKE $2 OR qrcode=$3) LIMIT 1",
      [req.params.id,'%'+(busca||'').toLowerCase()+'%',busca]);
    if (!r.rows[0]) return res.json({ok:false, msg:'Inscrito nao encontrado.'});
    const insc = r.rows[0];

    // Verifica se tem entrada aberta (sem saida)
    const aberto = await query(
      "SELECT id FROM evento_presencas_tempo WHERE inscricao_id=$1 AND saida_em IS NULL ORDER BY entrada_em DESC LIMIT 1",
      [insc.id]
    );

    if (aberto.rows.length > 0) {
      // SAIDA — fecha a sessao aberta
      await query("UPDATE evento_presencas_tempo SET saida_em=NOW() WHERE id=$1", [aberto.rows[0].id]);
      // Calcula tempo total
      const tot = await query(
        "SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(saida_em,NOW())-entrada_em))),0) as segundos FROM evento_presencas_tempo WHERE inscricao_id=$1",
        [insc.id]
      );
      const mins = Math.round(tot.rows[0].segundos / 60);
      return res.json({ok:true, tipo:'saida', msg:'Saida registrada: '+insc.nome+' — '+mins+' min acumulados', nome: insc.nome});
    } else {
      // ENTRADA — abre nova sessao
      await query(
        "INSERT INTO evento_presencas_tempo (inscricao_id, evento_id, entrada_em) VALUES ($1,$2,NOW())",
        [insc.id, req.params.id]
      );
      // Primeiro checkin — marca checkin_em se ainda nao tiver
      if (!insc.checkin_em) {
        await query("UPDATE evento_inscricoes SET checkin_em=NOW() WHERE id=$1", [insc.id]);
      }
      return res.json({ok:true, tipo:'entrada', msg:'Entrada registrada: '+insc.nome, nome: insc.nome});
    }
  } catch(e) { res.json({ok:false, msg:'Erro: '+e.message}); }
});

router.post('/eventos/:id/inscricoes/:iid/checkin', requireAuth, async (req, res) => {
  await query('UPDATE evento_inscricoes SET checkin_em=NOW() WHERE id=$1',[req.params.iid]);
  req.session.msg=['Check-in realizado!']; res.redirect('/eventos/'+req.params.id+'/checkin');
});

router.post('/eventos/:id/pagamentos/:pid/confirmar', requireAuth, async (req, res) => {
  await query("UPDATE evento_pagamentos SET status='pago', pago_em=NOW() WHERE id=$1",[req.params.pid]);
  await query("UPDATE evento_inscricoes SET status='confirmado' WHERE id=(SELECT inscricao_id FROM evento_pagamentos WHERE id=$1)",[req.params.pid]);
  req.session.msg=['Pagamento confirmado!']; res.redirect('/eventos/'+req.params.id);
});

router.get('/eventos/:id/relatorio-pdf', requireAuth, async (req, res) => {
  try {
    const [evR, inscrR, pgR, config] = await Promise.all([
      query('SELECT * FROM eventos WHERE id=$1',[req.params.id]),
      query("SELECT * FROM evento_inscricoes WHERE evento_id=$1 ORDER BY nome",[req.params.id]),
      query("SELECT * FROM evento_pagamentos WHERE status='pago' AND inscricao_id IN (SELECT id FROM evento_inscricoes WHERE evento_id=$1)",[req.params.id]),
      getConfig()
    ]);
    const ev = evR.rows[0];
    if (!ev) return res.status(404).send('Evento nao encontrado');
    const inscritos = inscrR.rows;
    const pagamentos = pgR.rows;
    const orgNome = config.org_nome||'LAURO';
    const orgCor = ev.cor_tema||config.org_cor||'#1a56db';
    const orgLogo = config.org_logo||null;
    const dataEv = ev.data_inicio?new Date(ev.data_inicio).toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}):'';
    const confirmados = inscritos.filter(i=>i.status==='confirmado').length;
    const checkins = inscritos.filter(i=>i.checkin_em).length;
    let bruto=0, taxas=0;
    pagamentos.forEach(p=>{
      const v=Number(p.valor)||0; bruto+=v;
      if(p.metodo==='pix') taxas+=v*0.0099;
      else if(p.metodo==='cartao') taxas+=v*0.0299+0.40;
    });
    const liquido = bruto-taxas;
    const logoHtml = orgLogo?`<img src="${orgLogo}" style="max-height:50px;max-width:160px;object-fit:contain" alt="${orgNome}">`:`<span style="font-size:18px;font-weight:800;color:white">${orgNome}</span>`;
    const linhasInscritos = inscritos.map((i,idx)=>`<tr style="background:${idx%2===0?'#f8fafc':'white'}"><td style="padding:6px 10px;font-size:11px">${idx+1}</td><td style="padding:6px 10px;font-size:11px;font-weight:600">${i.nome}</td><td style="padding:6px 10px;font-size:11px">${i.email||'—'}</td><td style="padding:6px 10px;font-size:11px">${i.lote_nome||'—'}</td><td style="padding:6px 10px;font-size:11px;text-align:center"><span style="background:${i.status==='confirmado'?'#dcfce7':'#fef3c7'};color:${i.status==='confirmado'?'#166534':'#92400e'};padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700">${i.status}</span></td><td style="padding:6px 10px;font-size:11px;text-align:center">${i.checkin_em?'✅':'—'}</td></tr>`).join('');
    const estilos=`*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;color:#374151}@media print{.np{display:none}}.header{background:linear-gradient(135deg,${orgCor},${orgCor}cc);padding:28px 32px;color:white;display:flex;align-items:center;justify-content:space-between}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:20px 32px;background:#f8fafc;border-bottom:1px solid #e5e7eb}.stat{background:white;border-radius:8px;padding:14px;text-align:center;border:1px solid #e5e7eb}.stat-num{font-size:24px;font-weight:800;color:${orgCor}}.stat-lab{font-size:10px;color:#6b7280;font-weight:600;text-transform:uppercase;margin-top:3px}.section{padding:24px 32px}.sec-title{font-size:14px;font-weight:700;margin-bottom:14px;padding-bottom:6px;border-bottom:2px solid ${orgCor}}.fin-row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #e5e7eb;font-size:13px}table{width:100%;border-collapse:collapse}thead th{background:${orgCor};color:white;padding:8px 10px;font-size:11px;text-align:left}.btn-p{position:fixed;bottom:20px;right:20px;padding:12px 24px;background:${orgCor};color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600}`;
    const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${estilos}</style></head><body>
<div class="header"><div>${logoHtml}<div style="margin-top:8px;font-size:13px;opacity:.85">${orgNome}</div></div><div style="text-align:right"><div style="font-size:20px;font-weight:800">${ev.nome}</div><div style="font-size:13px;opacity:.85;margin-top:4px">${dataEv}</div><div style="font-size:12px;opacity:.75">${ev.local||''}</div></div></div>
<div class="stats"><div class="stat"><div class="stat-num">${inscritos.length}</div><div class="stat-lab">Inscritos</div></div><div class="stat"><div class="stat-num">${confirmados}</div><div class="stat-lab">Confirmados</div></div><div class="stat"><div class="stat-num">${checkins}</div><div class="stat-lab">Check-ins</div></div><div class="stat"><div class="stat-num">R$ ${liquido.toLocaleString('pt-BR',{minimumFractionDigits:2})}</div><div class="stat-lab">Receita líquida</div></div></div>
<div class="section"><div class="sec-title">Resumo financeiro</div><div class="fin-row"><span>Receita bruta</span><span style="color:#10b981;font-weight:600">R$ ${bruto.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div><div class="fin-row"><span>Taxas</span><span style="color:#ef4444;font-weight:600">- R$ ${taxas.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div><div class="fin-row" style="border-bottom:2px solid ${orgCor}"><span style="font-weight:700">Receita líquida</span><span style="font-weight:800;color:${orgCor}">R$ ${liquido.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div></div>
<div class="section"><div class="sec-title">Lista de inscritos (${inscritos.length})</div><table><thead><tr><th>#</th><th>Nome</th><th>Email</th><th>Lote</th><th>Status</th><th>Check-in</th></tr></thead><tbody>${linhasInscritos}</tbody></table></div>
<button class="btn-p np" onclick="window.print()">Imprimir / Salvar PDF</button>
<script>window.onload=()=>window.print();</script></body></html>`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.send(html);
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});
router.get('/eventos/:id/inscricoes/:iid/cracha', requireAuth, async (req, res) => {
  try {
    const [inscR, evR, config] = await Promise.all([
      query('SELECT * FROM evento_inscricoes WHERE id=$1',[req.params.iid]),
      query('SELECT * FROM eventos WHERE id=$1',[req.params.id]),
      getConfig()
    ]);
    const insc=inscR.rows[0]; const ev=evR.rows[0];
    if (!insc||!ev) return res.status(404).send('Nao encontrado');
    const orgLogo=config.org_logo||null;
    const orgNome=config.org_nome||'LAURO';
    const orgCor=ev.cor_tema||config.org_cor||'#1a56db';
    const dataEv=ev.data_inicio?new Date(ev.data_inicio).toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'}):'';
    const qrUrl='https://api.qrserver.com/v1/create-qr-code/?size=120x120&data='+encodeURIComponent(insc.qrcode||insc.id);
    const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
@page{size:85mm 54mm;margin:0}*{margin:0;padding:0;box-sizing:border-box}body{width:85mm;height:54mm;font-family:Arial,sans-serif;overflow:hidden}
.cracha{width:85mm;height:54mm;position:relative;background:white}
.topo{background:${orgCor};height:14mm;display:flex;align-items:center;padding:0 4mm;gap:3mm}
.topo img{height:10mm;max-width:24mm;object-fit:contain;filter:brightness(0) invert(1)}
.topo-nome{color:white;font-size:9pt;font-weight:700}
.corpo{display:flex;height:34mm;padding:3mm 4mm;gap:3mm;align-items:center}
.info{flex:1;min-width:0}
.nome{font-size:11pt;font-weight:800;color:#111;line-height:1.2;margin-bottom:2mm;word-break:break-word}
.tipo{font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:white;background:${orgCor};padding:1mm 3mm;border-radius:3mm;display:inline-block;margin-bottom:2mm}
.ev-nome{font-size:7pt;color:#6b7280;line-height:1.3}
.qr{flex-shrink:0;text-align:center}
.qr img{width:22mm;height:22mm}
.qr-lab{font-size:5pt;color:#9ca3af;margin-top:1mm}
.rodape{background:#f8fafc;height:6mm;display:flex;align-items:center;justify-content:space-between;padding:0 4mm;border-top:.3mm solid #e5e7eb}
.rodape span{font-size:6pt;color:#9ca3af}
</style></head><body>
<div class="cracha">
  <div class="topo">
    ${orgLogo?`<img src="${orgLogo}" alt="${orgNome}">`:`<span class="topo-nome">${orgNome}</span>`}
    <span class="topo-nome">${ev.nome.substring(0,35)}</span>
  </div>
  <div class="corpo">
    <div class="info">
      <div class="nome">${insc.nome}</div>
      <div class="tipo">${insc.tipo_participante||'Participante'}</div>
      <div class="ev-nome">${ev.nome}</div>
      ${dataEv?`<div class="ev-nome" style="margin-top:1mm">${dataEv}</div>`:''}
    </div>
    <div class="qr"><img src="${qrUrl}" alt="QR"><div class="qr-lab">Check-in</div></div>
  </div>
  <div class="rodape"><span>${orgNome}</span><span>${insc.qrcode||''}</span></div>
</div>
<script>window.onload=()=>window.print();</script>
</body></html>`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.send(html);
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});
router.get('/eventos/:id/inscricoes/:iid/certificado', requireAuth, async (req, res) => {
  try {
    const [inscR, evR, config] = await Promise.all([query('SELECT * FROM evento_inscricoes WHERE id=$1',[req.params.iid]), query('SELECT * FROM eventos WHERE id=$1',[req.params.id]), getConfig()]);
    const insc=inscR.rows[0]; const ev=evR.rows[0];
    const {imagemBase64} = require('../services/desligamento');
    config.timbrado_b64 = await imagemBase64(config.timbrado_chave);
    config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
    config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
    const dataEv = ev.data_inicio ? new Date(ev.data_inicio).toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'}) : '';
    const timbrado=config.timbrado_b64||null; const presidenteSrc=config.assinatura_presidente_b64||null; const secretarioSrc=config.assinatura_secretario_b64||null;
    const nomePresidente=(config.presidente_nome||'PRESIDENTE').toUpperCase(); const nomeSecretario=(config.secretario_nome||'SECRETÁRIO').toUpperCase();
    // Gerar codigo_validacao unico
    const crypto = require('crypto');
    const codigoVal = crypto.randomBytes(16).toString('hex');
    const appUrl = process.env.APP_URL || 'https://liga-urologia.onrender.com';
    const urlValidacao = appUrl + '/certificado/validar/' + codigoVal;
    // QR Code como URL de API publica
    const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=' + encodeURIComponent(urlValidacao);
    // Fundo: prioriza bg do evento, depois timbrado global
    const certBgB64 = ev.cert_bg_chave ? await imagemBase64(ev.cert_bg_chave) : null;
    const fundoSrc = certBgB64 || timbrado;
    const bgHtml = fundoSrc?`<div style="position:fixed;top:0;left:0;width:210mm;height:297mm;z-index:0"><img src="${timbrado}" style="width:210mm;height:297mm;display:block"></div>`:'';
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Times New Roman',serif;color:#000;width:210mm}</style></head><body>${bgHtml}<div style="position:relative;z-index:1;width:210mm;min-height:297mm;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40mm 25mm;text-align:center"><div style="font-size:11pt;color:#666;margin-bottom:8px;text-transform:uppercase;letter-spacing:3px">Liga Académica de Urología — LAURO</div><div style="font-size:28pt;font-weight:bold;color:#1a3d2b;margin:20px 0;text-transform:uppercase;letter-spacing:2px">Certificado</div><div style="font-size:12pt;margin-bottom:16px">Certificamos que</div><div style="font-size:20pt;font-weight:bold;border-bottom:2px solid #1a3d2b;padding-bottom:8px;margin-bottom:16px">${insc.nome}</div><div style="font-size:12pt;line-height:1.8">participou do evento<br><strong style="font-size:14pt">${ev.nome}</strong><br>realizado em ${dataEv}<br>com carga horária de <strong>4 horas</strong></div><div style="display:flex;justify-content:space-around;margin-top:50px;width:100%"><div style="text-align:center"><div style="height:50px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:4px">${presidenteSrc?`<img src="${presidenteSrc}" style="max-height:50px">`:''}</div><div style="border-top:1.5px solid #000;width:160px;margin:0 auto 4px"></div><div style="font-size:9pt;font-weight:bold">${nomePresidente}</div><div style="font-size:8pt">PRESIDENTE</div></div><div style="text-align:center"><div style="height:50px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:4px">${secretarioSrc?`<img src="${secretarioSrc}" style="max-height:50px">`:''}</div><div style="border-top:1.5px solid #000;width:160px;margin:0 auto 4px"></div><div style="font-size:9pt;font-weight:bold">${nomeSecretario}</div><div style="font-size:8pt">SECRETÁRIO</div></div></div></div><script>window.onload=function(){window.print()}</script></body></html>`;
    await query('INSERT INTO evento_certificados (inscricao_id, codigo_validacao) VALUES ($1,$2) ON CONFLICT (inscricao_id) DO UPDATE SET codigo_validacao=EXCLUDED.codigo_validacao RETURNING id',[insc.id, codigoVal]);
    // Enviar por WhatsApp
    if (insc.whatsapp) {
      try {
        const {enviarWhatsApp} = require('../services/notificacoes');
        const config2 = await getConfig();
        const msg = (config2.org_nome||'LAURO')+'\n\nOla, *'+insc.nome.split(' ')[0]+'*!\n\nSeu certificado de participacao no evento *'+ev.nome+'* esta disponivel!\n\nAcesse e valide seu certificado:\n'+urlValidacao;
        await enviarWhatsApp(insc.whatsapp, msg);
        await query('UPDATE evento_certificados SET enviado_wpp=true WHERE inscricao_id=$1',[insc.id]);
      } catch(e) {}
    }
    // Enviar por email
    if (insc.email) {
      try {
        const {enviarEmail} = require('../services/notificacoes');
        const config2 = await getConfig();
        const htmlEmail = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;background:#f8fafc;padding:32px 16px"><table width="100%" style="max-width:600px;margin:0 auto;background:white;border-radius:14px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08)"><tr><td style="background:linear-gradient(135deg,'+(config2.org_cor||'#1a56db')+','+(config2.org_cor||'#1a56db')+'cc);padding:32px;text-align:center"><span style="font-size:20px;font-weight:800;color:white">'+(config2.org_nome||'LAURO')+'</span></td></tr><tr><td style="padding:36px 40px;font-size:15px;color:#374151;line-height:1.8"><p>Ola, <strong>'+insc.nome.split(' ')[0]+'</strong>!</p><p>Seu certificado de participacao no evento <strong>'+ev.nome+'</strong> foi emitido com sucesso!</p><div style="text-align:center;margin:24px 0"><img src="'+qrUrl+'" style="width:120px;height:120px"><p style="font-size:12px;color:#6b7280;margin-top:8px">Escaneie o QR Code para validar seu certificado</p></div><div style="text-align:center"><a href="'+urlValidacao+'" style="background:'+(config2.org_cor||'#1a56db')+';color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Validar certificado</a></div></td></tr><tr><td style="padding:16px 40px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;color:#94a3b8">'+(config2.org_nome||'LAURO')+'</td></tr></table></body></html>';
        await enviarEmail({para:insc.email, assunto:'Seu certificado — '+ev.nome, html:htmlEmail, texto:'Seu certificado esta disponivel: '+urlValidacao});
        await query('UPDATE evento_certificados SET enviado_email=true WHERE inscricao_id=$1',[insc.id]);
      } catch(e) {}
    }
    res.send(html);
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});

router.post('/eventos/:id/cert-bg', requireAuth, async (req, res) => {
  try {
    const {upload, uploadArquivo} = require('../services/arquivos');
    upload.single('cert_bg')(req, res, async (err) => {
      if (req.file) {
        const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'cert-bg');
        await query('UPDATE eventos SET cert_bg_chave=$1 WHERE id=$2', [r.chave, req.params.id]);
      }
      req.session.msg = ['Fundo salvo!'];
      res.redirect('/eventos/'+req.params.id+'?tab=certificados');
    });
  } catch(e) { res.redirect('/eventos/'+req.params.id+'?tab=certificados'); }
});
router.post('/eventos/:id/cert-bg/remover', requireAuth, async (req, res) => {
  await query('UPDATE eventos SET cert_bg_chave=NULL WHERE id=$1', [req.params.id]);
  req.session.msg = ['Fundo removido!'];
  res.redirect('/eventos/'+req.params.id+'?tab=certificados');
});
router.get('/eventos/:id/cert-bg', async (req, res) => {
  try {
    const r = await query('SELECT cert_bg_chave FROM eventos WHERE id=$1', [req.params.id]);
    const chave = r.rows[0]?.cert_bg_chave;
    if (!chave) return res.status(404).send('Sem fundo');
    const {downloadArquivo} = require('../services/arquivos');
    const {buffer, contentType} = await downloadArquivo(chave);
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch(e) { res.status(500).send('Erro'); }
});
router.post('/eventos/:id/certificados/emitir-todos', requireAuth, async (req, res) => {
  const inscritos = await query("SELECT id FROM evento_inscricoes WHERE evento_id=$1 AND checkin_em IS NOT NULL",[req.params.id]);
  for (const i of inscritos.rows) { await query('INSERT INTO evento_certificados (inscricao_id) VALUES ($1) ON CONFLICT DO NOTHING',[i.id]); }
  req.session.msg=['Certificados emitidos para '+inscritos.rows.length+' participantes!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/campos', requireAuth, async (req, res) => {
  const {label,tipo,opcoes,obrigatorio} = req.body;
  const ord = await query('SELECT COUNT(*) FROM evento_campos WHERE evento_id=$1',[req.params.id]);
  await query('INSERT INTO evento_campos (evento_id,label,tipo,opcoes,obrigatorio,ordem) VALUES ($1,$2,$3,$4,$5,$6)',
    [req.params.id,label,tipo||'text',opcoes||null,obrigatorio==='true',parseInt(ord.rows[0].count)+1]);
  req.session.msg=['Campo adicionado!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/campos/:cid/mover', requireAuth, async (req, res) => {
  const { direcao } = req.body;
  const r = await query('SELECT * FROM evento_campos WHERE id=$1', [req.params.cid]);
  const campo = r.rows[0];
  if (!campo) return res.redirect('/eventos/'+req.params.id+'?tab=campos');
  const ordemAtual = campo.ordem;
  const ordemNova = direcao === 'cima' ? ordemAtual - 1 : ordemAtual + 1;
  const outro = await query('SELECT id FROM evento_campos WHERE evento_id=$1 AND ordem=$2', [req.params.id, ordemNova]);
  if (outro.rows[0]) {
    await query('UPDATE evento_campos SET ordem=$1 WHERE id=$2', [ordemAtual, outro.rows[0].id]);
    await query('UPDATE evento_campos SET ordem=$1 WHERE id=$2', [ordemNova, req.params.cid]);
  }
  res.redirect('/eventos/'+req.params.id+'?tab=campos');
});

router.post('/eventos/:id/campos/:cid/deletar', requireAuth, async (req, res) => {
  await query('DELETE FROM evento_campos WHERE id=$1',[req.params.cid]);
  req.session.msg=['Campo removido!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/lotes/:lid/editar', requireAuth, async (req, res) => {
  const {nome,preco,vagas,data_inicio,data_fim} = req.body;
  await query('UPDATE evento_lotes SET nome=$1,preco=$2,vagas=$3,data_inicio=$4,data_fim=$5 WHERE id=$6',
    [nome,parseFloat(preco)||0,parseInt(vagas),data_inicio||null,data_fim||null,req.params.lid]);
  req.session.msg=['Lote atualizado!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/contato-evento/:id', async (req, res) => {
  try {
    const {nome,email,mensagem} = req.body;
    // resend
    await enviarEmail({ from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>', to:'lauroucpcde@lauroucpcde.com', subject:'Contato via evento — '+nome, html:'<p><strong>Nome:</strong> '+nome+'</p><p><strong>Email:</strong> '+email+'</p><p><strong>Mensagem:</strong><br>'+mensagem+'</p>' });
    res.send('<script>alert("Mensagem enviada! Entraremos em contato em breve.");history.back();</script>');
  } catch(e) { res.send('<script>alert("Erro ao enviar. Tente novamente.");history.back();</script>'); }
});

router.get('/eventos/:id/cupom', async (req, res) => {
  try {
    const cod = req.query.cod?.toUpperCase();
    if (!cod) return res.json({ok:false});
    const r = await query('SELECT * FROM evento_cupons WHERE evento_id=$1 AND codigo=$2 AND ativo=true',[req.params.id,cod]);
    const cupom = r.rows[0];
    if (!cupom) return res.json({ok:false, msg:'Cupom inválido'});
    if (cupom.usos_atual >= cupom.usos_max) return res.json({ok:false, msg:'Cupom esgotado'});
    const desconto = cupom.tipo==='percentual' ? parseFloat(cupom.valor)/100 : null;
    res.json({ok:true, desconto, tipo:cupom.tipo, valor:cupom.valor});
  } catch(e) { res.json({ok:false}); }
});

router.post('/eventos/:id/avancado', requireAuth, async (req, res) => {
  const {email_inscricao,email_confirmacao,notif_email,wpp_grupo,inscricao_gratuita_auto,inscricao_unica,termos_texto,lgpd_texto} = req.body;
  await query('UPDATE eventos SET email_inscricao=$1,email_confirmacao=$2,wpp_grupo=$3,inscricao_gratuita_auto=$4,inscricao_unica=$5,termos_texto=$6,lgpd_texto=$7 WHERE id=$8',
    [email_inscricao||null,email_confirmacao||null,wpp_grupo||null,inscricao_gratuita_auto==='true',inscricao_unica==='true',termos_texto||null,lgpd_texto||null,req.params.id]);
  // carga_horaria salva via rota /editar
  req.session.msg=['Configurações avançadas salvas!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/programacao', requireAuth, async (req, res) => {
  const {horario,titulo,descricao,local} = req.body;
  const ord = await query('SELECT COUNT(*) FROM evento_programacao WHERE evento_id=$1',[req.params.id]);
  await query('INSERT INTO evento_programacao (evento_id,horario,titulo,descricao,local,ordem) VALUES ($1,$2,$3,$4,$5,$6)',
    [req.params.id,horario,titulo,descricao||null,local||null,parseInt(ord.rows[0].count)+1]);
  req.session.msg=['Item adicionado!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/programacao/:pid/deletar', requireAuth, async (req, res) => {
  await query('DELETE FROM evento_programacao WHERE id=$1',[req.params.pid]);
  req.session.msg=['Item removido!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/palestrantes', requireAuth, async (req, res) => {
  try {
    const {upload,uploadArquivo} = require('../services/arquivos');
    upload.single('foto')(req, res, async (err) => {
      const {nome,bio,instituicao} = req.body; let fotoChave=null;
      if (req.file) { const r=await uploadArquivo(req.file.buffer,req.file.originalname,req.file.mimetype,'palestrantes'); fotoChave=r.chave; }
      const ord = await query('SELECT COUNT(*) FROM evento_palestrantes WHERE evento_id=$1',[req.params.id]);
      await query('INSERT INTO evento_palestrantes (evento_id,nome,bio,instituicao,foto_chave,ordem) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.params.id,nome,bio||null,instituicao||null,fotoChave,parseInt(ord.rows[0].count)+1]);
      req.session.msg=['Palestrante adicionado!']; res.redirect('/eventos/'+req.params.id);
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/eventos/'+req.params.id); }
});

router.get('/eventos/palestrantes/:id/foto', async (req, res) => {
  try {
    const r = await query('SELECT foto_chave FROM evento_palestrantes WHERE id=$1',[req.params.id]);
    if (!r.rows[0]?.foto_chave) return res.status(404).send('');
    const {getUrlAssinada} = require('../services/desligamento');
    res.redirect(await getUrlAssinada(r.rows[0].foto_chave));
  } catch(e) { res.status(500).send(''); }
});

router.post('/eventos/:id/palestrantes/:pid/deletar', requireAuth, async (req, res) => {
  await query('DELETE FROM evento_palestrantes WHERE id=$1',[req.params.pid]);
  req.session.msg=['Palestrante removido!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/patrocinadores', requireAuth, async (req, res) => {
  try {
    const {upload,uploadArquivo} = require('../services/arquivos');
    upload.single('logo')(req, res, async (err) => {
      const {nome,url} = req.body; let logoChave=null;
      if (req.file) { const r=await uploadArquivo(req.file.buffer,req.file.originalname,req.file.mimetype,'patrocinadores'); logoChave=r.chave; }
      const ord = await query('SELECT COUNT(*) FROM evento_patrocinadores WHERE evento_id=$1',[req.params.id]);
      await query('INSERT INTO evento_patrocinadores (evento_id,nome,url,logo_chave,ordem) VALUES ($1,$2,$3,$4,$5)',
        [req.params.id,nome,url||null,logoChave,parseInt(ord.rows[0].count)+1]);
      req.session.msg=['Patrocinador adicionado!']; res.redirect('/eventos/'+req.params.id);
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/eventos/'+req.params.id); }
});

router.get('/eventos/patrocinadores/:id/logo', async (req, res) => {
  try {
    const r = await query('SELECT logo_chave FROM evento_patrocinadores WHERE id=$1',[req.params.id]);
    if (!r.rows[0]?.logo_chave) return res.status(404).send('');
    const {getUrlAssinada} = require('../services/desligamento');
    res.redirect(await getUrlAssinada(r.rows[0].logo_chave));
  } catch(e) { res.status(500).send(''); }
});

router.post('/eventos/:id/patrocinadores/:pid/deletar', requireAuth, async (req, res) => {
  await query('DELETE FROM evento_patrocinadores WHERE id=$1',[req.params.pid]);
  req.session.msg=['Patrocinador removido!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/cupons', requireAuth, async (req, res) => {
  const {codigo,tipo,valor,usos_max} = req.body;
  try {
    await query('INSERT INTO evento_cupons (evento_id,codigo,tipo,valor,usos_max) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id,codigo.toUpperCase(),tipo||'percentual',parseFloat(valor)||100,parseInt(usos_max)||1]);
    req.session.msg=['Cupom criado!'];
  } catch(e) { req.session.erro=['Código já existe!']; }
  res.redirect('/eventos/'+req.params.id+'?tab=cupons');
});

router.post('/eventos/:id/cupons/:cid/deletar', requireAuth, async (req, res) => {
  await query('DELETE FROM evento_cupons WHERE id=$1',[req.params.cid]);
  req.session.msg=['Cupom excluído!']; res.redirect('/eventos/'+req.params.id);
});

// Gerar cupons em lote para ligantes EM DIA e diretivos com envio via WhatsApp/email
router.post('/eventos/:id/cupons/gerar-ligantes', requireAuth, async (req, res) => {
  // versao nova abaixo
  const _dummy = 1;
});
router.post('/eventos/:id/cupons/gerar-ligantes-v2', requireAuth, async (req, res) => {
  const { prefixo, destino, enviar_wpp, enviar_email } = req.body;
  const pref = (prefixo||'LAURO').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const eventoR = await query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
  const evento = eventoR.rows[0];
  const { enviarWhatsApp, enviarEmail } = require('../services/notificacoes');
  const config = await query('SELECT chave,valor FROM configuracoes').then(r => { const c={}; r.rows.forEach(x=>c[x.chave]=x.valor); return c; });
  const orgNome = config.org_nome || 'LAURO';
  const appUrl = process.env.APP_URL || 'https://liga-urologia.onrender.com';

  let pessoas = [];

  // Ligantes EM DIA (último pagamento = pago OU sem cobranças = gratuito)
  if (destino === 'ligantes' || destino === 'todos') {
    const ligR = await query(`
      SELECT l.id, l.nome, l.email, l.whatsapp, 'ligante' as tipo,
        (SELECT c.status FROM cobrancas c WHERE c.membro_id IS NULL
         ORDER BY c.criado_em DESC LIMIT 1) as ultimo_status
      FROM ligantes l WHERE l.ativo=1
    `);
    // Verifica em dia: pago ou sem dívidas atrasadas
    for (const lig of ligR.rows) {
      const divR = await query(
        "SELECT COUNT(*) as n FROM cobrancas WHERE status='atrasado' AND referencia LIKE $1",
        ['%-' + lig.id + '-%']
      );
      // Ligantes não têm cobrança direta pelo id neste sistema — incluímos todos ativos
      pessoas.push({ ...lig, em_dia: true });
    }
  }

  // Diretivos — todos (não pagam mensalidade)
  if (destino === 'diretivos' || destino === 'todos') {
    const dirR = await query('SELECT id, nome, email, whatsapp, \'diretivo\' as tipo FROM diretivos WHERE ativo=1');
    dirR.rows.forEach(d => pessoas.push({ ...d, em_dia: true }));
  }

  let criados = 0, enviados = 0, erros = [];

  for (const p of pessoas) {
    if (!p.em_dia) continue;
    const crypto = require('crypto');
    const sufixo = crypto.randomBytes(3).toString('hex').toUpperCase();
    const codigo = pref + '-' + sufixo;
    const campo_pessoa = p.tipo === 'ligante' ? 'ligante_id' : 'diretivo_id';

    // Verifica se ja tem cupom para esta pessoa neste evento
    const jaTemR = await query(
      'SELECT id FROM evento_cupons WHERE evento_id=$1 AND '+campo_pessoa+'=$2',
      [req.params.id, p.id]
    );

    let codigoFinal = codigo;
    if (jaTemR.rows.length > 0) {
      // Reutiliza cupom existente
      const cupomExR = await query('SELECT codigo FROM evento_cupons WHERE evento_id=$1 AND '+campo_pessoa+'=$2', [req.params.id, p.id]);
      codigoFinal = cupomExR.rows[0].codigo;
    }

    try {
      if (jaTemR.rows.length === 0) {
        const col = p.tipo === 'ligante' ? 'ligante_id' : 'diretivo_id';
        await query('INSERT INTO evento_cupons (evento_id,codigo,tipo,valor,usos_max,'+col+') VALUES ($1,$2,$3,$4,$5,$6)',
          [req.params.id, codigoFinal, 'percentual', 100, 1, p.id]);
      }
      criados++;

      const msg = `*${orgNome}*\n\nOlá, *${p.nome.split(' ')[0]}*!\n\nVocê tem um *cupom de isenção 100%* para o evento:\n*${evento.nome}*\n\n🎫 Seu cupom: \`${codigoFinal}\`\n\n🔗 Inscreva-se em: ${appUrl}/inscricao/${req.params.id}\n\n_Cupom válido para uma inscrição._`;

      if (enviar_wpp === 'on' && p.whatsapp) {
        try { await enviarWhatsApp(p.whatsapp, msg); enviados++; await new Promise(r=>setTimeout(r,600)); } catch(e) { erros.push(p.nome); }
      }
      if (enviar_email === 'on' && p.email) {
        const html = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:20px">
          <h2 style="color:#1a3d2b">${orgNome}</h2>
          <p>Olá, <strong>${p.nome.split(' ')[0]}</strong>!</p>
          <p>Você tem um <strong>cupom de isenção 100%</strong> para o evento:</p>
          <h3 style="color:#1a3d2b">${evento.nome}</h3>
          <div style="background:#f0fdf4;border:2px dashed #22c55e;border-radius:10px;padding:20px;text-align:center;margin:20px 0">
            <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px">Seu cupom</div>
            <div style="font-size:28px;font-weight:900;font-family:monospace;color:#1a3d2b;letter-spacing:4px">${codigoFinal}</div>
            <div style="font-size:12px;color:#6b7280;margin-top:4px">válido para 1 inscrição</div>
          </div>
          <a href="${appUrl}/inscricao/${req.params.id}" style="display:inline-block;background:#1a3d2b;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700">🎟️ Inscrever-se agora</a>
        </div>`;
        try { await enviarEmail({ para: p.email, assunto: `🎟️ Seu cupom gratuito — ${evento.nome}`, html, texto: msg }); } catch(e) {}
      }
    } catch(e) { /* código duplicado — ignora */ }
  }

  req.session.msg=[`${criados} cupons gerados, ${enviados} notificações enviadas!`];
  res.redirect('/eventos/'+req.params.id+'?tab=cupons');
});

// ─── EDITAR INSCRITO ──────────────────────────────────────────────────────────
router.post('/eventos/:id/inscricoes/:iid/editar', requireAuth, async (req, res) => {
  const { nome, email, whatsapp, cpf, instituicao, status } = req.body;
  await query(
    'UPDATE evento_inscricoes SET nome=$1, email=$2, whatsapp=$3, cpf=$4, instituicao=$5, status=$6 WHERE id=$7',
    [nome, email, whatsapp||null, cpf||null, instituicao||null, status, req.params.iid]
  );
  req.session.msg=['Inscrito atualizado!'];
  res.redirect('/eventos/'+req.params.id+'?tab=inscritos');
});

// ─── EMAIL EM MASSA PARA INSCRITOS ────────────────────────────────────────────
router.post('/eventos/:id/campos/ordem', requireAuth, async (req, res) => {
  try {
    const { campos } = req.body;
    const lista = JSON.parse(campos);
    for (let i = 0; i < lista.length; i++) {
      await query(
        'INSERT INTO evento_campos_ordem (evento_id, campo, ordem) VALUES ($1,$2,$3) ON CONFLICT (evento_id,campo) DO UPDATE SET ordem=$3',
        [req.params.id, lista[i], i + 1]
      );
    }
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, msg: e.message }); }
});

router.get('/eventos/:id/mala-direta/historico', requireAuth, async (req, res) => {
  try {
    const r = await query(
      'SELECT e.*, u.nome as enviado_por_nome FROM mala_direta_envios e LEFT JOIN usuarios u ON u.id=e.enviado_por WHERE e.evento_id=$1 ORDER BY e.criado_em DESC',
      [req.params.id]
    );
    res.json({ ok: true, envios: r.rows });
  } catch(e) { res.json({ ok: false }); }
});

router.get('/eventos/:id/mala-direta/:envio_id/logs', requireAuth, async (req, res) => {
  try {
    const r = await query(
      'SELECT * FROM mala_direta_logs WHERE envio_id=$1 ORDER BY criado_em',
      [req.params.envio_id]
    );
    res.json({ ok: true, logs: r.rows });
  } catch(e) { res.json({ ok: false }); }
});

router.post('/eventos/:id/mala-direta', requireAuth, async (req, res) => {
  const { assunto, conteudo_html, destinatarios } = req.body;
  try {
    const config = await getConfig();
    const orgNome = config.org_nome || 'Liga Academica de Urologia';
    const orgCor = config.org_cor || '#1a56db';
    const orgLogo = config.org_logo || null;
    // resend
    let where = "WHERE evento_id=$1 AND email IS NOT NULL";
    const params = [req.params.id];
    if (destinatarios === 'confirmados') where += " AND status='confirmado'";
    else if (destinatarios === 'pendentes') where += " AND status='pendente'";
    const r = await query('SELECT * FROM evento_inscricoes '+where, params);
    const envioR = await query(
      'INSERT INTO mala_direta_envios (evento_id,assunto,conteudo_html,destinatarios,enviado_por) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [req.params.id, assunto, conteudo_html, destinatarios, req.session.usuario.id]
    );
    const envioId = envioR.rows[0].id;
    const logoHtml = orgLogo
      ? '<img src="'+orgLogo+'" style="max-height:56px;max-width:180px;object-fit:contain;display:block;margin:0 auto" alt="'+orgNome+'">'
      : '<span style="font-size:20px;font-weight:800;color:white">'+orgNome+'</span>';
    let enviados = 0, erros = 0;
    for (const insc of r.rows) {
      const conteudo = conteudo_html.replace(/\{nome\}/g, insc.nome.split(' ')[0]);
      const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
        +'<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">'
        +'<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">'
        +'<table width="100%" style="max-width:600px;background:white;border-radius:14px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08)">'
        +'<tr><td style="background:linear-gradient(135deg,'+orgCor+','+orgCor+'cc);padding:32px;text-align:center">'+logoHtml
        +'<div style="color:rgba(255,255,255,.85);font-size:13px;margin-top:8px">'+orgNome+'</div></td></tr>'
        +'<tr><td style="padding:36px 40px;font-size:15px;color:#374151;line-height:1.8">'
        +'<p style="margin:0 0 20px;font-size:16px">Ola, <strong>'+insc.nome.split(' ')[0]+'</strong>!</p>'
        +conteudo
        +'</td></tr>'
        +'<tr><td style="padding:20px 40px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center">'
        +'<p style="margin:0;font-size:12px;color:#94a3b8">'+orgNome+' &bull; Esta mensagem foi enviada pela secretaria</p>'
        +'</td></tr></table></td></tr></table></body></html>';
      let status = 'enviado';
      try {
        await enviarEmail({ from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>', to: insc.email, subject: assunto, html });
        enviados++;
        await new Promise(r => setTimeout(r, 200));
      } catch(e) { status = 'erro'; erros++; }
      await query('INSERT INTO mala_direta_logs (envio_id,inscricao_id,email,nome,status) VALUES ($1,$2,$3,$4,$5)',
        [envioId, insc.id, insc.email, insc.nome, status]);
    }
    await query('UPDATE mala_direta_envios SET total_enviados=$1,total_erros=$2 WHERE id=$3',[enviados,erros,envioId]);
    req.flash('msg', 'Email enviado para '+enviados+' inscritos!');
  } catch(e) { req.flash('erro','Erro: '+e.message); }
  res.redirect('/eventos/'+req.params.id+'?tab=mala-direta');
});

router.post('/eventos/:id/mala-direta', requireAuth, async (req, res) => {
  const { assunto, conteudo_html, destinatarios } = req.body;
  try {
    const evR = await query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
    const ev = evR.rows[0];
    const config = await getConfig();
    const orgNome = config.org_nome || 'Liga Academica de Urologia';
    const orgLogo = config.org_logo || null;
    // resend
    let where = "WHERE evento_id=$1 AND email IS NOT NULL";
    const params = [req.params.id];
    if (destinatarios === 'confirmados') where += " AND status='confirmado'";
    else if (destinatarios === 'pendentes') where += " AND status='pendente'";
    const r = await query('SELECT * FROM evento_inscricoes '+where, params);
    const logoHtml = orgLogo
      ? '<img src="'+orgLogo+'" style="max-height:56px;max-width:180px;object-fit:contain;display:block;margin:0 auto">'
      : '<span style="font-size:18px;font-weight:800;color:#1a56db">'+orgNome+'</span>';
    let enviados = 0;
    for (const insc of r.rows) {
      const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
        +'<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif">'
        +'<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px"><tr><td align="center">'
        +'<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06)">'
        +'<tr><td style="padding:28px 32px;text-align:center;border-bottom:1px solid #f1f5f9">'+logoHtml+'</td></tr>'
        +'<tr><td style="padding:32px;font-size:15px;color:#374151;line-height:1.7">'
        +'<p style="margin:0 0 16px">Ola, <strong>'+insc.nome.split(' ')[0]+'</strong>!</p>'
        +conteudo_html
        +'</td></tr>'
        +'<tr><td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #f1f5f9;text-align:center">'
        +'<p style="margin:0;font-size:12px;color:#94a3b8">'+orgNome+' · Mensagem enviada pela secretaria</p>'
        +'</td></tr>'
        +'</table></td></tr></table></body></html>';
      try { await enviarEmail({from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>',to:insc.email,subject:assunto,html}); enviados++; await new Promise(r=>setTimeout(r,200)); } catch(e){}
    }
    req.flash('msg', 'Email enviado para '+enviados+' inscritos!');
  } catch(e) { req.flash('erro', 'Erro: '+e.message); }
  res.redirect('/eventos/'+req.params.id+'?tab=mala-direta');
});

router.post('/eventos/:id/email-massa', requireAuth, async (req, res) => {
  const { assunto, mensagem, apenas_confirmados } = req.body;
  try {
    let sql = 'SELECT * FROM evento_inscricoes WHERE evento_id=$1 AND email IS NOT NULL';
    if (apenas_confirmados === 'on') sql += " AND status='confirmado'";
    const r = await query(sql, [req.params.id]);
    const evR = await query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
    const evento = evR.rows[0];
    const config = await query('SELECT chave,valor FROM configuracoes').then(r => { const c={}; r.rows.forEach(x=>c[x.chave]=x.valor); return c; });
    // resend
    const cor = evento.cor_tema || '#1a3d2b';
    let enviados = 0;
    for (const insc of r.rows) {
      const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f4f4f4;padding:20px">
        <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
          <div style="background:${cor};padding:22px 28px">
            <h2 style="color:#fff;margin:0">${config.org_nome||'LAURO'}</h2>
            <p style="color:rgba(255,255,255,.75);margin:4px 0 0;font-size:13px">${evento.nome}</p>
          </div>
          <div style="padding:28px">
            <p style="color:#555;margin-bottom:20px">Olá, <strong>${insc.nome.split(' ')[0]}</strong>!</p>
            <div style="color:#374151;line-height:1.7">${mensagem.replace(/\n/g,'<br>')}</div>
            <p style="font-size:12px;color:#9ca3af;margin-top:24px;padding-top:16px;border-top:1px solid #f3f4f6">${config.org_nome||'LAURO'} · Dúvidas? Responda este e-mail.</p>
          </div>
        </div></body></html>`;
      try {
        await enviarEmail({ from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>', to:insc.email, subject:assunto, html });
        enviados++;
        await new Promise(r=>setTimeout(r,300));
      } catch(e) { console.error('Email massa erro:', insc.email, e.message); }
    }
    req.session.msg=[`Email enviado para ${enviados} inscritos!`];
  } catch(e) {
    req.session.erro=['Erro: '+e.message];
  }
  res.redirect('/eventos/'+req.params.id+'?tab=inscritos');
});

// ─── SALVAR LGPD NO EVENTO (via avançado) ────────────────────────────────────
// Já coberto pela rota /eventos/:id/avancado existente — lgpd_texto salvo junto

// ===== CONTRATOS LIGANTES =====
router.get('/contratos', requireAuth, async (req, res) => {
  const config = await getConfig();
  const tgR = await query("SELECT valor FROM configuracoes WHERE chave='contrato_texto_global'");
  const textoGlobal = tgR.rows[0]?.valor || '';
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const [cR, lR] = await Promise.all([
    query(`SELECT c.*, l.nome as ligante_nome, l.email as ligante_email FROM contratos_ligantes c LEFT JOIN ligantes l ON l.id=c.ligante_id ORDER BY c.criado_em DESC`),
    query(`SELECT id, nome, email, turma, semestre, rg, catraca FROM ligantes ORDER BY nome`)
  ]);
  res.render('pages/contratos', { config, usuario: req.session.usuario, msg, erro, contratos: cR.rows, ligantes: lR.rows, textoGlobal });
});

router.post('/contratos', requireAuth, async (req, res) => {
  try {
    const { ligante_id, data_inicio } = req.body;
    const tgR = await query("SELECT valor FROM configuracoes WHERE chave='contrato_texto_global'");
    const texto_contrato = tgR.rows[0]?.valor || '';
    await query('INSERT INTO contratos_ligantes (ligante_id, texto_contrato, data_inicio, criado_por) VALUES ($1,$2,$3,$4)', [ligante_id, texto_contrato, data_inicio||null, req.session.usuario.id]);
    req.session.msg = ['Contrato gerado!'];
  } catch(e) { req.session.erro = [e.message]; }
  res.redirect('/contratos');
});

router.post('/contratos/:id/editar', requireAuth, async (req, res) => {
  try {
    await query('UPDATE contratos_ligantes SET texto_contrato=$1 WHERE id=$2', [req.body.texto_contrato, req.params.id]);
    req.session.msg = ['Contrato atualizado!'];
  } catch(e) { req.session.erro = [e.message]; }
  res.redirect('/contratos');
});

router.post('/contratos/:id/deletar', requireAuth, requireAdmin, async (req, res) => {
  await query('DELETE FROM contratos_ligantes WHERE id=$1', [req.params.id]);
  req.session.msg = ['Excluido!']; res.redirect('/contratos');
});

router.get('/contratos/:id/pdf', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT c.*, l.nome, l.rg, l.catraca, l.turma, l.semestre, l.email FROM contratos_ligantes c LEFT JOIN ligantes l ON l.id=c.ligante_id WHERE c.id=$1', [req.params.id]);
    const d = r.rows[0];
    if (!d) return res.status(404).send('Nao encontrado');
    const config = await getConfig();
    const { gerarHTMLContrato, imagemBase64 } = require('../services/desligamento');
    config.timbrado_b64 = await imagemBase64(config.timbrado_contrato_chave || config.timbrado_chave);
    config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
    config.assinatura_vicepresidente_b64 = await imagemBase64(config.assinatura_vicepresidente_chave);
    config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
    config.assinatura_orientador_b64 = await imagemBase64(config.assinatura_orientador_chave);
    let html = gerarHTMLContrato(d, config, d.texto_contrato || '', true);
    html = html.replace('window.onload=function(){window.print()}','');
    const timbB64 = config.timbrado_b64 || '';
    const headerTemplate = timbB64 ? '<div style="font-size:10px;width:210mm;height:57mm;margin:0;padding:0"><img src="'+timbB64+'" style="width:210mm;height:57mm;object-fit:cover;object-position:top"></div>' : '<div></div>';
    const footerTemplate = timbB64 ? '<div style="font-size:10px;width:210mm;height:38mm;margin:0;padding:0"><img src="'+timbB64+'" style="width:210mm;height:38mm;object-fit:cover;object-position:bottom"></div>' : '<div></div>';
    const puppeteer = require('puppeteer-core');
    const chromium = require('@sparticuz/chromium');
    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate, footerTemplate, margin: { top: '57mm', right: '20mm', bottom: '38mm', left: '20mm' } });
    await browser.close();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="contrato.pdf"');
    res.send(pdf);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.get('/contratos/:id/visualizar', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT c.*, l.nome, l.rg, l.catraca, l.turma, l.semestre, l.email FROM contratos_ligantes c LEFT JOIN ligantes l ON l.id=c.ligante_id WHERE c.id=$1', [req.params.id]);
    const d = r.rows[0];
    if (!d) return res.status(404).send('Nao encontrado');
    const config = await getConfig();
    const { gerarHTMLContrato, imagemBase64 } = require('../services/desligamento');
    config.timbrado_b64 = await imagemBase64(config.timbrado_contrato_chave || config.timbrado_chave);
    config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
    config.assinatura_vicepresidente_b64 = await imagemBase64(config.assinatura_vicepresidente_chave);
    config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
    config.assinatura_orientador_b64 = await imagemBase64(config.assinatura_orientador_chave);
    const html = gerarHTMLContrato(d, config, d.texto_contrato || '');
    res.send(html);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});
router.post('/contratos/timbrado', requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('timbrado_contrato')(req, res, async (err) => {
      if (!req.file) { req.session.erro=['Sem arquivo']; return res.redirect('/contratos'); }
      const resultado = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'timbrados');
      const chave = resultado.chave;
      await query("INSERT INTO configuracoes(chave,valor) VALUES('timbrado_contrato_chave',$1) ON CONFLICT(chave) DO UPDATE SET valor=$1", [chave]);
      req.session.msg=['Timbrado do contrato atualizado!']; res.redirect('/contratos');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/contratos'); }
});

router.post('/contratos/texto-global', requireAuth, async (req, res) => {
  try {
    const texto_contrato = req.body?.texto_contrato || '';
    await query('UPDATE contratos_ligantes SET texto_contrato=$1', [texto_contrato]);
    await query("INSERT INTO configuracoes(chave,valor) VALUES('contrato_texto_global',$1) ON CONFLICT(chave) DO UPDATE SET valor=$1", [texto_contrato]);
    req.session.msg=['Texto atualizado em todos os contratos!']; res.redirect('/contratos');
  } catch(e) { req.session.erro=[e.message]; res.redirect('/contratos'); }
});

router.get('/contratos/:id/imprimir', requireAuth, async (req, res) => { res.redirect('/contratos/'+req.params.id+'/visualizar'); });

router.post('/contratos/:id/enviar', requireAuth, async (req, res) => {
  req.setTimeout && req.setTimeout(120000);
  res.setTimeout && res.setTimeout(120000);
  try {
    const r = await query('SELECT c.*, l.nome, l.rg, l.catraca, l.turma, l.semestre, l.email FROM contratos_ligantes c LEFT JOIN ligantes l ON l.id=c.ligante_id WHERE c.id=$1', [req.params.id]);
    const d = r.rows[0];
    if (!d||!d.email) { req.session.erro=['Email nao cadastrado.']; return res.redirect('/contratos'); }

    const config = await getConfig();
    const { imagemBase64 } = require('../services/desligamento');
    config.timbrado_b64 = await imagemBase64(config.timbrado_contrato_chave || config.timbrado_chave);
    config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
    config.assinatura_vicepresidente_b64 = await imagemBase64(config.assinatura_vicepresidente_chave);
    config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
    config.assinatura_orientador_b64 = await imagemBase64(config.assinatura_orientador_chave);

    // Gerar PDF com pdfkit — multi-página
    const PDFDocument = require('pdfkit');
    const pdfBuffer = await new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const W = 595.28, H = 841.89;
        const ML = 56, MR = 56, MT = 162, textW = W - ML - MR;
        // Rodapé de 3.5cm = 99.2px — limite do texto
        const RODAPE = 99;
        const maxY = H - RODAPE;

        function desenharTimbrado() {
          if (config.timbrado_b64) {
            try {
              const imgBuf = Buffer.from(config.timbrado_b64.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
              doc.image(imgBuf, 0, 0, { width: W, height: H });
            } catch(e) {}
          }
        }

        function novaPagina() {
          doc.addPage({ size: 'A4', margin: 0 });
          desenharTimbrado();
          return 142; // 5cm do topo para não sobrepor cabeçalho
        }

        desenharTimbrado();
        let y = MT;

        // Título
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#000')
          .text('CONTRATO DE LIGA ACADEMICA Y MIEMBRO ACTIVO', ML, y, { width: textW, align: 'center' });
        y = doc.y + 2;
        doc.fontSize(11).font('Helvetica-Bold')
          .text('LIGA ACADEMICA DE UROLOGIA - LAURO', ML, y, { width: textW, align: 'center' });
        y = doc.y + 14;

        // Dados do ligante
        const dataIng = d.data_inicio ? new Date(d.data_inicio).toLocaleDateString('pt-BR') : '';
        doc.fontSize(10).font('Helvetica-Bold').text('MIEMBRO: ', ML, y, { continued: true });
        doc.font('Helvetica').text(d.nome || '');
        y = doc.y + 2;
        doc.font('Helvetica-Bold').text('R.G./C.I: ', ML, y, { continued: true });
        doc.font('Helvetica').text(d.rg || '');
        y = doc.y + 2;
        doc.font('Helvetica-Bold').text('Catraca: ', ML, y, { continued: true });
        doc.font('Helvetica').text(d.catraca || '');
        y = doc.y + 2;
        doc.font('Helvetica-Bold').text('Fecha de ingreso: ', ML, y, { continued: true });
        doc.font('Helvetica').text(dataIng);
        y = doc.y + 12;

        // Texto do contrato — limpar HTML do Quill
        const dataFmt = new Date().toLocaleDateString('pt-BR');
        let texto = (d.texto_contrato || '')
          .replace(/\{nome\}/g, d.nome||'').replace(/\{rg\}/g, d.rg||'')
          .replace(/\{catraca\}/g, d.catraca||'').replace(/\{turma\}/g, d.turma||'')
          .replace(/\{semestre\}/g, d.semestre||'').replace(/\{data\}/g, dataFmt)
          .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
          .replace(/<p[^>]*class="ql-align-center"[^>]*>/gi, '§CENTER§')
          .replace(/<p[^>]*class="ql-align-right"[^>]*>/gi, '§RIGHT§')
          .replace(/<p[^>]*>/gi, '')
          .replace(/<strong>([^<]+)<\/strong>/gi, '$1')
          .replace(/<em>([^<]+)<\/em>/gi, '$1')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/\n\s*\n\s*\n/g, '\n\n').trim();

        const linhas = texto.split('\n');
        for (const linha of linhas) {
          const isCenter = linha.startsWith('§CENTER§');
          const isRight = linha.startsWith('§RIGHT§');
          const txt = linha.replace(/§CENTER§|§RIGHT§/g, '').trim();
          if (!txt) { y += 5; continue; }
          const align = isCenter ? 'center' : isRight ? 'right' : 'justify';
          // Estimar altura antes de renderizar
          doc.fontSize(10).font('Helvetica');
          // Forçar nova página antes do CAPÍTULO V
          if (txt === 'CAPÍTULO V') { y = novaPagina(); }
          const alt = doc.heightOfString(txt, { width: textW, lineGap: 1 });
          if (y + alt > maxY) { y = novaPagina(); }
          doc.fillColor('#000').text(txt, ML, y, { width: textW, align, lineGap: 1 });
          y = doc.y + 4;
        }

        // Assinaturas — verificar espaço, senão nova página
        const altAssins = 130;
        if (y + altAssins > maxY) { y = novaPagina(); }
        y += 10;
        const assinaturas = [
          { nome: (d.nome||'').toUpperCase(), cargo: 'Miembro Activo', img: null },
          { nome: (config.presidente_nome||'PRESIDENTE').toUpperCase(), cargo: 'Presidente', img: config.assinatura_presidente_b64 },
          { nome: (config.vicepresidente_nome||'VICE-PRESIDENTE').toUpperCase(), cargo: 'Vice-Presidente', img: config.assinatura_vicepresidente_b64 },
          { nome: (config.secretario_nome||'SECRETÁRIO').toUpperCase(), cargo: 'Secretario', img: config.assinatura_secretario_b64 }
        ];

        const colW = textW / 2 - 10;
        const col1X = ML;
        const col2X = ML + colW + 20;

        for (let i = 0; i < assinaturas.length; i += 2) {
          if (y > H - 80) break;
          const a1 = assinaturas[i];
          const a2 = assinaturas[i+1];

          // Imagens
          if (a1 && a1.img) {
            try {
              const buf = Buffer.from(a1.img.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
              doc.image(buf, col1X + colW/2 - 55, y, { width: 110, height: 40, fit: [110, 40] });
            } catch(e) {}
          }
          if (a2 && a2.img) {
            try {
              const buf = Buffer.from(a2.img.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
              doc.image(buf, col2X + colW/2 - 55, y, { width: 110, height: 40, fit: [110, 40] });
            } catch(e) {}
          }
          y += 43;

          // Linhas
          doc.moveTo(col1X, y).lineTo(col1X + colW, y).lineWidth(1).stroke('#000');
          if (a2) doc.moveTo(col2X, y).lineTo(col2X + colW, y).lineWidth(1).stroke('#000');
          y += 3;

          // Nomes
          if (a1) {
            doc.fontSize(8).font('Helvetica-Bold').fillColor('#000').text(a1.nome, col1X, y, { width: colW, align: 'center' });
            doc.fontSize(7.5).font('Helvetica').text(a1.cargo, col1X, doc.y, { width: colW, align: 'center' });
          }
          if (a2) {
            doc.fontSize(8).font('Helvetica-Bold').fillColor('#000').text(a2.nome, col2X, y, { width: colW, align: 'center' });
            doc.fontSize(7.5).font('Helvetica').text(a2.cargo, col2X, doc.y, { width: colW, align: 'center' });
          }
          y = doc.y + 10;
        }

        doc.end();
      } catch(e) { reject(e); }
    });

    console.log('PDF contrato gerado:', pdfBuffer.length);
    await enviarEmail({
      from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>',
      to: d.email,
      subject: 'Contrato de Adesão — LAURO',
      html: emailBonito('Contrato de Adesão — LAURO',
        '<p>Prezado(a) <strong>' + d.nome + '</strong>,</p>' +
        '<p>Segue em anexo seu <strong>Contrato de Adesão</strong> à Liga Acadêmica de Urologia LAURO.</p>' +
        '<p>Por favor, assine o documento e devolva-o assinado à secretaria.</p>' +
        '<p style="margin-top:16px">Atenciosamente,<br><strong>Secretaria — LAURO</strong></p>'
      ),
      attachments: [{ filename: 'contrato-LAURO.pdf', content: pdfBuffer.toString('base64') }]
    });
    await query('UPDATE contratos_ligantes SET status=$1,enviado_em=NOW() WHERE id=$2',['enviado',req.params.id]);
    req.session.msg=['Contrato enviado para '+d.email+'!'];
  } catch(e) { console.log('ERRO enviar contrato:', e.message); req.session.erro=[e.message]; }
  res.redirect('/contratos');
});

router.post('/contratos/:id/assinado', requireAuth, async (req, res) => {
  try {
    upload.single('pdf_assinado')(req, res, async (err) => {
      if (err||!req.file) { req.session.erro=['Erro no upload.']; return res.redirect('/contratos'); }
      const { uploadArquivo } = require('../services/arquivos');
      const r = await uploadArquivo(req.file.buffer,'contrato-assinado-'+req.params.id+'.pdf',req.file.mimetype,'contratos');
      await query('UPDATE contratos_ligantes SET pdf_assinado_chave=$1,status=$2,assinado_em=NOW() WHERE id=$3',[r.chave,'assinado',req.params.id]);
      req.session.msg=['Contrato assinado anexado!'];
      res.redirect('/contratos');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/contratos'); }
});

router.get('/contratos/:id/assinado', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT pdf_assinado_chave FROM contratos_ligantes WHERE id=$1',[req.params.id]);
    const d = r.rows[0];
    if (!d||!d.pdf_assinado_chave) return res.status(404).send('Nao encontrado');
    const { getUrlAssinada } = require('../services/arquivos');
    const url = await getUrlAssinada(d.pdf_assinado_chave);
    res.redirect(url);
  } catch(e) { res.status(500).send(e.message); }
});

// ─── CONTRATOS DIRETIVOS ───────────────────────────────────────────────────────

router.get('/contratos-diretivos', requireAuth, async (req, res) => {
  const config = await getConfig();
  const tgR = await query("SELECT valor FROM configuracoes WHERE chave='contrato_dir_texto_global'");
  const textoGlobalDir = tgR.rows[0]?.valor || '';
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const [cR, dR] = await Promise.all([
    query(`SELECT c.*, d.nome as diretivo_nome, d.email as diretivo_email FROM contratos_diretivos c LEFT JOIN diretivos d ON d.id=c.diretivo_id ORDER BY c.criado_em DESC`),
    query(`SELECT id, nome, email, cargo FROM diretivos WHERE ativo=1 ORDER BY nome`)
  ]);
  res.render('pages/contratos-diretivos', { config, usuario: req.session.usuario, msg, erro, contratos: cR.rows, diretivos: dR.rows, textoGlobalDir });
});

router.post('/contratos-diretivos', requireAuth, async (req, res) => {
  try {
    const { diretivo_id, data_inicio } = req.body;
    const tgR = await query("SELECT valor FROM configuracoes WHERE chave='contrato_dir_texto_global'");
    const texto_contrato = tgR.rows[0]?.valor || '';
    await query('INSERT INTO contratos_diretivos (diretivo_id, texto_contrato, data_inicio, criado_por) VALUES ($1,$2,$3,$4)', [diretivo_id, texto_contrato, data_inicio||null, req.session.usuario.id]);
    req.session.msg = ['Contrato gerado!'];
  } catch(e) { req.session.erro = [e.message]; }
  res.redirect('/contratos-diretivos');
});

router.post('/contratos-diretivos/:id/editar', requireAuth, async (req, res) => {
  try {
    await query('UPDATE contratos_diretivos SET texto_contrato=$1 WHERE id=$2', [req.body.texto_contrato, req.params.id]);
    req.session.msg = ['Contrato atualizado!'];
  } catch(e) { req.session.erro = [e.message]; }
  res.redirect('/contratos-diretivos');
});

router.post('/contratos-diretivos/:id/deletar', requireAuth, requireAdmin, async (req, res) => {
  await query('DELETE FROM contratos_diretivos WHERE id=$1', [req.params.id]);
  req.session.msg = ['Excluido!']; res.redirect('/contratos-diretivos');
});

router.post('/contratos-diretivos/timbrado', requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('timbrado_contrato')(req, res, async (err) => {
      if (!req.file) { req.session.erro=['Sem arquivo']; return res.redirect('/contratos-diretivos'); }
      const resultado = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'timbrados');
      await query("INSERT INTO configuracoes(chave,valor) VALUES('timbrado_contrato_chave',$1) ON CONFLICT(chave) DO UPDATE SET valor=$1", [resultado.chave]);
      req.session.msg=['Timbrado atualizado!']; res.redirect('/contratos-diretivos');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/contratos-diretivos'); }
});

router.post('/contratos-diretivos/texto-global', requireAuth, async (req, res) => {
  try {
    const texto_contrato = req.body?.texto_contrato || '';
    await query('UPDATE contratos_diretivos SET texto_contrato=$1', [texto_contrato]);
    await query("INSERT INTO configuracoes(chave,valor) VALUES('contrato_dir_texto_global',$1) ON CONFLICT(chave) DO UPDATE SET valor=$1", [texto_contrato]);
    req.session.msg=['Texto atualizado!']; res.redirect('/contratos-diretivos');
  } catch(e) { req.session.erro=[e.message]; res.redirect('/contratos-diretivos'); }
});

router.get('/contratos-diretivos/:id/pdf', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT c.*, d.nome, d.rg, d.email, d.cargo FROM contratos_diretivos c LEFT JOIN diretivos d ON d.id=c.diretivo_id WHERE c.id=$1', [req.params.id]);
    const d = r.rows[0];
    if (!d) return res.status(404).send('Nao encontrado');
    const config = await getConfig();
    const { imagemBase64 } = require('../services/desligamento');
    config.timbrado_b64 = await imagemBase64(config.timbrado_contrato_chave || config.timbrado_chave);
    config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
    config.assinatura_vicepresidente_b64 = await imagemBase64(config.assinatura_vicepresidente_chave);
    config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
    // Gerar PDF pdfkit
    const pdfBuffer = await gerarPDFContratoDir(d, config);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="contrato-diretivo.pdf"');
    res.send(pdfBuffer);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.get('/contratos-diretivos/:id/imprimir', requireAuth, async (req, res) => {
  res.redirect('/contratos-diretivos/'+req.params.id+'/pdf');
});

router.post('/contratos-diretivos/:id/enviar', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT c.*, d.nome, d.rg, d.email, d.cargo FROM contratos_diretivos c LEFT JOIN diretivos d ON d.id=c.diretivo_id WHERE c.id=$1', [req.params.id]);
    const d = r.rows[0];
    if (!d||!d.email) { req.session.erro=['Email nao cadastrado.']; return res.redirect('/contratos-diretivos'); }
    const config = await getConfig();
    const { imagemBase64 } = require('../services/desligamento');
    config.timbrado_b64 = await imagemBase64(config.timbrado_contrato_chave || config.timbrado_chave);
    config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
    config.assinatura_vicepresidente_b64 = await imagemBase64(config.assinatura_vicepresidente_chave);
    config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
    const pdfBuffer = await gerarPDFContratoDir(d, config);
    await enviarEmail({
      from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>',
      to: d.email,
      subject: 'Contrato Diretivo — LAURO',
      html: emailBonito('Contrato Diretivo — LAURO',
        '<p>Prezado(a) <strong>' + d.nome + '</strong>,</p>' +
        '<p>Segue em anexo seu <strong>Contrato de Diretivo</strong> da Liga Acadêmica de Urologia LAURO.</p>' +
        '<p>Por favor, assine o documento e devolva-o assinado à secretaria.</p>' +
        '<p style="margin-top:16px">Atenciosamente,<br><strong>Secretaria — LAURO</strong></p>'
      ),
      attachments: [{ filename: 'contrato-diretivo-LAURO.pdf', content: pdfBuffer.toString('base64') }]
    });
    await query('UPDATE contratos_diretivos SET status=$1,enviado_em=NOW() WHERE id=$2',['enviado',req.params.id]);
    req.session.msg=['Contrato enviado para '+d.email+'!'];
  } catch(e) { req.session.erro=[e.message]; }
  res.redirect('/contratos-diretivos');
});

router.post('/contratos-diretivos/:id/assinado', requireAuth, async (req, res) => {
  try {
    upload.single('pdf_assinado')(req, res, async (err) => {
      if (err||!req.file) { req.session.erro=['Erro no upload.']; return res.redirect('/contratos-diretivos'); }
      const { uploadArquivo } = require('../services/arquivos');
      const r = await uploadArquivo(req.file.buffer,'contrato-dir-'+req.params.id+'.pdf',req.file.mimetype,'contratos');
      await query('UPDATE contratos_diretivos SET pdf_assinado_chave=$1,status=$2,assinado_em=NOW() WHERE id=$3',[r.chave,'assinado',req.params.id]);
      req.session.msg=['Contrato assinado anexado!']; res.redirect('/contratos-diretivos');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/contratos-diretivos'); }
});

router.get('/contratos-diretivos/:id/assinado', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT pdf_assinado_chave FROM contratos_diretivos WHERE id=$1',[req.params.id]);
    const d = r.rows[0];
    if (!d||!d.pdf_assinado_chave) return res.status(404).send('Nao encontrado');
    const { getUrlAssinada } = require('../services/arquivos');
    const url = await getUrlAssinada(d.pdf_assinado_chave);
    res.redirect(url);
  } catch(e) { res.status(500).send(e.message); }
});


// ════════════════════════════════════════════════════════════════
//  FLUXO DE CAIXA
// ════════════════════════════════════════════════════════════════

router.get('/fluxo-caixa', requireAuth, async (req, res) => {
  try {
    const mesesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const hoje = new Date();
    const mesAtual = req.query.mes || `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`;
    const [ano, mes] = mesAtual.split('-').map(Number);
    const mesNome = mesesNomes[mes-1] + ' ' + ano;

    const lancamentos = await query(
      `SELECT * FROM fluxo_caixa WHERE EXTRACT(YEAR FROM data_lancamento)=$1 AND EXTRACT(MONTH FROM data_lancamento)=$2 ORDER BY data_lancamento, id`,
      [ano, mes]
    );

    const entradas = lancamentos.rows.filter(l => l.tipo === 'E');
    const saidas   = lancamentos.rows.filter(l => l.tipo === 'S');
    const totalEntradas = entradas.reduce((s,l) => s + parseFloat(l.valor), 0);
    const totalSaidas   = saidas.reduce((s,l) => s + parseFloat(l.valor), 0);
    const saldo = totalEntradas - totalSaidas;

    res.render('pages/fluxo-caixa', {
      config: await getConfig(), usuario: req.session.usuario,
      lancamentos: lancamentos.rows, mesAtual, mesNome,
      totalEntradas, totalSaidas, saldo,
      qtdEntradas: entradas.length, qtdSaidas: saidas.length,
      msg: req.flash('msg'), erro: req.flash('erro')
    });
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/dashboard'); }
});

router.post('/fluxo-caixa/novo', requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('nf')(req, res, async (err) => {
      if (err) { req.flash('erro', [err.message]); return res.redirect('/fluxo-caixa'); }
      const { tipo, descricao, categoria, valor, data_lancamento, observacoes } = req.body;
      let nf_chave = null, nf_nome_original = null;
      if (req.file) {
        const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'fluxo-caixa');
        nf_chave = r.chave;
        nf_nome_original = req.file.originalname;
      }
      await query(
        `INSERT INTO fluxo_caixa (tipo,descricao,categoria,valor,data_lancamento,nf_chave,nf_nome_original,observacoes,criado_por,criado_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
        [tipo, descricao, categoria, parseFloat(valor), data_lancamento, nf_chave, nf_nome_original, observacoes||null, req.session.usuario.id]
      );
      const mes = data_lancamento.substring(0,7);
      req.flash('msg', [tipo==='E'?'Entrada registrada!':'Saída registrada!']);
      res.redirect('/fluxo-caixa?mes='+mes);
    });
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/fluxo-caixa'); }
});

router.post('/fluxo-caixa/:id/editar', requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('nf')(req, res, async (err) => {
      if (err) { req.flash('erro', [err.message]); return res.redirect('/fluxo-caixa'); }
      const { tipo, descricao, categoria, valor, data_lancamento, observacoes } = req.body;
      const atual = await query('SELECT nf_chave,nf_nome_original FROM fluxo_caixa WHERE id=$1',[req.params.id]);
      let nf_chave = atual.rows[0]?.nf_chave;
      let nf_nome_original = atual.rows[0]?.nf_nome_original;
      if (req.file) {
        const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'fluxo-caixa');
        nf_chave = r.chave;
        nf_nome_original = req.file.originalname;
      }
      await query(
        `UPDATE fluxo_caixa SET tipo=$1,descricao=$2,categoria=$3,valor=$4,data_lancamento=$5,nf_chave=$6,nf_nome_original=$7,observacoes=$8 WHERE id=$9`,
        [tipo, descricao, categoria, parseFloat(valor), data_lancamento, nf_chave, nf_nome_original, observacoes||null, req.params.id]
      );
      const mes = data_lancamento.substring(0,7);
      req.flash('msg', ['Lançamento atualizado!']);
      res.redirect('/fluxo-caixa?mes='+mes);
    });
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/fluxo-caixa'); }
});

router.post('/fluxo-caixa/:id/excluir', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT data_lancamento FROM fluxo_caixa WHERE id=$1',[req.params.id]);
    const mes = r.rows[0]?.data_lancamento?.toISOString?.()?.substring(0,7) || '';
    await query('DELETE FROM fluxo_caixa WHERE id=$1',[req.params.id]);
    req.flash('msg', ['Lançamento excluído.']);
    res.redirect('/fluxo-caixa'+(mes?'?mes='+mes:''));
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/fluxo-caixa'); }
});

router.get('/fluxo-caixa/:id/nf-url', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT nf_chave,nf_nome_original FROM fluxo_caixa WHERE id=$1',[req.params.id]);
    const d = r.rows[0];
    if (!d?.nf_chave) return res.json({url:null});
    const { getUrlAssinada } = require('../services/arquivos');
    const url = await getUrlAssinada(d.nf_chave);
    res.json({url, nome: d.nf_nome_original});
  } catch(e) { res.json({url:null,erro:e.message}); }
});





// ── CATEGORIAS DO CALENDÁRIO ──
router.get('/calendario/categorias', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM calendario_categorias ORDER BY criado_em');
    res.json(r.rows);
  } catch(e) { res.json([]); }
});

router.post('/calendario/categorias', requireAuth, async (req, res) => {
  try {
    const { nome, cor } = req.body;
    if(!nome) return res.json({ok:false, erro:'Nome obrigatório'});
    await query('INSERT INTO calendario_categorias (nome,cor,criado_por) VALUES ($1,$2,$3)', [nome, cor||'#2b6803', req.session.usuario.id]);
    res.json({ok:true});
  } catch(e) { res.json({ok:false, erro:e.message}); }
});

router.delete('/calendario/categorias/:id', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM calendario_categorias WHERE id=$1', [req.params.id]);
    res.json({ok:true});
  } catch(e) { res.json({ok:false, erro:e.message}); }
});



// Helper para buscar atividades
async function getAniversarios(anoRef) {
  const r = await query(`
    SELECT nome, data_nascimento::date as data_nascimento, 'membro' as tipo FROM membros
      WHERE ativo=1 AND data_nascimento IS NOT NULL
    UNION ALL
    SELECT nome, data_nascimento::date as data_nascimento, 'diretivo' as tipo FROM diretivos
      WHERE ativo=1 AND data_nascimento IS NOT NULL
  `);

  const aniversarios = [];
  const anos = [anoRef - 1, anoRef, anoRef + 1];

  r.rows.forEach(m => {
    const nasc = new Date(m.data_nascimento);
    const dia = nasc.getUTCDate();
    const mes = nasc.getUTCMonth(); // 0-11

    anos.forEach(ano => {
      const dataAniv = new Date(Date.UTC(ano, mes, dia));
      aniversarios.push({
        id: `aniv-${m.tipo}-${m.nome}-${ano}`,
        titulo: `🎂 Aniversário — ${m.nome}`,
        descricao: `${m.tipo === 'membro' ? 'Ligante' : 'Diretivo'} ${m.nome} faz aniversário hoje!`,
        categoria: 'Aniversario',
        cor: '#f97316',
        data_inicio: dataAniv.toISOString(),
        data_fim: null,
        dia_inteiro: true,
        local: null,
        link_externo: null,
        publico: false, // não aparece na agenda pública
        criado_em: new Date().toISOString()
      });
    });
  });

  return aniversarios;
}

async function getAtividades(apenasPublicas = false, incluirAniversarios = false) {
  const where = apenasPublicas ? 'WHERE publico = TRUE' : '';
  const r = await query(`SELECT * FROM calendario_atividades ${where} ORDER BY data_inicio`);
  let atividades = r.rows;

  if (incluirAniversarios) {
    const anivs = await getAniversarios(new Date().getFullYear());
    atividades = [...atividades, ...anivs];
  }

  return atividades;
}


// PAINEL INTERNO
router.get('/calendario', requireAuth, async (req, res) => {
  try {
    const atividades = await getAtividades(false, true);
    const icalUrl = (process.env.RAILWAY_PUBLIC_DOMAIN
      ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN
      : 'https://liga-urologia-production.up.railway.app') + '/calendario.ics';
    res.render('pages/calendario', {
      config: await getConfig(),
      usuario: req.session.usuario,
      paginaAtual: 'calendario',
      atividades: JSON.stringify(atividades),
      icalUrl,
      msg: req.flash('msg'),
      erro: req.flash('erro')
    });
  } catch(e) {
    console.error('ERRO CALENDARIO:', e.message);
    res.send('ERRO: ' + e.message);
  }
});

// PÁGINA PÚBLICA (sem login)
router.get('/agenda', async (req, res) => {
  try {
    const atividades = await getAtividades(true);
    res.render('pages/agenda-publica', {
      config: await getConfig(),
      atividades: atividades
    });
  } catch(e) { res.status(500).send('Erro ao carregar agenda.'); }
});

// FEED iCAL — compatível com iPhone/Android/Google Calendar
router.get('/calendario.ics', async (req, res) => {
  try {
    const atividades = await getAtividades(true);
    const config = await getConfig();

    const formatDate = (d, diaInteiro) => {
      const dt = new Date(d);
      if (diaInteiro) {
        return dt.toISOString().replace(/-/g,'').slice(0,8);
      }
      return dt.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    };

    const escIcal = s => (s||'').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');

    let ical = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:-//Liga Urologia//Calendario//PT`,
      `X-WR-CALNAME:${escIcal(config.org_nome)} - Agenda`,
      'X-WR-TIMEZONE:America/Sao_Paulo',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];

    atividades.forEach(ev => {
      const uid = `${ev.id}-liga-urologia@railway.app`;
      const dtstart = ev.dia_inteiro
        ? `DTSTART;VALUE=DATE:${formatDate(ev.data_inicio, true)}`
        : `DTSTART:${formatDate(ev.data_inicio, false)}`;
      const dtend = ev.data_fim
        ? (ev.dia_inteiro
          ? `DTEND;VALUE=DATE:${formatDate(ev.data_fim, true)}`
          : `DTEND:${formatDate(ev.data_fim, false)}`)
        : (ev.dia_inteiro
          ? `DTEND;VALUE=DATE:${formatDate(ev.data_inicio, true)}`
          : `DTEND:${formatDate(new Date(new Date(ev.data_inicio).getTime() + 60*60*1000), false)}`);

      const criado = new Date(ev.criado_em).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');

      ical.push('BEGIN:VEVENT');
      ical.push(`UID:${uid}`);
      ical.push(`DTSTAMP:${criado}`);
      ical.push(dtstart);
      ical.push(dtend);
      ical.push(`SUMMARY:${escIcal(ev.titulo)}`);
      if (ev.descricao) ical.push(`DESCRIPTION:${escIcal(ev.descricao)}`);
      if (ev.local)     ical.push(`LOCATION:${escIcal(ev.local)}`);
      if (ev.link_externo) ical.push(`URL:${ev.link_externo}`);
      ical.push(`CATEGORIES:${escIcal(ev.categoria)}`);
      ical.push('END:VEVENT');
    });

    ical.push('END:VCALENDAR');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="liga-urologia.ics"');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(ical.join('\r\n'));
  } catch(e) { res.status(500).send('Erro ao gerar calendário.'); }
});

// CRIAR ATIVIDADE
router.post('/calendario/novo', requireAuth, async (req, res) => {
  try {
    const { titulo, descricao, categoria, cor, data_inicio, data_fim, local, link_externo } = req.body;
    const dia_inteiro = req.body.dia_inteiro === 'true';
    const publico = req.body.publico === 'true';
    await query(
      `INSERT INTO calendario_atividades (titulo,descricao,categoria,cor,data_inicio,data_fim,dia_inteiro,local,link_externo,publico,criado_por,criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
      [titulo, descricao||null, categoria, cor||'#2b6803',
       data_inicio, data_fim||null, dia_inteiro, local||null,
       link_externo||null, publico, req.session.usuario.id]
    );
    req.flash('msg', ['Atividade criada com sucesso!']);
    res.redirect('/calendario');
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/calendario'); }
});

// EDITAR ATIVIDADE
router.post('/calendario/:id/editar', requireAuth, async (req, res) => {
  try {
    const { titulo, descricao, categoria, cor, data_inicio, data_fim, local, link_externo } = req.body;
    const dia_inteiro = req.body.dia_inteiro === 'true';
    const publico = req.body.publico === 'true';
    await query(
      `UPDATE calendario_atividades SET titulo=$1,descricao=$2,categoria=$3,cor=$4,data_inicio=$5,data_fim=$6,dia_inteiro=$7,local=$8,link_externo=$9,publico=$10 WHERE id=$11`,
      [titulo, descricao||null, categoria, cor||'#2b6803',
       data_inicio, data_fim||null, dia_inteiro, local||null,
       link_externo||null, publico, req.params.id]
    );
    req.flash('msg', ['Atividade atualizada!']);
    res.redirect('/calendario');
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/calendario'); }
});

// EXCLUIR ATIVIDADE
router.post('/calendario/:id/excluir', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM calendario_atividades WHERE id=$1', [req.params.id]);
    req.flash('msg', ['Atividade excluída.']);
    res.redirect('/calendario');
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/calendario'); }
});


module.exports = router;
