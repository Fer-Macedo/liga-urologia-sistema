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
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4f0;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f0;padding:32px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.10)">
  <!-- HEADER -->
  <tr><td style="background:linear-gradient(160deg,#0a1a08 0%,#1a3410 50%,#253d18 100%);padding:28px 40px;text-align:center">
    <img src="${logoUrl}" style="height:72px;width:72px;border-radius:50%;border:3px solid rgba(255,255,255,0.35);object-fit:cover;display:block;margin:0 auto 12px">
    <div style="color:#ffffff;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;opacity:0.75">Liga Académica de Urología</div>
    <div style="color:#ffffff;font-size:10px;opacity:0.55;margin-top:3px">Universidad Central del Paraguay — Ciudad del Este</div>
  </td></tr>
  <!-- TITULO -->
  <tr><td style="background:#1a3410;padding:16px 40px;text-align:center">
    <h2 style="color:#ffffff;font-size:16px;font-weight:700;margin:0;letter-spacing:0.3px">${titulo}</h2>
  </td></tr>
  <!-- LINHA ACENTO -->
  <tr><td style="height:4px;background:linear-gradient(90deg,#1a3410,#4a8a20,#1a3410)"></td></tr>
  <!-- CORPO -->
  <tr><td style="padding:36px 40px">
    <div style="color:#1f2937;font-size:14px;line-height:1.8">${corpo}</div>
  </td></tr>
  <!-- FOOTER -->
  <tr><td style="background:#1a3410;padding:20px 40px;text-align:center">
    <p style="margin:0 0 4px;color:#fff;font-size:12px;font-weight:700">LAURO — Liga Académica de Urología</p>
    <p style="margin:0 0 4px;color:rgba(255,255,255,0.65);font-size:11px">Universidad Central del Paraguay · Ciudad del Este, PY</p>
    <p style="margin:0;color:rgba(255,255,255,0.65);font-size:11px">lauroucpcde@lauroucpcde.com</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
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

      // PARÁGRAFOS — renderização com inline bold para <strong>
      function renderParaComBold(doc, paraHtml, x, startY, width) {
        const inner = paraHtml.replace(/<p[^>]*>/i,'').replace(/<\/p>/i,'');
        // Dividir em segmentos: texto normal e <strong>...</strong>
        const segs = [];
        let rest = inner;
        const re = /<strong[^>]*>([\s\S]*?)<\/strong>/gi;
        let lastIdx = 0, m;
        re.lastIndex = 0;
        while ((m = re.exec(inner)) !== null) {
          if (m.index > lastIdx) segs.push({ bold: false, text: strip(inner.slice(lastIdx, m.index)) });
          segs.push({ bold: true, text: strip(m[1]) });
          lastIdx = m.index + m[0].length;
        }
        if (lastIdx < inner.length) segs.push({ bold: false, text: strip(inner.slice(lastIdx)) });
        if (segs.length === 0 || (segs.length === 1 && !segs[0].bold)) {
          const txt = strip(inner);
          if (txt) doc.fontSize(11).font('Helvetica').fillColor('#000').text(txt, x, startY, { width, align: 'justify', lineGap: 1 });
          return;
        }
        // Renderizar segmentos inline
        let first = true;
        for (let i = 0; i < segs.length; i++) {
          const seg = segs[i];
          if (!seg.text) continue;
          const isLast = i === segs.length - 1;
          const opts = { width, align: 'justify', lineGap: 1, continued: !isLast };
          if (first) { opts.x = x; opts.y = startY; first = false; }
          doc.fontSize(11).font(seg.bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#000').text(seg.text, opts);
        }
      }

      for (const p of pTags) {
        if (y > H - 260) break;
        const textoLimpo = strip(p.replace(/<p[^>]*>/i,'').replace(/<\/p>/i,''));
        if (!textoLimpo) continue;
        renderParaComBold(doc, p, ML, y, textW);
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
// Página pública de assinatura — token único
router.get('/assinar-ata/:token', async (req, res) => {
  try {
    const pR = await query(`
      SELECT ap.*, ar.numero, ar.tipo, ar.data_reuniao, ar.hora_inicio, ar.local
      FROM atas_presentes ap
      JOIN atas_reuniao ar ON ar.id=ap.ata_id
      WHERE ap.token_assinatura=$1
    `, [req.params.token]);
    const cfg = await query("SELECT chave,valor FROM configuracoes WHERE chave IN ('org_logo','org_nome')");
    const cfgMap = {}; cfg.rows.forEach(r => cfgMap[r.chave]=r.valor);
    const orgLogo = cfgMap.org_logo || null;
    const orgNome = cfgMap.org_nome || 'LAURO';
    if (!pR.rows.length) return res.status(404).send('<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LAURO — Assinatura de Ata</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:#f1f5f9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:white;max-width:420px;width:100%;border-radius:8px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)}.header{background:linear-gradient(160deg,#1a3d2b 0%,#0a1f1a 100%);padding:28px 32px;text-align:center;color:white}.header p{font-size:12px;opacity:.7;margin:0}.body{padding:48px 32px;text-align:center}.footer{padding:16px 32px;background:#f8fafc;text-align:center;font-size:11px;color:#94a3b8}</style></head><body><div class="card"><div class="header"><img src="\'+orgLogo+\'" style="width:64px;height:64px;border-radius:50%;border:3px solid rgba(255,255,255,.3);display:block;margin:0 auto 12px"><p>\'+orgNome+\'</p></div><div class="body"><svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg><h2 style="color:#dc2626;margin:16px 0 8px;font-size:20px">Link invalido ou expirado</h2><p style="color:#475569;font-size:14px;line-height:1.6">Este link nao e mais valido. Solicite um novo link ao administrador da Liga.</p></div><div class="footer">Liga Academica de Urologia — LAURO | UCP | Ciudad del Este</div></div></body></html>'.replace("'+orgLogo+'", orgLogo||'').replace("'+orgNome+'", orgNome));
    const p = pR.rows[0];
    if (p.token_usado) return res.send('<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LAURO — Assinatura de Ata</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:#f1f5f9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:white;max-width:420px;width:100%;border-radius:8px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)}.header{background:linear-gradient(160deg,#1a3d2b 0%,#0a1f1a 100%);padding:28px 32px;text-align:center;color:white}.header p{font-size:12px;opacity:.7;margin:0}.body{padding:48px 32px;text-align:center}.footer{padding:16px 32px;background:#f8fafc;text-align:center;font-size:11px;color:#94a3b8}</style></head><body><div class="card"><div class="header"><img src="\'+orgLogo+\'" style="width:64px;height:64px;border-radius:50%;border:3px solid rgba(255,255,255,.3);display:block;margin:0 auto 12px"><p>\'+orgNome+\'</p></div><div class="body"><svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#1a3d2b" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg><h2 style="color:#1a3d2b;margin:16px 0 8px;font-size:20px">Ata ja assinada!</h2><p style="color:#475569;font-size:14px;line-height:1.6">Voce ja assinou esta ata anteriormente. Nao e possivel assinar novamente.</p></div><div class="footer">Liga Academica de Urologia — LAURO | UCP | Ciudad del Este</div></div></body></html>'.replace("'+orgLogo+'", orgLogo||'').replace("'+orgNome+'", orgNome));
    if (p.token_expira_em && new Date(p.token_expira_em) < new Date()) return res.send('<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LAURO — Assinatura de Ata</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:#f1f5f9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:white;max-width:420px;width:100%;border-radius:8px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)}.header{background:linear-gradient(160deg,#1a3d2b 0%,#0a1f1a 100%);padding:28px 32px;text-align:center;color:white}.header p{font-size:12px;opacity:.7;margin:0}.body{padding:48px 32px;text-align:center}.footer{padding:16px 32px;background:#f8fafc;text-align:center;font-size:11px;color:#94a3b8}</style></head><body><div class="card"><div class="header"><img src="\'+orgLogo+\'" style="width:64px;height:64px;border-radius:50%;border:3px solid rgba(255,255,255,.3);display:block;margin:0 auto 12px"><p>\'+orgNome+\'</p></div><div class="body"><svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><h2 style="color:#dc2626;margin:16px 0 8px;font-size:20px">Link expirado</h2><p style="color:#475569;font-size:14px;line-height:1.6">O prazo para assinatura deste link expirou. Solicite um novo link ao administrador.</p></div><div class="footer">Liga Academica de Urologia — LAURO | UCP | Ciudad del Este</div></div></body></html>'.replace("'+orgLogo+'", orgLogo||'').replace("'+orgNome+'", orgNome));
    const numAta = p.numero || p.ata_id;
    const tipoAta = p.tipo === 'ordinaria' ? 'Ordinaria' : p.tipo === 'extraordinaria' ? 'Extraordinaria' : 'Especial';
    const dataFormatada = p.data_reuniao ? new Date(p.data_reuniao).toLocaleDateString('pt-BR',{timeZone:'UTC',day:'2-digit',month:'2-digit',year:'numeric'}) : '';
    res.render('pages/assinar-ata-publica', {
      token: req.params.token,
      numAta,
      tipoAta,
      dataFormatada,
      membroNome: p.membro_nome,
      membroCargo: p.membro_cargo || '',
      orgLogo,
      orgNome
    });
  } catch(e) { console.error('assinar-ata GET:', e.message); res.status(500).send('Erro interno.'); }
});

// Marca token como visualizado — invalida ao abrir a página
router.post('/assinar-ata-aberto/:token', async (req, res) => {
  try {
    await query("UPDATE atas_presentes SET token_usado=true WHERE token_assinatura=$1 AND token_usado=false AND assinatura_digital IS NULL", [req.params.token]);
    res.json({ok:true});
  } catch(e) { res.json({ok:false}); }
});

router.post('/assinar-ata/:token', async (req, res) => {
  try {
    const pR = await query('SELECT * FROM atas_presentes WHERE token_assinatura=$1', [req.params.token]);
    if (!pR.rows.length) return res.json({ok:false, erro:'Link invalido.'});
    const p = pR.rows[0];
    if (p.token_usado) return res.json({ok:false, erro:'Este link ja foi utilizado.'});
    if (p.token_expira_em && new Date(p.token_expira_em) < new Date()) return res.json({ok:false, erro:'Link expirado.'});
    const { assinatura_digital } = req.body;
    if (!assinatura_digital) return res.json({ok:false, erro:'Assinatura nao encontrada.'});
    await query('UPDATE atas_presentes SET assinatura_digital=$1, assinou_em=NOW(), token_usado=true WHERE id=$2', [assinatura_digital, p.id]);
    res.json({ok:true});
  } catch(e) { console.error('assinar-ata POST:', e.message); res.json({ok:false, erro:'Erro interno.'}); }
});

router.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-hashes'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://api.z-api.io", "https://api.pagseguro.com", "https://graph.instagram.com"],
      frameSrc: ["'self'", "https://view.officeapps.live.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    }
  },
  crossOriginEmbedderPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// Rate limit geral
const limiterGeral = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  message: { erro: 'Muitas requisições. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: function(req){
    var p = req.path || '';
    // Pular rate limit para rotas publicas e para usuarios autenticados
    if (p.indexOf('/checkout') === 0 || p.indexOf('/inscricao') === 0 || p.indexOf('/webhook') === 0) return true;
    if (req.session && req.session.usuario) return true; // admin autenticado — sem limite
    return false;
  }
});

// Rate limit específico para APIs públicas (mais permissivo para o site)
const limiterApiPublica = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { erro: 'Muitas requisições. Aguarde 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limit para contato (anti-spam)
const limiterContato = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { erro: 'Limite de mensagens atingido. Tente em 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
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
const { requireAuth, requireAdmin, requireFinanceiro, requireSecretaria, requirePermissao, requirePresidencia } = require('../middleware/auth');
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

  req.session.regenerate(async (err) => {
    if (err) console.error('Session regenerate erro:', err);
    req.session.usuario = dadosUsuario;
    try {
      const pR = await query('SELECT modulo FROM usuario_permissoes WHERE usuario_id=$1', [usuario.id]);
      req.session.permissoesAtivas = pR.rows.map(r => r.modulo);
    } catch(e) { req.session.permissoesAtivas = []; }
    res.redirect('/dashboard');
  });
});

router.get('/api/pendentes', requireAuth, async (req, res) => {
  try {
    const [rD,rL] = await Promise.all([
      query('SELECT COUNT(*) n FROM diretivos WHERE pendente=true'),
      query('SELECT COUNT(*) n FROM ligantes WHERE pendente=true')
    ]);
    const nD=parseInt(rD.rows[0].n), nL=parseInt(rL.rows[0].n);
    const count=nD+nL, itens=[];
    if(nD>0) itens.push({tipo:'diretivo',label:nD+' diretivo'+(nD>1?'s':'')+' aguardando aprovacao',url:'/diretivos?status=pendente'});
    if(nL>0) itens.push({tipo:'ligante',label:nL+' ligante'+(nL>1?'s':'')+' aguardando aprovacao',url:'/ligantes?status=pendente'});
    res.json({count,itens});
  } catch(e){ res.json({count:0,itens:[]}); }
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

// ═══════════════════════════════════════════════════════
// APIs PÚBLICAS — Site Externo LAURO
// ═══════════════════════════════════════════════════════

function corsPublico(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Cache-Control', 'public, max-age=300');
  next();
}

router.get('/api/eventos-publicos', corsPublico, limiterApiPublica, async (req, res) => {
  try {
    const { gerarUrlInline } = require('../services/arquivos');
    const r = await query(`SELECT id, nome, descricao, data_inicio, data_fim, local, endereco, banner_chave, vagas_total, tipo_evento, carga_horaria, youtube_url, inscricao_gratuita_auto, checkout_fecha_em FROM eventos WHERE status='publicado' AND publico=true AND (checkout_fecha_em IS NULL OR checkout_fecha_em > NOW()) ORDER BY data_inicio ASC LIMIT 20`);
    const eventos = await Promise.all(r.rows.map(async ev => {
      let banner_url = null;
      if (ev.banner_chave) { try { banner_url = await gerarUrlInline(ev.banner_chave); } catch(e) {} }
      return { id: ev.id, nome: ev.nome, descricao: ev.descricao, data_inicio: ev.data_inicio, data_fim: ev.data_fim, local: ev.local, endereco: ev.endereco, banner_chave: banner_url, vagas_total: ev.vagas_total, tipo_evento: ev.tipo_evento, carga_horaria: ev.carga_horaria, youtube_url: ev.youtube_url, gratuito: ev.inscricao_gratuita_auto, inscricao_url: `https://sistema.lauroucpcde.com/inscricao/${ev.id}` };
    }));
    res.json(eventos);
  } catch(e) { console.error('[API-PUBLIC] eventos:', e.message); res.json([]); }
});

router.get('/api/equipe-publica', corsPublico, limiterApiPublica, async (req, res) => {
  try {
    const { gerarUrlInline } = require('../services/arquivos');
    const [dirsR, ligsR] = await Promise.all([
      query('SELECT id, nome, cargo, foto_chave FROM diretivos WHERE ativo=1 AND pendente=false ORDER BY cargo, nome'),
      query('SELECT id, nome, semestre, foto_chave FROM ligantes WHERE ativo=1 AND pendente=false ORDER BY nome LIMIT 50')
    ]);
    const mapFoto = async (rows) => Promise.all(rows.map(async m => {
      let foto_url = null;
      if (m.foto_chave) { try { foto_url = await gerarUrlInline(m.foto_chave); } catch(e) {} }
      return { ...m, foto_url };
    }));
    const [diretivos, ligantes] = await Promise.all([mapFoto(dirsR.rows), mapFoto(ligsR.rows)]);
    res.json({ diretivos, ligantes });
  } catch(e) { console.error('[API-PUBLIC] equipe:', e.message); res.json({ diretivos: [], ligantes: [] }); }
});

router.get('/api/stats-publicas', corsPublico, limiterApiPublica, async (req, res) => {
  try {
    const [ligsR, evsR] = await Promise.all([
      query("SELECT COUNT(*) as total FROM ligantes WHERE ativo=1 AND pendente=false"),
      query("SELECT COUNT(*) as total FROM eventos WHERE status='publicado'")
    ]);
    res.json({ ligantes: parseInt(ligsR.rows[0].total)||0, eventos: parseInt(evsR.rows[0].total)||0 });
  } catch(e) { res.json({ ligantes: 48, eventos: 14 }); }
});

router.post('/api/contato-site', corsPublico, limiterContato, async (req, res) => {
  try {
    const { nombre, email, telefono, mensaje } = req.body;
    if (!nombre || !email || !mensaje) return res.json({ ok: false, erro: 'Campos obrigatórios faltando' });
    // Validações de segurança
    if (nombre.length > 100 || email.length > 150 || (mensaje||'').length > 2000) return res.json({ ok: false, erro: 'Dados inválidos' });
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return res.json({ ok: false, erro: 'Email inválido' });
    // Sanitização básica anti-injection
    const safe = s => (s||'').replace(/<[^>]*>/g,'').replace(/[<>'";&]/g,'').trim();
    const nomeClean = safe(nombre).substring(0,100);
    const msgClean = safe(mensaje).substring(0,2000);
    const telClean = safe(telefono||'').substring(0,20);
    const { enviarEmail } = require('../services/notificacoes');
    await enviarEmail({ para: 'lauroucpcde@lauroucpcde.com', assunto: `Contato pelo site — ${nombre}`, texto: `Nome: ${nombre}\nEmail: ${email}\nTelefone: ${telefono||'—'}\n\n${mensaje}`, html: `<h3>Contato pelo Site LAURO</h3><p><b>Nome:</b> ${nombre}</p><p><b>Email:</b> ${email}</p><p><b>Tel:</b> ${telefono||'—'}</p><hr><p>${mensaje}</p>` });
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false }); }
});

router.get('/dashboard', requireAuth, async (req, res) => {
  const config = await getConfig();
  const hoje = dayjs();
  const mes = hoje.format('YYYY-MM');
  const mesStr = '%-' + mes;
  const [total, pagos, pendentes, atrasados, recTot, pendTot, atrTot, recentes, aniversariantes] = await Promise.all([
    query("SELECT COUNT(*) n FROM membros WHERE ativo=1"),
    query("SELECT COUNT(*) n FROM cobrancas WHERE status='pago' AND referencia LIKE $1", [mesStr]),
    query("SELECT COUNT(*) n FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='pendente' AND c.referencia LIKE $1 AND m.ativo=1", [mesStr]),
    query("SELECT COUNT(*) n FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='atrasado' AND c.referencia LIKE $1 AND m.ativo=1", [mesStr]),
    query("SELECT COALESCE(SUM(valor_desconto),0) v FROM cobrancas WHERE status='pago' AND referencia LIKE $1", [mesStr]),
    query("SELECT COALESCE(SUM(valor_cheio),0) v FROM cobrancas WHERE status='pendente' AND referencia LIKE $1", [mesStr]),
    query("SELECT COALESCE(SUM(valor_cheio),0) v FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='atrasado' AND c.referencia LIKE $1 AND m.ativo=1", [mesStr]),
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
    query('SELECT m.*, CASE WHEN m.ativo=0 THEN \'cancelado\' WHEN EXISTS(SELECT 1 FROM cobrancas WHERE membro_id=m.id AND status=\'atrasado\') THEN \'atrasado\' WHEN EXISTS(SELECT 1 FROM cobrancas WHERE membro_id=m.id AND status IN (\'pago\',\'em_dia\') AND referencia LIKE \'%-\'||TO_CHAR(NOW(),\'YYYY-MM\')) THEN \'pago\' ELSE \'pendente\' END as ultimo_status FROM membros m ' + where + ' ORDER BY m.nome'),
    query(`SELECT
      COUNT(*) as total,
      SUM(CASE WHEN m.ativo=1 THEN 1 ELSE 0 END) as ativos,
      SUM(CASE WHEN m.ativo=0 THEN 1 ELSE 0 END) as inativos,
      SUM(CASE WHEN m.ativo=1 AND EXISTS(SELECT 1 FROM cobrancas WHERE membro_id=m.id AND status IN ('pago','em_dia') AND referencia LIKE '%-'||TO_CHAR(NOW(),'YYYY-MM')) THEN 1 ELSE 0 END) as em_dia,
      SUM(CASE WHEN m.ativo=1 AND EXISTS(SELECT 1 FROM cobrancas WHERE membro_id=m.id AND status='atrasado' AND membro_id IN (SELECT id FROM membros WHERE ativo=1)) THEN 1 ELSE 0 END) as atrasados
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
    [nome, cpf||null, email||null, whatsapp||null, data_nascimento||null, parseInt(dia_vencimento)||15, parseFloat(mensalidade)||25, parseFloat(desconto_pontualidade)||20, observacoes||null]
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
    [nome, cpf||null, email||null, whatsapp||null, data_nascimento||null, parseInt(dia_vencimento)||15, parseFloat(mensalidade)||25, parseFloat(desconto_pontualidade)||20, novoAtivo, observacoes||null, req.params.id]
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
  const periodo = req.query.periodo || 'mes';
  const dataInicio = req.query.data_inicio || null;
  const dataFim = req.query.data_fim || null;
  const hoje = dayjs();

  let dtInicio, dtFim;
  if (dataInicio && dataFim) {
    dtInicio = dataInicio; dtFim = dataFim;
  } else if (periodo === '30') {
    dtInicio = hoje.subtract(30,'day').format('YYYY-MM-DD'); dtFim = hoje.format('YYYY-MM-DD');
  } else if (periodo === '60') {
    dtInicio = hoje.subtract(60,'day').format('YYYY-MM-DD'); dtFim = hoje.format('YYYY-MM-DD');
  } else if (periodo === '90') {
    dtInicio = hoje.subtract(90,'day').format('YYYY-MM-DD'); dtFim = hoje.format('YYYY-MM-DD');
  } else if (periodo === '120') {
    dtInicio = hoje.subtract(120,'day').format('YYYY-MM-DD'); dtFim = hoje.format('YYYY-MM-DD');
  } else if (periodo === 'todos') {
    dtInicio = null; dtFim = null;
  } else {
    dtInicio = hoje.startOf('month').format('YYYY-MM-DD');
    dtFim = hoje.endOf('month').format('YYYY-MM-DD');
  }

  const periodoWhere = dtInicio && dtFim
    ? ` AND c.data_vencimento::date BETWEEN '${dtInicio}' AND '${dtFim}'`
    : '';

  const [tPagas, tPendentes, tAtrasadas, tTodas] = await Promise.all([
    query(`SELECT COUNT(*) n, COALESCE(SUM(c.valor_desconto),0) soma FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='pago' AND m.ativo=1${periodoWhere}`),
    query(`SELECT COUNT(*) n FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='pendente' AND m.ativo=1${periodoWhere}`),
    query(`SELECT COUNT(*) n FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='atrasado' AND m.ativo=1${periodoWhere}`),
    query(`SELECT COUNT(*) n FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE m.ativo=1${periodoWhere}`),
  ]);

  const membroId = req.query.membro ? parseInt(req.query.membro) : null;
  let whereClause = `m.ativo=1${periodoWhere}`;
  if (membroId) whereClause = `c.membro_id=${membroId}${periodoWhere}`;
  if (filtro === 'pagas') whereClause += " AND c.status='pago'";
  else if (filtro === 'pendentes') whereClause += " AND c.status='pendente'";
  else if (filtro === 'atrasadas') whereClause += " AND c.status='atrasado'";

  const [r, membroR] = await Promise.all([
    query(`SELECT c.*, m.nome, m.whatsapp, m.email FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE ${whereClause} ORDER BY c.data_vencimento DESC, m.nome ASC LIMIT 500`),
    membroId ? query('SELECT nome FROM membros WHERE id=$1', [membroId]) : Promise.resolve({ rows: [] })
  ]);
  const membroFiltro = membroR.rows[0] || null;
  res.render('pages/cobrancas', {
    config, usuario: req.session.usuario, cobrancas: r.rows, filtro, dayjs,
    msg: req.flash('msg'), erro: req.flash('erro'),
    totalPagas: parseInt(tPagas.rows[0].n), somaPagas: parseFloat(tPagas.rows[0].soma),
    totalPendentes: parseInt(tPendentes.rows[0].n),
    totalAtrasadas: parseInt(tAtrasadas.rows[0].n),
    totalTodas: parseInt(tTodas.rows[0].n),
    membroId: membroId || null, membroFiltro,
    periodo, dtInicio: dtInicio||'', dtFim: dtFim||'',
    dataInicio: dataInicio||'', dataFim: dataFim||'',
  });
});

router.post('/cobrancas/:id/confirmar', requireAuth, requireFinanceiro, async (req, res) => {
  try {
    await query("UPDATE cobrancas SET status='pago', data_pagamento=NOW(), metodo_pagamento=COALESCE(metodo_pagamento,'pix') WHERE id=$1 AND status!='pago'", [req.params.id]);
    try { const { lancarMensalidadeNoFluxo } = require('../services/fluxo-mensalidade'); await lancarMensalidadeNoFluxo(query, req.params.id); } catch(e) { console.error('lancar fluxo (baixa manual):', e.message); }
    req.session.msg = ['Pagamento confirmado manualmente!'];
  } catch(e) { req.session.erro = ['Erro ao confirmar: '+e.message]; }
  const ref = req.headers.referer || '/cobrancas';
  res.redirect(ref);
});

router.post('/cobrancas/:id/pago', requireAuth, requireFinanceiro, async (req, res) => {
  await query("UPDATE cobrancas SET status='pago', data_pagamento=NOW(), metodo_pagamento=COALESCE(metodo_pagamento,'pix') WHERE id=$1", [req.params.id]);
  try { const { lancarMensalidadeNoFluxo } = require('../services/fluxo-mensalidade'); await lancarMensalidadeNoFluxo(query, req.params.id); } catch(e) { console.error('lancar fluxo (baixa manual 2):', e.message); }
  req.flash('msg', 'Pagamento registrado!');
  res.redirect('/cobrancas');
});

router.post('/cobrancas/:id/notificar', requireAuth, requireFinanceiro, async (req, res) => {
  const config = await getConfig();
  const r = await query('SELECT c.*, m.* FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.id=$1', [req.params.id]);
  const cob = r.rows[0];
  if (!cob) return res.redirect('/cobrancas');
  const vencDate = dayjs(cob.data_vencimento).startOf('day');
  const hojeDate = dayjs().startOf('day');
  const diffDias = vencDate.diff(hojeDate, 'day');
  const tipo = diffDias < 0 ? 'pos' : diffDias === 0 ? 'dia' : 'pre';
  await notificarCobranca({ membro: cob, cobranca: cob, tipo, config, canal: req.body.canal });
  req.flash('msg', req.body.canal === 'whatsapp' ? 'Cobrança enviada por WhatsApp!' : (req.body.canal === 'email' ? 'Cobrança enviada por e-mail!' : 'Notificação enviada!'));
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
    "SELECT * FROM (SELECT id, nome, whatsapp, data_nascimento::text, TO_CHAR(data_nascimento::date,'MM-DD') as md, TO_CHAR(data_nascimento::date,'MM-DD') as aniv, 'ligante' as tipo, foto_chave FROM ligantes WHERE ativo=1 AND data_nascimento IS NOT NULL UNION ALL SELECT id, nome, whatsapp, data_nascimento::text, TO_CHAR(data_nascimento::date,'MM-DD') as md, TO_CHAR(data_nascimento::date,'MM-DD') as aniv, 'diretivo' as tipo, foto_chave FROM diretivos WHERE ativo=1 AND data_nascimento IS NOT NULL) t ORDER BY md"
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
  const {upload:upCfg, uploadArquivo:upArqCfg} = require('../services/arquivos');
  // O multer processa o multipart/form-data. SÓ DEPOIS dele o req.body fica preenchido.
  upCfg.fields([{name:'assinatura_presidente'},{name:'assinatura_vicepresidente'},{name:'assinatura_secretario'},{name:'assinatura_financeiro'},{name:'assinatura_director_ensino'},{name:'assinatura_director_extension'},{name:'timbrado'}])(req, res, async(err)=>{
    try {
      if (err) { req.flash('erro','Error al subir archivo: '+err.message); return res.redirect('/configuracoes'); }
      const camposCheckbox = ['notif_pre_ativo','notif_dia_ativo','notif_pos1_ativo','notif_aniversario_ativo'];
      const ignorar = ['_csrf'];
      // Salva DINAMICAMENTE qualquer campo de texto (escalável p/ outras ligas)
      for (const chave of Object.keys(req.body || {})) {
        if (ignorar.includes(chave)) continue;
        let val = req.body[chave];
        if (Array.isArray(val)) val = val[val.length - 1];
        if (camposCheckbox.includes(chave)) { val = (val === 'on' || val === '1') ? '1' : '0'; }
        await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', [chave, val]);
      }
      // Checkboxes desmarcados (não enviados) viram '0'
      for (const c of camposCheckbox) {
        if (req.body[c] === undefined) {
          await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', [c, '0']);
        }
      }
      // Uploads de arquivos
      for(const campo of ['assinatura_presidente','assinatura_vicepresidente','assinatura_secretario','assinatura_financeiro','assinatura_director_ensino','assinatura_director_extension','timbrado']){
        if(req.files && req.files[campo] && req.files[campo][0]){
          const ff=req.files[campo][0];
          const r=await upArqCfg(ff.buffer,ff.originalname,ff.mimetype,campo);
          await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2',[campo+'_chave',r.chave]);
        }
      }
      req.flash('msg', 'Configurações salvas!');
      res.redirect('/configuracoes');
    } catch(e) { console.error('salvar config:', e); req.flash('erro', e.message); res.redirect('/configuracoes'); }
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


// ─── ATENDIMENTOS WHATSAPP ────────────────────────────────────────────────────
router.get('/atendimentos', requireAuth, async (req, res) => {
  try {
    const config = await getConfig();
    const msg = req.session.msg||[]; req.session.msg=[];
    const erro = req.session.erro||[]; req.session.erro=[];
    const _perfil = req.session.usuario && req.session.usuario.perfil;
    const _isAdmin = _perfil === 'admin' || _perfil === 'presidencia';
    // Admin e presidência veem tudo; demais áreas veem só os atendimentos da sua área
    const _filtroArea = _isAdmin ? '' : ' WHERE area=$1';
    const _params = _isAdmin ? [] : [_perfil];
    const [statsR, atendR, contatosR] = await Promise.all([
      query("SELECT COUNT(*) FILTER (WHERE status='aguardando') AS aguardando, COUNT(*) FILTER (WHERE status='transferido') AS transferidos_hoje, COUNT(*) FILTER (WHERE status='encerrado') AS encerrados_hoje, COUNT(*) AS total FROM lauro_atendimentos" + _filtroArea, _params),
      query("SELECT a.*, COALESCE((SELECT nome FROM membros WHERE regexp_replace(whatsapp,'[^0-9]','','g')=a.numero_membro LIMIT 1),(SELECT nome FROM ligantes WHERE regexp_replace(whatsapp,'[^0-9]','','g')=a.numero_membro LIMIT 1),(SELECT nome FROM membros WHERE RIGHT(regexp_replace(whatsapp,'[^0-9]','','g'),8)=RIGHT(a.numero_membro,8) LIMIT 1),(SELECT nome FROM ligantes WHERE RIGHT(regexp_replace(whatsapp,'[^0-9]','','g'),8)=RIGHT(a.numero_membro,8) LIMIT 1),a.nome_contato) as nome_membro FROM lauro_atendimentos a" + (_filtroArea ? _filtroArea.replace('area', 'a.area') : '') + " ORDER BY CASE WHEN a.status='aguardando' THEN 0 WHEN a.status='transferido' THEN 1 ELSE 2 END, a.criado_em DESC LIMIT 200", _params),
      query('SELECT area, numero FROM lauro_contatos ORDER BY area')
    ]);
    res.render('pages/atendimentos', { config, msg, erro, usuario: req.session.usuario, stats: statsR.rows[0]||{}, atendimentos: atendR.rows, contatos: contatosR.rows }, function(err, html){
      console.log('RENDER CALLBACK: err=', err&&err.message, 'html_len=', html&&html.length);
      if(err){ console.error('RENDER ATEND ERRO:', err.message); return res.status(500).send('Erro render: '+err.message); }
      res.send(html);
    });
  } catch(e) { console.error('CATCH ATEND:', e.message); res.status(500).send(e.message); }
});

router.get('/atendimentos/:id/conversa', requireAuth, async (req, res) => {
  try {
    const atR = await query('SELECT numero_membro, area, idioma, criado_em, encerrado_em, nome_contato FROM lauro_atendimentos WHERE id=$1', [req.params.id]);
    if (!atR.rows.length) return res.json({msgs:[], area:'', numero:'', idioma:'pt'});
    const {numero_membro, area, idioma, criado_em, encerrado_em} = atR.rows[0];
    // Controle de acesso: só admin/presidência ou usuário da mesma área podem ver o chat
    const _perfil = req.session.usuario && req.session.usuario.perfil;
    const _isAdmin = _perfil === 'admin' || _perfil === 'presidencia';
    if (!_isAdmin && area !== _perfil) {
      return res.status(403).json({msgs:[], erro:'Sem permissão para ver este atendimento'});
    }
    const [msgsR, membroR] = await Promise.all([
      query('SELECT papel, mensagem, criado_em FROM lauro_conversas WHERE numero=$1 ORDER BY criado_em ASC LIMIT 300', [numero_membro]),
      query("SELECT nome FROM membros WHERE regexp_replace(whatsapp,'\\D','','g') = $1 LIMIT 1", [numero_membro])
    ]);
    let nomeMembro = membroR.rows.length > 0 ? membroR.rows[0].nome : null;
    if (!nomeMembro) {
      const _ligR = await query("SELECT nome FROM ligantes WHERE regexp_replace(whatsapp,'[^0-9]','','g') = $1 LIMIT 1", [numero_membro]);
      if (_ligR.rows.length) nomeMembro = _ligR.rows[0].nome;
    }
    // Fallback: formato BR 8->9 digitos (554688191844 -> 5546988191844)
    if (!nomeMembro && numero_membro.length === 12 && numero_membro.startsWith('55')) {
      const _num9 = numero_membro.slice(0,4) + '9' + numero_membro.slice(4);
      const _mR9 = await query("SELECT nome FROM membros WHERE regexp_replace(whatsapp,'[^0-9]','','g') = $1 LIMIT 1", [_num9]);
      if (_mR9.rows.length) nomeMembro = _mR9.rows[0].nome;
      else {
        const _lR9 = await query("SELECT nome FROM ligantes WHERE regexp_replace(whatsapp,'[^0-9]','','g') = $1 LIMIT 1", [_num9]);
        if (_lR9.rows.length) nomeMembro = _lR9.rows[0].nome;
      }
    }
    if (!nomeMembro && atR.rows[0].nome_contato) nomeMembro = atR.rows[0].nome_contato;
    res.json({ msgs: msgsR.rows, area, numero: '****'+numero_membro.slice(-4), idioma, nomeMembro, atendId: parseInt(req.params.id) });
  } catch(e) { res.json({msgs:[], erro: e.message}); }
});

router.post('/atendimentos/:id/responder', requireAuth, async (req, res) => {
  try {
    const { mensagem } = req.body;
    if (!mensagem || !mensagem.trim()) return res.json({ok:false, erro:'Mensagem vazia'});
    const atR = await query("SELECT numero_membro, area, idioma, numero_area FROM lauro_atendimentos WHERE id=$1 AND status='aguardando'", [req.params.id]);
    if (!atR.rows.length) return res.json({ok:false, erro:'Atendimento nao encontrado ou encerrado'});
    const { numero_membro, area, numero_area } = atR.rows[0];
    const _perfilR = req.session.usuario && req.session.usuario.perfil;
    if (_perfilR !== 'admin' && _perfilR !== 'presidencia' && area !== _perfilR) return res.json({ok:false, erro:'Sem permissão para este atendimento'});
    const lauro = require('../services/lauro');
    await lauro.enviarMensagemDireta(numero_membro, mensagem.trim());
    if (numero_area) await lauro.enviarMensagemDireta(numero_area, mensagem.trim()).catch(()=>{});
    await query('INSERT INTO lauro_conversas (numero,papel,mensagem) VALUES ($1,$2,$3)', [numero_membro, 'area', mensagem.trim()]).catch(()=>{});
    const config = await getConfig();
    const nomeArea = area.charAt(0).toUpperCase() + area.slice(1);
    res.json({ok:true, enviado: mensagem.trim(), area: nomeArea});
  } catch(e) { res.json({ok:false, erro: e.message}); }
});
router.post('/atendimentos/:id/responder-arquivo', requireAuth, (req, res) => {
  const { upload } = require('../services/arquivos');
  upload.single('arquivo')(req, res, async function(errUp){
    try {
      if (errUp) return res.json({ok:false, erro: errUp.message});
      if (!req.file) return res.json({ok:false, erro:'Nenhum arquivo recebido'});
      const atR = await query("SELECT numero_membro, area, numero_area FROM lauro_atendimentos WHERE id=$1 AND status='aguardando'", [req.params.id]);
      if (!atR.rows.length) return res.json({ok:false, erro:'Atendimento nao encontrado ou encerrado'});
      const { numero_membro, area, numero_area } = atR.rows[0];
      const _perfil = req.session.usuario && req.session.usuario.perfil;
      if (_perfil !== 'admin' && _perfil !== 'presidencia' && area !== _perfil) return res.json({ok:false, erro:'Sem permissao para este atendimento'});
      const { uploadArquivo } = require('../services/arquivos');
      const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'atendimentos');
      const lauro = require('../services/lauro');
      const dataUri = 'data:' + req.file.mimetype + ';base64,' + req.file.buffer.toString('base64');
      let tipo;
      if (req.file.mimetype.indexOf('image/') === 0) { tipo = 'image'; await lauro.enviarImagem(numero_membro, dataUri, ''); }
      else { tipo = 'document'; await lauro.enviarDocumento(numero_membro, dataUri, req.file.originalname); }
      if (numero_area) {
        if (tipo === 'image') await lauro.enviarImagem(numero_area, dataUri, '').catch(()=>{});
        else await lauro.enviarDocumento(numero_area, dataUri, req.file.originalname).catch(()=>{});
      }
      await query('INSERT INTO lauro_conversas (numero, papel, mensagem) VALUES ($1,$2,$3)', [numero_membro, 'area', '[[MIDIA]]'+tipo+'|||'+r.chave+'|||'+req.file.originalname]);
      res.json({ok:true, tipo, chave: r.chave, nome: req.file.originalname});
    } catch(e) { res.json({ok:false, erro: e.message}); }
  });
});

router.get('/atendimentos/midia', requireAuth, async (req, res) => {
  try {
    const chave = req.query.chave;
    if (!chave) return res.status(400).send('chave ausente');
    const { gerarUrlInline } = require('../services/arquivos');
    const url = await gerarUrlInline(chave);
    res.redirect(url);
  } catch(e) { res.status(500).send('erro'); }
});

router.post('/atendimentos/contatos', requireAuth, async (req, res) => {
  try {
    const { area, numero } = req.body;
    const n = (numero||'').replace(/\D/g,'');
    await query('INSERT INTO lauro_contatos (area,numero) VALUES ($1,$2) ON CONFLICT (area) DO UPDATE SET numero=$2, updated_at=NOW()', [area, n]);
    const lauro = require('../services/lauro');
    if (lauro.recarregarContatos) await lauro.recarregarContatos();
    req.session.msg = ['Contato da area ' + area + ' atualizado!'];
  } catch(e) { req.session.erro = [e.message]; }
  res.redirect('/atendimentos');
});
router.post('/atendimentos/:id/encerrar', requireAuth, async (req, res) => {
  try {
    const atR = await query('SELECT numero_membro, area, idioma FROM lauro_atendimentos WHERE id=$1', [req.params.id]);
    if (atR.rows.length > 0) {
      const { numero_membro, area, idioma } = atR.rows[0];
      const _perfilE = req.session.usuario && req.session.usuario.perfil;
      if (_perfilE !== 'admin' && _perfilE !== 'presidencia' && area !== _perfilE) { req.session.erro=['Sem permissão para este atendimento']; return res.redirect('/atendimentos'); }
      await query("UPDATE lauro_atendimentos SET status='encerrado', encerrado_em=NOW() WHERE id=$1", [req.params.id]);
      const lauro = require('../services/lauro');
      const _areaCap = area ? (area.charAt(0).toUpperCase() + area.slice(1)) : 'Secretaria';
      const m = idioma==='es'
        ? 'Tu atención fue finalizada por ' + _areaCap + '. ¡Cualquier duda o información, puedes volver a contactarnos aquí que atenderemos tu solicitud!'
        : 'Seu atendimento foi encerrado pela ' + _areaCap + '. Qualquer dúvida ou informação, você pode voltar a nos contatar aqui que atenderemos a sua solicitação!';
      await lauro.enviarMensagemDireta(numero_membro, m).catch(()=>{});
    }
    req.session.msg = ['Atendimento encerrado!'];
  } catch(e) { req.session.erro=[e.message]; }
  res.redirect('/atendimentos');
});
router.post('/atendimentos/:id/transferir', requireAuth, async (req, res) => {
  try {
    const { area_destino } = req.body;
    const atR = await query("SELECT numero_membro, area, idioma FROM lauro_atendimentos WHERE id=$1 AND status='aguardando'", [req.params.id]);
    if (atR.rows.length > 0) {
      const { numero_membro, area, idioma } = atR.rows[0];
      const _perfilT = req.session.usuario && req.session.usuario.perfil;
      if (_perfilT !== 'admin' && _perfilT !== 'presidencia' && area !== _perfilT) { req.session.erro=['Sem permissão para este atendimento']; return res.redirect('/atendimentos'); }
      await query("UPDATE lauro_atendimentos SET status='transferido', encerrado_em=NOW() WHERE id=$1", [req.params.id]);
      const lauro = require('../services/lauro');
      await lauro.redirecionarArea(numero_membro, area_destino, idioma||'pt');
    }
    req.session.msg = ['Transferido para ' + area_destino + '!'];
  } catch(e) { req.session.erro=[e.message]; }
  res.redirect('/atendimentos');
});
// ─────────────────────────────────────────────────────────────────────────────

// ─── PROCESSO SELETIVO ────────────────────────────────────────────────────────
async function getPsData(req) {
  const [pR,qR,cR,prR] = await Promise.all([
    query('SELECT * FROM ps_processos ORDER BY criado_em DESC'),
    query("SELECT * FROM ps_questoes WHERE ativo=TRUE ORDER BY tema,id"),
    query(`SELECT c.*, r.percentual, r.aprovado_prova, r.total_acertos, r.total_questoes,
            e.percentual_entrevista, e.resultado as resultado_entrevista
           FROM ps_candidatos c
           LEFT JOIN ps_respostas r ON r.candidato_id=c.id
           LEFT JOIN ps_entrevistas e ON e.candidato_id=c.id
           ORDER BY c.processo_id, c.numero_lista`),
    query(`SELECT pv.*, p.nome as processo_nome FROM ps_provas pv 
           JOIN ps_processos p ON p.id=pv.processo_id ORDER BY pv.criado_em DESC`)
  ]);
  const temas=[...new Set(qR.rows.map(q=>q.tema))].sort();
  return {processos:pR.rows, questoes:qR.rows, temas, candidatos:cR.rows, provas:prR.rows};
}
router.get('/processo-seletivo', requireAuth, async (req, res) => {
  try {
    const config=await getConfig();
    const msg=req.session.msg||[]; req.session.msg=[];
    const erro=req.session.erro||[]; req.session.erro=[];
    const data=await getPsData(req);
    res.render('pages/processo-seletivo', {config, msg, erro, usuario:req.session.usuario, ...data});
  } catch(e) { req.session.erro=[e.message]; res.redirect('/dashboard'); }
});
router.post('/processo-seletivo/criar', requireAuth, async (req, res) => {
  try {
    const {nome,semestre,data_prova,local_prova,vagas,nota_minima}=req.body;
    await query('INSERT INTO ps_processos (nome,semestre,data_prova,local_prova,vagas,nota_minima) VALUES ($1,$2,$3,$4,$5,$6)',
      [nome,semestre||null,data_prova||null,local_prova||null,parseInt(vagas)||10,parseFloat(nota_minima)||60]);
    req.session.msg=['Processo seletivo criado!'];
  } catch(e) { req.session.erro=[e.message]; }
  res.redirect('/processo-seletivo');
});
router.post('/processo-seletivo/:id/deletar', requireAuth, async (req, res) => {
  try { await query('DELETE FROM ps_processos WHERE id=$1',[req.params.id]); req.session.msg=['Processo excluído!']; }
  catch(e) { req.session.erro=[e.message]; }
  res.redirect('/processo-seletivo');
});
router.post('/processo-seletivo/questao/criar', requireAuth, async (req, res) => {
  try {
    const {_id,tema,enunciado,opcao_a,opcao_b,opcao_c,opcao_d,resposta_correta,dificuldade}=req.body;
    if(_id) {
      await query('UPDATE ps_questoes SET tema=$1,enunciado=$2,opcao_a=$3,opcao_b=$4,opcao_c=$5,opcao_d=$6,resposta_correta=$7,dificuldade=$8 WHERE id=$9',
        [tema,enunciado,opcao_a,opcao_b,opcao_c,opcao_d,resposta_correta,dificuldade,_id]);
    } else {
      await query('INSERT INTO ps_questoes (tema,enunciado,opcao_a,opcao_b,opcao_c,opcao_d,resposta_correta,dificuldade) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [tema,enunciado,opcao_a,opcao_b,opcao_c,opcao_d,resposta_correta,dificuldade]);
    }
    req.session.msg=['Questão salva!'];
  } catch(e) { req.session.erro=[e.message]; }
  res.redirect('/processo-seletivo');
});
router.post('/processo-seletivo/questao/:id/editar', requireAuth, async (req, res) => {
  try {
    const {tema,enunciado,opcao_a,opcao_b,opcao_c,opcao_d,resposta_correta,dificuldade}=req.body;
    await query('UPDATE ps_questoes SET tema=$1,enunciado=$2,opcao_a=$3,opcao_b=$4,opcao_c=$5,opcao_d=$6,resposta_correta=$7,dificuldade=$8 WHERE id=$9',
      [tema,enunciado,opcao_a,opcao_b,opcao_c,opcao_d,resposta_correta,dificuldade,req.params.id]);
    req.session.msg=['Questão atualizada!'];
  } catch(e) { req.session.erro=[e.message]; }
  res.redirect('/processo-seletivo');
});
router.post('/processo-seletivo/questao/:id/deletar', requireAuth, async (req, res) => {
  try { await query('UPDATE ps_questoes SET ativo=FALSE WHERE id=$1',[req.params.id]); req.session.msg=['Questão removida!']; }
  catch(e) { req.session.erro=[e.message]; }
  res.redirect('/processo-seletivo');
});
router.post('/processo-seletivo/candidato/criar', requireAuth, async (req, res) => {
  try {
    const {processo_id,nome,rg,email,telefone,curso,semestre_atual,numero_lista,fila_prova}=req.body;
    await query('INSERT INTO ps_candidatos (processo_id,nome,rg,email,telefone,curso,semestre_atual,numero_lista,fila_prova) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [processo_id,nome,rg||null,email||null,telefone||null,curso||null,semestre_atual||null,numero_lista||null,fila_prova||'A']);
    req.session.msg=['Candidato inscrito!'];
  } catch(e) { req.session.erro=[e.message]; }
  res.redirect('/processo-seletivo');
});
router.post('/processo-seletivo/candidato/:id/deletar', requireAuth, async (req, res) => {
  try { await query('DELETE FROM ps_candidatos WHERE id=$1',[req.params.id]); req.session.msg=['Candidato removido!']; }
  catch(e) { req.session.erro=[e.message]; }
  res.redirect('/processo-seletivo');
});
router.post('/processo-seletivo/candidato/:id/correcao', requireAuth, async (req, res) => {
  try {
    const {respostas_json,total_questoes,total_acertos,percentual,prova_id}=req.body;
    const notaMin=(await query('SELECT nota_minima FROM ps_processos p JOIN ps_candidatos c ON c.processo_id=p.id WHERE c.id=$1',[req.params.id])).rows[0]?.nota_minima||60;
    const aprov=parseFloat(percentual)>=parseFloat(notaMin);
    let cartaoChave=null;
    if(req.file){
      const {uploadArquivo}=require('../services/arquivos');
      const r=await uploadArquivo(req.file.buffer,'cartao-'+req.params.id+'.'+req.file.mimetype.split('/')[1],req.file.mimetype,'processo-seletivo');
      cartaoChave=r.chave;
    }
    const candR=await query('SELECT processo_id FROM ps_candidatos WHERE id=$1',[req.params.id]);
    await query('DELETE FROM ps_respostas WHERE candidato_id=$1',[req.params.id]);
    await query('INSERT INTO ps_respostas (candidato_id,processo_id,prova_id,respostas_json,total_questoes,total_acertos,percentual,aprovado_prova,cartao_chave,corrigido_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())',
      [req.params.id,candR.rows[0]?.processo_id,prova_id||null,respostas_json,total_questoes,total_acertos,percentual,aprov,cartaoChave]);
    await query("UPDATE ps_candidatos SET status=$1 WHERE id=$2",[aprov?'classificado':'reprovado',req.params.id]);
    res.json({ok:true,percentual,aprovado:aprov});
  } catch(e) { res.json({ok:false,erro:e.message}); }
});
router.post('/processo-seletivo/candidato/:id/entrevista', requireAuth, async (req, res) => {
  try {
    const {respostas_json,pontuacao_total,pontuacao_maxima,percentual_entrevista,entrevistadores,observacoes}=req.body;
    const aprovEntrev=parseFloat(percentual_entrevista)>=60;
    const candR=await query('SELECT processo_id FROM ps_candidatos WHERE id=$1',[req.params.id]);
    await query('DELETE FROM ps_entrevistas WHERE candidato_id=$1',[req.params.id]);
    await query('INSERT INTO ps_entrevistas (candidato_id,processo_id,entrevistadores,respostas_json,pontuacao_total,pontuacao_maxima,percentual_entrevista,observacoes,resultado,realizada_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())',
      [req.params.id,candR.rows[0]?.processo_id,entrevistadores||null,JSON.stringify(respostas_json),pontuacao_total,pontuacao_maxima,percentual_entrevista,observacoes||null,aprovEntrev?'aprovado':'reprovado']);
    await query("UPDATE ps_candidatos SET status='entrevista' WHERE id=$1 AND status='classificado'",[req.params.id]);
    res.json({ok:true,percentual_entrevista,resultado:aprovEntrev?'aprovado':'reprovado'});
  } catch(e) { res.json({ok:false,erro:e.message}); }
});
router.get('/processo-seletivo/:id/gabarito/:fila', requireAuth, async (req, res) => {
  try {
    const r=await query("SELECT id,gabarito_json FROM ps_provas WHERE processo_id=$1 AND fila=$2",[req.params.id,req.params.fila]);
    if(!r.rows.length) return res.json({gabarito:{},prova_id:null});
    const gab=r.rows[0].gabarito_json||{};
    res.json({gabarito:gab,prova_id:r.rows[0].id});
  } catch(e) { res.json({gabarito:{},erro:e.message}); }
});
router.get('/processo-seletivo/:id/resultados', requireAuth, async (req, res) => {
  try {
    const r=await query(`SELECT c.*, r.percentual, r.aprovado_prova, r.total_acertos, r.total_questoes,
      e.percentual_entrevista, e.resultado as resultado_entrevista
      FROM ps_candidatos c
      LEFT JOIN ps_respostas r ON r.candidato_id=c.id
      LEFT JOIN ps_entrevistas e ON e.candidato_id=c.id
      WHERE c.processo_id=$1 ORDER BY r.percentual DESC NULLS LAST`,[req.params.id]);
    res.json({candidatos:r.rows});
  } catch(e) { res.json({candidatos:[],erro:e.message}); }
});
router.get('/processo-seletivo/:id/perguntas-entrevista', requireAuth, async (req, res) => {
  try {
    const r=await query('SELECT * FROM ps_entrevista_perguntas WHERE (processo_id=$1 OR processo_id IS NULL) AND ativo=TRUE ORDER BY ordem',[req.params.id]);
    res.json({perguntas:r.rows});
  } catch(e) { res.json({perguntas:[]}); }
});
router.get('/processo-seletivo/perguntas-entrevista', requireAuth, async (req, res) => {
  try {
    const r=await query('SELECT * FROM ps_entrevista_perguntas WHERE processo_id IS NULL AND ativo=TRUE ORDER BY ordem');
    res.json({perguntas:r.rows});
  } catch(e) { res.json({perguntas:[]}); }
});
router.post('/processo-seletivo/perguntas-entrevista/salvar', requireAuth, async (req, res) => {
  try {
    const {perguntas}=req.body;
    await query('UPDATE ps_entrevista_perguntas SET ativo=FALSE WHERE processo_id IS NULL');
    for(let i=0;i<perguntas.length;i++){
      const p=perguntas[i];
      if(p.id){await query('UPDATE ps_entrevista_perguntas SET pergunta=$1,descricao=$2,peso=$3,ordem=$4,ativo=TRUE WHERE id=$5',[p.pergunta,p.descricao||null,p.peso||1,i,p.id]);}
      else{await query('INSERT INTO ps_entrevista_perguntas (pergunta,descricao,peso,ordem) VALUES ($1,$2,$3,$4)',[p.pergunta,p.descricao||null,p.peso||1,i]);}
    }
    res.json({ok:true});
  } catch(e) { res.json({ok:false,erro:e.message}); }
});
router.get('/processo-seletivo/:id/prova/gerar', requireAuth, async (req, res) => {
  try {
    const config=await getConfig();
    const [pR,qR,prvR]=await Promise.all([
      query('SELECT * FROM ps_processos WHERE id=$1',[req.params.id]),
      query("SELECT * FROM ps_questoes WHERE ativo=TRUE ORDER BY tema,id"),
      query('SELECT * FROM ps_provas WHERE processo_id=$1',[req.params.id])
    ]);
    const temas=[...new Set(qR.rows.map(q=>q.tema))].sort();
    res.render('pages/montar-prova',{config,usuario:req.session.usuario,msg:req.session.msg||[],erro:req.session.erro||[],processo:pR.rows[0],questoes:qR.rows,temas,provas:prvR.rows});
    req.session.msg=[];req.session.erro=[];
  } catch(e) { req.session.erro=[e.message]; res.redirect('/processo-seletivo'); }
});
router.post('/processo-seletivo/:id/prova/salvar', requireAuth, async (req, res) => {
  try {
    const {fila,questoes_ids}=req.body;
    const ids=Array.isArray(questoes_ids)?questoes_ids:[questoes_ids];
    const qR=await query(`SELECT * FROM ps_questoes WHERE id=ANY($1::int[])`,[ ids.map(Number)]);
    const qMap={};qR.rows.forEach(q=>{qMap[q.id]=q;});
    const gabarito={};
    ids.forEach((id,i)=>{const q=qMap[id];if(q)gabarito[i+1]=q.resposta_correta;});
    await query('INSERT INTO ps_provas (processo_id,fila,questoes_json,gabarito_json) VALUES ($1,$2,$3,$4) ON CONFLICT (processo_id,fila) DO UPDATE SET questoes_json=$3,gabarito_json=$4',
      [req.params.id,fila,JSON.stringify(ids.map(Number)),JSON.stringify(gabarito)]);
    req.session.msg=['Prova Fila '+fila+' salva com '+ids.length+' questões!'];
  } catch(e) { req.session.erro=[e.message]; }
  res.redirect('/processo-seletivo/'+req.params.id+'/prova/gerar');
});
router.get('/processo-seletivo/prova/:id/pdf', requireAuth, async (req, res) => {
  try {
    const pvR=await query(`SELECT pv.*,p.nome as proc_nome,p.data_prova FROM ps_provas pv JOIN ps_processos p ON p.id=pv.processo_id WHERE pv.id=$1`,[req.params.id]);
    if(!pvR.rows.length) return res.status(404).send('Prova não encontrada');
    const pv=pvR.rows[0];
    const ids=pv.questoes_json||[];
    const qR=await query(`SELECT * FROM ps_questoes WHERE id=ANY($1::int[])`,[ ids]);
    const qMap={};qR.rows.forEach(q=>{qMap[q.id]=q;});
    // Agrupar por tema
    const temas={};
    ids.forEach((id,i)=>{
      const q=qMap[id];if(!q)return;
      if(!temas[q.tema])temas[q.tema]=[];
      temas[q.tema].push({num:i+1,...q});
    });
    let conteudo='';
    Object.entries(temas).forEach(([tema,qs])=>{
      conteudo+='<div class="tema-titulo">'+tema+':</div>';
      qs.forEach(q=>{
        conteudo+='<div class="questao"><p><span class="questao-num">'+q.num+')</span> '+q.enunciado+'</p>';
        conteudo+='<div class="opcoes">';
        ['A','B','C','D'].forEach(l=>{conteudo+='<div class="opcao">'+l+') '+q['opcao_'+l.toLowerCase()]+'</div>';});
        conteudo+='</div></div>';
      });
    });
    const data=pv.data_prova?new Date(pv.data_prova).toLocaleDateString('pt-BR'):'___/___/______';
    const html=require('fs').readFileSync(__dirname.replace('routes','').replace('src/','')+'views/pdf/prova-template.html','utf8')
      .replace(/\{\{TITULO\}\}/g,pv.proc_nome||'Proceso Seletivo')
      .replace(/\{\{FILA\}\}/g,pv.fila)
      .replace(/\{\{DATA\}\}/g,data)
      .replace('{{CONTEUDO}}',conteudo);
    const puppeteer=require('puppeteer');
    const browser=await puppeteer.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
    const page=await browser.newPage();
    await page.setContent(html,{waitUntil:'networkidle0'});
    const pdf=await page.pdf({format:'A4',printBackground:true,margin:{top:'15mm',bottom:'15mm',left:'15mm',right:'15mm'}});
    await browser.close();
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename="prova-fila-'+pv.fila+'.pdf"');
    res.send(pdf);
  } catch(e) { res.status(500).send('Erro PDF prova: '+e.message); }
});
router.get('/processo-seletivo/prova/:id/gabarito', requireAuth, async (req, res) => {
  try {
    const pvR=await query(`SELECT pv.*,p.nome as proc_nome,p.data_prova FROM ps_provas pv JOIN ps_processos p ON p.id=pv.processo_id WHERE pv.id=$1`,[req.params.id]);
    if(!pvR.rows.length) return res.status(404).send('Prova não encontrada');
    const pv=pvR.rows[0];
    const ids=pv.questoes_json||[];
    const qR=await query(`SELECT * FROM ps_questoes WHERE id=ANY($1::int[])`,[ ids]);
    const qMap={};qR.rows.forEach(q=>{qMap[q.id]=q;});
    // Agrupar por tema para o gabarito
    const temas={};
    ids.forEach((id,i)=>{
      const q=qMap[id];if(!q)return;
      if(!temas[q.tema])temas[q.tema]=[];
      temas[q.tema].push({num:i+1,...q});
    });
    let secoesGab='';
    Object.entries(temas).forEach(([tema,qs])=>{
      secoesGab+='<div class="gabarito-section"><div class="gabarito-section-title">'+tema+'</div>';
      secoesGab+='<div style="font-size:8pt;font-weight:700;display:flex;gap:4px;margin-bottom:4px;padding-left:22px"><span>A</span><span>B</span><span>C</span><span>D</span></div>';
      qs.forEach(q=>{
        secoesGab+='<div class="bubble-row"><span class="bubble-label">'+q.num+'</span>';
        ['A','B','C','D'].forEach(l=>{secoesGab+='<div class="bubble">'+l+'</div>';});
        secoesGab+='</div>';
      });
      secoesGab+='</div>';
    });
    const data=pv.data_prova?new Date(pv.data_prova).toLocaleDateString('pt-BR'):'___/___/______';
    const html=require('fs').readFileSync(__dirname.replace('routes','').replace('src/','')+'views/pdf/gabarito-template.html','utf8')
      .replace(/\{\{FILA\}\}/g,pv.fila)
      .replace(/\{\{DATA\}\}/g,data)
      .replace('{{SECOES_GABARITO}}',secoesGab);
    const puppeteer=require('puppeteer');
    const browser=await puppeteer.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
    const page=await browser.newPage();
    await page.setContent(html,{waitUntil:'networkidle0'});
    const pdf=await page.pdf({format:'A4',printBackground:true,margin:{top:'10mm',bottom:'10mm',left:'15mm',right:'15mm'}});
    await browser.close();
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename="gabarito-fila-'+pv.fila+'.pdf"');
    res.send(pdf);
  } catch(e) { res.status(500).send('Erro PDF gabarito: '+e.message); }
});
// ─────────────────────────────────────────────────────────────────────────────

// ─── WEBHOOK PAGBANK ──────────────────────────────────────────────────────────

router.post('/webhook/pagbank', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    let body;
    try { body = JSON.parse(req.body.toString()); }
    catch (e) { return res.sendStatus(200); }

    console.log('PagBank Webhook recebido:', JSON.stringify(body).substring(0, 300));

    const { orderId, referencia, status, pago, metodo } = processarWebhook(body);

    if (!referencia) return res.sendStatus(200);

    // Pagamento de MENSALIDADE
    if (pago && referencia.startsWith('mensalidade-')) {
      const r = await query(
        "UPDATE cobrancas SET status='pago', data_pagamento=NOW(), pagbank_charge_id=$1, metodo_pagamento=COALESCE($3,metodo_pagamento) WHERE referencia=$2 AND status!='pago' RETURNING id",
        [orderId, referencia, metodo]
      );
      if (r.rowCount > 0) {
        console.log('PagBank mensalidade confirmada:', referencia, orderId, 'metodo:', metodo);
        try {
          const { lancarMensalidadeNoFluxo } = require('../services/fluxo-mensalidade');
          await lancarMensalidadeNoFluxo(query, r.rows[0].id);
        } catch(e) { console.error('lancar fluxo (webhook2):', e.message); }
      }
    }

    // Pagamento de MENSALIDADE (formato {membro_id}-{ano}-{mes}, ex: 56-2026-05)
    if (pago && /^\d+-\d{4}-\d{2}$/.test(referencia)) {
      const r = await query(
        "UPDATE cobrancas SET status='pago', data_pagamento=NOW(), metodo_pagamento=COALESCE($2,metodo_pagamento) WHERE referencia=$1 AND status!='pago' RETURNING id",
        [referencia, metodo]
      );
      if (r.rowCount > 0) {
        console.log('PagBank mensalidade confirmada via webhook:', referencia, orderId, 'metodo:', metodo);
        try {
          const { lancarMensalidadeNoFluxo } = require('../services/fluxo-mensalidade');
          await lancarMensalidadeNoFluxo(query, r.rows[0].id);
        } catch(e) { console.error('lancar fluxo (webhook):', e.message); }
      }
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
          // Lançar no fluxo de caixa
          try {
            const epR = await query(`SELECT ep.*, ei.nome as inscrito, e.nome as evento_nome FROM evento_pagamentos ep JOIN evento_inscricoes ei ON ei.id=ep.inscricao_id JOIN eventos e ON e.id=ei.evento_id WHERE ep.inscricao_id=$1 AND ep.status='pago' LIMIT 1`,[inscricaoId]);
            if(epR.rows.length){
              const ep=epR.rows[0];
              const jaExiste=await query('SELECT id FROM fluxo_caixa WHERE observacoes ILIKE $1',['%inscricao_id:'+ep.id+'%']);
              if(!jaExiste.rows.length){
                const v=parseFloat(ep.valor)||0;
                const liquido=ep.metodo==='cartao'?Math.round(v*0.96*100)/100:Math.round(v*0.981*100)/100;
                const dataPag=new Date().toISOString().slice(0,10);
                await query(`INSERT INTO fluxo_caixa (tipo,descricao,categoria,valor,data_lancamento,observacoes,criado_em) VALUES ('E',$1,'Eventos',$2,$3,$4,NOW())`,
                  [('Ingresso '+ep.evento_nome+' — '+ep.inscrito).substring(0,200), liquido, dataPag,
                   'Pago via '+(ep.metodo||'pix')+'. Bruto R$ '+v.toFixed(2)+'. inscricao_id:'+ep.id]);
              }
            }
          } catch(ef){ console.error('lancar fluxo evento webhook:', ef.message); }
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
          (SELECT COUNT(*) FROM turma_membros tm JOIN membros mx ON mx.id=tm.membro_id WHERE tm.turma_id=a.turma_id AND mx.status='ativo') as total_membros
         FROM atividades a WHERE a.turma_id=$1 ORDER BY a.data_atividade DESC`, [turmaId]
      );
      for (const at of atR.rows) {
        const membR = await query(
          `SELECT m.id as membro_id, m.nome,
            COALESCE((SELECT p.presente FROM presencas p WHERE p.atividade_id=$1 AND p.membro_id=m.id),0) as presente
           FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id
           WHERE tm.turma_id=$2 AND m.status='ativo' ORDER BY m.nome`, [at.id, turmaId]
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
         WHERE tm.turma_id=$1 AND m.status='ativo' ORDER BY m.nome`, [turmaId]
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
  let turma_ids = req.body.turmas_ids || req.body.turma_id_sel || req.body.turma_id;
  if (!Array.isArray(turma_ids)) turma_ids = turma_ids ? [turma_ids] : [];
  turma_ids = turma_ids.filter(Boolean);
  if (!turma_ids.length) { req.flash('erro', 'Selecione ao menos uma turma.'); return res.redirect('/frequencia'); }
  const { tipo, descricao, data_atividade } = req.body;
  for (const turma_id of turma_ids) {
    const r = await query(
      'INSERT INTO atividades (turma_id,tipo,descricao,data_atividade) VALUES ($1,$2,$3,$4) RETURNING id',
      [turma_id, tipo, descricao, data_atividade]
    );
    const membros = await query("SELECT tm.membro_id FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id WHERE tm.turma_id=$1 AND m.status='ativo'", [turma_id]);
    for (const m of membros.rows) {
      await query('INSERT INTO presencas (atividade_id,membro_id,presente) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [r.rows[0].id, m.membro_id]);
    }
  }
  req.flash('msg', 'Atividade criada em ' + turma_ids.length + ' turma(s)!');
  res.redirect('/frequencia?turma=' + turma_ids[0]);
});

router.post('/frequencia/atividade/:id/presenca', requireAuth, requireSecretaria, async (req, res) => {
  const atId = req.params.id;
  const presentes = [].concat(req.body.presentes || []);
  const at = await query('SELECT turma_id FROM atividades WHERE id=$1', [atId]);
  if (!at.rows[0]) return res.redirect('/frequencia');
  const turmaId = at.rows[0].turma_id;
  const membros = await query("SELECT tm.membro_id FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id WHERE tm.turma_id=$1 AND m.status='ativo'", [turmaId]);
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

router.post('/frequencia/atividade/:id/editar', requireAuth, requireSecretaria, async (req, res) => {
  const { tipo, descricao, data_atividade } = req.body;
  const r = await query('SELECT turma_id FROM atividades WHERE id=$1', [req.params.id]);
  const turmaId = r.rows[0]?.turma_id;
  await query('UPDATE atividades SET tipo=$1, descricao=$2, data_atividade=$3 WHERE id=$4',
    [tipo, descricao, data_atividade, req.params.id]);
  res.redirect('/frequencia?turma=' + turmaId + '&tab=atividades');
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
  const [membrosR, atividadesR, presencasR] = await Promise.all([
    query(`SELECT m.id, m.nome, m.email FROM turma_membros tm JOIN ligantes m ON m.id=tm.membro_id WHERE tm.turma_id=$1 AND m.ativo=1 AND m.pendente=false ORDER BY m.nome`, [req.params.turmaId]),
    query('SELECT id, tipo, descricao, data_atividade FROM atividades WHERE turma_id=$1 ORDER BY data_atividade', [req.params.turmaId]),
    query('SELECT p.membro_id, p.atividade_id, p.presente FROM presencas p JOIN atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1', [req.params.turmaId])
  ]);
  const atividades = atividadesR;
  const totalAtividades = atividades.rows.length;
  const pd = {};
  presencasR.rows.forEach(p => { if(!pd[p.atividade_id]) pd[p.atividade_id]={}; pd[p.atividade_id][p.membro_id]=p.presente; });
  const membros = { rows: membrosR.rows.map(m => ({
    ...m,
    total_atividades: totalAtividades,
    presencas: presencasR.rows.filter(p => p.membro_id===m.id && p.presente===1).length
  }))};
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

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;border-radius:0!important;font-family:'Inter',sans-serif}
body{background:#f0f4f0;padding:32px;min-height:100vh}
.header-bar{background:linear-gradient(160deg,#0a1a08,#1a3410,#253d18);padding:24px 32px;display:flex;align-items:center;gap:16px;margin:-32px -32px 28px}
.header-bar img{width:72px;height:72px;border-radius:50%!important;border:3px solid rgba(255,255,255,.35);object-fit:cover}
.header-bar-info h1{font-size:20px;font-weight:800;color:#fff}
.header-bar-info p{font-size:12px;color:rgba(255,255,255,.65);margin-top:3px}
.card{background:white;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:16px}
.stat{background:white;border:1px solid #e2e8f0;padding:18px 20px;border-top:3px solid #1a3410}
.stat.verde{border-top-color:#10b981}
.stat.ambar{border-top-color:#f59e0b}
.stat.verm{border-top-color:#ef4444}
.stat-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:6px}
.stat-num{font-size:28px;font-weight:800;color:#1a3410}
.stat.verde .stat-num{color:#10b981}
.stat.ambar .stat-num{color:#f59e0b}
.stat.verm .stat-num{color:#ef4444}
.card-titulo{padding:14px 20px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:700;color:#1a3410;background:#f8faf6;text-transform:uppercase;letter-spacing:.04em}
table{width:100%;border-collapse:collapse}
thead th{background:linear-gradient(135deg,#1a3410,#253d18);color:#fff;padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
tbody tr:hover{background:#f0f7eb}
td{padding:11px 16px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#374151;vertical-align:middle}
.btn{background:linear-gradient(135deg,#1a3410,#253d18);color:white;border:none;padding:11px 28px;cursor:pointer;font-size:14px;font-weight:700;margin-bottom:24px;display:inline-flex;align-items:center;gap:8px;transition:transform .12s ease,box-shadow .12s ease}
.btn:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(37,61,24,.35)}
@media print{.btn{display:none}body{background:white;padding:16px}.header-bar{margin:-16px -16px 20px}}
</style></head><body>`
  const logoEl = orgLogo ? `<img src="${orgLogo}" alt="${orgNome}">` : `<div style="width:72px;height:72px;border-radius:50%!important;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#fff">${orgNome.substring(0,2).toUpperCase()}</div>`;
  const htmlDir = `<div class="header-bar">${logoEl}<div class="header-bar-info"><h1>${turma.nome}</h1><p>${dataInicio ? dataInicio+' · ' : ''}${atividades.rows.length} atividades · Mínimo 75% para aprovação</p></div></div>`
    + '<button class="btn" onclick="window.print()"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Imprimir / Salvar PDF</button>'
    + `<div class="stats"><div class="stat verde"><div class="stat-lbl">Aptos ≥75%</div><div class="stat-num">${aptos}</div></div><div class="stat ambar"><div class="stat-lbl">Em risco 50-74%</div><div class="stat-num">${risco}</div></div><div class="stat verm"><div class="stat-lbl">Não aptos &lt;50%</div><div class="stat-num">${inaptos}</div></div></div>`
    + '<div class="card"><div class="card-titulo">Resumo por Ligante</div>'
    + '<table><thead><tr>'
    + '<th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700">Ligante</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Presencas</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Faltas</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Total</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Frequencia</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Status</th>'
    + '</tr></thead><tbody>' + linhasMembros + '</tbody></table></div>'
    + '<div class="card"><div class="card-titulo">Presenças por Atividade</div>'
    + '<div style="overflow-x:auto"><table><thead><tr>' + headerAt + '</tr></thead><tbody>' + linhasAt + '</tbody></table></div></div>'
    + '</body></html>';
  res.send(html + htmlDir);
});

router.get('/frequencia/integridade/:id', requireAuth, async (req, res) => {
  try {
    const turmaId = req.params.id;
    const ligantes = await query('SELECT id, nome FROM ligantes WHERE ativo=1 ORDER BY nome');
    const membros = await query("SELECT tm.membro_id FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id WHERE tm.turma_id=$1 AND m.status='ativo'",[turmaId]);
    const ids = new Set(membros.rows.map(m=>m.membro_id));
    const faltando = ligantes.rows.filter(l=>!ids.has(l.id));
    const problemas = [];
    if (faltando.length > 0) {
      problemas.push({ severidade:'aviso', descricao: faltando.length + ' ligante(s) ativo(s) nao estao na turma: ' + faltando.slice(0,5).map(l=>l.nome).join(', ') + (faltando.length>5?' e mais '+(faltando.length-5)+'...':'') });
    }
    // checar presencas orfas
    const orfas = await query("SELECT COUNT(*) as total FROM presencas p JOIN atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1 AND p.membro_id NOT IN (SELECT tm.membro_id FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id WHERE tm.turma_id=$1 AND m.status='ativo')",[ turmaId]);
    if (parseInt(orfas.rows[0].total) > 0) {
      problemas.push({ severidade:'erro', descricao: orfas.rows[0].total + ' presenca(s) de membros que nao estao mais na turma' });
    }
    res.json({ totalProblemas: problemas.length, problemas });
  } catch(e) { res.json({ok:false, totalProblemas:1, problemas:[{severidade:'erro',descricao:'Erro interno: '+e.message}]}); }
});

router.post('/frequencia/turma/:id/sincronizar', requireAuth, async (req, res) => {
  try {
    const turmaId = req.params.id;
    const ligantes = await query('SELECT id FROM ligantes WHERE ativo=1');
    let adicionados = 0;
    for (const l of ligantes.rows) {
      const existe = await query('SELECT id FROM turma_membros WHERE turma_id=$1 AND membro_id=$2',[turmaId,l.id]);
      if (existe.rows.length === 0) {
        await query('INSERT INTO turma_membros (turma_id,membro_id,data_entrada,criado_em) VALUES ($1,$2,NOW(),NOW())',[turmaId,l.id]);
        adicionados++;
      }
    }
    req.flash('msg', adicionados > 0 ? adicionados+' ligantes sincronizados!' : 'Todos os ligantes já estão na turma.');
    res.redirect('/frequencia?turma='+turmaId);
  } catch(e) { req.flash('erro','Erro: '+e.message); res.redirect('/frequencia'); }
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
     FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id WHERE tm.turma_id=$1 AND m.status='ativo'` + sqlFiltro, params
  );
  const orgNome = config.org_nome || 'Liga Academica de Urologia';
  let enviados = 0;
  for (const m of membros.rows) {
    const pct = m.total_atividades > 0 ? Math.round((m.presencas / m.total_atividades) * 100) : 0;
    const status = pct >= 75 ? 'APTO ✅' : pct >= 50 ? 'EM RISCO ⚠️' : 'NÃO APTO ❌';
    const msgWpp = `*${orgNome}* 📊\n\nOlá, *${m.nome.split(' ')[0]}*!\n\nSeu relatório de frequência da turma *${turma.nome}*:\n\n📅 Atividades realizadas: *${m.total_atividades}*\n✅ Suas presenças: *${m.presencas}*\n📊 Frequência: *${pct}%*\n🎓 Status: *${status}*\n\n${pct >= 75 ? 'Parabéns! Você está apto para o certificado! 🎉' : pct >= 50 ? 'Atenção! Você está em risco. Não falte às próximas atividades! ⚠️' : 'Atenção! Você está abaixo do mínimo exigido (75%). Participe mais! ❌'}\n\nQualquer dúvida, entre em contato com a secretaria.`;
    if (m.whatsapp && process.env.WAPP_SOMENTE_RESPOSTA !== 'true') { try { await enviarWhatsApp(m.whatsapp, msgWpp); enviados++; } catch(e) {} }
    if (m.email) {
      const orgCor = config.org_cor || '#2b6803';
      const orgCorEsc = '#1a3d02';
      const orgLogo = config.org_logo || null;
      const pn = m.nome.split(' ')[0];
      const corStatus = pct>=75?'#166534':pct>=50?'#92400e':'#991b1b';
      const bgStatus  = pct>=75?'#dcfce7':pct>=50?'#fef3c7':'#fee2e2';
      const logoHtml  = orgLogo
        ? `<div style="width:72px;height:72px;background:#fff;border-radius:50%;display:inline-block;text-align:center;overflow:hidden"><img src="${orgLogo}" alt="${orgNome}" style="width:72px;height:72px;object-fit:cover;border-radius:50%;vertical-align:middle"></div>`
        : `<span style="color:white;font-size:20px;font-weight:800">${orgNome}</span>`;
      const barW = Math.round(pct);
      const barColor = pct>=75?'#22c55e':pct>=50?'#f59e0b':'#ef4444';
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f1f5f9"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td style="background:linear-gradient(160deg,${orgCor} 0%,${orgCorEsc} 100%);border-radius:12px 12px 0 0;padding:36px 40px;text-align:center">${logoHtml}<div style="margin-top:14px"><span style="color:rgba(255,255,255,0.9);font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;background:rgba(255,255,255,0.15);border-radius:4px;padding:4px 16px;display:inline-block">Reporte de Asistencia</span></div></td></tr><tr><td style="background:white;padding:36px 40px"><div style="border-left:3px solid ${orgCor};padding-left:14px;margin-bottom:24px"><p style="margin:0;font-size:11px;font-weight:700;color:${orgCor};letter-spacing:1.5px;text-transform:uppercase">Curso</p><h2 style="margin:4px 0 0;font-size:20px;font-weight:700;color:#0f172a">${turma.nome}</h2></div><p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7">¡Hola, <strong>${pn}</strong>! A continuación encontrarás tu reporte de asistencia actualizado.</p><table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;margin-bottom:24px"><tr style="background:#f8fafc"><td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0">Actividades realizadas</td><td style="padding:12px 16px;font-size:14px;font-weight:700;color:#0f172a;text-align:right;border-bottom:1px solid #e2e8f0">${m.total_atividades}</td></tr><tr><td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0">Tus asistencias</td><td style="padding:12px 16px;font-size:14px;font-weight:700;color:#0f172a;text-align:right;border-bottom:1px solid #e2e8f0">${m.presencas}</td></tr><tr style="background:#f8fafc"><td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0">Frecuencia</td><td style="padding:12px 16px;font-size:14px;font-weight:700;color:#0f172a;text-align:right;border-bottom:1px solid #e2e8f0">${pct}%</td></tr><tr><td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600">Estado</td><td style="padding:12px 16px;text-align:right"><span style="background:${bgStatus};color:${corStatus};padding:4px 12px;border-radius:4px;font-size:12px;font-weight:700">${status}</span></td></tr></table><div style="margin-bottom:24px"><div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:12px;color:#64748b;font-weight:600">Progreso</span><span style="font-size:12px;font-weight:700;color:${barColor}">${pct}%</span></div><div style="background:#e2e8f0;border-radius:99px;height:10px;overflow:hidden"><div style="width:${barW}%;background:${barColor};height:10px;border-radius:99px"></div></div><div style="display:flex;justify-content:flex-end;margin-top:4px"><span style="font-size:10px;color:#94a3b8">Mínimo requerido: 75%</span></div></div><div style="background:#f8fafc;border-radius:8px;padding:16px 20px;border:1px solid #e2e8f0"><p style="margin:0;font-size:12px;color:#64748b;line-height:1.7">${pct>=75?'🎉 ¡Felicitaciones! Estás <strong>apto para el certificado</strong> de 1 año de liga.':pct>=50?'⚠️ ¡Atención! Estás en riesgo. <strong>No faltes a las próximas actividades</strong> para garantizar el certificado.':'❌ Estás por debajo del mínimo requerido (75%). <strong>¡Participa más</strong> en las actividades para revertir esta situación!'}</p></div></td></tr><tr><td style="background:#0f172a;border-radius:0 0 12px 12px;padding:24px 40px"><table width="100%" cellpadding="0" cellspacing="0"><tr><td><p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;font-weight:600">${orgNome}</p><p style="margin:4px 0 0;color:rgba(255,255,255,0.4);font-size:10px">Mensaje automático — no responda este correo.</p></td><td align="right"><p style="margin:0;color:rgba(255,255,255,0.3);font-size:9px;letter-spacing:1.5px;text-transform:uppercase">UCP · Ciudad del Este</p></td></tr></table></td></tr></table></td></tr></table></body></html>`;
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
      marketing:   ['dashboard', 'marketing', 'aniversarios'],
      ensino:      ['dashboard', 'projetos', 'frequencia', 'aniversarios'],
      extensao:    ['dashboard', 'projetos', 'eventos', 'aniversarios'],
      cientifico:  ['dashboard', 'projetos', 'eventos', 'aniversarios'],
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

// ─── EXCLUIR USUÁRIO ─────────────────────────────────────────────────────────
router.post('/usuarios/:id/excluir', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const u = await query('SELECT nome, perfil FROM usuarios WHERE id=$1', [id]);
    if (!u.rows.length) { req.flash('erro', 'Usuário não encontrado.'); return res.redirect('/usuarios'); }
    if (u.rows[0].perfil === 'admin') { req.flash('erro', 'Não é possível excluir o administrador principal.'); return res.redirect('/usuarios'); }
    await query('DELETE FROM usuario_permissoes WHERE usuario_id=$1', [id]);
    await query('DELETE FROM usuarios WHERE id=$1', [id]);
    req.flash('msg', 'Usuário ' + u.rows[0].nome + ' excluído com sucesso.');
  } catch(e) {
    req.flash('erro', 'Erro ao excluir usuário: ' + e.message);
  }
  res.redirect('/usuarios');
});

// ─── WEBHOOK WHATSAPP — LAURO ─────────────────────────────────────────────────
router.post('/webhook/whatsapp', async (req, res) => {
  try {
    // Validação de token W-API
    const wapiToken = process.env.WAPI_TOKEN;
    if (wapiToken) {
      const authHeader = req.headers['authorization'] || req.headers['x-wapi-token'] || '';
      const bodyToken = req.body && req.body.token;
      const instanceId = req.body && req.body.instanceId;
      const expectedInstance = process.env.WAPI_INSTANCE_ID;
      if (expectedInstance && instanceId && instanceId !== expectedInstance) return res.sendStatus(200);
      if (!authHeader && !bodyToken) {
        // W-API envia sem header de auth — aceitar mas validar instanceId
      }
    }
    const body = req.body;
    if (!body || typeof body !== 'object') return res.sendStatus(200);
    console.log('Webhook WA recebido:', JSON.stringify(body).substring(0, 1000));
    // Detectar provider: W-API, Evolution API ou Z-API
    const isWAPI = !!(body.instanceId && body.data && body.data.from !== undefined);
    const isEvolution = !isWAPI && !!(body.event && body.data);
    const evData = isEvolution ? body.data : null;
    const wapiData = isWAPI ? body.data : null;

    // Ignorar mensagens proprias e grupos
    const fromMe = isWAPI ? wapiData.fromMe : (isEvolution ? (evData.key && evData.key.fromMe) : body.fromMe);
    const isGroup = isWAPI ? (!!(wapiData.isGroup || (wapiData.from && wapiData.from.includes('@g.us')))) : (isEvolution ? (evData.key && evData.key.remoteJid && evData.key.remoteJid.includes('@g.us')) : body.isGroup);
    if (fromMe === true) return res.sendStatus(200);
    if (isGroup === true) return res.sendStatus(200);
    if (isEvolution && body.event !== 'messages.upsert') return res.sendStatus(200);

    // Extrair numero
    let numero = '';
    if (isWAPI) {
      numero = (wapiData.from || '').replace('@c.us','').replace('@s.whatsapp.net','').replace(/[^0-9]/g,'');
    } else if (isEvolution) {
      const remoteJid = evData.key && evData.key.remoteJid || '';
      if (remoteJid.includes('@lid') && body.sender) {
        numero = body.sender.replace('@s.whatsapp.net','').replace(/[^0-9]/g,'');
      } else {
        numero = remoteJid.replace('@s.whatsapp.net','').replace(/[^0-9]/g,'');
      }
    } else {
      numero = ((body.sender && body.sender.id ? body.sender.id : '') || (body.phone||'') || (body.senderPhone||'')).replace(/[^0-9]/g, '');
    }

    // Extrair texto
    let texto = '';
    if (isWAPI) {
      texto = (wapiData.body || wapiData.caption || '').toString().trim();
    } else if (isEvolution) {
      const msg = evData.message || {};
      texto = (msg.conversation || (msg.extendedTextMessage && msg.extendedTextMessage.text) || '').toString().trim();
    } else {
      texto = ((body.msgContent && body.msgContent.conversation) || (body.msgContent && body.msgContent.extendedTextMessage && body.msgContent.extendedTextMessage.text) || (body.text && body.text.message) || (body.body||'')).toString().trim();
    }

    // Extrair midia
    let midia = null;
    try {
      if (isWAPI) {
        const tipo = wapiData.type || '';
        if (tipo === 'image') midia = { tipo:'image', url: wapiData.image || '', caption: wapiData.caption || '' };
        else if (tipo === 'document') midia = { tipo:'document', url: wapiData.document || '', fileName: wapiData.fileName || 'arquivo', caption: '' };
        else if (tipo === 'video') midia = { tipo:'video', url: wapiData.video || '', caption: wapiData.caption || '' };
        else if (tipo === 'audio' || tipo === 'ptt') midia = { tipo:'audio', url: wapiData.audio || '', caption: '' };
      } else if (isEvolution) {
        const msg = evData.message || {};
        if (msg.imageMessage) midia = { tipo:'image', url: msg.imageMessage.url || '', caption: msg.imageMessage.caption || '' };
        else if (msg.documentMessage) midia = { tipo:'document', url: msg.documentMessage.url || '', fileName: msg.documentMessage.fileName || 'arquivo', caption: '' };
        else if (msg.videoMessage) midia = { tipo:'video', url: msg.videoMessage.url || '', caption: msg.videoMessage.caption || '' };
        else if (msg.audioMessage) midia = { tipo:'audio', url: msg.audioMessage.url || '', caption: '' };
      } else {
        if (body.image && (body.image.imageUrl || body.image.url)) midia = { tipo:'image', url: body.image.imageUrl || body.image.url, caption: body.image.caption || '' };
        else if (body.document && (body.document.documentUrl || body.document.url)) midia = { tipo:'document', url: body.document.documentUrl || body.document.url, fileName: body.document.fileName || body.document.title || 'arquivo', caption: body.document.caption || '' };
        else if (body.video && (body.video.videoUrl || body.video.url)) midia = { tipo:'video', url: body.video.videoUrl || body.video.url, caption: body.video.caption || '' };
        else if (body.audio && (body.audio.audioUrl || body.audio.url)) midia = { tipo:'audio', url: body.audio.audioUrl || body.audio.url, caption: '' };
      }
    } catch(e) {}
    if (numero.length < 5 || (texto.length < 1 && !midia)) return res.sendStatus(200);
    console.log('Lauro processando:', numero, '-', texto || ('['+(midia && midia.tipo)+']'));
    // R2 persist: baixa midia temporaria Z-API e salva permanentemente
    if (midia && typeof midia.url === 'string' && midia.url.startsWith('http')) {
      try {
        const _axR2 = require('axios');
        const { uploadArquivo: _upR2 } = require('../services/arquivos');
        const _resp = await _axR2.get(midia.url, { responseType: 'arraybuffer', timeout: 15000 });
        const _mime = ((_resp.headers['content-type'] || 'application/octet-stream').split(';')[0]).trim();
        const _ext = midia.fileName
          ? (midia.fileName.split('.').pop() || 'bin')
          : (_mime.split('/')[1] || 'bin').replace('jpeg','jpg');
        const _r = await _upR2(Buffer.from(_resp.data), 'wapp-'+Date.now()+'.'+_ext, _mime, 'wapp-midias');
        midia.url = _r.chave;
        console.log('Lauro R2 midia salva:', _r.chave);
      } catch(_e) { console.error('Lauro R2 midia ERRO (url temp mantida):', _e.message); }
    }
    const { processarMensagem } = require('../services/lauro');
    processarMensagem(numero, texto, midia);
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

router.post('/cadastro-diretivo', require('../services/arquivos').upload.single('foto'), async (req, res) => {
  try {
    const { nome, rg, cpf, email, catraca, cargo, semestre_turma, orcid, data_nascimento,
            whatsapp, instagram, graduacao, ano_ingresso, onde_reside, transporte_proprio,
            tipo_transporte, experiencia_urologia } = req.body;
    const disponibilidade = [].concat(req.body.disponibilidade || []).join(', ');
    if (!nome || !email) { req.session.erro = ['Nome e e-mail são obrigatórios.']; return res.redirect('/cadastro-diretivo'); }
    // Upload de foto se enviada
    let foto_chave = null;
    if (req.file) {
      try {
        const { uploadArquivo } = require('../services/arquivos');
        const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'diretivos');
        foto_chave = r.chave;
      } catch(ef) { console.error('Erro upload foto diretivo:', ef.message); }
    }
    const whatsappNum = whatsapp || ((req.body.ddi||'')+' '+(req.body.whatsapp_num||'')).trim() || null;
    const r = await query(
      `INSERT INTO diretivos (nome,rg,cpf,email,catraca,cargo,semestre_turma,orcid,data_nascimento,
        whatsapp,instagram,graduacao,ano_ingresso,onde_reside,transporte_proprio,tipo_transporte,
        disponibilidade,experiencia_urologia,foto_chave,pendente,cadastrado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,true,NOW())
       RETURNING id`,
      [nome,rg,cpf,email,catraca,cargo,semestre_turma,orcid,(data_nascimento&&data_nascimento.trim()&&data_nascimento!='Invalid Date'?data_nascimento:null),
       whatsappNum,instagram,graduacao,ano_ingresso,onde_reside,transporte_proprio,
       tipo_transporte,disponibilidade,experiencia_urologia,foto_chave]
    );
    console.log('Cadastro diretivo OK — id:', r.rows[0].id, 'nome:', nome, 'email:', email);
    req.session.msg = ['Cadastro realizado com sucesso! Obrigado, ' + nome.split(' ')[0] + '! Aguarde a aprovacao da diretoria.'];
    res.redirect('/cadastro-diretivo');
  } catch(e) {
    console.error('Erro cadastro diretivo DETALHADO:', e.message, e.stack);
    req.session.erro = ['Erro ao cadastrar: ' + e.message + '. Tente novamente.'];
    res.redirect('/cadastro-diretivo');
  }
});

router.get('/diretivos', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];
  const statusFiltro = req.query.status || 'ativos';
  let whereAtivo;
  if (statusFiltro === 'pendente') whereAtivo = 'pendente=true';
  else if (statusFiltro === 'inativos') whereAtivo = 'ativo=0 AND pendente=false';
  else if (statusFiltro === 'todos') whereAtivo = 'pendente=false';
  else whereAtivo = 'ativo=1 AND pendente=false';
  const r = await query('SELECT * FROM diretivos WHERE ' + whereAtivo + ' ORDER BY cargo, nome');
  const pcR = await query('SELECT COUNT(*) n FROM diretivos WHERE pendente=true');
  const pendentesCount = parseInt(pcR.rows[0].n);
  res.render('pages/diretivos', {
    config, msg, erro, diretivos: r.rows, usuario: req.session.usuario,
    appUrl: process.env.APP_URL || 'https://liga-urologia.onrender.com',
    statusFiltro, pendentesCount
  });
});

router.post('/diretivos', requireAuth, requireSecretaria, async (req, res) => {
  const { nome, rg, cpf, email, whatsapp, cargo, semestre_turma, data_nascimento, onde_reside, disponibilidade } = req.body;
  await query('INSERT INTO diretivos (nome,rg,cpf,email,whatsapp,cargo,semestre_turma,data_nascimento,onde_reside,disponibilidade) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [nome,rg,cpf,email,whatsapp,cargo,semestre_turma,data_nascimento||null,onde_reside,disponibilidade]);
  req.session.msg = ['Diretivo cadastrado com sucesso!'];
  res.redirect('/diretivos');
});

router.get('/diretivos/:id/aprovar', requireAuth, requireSecretaria, async (req, res) => {
  await query('UPDATE diretivos SET pendente=false, ativo=1 WHERE id=$1', [req.params.id]);
  await logAtividade(req.session.usuario.id, 'DIRETIVO_LIBERADO', 'Cadastro pendente liberado ID: ' + req.params.id, req);
  req.session.msg = ['Cadastro de diretivo liberado com sucesso!'];
  res.redirect('/diretivos?status=pendente');
});
router.get('/diretivos/:id/excluir', requireAuth, requireSecretaria, async (req, res) => {
  await query('DELETE FROM diretivos WHERE id=$1 AND pendente=true', [req.params.id]);
  await logAtividade(req.session.usuario.id, 'DIRETIVO_RECUSADO', 'Cadastro pendente recusado ID: ' + req.params.id, req);
  req.session.msg = ['Cadastro pendente recusado e removido.'];
  res.redirect('/diretivos?status=pendente');
});

router.post('/diretivos/:id/editar', requireAuth, requireSecretaria, (req, res) => {
  const { upload, uploadArquivo } = require('../services/arquivos');
  upload.single('foto')(req, res, async (err) => {
    try {
      if (err) { req.session.erro = ['Erro no upload da foto: ' + err.message]; return res.redirect('/diretivos'); }
      const { nome,rg,cpf,email,whatsapp,instagram,catraca,cargo,semestre_turma,data_nascimento,
              onde_reside,disponibilidade,ano_ingresso,orcid,graduacao,experiencia_urologia,
              transporte_proprio,tipo_transporte } = req.body;
      // Foto: se enviada, sobe ao R2 e atualiza foto_chave; se não, mantém a atual
      let setFoto = '';
      const params = [nome,rg,cpf,email,whatsapp,instagram,catraca,cargo,semestre_turma,data_nascimento||null,
                      onde_reside,disponibilidade,ano_ingresso,orcid,graduacao,experiencia_urologia,
                      transporte_proprio,tipo_transporte];
      if (req.body.remover_foto === '1') {
        // Usuário pediu para remover a foto: zera foto_chave
        setFoto = ', foto_chave=$' + params.length;
      } else if (req.file && req.file.buffer && req.file.size > 0) {
        const r = await uploadArquivo(req.file.buffer, 'diretivo-'+req.params.id+'.'+(req.file.mimetype.split('/')[1]||'jpg'), req.file.mimetype, 'diretivos');
        params.push(r.chave);
        setFoto = ', foto_chave=$' + params.length;
      }
      params.push(req.params.id);
      await query(
        `UPDATE diretivos SET nome=$1,rg=$2,cpf=$3,email=$4,whatsapp=$5,instagram=$6,catraca=$7,
         cargo=$8,semestre_turma=$9,data_nascimento=$10,onde_reside=$11,disponibilidade=$12,
         ano_ingresso=$13,orcid=$14,graduacao=$15,experiencia_urologia=$16,
         transporte_proprio=$17,tipo_transporte=$18` + setFoto + ` WHERE id=$` + params.length,
        params
      );
      req.session.msg = ['Diretivo atualizado com sucesso!'];
      res.redirect('/diretivos');
    } catch (e) {
      req.session.erro = ['Erro ao atualizar diretivo: ' + e.message];
      res.redirect('/diretivos');
    }
  });
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
        (SELECT COUNT(*) FROM diretivo_turma_membros tm JOIN diretivos dx ON dx.id=tm.diretivo_id WHERE tm.turma_id=a.turma_id AND dx.ativo=1) as total_membros
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
       FROM diretivo_turma_membros tm JOIN diretivos d ON d.id=tm.diretivo_id WHERE tm.turma_id=$1 AND d.ativo=1 ORDER BY d.nome`, [turmaAtual.id]
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
  try {
    const { tipo, descricao, data_atividade } = req.body;
    const turmas_ids = [].concat(req.body.turmas_ids || req.body.turma_id_sel || req.body.turma_id || []).filter(Boolean);
    if (!turmas_ids.length) { req.session.erro=['Selecione ao menos uma turma.']; return res.redirect('/frequencia-diretivos'); }
    let lastTurmaId = turmas_ids[0];
    for (const turma_id of turmas_ids) {
      const r = await query('INSERT INTO diretivo_atividades (turma_id,tipo,descricao,data_atividade) VALUES ($1,$2,$3,$4) RETURNING id', [turma_id, tipo, descricao, data_atividade]);
      const membros = await query('SELECT dtm.diretivo_id FROM diretivo_turma_membros dtm JOIN diretivos d ON d.id=dtm.diretivo_id WHERE dtm.turma_id=$1 AND d.ativo=1', [turma_id]);
      for (const m of membros.rows) { await query('INSERT INTO diretivo_presencas (atividade_id,diretivo_id,presente) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [r.rows[0].id, m.diretivo_id]); }
      lastTurmaId = turma_id;
    }
    req.session.msg = ['Atividade criada!'];
    res.redirect('/frequencia-diretivos?turma=' + lastTurmaId);
  } catch(e) { console.error('ERRO criar atividade diretivos:', e.message); req.session.erro=[e.message]; res.redirect('/frequencia-diretivos'); }
});

router.post('/frequencia-diretivos/atividade/:id/presenca', requireAuth, requireSecretaria, async (req, res) => {
  const atR = await query('SELECT * FROM diretivo_atividades WHERE id=$1', [req.params.id]);
  const at = atR.rows[0];
  if (!at) return res.redirect('/frequencia-diretivos');
  const membros = await query('SELECT dtm.diretivo_id FROM diretivo_turma_membros dtm JOIN diretivos d ON d.id=dtm.diretivo_id WHERE dtm.turma_id=$1 AND d.ativo=1', [at.turma_id]);
  const presentes = [].concat(req.body.presentes || []).map(Number);
  for (const m of membros.rows) {
    await query('INSERT INTO diretivo_presencas (atividade_id,diretivo_id,presente) VALUES ($1,$2,$3) ON CONFLICT (atividade_id,diretivo_id) DO UPDATE SET presente=$3', [at.id, m.diretivo_id, presentes.includes(m.diretivo_id) ? 1 : 0]);
  }
  req.session.msg = ['Presenças salvas!'];
  res.redirect('/frequencia-diretivos?turma=' + at.turma_id);
});

router.post('/frequencia-diretivos/atividade/:id/editar', requireAuth, requireSecretaria, async (req, res) => {
  const { tipo, descricao, data_atividade } = req.body;
  const r = await query('SELECT turma_id FROM diretivo_atividades WHERE id=$1', [req.params.id]);
  const turmaId = r.rows[0]?.turma_id;
  await query('UPDATE diretivo_atividades SET tipo=$1, descricao=$2, data_atividade=$3 WHERE id=$4',
    [tipo, descricao, data_atividade, req.params.id]);
  res.redirect('/frequencia-diretivos?turma=' + turmaId + '&tab=atividades');
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

router.post('/frequencia-diretivos/turma/:id/sincronizar', requireAuth, async (req, res) => {
  try {
    const turmaId = req.params.id;
    const diretivos = await query('SELECT id FROM diretivos WHERE ativo=1');
    let adicionados = 0;
    for (const d of diretivos.rows) {
      const existe = await query('SELECT id FROM diretivo_turma_membros WHERE turma_id=$1 AND diretivo_id=$2',[turmaId,d.id]);
      if (existe.rows.length === 0) {
        await query('INSERT INTO diretivo_turma_membros (turma_id,diretivo_id,data_entrada) VALUES ($1,$2,NOW())',[turmaId,d.id]);
        adicionados++;
      }
    }
    req.flash('msg', adicionados > 0 ? adicionados+' diretivos sincronizados!' : 'Todos os diretivos já estão na turma.');
    res.redirect('/frequencia-diretivos?turma='+turmaId);
  } catch(e) { req.flash('erro','Erro: '+e.message); res.redirect('/frequencia-diretivos'); }
});

router.get('/frequencia-diretivos/integridade/:id', requireAuth, async (req, res) => {
  try {
    const turmaId = req.params.id;
    const diretivos = await query('SELECT id, nome FROM diretivos WHERE ativo=1 ORDER BY nome');
    const membros = await query('SELECT dtm.diretivo_id FROM diretivo_turma_membros dtm JOIN diretivos d ON d.id=dtm.diretivo_id WHERE dtm.turma_id=$1 AND d.ativo=1',[turmaId]);
    const ids = new Set(membros.rows.map(m=>m.diretivo_id));
    const faltando = diretivos.rows.filter(d=>!ids.has(d.id));
    const problemas = [];
    if (faltando.length > 0) problemas.push({ severidade:'aviso', descricao: faltando.length+' diretivo(s) ativo(s) não estão na turma: '+faltando.slice(0,5).map(d=>d.nome).join(', ')+(faltando.length>5?' e mais '+(faltando.length-5)+'...':'') });
    res.json({ totalProblemas: problemas.length, problemas });
  } catch(e) { res.json({ok:false, totalProblemas:1, problemas:[{severidade:'erro',descricao:'Erro: '+e.message}]}); }
});

router.get('/frequencia-diretivos/relatorio/:turmaId', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const turmaR = await query('SELECT * FROM diretivo_turmas WHERE id=$1', [req.params.turmaId]);
  const turma = turmaR.rows[0];
  if (!turma) return res.redirect('/frequencia-diretivos');
  const [membrosR2, atividadesR2, presencasR2] = await Promise.all([
    query(`SELECT d.id, d.nome, d.cargo FROM diretivo_turma_membros tm JOIN diretivos d ON d.id=tm.diretivo_id WHERE tm.turma_id=$1 ORDER BY d.nome`, [req.params.turmaId]),
    query('SELECT id, tipo, descricao, data_atividade FROM diretivo_atividades WHERE turma_id=$1 ORDER BY data_atividade', [req.params.turmaId]),
    query('SELECT p.diretivo_id, p.atividade_id, p.presente FROM diretivo_presencas p JOIN diretivo_atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1', [req.params.turmaId])
  ]);
  const atividades = atividadesR2;
  const totalAt2 = atividades.rows.length;
  const pd = {};
  presencasR2.rows.forEach(p => { if(!pd[p.atividade_id]) pd[p.atividade_id]={}; pd[p.atividade_id][p.diretivo_id]=p.presente; });
  const membros = { rows: membrosR2.rows.map(d => ({
    ...d,
    total_atividades: totalAt2,
    presencas: presencasR2.rows.filter(p => p.diretivo_id===d.id && p.presente===1).length
  }))};
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
  const logoEl2 = orgLogo ? `<img src="${orgLogo}" style="width:72px;height:72px;border-radius:50%;border:3px solid rgba(255,255,255,.35);object-fit:cover">` : `<div style="width:72px;height:72px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#fff">${orgNome.substring(0,2).toUpperCase()}</div>`;
  const htmlDir = `<!DOCTYPE html><html><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box;border-radius:0!important;font-family:'Inter',sans-serif}body{background:#f0f4f0;padding:32px;min-height:100vh}.header-bar{background:linear-gradient(160deg,#0a1a08,#1a3410,#253d18);padding:24px 32px;display:flex;align-items:center;gap:16px;margin:-32px -32px 28px}.header-bar img{width:72px;height:72px;border-radius:50%!important;border:3px solid rgba(255,255,255,.35);object-fit:cover}.header-bar-info h1{font-size:20px;font-weight:800;color:#fff}.header-bar-info p{font-size:12px;color:rgba(255,255,255,.65);margin-top:3px}.card{background:white;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,.06)}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:16px}.stat{background:white;border:1px solid #e2e8f0;padding:18px 20px}.stat.verde{border-top:3px solid #10b981}.stat.ambar{border-top:3px solid #f59e0b}.stat.verm{border-top:3px solid #ef4444}.stat-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:6px}.stat-num{font-size:28px;font-weight:800}.stat.verde .stat-num{color:#10b981}.stat.ambar .stat-num{color:#f59e0b}.stat.verm .stat-num{color:#ef4444}.card-titulo{padding:14px 20px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:700;color:#1a3410;background:#f8faf6;text-transform:uppercase;letter-spacing:.04em}table{width:100%;border-collapse:collapse}thead th{background:linear-gradient(135deg,#1a3410,#253d18);color:#fff;padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}tbody tr:hover{background:#f0f7eb}td{padding:11px 16px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#374151;vertical-align:middle}.btn{background:linear-gradient(135deg,#1a3410,#253d18);color:white;border:none;padding:11px 28px;cursor:pointer;font-size:14px;font-weight:700;margin-bottom:24px;display:inline-flex;align-items:center;gap:8px}@media print{.btn{display:none}body{background:white;padding:16px}.header-bar{margin:-16px -16px 20px}}</style></head><body>`
    + `<div class="header-bar">${logoEl2}<div class="header-bar-info"><h1>${turma.nome}</h1><p>${dataInicio ? dataInicio+' · ' : ''}${atividades.rows.length} atividades · Mínimo 75% para aprovação</p></div></div>`
    + '<button class="btn" onclick="window.print()">Imprimir / Salvar PDF</button>'
    + `<div class="stats"><div class="stat verde"><div class="stat-lbl">Aptos ≥75%</div><div class="stat-num">${aptos}</div></div><div class="stat ambar"><div class="stat-lbl">Em risco 50-74%</div><div class="stat-num">${risco}</div></div><div class="stat verm"><div class="stat-lbl">Não aptos &lt;50%</div><div class="stat-num">${inaptos}</div></div></div>`
    + '<div class="card"><div class="card-titulo">Resumo por Diretivo</div>'
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
      if (insc.whatsapp && process.env.WAPP_SOMENTE_RESPOSTA !== 'true') { try { await enviarWhatsApp(insc.whatsapp,msg); enviados++; } catch(e){} }
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
router.get('/eventos/:id/presencas-pdf', requireAuth, async (req, res) => {
  try {
    const config = await getConfig();
    const evR = await query('SELECT * FROM eventos WHERE id=$1',[req.params.id]);
    const ev = evR.rows[0];
    if (!ev) return res.status(404).send('Evento nao encontrado');
    const inscrR = await query(
      `SELECT i.*,
        COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(saida_em,NOW())-entrada_em))) FROM evento_presencas_tempo WHERE inscricao_id=i.id),0) as segundos_presencial,
        COALESCE((SELECT tempo_total_segundos FROM evento_presencas_online WHERE inscricao_id=i.id AND evento_id=$1),0) as segundos_online
       FROM evento_inscricoes i WHERE i.evento_id=$1 AND i.status='confirmado' ORDER BY i.nome`,
      [ev.id]
    );
    const inscricoes = inscrR.rows;
    const duracaoSeg = (ev.duracao_minutos||0)*60;
    const orgNome = config.org_nome||'LAURO';
    const orgLogo = config.org_logo||null;
    const tipoEv = ev.tipo_evento||'presencial';
    const dataEv = ev.data_inicio?new Date(ev.data_inicio).toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}):'';
    const fmtDur = (seg)=>{ const m=Math.floor(seg/60); const h=Math.floor(m/60); const mm=m%60; return h>0?(h+'h '+mm+'min'):(mm+'min'); };
    let aptos=0, risco=0, naoApt=0;
    const linhas = inscricoes.map((i,idx)=>{
      const segP=Number(i.segundos_presencial||0), segO=Number(i.segundos_online||0);
      const seg=Math.max(segP,segO);
      const tipo = segP>segO ? 'presencial' : segO>segP ? 'online' : (tipoEv==='hibrido'?'':tipoEv);
      const tipoLabel = tipo==='presencial'?'Presencial':tipo==='online'?'Online':'—';
      const pct = duracaoSeg>0 ? Math.min(100, Math.round(seg/duracaoSeg*100)) : 0;
      let stTxt, stBg, stCo;
      if (pct>=75){ stTxt='Apto'; stBg='#EDF6F1'; stCo='#23704F'; aptos++; }
      else if (pct>=50){ stTxt='Em risco'; stBg='#FBF3E0'; stCo='#C98A1E'; risco++; }
      else { stTxt='Não apto'; stBg='#FBE9E7'; stCo='#C0392B'; naoApt++; }
      const corPct = pct>=75?'#23704F':pct>=50?'#C98A1E':'#C0392B';
      return `<tr style="background:${idx%2===0?'#F6F8F5':'#ffffff'}"><td style="padding:7px 10px;font-size:10.5px;color:#74837C">${idx+1}</td><td style="padding:7px 10px;font-size:11px;font-weight:600;color:#10201A">${i.nome}<div style="font-size:9px;color:#74837C;font-weight:400">${i.email||''}</div></td><td style="padding:7px 10px;text-align:center"><span style="font-family:'IBM Plex Mono';font-size:9px;color:#3A4A43;border:1px solid #CDD4CE;padding:2px 7px">${tipoLabel}</span></td><td style="padding:7px 10px;font-size:10.5px;text-align:center;color:#3A4A43">${seg>0?fmtDur(seg):'—'}</td><td style="padding:7px 10px;text-align:center;font-family:'Archivo';font-weight:700;font-size:11px;color:${corPct}">${pct}%</td><td style="padding:7px 10px;text-align:center"><span style="background:${stBg};color:${stCo};padding:2px 8px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">${stTxt}</span></td></tr>`;
    }).join('');
    const minPct = 75;
    const minSeg = Math.round(duracaoSeg*minPct/100);
    const estilos=`*{margin:0;padding:0;box-sizing:border-box}@page{size:A4;margin:0}body{font-family:'IBM Plex Sans',Arial,sans-serif;color:#10201A;-webkit-print-color-adjust:exact;print-color-adjust:exact}@media print{.np{display:none}}.wrap{max-width:820px;margin:0 auto}.header{background:linear-gradient(135deg,#103024,#0C231B);padding:26px 34px;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:14px}.logo-chip{width:54px;height:54px;background:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}.logo-chip img{width:54px;height:54px;object-fit:cover;border-radius:50%}.org{font-family:'Archivo';font-weight:800;font-size:15px;letter-spacing:.3px;line-height:1.15}.org small{display:block;font-family:'IBM Plex Mono';font-size:8.5px;letter-spacing:2px;color:#37C98B;text-transform:uppercase;margin-top:4px;font-weight:500}.ev{text-align:right}.ev .nm{font-family:'Archivo';font-size:18px;font-weight:800;line-height:1.15}.ev .dt{font-size:11.5px;color:#A9C2B6;margin-top:5px;text-transform:capitalize}.ev .lc{font-size:10.5px;color:#7E988B;margin-top:1px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:18px 34px;background:#F2F4F0;border-bottom:1px solid #E2E6E1}.stat{background:#fff;border:1px solid #E2E6E1;padding:13px 14px;position:relative;overflow:hidden}.stat::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--bar,#2FA873)}.stat .n{font-family:'Archivo';font-size:21px;font-weight:800;letter-spacing:-.5px;color:var(--c,#15402F)}.stat .l{font-family:'IBM Plex Mono';font-size:8.5px;color:#74837C;font-weight:500;text-transform:uppercase;letter-spacing:1px;margin-top:4px}.section{padding:20px 34px}.sec-title{font-family:'Archivo';font-size:13px;font-weight:800;letter-spacing:.2px;text-transform:uppercase;margin-bottom:12px;padding-bottom:7px;border-bottom:2px solid #2FA873;color:#10201A}.dur{display:flex;gap:40px;border:1px solid #E2E6E1;padding:16px 20px}.dur .l{font-family:'IBM Plex Mono';font-size:9px;color:#74837C;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px}.dur .v{font-family:'Archivo';font-size:16px;font-weight:800;color:#15402F}table{width:100%;border-collapse:collapse;border:1px solid #E2E6E1}thead{display:table-header-group}thead th{background:#15402F;color:#fff;padding:9px 10px;font-family:'IBM Plex Mono';font-size:9px;text-align:left;text-transform:uppercase;letter-spacing:1px;font-weight:600}tbody td{border-bottom:1px solid #EDEFEC}tbody tr{page-break-inside:avoid}.foot{padding:16px 34px;border-top:1px solid #E2E6E1;font-family:'IBM Plex Mono';font-size:9px;color:#74837C;text-transform:uppercase;letter-spacing:1px;display:flex;justify-content:space-between;gap:12px}.btn-p{position:fixed;bottom:22px;right:22px;padding:12px 22px;background:#2FA873;color:#0C231B;border:none;cursor:pointer;font-family:'IBM Plex Sans';font-size:13px;font-weight:700;box-shadow:0 8px 24px -8px rgba(47,168,115,.8)}@media print{@page{margin:14mm 0 12mm}@page :first{margin:0 0 12mm}}`;
    const html=`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet"><style>${estilos}</style></head><body>
<div class="wrap">
  <div class="header"><div class="brand">${orgLogo?`<div class="logo-chip"><img src="${orgLogo}" alt=""></div>`:''}<div class="org">${orgNome}<small>Relatório de Presenças</small></div></div><div class="ev"><div class="nm">${ev.nome}</div><div class="dt">${dataEv}</div><div class="lc">${ev.local||''}</div></div></div>
  <div class="stats">
    <div class="stat" style="--bar:#2FA873;--c:#15402F"><div class="n">${inscricoes.length}</div><div class="l">Total confirmados</div></div>
    <div class="stat" style="--bar:#2FA873;--c:#23704F"><div class="n">${aptos}</div><div class="l">Aptos (≥75%)</div></div>
    <div class="stat" style="--bar:#C98A1E;--c:#C98A1E"><div class="n">${risco}</div><div class="l">Em risco (50–74%)</div></div>
    <div class="stat" style="--bar:#C0392B;--c:#C0392B"><div class="n">${naoApt}</div><div class="l">Não aptos (&lt;50%)</div></div>
  </div>
  <div class="section"><div class="dur"><div><div class="l">Duração total do evento</div><div class="v">${duracaoSeg>0?fmtDur(duracaoSeg):'Não definida'}</div></div><div><div class="l">Mínimo para certificado</div><div class="v" style="color:#23704F">${minPct}% — ${duracaoSeg>0?fmtDur(minSeg):'—'}</div></div></div></div>
  <div class="section"><div class="sec-title">Lista de presenças (${inscricoes.length})</div>
    <table><thead><tr><th style="width:34px">#</th><th>Participante</th><th style="text-align:center;width:78px">Tipo</th><th style="text-align:center;width:90px">Tempo assistido</th><th style="text-align:center;width:64px">% Presença</th><th style="text-align:center;width:80px">Status</th></tr></thead><tbody>${linhas}</tbody></table>
  </div>
  <div class="foot"><span>${orgNome} · Gerado em ${new Date().toLocaleString('pt-BR')}</span><span>${ev.nome}</span></div>
</div>
<button class="btn-p np" onclick="window.print()">Imprimir / Salvar PDF</button>
<script>window.onload=function(){setTimeout(function(){window.print();},500);};</script>
</body></html>`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.send(html);
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
    const orgCor = config.org_cor || '#2b6803';
    const logoHtml = orgLogo
      ? `<div class="logoring"><img src="${orgLogo}" alt="${orgNome}"></div>`
      : `<div style="font-size:22px;font-weight:800;letter-spacing:-.5px;color:${orgCor}">${orgNome}</div>`;
    const baseCss = `*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Sora',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#eef1ee;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;color:#1a2e1a}.wrap{width:100%;max-width:520px}.card{background:#fff;border:1px solid #dde3dd;border-top:4px solid var(--ac);box-shadow:0 12px 40px rgba(20,40,20,.09)}.logo{padding:28px 32px 22px;text-align:center;border-bottom:1px solid #e7eee4;background:linear-gradient(180deg,#ffffff,#f4f8f1)}.logoring{width:88px;height:88px;border-radius:50%;margin:0 auto;background:#fff;border:2px solid var(--green);display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 5px rgba(43,104,3,.08)}.logoring img{width:76px;height:76px;border-radius:50%;object-fit:contain}.cbody{padding:34px 32px}.badge{width:62px;height:62px;display:flex;align-items:center;justify-content:center;color:#fff;background:var(--ac);margin:0 auto 18px}h1{font-size:21px;font-weight:700;text-align:center;margin-bottom:8px;letter-spacing:-.3px}.sub{text-align:center;color:#5a6b5a;font-size:14px;line-height:1.55;max-width:380px;margin:0 auto}.rows{margin-top:26px;border:1px solid #e4e9e4;border-left:3px solid var(--green)}.row{display:flex;padding:13px 16px;border-bottom:1px solid #eef1ee;font-size:14px;gap:14px;transition:background .15s}.row:last-child{border-bottom:0}.row:hover{background:#f3f8f1}.row .k{flex:0 0 118px;color:#6f8566;font-size:11px;text-transform:uppercase;letter-spacing:.7px;font-weight:600;padding-top:2px}.row .v{flex:1;font-weight:600;color:#1a2e1a;word-break:break-word}.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1px;color:var(--green)}.foot{display:flex;align-items:center;justify-content:center;gap:7px;padding:14px;background:#1a4f10;font-size:12px;font-weight:500;color:rgba(255,255,255,.95);letter-spacing:.2px}.foot svg{color:#fff}`;
    const head = (titulo, accent) => `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&display=swap" rel="stylesheet"><style>:root{--ac:${accent};--green:${orgCor}}${baseCss}</style></head><body><div class="wrap"><div class="card"><div class="logo">${logoHtml}</div>`;
    const foot = `<div class="foot"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="1"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>Verificación de autenticidad · ${orgNome}</div></div></div></body></html>`;
    if (!cert) {
      const iconX = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
      return res.send(`${head('Certificado inválido', '#c0392b')}<div class="cbody"><div class="badge">${iconX}</div><h1>Certificado no encontrado</h1><p class="sub">El código ingresado no corresponde a ningún certificado emitido por ${orgNome}. Verifique que lo haya escrito correctamente.</p></div>${foot}`);
    }
    const dt = cert.data_inicio ? new Date(cert.data_inicio).toLocaleDateString('es-PY', {day:'2-digit',month:'long',year:'numeric'}) : '\u2014';
    const emitidoEm = cert.emitido_em ? new Date(cert.emitido_em).toLocaleDateString('es-PY') : '\u2014';
    const iconCheck = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    res.send(`${head('Certificado válido', orgCor)}<div class="cbody"><div class="badge">${iconCheck}</div><h1>Certificado válido</h1><p class="sub">Documento auténtico, emitido y verificado por ${orgNome}.</p><div class="rows"><div class="row"><div class="k">Participante</div><div class="v">${cert.nome}</div></div><div class="row"><div class="k">Evento</div><div class="v">${cert.evento_nome}</div></div><div class="row"><div class="k">Realizado el</div><div class="v">${dt}</div></div><div class="row"><div class="k">Emitido el</div><div class="v">${emitidoEm}</div></div><div class="row"><div class="k">Código</div><div class="v code">${req.params.codigo}</div></div></div></div>${foot}`);
  } catch(e) { res.status(500).send('Error: '+e.message); }
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
      if (insc.whatsapp && process.env.WAPP_SOMENTE_RESPOSTA !== 'true') { try { await enviarWhatsApp(insc.whatsapp,msg); enviados++; } catch(e){} }
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
        if (process.env.WAPP_SOMENTE_RESPOSTA !== 'true') await enviarWhatsApp(whatsapp, msg);
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

router.get('/arquivos', requireAuth, requirePermissao('arquivos'), async (req, res) => {
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

router.post('/cadastro-ligante', require('../services/arquivos').upload.single('foto'), async (req, res) => {
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

router.get('/ligantes', requireAuth, requirePermissao('ligantes'), async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg = [];
  const erro = req.session.erro||[]; req.session.erro = [];
  const sfL = req.query.status || 'ativos';
  let whereAtivo;
  if (sfL === 'pendente') whereAtivo = 'WHERE pendente=true';
  else if (sfL === 'inativos') whereAtivo = 'WHERE ativo=0 AND pendente=false';
  else if (sfL === 'todos') whereAtivo = 'WHERE pendente=false';
  else whereAtivo = 'WHERE ativo=1 AND pendente=false';
  const r = await query('SELECT * FROM ligantes ' + whereAtivo + ' ORDER BY nome ASC');
  const ligantes = r.rows;
  const totR = await query('SELECT COUNT(*) t FROM ligantes WHERE pendente=false');
  const atvR = await query('SELECT COUNT(*) t FROM ligantes WHERE ativo=1 AND pendente=false');
  const pcR = await query('SELECT COUNT(*) n FROM ligantes WHERE pendente=true');
  const total = parseInt(totR.rows[0].t);
  const ativos = parseInt(atvR.rows[0].t);
  const inativos = total - ativos;
  const pendentesCount = parseInt(pcR.rows[0].n);
  res.render('pages/ligantes', { config, usuario: req.session.usuario, ligantes, msg, erro, total, ativos, inativos, statusFiltro: sfL, pendentesCount });
});

router.get('/ligantes/:id/aprovar', requireAuth, requirePermissao('ligantes'), async (req, res) => {
  await query('UPDATE ligantes SET pendente=false, ativo=1 WHERE id=$1', [req.params.id]);
  await logAtividade(req.session.usuario.id, 'LIGANTE_APROTADMo', 'Ligante aprovado ID: ' + req.params.id, req);

  // AUTO-CADASTRO FINANCEIRO: ao aprovar ligante, criar membro automaticamente se nao existir
  try {
    const ligR = await query('SELECT * FROM ligantes WHERE id=$1', [req.params.id]);
    const lig = ligR.rows[0];
    if (lig) {
      const cpfVal = lig.cpf || '';
      const emailVal = lig.email || '';
      const jaExiste = await query(
        'SELECT id FROM membros WHERE (cpf IS NOT NULL AND cpf <> $3 AND cpf = $1) OR (email IS NOT NULL AND email <> $3 AND email = $2)',
        [cpfVal, emailVal, '']
      );
      if (jaExiste.rows.length === 0) {
        await query(
          'INSERT INTO membros (nome, cpf, email, whatsapp, data_nascimento, rg, catraca, dia_vencimento, mensalidade, ativo, observacoes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            lig.nome || '',
            lig.cpf || null,
            lig.email || null,
            lig.whatsapp || null,
            lig.data_nascimento || null,
            lig.rg || null,
            lig.catraca || null,
            15,
            25.00,
            1,
            'Cadastro automatico via aprovacao de ligante ID: ' + lig.id
          ]
        );
        console.log('[AUTO-MEMBRO] Criado para ligante:', lig.nome, '| ID ligante:', lig.id);
      } else {
        console.log('[AUTO-MEMBRO] Ja existe membro com CPF/email do ligante:', lig.nome, '- pulando');
      }
    }
  } catch(e) {
    console.error('[AUTO-MEMBRO] Erro ao criar membro automatico:', e.message);
  }

  req.session.msg = ['Ligante aprovado e cadastrado no financeiro automaticamente!'];
  res.redirect('/ligantes?status=pendente');
});

router.get('/ligantes/:id/excluir-pendente', requireAuth, requirePermissao('ligantes'), async (req, res) => {
  await query('DELETE FROM ligantes WHERE id=$1 AND pendente=true', [req.params.id]);
  await logAtividade(req.session.usuario.id, 'LIGANTE_RECUSADO', 'Ligante recusado ID: ' + req.params.id, req);
  req.session.msg = ['Cadastro recusado e removido.'];
  res.redirect('/ligantes?status=pendente');
});

router.post('/ligantes/:id/toggle', requireAuth, async (req, res) => {
  const r = await query('SELECT ativo, email FROM ligantes WHERE id=$1', [req.params.id]);
  const atual = r.rows[0]?.ativo;
  const novoStatus = atual == 0 ? 1 : 0;
  const motivo = req.body.motivo || null;
  await query('UPDATE ligantes SET ativo=$1 WHERE id=$2', [novoStatus, req.params.id]);
  // Sincronizar membros automaticamente ao inativar/ativar ligante
  try {
    const email = r.rows[0].email;
    const memStatus = novoStatus === 1 ? 'ativo' : 'inativo';
    if (email) await query("UPDATE membros SET ativo=$1, status=$2 WHERE email=$3", [novoStatus, memStatus, email]);
    // Fallback por CPF (cobre casos de email divergente)
    const cpfLig = r.rows[0].cpf;
    if (cpfLig) await query("UPDATE membros SET ativo=$1, status=$2 WHERE regexp_replace(cpf,'[^0-9]','','g')=regexp_replace($3,'[^0-9]','','g')", [novoStatus, memStatus, cpfLig]).catch(()=>{});
    // Fallback por nome exato (último recurso)
    const nomeLig = r.rows[0].nome;
    if (nomeLig) await query("UPDATE membros SET ativo=$1, status=$2 WHERE LOWER(TRIM(nome))=LOWER(TRIM($3))", [novoStatus, memStatus, nomeLig]).catch(()=>{});
    // Cancelar cobranças por CPF e nome também
    if (cpfLig) await query("UPDATE cobrancas SET status='cancelado' WHERE membro_id IN (SELECT id FROM membros WHERE regexp_replace(cpf,'[^0-9]','','g')=regexp_replace($1,'[^0-9]','','g')) AND status IN ('pendente','atrasado')", [cpfLig]).catch(()=>{});
  } catch(e) {}
  if (novoStatus === 0) {
    // Cancelar cobranças pendentes do membro vinculado ao email do ligante
    const ligR = await query('SELECT email FROM ligantes WHERE id=$1', [req.params.id]);
    if (ligR.rows[0]?.email) {
      await query(
        "UPDATE cobrancas SET status='cancelado' WHERE membro_id IN (SELECT id FROM membros WHERE email=$1) AND status IN ('pendente','atrasado')",
        [ligR.rows[0].email]
      );
      // Sincronizar ativo em membros (cadastro financeiro)
      await query("UPDATE membros SET ativo=$1 WHERE email=$2", [novoStatus, ligR.rows[0].email]);
    }
    // Também sincronizar por whatsapp caso email não bata
    if (ligR.rows[0]?.whatsapp) {
      await query("UPDATE membros SET ativo=$1 WHERE whatsapp=$2 AND ($3::text IS NULL OR email IS NULL OR email='')", [novoStatus, ligR.rows[0].whatsapp, ligR.rows[0].email]);
    }
    if (motivo) {
      await query('INSERT INTO inativacoes_log (tipo, referencia_id, motivo, usuario_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', ['ligante', req.params.id, motivo, req.session.usuario.id]).catch(()=>{});
    }
  }
  await logAtividade(req.session.usuario.id, 'LIGANTE_STATUS', 'Status alterado ID: ' + req.params.id + (motivo ? ' — ' + motivo : ''), req);
  req.session.msg = [novoStatus == 1 ? 'Ligante reativado! Cadastro financeiro sincronizado.' : 'Ligante inativado, cobranças canceladas e cadastro financeiro atualizado!'];
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

router.get('/ligantes/:id/editar', requireAuth, requirePermissao('ligantes'), async (req, res) => {
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
router.get('/ligantes/relatorio', requireAuth, requirePermissao('ligantes'), async (req, res) => {
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

// === RELATORIO DIRETIVOS ===
router.get('/diretivos/relatorio', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const q = req.query;
  const filtros = { status: q.status||'todos', cargo: q.cargo||'todos', semestre_turma: q.semestre_turma||'todos', ordem: q.ordem||'nome', colunas: q.colunas ? (Array.isArray(q.colunas) ? q.colunas : [q.colunas]) : ['nome','email','cargo','semestre_turma','whatsapp','status'] };
  let where = [];
  if (filtros.status === 'ativo') where.push("ativo = 1");
  if (filtros.status === 'inativo') where.push("ativo = 0");
  if (filtros.cargo !== 'todos') where.push(`cargo = '${filtros.cargo.replace(/'/g,"''")}'`);
  if (filtros.semestre_turma !== 'todos') where.push(`semestre_turma = '${filtros.semestre_turma.replace(/'/g,"''")}'`);
  const ordens = { nome:'nome ASC', nome_desc:'nome DESC', cargo:'cargo ASC', semestre_turma:'semestre_turma ASC', cadastrado_em:'cadastrado_em DESC' };
  const orderBy = ordens[filtros.ordem] || 'nome ASC';
  const sql = `SELECT * FROM diretivos ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy}`;
  const [r, cargosR, semestresR] = await Promise.all([
    query(sql),
    query("SELECT DISTINCT cargo FROM diretivos WHERE cargo IS NOT NULL AND cargo <> '' ORDER BY cargo"),
    query("SELECT DISTINCT semestre_turma FROM diretivos WHERE semestre_turma IS NOT NULL AND semestre_turma <> '' ORDER BY semestre_turma")
  ]);
  const labelColuna = (col) => ({nome:'Nome',email:'E-mail',whatsapp:'WhatsApp',instagram:'Instagram',cargo:'Cargo',semestre_turma:'Semestre/Turma',catraca:'Catraca',rg:'RG/CI',cpf:'CPF',data_nascimento:'Nascimento',ano_ingresso:'Ano ingresso',orcid:'ORCID',status:'Status',cadastrado_em:'Cadastro'}[col] || col);
  res.render('pages/diretivos-relatorio', { config, usuario: req.session.usuario, diretivos: r.rows, filtros, cargos: cargosR.rows.map(x=>x.cargo).filter(Boolean), semestresTurmas: semestresR.rows.map(x=>x.semestre_turma).filter(Boolean), colunasVisiveis: filtros.colunas, labelColuna, msg: req.session.msg||[], erro: req.session.erro||[] });
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
  const presidSrc = config.assinatura_presidente_b64 || null;
  const secretSrc = config.assinatura_secretario_b64 || null;
  const nomePresidente = (config.presidente_nome || 'PRESIDENTE').toUpperCase();
  const nomeSecretario = (config.secretario_nome || 'SECRETARIO(A)').toUpperCase();
  const d = new Date(carta.data || new Date());
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const dataStr = d.getDate() + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear();
  const mesRef = carta.mes_referencia || '___________';
  const venc = carta.vencimento ? new Date(carta.vencimento).toLocaleDateString('es-PY') : '___________';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Times New Roman',serif;font-size:11pt;color:#000}.pagina{width:210mm;height:297mm;position:relative;overflow:hidden}.bg{position:absolute;top:0;left:0;width:210mm;height:297mm;z-index:0}.bg img{width:210mm;height:297mm;display:block}.texto{position:absolute;top:52mm;left:22mm;width:166mm;height:203mm;z-index:1;display:flex;flex-direction:column}.titulo{font-size:13pt;font-weight:bold;text-align:center;margin-bottom:6px;text-transform:uppercase}.subtitulo{font-size:11pt;font-weight:bold;text-align:center;margin-bottom:14px;text-transform:uppercase}.corpo{text-align:justify;line-height:1.55;flex:1}.corpo p{margin-bottom:8px}.assinaturas{display:flex;flex-direction:column;gap:10px;align-items:center;margin-top:10px}.assinatura-bloco{text-align:center;width:70%}.assinatura-img-wrap{height:50px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:3px}.assinatura-img{max-height:50px;max-width:130px;object-fit:contain}.linha{border-top:1.5px solid #000;width:90%;margin:0 auto 3px}.assinatura-nome{font-weight:bold;font-size:8.5pt;text-transform:uppercase}.assinatura-cargo{font-size:8pt;margin-top:2px}</style></head><body><div class="pagina"><div class="bg">${timbrado?`<img src="${timbrado}">`:''}</div><div class="texto"><div class="titulo">Carta de Cobro — LAURO</div><div class="subtitulo">Pago Mensual Vencido</div><div style="text-align:right;font-size:9pt;color:#555;margin-bottom:8px">N° ${carta.numero_carta ? String(carta.numero_carta).padStart(4,'0') : '----'}</div><div class="corpo"><p>Ciudad del Este/PY, ${dataStr}.</p><p>Estimado/a señor/a <strong>${pessoa.nome||'___________'}</strong>,</p><p>Esperamos que este mensaje le encuentre bien.</p><p>Nos ponemos en contacto con usted en nombre de LAURO – Liga Académica de Urología para recordarle que su cuota de membresía está vencida. Como ya le informamos, las cuotas de membresía vencen el día 15 de cada mes.</p><p>Hasta la fecha, no hemos recibido el pago de la cuota mensual correspondiente al mes de <strong>${mesRef}</strong>, cuyo vencimiento fue el <strong>${venc}</strong>. Solicitamos amablemente que se abone la deuda lo antes posible para evitar cualquier restricción en la participación en las actividades de la Liga.</p><p>Si ya ha realizado el pago, ignore este mensaje o, si es posible, envíenos el comprobante de pago para su verificación.</p><p>Estamos a su disposición para responder cualquier pregunta o proporcionar aclaraciones.</p><p style='margin-top:10px;font-style:italic;font-size:10pt'><strong>Esta es su ${ordinalEspanhol(carta.numero_ordinal||1)} notificacion oficial</strong> emitida por LAURO – Liga Academica de Urologia.</p><p>Atentamente,</p></div><div class="assinaturas"><div class="assinatura-bloco"><div class="assinatura-img-wrap">${financeiroSrc?`<img src="${financeiroSrc}" class="assinatura-img">`:''}</div><div class="linha"></div><div class="assinatura-nome">${nomeFinanceiro}</div><div class="assinatura-cargo">Director(a) Financiero(a)<br>LAURO – Liga Académica de Urología</div></div></div></div></div></body></html>`;
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

router.get('/carta-cobranca', requireAuth, requirePermissao('carta-cobranca'), async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const [cartasR, membrosR, ligantesR] = await Promise.all([
    query(`SELECT c.*, COALESCE(m.nome,l.nome) AS pessoa_nome, COALESCE(m.email,l.email) AS pessoa_email,
      (CASE
        WHEN c.membro_id IS NOT NULL THEN (
          (SELECT COUNT(*) FROM cartas_notificacao WHERE membro_id=c.membro_id) +
          (SELECT COUNT(*) FROM cartas_cobranca WHERE membro_id=c.membro_id)
        )
        WHEN c.ligante_id IS NOT NULL THEN (
          (SELECT COUNT(*) FROM cartas_notificacao WHERE ligante_id=c.ligante_id) +
          (SELECT COUNT(*) FROM cartas_cobranca WHERE ligante_id=c.ligante_id)
        )
        ELSE 0
      END) AS total_notif_pessoa
    FROM cartas_cobranca c
    LEFT JOIN membros m ON m.id=c.membro_id
    LEFT JOIN ligantes l ON l.id=c.ligante_id
    ORDER BY c.criado_em DESC`),
    query('SELECT id,nome,email FROM membros WHERE ativo=1 ORDER BY nome'),
    query('SELECT id,nome,email FROM ligantes WHERE ativo=1 ORDER BY nome')
  ]);
  res.render('pages/carta-cobranca', { config, usuario: req.session.usuario, msg, erro, cartas: cartasR.rows, membros: membrosR.rows, ligantes: ligantesR.rows });
});

router.post('/carta-cobranca', requireAuth, async (req, res) => {
  const { membro_id, ligante_id, mes_referencia, vencimento } = req.body;
  const mid = membro_id && membro_id !== '' ? parseInt(membro_id) : null;
  const lid = ligante_id && ligante_id !== '' ? parseInt(ligante_id) : null;
  const numCob = (await query("SELECT nextval('seq_numero_carta') n")).rows[0].n;
  const ordCob = await calcularOrdinalPessoa(mid,lid,null);
  await query('INSERT INTO cartas_cobranca (membro_id,ligante_id,mes_referencia,vencimento,criado_por,numero_carta,numero_ordinal) VALUES ($1,$2,$3,$4,$5,$6,$7)', [mid,lid,mes_referencia,vencimento||null,req.session.usuario.id,numCob,ordCob]);
  req.session.msg = ['Carta criada!']; res.redirect('/carta-cobranca');
});

router.get('/carta-cobranca/:id/visualizar', requireAuth, requirePermissao('carta-cobranca'), async (req, res) => {
  try {
    const r = await query('SELECT * FROM cartas_cobranca WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).send('Nao encontrado');
    const config = await prepararConfigCobranca(await getConfig());
    res.send(gerarHTMLCartaCobranca(await buscarPessoaCarta(r.rows[0]), config, r.rows[0]));
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});

router.get('/carta-cobranca/:id/imprimir', requireAuth, requirePermissao('carta-cobranca'), async (req, res) => {
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


// ─── CARTA DE NOTIFICACAO ──────────────────────────────────────────────────────

function ordinalEspanhol(n) {
  const map = ['Primera','Segunda','Tercera','Cuarta','Quinta','Sexta','Septima','Octava','Novena','Decima'];
  return n <= 10 ? map[n-1] : n + 'a';
}

function substituirPlaceholderOrdinal(texto, ordinal) {
  // Substitui qualquer variacao do placeholder pelo ordinal real
  // Ex: [Primera / Segunda], [primera/segunda], {ordinal}, [N], etc.
  const ord = ordinalEspanhol(ordinal);
  return texto
    .replace(/\[Primera\s*\/\s*Segunda\]/gi, ord)
    .replace(/\[primera\s*\/\s*segunda\]/gi, ord)
    .replace(/\[Primera\s*\/\s*Segunda\s*\/\s*Tercera[^\]]*\]/gi, ord)
    .replace(/\{ordinal\}/gi, ord)
    .replace(/\{notificacion\}/gi, ord)
    .replace(/\[N[°ºo]?\s*notificac[aã][oõ][^\]]*\]/gi, ord)
    .replace(/\[\s*ordinal\s*\]/gi, ord);
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



function gerarHTMLCartaNotificacao(pessoa, config, carta) {
  const timbrado = config.timbrado_b64 || null;
  const presidSrc = config.assinatura_presidente_b64 || null;
  const secretSrc = config.assinatura_secretario_b64 || null;
  const nomePresidente = (config.presidente_nome || 'PRESIDENTE').toUpperCase();
  const nomeSecretario = (config.secretario_nome || 'SECRETARIO(A)').toUpperCase();
  const d = new Date(carta.criado_em || new Date());
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const dataStr = d.getDate() + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear();
  const textoLivre = (carta.texto_livre || '').replace(/\n/g, '</p><p>');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Times New Roman',serif;font-size:11pt;color:#000}.pagina{width:210mm;height:297mm;position:relative;overflow:hidden}.bg{position:absolute;top:0;left:0;width:210mm;height:297mm;z-index:0}.bg img{width:210mm;height:297mm;display:block}.texto{position:absolute;top:52mm;left:22mm;width:166mm;height:203mm;z-index:1;display:flex;flex-direction:column}.titulo{font-size:13pt;font-weight:bold;text-align:center;margin-bottom:6px;text-transform:uppercase}.subtitulo{font-size:11pt;font-weight:bold;text-align:center;margin-bottom:14px;text-transform:uppercase}.corpo{text-align:justify;line-height:1.55;flex:1}.corpo p{margin-bottom:8px}.assinaturas{display:flex;flex-direction:column;gap:10px;align-items:center;margin-top:10px}.assinatura-bloco{text-align:center;width:70%}.assinatura-img-wrap{height:50px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:3px}.assinatura-img{max-height:50px;max-width:130px;object-fit:contain}.linha{border-top:1.5px solid #000;width:90%;margin:0 auto 3px}.assinatura-nome{font-weight:bold;font-size:8.5pt;text-transform:uppercase}.assinatura-cargo{font-size:8pt;margin-top:2px}</style></head><body><div class="pagina"><div class="bg">${timbrado?`<img src="${timbrado}">`:''}</div><div class="texto"><div class="titulo">Carta de Notificacion - LAURO</div><div class="subtitulo">Liga Academica de Urologia | UCP | Ciudad del Este</div><div style="text-align:right;font-size:9pt;color:#555;margin-bottom:8px">N° ${carta.numero_carta ? String(carta.numero_carta).padStart(4,'0') : '----'}</div><div class="corpo"><p>Ciudad del Este/PY, ${dataStr}.</p><p>Estimado/a senor/a <strong>${pessoa.nome||'___________'}</strong>,</p><p>${textoLivre}</p><p style='margin-top:10px;font-style:italic;font-size:10pt'><strong>Esta es su ${ordinalEspanhol(carta.numero_ordinal||1)} notificacion oficial</strong> emitida por LAURO – Liga Academica de Urologia.</p><p>Atentamente,</p></div><div class="assinaturas" style="display:flex;flex-direction:row;justify-content:space-around;gap:16px;margin-top:14px"><div class="assinatura-bloco" style="text-align:center;flex:1"><div class="assinatura-img-wrap" style="height:50px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:3px">${presidSrc?`<img src="${presidSrc}" style="max-height:50px;max-width:130px;object-fit:contain">`:''}</div><div style="border-top:1.5px solid #000;width:90%;margin:0 auto 3px"></div><div style="font-weight:bold;font-size:8.5pt;text-transform:uppercase">${nomePresidente}</div><div style="font-size:8pt;margin-top:2px">Presidente<br>LAURO – Liga Academica de Urologia</div></div><div class="assinatura-bloco" style="text-align:center;flex:1"><div class="assinatura-img-wrap" style="height:50px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:3px">${secretSrc?`<img src="${secretSrc}" style="max-height:50px;max-width:130px;object-fit:contain">`:''}</div><div style="border-top:1.5px solid #000;width:90%;margin:0 auto 3px"></div><div style="font-weight:bold;font-size:8.5pt;text-transform:uppercase">${nomeSecretario}</div><div style="font-size:8pt;margin-top:2px">Secretario(a)<br>LAURO – Liga Academica de Urologia</div></div></div></div></div></body></html>`;
}

async function prepararConfigNotificacao(config) {
  const { imagemBase64 } = require('../services/desligamento');
  config.timbrado_b64 = await imagemBase64(config.timbrado_chave);
  config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
  config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
  return config;
}

async function buscarPessoaNotificacao(carta) {
  let pessoa = {};
  if (carta.membro_id)        { const r = await query('SELECT * FROM membros WHERE id=$1',  [carta.membro_id]);   pessoa=r.rows[0]||{}; }
  else if (carta.ligante_id)  { const r = await query('SELECT * FROM ligantes WHERE id=$1', [carta.ligante_id]);  pessoa=r.rows[0]||{}; }
  else if (carta.diretivo_id) { const r = await query('SELECT * FROM diretivos WHERE id=$1',[carta.diretivo_id]); pessoa=r.rows[0]||{}; }
  return pessoa;
}

router.get('/carta-notificacao', requireAuth, requirePermissao('carta-notificacao'), async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];

  // Filtros via query string
  const filtroStatus = req.query.status || 'todos';       // todos | pendente | enviado
  const filtroTipo   = req.query.tipo   || 'todos';       // todos | membro | ligante | diretivo
  const filtroNotif  = req.query.notif  || 'todos';       // todos | 1 | 2 | 3plus
  const filtroBusca  = req.query.busca  || '';

  // Construir WHERE dinamico
  const wheres = [];
  const params = [];
  let pi = 1;

  if (filtroStatus !== 'todos') {
    wheres.push(`cn.status=$${pi++}`); params.push(filtroStatus);
  }
  if (filtroTipo === 'membro')   { wheres.push('cn.membro_id IS NOT NULL'); }
  if (filtroTipo === 'ligante')  { wheres.push('cn.ligante_id IS NOT NULL'); }
  if (filtroTipo === 'diretivo') { wheres.push('cn.diretivo_id IS NOT NULL'); }
  if (filtroBusca) {
    wheres.push(`LOWER(COALESCE(m.nome,l.nome,d.nome,'')) LIKE $${pi++}`);
    params.push('%' + filtroBusca.toLowerCase() + '%');
  }

  const whereClause = wheres.length > 0 ? 'WHERE ' + wheres.join(' AND ') : '';

  // Filtro por numero de notificacoes (aplicado apos subquery)
  let havingClause = '';
  if (filtroNotif === '1') havingClause = 'HAVING total_notif_pessoa = 1';
  else if (filtroNotif === '2') havingClause = 'HAVING total_notif_pessoa = 2';
  else if (filtroNotif === '3plus') havingClause = 'HAVING total_notif_pessoa >= 3';

  const sqlCartas = `
    SELECT * FROM (
      SELECT cn.*, COALESCE(m.nome,l.nome,d.nome) AS pessoa_nome, COALESCE(m.email,l.email,d.email) AS pessoa_email,
        (CASE
          WHEN cn.membro_id IS NOT NULL THEN (
            (SELECT COUNT(*) FROM cartas_notificacao WHERE membro_id=cn.membro_id) +
            (SELECT COUNT(*) FROM cartas_cobranca WHERE membro_id=cn.membro_id)
          )
          WHEN cn.ligante_id IS NOT NULL THEN (
            (SELECT COUNT(*) FROM cartas_notificacao WHERE ligante_id=cn.ligante_id) +
            (SELECT COUNT(*) FROM cartas_cobranca WHERE ligante_id=cn.ligante_id)
          )
          WHEN cn.diretivo_id IS NOT NULL THEN (
            (SELECT COUNT(*) FROM cartas_notificacao WHERE diretivo_id=cn.diretivo_id)
          )
          ELSE 0
        END) AS total_notif_pessoa
      FROM cartas_notificacao cn
      LEFT JOIN membros m ON m.id=cn.membro_id
      LEFT JOIN ligantes l ON l.id=cn.ligante_id
      LEFT JOIN diretivos d ON d.id=cn.diretivo_id
      ${whereClause}
    ) sub
    ${havingClause}
    ORDER BY criado_em DESC`;

  const [cartasR, membrosR, ligantesR, diretivosR] = await Promise.all([
    query(sqlCartas, params),
    query('SELECT id,nome,email FROM membros WHERE ativo=1 ORDER BY nome'),
    query('SELECT id,nome,email FROM ligantes WHERE ativo=1 ORDER BY nome'),
    query('SELECT id,nome,email FROM diretivos WHERE ativo=1 ORDER BY nome')
  ]);

  res.render('pages/carta-notificacao', {
    config, usuario: req.session.usuario, msg, erro,
    cartas: cartasR.rows, membros: membrosR.rows, ligantes: ligantesR.rows, diretivos: diretivosR.rows,
    filtroStatus, filtroTipo, filtroNotif, filtroBusca
  });
});

router.post('/carta-notificacao', requireAuth, async (req, res) => {
  const { tipo_dest, membro_id, ligante_id, diretivo_id, texto_livre } = req.body;
  const mid = (tipo_dest==='membro'   && membro_id   && membro_id!=='')   ? parseInt(membro_id)   : null;
  const lid = (tipo_dest==='ligante'  && ligante_id  && ligante_id!=='')  ? parseInt(ligante_id)  : null;
  const did = (tipo_dest==='diretivo' && diretivo_id && diretivo_id!=='') ? parseInt(diretivo_id) : null;
  const numNot = (await query("SELECT nextval('seq_numero_carta') n")).rows[0].n;
  const ordNot = await calcularOrdinalPessoa(mid,lid,did);
  const textoFinal = substituirPlaceholderOrdinal(texto_livre||'', ordNot);
  await query('INSERT INTO cartas_notificacao (membro_id,ligante_id,diretivo_id,texto_livre,criado_por,numero_carta,numero_ordinal) VALUES ($1,$2,$3,$4,$5,$6,$7)', [mid,lid,did,textoFinal,req.session.usuario.id,numNot,ordNot]);
  req.session.msg = ['Carta de notificacao criada!']; res.redirect('/carta-notificacao');
});

router.get('/carta-notificacao/:id/visualizar', requireAuth, requirePermissao('carta-notificacao'), async (req, res) => {
  try {
    const r = await query('SELECT * FROM cartas_notificacao WHERE id=$1',[req.params.id]);
    if (!r.rows[0]) return res.status(404).send('Nao encontrado');
    const config = await prepararConfigNotificacao(await getConfig());
    res.send(gerarHTMLCartaNotificacao(await buscarPessoaNotificacao(r.rows[0]), config, r.rows[0]));
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});

router.get('/carta-notificacao/:id/imprimir', requireAuth, requirePermissao('carta-notificacao'), async (req, res) => {
  try {
    const r = await query('SELECT * FROM cartas_notificacao WHERE id=$1',[req.params.id]);
    if (!r.rows[0]) return res.status(404).send('Nao encontrado');
    const config = await prepararConfigNotificacao(await getConfig());
    let html = gerarHTMLCartaNotificacao(await buscarPessoaNotificacao(r.rows[0]), config, r.rows[0]);
    html = html.replace('</body>','<script>window.onload=function(){window.print()}<\/script></body>');
    res.send(html);
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});

async function enviarCartaNotificacao(id, req, res, reenvio) {
  req.setTimeout && req.setTimeout(120000);
  res.setTimeout && res.setTimeout(120000);
  try {
    const r = await query('SELECT * FROM cartas_notificacao WHERE id=$1',[id]);
    if (!r.rows[0]) { req.session.erro=['Nao encontrado.']; return res.redirect('/carta-notificacao'); }
    const pessoa = await buscarPessoaNotificacao(r.rows[0]);
    if (!pessoa.email) { req.session.erro=['Email nao cadastrado para este destinatario.']; return res.redirect('/carta-notificacao'); }
    const config = await prepararConfigNotificacao(await getConfig());
    const htmlCarta = gerarHTMLCartaNotificacao(pessoa, config, r.rows[0]);
    const pdfBuffer = await gerarPDFBuffer(htmlCarta, config.timbrado_b64, config.assinatura_financeiro_b64, config.financeiro_nome||'DIRECTOR(A) FINANCIERO(A)', 'Director(a) Financiero(a)\nLAURO - Liga Academica de Urologia');
    await enviarEmail({
      from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>',
      to: pessoa.email,
      subject: 'Carta de Notificacion - LAURO'+(reenvio?' (Reenvio)':''),
      html: emailBonito('Carta de Notificacion'+(reenvio?' (Reenvio)':''),'<p>Estimado(a) <strong>'+pessoa.nome+'</strong>,</p><p>Adjunto encontrara su <strong>Carta de Notificacion</strong> de LAURO.</p><p>Atentamente,<br><strong>Direccion - LAURO</strong></p>'),
      attachments: [{filename:'carta-notificacion-LAURO.pdf',content:pdfBuffer.toString('base64')}]
    });
    await query("UPDATE cartas_notificacao SET status='enviado', enviado_em=NOW() WHERE id=$1",[id]);
    req.session.msg=['Email enviado para '+pessoa.email+'!']; res.redirect('/carta-notificacao');
  } catch(e) { req.session.erro=['Erro: '+e.message]; res.redirect('/carta-notificacao'); }
}

router.post('/carta-notificacao/:id/editar', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT status FROM cartas_notificacao WHERE id=$1',[req.params.id]);
    if (!r.rows[0]) { req.session.erro=['Carta nao encontrada.']; return res.redirect('/carta-notificacao'); }
    if (r.rows[0].status === 'enviado') { req.session.erro=['Nao e possivel editar uma carta ja enviada.']; return res.redirect('/carta-notificacao'); }
    const { texto_livre } = req.body;
    const r2 = await query('SELECT numero_ordinal FROM cartas_notificacao WHERE id=$1',[req.params.id]);
    const ordEdit = parseInt(r2.rows[0]?.numero_ordinal||1);
    const textoEditado = substituirPlaceholderOrdinal(texto_livre||'', ordEdit);
    await query('UPDATE cartas_notificacao SET texto_livre=$1 WHERE id=$2 AND status=$3',[textoEditado,req.params.id,'pendente']);
    req.session.msg=['Carta atualizada com sucesso!']; res.redirect('/carta-notificacao');
  } catch(e) { req.session.erro=['Erro: '+e.message]; res.redirect('/carta-notificacao'); }
});

router.post('/carta-notificacao/:id/enviar',   requireAuth, (req,res) => enviarCartaNotificacao(req.params.id,req,res,false));
router.post('/carta-notificacao/:id/reenviar', requireAuth, (req,res) => enviarCartaNotificacao(req.params.id,req,res,true));
router.post('/carta-notificacao/:id/deletar',  requireAuth, async (req,res) => {
  await query('DELETE FROM cartas_notificacao WHERE id=$1',[req.params.id]);
  req.session.msg=['Carta excluida!']; res.redirect('/carta-notificacao');
});


// ─── LISTA DE ASSINATURAS ─────────────────────────────────────────────────────

router.get('/lista-assinaturas', requireAuth, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const r = await query('SELECT * FROM listas_assinaturas ORDER BY data_evento DESC NULLS LAST, criado_em DESC');
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


router.post('/lista-assinaturas/:id/editar', requireAuth, async (req, res) => {
  try {
    const { nome, data_evento } = req.body;
    await query('UPDATE listas_assinaturas SET nome=$1, data_evento=$2 WHERE id=$3',
      [nome, data_evento||null, req.params.id]);
    req.session.msg=['Lista atualizada!'];
  } catch(e) { req.session.erro=['Erro: '+e.message]; }
  res.redirect('/lista-assinaturas');
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

router.get('/marketing', requireAuth, requirePermissao('marketing'), async (req, res) => {
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

router.get('/marketing/midias/:id/img', requireAuth, requirePermissao('marketing'), async (req, res) => {
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
  const cuponsR = await query('SELECT ec.*, ec.criado_em AS cupom_criado_em, ei.nome AS usado_nome, ei.criado_em AS usado_em, COALESCE(l.nome, d.nome, mb.nome) AS dono_nome FROM evento_cupons ec LEFT JOIN evento_inscricoes ei ON ei.id = ec.usado_por_inscricao_id LEFT JOIN ligantes l ON ec.ligante_id = l.id LEFT JOIN diretivos d ON ec.diretivo_id = d.id LEFT JOIN membros mb ON ec.membro_id = mb.id WHERE ec.evento_id=$1 ORDER BY ec.criado_em DESC',[req.params.id]);
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
      query(`SELECT e.*, (SELECT COUNT(*) FROM evento_inscricoes WHERE evento_id=e.id) as total_inscritos FROM eventos e WHERE id=$1`,[req.params.id]),
      query('SELECT l.*, (SELECT COUNT(*) FROM evento_inscricoes WHERE lote_id=l.id) as inscritos FROM evento_lotes l WHERE l.evento_id=$1 ORDER BY l.ordem',[req.params.id])
    ]);
    // Evento não existe de fato
    if (!evR.rows[0]) return res.status(404).send('Evento não encontrado.');
    const _eventoEncerrado = evR.rows[0].status !== 'ativo';
    const camposR = await query('SELECT * FROM evento_campos WHERE evento_id=$1 ORDER BY ordem',[req.params.id]);
    const [progPubR, palesPubR, patrocPubR] = await Promise.all([
      query('SELECT * FROM evento_programacao WHERE evento_id=$1 ORDER BY ordem',[req.params.id]),
      query('SELECT * FROM evento_palestrantes WHERE evento_id=$1 ORDER BY ordem',[req.params.id]),
      query('SELECT * FROM evento_patrocinadores WHERE evento_id=$1 ORDER BY ordem',[req.params.id])
    ]);
    const cfgPub = await getConfig();
    const cupomUrl = req.query.cupom ? req.query.cupom.toUpperCase() : null;
    res.render('pages/evento-inscricao-publica', { evento: evR.rows[0], lotes: lotesR.rows, sucesso: false, qrcode: null, campos: camposR.rows, codigoInscricao: null, config: cfgPub, programacao: progPubR.rows, palestrantes: palesPubR.rows, patrocinadores: patrocPubR.rows, pixData: null, cupomUrl, encerrado: _eventoEncerrado });
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
    const _defConfEs = '<p>Estimado/a <strong>{nombre}</strong>,</p><p>Confirmamos su inscripción al evento <strong>{evento}</strong>.</p><p>Próximamente recibirá un correo electrónico con toda la información del evento, incluyendo:</p><ul><li>Fecha y hora</li><li>Lugar</li><li>Instrucciones importantes para la participación</li></ul><p>Le recomendamos prestar atención a las instrucciones y ser puntual el día del evento. También le recomendamos unirse al grupo de WhatsApp del evento para recibir toda la información y mantenerse al día con las indicaciones del equipo organizador.</p><p>Si tiene alguna pregunta, no dude en contactarnos.</p><p>Atentamente,<br>Comité Organizador<br>Liga Académica de Urología – LAURO</p>';
    var _corpoConf = (textoExtra && textoExtra.replace(/<[^>]*>/g,'').trim().length) ? textoExtra : _defConfEs;
    _corpoConf = _corpoConf.split('{nombre}').join((insc.nome||'').split(' ')[0]).split('{evento}').join(insc.evento_nome||'');
    const dataStr = insc.data_inicio ? new Date(insc.data_inicio).toLocaleDateString('pt-BR', {day:'2-digit',month:'long',year:'numeric',timeZone:'UTC'}) : '';
    const logoHtml = orgLogo ? '<img src="'+orgLogo+'" alt="'+orgNome+'" style="width:72px;height:72px;border-radius:50%;object-fit:contain;display:block;margin:0 auto">' : '<span style="color:white;font-size:20px;font-weight:800">'+orgNome+'</span>';
    const wppBtn = insc.wpp_grupo ? '<a href="'+insc.wpp_grupo+'" style="display:inline-block;background:#25d366;color:white;padding:12px 32px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.5px;text-transform:uppercase"><img src="https://sistema.lauroucpcde.com/img/whatsapp-white.svg" width="18" height="18" style="vertical-align:middle;margin-right:8px;display:inline" alt="">Unirse al grupo del evento</a>' : '';
    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f1f5f9"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">'
      +'<tr><td style="background:linear-gradient(160deg,'+cor+' 0%,'+corEsc+' 100%);border-radius:12px 12px 0 0;padding:36px 40px;text-align:center">'+logoHtml+'<div style="margin-top:14px;display:inline-block;background:rgba(255,255,255,0.15);border-radius:4px;padding:4px 16px"><span style="color:rgba(255,255,255,0.9);font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase">INSCRIPCIÓN CONFIRMADA</span></div></td></tr>'
      +'<tr><td style="background:white;padding:36px 40px"><div style="border-left:3px solid '+cor+';padding-left:14px;margin-bottom:24px"><p style="margin:0;font-size:11px;font-weight:700;color:'+cor+';letter-spacing:1.5px;text-transform:uppercase">CONFIRMACIÓN DE INSCRIPCIÓN</p><h2 style="margin:4px 0 0;font-size:20px;font-weight:700;color:#0f172a">'+insc.evento_nome+'</h2></div>'
      +_corpoConf
      +(wppBtn?'<div style="text-align:center;padding-bottom:24px">'+wppBtn+'</div>':'')
      +'<div style="text-align:center;margin:24px 0;padding:24px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0">'
      +'<p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px">Su código QR de check-in</p>'
      +'<img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data='+encodeURIComponent(insc.qrcode||insc.id)+'" style="width:160px;height:160px;border-radius:8px" alt="QR Code">'
      +'<p style="margin:12px 0 0;font-size:11px;color:#94a3b8">Presente este código QR en la entrada del evento</p>'
      +'<p style="margin:6px 0 0;font-size:12px;font-family:monospace;color:#475569;font-weight:600">'+insc.qrcode+'</p>'
      +'</div>'
      +'</td></tr><tr><td style="background:#0f172a;border-radius:0 0 12px 12px;padding:24px 40px"><table width="100%" cellpadding="0" cellspacing="0"><tr><td><p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;font-weight:600">'+orgNome+'</p><p style="margin:4px 0 0;color:rgba(255,255,255,0.4);font-size:10px">¿Dudas? Responda este correo.</p></td><td align="right"><p style="margin:0;color:rgba(255,255,255,0.3);font-size:9px;letter-spacing:1.5px;text-transform:uppercase">Powered by PagBank</p></td></tr></table></td></tr>'
      +'</table></td></tr></table></body></html>';
    await enviarEmail({ from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>', to: insc.email, subject: 'Inscripción confirmada — ' + insc.evento_nome, html });
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
  try {
    const iid=req.params.iid;
    await query('DELETE FROM evento_pagamentos WHERE inscricao_id=$1',[iid]);
    await query('DELETE FROM evento_certificados WHERE inscricao_id=$1',[iid]);
    await query('DELETE FROM evento_inscricoes WHERE id=$1',[iid]);
    req.session.msg=['Inscrição excluída com sucesso!'];
  } catch(e) { req.session.erro=['Erro ao excluir: '+e.message]; }
  res.redirect('/eventos/'+req.params.id+'?tab=inscritos');
  // Notificar lista de espera em background (sem bloquear resposta)
  setImmediate(async () => {
    try {
      const evR = await query('SELECT * FROM eventos WHERE id=$1',[req.params.id]);
      const ev = evR.rows[0];
      const espR = await query('SELECT * FROM evento_lista_espera WHERE evento_id=$1 AND notificado=false ORDER BY criado_em ASC LIMIT 1',[req.params.id]);
      if (espR.rows[0] && ev) {
        const esp = espR.rows[0];
        const {enviarWhatsApp} = require('../services/notificacoes');
        const config = await getConfig();
        const appUrl = process.env.APP_URL||'https://sistema.lauroucpcde.com';
        const msg = (config.org_nome||'LAURO')+'\n\n*Vaga disponível!*\n\nOlá, *'+esp.nome.split(' ')[0]+'*! Uma vaga abriu no evento *'+ev.nome+'*.\n\nAcesse agora para garantir sua vaga:\n'+appUrl+'/inscricao/'+ev.id;
        if (esp.whatsapp && process.env.WAPP_SOMENTE_RESPOSTA !== 'true') await enviarWhatsApp(esp.whatsapp, msg);
        await query('UPDATE evento_lista_espera SET notificado=true, notificado_em=NOW() WHERE id=$1',[esp.id]);
      }
    } catch(e) {}
  });
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

router.post('/eventos/:id/inscricoes/:iid/reenviar-email', requireAuth, async (req, res) => {
  try {
    await enviarEmailConfirmacaoEvento(req.params.iid);
    req.session.msg = ['E-mail de confirmação reenviado com sucesso!'];
  } catch(e) {
    req.session.erro = ['Erro ao reenviar e-mail: ' + e.message];
  }
  res.redirect('/eventos/' + req.params.id + '?tab=inscritos');
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
    const orgLogo = config.org_logo||null;
    const dataEv = ev.data_inicio?new Date(ev.data_inicio).toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}):'';
    const confirmados = inscritos.filter(i=>i.status==='confirmado').length;
    const checkins = inscritos.filter(i=>i.checkin_em).length;
    let bruto=0, taxas=0;
    pagamentos.forEach(p=>{
      const v=Number(p.valor)||0; bruto+=v;
     if(p.metodo==='pix') taxas+=v*0.018;
      else if(p.metodo==='cartao') taxas+=v*0.04;
    });
    const liquido = bruto-taxas;
    const brl = (v)=>Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const linhasInscritos = inscritos.map((i,idx)=>{
      const conf = i.status==='confirmado';
      const pillBg = conf?'#EDF6F1':'#FBF3E0';
      const pillCo = conf?'#23704F':'#C98A1E';
      return `<tr style="background:${idx%2===0?'#F6F8F5':'#ffffff'}"><td style="padding:7px 10px;font-size:10.5px;color:#74837C">${idx+1}</td><td style="padding:7px 10px;font-size:11px;font-weight:600;color:#10201A">${i.nome}</td><td style="padding:7px 10px;font-size:10.5px;color:#3A4A43">${i.email||'—'}</td><td style="padding:7px 10px;font-size:10.5px;color:#3A4A43">${i.lote_nome||'—'}</td><td style="padding:7px 10px;text-align:center"><span style="background:${pillBg};color:${pillCo};padding:2px 8px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">${i.status}</span></td><td style="padding:7px 10px;font-size:12px;text-align:center;color:${i.checkin_em?'#23704F':'#9ca3af'};font-weight:700">${i.checkin_em?'✓':'—'}</td></tr>`;
    }).join('');
    const estilos=`*{margin:0;padding:0;box-sizing:border-box}@page{size:A4;margin:0}body{font-family:'IBM Plex Sans',Arial,sans-serif;color:#10201A;-webkit-print-color-adjust:exact;print-color-adjust:exact}@media print{.np{display:none}}.wrap{max-width:820px;margin:0 auto}.header{background:linear-gradient(135deg,#103024,#0C231B);padding:26px 34px;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:14px}.logo-chip{width:54px;height:54px;background:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}.logo-chip img{width:54px;height:54px;object-fit:cover;border-radius:50%}.org{font-family:'Archivo';font-weight:800;font-size:15px;letter-spacing:.3px;line-height:1.15}.org small{display:block;font-family:'IBM Plex Mono';font-size:8.5px;letter-spacing:2px;color:#37C98B;text-transform:uppercase;margin-top:4px;font-weight:500}.ev{text-align:right}.ev .nm{font-family:'Archivo';font-size:18px;font-weight:800;line-height:1.15}.ev .dt{font-size:11.5px;color:#A9C2B6;margin-top:5px;text-transform:capitalize}.ev .lc{font-size:10.5px;color:#7E988B;margin-top:1px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:18px 34px;background:#F2F4F0;border-bottom:1px solid #E2E6E1}.stat{background:#fff;border:1px solid #E2E6E1;padding:13px 14px;position:relative;overflow:hidden}.stat::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:#2FA873}.stat .n{font-family:'Archivo';font-size:21px;font-weight:800;letter-spacing:-.5px;color:#15402F}.stat .l{font-family:'IBM Plex Mono';font-size:8.5px;color:#74837C;font-weight:500;text-transform:uppercase;letter-spacing:1px;margin-top:4px}.section{padding:20px 34px}.sec-title{font-family:'Archivo';font-size:13px;font-weight:800;letter-spacing:.2px;text-transform:uppercase;margin-bottom:12px;padding-bottom:7px;border-bottom:2px solid #2FA873;color:#10201A}.fin{border:1px solid #E2E6E1}.fin-row{display:flex;justify-content:space-between;padding:11px 16px;font-size:12.5px;border-bottom:1px solid #E2E6E1}.fin-row:last-child{border-bottom:none;background:#F6F8F5}.fin-row .lbl{color:#3A4A43}table{width:100%;border-collapse:collapse;border:1px solid #E2E6E1}thead{display:table-header-group}thead th{background:#15402F;color:#fff;padding:9px 10px;font-family:'IBM Plex Mono';font-size:9px;text-align:left;text-transform:uppercase;letter-spacing:1px;font-weight:600}tbody td{border-bottom:1px solid #EDEFEC}tbody tr{page-break-inside:avoid}.foot{padding:16px 34px;border-top:1px solid #E2E6E1;font-family:'IBM Plex Mono';font-size:9px;color:#74837C;text-transform:uppercase;letter-spacing:1px;display:flex;justify-content:space-between;gap:12px}.btn-p{position:fixed;bottom:22px;right:22px;padding:12px 22px;background:#2FA873;color:#0C231B;border:none;cursor:pointer;font-family:'IBM Plex Sans';font-size:13px;font-weight:700;box-shadow:0 8px 24px -8px rgba(47,168,115,.8)}@media print{@page{margin:14mm 0 12mm}@page :first{margin:0 0 12mm}}`;
    const html=`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet"><style>${estilos}</style></head><body>
<div class="wrap">
  <div class="header">
    <div class="brand">${orgLogo?`<div class="logo-chip"><img src="${orgLogo}" alt=""></div>`:''}<div class="org">${orgNome}<small>Relatório de Evento</small></div></div>
    <div class="ev"><div class="nm">${ev.nome}</div><div class="dt">${dataEv}</div><div class="lc">${ev.local||''}</div></div>
  </div>
  <div class="stats">
    <div class="stat"><div class="n">${inscritos.length}</div><div class="l">Inscritos</div></div>
    <div class="stat"><div class="n">${confirmados}</div><div class="l">Confirmados</div></div>
    <div class="stat"><div class="n">${checkins}</div><div class="l">Check-ins</div></div>
    <div class="stat"><div class="n">R$ ${brl(liquido)}</div><div class="l">Receita líquida</div></div>
  </div>
  <div class="section"><div class="sec-title">Resumo financeiro</div><div class="fin">
    <div class="fin-row"><span class="lbl">Receita bruta</span><span style="font-weight:700;color:#23704F">R$ ${brl(bruto)}</span></div>
    <div class="fin-row"><span class="lbl">Taxas (PIX / cartão)</span><span style="font-weight:700;color:#C0392B">− R$ ${brl(taxas)}</span></div>
    <div class="fin-row"><span class="lbl" style="font-weight:700;color:#10201A">Receita líquida</span><span style="font-family:'Archivo';font-weight:800;color:#15402F">R$ ${brl(liquido)}</span></div>
  </div></div>
  <div class="section"><div class="sec-title">Lista de inscritos (${inscritos.length})</div>
    <table><thead><tr><th style="width:34px">#</th><th>Nome</th><th>Email</th><th>Lote</th><th style="text-align:center;width:84px">Status</th><th style="text-align:center;width:66px">Check-in</th></tr></thead><tbody>${linhasInscritos}</tbody></table>
  </div>
  <div class="foot"><span>${orgNome} · Gerado em ${new Date().toLocaleString('pt-BR')}</span><span>${ev.nome}</span></div>
</div>
<button class="btn-p np" onclick="window.print()">Imprimir / Salvar PDF</button>
<script>window.onload=function(){setTimeout(function(){window.print();},500);};</script>
</body></html>`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.send(html);
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});
router.get('/eventos/:id/inscritos-pdf', requireAuth, async (req, res) => {
  try {
    const [evR, inscrR, config] = await Promise.all([
      query('SELECT * FROM eventos WHERE id=$1',[req.params.id]),
      query("SELECT * FROM evento_inscricoes WHERE evento_id=$1 ORDER BY nome",[req.params.id]),
      getConfig()
    ]);
    const ev = evR.rows[0];
    if (!ev) return res.status(404).send('Evento nao encontrado');
    const orgNome = config.org_nome||'LAURO';
    const orgLogo = config.org_logo||null;
    const dataEv = ev.data_inicio?new Date(ev.data_inicio).toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}):'';
    const fBusca = (req.query.busca||'').toString().toLowerCase().trim();
    const fStatus = (req.query.status||'').toString();
    const fTipo = (req.query.tipo||'').toString();
    const fLote = (req.query.lote||'').toString();
    let inscritos = inscrR.rows.filter(i=>{
      const nome=(i.nome||'').toLowerCase(), email=(i.email||'').toLowerCase();
      const isento = i.isento ? 'isento' : 'pagante';
      if (fBusca && !nome.includes(fBusca) && !email.includes(fBusca)) return false;
      if (fStatus && i.status !== fStatus) return false;
      if (fTipo && isento !== fTipo) return false;
      if (fLote && String(i.lote_id||'') !== fLote) return false;
      return true;
    });
    const filtros = [];
    if (fStatus) filtros.push('Status: '+fStatus);
    if (fTipo) filtros.push('Tipo: '+fTipo);
    if (fLote) filtros.push('Lote selecionado');
    if (fBusca) filtros.push('Busca: "'+fBusca+'"');
    const filtroTxt = filtros.length ? filtros.join(' · ') : 'Todos os inscritos';
    const linhas = inscritos.map((i,idx)=>{
      const st=i.status||'';
      const conf = st==='confirmado'; const canc = st==='cancelado';
      const pillBg = conf?'#EDF6F1':canc?'#FBE9E7':'#FBF3E0';
      const pillCo = conf?'#23704F':canc?'#C0392B':'#C98A1E';
      const isentoTag = i.isento ? ` <span style="background:#FBF3E0;color:#C98A1E;padding:1px 6px;font-size:8px;font-weight:700;letter-spacing:.5px">ISENTO</span>` : '';
      const chk = i.checkin_em ? new Date(i.checkin_em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—';
      return `<tr style="background:${idx%2===0?'#F6F8F5':'#ffffff'}"><td style="padding:7px 10px;font-size:10.5px;color:#74837C">${idx+1}</td><td style="padding:7px 10px;font-size:11px;font-weight:600;color:#10201A">${i.nome||''}</td><td style="padding:7px 10px;font-size:10.5px;color:#3A4A43">${i.email||'—'}</td><td style="padding:7px 10px;font-size:10.5px;color:#3A4A43">${i.lote_nome||'—'}</td><td style="padding:7px 10px;text-align:center"><span style="background:${pillBg};color:${pillCo};padding:2px 8px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">${st}</span>${isentoTag}</td><td style="padding:7px 10px;font-size:10.5px;text-align:center;color:${i.checkin_em?'#23704F':'#9ca3af'};font-weight:${i.checkin_em?'700':'400'}">${chk}</td></tr>`;
    }).join('');
    const estilos=`*{margin:0;padding:0;box-sizing:border-box}@page{size:A4;margin:0}body{font-family:'IBM Plex Sans',Arial,sans-serif;color:#10201A;-webkit-print-color-adjust:exact;print-color-adjust:exact}@media print{.np{display:none}}.wrap{max-width:820px;margin:0 auto}.header{background:linear-gradient(135deg,#103024,#0C231B);padding:26px 34px;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:14px}.logo-chip{width:54px;height:54px;background:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}.logo-chip img{width:54px;height:54px;object-fit:cover;border-radius:50%}.org{font-family:'Archivo';font-weight:800;font-size:15px;letter-spacing:.3px;line-height:1.15}.org small{display:block;font-family:'IBM Plex Mono';font-size:8.5px;letter-spacing:2px;color:#37C98B;text-transform:uppercase;margin-top:4px;font-weight:500}.ev{text-align:right}.ev .nm{font-family:'Archivo';font-size:18px;font-weight:800;line-height:1.15}.ev .dt{font-size:11.5px;color:#A9C2B6;margin-top:5px;text-transform:capitalize}.ev .lc{font-size:10.5px;color:#7E988B;margin-top:1px}.meta{padding:14px 34px;background:#F2F4F0;border-bottom:1px solid #E2E6E1;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}.meta .l{font-family:'IBM Plex Mono';font-size:9px;color:#74837C;text-transform:uppercase;letter-spacing:1px}.meta .v{font-family:'Archivo';font-size:14px;font-weight:800;color:#15402F;margin-top:3px}.section{padding:20px 34px}.sec-title{font-family:'Archivo';font-size:13px;font-weight:800;letter-spacing:.2px;text-transform:uppercase;margin-bottom:12px;padding-bottom:7px;border-bottom:2px solid #2FA873;color:#10201A}table{width:100%;border-collapse:collapse;border:1px solid #E2E6E1}thead{display:table-header-group}thead th{background:#15402F;color:#fff;padding:9px 10px;font-family:'IBM Plex Mono';font-size:9px;text-align:left;text-transform:uppercase;letter-spacing:1px;font-weight:600}tbody td{border-bottom:1px solid #EDEFEC}tbody tr{page-break-inside:avoid}.foot{padding:16px 34px;border-top:1px solid #E2E6E1;font-family:'IBM Plex Mono';font-size:9px;color:#74837C;text-transform:uppercase;letter-spacing:1px;display:flex;justify-content:space-between;gap:12px}.btn-p{position:fixed;bottom:22px;right:22px;padding:12px 22px;background:#2FA873;color:#0C231B;border:none;cursor:pointer;font-family:'IBM Plex Sans';font-size:13px;font-weight:700;box-shadow:0 8px 24px -8px rgba(47,168,115,.8)}@media print{@page{margin:14mm 0 12mm}@page :first{margin:0 0 12mm}}`;
    const html=`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet"><style>${estilos}</style></head><body>
<div class="wrap">
  <div class="header"><div class="brand">${orgLogo?`<div class="logo-chip"><img src="${orgLogo}" alt=""></div>`:''}<div class="org">${orgNome}<small>Lista de Inscritos</small></div></div><div class="ev"><div class="nm">${ev.nome}</div><div class="dt">${dataEv}</div><div class="lc">${ev.local||''}</div></div></div>
  <div class="meta"><div><div class="l">Registros</div><div class="v">${inscritos.length}</div></div><div style="text-align:right"><div class="l">Filtro aplicado</div><div class="v" style="font-size:11px;font-weight:600;color:#3A4A43;text-transform:none;font-family:'IBM Plex Sans'">${filtroTxt}</div></div></div>
  <div class="section"><div class="sec-title">Inscritos (${inscritos.length})</div>
    <table><thead><tr><th style="width:34px">#</th><th>Nome</th><th>Email</th><th>Lote</th><th style="text-align:center;width:90px">Status</th><th style="text-align:center;width:70px">Check-in</th></tr></thead><tbody>${linhas}</tbody></table>
  </div>
  <div class="foot"><span>${orgNome} · Gerado em ${new Date().toLocaleString('pt-BR')}</span><span>${ev.nome}</span></div>
</div>
<button class="btn-p np" onclick="window.print()">Imprimir / Salvar PDF</button>
<script>window.onload=function(){setTimeout(function(){window.print();},500);};</script>
</body></html>`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.send(html);
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});
// GET /eventos/:id/inscritos-excel — download planilha Excel dos inscritos
router.get('/eventos/:id/inscritos-excel', requireAuth, async (req, res) => {
  try {
    const [evR, inscrR] = await Promise.all([
      query('SELECT * FROM eventos WHERE id=$1', [req.params.id]),
      query('SELECT i.*, l.nome as lote_nome FROM evento_inscricoes i LEFT JOIN evento_lotes l ON l.id=i.lote_id WHERE i.evento_id=$1 ORDER BY i.nome', [req.params.id])
    ]);
    const ev = evR.rows[0];
    if (!ev) return res.status(404).send('Evento nao encontrado');

    const fStatus = (req.query.status||'').toString();
    const fTipo = (req.query.tipo||'').toString();
    const fBusca = (req.query.busca||'').toString().toLowerCase().trim();

    let inscritos = inscrR.rows.filter(i => {
      const nome = (i.nome||'').toLowerCase();
      const email = (i.email||'').toLowerCase();
      const isento = i.isento ? 'isento' : 'pagante';
      if (fBusca && !nome.includes(fBusca) && !email.includes(fBusca)) return false;
      if (fStatus && i.status !== fStatus) return false;
      if (fTipo && isento !== fTipo) return false;
      return true;
    });

    // Gerar CSV (abre no Excel)
    const BOM = '\uFEFF'; // BOM para UTF-8 no Excel
    const cabecalho = ['#','Nome','Email','WhatsApp','CPF','RG','Instituicao','Lote','Status','Isento','Semestre','Turma','Tipo Participante','Check-in','Inscrito em'];
    const linhas = inscritos.map((i, idx) => [
      idx+1,
      i.nome||'',
      i.email||'',
      i.whatsapp||'',
      i.cpf||'',
      i.rg||'',
      i.instituicao||'',
      i.lote_nome||'',
      i.status||'',
      i.isento ? 'Sim' : 'Nao',
      i.semestre||'',
      i.turma||'',
      i.tipo_participante||'',
      i.checkin_em ? new Date(i.checkin_em).toLocaleString('pt-BR') : '',
      i.criado_em ? new Date(i.criado_em).toLocaleString('pt-BR') : ''
    ].map(v => '"'+String(v).replace(/"/g,'""')+'"').join(';'));

    const csv = BOM + cabecalho.map(h=>'"'+h+'"').join(';') + '\n' + linhas.join('\n');
    const nomeArquivo = ev.nome.replace(/[^a-z0-9]/gi,'_').substring(0,40) + '_inscritos.csv';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + nomeArquivo + '"');
    res.send(csv);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
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
        if (process.env.WAPP_SOMENTE_RESPOSTA !== 'true') await enviarWhatsApp(insc.whatsapp, msg);
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
  req.session.msg=['Configurações avançadas salvas!']; res.redirect('/eventos/'+req.params.id+'?tab=avancado');
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

router.post('/eventos/:id/palestrantes/:pid/editar', requireAuth, async (req, res) => {
  try {
    const {upload,uploadArquivo} = require('../services/arquivos');
    upload.single('foto')(req, res, async (err) => {
      const {nome,bio,instituicao} = req.body;
      if (req.file) {
        const r=await uploadArquivo(req.file.buffer,req.file.originalname,req.file.mimetype,'palestrantes');
        await query('UPDATE evento_palestrantes SET nome=$1,bio=$2,instituicao=$3,foto_chave=$4 WHERE id=$5',[nome,bio||null,instituicao||null,r.chave,req.params.pid]);
      } else {
        await query('UPDATE evento_palestrantes SET nome=$1,bio=$2,instituicao=$3 WHERE id=$4',[nome,bio||null,instituicao||null,req.params.pid]);
      }
      req.session.msg=['Palestrante atualizado!']; res.redirect('/eventos/'+req.params.id);
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/eventos/'+req.params.id); }
});

router.post('/eventos/:id/palestrantes/:pid/editar', requireAuth, async (req, res) => {
  try {
    const {upload,uploadArquivo} = require('../services/arquivos');
    upload.single('foto')(req, res, async (err) => {
      const {nome,bio,instituicao} = req.body;
      if (req.file) {
        const r=await uploadArquivo(req.file.buffer,req.file.originalname,req.file.mimetype,'palestrantes');
        await query('UPDATE evento_palestrantes SET nome=$1,bio=$2,instituicao=$3,foto_chave=$4 WHERE id=$5',[nome,bio||null,instituicao||null,r.chave,req.params.pid]);
      } else {
        await query('UPDATE evento_palestrantes SET nome=$1,bio=$2,instituicao=$3 WHERE id=$4',[nome,bio||null,instituicao||null,req.params.pid]);
      }
      req.session.msg=['Palestrante atualizado!']; res.redirect('/eventos/'+req.params.id);
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/eventos/'+req.params.id); }
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

router.post('/eventos/:id/cupons/:cid/reenviar', requireAuth, async (req, res) => {
  try {
    const { enviarWhatsApp, enviarEmail } = require('../services/notificacoes');
    const eventoR = await query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
    const evento = eventoR.rows[0];
    const config = await query('SELECT chave,valor FROM configuracoes').then(r => { const c={}; r.rows.forEach(x=>c[x.chave]=x.valor); return c; });
    const orgNome = config.org_nome || 'LAURO';
    const appUrl = process.env.APP_URL || 'https://liga-urologia.onrender.com';

    const cupR = await query('SELECT * FROM evento_cupons WHERE id=$1 AND evento_id=$2', [req.params.cid, req.params.id]);
    const cupom = cupR.rows[0];
    if (!cupom) { req.session.erro=['Cupom não encontrado.']; return res.redirect('/eventos/'+req.params.id+'?tab=cupons'); }

    let pessoa = null;
    if (cupom.ligante_id) {
      const r = await query('SELECT nome,email,whatsapp FROM ligantes WHERE id=$1', [cupom.ligante_id]);
      pessoa = r.rows[0];
    } else if (cupom.diretivo_id) {
      const r = await query('SELECT nome,email,whatsapp FROM diretivos WHERE id=$1', [cupom.diretivo_id]);
      pessoa = r.rows[0];
    }
    if (!pessoa) { req.session.erro=['Este cupom não tem pessoa vinculada para reenvio.']; return res.redirect('/eventos/'+req.params.id+'?tab=cupons'); }

    const codigoFinal = cupom.codigo;
    const msg = `💚💙 *${orgNome}* 💚💙\n\nOlá, *${pessoa.nome.split(' ')[0]}*! 🎉\n\nVocê tem um *cupom de isenção 100%* 🎫 para o evento:\n*${evento.nome}*\n\n🎟️ Seu cupom: *${codigoFinal}*\n\n👉 Inscreva-se pelo link abaixo (o cupom já vem aplicado, é só finalizar):\n${appUrl}/inscricao/${req.params.id}?cupom=${encodeURIComponent(codigoFinal)}\n\n_Cupom válido para uma inscrição._ ✨`;
    let okWpp=false, okEmail=false;
    if (pessoa.whatsapp && process.env.WAPP_SOMENTE_RESPOSTA !== 'true') { try { await enviarWhatsApp(pessoa.whatsapp, msg, { urgente: true }); okWpp=true; } catch(e) {} }
    if (pessoa.email) {
      const html = (function(){var cor='#1a3d2b',corEsc='#0a2018';var oN=(typeof config!=='undefined'&&config&&config.org_nome)?config.org_nome:'Liga Academica de Urologia';var oL=(typeof config!=='undefined'&&config&&config.org_logo)?config.org_logo:null;var lg=oL?('<div style="width:72px;height:72px;background:#fff;border-radius:50%;display:inline-block;text-align:center;overflow:hidden"><img src="'+oL+'" alt="'+oN+'" style="width:72px;height:72px;object-fit:cover;border-radius:50%;vertical-align:middle"></div>'):('<span style="color:white;font-size:20px;font-weight:800">'+oN+'</span>');var pn=pessoa.nome.split(' ')[0];var linkCupom=appUrl+'/inscricao/'+req.params.id+'?cupom='+encodeURIComponent(codigoFinal);return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f1f5f9"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">'+'<tr><td style="background:linear-gradient(160deg,'+cor+' 0%,'+corEsc+' 100%);border-radius:12px 12px 0 0;padding:36px 40px;text-align:center">'+lg+'<div style="margin-top:14px;display:block"><span style="color:rgba(255,255,255,0.9);font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;background:rgba(255,255,255,0.15);border-radius:4px;padding:4px 16px;display:inline-block">Cup&oacute;n de Exenci&oacute;n 100%</span></div></td></tr>'+'<tr><td style="background:white;padding:36px 40px"><div style="border-left:3px solid '+cor+';padding-left:14px;margin-bottom:24px"><p style="margin:0;font-size:11px;font-weight:700;color:'+cor+';letter-spacing:1.5px;text-transform:uppercase">Tu invitaci&oacute;n gratuita</p><h2 style="margin:4px 0 0;font-size:20px;font-weight:700;color:#0f172a">'+evento.nome+'</h2></div>'+'<p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7">&iexcl;Hola, <strong>'+pn+'</strong>! Tienes un <strong>cup&oacute;n de exenci&oacute;n 100%</strong> para participar gratuitamente en este evento.</p>'+'<div style="text-align:center;margin:24px 0;padding:24px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0"><p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px">Tu c&oacute;digo de cup&oacute;n</p><div style="font-size:30px;font-weight:900;font-family:monospace;color:'+cor+';letter-spacing:4px">'+codigoFinal+'</div><p style="margin:12px 0 0;font-size:12px;color:'+cor+';font-weight:700">&#128203; Copiar cup&oacute;n</p><p style="margin:4px 0 0;font-size:11px;color:#94a3b8">V&aacute;lido para 1 inscripci&oacute;n</p></div>'+'<div style="text-align:center;padding-top:8px"><a href="'+linkCupom+'" style="display:inline-block;background:'+cor+';color:white;padding:13px 36px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.5px;text-transform:uppercase">Inscribirme con el cup&oacute;n aplicado</a></div>'+'</td></tr><tr><td style="background:#0f172a;border-radius:0 0 12px 12px;padding:24px 40px"><table width="100%" cellpadding="0" cellspacing="0"><tr><td><p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;font-weight:600">'+oN+'</p><p style="margin:4px 0 0;color:rgba(255,255,255,0.4);font-size:10px">&iquest;Dudas? Responde a este correo.</p></td><td align="right"><p style="margin:0;color:rgba(255,255,255,0.3);font-size:9px;letter-spacing:1.5px;text-transform:uppercase">UCP - Ciudad del Este</p></td></tr></table></td></tr>'+'</table></td></tr></table></body></html>';})();
      try { await enviarEmail({ para: pessoa.email, assunto: `🎟️ Seu cupom gratuito — ${evento.nome}`, html, texto: msg }); okEmail=true; } catch(e) {}
    }
    const canais = [okWpp?'WhatsApp':null, okEmail?'email':null].filter(Boolean).join(' e ');
    req.session.msg=[canais ? `Cupom reenviado para ${pessoa.nome} via ${canais}.` : `Não foi possível reenviar (pessoa sem WhatsApp/email).`];
    res.redirect('/eventos/'+req.params.id+'?tab=cupons');
  } catch(e) { req.session.erro=[e.message]; res.redirect('/eventos/'+req.params.id+'?tab=cupons'); }
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
    // Gera sufixo sem caracteres ambíguos (sem 0,O,1,I,L,8,B,5,S,2,Z)
    const _chars = 'ACDEFGHJKMNPQRTUVWXY3467';
    let sufixo = '';
    for (let _i = 0; _i < 6; _i++) sufixo += _chars[Math.floor(Math.random() * _chars.length)];
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

      const msg = `💚💙 *${orgNome}* 💚💙\n\nOlá, *${p.nome.split(' ')[0]}*! 🎉\n\nVocê tem um *cupom de isenção 100%* 🎫 para o evento:\n*${evento.nome}*\n\n🎟️ Seu cupom: *${codigoFinal}*\n\n👉 Inscreva-se pelo link abaixo (o cupom já vem aplicado, é só finalizar):\n${appUrl}/inscricao/${req.params.id}?cupom=${encodeURIComponent(codigoFinal)}\n\n_Cupom válido para uma inscrição._ ✨`;

      if (enviar_wpp === 'on' && p.whatsapp) {
        try { await enviarWhatsApp(p.whatsapp, msg); enviados++; } catch(e) { erros.push(p.nome); }
      }
      if (enviar_email === 'on' && p.email) {
        const html = (function(){var cor='#1a3d2b',corEsc='#0a2018';var oN=(typeof config!=='undefined'&&config&&config.org_nome)?config.org_nome:'Liga Academica de Urologia';var oL=(typeof config!=='undefined'&&config&&config.org_logo)?config.org_logo:null;var lg=oL?('<div style="width:72px;height:72px;background:#fff;border-radius:50%;display:inline-block;text-align:center;overflow:hidden"><img src="'+oL+'" alt="'+oN+'" style="width:72px;height:72px;object-fit:cover;border-radius:50%;vertical-align:middle"></div>'):('<span style="color:white;font-size:20px;font-weight:800">'+oN+'</span>');var pn=p.nome.split(' ')[0];var linkCupom=appUrl+'/inscricao/'+req.params.id+'?cupom='+encodeURIComponent(codigoFinal);return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f1f5f9"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">'+'<tr><td style="background:linear-gradient(160deg,'+cor+' 0%,'+corEsc+' 100%);border-radius:12px 12px 0 0;padding:36px 40px;text-align:center">'+lg+'<div style="margin-top:14px;display:block"><span style="color:rgba(255,255,255,0.9);font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;background:rgba(255,255,255,0.15);border-radius:4px;padding:4px 16px;display:inline-block">Cup&oacute;n de Exenci&oacute;n 100%</span></div></td></tr>'+'<tr><td style="background:white;padding:36px 40px"><div style="border-left:3px solid '+cor+';padding-left:14px;margin-bottom:24px"><p style="margin:0;font-size:11px;font-weight:700;color:'+cor+';letter-spacing:1.5px;text-transform:uppercase">Tu invitaci&oacute;n gratuita</p><h2 style="margin:4px 0 0;font-size:20px;font-weight:700;color:#0f172a">'+evento.nome+'</h2></div>'+'<p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7">&iexcl;Hola, <strong>'+pn+'</strong>! Tienes un <strong>cup&oacute;n de exenci&oacute;n 100%</strong> para participar gratuitamente en este evento.</p>'+'<div style="text-align:center;margin:24px 0;padding:24px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0"><p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px">Tu c&oacute;digo de cup&oacute;n</p><div style="font-size:30px;font-weight:900;font-family:monospace;color:'+cor+';letter-spacing:4px">'+codigoFinal+'</div><p style="margin:12px 0 0;font-size:12px;color:'+cor+';font-weight:700">&#128203; Copiar cup&oacute;n</p><p style="margin:4px 0 0;font-size:11px;color:#94a3b8">V&aacute;lido para 1 inscripci&oacute;n</p></div>'+'<div style="text-align:center;padding-top:8px"><a href="'+linkCupom+'" style="display:inline-block;background:'+cor+';color:white;padding:13px 36px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.5px;text-transform:uppercase">Inscribirme con el cup&oacute;n aplicado</a></div>'+'</td></tr><tr><td style="background:#0f172a;border-radius:0 0 12px 12px;padding:24px 40px"><table width="100%" cellpadding="0" cellspacing="0"><tr><td><p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;font-weight:600">'+oN+'</p><p style="margin:4px 0 0;color:rgba(255,255,255,0.4);font-size:10px">&iquest;Dudas? Responde a este correo.</p></td><td align="right"><p style="margin:0;color:rgba(255,255,255,0.3);font-size:9px;letter-spacing:1.5px;text-transform:uppercase">UCP - Ciudad del Este</p></td></tr></table></td></tr>'+'</table></td></tr></table></body></html>';})();
        try { await enviarEmail({ para: p.email, assunto: `🎟️ Seu cupom gratuito — ${evento.nome}`, html, texto: msg }); } catch(e) {}
      }
    } catch(e) { /* código duplicado — ignora */ }
  }

  req.session.msg=[`${criados} cupons gerados, ${enviados} notificações enviadas!`];
  res.redirect('/eventos/'+req.params.id+'?tab=cupons');
});

// ─── EDITAR INSCRITO ──────────────────────────────────────────────────────────
router.post('/eventos/:id/inscricoes/:iid/editar', requireAuth, async (req, res) => {
  const { nome, email, whatsapp, cpf, instituicao, status, rg, semestre, turma, catraca, tipo_participante, lote_id, cupom_codigo, isento } = req.body;
  await query(
    'UPDATE evento_inscricoes SET nome=$1, email=$2, whatsapp=$3, cpf=$4, instituicao=$5, status=$6, rg=$7, semestre=$8, turma=$9, catraca=$10, tipo_participante=$11, lote_id=$12, cupom_codigo=$13, isento=$14 WHERE id=$15',
    [nome, email, whatsapp||null, cpf||null, instituicao||null, status, rg||null, semestre||null, turma||null, catraca||null, tipo_participante||'externo', lote_id||null, cupom_codigo||null, isento==='true', req.params.iid]
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
router.get('/contratos', requireAuth, requirePermissao('contratos'), async (req, res) => {
  const config = await getConfig();
  const tgR = await query("SELECT valor FROM configuracoes WHERE chave='contrato_texto_global'");
  const textoGlobal = tgR.rows[0]?.valor || '';
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const turmaFiltro = req.query.turma || '';
  const statusFiltro = req.query.status || '';
  let whereExtra = '1=1'; const params = [];
  if (turmaFiltro) { params.push(turmaFiltro); whereExtra += ` AND l.semestre_ingresso=$${params.length}`; }
  if (statusFiltro === 'assinado') whereExtra += ' AND c.assinado_em IS NOT NULL';
  else if (statusFiltro === 'pendente') whereExtra += ' AND c.assinado_em IS NULL';
  const [cR, lR] = await Promise.all([
    query(`SELECT c.*, l.nome as ligante_nome, l.email as ligante_email, l.semestre_ingresso as turma FROM contratos_ligantes c LEFT JOIN ligantes l ON l.id=c.ligante_id WHERE ${whereExtra} ORDER BY c.criado_em DESC`, params),
    query(`SELECT id, nome, email, semestre_ingresso, turma, semestre, rg, catraca FROM ligantes WHERE ativo=1 ORDER BY nome`)
  ]);
  const turmas = [...new Set(lR.rows.map(l=>l.semestre_ingresso).filter(Boolean))].sort();
  const comContrato = new Set(cR.rows.map(c=>c.ligante_id));
  const ligFiltrados = turmaFiltro ? lR.rows.filter(l=>l.semestre_ingresso===turmaFiltro) : lR.rows;
  const semContrato = ligFiltrados.filter(l=>!comContrato.has(l.id));
  const statsTotal = cR.rows.length;
  const statsAssinados = cR.rows.filter(c=>c.assinado_em).length;
  const statsPendentes = statsTotal - statsAssinados;
  res.render('pages/contratos', { config, usuario: req.session.usuario, msg, erro, contratos: cR.rows, ligantes: lR.rows, textoGlobal, turmaFiltro, statusFiltro, turmas, semContrato, statsTotal, statsAssinados, statsPendentes });
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
    chromium.setHeadlessMode = true;
    chromium.setGraphicsMode = false;
    const execPath = await chromium.executablePath();
    const browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      executablePath: execPath,
      headless: 'new'
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
    const { getUrlAssinada } = require('../services/desligamento');
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
  const turmaFiltro = req.query.turma || '';
  const statusFiltro = req.query.status || '';
  const todos = cR.rows;
  const diretivos = dR.rows;
  const idsComContrato = new Set(todos.map(c => c.diretivo_id));
  const semContrato = diretivos.filter(d => !idsComContrato.has(d.id));
  const statsTotal = todos.length;
  const statsAssinados = todos.filter(c => c.assinado_em).length;
  const statsPendentes = statsTotal - statsAssinados;
  let contratos = todos;
  if (statusFiltro === 'assinado') contratos = todos.filter(c => c.assinado_em);
  else if (statusFiltro === 'pendente') contratos = todos.filter(c => !c.assinado_em);
  const turmas = [];
  res.render('pages/contratos-diretivos', { config, usuario: req.session.usuario, msg, erro, contratos, diretivos, textoGlobalDir, turmaFiltro, statusFiltro, turmas, semContrato, statsTotal, statsAssinados, statsPendentes });
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
    const { getUrlAssinada } = require('../services/desligamento');
    const url = await getUrlAssinada(d.pdf_assinado_chave);
    res.redirect(url);
  } catch(e) { res.status(500).send(e.message); }
});


// ════════════════════════════════════════════════════════════════
//  FLUXO DE CAIXA
// ════════════════════════════════════════════════════════════════

router.get('/fluxo-caixa', requireAuth, requirePermissao('fluxo-caixa'), async (req, res) => {
  try {
    const mesesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const hoje = new Date();
    const mesAtual = req.query.mes || `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`;
    const [ano, mes] = mesAtual.split('-').map(Number);
    const mesNome = mesesNomes[mes-1] + ' ' + ano;

    const lancamentos = await query(
      `SELECT * FROM fluxo_caixa WHERE EXTRACT(YEAR FROM data_lancamento)=$1 AND EXTRACT(MONTH FROM data_lancamento)=$2 ORDER BY data_lancamento DESC, id DESC`,
      [ano, mes]
    );

    const entradas = lancamentos.rows.filter(l => l.tipo === 'E');
    const saidas   = lancamentos.rows.filter(l => l.tipo === 'S');
    const totalEntradas = entradas.reduce((s,l) => s + parseFloat(l.valor), 0);
    const totalSaidas   = saidas.reduce((s,l) => s + parseFloat(l.valor), 0);
    const saldo = totalEntradas - totalSaidas;

    // Saldo acumulado = tudo ate o FIM do mes visualizado
    const saldoAcumR = await query(
      `SELECT
        COALESCE(SUM(CASE WHEN tipo='E' THEN valor ELSE 0 END),0) AS total_e,
        COALESCE(SUM(CASE WHEN tipo='S' THEN valor ELSE 0 END),0) AS total_s
       FROM fluxo_caixa
       WHERE data_lancamento <= (DATE_TRUNC('month', $1::date) + INTERVAL '1 month - 1 day')`,
      [mesAtual + '-01']
    );
    const saldoAcumulado = parseFloat(saldoAcumR.rows[0].total_e) - parseFloat(saldoAcumR.rows[0].total_s);
    // Saldo anterior = acumulado ate fim do mes anterior
    const saldoAntR = await query(
      `SELECT
        COALESCE(SUM(CASE WHEN tipo='E' THEN valor ELSE 0 END),0) AS total_e,
        COALESCE(SUM(CASE WHEN tipo='S' THEN valor ELSE 0 END),0) AS total_s
       FROM fluxo_caixa
       WHERE data_lancamento < DATE_TRUNC('month', $1::date)`,
      [mesAtual + '-01']
    );
    const saldoAnterior = parseFloat(saldoAntR.rows[0].total_e) - parseFloat(saldoAntR.rows[0].total_s);

    res.render('pages/fluxo-caixa', {
      config: await getConfig(), usuario: req.session.usuario,
      lancamentos: lancamentos.rows, mesAtual, mesNome,
      totalEntradas, totalSaidas, saldo,
      saldoAcumulado, saldoAnterior,
      qtdEntradas: entradas.length, qtdSaidas: saidas.length,
      msg: req.flash('msg'), erro: req.flash('erro')
    });
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/dashboard'); }
});

router.get('/fluxo-caixa/graficos-data', requireAuth, requirePermissao('fluxo-caixa'), async (req, res) => {
  try {
    // Mensal — últimos 12 meses
    const mensal = await query(`
      SELECT TO_CHAR(data_lancamento,'YYYY-MM') as mes,
        SUM(CASE WHEN tipo='E' THEN valor ELSE 0 END) as entradas,
        SUM(CASE WHEN tipo='S' THEN valor ELSE 0 END) as saidas
      FROM fluxo_caixa
      WHERE data_lancamento >= NOW() - INTERVAL '12 months'
      GROUP BY mes ORDER BY mes`);
    // Semanal — últimas 8 semanas
    const semanal = await query(`
      SELECT TO_CHAR(DATE_TRUNC('week',data_lancamento),'DD/MM') as semana,
        SUM(CASE WHEN tipo='E' THEN valor ELSE 0 END) as entradas,
        SUM(CASE WHEN tipo='S' THEN valor ELSE 0 END) as saidas
      FROM fluxo_caixa
      WHERE data_lancamento >= NOW() - INTERVAL '8 weeks'
      GROUP BY DATE_TRUNC('week',data_lancamento), semana ORDER BY DATE_TRUNC('week',data_lancamento)`);
    // Anual — últimos 5 anos
    const anual = await query(`
      SELECT EXTRACT(YEAR FROM data_lancamento)::text as ano,
        SUM(CASE WHEN tipo='E' THEN valor ELSE 0 END) as entradas,
        SUM(CASE WHEN tipo='S' THEN valor ELSE 0 END) as saidas
      FROM fluxo_caixa
      WHERE data_lancamento >= NOW() - INTERVAL '5 years'
      GROUP BY ano ORDER BY ano`);
    // Categorias do mês atual
    const hoje = new Date();
    const categorias = await query(`
      SELECT categoria, tipo,
        SUM(valor) as total
      FROM fluxo_caixa
      WHERE EXTRACT(YEAR FROM data_lancamento)=$1 AND EXTRACT(MONTH FROM data_lancamento)=$2
        AND categoria IS NOT NULL
      GROUP BY categoria, tipo ORDER BY total DESC`,
      [hoje.getFullYear(), hoje.getMonth()+1]);
    res.json({ mensal: mensal.rows, semanal: semanal.rows, anual: anual.rows, categorias: categorias.rows });
  } catch(e) { res.json({ erro: e.message }); }
});

router.post('/fluxo-caixa/novo', requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.fields([{name:'nf',maxCount:1},{name:'nf2',maxCount:1}])(req, res, async (err) => {
      if (err) { req.flash('erro', [err.message]); return res.redirect('/fluxo-caixa'); }
      const { tipo, descricao, categoria, valor, data_lancamento, observacoes } = req.body;
      let nf_chave = null, nf_nome_original = null, nf_chave2 = null, nf_nome_original2 = null;
      if (req.files && req.files['nf'] && req.files['nf'][0]) {
        const f = req.files['nf'][0];
        const r = await uploadArquivo(f.buffer, f.originalname, f.mimetype, 'fluxo-caixa');
        nf_chave = r.chave; nf_nome_original = f.originalname;
      }
      if (req.files && req.files['nf2'] && req.files['nf2'][0]) {
        const f = req.files['nf2'][0];
        const r = await uploadArquivo(f.buffer, f.originalname, f.mimetype, 'fluxo-caixa');
        nf_chave2 = r.chave; nf_nome_original2 = f.originalname;
      }
      await query(
        `INSERT INTO fluxo_caixa (tipo,descricao,categoria,valor,data_lancamento,nf_chave,nf_nome_original,nf_chave2,nf_nome_original2,observacoes,criado_por,criado_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
        [tipo, descricao, categoria, parseFloat(valor), data_lancamento, nf_chave, nf_nome_original, nf_chave2, nf_nome_original2, observacoes||null, req.session.usuario.id]
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
    upload.fields([{name:'nf',maxCount:1},{name:'nf2',maxCount:1}])(req, res, async (err) => {
      if (err) { req.flash('erro', [err.message]); return res.redirect('/fluxo-caixa'); }
      const { tipo, descricao, categoria, valor, data_lancamento, observacoes } = req.body;
      const atual = await query('SELECT nf_chave,nf_nome_original,nf_chave2,nf_nome_original2 FROM fluxo_caixa WHERE id=$1',[req.params.id]);
      let nf_chave = atual.rows[0]?.nf_chave;
      let nf_nome_original = atual.rows[0]?.nf_nome_original;
      let nf_chave2 = atual.rows[0]?.nf_chave2;
      let nf_nome_original2 = atual.rows[0]?.nf_nome_original2;
      if (req.files && req.files['nf'] && req.files['nf'][0]) {
        const f = req.files['nf'][0];
        const r = await uploadArquivo(f.buffer, f.originalname, f.mimetype, 'fluxo-caixa');
        nf_chave = r.chave; nf_nome_original = f.originalname;
      }
      if (req.files && req.files['nf2'] && req.files['nf2'][0]) {
        const f = req.files['nf2'][0];
        const r = await uploadArquivo(f.buffer, f.originalname, f.mimetype, 'fluxo-caixa');
        nf_chave2 = r.chave; nf_nome_original2 = f.originalname;
      }
      await query(
        `UPDATE fluxo_caixa SET tipo=$1,descricao=$2,categoria=$3,valor=$4,data_lancamento=$5,nf_chave=$6,nf_nome_original=$7,nf_chave2=$8,nf_nome_original2=$9,observacoes=$10 WHERE id=$11`,
        [tipo, descricao, categoria, parseFloat(valor), data_lancamento, nf_chave, nf_nome_original, nf_chave2, nf_nome_original2, observacoes||null, req.params.id]
      );
      const mes = data_lancamento.substring(0,7);
      req.flash('msg', ['Lançamento atualizado!']);
      res.redirect('/fluxo-caixa?mes='+mes);
    });
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/fluxo-caixa'); }
});

router.post('/fluxo-caixa/excluir-lote', requireAuth, async (req, res) => {
  try {
    const ids = req.body.ids;
    const mesRef = req.body.mes || '';
    const lista = (Array.isArray(ids)?ids:[ids]).map(Number).filter(n=>n>0);
    if(!lista.length){ req.flash('erro',['Nenhum item selecionado']); return res.redirect(req.headers.referer||'/fluxo-caixa'); }
    for(const id of lista){ await query('DELETE FROM fluxo_caixa WHERE id=$1',[id]); }
    req.flash('msg', [lista.length+' lancamento(s) excluido(s).']);
    res.redirect('/fluxo-caixa'+(mesRef?'?mes='+mesRef:''));
  } catch(e){ req.flash('erro',[e.message]); res.redirect('/fluxo-caixa'); }
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

router.get('/fluxo-caixa/:id/nf-url', requireAuth, requirePermissao('fluxo-caixa'), async (req, res) => {
  try {
    const r = await query('SELECT nf_chave,nf_nome_original FROM fluxo_caixa WHERE id=$1',[req.params.id]);
    const d = r.rows[0];
    if (!d?.nf_chave) return res.json({url:null});
    const { getUrlAssinada } = require('../services/desligamento');
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
      atividades: atividades,
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

// ─── ASSISTENTE VIRTUAL ───────────────────────────────────────────────────────
router.get('/assistente-virtual/uso', requireAuth, async (req, res) => {
  const hoje = new Date().toISOString().split('T')[0];
  const mes = hoje.substring(0, 7);
  const total = await query('SELECT SUM(tokens_entrada+tokens_saida) as tokens, SUM(custo_estimado) as custo, COUNT(*) as chamadas FROM anthropic_uso');
  const mes_r = await query("SELECT SUM(tokens_entrada+tokens_saida) as tokens, SUM(custo_estimado) as custo, COUNT(*) as chamadas FROM anthropic_uso WHERE TO_CHAR(criado_em,'YYYY-MM')=$1", [mes]);
  const hoje_r = await query("SELECT SUM(tokens_entrada+tokens_saida) as tokens, SUM(custo_estimado) as custo, COUNT(*) as chamadas FROM anthropic_uso WHERE criado_em::date=$1", [hoje]);
  res.json({
    total: { tokens: parseInt(total.rows[0].tokens)||0, custo: parseFloat(total.rows[0].custo)||0, chamadas: parseInt(total.rows[0].chamadas)||0 },
    mes: { tokens: parseInt(mes_r.rows[0].tokens)||0, custo: parseFloat(mes_r.rows[0].custo)||0, chamadas: parseInt(mes_r.rows[0].chamadas)||0 },
    hoje: { tokens: parseInt(hoje_r.rows[0].tokens)||0, custo: parseFloat(hoje_r.rows[0].custo)||0, chamadas: parseInt(hoje_r.rows[0].chamadas)||0 }
  });
});
router.get('/assistente-virtual', requireAuth, async (req, res) => {
  try {
    const config = await getConfig();
    const r = await query('SELECT id, pergunta, resposta, ativo FROM lauro_conhecimento ORDER BY id DESC LIMIT 200');
    res.render('pages/assistente-virtual', {
      config, conhecimento: r.rows,
      usuario: req.session.usuario || {nome:'Administrador'},
      msg: req.session.msg||[], erro: req.session.erro||[]
    });
    delete req.session.msg; delete req.session.erro;
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});

router.post('/assistente-virtual/aprender', requireAuth, async (req, res) => {
  try {
    const { mensagem } = req.body;
    if (!mensagem || !mensagem.trim()) return res.json({ erro: 'Mensagem vazia' });
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.json({ erro: 'API key nao configurada' });
    const _ax = require('axios');
    const prompt = 'Você é o assistente de treinamento do Lauro, atendente virtual da LAURO Liga Acadêmica de Urologia. O administrador vai te ensinar informações (texto, imagens ou documentos). Extraia os pontos principais e crie perguntas/respostas úteis para uso no WhatsApp. RESPONDA APENAS EM JSON puro (sem markdown, sem backticks): {"mensagem":"Confirmação amigável do que aprendeu (1-2 frases, use emojis)","aprendizados":[{"pergunta":"Pergunta específica que um membro faria no WhatsApp","resposta":"Resposta completa e útil"}]}. Crie entre 1 e 4 pares. Seja específico — inclua nomes, datas, links quando disponíveis.';
    const { arquivo } = req.body;
    let msgContent;
    if (arquivo) {
      const isImage = arquivo.tipo.startsWith('image/');
      const isPDF = arquivo.tipo === 'application/pdf';
      if (isImage) {
        msgContent = [
          { type: 'image', source: { type: 'base64', media_type: arquivo.tipo, data: arquivo.base64 } },
          { type: 'text', text: mensagem || 'Analise esta imagem e extraia todas as informações relevantes para a base de conhecimento da Liga.' }
        ];
      } else if (isPDF) {
        msgContent = [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: arquivo.base64 } },
          { type: 'text', text: mensagem || 'Analise este documento e extraia as informações relevantes para a base de conhecimento da Liga.' }
        ];
      } else {
        const textoArquivo = Buffer.from(arquivo.base64, 'base64').toString('utf-8');
        msgContent = mensagem + '\n\nConteúdo do arquivo ' + arquivo.nome + ':\n' + textoArquivo.substring(0,4000);
      }
    } else {
      msgContent = mensagem;
    }
    const apiRes = await _ax.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-6', max_tokens: 1500,
      system: prompt, messages: [{ role: 'user', content: msgContent }]
    }, { headers: { 'Content-Type':'application/json', 'x-api-key':apiKey, 'anthropic-version':'2023-06-01' } });
    const text = apiRes.data.content && apiRes.data.content[0] ? apiRes.data.content[0].text : '{}';
    // Registrar uso de tokens (claude-sonnet-4-6: $0.003/1k entrada, $0.015/1k saida)
    try {
      const uso = apiRes.data.usage || {};
      const tIn = uso.input_tokens || 0;
      const tOut = uso.output_tokens || 0;
      const custo = (tIn * 0.003 / 1000) + (tOut * 0.015 / 1000);
      await query('INSERT INTO anthropic_uso (contexto,modelo,tokens_entrada,tokens_saida,custo_estimado) VALUES ($1,$2,$3,$4,$5)',
        ['assistente-virtual', 'claude-sonnet-4-6', tIn, tOut, custo]);
    } catch(e) {}
    const parsed = JSON.parse(text.replace(/```json|```/g,'').trim());
    const ids = [];
    for (const ap of (parsed.aprendizados||[])) {
      const r2 = await query('INSERT INTO lauro_conhecimento (pergunta, resposta, ativo) VALUES ($1,$2,1) RETURNING id',
        [ap.pergunta.substring(0,500), ap.resposta.substring(0,2000)]);
      ids.push(r2.rows[0].id);
    }
    const apComIds = (parsed.aprendizados||[]).map((ap,i)=>({...ap, id:ids[i]}));
    res.json({ resposta: parsed.mensagem, aprendizados: apComIds, total: ids.length });
  } catch(e) { console.error('AV aprender:', e.message); res.json({ erro: 'Erro: '+e.message }); }
});


router.post('/assistente-virtual/conhecimento/:id/editar', requireAuth, async (req,res) => {
  try {
    const { pergunta, resposta } = req.body;
    if (!pergunta || !resposta) return res.json({ok:false, erro:'Campos vazios'});
    await query('UPDATE lauro_conhecimento SET pergunta=$1, resposta=$2 WHERE id=$3',
      [pergunta.substring(0,500), resposta.substring(0,2000), req.params.id]);
    res.json({ok:true});
  } catch(e) { res.json({ok:false}); }
});

router.post('/assistente-virtual/conhecimento/:id/toggle', requireAuth, async (req,res) => {
  try { await query('UPDATE lauro_conhecimento SET ativo=CASE WHEN ativo=1 THEN 0 ELSE 1 END WHERE id=$1',[req.params.id]); res.json({ok:true}); }
  catch(e) { res.json({ok:false}); }
});

router.post('/assistente-virtual/conhecimento/:id/deletar', requireAuth, async (req,res) => {
  try { await query('DELETE FROM lauro_conhecimento WHERE id=$1',[req.params.id]); res.json({ok:true}); }
  catch(e) { res.json({ok:false}); }
});

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


// ════════════════════════════════════════════════════════════════
//  SORTEIOS
// ════════════════════════════════════════════════════════════════

// Lista de sorteios
router.get('/sorteios', requireAuth, requirePermissao('sorteios'), async (req, res) => {
  try {
    const [sorteiosR, ligantesR, diretivosR] = await Promise.all([
      query('SELECT * FROM sorteios ORDER BY criado_em DESC'),
      query("SELECT id, nome FROM membros WHERE ativo=1 ORDER BY nome"),
      query("SELECT id, nome FROM diretivos WHERE ativo=1 AND pendente=false ORDER BY nome")
    ]);
    res.render('pages/sorteios', {
      config: await getConfig(), usuario: req.session.usuario,
      paginaAtual: 'sorteios',
      sorteios: sorteiosR.rows,
      ligantes: ligantesR.rows,
      diretivos: diretivosR.rows,
      msg: req.flash('msg'), erro: req.flash('erro')
    });
  } catch(e) { console.error(e); res.send('ERRO: ' + e.message); }
});

// Roleta animada
router.get('/sorteios/roleta', requireAuth, requirePermissao('sorteios'), async (req, res) => {
  try {
    const [lig, dir] = await Promise.all([
      query("SELECT nome FROM membros WHERE ativo=1 ORDER BY nome"),
      query("SELECT nome FROM diretivos WHERE ativo=1 ORDER BY nome")
    ]);
    res.render('pages/roleta', {
      config: await getConfig(), usuario: req.session.usuario,
      paginaAtual: 'sorteios',
      ligantes: lig.rows.map(r => r.nome),
      diretivos: dir.rows.map(r => r.nome)
    });
  } catch(e) { res.send('ERRO: ' + e.message); }
});

// Criar sorteio
router.post('/sorteios/criar', requireAuth, async (req, res) => {
  try {
    console.log('[SORTEIO DEBUG] body:', JSON.stringify({
      publico_alvo: req.body.publico_alvo,
      selecao: req.body['participantes_selecao[]'],
      extra: req.body['participantes_extra'],
      manual: req.body['participantes_manual']
    }));
    const { tipo, nome, descricao, qtd_ganhadores, publico_alvo, participantes_manual, instagram_liga } = req.body;
    const tarefas = req.body['tarefas[]'] ? (Array.isArray(req.body['tarefas[]']) ? req.body['tarefas[]'] : [req.body['tarefas[]']]) : [];
    const tarefasJson = tarefas.length ? JSON.stringify(tarefas.filter(t => t.trim())) : null;
    // Se publico_alvo='selecao', pegar nomes dos checkboxes selecionados
    let partManual = null;
    if (publico_alvo === 'selecao') {
      // Checkboxes selecionados
      const selecionados = req.body['participantes_selecao[]']
        ? (Array.isArray(req.body['participantes_selecao[]']) ? req.body['participantes_selecao[]'] : [req.body['participantes_selecao[]']])
        : [];
      // Nomes extras digitados manualmente
      const extras = req.body['participantes_extra']
        ? req.body['participantes_extra'].split('\n').map(n=>n.trim()).filter(n=>n)
        : [];
      const todos = [...selecionados, ...extras];
      partManual = todos.length ? JSON.stringify(todos) : null;
    } else if (participantes_manual) {
      partManual = JSON.stringify(participantes_manual.split('\n').map(n=>n.trim()).filter(n=>n));
    }

    const r = await query(
      `INSERT INTO sorteios (tipo,nome,descricao,qtd_ganhadores,publico_alvo,participantes_manual,instagram_liga,tarefas,status,criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'rascunho',$9) RETURNING id`,
      [tipo, nome, descricao||null, parseInt(qtd_ganhadores)||1, publico_alvo||null, partManual, instagram_liga||null, tarefasJson, req.session.usuario.id]
    );
    req.flash('msg', ['Sorteio criado com sucesso!']);
    res.redirect('/sorteios/' + r.rows[0].id);
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/sorteios'); }
});

// Detalhe do sorteio
router.get('/sorteios/:id', requireAuth, requirePermissao('sorteios'), async (req, res) => {
  try {
    const s = await query('SELECT * FROM sorteios WHERE id=$1', [req.params.id]);
    if(!s.rows.length) return res.redirect('/sorteios');
    const sorteio = s.rows[0];

    // Buscar participantes conforme o tipo
    let participantes = [];
    if(sorteio.tipo === 'interno'){
      if(sorteio.publico_alvo === 'ligantes'){
        const r = await query("SELECT nome FROM membros WHERE ativo=1 ORDER BY nome");
        participantes = r.rows.map(r=>r.nome);
      } else if(sorteio.publico_alvo === 'diretivos'){
        const r = await query("SELECT nome FROM diretivos WHERE ativo=1 ORDER BY nome");
        participantes = r.rows.map(r=>r.nome);
      } else if(sorteio.publico_alvo === 'ambos'){
        const [lig, dir] = await Promise.all([
          query("SELECT nome FROM membros WHERE ativo=1 ORDER BY nome"),
          query("SELECT nome FROM diretivos WHERE ativo=1 ORDER BY nome")
        ]);
        participantes = [...lig.rows.map(r=>r.nome), ...dir.rows.map(r=>r.nome)];
      } else if((sorteio.publico_alvo === 'manual' || sorteio.publico_alvo === 'selecao') && sorteio.participantes_manual){
        participantes = JSON.parse(sorteio.participantes_manual);
      }
    } else {
      const r = await query('SELECT * FROM sorteio_participantes WHERE sorteio_id=$1 ORDER BY criado_em', [sorteio.id]);
      participantes = r.rows.map(p=>p.nome);
    }

    const ganhadores = sorteio.ganhador_nome ? sorteio.ganhador_nome.split('|') : [];

    res.render('pages/sorteio-detalhe', {
      config: await getConfig(), usuario: req.session.usuario,
      paginaAtual: 'sorteios',
      sorteio, participantes, ganhadores,
      msg: req.flash('msg'), erro: req.flash('erro')
    });
  } catch(e) { res.send('ERRO: ' + e.message); }
});

// Salvar resultado do sorteio
router.post('/sorteios/:id/salvar-resultado', requireAuth, async (req, res) => {
  try {
    const ganhadores = JSON.parse(req.body.ganhadores || '[]');
    const ganhadorNome = ganhadores.join('|');
    await query(
      `UPDATE sorteios SET status='sorteado', ganhador_nome=$1, sorteado_em=NOW(), sorteado_por=$2 WHERE id=$3`,
      [ganhadorNome, req.session.usuario.id, req.params.id]
    );
    res.redirect('/sorteios/' + req.params.id);
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/sorteios/' + req.params.id); }
});

// Validar ganhador
router.post('/sorteios/:id/validar', requireAuth, async (req, res) => {
  try {
    const { brinde, ganhador_contato, observacoes_validacao, validado } = req.body;
    const tarefasCumpridas = req.body.tarefas_cumpridas
      ? JSON.stringify(Array.isArray(req.body.tarefas_cumpridas) ? req.body.tarefas_cumpridas : [req.body.tarefas_cumpridas])
      : null;
    const isValidado = validado === 'true';

    await query(
      `UPDATE sorteios SET validado=$1, brinde=$2, ganhador_contato=$3, observacoes_validacao=$4, tarefas_cumpridas=$5 WHERE id=$6`,
      [isValidado, brinde||null, ganhador_contato||null, observacoes_validacao||null, tarefasCumpridas, req.params.id]
    );

    req.flash('msg', [isValidado ? '✅ Ganhador validado e brinde registrado!' : '❌ Ganhador marcado como inválido.']);
    res.redirect('/sorteios/' + req.params.id);
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/sorteios/' + req.params.id); }
});

// Resetar sorteio
router.get('/sorteios/:id/resetar', requireAuth, requirePermissao('sorteios'), async (req, res) => {
  try {
    await query(`UPDATE sorteios SET status='rascunho', ganhador_nome=NULL, ganhador_contato=NULL, brinde=NULL, validado=FALSE, sorteado_em=NULL, tarefas_cumpridas=NULL WHERE id=$1`, [req.params.id]);
    res.redirect('/sorteios/' + req.params.id);
  } catch(e) { res.redirect('/sorteios/' + req.params.id); }
});

// Excluir sorteio
router.post('/sorteios/:id/excluir', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM sorteios WHERE id=$1', [req.params.id]);
    req.flash('msg', ['Sorteio excluído.']);
    res.redirect('/sorteios');
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/sorteios'); }
});


// ════════════════════════════════════════════════════════════════
//  PALESTRANTES
// ════════════════════════════════════════════════════════════════

router.get('/palestrantes', requireAuth, async (req, res) => {
  try {
    const statusFiltro = req.query.status || 'todos';
    let whereClause = '';
    if (statusFiltro === 'pendente') whereClause = 'WHERE pendente=true';
    else if (statusFiltro === 'aprovado') whereClause = 'WHERE pendente=false AND preenchido_em IS NOT NULL';
    const [rAll, rPend, rStats] = await Promise.all([
      query(`SELECT * FROM palestrantes ${whereClause} ORDER BY criado_em DESC`),
      query('SELECT COUNT(*) as total FROM palestrantes WHERE pendente=true'),
      query('SELECT COUNT(*) as total, SUM(CASE WHEN preenchido_em IS NOT NULL THEN 1 ELSE 0 END) as completos FROM palestrantes')
    ]);
    const statsTotal = parseInt(rStats.rows[0].total) || 0;
    const statsCompletos = parseInt(rStats.rows[0].completos) || 0;
    const statsAguardando = statsTotal - statsCompletos;
    res.render('pages/palestrantes', {
      config: await getConfig(), usuario: req.session.usuario,
      paginaAtual: 'palestrantes',
      palestrantes: rAll.rows,
      statusFiltro,
      pendentesCount: parseInt(rPend.rows[0].total) || 0,
      statsTotal, statsCompletos, statsAguardando,
      msg: req.flash('msg'), erro: req.flash('erro')
    });
  } catch(e) { res.send('ERRO: ' + e.message); }
});


router.post('/palestrantes/gerar-link', requireAuth, async (req, res) => {
  try {
    const { nome_completo, email, whatsapp } = req.body;
    const token = require('crypto').randomBytes(32).toString('hex');
    await query(
      `INSERT INTO palestrantes (token_form,nome_completo,email,whatsapp,criado_por) VALUES ($1,$2,$3,$4,$5)`,
      [token, nome_completo||null, email||null, whatsapp||null, req.session.usuario.id]
    );
    req.flash('msg', ['link:' + token]);
    res.redirect('/palestrantes');
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/palestrantes'); }
});

router.post('/palestrantes/novo', requireAuth, async (req, res) => {
  try {
    const { nome_completo, email, whatsapp, cpf, rg_ci, especialidade, instituicao,
      endereco_pais, endereco_cep, endereco_rua, endereco_numero, endereco_complemento,
      endereco_bairro, endereco_cidade, endereco_estado, observacoes } = req.body;
    const token = crypto.randomBytes(32).toString('hex');
    await query(
      `INSERT INTO palestrantes (token_form,nome_completo,email,whatsapp,cpf,rg_ci,especialidade,instituicao,
        endereco_pais,endereco_cep,endereco_rua,endereco_numero,endereco_complemento,
        endereco_bairro,endereco_cidade,endereco_estado,observacoes,criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [token,nome_completo||null,email||null,whatsapp||null,cpf||null,rg_ci||null,especialidade||null,
       instituicao||null,endereco_pais||'Brasil',endereco_cep||null,endereco_rua||null,
       endereco_numero||null,endereco_complemento||null,endereco_bairro||null,
       endereco_cidade||null,endereco_estado||null,observacoes||null,req.session.usuario.id]
    );
    req.flash('msg', ['Palestrante criado! Copie o link e envie para ele.']);
    res.redirect('/palestrantes');
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/palestrantes'); }
});

router.post('/palestrantes/:id/editar', requireAuth, async (req, res) => {
  try {
    const { nome_completo, email, whatsapp, cpf, rg_ci, especialidade, instituicao,
      endereco_pais, endereco_cep, endereco_rua, endereco_numero, endereco_complemento,
      endereco_bairro, endereco_cidade, endereco_estado, observacoes } = req.body;
    await query(
      `UPDATE palestrantes SET nome_completo=$1,email=$2,whatsapp=$3,cpf=$4,rg_ci=$5,especialidade=$6,
        instituicao=$7,endereco_pais=$8,endereco_cep=$9,endereco_rua=$10,endereco_numero=$11,
        endereco_complemento=$12,endereco_bairro=$13,endereco_cidade=$14,endereco_estado=$15,
        observacoes=$16 WHERE id=$17`,
      [nome_completo||null,email||null,whatsapp||null,cpf||null,rg_ci||null,especialidade||null,
       instituicao||null,endereco_pais||'Brasil',endereco_cep||null,endereco_rua||null,
       endereco_numero||null,endereco_complemento||null,endereco_bairro||null,
       endereco_cidade||null,endereco_estado||null,observacoes||null,req.params.id]
    );
    req.flash('msg', ['Dados atualizados!']);
    res.redirect('/palestrantes');
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/palestrantes'); }
});

router.post('/palestrantes/:id/excluir', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM palestrantes WHERE id=$1', [req.params.id]);
    req.flash('msg', ['Palestrante excluído.']);
    res.redirect('/palestrantes');
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/palestrantes'); }
});

// FORMULÁRIO PÚBLICO — palestrante preenche
router.get('/palestrante/form/:token', async (req, res) => {
  try {
    const r = await query('SELECT * FROM palestrantes WHERE token_form=$1', [req.params.token]);
    if(!r.rows.length) return res.status(404).send('<h2>Link inválido ou expirado.</h2>');
    res.render('pages/form-palestrante', {
      config: await getConfig(),
      palestrante: r.rows[0],
      enviado: false,
      erro: null
    });
  } catch(e) { res.send('ERRO: ' + e.message); }
});

router.post('/palestrante/form/:token', async (req, res) => {
  try {
    const r = await query('SELECT * FROM palestrantes WHERE token_form=$1', [req.params.token]);
    if(!r.rows.length) return res.status(404).send('<h2>Link inválido.</h2>');
    const { nome_completo, email, whatsapp, rg_ci, especialidade, instituicao,
      endereco_pais, endereco_cep, endereco_rua, endereco_numero, endereco_complemento,
      endereco_bairro, endereco_cidade, endereco_estado } = req.body;
    await query(
      `UPDATE palestrantes SET nome_completo=$1,email=$2,whatsapp=$3,rg_ci=$4,especialidade=$5,
        instituicao=$6,endereco_pais=$7,endereco_cep=$8,endereco_rua=$9,endereco_numero=$10,
        endereco_complemento=$11,endereco_bairro=$12,endereco_cidade=$13,endereco_estado=$14,
        preenchido_em=NOW() WHERE token_form=$15`,
      [nome_completo||null,email||null,whatsapp||null,rg_ci||null,especialidade||null,
       instituicao||null,endereco_pais||'Brasil',endereco_cep||null,endereco_rua||null,
       endereco_numero||null,endereco_complemento||null,endereco_bairro||null,
       endereco_cidade||null,endereco_estado||null,req.params.token]
    );
    const updated = await query('SELECT * FROM palestrantes WHERE token_form=$1', [req.params.token]);
    res.render('pages/form-palestrante', {
      config: await getConfig(),
      palestrante: updated.rows[0],
      enviado: true,
      erro: null
    });
  } catch(e) { res.send('ERRO: ' + e.message); }
});



// BACKUP MANUAL
router.get('/admin/backup/download', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tabelas = ['usuarios','configuracoes','membros','diretivos', 'cientifico','cobrancas','fluxo_caixa','eventos','evento_lotes','evento_inscricoes','evento_pagamentos','evento_certificados','evento_campos','evento_cupons','evento_programacao','evento_palestrantes','evento_patrocinadores','listas_assinaturas','desvinculacoes','cartas_cobranca','calendario_atividades','calendario_categorias','sorteios','sorteio_participantes','palestrantes','marketing_posts','marketing_midias','marketing_config','contratos_diretivos'];
    const linhas = ['-- BACKUP LAURO ' + new Date().toISOString(), 'BEGIN;'];
    for (const t of tabelas) {
      try {
        const ex = await query('SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)', [t]);
        if (!ex.rows[0].exists) continue;
        const r = await query('SELECT * FROM ' + t + ' ORDER BY 1');
        linhas.push('-- ' + t + ' (' + r.rows.length + ' registros)');
        for (const row of r.rows) {
          const cols = Object.keys(row).map(c => '"' + c + '"').join(', ');
          const vals = Object.values(row).map(v => {
            if (v === null) return 'NULL';
            if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
            if (typeof v === 'number') return String(v);
            if (v instanceof Date) return "'" + v.toISOString() + "'";
            return "'" + String(v).replace(/'/g, "''") + "'";
          }).join(', ');
          linhas.push('INSERT INTO ' + t + ' (' + cols + ') VALUES (' + vals + ') ON CONFLICT DO NOTHING;');
        }
      } catch(e) { linhas.push('-- ERRO ' + t + ': ' + e.message); }
    }
    linhas.push('COMMIT;');
    const dataStr = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="backup-lauro-' + dataStr + '.sql"');
    res.send(linhas.join('\n'));
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});



// ═══════════════════════════════════════════════════════════════════════════
// CHECK-OUT DE EVENTOS — confirmação de presença
// ═══════════════════════════════════════════════════════════════════════════

// Página pública de check-out
router.get('/checkout/:id', async (req, res) => {
  try {
    const evR = await query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
    if (!evR.rows[0]) return res.status(404).send('Evento não encontrado.');
    const evento = evR.rows[0];
    const cfgPub = await getConfig();
    // Verifica se está aberto (flag manual) e dentro do prazo (se houver)
    let aberto = evento.checkout_aberto === true;
    if (aberto && evento.checkout_fecha_em && new Date(evento.checkout_fecha_em) < new Date()) aberto = false;
    res.render('pages/evento-checkout-publico', { evento, config: cfgPub, aberto, sucesso: false, jaConfirmado: false, erro: null, nome: null });
  } catch(e) { console.error('Checkout GET erro:', e.message); res.status(500).send('Erro ao carregar.'); }
});

// Registrar check-out (público)
router.post('/checkout/:id', async (req, res) => {
  try {
    const evR = await query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
    if (!evR.rows[0]) return res.status(404).send('Evento não encontrado.');
    const evento = evR.rows[0];
    const cfgPub = await getConfig();

    // Revalida abertura no servidor (segurança)
    let aberto = evento.checkout_aberto === true;
    if (aberto && evento.checkout_fecha_em && new Date(evento.checkout_fecha_em) < new Date()) aberto = false;
    if (!aberto) {
      return res.render('pages/evento-checkout-publico', { evento, config: cfgPub, aberto: false, sucesso: false, jaConfirmado: false, erro: 'O check-out deste evento está encerrado.', nome: null });
    }

    const email = (req.body.email || '').trim().toLowerCase();
    const docLimpo = (req.body.documento || req.body.rg || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (!email || !docLimpo) {
      return res.render('pages/evento-checkout-publico', { evento, config: cfgPub, aberto: true, sucesso: false, jaConfirmado: false, erro: 'Completa el correo y el RG/CI/DNI.', nome: null });
    }

    // Busca a inscrição por email OU documento (RG/CI/DNI) no evento
    const insR = await query(
      `SELECT id, nome, status, isento, email, rg FROM evento_inscricoes
       WHERE evento_id=$1 AND (LOWER(email)=$2 OR regexp_replace(LOWER(COALESCE(rg,'')),'[^a-z0-9]','','g')=$3)`,
      [req.params.id, email, docLimpo]
    );
    const inscricao = insR.rows[0] || null;

    // Verifica se já existe check-out para esta pessoa (evita duplicata)
    let jaExiste;
    if (inscricao) {
      jaExiste = await query('SELECT id FROM evento_checkouts WHERE evento_id=$1 AND inscricao_id=$2 LIMIT 1', [req.params.id, inscricao.id]);
    } else {
      jaExiste = await query("SELECT id FROM evento_checkouts WHERE evento_id=$1 AND (LOWER(email)=$2 OR regexp_replace(LOWER(COALESCE(cpf,'')),'[^a-z0-9]','','g')=$3) LIMIT 1", [req.params.id, email, docLimpo]);
    }
    if (jaExiste.rows.length > 0) {
      const nomeJa = inscricao ? inscricao.nome.split(' ')[0] : null;
      return res.render('pages/evento-checkout-publico', { evento, config: cfgPub, aberto: true, sucesso: false, jaConfirmado: true, erro: null, nome: nomeJa });
    }

    // Registra o check-out (vinculando à inscrição se achou)
    await query(
      'INSERT INTO evento_checkouts (evento_id, inscricao_id, email, cpf, nome_informado, ip) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.params.id, inscricao ? inscricao.id : null, email, docLimpo, inscricao ? inscricao.nome : null, (req.headers['x-forwarded-for']||req.ip||'').toString().split(',')[0].trim()]
    );

    const nome = inscricao ? inscricao.nome.split(' ')[0] : null;

    // Email de confirmação (só quando bateu com inscrição válida)
    if (inscricao && inscricao.email) {
      try {
        const { enviarEmail } = require('../services/notificacoes');
        const orgNome = cfgPub.org_nome || 'Liga Académica de Urología';
        const orgLogo = cfgPub.org_logo || null;
        const logoHtml = orgLogo ? '<div style="width:80px;height:80px;border-radius:50%;background:white;margin:0 auto;padding:8px;box-sizing:border-box"><img src="'+orgLogo+'" style="width:64px;height:64px;object-fit:contain;border-radius:50%"></div>' : '';
        const primeiro = inscricao.nome.split(' ')[0];
        const htmlCk = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td><div style="background:linear-gradient(160deg,#1a3d2b 0%,#0a1f1a 100%);padding:32px 40px;text-align:center">'+logoHtml+'<div style="margin-top:12px;display:inline-block;background:rgba(34,197,94,0.2);border-radius:4px;padding:4px 16px"><span style="color:#86efac;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase">✅ ASISTENCIA CONFIRMADA</span></div></div></td></tr><tr><td style="background:white;padding:36px 40px"><h2 style="margin:0 0 8px;font-size:20px;color:#0f172a">¡Hola, '+primeiro+'!</h2><p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.7">Tu <strong>asistencia</strong> al evento <strong>'+evento.nome+'</strong> fue registrada con éxito. ✅</p><div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin-bottom:24px"><p style="margin:0;font-size:13px;color:#166534">Este registro confirma que estuviste presente en el evento. Tu certificado será procesado conforme las reglas del evento.</p></div><p style="margin:0;font-size:12px;color:#94a3b8">¿Dudas? Contáctanos por WhatsApp o responde a este correo.</p></td></tr><tr><td style="background:#0f172a;padding:24px 40px"><p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;font-weight:600">'+orgNome+'</p><p style="margin:4px 0 0;color:rgba(255,255,255,0.4);font-size:10px">Liga Académica de Urología — UCP | Ciudad del Este</p></td></tr></table></td></tr></table></body></html>';
        const textoCk = 'Hola, '+primeiro+'! Tu asistencia al evento '+evento.nome+' fue registrada con éxito.';
        enviarEmail({ para: inscricao.email, assunto: '✅ Asistencia confirmada — '+evento.nome, html: htmlCk, texto: textoCk }).catch(function(e){ console.error('Email checkout erro:', e.message); });
      } catch(e) { console.error('Email checkout falhou:', e.message); }
    }

    res.render('pages/evento-checkout-publico', { evento, config: cfgPub, aberto: true, sucesso: true, jaConfirmado: false, erro: null, nome });
  } catch(e) { console.error('Checkout POST erro:', e.message); res.status(500).send('Erro ao registrar.'); }
});

// Abrir / Encerrar check-out (painel)
router.post('/eventos/:id/checkout-toggle', requireAuth, async (req, res) => {
  try {
    const acao = req.body.acao;
    if (acao === 'abrir') {
      const fecha = req.body.fecha_em ? req.body.fecha_em : null;
      await query('UPDATE eventos SET checkout_aberto=true, checkout_fecha_em=$1 WHERE id=$2', [fecha, req.params.id]);
      req.session.msg = ['Check-out ABERTO para recebimento.'];
    } else {
      await query('UPDATE eventos SET checkout_aberto=false WHERE id=$1', [req.params.id]);
      req.session.msg = ['Check-out ENCERRADO.'];
    }
  } catch(e) { req.session.erro = [e.message]; }
  res.redirect('/eventos/' + req.params.id + '?tab=checkout');
});

// Relatório de check-out (painel) — JSON consumido pela aba
router.get('/eventos/:id/checkout-relatorio', requireAuth, async (req, res) => {
  try {
    const evR = await query('SELECT id, nome, checkout_aberto, checkout_fecha_em FROM eventos WHERE id=$1', [req.params.id]);
    if (!evR.rows[0]) return res.json({ok:false, erro:'Evento não encontrado'});

    // Inscritos válidos (confirmado, pago ou isento)
    const inscritos = await query(
      `SELECT id, nome, email, cpf, status, isento FROM evento_inscricoes WHERE evento_id=$1`,
      [req.params.id]
    );
    // Check-outs do evento
    const checkouts = await query(
      `SELECT inscricao_id, email, cpf, nome_informado, criado_em FROM evento_checkouts WHERE evento_id=$1 ORDER BY criado_em`,
      [req.params.id]
    );

    // Conjunto de inscrição_ids que fizeram check-out
    const fezCheckout = new Set(checkouts.rows.filter(c => c.inscricao_id).map(c => c.inscricao_id));

    const aptos = [];        // inscrição válida + fez check-out
    const naoCompareceu = []; // inscrição válida + NÃO fez check-out
    inscritos.rows.forEach(i => {
      const valida = i.status === 'confirmado'; // confirmado cobre pago e isento (ambos ficam confirmado)
      if (!valida) return;
      if (fezCheckout.has(i.id)) aptos.push({ id: i.id, nome: i.nome, email: i.email, isento: i.isento });
      else naoCompareceu.push({ nome: i.nome, email: i.email, isento: i.isento });
    });

    // Check-outs sem inscrição válida (não bateu) — pra revisar
    const semInscricao = checkouts.rows.filter(c => !c.inscricao_id).map(c => ({ email: c.email, cpf: c.cpf, quando: c.criado_em }));
    // Ordena alfabeticamente por nome (pt-BR, ignora acentos na ordenação)
    const _ord = (a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' });
    aptos.sort(_ord);
    naoCompareceu.sort(_ord);

    res.json({
      ok: true,
      evento: evR.rows[0],
      resumo: { aptos: aptos.length, nao_compareceu: naoCompareceu.length, sem_inscricao: semInscricao.length, total_checkouts: checkouts.rows.length },
      aptos, naoCompareceu, semInscricao
    });
  } catch(e) { console.error('Relatorio checkout erro:', e.message); res.json({ok:false, erro:e.message}); }
});

router.post('/eventos/:id/inscricao/:inscricao_id/desfazer-checkout', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM evento_checkouts WHERE evento_id=$1 AND inscricao_id=$2', [req.params.id, req.params.inscricao_id]);
    res.json({ok:true});
  } catch(e) { res.json({ok:false, erro:e.message}); }
});

// Exportar lista de aptos em CSV (painel)
router.get('/eventos/:id/checkout-export', requireAuth, async (req, res) => {
  try {
    const [evR, inscritos] = await Promise.all([
      query('SELECT nome FROM eventos WHERE id=$1', [req.params.id]),
      query(
        `SELECT i.nome, i.email, i.cpf, i.rg, i.catraca, i.tipo_participante,
                i.isento,
                to_char(c.criado_em, 'DD/MM/YYYY HH24:MI') as checkout_em
         FROM evento_inscricoes i
         LEFT JOIN evento_checkouts c ON c.inscricao_id=i.id
         WHERE i.evento_id=$1 AND i.status='confirmado'
           AND EXISTS (SELECT 1 FROM evento_checkouts ec WHERE ec.inscricao_id=i.id)
         ORDER BY i.nome`,
        [req.params.id]
      )
    ]);
    const nomeEv = (evR.rows[0]?.nome || 'evento').replace(/[^a-z0-9]/gi,'_').substring(0,30);
    const cabecalho = ['Nome Completo','Email','CPF','RG','Catraca','Tipo Participante','Pagamento','Check-out em'];
    let csv = cabecalho.join(';') + '\n';
    inscritos.rows.forEach(r => {
      const tipoRaw = (r.tipo_participante || 'externo').toLowerCase().trim();
      const tipo = tipoRaw === 'ucp' ? 'Aluno UCP' : tipoRaw === 'externo' ? 'Externo' : r.tipo_participante || 'Externo';
      csv += [
        r.nome || '',
        r.email || '',
        r.cpf || '',
        r.rg || '',
        r.catraca || '',
        tipo,
        r.isento ? 'Isento' : 'Pago',
        r.checkout_em || ''
      ].map(v => '"' + String(v).replace(/"/g,'""') + '"').join(';') + '\n';
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="aptos-' + nomeEv + '.csv"');
    res.send('\uFEFF' + csv);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});


// GET /fluxo-caixa/doc/:id/visualizar — proxy para visualizar documento
router.get('/fluxo-caixa/doc/visualizar', requireAuth, async (req, res) => {
  try {
    const chave = req.query.chave;
    if (!chave) return res.status(400).send('Chave não informada');
    const { gerarUrlInline } = require('../services/arquivos');
    const url = await gerarUrlInline(chave);
    res.redirect(url);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

// GET /fluxo-caixa/doc/baixar — proxy para baixar documento
router.get('/fluxo-caixa/doc/baixar', requireAuth, async (req, res) => {
  try {
    const { chave, nome } = req.query;
    if (!chave) return res.status(400).send('Chave não informada');
    const { gerarUrlDownload } = require('../services/arquivos');
    const url = await gerarUrlDownload(chave, nome || 'documento');
    res.redirect(url);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

// ─── LAURO — DIAGNÓSTICO E CONTATOS (admin + presidência) ────────────────────
router.get('/admin/lauro-diagnostico', requirePresidencia, async (req, res) => {
  try {
    const config = await getConfig();
    const perfil = req.session.usuario.perfil;
    const contatos = await query('SELECT * FROM lauro_contatos ORDER BY area');
    // Admin vê todos; presidência vê só os dela
    const atendimentos = perfil === 'admin'
      ? await query("SELECT * FROM lauro_atendimentos ORDER BY criado_em DESC LIMIT 50")
      : await query("SELECT * FROM lauro_atendimentos WHERE area='presidencia' ORDER BY criado_em DESC LIMIT 50");
    res.render('pages/lauro-diagnostico', { config, contatos: contatos.rows, atendimentos: atendimentos.rows, msg: req.flash('msg'), erro: req.flash('erro'), perfil });
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.post('/admin/lauro-contato', requirePresidencia, async (req, res) => {
  try {
    const area = Array.isArray(req.body.area) ? req.body.area[0] : req.body.area;
    const numero = Array.isArray(req.body.numero) ? req.body.numero[0] : req.body.numero;
    const num = String(numero || '').replace(/[^0-9]/g, '');
    await query(
      'INSERT INTO lauro_contatos (area, numero, nome, atualizado_em) VALUES ($1,$2,$3,NOW()) ON CONFLICT (area) DO UPDATE SET numero=$2, nome=$3, atualizado_em=NOW()',
      [area, num, area]
    );
    const { recarregarContatos } = require('../services/lauro');
    await recarregarContatos();
    req.flash('msg', 'Contato de ' + area + ' atualizado: ' + num);
    res.redirect('/admin/lauro-diagnostico');
  } catch(e) { req.flash('erro', e.message); res.redirect('/admin/lauro-diagnostico'); }
});

router.post('/admin/lauro-encerrar/:id', requirePresidencia, async (req, res) => {
  try {
    await query("UPDATE lauro_atendimentos SET status='encerrado', encerrado_em=NOW() WHERE id=$1", [req.params.id]);
    req.flash('msg', 'Atendimento encerrado.');
    res.redirect('/admin/lauro-diagnostico');
  } catch(e) { req.flash('erro', e.message); res.redirect('/admin/lauro-diagnostico'); }
});

// ─── LAURO — ATENDIMENTOS POR ÁREA (cada área vê só os seus) ────────────────
router.get('/lauro-atendimentos', requireAuth, async (req, res) => {
  try {
    const config = await getConfig();
    const perfil = req.session.usuario.perfil;
    const areasValidas = ['secretaria','financeiro','cientifico','extensao','ensino','marketing'];
    if (!areasValidas.includes(perfil)) return res.redirect('/dashboard');
    const atendimentos = await query(
      "SELECT * FROM lauro_atendimentos WHERE area=$1 ORDER BY criado_em DESC LIMIT 50",
      [perfil]
    );
    res.render('pages/lauro-atendimentos', { config, atendimentos: atendimentos.rows, area: perfil, msg: req.flash('msg'), erro: req.flash('erro') });
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.post('/lauro-encerrar/:id', requireAuth, async (req, res) => {
  try {
    const perfil = req.session.usuario.perfil;
    const areasValidas = ['secretaria','financeiro','cientifico','extensao','ensino','marketing'];
    if (!areasValidas.includes(perfil)) return res.status(403).send('Sem permissão.');
    // Verifica que o atendimento pertence à área do usuário
    const at = await query("SELECT id FROM lauro_atendimentos WHERE id=$1 AND area=$2", [req.params.id, perfil]);
    if (!at.rows.length) { req.flash('erro', 'Atendimento não encontrado.'); return res.redirect('/lauro-atendimentos'); }
    await query("UPDATE lauro_atendimentos SET status='encerrado', encerrado_em=NOW() WHERE id=$1", [req.params.id]);
    req.flash('msg', 'Atendimento encerrado.');
    res.redirect('/lauro-atendimentos');
  } catch(e) { req.flash('erro', e.message); res.redirect('/lauro-atendimentos'); }
});

// GET /admin/lauro-teste-wapi — dispara mensagem de teste e mostra resultado W-API
// ?area=presidencia  -> testa o número cadastrado da área
// ?numero=557999444808 -> testa um número específico (qualquer formato)
router.get('/admin/lauro-teste-wapi', requireAdmin, async (req, res) => {
  try {
    const axios = require('axios');
    const instanceId = process.env.WAPI_INSTANCE_ID;
    const token = process.env.WAPI_TOKEN;

    // Verifica status da conexão da instância (se desconectada, nada é entregue)
    let statusInstancia = null;
    const statusEndpoints = [
      `https://api.w-api.app/v1/instance/status-instance?instanceId=${instanceId}`,
      `https://api.w-api.app/v1/instance/device?instanceId=${instanceId}`,
      `https://api.w-api.app/v1/instance/me?instanceId=${instanceId}`
    ];
    for (const url of statusEndpoints) {
      try {
        const s = await axios.get(url, { headers: { 'Authorization': `Bearer ${token}` }, timeout: 10000 });
        statusInstancia = { url, data: s.data };
        break;
      } catch(e) {
        statusInstancia = { url, erro: e.response?.status, detalhe: e.response?.data || e.message };
      }
    }

    const enviarTeste = async (phone, label) => {
      try {
        const resp = await axios.post(
          `https://api.w-api.app/v1/message/send-text?instanceId=${instanceId}`,
          { phone, message: `[LAURO TESTE ${label}] Se você recebeu esta mensagem, o número ${phone} ESTÁ correto. Hora: ${new Date().toLocaleString('pt-BR',{timeZone:'America/Asuncion'})}` },
          { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, timeout: 20000 }
        );
        return { numero: phone, label, status: resp.status, body: resp.data, ok: true };
      } catch(e) {
        return { numero: phone, label, status: e.response?.status, body: e.response?.data || e.message, ok: false };
      }
    };

    const resultados = [];

    // Modo 1: número específico via ?numero=
    if (req.query.numero) {
      const n = String(req.query.numero).replace(/[^0-9]/g, '');
      resultados.push(await enviarTeste(n, 'CUSTOM'));
      // Se for número BR (55) com 13 dígitos, testa também SEM o 9º dígito
      if (n.startsWith('55') && n.length === 13) {
        const sem9 = n.slice(0, 4) + n.slice(5); // remove o dígito após o DDD
        resultados.push(await enviarTeste(sem9, 'BR-SEM-9'));
      }
      // Se for número BR (55) com 12 dígitos, testa também COM o 9º dígito
      if (n.startsWith('55') && n.length === 12) {
        const com9 = n.slice(0, 4) + '9' + n.slice(4);
        resultados.push(await enviarTeste(com9, 'BR-COM-9'));
      }
      return res.json({ instanceId, statusInstancia, instrucao: 'Veja qual LABEL chegou no seu WhatsApp — esse é o formato correto.', resultados });
    }

    // Modo 2: número cadastrado da área via ?area=
    const { recarregarContatos } = require('../services/lauro');
    await recarregarContatos();
    const { query: q2 } = require('../models/database');
    const contatos = await q2("SELECT area, numero FROM lauro_contatos WHERE numero != '' ORDER BY area");
    const areaAlvo = req.query.area || null;
    for (const c of contatos.rows) {
      if (areaAlvo && c.area !== areaAlvo) continue;
      const r = await enviarTeste(c.numero, c.area);
      r.area = c.area;
      resultados.push(r);
    }
    res.json({ instanceId, resultados });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// GET /api/evolution-qr — gera QR code para conectar WhatsApp
router.get('/api/evolution-qr', async (req, res) => {
  try {
    const axios = require('axios');
    const r = await axios.get('http://localhost:8080/instance/connect/lauro-liga', {
      headers: { 'apikey': 'lauro-evolution-2026-key' }
    });
    res.json(r.data);
  } catch(e) { res.json({ erro: e.message }); }
});

// ─── BUSCA GLOBAL ─────────────────────────────────────────────────────────
router.get('/buscar', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  const like = '%' + q + '%';
  let ligantes = [], membros = [], diretivos = [], eventos = [], cobrancas = [];

  if (q.length >= 1) {
    try {
      const r = await query("SELECT id, nome, email, whatsapp, semestre, turma FROM ligantes WHERE nome ILIKE $1 OR email ILIKE $1 OR whatsapp ILIKE $1 OR rg ILIKE $1 OR cpf ILIKE $1 ORDER BY nome LIMIT 30", [like]);
      ligantes = r.rows;
    } catch (e) { console.error('busca ligantes:', e.message); }

    try {
      const r = await query("SELECT id, nome, email, whatsapp, status FROM membros WHERE nome ILIKE $1 OR email ILIKE $1 OR whatsapp ILIKE $1 OR cpf ILIKE $1 OR rg ILIKE $1 ORDER BY nome LIMIT 30", [like]);
      membros = r.rows;
    } catch (e) { console.error('busca membros:', e.message); }

    try {
      const r = await query("SELECT id, nome, email, whatsapp, cargo FROM diretivos WHERE nome ILIKE $1 OR email ILIKE $1 OR whatsapp ILIKE $1 OR rg ILIKE $1 OR cpf ILIKE $1 ORDER BY nome LIMIT 30", [like]);
      diretivos = r.rows;
    } catch (e) { console.error('busca diretivos:', e.message); }

    try {
      const r = await query("SELECT id, nome, status, data_inicio, local FROM eventos WHERE nome ILIKE $1 OR descricao ILIKE $1 OR local ILIKE $1 ORDER BY data_inicio DESC NULLS LAST LIMIT 30", [like]);
      eventos = r.rows;
    } catch (e) { console.error('busca eventos:', e.message); }

    try {
      const r = await query("SELECT c.*, m.nome AS membro_nome FROM cobrancas c LEFT JOIN membros m ON m.id = c.membro_id WHERE m.nome ILIKE $1 ORDER BY c.id DESC LIMIT 30", [like]);
      cobrancas = r.rows;
    } catch (e) { console.error('busca cobrancas:', e.message); }
  }

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const total = ligantes.length + membros.length + diretivos.length + eventos.length + cobrancas.length;
  const join = (arr) => arr.filter(Boolean).map(esc).join(' · ');
  const tag = (st) => {
    const s = String(st || '').toLowerCase();
    if (s.indexOf('atras') >= 0) return '<span class="tag t-at">atrasado</span>';
    if (s.indexOf('pag') >= 0) return '<span class="tag t-ok">pago</span>';
    if (s.indexOf('pend') >= 0) return '<span class="tag t-pe">pendente</span>';
    if (s) return '<span class="tag t-pe">' + esc(s) + '</span>';
    return '';
  };

  let corpo = '';
  if (ligantes.length) corpo += '<section class="grp"><h2>Ligantes <span>' + ligantes.length + '</span></h2><div class="cards">' +
    ligantes.map(function (l) { return '<a class="card" href="/ligantes"><div class="nm">' + esc(l.nome) + '</div><div class="meta">' + join([l.email, l.whatsapp, l.semestre && ('Sem. ' + l.semestre), l.turma && ('Turma ' + l.turma)]) + '</div></a>'; }).join('') + '</div></section>';

  if (membros.length) corpo += '<section class="grp"><h2>Membros <span>' + membros.length + '</span></h2><div class="cards">' +
    membros.map(function (m) { return '<a class="card" href="/membros"><div class="nm">' + esc(m.nome) + tag(m.status) + '</div><div class="meta">' + join([m.email, m.whatsapp]) + '</div></a>'; }).join('') + '</div></section>';

  if (diretivos.length) corpo += '<section class="grp"><h2>Diretivos <span>' + diretivos.length + '</span></h2><div class="cards">' +
    diretivos.map(function (d) { return '<a class="card" href="/diretivos"><div class="nm">' + esc(d.nome) + '</div><div class="meta">' + join([d.cargo, d.email, d.whatsapp]) + '</div></a>'; }).join('') + '</div></section>';

  if (eventos.length) corpo += '<section class="grp"><h2>Eventos <span>' + eventos.length + '</span></h2><div class="cards">' +
    eventos.map(function (ev) { var dt = ''; try { if (ev.data_inicio) dt = new Date(ev.data_inicio).toLocaleDateString('pt-BR'); } catch (e) {} return '<a class="card" href="/eventos/' + ev.id + '"><div class="nm">' + esc(ev.nome) + (ev.status ? tag(ev.status) : '') + '</div><div class="meta">' + join([dt, ev.local]) + '</div></a>'; }).join('') + '</div></section>';

  if (cobrancas.length) corpo += '<section class="grp"><h2>Cobranças <span>' + cobrancas.length + '</span></h2><div class="cards">' +
    cobrancas.map(function (c) { var val = (c.valor != null) ? ('R$ ' + Number(c.valor).toFixed(2).replace('.', ',')) : ''; return '<a class="card" href="/cobrancas"><div class="nm">' + esc(c.membro_nome || 'Cobrança') + tag(c.status) + '</div><div class="meta">' + join([val]) + '</div></a>'; }).join('') + '</div></section>';

  if (q && total === 0) corpo = '<div class="vazio">Nenhum resultado encontrado para "<b>' + esc(q) + '</b>".</div>';

  const html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Busca — LAURO</title><style>'
    + '*{box-sizing:border-box;margin:0;padding:0}'
    + 'body{font-family:Segoe UI,system-ui,sans-serif;background:#f4f6f3;color:#1c2620;padding:24px}'
    + '.wrap{max-width:880px;margin:0 auto}'
    + '.back{display:inline-flex;align-items:center;gap:6px;text-decoration:none;color:#fff;background:#1a3d2b;padding:9px 16px;border-radius:8px;font-size:14px;font-weight:600}'
    + '.back:hover{background:#2b6803}'
    + 'h1{font-size:20px;font-weight:700;margin:18px 0 4px}'
    + '.sub{color:#5b6b60;font-size:14px;margin-bottom:22px}'
    + 'form.bar{display:flex;gap:8px;margin-bottom:26px}'
    + 'form.bar input{flex:1;border:1px solid #cdd6cf;border-radius:8px;padding:11px 14px;font-size:15px}'
    + 'form.bar button{background:#2b6803;color:#fff;border:0;border-radius:8px;padding:0 20px;font-weight:600;cursor:pointer}'
    + '.grp{margin-bottom:24px}'
    + '.grp h2{font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#3a4a40;margin-bottom:10px;font-weight:700}'
    + '.grp h2 span{background:#e3ede5;color:#2b6803;border-radius:20px;padding:2px 9px;font-size:12px;margin-left:6px}'
    + '.cards{display:flex;flex-direction:column;gap:8px}'
    + '.card{display:block;background:#fff;border:1px solid #e6ece7;border-radius:10px;padding:13px 16px;text-decoration:none;color:inherit;transition:.15s}'
    + '.card:hover{border-color:#2b6803;box-shadow:0 3px 12px rgba(43,104,3,.10);transform:translateY(-1px)}'
    + '.card .nm{font-weight:600;font-size:15px;color:#172419}'
    + '.card .meta{font-size:13px;color:#69786e;margin-top:3px}'
    + '.tag{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;margin-left:8px;vertical-align:middle}'
    + '.t-at{background:#fdeaea;color:#c0392b}.t-ok{background:#e7f6ea;color:#1e7d34}.t-pe{background:#fef6e3;color:#b8860b}'
    + '.vazio{text-align:center;color:#7a897f;padding:50px 20px;background:#fff;border:1px dashed #d3ddd5;border-radius:12px}'
    + '</style></head><body><div class="wrap">'
    + '<a class="back" href="/dashboard">&larr; Voltar ao painel</a>'
    + '<h1>Resultados da busca</h1>'
    + '<div class="sub">' + (q ? ('Você buscou por "<b>' + esc(q) + '</b>" &mdash; ' + total + ' resultado(s)') : 'Digite algo para buscar') + '</div>'
    + '<form class="bar" action="/buscar" method="get"><input name="q" value="' + esc(q) + '" placeholder="Buscar ligantes, membros, eventos, cobranças..." autofocus><button type="submit">Buscar</button></form>'
    + corpo
    + '</div></body></html>';

  res.send(html);
});



// ─── INVENTÁRIO PATRIMONIAL ───────────────────────────────────────────────────

router.get('/inventario', requireAuth, requirePermissao('inventario'), async (req, res) => {
  const config = await getConfig();
  const busca = req.query.busca || '';
  const categoria = req.query.categoria || '';
  const estado = req.query.estado || '';
  const situacao = req.query.situacao || 'ativos';
  const params = [];
  let where = situacao === 'inativos' ? 'WHERE i.ativo=0' : situacao === 'todos' ? 'WHERE 1=1' : 'WHERE i.ativo=1';
  let idx = 1;
  if (busca) { where += ' AND (i.nome ILIKE $' + idx + ' OR i.codigo ILIKE $' + idx + ' OR i.responsavel ILIKE $' + idx + ')'; params.push('%' + busca + '%'); idx++; }
  if (categoria) { where += ' AND i.categoria_id=$' + idx; params.push(categoria); idx++; }
  if (estado) { where += ' AND i.estado=$' + idx; params.push(estado); idx++; }
  const [itens, categorias, stats] = await Promise.all([
    query('SELECT i.*, c.nome as categoria_nome, c.cor as categoria_cor FROM inventario_itens i LEFT JOIN inventario_categorias c ON c.id=i.categoria_id ' + where + ' ORDER BY i.criado_em DESC', params),
    query('SELECT * FROM inventario_categorias ORDER BY nome'),
    query("SELECT COUNT(*) FILTER (WHERE i.ativo=1) as total, COUNT(*) FILTER (WHERE i.estado='danificado' AND i.ativo=1) as danificados, COUNT(*) FILTER (WHERE i.estado='perdido' AND i.ativo=1) as perdidos, COALESCE(SUM(i.valor_estimado) FILTER (WHERE i.ativo=1),0) as valor_total, COALESCE(SUM(i.valor_estimado_brl) FILTER (WHERE i.ativo=1),0) as valor_total_brl, (SELECT COUNT(*) FROM (SELECT DISTINCT ON (item_id) item_id, tipo FROM inventario_movimentacoes ORDER BY item_id, criado_em DESC) t WHERE t.tipo='emprestimo') as emprestados FROM inventario_itens i")
  ]);
  res.render('pages/inventario', { config, usuario: req.session.usuario, itens: itens.rows, categorias: categorias.rows, stats: stats.rows[0], busca, categoria, estado, situacao, msg: req.flash('msg'), erro: req.flash('erro') });
});

router.post('/inventario', requireAuth, async (req, res) => {
  const { nome, descricao, categoria_id, estado, localizacao, valor_estimado, valor_estimado_brl, data_aquisicao, responsavel, observacoes, codigo_etiqueta } = req.body;
  const ano = new Date().getFullYear();
  const last = await query('SELECT codigo FROM inventario_itens WHERE codigo LIKE $1 ORDER BY codigo DESC LIMIT 1', ['LIG-' + ano + '-%']);
  let seq = 1;
  if (last.rows.length) { const p = last.rows[0].codigo.split('-'); seq = (parseInt(p[2]) || 0) + 1; }
  const codigo = 'LIG-' + ano + '-' + String(seq).padStart(3, '0');
  await query('INSERT INTO inventario_itens (codigo,nome,descricao,categoria_id,estado,localizacao,valor_estimado,valor_estimado_brl,data_aquisicao,responsavel,observacoes,codigo_etiqueta) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [codigo, nome, descricao || null, categoria_id || null, estado || 'otimo', localizacao || null, valor_estimado || null, valor_estimado_brl || null, data_aquisicao || null, responsavel || null, observacoes || null, codigo_etiqueta || null]);
  req.flash('msg', 'Item ' + codigo + ' cadastrado com sucesso!');
  res.redirect('/inventario');
});

router.post('/inventario/:id/editar', requireAuth, async (req, res) => {
  const { nome, descricao, categoria_id, estado, localizacao, valor_estimado, valor_estimado_brl, data_aquisicao, responsavel, observacoes, codigo_etiqueta } = req.body;
  await query('UPDATE inventario_itens SET nome=$1,descricao=$2,categoria_id=$3,estado=$4,localizacao=$5,valor_estimado=$6,valor_estimado_brl=$7,data_aquisicao=$8,responsavel=$9,observacoes=$10,codigo_etiqueta=$11,atualizado_em=NOW() WHERE id=$12',
    [nome, descricao || null, categoria_id || null, estado, localizacao || null, valor_estimado || null, valor_estimado_brl || null, data_aquisicao || null, responsavel || null, observacoes || null, codigo_etiqueta || null, req.params.id]);
  req.flash('msg', 'Item atualizado com sucesso!');
  res.redirect('/inventario');
});

router.post('/inventario/:id/movimentacao', requireAuth, async (req, res) => {
  const { tipo, descricao, responsavel, data_mov } = req.body;
  await query('INSERT INTO inventario_movimentacoes (item_id,tipo,descricao,responsavel,data_mov) VALUES ($1,$2,$3,$4,$5)',
    [req.params.id, tipo, descricao || null, responsavel || null, data_mov || null]);
  req.flash('msg', 'Movimentação registrada!');
  res.redirect('/inventario');
});

router.post('/inventario/:id/desativar', requireAuth, async (req, res) => {
  await query('UPDATE inventario_itens SET ativo=0 WHERE id=$1', [req.params.id]);
  req.flash('msg', 'Item removido do inventário.');
  res.redirect('/inventario');
});

router.get('/inventario/:id/dados', requireAuth, requirePermissao('inventario'), async (req, res) => {
  const [item, hist, cats] = await Promise.all([
    query('SELECT i.*, c.nome as categoria_nome FROM inventario_itens i LEFT JOIN inventario_categorias c ON c.id=i.categoria_id WHERE i.id=$1', [req.params.id]),
    query('SELECT * FROM inventario_movimentacoes WHERE item_id=$1 ORDER BY criado_em DESC LIMIT 30', [req.params.id]),
    query('SELECT * FROM inventario_categorias ORDER BY nome')
  ]);
  if (!item.rows.length) return res.json({ erro: 'Nao encontrado' });
  res.json({ item: item.rows[0], historico: hist.rows, categorias: cats.rows });
});

require('./projetos-academicos')(router);
require('./projeto-fluxo')(router);


// ─── POLÍTICA DE PRIVACIDADE PÚBLICA ─────────────────────────────────────────
router.get("/privacidade", (req, res) => {
  res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Política de Privacidade — LAURO Liga CDE</title><style>body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#333;line-height:1.7}h1{color:#1a3d2b}h2{color:#1a3d2b;margin-top:32px}a{color:#1a3d2b}</style></head><body><h1>Política de Privacidade</h1><p><strong>Liga Acadêmica de Urologia — UCP | Ciudad del Este</strong></p><p>Última atualização: junho de 2026</p><h2>1. Informações que coletamos</h2><p>Coletamos informações fornecidas diretamente por você, como nome, e-mail, número de WhatsApp e dados de pagamento, para fins de gestão de membros e eventos acadêmicos.</p><h2>2. Uso das informações</h2><p>As informações coletadas são utilizadas exclusivamente para comunicação institucional, cobrança de mensalidades, notificações de eventos e gestão da liga acadêmica.</p><h2>3. Compartilhamento</h2><p>Não compartilhamos seus dados com terceiros, exceto quando necessário para processamento de pagamentos (PagBank) ou cumprimento de obrigações legais.</p><h2>4. Segurança</h2><p>Adotamos medidas técnicas e organizacionais para proteger seus dados contra acesso não autorizado, perda ou divulgação indevida.</p><h2>5. Seus direitos</h2><p>Você pode solicitar acesso, correção ou exclusão dos seus dados a qualquer momento pelo e-mail: <a href="mailto:fernando.macedoo@hotmail.com">fernando.macedoo@hotmail.com</a></p><h2>6. Contato</h2><p>Para dúvidas sobre esta política, entre em contato com a secretaria da Liga Acadêmica de Urologia — UCP.</p></body></html>`);
});
// ─── FIM POLÍTICA DE PRIVACIDADE ──────────────────────────────────────────────

// ─── INSTAGRAM OAUTH ──────────────────────────────────────────────────────────
router.get("/auth/instagram/connect", requireAuth, (req, res) => {
  const APP_ID = process.env.META_APP_ID;
  const REDIRECT_URI = process.env.META_REDIRECT_URI;
  const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=instagram_business_basic,instagram_business_content_publish&response_type=code`;
  res.redirect(url);
});

router.get("/auth/instagram/callback", async (req, res) => {
  const { code } = req.query;
  const APP_ID = process.env.META_APP_ID;
  const APP_SECRET = process.env.META_APP_SECRET;
  const REDIRECT_URI = process.env.META_REDIRECT_URI;
  try {
    const axios = require("axios");
    const tokenRes = await axios.get("https://graph.facebook.com/v19.0/oauth/access_token", {
      params: { client_id: APP_ID, client_secret: APP_SECRET, redirect_uri: REDIRECT_URI, code }
    });
    const accessToken = tokenRes.data.access_token;
    const pagesRes = await axios.get("https://graph.facebook.com/v19.0/me/accounts", {
      params: { access_token: accessToken }
    });
    const page = pagesRes.data.data[0];
    const pageToken = page.access_token;
    const pageId = page.id;
    const igRes = await axios.get(`https://graph.facebook.com/v19.0/${pageId}`, {
      params: { fields: "instagram_business_account", access_token: pageToken }
    });
    const igId = igRes.data.instagram_business_account?.id;
    res.send(`<h2>Conectado!</h2><p><b>Page Token:</b><br><textarea rows="4" cols="80">${pageToken}</textarea></p><p><b>Instagram ID:</b> ${igId}</p>`);
  } catch(err) {
    res.send("<h2>Erro</h2><pre>" + JSON.stringify(err.response?.data || err.message, null, 2) + "</pre>");
  }
});
// ─── FIM INSTAGRAM OAUTH ──────────────────────────────────────────────────────
router.get("/api/pendencias", requireAuth, async (req, res) => {
  try {
    const r = await query("SELECT COUNT(*) as total FROM instagram_posts WHERE status='agendado'");
    const lig = await query("SELECT COUNT(*) as total FROM ligantes WHERE status='pendente'"); const dir = await query("SELECT COUNT(*) as total FROM diretivos WHERE status='pendente'"); const pal = await query("SELECT COUNT(*) as total FROM palestrantes WHERE status='pendente' OR ativo=0 LIMIT 1").catch(()=>({rows:[{total:0}]})); const l=parseInt(lig.rows[0].total)||0; const d=parseInt(dir.rows[0].total)||0; const p=parseInt(pal.rows[0].total)||0; res.json({ ok:true, ligantes:l, diretivos:d, palestrantes:p, total:l+d+p });
  } catch(e) { res.json({ ok: true, pendencias: 0 }); }
});

// ─── INSTAGRAM ────────────────────────────────────────────────────────────────
const ig = require("../services/instagram");

router.get("/instagram", requireAuth, async (req, res) => {
  try {
    const posts = await query("SELECT * FROM instagram_posts ORDER BY criado_em DESC LIMIT 50");
    const config = await query("SELECT chave,valor FROM configuracoes WHERE chave LIKE 'instagram%'").then(r => { const c={}; r.rows.forEach(x=>c[x.chave]=x.valor); return c; });
    let feedPosts = [];
    try { feedPosts = await ig.buscarMetricas(); } catch(e) {}
    res.render("pages/instagram", { posts: posts.rows, config, feedPosts, ok: req.query.ok||null, erro: req.query.erro||null });
  } catch(e) { res.redirect("/dashboard?erro=Erro+ao+carregar+Instagram"); }
});

router.post("/instagram/publicar", requireAuth, async (req, res) => {
  const { tipo, midia_url, legenda, midias, agendar, agendado_para } = req.body;
  try {
    if (agendar === "1" && agendado_para) {
      await ig.agendarPost({ tipo, midiaUrl: midia_url, midias: midias ? JSON.parse(midias) : null, legenda, agendadoPara: agendado_para, criadoPor: req.session.userId||null });
      return res.redirect("/instagram?ok=Post+agendado+com+sucesso");
    }
    if (tipo === "feed") await ig.publicarFoto({ imageUrl: midia_url, legenda });
    else if (tipo === "carousel") { const urls = JSON.parse(midias).map(m=>m.url); await ig.publicarCarrossel({ imageUrls: urls, legenda }); }
    else if (tipo === "story") await ig.publicarStory({ imageUrl: midia_url });
    else if (tipo === "reel") await ig.publicarReel({ videoUrl: midia_url, legenda });
    await query("INSERT INTO instagram_posts (tipo,midia_url,midias,legenda,status,publicado_em) VALUES ($1,$2,$3,$4,'publicado',NOW())", [tipo, midia_url||null, midias||null, legenda||null]);
    res.redirect("/instagram?ok=Publicado+com+sucesso+no+Instagram");
  } catch(e) {
    res.redirect("/instagram?erro=" + encodeURIComponent(e.message));
  }
});

router.post("/instagram/agendar/:id/excluir", requireAuth, async (req, res) => {
  await query("DELETE FROM instagram_posts WHERE id=$1 AND status='agendado'", [req.params.id]);
  res.redirect("/instagram?ok=Post+agendado+excluido");
});

router.get("/instagram/metricas/:id", requireAuth, async (req, res) => {
  try {
    const insights = await ig.buscarInsights(req.params.id);
    res.json({ ok: true, insights });
  } catch(e) { res.json({ ok: false, erro: e.message }); }
});

router.post("/instagram/config", requireAuth, async (req, res) => {
  const { instagram_aniversario_ativo, instagram_aniversario_imagem } = req.body;
  await query("INSERT INTO configuracoes (chave,valor) VALUES ('instagram_aniversario_ativo',$1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [instagram_aniversario_ativo||'0']);
  await query("INSERT INTO configuracoes (chave,valor) VALUES ('instagram_aniversario_imagem',$1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [instagram_aniversario_imagem||'']);
  res.redirect("/instagram?ok=Configuracoes+salvas");
});
// ─── FIM INSTAGRAM ────────────────────────────────────────────────────────────

// ─── INSTAGRAM API ROUTES ─────────────────────────────────────────────────────
router.get("/api/instagram/feed", requireAuth, async (req, res) => {
  try { const ig = require("../services/instagram"); const feed = await ig.buscarFeedCompleto(); res.json({ ok: true, feed }); } catch(e) { res.json({ ok: false, erro: e.message }); }
});

router.get("/api/instagram/perfil", requireAuth, async (req, res) => {
  try { const ig = require("../services/instagram"); const perfil = await ig.buscarPerfil(); res.json({ ok: true, perfil }); } catch(e) { res.json({ ok: false, erro: e.message }); }
});

router.get("/api/instagram/comentarios/:mediaId", requireAuth, async (req, res) => {
  try { const ig = require("../services/instagram"); const comentarios = await ig.buscarComentarios(req.params.mediaId); res.json({ ok: true, comentarios }); } catch(e) { res.json({ ok: false, erro: e.message }); }
});

router.post("/api/instagram/comentarios/:mediaId/responder", requireAuth, async (req, res) => {
  try { const ig = require("../services/instagram"); const r = await ig.responderComentario(req.params.mediaId, req.body.texto); res.json({ ok: true, data: r }); } catch(e) { res.json({ ok: false, erro: e.message }); }
});

router.get("/api/instagram/insights/:mediaId", requireAuth, async (req, res) => {
  try { const ig = require("../services/instagram"); const insights = await ig.buscarInsights(req.params.mediaId); res.json({ ok: true, insights }); } catch(e) { res.json({ ok: false, erro: e.message }); }
});
// ─── FIM INSTAGRAM API ────────────────────────────────────────────────────────
// ─── ATAS DE REUNIÃO ──────────────────────────────────────────────────────────
router.get('/atas', requireAuth, requirePermissao('atas'), async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const page = parseInt(req.query.page)||1;
  const limit = 20;
  const offset = (page-1)*limit;
  const [atasR, totalR, diretivosR, ligantesR, ultimaR] = await Promise.all([
    query('SELECT a.*, u.nome as criado_por_nome FROM atas_reuniao a LEFT JOIN usuarios u ON u.id=a.criado_por ORDER BY a.criado_em DESC LIMIT $1 OFFSET $2', [limit, offset]),
    query('SELECT COUNT(*) as total FROM atas_reuniao'),
    query("SELECT id,nome,cargo FROM diretivos WHERE ativo=1 AND pendente=false ORDER BY nome"),
    query("SELECT id,nome FROM ligantes WHERE ativo=1 AND pendente=false ORDER BY nome"),
    query('SELECT numero FROM atas_reuniao ORDER BY id DESC LIMIT 1')
  ]);
  // Gerar próximo número automático
  const ano = new Date().getFullYear();
  let proximoSeq = '001';
  if(ultimaR.rows.length) {
    const ultimo = ultimaR.rows[0].numero||'000/'+ano;
    const partes = ultimo.split('/');
    const ultimoAno = parseInt(partes[1])||ano;
    const ultimoSeq = parseInt(partes[0])||0;
    // Se mudou o ano, reinicia sequência
    if(ultimoAno === ano) {
      proximoSeq = String(ultimoSeq+1).padStart(3,'0');
    } else {
      proximoSeq = '001';
    }
  }
  const total = parseInt(totalR.rows[0].total);
  const totalPages = Math.ceil(total/limit);
  res.render('pages/atas', { config, usuario: req.session.usuario, msg, erro, atas: atasR.rows, diretivos: diretivosR.rows, ligantes: ligantesR.rows, proximoSeq, page, totalPages });
});

router.post('/atas', requireAuth, async (req, res) => {
  const { numero, tipo, data_reuniao, hora_inicio, hora_fim, local, pauta, corpo, membros_json } = req.body;
  const r = await query(
    'INSERT INTO atas_reuniao(numero,tipo,data_reuniao,hora_inicio,hora_fim,local,pauta,corpo,status,criado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
    [numero||null, tipo, data_reuniao, hora_inicio||null, hora_fim||null, local, pauta, corpo, 'rascunho', req.session.usuario.id]
  );
  const ataId = r.rows[0].id;
  if(membros_json) {
    const membros = JSON.parse(membros_json);
    for(const m of membros) {
      await query('INSERT INTO atas_presentes(ata_id,membro_tipo,membro_id,membro_nome,membro_cargo,presente) VALUES($1,$2,$3,$4,$5,$6)',
        [ataId, m.tipo, m.id, m.nome, m.cargo||'', true]);
    }
  }
  req.session.msg = ['Ata criada com sucesso!'];
  res.redirect('/atas');
});

router.get('/atas/:id', requireAuth, requirePermissao('atas'), async (req, res) => {
  const config = await getConfig();
  const ata = await query('SELECT a.*,u.nome as criado_por_nome FROM atas_reuniao a LEFT JOIN usuarios u ON u.id=a.criado_por WHERE a.id=$1', [req.params.id]);
  if(!ata.rows.length) return res.redirect('/atas');
  const presentes = await query('SELECT * FROM atas_presentes WHERE ata_id=$1 ORDER BY membro_nome', [req.params.id]);
  const diretivos = await query("SELECT id,nome,cargo FROM diretivos WHERE ativo=1 AND pendente=false ORDER BY nome");
  const ligantes = await query("SELECT id,nome FROM ligantes WHERE ativo=1 AND pendente=false ORDER BY nome");
  res.render('pages/ata-detalhe', { config, usuario: req.session.usuario, ata: ata.rows[0], presentes: presentes.rows, diretivos: diretivos.rows, ligantes: ligantes.rows, msg:[], erro:[] });
});

router.post('/atas/:id/status', requireAuth, async (req, res) => {
  const novoStatus = req.body.status;
  await query('UPDATE atas_reuniao SET status=$1,atualizado_em=NOW() WHERE id=$2', [novoStatus, req.params.id]);

  // Notificar presentes quando enviado para assinatura
  if (novoStatus === 'em_assinatura') {
    try {
      const crypto = require('crypto');
      const { enviarWhatsApp, enviarEmail } = require('../services/notificacoes');
      const ata = await query('SELECT * FROM atas_reuniao WHERE id=$1', [req.params.id]);
      const presentes = await query(`
        SELECT ap.*,
          COALESCE(d.email, l.email) as email,
          COALESCE(d.whatsapp, l.whatsapp) as whatsapp
        FROM atas_presentes ap
        LEFT JOIN diretivos d ON d.id=ap.membro_id AND ap.membro_tipo='diretivo'
        LEFT JOIN ligantes l ON l.id=ap.membro_id AND ap.membro_tipo='ligante'
        WHERE ap.ata_id=$1
      `, [req.params.id]);
      const a = ata.rows[0];
      const dataFormatada = a.data_reuniao ? new Date(a.data_reuniao).toLocaleDateString('pt-BR',{timeZone:'UTC',day:'2-digit',month:'2-digit',year:'numeric'}) : '';
      const cfg = await query("SELECT valor FROM configuracoes WHERE chave='org_logo'");
      const orgLogo = cfg.rows[0]?.valor || null;
      const appUrl = (process.env.APP_URL || 'https://sistema.lauroucpcde.com').replace(/\/$/, '');
      for (const p of presentes.rows) {
        const token = crypto.randomBytes(32).toString('hex');
        const expira = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await query('UPDATE atas_presentes SET token_assinatura=$1, token_usado=false, token_expira_em=$2 WHERE id=$3', [token, expira, p.id]);
        const linkAssinar = appUrl + '/assinar-ata/' + token;
        const primeiroNome = p.membro_nome.split(' ')[0];
        const tipoAta = a.tipo === 'ordinaria' ? 'Ordinaria' : a.tipo === 'extraordinaria' ? 'Extraordinaria' : 'Especial';
        const numAta = a.numero || a.id;
        if (p.whatsapp) {
          try {
            const jaNotif = await query("SELECT id FROM notificacoes_log WHERE tipo='ata_assinatura' AND canal='whatsapp' AND status='ok' AND observacao=$1", ['ata_' + req.params.id + '_presente_' + p.id]);
            if (!jaNotif.rows.length) {
              const msgWapp = '*LAURO — Assinatura de Ata*\n\nOla, ' + primeiroNome + '!\n\nA *Ata N ' + numAta + '* (Reuniao ' + tipoAta + ' — ' + dataFormatada + ') aguarda sua assinatura.\n\nLink de uso unico (expira em 30 dias):\n' + linkAssinar + '\n\n_Liga Academica de Urologia — LAURO | UCP | CDE_';
              await enviarWhatsApp(p.whatsapp, msgWapp, {urgente:true});
              await new Promise(r=>setTimeout(r,15000));
              await query("INSERT INTO notificacoes_log(tipo,canal,status,observacao,criado_em) VALUES('ata_assinatura','whatsapp','ok',$1,NOW())", ['ata_' + req.params.id + '_presente_' + p.id]);
            }
          } catch(e) { console.error('Wapp ata:', e.message); }
        }
        if (p.email) {
          const logoHtml = orgLogo ? '<div style="width:80px;height:80px;border-radius:50%;background:white;margin:0 auto 16px;padding:8px;box-sizing:border-box"><img src="' + orgLogo + '" style="width:64px;height:64px;object-fit:contain;border-radius:50%"></div>' : '';
          const html = '<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td><div style="background:linear-gradient(160deg,#1a3d2b 0%,#0a1f1a 100%);padding:36px 40px;text-align:center">' + logoHtml + '<div style="display:inline-block;background:rgba(34,197,94,0.2);border-radius:4px;padding:4px 16px"><span style="color:#86efac;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase">ASSINATURA DE ATA</span></div></div></td></tr><tr><td style="background:white;padding:36px 40px"><h2 style="margin:0 0 8px;font-size:20px;color:#0f172a">Ola, ' + primeiroNome + '!</h2><p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7">A <strong>Ata N' + numAta + '</strong> (Reuniao ' + tipoAta + ' — ' + dataFormatada + ') aguarda sua assinatura digital.</p><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 24px"><tr style="background:#f8fafc"><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Numero da ata</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:right;font-weight:700;color:#0f172a">' + numAta + '</td></tr><tr><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Tipo</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:right;font-weight:700;color:#0f172a">Reuniao ' + tipoAta + '</td></tr><tr style="background:#f8fafc"><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Data</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:right;font-weight:700;color:#0f172a">' + dataFormatada + '</td></tr><tr><td style="padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;color:#475569">Validade do link</td><td style="padding:12px 16px;border:1px solid #e2e8f0;text-align:right;font-weight:700;color:#0f172a">30 dias</td></tr></table><p style="text-align:center;margin:28px 0"><a href="' + linkAssinar + '" style="background:#1a3d2b;color:#fff;padding:14px 32px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block">Assinar Ata</a></p><p style="margin:0;font-size:12px;color:#94a3b8;text-align:center">Link de uso unico — expira apos a assinatura ou em 30 dias.</p></td></tr><tr><td style="background:#0f172a;padding:24px 40px"><p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;font-weight:600">Liga Academica de Urologia — LAURO</p><p style="margin:4px 0 0;color:rgba(255,255,255,0.4);font-size:10px">Universidad Central del Paraguay | Ciudad del Este</p></td></tr></table></td></tr></table></body></html>';
          try { await enviarEmail({ para: p.email, assunto: 'Ata N' + numAta + ' aguarda sua assinatura — LAURO', html, texto: 'Ola ' + primeiroNome + ', acesse: ' + linkAssinar }); } catch(e) { console.error('Email ata:', e.message); }
        }
      }
    } catch(e) { console.error('Erro notif ata:', e.message); }
  }

  res.json({ok:true});
});

router.post('/atas/:id/assinatura', requireAuth, async (req, res) => {
  const { presente_id, assinatura_digital } = req.body;
  await query('UPDATE atas_presentes SET assinatura_digital=$1,assinou_em=NOW() WHERE id=$2 AND ata_id=$3',
    [assinatura_digital, presente_id, req.params.id]);
  res.json({ok:true});
});

router.post('/atas/:id/pdf-upload', requireAuth, async (req, res) => {
  // Upload do PDF físico assinado via Cloudflare R2 (mesmo sistema dos contratos)
  res.json({ok:false, erro:'Use o formulário de upload'});
});

router.post('/atas/:id/presentes', requireAuth, async (req, res) => {
  const { membro_id, membro_tipo, membro_nome, membro_cargo } = req.body;
  await query('INSERT INTO atas_presentes(ata_id,membro_tipo,membro_id,membro_nome,membro_cargo,presente) VALUES($1,$2,$3,$4,$5,true)',
    [req.params.id, membro_tipo, membro_id, membro_nome, membro_cargo||'']);
  res.json({ok:true});
});
router.post('/atas/:id/presentes/:presenteId/reenviar', requireAuth, async (req, res) => {
  try {
    const crypto = require('crypto');
    const { enviarWhatsApp, enviarEmail } = require('../services/notificacoes');
    const ata = await query('SELECT * FROM atas_reuniao WHERE id=$1', [req.params.id]);
    const pR = await query(`
      SELECT ap.*, COALESCE(d.email, l.email) as email, COALESCE(d.whatsapp, l.whatsapp) as whatsapp
      FROM atas_presentes ap
      LEFT JOIN diretivos d ON d.id=ap.membro_id AND ap.membro_tipo='diretivo'
      LEFT JOIN ligantes l ON l.id=ap.membro_id AND ap.membro_tipo='ligante'
      WHERE ap.id=$1 AND ap.ata_id=$2
    `, [req.params.presenteId, req.params.id]);
    if (!pR.rows.length) return res.json({ok:false, erro:'Presente não encontrado'});
    const p = pR.rows[0];
    const a = ata.rows[0];

    // Gerar novo token
    const token = crypto.randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await query('UPDATE atas_presentes SET token_assinatura=$1, token_usado=false, token_expira_em=$2 WHERE id=$3', [token, expira, p.id]);

    const appUrl = (process.env.APP_URL || 'https://sistema.lauroucpcde.com').replace(/\/$/, '');
    const linkAssinar = appUrl + '/assinar-ata/' + token;
    const primeiroNome = p.membro_nome.split(' ')[0];
    const numAta = a.numero || a.id;
    const dataFormatada = a.data_reuniao ? new Date(a.data_reuniao).toLocaleDateString('pt-BR',{timeZone:'UTC',day:'2-digit',month:'2-digit',year:'numeric'}) : '';
    const tipoAta = a.tipo === 'ordinaria' ? 'Ordinaria' : a.tipo === 'extraordinaria' ? 'Extraordinaria' : 'Especial';

    // Reenvio: somente email — WhatsApp só na primeira vez para evitar ban
    if (p.email) {
      const cfg = await query("SELECT valor FROM configuracoes WHERE chave='org_logo'");
      const orgLogo = cfg.rows[0]?.valor || null;
      const logoHtml = orgLogo ? '<div style="width:80px;height:80px;border-radius:50%;background:white;margin:0 auto 16px;padding:8px;box-sizing:border-box"><img src="' + orgLogo + '" style="width:64px;height:64px;object-fit:contain;border-radius:50%"></div>' : '';
      const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td><div style="background:linear-gradient(160deg,#1a3d2b 0%,#0a1f1a 100%);padding:36px 40px;text-align:center">' + logoHtml + '<div style="display:inline-block;background:rgba(34,197,94,0.2);border-radius:4px;padding:4px 16px"><span style="color:#86efac;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase">REENVIO — ASSINATURA DE ATA</span></div></div></td></tr><tr><td style="background:white;padding:36px 40px"><h2 style="margin:0 0 8px;font-size:20px;color:#0f172a">Ola, ' + primeiroNome + '!</h2><p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7">Segue novo link para assinar a <strong>Ata N' + numAta + '</strong> (Reuniao ' + tipoAta + ' — ' + dataFormatada + ').</p><p style="text-align:center;margin:28px 0"><a href="' + linkAssinar + '" style="background:#1a3d2b;color:#fff;padding:14px 32px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block">Assinar Ata</a></p><p style="margin:0;font-size:12px;color:#94a3b8;text-align:center">Link de uso unico — expira apos a assinatura ou em 30 dias.</p></td></tr><tr><td style="background:#0f172a;padding:24px 40px"><p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;font-weight:600">Liga Academica de Urologia — LAURO</p><p style="margin:4px 0 0;color:rgba(255,255,255,0.4);font-size:10px">Universidad Central del Paraguay | Ciudad del Este</p></td></tr></table></td></tr></table></body></html>';
      try { await enviarEmail({ para: p.email, assunto: 'Reenvio — Ata N' + numAta + ' aguarda sua assinatura — LAURO', html, texto: 'Novo link: ' + linkAssinar }); } catch(e) {}
    }
    res.json({ok:true});
  } catch(e) { console.error('Reenviar ata:', e.message); res.json({ok:false, erro:e.message}); }
});

router.delete('/atas/:id/presentes/:presenteId', requireAuth, async (req, res) => {
  await query('DELETE FROM atas_presentes WHERE id=$1 AND ata_id=$2', [req.params.presenteId, req.params.id]);
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({ok:true});
  }
  res.redirect('/atas/' + req.params.id + '?tab=assinaturas');
});
router.get('/atas/:id/docx', requireAuth, requirePermissao('atas'), async (req, res) => {
  try {
    const { gerarAtaDocx } = require('../services/gerarAtaDocx');
    const ata = await query('SELECT * FROM atas_reuniao WHERE id=$1', [req.params.id]);
    if(!ata.rows.length) return res.status(404).json({erro:'Ata não encontrada'});
    const presentes = await query('SELECT * FROM atas_presentes WHERE ata_id=$1 ORDER BY membro_nome', [req.params.id]);
    const buf = await gerarAtaDocx(ata.rows[0], presentes.rows);
    const num = (ata.rows[0].numero||ata.rows[0].id).toString().replace('/','_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Acta_${num}.docx"`);
    res.send(buf);
  } catch(e) {
    console.error('[DOCX]', e);
    res.status(500).json({erro: e.message});
  }
});
router.delete('/atas/:id', requireAuth, async (req, res) => {
  await query('DELETE FROM atas_reuniao WHERE id=$1', [req.params.id]);
  res.json({ok:true});
});
// ─── FIM ATAS ─────────────────────────────────────────────────────────────────

module.exports = router;

// ─── CIENTIFICO ──────────────────────────────────────────────────────────────
const bcryptCient = require('bcrypt');
const { upload: uploadArq, uploadArquivo, gerarUrlInline } = require('../services/arquivos');

async function requireCientifico(req, res, next) {
  if (!req.session.usuario) return res.redirect('/login');
  const r = await query('SELECT 1 FROM usuario_permissoes WHERE usuario_id=$1 AND modulo=$2', [req.session.usuario.id, 'cientifico']);
  const perfil = req.session.usuario.perfil;
  if (r.rows.length > 0 || perfil === 'admin' || perfil === 'presidencia') return next();
  return res.redirect('/dashboard');
}

async function registrarTimeline(grupoId, evento, descricao) {
  await query('INSERT INTO timeline_grupo_cientifico (grupo_id,evento,descricao) VALUES ($1,$2,$3)', [grupoId, evento, descricao || null]);
}

// GET /cientifico
router.get('/cientifico', requireAuth, requireCientifico, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const permsR = await query('SELECT modulo FROM usuario_permissoes WHERE usuario_id=$1',[req.session.usuario.id]);
  const permissoesAtivas = permsR.rows.map(r=>r.modulo);
  const projetos = (await query(`SELECT p.*, (SELECT COUNT(*) FROM grupos_cientificos g WHERE g.projeto_id=p.id) as total_grupos FROM projetos_cientificos p ORDER BY p.criado_em DESC`)).rows;
  const stats = {
    abertos: projetos.filter(p=>p.status==='aberto').length,
    grupos: (await query('SELECT COUNT(*) n FROM grupos_cientificos')).rows[0].n,
    em_revisao: (await query("SELECT COUNT(*) n FROM versoes_trabalho WHERE status='em_revisao'")).rows[0].n,
    aprovados: (await query("SELECT COUNT(*) n FROM versoes_trabalho WHERE status='aprovado'")).rows[0].n,
  };
  const appUrl = 'https://cientifico.lauroucpcde.com';
  res.render('pages/cientifico/index', { config, usuario: req.session.usuario, permissoesAtivas, projetos, stats, msg, erro, appUrl });
});

// GET /cientifico/novo
router.get('/cientifico/novo', requireAuth, requireCientifico, async (req, res) => {
  const config = await getConfig();
  const permsR = await query('SELECT modulo FROM usuario_permissoes WHERE usuario_id=$1',[req.session.usuario.id]);
  const permissoesAtivas = permsR.rows.map(r=>r.modulo);
  const erro = req.session.erro||[]; req.session.erro=[];
  res.render('pages/cientifico/projeto-form', { config, usuario: req.session.usuario, permissoesAtivas, projeto: null, erro });
});

// POST /cientifico/novo
router.post('/cientifico/novo', requireAuth, requireCientifico, uploadArq.fields([{name:'edital',maxCount:1},{name:'modelo',maxCount:1}]), async (req, res) => {
  const { titulo, descricao, prazo, status } = req.body;
  if (!titulo) { req.session.erro=['Titulo obrigatorio']; return res.redirect('/cientifico/novo'); }
  let edital_chave=null, edital_nome=null, modelo_chave=null, modelo_nome=null;
  if (req.files?.edital?.[0]) {
    const f=req.files.edital[0];
    edital_chave = await uploadArquivo(f.buffer, f.originalname, f.mimetype, 'cientifico/editais');
    edital_nome = f.originalname;
  }
  if (req.files?.modelo?.[0]) {
    const f=req.files.modelo[0];
    modelo_chave = await uploadArquivo(f.buffer, f.originalname, f.mimetype, 'cientifico/modelos');
    modelo_nome = f.originalname;
  }
  await query('INSERT INTO projetos_cientificos (titulo,descricao,prazo,status,edital_chave,edital_nome,modelo_chave,modelo_nome,criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [titulo, descricao||null, prazo||null, status||'aberto', edital_chave, edital_nome, modelo_chave, modelo_nome, req.session.usuario.id]);
  req.session.msg=['Projeto criado com sucesso!'];
  res.redirect('/cientifico');
});

// GET /cientifico/projeto/:id
router.get('/cientifico/projeto/:id', requireAuth, requireCientifico, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const permsR = await query('SELECT modulo FROM usuario_permissoes WHERE usuario_id=$1',[req.session.usuario.id]);
  const permissoesAtivas = permsR.rows.map(r=>r.modulo);
  const pR = await query('SELECT * FROM projetos_cientificos WHERE id=$1',[req.params.id]);
  if (!pR.rows.length) return res.redirect('/cientifico');
  const projeto = pR.rows[0];
  const grupos = (await query(`SELECT g.*, (SELECT COUNT(*) FROM membros_grupo_cientifico m WHERE m.grupo_id=g.id) as total_membros, (SELECT status FROM versoes_trabalho v WHERE v.grupo_id=g.id ORDER BY v.enviado_em DESC LIMIT 1) as ultimo_status FROM grupos_cientificos g WHERE g.projeto_id=$1 ORDER BY g.criado_em ASC`,[req.params.id])).rows;
  const avisos = (await query(`SELECT a.*, u.nome as autor_nome, g.nome as grupo_nome FROM avisos_cientificos a LEFT JOIN usuarios u ON u.id=a.autor_id LEFT JOIN grupos_cientificos g ON g.id=a.grupo_id WHERE a.projeto_id=$1 ORDER BY a.criado_em DESC LIMIT 20`,[req.params.id])).rows;
  res.render('pages/cientifico/projeto-detalhe', { config, usuario: req.session.usuario, permissoesAtivas, projeto, grupos, avisos, msg, erro });
});

// GET /cientifico/projeto/:id/editar
router.get('/cientifico/projeto/:id/editar', requireAuth, requireCientifico, async (req, res) => {
  const config = await getConfig();
  const permsR = await query('SELECT modulo FROM usuario_permissoes WHERE usuario_id=$1',[req.session.usuario.id]);
  const permissoesAtivas = permsR.rows.map(r=>r.modulo);
  const pR = await query('SELECT * FROM projetos_cientificos WHERE id=$1',[req.params.id]);
  if (!pR.rows.length) return res.redirect('/cientifico');
  const erro = req.session.erro||[]; req.session.erro=[];
  res.render('pages/cientifico/projeto-form', { config, usuario: req.session.usuario, permissoesAtivas, projeto: pR.rows[0], erro });
});

// POST /cientifico/projeto/:id/editar
router.post('/cientifico/projeto/:id/editar', requireAuth, requireCientifico, uploadArq.fields([{name:'edital',maxCount:1},{name:'modelo',maxCount:1}]), async (req, res) => {
  const { titulo, descricao, prazo, status } = req.body;
  const pR = await query('SELECT * FROM projetos_cientificos WHERE id=$1',[req.params.id]);
  if (!pR.rows.length) return res.redirect('/cientifico');
  const p = pR.rows[0];
  let edital_chave=p.edital_chave, edital_nome=p.edital_nome, modelo_chave=p.modelo_chave, modelo_nome=p.modelo_nome;
  if (req.files?.edital?.[0]) {
    const f=req.files.edital[0];
    edital_chave = await uploadArquivo(f.buffer, f.originalname, f.mimetype, 'cientifico/editais');
    edital_nome = f.originalname;
  }
  if (req.files?.modelo?.[0]) {
    const f=req.files.modelo[0];
    modelo_chave = await uploadArquivo(f.buffer, f.originalname, f.mimetype, 'cientifico/modelos');
    modelo_nome = f.originalname;
  }
  await query('UPDATE projetos_cientificos SET titulo=$1,descricao=$2,prazo=$3,status=$4,edital_chave=$5,edital_nome=$6,modelo_chave=$7,modelo_nome=$8 WHERE id=$9',
    [titulo,descricao||null,prazo||null,status,edital_chave,edital_nome,modelo_chave,modelo_nome,req.params.id]);
  req.session.msg=['Projeto atualizado!'];
  res.redirect('/cientifico/projeto/'+req.params.id);
});

// GET /cientifico/arquivo/:projetoId/:tipo (download edital/modelo)
router.get('/cientifico/arquivo/:projetoId/:tipo', requireAuth, async (req, res) => {
  const pR = await query('SELECT * FROM projetos_cientificos WHERE id=$1',[req.params.projetoId]);
  if (!pR.rows.length) return res.status(404).send('Nao encontrado');
  const p = pR.rows[0];
  const chave = req.params.tipo==='edital' ? p.edital_chave : p.modelo_chave;
  if (!chave) return res.status(404).send('Arquivo nao encontrado');
  const url = await gerarUrlInline(chave);
  res.redirect(url);
});

// GET /cientifico/projeto/:projetoId/grupo/novo
router.get('/cientifico/projeto/:projetoId/grupo/novo', requireAuth, requireCientifico, async (req, res) => {
  const config = await getConfig();
  const permsR = await query('SELECT modulo FROM usuario_permissoes WHERE usuario_id=$1',[req.session.usuario.id]);
  const permissoesAtivas = permsR.rows.map(r=>r.modulo);
  const pR = await query('SELECT * FROM projetos_cientificos WHERE id=$1',[req.params.projetoId]);
  if (!pR.rows.length) return res.redirect('/cientifico');
  const erro = req.session.erro||[]; req.session.erro=[];
  res.render('pages/cientifico/grupo-form', { config, usuario: req.session.usuario, permissoesAtivas, projeto: pR.rows[0], erro });
});

// POST /cientifico/projeto/:projetoId/grupo/novo
router.post('/cientifico/projeto/:projetoId/grupo/novo', requireAuth, requireCientifico, async (req, res) => {
  const { nome, tipo_trabalho } = req.body;
  if (!nome) { req.session.erro=['Nome obrigatorio']; return res.redirect('back'); }
  const tipoT = tipo_trabalho==='individual' ? 'individual' : 'colaborativo';
  const gR = await query('INSERT INTO grupos_cientificos (projeto_id,nome,tipo_trabalho) VALUES ($1,$2,$3) RETURNING id',[req.params.projetoId,nome,tipoT]);
  const grupoId = gR.rows[0].id;
  await registrarTimeline(grupoId, 'Grupo criado', 'Grupo "'+nome+'" criado no sistema');
  req.session.msg=['Grupo criado!'];
  res.redirect('/cientifico/projeto/'+req.params.projetoId+'/grupo/'+grupoId);
});

// GET /cientifico/projeto/:projetoId/grupo/:grupoId
router.get('/cientifico/projeto/:projetoId/grupo/:grupoId', requireAuth, requireCientifico, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const permsR = await query('SELECT modulo FROM usuario_permissoes WHERE usuario_id=$1',[req.session.usuario.id]);
  const permissoesAtivas = permsR.rows.map(r=>r.modulo);
  const pR = await query('SELECT * FROM projetos_cientificos WHERE id=$1',[req.params.projetoId]);
  const gR = await query('SELECT * FROM grupos_cientificos WHERE id=$1 AND projeto_id=$2',[req.params.grupoId,req.params.projetoId]);
  if (!pR.rows.length||!gR.rows.length) return res.redirect('/cientifico');
  const projeto=pR.rows[0], grupo=gR.rows[0];
  const membros = (await query(`SELECT m.*, CASE WHEN m.origem_tipo='ligante' THEN l.nome ELSE d.nome END as nome, CASE WHEN m.origem_tipo='ligante' THEN l.email ELSE d.email END as email FROM membros_grupo_cientifico m LEFT JOIN ligantes l ON m.origem_tipo='ligante' AND l.id=m.origem_id LEFT JOIN diretivos d ON m.origem_tipo='diretivo' AND d.id=m.origem_id WHERE m.grupo_id=$1`,[req.params.grupoId])).rows;
  const versoes = (await query(`SELECT v.*, CASE WHEN v.enviado_por_tipo='ligante' THEN l.nome ELSE d.nome END as enviado_por_nome FROM versoes_trabalho v LEFT JOIN ligantes l ON v.enviado_por_tipo='ligante' AND l.id=v.enviado_por_id LEFT JOIN diretivos d ON v.enviado_por_tipo='diretivo' AND d.id=v.enviado_por_id WHERE v.grupo_id=$1 ORDER BY v.enviado_em DESC`,[req.params.grupoId])).rows;
  const chat = (await query('SELECT * FROM chat_grupo_cientifico WHERE grupo_id=$1 ORDER BY criado_em ASC',[req.params.grupoId])).rows;
  const timeline = (await query('SELECT * FROM timeline_grupo_cientifico WHERE grupo_id=$1 ORDER BY criado_em DESC',[req.params.grupoId])).rows;
  const avisos = (await query(`SELECT a.* FROM avisos_cientificos a WHERE a.projeto_id=$1 AND (a.grupo_id=$2 OR a.grupo_id IS NULL) ORDER BY a.criado_em DESC LIMIT 5`,[req.params.projetoId,req.params.grupoId])).rows;
  const membroIds = membros.map(m=>m.origem_id);
  const ligantesDisponiveis = (await query('SELECT id,nome FROM ligantes WHERE ativo=1 AND pendente=false ORDER BY nome')).rows.filter(l=>!membros.find(m=>m.origem_tipo==='ligante'&&m.origem_id===l.id));
  const diretivosDisponiveis = (await query('SELECT id,nome FROM diretivos WHERE ativo=1 AND pendente=false ORDER BY nome')).rows.filter(d=>!membros.find(m=>m.origem_tipo==='diretivo'&&m.origem_id===d.id));
  // No modo individual, agrupar versoes por autor
  let versoesPorAutor = [];
  if (grupo.tipo_trabalho === 'individual') {
    const mapa = {};
    for (const v of versoes) {
      const chave = v.enviado_por_tipo + '-' + v.enviado_por_id;
      if (!mapa[chave]) mapa[chave] = { autor_nome: v.enviado_por_nome || 'Membro', autor_tipo: v.enviado_por_tipo, autor_id: v.enviado_por_id, versoes: [] };
      mapa[chave].versoes.push(v);
    }
    // incluir tambem membros que ainda nao enviaram nada
    for (const m of membros) {
      const chave = m.origem_tipo + '-' + m.origem_id;
      if (!mapa[chave]) mapa[chave] = { autor_nome: m.nome || 'Membro', autor_tipo: m.origem_tipo, autor_id: m.origem_id, versoes: [] };
    }
    versoesPorAutor = Object.values(mapa);
  }
  res.render('pages/cientifico/grupo-detalhe', { config, usuario: req.session.usuario, permissoesAtivas, projeto, grupo, membros, versoes, versoesPorAutor, chat, timeline, avisos, ligantesDisponiveis, diretivosDisponiveis, msg, erro });
});

// POST /cientifico/grupo/:grupoId/membro/adicionar
router.post('/cientifico/grupo/:grupoId/membro/adicionar', requireAuth, requireCientifico, async (req, res) => {
  const { origem_tipo, origem_id, papel } = req.body;
  const gR = await query('SELECT * FROM grupos_cientificos WHERE id=$1',[req.params.grupoId]);
  if (!gR.rows.length) return res.redirect('/cientifico');
  const g = gR.rows[0];
  try {
    await query('INSERT INTO membros_grupo_cientifico (grupo_id,origem_tipo,origem_id,papel) VALUES ($1,$2,$3,$4)',[req.params.grupoId,origem_tipo,origem_id,papel||'membro']);
    const nomeR = origem_tipo==='ligante' ? await query('SELECT nome FROM ligantes WHERE id=$1',[origem_id]) : await query('SELECT nome FROM diretivos WHERE id=$1',[origem_id]);
    const nome = nomeR.rows[0]?.nome||'Membro';
    await registrarTimeline(req.params.grupoId, 'Membro adicionado', nome+' adicionado ao grupo como '+papel);
    // gerar senha padrao no portal se nao existir
    const senhaExiste = await query('SELECT 1 FROM portal_cientifico_senhas WHERE origem_tipo=$1 AND origem_id=$2',[origem_tipo,origem_id]);
    if (!senhaExiste.rows.length) {
      const hash = await bcryptCient.hash('123456', 10);
      await query('INSERT INTO portal_cientifico_senhas (origem_tipo,origem_id,senha_hash,primeiro_acesso) VALUES ($1,$2,$3,true)',[origem_tipo,origem_id,hash]);
    }
    req.session.msg=['Membro adicionado!'];
  } catch(e) {
    req.session.erro=['Este membro ja esta em outro grupo.'];
  }
  res.redirect('/cientifico/projeto/'+g.projeto_id+'/grupo/'+req.params.grupoId+'?tab=membros');
});

// POST /cientifico/grupo/:grupoId/membro/:membroId/remover
router.post('/cientifico/grupo/:grupoId/membro/:membroId/remover', requireAuth, requireCientifico, async (req, res) => {
  const gR = await query('SELECT * FROM grupos_cientificos WHERE id=$1',[req.params.grupoId]);
  if (!gR.rows.length) return res.redirect('/cientifico');
  const g = gR.rows[0];
  await query('DELETE FROM membros_grupo_cientifico WHERE id=$1 AND grupo_id=$2',[req.params.membroId,req.params.grupoId]);
  await registrarTimeline(req.params.grupoId, 'Membro removido', 'Membro removido do grupo');
  req.session.msg=['Membro removido.'];
  res.redirect('/cientifico/projeto/'+g.projeto_id+'/grupo/'+req.params.grupoId+'?tab=membros');
});

// POST /cientifico/projeto/:projetoId/aviso
router.post('/cientifico/projeto/:projetoId/aviso', requireAuth, requireCientifico, async (req, res) => {
  const { texto, grupo_id } = req.body;
  if (!texto) { req.session.erro=['Texto obrigatorio']; return res.redirect('back'); }
  await query('INSERT INTO avisos_cientificos (projeto_id,grupo_id,autor_id,texto) VALUES ($1,$2,$3,$4)',
    [req.params.projetoId, grupo_id||null, req.session.usuario.id, texto]);
  req.session.msg=['Aviso publicado!'];
  res.redirect('/cientifico/projeto/'+req.params.projetoId);
});

// POST /cientifico/grupo/:grupoId/chat
router.post('/cientifico/grupo/:grupoId/chat', requireAuth, requireCientifico, uploadArq.single('arquivo_chat'), async (req, res) => {
  const { texto } = req.body;
  const gR = await query('SELECT * FROM grupos_cientificos WHERE id=$1',[req.params.grupoId]);
  if (!gR.rows.length) return res.redirect('/cientifico');
  const g = gR.rows[0];
  if (!texto && !req.file) return res.redirect('back');
  let arquivo_chave=null, arquivo_nome=null;
  if (req.file) {
    arquivo_chave = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'cientifico/chat');
    arquivo_nome = req.file.originalname;
  }
  await query('INSERT INTO chat_grupo_cientifico (grupo_id,autor_tipo,autor_id,autor_nome,texto,arquivo_chave,arquivo_nome) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [req.params.grupoId,'sistema',req.session.usuario.id,req.session.usuario.nome,texto||null,arquivo_chave,arquivo_nome]);
  res.redirect('/cientifico/projeto/'+g.projeto_id+'/grupo/'+req.params.grupoId+'?tab=chat');
});

// POST /cientifico/versao/:versaoId/iniciar-revisao
router.post('/cientifico/versao/:versaoId/iniciar-revisao', requireAuth, requireCientifico, async (req, res) => {
  const vR = await query('SELECT v.*, g.projeto_id FROM versoes_trabalho v JOIN grupos_cientificos g ON g.id=v.grupo_id WHERE v.id=$1',[req.params.versaoId]);
  if (!vR.rows.length) return res.redirect('/cientifico');
  const v = vR.rows[0];
  await query("UPDATE versoes_trabalho SET status='em_revisao' WHERE id=$1",[req.params.versaoId]);
  await registrarTimeline(v.grupo_id,'Em revisao','Versao em revisao pelo cientifico');
  res.redirect('/cientifico/projeto/'+v.projeto_id+'/grupo/'+v.grupo_id);
});

// POST /cientifico/versao/:versaoId/revisar
router.post('/cientifico/versao/:versaoId/revisar', requireAuth, requireCientifico, async (req, res) => {
  const { acao, comentario } = req.body;
  const vR = await query('SELECT v.*, g.projeto_id FROM versoes_trabalho v JOIN grupos_cientificos g ON g.id=v.grupo_id WHERE v.id=$1',[req.params.versaoId]);
  if (!vR.rows.length) return res.redirect('/cientifico');
  const v = vR.rows[0];
  const novoStatus = acao==='aprovar' ? 'aprovado' : 'devolvido';
  await query('UPDATE versoes_trabalho SET status=$1,comentario_revisor=$2,revisado_por=$3,revisado_em=NOW() WHERE id=$4',
    [novoStatus,comentario||null,req.session.usuario.id,req.params.versaoId]);
  try {
    const { enviarWhatsApp: _wppR } = require('../services/notificacoes');
    const _gIR = await query('SELECT gc.nome as gnome, pc.titulo as ptitulo FROM grupos_cientificos gc JOIN projetos_cientificos pc ON pc.id=gc.projeto_id WHERE gc.id=$1',[v.grupo_id]);
    const _gI = _gIR.rows[0];
    const _mbR = await query("SELECT CASE WHEN m.origem_tipo='ligante' THEN l.whatsapp ELSE d.whatsapp END as whatsapp FROM membros_grupo_cientifico m LEFT JOIN ligantes l ON m.origem_tipo='ligante' AND l.id=m.origem_id LEFT JOIN diretivos d ON m.origem_tipo='diretivo' AND d.id=m.origem_id WHERE m.grupo_id=$1",[v.grupo_id]);
    for (const _mb of _mbR.rows) {
      if (!_mb.whatsapp) continue;
      const _msg = acao==='aprovar'
        ? `*LAURO - Portal Cientifico*\n\n✅ *Trabalho APROVADO!*\n\n*Projeto:* ${_gI?.ptitulo||''}\n*Grupo:* ${_gI?.gnome||''}\n\n${comentario?'*Comentario:* '+comentario+'\n\n':''}Parabens!\nPortal: https://cientifico.lauroucpcde.com`
        : `*LAURO - Portal Cientifico*\n\n🔄 *Trabalho devolvido para correcao*\n\n*Projeto:* ${_gI?.ptitulo||''}\n*Grupo:* ${_gI?.gnome||''}\n\n${comentario?'*Comentario do revisor:* '+comentario+'\n\n':''}Envie a versao corrigida:\nhttps://cientifico.lauroucpcde.com`;
      try { await _wppR(_mb.whatsapp, _msg); } catch(e){}
    }
  } catch(e) { console.error('[WPP Cientifico] Erro notificar membros:', e.message); }
  await registrarTimeline(v.grupo_id, acao==='aprovar'?'Trabalho aprovado':'Devolvido para correcao', comentario||null);
  req.session.msg=[acao==='aprovar'?'Trabalho aprovado!':'Trabalho devolvido para correcao.'];
  res.redirect('/cientifico/projeto/'+v.projeto_id+'/grupo/'+v.grupo_id);
});

// GET /cientifico/versao/:versaoId/download
router.get('/cientifico/versao/:versaoId/download', requireAuth, async (req, res) => {
  const vR = await query('SELECT * FROM versoes_trabalho WHERE id=$1',[req.params.versaoId]);
  if (!vR.rows.length) return res.status(404).send('Nao encontrado');
  const url = await gerarUrlInline(vR.rows[0].arquivo_chave);
  res.redirect(url);
});

// ─── PORTAL CIENTIFICO (membros externos) ────────────────────────────────────
const bcryptPortal = bcryptCient; // alias

function requirePortal(req, res, next) {
  if (!req.session.portalMembro) return res.redirect('/portal/login');
  next();
}

async function getPortalMembro(tipo, id) {
  if (tipo === 'ligante') {
    const r = await query('SELECT id, nome, email FROM ligantes WHERE id=$1 AND ativo=1', [id]);
    return r.rows[0] || null;
  } else {
    const r = await query('SELECT id, nome, email FROM diretivos WHERE id=$1 AND ativo=1', [id]);
    return r.rows[0] || null;
  }
}

// GET /portal
router.get('/portal', requirePortal, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const { tipo, id } = req.session.portalMembro;
  const membro = await getPortalMembro(tipo, id);
  if (!membro) { req.session.portalMembro = null; return res.redirect('/portal/login'); }
  const grupos = (await query(`
    SELECT m.grupo_id, gc.nome as grupo_nome, pc.titulo as projeto_titulo, pc.prazo,
      (SELECT status FROM versoes_trabalho v WHERE v.grupo_id=m.grupo_id ORDER BY v.enviado_em DESC LIMIT 1) as ultimo_status
    FROM membros_grupo_cientifico m
    JOIN grupos_cientificos gc ON gc.id=m.grupo_id
    JOIN projetos_cientificos pc ON pc.id=gc.projeto_id
    WHERE m.origem_tipo=$1 AND m.origem_id=$2
    ORDER BY pc.criado_em DESC
  `, [tipo, id])).rows;
  res.render('pages/portal/dashboard', { config, membro, grupos, msg });
});


// ─── MATERIAIS DE ESTUDO (ADMIN) ─────────────────────────────────────────────
router.get('/materiais', requireAuth, async (req, res) => {
  const materiais = await query('SELECT * FROM materiais_estudo ORDER BY ordem ASC, criado_em DESC');
  res.render('pages/materiais', {
    config: await getConfig(), usuario: req.session.usuario,
    paginaAtual: 'materiais', materiais: materiais.rows,
    msg: req.flash('msg'), erro: req.flash('erro')
  });
});

router.post('/materiais/criar', requireAuth, requireAdmin, async (req, res) => {
  try {
    const upload = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 500*1024*1024 } }); // 500MB
    upload.single('arquivo')(req, res, async (err) => {
      if (err) { req.flash('erro', ['Erro no upload: ' + err.message]); return res.redirect('/materiais'); }
      const { titulo, descricao, categoria, permite_download, ordem } = req.body;
      let arquivo_chave = null, arquivo_nome = null, arquivo_tipo = null, arquivo_tamanho = null;
      if (req.file) {
        const { uploadArquivo } = require('../services/arquivos');
        const ext = req.file.originalname.split('.').pop();
        const chave = 'materiais/' + Date.now() + '-' + Math.random().toString(36).substring(2) + '.' + ext;
        const r = await uploadArquivo(req.file.buffer, chave, req.file.mimetype, 'materiais');
        arquivo_chave = r.chave;
        arquivo_nome = req.file.originalname;
        arquivo_tipo = req.file.mimetype;
        arquivo_tamanho = req.file.size;
      }
      await query(
        'INSERT INTO materiais_estudo(titulo,descricao,categoria,arquivo_chave,arquivo_nome,arquivo_tipo,arquivo_tamanho,permite_download,ordem,criado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [titulo, descricao||null, categoria||null, arquivo_chave, arquivo_nome, arquivo_tipo, arquivo_tamanho, permite_download==='1', parseInt(ordem)||0, req.session.usuario.id]
      );
      req.flash('msg', ['Material adicionado com sucesso!']);
      res.redirect('/materiais');
    });
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/materiais'); }
});

router.post('/materiais/:id/editar', requireAuth, requireAdmin, async (req, res) => {
  const { titulo, descricao, categoria, permite_download, ordem, ativo } = req.body;
  await query(
    'UPDATE materiais_estudo SET titulo=$1,descricao=$2,categoria=$3,permite_download=$4,ordem=$5,ativo=$6,atualizado_em=NOW() WHERE id=$7',
    [titulo, descricao||null, categoria||null, permite_download==='1', parseInt(ordem)||0, ativo==='1', req.params.id]
  );
  req.flash('msg', ['Material atualizado!']);
  res.redirect('/materiais');
});

router.post('/materiais/:id/excluir', requireAuth, requireAdmin, async (req, res) => {
  await query('DELETE FROM materiais_estudo WHERE id=$1', [req.params.id]);
  req.flash('msg', ['Material removido!']);
  res.redirect('/materiais');
});

// Servir arquivo do material (com controle de download)
router.get('/membro/materiais/:id/arquivo', requireMembro, async (req, res) => {
  try {
    const r = await query('SELECT * FROM materiais_estudo WHERE id=$1 AND ativo=true', [req.params.id]);
    if (!r.rows.length) return res.status(404).send('Material nao encontrado');
    const mat = r.rows[0];
    if (!mat.arquivo_chave) return res.status(404).send('Arquivo nao disponivel');
    const { gerarUrlTemporaria, gerarUrlDownload } = require('../services/arquivos');
    // Download direto com nome correto
    if (req.query.download === '1') {
      const urlDownload = await gerarUrlDownload(mat.arquivo_chave, mat.arquivo_nome || 'arquivo');
      return res.redirect(urlDownload);
    }
    // Proxy do arquivo — serve o conteudo direto pelo servidor (evita bloqueio CSP/X-Frame)
    const url = await gerarUrlTemporaria(mat.arquivo_chave, 600);
    if (req.query.inline === '1') {
      return res.json({ url: '/membro/materiais/'+req.params.id+'/proxy', nome: mat.arquivo_nome, tipo: mat.arquivo_tipo });
    }
    res.redirect(url);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.get('/membro/materiais/:id/proxy', requireMembro, async (req, res) => {
  try {
    const r = await query('SELECT * FROM materiais_estudo WHERE id=$1 AND ativo=true', [req.params.id]);
    if (!r.rows.length) return res.status(404).send('Not found');
    const mat = r.rows[0];
    if (!mat.arquivo_chave) return res.status(404).send('No file');
    const { gerarUrlTemporaria } = require('../services/arquivos');
    const url = await gerarUrlTemporaria(mat.arquivo_chave, 60);
    const axios = require('axios');
    const resp = await axios.get(url, { responseType: 'stream', timeout: 30000 });
    res.setHeader('Content-Type', mat.arquivo_tipo || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline; filename="' + (mat.arquivo_nome || 'arquivo') + '"');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    resp.data.pipe(res);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.get('/materiais/:id/arquivo', requireMembro, async (req, res) => {
  try {
    const r = await query('SELECT * FROM materiais_estudo WHERE id=$1 AND ativo=true', [req.params.id]);
    if (!r.rows.length) return res.status(404).send('Material nao encontrado');
    const mat = r.rows[0];
    if (!mat.arquivo_chave) return res.status(404).send('Arquivo nao disponivel');
    const { gerarUrlTemporaria } = require('../services/arquivos');
    const url = await gerarUrlTemporaria(mat.arquivo_chave, 300); // 5 min
    if (mat.permite_download) {
      res.redirect(url);
    } else {
      // Inline — forcar visualizacao sem download
      res.setHeader('Content-Disposition', 'inline; filename="' + (mat.arquivo_nome || 'arquivo') + '"');
      res.redirect(url);
    }
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

// Tambem permitir acesso admin ao arquivo
router.get('/materiais/:id/arquivo-admin', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM materiais_estudo WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).send('Material nao encontrado');
    const mat = r.rows[0];
    if (!mat.arquivo_chave) return res.status(404).send('Arquivo nao disponivel');
    const { gerarUrlTemporaria } = require('../services/arquivos');
    const url = await gerarUrlTemporaria(mat.arquivo_chave, 300);
    res.redirect(url);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

// GET /portal/login
router.get('/portal/login', async (req, res) => {
  if (req.session.portalMembro) return res.redirect('/portal');
  const config = await getConfig();
  const erro = req.session.erro||[]; req.session.erro=[];
  res.render('pages/portal/login', { config, erro });
});

// POST /portal/login
router.post('/portal/login', async (req, res) => {
  const { email, senha } = req.body;
  const config = await getConfig();
  // Busca em ligantes e diretivos
  let membro = null, tipo = null;
  const rL = await query('SELECT id, nome, email FROM ligantes WHERE LOWER(email)=LOWER($1) AND ativo=1 AND pendente=false', [email]);
  if (rL.rows.length) { membro = rL.rows[0]; tipo = 'ligante'; }
  else {
    const rD = await query('SELECT id, nome, email FROM diretivos WHERE LOWER(email)=LOWER($1) AND ativo=1 AND pendente=false', [email]);
    if (rD.rows.length) { membro = rD.rows[0]; tipo = 'diretivo'; }
  }
  if (!membro) { req.session.erro=['Email nao encontrado ou acesso nao permitido.']; return res.redirect('/portal/login'); }
  const senhaR = await query('SELECT * FROM portal_cientifico_senhas WHERE origem_tipo=$1 AND origem_id=$2', [tipo, membro.id]);
  if (!senhaR.rows.length) { req.session.erro=['Acesso nao configurado. Aguarde ser adicionado a um grupo.']; return res.redirect('/portal/login'); }
  const senhaOk = await bcryptPortal.compare(senha, senhaR.rows[0].senha_hash);
  if (!senhaOk) { req.session.erro=['Senha incorreta.']; return res.redirect('/portal/login'); }
  req.session.portalMembro = { tipo, id: membro.id, nome: membro.nome };
  if (senhaR.rows[0].primeiro_acesso) return res.redirect('/portal/trocar-senha');
  res.redirect('/portal');
});

// GET /portal/trocar-senha
router.get('/portal/trocar-senha', requirePortal, async (req, res) => {
  const config = await getConfig();
  const erro = req.session.erro||[]; req.session.erro=[];
  res.render('pages/portal/trocar-senha', { config, erro });
});

// POST /portal/trocar-senha
router.post('/portal/trocar-senha', requirePortal, async (req, res) => {
  const { nova_senha, confirmar_senha } = req.body;
  if (!nova_senha || nova_senha.length < 6) { req.session.erro=['Senha deve ter no minimo 6 caracteres.']; return res.redirect('/portal/trocar-senha'); }
  if (nova_senha !== confirmar_senha) { req.session.erro=['As senhas nao conferem.']; return res.redirect('/portal/trocar-senha'); }
  const { tipo, id } = req.session.portalMembro;
  const hash = await bcryptPortal.hash(nova_senha, 10);
  await query('UPDATE portal_cientifico_senhas SET senha_hash=$1, primeiro_acesso=false WHERE origem_tipo=$2 AND origem_id=$3', [hash, tipo, id]);
  req.session.msg=['Senha definida com sucesso! Bem-vindo(a).'];
  res.redirect('/portal');
});

// GET /portal/esqueci-senha
router.get('/portal/esqueci-senha', async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  res.render('pages/portal/esqueci-senha', { config, msg, erro });
});

// POST /portal/esqueci-senha
router.post('/portal/esqueci-senha', async (req, res) => {
  const { email } = req.body;
  let membro = null, tipo = null;
  const rL = await query('SELECT id, nome, email FROM ligantes WHERE LOWER(email)=LOWER($1) AND ativo=1', [email]);
  if (rL.rows.length) { membro = rL.rows[0]; tipo = 'ligante'; }
  else {
    const rD = await query('SELECT id, nome, email FROM diretivos WHERE LOWER(email)=LOWER($1) AND ativo=1', [email]);
    if (rD.rows.length) { membro = rD.rows[0]; tipo = 'diretivo'; }
  }
  if (membro) {
    const novaSenha = Math.random().toString(36).slice(-8);
    const hash = await bcryptPortal.hash(novaSenha, 10);
    await query('UPDATE portal_cientifico_senhas SET senha_hash=$1, primeiro_acesso=true WHERE origem_tipo=$2 AND origem_id=$3', [hash, tipo, membro.id]);
    await enviarEmail({ para: membro.email, assunto: 'Portal Cientifico — Senha temporaria', texto: 'Ola ' + membro.nome + ',\n\nSua senha temporaria para o Portal Cientifico e: ' + novaSenha + '\n\nAo entrar, sera solicitado que voce defina uma nova senha.\n\nAcesse: ' + (process.env.APP_URL||'') + '/portal/login' });
  }
  req.session.msg=['Se o email estiver cadastrado, voce recebera as instrucoes em instantes.'];
  res.redirect('/portal/esqueci-senha');
});

// GET /portal/logout
router.get('/portal/logout', (req, res) => {
  req.session.portalMembro = null;
  res.redirect('/portal/login');
});

// GET /portal/grupo/:grupoId
router.get('/portal/grupo/:grupoId', requirePortal, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const { tipo, id } = req.session.portalMembro;
  const membro = await getPortalMembro(tipo, id);
  if (!membro) { req.session.portalMembro = null; return res.redirect('/portal/login'); }
  // Verificar que o membro pertence a este grupo
  const mR = await query('SELECT * FROM membros_grupo_cientifico WHERE grupo_id=$1 AND origem_tipo=$2 AND origem_id=$3', [req.params.grupoId, tipo, id]);
  if (!mR.rows.length) return res.redirect('/portal');
  const gR = await query('SELECT * FROM grupos_cientificos WHERE id=$1', [req.params.grupoId]);
  if (!gR.rows.length) return res.redirect('/portal');
  const grupo = gR.rows[0];
  const pR = await query('SELECT * FROM projetos_cientificos WHERE id=$1', [grupo.projeto_id]);
  const projeto = pR.rows[0];
  let versoes;
  if (grupo.tipo_trabalho === 'individual') {
    versoes = (await query('SELECT * FROM versoes_trabalho WHERE grupo_id=$1 AND enviado_por_tipo=$2 AND enviado_por_id=$3 ORDER BY enviado_em DESC', [req.params.grupoId, tipo, id])).rows;
  } else {
    versoes = (await query('SELECT * FROM versoes_trabalho WHERE grupo_id=$1 ORDER BY enviado_em DESC', [req.params.grupoId])).rows;
  }
  const chat = (await query('SELECT * FROM chat_grupo_cientifico WHERE grupo_id=$1 ORDER BY criado_em ASC', [req.params.grupoId])).rows;
  const timeline = (await query('SELECT * FROM timeline_grupo_cientifico WHERE grupo_id=$1 ORDER BY criado_em DESC', [req.params.grupoId])).rows;
  const avisos = (await query('SELECT * FROM avisos_cientificos WHERE projeto_id=$1 AND (grupo_id=$2 OR grupo_id IS NULL) ORDER BY criado_em DESC', [projeto.id, req.params.grupoId])).rows;
  res.render('pages/portal/grupo', { config, membro, grupo, projeto, versoes, chat, timeline, avisos, msg, erro });
});

// POST /portal/grupo/:grupoId/upload
router.post('/portal/grupo/:grupoId/upload', requirePortal, uploadArq.single('arquivo'), async (req, res) => {
  const { tipo, id } = req.session.portalMembro;
  const mR = await query('SELECT 1 FROM membros_grupo_cientifico WHERE grupo_id=$1 AND origem_tipo=$2 AND origem_id=$3', [req.params.grupoId, tipo, id]);
  if (!mR.rows.length) return res.redirect('/portal');
  if (!req.file) { req.session.erro=['Selecione um arquivo.']; return res.redirect('back'); }
  const chave = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'cientifico/trabalhos');
  await query('INSERT INTO versoes_trabalho (grupo_id,arquivo_chave,arquivo_nome,enviado_por_tipo,enviado_por_id) VALUES ($1,$2,$3,$4,$5)',
    [req.params.grupoId, chave, req.file.originalname, tipo, id]);
  const membro = await getPortalMembro(tipo, id);
  await registrarTimeline(req.params.grupoId, 'Nova versao enviada', (membro?.nome||'Membro')+' enviou uma nova versao do trabalho');
  // Notificar diretores cientificos via WhatsApp
  try {
    const { enviarWhatsApp } = require('../services/notificacoes');
    const gInfoR = await query('SELECTgc.nome as gnome, pc.titulo as ptitulo FROM grupos_cientificos gc JOIN projetos_cientificos pc ON pc.id=gc.projeto_id WHERE gc.id=$1',[req.params.grupoId]);
    const gInfo = gInfoR.rows[0];
    const diretoresR = await query("SESECT u.id, d.whatsapp, d.nome FROM usuario_permissoes up JOIN usuarios u ON u.id=up.usuario_id LEFT JOIN diretivos d ON LOWER(d.email)=LOWER(u.email) WHERE up.modulo='cientifico' AND d.whatsapp IS NOT NULL");
    const msgDir = `*LAURO - Portal Cientifico*

Nova versao de trabalho enviada!

*Projeto:* ${gInfo?.ptitulo||''}
)]rupo: * ${gInfo?.gnome||''}
*Enviado por:* ${membro?.nome||'Membro'}

Acesse o sistema para revisar:
https://sistema.lauroucpcde.com/cientifico`;
    for (const d of diretoresR.rows) { if (d.whatsapp) { try { await enviarWhatsApp(d.whatsapp, msgDir); } catch(e){} } }
  } catch(e) { console.error('[WPP Cientifico] Erro ao notificar diretores:', e.message); }
  req.session.msg=['Versao enviada com sucesso!'];
  res.redirect('/portal/grupo/'+req.params.grupoId);
});

// POST /portal/grupo/:grupoId/chat
router.post('/portal/grupo/:grupoId/chat', requirePortal, uploadArq.single('arquivo_chat'), async (req, res) => {
  const { tipo, id } = req.session.portalMembro;
  const mR = await query('SELECT 1 FROM membros_grupo_cientifico WHERE grupo_id=$1 AND origem_tipo=$2 AND origem_id=$3', [req.params.grupoId, tipo, id]);
  if (!mR.rows.length) return res.redirect('/portal');
  const { texto } = req.body;
  if (!texto && !req.file) return res.redirect('back');
  const membro = await getPortalMembro(tipo, id);
  let arquivo_chave=null, arquivo_nome=null;
  if (req.file) {
    arquivo_chave = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'cientifico/chat');
    arquivo_nome = req.file.originalname;
  }
  await query('INSERT INTO chat_grupo_cientifico (grupo_id,autor_tipo,autor_id,autor_nome,texto,arquivo_chave,arquivo_nome) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [req.params.grupoId, 'portal', id, membro?.nome||'Membro', texto||null, arquivo_chave, arquivo_nome]);
  res.redirect('/portal/grupo/'+req.params.grupoId+'?tab=chat');
});

// GET /portal/arquivo/:projetoId/:tipo
router.get('/portal/arquivo/:projetoId/:tipo', requirePortal, async (req, res) => {
  const pR = await query('SELECT * FROM projetos_cientificos WHERE id=$1', [req.params.projetoId]);
  if (!pR.rows.length) return res.status(404).send('Nao encontrado');
  const p = pR.rows[0];
  const chave = req.params.tipo==='edital' ? p.edital_chave : p.modelo_chave;
  if (!chave) return res.status(404).send('Arquivo nao encontrado');
  const url = await gerarUrlInline(chave);
  res.redirect(url);
});

// POST /admin/disparar-cobrancas-vencidas (só vencidas, a partir do dia 16, com intervalo seguro)
router.post('/admin/disparar-cobrancas-vencidas', requireAuth, async (req, res) => {
  const hoje = new Date().toISOString().split('T')[0];
  const config = (await query('SELECT chave, valor FROM configuracoes')).rows.reduce((a,r)=>{a[r.chave]=r.valor;return a},{});
  const { notificarCobranca } = require('../services/notificacoes');
  // Buscar cobranças vencidas (data_vencimento < hoje) e não pagas, sem notificação pos já enviada
  const r = await query(`
    SELECT c.*, m.nome, m.email, m.whatsapp FROM cobrancas c
    JOIN membros m ON m.id=c.membro_id
    WHERE c.data_vencimento::date < $1
    AND c.status='pendente'
    AND m.ativo=1
    AND NOT EXISTS (
      SELECT 1 FROM notificacoes_log nl
      WHERE nl.cobranca_id=c.id AND nl.tipo='pos' AND nl.canal='email' AND nl.status='ok'
    )
    ORDER BY c.data_vencimento ASC, m.nome ASC
  `, [hoje]);
  let enfileirados = 0;
  // Enviar em background com intervalo de 8s entre emails (evita spam e bloqueio)
  res.json({ ok: true, total: r.rows.length, msg: `Iniciando envio de ${r.rows.length} cobranças vencidas por email. Serão enviadas com intervalo de 8s cada.` });
  for (const cob of r.rows) {
    try {
      await notificarCobranca({ membro: {...cob, id: cob.membro_id}, cobranca: cob, tipo: 'pos', config, canal: 'email' });
      enfileirados++;
      console.log(`[COBRANCA-VENCIDA] Email enviado: ${cob.nome} (${enfileirados}/${r.rows.length})`);
    } catch(e) {
      console.error(`[COBRANCA-VENCIDA] Erro ao enviar para ${cob.nome}:`, e.message);
    }
    // Intervalo de 8s entre cada email para não sobrecarregar servidor SMTP
    if (enfileirados < r.rows.length) await new Promise(r => setTimeout(r, 8000));
  }
  console.log(`[COBRANCA-VENCIDA] Concluído: ${enfileirados}/${r.rows.length} emails enviados`);
});

// POST /admin/disparar-cobrancas-pre (disparo seguro via sistema)
router.post('/admin/disparar-cobrancas-pre', requireAuth, async (req, res) => {
  const { data_vencimento } = req.body;
  if (!data_vencimento) return res.json({ erro: 'data_vencimento obrigatoria' });
  const config = (await query('SELECT chave, valor FROM configuracoes')).rows.reduce((a,r)=>{a[r.chave]=r.valor;return a},{});
  const { notificarCobranca } = require('../services/notificacoes');
  const r = await query(`SELECT c.*, m.nome, m.email, m.whatsapp FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.data_vencimento::date=$1 AND c.status='pendente' AND m.ativo=1 AND NOT EXISTS (SELECT 1 FROM notificacoes_log nl WHERE nl.cobranca_id=c.id AND nl.tipo='pre' AND nl.canal='whatsapp' AND nl.status='ok') ORDER BY m.nome`,[data_vencimento]);
  let enfileirados=0;
  for (const cob of r.rows) {
    await notificarCobranca({ membro: {...cob, id: cob.membro_id}, cobranca: cob, tipo: 'pre', config, canal: 'whatsapp' });
    enfileirados++;
  }
  res.json({ ok: true, enfileirados, msg: 'Mensagens enfileiradas com seguranca. Serao enviadas com intervalos de 90s.' });
});

// GET /cientifico/chat-arquivo/:chatId
router.get('/cientifico/chat-arquivo/:chatId', requireAuth, async (req, res) => {
  const r = await query('SELECT * FROM chat_grupo_cientifico WHERE id=$1',[req.params.chatId]);
  if (!r.rows.length || !r.rows[0].arquivo_chave) return res.status(404).send('Nao encontrado');
  const url = await gerarUrlInline(r.rows[0].arquivo_chave);
  res.redirect(url);
});

// GET /portal/chat-arquivo/:chatId
router.get('/portal/chat-arquivo/:chatId', requirePortal, async (req, res) => {
  const r = await query('SELECT * FROM chat_grupo_cientifico WHERE id=$1',[req.params.chatId]);
  if (!r.rows.length || !r.rows[0].arquivo_chave) return res.status(404).send('Nao encontrado');
  const url = await gerarUrlInline(r.rows[0].arquivo_chave);
  res.redirect(url);
});


// Foto publica para portal do membro
router.get('/membro/foto/:tipo/:id', requireMembro, async (req, res) => {
  const { tipo, id } = req.params;
  const tabela = tipo==='diretivo'?'diretivos':'ligantes';
  const r = await query(`SELECT foto_chave FROM ${tabela} WHERE id=$1`, [id]);
  if(!r.rows[0]||!r.rows[0].foto_chave) return res.status(404).send('');
  const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const R2 = new S3Client({ region:'auto', endpoint:process.env.R2_ENDPOINT, credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY }});
  const url = await getSignedUrl(R2, new GetObjectCommand({ Bucket:process.env.R2_BUCKET||'liga-urologia-files', Key:r.rows[0].foto_chave }), { expiresIn:3600 });
  res.redirect(url);
});

// ─── PORTAL DO MEMBRO ────────────────────────────────────────────────────────
const bcryptMembro = bcryptCient;

async function requireMembro(req, res, next) {
  if (!req.session.membroPortal) return res.redirect('/membro/login');
  const { tipo, id } = req.session.membroPortal;
  const tabela = tipo === 'ligante' ? 'ligantes' : 'diretivos';
  const r = await query('SELECT ativo, pendente FROM ' + tabela + ' WHERE id=$1', [id]);
  if (!r.rows.length || r.rows[0].ativo != 1 || r.rows[0].pendente) {
    req.session.membroPortal = null;
    return res.render('pages/membro/login', { erro: 'Você não tem mais permissão para acessar essa área. Esta área é restrita a membros ativos da Liga.' });
  }
  next();
}

async function getMembroPortal(tipo, id) {
  if (tipo === 'ligante') {
    const r = await query('SELECT id, nome, email, whatsapp FROM ligantes WHERE id=$1 AND ativo=1 AND pendente=false', [id]);
    return r.rows[0] ? { ...r.rows[0], tipo: 'ligante' } : null;
  } else {
    const r = await query('SELECT id, nome, email, whatsapp FROM diretivos WHERE id=$1 AND ativo=1 AND pendente=false', [id]);
    return r.rows[0] ? { ...r.rows[0], tipo: 'diretivo' } : null;
  }
}

// GET /membro/login
router.get('/membro/login', (req, res) => {
  if (req.session.membroPortal) return res.redirect('/membro/dashboard');
  res.render('pages/membro/login', { erro: null });
});

// POST /membro/login
router.post('/membro/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.render('pages/membro/login', { erro: 'Preencha email e senha.' });
  let membro = null, tipo = null, id = null;
  const l = await query('SELECT id, nome, email FROM ligantes WHERE LOWER(email)=LOWER($1) AND ativo=1 AND pendente=false', [email]);
  if (l.rows.length) { membro = l.rows[0]; tipo = 'ligante'; id = l.rows[0].id; }
  if (!membro) {
    const d = await query('SELECT id, nome, email FROM diretivos WHERE LOWER(email)=LOWER($1) AND ativo=1 AND pendente=false', [email]);
    if (d.rows.length) { membro = d.rows[0]; tipo = 'diretivo'; id = d.rows[0].id; }
  }
  if (!membro) {
    // Verificar se existe mas está inativo
    const lInat = await query('SELECT id FROM ligantes WHERE LOWER(email)=LOWER($1)', [email]);
    const dInat = await query('SELECT id FROM diretivos WHERE LOWER(email)=LOWER($1)', [email]);
    if (lInat.rows.length || dInat.rows.length) {
      return res.render('pages/membro/login', { erro: 'Você não tem mais permissão para acessar essa área. Esta área é restrita a membros ativos da Liga.' });
    }
    return res.render('pages/membro/login', { erro: 'Email não encontrado.' });
  }
  const senhaR = await query('SELECT senha_hash, primeiro_acesso FROM portal_cientifico_senhas WHERE origem_tipo=$1 AND origem_id=$2', [tipo, id]);
  if (!senhaR.rows.length) return res.render('pages/membro/login', { erro: 'Acesso não configurado. Contate a secretaria.' });
  const ok = await bcryptMembro.compare(senha, senhaR.rows[0].senha_hash);
  if (!ok) return res.render('pages/membro/login', { erro: 'Senha incorreta.' });
  req.session.membroPortal = { tipo, id, nome: membro.nome, email: membro.email };
  if (senhaR.rows[0].primeiro_acesso) return res.redirect('/membro/trocar-senha');
  res.redirect('/membro/dashboard');
});

// GET /membro/trocar-senha
router.get('/membro/trocar-senha', requireMembro, (req, res) => {
  res.render('pages/portal/trocar-senha', { erro: null, baseUrl: '/membro' });
});

// POST /membro/trocar-senha
router.post('/membro/trocar-senha', requireMembro, async (req, res) => {
  const { nova_senha, confirmar_senha } = req.body;
  if (!nova_senha || nova_senha.length < 6) return res.render('pages/portal/trocar-senha', { erro: 'Senha deve ter pelo menos 6 caracteres.', baseUrl: '/membro' });
  if (nova_senha !== confirmar_senha) return res.render('pages/portal/trocar-senha', { erro: 'Senhas não conferem.', baseUrl: '/membro' });
  const { tipo, id } = req.session.membroPortal;
  const bcryptMembro = require('bcryptjs');
  const hash = await bcryptMembro.hash(nova_senha, 10);
  await query('UPDATE portal_cientifico_senhas SET senha_hash=$1, primeiro_acesso=false WHERE origem_tipo=$2 AND origem_id=$3', [hash, tipo, id]);
  res.redirect('/membro/dashboard');
});

// GET /membro/logout
router.get('/membro/logout', (req, res) => {
  req.session.membroPortal = null;
  res.redirect('/membro/login');
});

// GET /membro/dashboard
router.get('/membro/dashboard', requireMembro, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const { tipo, id } = req.session.membroPortal;
  const membro = await getMembroPortal(tipo, id);
  if (!membro) { req.session.membroPortal = null; return res.redirect('/membro/login'); }
  const hoje = new Date().toISOString().split('T')[0];
  const mesAtual = hoje.substring(0, 7);
  // Cobrança atual
  const mesRef = mesAtual.replace('-','');
  const cobR = await query(`SELECT * FROM cobrancas WHERE membro_id=(SELECT id FROM membros WHERE LOWER(email)=LOWER($1) LIMIT 1) AND status != 'cancelado' AND status IN ('pendente','atrasado') ORDER BY data_vencimento DESC LIMIT 1`, [membro.email]);
  const cobrancaAtual = cobR.rows[0] || null;
  // Frequencia ligante
  let frequencia = { percentual: 0, presencas: 0, total: 0 };
  if (tipo === 'ligante') {
    const membroDashR = await query('SELECT id FROM membros WHERE LOWER(email)=LOWER((SELECT email FROM ligantes WHERE id=$1))', [id]);
    const membroDashId = membroDashR.rows[0]?.id;
    if(membroDashId) {
      const tmR = await query('SELECT turma_id FROM turma_membros WHERE membro_id=$1 ORDER BY criado_em DESC LIMIT 1', [membroDashId]);
      if(tmR.rows.length) {
        const fR = await query('SELECT COUNT(*) FILTER (WHERE p.presente=1) as presencas, COUNT(*) as total FROM atividades a LEFT JOIN presencas p ON p.atividade_id=a.id AND p.membro_id=$1 WHERE a.turma_id=$2', [membroDashId, tmR.rows[0].turma_id]);
        if(fR.rows[0]) { const p=parseInt(fR.rows[0].presencas)||0; const t=parseInt(fR.rows[0].total)||0; frequencia={presencas:p,total:t,percentual:t>0?Math.round(p/t*100):0}; }
      }
    }
  } else if (tipo === 'diretivo') {
    const fR = await query(`SELECT COUNT(*) FILTER (WHERE dp.presente=1) as presencas, COUNT(*) as total FROM diretivo_atividades a INNER JOIN diretivo_presencas dp ON dp.atividade_id=a.id AND dp.diretivo_id=$1`,[id]);
    if(fR.rows[0]) { const p=parseInt(fR.rows[0].presencas)||0; const t=parseInt(fR.rows[0].total)||0; frequencia={presencas:p,total:t,percentual:t>0?Math.round(p/t*100):0}; }
  }
  // Comunicados
  const comR = await query(`
    SELECT c.*, 
      CASE WHEN cl.id IS NOT NULL THEN true ELSE false END as lido
    FROM comunicados c
    LEFT JOIN comunicados_leituras cl ON cl.comunicado_id=c.id AND cl.membro_tipo=$2 AND cl.membro_id=$3
    WHERE c.ativo=true AND (c.destinatarios='todos' OR c.destinatarios=$1) 
    ORDER BY c.criado_em DESC LIMIT 10
  `, [tipo==='ligante'?'ligantes':'diretivos', tipo, id]);
  const naoLidosR = await query(`
    SELECT COUNT(*) as total FROM comunicados c
    LEFT JOIN comunicados_leituras cl ON cl.comunicado_id=c.id AND cl.membro_tipo=$2 AND cl.membro_id=$3
    WHERE c.ativo=true AND (c.destinatarios='todos' OR c.destinatarios=$1) AND cl.id IS NULL
  `, [tipo==='ligante'?'ligantes':'diretivos', tipo, id]);
  const comunicadosNaoLidos = parseInt(naoLidosR.rows[0]?.total)||0;
  // Proximo evento
  const evR = await query(`SELECT id, nome, data_inicio, local FROM eventos WHERE data_inicio >= NOW() ORDER BY data_inicio ASC LIMIT 1`);
  // Grupos cientificos
  const grR = await query(`SELECT gc.nome as gnome, pc.titulo as ptitulo FROM membros_grupo_cientifico m JOIN grupos_cientificos gc ON gc.id=m.grupo_id JOIN projetos_cientificos pc ON pc.id=gc.projeto_id WHERE m.origem_tipo=$1 AND m.origem_id=$2`, [tipo, id]);
  res.render('pages/membro/dashboard', { membro, cobrancaAtual, frequencia, comunicados: comR.rows, comunicadosNaoLidos, proximoEvento: evR.rows[0]||null, grupos: grR.rows });
});

// GET /membro/financeiro/dados — API JSON para historico inline
router.get('/membro/financeiro/dados', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try {
    const membro = await getMembroPortal(tipo, id);
    const cobR = await query("SELECT * FROM cobrancas WHERE membro_id=(SELECT id FROM membros WHERE LOWER(email)=LOWER($1) LIMIT 1) AND status != 'cancelado' ORDER BY data_vencimento DESC", [membro.email]);
    res.json({ cobrancas: cobR.rows });
  } catch(e) { res.json({ cobrancas: [], error: e.message }); }
});

// GET /membro/financeiro
router.get('/membro/financeiro', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  const membro = await getMembroPortal(tipo, id);
  const cobR = await query(`SELECT * FROM cobrancas WHERE membro_id=(SELECT id FROM membros WHERE LOWER(email)=LOWER($1) LIMIT 1) AND status != 'cancelado' ORDER BY data_vencimento DESC`, [membro.email]);
  res.render('pages/membro/financeiro', { membro, cobrancas: cobR.rows });
});

// POST /membro/comunicado/:id/lido — marcar comunicado como lido
router.post('/membro/comunicado/:id/lido', requireMembro, async (req, res) => {
  try {
    const { tipo, id } = req.session.membroPortal;
    await query(
      'INSERT INTO comunicados_leituras (comunicado_id, membro_tipo, membro_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [req.params.id, tipo, id]
    );
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, erro: e.message }); }
});

// GET /membro/frequencia — redireciona para dashboard (novo portal)
router.get('/membro/frequencia', requireMembro, (req, res) => {
  res.redirect('/membro/dashboard#frequencia');
});

// GET /membro/frequencia/dados — API JSON para historico inline
router.get('/membro/frequencia/dados', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  let registros = [];
  try {
    if (tipo === 'ligante') {
      const membroR = await query('SELECT id FROM membros WHERE LOWER(email)=LOWER((SELECT email FROM ligantes WHERE id=$1))', [id]);
      const membroId = membroR.rows[0]?.id;
      if(membroId) {
        const tmR = await query('SELECT turma_id FROM turma_membros WHERE membro_id=$1 ORDER BY criado_em DESC LIMIT 1', [membroId]);
        if(tmR.rows.length) {
          const fR = await query(`SELECT a.data_atividade as data, a.descricao, p.presente FROM atividades a INNER JOIN presencas p ON p.atividade_id=a.id AND p.membro_id=$1 WHERE a.turma_id=$2 ORDER BY a.data_atividade DESC LIMIT 50`, [membroId, tmR.rows[0].turma_id]);
          registros = fR.rows;
        }
      }
    } else if (tipo === 'diretivo') {
      const fR = await query(`SELECT a.data_atividade as data, a.descricao, COALESCE(dp.presente,0) as presente FROM diretivo_atividades a INNER JOIN diretivo_presencas dp ON dp.atividade_id=a.id AND dp.diretivo_id=$1 ORDER BY a.data_atividade DESC LIMIT 50`, [id]);
      registros = fR.rows;
    }
    res.json({ registros });
  } catch(e) { res.json({ registros: [], error: e.message }); }
});

// GET /membro/eventos — redireciona para dashboard (novo portal)
router.get('/membro/eventos', requireMembro, (req, res) => {
  res.redirect('/membro/dashboard#eventos');
});

// GET /membro/eventos/dados — API JSON para eventos inline
router.get('/membro/eventos/dados', requireMembro, async (req, res) => {
  try {
    const evR = await query(`SELECT id, nome, data_inicio, local, descricao, status FROM eventos ORDER BY data_inicio DESC LIMIT 30`);
    res.json({ eventos: evR.rows });
  } catch(e) { res.json({ eventos: [], error: e.message }); }
});

// GET /membro/agenda — redireciona para dashboard (novo portal)
router.get('/membro/agenda', requireMembro, (req, res) => {
  res.redirect('/membro/dashboard#agenda');
});

// GET /membro/agenda/dados — API JSON para calendario inline
router.get('/membro/agenda/dados', requireMembro, async (req, res) => {
  try {
    const mes = parseInt(req.query.mes) || (new Date().getMonth()+1);
    const ano = parseInt(req.query.ano) || new Date().getFullYear();
    const evR = await query(`SELECT id, nome as titulo, data_inicio, local FROM eventos WHERE data_inicio >= NOW() - INTERVAL '7 days' ORDER BY data_inicio ASC LIMIT 20`);
    const anivR = await query(`SELECT id, nome, tipo, foto_chave, TO_CHAR(data_nascimento::date,'YYYY-MM-DD') as data_nascimento FROM (SELECT id, nome, data_nascimento, foto_chave, 'ligante' as tipo FROM ligantes WHERE ativo=1 AND data_nascimento IS NOT NULL UNION ALL SELECT id, nome, data_nascimento, foto_chave, 'diretivo' as tipo FROM diretivos WHERE ativo=1 AND data_nascimento IS NOT NULL) t WHERE EXTRACT(MONTH FROM data_nascimento::date)=$1 ORDER BY EXTRACT(DAY FROM data_nascimento::date)`, [mes]);
    res.json({ eventos: evR.rows, aniversariantes: anivR.rows });
  } catch(e) { res.json({ eventos: [], aniversariantes: [], error: e.message }); }
});

// GET /membro/comunicados — redireciona para dashboard (novo portal)
router.get('/membro/comunicados', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try { await query(`UPDATE portal_cientifico_senhas SET ultimo_acesso_comunicados=NOW() WHERE origem_tipo=$1 AND origem_id=$2`, [tipo, id]); } catch(e) {}
  res.redirect('/membro/dashboard#comunicados');
});

// GET /membro/perfil/dados
router.get('/membro/perfil/dados', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try {
    let dados = null;
    const editR = await query("SELECT valor FROM configuracoes WHERE chave='portal_membro_edicao_liberada'");
    const edicaoLiberada = editR.rows[0]?.valor === '1';
    if (tipo === 'ligante') {
      const r = await query(`SELECT id, nome, email, email_alternativo, whatsapp, data_nascimento, sexo, rg, cpf,
        semestre, turma, semestre_ingresso, catraca, orcid, foto_chave,
        tem_formacao, qual_formacao, habilidades, aceita_cargo, qual_cargo,
        contribuicao_grupo, ideia_inovadora, tema_interesse, porque_lauro, apresentacao
        FROM ligantes WHERE id=$1`, [id]);
      dados = r.rows[0] ? { ...r.rows[0], tipo: 'ligante' } : null;
    } else {
      const r = await query(`SELECT id, nome, email, whatsapp, data_nascimento, rg, cpf, catraca, cargo,
        semestre_turma, orcid, instagram, graduacao, ano_ingresso, onde_reside,
        transporte_proprio, tipo_transporte, disponibilidade, experiencia_urologia, foto_chave
        FROM diretivos WHERE id=$1`, [id]);
      dados = r.rows[0] ? { ...r.rows[0], tipo: 'diretivo' } : null;
    }
    res.json({ dados, edicaoLiberada });
  } catch(e) { res.json({ dados: null, edicaoLiberada: false, error: e.message }); }
});

// GET /membro/estatuto/dados
router.get('/membro/estatuto/dados', requireMembro, async (req, res) => {
  try {
    const r = await query("SELECT valor FROM configuracoes WHERE chave='estatuto_pdf_chave'");
    const chave = r.rows[0]?.valor || '';
    if (!chave) return res.json({ url: null, msg: 'Estatuto nao disponivel ainda.' });
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const R2 = new S3Client({ region:'auto', endpoint:process.env.R2_ENDPOINT, credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY }});
    const url = await getSignedUrl(R2, new GetObjectCommand({ Bucket:process.env.R2_BUCKET||'liga-urologia-files', Key:chave }), { expiresIn:3600 });
    res.json({ url });
  } catch(e) { res.json({ url: null, msg: 'Erro ao carregar estatuto.' }); }
});

// GET /membro/regulamento/dados
router.get('/membro/regulamento/dados', requireMembro, async (req, res) => {
  try {
    const r = await query("SELECT valor FROM configuracoes WHERE chave='regulamento_pdf_chave'");
    const chave = r.rows[0]?.valor || '';
    if (!chave) return res.json({ url: null, msg: 'Regulamento nao disponivel ainda.' });
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const R2 = new S3Client({ region:'auto', endpoint:process.env.R2_ENDPOINT, credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY }});
    const url = await getSignedUrl(R2, new GetObjectCommand({ Bucket:process.env.R2_BUCKET||'liga-urologia-files', Key:chave }), { expiresIn:3600 });
    res.json({ url });
  } catch(e) { res.json({ url: null, msg: 'Erro ao carregar regulamento.' }); }
});

// GET /membro/contrato/dados
router.get('/membro/contrato/dados', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try {
    if (tipo !== 'ligante') return res.json({ url: null, msg: 'Contratos disponiveis apenas para ligantes.' });
    const r = await query('SELECT pdf_assinado_chave, pdf_chave, status, criado_em FROM contratos_ligantes WHERE ligante_id=$1 ORDER BY criado_em DESC LIMIT 1', [id]);
    if (!r.rows[0]) return res.json({ url: null, msg: 'Nenhum contrato encontrado.' });
    const chave = r.rows[0].pdf_assinado_chave || r.rows[0].pdf_chave;
    if (!chave) return res.json({ url: null, msg: 'PDF do contrato nao disponivel.', status: r.rows[0].status });
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const R2 = new S3Client({ region:'auto', endpoint:process.env.R2_ENDPOINT, credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY }});
    const url = await getSignedUrl(R2, new GetObjectCommand({ Bucket:process.env.R2_BUCKET||'liga-urologia-files', Key:chave }), { expiresIn:3600 });
    res.json({ url, status: r.rows[0].status });
  } catch(e) { res.json({ url: null, msg: 'Erro ao carregar contrato.' }); }
});

// Admin upload estatuto/regulamento
router.post('/admin/portal/estatuto', requireAuth, require('../services/arquivos').upload.single('arquivo'), async (req, res) => {
  if (!req.file) return res.json({ ok: false, msg: 'Nenhum arquivo.' });
  const chave = req.file.key || req.file.filename;
  await query("INSERT INTO configuracoes (chave, valor) VALUES ('estatuto_pdf_chave', $1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [chave]);
  res.json({ ok: true, chave });
});
router.post('/admin/portal/regulamento', requireAuth, require('../services/arquivos').upload.single('arquivo'), async (req, res) => {
  if (!req.file) return res.json({ ok: false, msg: 'Nenhum arquivo.' });
  const chave = req.file.key || req.file.filename;
  await query("INSERT INTO configuracoes (chave, valor) VALUES ('regulamento_pdf_chave', $1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [chave]);
  res.json({ ok: true, chave });
});
router.post('/admin/portal/edicao-perfil', requireAuth, async (req, res) => {
  const { liberada } = req.body;
  await query("INSERT INTO configuracoes (chave, valor) VALUES ('portal_membro_edicao_liberada', $1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [liberada ? '1' : '0']);
  res.json({ ok: true, liberada: !!liberada });
});

// GET /membro/chat/mensagens
router.get('/membro/chat/mensagens', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try {
    const r = await query('SELECT id, autor, texto, criado_em, lido_admin FROM portal_mensagens WHERE origem_tipo=$1 AND origem_id=$2 ORDER BY criado_em ASC LIMIT 100', [tipo, id]);
    await query("UPDATE portal_mensagens SET lido_membro=true WHERE origem_tipo=$1 AND origem_id=$2 AND autor='admin'", [tipo, id]);
    res.json({ mensagens: r.rows });
  } catch(e) { res.json({ mensagens: [], error: e.message }); }
});

// POST /membro/chat/enviar (fallback sem socket)
router.post('/membro/chat/enviar', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  const { texto } = req.body;
  if (!texto || !texto.trim()) return res.json({ ok: false });
  try {
    const r = await query('INSERT INTO portal_mensagens (origem_tipo, origem_id, autor, texto) VALUES ($1,$2,$3,$4) RETURNING id, criado_em', [tipo, id, 'membro', texto.trim()]);
    const io = req.app._io;
    if (io) io.to('admins').emit('chat_novo', { tipo, id, texto: texto.trim() });
    res.json({ ok: true, msg: r.rows[0] });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

// Admin: GET /admin/chat/mensagens/:tipo/:id
router.get('/admin/chat/mensagens/:tipo/:id', requireAuth, async (req, res) => {
  const { tipo, id } = req.params;
  try {
    const r = await query('SELECT id, autor, texto, criado_em FROM portal_mensagens WHERE origem_tipo=$1 AND origem_id=$2 ORDER BY criado_em ASC', [tipo, id]);
    await query("UPDATE portal_mensagens SET lido_admin=true WHERE origem_tipo=$1 AND origem_id=$2 AND autor='membro'", [tipo, id]);
    res.json({ mensagens: r.rows });
  } catch(e) { res.json({ mensagens: [], error: e.message }); }
});

// Admin: POST /admin/chat/responder
router.post('/admin/chat/responder', requireAuth, async (req, res) => {
  const { tipo, id, texto } = req.body;
  if (!texto || !tipo || !id) return res.json({ ok: false });
  try {
    const r = await query('INSERT INTO portal_mensagens (origem_tipo, origem_id, autor, texto) VALUES ($1,$2,$3,$4) RETURNING id, criado_em', [tipo, id, 'admin', texto.trim()]);
    const io = req.app._io;
    if (io) io.to('membro_' + tipo + '_' + id).emit('chat_msg_ok', { id: r.rows[0].id, texto: texto.trim(), criado_em: r.rows[0].criado_em, autor: 'admin' });
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

// Admin: GET /admin/chat/lista — membros com mensagens nao lidas
router.get('/admin/chat/lista', requireAuth, async (req, res) => {
  try {
    const r = await query(`SELECT pm.origem_tipo, pm.origem_id, 
      COALESCE(l.nome, d.nome) as nome,
      COUNT(*) FILTER (WHERE pm.autor='membro' AND pm.lido_admin=false) as nao_lidas,
      MAX(pm.criado_em) as ultima_msg,
      (SELECT texto FROM portal_mensagens WHERE origem_tipo=pm.origem_tipo AND origem_id=pm.origem_id ORDER BY criado_em DESC LIMIT 1) as ultimo_texto
      FROM portal_mensagens pm
      LEFT JOIN ligantes l ON pm.origem_tipo='ligante' AND pm.origem_id=l.id
      LEFT JOIN diretivos d ON pm.origem_tipo='diretivo' AND pm.origem_id=d.id
      GROUP BY pm.origem_tipo, pm.origem_id, l.nome, d.nome
      ORDER BY MAX(pm.criado_em) DESC`);
    res.json({ conversas: r.rows });
  } catch(e) { res.json({ conversas: [], error: e.message }); }
});


// ─── FIM PORTAL DO MEMBRO ─────────────────────────────────────────────────────

// GET /membro/esqueci-senha

// Materiais de estudo — portal do membro (redireciona para dashboard novo portal)
router.get('/membro/materiais', requireMembro, (req, res) => {
  res.redirect('/membro/dashboard#materiais');
});
router.get('/membro/materiais/dados', requireMembro, async (req, res) => {
  const materiais = await query("SELECT * FROM materiais_estudo WHERE ativo=true ORDER BY ordem ASC, criado_em DESC");
  res.json({ materiais: materiais.rows });
});
router.get('/membro/materiais-lista', requireMembro, async (req, res) => {
  const materiais = await query("SELECT * FROM materiais_estudo WHERE ativo=true ORDER BY ordem ASC, criado_em DESC");
  const membro = await getMembroPortal(req.session.membroPortal.tipo, req.session.membroPortal.id);
  res.render('pages/membro/materiais', { membro, materiais: materiais.rows });
});

router.get('/membro/esqueci-senha', (req, res) => {
  res.render('pages/membro/esqueci-senha', { erro: null, ok: null });
});

// POST /membro/esqueci-senha
router.post('/membro/esqueci-senha', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.render('pages/membro/esqueci-senha', { erro: 'Informe o email.', ok: null });
  // Buscar ligante ou diretivo
  let tipo = null, id = null;
  const l = await query('SELECT id FROM ligantes WHERE LOWER(email)=LOWER($1) AND ativo=1', [email]);
  if (l.rows.length) { tipo = 'ligante'; id = l.rows[0].id; }
  if (!tipo) {
    const d = await query('SELECT id FROM diretivos WHERE LOWER(email)=LOWER($1) AND ativo=1', [email]);
    if (d.rows.length) { tipo = 'diretivo'; id = d.rows[0].id; }
  }
  // Nao revelar se email existe ou nao (seguranca)
  if (!tipo) return res.render('pages/membro/esqueci-senha', { erro: null, ok: 'Se o email estiver cadastrado, voce recebera o codigo em instantes.' });
  // Gerar codigo de 6 digitos
  const codigo = Math.floor(100000 + Math.random() * 900000).toString();
  const expira = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos
  // Invalidar codigos anteriores
  await query('UPDATE recuperacao_senha_portal SET usado=true WHERE email=LOWER($1) AND usado=false', [email]);
  // Salvar novo codigo
  await query('INSERT INTO recuperacao_senha_portal (origem_tipo, origem_id, email, codigo, expira_em) VALUES ($1,$2,LOWER($3),$4,$5)', [tipo, id, email, codigo, expira]);
  // Enviar email
  try {
    const { enviarEmail } = require('../services/notificacoes');
    const config = await getConfig();
    const orgNome = config.org_nome || 'LAURO - Liga Academica de Urologia';
    await enviarEmail({
      para: email,
      assunto: 'Codigo de recuperacao de senha — ' + orgNome,
      html: `<div style="font-family:'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#0C231B;margin-bottom:8px">${orgNome}</h2>
        <p style="color:#6B7A72;margin-bottom:24px">Portal do Membro</p>
        <p style="margin-bottom:16px">Voce solicitou a recuperacao de senha. Use o codigo abaixo para redefinir sua senha:</p>
        <div style="background:#0C231B;color:#4ade80;font-size:36px;font-weight:700;letter-spacing:12px;text-align:center;padding:24px;margin:24px 0">${codigo}</div>
        <p style="color:#6B7A72;font-size:13px">Este codigo expira em <strong>15 minutos</strong>.</p>
        <p style="color:#6B7A72;font-size:13px;margin-top:8px">Se nao foi voce, ignore este email.</p>
        <hr style="border:none;border-top:1px solid #E5EBE8;margin:24px 0">
        <p style="color:#9BA8A4;font-size:11px">Portal do Membro — <a href="https://membro.lauroucpcde.com" style="color:#0F6E56">membro.lauroucpcde.com</a></p>
      </div>`
    });
  } catch(e) { console.error('Erro ao enviar email recuperacao:', e.message); }
  res.render('pages/membro/esqueci-senha', { erro: null, ok: 'Se o email estiver cadastrado, voce recebera o codigo em instantes.' });
});

// GET /membro/verificar-codigo
router.get('/membro/verificar-codigo', (req, res) => {
  const email = req.query.email || '';
  res.render('pages/membro/verificar-codigo', { email, erro: null });
});

// POST /membro/verificar-codigo
router.post('/membro/verificar-codigo', async (req, res) => {
  const { email, codigo, nova_senha, confirmar_senha } = req.body;
  if (!codigo || !nova_senha || !confirmar_senha) return res.render('pages/membro/verificar-codigo', { email, erro: 'Preencha todos os campos.' });
  if (nova_senha !== confirmar_senha) return res.render('pages/membro/verificar-codigo', { email, erro: 'As senhas nao conferem.' });
  if (nova_senha.length < 6) return res.render('pages/membro/verificar-codigo', { email, erro: 'A senha deve ter pelo menos 6 caracteres.' });
  // Verificar codigo
  const r = await query('SELECT * FROM recuperacao_senha_portal WHERE LOWER(email)=LOWER($1) AND codigo=$2 AND usado=false AND expira_em > NOW() ORDER BY criado_em DESC LIMIT 1', [email, codigo.trim()]);
  if (!r.rows.length) return res.render('pages/membro/verificar-codigo', { email, erro: 'Codigo invalido ou expirado. Solicite um novo codigo.' });
  const rec = r.rows[0];
  // Atualizar senha
  const hash = await bcryptMembro.hash(nova_senha, 10);
  await query('UPDATE portal_cientifico_senhas SET senha_hash=$1, primeiro_acesso=false WHERE origem_tipo=$2 AND origem_id=$3', [hash, rec.origem_tipo, rec.origem_id]);
  // Marcar codigo como usado
  await query('UPDATE recuperacao_senha_portal SET usado=true WHERE id=$1', [rec.id]);
  res.redirect('/membro/login?msg=Senha+redefinida+com+sucesso');
});

// ─── COMUNICADOS SISTEMA INTERNO ─────────────────────────────────────────────
router.get('/comunicados', requireAuth, requirePermissao('comunicados'), async (req, res) => {
  const r = await query('SELECT c.*, u.nome as autor_nome FROM comunicados c LEFT JOIN usuarios u ON u.id=c.autor_id ORDER BY c.criado_em DESC');
  const configR = await query('SELECT chave, valor FROM configuracoes');
  const config = configR.rows.reduce((a,r)=>{a[r.chave]=r.valor;return a},{});
  res.render('pages/comunicados', { comunicados: r.rows, config, ok: req.query.ok||null, erro: req.query.erro||null });
});

router.post('/comunicados/novo', requireAuth, async (req, res) => {
  const { titulo, texto, destinatarios } = req.body;
  if (!titulo || !texto) return res.redirect('/comunicados?erro=Preencha+titulo+e+texto');
  await query('INSERT INTO comunicados (titulo, texto, destinatarios, autor_id) VALUES ($1,$2,$3,$4)', [titulo.trim(), texto.trim(), destinatarios||'todos', req.session.userId||null]);
  res.redirect('/comunicados?ok=Comunicado+publicado+com+sucesso');
});

router.post('/comunicados/:id/toggle', requireAuth, async (req, res) => {
  await query('UPDATE comunicados SET ativo = NOT ativo WHERE id=$1', [req.params.id]);
  res.redirect('/comunicados');
});

router.post('/comunicados/:id/excluir', requireAuth, async (req, res) => {
  await query('DELETE FROM comunicados WHERE id=$1', [req.params.id]);
  res.redirect('/comunicados?ok=Comunicado+excluido');
});
// ─── FIM COMUNICADOS ──────────────────────────────────────────────────────────
