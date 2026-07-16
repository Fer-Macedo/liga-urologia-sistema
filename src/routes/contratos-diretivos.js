// ═══ CONTRATOS DIRETIVOS ════════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requireAdmin, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');
const { enviarEmail, emailBonito } = require('../services/email');

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


module.exports = function (router) {

router.get('/contratos-diretivos', requireAuth, requirePermissao('contratos-diretivos'), async (req, res) => {
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

router.post('/contratos-diretivos', requireAuth, requirePermissao('contratos-diretivos'), async (req, res) => {
  try {
    const { diretivo_id, data_inicio } = req.body;
    const tgR = await query("SELECT valor FROM configuracoes WHERE chave='contrato_dir_texto_global'");
    const texto_contrato = tgR.rows[0]?.valor || '';
    await query('INSERT INTO contratos_diretivos (diretivo_id, texto_contrato, data_inicio, criado_por) VALUES ($1,$2,$3,$4)', [diretivo_id, texto_contrato, data_inicio||null, req.session.usuario.id]);
    req.session.msg = ['Contrato gerado!'];
  } catch(e) { req.session.erro = [e.message]; }
  res.redirect('/contratos-diretivos');
});

router.post('/contratos-diretivos/:id/editar', requireAuth, requirePermissao('contratos-diretivos'), async (req, res) => {
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

router.post('/contratos-diretivos/timbrado', requireAuth, requirePermissao('contratos-diretivos'), async (req, res) => {
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

router.post('/contratos-diretivos/texto-global', requireAuth, requirePermissao('contratos-diretivos'), async (req, res) => {
  try {
    const texto_contrato = req.body?.texto_contrato || '';
    await query('UPDATE contratos_diretivos SET texto_contrato=$1', [texto_contrato]);
    await query("INSERT INTO configuracoes(chave,valor) VALUES('contrato_dir_texto_global',$1) ON CONFLICT(chave) DO UPDATE SET valor=$1", [texto_contrato]);
    req.session.msg=['Texto atualizado!']; res.redirect('/contratos-diretivos');
  } catch(e) { req.session.erro=[e.message]; res.redirect('/contratos-diretivos'); }
});

router.get('/contratos-diretivos/:id/pdf', requireAuth, requirePermissao('contratos-diretivos'), async (req, res) => {
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

router.get('/contratos-diretivos/:id/imprimir', requireAuth, requirePermissao('contratos-diretivos'), async (req, res) => {
  res.redirect('/contratos-diretivos/'+req.params.id+'/pdf');
});

router.post('/contratos-diretivos/:id/enviar', requireAuth, requirePermissao('contratos-diretivos'), async (req, res) => {
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

router.post('/contratos-diretivos/:id/assinado', requireAuth, requirePermissao('contratos-diretivos'), async (req, res) => {
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

router.get('/contratos-diretivos/:id/assinado', requireAuth, requirePermissao('contratos-diretivos'), async (req, res) => {
  try {
    const r = await query('SELECT pdf_assinado_chave FROM contratos_diretivos WHERE id=$1',[req.params.id]);
    const d = r.rows[0];
    if (!d||!d.pdf_assinado_chave) return res.status(404).send('Nao encontrado');
    const { getUrlAssinada } = require('../services/desligamento');
    const url = await getUrlAssinada(d.pdf_assinado_chave);
    res.redirect(url);
  } catch(e) { res.status(500).send(e.message); }
});

};
