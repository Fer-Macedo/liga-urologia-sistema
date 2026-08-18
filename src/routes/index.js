const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const xss = require('xss');

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
      // youtube.com/-nocookie: embed da transmissão ao vivo do evento (/live/:token). Sem isso
      // o navegador BLOQUEIA o iframe caladamente — a página carrega normal, a contagem de
      // presença continua funcionando (é só fetch/ping, não passa pelo frame-src), mas o vídeo
      // nunca aparece: tela preta o tempo todo (achado em produção 17/08/2026, Erro 153 do
      // YouTube ao tentar embutir fora de um frame permitido).
      frameSrc: ["'self'", "https://view.officeapps.live.com", "https://www.youtube.com", "https://www.youtube-nocookie.com"],
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

// Pular o limite geral pra rotas publicas de fluxo unico (varias pessoas atras do MESMO IP —
// rede da faculdade, dormitorio, operadora de celular — nao podem somar no mesmo teto e
// derrubar gente de verdade). /live/ inclui /live/:token/ping, que bate a cada 2min por pessoa
// assistindo; a propria rota /ping ja tem seu limite por token (90s entre contagens), entao
// tirar do limite geral aqui nao abre brecha de abuso. Extraída como função própria (em vez de
// inline) pra dar pra testar sem montar o rate-limiter inteiro — mesmo teste de carga real que
// já pegou /checkout derrubando 11 de 100 simultâneos do mesmo IP (12/08/2026).
function deveSkipLimiteGeral(req) {
  var p = req.path || '';
  if (p.indexOf('/checkout') === 0 || p.indexOf('/inscricao') === 0 || p.indexOf('/webhook') === 0) return true;
  if (p.indexOf('/live/') === 0) return true;
  if (p.indexOf('/participar/') === 0) return true; // inscrição pública de sorteio Externo
  if (req.session && req.session.usuario) return true; // admin autenticado — sem limite
  return false;
}

// Rate limit geral
const limiterGeral = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  message: { erro: 'Muitas requisições. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: deveSkipLimiteGeral
});

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
// ─── MÓDULOS DE DOMÍNIO ───────────────────────────────────────────────────────
// desafio-azul ANTES de auth: o middleware que detecta o host desafiorunazul e serve a
// landing precisa registrar antes da rota GET '/' do auth (que redireciona p/ o dashboard).
// Ordem de registro no Express manda — inverter isso faz a landing cair no login.
require('./desafio-azul')(router);
require('./auth')(router);
require('./dashboard')(router);
require('./membros')(router);
require('./cobrancas')(router);
require('./configuracoes')(router);
require('./usuarios')(router);
require('./atendimentos')(router);
require('./instagram')(router);
require('./inventario')(router);
require('./sistema')(router);
require('./processo-seletivo')(router);
require('./projetos-academicos')(router);
require('./projeto-fluxo')(router);
require('./whatsapp-oficial')(router);
require('./whatsapp-wapi')(router);
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





module.exports = router;

