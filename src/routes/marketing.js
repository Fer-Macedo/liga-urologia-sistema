const { query } = require('../models/database');
const { requireAuth, requireAdmin, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');

module.exports = function (router) {

// ─── MARKETING ────────────────────────────────────────────────────────────────

async function getMktConfig() {
  const r = await query('SELECT chave,valor FROM marketing_config');
  const cfg = {}; r.rows.forEach(row => cfg[row.chave] = row.valor); return cfg;
}

// Análise de desempenho da conta do Instagram (dados reais da API da Meta) — alimenta o
// painel "Desempenho da conta" na aba Analytics.
router.get('/marketing/instagram/analise', requireAuth, requirePermissao('marketing'), async (req, res) => {
  try {
    const { analiseConta } = require('../services/instagram-analise');
    res.json({ ok: true, ...(await analiseConta()) });
  } catch (e) {
    res.json({ ok: false, erro: e.message });
  }
});

// Análise estratégica por IA: última análise salva + gerar uma nova sob demanda.
router.get('/marketing/instagram/estrategia', requireAuth, requirePermissao('marketing'), async (req, res) => {
  try {
    const { ultimaEstrategia } = require('../services/instagram-estrategia');
    res.json({ ok: true, estrategia: await ultimaEstrategia() });
  } catch (e) {
    res.json({ ok: false, erro: e.message });
  }
});

router.post('/marketing/instagram/estrategia/gerar', requireAuth, requirePermissao('marketing'), async (req, res) => {
  try {
    const { gerarEstrategia } = require('../services/instagram-estrategia');
    const nome = req.session.usuario && req.session.usuario.nome;
    res.json(await gerarEstrategia(nome));
  } catch (e) {
    res.json({ ok: false, erro: e.message });
  }
});

// ── Ações sobre publicações agendadas do Instagram (cancelar / editar legenda) ──
router.post('/marketing/instagram/post/:id/cancelar', requireAuth, requirePermissao('marketing'), async (req, res) => {
  try {
    const r = await query("UPDATE instagram_posts SET status='cancelado' WHERE id=$1 AND status='agendado' RETURNING id", [req.params.id]);
    if (!r.rowCount) return res.json({ ok: false, erro: 'Só é possível cancelar uma publicação que ainda está agendada.' });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, erro: e.message }); }
});

router.post('/marketing/instagram/post/:id/legenda', requireAuth, requirePermissao('marketing'), async (req, res) => {
  try {
    const legenda = (req.body && req.body.legenda || '').trim();
    if (!legenda) return res.json({ ok: false, erro: 'A legenda não pode ficar vazia.' });
    const r = await query("UPDATE instagram_posts SET legenda=$1 WHERE id=$2 AND status='agendado' RETURNING id", [legenda, req.params.id]);
    if (!r.rowCount) return res.json({ ok: false, erro: 'Só dá para editar enquanto a publicação está agendada.' });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, erro: e.message }); }
});

router.get('/marketing/canva/conectar', requireAuth, requireAdmin, async (req, res) => {
  const { gerarPkce, montarUrlAutorizacao } = require('../services/canva');
  const { verifier, challenge } = gerarPkce();
  const state = require('crypto').randomBytes(16).toString('hex');
  req.session.canvaVerifier = verifier;
  req.session.canvaState = state;
  const redirectUri = (process.env.APP_URL || 'https://sistema.lauroucpcde.com').replace(/\/$/, '') + '/marketing/canva/callback';
  res.redirect(montarUrlAutorizacao({ challenge, state, redirectUri }));
});

router.get('/marketing/canva/callback', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.canvaState) {
      req.session.erro = ['Falha ao conectar com o Canva (state invalido). Tente novamente.'];
      return res.redirect('/marketing?tab=integracao');
    }
    const { trocarCodigoPorToken } = require('../services/canva');
    const redirectUri = (process.env.APP_URL || 'https://sistema.lauroucpcde.com').replace(/\/$/, '') + '/marketing/canva/callback';
    await trocarCodigoPorToken({ code, verifier: req.session.canvaVerifier, redirectUri });
    delete req.session.canvaVerifier; delete req.session.canvaState;
    req.session.msg = ['Canva conectado com sucesso!'];
    res.redirect('/marketing?tab=integracao');
  } catch(e) {
    console.error('Canva callback erro:', e.response ? JSON.stringify(e.response.data).substring(0,300) : e.message);
    req.session.erro = ['Erro ao conectar com o Canva.'];
    res.redirect('/marketing?tab=integracao');
  }
});

router.post('/marketing/canva/desconectar', requireAuth, requireAdmin, async (req, res) => {
  const { desconectar } = require('../services/canva');
  await desconectar();
  req.session.msg = ['Canva desconectado.'];
  res.redirect('/marketing?tab=integracao');
});

router.get('/marketing/canva/designs', requireAuth, requirePermissao('marketing'), async (req, res) => {
  const { listarDesigns } = require('../services/canva');
  const r = await listarDesigns();
  res.json(r);
});

router.post('/marketing/canva/criar', requireAuth, requirePermissao('marketing'), async (req, res) => {
  const { criarDesign } = require('../services/canva');
  const { tipo, largura, altura } = req.body;
  const custom = (largura && altura) ? { width: parseInt(largura), height: parseInt(altura) } : null;
  const r = await criarDesign(tipo, custom);
  res.json(r);
});

router.post('/marketing/canva/importar/:designId', requireAuth, requirePermissao('marketing'), async (req, res) => {
  const { importarDesignParaMidia } = require('../services/canva');
  const r = await importarDesignParaMidia(req.params.designId, req.body.nome);
  res.json(r);
});

router.get('/marketing', requireAuth, requirePermissao('marketing'), async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const [postsR, midiasR] = await Promise.all([query('SELECT * FROM marketing_posts ORDER BY criado_em DESC'), query('SELECT * FROM marketing_midias ORDER BY criado_em DESC')]);
  // Publicações do Instagram vivem em OUTRA tabela (instagram_posts, alimentada pelo
  // agendamento automático). Sem isso, um carrossel agendado não aparecia em lugar
  // nenhum da interface — o usuário não tinha como conferir o que estava programado.
  let igPosts = [];
  try {
    const r = await query("SELECT id, tipo, legenda, status, agendado_para, publicado_em, erro_msg, instagram_media_id, midia_url, midias FROM instagram_posts ORDER BY COALESCE(publicado_em, agendado_para) DESC LIMIT 30");
    igPosts = r.rows;
  } catch(e) { console.error('[MARKETING] instagram_posts:', e.message); }
  const mktConfig = await getMktConfig();
  const { estaConectado } = require('../services/canva');
  const { gerarUrlInline } = require('../services/arquivos');
  const canvaConectado = await estaConectado();
  const posts = postsR.rows; const total = posts.length||1;
  const igPct = Math.round(posts.filter(p=>(p.redes||[]).includes('instagram')).length/total*100);
  const fbPct = Math.round(posts.filter(p=>(p.redes||[]).includes('facebook')).length/total*100);
  const waPct = Math.round(posts.filter(p=>(p.redes||[]).includes('whatsapp')).length/total*100);
  // Dados leves para a gestao das fotos do site - so nome e foto, sem nenhum dado sensivel (cpf/rg/email/whatsapp)
  const [ligEquipeR, dirEquipeR, bannersR] = await Promise.all([
    query("SELECT id, nome, foto_site_chave FROM ligantes WHERE ativo=1 AND pendente=false ORDER BY nome"),
    query("SELECT id, nome, foto_site_chave FROM diretivos WHERE ativo=1 AND pendente=false ORDER BY cargo, nome"),
    query("SELECT id, titulo, imagem_chave, link_url, ativo FROM site_banners ORDER BY ordem, criado_em DESC")
  ]);
  const comFoto = async (rows, chaveCampo) => Promise.all(rows.map(async r => {
    let foto_url = null;
    if (r[chaveCampo]) { try { foto_url = await gerarUrlInline(r[chaveCampo]); } catch(e) {} }
    return { id: r.id, nome: r.nome, foto_url };
  }));
  const [equipeLigantes, equipeDiretivos] = await Promise.all([
    comFoto(ligEquipeR.rows, 'foto_site_chave'),
    comFoto(dirEquipeR.rows, 'foto_site_chave')
  ]);
  const siteBanners = await Promise.all(bannersR.rows.map(async b => {
    let imagem_url = null;
    if (b.imagem_chave) { try { imagem_url = await gerarUrlInline(b.imagem_chave); } catch(e) {} }
    return { ...b, imagem_url };
  }));
  const siteVideoR = await query("SELECT valor FROM configuracoes WHERE chave='site_video_chave'");
  let siteVideoUrl = null;
  if (siteVideoR.rows.length && siteVideoR.rows[0].valor) { try { siteVideoUrl = await gerarUrlInline(siteVideoR.rows[0].valor, 'video/mp4'); } catch(e) {} }
  const marcaDaguaR = await query("SELECT valor FROM configuracoes WHERE chave='marca_dagua_chave'");
  let marcaDaguaUrl = null;
  if (marcaDaguaR.rows.length && marcaDaguaR.rows[0].valor) { try { marcaDaguaUrl = await gerarUrlInline(marcaDaguaR.rows[0].valor); } catch(e) {} }
  const galeriasR = await query(`
    SELECT g.*, (SELECT COUNT(*) FROM galeria_fotos WHERE galeria_id=g.id) as total_fotos
    FROM galerias_eventos g ORDER BY g.criado_em DESC
  `);
  const galerias = await Promise.all(galeriasR.rows.map(async g => {
    const fotosR = await query('SELECT id, imagem_chave FROM galeria_fotos WHERE galeria_id=$1 ORDER BY criado_em', [g.id]);
    const fotos = await Promise.all(fotosR.rows.map(async f => ({ id: f.id, url: await gerarUrlInline(f.imagem_chave).catch(()=>null) })));
    return { ...g, total_fotos: Number(g.total_fotos), fotos };
  }));
  const anivCfgR = await query("SELECT chave,valor FROM configuracoes WHERE chave IN ('aniversario_story_ativo','aniversario_template_chave')");
  const anivCfg = {}; anivCfgR.rows.forEach(x => anivCfg[x.chave] = x.valor);
  const aniversarioAtivo = anivCfg.aniversario_story_ativo === '1';
  let aniversarioTemplateUrl = null;
  if (anivCfg.aniversario_template_chave) { try { aniversarioTemplateUrl = await gerarUrlInline(anivCfg.aniversario_template_chave); } catch(e) {} }
  const hojeMD = require('dayjs')().format('MM-DD');
  const aniversariantesHojeR = await query(
    `SELECT id, nome, cargo, NULL as semestre, 'diretivo' as tipo FROM diretivos WHERE ativo=1 AND pendente=false AND data_nascimento IS NOT NULL AND TO_CHAR(data_nascimento::date,'MM-DD')=$1
     UNION ALL
     SELECT id, nome, NULL as cargo, semestre, 'ligante' as tipo FROM ligantes WHERE ativo=1 AND pendente=false AND data_nascimento IS NOT NULL AND TO_CHAR(data_nascimento::date,'MM-DD')=$1`,
    [hojeMD]
  );
  const mesAtual = require('dayjs')().format('MM');
  const aniversariantesMesR = await query(
    `SELECT id, nome, cargo, NULL as semestre, 'diretivo' as tipo, TO_CHAR(data_nascimento::date,'DD') as dia FROM diretivos WHERE ativo=1 AND pendente=false AND data_nascimento IS NOT NULL AND TO_CHAR(data_nascimento::date,'MM')=$1
     UNION ALL
     SELECT id, nome, NULL as cargo, semestre, 'ligante' as tipo, TO_CHAR(data_nascimento::date,'DD') as dia FROM ligantes WHERE ativo=1 AND pendente=false AND data_nascimento IS NOT NULL AND TO_CHAR(data_nascimento::date,'MM')=$1
     ORDER BY dia`,
    [mesAtual]
  );
  const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const nomeMesAtual = MESES_PT[parseInt(mesAtual, 10) - 1];
  const [eventosInternosR, notasR] = await Promise.all([
    query('SELECT ec.*, u.nome as criado_por_nome FROM marketing_calendario ec LEFT JOIN usuarios u ON u.id=ec.criado_por ORDER BY ec.data_inicio'),
    query('SELECT n.*, u.nome as criado_por_nome FROM marketing_notas n LEFT JOIN usuarios u ON u.id=n.criado_por ORDER BY n.fixado DESC, n.criado_em DESC')
  ]);
  res.render('pages/marketing', { config, usuario: req.session.usuario, msg, erro, posts, igPosts, midias: midiasR.rows, mktConfig, igPct, fbPct, waPct, canvaConectado, equipeLigantes, equipeDiretivos, siteBanners, siteVideoUrl, marcaDaguaUrl, galerias, aniversarioAtivo, aniversarioTemplateUrl, aniversariantesHoje: aniversariantesHojeR.rows, aniversariantesMes: aniversariantesMesR.rows, nomeMesAtual, eventosInternos: eventosInternosR.rows, notas: notasR.rows });
});

router.post('/marketing/interno/evento', requireAuth, requirePermissao('marketing'), async (req, res) => {
  const { titulo, descricao, data_inicio, data_fim, cor } = req.body;
  await query('INSERT INTO marketing_calendario (titulo,descricao,data_inicio,data_fim,cor,criado_por) VALUES ($1,$2,$3,$4,$5,$6)',
    [titulo, descricao||null, data_inicio, data_fim||null, cor||'#0F6E56', req.session.usuario.id]);
  req.session.msg = ['Atividade adicionada ao calendario interno!'];
  res.redirect('/marketing?tab=interno');
});

router.post('/marketing/interno/evento/:id/excluir', requireAuth, requirePermissao('marketing'), async (req, res) => {
  await query('DELETE FROM marketing_calendario WHERE id=$1', [req.params.id]);
  req.session.msg = ['Atividade removida.'];
  res.redirect('/marketing?tab=interno');
});

router.post('/marketing/interno/nota', requireAuth, requirePermissao('marketing'), async (req, res) => {
  const { texto, cor } = req.body;
  await query('INSERT INTO marketing_notas (texto,cor,criado_por) VALUES ($1,$2,$3)', [texto, cor||'#fff3b0', req.session.usuario.id]);
  req.session.msg = ['Nota adicionada!'];
  res.redirect('/marketing?tab=interno');
});

router.post('/marketing/interno/nota/:id/fixar', requireAuth, requirePermissao('marketing'), async (req, res) => {
  await query('UPDATE marketing_notas SET fixado = NOT fixado WHERE id=$1', [req.params.id]);
  res.redirect('/marketing?tab=interno');
});

router.post('/marketing/interno/nota/:id/excluir', requireAuth, requirePermissao('marketing'), async (req, res) => {
  await query('DELETE FROM marketing_notas WHERE id=$1', [req.params.id]);
  req.session.msg = ['Nota removida.'];
  res.redirect('/marketing?tab=interno');
});

// Foto padronizada da equipe para o site publico - gerido pelo Marketing, separado da foto interna
// de cadastro (que ligantes/diretivos continuam anexando normalmente no proprio formulario deles).
router.post('/marketing/equipe/:tipo/:id/foto', requireAuth, requirePermissao('marketing'), async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('foto')(req, res, async (err) => {
      if (err || !req.file) { req.session.erro=['Nenhuma imagem enviada.']; return res.redirect('/marketing?tab=equipe'); }
      const tabela = req.params.tipo === 'diretivo' ? 'diretivos' : 'ligantes';
      const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'equipe-site');
      await query(`UPDATE ${tabela} SET foto_site_chave=$1 WHERE id=$2`, [r.chave, req.params.id]);
      req.session.msg = ['Foto do site atualizada!'];
      res.redirect('/marketing?tab=equipe');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/marketing?tab=equipe'); }
});

// Banners gerais do site - propaganda/avisos do Marketing, SEM vinculo com nenhum evento
// especifico (o banner de evento continua 100% gerido pela aba Eventos, aparece/some sozinho
// conforme a data do evento e ja leva direto pra inscricao).
router.post('/marketing/banners', requireAuth, requirePermissao('marketing'), async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('imagem')(req, res, async (err) => {
      if (err || !req.file) { req.session.erro=['Nenhuma imagem enviada.']; return res.redirect('/marketing?tab=equipe'); }
      const { titulo, link_url } = req.body;
      const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'site-banners');
      await query('INSERT INTO site_banners (titulo, imagem_chave, link_url, criado_por) VALUES ($1,$2,$3,$4)', [titulo||null, r.chave, link_url||null, req.session.usuario.id]);
      req.session.msg = ['Banner adicionado!'];
      res.redirect('/marketing?tab=equipe');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/marketing?tab=equipe'); }
});

router.post('/marketing/banners/:id/toggle', requireAuth, requirePermissao('marketing'), async (req, res) => {
  await query('UPDATE site_banners SET ativo = NOT ativo WHERE id=$1', [req.params.id]);
  res.redirect('/marketing?tab=equipe');
});

router.post('/marketing/banners/:id/deletar', requireAuth, requirePermissao('marketing'), async (req, res) => {
  await query('DELETE FROM site_banners WHERE id=$1', [req.params.id]);
  req.session.msg = ['Banner excluido!'];
  res.redirect('/marketing?tab=equipe');
});

// Video institucional do site - o Marketing sobe/substitui o video direto pela plataforma,
// sem precisar mexer em codigo. O video some do site se for removido.
router.post('/marketing/video', requireAuth, requirePermissao('marketing'), async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('video')(req, res, async (err) => {
      if (err || !req.file) { req.session.erro=['Nenhum video enviado.']; return res.redirect('/marketing?tab=equipe'); }
      const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'site-video');
      await query("INSERT INTO configuracoes (chave,valor) VALUES ('site_video_chave',$1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [r.chave]);
      req.session.msg = ['Video do site atualizado!'];
      res.redirect('/marketing?tab=equipe');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/marketing?tab=equipe'); }
});

router.post('/marketing/video/remover', requireAuth, requirePermissao('marketing'), async (req, res) => {
  await query("DELETE FROM configuracoes WHERE chave='site_video_chave'");
  req.session.msg = ['Video do site removido!'];
  res.redirect('/marketing?tab=equipe');
});

// Marca d'agua (carimbo) usada em todas as fotos das galerias de eventos - PNG com fundo transparente
router.post('/marketing/marca-dagua', requireAuth, requirePermissao('marketing'), async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('marca')(req, res, async (err) => {
      if (err || !req.file) { req.session.erro=['Nenhuma imagem enviada.']; return res.redirect('/marketing?tab=equipe'); }
      const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'marca-dagua');
      await query("INSERT INTO configuracoes (chave,valor) VALUES ('marca_dagua_chave',$1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [r.chave]);
      req.session.msg = ['Marca dagua atualizada! Sera aplicada nas proximas fotos enviadas.'];
      res.redirect('/marketing?tab=equipe');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/marketing?tab=equipe'); }
});

router.post('/marketing/marca-dagua/remover', requireAuth, requirePermissao('marketing'), async (req, res) => {
  await query("DELETE FROM configuracoes WHERE chave='marca_dagua_chave'");
  req.session.msg = ['Marca dagua removida!'];
  res.redirect('/marketing?tab=equipe');
});

// Galerias de fotos de eventos - o Marketing cria a galeria e sobe as fotos em lote, ja
// carimbadas com a marca dagua da liga, para exibicao/download no site institucional.
router.post('/marketing/galerias', requireAuth, requirePermissao('marketing'), async (req, res) => {
  try {
    const { nome_evento, data_evento } = req.body;
    if (!nome_evento) { req.session.erro=['Informe o nome do evento.']; return res.redirect('/marketing?tab=equipe'); }
    await query('INSERT INTO galerias_eventos (nome_evento, data_evento, criado_por) VALUES ($1,$2,$3)', [nome_evento, data_evento||null, req.session.usuario.id]);
    req.session.msg = ['Galeria criada!'];
    res.redirect('/marketing?tab=equipe');
  } catch(e) { req.session.erro=[e.message]; res.redirect('/marketing?tab=equipe'); }
});

router.post('/marketing/galerias/:id/toggle', requireAuth, requirePermissao('marketing'), async (req, res) => {
  await query('UPDATE galerias_eventos SET ativo = NOT ativo WHERE id=$1', [req.params.id]);
  res.redirect('/marketing?tab=equipe');
});

router.post('/marketing/galerias/:id/deletar', requireAuth, requirePermissao('marketing'), async (req, res) => {
  try {
    const { deletarArquivo } = require('../services/arquivos');
    const fotos = await query('SELECT imagem_chave FROM galeria_fotos WHERE galeria_id=$1', [req.params.id]);
    await Promise.all(fotos.rows.map(f => deletarArquivo(f.imagem_chave).catch(()=>{})));
    await query('DELETE FROM galerias_eventos WHERE id=$1', [req.params.id]);
    req.session.msg = ['Galeria excluida!'];
    res.redirect('/marketing?tab=equipe');
  } catch(e) { req.session.erro=[e.message]; res.redirect('/marketing?tab=equipe'); }
});

router.post('/marketing/galerias/:id/fotos', requireAuth, requirePermissao('marketing'), async (req, res) => {
  try {
    const { upload, uploadArquivo, aplicarMarcaDagua } = require('../services/arquivos');
    upload.array('fotos', 60)(req, res, async (err) => {
      if (err || !req.files || !req.files.length) { req.session.erro=['Nenhuma foto enviada.']; return res.redirect('/marketing?tab=equipe'); }
      const marcaR = await query("SELECT valor FROM configuracoes WHERE chave='marca_dagua_chave'");
      const marcaChave = marcaR.rows[0]?.valor || null;
      for (const file of req.files) {
        const buffer = await aplicarMarcaDagua(file.buffer, marcaChave);
        const r = await uploadArquivo(buffer, file.originalname, marcaChave ? 'image/jpeg' : file.mimetype, 'galeria-eventos');
        await query('INSERT INTO galeria_fotos (galeria_id, imagem_chave) VALUES ($1,$2)', [req.params.id, r.chave]);
      }
      req.session.msg = [`${req.files.length} foto(s) adicionada(s)!`];
      res.redirect('/marketing?tab=equipe');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/marketing?tab=equipe'); }
});

router.post('/marketing/galeria-fotos/:id/deletar', requireAuth, requirePermissao('marketing'), async (req, res) => {
  try {
    const { deletarArquivo } = require('../services/arquivos');
    const f = await query('SELECT imagem_chave FROM galeria_fotos WHERE id=$1', [req.params.id]);
    if (f.rows.length) await deletarArquivo(f.rows[0].imagem_chave).catch(()=>{});
    await query('DELETE FROM galeria_fotos WHERE id=$1', [req.params.id]);
    res.redirect('/marketing?tab=equipe');
  } catch(e) { req.session.erro=[e.message]; res.redirect('/marketing?tab=equipe'); }
});

// Stories automaticos de aniversario (ligantes/diretivos) - publica sozinho no Instagram
// as 7h, usando a arte-modelo do Canva + foto/nome/cargo da pessoa sobrepostos.
router.post('/marketing/aniversario/template', requireAuth, requirePermissao('marketing'), async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('template')(req, res, async (err) => {
      if (err || !req.file) { req.session.erro=['Nenhuma imagem enviada.']; return res.redirect('/marketing?tab=equipe'); }
      const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'aniversario-template');
      await query("INSERT INTO configuracoes (chave,valor) VALUES ('aniversario_template_chave',$1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [r.chave]);
      req.session.msg = ['Arte-modelo atualizada!'];
      res.redirect('/marketing?tab=equipe');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/marketing?tab=equipe'); }
});

router.post('/marketing/aniversario/toggle', requireAuth, requirePermissao('marketing'), async (req, res) => {
  const atualR = await query("SELECT valor FROM configuracoes WHERE chave='aniversario_story_ativo'");
  const novoValor = atualR.rows[0]?.valor === '1' ? '0' : '1';
  await query("INSERT INTO configuracoes (chave,valor) VALUES ('aniversario_story_ativo',$1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [novoValor]);
  res.redirect('/marketing?tab=equipe');
});

// Gera uma previa da arte (sem publicar) para o marketing conferir visualmente
router.get('/marketing/aniversario/preview/:tipo/:id', requireAuth, requirePermissao('marketing'), async (req, res) => {
  try {
    const { baixarArquivoBuffer } = require('../services/arquivos');
    const { gerarArteAniversario, nomeCurto } = require('../services/aniversario-arte');
    const { rotuloAniversario } = require('../services/cargo-genero');
    const tipo = req.params.tipo === 'diretivo' ? 'diretivo' : 'ligante';
    const p = tipo === 'diretivo'
      ? await query("SELECT nome, cargo, sexo, COALESCE(foto_site_chave, foto_chave) as foto_chave FROM diretivos WHERE id=$1", [req.params.id])
      : await query("SELECT nome, COALESCE(foto_site_chave, foto_chave) as foto_chave FROM ligantes WHERE id=$1", [req.params.id]);
    if (!p.rows.length || !p.rows[0].foto_chave) return res.status(404).send('Pessoa ou foto nao encontrada');
    const pessoa = p.rows[0];
    const templateR = await query("SELECT valor FROM configuracoes WHERE chave='aniversario_template_chave'");
    if (!templateR.rows.length) return res.status(400).send('Nenhuma arte-modelo configurada ainda');
    const cargo = rotuloAniversario({ tipo, cargo: pessoa.cargo, sexo: pessoa.sexo });
    const nomeExibir = req.query.nome_completo === '1' ? pessoa.nome : (req.query.nome || nomeCurto(pessoa.nome));
    const [templateBuffer, fotoBuffer] = await Promise.all([
      baixarArquivoBuffer(templateR.rows[0].valor),
      baixarArquivoBuffer(pessoa.foto_chave)
    ]);
    const arte = await gerarArteAniversario({ templateBuffer, fotoBuffer, nome: nomeExibir, cargo });
    res.set('Content-Type', 'image/jpeg');
    if (req.query.download) {
      res.set('Content-Disposition', `attachment; filename="aniversario-${tipo}-${pessoa.nome.replace(/[^a-zA-Z0-9]+/g,'-')}.jpg"`);
    }
    res.send(arte);
  } catch(e) { res.status(500).send('Erro ao gerar previa: ' + e.message); }
});

router.post('/marketing/posts', requireAuth, requirePermissao('marketing'), async (req, res) => {
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

router.post('/marketing/:id/publicar', requireAuth, requirePermissao('marketing'), async (req, res) => {
  try {
    const { publicarPostMarketing } = require('../services/marketing-publish');
    const resultado = await publicarPostMarketing(req.params.id);
    if (!resultado.ok && resultado.erro === 'Post não encontrado') { req.session.erro=['Post não encontrado']; return res.redirect('/marketing'); }
    req.session.msg = resultado.ok ? ['Post publicado!'] : ['Publicado com erros: '+(resultado.erros||[]).join(', ')];
    res.redirect('/marketing');
  } catch(e) { req.session.erro=[e.message]; res.redirect('/marketing'); }
});

router.post('/marketing/:id/deletar', requireAuth, requirePermissao('marketing'), async (req, res) => {
  await query('DELETE FROM marketing_posts WHERE id=$1', [req.params.id]);
  req.session.msg = ['Post excluído!']; res.redirect('/marketing');
});

router.post('/marketing/midias/upload', requireAuth, requirePermissao('marketing'), async (req, res) => {
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

router.post('/marketing/midias/:id/deletar', requireAuth, requirePermissao('marketing'), async (req, res) => {
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

router.post('/marketing/gerar-legenda', requireAuth, requirePermissao('marketing'), async (req, res) => {
  try {
    const { chamarClaudeTexto } = require('../services/cientifico-ia');
    const titulo = req.body.titulo || '';
    const r = await chamarClaudeTexto(query, {
      prompt: 'Crie uma legenda profissional para post de marketing de uma liga academica de urologia sobre: ' + titulo + '. Maximo 150 palavras, tom profissional e engajador. Responda APENAS com o texto da legenda, sem comentarios extras.',
      contexto: 'marketing-legenda', maxTokens: 500
    });
    if (!r.ok) return res.json({ ok: false, erro: r.erro });
    res.json({ ok: true, texto: r.texto.trim() });
  } catch(e) { res.json({ ok: false, erro: e.message }); }
});

router.post('/marketing/gerar-hashtags', requireAuth, requirePermissao('marketing'), async (req, res) => {
  try {
    const { chamarClaudeTexto } = require('../services/cientifico-ia');
    const titulo = req.body.titulo || '';
    const r = await chamarClaudeTexto(query, {
      prompt: 'Liste 15 hashtags para post sobre: ' + titulo + ' de liga academica de urologia. Retorne APENAS hashtags separadas por espaco, sem comentarios extras.',
      contexto: 'marketing-hashtags', maxTokens: 300
    });
    if (!r.ok) return res.json({ ok: false, erro: r.erro });
    const tags = r.texto.trim().split(/\s+/).filter(t => t.startsWith('#')).slice(0, 15);
    res.json({ ok: true, tags });
  } catch(e) { res.json({ ok: false, erro: e.message }); }
});

router.post('/marketing/whatsapp-massa', requireAuth, requirePermissao('marketing'), async (req, res) => {
  try {
    const { destinatarios, mensagem } = req.body;
    if (!mensagem) { req.session.erro=['Mensagem obrigatória!']; return res.redirect('/marketing'); }
    const { enviarWhatsApp } = require('../services/notificacoes');
    let pessoas = [];
    if (destinatarios==='ligantes'||destinatarios==='todos') { const r=await query('SELECT nome,whatsapp FROM ligantes WHERE ativo=1 AND whatsapp IS NOT NULL'); pessoas=[...pessoas,...r.rows]; }
    if (destinatarios==='diretivos'||destinatarios==='todos') { const r=await query('SELECT nome,whatsapp FROM diretivos WHERE ativo=1 AND whatsapp IS NOT NULL'); pessoas=[...pessoas,...r.rows]; }
    let enviados=0, erros=0, bloqueados=0;
    for (const p of pessoas) {
      if (!p.whatsapp) continue;
      try {
        const r = await enviarWhatsApp(p.whatsapp, mensagem.replace('{nome}', p.nome));
        if (r && r.blocked) bloqueados++; else enviados++;
      } catch(e) { erros++; }
    }
    if (bloqueados > 0 && enviados === 0) {
      req.session.erro = ['Por enquanto, o envio de mensagens via WhatsApp esta suspenso pelo administrador (numero em periodo de aquecimento, para evitar banimento). Em breve retornaremos com o servico normalmente. Enquanto isso, use o e-mail para se comunicar.'];
    } else {
      req.session.msg=[`WhatsApp enviado! ${enviados} enviados, ${erros} erros${bloqueados?', '+bloqueados+' bloqueados (envio suspenso pelo administrador)':''}.`];
    }
    res.redirect('/marketing?tab=whatsapp');
  } catch(e) { req.session.erro=[e.message]; res.redirect('/marketing?tab=whatsapp'); }
});

};
