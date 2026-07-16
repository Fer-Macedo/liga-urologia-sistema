// ═══ CARTA DE COBRANÇA ══════════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');
const { enviarEmail, emailBonito } = require('../services/email');
const { gerarPDFBuffer, ordinalEspanhol, calcularOrdinalPessoa } = require('../services/cartas');

function gerarHTMLCartaCobranca(pessoa, config, carta) {
  const timbrado = config.timbrado_b64 || null;
  const financeiroSrc = config.assinatura_financeiro_b64 || null;
  const nomeFinanceiro = (config.financeiro_nome || 'DIRECTOR(A) FINANCIERO(A)').toUpperCase();
  const d = new Date(carta.data || new Date());
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const dataStr = d.getDate() + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear();
  const mesRef = carta.mes_referencia || '___________';
  const venc = carta.vencimento ? new Date(carta.vencimento).toLocaleDateString('es-PY') : '___________';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Times New Roman',serif;font-size:11pt;color:#000}.pagina{width:210mm;height:297mm;position:relative;overflow:hidden}.bg{position:absolute;top:0;left:0;width:210mm;height:297mm;z-index:0}.bg img{width:210mm;height:297mm;display:block}.texto{position:absolute;top:52mm;left:22mm;width:166mm;height:203mm;z-index:1;display:flex;flex-direction:column}.titulo{font-size:13pt;font-weight:bold;text-align:center;margin-bottom:6px;text-transform:uppercase}.subtitulo{font-size:11pt;font-weight:bold;text-align:center;margin-bottom:14px;text-transform:uppercase}.corpo{text-align:justify;line-height:1.55;flex:1}.corpo p{margin-bottom:8px}.assinaturas{display:flex;flex-direction:column;gap:10px;align-items:center;margin-top:10px}.assinatura-bloco{text-align:center;width:70%}.assinatura-img-wrap{height:50px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:3px}.assinatura-img{max-height:50px;max-width:130px;object-fit:contain}.linha{border-top:1.5px solid #000;width:90%;margin:0 auto 3px}.assinatura-nome{font-weight:bold;font-size:8.5pt;text-transform:uppercase}.assinatura-cargo{font-size:8pt;margin-top:2px}@page{size:A4;margin:0}@media print{html,body{width:100vw;min-height:100vh;margin:0!important;padding:0!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.pagina{position:absolute;top:0;left:0;margin:0;padding:0;width:100vw;height:100vh;box-shadow:none;overflow:hidden}.bg{top:0;left:0;width:100vw;height:100vh}.bg img{width:100vw;height:100vh;display:block;object-fit:cover}}</style></head><body><div class="pagina"><div class="bg">${timbrado?`<img src="${timbrado}">`:''}</div><div class="texto"><div class="titulo">Carta de Cobro — LAURO</div><div class="subtitulo">Pago Mensual Vencido</div><div style="text-align:right;font-size:9pt;color:#555;margin-bottom:8px">N° ${carta.numero_carta ? String(carta.numero_carta).padStart(4,'0') : '----'}</div><div class="corpo"><p>Ciudad del Este/PY, ${dataStr}.</p><p>Estimado/a señor/a <strong>${pessoa.nome||'___________'}</strong>,</p><p>Esperamos que este mensaje le encuentre bien.</p><p>Nos ponemos en contacto con usted en nombre de LAURO – Liga Académica de Urología para recordarle que su cuota de membresía está vencida. Como ya le informamos, las cuotas de membresía vencen el día 15 de cada mes.</p><p>Hasta la fecha, no hemos recibido el pago de la cuota mensual correspondiente al mes de <strong>${mesRef}</strong>, cuyo vencimiento fue el <strong>${venc}</strong>. Solicitamos amablemente que se abone la deuda lo antes posible para evitar cualquier restricción en la participación en las actividades de la Liga.</p><p>Si ya ha realizado el pago, ignore este mensaje o, si es posible, envíenos el comprobante de pago para su verificación.</p><p>Estamos a su disposición para responder cualquier pregunta o proporcionar aclaraciones.</p><p style='margin-top:10px;font-style:italic;font-size:10pt'><strong>Esta es su ${ordinalEspanhol(carta.numero_ordinal||1)} notificacion oficial</strong> emitida por LAURO – Liga Academica de Urologia.</p><p>Atentamente,</p></div><div class="assinaturas"><div class="assinatura-bloco"><div class="assinatura-img-wrap">${financeiroSrc?`<img src="${financeiroSrc}" class="assinatura-img">`:''}</div><div class="linha"></div><div class="assinatura-nome">${nomeFinanceiro}</div><div class="assinatura-cargo">Director(a) Financiero(a)<br>LAURO – Liga Académica de Urología</div></div></div></div></div></body></html>`;
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

module.exports = function (router) {

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

router.post('/carta-cobranca', requireAuth, requirePermissao('carta-cobranca'), async (req, res) => {
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
    const html = gerarHTMLCartaCobranca(await buscarPessoaCarta(r.rows[0]), config, r.rows[0]);
    // Gera o PDF no servidor (chromium) para o timbrado sangrar ate a borda do A4.
    // Antes servia HTML + window.print(), e o navegador do usuario impunha suas
    // proprias margens, deixando faixa branca lateral. O PDF ja sai sem margem.
    const puppeteer = require('puppeteer-core');
    const chromium = require('@sparticuz/chromium');
    chromium.setHeadlessMode = true;
    chromium.setGraphicsMode = false;
    const browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      executablePath: await chromium.executablePath(),
      headless: 'new'
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
    await browser.close();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="carta-cobro.pdf"');
    // page.pdf() retorna Uint8Array; sem Buffer.from o Express serializa como JSON
    // e o navegador acusa "falha ao carregar o PDF".
    res.end(Buffer.from(pdf));
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

router.post('/carta-cobranca/:id/enviar', requireAuth, requirePermissao('carta-cobranca'), (req, res) => enviarCartaCobranca(req.params.id, req, res, false));
router.post('/carta-cobranca/:id/reenviar', requireAuth, requirePermissao('carta-cobranca'), (req, res) => enviarCartaCobranca(req.params.id, req, res, true));
router.post('/carta-cobranca/:id/deletar', requireAuth, requirePermissao('carta-cobranca'), async (req, res) => {
  await query('DELETE FROM cartas_cobranca WHERE id=$1', [req.params.id]);
  req.session.msg = ['Carta excluída!']; res.redirect('/carta-cobranca');
});

};
