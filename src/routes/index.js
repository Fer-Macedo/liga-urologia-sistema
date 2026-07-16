const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const xss = require('xss');
const { enviarEmail, emailBonito } = require('../services/email');

async function gerarPDFContratoDir(d, config) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const W = 595.28, H = 841.89;
      const ML = 56, MR = 56, MT = 162, textW = W - ML - MR;
      const RODAPE = 99, maxY = H - RODAPE;
      function desenharTimbrado() {
        if (config.timbrado_b64) {
          try {
            const imgBuf = Buffer.from(config.timbrado_b64.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
            doc.image(imgBuf, 0, 0, { width: W, height: H });
          } catch(e) {}
        }
      }
      function novaPagina() { doc.addPage({ size: 'A4', margin: 0 }); desenharTimbrado(); return 142; }
      desenharTimbrado();
      let y = MT;
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#000')
        .text('CONTRATO DE DIRETIVO', ML, y, { width: textW, align: 'center' });
      y = doc.y + 2;
      doc.fontSize(11).font('Helvetica-Bold')
        .text('LIGA ACADEMICA DE UROLOGIA - LAURO', ML, y, { width: textW, align: 'center' });
      y = doc.y + 14;
      const dataIng = d.data_inicio ? new Date(d.data_inicio).toLocaleDateString('pt-BR') : '';
      doc.fontSize(10).font('Helvetica-Bold').text('DIRETIVO: ', ML, y, { continued: true });
      doc.font('Helvetica').text(d.nome || '');
      y = doc.y + 2;
      doc.font('Helvetica-Bold').text('R.G./C.I: ', ML, y, { continued: true });
      doc.font('Helvetica').text(d.rg || '');
      y = doc.y + 2;
      doc.font('Helvetica-Bold').text('Cargo: ', ML, y, { continued: true });
      doc.font('Helvetica').text(d.cargo || '');
      y = doc.y + 2;
      doc.font('Helvetica-Bold').text('Fecha de ingreso: ', ML, y, { continued: true });
      doc.font('Helvetica').text(dataIng);
      y = doc.y + 12;
      const dataFmt = new Date().toLocaleDateString('pt-BR');
      let texto = (d.texto_contrato || '')
        .replace(/\{nome\}/g, d.nome||'').replace(/\{rg\}/g, d.rg||'')
        .replace(/\{cargo\}/g, d.cargo||'').replace(/\{data\}/g, dataFmt)
        .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
        .replace(/<p[^>]*class="ql-align-center"[^>]*>/gi, '§CENTER§')
        .replace(/<p[^>]*class="ql-align-right"[^>]*>/gi, '§RIGHT§')
        .replace(/<p[^>]*>/gi, '')
        .replace(/<strong>([^<]+)<\/strong>/gi, '$1')
        .replace(/<em>([^<]+)<\/em>/gi, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/\n\s*\n\s*\n/g, '\n\n').trim();
      const linhas = texto.split('\n');
      for (const linha of linhas) {
        const isCenter = linha.startsWith('§CENTER§');
        const isRight = linha.startsWith('§RIGHT§');
        const txt = linha.replace(/§CENTER§|§RIGHT§/g, '').trim();
        if (!txt) { y += 5; continue; }
        const align = isCenter ? 'center' : isRight ? 'right' : 'justify';
        doc.fontSize(10).font('Helvetica');
        const alt = doc.heightOfString(txt, { width: textW, lineGap: 1 });
        if (y + alt > maxY) { y = novaPagina(); }
        doc.fillColor('#000').text(txt, ML, y, { width: textW, align, lineGap: 1 });
        y = doc.y + 4;
      }
      if (y + 130 > maxY) { y = novaPagina(); }
      y += 10;
      const colW = textW / 2 - 10;
      const col1X = ML, col2X = ML + colW + 20;
      const assinaturas = [
        { nome: (d.nome||'').toUpperCase(), cargo: d.cargo||'Diretivo', img: null },
        { nome: (config.presidente_nome||'PRESIDENTE').toUpperCase(), cargo: 'Presidente', img: config.assinatura_presidente_b64 }
      ];
      for (let i = 0; i < assinaturas.length; i += 2) {
        if (y > H - 80) break;
        const a1 = assinaturas[i], a2 = assinaturas[i+1];
        if (a1?.img) { try { const buf = Buffer.from(a1.img.replace(/^data:image\/[^;]+;base64,/,''),'base64'); doc.image(buf, col1X+colW/2-55, y, {width:110,height:40,fit:[110,40]}); } catch(e){} }
        if (a2?.img) { try { const buf = Buffer.from(a2.img.replace(/^data:image\/[^;]+;base64,/,''),'base64'); doc.image(buf, col2X+colW/2-55, y, {width:110,height:40,fit:[110,40]}); } catch(e){} }
        y += 43;
        doc.moveTo(col1X,y).lineTo(col1X+colW,y).lineWidth(1).stroke('#000');
        if (a2) doc.moveTo(col2X,y).lineTo(col2X+colW,y).lineWidth(1).stroke('#000');
        y += 3;
        if (a1) { doc.fontSize(8).font('Helvetica-Bold').fillColor('#000').text(a1.nome,col1X,y,{width:colW,align:'center'}); doc.fontSize(7.5).font('Helvetica').text(a1.cargo,col1X,doc.y,{width:colW,align:'center'}); }
        if (a2) { doc.fontSize(8).font('Helvetica-Bold').fillColor('#000').text(a2.nome,col2X,y,{width:colW,align:'center'}); doc.fontSize(7.5).font('Helvetica').text(a2.cargo,col2X,doc.y,{width:colW,align:'center'}); }
        y = doc.y + 10;
      }
      doc.end();
    } catch(e) { reject(e); }
  });
}



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

const { limiterApiPublica, limiterContato } = require('../services/rate-limiters');
router.use(limiterGeral);

// Rate limit para login
const limiterLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Muitas tentativas de login. Aguarde 15 minutos.'
});

// Rate limit para codigo de recuperacao de senha (brute-force do codigo de 6 digitos)
const limiterCodigoRecuperacao = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Muitas tentativas. Aguarde 15 minutos.'
});

// Rate limit para solicitar recuperacao de senha (evita spam de emails)
const limiterEsqueciSenha = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Muitas solicitacoes. Aguarde 1 hora.'
});

// Rate limit para pagamento com cartao embutido (evita card testing/carding)
const limiterPagamentoCartao = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: { ok: false, erro: 'Muitas tentativas de pagamento. Aguarde 15 minutos.' }
});

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
const { requireAuth, requireAdmin, requireFinanceiro, requireSecretaria, requirePermissao } = require('../middleware/auth');
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

// ─── FREQUÊNCIA DIRETIVOS ─────────────────────────────────────────────────────

router.get('/frequencia-diretivos', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];

  const turmasR = await query('SELECT * FROM diretivo_turmas WHERE ativo=1 ORDER BY nome');
  const turmas = turmasR.rows;

  let turmaAtual = null, atividades = [], membrosFrequencia = [], resumo = { aptos:0, risco:0, inaptos:0 }, todosDiretivos = [];

  const turmaId = req.query.turma;
  if (turmaId) { const tR = await query('SELECT * FROM diretivo_turmas WHERE id=$1', [turmaId]); turmaAtual = tR.rows[0] || null; }
  if (!turmaAtual && turmas.length > 0) turmaAtual = turmas[0];

  const todosR = await query('SELECT id, nome FROM diretivos WHERE ativo=1 ORDER BY nome');
  todosDiretivos = todosR.rows;

  if (turmaAtual) {
    const atR = await query(
      `SELECT a.*, 
        (SELECT COUNT(*) FROM diretivo_presencas p WHERE p.atividade_id=a.id AND p.presente=1) as presentes,
        (SELECT COUNT(*) FROM diretivo_turma_membros tm JOIN diretivos dx ON dx.id=tm.diretivo_id WHERE tm.turma_id=a.turma_id AND dx.ativo=1) as total_membros
       FROM diretivo_atividades a WHERE a.turma_id=$1 ORDER BY a.data_atividade DESC`, [turmaAtual.id]
    );
    for (const at of atR.rows) {
      const mR = await query(
        `SELECT d.id as diretivo_id, d.nome, COALESCE(p.presente,0) as presente
         FROM diretivo_turma_membros tm JOIN diretivos d ON d.id=tm.diretivo_id
         LEFT JOIN diretivo_presencas p ON p.atividade_id=$1 AND p.diretivo_id=d.id
         WHERE tm.turma_id=$2 ORDER BY d.nome`, [at.id, turmaAtual.id]
      );
      at.membros = mR.rows; atividades.push(at);
    }
    const mfR = await query(
      `SELECT d.id as membro_id, d.nome, d.cargo, tm.data_entrada,
        (SELECT COUNT(*) FROM diretivo_atividades a WHERE a.turma_id=$1) as total_atividades,
        (SELECT COUNT(*) FROM diretivo_presencas p JOIN diretivo_atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1 AND p.diretivo_id=d.id AND p.presente=1) as presencas
       FROM diretivo_turma_membros tm JOIN diretivos d ON d.id=tm.diretivo_id WHERE tm.turma_id=$1 AND d.ativo=1 ORDER BY d.nome`, [turmaAtual.id]
    );
    membrosFrequencia = mfR.rows;
    membrosFrequencia.forEach(m => {
      const pct = m.total_atividades > 0 ? Math.round((m.presencas/m.total_atividades)*100) : 0;
      if (pct >= 75) resumo.aptos++; else if (pct >= 50) resumo.risco++; else resumo.inaptos++;
    });
  }

  res.render('pages/frequencia-diretivos', {
    config, msg, erro, usuario: req.session.usuario,
    turmas: turmas.sort((a,b) => a.nome.localeCompare(b.nome)),
    turmaAtual, atividades, membrosFrequencia, resumo, todosDiretivos
  });
});

router.post('/frequencia-diretivos/turma', requireAuth, requireSecretaria, async (req, res) => {
  const { nome, data_inicio, data_fim } = req.body;
  await query('INSERT INTO diretivo_turmas (nome,data_inicio,data_fim) VALUES ($1,$2,$3)', [nome, data_inicio, data_fim||null]);
  req.session.msg = ['Turma criada com sucesso!'];
  res.redirect('/frequencia-diretivos');
});

router.post('/frequencia-diretivos/atividade', requireAuth, requireSecretaria, async (req, res) => {
  try {
    const { tipo, descricao, data_atividade } = req.body;
    const turmas_ids = [].concat(req.body.turmas_ids || req.body.turma_id_sel || req.body.turma_id || []).filter(Boolean);
    if (!turmas_ids.length) { req.session.erro=['Selecione ao menos uma turma.']; return res.redirect('/frequencia-diretivos'); }
    let lastTurmaId = turmas_ids[0];
    for (const turma_id of turmas_ids) {
      const r = await query('INSERT INTO diretivo_atividades (turma_id,tipo,descricao,data_atividade) VALUES ($1,$2,$3,$4) RETURNING id', [turma_id, tipo, descricao, data_atividade]);
      const membros = await query('SELECT dtm.diretivo_id FROM diretivo_turma_membros dtm JOIN diretivos d ON d.id=dtm.diretivo_id WHERE dtm.turma_id=$1 AND d.ativo=1', [turma_id]);
      for (const m of membros.rows) { await query('INSERT INTO diretivo_presencas (atividade_id,diretivo_id,presente) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [r.rows[0].id, m.diretivo_id]); }
      lastTurmaId = turma_id;
    }
    req.session.msg = ['Atividade criada!'];
    res.redirect('/frequencia-diretivos?turma=' + lastTurmaId);
  } catch(e) { console.error('ERRO criar atividade diretivos:', e.message); req.session.erro=[e.message]; res.redirect('/frequencia-diretivos'); }
});

router.post('/frequencia-diretivos/atividade/:id/presenca', requireAuth, requireSecretaria, async (req, res) => {
  const atR = await query('SELECT * FROM diretivo_atividades WHERE id=$1', [req.params.id]);
  const at = atR.rows[0];
  if (!at) return res.redirect('/frequencia-diretivos');
  const membros = await query('SELECT dtm.diretivo_id FROM diretivo_turma_membros dtm JOIN diretivos d ON d.id=dtm.diretivo_id WHERE dtm.turma_id=$1 AND d.ativo=1', [at.turma_id]);
  const presentes = [].concat(req.body.presentes || []).map(Number);
  for (const m of membros.rows) {
    await query('INSERT INTO diretivo_presencas (atividade_id,diretivo_id,presente) VALUES ($1,$2,$3) ON CONFLICT (atividade_id,diretivo_id) DO UPDATE SET presente=$3', [at.id, m.diretivo_id, presentes.includes(m.diretivo_id) ? 1 : 0]);
  }
  req.session.msg = ['Presenças salvas!'];
  res.redirect('/frequencia-diretivos?turma=' + at.turma_id);
});

router.post('/frequencia-diretivos/atividade/:id/editar', requireAuth, requireSecretaria, async (req, res) => {
  const { tipo, descricao, data_atividade } = req.body;
  const r = await query('SELECT turma_id FROM diretivo_atividades WHERE id=$1', [req.params.id]);
  const turmaId = r.rows[0]?.turma_id;
  await query('UPDATE diretivo_atividades SET tipo=$1, descricao=$2, data_atividade=$3 WHERE id=$4',
    [tipo, descricao, data_atividade, req.params.id]);
  res.redirect('/frequencia-diretivos?turma=' + turmaId + '&tab=atividades');
});
router.post('/frequencia-diretivos/atividade/:id/deletar', requireAuth, requireSecretaria, async (req, res) => {
  const atR = await query('SELECT turma_id FROM diretivo_atividades WHERE id=$1', [req.params.id]);
  const turma_id = atR.rows[0]?.turma_id;
  await query('DELETE FROM diretivo_presencas WHERE atividade_id=$1', [req.params.id]);
  await query('DELETE FROM diretivo_atividades WHERE id=$1', [req.params.id]);
  req.session.msg = ['Atividade removida!'];
  res.redirect('/frequencia-diretivos?turma=' + turma_id);
});

router.post('/frequencia-diretivos/turma/:id/adicionar-membro', requireAuth, requireSecretaria, async (req, res) => {
  const { diretivo_id, data_entrada } = req.body;
  await query('INSERT INTO diretivo_turma_membros (turma_id,diretivo_id,data_entrada) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.params.id, diretivo_id, data_entrada]);
  const ats = await query('SELECT id FROM diretivo_atividades WHERE turma_id=$1', [req.params.id]);
  for (const at of ats.rows) { await query('INSERT INTO diretivo_presencas (atividade_id,diretivo_id,presente) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [at.id, diretivo_id]); }
  req.session.msg = ['Diretivo adicionado à turma!'];
  res.redirect('/frequencia-diretivos?turma=' + req.params.id);
});

router.post('/frequencia-diretivos/turma/:id/remover-membro', requireAuth, requireSecretaria, async (req, res) => {
  await query('DELETE FROM diretivo_turma_membros WHERE turma_id=$1 AND diretivo_id=$2', [req.params.id, req.body.diretivo_id]);
  req.session.msg = ['Diretivo removido da turma!'];
  res.redirect('/frequencia-diretivos?turma=' + req.params.id);
});

router.post('/frequencia-diretivos/turma/:id/sincronizar', requireAuth, async (req, res) => {
  try {
    const turmaId = req.params.id;
    const diretivos = await query('SELECT id FROM diretivos WHERE ativo=1');
    let adicionados = 0;
    for (const d of diretivos.rows) {
      const existe = await query('SELECT id FROM diretivo_turma_membros WHERE turma_id=$1 AND diretivo_id=$2',[turmaId,d.id]);
      if (existe.rows.length === 0) {
        await query('INSERT INTO diretivo_turma_membros (turma_id,diretivo_id,data_entrada) VALUES ($1,$2,NOW())',[turmaId,d.id]);
        adicionados++;
      }
    }
    req.flash('msg', adicionados > 0 ? adicionados+' diretivos sincronizados!' : 'Todos os diretivos já estão na turma.');
    res.redirect('/frequencia-diretivos?turma='+turmaId);
  } catch(e) { req.flash('erro','Erro: '+e.message); res.redirect('/frequencia-diretivos'); }
});

router.get('/frequencia-diretivos/integridade/:id', requireAuth, async (req, res) => {
  try {
    const turmaId = req.params.id;
    const diretivos = await query('SELECT id, nome FROM diretivos WHERE ativo=1 ORDER BY nome');
    const membros = await query('SELECT dtm.diretivo_id FROM diretivo_turma_membros dtm JOIN diretivos d ON d.id=dtm.diretivo_id WHERE dtm.turma_id=$1 AND d.ativo=1',[turmaId]);
    const ids = new Set(membros.rows.map(m=>m.diretivo_id));
    const faltando = diretivos.rows.filter(d=>!ids.has(d.id));
    const problemas = [];
    if (faltando.length > 0) problemas.push({ severidade:'aviso', descricao: faltando.length+' diretivo(s) ativo(s) não estão na turma: '+faltando.slice(0,5).map(d=>d.nome).join(', ')+(faltando.length>5?' e mais '+(faltando.length-5)+'...':'') });
    res.json({ totalProblemas: problemas.length, problemas });
  } catch(e) { res.json({ok:false, totalProblemas:1, problemas:[{severidade:'erro',descricao:'Erro: '+e.message}]}); }
});

router.get('/frequencia-diretivos/relatorio/:turmaId', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const turmaR = await query('SELECT * FROM diretivo_turmas WHERE id=$1', [req.params.turmaId]);
  const turma = turmaR.rows[0];
  if (!turma) return res.redirect('/frequencia-diretivos');
  const [membrosR2, atividadesR2, presencasR2] = await Promise.all([
    query(`SELECT d.id, d.nome, d.cargo FROM diretivo_turma_membros tm JOIN diretivos d ON d.id=tm.diretivo_id WHERE tm.turma_id=$1 ORDER BY d.nome`, [req.params.turmaId]),
    query('SELECT id, tipo, descricao, data_atividade FROM diretivo_atividades WHERE turma_id=$1 ORDER BY data_atividade', [req.params.turmaId]),
    query('SELECT p.diretivo_id, p.atividade_id, p.presente FROM diretivo_presencas p JOIN diretivo_atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1', [req.params.turmaId])
  ]);
  const atividades = atividadesR2;
  const totalAt2 = atividades.rows.length;
  const pd = {};
  presencasR2.rows.forEach(p => { if(!pd[p.atividade_id]) pd[p.atividade_id]={}; pd[p.atividade_id][p.diretivo_id]=p.presente; });
  const membros = { rows: membrosR2.rows.map(d => ({
    ...d,
    total_atividades: totalAt2,
    presencas: presencasR2.rows.filter(p => p.diretivo_id===d.id && p.presente===1).length
  }))};
  const orgNome = config.org_nome || 'Liga Academica de Urologia';
  const orgCor = config.org_cor || '#1a56db';
  const orgLogo = config.org_logo || null;
  const logoHtml = orgLogo ? `<img src="${orgLogo}" style="max-height:56px;object-fit:contain">` : `<span style="font-size:20px;font-weight:800;color:${orgCor}">${orgNome}</span>`;
  const aptos = membros.rows.filter(m => m.total_atividades > 0 && (m.presencas/m.total_atividades)*100 >= 75).length;
  const risco = membros.rows.filter(m => m.total_atividades > 0 && (m.presencas/m.total_atividades)*100 >= 50 && (m.presencas/m.total_atividades)*100 < 75).length;
  const inaptos = membros.rows.length - aptos - risco;
  const dataInicio = turma.data_inicio ? new Date(turma.data_inicio+'T12:00:00').toLocaleDateString('pt-BR') : '';
  const dataFim = turma.data_fim ? new Date(turma.data_fim+'T12:00:00').toLocaleDateString('pt-BR') : '';
  let linhasMembros = membros.rows.map(m => {
    const pct = m.total_atividades > 0 ? Math.round((m.presencas/m.total_atividades)*100) : 0;
    const faltas = Number(m.total_atividades) - Number(m.presencas);
    const status = pct>=75?'Apto':pct>=50?'Em risco':'Nao apto';
    const corS = pct>=75?'#166534':pct>=50?'#92400e':'#991b1b';
    const bgS = pct>=75?'#dcfce7':pct>=50?'#fef3c7':'#fee2e2';
    const barC = pct>=75?'#10b981':pct>=50?'#f59e0b':'#ef4444';
    return `<tr><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;font-weight:600">${m.nome}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b">${m.cargo||''}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center;color:#10b981;font-weight:700">${m.presencas}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center;color:#ef4444;font-weight:700">${faltas}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center;color:#64748b">${m.total_atividades}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center"><div style="display:flex;align-items:center;gap:8px;justify-content:center"><div style="width:80px;height:6px;background:#e2e8f0;border-radius:3px"><div style="width:${pct}%;height:100%;background:${barC};border-radius:3px"></div></div><span style="font-weight:700">${pct}%</span></div></td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center"><span style="background:${bgS};color:${corS};padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700">${status}</span></td></tr>`;
  }).join('');
  let headerAt = `<th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b">Diretivo</th><th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b">Cargo</th>`;
  for (const at of atividades.rows) {
    const dt = new Date(at.data_atividade).toLocaleDateString('pt-BR',{timeZone:'UTC',day:'2-digit',month:'2-digit'});
    headerAt += `<th style="padding:10px 8px;text-align:center;font-size:10px;font-weight:700;color:#64748b;min-width:70px">${dt}<br><span style="font-weight:400;opacity:.7">${at.tipo.substring(0,10)}</span></th>`;
  }
  let linhasAt = '';
  for (const m of membros.rows) {
    let cols = `<td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;font-weight:600">${m.nome}</td><td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b">${m.cargo||''}</td>`;
    for (const at of atividades.rows) {
      const presente = pd[at.id] && pd[at.id][m.id] ? 1 : 0;
      cols += presente
        ? `<td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:center;background:#f0fdf4;color:#10b981;font-weight:700">S</td>`
        : `<td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:center;background:#fff1f2;color:#ef4444;font-weight:700">N</td>`;
    }
    linhasAt += `<tr>${cols}</tr>`;
  }
  const logoEl2 = orgLogo ? `<img src="${orgLogo}" style="width:72px;height:72px;border-radius:50%;border:3px solid rgba(255,255,255,.35);object-fit:cover">` : `<div style="width:72px;height:72px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#fff">${orgNome.substring(0,2).toUpperCase()}</div>`;
  const htmlDir = `<!DOCTYPE html><html><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box;border-radius:0!important;font-family:'Inter',sans-serif}body{background:#f0f4f0;padding:32px;min-height:100vh}.header-bar{background:linear-gradient(160deg,#0a1a08,#1a3410,#253d18);padding:24px 32px;display:flex;align-items:center;gap:16px;margin:-32px -32px 28px}.header-bar img{width:72px;height:72px;border-radius:50%!important;border:3px solid rgba(255,255,255,.35);object-fit:cover}.header-bar-info h1{font-size:20px;font-weight:800;color:#fff}.header-bar-info p{font-size:12px;color:rgba(255,255,255,.65);margin-top:3px}.card{background:white;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,.06)}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:16px}.stat{background:white;border:1px solid #e2e8f0;padding:18px 20px}.stat.verde{border-top:3px solid #10b981}.stat.ambar{border-top:3px solid #f59e0b}.stat.verm{border-top:3px solid #ef4444}.stat-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:6px}.stat-num{font-size:28px;font-weight:800}.stat.verde .stat-num{color:#10b981}.stat.ambar .stat-num{color:#f59e0b}.stat.verm .stat-num{color:#ef4444}.card-titulo{padding:14px 20px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:700;color:#1a3410;background:#f8faf6;text-transform:uppercase;letter-spacing:.04em}table{width:100%;border-collapse:collapse}thead th{background:linear-gradient(135deg,#1a3410,#253d18);color:#fff;padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}tbody tr:hover{background:#f0f7eb}td{padding:11px 16px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#374151;vertical-align:middle}.btn{background:linear-gradient(135deg,#1a3410,#253d18);color:white;border:none;padding:11px 28px;cursor:pointer;font-size:14px;font-weight:700;margin-bottom:24px;display:inline-flex;align-items:center;gap:8px}@media print{.btn{display:none}body{background:white;padding:16px}.header-bar{margin:-16px -16px 20px}}</style></head><body>`
    + `<div class="header-bar">${logoEl2}<div class="header-bar-info"><h1>${turma.nome}</h1><p>${dataInicio ? dataInicio+' · ' : ''}${atividades.rows.length} atividades · Mínimo 75% para aprovação</p></div></div>`
    + '<button class="btn" onclick="window.print()">Imprimir / Salvar PDF</button>'
    + `<div class="stats"><div class="stat verde"><div class="stat-lbl">Aptos ≥75%</div><div class="stat-num">${aptos}</div></div><div class="stat ambar"><div class="stat-lbl">Em risco 50-74%</div><div class="stat-num">${risco}</div></div><div class="stat verm"><div class="stat-lbl">Não aptos &lt;50%</div><div class="stat-num">${inaptos}</div></div></div>`
    + '<div class="card"><div class="card-titulo">Resumo por Diretivo</div>'
    + '<table><thead><tr>'
    + '<th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700">Diretivo</th>'
    + '<th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700">Cargo</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Presencas</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Faltas</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Total</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Frequencia</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Status</th>'
    + '</tr></thead><tbody>' + linhasMembros + '</tbody></table></div>'
    + '<div class="card"><div style="padding:16px 20px;border-bottom:1px solid #f1f5f9;font-size:14px;font-weight:700">Presencas por atividade</div>'
    + '<div style="overflow-x:auto"><table><thead><tr>' + headerAt + '</tr></thead><tbody>' + linhasAt + '</tbody></table></div></div>'
    + '</body></html>';
  res.send(htmlDir);
});

router.get('/live/:token', async (req, res) => {
  try {
    const r = await query('SELECT epo.*, i.nome, i.email, e.nome as evento_nome, e.youtube_url, e.duracao_minutos FROM evento_presencas_online epo JOIN evento_inscricoes i ON i.id=epo.inscricao_id JOIN eventos e ON e.id=epo.evento_id WHERE epo.token=$1',[req.params.token]);
    if (!r.rows[0]) return res.status(404).send('Link invalido ou expirado.');
    const p = r.rows[0];
    if (!p.primeiro_acesso) { await query("UPDATE evento_presencas_online SET primeiro_acesso=NOW(),ativo=true WHERE token=$1",[req.params.token]); }
    else { await query("UPDATE evento_presencas_online SET ativo=true,ultimo_ping=NOW() WHERE token=$1",[req.params.token]); }
    const config = await getConfig();
    const patrocR = await query('SELECT * FROM evento_patrocinadores WHERE evento_id=$1 ORDER BY id', [p.evento_id]);
    res.render('pages/evento-live', { token: req.params.token, presenca: p, config, patrocinadores: patrocR.rows });
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});
router.post('/live/:token/ping', async (req, res) => {
  try {
    const rp = await query("UPDATE evento_presencas_online SET ultimo_ping=NOW(),ativo=true,tempo_total_segundos=tempo_total_segundos+120 WHERE token=$1 RETURNING tempo_total_segundos,ultimo_ping",[req.params.token]);
    const total = rp.rows[0]?.tempo_total_segundos || 0;
    const ult = rp.rows[0]?.ultimo_ping;
    res.json({ok:true, total, ultimoPing: ult});
  } catch(e) { res.json({ok:false}); }
});
router.post('/live/:token/sair', async (req, res) => {
  try {
    await query("UPDATE evento_presencas_online SET ativo=false WHERE token=$1",[req.params.token]);
    res.json({ok:true});
  } catch(e) { res.json({ok:false}); }
});
router.post('/eventos/:id/enviar-link-live', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const crypto = require('crypto');
    const { enviarWhatsApp, enviarEmail } = require('../services/notificacoes');
    const config = await getConfig();
    const appUrl = process.env.APP_URL || 'https://liga-urologia.onrender.com';
    const evR = await query('SELECT * FROM eventos WHERE id=$1',[req.params.id]);
    const ev = evR.rows[0];
    if (!ev) return res.json({ok:false,msg:'Evento nao encontrado'});
    const inscrR = await query("SELECT * FROM evento_inscricoes WHERE evento_id=$1 AND status='confirmado'",[req.params.id]);
    let enviados = 0;
    for (const insc of inscrR.rows) {
      let token = crypto.randomBytes(24).toString('hex');
      const existe = await query('SELECT token FROM evento_presencas_online WHERE inscricao_id=$1 AND evento_id=$2',[insc.id,ev.id]);
      if (existe.rows.length > 0) { token = existe.rows[0].token; }
      else { await query('INSERT INTO evento_presencas_online (inscricao_id,evento_id,token) VALUES ($1,$2,$3)',[insc.id,ev.id,token]); }
      const link = appUrl+'/live/'+token;
      const msg = (config.org_nome||'LAURO')+'\n\nOla, '+insc.nome.split(' ')[0]+'!\n\nSeu link de acesso ao evento '+ev.nome+':\n\n'+link+'\n\nAcesse para assistir e registrar sua presenca automaticamente.';
      if (insc.whatsapp) { try { await enviarWhatsApp(insc.whatsapp,msg); enviados++; } catch(e){} }
      if (insc.email) {
        const html = '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px"><h2>'+ev.nome+'</h2><p>Ola, <strong>'+insc.nome.split(' ')[0]+'</strong>!</p><p>Clique para assistir e ter sua presenca registrada:</p><div style="text-align:center;margin:24px 0"><a href="'+link+'" style="background:#1a56db;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700">Assistir ao evento</a></div><p style="font-size:12px;color:#6b7280">Link exclusivo — nao compartilhe.</p></div>';
        try { await enviarEmail({para:insc.email,assunto:'Seu link de acesso — '+ev.nome,html,texto:msg}); } catch(e){}
      }
    }
    res.json({ok:true,msg:enviados+' links enviados!'});
  } catch(e) { res.json({ok:false,msg:e.message}); }
});
router.get('/eventos/:id/presencas', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const config = await getConfig();
    const evR = await query('SELECT * FROM eventos WHERE id=$1',[req.params.id]);
    const ev = evR.rows[0];
    if (!ev) return res.redirect('/eventos');
    const inscrR = await query(
      `SELECT i.*,
        COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(saida_em,NOW())-entrada_em))) FROM evento_presencas_tempo WHERE inscricao_id=i.id),0) as segundos_presencial,
        COALESCE((SELECT tempo_total_segundos FROM evento_presencas_online WHERE inscricao_id=i.id AND evento_id=$1),0) as segundos_online
       FROM evento_inscricoes i WHERE i.evento_id=$1 AND i.status='confirmado' ORDER BY i.nome`,
      [ev.id]
    );
    const duracaoSeg = (ev.duracao_minutos||0)*60;
    res.render('pages/evento-presencas',{config,evento:ev,inscricoes:inscrR.rows,duracaoSeg,usuario:req.session.usuario,msg:req.flash('msg')});
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});
router.get('/eventos/:id/presencas-pdf', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const config = await getConfig();
    const evR = await query('SELECT * FROM eventos WHERE id=$1',[req.params.id]);
    const ev = evR.rows[0];
    if (!ev) return res.status(404).send('Evento nao encontrado');
    const inscrR = await query(
      `SELECT i.*,
        COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(saida_em,NOW())-entrada_em))) FROM evento_presencas_tempo WHERE inscricao_id=i.id),0) as segundos_presencial,
        COALESCE((SELECT tempo_total_segundos FROM evento_presencas_online WHERE inscricao_id=i.id AND evento_id=$1),0) as segundos_online
       FROM evento_inscricoes i WHERE i.evento_id=$1 AND i.status='confirmado' ORDER BY i.nome`,
      [ev.id]
    );
    const inscricoes = inscrR.rows;
    const duracaoSeg = (ev.duracao_minutos||0)*60;
    const orgNome = config.org_nome||'LAURO';
    const orgLogo = config.org_logo||null;
    const tipoEv = ev.tipo_evento||'presencial';
    const dataEv = ev.data_inicio?new Date(ev.data_inicio).toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}):'';
    const fmtDur = (seg)=>{ const m=Math.floor(seg/60); const h=Math.floor(m/60); const mm=m%60; return h>0?(h+'h '+mm+'min'):(mm+'min'); };
    let aptos=0, risco=0, naoApt=0;
    const linhas = inscricoes.map((i,idx)=>{
      const segP=Number(i.segundos_presencial||0), segO=Number(i.segundos_online||0);
      const seg=Math.max(segP,segO);
      const tipo = segP>segO ? 'presencial' : segO>segP ? 'online' : (tipoEv==='hibrido'?'':tipoEv);
      const tipoLabel = tipo==='presencial'?'Presencial':tipo==='online'?'Online':'—';
      const pct = duracaoSeg>0 ? Math.min(100, Math.round(seg/duracaoSeg*100)) : 0;
      let stTxt, stBg, stCo;
      if (pct>=75){ stTxt='Apto'; stBg='#EDF6F1'; stCo='#23704F'; aptos++; }
      else if (pct>=50){ stTxt='Em risco'; stBg='#FBF3E0'; stCo='#C98A1E'; risco++; }
      else { stTxt='Não apto'; stBg='#FBE9E7'; stCo='#C0392B'; naoApt++; }
      const corPct = pct>=75?'#23704F':pct>=50?'#C98A1E':'#C0392B';
      return `<tr style="background:${idx%2===0?'#F6F8F5':'#ffffff'}"><td style="padding:7px 10px;font-size:10.5px;color:#74837C">${idx+1}</td><td style="padding:7px 10px;font-size:11px;font-weight:600;color:#10201A">${i.nome}<div style="font-size:9px;color:#74837C;font-weight:400">${i.email||''}</div></td><td style="padding:7px 10px;text-align:center"><span style="font-family:'IBM Plex Mono';font-size:9px;color:#3A4A43;border:1px solid #CDD4CE;padding:2px 7px">${tipoLabel}</span></td><td style="padding:7px 10px;font-size:10.5px;text-align:center;color:#3A4A43">${seg>0?fmtDur(seg):'—'}</td><td style="padding:7px 10px;text-align:center;font-family:'Archivo';font-weight:700;font-size:11px;color:${corPct}">${pct}%</td><td style="padding:7px 10px;text-align:center"><span style="background:${stBg};color:${stCo};padding:2px 8px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">${stTxt}</span></td></tr>`;
    }).join('');
    const minPct = 75;
    const minSeg = Math.round(duracaoSeg*minPct/100);
    const estilos=`*{margin:0;padding:0;box-sizing:border-box}@page{size:A4;margin:0}body{font-family:'IBM Plex Sans',Arial,sans-serif;color:#10201A;-webkit-print-color-adjust:exact;print-color-adjust:exact}@media print{.np{display:none}}.wrap{max-width:820px;margin:0 auto}.header{background:linear-gradient(135deg,#103024,#0C231B);padding:26px 34px;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:14px}.logo-chip{width:54px;height:54px;background:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}.logo-chip img{width:54px;height:54px;object-fit:cover;border-radius:50%}.org{font-family:'Archivo';font-weight:800;font-size:15px;letter-spacing:.3px;line-height:1.15}.org small{display:block;font-family:'IBM Plex Mono';font-size:8.5px;letter-spacing:2px;color:#37C98B;text-transform:uppercase;margin-top:4px;font-weight:500}.ev{text-align:right}.ev .nm{font-family:'Archivo';font-size:18px;font-weight:800;line-height:1.15}.ev .dt{font-size:11.5px;color:#A9C2B6;margin-top:5px;text-transform:capitalize}.ev .lc{font-size:10.5px;color:#7E988B;margin-top:1px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:18px 34px;background:#F2F4F0;border-bottom:1px solid #E2E6E1}.stat{background:#fff;border:1px solid #E2E6E1;padding:13px 14px;position:relative;overflow:hidden}.stat::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--bar,#2FA873)}.stat .n{font-family:'Archivo';font-size:21px;font-weight:800;letter-spacing:-.5px;color:var(--c,#15402F)}.stat .l{font-family:'IBM Plex Mono';font-size:8.5px;color:#74837C;font-weight:500;text-transform:uppercase;letter-spacing:1px;margin-top:4px}.section{padding:20px 34px}.sec-title{font-family:'Archivo';font-size:13px;font-weight:800;letter-spacing:.2px;text-transform:uppercase;margin-bottom:12px;padding-bottom:7px;border-bottom:2px solid #2FA873;color:#10201A}.dur{display:flex;gap:40px;border:1px solid #E2E6E1;padding:16px 20px}.dur .l{font-family:'IBM Plex Mono';font-size:9px;color:#74837C;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px}.dur .v{font-family:'Archivo';font-size:16px;font-weight:800;color:#15402F}table{width:100%;border-collapse:collapse;border:1px solid #E2E6E1}thead{display:table-header-group}thead th{background:#15402F;color:#fff;padding:9px 10px;font-family:'IBM Plex Mono';font-size:9px;text-align:left;text-transform:uppercase;letter-spacing:1px;font-weight:600}tbody td{border-bottom:1px solid #EDEFEC}tbody tr{page-break-inside:avoid}.foot{padding:16px 34px;border-top:1px solid #E2E6E1;font-family:'IBM Plex Mono';font-size:9px;color:#74837C;text-transform:uppercase;letter-spacing:1px;display:flex;justify-content:space-between;gap:12px}.btn-p{position:fixed;bottom:22px;right:22px;padding:12px 22px;background:#2FA873;color:#0C231B;border:none;cursor:pointer;font-family:'IBM Plex Sans';font-size:13px;font-weight:700;box-shadow:0 8px 24px -8px rgba(47,168,115,.8)}@media print{@page{margin:14mm 0 12mm}@page :first{margin:0 0 12mm}}`;
    const html=`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet"><style>${estilos}</style></head><body>
<div class="wrap">
  <div class="header"><div class="brand">${orgLogo?`<div class="logo-chip"><img src="${orgLogo}" alt=""></div>`:''}<div class="org">${orgNome}<small>Relatório de Presenças</small></div></div><div class="ev"><div class="nm">${ev.nome}</div><div class="dt">${dataEv}</div><div class="lc">${ev.local||''}</div></div></div>
  <div class="stats">
    <div class="stat" style="--bar:#2FA873;--c:#15402F"><div class="n">${inscricoes.length}</div><div class="l">Total confirmados</div></div>
    <div class="stat" style="--bar:#2FA873;--c:#23704F"><div class="n">${aptos}</div><div class="l">Aptos (≥75%)</div></div>
    <div class="stat" style="--bar:#C98A1E;--c:#C98A1E"><div class="n">${risco}</div><div class="l">Em risco (50–74%)</div></div>
    <div class="stat" style="--bar:#C0392B;--c:#C0392B"><div class="n">${naoApt}</div><div class="l">Não aptos (&lt;50%)</div></div>
  </div>
  <div class="section"><div class="dur"><div><div class="l">Duração total do evento</div><div class="v">${duracaoSeg>0?fmtDur(duracaoSeg):'Não definida'}</div></div><div><div class="l">Mínimo para certificado</div><div class="v" style="color:#23704F">${minPct}% — ${duracaoSeg>0?fmtDur(minSeg):'—'}</div></div></div></div>
  <div class="section"><div class="sec-title">Lista de presenças (${inscricoes.length})</div>
    <table><thead><tr><th style="width:34px">#</th><th>Participante</th><th style="text-align:center;width:78px">Tipo</th><th style="text-align:center;width:90px">Tempo assistido</th><th style="text-align:center;width:64px">% Presença</th><th style="text-align:center;width:80px">Status</th></tr></thead><tbody>${linhas}</tbody></table>
  </div>
  <div class="foot"><span>${orgNome} · Gerado em ${new Date().toLocaleString('pt-BR')}</span><span>${ev.nome}</span></div>
</div>
<button class="btn-p np" onclick="window.print()">Imprimir / Salvar PDF</button>
<script>window.onload=function(){setTimeout(function(){window.print();},500);};</script>
</body></html>`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.send(html);
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});

router.get('/certificado/validar/:codigo', async (req, res) => {
  try {
    const r = await query(
      `SELECT ec.*, ei.nome, ei.email, e.nome as evento_nome, e.data_inicio
       FROM evento_certificados ec
       JOIN evento_inscricoes ei ON ei.id=ec.inscricao_id
       JOIN eventos e ON e.id=ei.evento_id
       WHERE ec.codigo_validacao=$1`,
      [req.params.codigo]
    );
    const cert = r.rows[0];
    const config = await getConfig();
    const orgNome = config.org_nome || 'LAURO';
    const orgLogo = config.org_logo || null;
    const orgCor = config.org_cor || '#2b6803';
    const logoHtml = orgLogo
      ? `<div class="logoring"><img src="${orgLogo}" alt="${orgNome}"></div>`
      : `<div style="font-size:22px;font-weight:800;letter-spacing:-.5px;color:${orgCor}">${orgNome}</div>`;
    const baseCss = `*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Sora',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#eef1ee;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;color:#1a2e1a}.wrap{width:100%;max-width:520px}.card{background:#fff;border:1px solid #dde3dd;border-top:4px solid var(--ac);box-shadow:0 12px 40px rgba(20,40,20,.09)}.logo{padding:28px 32px 22px;text-align:center;border-bottom:1px solid #e7eee4;background:linear-gradient(180deg,#ffffff,#f4f8f1)}.logoring{width:88px;height:88px;border-radius:50%;margin:0 auto;background:#fff;border:2px solid var(--green);display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 5px rgba(43,104,3,.08)}.logoring img{width:76px;height:76px;border-radius:50%;object-fit:contain}.cbody{padding:34px 32px}.badge{width:62px;height:62px;display:flex;align-items:center;justify-content:center;color:#fff;background:var(--ac);margin:0 auto 18px}h1{font-size:21px;font-weight:700;text-align:center;margin-bottom:8px;letter-spacing:-.3px}.sub{text-align:center;color:#5a6b5a;font-size:14px;line-height:1.55;max-width:380px;margin:0 auto}.rows{margin-top:26px;border:1px solid #e4e9e4;border-left:3px solid var(--green)}.row{display:flex;padding:13px 16px;border-bottom:1px solid #eef1ee;font-size:14px;gap:14px;transition:background .15s}.row:last-child{border-bottom:0}.row:hover{background:#f3f8f1}.row .k{flex:0 0 118px;color:#6f8566;font-size:11px;text-transform:uppercase;letter-spacing:.7px;font-weight:600;padding-top:2px}.row .v{flex:1;font-weight:600;color:#1a2e1a;word-break:break-word}.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1px;color:var(--green)}.foot{display:flex;align-items:center;justify-content:center;gap:7px;padding:14px;background:#1a4f10;font-size:12px;font-weight:500;color:rgba(255,255,255,.95);letter-spacing:.2px}.foot svg{color:#fff}`;
    const head = (titulo, accent) => `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&display=swap" rel="stylesheet"><style>:root{--ac:${accent};--green:${orgCor}}${baseCss}</style></head><body><div class="wrap"><div class="card"><div class="logo">${logoHtml}</div>`;
    const foot = `<div class="foot"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="1"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>Verificación de autenticidad · ${orgNome}</div></div></div></body></html>`;
    if (!cert) {
      const iconX = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
      return res.send(`${head('Certificado inválido', '#c0392b')}<div class="cbody"><div class="badge">${iconX}</div><h1>Certificado no encontrado</h1><p class="sub">El código ingresado no corresponde a ningún certificado emitido por ${orgNome}. Verifique que lo haya escrito correctamente.</p></div>${foot}`);
    }
    const dt = cert.data_inicio ? new Date(cert.data_inicio).toLocaleDateString('es-PY', {day:'2-digit',month:'long',year:'numeric'}) : '\u2014';
    const emitidoEm = cert.emitido_em ? new Date(cert.emitido_em).toLocaleDateString('es-PY') : '\u2014';
    const iconCheck = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    res.send(`${head('Certificado válido', orgCor)}<div class="cbody"><div class="badge">${iconCheck}</div><h1>Certificado válido</h1><p class="sub">Documento auténtico, emitido y verificado por ${orgNome}.</p><div class="rows"><div class="row"><div class="k">Participante</div><div class="v">${cert.nome}</div></div><div class="row"><div class="k">Evento</div><div class="v">${cert.evento_nome}</div></div><div class="row"><div class="k">Realizado el</div><div class="v">${dt}</div></div><div class="row"><div class="k">Emitido el</div><div class="v">${emitidoEm}</div></div><div class="row"><div class="k">Código</div><div class="v code">${req.params.codigo}</div></div></div></div>${foot}`);
  } catch(e) { res.status(500).send('Error: '+e.message); }
});

// ─── AVALIACAO POS-EVENTO ────────────────────────────────────────────────────
router.post('/eventos/:id/enviar-avaliacao', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const crypto = require('crypto');
    const {enviarWhatsApp} = require('../services/notificacoes');
    const config = await getConfig();
    const appUrl = process.env.APP_URL||'https://liga-urologia.onrender.com';
    const evR = await query('SELECT * FROM eventos WHERE id=$1',[req.params.id]);
    const ev = evR.rows[0];
    if (!ev) return res.json({ok:false,msg:'Evento nao encontrado'});
    const inscrR = await query("SELECT * FROM evento_inscricoes WHERE evento_id=$1 AND status='confirmado'",[req.params.id]);
    let enviados = 0;
    for (const insc of inscrR.rows) {
      const token = crypto.randomBytes(20).toString('hex');
      await query('INSERT INTO evento_avaliacoes (evento_id,inscricao_id,token) VALUES ($1,$2,$3) ON CONFLICT (token) DO NOTHING',[ev.id,insc.id,token]);
      const link = appUrl+'/avaliacao/'+token;
      const msg = (config.org_nome||'LAURO')+'\n\nOla, *'+insc.nome.split(' ')[0]+'*!\n\nObrigado por participar de *'+ev.nome+'*!\n\nResponda nossa pesquisa rapida:\n'+link+'\n\nLeva menos de 2 minutos!';
      if (insc.whatsapp) { try { await enviarWhatsApp(insc.whatsapp,msg); enviados++; } catch(e){} }
    }
    res.json({ok:true,msg:enviados+' pesquisas enviadas!'});
  } catch(e) { res.json({ok:false,msg:e.message}); }
});
router.get('/avaliacao/:token', async (req, res) => {
  try {
    const r = await query('SELECT a.*, e.nome as evento_nome, e.data_inicio, i.nome as participante FROM evento_avaliacoes a JOIN eventos e ON e.id=a.evento_id LEFT JOIN evento_inscricoes i ON i.id=a.inscricao_id WHERE a.token=$1',[req.params.token]);
    if (!r.rows[0]) return res.status(404).send('Link invalido ou expirado.');
    const aval = r.rows[0];
    const config = await getConfig();
    if (aval.respondido) return res.render('pages/avaliacao-respondida',{config,aval});
    res.render('pages/avaliacao-form',{config,aval,token:req.params.token});
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});
router.post('/avaliacao/:token', async (req, res) => {
  try {
    const {nota_geral,nota_conteudo,nota_organizacao,nota_palestrantes,indicaria,gostou,melhorar,sugestoes} = req.body;
    await query(
      'UPDATE evento_avaliacoes SET nota_geral=$1,nota_conteudo=$2,nota_organizacao=$3,nota_palestrantes=$4,indicaria=$5,gostou=$6,melhorar=$7,sugestoes=$8,respondido=true,respondido_em=NOW() WHERE token=$9',
      [parseInt(nota_geral)||null,parseInt(nota_conteudo)||null,parseInt(nota_organizacao)||null,parseInt(nota_palestrantes)||null,indicaria||null,gostou||null,melhorar||null,sugestoes||null,req.params.token]
    );
    const config = await getConfig();
    res.render('pages/avaliacao-obrigado',{config});
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});
router.get('/eventos/:id/avaliacoes', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const config = await getConfig();
    const evR = await query('SELECT * FROM eventos WHERE id=$1',[req.params.id]);
    const av = await query('SELECT a.*, i.nome as participante FROM evento_avaliacoes a LEFT JOIN evento_inscricoes i ON i.id=a.inscricao_id WHERE a.evento_id=$1 ORDER BY a.respondido_em DESC',[req.params.id]);
    res.render('pages/evento-avaliacoes',{config,evento:evR.rows[0],avaliacoes:av.rows,usuario:req.session.usuario});
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});

// ─── LISTA DE ESPERA ─────────────────────────────────────────────────────────
router.post('/inscricao/:id/lista-espera', async (req, res) => {
  try {
    const { nome, email, whatsapp } = req.body;
    if (!nome) return res.json({ok:false, msg:'Nome obrigatório.'});
    const evR = await query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
    const ev = evR.rows[0];
    if (!ev) return res.json({ok:false, msg:'Evento não encontrado.'});
    // Verifica se ja esta na lista
    const jaR = await query('SELECT id FROM evento_lista_espera WHERE evento_id=$1 AND (email=$2 OR whatsapp=$3)', [req.params.id, email||'', whatsapp||'']);
    if (jaR.rows.length > 0) return res.json({ok:false, msg:'Você já está na lista de espera!'});
    await query('INSERT INTO evento_lista_espera (evento_id,nome,email,whatsapp) VALUES ($1,$2,$3,$4)', [req.params.id, nome, email||null, whatsapp||null]);
    // Notifica por WhatsApp
    if (whatsapp) {
      try {
        const {enviarWhatsApp} = require('../services/notificacoes');
        const config = await getConfig();
        const msg = (config.org_nome||'LAURO')+'\n\nOla, *'+nome.split(' ')[0]+'*!\n\nVoce foi adicionado(a) a lista de espera do evento *'+ev.nome+'*.\n\nAssim que uma vaga abrir, voce sera notificado(a) automaticamente!';
        await enviarWhatsApp(whatsapp, msg);
      } catch(e) {}
    }
    res.json({ok:true, msg:'Você foi adicionado(a) à lista de espera! Avisaremos quando uma vaga abrir.'});
  } catch(e) { res.json({ok:false, msg:'Erro: '+e.message}); }
});

router.get('/eventos/:id/lista-espera', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const r = await query('SELECT * FROM evento_lista_espera WHERE evento_id=$1 ORDER BY criado_em ASC', [req.params.id]);
    res.json({ok:true, espera: r.rows});
  } catch(e) { res.json({ok:false}); }
});

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

// ─── ARQUIVOS ─────────────────────────────────────────────────────────────────

router.get('/arquivos', requireAuth, requirePermissao('arquivos'), async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];
  const pastaId = req.query.pasta || null;
  const lixeiraMode = req.query.lixeira === '1';
  const [pastasR, arquivosR, lixeiraR] = await Promise.all([
    query('SELECT * FROM arquivo_pastas WHERE lixeira=0 OR lixeira IS NULL ORDER BY nome'),
    lixeiraMode ? query('SELECT * FROM arquivos WHERE lixeira=1 ORDER BY criado_em DESC') : pastaId ? query('SELECT * FROM arquivos WHERE pasta_id=$1 AND (lixeira=0 OR lixeira IS NULL) ORDER BY nome_original', [pastaId]) : query('SELECT * FROM arquivos WHERE pasta_id IS NULL AND (lixeira=0 OR lixeira IS NULL) ORDER BY nome_original'),
    query('SELECT COUNT(*) n FROM arquivos WHERE lixeira=1')
  ]);
  const todasPastas = pastasR.rows;
  let pastaAtual = pastaId ? todasPastas.find(p => p.id == pastaId) || null : null;
  const arquivos = arquivosR.rows.map(a => {
    const kb = (a.tamanho || 0) / 1024;
    a.tamanho_fmt = kb < 1024 ? kb.toFixed(0) + ' KB' : (kb/1024).toFixed(1) + ' MB';
    const ext = (a.nome_original || '').split('.').pop().toLowerCase();
    const icons = { pdf:'📑', doc:'📝', docx:'📝', xls:'📊', xlsx:'📊', ppt:'📣', pptx:'📣', jpg:'🖼️', jpeg:'🖼️', png:'🖼️', gif:'🖼️', mp4:'🎬', mp3:'🎵', zip:'📦', rar:'📦' };
    a.icone = a.tipo === 'google' ? '🔗' : (icons[ext] || '📄');
    return a;
  });
  res.render('pages/arquivos', { config, usuario: req.session.usuario, msg, erro, todasPastas, pastas: todasPastas, pastaAtual, arquivos, lixeiraMode, lixeiraCount: parseInt(lixeiraR.rows[0].n) });
});

router.get('/cadastro-ligante', async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];
  res.render('pages/cadastro-ligante-publico', { config, msg, erro, form: {} });
});

router.post('/cadastro-ligante', require('../services/arquivos').upload.single('foto'), async (req, res) => {
  const config = await getConfig();
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('foto')(req, res, async (err) => {
      const form = req.body;
      form.whatsapp = form.whatsapp || ((form.ddi||'')+(form.whatsapp_num||'').replace(/\D/g,'')).trim() || null;
      const campos = ['nome','data_nascimento','sexo','email','email_alternativo','whatsapp','rg','cpf','semestre','turma','catraca','orcid','tem_formacao','habilidades','aceita_cargo','contribuicao_grupo','ideia_inovadora','tema_interesse','porque_lauro','apresentacao'];
      const faltando = campos.filter(c => !form[c] || form[c].trim() === '');
      if (form.tem_formacao === 'Sim' && (!form.qual_formacao || form.qual_formacao.trim()==='')) faltando.push('qual_formacao');
      if (form.aceita_cargo === 'Sim' && (!form.qual_cargo || form.qual_cargo.trim()==='')) faltando.push('qual_cargo');
      if (faltando.length > 0) { req.session.erro = ['Preencha todos os campos obrigatórios.']; return res.render('pages/cadastro-ligante-publico', { config, msg: [], erro: req.session.erro, form }); }
      if (!req.file) { req.session.erro = ['A foto é obrigatória para o cadastro.']; return res.render('pages/cadastro-ligante-publico', { config, msg: [], erro: req.session.erro, form }); }
      let foto_chave = null;
      if (req.file) { const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'ligantes'); foto_chave = r.chave; }
      await query(`INSERT INTO ligantes (nome, data_nascimento, sexo, email, email_alternativo, whatsapp, rg, cpf, semestre, turma, catraca, orcid, tem_formacao, qual_formacao, habilidades, aceita_cargo, qual_cargo, contribuicao_grupo, ideia_inovadora, tema_interesse, porque_lauro, apresentacao, foto_chave, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW())`,
      [form.nome, form.data_nascimento, form.sexo, form.email, form.email_alternativo||null, form.whatsapp, form.rg, form.cpf||null, form.semestre, form.turma, form.catraca||null, form.orcid||null, form.tem_formacao||null, form.qual_formacao||null, form.habilidades||null, form.aceita_cargo||null, form.qual_cargo||null, form.contribuicao_grupo||null, form.ideia_inovadora||null, form.tema_interesse||null, form.porque_lauro, form.apresentacao, foto_chave]);
      req.session.msg = ['Cadastro realizado com sucesso! Bem-vindo(a) à LAURO! 🎉'];
      res.redirect('/cadastro-ligante');
    });
  } catch(e) { console.error('Erro cadastro ligante:', e.message); req.session.erro = ['Erro ao salvar cadastro. Tente novamente.']; res.redirect('/cadastro-ligante'); }
});

router.post('/ligantes', requireAuth, requireSecretaria, async (req, res) => {
  const { nome, rg, cpf, email, whatsapp, data_nascimento, sexo, semestre, turma, catraca } = req.body;
  await query('INSERT INTO ligantes (nome,rg,cpf,email,whatsapp,data_nascimento,sexo,semestre,turma,catraca) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [nome,rg,cpf,email,whatsapp,data_nascimento||null,sexo||null,semestre,turma,catraca||null]);
  req.session.msg = ['Ligante cadastrado com sucesso!'];
  res.redirect('/ligantes');
});

router.get('/ligantes', requireAuth, requirePermissao('ligantes'), async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg = [];
  const erro = req.session.erro||[]; req.session.erro = [];
  const sfL = req.query.status || 'ativos';
  let whereAtivo;
  if (sfL === 'pendente') whereAtivo = 'WHERE pendente=true';
  else if (sfL === 'inativos') whereAtivo = 'WHERE ativo=0 AND pendente=false';
  else if (sfL === 'todos') whereAtivo = 'WHERE pendente=false';
  else whereAtivo = 'WHERE ativo=1 AND pendente=false';
  const r = await query('SELECT * FROM ligantes ' + whereAtivo + ' ORDER BY nome ASC');
  const ligantes = r.rows;
  const totR = await query('SELECT COUNT(*) t FROM ligantes WHERE pendente=false');
  const atvR = await query('SELECT COUNT(*) t FROM ligantes WHERE ativo=1 AND pendente=false');
  const pcR = await query('SELECT COUNT(*) n FROM ligantes WHERE pendente=true');
  const total = parseInt(totR.rows[0].t);
  const ativos = parseInt(atvR.rows[0].t);
  const inativos = total - ativos;
  const pendentesCount = parseInt(pcR.rows[0].n);
  res.render('pages/ligantes', { config, usuario: req.session.usuario, ligantes, msg, erro, total, ativos, inativos, statusFiltro: sfL, pendentesCount });
});

router.get('/ligantes/:id/aprovar', requireAuth, requirePermissao('ligantes'), async (req, res) => {
  await query('UPDATE ligantes SET pendente=false, ativo=1 WHERE id=$1', [req.params.id]);
  await logAtividade(req.session.usuario.id, 'LIGANTE_APROTADMo', 'Ligante aprovado ID: ' + req.params.id, req);

  // Libera acesso ao Portal de Membros (senha padrao 123456, obriga trocar no primeiro acesso).
  try {
    const jaTemSenha = await query('SELECT 1 FROM portal_cientifico_senhas WHERE origem_tipo=$1 AND origem_id=$2', ['ligante', req.params.id]);
    if (!jaTemSenha.rows.length) {
      const hashPadrao = await bcryptCient.hash('123456', 10);
      await query('INSERT INTO portal_cientifico_senhas (origem_tipo,origem_id,senha_hash,primeiro_acesso) VALUES ($1,$2,$3,true)', ['ligante', req.params.id, hashPadrao]);
    }
  } catch(e) { console.error('[Portal] Erro ao liberar acesso do ligante:', e.message); }

  // AUTO-CADASTRO FINANCEIRO: ao aprovar ligante, criar membro automaticamente se nao existir
  try {
    const ligR = await query('SELECT * FROM ligantes WHERE id=$1', [req.params.id]);
    const lig = ligR.rows[0];
    if (lig) {
      const cpfVal = lig.cpf || '';
      const emailVal = lig.email || '';
      const jaExiste = await query(
        'SELECT id FROM membros WHERE (cpf IS NOT NULL AND cpf <> $3 AND cpf = $1) OR (email IS NOT NULL AND email <> $3 AND email = $2)',
        [cpfVal, emailVal, '']
      );
      if (jaExiste.rows.length === 0) {
        await query(
          'INSERT INTO membros (nome, cpf, email, whatsapp, data_nascimento, rg, catraca, dia_vencimento, mensalidade, ativo, observacoes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            lig.nome || '',
            lig.cpf || null,
            lig.email || null,
            lig.whatsapp || null,
            lig.data_nascimento || null,
            lig.rg || null,
            lig.catraca || null,
            15,
            25.00,
            1,
            'Cadastro automatico via aprovacao de ligante ID: ' + lig.id
          ]
        );
        console.log('[AUTO-MEMBRO] Criado para ligante:', lig.nome, '| ID ligante:', lig.id);
      } else {
        console.log('[AUTO-MEMBRO] Ja existe membro com CPF/email do ligante:', lig.nome, '- pulando');
      }
    }
  } catch(e) {
    console.error('[AUTO-MEMBRO] Erro ao criar membro automatico:', e.message);
  }

  req.session.msg = ['Ligante aprovado e cadastrado no financeiro automaticamente!'];
  res.redirect('/ligantes?status=pendente');
});

router.get('/ligantes/:id/excluir-pendente', requireAuth, requirePermissao('ligantes'), async (req, res) => {
  await query('DELETE FROM ligantes WHERE id=$1 AND pendente=true', [req.params.id]);
  await logAtividade(req.session.usuario.id, 'LIGANTE_RECUSADO', 'Ligante recusado ID: ' + req.params.id, req);
  req.session.msg = ['Cadastro recusado e removido.'];
  res.redirect('/ligantes?status=pendente');
});

router.post('/ligantes/:id(\\d+)/liberar-edicao', requireAuth, requireSecretaria, async (req, res) => {
  try {
    const r = await query('SELECT edicao_liberada, nome FROM ligantes WHERE id=$1', [req.params.id]);
    if (!r.rows.length) { req.session.erro = ['Ligante não encontrado.']; return res.redirect('/ligantes'); }
    const novo = !r.rows[0].edicao_liberada;
    await query('UPDATE ligantes SET edicao_liberada=$1 WHERE id=$2', [novo, req.params.id]);
    await logAtividade(req.session.usuario.id, novo ? 'LIGANTE_EDICAO_LIBERADA' : 'LIGANTE_EDICAO_BLOQUEADA', r.rows[0].nome, req);
    req.session.msg = [novo ? 'Edição de cadastro liberada para este ligante.' : 'Edição de cadastro bloqueada para este ligante.'];
  } catch(e) { req.session.erro = ['Erro ao alterar edição: ' + e.message]; }
  res.redirect('/ligantes');
});

router.post('/ligantes/grupo/liberar-edicao', requireAuth, requireSecretaria, async (req, res) => {
  const r = await query("SELECT valor FROM configuracoes WHERE chave='edicao_ligantes_grupo'");
  const novo = (r.rows[0]?.valor === '1') ? '0' : '1';
  await query("INSERT INTO configuracoes (chave,valor) VALUES ('edicao_ligantes_grupo',$1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [novo]);
  req.session.msg = [novo === '1' ? 'Edição de cadastro liberada para todos os ligantes.' : 'Edição de cadastro em grupo bloqueada para os ligantes.'];
  res.redirect('/ligantes');
});

router.post('/diretivos/grupo/liberar-edicao', requireAuth, requireSecretaria, async (req, res) => {
  const r = await query("SELECT valor FROM configuracoes WHERE chave='edicao_diretivos_grupo'");
  const novo = (r.rows[0]?.valor === '1') ? '0' : '1';
  await query("INSERT INTO configuracoes (chave,valor) VALUES ('edicao_diretivos_grupo',$1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [novo]);
  req.session.msg = [novo === '1' ? 'Edição de cadastro liberada para todos os diretivos.' : 'Edição de cadastro em grupo bloqueada para os diretivos.'];
  res.redirect('/diretivos');
});

router.post('/ligantes/:id/toggle', requireAuth, requirePermissao('ligantes'), async (req, res) => {
  const r = await query('SELECT ativo, email FROM ligantes WHERE id=$1', [req.params.id]);
  const atual = r.rows[0]?.ativo;
  const novoStatus = atual == 0 ? 1 : 0;
  const motivo = req.body.motivo || null;
  await query('UPDATE ligantes SET ativo=$1 WHERE id=$2', [novoStatus, req.params.id]);
  // Sincronizar membros automaticamente ao inativar/ativar ligante
  try {
    const email = r.rows[0].email;
    const memStatus = novoStatus === 1 ? 'ativo' : 'inativo';
    if (email) await query("UPDATE membros SET ativo=$1, status=$2 WHERE email=$3", [novoStatus, memStatus, email]);
    // Fallback por CPF (cobre casos de email divergente)
    const cpfLig = r.rows[0].cpf;
    if (cpfLig) await query("UPDATE membros SET ativo=$1, status=$2 WHERE regexp_replace(cpf,'[^0-9]','','g')=regexp_replace($3,'[^0-9]','','g')", [novoStatus, memStatus, cpfLig]).catch(()=>{});
    // Fallback por nome exato (último recurso)
    const nomeLig = r.rows[0].nome;
    if (nomeLig) await query("UPDATE membros SET ativo=$1, status=$2 WHERE LOWER(TRIM(nome))=LOWER(TRIM($3))", [novoStatus, memStatus, nomeLig]).catch(()=>{});
    // Cancelar cobranças por CPF e nome também
    if (cpfLig) await query("UPDATE cobrancas SET status='cancelado' WHERE membro_id IN (SELECT id FROM membros WHERE regexp_replace(cpf,'[^0-9]','','g')=regexp_replace($1,'[^0-9]','','g')) AND status IN ('pendente','atrasado')", [cpfLig]).catch(()=>{});
  } catch(e) {}
  if (novoStatus === 0) {
    // Cancelar cobranças pendentes do membro vinculado ao email do ligante
    const ligR = await query('SELECT email FROM ligantes WHERE id=$1', [req.params.id]);
    if (ligR.rows[0]?.email) {
      await query(
        "UPDATE cobrancas SET status='cancelado' WHERE membro_id IN (SELECT id FROM membros WHERE email=$1) AND status IN ('pendente','atrasado')",
        [ligR.rows[0].email]
      );
      // Sincronizar ativo em membros (cadastro financeiro)
      await query("UPDATE membros SET ativo=$1 WHERE email=$2", [novoStatus, ligR.rows[0].email]);
    }
    // Também sincronizar por whatsapp caso email não bata
    if (ligR.rows[0]?.whatsapp) {
      await query("UPDATE membros SET ativo=$1 WHERE whatsapp=$2 AND ($3::text IS NULL OR email IS NULL OR email='')", [novoStatus, ligR.rows[0].whatsapp, ligR.rows[0].email]);
    }
    if (motivo) {
      await query('INSERT INTO inativacoes_log (tipo, referencia_id, motivo, usuario_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', ['ligante', req.params.id, motivo, req.session.usuario.id]).catch(()=>{});
    }
  }
  await logAtividade(req.session.usuario.id, 'LIGANTE_STATUS', 'Status alterado ID: ' + req.params.id + (motivo ? ' — ' + motivo : ''), req);
  req.session.msg = [novoStatus == 1 ? 'Ligante reativado! Cadastro financeiro sincronizado.' : 'Ligante inativado, cobranças canceladas e cadastro financeiro atualizado!'];
  res.redirect('/ligantes');
});

router.get('/ligantes/:id/foto', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT foto_chave FROM ligantes WHERE id=$1', [req.params.id]);
    const ligante = r.rows[0];
    if (!ligante || !ligante.foto_chave) return res.status(404).send('Foto não encontrada');
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const R2 = new S3Client({ region:'auto', endpoint:process.env.R2_ENDPOINT, credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY } });
    const url = await getSignedUrl(R2, new GetObjectCommand({ Bucket: process.env.R2_BUCKET||'liga-urologia-files', Key: ligante.foto_chave }), { expiresIn: 3600 });
    res.redirect(url);
  } catch(e) { res.status(500).send('Erro'); }
});

router.get('/ligantes/:id/editar', requireAuth, requirePermissao('ligantes'), async (req, res) => {
  const config = await getConfig();
  const r = await query('SELECT * FROM ligantes WHERE id=$1', [req.params.id]);
  const ligante = r.rows[0];
  if (!ligante) { req.session.erro=['Ligante não encontrado.']; return res.redirect('/ligantes'); }
  res.render('pages/ligante-editar', { config, usuario: req.session.usuario, ligante, msg: req.session.msg||[], erro: req.session.erro||[] });
  req.session.msg = []; req.session.erro = [];
});

router.post('/ligantes/:id/editar', requireAuth, requirePermissao('ligantes'), async (req, res) => {
  try {
    const {upload,uploadArquivo}=require('../services/arquivos');
    upload.single('foto')(req,res,async(err)=>{
      const b=req.body; let fk=null;
      const _oldEmail=(await query('SELECT email FROM ligantes WHERE id=$1',[req.params.id])).rows[0];
      if(req.file){const r=await uploadArquivo(req.file.buffer,req.file.originalname,req.file.mimetype,'ligantes');fk=r.chave;}
      const fu=fk?',foto_chave=$24':'';
      const p=[b.nome,b.data_nascimento||null,b.sexo,b.email,b.email_alternativo||null,b.whatsapp,b.rg,b.cpf||null,b.semestre,b.turma,b.catraca||null,b.orcid||null,b.tem_formacao||null,b.qual_formacao||null,b.habilidades||null,b.aceita_cargo||null,b.qual_cargo||null,b.contribuicao_grupo||null,b.ideia_inovadora||null,b.tema_interesse||null,b.porque_lauro,b.apresentacao,req.params.id];
      if(fk)p.push(fk);
      await query('UPDATE ligantes SET nome=$1,data_nascimento=$2,sexo=$3,email=$4,email_alternativo=$5,whatsapp=$6,rg=$7,cpf=$8,semestre=$9,turma=$10,catraca=$11,orcid=$12,tem_formacao=$13,qual_formacao=$14,habilidades=$15,aceita_cargo=$16,qual_cargo=$17,contribuicao_grupo=$18,ideia_inovadora=$19,tema_interesse=$20,porque_lauro=$21,apresentacao=$22'+fu+' WHERE id=$23',p);
      // Propaga os dados compartilhados p/ o cadastro FINANCEIRO (membros), casando pelo e-mail
      // anterior. Assim tudo que a secretaria altera reflete na mensalidade automaticamente.
      if(_oldEmail && _oldEmail.email){
        await query("UPDATE membros SET nome=$1, email=COALESCE(NULLIF($2,''),email), cpf=$3, whatsapp=$4, data_nascimento=$5 WHERE LOWER(email)=LOWER($6)",
          [b.nome, b.email, b.cpf||null, b.whatsapp||null, b.data_nascimento||null, _oldEmail.email]).catch(()=>{});
      }
      await logAtividade(req.session.usuario.id,'LIGANTE_EDITADO','Ligante editado: '+b.nome,req);
      req.session.msg=['Ligante atualizado!']; res.redirect('/ligantes');
    });
  } catch(e){req.session.erro=[e.message];res.redirect('/ligantes');}
});

router.post('/ligantes/:id/deletar', requireAuth, requireAdmin, async (req, res) => {
  const r = await query('SELECT nome FROM ligantes WHERE id=$1', [req.params.id]);
  await query('DELETE FROM ligantes WHERE id=$1', [req.params.id]);
  await logAtividade(req.session.usuario.id, 'LIGANTE_DELETADO', 'Ligante excluído: ' + (r.rows[0]?.nome||''), req);
  req.session.msg = ['Ligante excluído com sucesso!'];
  res.redirect('/ligantes');
});
// ─── RELATÓRIO LIGANTES ───────────────────────────────────────────────────────
router.get('/ligantes/relatorio', requireAuth, requirePermissao('ligantes'), async (req, res) => {
  const config = await getConfig();
  const q = req.query;
  const filtros = { status: q.status||'todos', sexo: q.sexo||'todos', semestre: q.semestre||'todos', turma: q.turma||'todos', aceita_cargo: q.aceita_cargo||'todos', tem_formacao: q.tem_formacao||'todos', ordem: q.ordem||'nome', colunas: q.colunas ? (Array.isArray(q.colunas) ? q.colunas : [q.colunas]) : ['nome','email','whatsapp','semestre','turma','rg','catraca','status'] };
  let where = [];
  if (filtros.status === 'ativo') where.push("ativo = 1");
  if (filtros.status === 'inativo') where.push("ativo = 0");
  if (filtros.sexo !== 'todos') where.push(`sexo = '${filtros.sexo.replace(/'/g,"''")}'`);
  if (filtros.semestre !== 'todos') where.push(`semestre = '${filtros.semestre.replace(/'/g,"''")}'`);
  if (filtros.turma !== 'todos') where.push(`turma = '${filtros.turma.replace(/'/g,"''")}'`);
  if (filtros.aceita_cargo !== 'todos') where.push(`aceita_cargo = '${filtros.aceita_cargo.replace(/'/g,"''")}'`);
  if (filtros.tem_formacao !== 'todos') where.push(`tem_formacao = '${filtros.tem_formacao.replace(/'/g,"''")}'`);
  const ordens = { nome:'nome ASC', nome_desc:'nome DESC', idade:'data_nascimento DESC', idade_desc:'data_nascimento ASC', semestre:'semestre ASC', turma:'turma ASC', criado_em:'criado_em DESC' };
  const orderBy = ordens[filtros.ordem] || 'nome ASC';
  const sql = `SELECT * FROM ligantes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy}`;
  const [r, semestresR, turmasR] = await Promise.all([query(sql), query('SELECT DISTINCT semestre FROM ligantes WHERE semestre IS NOT NULL ORDER BY semestre'), query('SELECT DISTINCT turma FROM ligantes WHERE turma IS NOT NULL ORDER BY turma')]);
  const labelColuna = (col) => ({nome:'Nome',email:'E-mail',whatsapp:'WhatsApp',sexo:'Sexo',data_nascimento:'Nascimento',semestre:'Semestre',turma:'Turma',catraca:'Catraca',rg:'RG/CI',cpf:'CPF',orcid:'ORCID',tem_formacao:'Formação',aceita_cargo:'Aceita cargo',habilidades:'Habilidades',status:'Status',criado_em:'Cadastro'}[col] || col);
  res.render('pages/ligantes-relatorio', { config, usuario: req.session.usuario, ligantes: r.rows, filtros, semestres: semestresR.rows.map(x=>x.semestre).filter(Boolean), turmas: turmasR.rows.map(x=>x.turma).filter(Boolean), colunasVisiveis: filtros.colunas, labelColuna, msg: req.session.msg||[], erro: req.session.erro||[] });
  req.session.msg = []; req.session.erro = [];
});

// === RELATORIO DIRETIVOS ===
router.get('/diretivos/relatorio', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const q = req.query;
  const filtros = { status: q.status||'todos', cargo: q.cargo||'todos', semestre_turma: q.semestre_turma||'todos', ordem: q.ordem||'nome', colunas: q.colunas ? (Array.isArray(q.colunas) ? q.colunas : [q.colunas]) : ['nome','email','cargo','semestre_turma','whatsapp','status'] };
  let where = [];
  if (filtros.status === 'ativo') where.push("ativo = 1");
  if (filtros.status === 'inativo') where.push("ativo = 0");
  if (filtros.cargo !== 'todos') where.push(`cargo = '${filtros.cargo.replace(/'/g,"''")}'`);
  if (filtros.semestre_turma !== 'todos') where.push(`semestre_turma = '${filtros.semestre_turma.replace(/'/g,"''")}'`);
  const ordens = { nome:'nome ASC', nome_desc:'nome DESC', cargo:'cargo ASC', semestre_turma:'semestre_turma ASC', cadastrado_em:'cadastrado_em DESC' };
  const orderBy = ordens[filtros.ordem] || 'nome ASC';
  const sql = `SELECT * FROM diretivos ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy}`;
  const [r, cargosR, semestresR] = await Promise.all([
    query(sql),
    query("SELECT DISTINCT cargo FROM diretivos WHERE cargo IS NOT NULL AND cargo <> '' ORDER BY cargo"),
    query("SELECT DISTINCT semestre_turma FROM diretivos WHERE semestre_turma IS NOT NULL AND semestre_turma <> '' ORDER BY semestre_turma")
  ]);
  const labelColuna = (col) => ({nome:'Nome',email:'E-mail',whatsapp:'WhatsApp',instagram:'Instagram',cargo:'Cargo',semestre_turma:'Semestre/Turma',catraca:'Catraca',rg:'RG/CI',cpf:'CPF',data_nascimento:'Nascimento',ano_ingresso:'Ano ingresso',orcid:'ORCID',status:'Status',cadastrado_em:'Cadastro'}[col] || col);
  res.render('pages/diretivos-relatorio', { config, usuario: req.session.usuario, diretivos: r.rows, filtros, cargos: cargosR.rows.map(x=>x.cargo).filter(Boolean), semestresTurmas: semestresR.rows.map(x=>x.semestre_turma).filter(Boolean), colunasVisiveis: filtros.colunas, labelColuna, msg: req.session.msg||[], erro: req.session.erro||[] });
  req.session.msg = []; req.session.erro = [];
});

// ─── ARQUIVOS FINANCEIROS ─────────────────────────────────────────────────────

router.get('/financeiro-arquivos', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const pastaAtual = req.query.pasta || null;
  const [pastasR, arquivosR] = await Promise.all([
    query('SELECT * FROM financeiro_pastas ORDER BY nome'),
    query('SELECT * FROM financeiro_arquivos WHERE pasta_id' + (pastaAtual ? '=$1 ORDER BY criado_em DESC' : ' IS NULL ORDER BY criado_em DESC'), pastaAtual ? [pastaAtual] : [])
  ]);
  res.render('pages/financeiro-arquivos', { config, usuario: req.session.usuario, msg, erro, pastas: pastasR.rows, arquivos: arquivosR.rows, pastaAtual });
});

router.post('/financeiro-arquivos/pasta', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  const { nome, pai_id } = req.body;
  const pasta_id = pai_id && pai_id !== '' ? pai_id : null;
  await query('INSERT INTO financeiro_pastas (nome, pai_id, criado_por) VALUES ($1,$2,$3)', [nome, pasta_id, req.session.usuario.id]);
  req.session.msg = ['Pasta criada com sucesso!'];
  res.redirect(pasta_id ? '/financeiro-arquivos?pasta=' + pasta_id : '/financeiro-arquivos');
});

router.post('/financeiro-arquivos/upload', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.array('arquivos', 20)(req, res, async (err) => {
      if (!req.files || req.files.length===0) { req.session.erro=['Nenhum arquivo.']; return res.redirect('/financeiro-arquivos'); }
      const pasta_id = req.body.pasta_id && req.body.pasta_id !== '' ? req.body.pasta_id : null;
      for (const file of req.files) { const nome = req.body.nome || file.originalname; const r = await uploadArquivo(file.buffer, file.originalname, file.mimetype, 'financeiro'); await query('INSERT INTO financeiro_arquivos (nome,tipo,chave_r2,mimetype,tamanho,pasta_id,enviado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)', [nome, 'upload', r.chave, file.mimetype, file.size, pasta_id, req.session.usuario.id]); }
      req.session.msg = ['Arquivo enviado com sucesso!'];
      res.redirect('/financeiro-arquivos' + (pasta_id ? '?pasta='+pasta_id : ''));
    });
  } catch(e) { req.session.erro=['Erro: '+e.message]; res.redirect('/financeiro-arquivos'); }
});

router.post('/financeiro-arquivos/google', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  const { nome, google_url, google_tipo, pasta_id } = req.body;
  const pid = pasta_id && pasta_id !== '' ? pasta_id : null;
  let embed = google_url;
  if (google_url.includes('docs.google.com')) embed = google_url.replace(/\/edit.*$/, '/edit?embedded=true&rm=minimal');
  else if (google_url.includes('drive.google.com/file')) { const m = google_url.match(/\/d\/([^/]+)/); if (m) embed = 'https://drive.google.com/file/d/' + m[1] + '/preview'; }
  await query('INSERT INTO financeiro_arquivos (nome,tipo,google_url,google_embed,pasta_id,enviado_por) VALUES ($1,$2,$3,$4,$5,$6)', [nome, 'google', google_url, embed, pid, req.session.usuario.id]);
  req.session.msg = ['Link do Google adicionado!'];
  res.redirect('/financeiro-arquivos' + (pid ? '?pasta='+pid : ''));
});

router.get('/financeiro-arquivos/:id/visualizar', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  try {
    const r = await query('SELECT * FROM financeiro_arquivos WHERE id=$1', [req.params.id]);
    const a = r.rows[0];
    if (!a || !a.chave_r2) return res.status(404).send('Não encontrado');
    const { getUrlAssinada } = require('../services/desligamento');
    res.redirect(await getUrlAssinada(a.chave_r2));
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.get('/financeiro-arquivos/:id/download', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  try {
    const r = await query('SELECT * FROM financeiro_arquivos WHERE id=$1', [req.params.id]);
    const a = r.rows[0];
    if (!a || !a.chave_r2) return res.status(404).send('Não encontrado');
    const { getUrlAssinada } = require('../services/desligamento');
    res.redirect(await getUrlAssinada(a.chave_r2));
  } catch(e) { res.status(500).send('Erro'); }
});

router.post('/financeiro-arquivos/:id/deletar', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  const r = await query('SELECT pasta_id FROM financeiro_arquivos WHERE id=$1', [req.params.id]);
  const pid = r.rows[0]?.pasta_id;
  await query('DELETE FROM financeiro_arquivos WHERE id=$1', [req.params.id]);
  req.session.msg = ['Arquivo excluído!'];
  res.redirect('/financeiro-arquivos' + (pid ? '?pasta='+pid : ''));
});

router.post('/financeiro-pastas/:id/deletar', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  await query('DELETE FROM financeiro_arquivos WHERE pasta_id=$1', [req.params.id]);
  await query('DELETE FROM financeiro_pastas WHERE id=$1', [req.params.id]);
  req.session.msg = ['Pasta excluída!'];
  res.redirect('/financeiro-arquivos');
});

router.post('/financeiro-arquivos/deletar-multiplos', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  try {
    const ids = req.body.ids ? (Array.isArray(req.body.ids) ? req.body.ids : [req.body.ids]) : [];
    const pasta_id = req.body.pasta_id || null;
    for (const id of ids) { await query('DELETE FROM financeiro_arquivos WHERE id=$1', [id]); }
    req.session.msg = [ids.length + ' arquivo(s) excluído(s)!'];
    res.redirect('/financeiro-arquivos' + (pasta_id ? '?pasta=' + pasta_id : ''));
  } catch(e) { req.session.erro=['Erro: '+e.message]; res.redirect('/financeiro-arquivos'); }
});

router.post('/financeiro-arquivos/:id/mover', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  try { await query('UPDATE financeiro_arquivos SET pasta_id=$1 WHERE id=$2', [req.body.pasta_id||null, req.params.id]); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ erro: e.message }); }
});

router.post('/financeiro-pastas/:id/mover', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  try {
    const pai_id = req.body.pai_id || null;
    if (String(pai_id) === String(req.params.id)) return res.status(400).json({ erro: 'Não pode mover para si mesmo' });
    await query('UPDATE financeiro_pastas SET pai_id=$1 WHERE id=$2', [pai_id, req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

router.post('/arquivos/google', requireAuth, async (req, res) => {
  const { nome, google_url, pasta_id } = req.body;
  const pid = pasta_id && pasta_id !== '' ? pasta_id : null;
  let embed = google_url;
  if (google_url && google_url.includes('docs.google.com')) embed = google_url.replace(/\/edit.*$/, '/edit?embedded=true&rm=minimal');
  else if (google_url && google_url.includes('drive.google.com/file')) { const m = google_url.match(/\/d\/([^/]+)/); if (m) embed = 'https://drive.google.com/file/d/' + m[1] + '/preview'; }
  await query('INSERT INTO arquivos (nome_original, tipo, google_url, google_embed, pasta_id, enviado_por) VALUES ($1,$2,$3,$4,$5,$6)', [nome, 'google', google_url, embed, pid, req.session.usuario.id]);
  req.session.msg = ['Link Google adicionado!'];
  res.redirect('/arquivos' + (pid ? '?pasta=' + pid : ''));
});

router.post('/arquivos/:id/renomear', requireAuth, async (req, res) => {
  await query('UPDATE arquivos SET nome_original=$1 WHERE id=$2', [req.body.nome, req.params.id]);
  res.json({ ok: true });
});

router.post('/arquivos/:id/mover', requireAuth, async (req, res) => {
  await query('UPDATE arquivos SET pasta_id=$1 WHERE id=$2', [req.body.pasta_id||null, req.params.id]);
  res.json({ ok: true });
});

router.post('/arquivos/pasta/:id/mover', requireAuth, async (req, res) => {
  await query('UPDATE arquivo_pastas SET pasta_pai_id=$1 WHERE id=$2', [req.body.pasta_pai_id||null, req.params.id]);
  res.json({ ok: true });
});

router.post('/arquivos/:id/lixeira', requireAuth, async (req, res) => { await query('UPDATE arquivos SET lixeira=1 WHERE id=$1', [req.params.id]); res.json({ ok: true }); });
router.post('/arquivos/:id/restaurar', requireAuth, async (req, res) => { await query('UPDATE arquivos SET lixeira=0 WHERE id=$1', [req.params.id]); res.json({ ok: true }); });
router.post('/arquivos/lixeira/esvaziar', requireAuth, requireAdmin, async (req, res) => { await query('DELETE FROM arquivos WHERE lixeira=1'); res.json({ ok: true }); });
router.post('/arquivos/pasta/:id/lixeira', requireAuth, async (req, res) => { await query('UPDATE arquivo_pastas SET lixeira=1 WHERE id=$1', [req.params.id]); res.json({ ok: true }); });

router.post('/arquivos/pasta/:id/editar', requireAuth, async (req, res) => {
  const { nome, icone, cor } = req.body;
  await query('UPDATE arquivo_pastas SET nome=$1, icone=$2, cor=$3 WHERE id=$4', [nome, icone||'📁', cor||null, req.params.id]);
  req.session.msg = ['Pasta atualizada!'];
  const pasta = await query('SELECT pasta_pai_id FROM arquivo_pastas WHERE id=$1', [req.params.id]);
  const pid = pasta.rows[0]?.pasta_pai_id;
  res.redirect('/arquivos' + (pid ? '?pasta=' + pid : '?pasta=' + req.params.id));
});

router.get("/arquivos/:id/visualizar", requireAuth, async (req, res) => {
  try {
    const r = await query("SELECT * FROM arquivos WHERE id=$1", [req.params.id]);
    const a = r.rows[0];
    if (!a) return res.status(404).send("Nao encontrado");
    if (a.tipo === "google" && a.google_embed) return res.redirect(a.google_embed);
    const { gerarUrlInline } = require("../services/arquivos");
    res.redirect(await gerarUrlInline(a.chave_r2, a.mimetype));
  } catch(e) { res.status(500).send("Erro: " + e.message); }
});

router.get("/arquivos/:id/download", requireAuth, async (req, res) => {
  try {
    const r = await query("SELECT * FROM arquivos WHERE id=$1", [req.params.id]);
    const a = r.rows[0];
    if (!a || !a.chave_r2) return res.status(404).send("Nao encontrado");
    const { gerarUrlDownload } = require("../services/arquivos");
    res.redirect(await gerarUrlDownload(a.chave_r2, a.nome_original || "arquivo"));
  } catch(e) { res.status(500).send("Erro"); }
});

router.post("/arquivos/:id/deletar", requireAuth, async (req, res) => {
  await query("DELETE FROM arquivos WHERE id=$1", [req.params.id]);
  req.session.msg = ["Arquivo excluido!"];
  res.redirect("/arquivos");
});

router.post("/arquivos/:id/substituir", requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require("../services/arquivos");
    upload.single("arquivo")(req, res, async (err) => {
      if (!req.file) { req.session.erro = ["Sem arquivo"]; return res.redirect("/arquivos"); }
      const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, "liga");
      await query("UPDATE arquivos SET chave_r2=$1,mimetype=$2,tamanho=$3,nome_original=$4 WHERE id=$5", [r.chave, req.file.mimetype, req.file.size, req.file.originalname, req.params.id]);
      req.session.msg = ["Substituido!"]; res.redirect("/arquivos");
    });
  } catch(e) { req.session.erro = [e.message]; res.redirect("/arquivos"); }
});

router.post("/arquivos/upload", requireAuth, async (req, res) => {
  try {
    const { upload, uploadArquivo } = require("../services/arquivos");
    upload.single("arquivo")(req, res, async (err) => {
      if (!req.file) return res.status(400).json({ erro: "Sem arquivo" });
      const pid = req.body.pasta_id || null;
      const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, "liga");
      await query("INSERT INTO arquivos (nome_original,chave_r2,mimetype,tamanho,pasta_id,enviado_por,ativo) VALUES ($1,$2,$3,$4,$5,$6,1)", [req.file.originalname, r.chave, req.file.mimetype, req.file.size, pid||null, req.session.usuario.id]);
      res.json({ ok: true });
    });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

router.get("/google/auth", requireAuth, requireAdmin, (req, res) => {
  const { getAuthUrl } = require("../services/google-drive");
  res.redirect(getAuthUrl());
});

router.get("/google/callback", requireAuth, async (req, res) => {
  try {
    const { getTokens } = require("../services/google-drive");
    const tokens = await getTokens(req.query.code);
    await query("INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2", ["google_tokens", JSON.stringify(tokens)]);
    req.session.msg = ["Google Drive conectado com sucesso!"];
    res.redirect("/configuracoes");
  } catch(e) { req.session.erro = ["Erro ao conectar Google Drive: " + e.message]; res.redirect("/configuracoes"); }
});

router.post("/arquivos/upload-drive", requireAuth, async (req, res) => {
  try {
    const { upload } = require("../services/arquivos");
    const { uploadParaDrive } = require("../services/google-drive");
    upload.single("arquivo")(req, res, async (err) => {
      if (!req.file) return res.status(400).json({ erro: "Sem arquivo" });
      const tokensR = await query("SELECT valor FROM configuracoes WHERE chave='google_tokens'");
      if (!tokensR.rows[0]) return res.status(400).json({ erro: "Google Drive nao conectado. Va em Configuracoes e conecte." });
      const tokens = JSON.parse(tokensR.rows[0].valor);
      const pasta_id = req.body.pasta_id || null;
      const result = await uploadParaDrive(tokens, req.file.buffer, req.file.originalname, req.file.mimetype);
      await query("INSERT INTO arquivos (nome_original, tipo, google_url, google_embed, pasta_id, enviado_por, ativo) VALUES ($1,$2,$3,$4,$5,$6,1)", [req.file.originalname, "google", result.webViewLink, result.embedUrl, pasta_id||null, req.session.usuario.id]);
      res.json({ ok: true, embedUrl: result.embedUrl });
    });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

router.get("/arquivos/:id/url", requireAuth, async (req, res) => {
  try {
    const r = await query("SELECT chave_r2 FROM arquivos WHERE id=$1", [req.params.id]);
    const a = r.rows[0];
    if (!a || !a.chave_r2) return res.status(404).json({ erro: "Nao encontrado" });
    const { getUrlAssinada } = require("../services/desligamento");
    res.json({ url: await getUrlAssinada(a.chave_r2) });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

router.get('/financeiro-arquivos/:id/url', requireAuth, requirePermissao('financeiro-arquivos'), async (req, res) => {
  try {
    const r = await query('SELECT chave_r2 FROM financeiro_arquivos WHERE id=$1', [req.params.id]);
    const a = r.rows[0];
    if (!a || !a.chave_r2) return res.status(404).json({ erro: 'Nao encontrado' });
    const { getUrlAssinada } = require('../services/desligamento');
    res.json({ url: await getUrlAssinada(a.chave_r2) });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// ─── MARKETING ────────────────────────────────────────────────────────────────

async function getMktConfig() {
  const r = await query('SELECT chave,valor FROM marketing_config');
  const cfg = {}; r.rows.forEach(row => cfg[row.chave] = row.valor); return cfg;
}

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
  res.render('pages/marketing', { config, usuario: req.session.usuario, msg, erro, posts, midias: midiasR.rows, mktConfig, igPct, fbPct, waPct, canvaConectado, equipeLigantes, equipeDiretivos, siteBanners, siteVideoUrl, marcaDaguaUrl, galerias, aniversarioAtivo, aniversarioTemplateUrl, aniversariantesHoje: aniversariantesHojeR.rows, aniversariantesMes: aniversariantesMesR.rows, nomeMesAtual, eventosInternos: eventosInternosR.rows, notas: notasR.rows });
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

// ─── CONTRATOS DIRETIVOS ───────────────────────────────────────────────────────

router.get('/contratos-diretivos', requireAuth, requirePermissao('contratos-diretivos'), async (req, res) => {
  const config = await getConfig();
  const tgR = await query("SELECT valor FROM configuracoes WHERE chave='contrato_dir_texto_global'");
  const textoGlobalDir = tgR.rows[0]?.valor || '';
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const [cR, dR] = await Promise.all([
    query(`SELECT c.*, d.nome as diretivo_nome, d.email as diretivo_email FROM contratos_diretivos c LEFT JOIN diretivos d ON d.id=c.diretivo_id ORDER BY c.criado_em DESC`),
    query(`SELECT id, nome, email, cargo FROM diretivos WHERE ativo=1 ORDER BY nome`)
  ]);
  const turmaFiltro = req.query.turma || '';
  const statusFiltro = req.query.status || '';
  const todos = cR.rows;
  const diretivos = dR.rows;
  const idsComContrato = new Set(todos.map(c => c.diretivo_id));
  const semContrato = diretivos.filter(d => !idsComContrato.has(d.id));
  const statsTotal = todos.length;
  const statsAssinados = todos.filter(c => c.assinado_em).length;
  const statsPendentes = statsTotal - statsAssinados;
  let contratos = todos;
  if (statusFiltro === 'assinado') contratos = todos.filter(c => c.assinado_em);
  else if (statusFiltro === 'pendente') contratos = todos.filter(c => !c.assinado_em);
  const turmas = [];
  res.render('pages/contratos-diretivos', { config, usuario: req.session.usuario, msg, erro, contratos, diretivos, textoGlobalDir, turmaFiltro, statusFiltro, turmas, semContrato, statsTotal, statsAssinados, statsPendentes });
});

router.post('/contratos-diretivos', requireAuth, requirePermissao('contratos-diretivos'), async (req, res) => {
  try {
    const { diretivo_id, data_inicio } = req.body;
    const tgR = await query("SELECT valor FROM configuracoes WHERE chave='contrato_dir_texto_global'");
    const texto_contrato = tgR.rows[0]?.valor || '';
    await query('INSERT INTO contratos_diretivos (diretivo_id, texto_contrato, data_inicio, criado_por) VALUES ($1,$2,$3,$4)', [diretivo_id, texto_contrato, data_inicio||null, req.session.usuario.id]);
    req.session.msg = ['Contrato gerado!'];
  } catch(e) { req.session.erro = [e.message]; }
  res.redirect('/contratos-diretivos');
});

router.post('/contratos-diretivos/:id/editar', requireAuth, requirePermissao('contratos-diretivos'), async (req, res) => {
  try {
    await query('UPDATE contratos_diretivos SET texto_contrato=$1 WHERE id=$2', [req.body.texto_contrato, req.params.id]);
    req.session.msg = ['Contrato atualizado!'];
  } catch(e) { req.session.erro = [e.message]; }
  res.redirect('/contratos-diretivos');
});

router.post('/contratos-diretivos/:id/deletar', requireAuth, requireAdmin, async (req, res) => {
  await query('DELETE FROM contratos_diretivos WHERE id=$1', [req.params.id]);
  req.session.msg = ['Excluido!']; res.redirect('/contratos-diretivos');
});

router.post('/contratos-diretivos/timbrado', requireAuth, requirePermissao('contratos-diretivos'), async (req, res) => {
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('timbrado_contrato')(req, res, async (err) => {
      if (!req.file) { req.session.erro=['Sem arquivo']; return res.redirect('/contratos-diretivos'); }
      const resultado = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'timbrados');
      await query("INSERT INTO configuracoes(chave,valor) VALUES('timbrado_contrato_chave',$1) ON CONFLICT(chave) DO UPDATE SET valor=$1", [resultado.chave]);
      req.session.msg=['Timbrado atualizado!']; res.redirect('/contratos-diretivos');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/contratos-diretivos'); }
});

router.post('/contratos-diretivos/texto-global', requireAuth, requirePermissao('contratos-diretivos'), async (req, res) => {
  try {
    const texto_contrato = req.body?.texto_contrato || '';
    await query('UPDATE contratos_diretivos SET texto_contrato=$1', [texto_contrato]);
    await query("INSERT INTO configuracoes(chave,valor) VALUES('contrato_dir_texto_global',$1) ON CONFLICT(chave) DO UPDATE SET valor=$1", [texto_contrato]);
    req.session.msg=['Texto atualizado!']; res.redirect('/contratos-diretivos');
  } catch(e) { req.session.erro=[e.message]; res.redirect('/contratos-diretivos'); }
});

router.get('/contratos-diretivos/:id/pdf', requireAuth, requirePermissao('contratos-diretivos'), async (req, res) => {
  try {
    const r = await query('SELECT c.*, d.nome, d.rg, d.email, d.cargo FROM contratos_diretivos c LEFT JOIN diretivos d ON d.id=c.diretivo_id WHERE c.id=$1', [req.params.id]);
    const d = r.rows[0];
    if (!d) return res.status(404).send('Nao encontrado');
    const config = await getConfig();
    const { imagemBase64 } = require('../services/desligamento');
    config.timbrado_b64 = await imagemBase64(config.timbrado_contrato_chave || config.timbrado_chave);
    config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
    config.assinatura_vicepresidente_b64 = await imagemBase64(config.assinatura_vicepresidente_chave);
    config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
    // Gerar PDF pdfkit
    const pdfBuffer = await gerarPDFContratoDir(d, config);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="contrato-diretivo.pdf"');
    res.send(pdfBuffer);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.get('/contratos-diretivos/:id/imprimir', requireAuth, requirePermissao('contratos-diretivos'), async (req, res) => {
  res.redirect('/contratos-diretivos/'+req.params.id+'/pdf');
});

router.post('/contratos-diretivos/:id/enviar', requireAuth, requirePermissao('contratos-diretivos'), async (req, res) => {
  try {
    const r = await query('SELECT c.*, d.nome, d.rg, d.email, d.cargo FROM contratos_diretivos c LEFT JOIN diretivos d ON d.id=c.diretivo_id WHERE c.id=$1', [req.params.id]);
    const d = r.rows[0];
    if (!d||!d.email) { req.session.erro=['Email nao cadastrado.']; return res.redirect('/contratos-diretivos'); }
    const config = await getConfig();
    const { imagemBase64 } = require('../services/desligamento');
    config.timbrado_b64 = await imagemBase64(config.timbrado_contrato_chave || config.timbrado_chave);
    config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
    config.assinatura_vicepresidente_b64 = await imagemBase64(config.assinatura_vicepresidente_chave);
    config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
    const pdfBuffer = await gerarPDFContratoDir(d, config);
    await enviarEmail({
      from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>',
      to: d.email,
      subject: 'Contrato Diretivo — LAURO',
      html: emailBonito('Contrato Diretivo — LAURO',
        '<p>Prezado(a) <strong>' + d.nome + '</strong>,</p>' +
        '<p>Segue em anexo seu <strong>Contrato de Diretivo</strong> da Liga Acadêmica de Urologia LAURO.</p>' +
        '<p>Por favor, assine o documento e devolva-o assinado à secretaria.</p>' +
        '<p style="margin-top:16px">Atenciosamente,<br><strong>Secretaria — LAURO</strong></p>'
      ),
      attachments: [{ filename: 'contrato-diretivo-LAURO.pdf', content: pdfBuffer.toString('base64') }]
    });
    await query('UPDATE contratos_diretivos SET status=$1,enviado_em=NOW() WHERE id=$2',['enviado',req.params.id]);
    req.session.msg=['Contrato enviado para '+d.email+'!'];
  } catch(e) { req.session.erro=[e.message]; }
  res.redirect('/contratos-diretivos');
});

router.post('/contratos-diretivos/:id/assinado', requireAuth, requirePermissao('contratos-diretivos'), async (req, res) => {
  try {
    upload.single('pdf_assinado')(req, res, async (err) => {
      if (err||!req.file) { req.session.erro=['Erro no upload.']; return res.redirect('/contratos-diretivos'); }
      const { uploadArquivo } = require('../services/arquivos');
      const r = await uploadArquivo(req.file.buffer,'contrato-dir-'+req.params.id+'.pdf',req.file.mimetype,'contratos');
      await query('UPDATE contratos_diretivos SET pdf_assinado_chave=$1,status=$2,assinado_em=NOW() WHERE id=$3',[r.chave,'assinado',req.params.id]);
      req.session.msg=['Contrato assinado anexado!']; res.redirect('/contratos-diretivos');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/contratos-diretivos'); }
});

router.get('/contratos-diretivos/:id/assinado', requireAuth, requirePermissao('contratos-diretivos'), async (req, res) => {
  try {
    const r = await query('SELECT pdf_assinado_chave FROM contratos_diretivos WHERE id=$1',[req.params.id]);
    const d = r.rows[0];
    if (!d||!d.pdf_assinado_chave) return res.status(404).send('Nao encontrado');
    const { getUrlAssinada } = require('../services/desligamento');
    const url = await getUrlAssinada(d.pdf_assinado_chave);
    res.redirect(url);
  } catch(e) { res.status(500).send(e.message); }
});



// ── CATEGORIAS DO CALENDÁRIO ──
router.get('/calendario/categorias', requireAuth, requirePermissao('calendario'), async (req, res) => {
  try {
    const r = await query('SELECT * FROM calendario_categorias ORDER BY criado_em');
    res.json(r.rows);
  } catch(e) { res.json([]); }
});

router.post('/calendario/categorias', requireAuth, requirePermissao('calendario'), async (req, res) => {
  try {
    const { nome, cor } = req.body;
    if(!nome) return res.json({ok:false, erro:'Nome obrigatório'});
    await query('INSERT INTO calendario_categorias (nome,cor,criado_por) VALUES ($1,$2,$3)', [nome, cor||'#2b6803', req.session.usuario.id]);
    res.json({ok:true});
  } catch(e) { res.json({ok:false, erro:e.message}); }
});

router.delete('/calendario/categorias/:id', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM calendario_categorias WHERE id=$1', [req.params.id]);
    res.json({ok:true});
  } catch(e) { res.json({ok:false, erro:e.message}); }
});



// Helper para buscar atividades
async function getAniversarios(anoRef) {
  const r = await query(`
    SELECT nome, data_nascimento::date as data_nascimento, 'membro' as tipo FROM membros
      WHERE ativo=1 AND data_nascimento IS NOT NULL
    UNION ALL
    SELECT nome, data_nascimento::date as data_nascimento, 'diretivo' as tipo FROM diretivos
      WHERE ativo=1 AND data_nascimento IS NOT NULL
  `);

  const aniversarios = [];
  const anos = [anoRef - 1, anoRef, anoRef + 1];

  r.rows.forEach(m => {
    const nasc = new Date(m.data_nascimento);
    const dia = nasc.getUTCDate();
    const mes = nasc.getUTCMonth(); // 0-11

    anos.forEach(ano => {
      const dataAniv = new Date(Date.UTC(ano, mes, dia));
      aniversarios.push({
        id: `aniv-${m.tipo}-${m.nome}-${ano}`,
        titulo: `🎂 Aniversário — ${m.nome}`,
        descricao: `${m.tipo === 'membro' ? 'Ligante' : 'Diretivo'} ${m.nome} faz aniversário hoje!`,
        categoria: 'Aniversario',
        cor: '#f97316',
        data_inicio: dataAniv.toISOString(),
        data_fim: null,
        dia_inteiro: true,
        local: null,
        link_externo: null,
        publico: false, // não aparece na agenda pública
        criado_em: new Date().toISOString()
      });
    });
  });

  return aniversarios;
}

async function getAtividades(apenasPublicas = false, incluirAniversarios = false) {
  const where = apenasPublicas ? 'WHERE publico = TRUE' : '';
  const r = await query(`SELECT * FROM calendario_atividades ${where} ORDER BY data_inicio`);
  let atividades = r.rows;

  if (incluirAniversarios) {
    const anivs = await getAniversarios(new Date().getFullYear());
    atividades = [...atividades, ...anivs];
  }

  return atividades;
}


// PAINEL INTERNO
router.get('/calendario', requireAuth, requirePermissao('calendario'), async (req, res) => {
  try {
    const atividades = await getAtividades(false, true);
    res.render('pages/calendario', {
      config: await getConfig(),
      usuario: req.session.usuario,
      paginaAtual: 'calendario',
      atividades: atividades,
      msg: req.flash('msg'),
      erro: req.flash('erro')
    });
  } catch(e) {
    console.error('ERRO CALENDARIO:', e.message);
    res.send('ERRO: ' + e.message);
  }
});

// PÁGINA PÚBLICA (sem login)
// Mantém o mês/ano que o usuário estava vendo ao criar/editar/excluir uma atividade
function calendarioRedirect(req) {
  const mes = parseInt(req.query.mes, 10);
  const ano = parseInt(req.query.ano, 10);
  if (Number.isInteger(mes) && Number.isInteger(ano)) return `/calendario?mes=${mes}&ano=${ano}`;
  return '/calendario';
}

// CRIAR ATIVIDADE
router.post('/calendario/novo', requireAuth, requirePermissao('calendario'), async (req, res) => {
  try {
    const { titulo, descricao, categoria, cor, data_inicio, data_fim, local, link_externo } = req.body;
    const dia_inteiro = req.body.dia_inteiro === 'true';
    const publico = req.body.publico === 'true';
    await query(
      `INSERT INTO calendario_atividades (titulo,descricao,categoria,cor,data_inicio,data_fim,dia_inteiro,local,link_externo,publico,criado_por,criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
      [titulo, descricao||null, categoria, cor||'#2b6803',
       data_inicio, data_fim||null, dia_inteiro, local||null,
       link_externo||null, publico, req.session.usuario.id]
    );
    req.flash('msg', ['Atividade criada com sucesso!']);
    res.redirect(calendarioRedirect(req));
  } catch(e) { req.flash('erro', [e.message]); res.redirect(calendarioRedirect(req)); }
});

// EDITAR ATIVIDADE
router.post('/calendario/:id/editar', requireAuth, requirePermissao('calendario'), async (req, res) => {
  try {
    const { titulo, descricao, categoria, cor, data_inicio, data_fim, local, link_externo } = req.body;
    const dia_inteiro = req.body.dia_inteiro === 'true';
    const publico = req.body.publico === 'true';
    await query(
      `UPDATE calendario_atividades SET titulo=$1,descricao=$2,categoria=$3,cor=$4,data_inicio=$5,data_fim=$6,dia_inteiro=$7,local=$8,link_externo=$9,publico=$10 WHERE id=$11`,
      [titulo, descricao||null, categoria, cor||'#2b6803',
       data_inicio, data_fim||null, dia_inteiro, local||null,
       link_externo||null, publico, req.params.id]
    );
    req.flash('msg', ['Atividade atualizada!']);
    res.redirect(calendarioRedirect(req));
  } catch(e) { req.flash('erro', [e.message]); res.redirect(calendarioRedirect(req)); }
});

// EXCLUIR ATIVIDADE
router.post('/calendario/:id/excluir', requireAuth, requirePermissao('calendario'), async (req, res) => {
  try {
    await query('DELETE FROM calendario_atividades WHERE id=$1', [req.params.id]);
    req.flash('msg', ['Atividade excluída.']);
    res.redirect(calendarioRedirect(req));
  } catch(e) { req.flash('erro', [e.message]); res.redirect(calendarioRedirect(req)); }
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



// ═══════════════════════════════════════════════════════════════════════════
// CHECK-OUT DE EVENTOS — confirmação de presença
// ═══════════════════════════════════════════════════════════════════════════

// Página pública de check-out
router.get('/checkout/:id', async (req, res) => {
  try {
    const evR = await query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
    if (!evR.rows[0]) return res.status(404).send('Evento não encontrado.');
    const evento = evR.rows[0];
    const cfgPub = await getConfig();
    // Verifica se está aberto (flag manual) e dentro do prazo (se houver)
    let aberto = evento.checkout_aberto === true;
    if (aberto && evento.checkout_fecha_em && new Date(evento.checkout_fecha_em) < new Date()) aberto = false;
    res.render('pages/evento-checkout-publico', { evento, config: cfgPub, aberto, sucesso: false, jaConfirmado: false, erro: null, nome: null });
  } catch(e) { console.error('Checkout GET erro:', e.message); res.status(500).send('Erro ao carregar.'); }
});

// Registrar check-out (público)
router.post('/checkout/:id', async (req, res) => {
  try {
    const evR = await query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
    if (!evR.rows[0]) return res.status(404).send('Evento não encontrado.');
    const evento = evR.rows[0];
    const cfgPub = await getConfig();

    // Revalida abertura no servidor (segurança)
    let aberto = evento.checkout_aberto === true;
    if (aberto && evento.checkout_fecha_em && new Date(evento.checkout_fecha_em) < new Date()) aberto = false;
    if (!aberto) {
      return res.render('pages/evento-checkout-publico', { evento, config: cfgPub, aberto: false, sucesso: false, jaConfirmado: false, erro: 'O check-out deste evento está encerrado.', nome: null });
    }

    const email = (req.body.email || '').trim().toLowerCase();
    const docLimpo = (req.body.documento || req.body.rg || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (!email || !docLimpo) {
      return res.render('pages/evento-checkout-publico', { evento, config: cfgPub, aberto: true, sucesso: false, jaConfirmado: false, erro: 'Completa el correo y el RG/CI/DNI.', nome: null });
    }

    // Busca a inscrição por email OU documento (RG/CI/DNI) no evento
    const insR = await query(
      `SELECT id, nome, status, isento, email, rg FROM evento_inscricoes
       WHERE evento_id=$1 AND (LOWER(email)=$2 OR regexp_replace(LOWER(COALESCE(rg,'')),'[^a-z0-9]','','g')=$3)`,
      [req.params.id, email, docLimpo]
    );
    const inscricao = insR.rows[0] || null;

    // Verifica se já existe check-out para esta pessoa (evita duplicata)
    let jaExiste;
    if (inscricao) {
      jaExiste = await query('SELECT id FROM evento_checkouts WHERE evento_id=$1 AND inscricao_id=$2 LIMIT 1', [req.params.id, inscricao.id]);
    } else {
      jaExiste = await query("SELECT id FROM evento_checkouts WHERE evento_id=$1 AND (LOWER(email)=$2 OR regexp_replace(LOWER(COALESCE(cpf,'')),'[^a-z0-9]','','g')=$3) LIMIT 1", [req.params.id, email, docLimpo]);
    }
    if (jaExiste.rows.length > 0) {
      const nomeJa = inscricao ? inscricao.nome.split(' ')[0] : null;
      return res.render('pages/evento-checkout-publico', { evento, config: cfgPub, aberto: true, sucesso: false, jaConfirmado: true, erro: null, nome: nomeJa });
    }

    // Registra o check-out (vinculando à inscrição se achou)
    await query(
      'INSERT INTO evento_checkouts (evento_id, inscricao_id, email, cpf, nome_informado, ip) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.params.id, inscricao ? inscricao.id : null, email, docLimpo, inscricao ? inscricao.nome : null, (req.headers['x-forwarded-for']||req.ip||'').toString().split(',')[0].trim()]
    );

    const nome = inscricao ? inscricao.nome.split(' ')[0] : null;

    // Email de confirmação (só quando bateu com inscrição válida)
    if (inscricao && inscricao.email) {
      try {
        const { enviarEmail } = require('../services/notificacoes');
        const primeiro = inscricao.nome.split(' ')[0];
        const htmlCk = '<h2 style="margin:0 0 8px;font-size:20px;color:#0f172a">¡Hola, '+primeiro+'!</h2><p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.7">Tu <strong>asistencia</strong> al evento <strong>'+evento.nome+'</strong> fue registrada con éxito. ✅</p><div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin-bottom:24px"><p style="margin:0;font-size:13px;color:#166534">Este registro confirma que estuviste presente en el evento. Tu certificado será procesado conforme las reglas del evento.</p></div><p style="margin:0;font-size:12px;color:#94a3b8">¿Dudas? Contáctanos por WhatsApp o responde a este correo.</p>';
        const textoCk = 'Hola, '+primeiro+'! Tu asistencia al evento '+evento.nome+' fue registrada con éxito.';
        enviarEmail({ para: inscricao.email, assunto: '✅ Asistencia confirmada — '+evento.nome, html: htmlCk, texto: textoCk, faixaLabel: 'ASISTENCIA CONFIRMADA' }).catch(function(e){ console.error('Email checkout erro:', e.message); });
      } catch(e) { console.error('Email checkout falhou:', e.message); }
    }

    res.render('pages/evento-checkout-publico', { evento, config: cfgPub, aberto: true, sucesso: true, jaConfirmado: false, erro: null, nome });
  } catch(e) { console.error('Checkout POST erro:', e.message); res.status(500).send('Erro ao registrar.'); }
});

// Abrir / Encerrar check-out (painel)
router.post('/eventos/:id/checkout-toggle', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const acao = req.body.acao;
    if (acao === 'abrir') {
      const fecha = req.body.fecha_em ? req.body.fecha_em : null;
      await query('UPDATE eventos SET checkout_aberto=true, checkout_fecha_em=$1 WHERE id=$2', [fecha, req.params.id]);
      req.session.msg = ['Check-out ABERTO para recebimento.'];
    } else {
      await query('UPDATE eventos SET checkout_aberto=false WHERE id=$1', [req.params.id]);
      req.session.msg = ['Check-out ENCERRADO.'];
    }
  } catch(e) { req.session.erro = [e.message]; }
  res.redirect('/eventos/' + req.params.id + '?tab=checkout');
});

// Relatório de check-out (painel) — JSON consumido pela aba
router.get('/eventos/:id/checkout-relatorio', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const evR = await query('SELECT id, nome, checkout_aberto, checkout_fecha_em FROM eventos WHERE id=$1', [req.params.id]);
    if (!evR.rows[0]) return res.json({ok:false, erro:'Evento não encontrado'});

    // Inscritos válidos (confirmado, pago ou isento)
    const inscritos = await query(
      `SELECT id, nome, email, cpf, status, isento FROM evento_inscricoes WHERE evento_id=$1`,
      [req.params.id]
    );
    // Check-outs do evento
    const checkouts = await query(
      `SELECT inscricao_id, email, cpf, nome_informado, criado_em FROM evento_checkouts WHERE evento_id=$1 ORDER BY criado_em`,
      [req.params.id]
    );

    // Conjunto de inscrição_ids que fizeram check-out
    const fezCheckout = new Set(checkouts.rows.filter(c => c.inscricao_id).map(c => c.inscricao_id));

    const aptos = [];        // inscrição válida + fez check-out
    const naoCompareceu = []; // inscrição válida + NÃO fez check-out
    inscritos.rows.forEach(i => {
      const valida = i.status === 'confirmado'; // confirmado cobre pago e isento (ambos ficam confirmado)
      if (!valida) return;
      if (fezCheckout.has(i.id)) aptos.push({ id: i.id, nome: i.nome, email: i.email, isento: i.isento });
      else naoCompareceu.push({ nome: i.nome, email: i.email, isento: i.isento });
    });

    // Check-outs sem inscrição válida (não bateu) — pra revisar
    const semInscricao = checkouts.rows.filter(c => !c.inscricao_id).map(c => ({ email: c.email, cpf: c.cpf, quando: c.criado_em }));
    // Ordena alfabeticamente por nome (pt-BR, ignora acentos na ordenação)
    const _ord = (a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' });
    aptos.sort(_ord);
    naoCompareceu.sort(_ord);

    res.json({
      ok: true,
      evento: evR.rows[0],
      resumo: { aptos: aptos.length, nao_compareceu: naoCompareceu.length, sem_inscricao: semInscricao.length, total_checkouts: checkouts.rows.length },
      aptos, naoCompareceu, semInscricao
    });
  } catch(e) { console.error('Relatorio checkout erro:', e.message); res.json({ok:false, erro:e.message}); }
});

router.post('/eventos/:id/inscricao/:inscricao_id/desfazer-checkout', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    await query('DELETE FROM evento_checkouts WHERE evento_id=$1 AND inscricao_id=$2', [req.params.id, req.params.inscricao_id]);
    res.json({ok:true});
  } catch(e) { res.json({ok:false, erro:e.message}); }
});

// Exportar lista de aptos em CSV (painel)
router.get('/eventos/:id/checkout-export', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const [evR, inscritos] = await Promise.all([
      query('SELECT nome FROM eventos WHERE id=$1', [req.params.id]),
      query(
        `SELECT i.nome, i.email, i.cpf, i.rg, i.catraca, i.tipo_participante,
                i.isento,
                to_char(c.criado_em, 'DD/MM/YYYY HH24:MI') as checkout_em
         FROM evento_inscricoes i
         LEFT JOIN evento_checkouts c ON c.inscricao_id=i.id
         WHERE i.evento_id=$1 AND i.status='confirmado'
           AND EXISTS (SELECT 1 FROM evento_checkouts ec WHERE ec.inscricao_id=i.id)
         ORDER BY i.nome`,
        [req.params.id]
      )
    ]);
    const nomeEv = (evR.rows[0]?.nome || 'evento').replace(/[^a-z0-9]/gi,'_').substring(0,30);
    const cabecalho = ['Nome Completo','Email','CPF','RG','Catraca','Tipo Participante','Pagamento','Check-out em'];
    let csv = cabecalho.join(';') + '\n';
    inscritos.rows.forEach(r => {
      const tipoRaw = (r.tipo_participante || 'externo').toLowerCase().trim();
      const tipo = tipoRaw === 'ucp' ? 'Aluno UCP' : tipoRaw === 'externo' ? 'Externo' : r.tipo_participante || 'Externo';
      csv += [
        r.nome || '',
        r.email || '',
        r.cpf || '',
        r.rg || '',
        r.catraca || '',
        tipo,
        r.isento ? 'Isento' : 'Pago',
        r.checkout_em || ''
      ].map(v => '"' + String(v).replace(/"/g,'""') + '"').join(';') + '\n';
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="aptos-' + nomeEv + '.csv"');
    res.send('\uFEFF' + csv);
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
      const hash = await bcryptCient.hash('123456', 10);
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

function membroCompletoEdicao(config, membro, tipo) {
  return membro.edicao_liberada || config[`edicao_${tipo}s_grupo`] === '1';
}

const { CAMPOS_MEUS_DADOS } = require('../services/campos-meus-dados');

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
  if (!nova_senha || nova_senha.length < 6) { req.session.erro=['Senha deve ter no minimo 6 caracteres.']; return res.redirect('/portal/trocar-senha'); }
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
    const hash = await bcryptPortal.hash(novaSenha, 10);
    await query('UPDATE portal_cientifico_senhas SET senha_hash=$1, primeiro_acesso=true WHERE origem_tipo=$2 AND origem_id=$3', [hash, tipo, membro.id]);
    await enviarEmail({ para: membro.email, assunto: 'Portal Cientifico — Senha temporaria', texto: 'Ola ' + membro.nome + ',\n\nSua senha temporaria para o Portal Cientifico e: ' + novaSenha + '\n\nAo entrar, sera solicitado que voce defina uma nova senha.\n\nAcesse: ' + (process.env.APP_URL||'') + '/portal/login' });
  }
  req.session.msg=['Se o email estiver cadastrado, voce recebera as instrucoes em instantes.'];
  res.redirect('/portal/esqueci-senha');
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


// Foto publica para portal do membro
router.get('/membro/foto/:tipo/:id', requireMembro, async (req, res) => {
  const { tipo, id } = req.params;
  const tabela = tipo==='diretivo'?'diretivos':'ligantes';
  const r = await query(`SELECT foto_chave FROM ${tabela} WHERE id=$1`, [id]);
  if(!r.rows[0]||!r.rows[0].foto_chave) return res.status(404).send('');
  const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const R2 = new S3Client({ region:'auto', endpoint:process.env.R2_ENDPOINT, credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY }});
  const url = await getSignedUrl(R2, new GetObjectCommand({ Bucket:process.env.R2_BUCKET||'liga-urologia-files', Key:r.rows[0].foto_chave }), { expiresIn:3600 });
  res.redirect(url);
});

// ─── PORTAL DO MEMBRO ────────────────────────────────────────────────────────
const bcryptMembro = bcryptCient;

async function requireMembro(req, res, next) {
  if (!req.session.membroPortal) return res.redirect('/membro/login');
  const { tipo, id } = req.session.membroPortal;
  const tabela = tipo === 'ligante' ? 'ligantes' : 'diretivos';
  const r = await query('SELECT ativo, pendente FROM ' + tabela + ' WHERE id=$1', [id]);
  if (!r.rows.length || r.rows[0].ativo != 1 || r.rows[0].pendente) {
    req.session.membroPortal = null;
    return res.render('pages/membro/login', { erro: 'Você não tem mais permissão para acessar essa área. Esta área é restrita a membros ativos da Liga.' });
  }
  next();
}

async function getMembroPortal(tipo, id) {
  if (tipo === 'ligante') {
    const r = await query('SELECT id, nome, email, whatsapp FROM ligantes WHERE id=$1 AND ativo=1 AND pendente=false', [id]);
    return r.rows[0] ? { ...r.rows[0], tipo: 'ligante' } : null;
  } else {
    const r = await query('SELECT id, nome, email, whatsapp FROM diretivos WHERE id=$1 AND ativo=1 AND pendente=false', [id]);
    return r.rows[0] ? { ...r.rows[0], tipo: 'diretivo' } : null;
  }
}

// GET /membro/perfil/:tipo/:id - pagina publica de perfil, linkada pelo site institucional (lauroucpcde.com)
// Mostra so nome, foto e cargo/semestre (mesmos dados ja expostos em /api/equipe-publica) - sem login, sem dado sensivel.
router.get('/membro/perfil/:tipo/:id', async (req, res) => {
  try {
    const { gerarUrlInline } = require('../services/arquivos');
    const { rotuloAniversario } = require('../services/cargo-genero');
    const tipo = req.params.tipo === 'diretivo' ? 'diretivo' : 'ligante';
    const r = tipo === 'diretivo'
      ? await query("SELECT id, nome, cargo, sexo, COALESCE(foto_site_chave, foto_chave) as foto_chave FROM diretivos WHERE id=$1 AND ativo=1 AND pendente=false", [req.params.id])
      : await query("SELECT id, nome, COALESCE(foto_site_chave, foto_chave) as foto_chave FROM ligantes WHERE id=$1 AND ativo=1 AND pendente=false", [req.params.id]);
    if (!r.rows.length) return res.status(404).send('Perfil no encontrado');
    const m = r.rows[0];
    let foto_url = null;
    if (m.foto_chave) { try { foto_url = await gerarUrlInline(m.foto_chave); } catch(e) {} }
    const pessoa = { nome: m.nome, cargo: rotuloAniversario({ tipo, cargo: m.cargo, sexo: m.sexo }), foto_url };
    res.render('pages/membro/perfil-publico', { pessoa, tipo });
  } catch(e) { res.status(500).send('Error al cargar el perfil'); }
});

// GET /membro/login
router.get('/membro/login', (req, res) => {
  if (req.session.membroPortal) return res.redirect('/membro/dashboard');
  res.render('pages/membro/login', { erro: null });
});

// POST /membro/login
router.post('/membro/login', limiterLogin, async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.render('pages/membro/login', { erro: 'Preencha email e senha.' });
  let membro = null, tipo = null, id = null;
  const l = await query('SELECT id, nome, email FROM ligantes WHERE LOWER(email)=LOWER($1) AND ativo=1 AND pendente=false', [email]);
  if (l.rows.length) { membro = l.rows[0]; tipo = 'ligante'; id = l.rows[0].id; }
  if (!membro) {
    const d = await query('SELECT id, nome, email FROM diretivos WHERE LOWER(email)=LOWER($1) AND ativo=1 AND pendente=false', [email]);
    if (d.rows.length) { membro = d.rows[0]; tipo = 'diretivo'; id = d.rows[0].id; }
  }
  if (!membro) {
    // Verificar se existe mas está inativo
    const lInat = await query('SELECT id FROM ligantes WHERE LOWER(email)=LOWER($1)', [email]);
    const dInat = await query('SELECT id FROM diretivos WHERE LOWER(email)=LOWER($1)', [email]);
    if (lInat.rows.length || dInat.rows.length) {
      return res.render('pages/membro/login', { erro: 'Você não tem mais permissão para acessar essa área. Esta área é restrita a membros ativos da Liga.' });
    }
    return res.render('pages/membro/login', { erro: 'Email não encontrado.' });
  }
  const senhaR = await query('SELECT senha_hash, primeiro_acesso FROM portal_cientifico_senhas WHERE origem_tipo=$1 AND origem_id=$2', [tipo, id]);
  if (!senhaR.rows.length) return res.render('pages/membro/login', { erro: 'Acesso não configurado. Contate a secretaria.' });
  const ok = await bcryptMembro.compare(senha, senhaR.rows[0].senha_hash);
  if (!ok) return res.render('pages/membro/login', { erro: 'Senha incorreta.' });
  req.session.membroPortal = { tipo, id, nome: membro.nome, email: membro.email };
  if (senhaR.rows[0].primeiro_acesso) return res.redirect('/membro/trocar-senha');
  res.redirect('/membro/dashboard');
});

// GET /membro/trocar-senha
router.get('/membro/trocar-senha', requireMembro, (req, res) => {
  res.render('pages/portal/trocar-senha', { erro: null, baseUrl: '/membro' });
});

// POST /membro/trocar-senha
router.post('/membro/trocar-senha', requireMembro, limiterLogin, async (req, res) => {
  const { senha_atual, nova_senha, confirmar_senha } = req.body;
  if (!nova_senha || nova_senha.length < 6) return res.render('pages/portal/trocar-senha', { erro: ['Senha deve ter pelo menos 6 caracteres.'], baseUrl: '/membro' });
  if (nova_senha !== confirmar_senha) return res.render('pages/portal/trocar-senha', { erro: ['Senhas não conferem.'], baseUrl: '/membro' });
  const { tipo, id } = req.session.membroPortal;
  const bcryptMembro = require('bcryptjs');
  const senhaAtualR = await query('SELECT senha_hash FROM portal_cientifico_senhas WHERE origem_tipo=$1 AND origem_id=$2', [tipo, id]);
  const senhaAtualOk = senhaAtualR.rows.length && await bcryptMembro.compare(senha_atual || '', senhaAtualR.rows[0].senha_hash);
  if (!senhaAtualOk) return res.render('pages/portal/trocar-senha', { erro: ['Senha atual incorreta.'], baseUrl: '/membro' });
  const hash = await bcryptMembro.hash(nova_senha, 10);
  await query('UPDATE portal_cientifico_senhas SET senha_hash=$1, primeiro_acesso=false WHERE origem_tipo=$2 AND origem_id=$3', [hash, tipo, id]);
  res.redirect('/membro/dashboard');
});

// GET /membro/logout
router.get('/membro/logout', (req, res) => {
  req.session.membroPortal = null;
  res.redirect('/membro/login');
});

// GET /membro/dashboard
router.get('/membro/dashboard', requireMembro, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const { tipo, id } = req.session.membroPortal;
  const membro = await getMembroPortal(tipo, id);
  if (!membro) { req.session.membroPortal = null; return res.redirect('/membro/login'); }
  const hoje = new Date().toISOString().split('T')[0];
  const mesAtual = hoje.substring(0, 7);
  // Cobrança atual
  const mesRef = mesAtual.replace('-','');
  const cobR = await query(`SELECT * FROM cobrancas WHERE membro_id=(SELECT id FROM membros WHERE LOWER(email)=LOWER($1) LIMIT 1) AND status != 'cancelado' AND status IN ('pendente','atrasado') ORDER BY data_vencimento DESC LIMIT 1`, [membro.email]);
  const cobrancaAtual = cobR.rows[0] || null;
  // Frequencia ligante
  let frequencia = { percentual: 0, presencas: 0, total: 0 };
  if (tipo === 'ligante') {
    const membroDashR = await query('SELECT id FROM membros WHERE LOWER(email)=LOWER((SELECT email FROM ligantes WHERE id=$1))', [id]);
    const membroDashId = membroDashR.rows[0]?.id;
    if(membroDashId) {
      const tmR = await query('SELECT turma_id FROM turma_membros WHERE membro_id=$1 ORDER BY criado_em DESC LIMIT 1', [membroDashId]);
      if(tmR.rows.length) {
        const fR = await query('SELECT COUNT(*) FILTER (WHERE p.presente=1) as presencas, COUNT(*) as total FROM atividades a LEFT JOIN presencas p ON p.atividade_id=a.id AND p.membro_id=$1 WHERE a.turma_id=$2', [membroDashId, tmR.rows[0].turma_id]);
        if(fR.rows[0]) { const p=parseInt(fR.rows[0].presencas)||0; const t=parseInt(fR.rows[0].total)||0; frequencia={presencas:p,total:t,percentual:t>0?Math.round(p/t*100):0}; }
      }
    }
  } else if (tipo === 'diretivo') {
    const fR = await query(`SELECT COUNT(*) FILTER (WHERE dp.presente=1) as presencas, COUNT(*) as total FROM diretivo_atividades a INNER JOIN diretivo_presencas dp ON dp.atividade_id=a.id AND dp.diretivo_id=$1`,[id]);
    if(fR.rows[0]) { const p=parseInt(fR.rows[0].presencas)||0; const t=parseInt(fR.rows[0].total)||0; frequencia={presencas:p,total:t,percentual:t>0?Math.round(p/t*100):0}; }
  }
  // Comunicados
  const comR = await query(`
    SELECT c.*, 
      CASE WHEN cl.id IS NOT NULL THEN true ELSE false END as lido
    FROM comunicados c
    LEFT JOIN comunicados_leituras cl ON cl.comunicado_id=c.id AND cl.membro_tipo=$2 AND cl.membro_id=$3
    WHERE c.ativo=true AND (c.destinatarios='todos' OR c.destinatarios=$1) 
    ORDER BY c.criado_em DESC LIMIT 10
  `, [tipo==='ligante'?'ligantes':'diretivos', tipo, id]);
  const naoLidosR = await query(`
    SELECT COUNT(*) as total FROM comunicados c
    LEFT JOIN comunicados_leituras cl ON cl.comunicado_id=c.id AND cl.membro_tipo=$2 AND cl.membro_id=$3
    WHERE c.ativo=true AND (c.destinatarios='todos' OR c.destinatarios=$1) AND cl.id IS NULL
  `, [tipo==='ligante'?'ligantes':'diretivos', tipo, id]);
  const comunicadosNaoLidos = parseInt(naoLidosR.rows[0]?.total)||0;
  // Proximo evento
  const evR = await query(`SELECT id, nome, data_inicio, local FROM eventos WHERE data_inicio >= NOW() ORDER BY data_inicio ASC LIMIT 1`);
  // Grupos cientificos
  const grR = await query(`SELECT gc.nome as gnome, pc.titulo as ptitulo FROM membros_grupo_cientifico m JOIN grupos_cientificos gc ON gc.id=m.grupo_id JOIN projetos_cientificos pc ON pc.id=gc.projeto_id WHERE m.origem_tipo=$1 AND m.origem_id=$2`, [tipo, id]);
  const cientAvisosR = await query(`
    SELECT COUNT(*) as total FROM avisos_cientificos a
    WHERE a.criado_em >= NOW() - INTERVAL '7 days'
    AND (
      a.grupo_id IN (SELECT grupo_id FROM membros_grupo_cientifico WHERE origem_tipo=$1 AND origem_id=$2)
      OR a.projeto_id IN (SELECT gc.projeto_id FROM membros_grupo_cientifico m JOIN grupos_cientificos gc ON gc.id=m.grupo_id WHERE m.origem_tipo=$1 AND m.origem_id=$2)
    )
  `, [tipo, id]).catch(()=>({rows:[{total:0}]}));
  // Trabalhos devolvidos para correcao contam como pendencia do membro tambem, nao so avisos
  const cientDevolvidosR = await query(`
    SELECT COUNT(*) as total FROM versoes_trabalho v
    WHERE v.status='devolvido' AND v.grupo_id IN (SELECT grupo_id FROM membros_grupo_cientifico WHERE origem_tipo=$1 AND origem_id=$2)
  `, [tipo, id]).catch(()=>({rows:[{total:0}]}));
  const cientificoAvisos = (parseInt(cientAvisosR.rows[0]?.total)||0) + (parseInt(cientDevolvidosR.rows[0]?.total)||0);
  res.render('pages/membro/dashboard', { membro, cobrancaAtual, frequencia, comunicados: comR.rows, comunicadosNaoLidos, proximoEvento: evR.rows[0]||null, grupos: grR.rows, cientificoAvisos });
});

// GET /membro/pagbank/chave-publica — chave p/ criptografar cartao no navegador
router.get('/membro/pagbank/chave-publica', requireMembro, async (req, res) => {
  const { obterChavePublica } = require('../services/pagbank');
  const r = await obterChavePublica();
  if (!r.ok) return res.status(502).json({ ok: false, erro: 'Nao foi possivel iniciar o pagamento. Tente novamente.' });
  res.json({ ok: true, publicKey: r.publicKey });
});

// POST /membro/pagar-cartao — pagamento com cartao embutido no portal (sem redirecionar)
router.post('/membro/pagar-cartao', requireMembro, limiterPagamentoCartao, async (req, res) => {
  try {
    const { tipo, id } = req.session.membroPortal;
    const { cobranca_id, encryptedCard, holder_name, holder_cpf } = req.body;
    if (!cobranca_id || !encryptedCard || !holder_name) return res.json({ ok: false, erro: 'Dados do cartao incompletos.' });

    const membro = await getMembroPortal(tipo, id);
    if (!membro) return res.json({ ok: false, erro: 'Sessao invalida.' });

    // Garante que a cobranca pertence ao proprio membro logado (evita pagar cobranca de outro)
    const cobR = await query(
      `SELECT c.* FROM cobrancas c JOIN membros m ON m.id=c.membro_id
       WHERE c.id=$1 AND LOWER(m.email)=LOWER($2) AND c.status IN ('pendente','atrasado')`,
      [cobranca_id, membro.email]
    );
    if (!cobR.rows.length) return res.json({ ok: false, erro: 'Cobranca nao encontrada ou ja paga.' });
    const cob = cobR.rows[0];

    const { pagarComCartao } = require('../services/pagbank');
    const dentroDoPrazo = !require('dayjs')().isAfter(require('dayjs')(cob.data_vencimento).endOf('day'));
    const valorPagar = (cob.valor_desconto != null && dentroDoPrazo) ? cob.valor_desconto : cob.valor_cheio;
    const r = await pagarComCartao({
      referencia: cob.referencia,
      valor: valorPagar,
      membro: { nome: membro.nome, email: membro.email, cpf: membro.cpf },
      encryptedCard,
      holderName: holder_name,
      holderCpf: holder_cpf
    });

    if (!r.ok) return res.json({ ok: false, erro: r.erro });
    if (!r.aprovado) return res.json({ ok: false, erro: 'Pagamento nao aprovado (status: ' + r.status + '). Verifique os dados do cartao ou tente outro cartao.' });

    await query("UPDATE cobrancas SET status='pago', data_pagamento=NOW(), pagbank_charge_id=$1, metodo_pagamento='cartao', valor_pago=$3 WHERE id=$2", [r.charge_id, cob.id, valorPagar]);
    try {
      const { lancarMensalidadeNoFluxo } = require('../services/fluxo-mensalidade');
      await lancarMensalidadeNoFluxo(query, cob.id);
    } catch(e) { console.error('lancar fluxo (cartao portal):', e.message); }

    res.json({ ok: true });
  } catch(e) {
    console.error('/membro/pagar-cartao erro:', e.message);
    res.json({ ok: false, erro: 'Erro ao processar pagamento. Tente novamente.' });
  }
});

// GET /membro/financeiro/dados — API JSON para historico inline
router.get('/membro/financeiro/dados', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try {
    const membro = await getMembroPortal(tipo, id);
    const cobR = await query("SELECT * FROM cobrancas WHERE membro_id=(SELECT id FROM membros WHERE LOWER(email)=LOWER($1) LIMIT 1) AND status != 'cancelado' ORDER BY data_vencimento DESC", [membro.email]);
    res.json({ cobrancas: cobR.rows });
  } catch(e) { res.json({ cobrancas: [], error: e.message }); }
});

// GET /membro/financeiro
router.get('/membro/financeiro', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  const membro = await getMembroPortal(tipo, id);
  const cobR = await query(`SELECT * FROM cobrancas WHERE membro_id=(SELECT id FROM membros WHERE LOWER(email)=LOWER($1) LIMIT 1) AND status != 'cancelado' ORDER BY data_vencimento DESC`, [membro.email]);
  res.render('pages/membro/financeiro', { membro, cobrancas: cobR.rows });
});

// POST /membro/comunicado/:id/lido — marcar comunicado como lido
router.post('/membro/comunicado/:id/lido', requireMembro, async (req, res) => {
  try {
    const { tipo, id } = req.session.membroPortal;
    await query(
      'INSERT INTO comunicados_leituras (comunicado_id, membro_tipo, membro_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [req.params.id, tipo, id]
    );
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, erro: e.message }); }
});

// GET /membro/frequencia — redireciona para dashboard (novo portal)
router.get('/membro/frequencia', requireMembro, (req, res) => {
  res.redirect('/membro/dashboard#frequencia');
});

// GET /membro/frequencia/dados — API JSON para historico inline
router.get('/membro/frequencia/dados', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  let registros = [];
  try {
    if (tipo === 'ligante') {
      const membroR = await query('SELECT id FROM membros WHERE LOWER(email)=LOWER((SELECT email FROM ligantes WHERE id=$1))', [id]);
      const membroId = membroR.rows[0]?.id;
      if(membroId) {
        const tmR = await query('SELECT turma_id FROM turma_membros WHERE membro_id=$1 ORDER BY criado_em DESC LIMIT 1', [membroId]);
        if(tmR.rows.length) {
          const fR = await query(`SELECT a.data_atividade as data, a.descricao, p.presente FROM atividades a INNER JOIN presencas p ON p.atividade_id=a.id AND p.membro_id=$1 WHERE a.turma_id=$2 ORDER BY a.data_atividade DESC LIMIT 50`, [membroId, tmR.rows[0].turma_id]);
          registros = fR.rows;
        }
      }
    } else if (tipo === 'diretivo') {
      const fR = await query(`SELECT a.data_atividade as data, a.descricao, COALESCE(dp.presente,0) as presente FROM diretivo_atividades a INNER JOIN diretivo_presencas dp ON dp.atividade_id=a.id AND dp.diretivo_id=$1 ORDER BY a.data_atividade DESC LIMIT 50`, [id]);
      registros = fR.rows;
    }
    res.json({ registros });
  } catch(e) { res.json({ registros: [], error: e.message }); }
});

// GET /membro/eventos — redireciona para dashboard (novo portal)
router.get('/membro/eventos', requireMembro, (req, res) => {
  res.redirect('/membro/dashboard#eventos');
});

// GET /membro/eventos/dados — API JSON para eventos inline
router.get('/membro/eventos/dados', requireMembro, async (req, res) => {
  try {
    const evR = await query(`SELECT id, nome, data_inicio, local, descricao, status FROM eventos ORDER BY data_inicio DESC LIMIT 30`);
    res.json({ eventos: evR.rows });
  } catch(e) { res.json({ eventos: [], error: e.message }); }
});

// GET /membro/agenda — redireciona para dashboard (novo portal)
router.get('/membro/agenda', requireMembro, (req, res) => {
  res.redirect('/membro/dashboard#agenda');
});

// GET /membro/agenda/dados — API JSON para calendario inline
router.get('/membro/agenda/dados', requireMembro, async (req, res) => {
  try {
    const mes = parseInt(req.query.mes) || (new Date().getMonth()+1);
    const ano = parseInt(req.query.ano) || new Date().getFullYear();
    const evR = await query(`SELECT id, titulo, descricao, data_inicio, data_fim, dia_inteiro, local, link_externo, cor FROM calendario_atividades WHERE publico = TRUE ORDER BY data_inicio ASC`);
    const anivR = await query(`SELECT id, nome, tipo, foto_chave, TO_CHAR(data_nascimento::date,'YYYY-MM-DD') as data_nascimento FROM (SELECT id, nome, data_nascimento, foto_chave, 'ligante' as tipo FROM ligantes WHERE ativo=1 AND data_nascimento IS NOT NULL UNION ALL SELECT id, nome, data_nascimento, foto_chave, 'diretivo' as tipo FROM diretivos WHERE ativo=1 AND data_nascimento IS NOT NULL) t WHERE EXTRACT(MONTH FROM data_nascimento::date)=$1 ORDER BY EXTRACT(DAY FROM data_nascimento::date)`, [mes]);
    res.json({ eventos: evR.rows, aniversariantes: anivR.rows });
  } catch(e) { res.json({ eventos: [], aniversariantes: [], error: e.message }); }
});

// GET /membro/comunicados — redireciona para dashboard (novo portal)
router.get('/membro/comunicados', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try { await query(`UPDATE portal_cientifico_senhas SET ultimo_acesso_comunicados=NOW() WHERE origem_tipo=$1 AND origem_id=$2`, [tipo, id]); } catch(e) {}
  res.redirect('/membro/dashboard#comunicados');
});

// GET /membro/perfil/dados
router.get('/membro/perfil/dados', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try {
    const config = await getConfig();
    let dados = null;
    if (tipo === 'ligante') {
      const r = await query(`SELECT id, nome, email, email_alternativo, whatsapp, data_nascimento, sexo, rg, cpf,
        semestre, turma, semestre_ingresso, catraca, orcid, foto_chave, edicao_liberada,
        tem_formacao, qual_formacao, habilidades, aceita_cargo, qual_cargo,
        contribuicao_grupo, ideia_inovadora, tema_interesse, porque_lauro, apresentacao
        FROM ligantes WHERE id=$1`, [id]);
      dados = r.rows[0] ? { ...r.rows[0], tipo: 'ligante' } : null;
    } else {
      const r = await query(`SELECT id, nome, email, whatsapp, data_nascimento, sexo, rg, cpf, catraca, cargo,
        semestre_turma, orcid, instagram, graduacao, ano_ingresso, onde_reside, edicao_liberada,
        transporte_proprio, tipo_transporte, disponibilidade, experiencia_urologia, foto_chave
        FROM diretivos WHERE id=$1`, [id]);
      dados = r.rows[0] ? { ...r.rows[0], tipo: 'diretivo' } : null;
    }
    if (!dados) return res.json({ dados: null, podeEditar: false, correcaoPendente: null });
    const pendR = await query("SELECT id, criado_em FROM cadastro_correcoes WHERE origem_tipo=$1 AND origem_id=$2 AND status='pendente'", [tipo, id]);
    res.json({
      dados,
      podeEditar: !!membroCompletoEdicao(config, dados, tipo),
      correcaoPendente: pendR.rows[0] || null
    });
  } catch(e) { res.json({ dados: null, podeEditar: false, correcaoPendente: null, error: e.message }); }
});

// Envio de correção de cadastro pelo Portal do Membro → vira pendência em /correcoes-cadastro
router.post('/membro/perfil/atualizar', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try {
    const config = await getConfig();
    const r = await query(`SELECT * FROM ${tipo === 'ligante' ? 'ligantes' : 'diretivos'} WHERE id=$1`, [id]);
    const membro = r.rows[0];
    if (!membro) return res.status(401).json({ ok: false, erro: 'Sessão expirada. Entre novamente.' });
    if (!membroCompletoEdicao(config, membro, tipo)) return res.json({ ok: false, erro: 'A edição de cadastro não está liberada para você no momento.' });
    const pendR = await query("SELECT id FROM cadastro_correcoes WHERE origem_tipo=$1 AND origem_id=$2 AND status='pendente'", [tipo, id]);
    if (pendR.rows.length) return res.json({ ok: false, erro: 'Você já tem uma atualização em análise. Aguarde a avaliação da equipe.' });

    // Só exigidos quando a resposta anterior os torna aplicáveis (ex.: "qual formação?" só se tem formação)
    const CONDICIONAIS = ['qual_formacao', 'qual_cargo', 'tipo_transporte'];
    const dados = {}, faltando = [];
    CAMPOS_MEUS_DADOS[tipo].forEach(c => {
      let v = req.body[c];
      if (c === 'disponibilidade') v = [].concat(req.body.disponibilidade || []).join(', ');
      dados[c] = v;
      if (!CONDICIONAIS.includes(c) && (!v || !String(v).trim())) faltando.push(c);
    });
    const vazio = c => !dados[c] || !String(dados[c]).trim();
    if (tipo === 'ligante') {
      if (dados.tem_formacao === 'Sim' && vazio('qual_formacao')) faltando.push('qual_formacao');
      if (dados.aceita_cargo === 'Sim' && vazio('qual_cargo')) faltando.push('qual_cargo');
    } else if (dados.transporte_proprio === 'Sim' && vazio('tipo_transporte')) faltando.push('tipo_transporte');
    if (faltando.length) return res.json({ ok: false, erro: 'Preencha todos os campos obrigatórios antes de enviar.' });

    await query('INSERT INTO cadastro_correcoes (origem_tipo, origem_id, dados) VALUES ($1,$2,$3)', [tipo, id, JSON.stringify(dados)]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, erro: e.message }); }
});

// GET /membro/estatuto/dados
router.get('/membro/estatuto/dados', requireMembro, async (req, res) => {
  try {
    const r = await query("SELECT valor FROM configuracoes WHERE chave='estatuto_pdf_chave'");
    const chave = r.rows[0]?.valor || '';
    if (!chave) return res.json({ url: null, msg: 'Estatuto nao disponivel ainda.' });
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const R2 = new S3Client({ region:'auto', endpoint:process.env.R2_ENDPOINT, credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY }});
    const url = await getSignedUrl(R2, new GetObjectCommand({ Bucket:process.env.R2_BUCKET||'liga-urologia-files', Key:chave }), { expiresIn:3600 });
    res.json({ url });
  } catch(e) { res.json({ url: null, msg: 'Erro ao carregar estatuto.' }); }
});

// GET /membro/regulamento/dados
router.get('/membro/regulamento/dados', requireMembro, async (req, res) => {
  try {
    const r = await query("SELECT valor FROM configuracoes WHERE chave='regulamento_pdf_chave'");
    const chave = r.rows[0]?.valor || '';
    if (!chave) return res.json({ url: null, msg: 'Regulamento nao disponivel ainda.' });
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const R2 = new S3Client({ region:'auto', endpoint:process.env.R2_ENDPOINT, credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY }});
    const url = await getSignedUrl(R2, new GetObjectCommand({ Bucket:process.env.R2_BUCKET||'liga-urologia-files', Key:chave }), { expiresIn:3600 });
    res.json({ url });
  } catch(e) { res.json({ url: null, msg: 'Erro ao carregar regulamento.' }); }
});

// GET /membro/contrato/dados
router.get('/membro/contrato/dados', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try {
    const r = tipo === 'ligante'
      ? await query('SELECT pdf_assinado_chave, status, criado_em FROM contratos_ligantes WHERE ligante_id=$1 ORDER BY criado_em DESC LIMIT 1', [id])
      : await query('SELECT pdf_assinado_chave, status, criado_em FROM contratos_diretivos WHERE diretivo_id=$1 ORDER BY criado_em DESC LIMIT 1', [id]);
    const msgSemContrato = 'Você ainda não possui contrato assinado. Por favor, procure a secretaria para regularizar sua situação.';
    if (!r.rows[0]) return res.json({ url: null, msg: msgSemContrato });
    // Mostra somente o PDF assinado (documento final, escaneado) — nunca o rascunho gerado antes da assinatura
    if (!r.rows[0].pdf_assinado_chave) return res.json({ url: null, msg: msgSemContrato, status: r.rows[0].status });
    // Serve pelo proxy same-origin (/membro/contrato/pdf). O iframe apontando direto
    // pro R2 e bloqueado pelo CSP (frame-src so 'self') — por isso o contrato aparecia em branco.
    res.json({ url: '/membro/contrato/pdf', status: r.rows[0].status });
  } catch(e) { res.json({ url: null, msg: 'Erro ao carregar contrato.' }); }
});

// Serve o PDF do contrato assinado pelo proprio servidor (same-origin), para o iframe
// do portal poder exibir sem ser bloqueado pelo CSP frame-src. Mesmo padrao do proxy
// de materiais. Cada membro so acessa o proprio contrato (via sessao do portal).
router.get('/membro/contrato/pdf', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try {
    const r = tipo === 'ligante'
      ? await query('SELECT pdf_assinado_chave FROM contratos_ligantes WHERE ligante_id=$1 ORDER BY criado_em DESC LIMIT 1', [id])
      : await query('SELECT pdf_assinado_chave FROM contratos_diretivos WHERE diretivo_id=$1 ORDER BY criado_em DESC LIMIT 1', [id]);
    const chave = r.rows[0] && r.rows[0].pdf_assinado_chave;
    if (!chave) return res.status(404).send('Contrato nao disponivel');
    const { gerarUrlTemporaria } = require('../services/arquivos');
    const url = await gerarUrlTemporaria(chave, 60);
    const axios = require('axios');
    const resp = await axios.get(url, { responseType: 'stream', timeout: 30000 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="contrato.pdf"');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    resp.data.pipe(res);
  } catch(e) { res.status(500).send('Erro ao carregar contrato'); }
});

// Admin upload estatuto/regulamento
router.post('/admin/portal/estatuto', requireAuth, require('../services/arquivos').upload.single('arquivo'), async (req, res) => {
  if (!req.file) return res.json({ ok: false, msg: 'Nenhum arquivo.' });
  const chave = req.file.key || req.file.filename;
  await query("INSERT INTO configuracoes (chave, valor) VALUES ('estatuto_pdf_chave', $1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [chave]);
  res.json({ ok: true, chave });
});
router.post('/admin/portal/regulamento', requireAuth, require('../services/arquivos').upload.single('arquivo'), async (req, res) => {
  if (!req.file) return res.json({ ok: false, msg: 'Nenhum arquivo.' });
  const chave = req.file.key || req.file.filename;
  await query("INSERT INTO configuracoes (chave, valor) VALUES ('regulamento_pdf_chave', $1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [chave]);
  res.json({ ok: true, chave });
});
// GET /membro/chat/mensagens
router.get('/membro/chat/mensagens', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try {
    const [r, atR] = await Promise.all([
      query('SELECT id, autor, texto, criado_em, lido_admin, remetente_nome FROM portal_mensagens WHERE origem_tipo=$1 AND origem_id=$2 ORDER BY criado_em ASC LIMIT 100', [tipo, id]),
      query("SELECT status FROM lauro_atendimentos WHERE numero_membro=$1 AND origem='portal' ORDER BY criado_em DESC LIMIT 1", ['portal-' + tipo + '-' + id])
    ]);
    await query("UPDATE portal_mensagens SET lido_membro=true WHERE origem_tipo=$1 AND origem_id=$2 AND autor='admin'", [tipo, id]);
    const encerrado = atR.rows.length > 0 && atR.rows[0].status === 'encerrado';
    res.json({ mensagens: r.rows, encerrado });
  } catch(e) { res.json({ mensagens: [], error: e.message }); }
});

// POST /membro/chat/enviar (fallback sem socket)
router.post('/membro/chat/enviar', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  const { texto } = req.body;
  if (!texto || !texto.trim()) return res.json({ ok: false });
  try {
    const { registrarMensagemMembro } = require('../services/portal-chat');
    const r = await registrarMensagemMembro(query, tipo, id, texto.trim());
    const io = req.app._io;
    if (io) io.to('admins').emit('chat_novo', { tipo, id, texto: texto.trim(), nome: r.nome, atendimentoId: r.atendimentoId });
    res.json({ ok: true, msg: { id: r.id, criado_em: r.criado_em } });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

// ─── FIM PORTAL DO MEMBRO ─────────────────────────────────────────────────────

// GET /membro/esqueci-senha

// Materiais de estudo — portal do membro (redireciona para dashboard novo portal)
router.get('/membro/materiais', requireMembro, (req, res) => {
  res.redirect('/membro/dashboard#materiais');
});
router.get('/membro/materiais/dados', requireMembro, async (req, res) => {
  const materiais = await query("SELECT * FROM materiais_estudo WHERE ativo=true ORDER BY ordem ASC, criado_em DESC");
  res.json({ materiais: materiais.rows });
});
// GET /membro/cientifico/dados
router.get('/membro/cientifico/dados', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try {
    const grR = await query(`
      SELECT gc.id as grupo_id, gc.nome as grupo_nome, gc.tipo_trabalho, gc.status as grupo_status,
             pc.id as projeto_id, pc.titulo as projeto_titulo, COALESCE(gc.prazo, pc.prazo) as prazo, pc.status as projeto_status,
             (SELECT status FROM versoes_trabalho v WHERE v.grupo_id=gc.id ORDER BY v.enviado_em DESC LIMIT 1) as ultimo_status,
             (SELECT ru.nome FROM versoes_trabalho v LEFT JOIN usuarios ru ON ru.id=v.revisor_atual_id WHERE v.grupo_id=gc.id ORDER BY v.enviado_em DESC LIMIT 1) as revisor_atual_nome,
             (SELECT COUNT(*) FROM versoes_trabalho v WHERE v.grupo_id=gc.id AND v.status IN ('aguardando','em_revisao')) as pendentes
      FROM membros_grupo_cientifico m
      JOIN grupos_cientificos gc ON gc.id=m.grupo_id
      JOIN projetos_cientificos pc ON pc.id=gc.projeto_id
      WHERE m.origem_tipo=$1 AND m.origem_id=$2
      ORDER BY COALESCE(gc.prazo, pc.prazo) ASC NULLS LAST
    `, [tipo, id]);
    const grupoIds = grR.rows.map(g => g.grupo_id);
    const projetoIds = [...new Set(grR.rows.map(g => g.projeto_id))];
    let avisos = [];
    if (grupoIds.length || projetoIds.length) {
      const avR = await query(`
        SELECT a.texto, a.criado_em, g.nome as grupo_nome
        FROM avisos_cientificos a
        LEFT JOIN grupos_cientificos g ON g.id=a.grupo_id
        WHERE a.grupo_id = ANY($1::int[]) OR a.projeto_id = ANY($2::int[])
        ORDER BY a.criado_em DESC LIMIT 10
      `, [grupoIds, projetoIds]);
      avisos = avR.rows;
    }
    res.json({ grupos: grR.rows, avisos, portalUrl: 'https://cientifico.lauroucpcde.com' });
  } catch(e) { res.json({ grupos: [], avisos: [], erro: e.message }); }
});

router.get('/membro/materiais-lista', requireMembro, async (req, res) => {
  const materiais = await query("SELECT * FROM materiais_estudo WHERE ativo=true ORDER BY ordem ASC, criado_em DESC");
  const membro = await getMembroPortal(req.session.membroPortal.tipo, req.session.membroPortal.id);
  res.render('pages/membro/materiais', { membro, materiais: materiais.rows });
});

router.get('/membro/esqueci-senha', (req, res) => {
  res.render('pages/membro/esqueci-senha', { erro: null, ok: null });
});

// POST /membro/esqueci-senha
router.post('/membro/esqueci-senha', limiterEsqueciSenha, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.render('pages/membro/esqueci-senha', { erro: 'Informe o email.', ok: null });
  // Buscar ligante ou diretivo
  let tipo = null, id = null;
  const l = await query('SELECT id FROM ligantes WHERE LOWER(email)=LOWER($1) AND ativo=1', [email]);
  if (l.rows.length) { tipo = 'ligante'; id = l.rows[0].id; }
  if (!tipo) {
    const d = await query('SELECT id FROM diretivos WHERE LOWER(email)=LOWER($1) AND ativo=1', [email]);
    if (d.rows.length) { tipo = 'diretivo'; id = d.rows[0].id; }
  }
  // Nao revelar se email existe ou nao (seguranca)
  if (!tipo) return res.render('pages/membro/esqueci-senha', { erro: null, ok: 'Se o email estiver cadastrado, voce recebera o codigo em instantes.' });
  // Gerar codigo de 6 digitos (crypto.randomInt — nao previsivel como Math.random)
  const codigo = require('crypto').randomInt(100000, 1000000).toString();
  const expira = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos
  // Invalidar codigos anteriores
  await query('UPDATE recuperacao_senha_portal SET usado=true WHERE email=LOWER($1) AND usado=false', [email]);
  // Salvar novo codigo
  await query('INSERT INTO recuperacao_senha_portal (origem_tipo, origem_id, email, codigo, expira_em) VALUES ($1,$2,LOWER($3),$4,$5)', [tipo, id, email, codigo, expira]);
  // Enviar email
  try {
    const { enviarEmail } = require('../services/notificacoes');
    const config = await getConfig();
    const orgNome = config.org_nome || 'LAURO - Liga Academica de Urologia';
    await enviarEmail({
      para: email,
      assunto: 'Codigo de recuperacao de senha — ' + orgNome,
      html: `<div style="font-family:'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#0C231B;margin-bottom:8px">${orgNome}</h2>
        <p style="color:#6B7A72;margin-bottom:24px">Portal do Membro</p>
        <p style="margin-bottom:16px">Voce solicitou a recuperacao de senha. Use o codigo abaixo para redefinir sua senha:</p>
        <div style="background:#0C231B;color:#4ade80;font-size:36px;font-weight:700;letter-spacing:12px;text-align:center;padding:24px;margin:24px 0">${codigo}</div>
        <p style="color:#6B7A72;font-size:13px">Este codigo expira em <strong>15 minutos</strong>.</p>
        <p style="color:#6B7A72;font-size:13px;margin-top:8px">Se nao foi voce, ignore este email.</p>
        <hr style="border:none;border-top:1px solid #E5EBE8;margin:24px 0">
        <p style="color:#9BA8A4;font-size:11px">Portal do Membro — <a href="https://membro.lauroucpcde.com" style="color:#0F6E56">membro.lauroucpcde.com</a></p>
      </div>`
    });
  } catch(e) { console.error('Erro ao enviar email recuperacao:', e.message); }
  res.render('pages/membro/esqueci-senha', { erro: null, ok: 'Se o email estiver cadastrado, voce recebera o codigo em instantes.' });
});

// GET /membro/verificar-codigo
router.get('/membro/verificar-codigo', (req, res) => {
  const email = req.query.email || '';
  res.render('pages/membro/verificar-codigo', { email, erro: null });
});

// POST /membro/verificar-codigo
router.post('/membro/verificar-codigo', limiterCodigoRecuperacao, async (req, res) => {
  const { email, codigo, nova_senha, confirmar_senha } = req.body;
  if (!codigo || !nova_senha || !confirmar_senha) return res.render('pages/membro/verificar-codigo', { email, erro: 'Preencha todos os campos.' });
  if (nova_senha !== confirmar_senha) return res.render('pages/membro/verificar-codigo', { email, erro: 'As senhas nao conferem.' });
  if (nova_senha.length < 6) return res.render('pages/membro/verificar-codigo', { email, erro: 'A senha deve ter pelo menos 6 caracteres.' });
  // Verificar codigo
  const r = await query('SELECT * FROM recuperacao_senha_portal WHERE LOWER(email)=LOWER($1) AND codigo=$2 AND usado=false AND expira_em > NOW() ORDER BY criado_em DESC LIMIT 1', [email, codigo.trim()]);
  if (!r.rows.length) return res.render('pages/membro/verificar-codigo', { email, erro: 'Codigo invalido ou expirado. Solicite um novo codigo.' });
  const rec = r.rows[0];
  // Atualizar senha
  const hash = await bcryptMembro.hash(nova_senha, 10);
  await query('UPDATE portal_cientifico_senhas SET senha_hash=$1, primeiro_acesso=false WHERE origem_tipo=$2 AND origem_id=$3', [hash, rec.origem_tipo, rec.origem_id]);
  // Marcar codigo como usado
  await query('UPDATE recuperacao_senha_portal SET usado=true WHERE id=$1', [rec.id]);
  res.redirect('/membro/login?msg=Senha+redefinida+com+sucesso');
});

