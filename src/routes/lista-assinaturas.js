// ═══ LISTA DE ASSINATURAS ═══════════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requireAdmin, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');
const { logAtividade } = require('../services/log-atividade');
const { gerarHTMLLista } = require('../services/lista-assinatura');

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

async function gerarHTMLListaGenerica(lista, config) {
  const pessoas = await getPessoasLista(lista.tipo_publico);
  const d = lista.data_evento ? new Date(lista.data_evento).toLocaleDateString('es-PY') : null;
  return gerarHTMLLista(lista.nome, d, lista.descricao, pessoas, config);
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
    res.send(await gerarHTMLListaGenerica(r.rows[0], config));
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
    let html = await gerarHTMLListaGenerica(r.rows[0], config);
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
