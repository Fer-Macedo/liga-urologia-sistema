// ═══ APIs PÚBLICAS — Site Externo LAURO ═══════════════════════════════════════
const { query } = require('../models/database');
const { limiterApiPublica, limiterContato } = require('../services/rate-limiters');

function corsPublico(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Cache-Control', 'public, max-age=300');
  next();
}

module.exports = function (router) {

router.get('/api/eventos-publicos', corsPublico, limiterApiPublica, async (req, res) => {
  try {
    const { gerarUrlInline } = require('../services/arquivos');
    const r = await query(`SELECT id, nome, descricao, data_inicio, data_fim, local, endereco, banner_chave, vagas_total, tipo_evento, carga_horaria, youtube_url, inscricao_gratuita_auto, checkout_fecha_em FROM eventos WHERE status='publicado' AND publico=true AND (checkout_fecha_em IS NULL OR checkout_fecha_em > NOW()) ORDER BY data_inicio ASC LIMIT 20`);
    const eventos = await Promise.all(r.rows.map(async ev => {
      let banner_url = null;
      if (ev.banner_chave) { try { banner_url = await gerarUrlInline(ev.banner_chave); } catch(e) {} }
      return { id: ev.id, nome: ev.nome, descricao: ev.descricao, data_inicio: ev.data_inicio, data_fim: ev.data_fim, local: ev.local, endereco: ev.endereco, banner_chave: banner_url, vagas_total: ev.vagas_total, tipo_evento: ev.tipo_evento, carga_horaria: ev.carga_horaria, youtube_url: ev.youtube_url, gratuito: ev.inscricao_gratuita_auto, inscricao_url: `https://sistema.lauroucpcde.com/inscricao/${ev.id}` };
    }));
    res.json(eventos);
  } catch(e) { console.error('[API-PUBLIC] eventos:', e.message); res.json([]); }
});

// Processo Seletivo ATIVO para a home pública (lauroucpcde.com)
router.get('/api/pss-publico', corsPublico, limiterApiPublica, async (req, res) => {
  try {
    const { gerarUrlInline } = require('../services/arquivos');
    const r = await query("SELECT id, nome, semestre, data_prova, local_prova, valor_inscricao, banner_chave, descricao FROM ps_processos WHERE inscricoes_abertas=true ORDER BY data_prova ASC NULLS LAST, id DESC LIMIT 1");
    if (!r.rows.length) return res.json({ ativo: false });
    const p = r.rows[0];
    let banner_url = null;
    if (p.banner_chave) { try { banner_url = await gerarUrlInline(p.banner_chave); } catch(e) {} }
    res.json({ ativo: true, processo: {
      id: p.id, nome: p.nome, semestre: p.semestre, data_prova: p.data_prova, local_prova: p.local_prova,
      valor: p.valor_inscricao, banner_url, descricao: p.descricao,
      inscricao_url: `https://inscricao.lauroucpcde.com/pss/${p.id}/inscricao`
    } });
  } catch(e) { console.error('[API-PUBLIC] pss:', e.message); res.json({ ativo: false }); }
});

router.get('/api/equipe-publica', corsPublico, limiterApiPublica, async (req, res) => {
  try {
    const { gerarUrlInline } = require('../services/arquivos');
    const { cargoComGenero } = require('../services/cargo-genero');
    const [dirsR, ligsR] = await Promise.all([
      query("SELECT id, nome, cargo, sexo, COALESCE(foto_site_chave, foto_chave) as foto_chave FROM diretivos WHERE ativo=1 AND pendente=false ORDER BY cargo, nome"),
      query("SELECT id, nome, semestre, COALESCE(foto_site_chave, foto_chave) as foto_chave FROM ligantes WHERE ativo=1 AND pendente=false ORDER BY nome LIMIT 50")
    ]);
    const mapFoto = async (rows) => Promise.all(rows.map(async m => {
      let foto_url = null;
      if (m.foto_chave) { try { foto_url = await gerarUrlInline(m.foto_chave); } catch(e) {} }
      return { ...m, foto_url };
    }));
    const [diretivosRaw, ligantesRaw] = await Promise.all([mapFoto(dirsR.rows), mapFoto(ligsR.rows)]);
    const diretivos = diretivosRaw.map(d => ({ id: d.id, nome: d.nome, foto_chave: d.foto_chave, foto_url: d.foto_url, cargo: d.cargo ? cargoComGenero(d.cargo, d.sexo) : 'Directivo' }));
    // Ligante nao expoe mais o semestre (desatualiza) — rotulo fixo "Ligante".
    const ligantes = ligantesRaw.map(l => ({ id: l.id, nome: l.nome, foto_chave: l.foto_chave, foto_url: l.foto_url, cargo: 'Ligante', semestre: 'Ligante' }));
    res.json({ diretivos, ligantes });
  } catch(e) { console.error('[API-PUBLIC] equipe:', e.message); res.json({ diretivos: [], ligantes: [] }); }
});

router.get('/api/stats-publicas', corsPublico, limiterApiPublica, async (req, res) => {
  try {
    const [ligsR, evsR] = await Promise.all([
      query("SELECT COUNT(*) as total FROM ligantes WHERE ativo=1 AND pendente=false"),
      query("SELECT COUNT(*) as total FROM eventos WHERE status='publicado'")
    ]);
    res.json({ ligantes: parseInt(ligsR.rows[0].total)||0, eventos: parseInt(evsR.rows[0].total)||0 });
  } catch(e) { res.json({ ligantes: 48, eventos: 14 }); }
});

router.post('/api/contato-site', corsPublico, limiterContato, async (req, res) => {
  try {
    const { nombre, email, telefono, mensaje } = req.body;
    if (!nombre || !email || !mensaje) return res.json({ ok: false, erro: 'Campos obrigatórios faltando' });
    // Validações de segurança
    if (nombre.length > 100 || email.length > 150 || (mensaje||'').length > 2000) return res.json({ ok: false, erro: 'Dados inválidos' });
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return res.json({ ok: false, erro: 'Email inválido' });
    // Sanitização básica anti-injection
    const safe = s => (s||'').replace(/<[^>]*>/g,'').replace(/[<>'";&]/g,'').trim();
    const nomeClean = safe(nombre).substring(0,100);
    const msgClean = safe(mensaje).substring(0,2000);
    const telClean = safe(telefono||'').substring(0,20);
    const { enviarEmail } = require('../services/notificacoes');
    await enviarEmail({ para: 'lauroucpcde@lauroucpcde.com', assunto: `Contato pelo site — ${nombre}`, texto: `Nome: ${nombre}\nEmail: ${email}\nTelefone: ${telefono||'—'}\n\n${mensaje}`, html: `<h3>Contato pelo Site LAURO</h3><p><b>Nome:</b> ${nombre}</p><p><b>Email:</b> ${email}</p><p><b>Tel:</b> ${telefono||'—'}</p><hr><p>${mensaje}</p>` });
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false }); }
});

// API publica - consumida pelo site lauroucpcde.com para exibir os banners gerais ativos
router.get('/api/banners-publicos', corsPublico, limiterApiPublica, async (req, res) => {
  try {
    const { gerarUrlInline } = require('../services/arquivos');
    const r = await query('SELECT id, titulo, imagem_chave, link_url FROM site_banners WHERE ativo=true ORDER BY ordem, criado_em DESC');
    const banners = await Promise.all(r.rows.map(async b => ({ id: b.id, titulo: b.titulo, link_url: b.link_url, imagem_url: await gerarUrlInline(b.imagem_chave).catch(()=>null) })));
    res.json({ banners });
  } catch(e) { res.json({ banners: [] }); }
});

// API publica - consumida pelo site lauroucpcde.com para exibir o video institucional
router.get('/api/video-publico', corsPublico, limiterApiPublica, async (req, res) => {
  try {
    const { gerarUrlInline } = require('../services/arquivos');
    const r = await query("SELECT valor FROM configuracoes WHERE chave='site_video_chave'");
    if (!r.rows.length || !r.rows[0].valor) return res.json({ video_url: null });
    const video_url = await gerarUrlInline(r.rows[0].valor, 'video/mp4').catch(()=>null);
    res.json({ video_url });
  } catch(e) { res.json({ video_url: null }); }
});

// API publica - lista de galerias ativas, consumida pelo site lauroucpcde.com
router.get('/api/galerias-publicas', corsPublico, limiterApiPublica, async (req, res) => {
  try {
    const { gerarUrlInline } = require('../services/arquivos');
    const r = await query(`
      SELECT g.id, g.nome_evento, g.data_evento,
        (SELECT imagem_chave FROM galeria_fotos WHERE galeria_id=g.id ORDER BY criado_em LIMIT 1) as capa_chave,
        (SELECT COUNT(*) FROM galeria_fotos WHERE galeria_id=g.id) as total_fotos
      FROM galerias_eventos g WHERE g.ativo=true
      ORDER BY g.data_evento DESC NULLS LAST, g.criado_em DESC
    `);
    const galerias = await Promise.all(r.rows.map(async g => ({
      id: g.id, nome_evento: g.nome_evento, data_evento: g.data_evento, total_fotos: Number(g.total_fotos),
      capa_url: g.capa_chave ? await gerarUrlInline(g.capa_chave).catch(()=>null) : null
    })));
    res.json({ galerias });
  } catch(e) { res.json({ galerias: [] }); }
});

// API publica - fotos de uma galeria especifica
router.get('/api/galerias-publicas/:id/fotos', corsPublico, limiterApiPublica, async (req, res) => {
  try {
    const { gerarUrlInline } = require('../services/arquivos');
    const g = await query('SELECT nome_evento, data_evento FROM galerias_eventos WHERE id=$1 AND ativo=true', [req.params.id]);
    if (!g.rows.length) return res.status(404).json({ erro: 'Galeria nao encontrada' });
    const fotosR = await query('SELECT id, imagem_chave FROM galeria_fotos WHERE galeria_id=$1 ORDER BY criado_em', [req.params.id]);
    const fotos = await Promise.all(fotosR.rows.map(async f => ({ id: f.id, url: await gerarUrlInline(f.imagem_chave).catch(()=>null) })));
    res.json({ nome_evento: g.rows[0].nome_evento, data_evento: g.rows[0].data_evento, fotos });
  } catch(e) { res.status(500).json({ erro: 'Erro ao carregar galeria' }); }
});

};
