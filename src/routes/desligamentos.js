// ═══ DESLIGAMENTOS ══════════════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requireAdmin, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');
const { logAtividade } = require('../services/log-atividade');
const { enviarEmail, emailBonito } = require('../services/email');

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

module.exports = function (router) {

// ─── DESLIGAMENTOS ────────────────────────────────────────────────────────────

router.get('/desligamentos', requireAuth, requirePermissao('desligamentos'), async (req, res) => {
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

router.post('/desligamentos', requireAuth, requirePermissao('desligamentos'), async (req, res) => {
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

router.get('/desligamentos/:id/visualizar', requireAuth, requirePermissao('desligamentos'), async (req, res) => {
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

router.post('/desligamentos/:id/enviar', requireAuth, requirePermissao('desligamentos'), async (req, res) => {
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

router.post('/desligamentos/:id/assinado', requireAuth, requirePermissao('desligamentos'), async (req, res) => {
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

router.get('/desligamentos/:id/assinado', requireAuth, requirePermissao('desligamentos'), async (req, res) => {
  try {
    const r = await query('SELECT pdf_assinado_chave FROM desligamentos WHERE id=$1', [req.params.id]);
    const d = r.rows[0];
    if (!d || !d.pdf_assinado_chave) return res.status(404).send('Não encontrado');
    const { getUrlAssinada } = require('../services/desligamento');
    const url = await getUrlAssinada(d.pdf_assinado_chave);
    res.redirect(url);
  } catch(e) { res.status(500).send('Erro'); }
});

router.post('/desligamentos/:id/substituir', requireAuth, requirePermissao('desligamentos'), async (req, res) => {
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


router.get('/desligamentos/:id/imprimir', requireAuth, requirePermissao('desligamentos'), async (req, res) => {
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

router.post('/desligamentos/:id/reenviar', requireAuth, requirePermissao('desligamentos'), async (req, res) => {
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

};
