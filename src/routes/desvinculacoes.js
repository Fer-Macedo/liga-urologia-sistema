// ═══ DESVINCULAÇÕES ═════════════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requireAdmin, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');
const { enviarEmail, emailBonito } = require('../services/email');

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

module.exports = function (router) {

router.get('/desvinculacoes', requireAuth, requirePermissao('desvinculacoes'), async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];
  const [desvR, ligR] = await Promise.all([
    query(`SELECT d.*, l.nome as ligante_nome, l.email as ligante_email FROM desvinculacoes d LEFT JOIN ligantes l ON l.id=d.ligante_id ORDER BY d.criado_em DESC`),
    query('SELECT id,nome,email FROM ligantes WHERE ativo=1 ORDER BY nome')
  ]);
  res.render('pages/desvinculacoes', { config, usuario: req.session.usuario, msg, erro, desvinculacoes: desvR.rows, ligantes: ligR.rows });
});

router.post('/desvinculacoes', requireAuth, requirePermissao('desvinculacoes'), async (req, res) => {
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

router.get('/desvinculacoes/:id/adv/:num', requireAuth, requirePermissao('desvinculacoes'), async (req, res) => {
  try {
    if (!['1','2','3'].includes(req.params.num)) return res.status(400).send('Inválido');
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

router.get('/desvinculacoes/:id/visualizar', requireAuth, requirePermissao('desvinculacoes'), async (req, res) => {
  try {
    const rd = await query('SELECT * FROM desvinculacoes WHERE id=$1', [req.params.id]);
    if (!rd.rows[0]) return res.status(404).send('Não encontrado');
    const rl = await query('SELECT * FROM ligantes WHERE id=$1', [rd.rows[0].ligante_id]);
    const ligante = {...(rl.rows[0]||{}), num_advertencias: rd.rows[0].num_advertencias||3};
    const config = await prepararConfigDesvinc(await getConfig());
    res.send(await gerarHTMLDesvinculacao(ligante, config, rd.rows[0].data_solicitacao));
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.get('/desvinculacoes/:id/imprimir', requireAuth, requirePermissao('desvinculacoes'), async (req, res) => {
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

router.post('/desvinculacoes/:id/enviar', requireAuth, requirePermissao('desvinculacoes'), (req, res) => enviarEmailDesvinc(req.params.id, req, res, false));
router.post('/desvinculacoes/:id/reenviar', requireAuth, requirePermissao('desvinculacoes'), (req, res) => enviarEmailDesvinc(req.params.id, req, res, true));

router.post('/desvinculacoes/:id/assinado', requireAuth, requirePermissao('desvinculacoes'), async (req, res) => {
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

router.get('/desvinculacoes/:id/assinado', requireAuth, requirePermissao('desvinculacoes'), async (req, res) => {
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

router.post('/desvinculacoes/:id/editar', requireAuth, requirePermissao('desvinculacoes'), async (req, res) => {
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

};
