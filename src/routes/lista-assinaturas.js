// ═══ LISTA DE ASSINATURAS ═══════════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requireAdmin, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');
const { logAtividade } = require('../services/log-atividade');

module.exports = function (router) {

router.get('/lista-assinaturas', requireAuth, requirePermissao('lista-assinaturas'), async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const r = await query('SELECT * FROM listas_assinaturas ORDER BY data_evento DESC NULLS LAST, criado_em DESC');
  res.render('pages/lista-assinaturas', { config, usuario: req.session.usuario, msg, erro, listas: r.rows });
});

router.post('/lista-assinaturas', requireAuth, requirePermissao('lista-assinaturas'), async (req, res) => {
  const { nome, data_evento, descricao, tipo_publico } = req.body;
  await query('INSERT INTO listas_assinaturas (nome,data_evento,descricao,tipo_publico,criado_por) VALUES ($1,$2,$3,$4,$5)', [nome, data_evento||null, descricao||null, tipo_publico||'todos', req.session.usuario.id]);
  req.session.msg = ['Lista criada!']; res.redirect('/lista-assinaturas');
});

async function getPessoasLista(tipoPublico) {
  const incluirLigantes = tipoPublico !== 'diretivos';
  const incluirDiretivos = tipoPublico !== 'ligantes';
  const [ligR, dirR] = await Promise.all([
    incluirLigantes ? query('SELECT nome, rg, catraca FROM ligantes WHERE ativo=1 ORDER BY nome') : { rows: [] },
    incluirDiretivos ? query('SELECT nome, rg, catraca FROM diretivos WHERE ativo=1 ORDER BY nome') : { rows: [] }
  ]);
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
  const pessoas = await getPessoasLista(lista.tipo_publico);
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
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}@page{size:A4;margin:0}body{font-family:'Times New Roman',serif;color:#000}@media print{.pagina{page-break-after:always}}</style></head><body>${paginasHtml}</body></html>`;
}

router.get('/lista-assinaturas/:id/visualizar', requireAuth, requirePermissao('lista-assinaturas'), async (req, res) => {
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

router.get('/lista-assinaturas/:id/imprimir', requireAuth, requirePermissao('lista-assinaturas'), async (req, res) => {
  try {
    const r = await query('SELECT * FROM listas_assinaturas WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).send('Nao encontrado');
    const config = await getConfig();
    const { imagemBase64 } = require('../services/desligamento');
    config.timbrado_b64 = await imagemBase64(config.timbrado_chave);
    config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
    config.assinatura_vicepresidente_b64 = await imagemBase64(config.assinatura_vicepresidente_chave);
    config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
    let html = await gerarHTMLLista(r.rows[0], config);
    html = html.replace('</body>', '<script>window.onload=function(){window.focus();setTimeout(function(){window.print()},300)}</script></body>');
    res.send(html);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});


router.post('/lista-assinaturas/:id/editar', requireAuth, requirePermissao('lista-assinaturas'), async (req, res) => {
  try {
    const { nome, data_evento } = req.body;
    await query('UPDATE listas_assinaturas SET nome=$1, data_evento=$2 WHERE id=$3',
      [nome, data_evento||null, req.params.id]);
    req.session.msg=['Lista atualizada!'];
  } catch(e) { req.session.erro=['Erro: '+e.message]; }
  res.redirect('/lista-assinaturas');
});
router.post('/lista-assinaturas/:id/upload-assinada', requireAuth, requirePermissao('lista-assinaturas'), async (req, res) => {
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

router.get('/lista-assinaturas/:id/assinada', requireAuth, requirePermissao('lista-assinaturas'), async (req, res) => {
  try {
    const r = await query('SELECT pdf_assinado_chave FROM listas_assinaturas WHERE id=$1', [req.params.id]);
    const chave = r.rows[0]?.pdf_assinado_chave;
    if (!chave) return res.status(404).send('Nao encontrado');
    const { getUrlAssinada } = require('../services/desligamento');
    res.redirect(await getUrlAssinada(chave));
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.post('/lista-assinaturas/:id/deletar', requireAuth, requireAdmin, async (req, res) => {
  const r = await query('SELECT nome, data_evento FROM listas_assinaturas WHERE id=$1', [req.params.id]);
  await query('DELETE FROM listas_assinaturas WHERE id=$1', [req.params.id]);
  if (r.rows[0]) {
    await logAtividade(req.session.usuario.id, 'LISTA_ASSINATURA_EXCLUIDA', 'Lista "'+r.rows[0].nome+'" (evento '+(r.rows[0].data_evento||'sem data')+') excluida, ID: '+req.params.id, req);
  }
  req.session.msg = ['Lista excluida!']; res.redirect('/lista-assinaturas');
});

};
