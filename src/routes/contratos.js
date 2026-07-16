// ═══ CONTRATOS LIGANTES ═════════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requireAdmin, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');
const { enviarEmail, emailBonito } = require('../services/email');

module.exports = function (router) {

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

router.post('/contratos', requireAuth, requirePermissao('contratos'), async (req, res) => {
  try {
    const { ligante_id, data_inicio } = req.body;
    const tgR = await query("SELECT valor FROM configuracoes WHERE chave='contrato_texto_global'");
    const texto_contrato = tgR.rows[0]?.valor || '';
    await query('INSERT INTO contratos_ligantes (ligante_id, texto_contrato, data_inicio, criado_por) VALUES ($1,$2,$3,$4)', [ligante_id, texto_contrato, data_inicio||null, req.session.usuario.id]);
    req.session.msg = ['Contrato gerado!'];
  } catch(e) { req.session.erro = [e.message]; }
  res.redirect('/contratos');
});

router.post('/contratos/:id/editar', requireAuth, requirePermissao('contratos'), async (req, res) => {
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

router.get('/contratos/:id/pdf', requireAuth, requirePermissao('contratos'), async (req, res) => {
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
    res.end(Buffer.from(pdf)); // page.pdf() retorna Uint8Array; Buffer.from evita PDF corrompido
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.get('/contratos/:id/visualizar', requireAuth, requirePermissao('contratos'), async (req, res) => {
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
router.post('/contratos/timbrado', requireAuth, requirePermissao('contratos'), async (req, res) => {
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

router.post('/contratos/texto-global', requireAuth, requirePermissao('contratos'), async (req, res) => {
  try {
    const texto_contrato = req.body?.texto_contrato || '';
    await query('UPDATE contratos_ligantes SET texto_contrato=$1', [texto_contrato]);
    await query("INSERT INTO configuracoes(chave,valor) VALUES('contrato_texto_global',$1) ON CONFLICT(chave) DO UPDATE SET valor=$1", [texto_contrato]);
    req.session.msg=['Texto atualizado em todos os contratos!']; res.redirect('/contratos');
  } catch(e) { req.session.erro=[e.message]; res.redirect('/contratos'); }
});

router.get('/contratos/:id/imprimir', requireAuth, requirePermissao('contratos'), async (req, res) => { res.redirect('/contratos/'+req.params.id+'/visualizar'); });

router.post('/contratos/:id/enviar', requireAuth, requirePermissao('contratos'), async (req, res) => {
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

router.post('/contratos/:id/assinado', requireAuth, requirePermissao('contratos'), async (req, res) => {
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

router.get('/contratos/:id/assinado', requireAuth, requirePermissao('contratos'), async (req, res) => {
  try {
    const r = await query('SELECT pdf_assinado_chave FROM contratos_ligantes WHERE id=$1',[req.params.id]);
    const d = r.rows[0];
    if (!d||!d.pdf_assinado_chave) return res.status(404).send('Nao encontrado');
    const { getUrlAssinada } = require('../services/desligamento');
    const url = await getUrlAssinada(d.pdf_assinado_chave);
    res.redirect(url);
  } catch(e) { res.status(500).send(e.message); }
});

};
