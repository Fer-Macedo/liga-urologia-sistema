// ═══ CARTA DE NOTIFICACAO ═══════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');
const { enviarEmail, emailBonito } = require('../services/email');
const { ordinalEspanhol, calcularOrdinalPessoa, gerarPDFBuffer } = require('../services/cartas');

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

module.exports = function (router) {

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

router.post('/carta-notificacao', requireAuth, requirePermissao('carta-notificacao'), async (req, res) => {
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

router.post('/carta-notificacao/:id/editar', requireAuth, requirePermissao('carta-notificacao'), async (req, res) => {
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

router.post('/carta-notificacao/:id/enviar',   requireAuth, requirePermissao('carta-notificacao'), (req,res) => enviarCartaNotificacao(req.params.id,req,res,false));
router.post('/carta-notificacao/:id/reenviar', requireAuth, requirePermissao('carta-notificacao'), (req,res) => enviarCartaNotificacao(req.params.id,req,res,true));
router.post('/carta-notificacao/:id/deletar',  requireAuth, requirePermissao('carta-notificacao'), async (req,res) => {
  await query('DELETE FROM cartas_notificacao WHERE id=$1',[req.params.id]);
  req.session.msg=['Carta excluida!']; res.redirect('/carta-notificacao');
});

};
