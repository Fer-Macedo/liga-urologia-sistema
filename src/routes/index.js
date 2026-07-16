const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const xss = require('xss');
const { enviarEmail, emailBonito } = require('../services/email');


const router = express.Router();

router.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-hashes'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com", "https://assets.pagseguro.com.br", "https://cdn.quilljs.com", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com", "https://cdn.quilljs.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://api.pagseguro.com", "https://graph.instagram.com"],
      frameSrc: ["'self'", "https://view.officeapps.live.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    }
  },
  crossOriginEmbedderPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// Rate limit geral
const limiterGeral = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  message: { erro: 'Muitas requisições. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: function(req){
    var p = req.path || '';
    // Pular rate limit para rotas publicas e para usuarios autenticados
    if (p.indexOf('/checkout') === 0 || p.indexOf('/inscricao') === 0 || p.indexOf('/webhook') === 0) return true;
    if (req.session && req.session.usuario) return true; // admin autenticado — sem limite
    return false;
  }
});

const { limiterApiPublica, limiterContato, limiterLogin, limiterCodigoRecuperacao, limiterEsqueciSenha, limiterPagamentoCartao } = require('../services/rate-limiters');
router.use(limiterGeral);

// Sanitiza inputs contra XSS — libera style/class (usado pelos editores de texto rico Quill)
// mantendo a sanitizacao de CSS do proprio pacote xss (bloqueia expression()/javascript: etc)
const xssRico = new xss.FilterXSS({
  css: { whiteList: { color: true, 'background-color': true, 'font-size': true, 'text-align': true, 'font-weight': true, 'font-style': true, 'text-decoration': true } },
  onIgnoreTagAttr: function(tag, name, value) {
    if (name === 'style' || name === 'class') return name + '="' + xss.escapeAttrValue(value) + '"';
  }
});
router.use((req, res, next) => {
  if (req.body) {
    for (const key in req.body) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = xssRico.process(req.body[key]);
      }
    }
  }
  next();
});
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const dayjs = require('dayjs');
const { query } = require('../models/database');
const { requireAuth, requireAdmin, requireFinanceiro, requireSecretaria, requirePermissao, requireMembro } = require('../middleware/auth');
const { criarCobranca, consultarPagamento, criarPixEvento, processarWebhook } = require('../services/pagbank');
const { confirmarInscricaoPss } = require('../services/pss');

// ─── LOG DE ATIVIDADES ───────────────────────────────────────────────────────
const { logAtividade } = require('../services/log-atividade');

const { getConfig } = require('../services/config');

// ─── PROTEÇÃO FORÇA BRUTA ─────────────────────────────────────────────────────
const tentativas = {};

function verificarBloqueio(ip) {
  const t = tentativas[ip];
  if (!t) return false;
  if (t.bloqueadoAte && new Date() < t.bloqueadoAte) return true;
  if (t.bloqueadoAte && new Date() >= t.bloqueadoAte) { delete tentativas[ip]; return false; }
  return false;
}

function registrarTentativa(ip) {
  if (!tentativas[ip]) tentativas[ip] = { count: 0 };
  tentativas[ip].count++;
  if (tentativas[ip].count >= 5) {
    tentativas[ip].bloqueadoAte = new Date(Date.now() + 15 * 60 * 1000);
    console.warn('IP bloqueado por tentativas: ' + ip);
  }
}

function limparTentativas(ip) { delete tentativas[ip]; }

// ─── TOKENS RECUPERAÇÃO SENHA ─────────────────────────────────────────────────
const tokensSenha = {}; // { token: { userId, expira } }

// ─── AUTH ─────────────────────────────────────────────────────────────────────

// ─── LANDING DESAFÍO RUN AZUL 2026 ────────────────────────────────────────────
router.use((req, res, next) => {
  if (req.hostname && req.hostname.startsWith('desafiorunazul') && req.path === '/') {
    return res.render('pages/desafio-azul');
  }
  next();
});

router.get('/desafio-azul', (req, res) => res.render('pages/desafio-azul'));

router.post('/desafio-azul/contato', limiterContato, async (req, res) => {
  try {
    const { nombre, empresa, cargo, telefono, whatsapp, email, plan, mensaje } = req.body;
    if (!nombre || !empresa || !whatsapp || !email) return res.json({ ok: false, erro: 'Campos obrigatórios faltando' });
    if (nombre.length > 150 || empresa.length > 150 || email.length > 150 || (mensaje||'').length > 2000) return res.json({ ok: false, erro: 'Dados inválidos' });
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return res.json({ ok: false, erro: 'Email inválido' });
    const safe = s => (s||'').replace(/<[^>]*>/g,'').replace(/[<>'";&]/g,'').trim();
    const nomeClean = safe(nombre).substring(0,150);
    const empresaClean = safe(empresa).substring(0,150);
    const cargoClean = safe(cargo||'').substring(0,100);
    const telClean = safe(telefono||'').substring(0,30);
    const waClean = safe(whatsapp).substring(0,30);
    const planClean = safe(plan||'').substring(0,100);
    const msgClean = safe(mensaje||'').substring(0,2000);

    await query(
      'INSERT INTO leads_patrocinio (nome, empresa, cargo, telefone, whatsapp, email, plano, mensagem) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [nomeClean, empresaClean, cargoClean, telClean, waClean, email, planClean, msgClean]
    );

    const { enviarEmail } = require('../services/notificacoes');
    await enviarEmail({
      para: 'lauroucpcde@lauroucpcde.com',
      assunto: `Nuevo lead de patrocinio — Desafío Run Azul 2026 — ${empresaClean}`,
      texto: `Nombre: ${nomeClean}\nEmpresa: ${empresaClean}\nCargo: ${cargoClean}\nTeléfono: ${telClean}\nWhatsApp: ${waClean}\nEmail: ${email}\nPlan: ${planClean}\n\nMensaje:\n${msgClean}`,
      html: `<h3>Nuevo lead de patrocinio — Desafío Run Azul 2026</h3><p><b>Nombre:</b> ${nomeClean}</p><p><b>Empresa:</b> ${empresaClean}</p><p><b>Cargo:</b> ${cargoClean||'—'}</p><p><b>Teléfono:</b> ${telClean||'—'}</p><p><b>WhatsApp:</b> ${waClean}</p><p><b>Email:</b> ${email}</p><p><b>Plan:</b> ${planClean||'—'}</p><hr><p>${msgClean}</p>`
    });

    res.json({ ok: true });
  } catch(e) { console.error('[DESAFIO-AZUL] contato:', e.message); res.json({ ok: false, erro: 'Erro ao processar solicitação' }); }
});

router.get('/', (req, res) => res.redirect('/dashboard'));

router.get('/login', async (req, res) => {
  if (req.session?.usuario) return res.redirect('/dashboard');
  res.render('pages/login', { config: await getConfig(), erro: req.flash('erro'), msg: req.flash('msg') });
});

router.post('/login', limiterLogin, async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;

  if (verificarBloqueio(ip)) {
    req.flash('erro', 'Muitas tentativas incorretas. Aguarde 15 minutos.');
    return res.redirect('/login');
  }

  const { email, senha } = req.body;

  if (!email || !senha || email.length > 100 || senha.length > 100) {
    req.flash('erro', 'Dados inválidos.');
    return res.redirect('/login');
  }

  const r = await query('SELECT * FROM usuarios WHERE email = $1 AND ativo = 1', [email.toLowerCase().trim()]);
  const usuario = r.rows[0];

  if (!usuario || !bcrypt.compareSync(senha, usuario.senha)) {
    registrarTentativa(ip);
    const t = tentativas[ip];
    const restantes = t ? Math.max(0, 5 - t.count) : 5;
    req.flash('erro', 'E-mail ou senha incorretos. ' + (restantes > 0 ? restantes + ' tentativas restantes.' : 'IP bloqueado por 15 minutos.'));
    return res.redirect('/login');
  }

  limparTentativas(ip);
  console.log('LOGIN: ' + usuario.email + ' | IP: ' + ip + ' | ' + new Date().toISOString());

  const dadosUsuario = { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil };

  req.session.regenerate(async (err) => {
    if (err) console.error('Session regenerate erro:', err);
    req.session.usuario = dadosUsuario;
    try {
      const pR = await query('SELECT modulo FROM usuario_permissoes WHERE usuario_id=$1', [usuario.id]);
      req.session.permissoesAtivas = pR.rows.map(r => r.modulo);
    } catch(e) { req.session.permissoesAtivas = []; }
    res.redirect('/dashboard');
  });
});

router.get('/api/pendentes', requireAuth, async (req, res) => {
  try {
    const [rD,rL] = await Promise.all([
      query('SELECT COUNT(*) n FROM diretivos WHERE pendente=true'),
      query('SELECT COUNT(*) n FROM ligantes WHERE pendente=true')
    ]);
    const nD=parseInt(rD.rows[0].n), nL=parseInt(rL.rows[0].n);
    const count0=nD+nL, itens=[];
    if(nD>0) itens.push({tipo:'diretivo',label:nD+' diretivo'+(nD>1?'s':'')+' aguardando aprovacao',url:'/diretivos?status=pendente'});
    if(nL>0) itens.push({tipo:'ligante',label:nL+' ligante'+(nL>1?'s':'')+' aguardando aprovacao',url:'/ligantes?status=pendente'});

    // Trabalhos cientificos aguardando revisao/decisao - so aparece para quem tem acesso
    // ao modulo (permissao cientifico, presidencia ou admin).
    // "Aguardando" (ninguem pegou ainda) conta para TODOS - e uma pendencia coletiva.
    // "Em revisao" so conta para quem esta revisando (revisor_atual_id) - uma vez que
    // alguem clica "Revisar", deixa de ser pendencia pros outros, pois ja esta sob controle.
    let count = count0;
    const perfil = req.session.usuario.perfil;
    let temAcessoCientifico = perfil==='presidencia' || perfil==='admin';
    if (!temAcessoCientifico) {
      const pr = await query("SELECT 1 FROM usuario_permissoes WHERE usuario_id=$1 AND modulo='cientifico'", [req.session.usuario.id]);
      temAcessoCientifico = pr.rows.length > 0;
    }
    if (temAcessoCientifico) {
      const [aR, rR] = await Promise.all([
        query("SELECT COUNT(*) n FROM versoes_trabalho WHERE status='aguardando'"),
        query("SELECT COUNT(*) n FROM versoes_trabalho WHERE status='em_revisao' AND revisor_atual_id=$1", [req.session.usuario.id])
      ]);
      const nAguardando = parseInt(aR.rows[0].n), nComigo = parseInt(rR.rows[0].n);
      if (nAguardando > 0) {
        count += nAguardando;
        itens.push({tipo:'cientifico',label:nAguardando+' trabalho'+(nAguardando>1?'s':'')+' aguardando alguem assumir a correcao',url:'/cientifico/pendencias'});
      }
      if (nComigo > 0) {
        count += nComigo;
        itens.push({tipo:'cientifico',label:nComigo+' trabalho'+(nComigo>1?'s':'')+' que voce esta revisando',url:'/cientifico/pendencias'});
      }
    }
    res.json({count,itens});
  } catch(e){ res.json({count:0,itens:[]}); }
});

router.get('/logout', (req, res) => {
  console.log('LOGOUT: ' + (req.session?.usuario?.email || '?') + ' | ' + new Date().toISOString());
  req.session.destroy();
  res.redirect('/login');
});

// ─── RECUPERAÇÃO DE SENHA ─────────────────────────────────────────────────────

router.get('/recuperar-senha', async (req, res) => {
  res.render('pages/recuperar-senha', {
    config: await getConfig(), enviado: false,
    msg: req.flash('msg'), erro: req.flash('erro')
  });
});

router.post('/recuperar-senha', async (req, res) => {
  const config = await getConfig();
  const email = (req.body.email || '').toLowerCase().trim();
  const r = await query('SELECT * FROM usuarios WHERE email=$1 AND ativo=1', [email]);
  const usuario = r.rows[0];

  if (usuario) {
    const token = crypto.randomBytes(32).toString('hex');
    tokensSenha[token] = { userId: usuario.id, expira: new Date(Date.now() + 30 * 60 * 1000) };

    const { enviarEmail } = require('../services/notificacoes');
    const appUrl = process.env.APP_URL || 'https://liga-urologia.onrender.com';
    const link = appUrl + '/nova-senha?token=' + token;
    const orgNome = config.org_nome || 'Liga Academica de Urologia';

    await enviarEmail({
      para: usuario.email,
      assunto: 'Recuperação de senha — ' + orgNome,
      texto: 'Clique no link para redefinir sua senha:\n' + link + '\n\nExpira em 30 minutos.',
      faixaLabel: 'RECUPERAÇÃO DE SENHA',
      html: '<h2 style="margin:0 0 16px">Recuperação de senha</h2><p style="color:#444;margin:0 0 24px">Olá, <strong>' + usuario.nome + '</strong>!<br><br>Clique no botão abaixo para criar uma nova senha:</p><div style="text-align:center;margin:24px 0"><a href="' + link + '" style="display:inline-block;background:#1a56db;color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold">🔒 Redefinir minha senha</a></div><p style="color:#888;font-size:12px">Este link expira em <strong>30 minutos</strong>.<br>Se não solicitou, ignore este e-mail.</p>'
    });

    console.log('RECUPERACAO SENHA: ' + email + ' | ' + new Date().toISOString());
  }

  res.render('pages/recuperar-senha', { config, enviado: true, msg: [], erro: [] });
});

router.get('/nova-senha', async (req, res) => {
  const config = await getConfig();
  const token = req.query.token || '';
  const dados = tokensSenha[token];
  const tokenValido = !!(dados && new Date() < dados.expira);
  res.render('pages/nova-senha', { config, token, tokenValido, erro: req.flash('erro') });
});

router.post('/nova-senha', async (req, res) => {
  const config = await getConfig();
  const { token, nova_senha, confirmar_senha } = req.body;
  const dados = tokensSenha[token];

  if (!dados || new Date() > dados.expira) {
    req.flash('erro', 'Link expirado ou inválido. Solicite um novo.');
    return res.redirect('/recuperar-senha');
  }
  if (nova_senha !== confirmar_senha) {
    return res.render('pages/nova-senha', { config, token, tokenValido: true, erro: ['As senhas não coincidem.'] });
  }
  if (nova_senha.length < 8) {
    return res.render('pages/nova-senha', { config, token, tokenValido: true, erro: ['A senha deve ter pelo menos 8 caracteres.'] });
  }

  await query('UPDATE usuarios SET senha=$1 WHERE id=$2', [bcrypt.hashSync(nova_senha, 10), dados.userId]);
  delete tokensSenha[token];

  console.log('SENHA REDEFINIDA: userId ' + dados.userId + ' | ' + new Date().toISOString());
  req.flash('msg', 'Senha redefinida com sucesso! Faça login com a nova senha.');
  res.redirect('/login');
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════
// APIs PÚBLICAS — Site Externo LAURO
// ═══════════════════════════════════════════════════════

// Monta o painel de numeros/lista especifico da area do usuario, reaproveitando as mesmas
// consultas que a propria tela daquela area ja usa - Ensino/Extensao (projetos_academicos),
// Cientifico (projetos/grupos/versoes) e Marketing (marketing_posts). Cada perfil sem acesso
// financeiro ve os numeros do que ele de fato acompanha, em vez de ficar sem nada relevante.
async function montarAreaEspecifica(perfil) {
  if (perfil === 'ensino' || perfil === 'extensao') {
    const statusR = await query('SELECT status, COUNT(*) n FROM projetos_academicos WHERE tipo=$1 GROUP BY status', [perfil]);
    const porStatus = {};
    statusR.rows.forEach(r => { porStatus[r.status] = parseInt(r.n); });
    const total = Object.values(porStatus).reduce((a, b) => a + b, 0);
    const pendentes = (porStatus.pendente||0) + (porStatus.liberado||0) + (porStatus.revisao||0);
    const andamento = (porStatus.aprovado||0) + (porStatus.andamento||0);
    const concluidos = porStatus.concluido || 0;
    const listaR = await query('SELECT id, nome, status FROM projetos_academicos WHERE tipo=$1 ORDER BY id DESC LIMIT 5', [perfil]);
    return {
      titulo: perfil === 'ensino' ? 'Projetos de Ensino' : 'Projetos de Extensão',
      link: '/' + perfil,
      cards: [
        { label: 'Total de Projetos', value: total, sub: 'cadastrados' },
        { label: 'Pendentes', value: pendentes, sub: 'aguardando aprovação' },
        { label: 'Em Andamento', value: andamento, sub: 'aprovados/em execução' },
        { label: 'Concluídos', value: concluidos, sub: 'finalizados' },
      ],
      listaTitulo: 'Projetos Recentes',
      itens: listaR.rows.map(r => ({ titulo: r.nome, sub: r.status }))
    };
  }
  if (perfil === 'cientifico') {
    const [projR, gruposR, aguardR, aprovR, listaR] = await Promise.all([
      query('SELECT COUNT(*) n FROM projetos_cientificos'),
      query('SELECT COUNT(*) n FROM grupos_cientificos'),
      query("SELECT COUNT(*) n FROM versoes_trabalho WHERE status IN ('aguardando','em_revisao')"),
      query("SELECT COUNT(*) n FROM versoes_trabalho WHERE status='aprovado'"),
      query('SELECT id, titulo FROM projetos_cientificos ORDER BY criado_em DESC LIMIT 5')
    ]);
    return {
      titulo: 'Portal Científico',
      link: '/cientifico',
      cards: [
        { label: 'Projetos Criados', value: projR.rows[0].n, sub: 'no total' },
        { label: 'Grupos', value: gruposR.rows[0].n, sub: 'formados' },
        { label: 'Aguardando Revisão', value: aguardR.rows[0].n, sub: 'trabalhos enviados' },
        { label: 'Aprovados', value: aprovR.rows[0].n, sub: 'trabalhos concluídos' },
      ],
      listaTitulo: 'Projetos Recentes',
      itens: listaR.rows.map(r => ({ titulo: r.titulo, sub: '' }))
    };
  }
  if (perfil === 'marketing') {
    const statusR = await query('SELECT status, COUNT(*) n FROM marketing_posts GROUP BY status');
    const porStatus = {};
    statusR.rows.forEach(r => { porStatus[r.status] = parseInt(r.n); });
    const total = Object.values(porStatus).reduce((a, b) => a + b, 0);
    const listaR = await query('SELECT id, titulo, status FROM marketing_posts ORDER BY criado_em DESC LIMIT 5');
    return {
      titulo: 'Marketing',
      link: '/marketing',
      cards: [
        { label: 'Total de Posts', value: total, sub: 'criados' },
        { label: 'Rascunhos', value: porStatus.rascunho||0, sub: 'não agendados' },
        { label: 'Agendados', value: porStatus.agendado||0, sub: 'aguardando publicação' },
        { label: 'Publicados', value: porStatus.publicado||0, sub: 'no ar' },
      ],
      listaTitulo: 'Posts Recentes',
      itens: listaR.rows.map(r => ({ titulo: r.titulo || '(sem título)', sub: r.status }))
    };
  }
  return null;
}

router.get('/dashboard', requireAuth, async (req, res) => {
  const config = await getConfig();
  const hoje = dayjs();
  const mes = hoje.format('YYYY-MM');
  const mesStr = '%-' + mes;
  const perfil = req.session.usuario.perfil;

  // Dados financeiros (inadimplencia, receita, pagamentos) so fazem sentido para quem
  // realmente acompanha as financas da Liga - os demais perfis veem o painel da propria area.
  const verFinanceiro = ['admin', 'presidencia', 'secretaria', 'financeiro'].includes(perfil);

  const consultas = [
    query("SELECT COUNT(*) n FROM membros WHERE ativo=1"),
    query("SELECT * FROM (SELECT nome, whatsapp, data_nascimento::text, TO_CHAR(data_nascimento::date,'MM-DD') as aniv, 'membro' as tipo FROM membros WHERE ativo=1 AND data_nascimento IS NOT NULL UNION ALL SELECT nome, whatsapp, data_nascimento::text, TO_CHAR(data_nascimento::date,'MM-DD') as aniv, 'diretivo' as tipo FROM diretivos WHERE ativo=1 AND data_nascimento IS NOT NULL) t ORDER BY CASE WHEN aniv >= TO_CHAR(NOW() AT TIME ZONE 'America/Sao_Paulo','MM-DD') THEN 0 ELSE 1 END, aniv LIMIT 8")
  ];
  if (verFinanceiro) {
    consultas.push(
      query("SELECT COUNT(*) n FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='pago' AND c.referencia LIKE $1 AND m.ativo=1", [mesStr]),
      query("SELECT COUNT(*) n FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='pendente' AND c.referencia LIKE $1 AND m.ativo=1 AND c.data_vencimento::date >= CURRENT_DATE", [mesStr]),
      query("SELECT COUNT(*) n FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE (c.status='atrasado' OR (c.status='pendente' AND c.data_vencimento::date < CURRENT_DATE)) AND m.ativo=1"),
      query("SELECT COALESCE(SUM(COALESCE(valor_pago,valor_desconto)),0) v FROM cobrancas WHERE status='pago' AND referencia LIKE $1", [mesStr]),
      query("SELECT COALESCE(SUM(c.valor_cheio),0) v FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='pendente' AND c.referencia LIKE $1 AND m.ativo=1 AND c.data_vencimento::date >= CURRENT_DATE", [mesStr]),
      query("SELECT COALESCE(SUM(c.valor_cheio),0) v FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE (c.status='atrasado' OR (c.status='pendente' AND c.data_vencimento::date < CURRENT_DATE)) AND m.ativo=1"),
      query("SELECT c.*, m.nome FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='pago' ORDER BY c.data_pagamento DESC LIMIT 8")
    );
  } else {
    // Sem acesso financeiro: mostra os proximos eventos no lugar, se tiver permissao pra isso.
    const temEventos = perfil === 'admin' || (req.session.permissoesAtivas || []).includes('eventos');
    consultas.push(temEventos
      ? query("SELECT id, nome, data_inicio, local FROM eventos WHERE data_inicio >= NOW() ORDER BY data_inicio ASC LIMIT 5")
      : Promise.resolve({ rows: [] })
    );
  }

  const [resultados, areaEspecifica] = await Promise.all([
    Promise.all(consultas),
    verFinanceiro ? Promise.resolve(null) : montarAreaEspecifica(perfil)
  ]);
  const [total, aniversariantes] = resultados;

  let stats = { total: total.rows[0].n, pagos: 0, pendentes: 0, atrasados: 0, totalRecebido: 0, totalPendente: 0, totalAtrasado: 0 };
  let recentes = [], proximosEventos = [];
  if (verFinanceiro) {
    const [pagos, pendentes, atrasados, recTot, pendTot, atrTot, recentesR] = resultados.slice(2);
    stats = {
      total: total.rows[0].n, pagos: pagos.rows[0].n, pendentes: pendentes.rows[0].n,
      atrasados: atrasados.rows[0].n, totalRecebido: recTot.rows[0].v,
      totalPendente: pendTot.rows[0].v, totalAtrasado: atrTot.rows[0].v
    };
    recentes = recentesR.rows;
  } else if (!areaEspecifica) {
    proximosEventos = resultados[2].rows;
  }

  res.render('pages/dashboard', {
    config, usuario: req.session.usuario, stats, verFinanceiro, areaEspecifica,
    recentes, aniversariantes: aniversariantes.rows, proximosEventos,
    dayjs, msg: req.flash('msg'), erro: req.flash('erro')
  });
});

// ─── MEMBROS ──────────────────────────────────────────────────────────────────

router.get('/membros', requireAuth, requirePermissao('membros'), async (req, res) => {
  const config = await getConfig();
  const filtro = req.query.filtro || 'todos';
  let where = '';
  if (filtro === 'ativos') where = 'WHERE m.ativo=1';
  else if (filtro === 'inativos') where = 'WHERE m.ativo=0';
  const [membros, statsR] = await Promise.all([
    query('SELECT m.*, CASE WHEN m.ativo=0 THEN \'cancelado\' WHEN EXISTS(SELECT 1 FROM cobrancas WHERE membro_id=m.id AND status=\'atrasado\') THEN \'atrasado\' WHEN EXISTS(SELECT 1 FROM cobrancas WHERE membro_id=m.id AND status IN (\'pago\',\'em_dia\') AND referencia LIKE \'%-\'||TO_CHAR(NOW(),\'YYYY-MM\')) THEN \'pago\' ELSE \'pendente\' END as ultimo_status FROM membros m ' + where + ' ORDER BY m.nome'),
    query(`SELECT
      COUNT(*) as total,
      SUM(CASE WHEN m.ativo=1 THEN 1 ELSE 0 END) as ativos,
      SUM(CASE WHEN m.ativo=0 THEN 1 ELSE 0 END) as inativos,
      SUM(CASE WHEN m.ativo=1 AND EXISTS(SELECT 1 FROM cobrancas WHERE membro_id=m.id AND status IN ('pago','em_dia') AND referencia LIKE '%-'||TO_CHAR(NOW(),'YYYY-MM')) THEN 1 ELSE 0 END) as em_dia,
      SUM(CASE WHEN m.ativo=1 AND EXISTS(SELECT 1 FROM cobrancas WHERE membro_id=m.id AND status='atrasado' AND membro_id IN (SELECT id FROM membros WHERE ativo=1)) THEN 1 ELSE 0 END) as atrasados
      FROM membros m`)
  ]);
  const st = statsR.rows[0];
  res.render('pages/membros', {
    config, usuario: req.session.usuario, membros: membros.rows, filtro,
    msg: req.flash('msg'), erro: req.flash('erro'),
    total: parseInt(st.total)||0,
    ativos: parseInt(st.ativos)||0,
    inativos: parseInt(st.inativos)||0,
    emDia: parseInt(st.em_dia)||0,
    atrasados: parseInt(st.atrasados)||0
  });
});

router.post('/membros', requireAuth, requireFinanceiro, async (req, res) => {
  const { nome, cpf, email, whatsapp, data_nascimento, dia_vencimento, mensalidade, desconto_pontualidade, observacoes } = req.body;
  await query(
    'INSERT INTO membros (nome,cpf,email,whatsapp,data_nascimento,dia_vencimento,mensalidade,desconto_pontualidade,observacoes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [nome, cpf||null, email||null, whatsapp||null, data_nascimento||null, parseInt(dia_vencimento)||15, parseFloat(mensalidade)||25, parseFloat(desconto_pontualidade)||20, observacoes||null]
  );
  req.flash('msg', 'Membro ' + nome + ' cadastrado!');
  res.redirect('/membros');
});

router.get('/membros/:id/editar', requireAuth, requireFinanceiro, async (req, res) => {
  const config = await getConfig();
  const r = await query('SELECT * FROM membros WHERE id=$1', [req.params.id]);
  const membro = r.rows[0];
  if (!membro) return res.redirect('/membros');
  res.render('pages/membro-editar', { config, usuario: req.session.usuario, membro, msg: req.flash('msg'), erro: req.flash('erro') });
});

router.post('/membros/:id/editar', requireAuth, requireFinanceiro, async (req, res) => {
  const { nome, cpf, email, whatsapp, data_nascimento, dia_vencimento, mensalidade, desconto_pontualidade, ativo, observacoes, motivo_inativacao } = req.body;
  const membroAtual = await query('SELECT ativo FROM membros WHERE id=$1', [req.params.id]);
  const eraAtivo = membroAtual.rows[0]?.ativo;
  const novoAtivo = (ativo === '1' || ativo === 1) ? 1 : 0;
  await query(
    'UPDATE membros SET nome=$1,cpf=$2,email=$3,whatsapp=$4,data_nascimento=$5,dia_vencimento=$6,mensalidade=$7,desconto_pontualidade=$8,ativo=$9,observacoes=$10 WHERE id=$11',
    [nome, cpf||null, email||null, whatsapp||null, data_nascimento||null, parseInt(dia_vencimento)||15, parseFloat(mensalidade)||25, parseFloat(desconto_pontualidade)||20, novoAtivo, observacoes||null, req.params.id]
  );
  if (eraAtivo == 1 && novoAtivo === 0) {
    await query("UPDATE cobrancas SET status='cancelado' WHERE membro_id=$1 AND status IN ('pendente','atrasado')", [req.params.id]);
    if (motivo_inativacao) {
      await query('INSERT INTO inativacoes_log (tipo, referencia_id, motivo, usuario_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', ['membro', req.params.id, motivo_inativacao, req.session.usuario.id]).catch(()=>{});
    }
  }
  req.flash('msg', novoAtivo === 0 ? 'Membro inativado e cobranças pendentes canceladas!' : 'Membro atualizado!');
  res.redirect('/membros');
});

// ─── COBRANÇAS ─────────────────────────────────────────────────────────────────

router.get('/cobrancas', requireAuth, requirePermissao('cobrancas'), async (req, res) => {
  const config = await getConfig();
  const filtro = req.query.filtro || 'todas';
  const periodo = req.query.periodo || 'mes';
  const dataInicio = req.query.data_inicio || null;
  const dataFim = req.query.data_fim || null;
  const hoje = dayjs();

  let dtInicio, dtFim;
  if (dataInicio && dataFim) {
    // Reformata via dayjs para YYYY-MM-DD canonico — impede SQL injection na
    // interpolacao de periodoWhere (a saida de .format() e sempre uma data limpa).
    const di = dayjs(dataInicio), df = dayjs(dataFim);
    if (di.isValid() && df.isValid()) {
      dtInicio = di.format('YYYY-MM-DD'); dtFim = df.format('YYYY-MM-DD');
    } else {
      dtInicio = hoje.startOf('month').format('YYYY-MM-DD');
      dtFim = hoje.endOf('month').format('YYYY-MM-DD');
    }
  } else if (periodo === '30') {
    dtInicio = hoje.subtract(30,'day').format('YYYY-MM-DD'); dtFim = hoje.format('YYYY-MM-DD');
  } else if (periodo === '60') {
    dtInicio = hoje.subtract(60,'day').format('YYYY-MM-DD'); dtFim = hoje.format('YYYY-MM-DD');
  } else if (periodo === '90') {
    dtInicio = hoje.subtract(90,'day').format('YYYY-MM-DD'); dtFim = hoje.format('YYYY-MM-DD');
  } else if (periodo === '120') {
    dtInicio = hoje.subtract(120,'day').format('YYYY-MM-DD'); dtFim = hoje.format('YYYY-MM-DD');
  } else if (periodo === 'todos') {
    dtInicio = null; dtFim = null;
  } else {
    dtInicio = hoje.startOf('month').format('YYYY-MM-DD');
    dtFim = hoje.endOf('month').format('YYYY-MM-DD');
  }

  const periodoWhere = dtInicio && dtFim
    ? ` AND c.data_vencimento::date BETWEEN '${dtInicio}' AND '${dtFim}'`
    : '';

  const [tPagas, tPendentes, tAtrasadas, tTodas] = await Promise.all([
    query(`SELECT COUNT(*) n, COALESCE(SUM(c.valor_desconto),0) soma FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='pago' AND m.ativo=1${periodoWhere}`),
    query(`SELECT COUNT(*) n FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='pendente' AND m.ativo=1${periodoWhere}`),
    query(`SELECT COUNT(*) n FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='atrasado' AND m.ativo=1${periodoWhere}`),
    query(`SELECT COUNT(*) n FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE m.ativo=1${periodoWhere}`),
  ]);

  const membroId = req.query.membro ? parseInt(req.query.membro) : null;
  const busca = (req.query.busca || '').trim();
  // Busca por nome do membro ignora o filtro de periodo - o historico completo (pago/cancelado/etc)
  // deve aparecer independente do mes selecionado, senao some quando a pessoa foi reativada
  // e nao tem cobranca no periodo atual.
  let whereClause = busca ? 'm.ativo=1' : `m.ativo=1${periodoWhere}`;
  if (membroId) whereClause = `c.membro_id=${membroId}${periodoWhere}`;
  if (busca) whereClause += ' AND m.nome ILIKE $1';
  if (filtro === 'pagas') whereClause += " AND c.status='pago'";
  else if (filtro === 'pendentes') whereClause += " AND c.status='pendente'";
  else if (filtro === 'atrasadas') whereClause += " AND c.status='atrasado'";

  const [r, membroR] = await Promise.all([
    busca
      ? query(`SELECT c.*, m.nome, m.whatsapp, m.email FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE ${whereClause} ORDER BY c.data_vencimento DESC, m.nome ASC LIMIT 500`, ['%'+busca+'%'])
      : query(`SELECT c.*, m.nome, m.whatsapp, m.email FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE ${whereClause} ORDER BY c.data_vencimento DESC, m.nome ASC LIMIT 500`),
    membroId ? query('SELECT nome FROM membros WHERE id=$1', [membroId]) : Promise.resolve({ rows: [] })
  ]);
  const membroFiltro = membroR.rows[0] || null;
  res.render('pages/cobrancas', {
    config, usuario: req.session.usuario, cobrancas: r.rows, filtro, dayjs,
    msg: req.flash('msg'), erro: req.flash('erro'),
    totalPagas: parseInt(tPagas.rows[0].n), somaPagas: parseFloat(tPagas.rows[0].soma),
    totalPendentes: parseInt(tPendentes.rows[0].n),
    totalAtrasadas: parseInt(tAtrasadas.rows[0].n),
    totalTodas: parseInt(tTodas.rows[0].n),
    membroId: membroId || null, membroFiltro, busca,
    periodo, dtInicio: dtInicio||'', dtFim: dtFim||'',
    dataInicio: dataInicio||'', dataFim: dataFim||'',
  });
});

router.post('/cobrancas/:id/confirmar', requireAuth, requireFinanceiro, async (req, res) => {
  try {
    const metodo = ['pix','cartao','dinheiro'].includes(req.body.metodo) ? req.body.metodo : 'pix';
    await query("UPDATE cobrancas SET status='pago', data_pagamento=NOW(), metodo_pagamento=COALESCE(metodo_pagamento,$2), valor_pago=COALESCE(valor_pago, CASE WHEN data_vencimento::date >= CURRENT_DATE THEN valor_desconto ELSE valor_cheio END) WHERE id=$1 AND status!='pago'", [req.params.id, metodo]);
    try { const { lancarMensalidadeNoFluxo } = require('../services/fluxo-mensalidade'); await lancarMensalidadeNoFluxo(query, req.params.id); } catch(e) { console.error('lancar fluxo (baixa manual):', e.message); }
    req.session.msg = ['Pagamento confirmado manualmente!'];
  } catch(e) { req.session.erro = ['Erro ao confirmar: '+e.message]; }
  const ref = req.headers.referer || '/cobrancas';
  res.redirect(ref);
});

router.post('/cobrancas/:id/pago', requireAuth, requireFinanceiro, async (req, res) => {
  await query("UPDATE cobrancas SET status='pago', data_pagamento=NOW(), metodo_pagamento=COALESCE(metodo_pagamento,'pix'), valor_pago=COALESCE(valor_pago, CASE WHEN data_vencimento::date >= CURRENT_DATE THEN valor_desconto ELSE valor_cheio END) WHERE id=$1", [req.params.id]);
  try { const { lancarMensalidadeNoFluxo } = require('../services/fluxo-mensalidade'); await lancarMensalidadeNoFluxo(query, req.params.id); } catch(e) { console.error('lancar fluxo (baixa manual 2):', e.message); }
  req.flash('msg', 'Pagamento registrado!');
  res.redirect('/cobrancas');
});

router.post('/cobrancas/gerar', requireAuth, requireFinanceiro, async (req, res) => {
  const { gerarCobrancasMes } = require('../services/agendamentos');
  await gerarCobrancasMes();
  req.flash('msg', 'Cobranças do mês geradas!');
  res.redirect('/cobrancas');
});

router.post('/cobrancas/nova', requireAuth, requireFinanceiro, async (req, res) => {
  const { membro_id, referencia, valor_cheio, valor_desconto, data_vencimento } = req.body;
  const mr = await query('SELECT * FROM membros WHERE id=$1', [membro_id]);
  const membro = mr.rows[0];
  if (!membro) { req.flash('erro', 'Membro não encontrado'); return res.redirect('/cobrancas'); }
  const existe = await query('SELECT id FROM cobrancas WHERE referencia=$1', [referencia]);
  if (existe.rows.length > 0) { req.flash('erro', 'Já existe uma cobrança com essa referência ("' + referencia + '")'); return res.redirect('/cobrancas'); }
  const pag = await criarCobranca({ membro, valor: parseFloat(valor_desconto), vencimento: data_vencimento, referencia });
  await query(
    'INSERT INTO cobrancas (membro_id,referencia,valor_cheio,valor_desconto,data_vencimento,pagbank_charge_id,pagbank_link) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [membro_id, referencia, parseFloat(valor_cheio), parseFloat(valor_desconto), data_vencimento, pag.charge_id||null, pag.link||null]
  );
  req.flash('msg', 'Cobrança criada!');
  res.redirect('/cobrancas');
});

// ─── ANIVERSÁRIOS ─────────────────────────────────────────────────────────────

router.get('/aniversarios', requireAuth, requirePermissao('aniversarios'), async (req, res) => {
  const config = await getConfig();
  const hoje = dayjs().format('MM-DD');
  const r = await query(
    "SELECT * FROM (SELECT id, nome, whatsapp, data_nascimento::text, TO_CHAR(data_nascimento::date,'MM-DD') as md, TO_CHAR(data_nascimento::date,'MM-DD') as aniv, 'ligante' as tipo, foto_chave FROM ligantes WHERE ativo=1 AND data_nascimento IS NOT NULL UNION ALL SELECT id, nome, whatsapp, data_nascimento::text, TO_CHAR(data_nascimento::date,'MM-DD') as md, TO_CHAR(data_nascimento::date,'MM-DD') as aniv, 'diretivo' as tipo, foto_chave FROM diretivos WHERE ativo=1 AND data_nascimento IS NOT NULL) t ORDER BY md"
  );
  res.render('pages/aniversarios', { config, usuario: req.session.usuario, aniversariantes: r.rows, hoje, dayjs, msg: req.flash('msg') });
});

// ─── NOTIFICAÇÕES ──────────────────────────────────────────────────────────────

router.get('/notificacoes', requireAuth, requirePermissao('notificacoes'), async (req, res) => {
  res.render('pages/notificacoes', { config: await getConfig(), usuario: req.session.usuario, msg: req.flash('msg') });
});

router.post('/notificacoes', requireAuth, requireAdmin, async (req, res) => {
  const campos = ['notif_pre_ativo','notif_dia_ativo','notif_aniversario_ativo','notif_atrasados_diario',
    'msg_cobranca_pre','msg_cobranca_dia','msg_cobranca_pos','msg_aniversario'];
  for (const c of campos) {
    const val = req.body[c] !== undefined ? (req.body[c] === 'on' ? '1' : req.body[c]) : '0';
    await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', [c, val]);
  }
  req.flash('msg', 'Configurações salvas!');
  res.redirect('/notificacoes');
});

// ─── CONFIGURAÇÕES ─────────────────────────────────────────────────────────────

router.get('/configuracoes', requireAuth, requirePermissao('configuracoes'), async (req, res) => {
  res.render('pages/configuracoes', { config: await getConfig(), usuario: req.session.usuario, msg: req.flash('msg'), erro: req.flash('erro') });
});

router.post('/configuracoes', requireAuth, requireAdmin, async (req, res) => {
  const {upload:upCfg, uploadArquivo:upArqCfg} = require('../services/arquivos');
  // O multer processa o multipart/form-data. SÓ DEPOIS dele o req.body fica preenchido.
  upCfg.fields([{name:'assinatura_presidente'},{name:'assinatura_vicepresidente'},{name:'assinatura_secretario'},{name:'assinatura_financeiro'},{name:'assinatura_director_ensino'},{name:'assinatura_director_extension'},{name:'timbrado'}])(req, res, async(err)=>{
    try {
      if (err) { req.flash('erro','Error al subir archivo: '+err.message); return res.redirect('/configuracoes'); }
      const camposCheckbox = ['notif_pre_ativo','notif_dia_ativo','notif_aniversario_ativo','notif_atrasados_diario'];
      const ignorar = ['_csrf'];
      // Salva DINAMICAMENTE qualquer campo de texto (escalável p/ outras ligas)
      for (const chave of Object.keys(req.body || {})) {
        if (ignorar.includes(chave)) continue;
        let val = req.body[chave];
        if (Array.isArray(val)) val = val[val.length - 1];
        if (camposCheckbox.includes(chave)) { val = (val === 'on' || val === '1') ? '1' : '0'; }
        await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', [chave, val]);
      }
      // Checkboxes desmarcados (não enviados) viram '0'
      for (const c of camposCheckbox) {
        if (req.body[c] === undefined) {
          await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', [c, '0']);
        }
      }
      // Uploads de arquivos
      for(const campo of ['assinatura_presidente','assinatura_vicepresidente','assinatura_secretario','assinatura_financeiro','assinatura_director_ensino','assinatura_director_extension','timbrado']){
        if(req.files && req.files[campo] && req.files[campo][0]){
          const ff=req.files[campo][0];
          const r=await upArqCfg(ff.buffer,ff.originalname,ff.mimetype,campo);
          await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2',[campo+'_chave',r.chave]);
        }
      }
      req.flash('msg', 'Configurações salvas!');
      res.redirect('/configuracoes');
    } catch(e) { console.error('salvar config:', e); req.flash('erro', e.message); res.redirect('/configuracoes'); }
  });
});

router.post('/configuracoes/logo-url', requireAuth, requireAdmin, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.json({ ok: false });
  await query("INSERT INTO configuracoes (chave,valor) VALUES ('org_logo',$1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [url]);
  res.json({ ok: true });
});

// ─── USUÁRIOS ──────────────────────────────────────────────────────────────────

router.post('/usuarios/:id/toggle', requireAuth, requireAdmin, async (req, res) => {
  const r = await query('SELECT * FROM usuarios WHERE id=$1', [req.params.id]);
  const u = r.rows[0];
  if (u && u.perfil !== 'admin') {
    await query('UPDATE usuarios SET ativo=$1 WHERE id=$2', [u.ativo ? 0 : 1, u.id]);
  }
  res.redirect('/usuarios');
});

router.post('/usuarios/:id/senha', requireAuth, requireAdmin, async (req, res) => {
  const hash = bcrypt.hashSync(req.body.nova_senha, 10);
  await query('UPDATE usuarios SET senha=$1 WHERE id=$2', [hash, req.params.id]);
  req.flash('msg', 'Senha alterada!');
  res.redirect('/usuarios');
});

router.post('/usuarios/:id/telefone', requireAuth, requireAdmin, async (req, res) => {
  await query('UPDATE usuarios SET telefone=$1 WHERE id=$2', [req.body.telefone || null, req.params.id]);
  req.flash('msg', 'Telefone atualizado!');
  res.redirect('/usuarios');
});

// ─── MEU PERFIL ───────────────────────────────────────────────────────────────

router.post('/minha-senha', requireAuth, async (req, res) => {
  const { senha_atual, nova_senha, confirmar_senha } = req.body;

  if (!nova_senha || nova_senha.length < 8) {
    req.flash('erro', 'A nova senha deve ter pelo menos 8 caracteres.');
    return res.redirect('/dashboard');
  }
  if (nova_senha !== confirmar_senha) {
    req.flash('erro', 'A nova senha e a confirmação não coincidem.');
    return res.redirect('/dashboard');
  }

  const r = await query('SELECT * FROM usuarios WHERE id=$1', [req.session.usuario.id]);
  const usuario = r.rows[0];

  if (!usuario || !bcrypt.compareSync(senha_atual, usuario.senha)) {
    req.flash('erro', 'Senha atual incorreta.');
    return res.redirect('/dashboard');
  }

  const novoHash = bcrypt.hashSync(nova_senha, 10);
  await query('UPDATE usuarios SET senha=$1 WHERE id=$2', [novoHash, usuario.id]);

  console.log('SENHA ALTERADA: ' + usuario.email + ' | ' + new Date().toISOString());
  req.flash('msg', 'Senha alterada com sucesso! Faça login novamente.');
  req.session.destroy();
  res.redirect('/login');
});

router.post('/meu-email', requireAuth, async (req, res) => {
  const { novo_email, senha_confirmacao } = req.body;

  if (!novo_email || !novo_email.includes('@')) {
    req.flash('erro', 'E-mail inválido.');
    return res.redirect('/dashboard');
  }

  const r = await query('SELECT * FROM usuarios WHERE id=$1', [req.session.usuario.id]);
  const usuario = r.rows[0];

  if (!usuario || !bcrypt.compareSync(senha_confirmacao, usuario.senha)) {
    req.flash('erro', 'Senha incorreta. Não foi possível alterar o e-mail.');
    return res.redirect('/dashboard');
  }

  const emailExiste = await query('SELECT id FROM usuarios WHERE email=$1 AND id!=$2', [novo_email.toLowerCase().trim(), usuario.id]);
  if (emailExiste.rows.length > 0) {
    req.flash('erro', 'Este e-mail já está em uso.');
    return res.redirect('/dashboard');
  }

  await query('UPDATE usuarios SET email=$1 WHERE id=$2', [novo_email.toLowerCase().trim(), usuario.id]);
  req.session.usuario.email = novo_email.toLowerCase().trim();

  console.log('EMAIL ALTERADO: ' + usuario.email + ' -> ' + novo_email + ' | ' + new Date().toISOString());
  req.flash('msg', 'E-mail alterado com sucesso!');
  res.redirect('/dashboard');
});

// ─── ATENDIMENTOS WHATSAPP ────────────────────────────────────────────────────
router.get('/atendimentos', requireAuth, requirePermissao('atendimentos'), async (req, res) => {
  try {
    const config = await getConfig();
    const msg = req.session.msg||[]; req.session.msg=[];
    const erro = req.session.erro||[]; req.session.erro=[];
    const _perfil = req.session.usuario && req.session.usuario.perfil;
    const _isAdmin = _perfil === 'admin' || _perfil === 'presidencia';
    // Admin e presidência veem tudo; demais áreas veem só os atendimentos da sua área
    const _filtroArea = _isAdmin ? '' : ' WHERE area=$1';
    const _params = _isAdmin ? [] : [_perfil];
    const [statsR, atendR, contatosR] = await Promise.all([
      query("SELECT COUNT(*) FILTER (WHERE status='aguardando') AS aguardando, COUNT(*) FILTER (WHERE status='transferido' AND DATE(encerrado_em AT TIME ZONE 'UTC' AT TIME ZONE 'America/Asuncion')=DATE(NOW() AT TIME ZONE 'America/Asuncion')) AS transferidos_hoje, COUNT(*) FILTER (WHERE status='encerrado' AND DATE(encerrado_em AT TIME ZONE 'UTC' AT TIME ZONE 'America/Asuncion')=DATE(NOW() AT TIME ZONE 'America/Asuncion')) AS encerrados_hoje, COUNT(*) AS total, ROUND(AVG(EXTRACT(EPOCH FROM (encerrado_em - criado_em))/60) FILTER (WHERE status='encerrado' AND criado_em >= NOW() - INTERVAL '7 days'))::int AS tempo_medio_semanal, ROUND(AVG(EXTRACT(EPOCH FROM (encerrado_em - criado_em))/60) FILTER (WHERE status='encerrado' AND criado_em >= NOW() - INTERVAL '30 days'))::int AS tempo_medio_mensal FROM lauro_atendimentos" + _filtroArea, _params),
      query("SELECT a.*, COALESCE((SELECT nome FROM membros WHERE regexp_replace(whatsapp,'[^0-9]','','g')=a.numero_membro LIMIT 1),(SELECT nome FROM ligantes WHERE regexp_replace(whatsapp,'[^0-9]','','g')=a.numero_membro LIMIT 1),(SELECT nome FROM membros WHERE RIGHT(regexp_replace(whatsapp,'[^0-9]','','g'),8)=RIGHT(a.numero_membro,8) LIMIT 1),(SELECT nome FROM ligantes WHERE RIGHT(regexp_replace(whatsapp,'[^0-9]','','g'),8)=RIGHT(a.numero_membro,8) LIMIT 1),a.nome_contato) as nome_membro, TO_CHAR(a.criado_em AT TIME ZONE 'UTC' AT TIME ZONE 'America/Asuncion', 'DD/MM, HH24:MI') as inicio_fmt, TO_CHAR(a.encerrado_em AT TIME ZONE 'UTC' AT TIME ZONE 'America/Asuncion', 'DD/MM, HH24:MI') as fim_fmt, ROUND(EXTRACT(EPOCH FROM (COALESCE(a.encerrado_em, NOW()) - a.criado_em))/60)::int as duracao_min FROM lauro_atendimentos a" + (_filtroArea ? _filtroArea.replace('area', 'a.area') : '') + " ORDER BY CASE WHEN a.status='aguardando' THEN 0 WHEN a.status='transferido' THEN 1 ELSE 2 END, a.criado_em DESC LIMIT 200", _params),
      query('SELECT area, numero FROM lauro_contatos ORDER BY area')
    ]);
    res.render('pages/atendimentos', { config, msg, erro, usuario: req.session.usuario, stats: statsR.rows[0]||{}, atendimentos: atendR.rows, contatos: contatosR.rows }, function(err, html){
      console.log('RENDER CALLBACK: err=', err&&err.message, 'html_len=', html&&html.length);
      if(err){ console.error('RENDER ATEND ERRO:', err.message); return res.status(500).send('Erro render: '+err.message); }
      res.send(html);
    });
  } catch(e) { console.error('CATCH ATEND:', e.message); res.status(500).send(e.message); }
});

router.get('/atendimentos/:id/conversa', requireAuth, requirePermissao('atendimentos'), async (req, res) => {
  try {
    const atR = await query('SELECT numero_membro, area, idioma, criado_em, encerrado_em, nome_contato, origem FROM lauro_atendimentos WHERE id=$1', [req.params.id]);
    if (!atR.rows.length) return res.json({msgs:[], area:'', numero:'', idioma:'pt'});
    const {numero_membro, area, idioma, criado_em, encerrado_em, origem} = atR.rows[0];
    // Controle de acesso: só admin/presidência ou usuário da mesma área podem ver o chat
    const _perfil = req.session.usuario && req.session.usuario.perfil;
    const _isAdmin = _perfil === 'admin' || _perfil === 'presidencia';
    if (!_isAdmin && area !== _perfil) {
      return res.status(403).json({msgs:[], erro:'Sem permissão para ver este atendimento'});
    }
    if (origem === 'portal') {
      const [_p, _tipo, _idMembro] = numero_membro.split('-');
      const msgsR = await query('SELECT autor, texto, criado_em, remetente_nome FROM portal_mensagens WHERE origem_tipo=$1 AND origem_id=$2 ORDER BY criado_em ASC LIMIT 300', [_tipo, _idMembro]);
      await query("UPDATE portal_mensagens SET lido_admin=true WHERE origem_tipo=$1 AND origem_id=$2 AND autor='membro'", [_tipo, _idMembro]);
      const msgs = msgsR.rows.map(m => ({ papel: m.autor === 'membro' ? 'user' : 'area', mensagem: m.texto, criado_em: m.criado_em, remetente_nome: m.remetente_nome }));
      return res.json({ msgs, area, numero: 'Portal', idioma: 'pt', nomeMembro: atR.rows[0].nome_contato, atendId: parseInt(req.params.id), encerrado: !!encerrado_em, origem });
    }
    const [msgsR, membroR] = await Promise.all([
      query('SELECT papel, mensagem, criado_em FROM lauro_conversas WHERE numero=$1 ORDER BY criado_em ASC LIMIT 300', [numero_membro]),
      query("SELECT nome FROM membros WHERE regexp_replace(whatsapp,'\\D','','g') = $1 LIMIT 1", [numero_membro])
    ]);
    let nomeMembro = membroR.rows.length > 0 ? membroR.rows[0].nome : null;
    if (!nomeMembro) {
      const _ligR = await query("SELECT nome FROM ligantes WHERE regexp_replace(whatsapp,'[^0-9]','','g') = $1 LIMIT 1", [numero_membro]);
      if (_ligR.rows.length) nomeMembro = _ligR.rows[0].nome;
    }
    // Fallback: formato BR 8->9 digitos (554688191844 -> 5546988191844)
    if (!nomeMembro && numero_membro.length === 12 && numero_membro.startsWith('55')) {
      const _num9 = numero_membro.slice(0,4) + '9' + numero_membro.slice(4);
      const _mR9 = await query("SELECT nome FROM membros WHERE regexp_replace(whatsapp,'[^0-9]','','g') = $1 LIMIT 1", [_num9]);
      if (_mR9.rows.length) nomeMembro = _mR9.rows[0].nome;
      else {
        const _lR9 = await query("SELECT nome FROM ligantes WHERE regexp_replace(whatsapp,'[^0-9]','','g') = $1 LIMIT 1", [_num9]);
        if (_lR9.rows.length) nomeMembro = _lR9.rows[0].nome;
      }
    }
    if (!nomeMembro && atR.rows[0].nome_contato) nomeMembro = atR.rows[0].nome_contato;
    res.json({ msgs: msgsR.rows, area, numero: '****'+numero_membro.slice(-4), idioma, nomeMembro, atendId: parseInt(req.params.id), encerrado: !!encerrado_em, origem });
  } catch(e) { res.json({msgs:[], erro: e.message}); }
});

router.post('/atendimentos/:id/responder', requireAuth, requirePermissao('atendimentos'), async (req, res) => {
  try {
    const { mensagem } = req.body;
    if (!mensagem || !mensagem.trim()) return res.json({ok:false, erro:'Mensagem vazia'});
    const atR = await query("SELECT numero_membro, area, idioma, numero_area, origem FROM lauro_atendimentos WHERE id=$1 AND status='aguardando'", [req.params.id]);
    if (!atR.rows.length) return res.json({ok:false, erro:'Atendimento nao encontrado ou encerrado'});
    const { numero_membro, area, numero_area, origem } = atR.rows[0];
    const _perfilR = req.session.usuario && req.session.usuario.perfil;
    if (_perfilR !== 'admin' && _perfilR !== 'presidencia' && area !== _perfilR) return res.json({ok:false, erro:'Sem permissão para este atendimento'});
    const nomeArea = area.charAt(0).toUpperCase() + area.slice(1);
    if (origem === 'portal') {
      const [_p, _tipo, _idMembro] = numero_membro.split('-');
      const nomeAdmin = (req.session.usuario && req.session.usuario.nome) || nomeArea;
      const r = await query(
        'INSERT INTO portal_mensagens (origem_tipo, origem_id, autor, texto, remetente_nome, atendimento_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, criado_em',
        [_tipo, _idMembro, 'admin', mensagem.trim(), nomeAdmin, req.params.id]
      );
      const io = req.app._io;
      if (io) io.to('membro_' + _tipo + '_' + _idMembro).emit('chat_msg_ok', { id: r.rows[0].id, texto: mensagem.trim(), criado_em: r.rows[0].criado_em, autor: 'admin' });
      return res.json({ok:true, enviado: mensagem.trim(), area: nomeArea});
    }
    const lauro = require('../services/lauro');
    await lauro.enviarMensagemDireta(numero_membro, mensagem.trim());
    if (numero_area) await lauro.enviarMensagemDireta(numero_area, mensagem.trim()).catch(()=>{});
    await query('INSERT INTO lauro_conversas (numero,papel,mensagem) VALUES ($1,$2,$3)', [numero_membro, 'area', mensagem.trim()]).catch(()=>{});
    res.json({ok:true, enviado: mensagem.trim(), area: nomeArea});
  } catch(e) { res.json({ok:false, erro: e.message}); }
});
router.post('/atendimentos/:id/responder-arquivo', requireAuth, requirePermissao('atendimentos'), (req, res) => {
  const { upload } = require('../services/arquivos');
  upload.single('arquivo')(req, res, async function(errUp){
    try {
      if (errUp) return res.json({ok:false, erro: errUp.message});
      if (!req.file) return res.json({ok:false, erro:'Nenhum arquivo recebido'});
      const atR = await query("SELECT numero_membro, area, numero_area FROM lauro_atendimentos WHERE id=$1 AND status='aguardando'", [req.params.id]);
      if (!atR.rows.length) return res.json({ok:false, erro:'Atendimento nao encontrado ou encerrado'});
      const { numero_membro, area, numero_area } = atR.rows[0];
      const _perfil = req.session.usuario && req.session.usuario.perfil;
      if (_perfil !== 'admin' && _perfil !== 'presidencia' && area !== _perfil) return res.json({ok:false, erro:'Sem permissao para este atendimento'});
      const { uploadArquivo } = require('../services/arquivos');
      const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'atendimentos');
      const lauro = require('../services/lauro');
      const dataUri = 'data:' + req.file.mimetype + ';base64,' + req.file.buffer.toString('base64');
      let tipo;
      if (req.file.mimetype.indexOf('image/') === 0) { tipo = 'image'; await lauro.enviarImagem(numero_membro, dataUri, ''); }
      else { tipo = 'document'; await lauro.enviarDocumento(numero_membro, dataUri, req.file.originalname); }
      if (numero_area) {
        if (tipo === 'image') await lauro.enviarImagem(numero_area, dataUri, '').catch(()=>{});
        else await lauro.enviarDocumento(numero_area, dataUri, req.file.originalname).catch(()=>{});
      }
      await query('INSERT INTO lauro_conversas (numero, papel, mensagem) VALUES ($1,$2,$3)', [numero_membro, 'area', '[[MIDIA]]'+tipo+'|||'+r.chave+'|||'+req.file.originalname]);
      res.json({ok:true, tipo, chave: r.chave, nome: req.file.originalname});
    } catch(e) { res.json({ok:false, erro: e.message}); }
  });
});

router.get('/atendimentos/midia', requireAuth, requirePermissao('atendimentos'), async (req, res) => {
  try {
    const chave = req.query.chave;
    if (!chave) return res.status(400).send('chave ausente');
    // A midia pertence a uma conversa de uma area especifica - so quem e da mesma area
    // (ou admin/presidencia) pode abrir, mesmo tendo a permissao geral de atendimentos.
    const _perfil = req.session.usuario.perfil;
    const _isAdmin = _perfil === 'admin' || _perfil === 'presidencia';
    if (!_isAdmin) {
      const convR = await query("SELECT numero FROM lauro_conversas WHERE mensagem LIKE '%'||$1||'%' LIMIT 1", [chave]);
      const numero = convR.rows[0]?.numero;
      const areaR = numero ? await query('SELECT area FROM lauro_atendimentos WHERE numero_membro=$1 ORDER BY criado_em DESC LIMIT 1', [numero]) : { rows: [] };
      const area = areaR.rows[0]?.area;
      if (!area || area !== _perfil) return res.status(403).send('Sem permissao para este arquivo.');
    }
    const { gerarUrlInline } = require('../services/arquivos');
    const url = await gerarUrlInline(chave);
    res.redirect(url);
  } catch(e) { res.status(500).send('erro'); }
});

router.post('/atendimentos/contatos', requireAuth, requirePermissao('atendimentos'), async (req, res) => {
  try {
    const { area, numero } = req.body;
    const n = (numero||'').replace(/\D/g,'');
    await query('INSERT INTO lauro_contatos (area,numero) VALUES ($1,$2) ON CONFLICT (area) DO UPDATE SET numero=$2, updated_at=NOW()', [area, n]);
    const lauro = require('../services/lauro');
    if (lauro.recarregarContatos) await lauro.recarregarContatos();
    req.session.msg = ['Contato da area ' + area + ' atualizado!'];
  } catch(e) { req.session.erro = [e.message]; }
  res.redirect('/atendimentos');
});
router.post('/atendimentos/:id/encerrar', requireAuth, requirePermissao('atendimentos'), async (req, res) => {
  try {
    const atR = await query('SELECT numero_membro, area, idioma, origem FROM lauro_atendimentos WHERE id=$1', [req.params.id]);
    if (atR.rows.length > 0) {
      const { numero_membro, area, idioma, origem } = atR.rows[0];
      const _perfilE = req.session.usuario && req.session.usuario.perfil;
      if (_perfilE !== 'admin' && _perfilE !== 'presidencia' && area !== _perfilE) { req.session.erro=['Sem permissão para este atendimento']; return res.redirect('/atendimentos'); }
      await query("UPDATE lauro_atendimentos SET status='encerrado', encerrado_em=NOW() WHERE id=$1", [req.params.id]);
      const _areaCap = area ? (area.charAt(0).toUpperCase() + area.slice(1)) : 'Secretaria';
      const m = idioma==='es'
        ? 'Tu atención fue finalizada por ' + _areaCap + '. ¡Cualquier duda o información, puedes volver a contactarnos aquí que atenderemos tu solicitud!'
        : 'Seu atendimento foi encerrado pela ' + _areaCap + '. Qualquer dúvida ou informação, você pode voltar a nos contatar aqui que atenderemos a sua solicitação!';
      if (origem === 'portal') {
        const [_p, _tipo, _idMembro] = numero_membro.split('-');
        const r = await query(
          'INSERT INTO portal_mensagens (origem_tipo, origem_id, autor, texto, remetente_nome, atendimento_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, criado_em',
          [_tipo, _idMembro, 'admin', m, _areaCap, req.params.id]
        );
        const io = req.app._io;
        if (io) io.to('membro_' + _tipo + '_' + _idMembro).emit('chat_msg_ok', { id: r.rows[0].id, texto: m, criado_em: r.rows[0].criado_em, autor: 'admin' });
      } else {
        const lauro = require('../services/lauro');
        await lauro.enviarMensagemDireta(numero_membro, m).catch(()=>{});
      }
    }
    req.session.msg = ['Atendimento encerrado!'];
  } catch(e) { req.session.erro=[e.message]; }
  res.redirect('/atendimentos');
});
router.post('/atendimentos/:id/transferir', requireAuth, requirePermissao('atendimentos'), async (req, res) => {
  try {
    const { area_destino } = req.body;
    const atR = await query("SELECT numero_membro, area, idioma, origem FROM lauro_atendimentos WHERE id=$1 AND status='aguardando'", [req.params.id]);
    if (atR.rows.length > 0) {
      const { numero_membro, area, idioma, origem } = atR.rows[0];
      const _perfilT = req.session.usuario && req.session.usuario.perfil;
      if (_perfilT !== 'admin' && _perfilT !== 'presidencia' && area !== _perfilT) { req.session.erro=['Sem permissão para este atendimento']; return res.redirect('/atendimentos'); }
      if (origem === 'portal') {
        const [_p, _tipo, _idMembro] = numero_membro.split('-');
        await query('UPDATE lauro_atendimentos SET area=$1 WHERE id=$2', [area_destino, req.params.id]);
        const nomeAreaDestino = area_destino.charAt(0).toUpperCase() + area_destino.slice(1);
        const m = 'Sua solicitação foi encaminhada para a equipe de ' + nomeAreaDestino + '. Em breve alguém vai te responder aqui mesmo!';
        const r = await query(
          'INSERT INTO portal_mensagens (origem_tipo, origem_id, autor, texto, remetente_nome, atendimento_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, criado_em',
          [_tipo, _idMembro, 'admin', m, nomeAreaDestino, req.params.id]
        );
        const io = req.app._io;
        if (io) io.to('membro_' + _tipo + '_' + _idMembro).emit('chat_msg_ok', { id: r.rows[0].id, texto: m, criado_em: r.rows[0].criado_em, autor: 'admin' });
      } else {
        await query("UPDATE lauro_atendimentos SET status='transferido', encerrado_em=NOW() WHERE id=$1", [req.params.id]);
        const lauro = require('../services/lauro');
        await lauro.redirecionarArea(numero_membro, area_destino, idioma||'pt');
      }
    }
    req.session.msg = ['Transferido para ' + area_destino + '!'];
  } catch(e) { req.session.erro=[e.message]; }
  res.redirect('/atendimentos');
});

// ─── WEBHOOK PAGBANK ──────────────────────────────────────────────────────────

router.post('/webhook/pagbank', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    let body;
    try { body = JSON.parse(req.body.toString()); }
    catch (e) { return res.sendStatus(200); }

    console.log('PagBank Webhook recebido:', JSON.stringify(body).substring(0, 300));

    const { orderId, referencia, status, pago, metodo, valorPago } = processarWebhook(body);

    if (!referencia) return res.sendStatus(200);

    // Pagamento de MENSALIDADE
    if (pago && referencia.startsWith('mensalidade-')) {
      const r = await query(
        "UPDATE cobrancas SET status='pago', data_pagamento=NOW(), pagbank_charge_id=$1, metodo_pagamento=COALESCE($3,metodo_pagamento), valor_pago=COALESCE($4, CASE WHEN data_vencimento::date >= CURRENT_DATE THEN valor_desconto ELSE valor_cheio END) WHERE referencia=$2 AND status!='pago' RETURNING id",
        [orderId, referencia, metodo, valorPago]
      );
      if (r.rowCount > 0) {
        console.log('PagBank mensalidade confirmada:', referencia, orderId, 'metodo:', metodo);
        try {
          const { lancarMensalidadeNoFluxo } = require('../services/fluxo-mensalidade');
          await lancarMensalidadeNoFluxo(query, r.rows[0].id);
        } catch(e) { console.error('lancar fluxo (webhook2):', e.message); }
      }
    }

    // Pagamento de MENSALIDADE (formato {membro_id}-{ano}-{mes}, ex: 56-2026-05)
    if (pago && /^\d+-\d{4}-\d{2}$/.test(referencia)) {
      const r = await query(
        "UPDATE cobrancas SET status='pago', data_pagamento=NOW(), metodo_pagamento=COALESCE($2,metodo_pagamento), valor_pago=COALESCE($3, CASE WHEN data_vencimento::date >= CURRENT_DATE THEN valor_desconto ELSE valor_cheio END) WHERE referencia=$1 AND status!='pago' RETURNING id",
        [referencia, metodo, valorPago]
      );
      if (r.rowCount > 0) {
        console.log('PagBank mensalidade confirmada via webhook:', referencia, orderId, 'metodo:', metodo);
        try {
          const { lancarMensalidadeNoFluxo } = require('../services/fluxo-mensalidade');
          await lancarMensalidadeNoFluxo(query, r.rows[0].id);
        } catch(e) { console.error('lancar fluxo (webhook):', e.message); }
      }
    }

    // Pagamento de INGRESSO DE EVENTO
    if (pago && referencia.startsWith('evento-insc-')) {
      const partes = referencia.split('-');
      const inscricaoId = partes[2];
      if (inscricaoId) {
        const upd = await query(
          "UPDATE evento_inscricoes SET status='confirmado' WHERE id=$1 AND status!='confirmado' RETURNING id",
          [inscricaoId]
        );
        await query(
          "UPDATE evento_pagamentos SET status='pago', pago_em=NOW(), pagbank_order_id=$1 WHERE inscricao_id=$2 AND status!='pago'",
          [orderId, inscricaoId]
        );
        // Enviar email de confirmação apenas se acabou de confirmar (evita duplicado)
        if (upd.rowCount > 0) {
          const { enviarEmailConfirmacaoEvento } = require('../services/eventos-email');
          await enviarEmailConfirmacaoEvento(inscricaoId);
          console.log('PagBank ingresso confirmado via webhook — insc:', inscricaoId, orderId);
          try {
            const { lancarEventoNoFluxo } = require('../services/fluxo-eventos');
            await lancarEventoNoFluxo(query, inscricaoId);
          } catch(ef){ console.error('lancar fluxo evento webhook:', ef.message); }
        }
      }
    }

    // Pagamento de INSCRIÇÃO DE PROCESSO SELETIVO (pss-cand-<id>)
    if (pago && referencia.startsWith('pss-cand-')) {
      const candId = referencia.split('-')[2];
      if (candId) {
        const jc = await query("SELECT pagamento_status FROM ps_candidatos WHERE id=$1", [candId]);
        if (jc.rows[0] && jc.rows[0].pagamento_status !== 'confirmado') {
          await confirmarInscricaoPss(candId, { orderId, valorPago, metodo });
          console.log('PagBank inscrição PSS confirmada via webhook — cand:', candId, orderId);
        }
      }
    }

  } catch (e) { console.error('PagBank Webhook erro:', e.message); }
  res.sendStatus(200);
});


// Le a Sidebar de verdade e extrai a lista de modulos/paginas que existem nela (id da
// permissao + nome exibido) - usado na tela de Usuarios para montar a lista de permissoes
// assinaveis. Isso evita a lista de permissoes ficar desatualizada ou com nome diferente do
// que aparece na Sidebar: toda vez que um item novo e adicionado la (com o devido
// temPerm('id')), ele passa a aparecer aqui automaticamente, sem precisar editar mais nada.
function extrairModulosDaSidebar() {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../views/partials/sidebar.ejs'), 'utf8');
  const re = /<% if \(temPerm\('([a-z0-9-]+)'\)\) \{ %>[\s\S]*?<a href="[^"]*" class="nav-item[^"]*"[^>]*>\s*<span class="nav-icon">[\s\S]*?<\/span>\s*<span[^>]*>([^<]+)<\/span>/g;
  const vistos = new Set();
  const modulos = [];
  let m;
  while ((m = re.exec(src))) {
    if (vistos.has(m[1])) continue;
    vistos.add(m[1]);
    modulos.push({ id: m[1], label: m[2].trim() });
  }
  // Itens de admin da Sidebar nao usam temPerm (sao liberados so por isAdmin), mas ainda
  // fazem sentido como permissao assinavel para outros perfis, entao entram manualmente.
  ['usuarios', 'auditoria', 'configuracoes'].forEach(id => {
    if (!vistos.has(id)) modulos.push({ id, label: id.charAt(0).toUpperCase() + id.slice(1) });
  });
  return modulos;
}

router.get('/usuarios', requireAuth, requirePermissao('usuarios'), async (req, res) => {
  const config = await getConfig();
  const r = await query('SELECT id,nome,email,perfil,ativo,criado_em,telefone FROM usuarios ORDER BY criado_em');

  const permR = await query('SELECT usuario_id, modulo FROM usuario_permissoes');
  const permissoesUsuarios = {};
  permR.rows.forEach(function(row) {
    if (!permissoesUsuarios[row.usuario_id]) permissoesUsuarios[row.usuario_id] = [];
    permissoesUsuarios[row.usuario_id].push(row.modulo);
  });

  const modulosSidebar = extrairModulosDaSidebar();

  res.render('pages/usuarios', {
    config, usuario: req.session.usuario,
    usuarios: r.rows, permissoesUsuarios, modulosSidebar,
    msg: req.flash('msg'), erro: req.flash('erro')
  });
});

router.post('/usuarios/:id/permissoes', requireAuth, requireAdmin, async (req, res) => {
  const userId = req.params.id;
  const modulos = [].concat(req.body.modulos || []);
  await query('DELETE FROM usuario_permissoes WHERE usuario_id=$1', [userId]);
  for (const modulo of modulos) {
    await query('INSERT INTO usuario_permissoes (usuario_id,modulo) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, modulo]);
  }
  req.flash('msg', 'Permissões atualizadas!');
  res.redirect('/usuarios');
});

router.post('/usuarios', requireAuth, requireAdmin, async (req, res) => {
  const { nome, email, senha, perfil, telefone } = req.body;
  const modulosInicial = [].concat(req.body.modulos_inicial || []);
  const hash = bcrypt.hashSync(senha, 10);
  try {
    const r = await query('INSERT INTO usuarios (nome,email,senha,perfil,telefone) VALUES ($1,$2,$3,$4,$5) RETURNING id', [nome, email, hash, perfil, telefone || null]);
    const novoId = r.rows[0].id;
    const PADRAO = {
      secretaria:  ['dashboard', 'frequencia', 'aniversarios'],
      financeiro:  ['dashboard', 'membros', 'cobrancas', 'aniversarios', 'notificacoes'],
      marketing:   ['dashboard', 'marketing', 'aniversarios'],
      ensino:      ['dashboard', 'projetos', 'frequencia', 'aniversarios'],
      extensao:    ['dashboard', 'projetos', 'eventos', 'aniversarios'],
      cientifico:  ['dashboard', 'projetos', 'eventos', 'aniversarios'],
      visualizador:['dashboard']
    };
    const perms = modulosInicial.length > 0 ? modulosInicial : (PADRAO[perfil] || ['dashboard']);
    for (const modulo of perms) {
      await query('INSERT INTO usuario_permissoes (usuario_id,modulo) VALUES ($1,$2) ON CONFLICT DO NOTHING', [novoId, modulo]);
    }
    req.flash('msg', 'Usuário ' + nome + ' criado com sucesso!');
  } catch (e) {
    req.flash('erro', 'E-mail já cadastrado.');
  }
  res.redirect('/usuarios');
});

// ─── EXCLUIR USUÁRIO ─────────────────────────────────────────────────────────
router.post('/usuarios/:id/excluir', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const u = await query('SELECT nome, perfil FROM usuarios WHERE id=$1', [id]);
    if (!u.rows.length) { req.flash('erro', 'Usuário não encontrado.'); return res.redirect('/usuarios'); }
    if (u.rows[0].perfil === 'admin') { req.flash('erro', 'Não é possível excluir o administrador principal.'); return res.redirect('/usuarios'); }
    await query('DELETE FROM usuario_permissoes WHERE usuario_id=$1', [id]);
    await query('DELETE FROM usuarios WHERE id=$1', [id]);
    req.flash('msg', 'Usuário ' + u.rows[0].nome + ' excluído com sucesso.');
  } catch(e) {
    req.flash('erro', 'Erro ao excluir usuário: ' + e.message);
  }
  res.redirect('/usuarios');
});

// Webhook antigo da W-API (/webhook/whatsapp) removido em 2026-07-15 — assinatura
// cancelada, canal substituído pelo webhook oficial em routes/whatsapp-oficial.js.


router.get('/auditoria', requireAuth, requireAdmin, async (req, res) => {
  const config = await getConfig();
  const pagina = parseInt(req.query.pagina) || 1;
  const limite = 50;
  const offset = (pagina - 1) * limite;
  const filtroUsuario = req.query.usuario || '';
  const filtroAcao = req.query.acao || '';
  let where = 'WHERE 1=1';
  const params = [];
  if (filtroUsuario) { params.push('%'+filtroUsuario+'%'); where += ' AND u.nome ILIKE $'+params.length; }
  if (filtroAcao) { params.push(filtroAcao); where += ' AND l.acao = $'+params.length; }
  params.push(limite); params.push(offset);
  const r = await query(`SELECT l.*, u.nome as usuario_nome, u.email as usuario_email, u.perfil FROM log_atividades l LEFT JOIN usuarios u ON l.usuario_id = u.id ${where} ORDER BY l.criado_em DESC LIMIT $${params.length-1} OFFSET $${params.length}`, params);
  const total = await query(`SELECT COUNT(*) FROM log_atividades l LEFT JOIN usuarios u ON l.usuario_id = u.id ${where}`, params.slice(0,-2));
  res.render('pages/auditoria', { config, usuario: req.session.usuario, logs: r.rows, pagina, limite, total: parseInt(total.rows[0].count), filtroUsuario, filtroAcao });
});









// BACKUP MANUAL
router.get('/admin/backup/download', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tabelas = ['usuarios','configuracoes','membros','diretivos', 'cientifico','cobrancas','fluxo_caixa','eventos','evento_lotes','evento_inscricoes','evento_pagamentos','evento_certificados','evento_campos','evento_cupons','evento_programacao','evento_palestrantes','evento_patrocinadores','listas_assinaturas','desvinculacoes','cartas_cobranca','calendario_atividades','calendario_categorias','sorteios','sorteio_participantes','palestrantes','marketing_posts','marketing_midias','marketing_config','contratos_diretivos'];
    const linhas = ['-- BACKUP LAURO ' + new Date().toISOString(), 'BEGIN;'];
    for (const t of tabelas) {
      try {
        const ex = await query('SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)', [t]);
        if (!ex.rows[0].exists) continue;
        const r = await query('SELECT * FROM ' + t + ' ORDER BY 1');
        linhas.push('-- ' + t + ' (' + r.rows.length + ' registros)');
        for (const row of r.rows) {
          const cols = Object.keys(row).map(c => '"' + c + '"').join(', ');
          const vals = Object.values(row).map(v => {
            if (v === null) return 'NULL';
            if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
            if (typeof v === 'number') return String(v);
            if (v instanceof Date) return "'" + v.toISOString() + "'";
            return "'" + String(v).replace(/'/g, "''") + "'";
          }).join(', ');
          linhas.push('INSERT INTO ' + t + ' (' + cols + ') VALUES (' + vals + ') ON CONFLICT DO NOTHING;');
        }
      } catch(e) { linhas.push('-- ERRO ' + t + ': ' + e.message); }
    }
    linhas.push('COMMIT;');
    const dataStr = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="backup-lauro-' + dataStr + '.sql"');
    res.send(linhas.join('\n'));
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});





// ─── BUSCA GLOBAL ─────────────────────────────────────────────────────────
router.get('/buscar', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  const like = '%' + q + '%';
  let ligantes = [], membros = [], diretivos = [], eventos = [], cobrancas = [];

  if (q.length >= 1) {
    try {
      const r = await query("SELECT id, nome, email, whatsapp, semestre, turma FROM ligantes WHERE nome ILIKE $1 OR email ILIKE $1 OR whatsapp ILIKE $1 OR rg ILIKE $1 OR cpf ILIKE $1 ORDER BY nome LIMIT 30", [like]);
      ligantes = r.rows;
    } catch (e) { console.error('busca ligantes:', e.message); }

    try {
      const r = await query("SELECT id, nome, email, whatsapp, status FROM membros WHERE nome ILIKE $1 OR email ILIKE $1 OR whatsapp ILIKE $1 OR cpf ILIKE $1 OR rg ILIKE $1 ORDER BY nome LIMIT 30", [like]);
      membros = r.rows;
    } catch (e) { console.error('busca membros:', e.message); }

    try {
      const r = await query("SELECT id, nome, email, whatsapp, cargo FROM diretivos WHERE nome ILIKE $1 OR email ILIKE $1 OR whatsapp ILIKE $1 OR rg ILIKE $1 OR cpf ILIKE $1 ORDER BY nome LIMIT 30", [like]);
      diretivos = r.rows;
    } catch (e) { console.error('busca diretivos:', e.message); }

    try {
      const r = await query("SELECT id, nome, status, data_inicio, local FROM eventos WHERE nome ILIKE $1 OR descricao ILIKE $1 OR local ILIKE $1 ORDER BY data_inicio DESC NULLS LAST LIMIT 30", [like]);
      eventos = r.rows;
    } catch (e) { console.error('busca eventos:', e.message); }

    try {
      const r = await query("SELECT c.*, m.nome AS membro_nome FROM cobrancas c LEFT JOIN membros m ON m.id = c.membro_id WHERE m.nome ILIKE $1 ORDER BY c.id DESC LIMIT 30", [like]);
      cobrancas = r.rows;
    } catch (e) { console.error('busca cobrancas:', e.message); }
  }

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const total = ligantes.length + membros.length + diretivos.length + eventos.length + cobrancas.length;
  const join = (arr) => arr.filter(Boolean).map(esc).join(' · ');
  const tag = (st) => {
    const s = String(st || '').toLowerCase();
    if (s.indexOf('atras') >= 0) return '<span class="tag t-at">atrasado</span>';
    if (s.indexOf('pag') >= 0) return '<span class="tag t-ok">pago</span>';
    if (s.indexOf('pend') >= 0) return '<span class="tag t-pe">pendente</span>';
    if (s) return '<span class="tag t-pe">' + esc(s) + '</span>';
    return '';
  };

  let corpo = '';
  if (ligantes.length) corpo += '<section class="grp"><h2>Ligantes <span>' + ligantes.length + '</span></h2><div class="cards">' +
    ligantes.map(function (l) { return '<a class="card" href="/ligantes"><div class="nm">' + esc(l.nome) + '</div><div class="meta">' + join([l.email, l.whatsapp, l.semestre && ('Sem. ' + l.semestre), l.turma && ('Turma ' + l.turma)]) + '</div></a>'; }).join('') + '</div></section>';

  if (membros.length) corpo += '<section class="grp"><h2>Membros <span>' + membros.length + '</span></h2><div class="cards">' +
    membros.map(function (m) { return '<a class="card" href="/membros"><div class="nm">' + esc(m.nome) + tag(m.status) + '</div><div class="meta">' + join([m.email, m.whatsapp]) + '</div></a>'; }).join('') + '</div></section>';

  if (diretivos.length) corpo += '<section class="grp"><h2>Diretivos <span>' + diretivos.length + '</span></h2><div class="cards">' +
    diretivos.map(function (d) { return '<a class="card" href="/diretivos"><div class="nm">' + esc(d.nome) + '</div><div class="meta">' + join([d.cargo, d.email, d.whatsapp]) + '</div></a>'; }).join('') + '</div></section>';

  if (eventos.length) corpo += '<section class="grp"><h2>Eventos <span>' + eventos.length + '</span></h2><div class="cards">' +
    eventos.map(function (ev) { var dt = ''; try { if (ev.data_inicio) dt = new Date(ev.data_inicio).toLocaleDateString('pt-BR'); } catch (e) {} return '<a class="card" href="/eventos/' + ev.id + '"><div class="nm">' + esc(ev.nome) + (ev.status ? tag(ev.status) : '') + '</div><div class="meta">' + join([dt, ev.local]) + '</div></a>'; }).join('') + '</div></section>';

  if (cobrancas.length) corpo += '<section class="grp"><h2>Cobranças <span>' + cobrancas.length + '</span></h2><div class="cards">' +
    cobrancas.map(function (c) { var val = (c.valor != null) ? ('R$ ' + Number(c.valor).toFixed(2).replace('.', ',')) : ''; return '<a class="card" href="/cobrancas"><div class="nm">' + esc(c.membro_nome || 'Cobrança') + tag(c.status) + '</div><div class="meta">' + join([val]) + '</div></a>'; }).join('') + '</div></section>';

  if (q && total === 0) corpo = '<div class="vazio">Nenhum resultado encontrado para "<b>' + esc(q) + '</b>".</div>';

  const html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Busca — LAURO</title><style>'
    + '*{box-sizing:border-box;margin:0;padding:0}'
    + 'body{font-family:Segoe UI,system-ui,sans-serif;background:#f4f6f3;color:#1c2620;padding:24px}'
    + '.wrap{max-width:880px;margin:0 auto}'
    + '.back{display:inline-flex;align-items:center;gap:6px;text-decoration:none;color:#fff;background:#1a3d2b;padding:9px 16px;border-radius:8px;font-size:14px;font-weight:600}'
    + '.back:hover{background:#2b6803}'
    + 'h1{font-size:20px;font-weight:700;margin:18px 0 4px}'
    + '.sub{color:#5b6b60;font-size:14px;margin-bottom:22px}'
    + 'form.bar{display:flex;gap:8px;margin-bottom:26px}'
    + 'form.bar input{flex:1;border:1px solid #cdd6cf;border-radius:8px;padding:11px 14px;font-size:15px}'
    + 'form.bar button{background:#2b6803;color:#fff;border:0;border-radius:8px;padding:0 20px;font-weight:600;cursor:pointer}'
    + '.grp{margin-bottom:24px}'
    + '.grp h2{font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#3a4a40;margin-bottom:10px;font-weight:700}'
    + '.grp h2 span{background:#e3ede5;color:#2b6803;border-radius:20px;padding:2px 9px;font-size:12px;margin-left:6px}'
    + '.cards{display:flex;flex-direction:column;gap:8px}'
    + '.card{display:block;background:#fff;border:1px solid #e6ece7;border-radius:10px;padding:13px 16px;text-decoration:none;color:inherit;transition:.15s}'
    + '.card:hover{border-color:#2b6803;box-shadow:0 3px 12px rgba(43,104,3,.10);transform:translateY(-1px)}'
    + '.card .nm{font-weight:600;font-size:15px;color:#172419}'
    + '.card .meta{font-size:13px;color:#69786e;margin-top:3px}'
    + '.tag{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;margin-left:8px;vertical-align:middle}'
    + '.t-at{background:#fdeaea;color:#c0392b}.t-ok{background:#e7f6ea;color:#1e7d34}.t-pe{background:#fef6e3;color:#b8860b}'
    + '.vazio{text-align:center;color:#7a897f;padding:50px 20px;background:#fff;border:1px dashed #d3ddd5;border-radius:12px}'
    + '</style></head><body><div class="wrap">'
    + '<a class="back" href="/dashboard">&larr; Voltar ao painel</a>'
    + '<h1>Resultados da busca</h1>'
    + '<div class="sub">' + (q ? ('Você buscou por "<b>' + esc(q) + '</b>" &mdash; ' + total + ' resultado(s)') : 'Digite algo para buscar') + '</div>'
    + '<form class="bar" action="/buscar" method="get"><input name="q" value="' + esc(q) + '" placeholder="Buscar ligantes, membros, eventos, cobranças..." autofocus><button type="submit">Buscar</button></form>'
    + corpo
    + '</div></body></html>';

  res.send(html);
});



// ─── INVENTÁRIO PATRIMONIAL ───────────────────────────────────────────────────

router.get('/inventario', requireAuth, requirePermissao('inventario'), async (req, res) => {
  const config = await getConfig();
  const busca = req.query.busca || '';
  const categoria = req.query.categoria || '';
  const estado = req.query.estado || '';
  const situacao = req.query.situacao || 'ativos';
  const params = [];
  let where = situacao === 'inativos' ? 'WHERE i.ativo=0' : situacao === 'todos' ? 'WHERE 1=1' : 'WHERE i.ativo=1';
  let idx = 1;
  if (busca) { where += ' AND (i.nome ILIKE $' + idx + ' OR i.codigo ILIKE $' + idx + ' OR i.responsavel ILIKE $' + idx + ')'; params.push('%' + busca + '%'); idx++; }
  if (categoria) { where += ' AND i.categoria_id=$' + idx; params.push(categoria); idx++; }
  if (estado) { where += ' AND i.estado=$' + idx; params.push(estado); idx++; }
  const [itens, categorias, stats] = await Promise.all([
    query('SELECT i.*, c.nome as categoria_nome, c.cor as categoria_cor FROM inventario_itens i LEFT JOIN inventario_categorias c ON c.id=i.categoria_id ' + where + ' ORDER BY i.criado_em DESC', params),
    query('SELECT * FROM inventario_categorias ORDER BY nome'),
    query("SELECT COUNT(*) FILTER (WHERE i.ativo=1) as total, COUNT(*) FILTER (WHERE i.estado='danificado' AND i.ativo=1) as danificados, COUNT(*) FILTER (WHERE i.estado='perdido' AND i.ativo=1) as perdidos, COALESCE(SUM(i.valor_estimado) FILTER (WHERE i.ativo=1),0) as valor_total, COALESCE(SUM(i.valor_estimado_brl) FILTER (WHERE i.ativo=1),0) as valor_total_brl, (SELECT COUNT(*) FROM (SELECT DISTINCT ON (item_id) item_id, tipo FROM inventario_movimentacoes ORDER BY item_id, criado_em DESC) t WHERE t.tipo='emprestimo') as emprestados FROM inventario_itens i")
  ]);
  res.render('pages/inventario', { config, usuario: req.session.usuario, itens: itens.rows, categorias: categorias.rows, stats: stats.rows[0], busca, categoria, estado, situacao, msg: req.flash('msg'), erro: req.flash('erro') });
});

router.post('/inventario', requireAuth, requirePermissao('inventario'), async (req, res) => {
  const { nome, descricao, categoria_id, estado, localizacao, valor_estimado, valor_estimado_brl, data_aquisicao, responsavel, observacoes, codigo_etiqueta } = req.body;
  const ano = new Date().getFullYear();
  const last = await query('SELECT codigo FROM inventario_itens WHERE codigo LIKE $1 ORDER BY codigo DESC LIMIT 1', ['LIG-' + ano + '-%']);
  let seq = 1;
  if (last.rows.length) { const p = last.rows[0].codigo.split('-'); seq = (parseInt(p[2]) || 0) + 1; }
  const codigo = 'LIG-' + ano + '-' + String(seq).padStart(3, '0');
  await query('INSERT INTO inventario_itens (codigo,nome,descricao,categoria_id,estado,localizacao,valor_estimado,valor_estimado_brl,data_aquisicao,responsavel,observacoes,codigo_etiqueta) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [codigo, nome, descricao || null, categoria_id || null, estado || 'otimo', localizacao || null, valor_estimado || null, valor_estimado_brl || null, data_aquisicao || null, responsavel || null, observacoes || null, codigo_etiqueta || null]);
  req.flash('msg', 'Item ' + codigo + ' cadastrado com sucesso!');
  res.redirect('/inventario');
});

router.post('/inventario/:id/editar', requireAuth, requirePermissao('inventario'), async (req, res) => {
  const { nome, descricao, categoria_id, estado, localizacao, valor_estimado, valor_estimado_brl, data_aquisicao, responsavel, observacoes, codigo_etiqueta } = req.body;
  await query('UPDATE inventario_itens SET nome=$1,descricao=$2,categoria_id=$3,estado=$4,localizacao=$5,valor_estimado=$6,valor_estimado_brl=$7,data_aquisicao=$8,responsavel=$9,observacoes=$10,codigo_etiqueta=$11,atualizado_em=NOW() WHERE id=$12',
    [nome, descricao || null, categoria_id || null, estado, localizacao || null, valor_estimado || null, valor_estimado_brl || null, data_aquisicao || null, responsavel || null, observacoes || null, codigo_etiqueta || null, req.params.id]);
  req.flash('msg', 'Item atualizado com sucesso!');
  res.redirect('/inventario');
});

router.post('/inventario/:id/movimentacao', requireAuth, requirePermissao('inventario'), async (req, res) => {
  const { tipo, descricao, responsavel, data_mov } = req.body;
  await query('INSERT INTO inventario_movimentacoes (item_id,tipo,descricao,responsavel,data_mov) VALUES ($1,$2,$3,$4,$5)',
    [req.params.id, tipo, descricao || null, responsavel || null, data_mov || null]);
  req.flash('msg', 'Movimentação registrada!');
  res.redirect('/inventario');
});

router.post('/inventario/:id/desativar', requireAuth, requirePermissao('inventario'), async (req, res) => {
  await query('UPDATE inventario_itens SET ativo=0 WHERE id=$1', [req.params.id]);
  req.flash('msg', 'Item removido do inventário.');
  res.redirect('/inventario');
});

router.get('/inventario/:id/dados', requireAuth, requirePermissao('inventario'), async (req, res) => {
  const [item, hist, cats] = await Promise.all([
    query('SELECT i.*, c.nome as categoria_nome FROM inventario_itens i LEFT JOIN inventario_categorias c ON c.id=i.categoria_id WHERE i.id=$1', [req.params.id]),
    query('SELECT * FROM inventario_movimentacoes WHERE item_id=$1 ORDER BY criado_em DESC LIMIT 30', [req.params.id]),
    query('SELECT * FROM inventario_categorias ORDER BY nome')
  ]);
  if (!item.rows.length) return res.json({ erro: 'Nao encontrado' });
  res.json({ item: item.rows[0], historico: hist.rows, categorias: cats.rows });
});

require('./processo-seletivo')(router);
require('./projetos-academicos')(router);
require('./projeto-fluxo')(router);
require('./whatsapp-oficial')(router);
require('./sorteios')(router);
require('./lista-assinaturas')(router);
require('./fluxo-caixa')(router);
require('./api-publica')(router);
require('./diretivos')(router);
require('./desvinculacoes')(router);
require('./eventos')(router);
require('./contratos')(router);
require('./comunicados')(router);
require('./correcoes-cadastro')(router);
require('./carta-cobranca')(router);
require('./carta-notificacao')(router);
require('./palestrantes')(router);
require('./assistente-virtual')(router);
require('./desligamentos')(router);
require('./atas')(router);
require('./frequencia')(router);
require('./frequencia-diretivos')(router);
require('./contratos-diretivos')(router);
require('./arquivos-financeiros')(router);
require('./ligantes')(router);
require('./arquivos')(router);
require('./calendario')(router);
require('./portal-membro')(router);
require('./marketing')(router);
require('./cientifico')(router);


// ─── POLÍTICA DE PRIVACIDADE PÚBLICA ─────────────────────────────────────────
router.get("/privacidade", (req, res) => {
  res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Política de Privacidade — LAURO Liga CDE</title><style>body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#333;line-height:1.7}h1{color:#1a3d2b}h2{color:#1a3d2b;margin-top:32px}a{color:#1a3d2b}</style></head><body><h1>Política de Privacidade</h1><p><strong>Liga Acadêmica de Urologia — UCP | Ciudad del Este</strong></p><p>Última atualização: junho de 2026</p><h2>1. Informações que coletamos</h2><p>Coletamos informações fornecidas diretamente por você, como nome, e-mail, número de WhatsApp e dados de pagamento, para fins de gestão de membros e eventos acadêmicos.</p><h2>2. Uso das informações</h2><p>As informações coletadas são utilizadas exclusivamente para comunicação institucional, cobrança de mensalidades, notificações de eventos e gestão da liga acadêmica.</p><h2>3. Compartilhamento</h2><p>Não compartilhamos seus dados com terceiros, exceto quando necessário para processamento de pagamentos (PagBank) ou cumprimento de obrigações legais.</p><h2>4. Segurança</h2><p>Adotamos medidas técnicas e organizacionais para proteger seus dados contra acesso não autorizado, perda ou divulgação indevida.</p><h2>5. Seus direitos</h2><p>Você pode solicitar acesso, correção ou exclusão dos seus dados a qualquer momento pelo e-mail: <a href="mailto:fernando.macedoo@hotmail.com">fernando.macedoo@hotmail.com</a></p><h2>6. Contato</h2><p>Para dúvidas sobre esta política, entre em contato com a secretaria da Liga Acadêmica de Urologia — UCP.</p></body></html>`);
});
// ─── FIM POLÍTICA DE PRIVACIDADE ──────────────────────────────────────────────

// ─── INSTAGRAM OAUTH ──────────────────────────────────────────────────────────
router.get("/auth/instagram/connect", requireAuth, (req, res) => {
  const APP_ID = process.env.META_APP_ID;
  const REDIRECT_URI = process.env.META_REDIRECT_URI;
  const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=instagram_business_basic,instagram_business_content_publish&response_type=code`;
  res.redirect(url);
});

router.get("/auth/instagram/callback", async (req, res) => {
  const { code } = req.query;
  const APP_ID = process.env.META_APP_ID;
  const APP_SECRET = process.env.META_APP_SECRET;
  const REDIRECT_URI = process.env.META_REDIRECT_URI;
  try {
    const axios = require("axios");
    const tokenRes = await axios.get("https://graph.facebook.com/v19.0/oauth/access_token", {
      params: { client_id: APP_ID, client_secret: APP_SECRET, redirect_uri: REDIRECT_URI, code }
    });
    const accessToken = tokenRes.data.access_token;
    const pagesRes = await axios.get("https://graph.facebook.com/v19.0/me/accounts", {
      params: { access_token: accessToken }
    });
    const page = pagesRes.data.data[0];
    const pageToken = page.access_token;
    const pageId = page.id;
    const igRes = await axios.get(`https://graph.facebook.com/v19.0/${pageId}`, {
      params: { fields: "instagram_business_account", access_token: pageToken }
    });
    const igId = igRes.data.instagram_business_account?.id;
    res.send(`<h2>Conectado!</h2><p><b>Page Token:</b><br><textarea rows="4" cols="80">${pageToken}</textarea></p><p><b>Instagram ID:</b> ${igId}</p>`);
  } catch(err) {
    res.send("<h2>Erro</h2><pre>" + JSON.stringify(err.response?.data || err.message, null, 2) + "</pre>");
  }
});
// ─── FIM INSTAGRAM OAUTH ──────────────────────────────────────────────────────
router.get("/api/pendencias", requireAuth, async (req, res) => {
  try {
    const r = await query("SELECT COUNT(*) as total FROM instagram_posts WHERE status='agendado'");
    const lig = await query("SELECT COUNT(*) as total FROM ligantes WHERE status='pendente'"); const dir = await query("SELECT COUNT(*) as total FROM diretivos WHERE status='pendente'"); const pal = await query("SELECT COUNT(*) as total FROM palestrantes WHERE status='pendente' OR ativo=0 LIMIT 1").catch(()=>({rows:[{total:0}]})); const l=parseInt(lig.rows[0].total)||0; const d=parseInt(dir.rows[0].total)||0; const p=parseInt(pal.rows[0].total)||0;
    const _perfil = req.session.usuario && req.session.usuario.perfil;
    const _isAdmin = _perfil === 'admin' || _perfil === 'presidencia';
    const atendR = await query("SELECT COUNT(*) as total FROM lauro_atendimentos WHERE status='aguardando'" + (_isAdmin?'':' AND area=$1'), _isAdmin?[]:[_perfil]).catch(()=>({rows:[{total:0}]}));
    const atend = parseInt(atendR.rows[0].total)||0;
    res.json({ ok:true, ligantes:l, diretivos:d, palestrantes:p, atendimentos:atend, total:l+d+p });
  } catch(e) { res.json({ ok: true, pendencias: 0 }); }
});

// ─── INSTAGRAM ────────────────────────────────────────────────────────────────
const ig = require("../services/instagram");

router.get("/instagram", requireAuth, async (req, res) => {
  try {
    const posts = await query("SELECT * FROM instagram_posts ORDER BY criado_em DESC LIMIT 50");
    const config = await query("SELECT chave,valor FROM configuracoes WHERE chave LIKE 'instagram%'").then(r => { const c={}; r.rows.forEach(x=>c[x.chave]=x.valor); return c; });
    let feedPosts = [];
    try { feedPosts = await ig.buscarMetricas(); } catch(e) {}
    res.render("pages/instagram", { posts: posts.rows, config, feedPosts, ok: req.query.ok||null, erro: req.query.erro||null });
  } catch(e) { res.redirect("/dashboard?erro=Erro+ao+carregar+Instagram"); }
});

router.post("/instagram/publicar", requireAuth, async (req, res) => {
  const { tipo, midia_url, legenda, midias, agendar, agendado_para } = req.body;
  try {
    if (agendar === "1" && agendado_para) {
      await ig.agendarPost({ tipo, midiaUrl: midia_url, midias: midias ? JSON.parse(midias) : null, legenda, agendadoPara: agendado_para, criadoPor: req.session.userId||null });
      return res.redirect("/instagram?ok=Post+agendado+com+sucesso");
    }
    if (tipo === "feed") await ig.publicarFoto({ imageUrl: midia_url, legenda });
    else if (tipo === "carousel") { const urls = JSON.parse(midias).map(m=>m.url); await ig.publicarCarrossel({ imageUrls: urls, legenda }); }
    else if (tipo === "story") await ig.publicarStory({ imageUrl: midia_url });
    else if (tipo === "reel") await ig.publicarReel({ videoUrl: midia_url, legenda });
    await query("INSERT INTO instagram_posts (tipo,midia_url,midias,legenda,status,publicado_em) VALUES ($1,$2,$3,$4,'publicado',NOW())", [tipo, midia_url||null, midias||null, legenda||null]);
    res.redirect("/instagram?ok=Publicado+com+sucesso+no+Instagram");
  } catch(e) {
    res.redirect("/instagram?erro=" + encodeURIComponent(e.message));
  }
});

router.post("/instagram/agendar/:id/excluir", requireAuth, async (req, res) => {
  await query("DELETE FROM instagram_posts WHERE id=$1 AND status='agendado'", [req.params.id]);
  res.redirect("/instagram?ok=Post+agendado+excluido");
});

router.get("/instagram/metricas/:id", requireAuth, async (req, res) => {
  try {
    const insights = await ig.buscarInsights(req.params.id);
    res.json({ ok: true, insights });
  } catch(e) { res.json({ ok: false, erro: e.message }); }
});

router.post("/instagram/config", requireAuth, async (req, res) => {
  const { instagram_aniversario_ativo, instagram_aniversario_imagem } = req.body;
  await query("INSERT INTO configuracoes (chave,valor) VALUES ('instagram_aniversario_ativo',$1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [instagram_aniversario_ativo||'0']);
  await query("INSERT INTO configuracoes (chave,valor) VALUES ('instagram_aniversario_imagem',$1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [instagram_aniversario_imagem||'']);
  res.redirect("/instagram?ok=Configuracoes+salvas");
});
// ─── FIM INSTAGRAM ────────────────────────────────────────────────────────────

// ─── INSTAGRAM API ROUTES ─────────────────────────────────────────────────────
router.get("/api/instagram/feed", requireAuth, async (req, res) => {
  try { const ig = require("../services/instagram"); const feed = await ig.buscarFeedCompleto(); res.json({ ok: true, feed }); } catch(e) { res.json({ ok: false, erro: e.message }); }
});

router.get("/api/instagram/perfil", requireAuth, async (req, res) => {
  try { const ig = require("../services/instagram"); const perfil = await ig.buscarPerfil(); res.json({ ok: true, perfil }); } catch(e) { res.json({ ok: false, erro: e.message }); }
});

router.get("/api/instagram/comentarios/:mediaId", requireAuth, async (req, res) => {
  try { const ig = require("../services/instagram"); const comentarios = await ig.buscarComentarios(req.params.mediaId); res.json({ ok: true, comentarios }); } catch(e) { res.json({ ok: false, erro: e.message }); }
});

router.post("/api/instagram/comentarios/:mediaId/responder", requireAuth, async (req, res) => {
  try { const ig = require("../services/instagram"); const r = await ig.responderComentario(req.params.mediaId, req.body.texto); res.json({ ok: true, data: r }); } catch(e) { res.json({ ok: false, erro: e.message }); }
});

router.get("/api/instagram/insights/:mediaId", requireAuth, async (req, res) => {
  try { const ig = require("../services/instagram"); const insights = await ig.buscarInsights(req.params.mediaId); res.json({ ok: true, insights }); } catch(e) { res.json({ ok: false, erro: e.message }); }
});
// ─── FIM INSTAGRAM API ────────────────────────────────────────────────────────

module.exports = router;

// POST /admin/disparar-cobrancas-vencidas (só vencidas, a partir do dia 16, com intervalo seguro)
router.post('/admin/disparar-cobrancas-vencidas', requireAuth, requireFinanceiro, async (req, res) => {
  const hoje = new Date().toISOString().split('T')[0];
  const config = (await query('SELECT chave, valor FROM configuracoes')).rows.reduce((a,r)=>{a[r.chave]=r.valor;return a},{});
  const { notificarCobranca } = require('../services/notificacoes');
  // Buscar cobranças vencidas (data_vencimento < hoje) e não pagas, sem notificação pos já enviada
  const r = await query(`
    SELECT c.*, m.nome, m.email, m.whatsapp FROM cobrancas c
    JOIN membros m ON m.id=c.membro_id
    WHERE c.data_vencimento::date < $1
    AND c.status='pendente'
    AND m.ativo=1
    AND NOT EXISTS (
      SELECT 1 FROM notificacoes_log nl
      WHERE nl.cobranca_id=c.id AND nl.tipo='pos' AND nl.canal='email' AND nl.status='ok'
    )
    ORDER BY c.data_vencimento ASC, m.nome ASC
  `, [hoje]);
  let enfileirados = 0;
  // Enviar em background com intervalo de 8s entre emails (evita spam e bloqueio)
  res.json({ ok: true, total: r.rows.length, msg: `Iniciando envio de ${r.rows.length} cobranças vencidas por email. Serão enviadas com intervalo de 8s cada.` });
  for (const cob of r.rows) {
    try {
      await notificarCobranca({ membro: {...cob, id: cob.membro_id}, cobranca: cob, tipo: 'pos', config, canal: 'email' });
      enfileirados++;
      console.log(`[COBRANCA-VENCIDA] Email enviado: ${cob.nome} (${enfileirados}/${r.rows.length})`);
    } catch(e) {
      console.error(`[COBRANCA-VENCIDA] Erro ao enviar para ${cob.nome}:`, e.message);
    }
    // Intervalo de 8s entre cada email para não sobrecarregar servidor SMTP
    if (enfileirados < r.rows.length) await new Promise(r => setTimeout(r, 8000));
  }
  console.log(`[COBRANCA-VENCIDA] Concluído: ${enfileirados}/${r.rows.length} emails enviados`);
});

// POST /admin/disparar-cobrancas-pre (disparo seguro via sistema)
router.post('/admin/disparar-cobrancas-pre', requireAuth, requireFinanceiro, async (req, res) => {
  const { data_vencimento } = req.body;
  if (!data_vencimento) return res.json({ erro: 'data_vencimento obrigatoria' });
  const config = (await query('SELECT chave, valor FROM configuracoes')).rows.reduce((a,r)=>{a[r.chave]=r.valor;return a},{});
  const { notificarCobranca } = require('../services/notificacoes');
  const r = await query(`SELECT c.*, m.nome, m.email, m.whatsapp FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.data_vencimento::date=$1 AND c.status='pendente' AND m.ativo=1 AND NOT EXISTS (SELECT 1 FROM notificacoes_log nl WHERE nl.cobranca_id=c.id AND nl.tipo='pre' AND nl.canal='whatsapp' AND nl.status='ok') ORDER BY m.nome`,[data_vencimento]);
  let enfileirados=0;
  for (const cob of r.rows) {
    await notificarCobranca({ membro: {...cob, id: cob.membro_id}, cobranca: cob, tipo: 'pre', config, canal: 'whatsapp' });
    enfileirados++;
  }
  res.json({ ok: true, enfileirados, msg: 'Mensagens enfileiradas com seguranca. Serao enviadas com intervalos de 90s.' });
});

