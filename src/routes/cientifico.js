const dayjs = require('dayjs');
const { query } = require('../models/database');
const { requireAuth, requireAdmin, requirePermissao, requireMembro } = require('../middleware/auth');
const { getConfig } = require('../services/config');
const { limiterLogin, limiterEsqueciSenha } = require('../services/rate-limiters');
// enviarEmail era importado SÓ dentro de uma função lá embaixo. Na rota de recuperar senha
// ele não existia, e a chamada estourava "ReferenceError: enviarEmail is not defined" —
// pendurando a requisição (nginx registrava 499) e deixando o usuário sem o e-mail.
const { enviarEmail: enviarEmailCient } = require('../services/notificacoes');

module.exports = function (router) {

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

// Criacao de grupos e restrita: apenas secretaria, equipe do cientifico, presidencia ou admin.
async function requireCriarGrupoCientifico(req, res, next) {
  if (!req.session.usuario) return res.redirect('/login');
  const perfil = req.session.usuario.perfil;
  if (['admin', 'presidencia', 'secretaria'].includes(perfil)) return next();
  const r = await query('SELECT 1 FROM usuario_permissoes WHERE usuario_id=$1 AND modulo=$2', [req.session.usuario.id, 'cientifico']);
  if (r.rows.length > 0) return next();
  req.session.erro = ['Apenas secretaria, equipe do cientifico, presidencia ou administrador podem criar grupos.'];
  return res.redirect('/dashboard');
}

async function registrarTimeline(grupoId, evento, descricao) {
  await query('INSERT INTO timeline_grupo_cientifico (grupo_id,evento,descricao) VALUES ($1,$2,$3)', [grupoId, evento, descricao || null]);
}

// Historico completo de uma versao do trabalho (enviado, em_revisao, transferido, aprovado,
// devolvido) - ao contrario de versoes_trabalho.comentario_revisor, que so guarda o ultimo,
// aqui fica registrado tudo o que ja aconteceu, pra dar pra rastrear o caso inteiro.
async function registrarEventoVersao(versaoId, tipo, { comentario, autorTipo, autorId, autorNome, destinoNome } = {}) {
  await query(
    'INSERT INTO versao_trabalho_eventos (versao_id,tipo,comentario,autor_tipo,autor_id,autor_nome,destino_nome) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [versaoId, tipo, comentario || null, autorTipo || null, autorId || null, autorNome || null, destinoNome || null]
  );
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

// GET /cientifico/pendencias — painel unico com todos os trabalhos aguardando correcao,
// de todos os projetos/grupos, sem precisar entrar um por um.
router.get('/cientifico/pendencias', requireAuth, requireCientifico, async (req, res) => {
  const config = await getConfig();
  const permsR = await query('SELECT modulo FROM usuario_permissoes WHERE usuario_id=$1',[req.session.usuario.id]);
  const permissoesAtivas = permsR.rows.map(r=>r.modulo);
  const pendentesR = await query(`
    SELECT v.id, v.status, v.enviado_em, v.arquivo_nome, v.revisor_atual_id,
           gc.id as grupo_id, gc.nome as grupo_nome,
           pc.id as projeto_id, pc.titulo as projeto_titulo,
           CASE WHEN v.enviado_por_tipo='ligante' THEN l.nome ELSE d.nome END as enviado_por_nome,
           ru.nome as revisor_atual_nome
    FROM versoes_trabalho v
    JOIN grupos_cientificos gc ON gc.id=v.grupo_id
    JOIN projetos_cientificos pc ON pc.id=gc.projeto_id
    LEFT JOIN ligantes l ON v.enviado_por_tipo='ligante' AND l.id=v.enviado_por_id
    LEFT JOIN diretivos d ON v.enviado_por_tipo='diretivo' AND d.id=v.enviado_por_id
    LEFT JOIN usuarios ru ON ru.id=v.revisor_atual_id
    WHERE v.status IN ('aguardando','em_revisao')
    ORDER BY v.enviado_em ASC
  `);
  res.render('pages/cientifico/pendencias', { config, usuario: req.session.usuario, permissoesAtivas, pendentes: pendentesR.rows });
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

// POST /cientifico/projeto/:id/excluir
router.post('/cientifico/projeto/:id/excluir', requireAuth, requireCientifico, async (req, res) => {
  const pR = await query('SELECT titulo FROM projetos_cientificos WHERE id=$1',[req.params.id]);
  if (!pR.rows.length) { req.session.erro=['Projeto nao encontrado.']; return res.redirect('/cientifico'); }
  await query('DELETE FROM projetos_cientificos WHERE id=$1',[req.params.id]);
  req.session.msg=['Projeto "'+pR.rows[0].titulo+'" excluido com sucesso.'];
  res.redirect('/cientifico');
});

// GET /cientifico/arquivo/:projetoId/:tipo (download edital/modelo)
router.get('/cientifico/arquivo/:projetoId/:tipo', requireAuth, requireCientifico, async (req, res) => {
  const pR = await query('SELECT * FROM projetos_cientificos WHERE id=$1',[req.params.projetoId]);
  if (!pR.rows.length) return res.status(404).send('Nao encontrado');
  const p = pR.rows[0];
  const chave = req.params.tipo==='edital' ? p.edital_chave : p.modelo_chave;
  if (!chave) return res.status(404).send('Arquivo nao encontrado');
  const url = await gerarUrlInline(chave);
  res.redirect(url);
});

// GET /cientifico/projeto/:projetoId/grupo/novo
router.get('/cientifico/projeto/:projetoId/grupo/novo', requireAuth, requireCriarGrupoCientifico, async (req, res) => {
  const config = await getConfig();
  const permsR = await query('SELECT modulo FROM usuario_permissoes WHERE usuario_id=$1',[req.session.usuario.id]);
  const permissoesAtivas = permsR.rows.map(r=>r.modulo);
  const pR = await query('SELECT * FROM projetos_cientificos WHERE id=$1',[req.params.projetoId]);
  if (!pR.rows.length) return res.redirect('/cientifico');
  const erro = req.session.erro||[]; req.session.erro=[];
  res.render('pages/cientifico/grupo-form', { config, usuario: req.session.usuario, permissoesAtivas, projeto: pR.rows[0], erro });
});

// POST /cientifico/projeto/:projetoId/grupo/novo
router.post('/cientifico/projeto/:projetoId/grupo/novo', requireAuth, requireCriarGrupoCientifico, async (req, res) => {
  const { nome, tipo_trabalho, prazo } = req.body;
  if (!nome) { req.session.erro=['Nome obrigatorio']; return res.redirect('back'); }
  const tipoT = tipo_trabalho==='individual' ? 'individual' : 'colaborativo';
  const gR = await query('INSERT INTO grupos_cientificos (projeto_id,nome,tipo_trabalho,prazo) VALUES ($1,$2,$3,$4) RETURNING id',[req.params.projetoId,nome,tipoT,prazo||null]);
  const grupoId = gR.rows[0].id;
  await registrarTimeline(grupoId, 'Grupo criado', 'Grupo "'+nome+'" criado no sistema');
  req.session.msg=['Grupo criado!'];
  res.redirect('/cientifico/projeto/'+req.params.projetoId+'/grupo/'+grupoId);
});

// POST /cientifico/grupo/:grupoId/prazo — define/edita o prazo especifico deste trabalho
// (cada grupo pode ter um prazo proprio, diferente do prazo geral do projeto/edital).
router.post('/cientifico/grupo/:grupoId/prazo', requireAuth, requireCientifico, async (req, res) => {
  const { prazo } = req.body;
  const gR = await query('SELECT projeto_id FROM grupos_cientificos WHERE id=$1', [req.params.grupoId]);
  if (!gR.rows.length) return res.redirect('/cientifico');
  await query('UPDATE grupos_cientificos SET prazo=$1 WHERE id=$2', [prazo||null, req.params.grupoId]);
  req.session.msg=['Prazo atualizado.'];
  res.redirect('/cientifico/projeto/'+gR.rows[0].projeto_id+'/grupo/'+req.params.grupoId);
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
  const versoes = (await query(`SELECT v.*, CASE WHEN v.enviado_por_tipo='ligante' THEN l.nome ELSE d.nome END as enviado_por_nome, ru.nome as revisor_atual_nome FROM versoes_trabalho v LEFT JOIN ligantes l ON v.enviado_por_tipo='ligante' AND l.id=v.enviado_por_id LEFT JOIN diretivos d ON v.enviado_por_tipo='diretivo' AND d.id=v.enviado_por_id LEFT JOIN usuarios ru ON ru.id=v.revisor_atual_id WHERE v.grupo_id=$1 ORDER BY v.enviado_em DESC`,[req.params.grupoId])).rows;
  if (versoes.length) {
    const versaoIds = versoes.map(v=>v.id);
    const eventosR = await query('SELECT * FROM versao_trabalho_eventos WHERE versao_id = ANY($1::int[]) ORDER BY criado_em ASC', [versaoIds]);
    for (const v of versoes) v.eventos = eventosR.rows.filter(e => e.versao_id === v.id);
  }
  const staffCientifico = (await query(`SELECT DISTINCT u.id, u.nome FROM usuarios u LEFT JOIN usuario_permissoes up ON up.usuario_id=u.id AND up.modulo='cientifico' WHERE u.ativo=1 AND (up.usuario_id IS NOT NULL OR u.perfil IN ('presidencia','admin')) ORDER BY u.nome`)).rows;
  const chat = (await query('SELECT * FROM chat_grupo_cientifico WHERE grupo_id=$1 ORDER BY criado_em ASC',[req.params.grupoId])).rows;
  const timeline = (await query('SELECT * FROM timeline_grupo_cientifico WHERE grupo_id=$1 ORDER BY criado_em DESC',[req.params.grupoId])).rows;
  const avisos = (await query(`SELECT a.* FROM avisos_cientificos a WHERE a.projeto_id=$1 AND (a.grupo_id=$2 OR a.grupo_id IS NULL) ORDER BY a.criado_em DESC LIMIT 5`,[req.params.projetoId,req.params.grupoId])).rows;
  // Notas PRIVADAS do revisor logado para este grupo (so quem criou visualiza)
  const notas = (await query('SELECT * FROM cientifico_notas WHERE grupo_id=$1 AND criado_por=$2 ORDER BY fixado DESC, criado_em DESC',[req.params.grupoId, req.session.usuario.id])).rows;
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
  res.render('pages/cientifico/grupo-detalhe', { config, usuario: req.session.usuario, permissoesAtivas, projeto, grupo, membros, versoes, versoesPorAutor, chat, timeline, avisos, notas, ligantesDisponiveis, diretivosDisponiveis, staffCientifico, msg, erro });
});

// ─── NOTAS PRIVADAS DO REVISOR (Cientifico) ───────────────────────────────────
// Anotacoes internas para guiar as correcoes. So o proprio usuario que criou ve/edita.
router.post('/cientifico/grupo/:grupoId/nota', requireAuth, requireCientifico, async (req, res) => {
  const { texto, cor, projetoId, membro_tipo, membro_id } = req.body;
  const mt = (membro_tipo === 'ligante' || membro_tipo === 'diretivo') ? membro_tipo : null;
  const mid = mt && membro_id ? parseInt(membro_id) : null;
  if (texto && texto.trim()) {
    await query('INSERT INTO cientifico_notas (grupo_id, texto, cor, criado_por, membro_tipo, membro_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.params.grupoId, texto.trim(), cor || '#fff3b0', req.session.usuario.id, mt, mid]);
  }
  res.redirect('/cientifico/projeto/' + (projetoId || '') + '/grupo/' + req.params.grupoId + '?tab=trabalho');
});

router.post('/cientifico/nota/:id/fixar', requireAuth, requireCientifico, async (req, res) => {
  await query('UPDATE cientifico_notas SET fixado = NOT fixado WHERE id=$1 AND criado_por=$2', [req.params.id, req.session.usuario.id]);
  const { projetoId, grupoId } = req.body;
  res.redirect('/cientifico/projeto/' + (projetoId || '') + '/grupo/' + (grupoId || '') + '?tab=trabalho');
});

router.post('/cientifico/nota/:id/excluir', requireAuth, requireCientifico, async (req, res) => {
  await query('DELETE FROM cientifico_notas WHERE id=$1 AND criado_por=$2', [req.params.id, req.session.usuario.id]);
  const { projetoId, grupoId } = req.body;
  res.redirect('/cientifico/projeto/' + (projetoId || '') + '/grupo/' + (grupoId || '') + '?tab=trabalho');
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
      const hash = await bcryptCient.hash('12345678', 10);
      await query('INSERT INTO portal_cientifico_senhas (origem_tipo,origem_id,senha_hash,primeiro_acesso) VALUES ($1,$2,$3,true)',[origem_tipo,origem_id,hash]);
    }
    req.session.msg=['Membro adicionado!'];
  } catch(e) {
    req.session.erro=['Este membro ja esta em outro grupo.'];
  }
  res.redirect('/cientifico/projeto/'+g.projeto_id+'/grupo/'+req.params.grupoId+'?tab=membros');
});

// POST /cientifico/grupo/:grupoId/membro/:membroId/papel - alterna membro <-> lider (pode haver varios lideres)
router.post('/cientifico/grupo/:grupoId/membro/:membroId/papel', requireAuth, requireCientifico, async (req, res) => {
  const gR = await query('SELECT * FROM grupos_cientificos WHERE id=$1',[req.params.grupoId]);
  if (!gR.rows.length) return res.redirect('/cientifico');
  const g = gR.rows[0];
  const novoPapel = req.body.papel === 'lider' ? 'lider' : 'membro';
  const mR = await query('SELECT * FROM membros_grupo_cientifico WHERE id=$1 AND grupo_id=$2',[req.params.membroId,req.params.grupoId]);
  if (mR.rows.length) {
    await query('UPDATE membros_grupo_cientifico SET papel=$1 WHERE id=$2',[novoPapel,req.params.membroId]);
    const m = mR.rows[0];
    const nomeR = m.origem_tipo==='ligante' ? await query('SELECT nome FROM ligantes WHERE id=$1',[m.origem_id]) : await query('SELECT nome FROM diretivos WHERE id=$1',[m.origem_id]);
    const nome = nomeR.rows[0]?.nome||'Membro';
    await registrarTimeline(req.params.grupoId, 'Papel alterado', nome+' agora e '+novoPapel);
    req.session.msg=['Papel atualizado!'];
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

// POST /cientifico/projeto/:projetoId/grupo/:grupoId/toggle-status — encerra ou reabre o grupo.
// Grupo encerrado: fica travado para edicao no portal (nao aceita mais versoes/rascunhos),
// mas continua visivel para consulta e download do trabalho final por todos os membros.
router.post('/cientifico/projeto/:projetoId/grupo/:grupoId/toggle-status', requireAuth, requireCientifico, async (req, res) => {
  const gR = await query('SELECT status FROM grupos_cientificos WHERE id=$1 AND projeto_id=$2',[req.params.grupoId,req.params.projetoId]);
  if (!gR.rows.length) return res.redirect('/cientifico');
  const novoStatus = gR.rows[0].status === 'encerrado' ? 'ativo' : 'encerrado';
  await query('UPDATE grupos_cientificos SET status=$1 WHERE id=$2',[novoStatus,req.params.grupoId]);
  await registrarTimeline(req.params.grupoId, novoStatus === 'encerrado' ? 'Grupo encerrado' : 'Grupo reaberto',
    novoStatus === 'encerrado' ? 'O trabalho foi finalizado e o grupo foi encerrado.' : 'O grupo foi reaberto para novas alteracoes.');
  req.session.msg=[novoStatus === 'encerrado' ? 'Grupo encerrado!' : 'Grupo reaberto!'];
  res.redirect('/cientifico/projeto/'+req.params.projetoId+'/grupo/'+req.params.grupoId);
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

// POST /cientifico/projeto/:projetoId/aviso/:avisoId/excluir — some de todos os portais na hora,
// ja que os portais so exibem o que ainda existe na tabela avisos_cientificos.
router.post('/cientifico/projeto/:projetoId/aviso/:avisoId/excluir', requireAuth, requireCientifico, async (req, res) => {
  await query('DELETE FROM avisos_cientificos WHERE id=$1 AND projeto_id=$2', [req.params.avisoId, req.params.projetoId]);
  req.session.msg=['Aviso excluido!'];
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

// POST /cientifico/versao/:versaoId/iniciar-revisao — revisor unico: quem clica "Revisar"
// fica responsavel pelo caso (pode transferir depois se precisar de ajuda).
router.post('/cientifico/versao/:versaoId/iniciar-revisao', requireAuth, requireCientifico, async (req, res) => {
  const vR = await query('SELECT v.*, g.projeto_id FROM versoes_trabalho v JOIN grupos_cientificos g ON g.id=v.grupo_id WHERE v.id=$1',[req.params.versaoId]);
  if (!vR.rows.length) return res.redirect('/cientifico');
  const v = vR.rows[0];
  await query("UPDATE versoes_trabalho SET status='em_revisao', revisor_atual_id=$1 WHERE id=$2",[req.session.usuario.id, req.params.versaoId]);
  await registrarTimeline(v.grupo_id,'Em revisao','Versao em revisao por '+req.session.usuario.nome);
  await registrarEventoVersao(req.params.versaoId, 'em_revisao', { autorTipo:'usuario', autorId:req.session.usuario.id, autorNome:req.session.usuario.nome });
  res.redirect('/cientifico/projeto/'+v.projeto_id+'/grupo/'+v.grupo_id);
});

// POST /cientifico/versao/:versaoId/transferir — o revisor atual passa o caso para outro
// membro da equipe do Cientifico (ex: precisa de ajuda com um caso especifico).
router.post('/cientifico/versao/:versaoId/transferir', requireAuth, requireCientifico, async (req, res) => {
  const { usuario_id } = req.body;
  const vR = await query('SELECT v.*, g.projeto_id, g.tipo_trabalho FROM versoes_trabalho v JOIN grupos_cientificos g ON g.id=v.grupo_id WHERE v.id=$1',[req.params.versaoId]);
  if (!vR.rows.length) return res.redirect('/cientifico');
  const v = vR.rows[0];
  const podeAgirEmEmergencia = ['admin','presidencia'].includes(req.session.usuario.perfil);
  if (v.revisor_atual_id !== req.session.usuario.id && !podeAgirEmEmergencia) {
    req.session.erro=['Somente quem esta revisando este trabalho (ou admin/presidencia, em caso de emergencia) pode transferi-lo.'];
    return res.redirect('/cientifico/projeto/'+v.projeto_id+'/grupo/'+v.grupo_id);
  }
  // So pode transferir para quem realmente tem acesso ao Cientifico (permissao do modulo,
  // presidencia ou admin) - senao qualquer id valido de usuarios viraria revisor autorizado.
  const destinoR = await query(`
    SELECT DISTINCT u.id, u.nome FROM usuarios u
    LEFT JOIN usuario_permissoes up ON up.usuario_id=u.id AND up.modulo='cientifico'
    WHERE u.id=$1 AND u.ativo=1 AND (up.usuario_id IS NOT NULL OR u.perfil IN ('presidencia','admin'))
  `, [usuario_id]);
  if (!destinoR.rows.length) { req.session.erro=['Usuario destino invalido ou sem acesso ao Cientifico.']; return res.redirect('back'); }
  const destino = destinoR.rows[0];
  await query('UPDATE versoes_trabalho SET revisor_atual_id=$1 WHERE id=$2', [destino.id, req.params.versaoId]);
  await registrarTimeline(v.grupo_id, 'Revisao transferida', req.session.usuario.nome+' transferiu para '+destino.nome);
  await registrarEventoVersao(req.params.versaoId, 'transferido', { autorTipo:'usuario', autorId:req.session.usuario.id, autorNome:req.session.usuario.nome, destinoNome:destino.nome });

  // Se o revisor pediu, MOVE as suas anotacoes deste trabalho para o novo revisor
  // (reatribui criado_por) — como o trabalho foi passado adiante, ele deixa de ve-las.
  let notasMovidas = 0;
  if (req.body.encaminhar_notas === '1') {
    let upd, params;
    if (v.tipo_trabalho === 'individual') {
      upd = 'UPDATE cientifico_notas SET criado_por=$1 WHERE grupo_id=$2 AND criado_por=$3 AND membro_tipo=$4 AND membro_id=$5';
      params = [destino.id, v.grupo_id, req.session.usuario.id, v.enviado_por_tipo, v.enviado_por_id];
    } else {
      upd = 'UPDATE cientifico_notas SET criado_por=$1 WHERE grupo_id=$2 AND criado_por=$3 AND membro_id IS NULL';
      params = [destino.id, v.grupo_id, req.session.usuario.id];
    }
    const r = await query(upd, params);
    notasMovidas = r.rowCount || 0;
  }
  req.session.msg=['Trabalho transferido para '+destino.nome+'.' + (notasMovidas ? ' '+notasMovidas+' anotação(ões) transferida(s).' : '')];
  res.redirect('/cientifico/projeto/'+v.projeto_id+'/grupo/'+v.grupo_id);
});

// POST /cientifico/versao/:versaoId/revisar
router.post('/cientifico/versao/:versaoId/revisar', requireAuth, requireCientifico, async (req, res) => {
  const { acao, comentario } = req.body;
  const vR = await query('SELECT v.*, g.projeto_id FROM versoes_trabalho v JOIN grupos_cientificos g ON g.id=v.grupo_id WHERE v.id=$1',[req.params.versaoId]);
  if (!vR.rows.length) return res.redirect('/cientifico');
  const v = vR.rows[0];
  const podeAgirEmEmergencia = ['admin','presidencia'].includes(req.session.usuario.perfil);
  if (v.revisor_atual_id !== req.session.usuario.id && !podeAgirEmEmergencia) {
    req.session.erro=['Somente quem esta revisando este trabalho (ou admin/presidencia, em caso de emergencia) pode aprovar ou devolver. Transfira para si mesmo clicando em "Revisar" primeiro.'];
    return res.redirect('/cientifico/projeto/'+v.projeto_id+'/grupo/'+v.grupo_id);
  }
  const novoStatus = acao==='aprovar' ? 'aprovado' : 'devolvido';
  await query('UPDATE versoes_trabalho SET status=$1,comentario_revisor=$2,revisado_por=$3,revisado_em=NOW() WHERE id=$4',
    [novoStatus,comentario||null,req.session.usuario.id,req.params.versaoId]);
  await registrarEventoVersao(req.params.versaoId, novoStatus, { comentario, autorTipo:'usuario', autorId:req.session.usuario.id, autorNome:req.session.usuario.nome });
  try {
    const { enviarEmail, htmlSimples } = require('../services/notificacoes');
    const _gIR = await query('SELECT gc.nome as gnome, pc.titulo as ptitulo FROM grupos_cientificos gc JOIN projetos_cientificos pc ON pc.id=gc.projeto_id WHERE gc.id=$1',[v.grupo_id]);
    const _gI = _gIR.rows[0] || {};
    const _mbR = await query("SELECT CASE WHEN m.origem_tipo='ligante' THEN l.email ELSE d.email END as email FROM membros_grupo_cientifico m LEFT JOIN ligantes l ON m.origem_tipo='ligante' AND l.id=m.origem_id LEFT JOIN diretivos d ON m.origem_tipo='diretivo' AND d.id=m.origem_id WHERE m.grupo_id=$1",[v.grupo_id]);
    const config = await getConfig();
    const agora = new Date();
    const html = htmlSimples({
      config, faixaLabel: 'PORTAL CIENTIFICO',
      titulo: acao==='aprovar' ? 'Trabalho aprovado!' : 'Trabalho devolvido para correcao',
      mensagem: (acao==='aprovar'
        ? `Seu trabalho foi <strong>aprovado</strong> pela equipe do Cientifico em ${agora.toLocaleDateString('pt-BR')} as ${agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}. Parabens!`
        : `Seu trabalho foi <strong>devolvido para correcao</strong> em ${agora.toLocaleDateString('pt-BR')} as ${agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}.`)
        + `<br><br><strong>Projeto:</strong> ${escapeHtml(_gI.ptitulo)}<br><strong>Grupo:</strong> ${escapeHtml(_gI.gnome)}`
        + (comentario ? `<br><br><strong>Comentario do revisor:</strong><br>${escapeHtml(comentario)}` : '')
        + `<br><br>Verifique o portal para dar continuidade ao andamento do seu projeto.`,
      cta: { label: 'Acessar o Portal', url: 'https://cientifico.lauroucpcde.com' }
    });
    for (const _mb of _mbR.rows) {
      if (!_mb.email) continue;
      try { await enviarEmail({ para: _mb.email, assunto: (acao==='aprovar'?'Trabalho aprovado':'Trabalho devolvido para correcao')+' - Cientifico', html }); } catch(e){}
    }
  } catch(e) { console.error('[Email Cientifico] Erro notificar membros:', e.message); }
  await registrarTimeline(v.grupo_id, acao==='aprovar'?'Trabalho aprovado':'Devolvido para correcao', comentario||null);
  req.session.msg=[acao==='aprovar'?'Trabalho aprovado!':'Trabalho devolvido para correcao.'];
  res.redirect('/cientifico/projeto/'+v.projeto_id+'/grupo/'+v.grupo_id);
});

// GET /cientifico/versao/:versaoId/download
router.get('/cientifico/versao/:versaoId/download', requireAuth, requireCientifico, async (req, res) => {
  const vR = await query('SELECT * FROM versoes_trabalho WHERE id=$1',[req.params.versaoId]);
  if (!vR.rows.length) return res.status(404).send('Nao encontrado');
  const url = await gerarUrlInline(vR.rows[0].arquivo_chave);
  res.redirect(url);
});

// POST /cientifico/versao/:versaoId/apoio-revisor — painel de apoio tecnico para o revisor humano
router.post('/cientifico/versao/:versaoId/apoio-revisor', requireAuth, requireCientifico, async (req, res) => {
  try {
    const vR = await query('SELECT v.*, g.tipo_trabalho, pc.titulo as projeto_titulo FROM versoes_trabalho v JOIN grupos_cientificos g ON g.id=v.grupo_id JOIN projetos_cientificos pc ON pc.id=g.projeto_id WHERE v.id=$1', [req.params.versaoId]);
    if (!vR.rows.length) return res.json({ ok: false, erro: 'Versao nao encontrada.' });
    const versao = vR.rows[0];
    const ehPdf = /\.pdf$/i.test(versao.arquivo_nome || '');
    const ehWord = /\.docx?$/i.test(versao.arquivo_nome || '');
    if (!ehPdf && !ehWord) {
      return res.json({ ok: false, erro: 'O apoio automatico so funciona com arquivos em PDF ou Word.' });
    }
    const { gerarUrlTemporaria } = require('../services/arquivos');
    const url = await gerarUrlTemporaria(versao.arquivo_chave, 120);
    const axios = require('axios');
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    let base64Pdf;
    if (ehPdf) {
      base64Pdf = Buffer.from(resp.data).toString('base64');
    } else {
      const mimetype = /\.docx$/i.test(versao.arquivo_nome) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/msword';
      base64Pdf = await converterWordParaPdfBase64(Buffer.from(resp.data), versao.arquivo_nome, mimetype);
    }
    const { apoioRevisor } = require('../services/cientifico-ia');
    const r = await apoioRevisor(query, { base64Pdf, tituloProjeto: versao.projeto_titulo, tipoTrabalho: versao.tipo_trabalho });
    if (!r.ok) return res.json({ ok: false, erro: r.erro });
    await query('UPDATE versoes_trabalho SET ia_analise_revisor=$1 WHERE id=$2', [JSON.stringify(r.apoio), req.params.versaoId]);
    res.json({ ok: true, apoio: r.apoio });
  } catch(e) { res.json({ ok: false, erro: e.message }); }
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

// GET /portal/materiais/:id/arquivo — abre material de apoio (ex: PRODUÇÃO CIENTÍFICA) no Portal Cientifico
router.get('/portal/materiais/:id/arquivo', requirePortal, async (req, res) => {
  try {
    const r = await query('SELECT * FROM materiais_estudo WHERE id=$1 AND ativo=true', [req.params.id]);
    if (!r.rows.length) return res.status(404).send('Material nao encontrado');
    const mat = r.rows[0];
    if (!mat.arquivo_chave) return res.status(404).send('Arquivo nao disponivel');
    const { gerarUrlTemporaria } = require('../services/arquivos');
    const url = await gerarUrlTemporaria(mat.arquivo_chave, 600);
    res.redirect(url);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

// GET /portal
router.get('/portal', requirePortal, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const { tipo, id } = req.session.portalMembro;
  const membro = await getPortalMembro(tipo, id);
  if (!membro) { req.session.portalMembro = null; return res.redirect('/portal/login'); }
  const gruposTodos = (await query(`
    SELECT m.grupo_id, gc.nome as grupo_nome, gc.status as grupo_status, pc.titulo as projeto_titulo, pc.prazo,
      (SELECT status FROM versoes_trabalho v WHERE v.grupo_id=m.grupo_id ORDER BY v.enviado_em DESC LIMIT 1) as ultimo_status
    FROM membros_grupo_cientifico m
    JOIN grupos_cientificos gc ON gc.id=m.grupo_id
    JOIN projetos_cientificos pc ON pc.id=gc.projeto_id
    WHERE m.origem_tipo=$1 AND m.origem_id=$2
    ORDER BY pc.criado_em DESC
  `, [tipo, id])).rows;
  const grupos = gruposTodos.filter(g => g.grupo_status !== 'encerrado');
  const gruposEncerrados = gruposTodos.filter(g => g.grupo_status === 'encerrado');
  const hora = parseInt(dayjs().tz ? dayjs().tz('America/Asuncion').format('H') : dayjs().format('H'), 10);
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const dataHoje = dayjs().format('DD/MM/YYYY');
  const materiais = (await query(
    "SELECT id, titulo, descricao, arquivo_nome FROM materiais_estudo WHERE ativo=true AND categoria='PRODUÇÃO CIENTÍFICA' ORDER BY ordem ASC, criado_em DESC"
  )).rows;
  res.render('pages/portal/dashboard', { config, membro, grupos, gruposEncerrados, msg, saudacao, dataHoje, tipoLabel: tipo === 'ligante' ? 'Ligante' : 'Diretivo', materiais });
});

// A edição de cadastro saiu do Portal Científico (que é só trabalhos científicos) e vive
// no Portal do Membro: GET/POST /membro/perfil/*.


// ─── MATERIAIS DE ESTUDO (ADMIN) ─────────────────────────────────────────────
router.get('/materiais', requireAuth, requirePermissao('materiais'), async (req, res) => {
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
router.get('/materiais/:id/arquivo-admin', requireAuth, requirePermissao('materiais'), async (req, res) => {
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
router.post('/portal/login', limiterLogin, async (req, res) => {
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
  if (!membro) { req.session.erro=['Este e-mail não condiz com o cadastro oficial de ligantes/diretivos da liga. Em caso de dúvida, entre em contato com a secretaria.']; return res.redirect('/portal/login'); }
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
router.post('/portal/trocar-senha', requirePortal, limiterLogin, async (req, res) => {
  const { senha_atual, nova_senha, confirmar_senha } = req.body;
  if (!nova_senha || nova_senha.length < 8) { req.session.erro=['Senha deve ter no minimo 8 caracteres.']; return res.redirect('/portal/trocar-senha'); }
  if (nova_senha !== confirmar_senha) { req.session.erro=['As senhas nao conferem.']; return res.redirect('/portal/trocar-senha'); }
  const { tipo, id } = req.session.portalMembro;
  const senhaAtualR = await query('SELECT senha_hash FROM portal_cientifico_senhas WHERE origem_tipo=$1 AND origem_id=$2', [tipo, id]);
  const senhaAtualOk = senhaAtualR.rows.length && await bcryptPortal.compare(senha_atual || '', senhaAtualR.rows[0].senha_hash);
  if (!senhaAtualOk) { req.session.erro=['Senha atual incorreta.']; return res.redirect('/portal/trocar-senha'); }
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
router.post('/portal/esqueci-senha', limiterEsqueciSenha, async (req, res) => {
  // try/catch obrigatorio: rota async que estoura sem captura pendura a requisicao para
  // sempre (Express 4 nao pega rejeicao de promise) — foi o que gerou os 499 no nginx.
  try {
    const { email } = req.body;
    let membro = null, tipo = null;
    const rL = await query('SELECT id, nome, email FROM ligantes WHERE LOWER(email)=LOWER($1) AND ativo=1', [email]);
    if (rL.rows.length) { membro = rL.rows[0]; tipo = 'ligante'; }
    else {
      const rD = await query('SELECT id, nome, email FROM diretivos WHERE LOWER(email)=LOWER($1) AND ativo=1', [email]);
      if (rD.rows.length) { membro = rD.rows[0]; tipo = 'diretivo'; }
    }
    if (membro) {
      const novaSenha = require('crypto').randomBytes(6).toString('base64url');
      // ORDEM IMPORTA: envia o e-mail PRIMEIRO e só troca a senha se ele saiu. Antes era o
      // contrário — a senha era destruída e, quando o envio falhava, a pessoa ficava
      // trancada fora: a antiga não valia mais e a nova nunca chegava.
      const env = await enviarEmailCient({
        para: membro.email,
        assunto: 'Portal Cientifico — Senha temporaria',
        texto: 'Ola ' + membro.nome + ',\n\nSua senha temporaria para o Portal Cientifico e: ' + novaSenha +
               '\n\nAo entrar, sera solicitado que voce defina uma nova senha.\n\nAcesse: ' +
               (process.env.APP_URL || '') + '/portal/login'
      });
      if (env && env.ok) {
        const hash = await bcryptPortal.hash(novaSenha, 10);
        const upd = await query('UPDATE portal_cientifico_senhas SET senha_hash=$1, primeiro_acesso=true WHERE origem_tipo=$2 AND origem_id=$3', [hash, tipo, membro.id]);
        // Quem nunca acessou o portal nao tem linha: sem isso o UPDATE nao acha nada e a
        // pessoa recebe uma senha que nao foi gravada em lugar nenhum.
        if (!upd.rowCount) {
          await query('INSERT INTO portal_cientifico_senhas (origem_tipo, origem_id, senha_hash, primeiro_acesso) VALUES ($1,$2,$3,true)', [tipo, membro.id, hash]);
        }
      } else {
        console.error('[PORTAL CIENTIFICO] envio do e-mail falhou — senha NAO alterada para', membro.email);
      }
    }
    req.session.msg = ['Se o email estiver cadastrado, voce recebera as instrucoes em instantes.'];
    res.redirect('/portal/esqueci-senha');
  } catch (e) {
    console.error('[PORTAL CIENTIFICO] esqueci-senha:', e);
    req.session.erro = ['No pudimos procesar tu solicitud ahora. Intentá de nuevo en instantes.'];
    res.redirect('/portal/esqueci-senha');
  }
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
  // Em trabalho "individual", cada um ve so as proprias versoes em andamento (rascunho,
  // em revisao, devolvido) - mas versoes APROVADAS ficam visiveis para todo o grupo, pois
  // colegas podem ter colaborado/coautorado e precisam poder consultar/baixar o trabalho
  // final depois de aprovado. Em trabalho "colaborativo", todo o historico ja e compartilhado.
  let versoes;
  if (grupo.tipo_trabalho === 'individual') {
    versoes = (await query(
      "SELECT * FROM versoes_trabalho WHERE grupo_id=$1 AND (status='aprovado' OR (enviado_por_tipo=$2 AND enviado_por_id=$3)) ORDER BY enviado_em DESC",
      [req.params.grupoId, tipo, id]
    )).rows;
  } else {
    versoes = (await query('SELECT * FROM versoes_trabalho WHERE grupo_id=$1 ORDER BY enviado_em DESC', [req.params.grupoId])).rows;
  }
  const chat = (await query('SELECT * FROM chat_grupo_cientifico WHERE grupo_id=$1 ORDER BY criado_em ASC', [req.params.grupoId])).rows;
  const timeline = (await query('SELECT * FROM timeline_grupo_cientifico WHERE grupo_id=$1 ORDER BY criado_em DESC', [req.params.grupoId])).rows;
  const avisos = (await query('SELECT * FROM avisos_cientificos WHERE projeto_id=$1 AND (grupo_id=$2 OR grupo_id IS NULL) ORDER BY criado_em DESC', [projeto.id, req.params.grupoId])).rows;
  const rascunhoR = await query('SELECT * FROM rascunhos_trabalho WHERE grupo_id=$1', [req.params.grupoId]);
  const rascunho = rascunhoR.rows[0] || null;
  const souDonoRascunho = !rascunho || !rascunho.dono_tipo || (rascunho.dono_tipo === tipo && rascunho.dono_id === id);
  let donoNomeRascunho = null;
  if (rascunho && rascunho.dono_tipo && !souDonoRascunho) {
    const donoM = await getPortalMembro(rascunho.dono_tipo, rascunho.dono_id);
    donoNomeRascunho = donoM ? donoM.nome : 'outro membro do grupo';
  }
  const podeEditarRascunho = souDonoRascunho && grupo.status !== 'encerrado';

  // Alerta de prazo - dispara quando faltam 5,4,3,2,1 dias ou e o proprio dia do prazo,
  // desde que o trabalho ainda nao tenha sido aprovado.
  let diasRestantesPrazo = null;
  const jaAprovado = versoes.some(v => v.status === 'aprovado');
  const prazoEfetivo = grupo.prazo || projeto.prazo;
  if (prazoEfetivo && !jaAprovado) {
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const prazoData = new Date(prazoEfetivo); prazoData.setHours(0,0,0,0);
    const diff = Math.round((prazoData - hoje) / (1000*60*60*24));
    if (diff >= 0 && diff <= 5) diasRestantesPrazo = diff;
  }

  res.render('pages/portal/grupo', { config, membro, grupo, projeto, versoes, chat, timeline, avisos, msg, erro, rascunho, diasRestantesPrazo, souDonoRascunho, donoNomeRascunho, podeEditarRascunho, meuTipo: tipo, meuId: id });
});

// POST /portal/grupo/:grupoId/upload
router.post('/portal/grupo/:grupoId/upload', requirePortal, uploadArq.single('arquivo'), async (req, res) => {
  const { tipo, id } = req.session.portalMembro;
  const mR = await query('SELECT 1 FROM membros_grupo_cientifico WHERE grupo_id=$1 AND origem_tipo=$2 AND origem_id=$3', [req.params.grupoId, tipo, id]);
  if (!mR.rows.length) return res.redirect('/portal');
  if (await grupoEstaEncerrado(req.params.grupoId)) { req.session.erro=['Este grupo foi encerrado e nao aceita mais alteracoes.']; return res.redirect('/portal/grupo/'+req.params.grupoId); }
  if (!req.file) { req.session.erro=['Selecione um arquivo.']; return res.redirect('back'); }
  const chave = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'cientifico/trabalhos');
  const insR = await query('INSERT INTO versoes_trabalho (grupo_id,arquivo_chave,arquivo_nome,enviado_por_tipo,enviado_por_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [req.params.grupoId, chave, req.file.originalname, tipo, id]);
  const membro = await getPortalMembro(tipo, id);
  await registrarTimeline(req.params.grupoId, 'Nova versao enviada', (membro?.nome||'Membro')+' enviou uma nova versao do trabalho');
  await registrarEventoVersao(insR.rows[0].id, 'enviado', { autorTipo: tipo, autorId: id, autorNome: membro?.nome });
  await notificarStaffNovoTrabalho({ grupoId: req.params.grupoId, membroNome: membro?.nome });
  await confirmarEnvioParaMembro({ grupoId: req.params.grupoId, tipo, id });
  req.session.msg=['Versao enviada com sucesso!'];
  res.redirect('/portal/grupo/'+req.params.grupoId);
});

// POST /portal/grupo/:grupoId/versao/:versaoId/revisar-ia — pre-check com IA antes da submissao oficial
router.post('/portal/grupo/:grupoId/versao/:versaoId/revisar-ia', requirePortal, async (req, res) => {
  const { tipo, id } = req.session.portalMembro;
  try {
    const mR = await query('SELECT 1 FROM membros_grupo_cientifico WHERE grupo_id=$1 AND origem_tipo=$2 AND origem_id=$3', [req.params.grupoId, tipo, id]);
    if (!mR.rows.length) return res.json({ ok: false, erro: 'Sem permissao para este grupo.' });
    const vR = await query('SELECT * FROM versoes_trabalho WHERE id=$1 AND grupo_id=$2', [req.params.versaoId, req.params.grupoId]);
    if (!vR.rows.length) return res.json({ ok: false, erro: 'Versao nao encontrada.' });
    const versao = vR.rows[0];
    const ehPdf = /\.pdf$/i.test(versao.arquivo_nome || '');
    const ehWord = /\.docx?$/i.test(versao.arquivo_nome || '');
    if (!ehPdf && !ehWord) {
      return res.json({ ok: false, erro: 'A revisao automatica so funciona com arquivos em PDF ou Word.' });
    }
    const gR = await query('SELECT gc.tipo_trabalho, pc.titulo FROM grupos_cientificos gc JOIN projetos_cientificos pc ON pc.id=gc.projeto_id WHERE gc.id=$1', [req.params.grupoId]);
    const grupo = gR.rows[0] || {};
    const { gerarUrlTemporaria } = require('../services/arquivos');
    const url = await gerarUrlTemporaria(versao.arquivo_chave, 120);
    const axios = require('axios');
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    let base64Pdf;
    if (ehPdf) {
      base64Pdf = Buffer.from(resp.data).toString('base64');
    } else {
      const mimetype = /\.docx$/i.test(versao.arquivo_nome) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/msword';
      base64Pdf = await converterWordParaPdfBase64(Buffer.from(resp.data), versao.arquivo_nome, mimetype);
    }
    const { revisarTrabalho } = require('../services/cientifico-ia');
    const r = await revisarTrabalho(query, { base64Pdf, tituloProjeto: grupo.titulo, tipoTrabalho: grupo.tipo_trabalho });
    if (!r.ok) return res.json({ ok: false, erro: r.erro });
    await query('UPDATE versoes_trabalho SET ia_revisao=$1, ia_revisado_em=NOW() WHERE id=$2', [JSON.stringify(r.revisao), req.params.versaoId]);
    res.json({ ok: true, revisao: r.revisao });
  } catch(e) { res.json({ ok: false, erro: e.message }); }
});

// POST /portal/grupo/:grupoId/versao/:versaoId/final — depois do trabalho aprovado, o dono
// sobe o arquivo final ja adaptado para o modelo/normas exigidos pelo congresso ou evento
// especifico (cada um tem seu proprio padrao, as vezes com logomarca e capa proprias, que a
// pessoa preenche por fora do sistema). Esse arquivo SUBSTITUI o arquivo aprovado na mesma
// versao - fica salvo no portal para acompanhamento e download futuro.
router.post('/portal/grupo/:grupoId/versao/:versaoId/final', requirePortal, uploadArq.single('arquivo_final'), async (req, res) => {
  const { tipo, id } = req.session.portalMembro;
  try {
    const mR = await query('SELECT 1 FROM membros_grupo_cientifico WHERE grupo_id=$1 AND origem_tipo=$2 AND origem_id=$3', [req.params.grupoId, tipo, id]);
    if (!mR.rows.length) { req.session.erro=['Sem permissao para este grupo.']; return res.redirect('/portal'); }
    if (await grupoEstaEncerrado(req.params.grupoId)) { req.session.erro=['Este grupo foi encerrado e nao aceita mais alteracoes.']; return res.redirect('/portal/grupo/'+req.params.grupoId); }
    const vR = await query('SELECT * FROM versoes_trabalho WHERE id=$1 AND grupo_id=$2', [req.params.versaoId, req.params.grupoId]);
    if (!vR.rows.length) { req.session.erro=['Versao nao encontrada.']; return res.redirect('/portal/grupo/'+req.params.grupoId); }
    const versao = vR.rows[0];
    if (versao.status !== 'aprovado') { req.session.erro=['So e possivel enviar o trabalho final depois que a versao for aprovada.']; return res.redirect('/portal/grupo/'+req.params.grupoId); }
    if (versao.enviado_por_tipo !== tipo || versao.enviado_por_id !== id) { req.session.erro=['Apenas quem enviou este trabalho pode subir a versao final.']; return res.redirect('/portal/grupo/'+req.params.grupoId); }
    if (!req.file) { req.session.erro=['Selecione o arquivo final.']; return res.redirect('/portal/grupo/'+req.params.grupoId); }

    const chave = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'cientifico/trabalhos');
    await query('UPDATE versoes_trabalho SET arquivo_chave=$1, arquivo_nome=$2, finalizado_em=NOW() WHERE id=$3', [chave, req.file.originalname, req.params.versaoId]);

    const membro = await getPortalMembro(tipo, id);
    await registrarTimeline(req.params.grupoId, 'Trabalho final enviado', (membro?.nome||'Membro')+' enviou o trabalho final, ja no modelo do evento/congresso');
    req.session.msg=['Trabalho final enviado e salvo no portal!'];
    res.redirect('/portal/grupo/'+req.params.grupoId);
  } catch(e) { console.error('versao/final erro:', e.message); req.session.erro=['Erro ao enviar o trabalho final.']; res.redirect('/portal/grupo/'+req.params.grupoId); }
});

// GET /portal/grupo/:grupoId/versao/:versaoId/download — consulta/download do arquivo de uma
// versao, disponivel para qualquer membro do grupo (dono ou coautor/colega) a qualquer momento,
// respeitando a mesma regra de visibilidade da listagem (trabalho individual so mostra versoes
// aprovadas para quem nao enviou; trabalho colaborativo mostra tudo).
router.get('/portal/grupo/:grupoId/versao/:versaoId/download', requirePortal, async (req, res) => {
  const { tipo, id } = req.session.portalMembro;
  try {
    const mR = await query('SELECT 1 FROM membros_grupo_cientifico WHERE grupo_id=$1 AND origem_tipo=$2 AND origem_id=$3', [req.params.grupoId, tipo, id]);
    if (!mR.rows.length) return res.status(403).send('Sem permissao para este grupo.');
    const gR = await query('SELECT tipo_trabalho FROM grupos_cientificos WHERE id=$1', [req.params.grupoId]);
    if (!gR.rows.length) return res.status(404).send('Grupo nao encontrado.');
    const vR = await query('SELECT * FROM versoes_trabalho WHERE id=$1 AND grupo_id=$2', [req.params.versaoId, req.params.grupoId]);
    if (!vR.rows.length) return res.status(404).send('Versao nao encontrada.');
    const versao = vR.rows[0];
    const ehDono = versao.enviado_por_tipo === tipo && versao.enviado_por_id === id;
    if (gR.rows[0].tipo_trabalho === 'individual' && versao.status !== 'aprovado' && !ehDono) {
      return res.status(403).send('Esta versao ainda nao esta disponivel para consulta.');
    }
    const { gerarUrlInline } = require('../services/arquivos');
    const url = await gerarUrlInline(versao.arquivo_chave);
    res.redirect(url);
  } catch(e) { console.error('versao/download erro:', e.message); res.status(500).send('Erro ao baixar o arquivo.'); }
});

// POST /portal/projeto/:projetoId/pico — assistente de construcao da pergunta PICO
router.post('/portal/projeto/:projetoId/pico', requirePortal, async (req, res) => {
  const { tipo, id } = req.session.portalMembro;
  const { ideia } = req.body;
  if (!ideia || !ideia.trim()) return res.json({ ok: false, erro: 'Descreva a ideia do estudo.' });
  try {
    const mR = await query(
      `SELECT 1 FROM membros_grupo_cientifico m JOIN grupos_cientificos gc ON gc.id=m.grupo_id
       WHERE gc.projeto_id=$1 AND m.origem_tipo=$2 AND m.origem_id=$3`,
      [req.params.projetoId, tipo, id]
    );
    if (!mR.rows.length) return res.json({ ok: false, erro: 'Sem permissao para este projeto.' });
    const { refinarPico } = require('../services/cientifico-ia');
    const r = await refinarPico(query, { ideiaLivre: ideia.trim() });
    if (!r.ok) return res.json({ ok: false, erro: r.erro });
    await query('UPDATE projetos_cientificos SET pico_pergunta=$1 WHERE id=$2', [JSON.stringify(r.pico), req.params.projetoId]);
    res.json({ ok: true, pico: r.pico });
  } catch(e) { res.json({ ok: false, erro: e.message }); }
});

// POST /portal/grupo/:grupoId/buscar-literatura — busca real no PubMed + sintese com IA
router.post('/portal/grupo/:grupoId/buscar-literatura', requirePortal, async (req, res) => {
  const { tipo, id } = req.session.portalMembro;
  const { termo } = req.body;
  if (!termo || !termo.trim()) return res.json({ ok: false, erro: 'Descreva o tema da busca.' });
  try {
    const mR = await query('SELECT 1 FROM membros_grupo_cientifico WHERE grupo_id=$1 AND origem_tipo=$2 AND origem_id=$3', [req.params.grupoId, tipo, id]);
    if (!mR.rows.length) return res.json({ ok: false, erro: 'Sem permissao para este grupo.' });
    const { buscarPubMed, sintetizarAchados } = require('../services/cientifico-busca');
    const r = await buscarPubMed(query, termo.trim());
    if (!r.ok) return res.json(r);
    let sintese = null;
    if (r.artigos.length) {
      const s = await sintetizarAchados(query, { tema: termo.trim(), artigos: r.artigos });
      if (s.ok) sintese = s.texto;
    }
    res.json({ ok: true, artigos: r.artigos, sintese });
  } catch(e) { res.json({ ok: false, erro: e.message }); }
});

// POST /portal/grupo/:grupoId/artigos-relacionados — busca real no Semantic Scholar
router.post('/portal/grupo/:grupoId/artigos-relacionados', requirePortal, async (req, res) => {
  const { tipo, id } = req.session.portalMembro;
  const { termo } = req.body;
  if (!termo || !termo.trim()) return res.json({ ok: false, erro: 'Descreva o tema ou cole o titulo do artigo.' });
  try {
    const mR = await query('SELECT 1 FROM membros_grupo_cientifico WHERE grupo_id=$1 AND origem_tipo=$2 AND origem_id=$3', [req.params.grupoId, tipo, id]);
    if (!mR.rows.length) return res.json({ ok: false, erro: 'Sem permissao para este grupo.' });
    const { artigosRelacionados } = require('../services/cientifico-busca');
    const r = await artigosRelacionados(termo.trim());
    res.json(r);
  } catch(e) { res.json({ ok: false, erro: e.message }); }
});

// POST /portal/grupo/:grupoId/polir-texto — reescreve trecho em tom cientifico e sugere titulo
router.post('/portal/grupo/:grupoId/polir-texto', requirePortal, async (req, res) => {
  const { tipo, id } = req.session.portalMembro;
  const { texto } = req.body;
  if (!texto || !texto.trim()) return res.json({ ok: false, erro: 'Cole o texto que deseja polir.' });
  try {
    const mR = await query('SELECT 1 FROM membros_grupo_cientifico WHERE grupo_id=$1 AND origem_tipo=$2 AND origem_id=$3', [req.params.grupoId, tipo, id]);
    if (!mR.rows.length) return res.json({ ok: false, erro: 'Sem permissao para este grupo.' });
    const { polirTexto } = require('../services/cientifico-busca');
    const r = await polirTexto(query, texto.trim());
    res.json(r);
  } catch(e) { res.json({ ok: false, erro: e.message }); }
});

// Confere se o membro logado pertence ao grupo (usado pelas rotas do Editor de Documento)
async function membroPertenceAoGrupo(grupoId, tipo, id) {
  const r = await query('SELECT 1 FROM membros_grupo_cientifico WHERE grupo_id=$1 AND origem_tipo=$2 AND origem_id=$3', [grupoId, tipo, id]);
  return r.rows.length > 0;
}

// Grupo encerrado nao aceita mais alteracoes (envio de versao, edicao de rascunho, upload de
// trabalho final) - continua so para consulta/download.
async function grupoEstaEncerrado(grupoId) {
  const r = await query('SELECT status FROM grupos_cientificos WHERE id=$1', [grupoId]);
  return r.rows.length > 0 && r.rows[0].status === 'encerrado';
}

// Escapa texto (nome, comentario etc) antes de colocar dentro de HTML de email - evita
// que um nome ou comentario com <script>/<img onerror> vire XSS no cliente de email.
function escapeHtml(str) {
  return String(str||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Usuarios do sistema que devem ser avisados por email sobre o Cientifico:
// equipe com permissao do modulo 'cientifico', presidencia e administrador.
async function emailsStaffCientifico() {
  const r = await query(`
    SELECT DISTINCT u.email, u.nome FROM usuarios u
    LEFT JOIN usuario_permissoes up ON up.usuario_id=u.id AND up.modulo='cientifico'
    WHERE u.ativo=1 AND u.email IS NOT NULL AND u.email <> ''
      AND (up.usuario_id IS NOT NULL OR u.perfil IN ('presidencia','admin'))
  `);
  return r.rows;
}

// Converte um arquivo Word (.doc/.docx) para PDF (base64) usando o Google Drive como
// conversor (sobe como Google Doc, exporta em PDF, apaga a copia temporaria). Usado para
// a IA de apoio/revisao, que so consegue ler PDF.
async function converterWordParaPdfBase64(buffer, nome, mimetype) {
  const tokensR = await query("SELECT valor FROM configuracoes WHERE chave='google_tokens'");
  if (!tokensR.rows.length) throw new Error('Google Drive nao esta conectado. Fale com o administrador.');
  const tokens = JSON.parse(tokensR.rows[0].valor);
  const { uploadParaDrive, exportarArquivo, getClient } = require('../services/google-drive');
  const resultado = await uploadParaDrive(tokens, buffer, nome, mimetype, 'reader');
  const pdfBuffer = await exportarArquivo(tokens, resultado.fileId, 'application/pdf');
  try {
    const { google } = require('googleapis');
    await google.drive({ version: 'v3', auth: getClient(tokens) }).files.delete({ fileId: resultado.fileId });
  } catch(e) { console.error('[Cientifico] Erro ao apagar copia temporaria do Drive:', e.message); }
  return pdfBuffer.toString('base64');
}

// Dispara email para a equipe do Cientifico/presidencia/admin avisando de um trabalho novo.
async function notificarStaffNovoTrabalho({ grupoId, membroNome }) {
  try {
    const { enviarEmail, htmlSimples } = require('../services/notificacoes');
    const gInfoR = await query('SELECT gc.nome as gnome, pc.titulo as ptitulo FROM grupos_cientificos gc JOIN projetos_cientificos pc ON pc.id=gc.projeto_id WHERE gc.id=$1', [grupoId]);
    const gInfo = gInfoR.rows[0] || {};
    const config = await getConfig();
    const staff = await emailsStaffCientifico();
    const html = htmlSimples({
      config, faixaLabel: 'PORTAL CIENTIFICO',
      titulo: 'Novo trabalho para correcao',
      mensagem: `<strong>${escapeHtml(membroNome)||'Um membro'}</strong> enviou uma nova versao do trabalho para avaliacao.<br><br><strong>Projeto:</strong> ${escapeHtml(gInfo.ptitulo)}<br><strong>Grupo:</strong> ${escapeHtml(gInfo.gnome)}`,
      cta: { label: 'Abrir para revisar', url: 'https://sistema.lauroucpcde.com/cientifico' }
    });
    for (const s of staff) {
      try { await enviarEmail({ para: s.email, assunto: 'Novo trabalho para correcao - Cientifico', html }); } catch(e){}
    }
  } catch(e) { console.error('[Email Cientifico] Erro ao notificar staff:', e.message); }
}

// Confirma por email para quem enviou que o trabalho chegou (comprovante com data/hora).
async function confirmarEnvioParaMembro({ grupoId, tipo, id }) {
  try {
    const { enviarEmail, htmlSimples } = require('../services/notificacoes');
    const membro = await getPortalMembro(tipo, id);
    if (!membro || !membro.email) return;
    const gInfoR = await query('SELECT gc.nome as gnome, pc.titulo as ptitulo FROM grupos_cientificos gc JOIN projetos_cientificos pc ON pc.id=gc.projeto_id WHERE gc.id=$1', [grupoId]);
    const gInfo = gInfoR.rows[0] || {};
    const config = await getConfig();
    const agora = new Date();
    const html = htmlSimples({
      config, faixaLabel: 'PORTAL CIENTIFICO',
      titulo: 'Trabalho enviado com sucesso',
      mensagem: `Recebemos o seu trabalho em <strong>${agora.toLocaleDateString('pt-BR')} as ${agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</strong>.<br><br><strong>Projeto:</strong> ${escapeHtml(gInfo.ptitulo)}<br><strong>Grupo:</strong> ${escapeHtml(gInfo.gnome)}<br><strong>Status:</strong> Enviado - aguardando avaliacao<br><br>Este email serve como comprovante do envio. Assim que a equipe do Cientifico avaliar, voce recebe um novo aviso por aqui.`,
      cta: { label: 'Acompanhar no Portal', url: 'https://cientifico.lauroucpcde.com' }
    });
    await enviarEmail({ para: membro.email, assunto: 'Comprovante: trabalho enviado - Cientifico', html });
  } catch(e) { console.error('[Email Cientifico] Erro ao confirmar envio ao membro:', e.message); }
}

// So o "dono" do trabalho (quem criou o rascunho) pode editar/gerar/enviar; os demais membros
// do grupo so podem visualizar e copiar o conteudo. Se ainda ninguem e dono (rascunho novo ou
// inexistente), a pessoa atual assume a posse automaticamente ao ser a primeira a mexer.
async function garantirDonoRascunho(grupoId, tipo, id) {
  const r = await query('SELECT dono_tipo, dono_id FROM rascunhos_trabalho WHERE grupo_id=$1', [grupoId]);
  if (!r.rows.length || !r.rows[0].dono_tipo) return { ok: true };
  const dono = r.rows[0];
  if (dono.dono_tipo === tipo && dono.dono_id === id) return { ok: true };
  return { ok: false, erro: 'Apenas quem criou este trabalho pode edita-lo. Voce pode visualizar e copiar o conteudo, mas nao editar.' };
}

// POST /portal/grupo/:grupoId/rascunho/salvar — salva o titulo/norma/texto do Editor de
// Documento no sistema (um rascunho por grupo). So o dono do trabalho pode salvar; os demais
// membros do grupo podem visualizar mas nao editar. A pessoa pode continuar de qualquer
// lugar depois, sem precisar terminar tudo de uma vez.
router.post('/portal/grupo/:grupoId/rascunho/salvar', requirePortal, async (req, res) => {
  const { tipo, id } = req.session.portalMembro;
  const { texto, titulo, norma } = req.body;
  try {
    if (!(await membroPertenceAoGrupo(req.params.grupoId, tipo, id))) return res.json({ ok: false, erro: 'Sem permissao para este grupo.' });
    if (await grupoEstaEncerrado(req.params.grupoId)) return res.json({ ok: false, erro: 'Este grupo foi encerrado e nao aceita mais alteracoes.' });
    const dono = await garantirDonoRascunho(req.params.grupoId, tipo, id);
    if (!dono.ok) return res.json(dono);
    await query(`
      INSERT INTO rascunhos_trabalho (grupo_id, titulo, norma, texto, dono_tipo, dono_id, atualizado_por_tipo, atualizado_por_id, atualizado_em)
      VALUES ($1,$2,$3,$4,$5,$6,$5,$6,NOW())
      ON CONFLICT (grupo_id) DO UPDATE SET titulo=$2, norma=$3, texto=$4,
        dono_tipo=COALESCE(rascunhos_trabalho.dono_tipo,$5), dono_id=COALESCE(rascunhos_trabalho.dono_id,$6),
        atualizado_por_tipo=$5, atualizado_por_id=$6, atualizado_em=NOW()
    `, [req.params.grupoId, titulo || null, norma || 'abnt', texto || '', tipo, id]);
    res.json({ ok: true });
  } catch(e) { console.error('rascunho/salvar erro:', e.message); res.json({ ok: false, erro: 'Erro ao salvar o rascunho.' }); }
});

// POST /portal/grupo/:grupoId/rascunho/baixar — gera e baixa o .docx formatado na norma,
// com o bloco de orientacoes no final (para quem so quer o arquivo local, sem usar o Google Docs).
router.post('/portal/grupo/:grupoId/rascunho/baixar', requirePortal, async (req, res) => {
  const { tipo, id } = req.session.portalMembro;
  const { texto, titulo, norma } = req.body;
  if (!texto || !texto.trim()) return res.status(400).send('Escreva ou cole o texto do trabalho primeiro.');
  try {
    if (!(await membroPertenceAoGrupo(req.params.grupoId, tipo, id))) return res.status(403).send('Sem permissao para este grupo.');
    if (await grupoEstaEncerrado(req.params.grupoId)) return res.status(403).send('Este grupo foi encerrado e nao aceita mais alteracoes.');
    const dono = await garantirDonoRascunho(req.params.grupoId, tipo, id);
    if (!dono.ok) return res.status(403).send(dono.erro);
    const { gerarDocumentoCientifico } = require('../services/gerador-docx');
    const tituloFinal = (titulo && titulo.trim()) ? titulo.trim() : 'Trabalho Cientifico';
    const nomeArquivo = tituloFinal.replace(/[^a-zA-Z0-9 ]+/g, '').trim().substring(0, 60) + '.docx';
    const buffer = await gerarDocumentoCientifico({ titulo: tituloFinal, texto: texto.trim(), norma });
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.set('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
    res.send(buffer);
  } catch(e) { console.error('rascunho/baixar erro:', e.message); res.status(500).send('Erro ao gerar o documento.'); }
});

// POST /portal/grupo/:grupoId/rascunho/editar-google — na primeira vez, gera o .docx
// formatado e sobe pro Google Drive da liga como Google Doc editavel. Nas proximas vezes,
// reaproveita o MESMO documento (nao cria um novo, pra nao perder edicoes feitas direto no
// Google Docs) e apenas destrava a edicao, caso tenha sido travada apos um envio anterior.
router.post('/portal/grupo/:grupoId/rascunho/editar-google', requirePortal, async (req, res) => {
  const { tipo, id } = req.session.portalMembro;
  const { texto, titulo, norma } = req.body;
  try {
    if (!(await membroPertenceAoGrupo(req.params.grupoId, tipo, id))) return res.json({ ok: false, erro: 'Sem permissao para este grupo.' });
    if (await grupoEstaEncerrado(req.params.grupoId)) return res.json({ ok: false, erro: 'Este grupo foi encerrado e nao aceita mais alteracoes.' });
    const dono = await garantirDonoRascunho(req.params.grupoId, tipo, id);
    if (!dono.ok) return res.json(dono);
    const tokensR = await query("SELECT valor FROM configuracoes WHERE chave='google_tokens'");
    if (!tokensR.rows.length) return res.json({ ok: false, erro: 'Google Drive nao esta conectado. Fale com o administrador.' });
    const tokens = JSON.parse(tokensR.rows[0].valor);
    const { uploadParaDrive, definirPermissaoPublica } = require('../services/google-drive');

    const rascunhoR = await query('SELECT google_file_id, google_doc_url, google_embed_url FROM rascunhos_trabalho WHERE grupo_id=$1', [req.params.grupoId]);
    const existente = rascunhoR.rows[0];

    if (existente && existente.google_file_id) {
      // Ja existe um documento pra este grupo - so destrava a edicao (caso estivesse travado
      // apos um envio anterior) em vez de criar um documento novo e perder o que ja tem la.
      await definirPermissaoPublica(tokens, existente.google_file_id, 'writer');
      await query('UPDATE rascunhos_trabalho SET atualizado_por_tipo=$1, atualizado_por_id=$2, atualizado_em=NOW() WHERE grupo_id=$3', [tipo, id, req.params.grupoId]);
      return res.json({ ok: true, embedUrl: existente.google_embed_url, docUrl: existente.google_doc_url, fileId: existente.google_file_id });
    }

    if (!texto || !texto.trim()) return res.json({ ok: false, erro: 'Escreva ou cole o texto do trabalho primeiro.' });
    const { gerarDocumentoCientifico } = require('../services/gerador-docx');
    const tituloFinal = (titulo && titulo.trim()) ? titulo.trim() : 'Trabalho Cientifico';
    const buffer = await gerarDocumentoCientifico({ titulo: tituloFinal, texto: texto.trim(), norma });
    const resultado = await uploadParaDrive(tokens, buffer, tituloFinal + '.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'writer');

    await query(`
      INSERT INTO rascunhos_trabalho (grupo_id, titulo, norma, texto, google_file_id, google_doc_url, google_embed_url, atualizado_por_tipo, atualizado_por_id, atualizado_em)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
      ON CONFLICT (grupo_id) DO UPDATE SET titulo=$2, norma=$3, texto=$4, google_file_id=$5, google_doc_url=$6, google_embed_url=$7, atualizado_por_tipo=$8, atualizado_por_id=$9, atualizado_em=NOW()
    `, [req.params.grupoId, tituloFinal, norma || 'abnt', texto.trim(), resultado.fileId, resultado.webViewLink, resultado.embedUrl, tipo, id]);

    res.json({ ok: true, embedUrl: resultado.embedUrl, docUrl: resultado.webViewLink, fileId: resultado.fileId });
  } catch(e) { console.error('rascunho/editar-google erro:', e.message); res.json({ ok: false, erro: 'Erro ao abrir no Google Docs.' }); }
});

// POST /portal/grupo/:grupoId/rascunho/revisar-ia — ultima conferencia da IA antes de enviar
// para avaliacao oficial: aponta pontos fortes, pontos de atencao e se a estrutura
// IMRAD/norma parece completa, com base no conteudo mais atual do rascunho (ou do Google
// Docs, se a pessoa estiver editando por la). Nao substitui a avaliacao humana do Cientifico.
router.post('/portal/grupo/:grupoId/rascunho/revisar-ia', requirePortal, async (req, res) => {
  const { tipo, id } = req.session.portalMembro;
  try {
    if (!(await membroPertenceAoGrupo(req.params.grupoId, tipo, id))) return res.json({ ok: false, erro: 'Sem permissao para este grupo.' });
    if (await grupoEstaEncerrado(req.params.grupoId)) return res.json({ ok: false, erro: 'Este grupo foi encerrado e nao aceita mais alteracoes.' });
    const dono = await garantirDonoRascunho(req.params.grupoId, tipo, id);
    if (!dono.ok) return res.json(dono);
    const rascunhoR = await query('SELECT * FROM rascunhos_trabalho WHERE grupo_id=$1', [req.params.grupoId]);
    if (!rascunhoR.rows.length || !(rascunhoR.rows[0].texto || '').trim()) return res.json({ ok: false, erro: 'Escreva ou salve o rascunho antes de revisar.' });
    let rascunho = rascunhoR.rows[0];

    const tokensR = await query("SELECT valor FROM configuracoes WHERE chave='google_tokens'");
    if (!tokensR.rows.length) return res.json({ ok: false, erro: 'Google Drive nao esta conectado. Fale com o administrador.' });
    const tokens = JSON.parse(tokensR.rows[0].valor);
    const { uploadParaDrive, exportarArquivo } = require('../services/google-drive');

    let fileId = rascunho.google_file_id;
    if (!fileId) {
      // Ainda nao existe documento no Google - cria um agora so pra poder exportar em PDF e analisar.
      const { gerarDocumentoCientifico } = require('../services/gerador-docx');
      const tituloFinal = rascunho.titulo || 'Trabalho Cientifico';
      const buffer = await gerarDocumentoCientifico({ titulo: tituloFinal, texto: rascunho.texto, norma: rascunho.norma });
      const resultado = await uploadParaDrive(tokens, buffer, tituloFinal + '.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'writer');
      fileId = resultado.fileId;
      await query('UPDATE rascunhos_trabalho SET google_file_id=$1, google_doc_url=$2, google_embed_url=$3 WHERE grupo_id=$4',
        [resultado.fileId, resultado.webViewLink, resultado.embedUrl, req.params.grupoId]);
    }

    const pdfBuffer = await exportarArquivo(tokens, fileId, 'application/pdf');
    const base64Pdf = pdfBuffer.toString('base64');

    const gR = await query('SELECT gc.tipo_trabalho, pc.titulo FROM grupos_cientificos gc JOIN projetos_cientificos pc ON pc.id=gc.projeto_id WHERE gc.id=$1', [req.params.grupoId]);
    const grupo = gR.rows[0] || {};
    const { revisarTrabalho } = require('../services/cientifico-ia');
    const r = await revisarTrabalho(query, { base64Pdf, tituloProjeto: grupo.titulo, tipoTrabalho: grupo.tipo_trabalho });
    if (!r.ok) return res.json({ ok: false, erro: r.erro });
    res.json({ ok: true, revisao: r.revisao });
  } catch(e) { console.error('rascunho/revisar-ia erro:', e.message); res.json({ ok: false, erro: 'Erro ao revisar com IA.' }); }
});

// POST /portal/grupo/:grupoId/rascunho/enviar — envia o rascunho como nova versao oficial
// do trabalho, para avaliacao da equipe do Cientifico. Se a pessoa editou no Google Docs
// embutido, busca o conteudo mais atual direto do Google (o que ela tiver editado por
// ultimo); senao, gera a partir do texto salvo.
router.post('/portal/grupo/:grupoId/rascunho/enviar', requirePortal, async (req, res) => {
  const { tipo, id } = req.session.portalMembro;
  try {
    if (!(await membroPertenceAoGrupo(req.params.grupoId, tipo, id))) return res.json({ ok: false, erro: 'Sem permissao para este grupo.' });
    if (await grupoEstaEncerrado(req.params.grupoId)) return res.json({ ok: false, erro: 'Este grupo foi encerrado e nao aceita mais alteracoes.' });
    const dono = await garantirDonoRascunho(req.params.grupoId, tipo, id);
    if (!dono.ok) return res.json(dono);
    const rascunhoR = await query('SELECT * FROM rascunhos_trabalho WHERE grupo_id=$1', [req.params.grupoId]);
    if (!rascunhoR.rows.length) return res.json({ ok: false, erro: 'Nenhum rascunho salvo ainda para este grupo.' });
    const rascunho = rascunhoR.rows[0];

    const { uploadArquivo } = require('../services/arquivos');
    const tituloFinal = rascunho.titulo || 'Trabalho Cientifico';
    const nomeArquivo = tituloFinal.replace(/[^a-zA-Z0-9 ]+/g, '').trim().substring(0, 60) + '.docx';
    let buffer;

    if (rascunho.google_file_id) {
      const tokensR = await query("SELECT valor FROM configuracoes WHERE chave='google_tokens'");
      const { exportarArquivo, definirPermissaoPublica } = require('../services/google-drive');
      const tokens = JSON.parse(tokensR.rows[0].valor);
      buffer = await exportarArquivo(tokens, rascunho.google_file_id, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      // Trava o documento (volta pra so-leitura) assim que enviado - ninguem mais edita por
      // acidente o que ja foi submetido para avaliacao. Destrava de novo em "Editar no Google Docs".
      try { await definirPermissaoPublica(tokens, rascunho.google_file_id, 'reader'); } catch(e) { console.error('travar doc erro:', e.message); }
    } else {
      const { gerarDocumentoCientifico } = require('../services/gerador-docx');
      buffer = await gerarDocumentoCientifico({ titulo: tituloFinal, texto: rascunho.texto || '', norma: rascunho.norma });
    }

    const chave = await uploadArquivo(buffer, nomeArquivo, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'cientifico/trabalhos');
    const insR = await query('INSERT INTO versoes_trabalho (grupo_id,arquivo_chave,arquivo_nome,enviado_por_tipo,enviado_por_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [req.params.grupoId, chave, nomeArquivo, tipo, id]);

    const membro = await getPortalMembro(tipo, id);
    await registrarTimeline(req.params.grupoId, 'Nova versao enviada', (membro?.nome || 'Membro') + ' enviou o trabalho para avaliacao');
    await registrarEventoVersao(insR.rows[0].id, 'enviado', { autorTipo: tipo, autorId: id, autorNome: membro?.nome });
    await notificarStaffNovoTrabalho({ grupoId: req.params.grupoId, membroNome: membro?.nome });
    await confirmarEnvioParaMembro({ grupoId: req.params.grupoId, tipo, id });

    res.json({ ok: true });
  } catch(e) { console.error('rascunho/enviar erro:', e.message); res.json({ ok: false, erro: 'Erro ao enviar o trabalho para avaliacao.' }); }
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
  const { tipo: tipoMembro, id: idMembro } = req.session.portalMembro;
  const pR = await query('SELECT * FROM projetos_cientificos WHERE id=$1', [req.params.projetoId]);
  if (!pR.rows.length) return res.status(404).send('Nao encontrado');
  const p = pR.rows[0];
  const pertenceR = await query(`SELECT 1 FROM membros_grupo_cientifico m JOIN grupos_cientificos gc ON gc.id=m.grupo_id WHERE gc.projeto_id=$1 AND m.origem_tipo=$2 AND m.origem_id=$3`, [req.params.projetoId, tipoMembro, idMembro]);
  if (!pertenceR.rows.length) return res.status(403).send('Sem permissao para este arquivo.');
  const chave = req.params.tipo==='edital' ? p.edital_chave : p.modelo_chave;
  if (!chave) return res.status(404).send('Arquivo nao encontrado');
  const url = await gerarUrlInline(chave);
  res.redirect(url);
});


// GET /cientifico/chat-arquivo/:chatId
router.get('/cientifico/chat-arquivo/:chatId', requireAuth, requireCientifico, async (req, res) => {
  const r = await query('SELECT * FROM chat_grupo_cientifico WHERE id=$1',[req.params.chatId]);
  if (!r.rows.length || !r.rows[0].arquivo_chave) return res.status(404).send('Nao encontrado');
  const url = await gerarUrlInline(r.rows[0].arquivo_chave);
  res.redirect(url);
});

// GET /portal/chat-arquivo/:chatId
router.get('/portal/chat-arquivo/:chatId', requirePortal, async (req, res) => {
  const { tipo, id } = req.session.portalMembro;
  const r = await query('SELECT * FROM chat_grupo_cientifico WHERE id=$1',[req.params.chatId]);
  if (!r.rows.length || !r.rows[0].arquivo_chave) return res.status(404).send('Nao encontrado');
  if (!(await membroPertenceAoGrupo(r.rows[0].grupo_id, tipo, id))) return res.status(403).send('Sem permissao para este arquivo.');
  const url = await gerarUrlInline(r.rows[0].arquivo_chave);
  res.redirect(url);
});

};
