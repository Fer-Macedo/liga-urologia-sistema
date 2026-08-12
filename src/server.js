require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');

const { initSchema, query, pool } = require('./models/database');
const routes = require('./routes/index');
const { iniciarAgendamentos } = require('./services/agendamentos');
const { agendarBackup } = require('./services/backup');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const http = require('http');
const { Server: SocketServer } = require('socket.io');
const httpServer = http.createServer(app);
// CORS do Socket.io restrito aos dominios do sistema (painel + portal do membro).
// Origens extras podem ser adicionadas via SOCKET_ORIGINS no .env (separadas por virgula).
const origensPermitidas = [
  'https://sistema.lauroucpcde.com',
  'https://membro.lauroucpcde.com',
  'https://sistema-teste.lauroucpcde.com',
  ...(process.env.SOCKET_ORIGINS ? process.env.SOCKET_ORIGINS.split(',').map(s => s.trim()) : []),
  ...(process.env.APP_URL ? [process.env.APP_URL.replace(/\/$/, '')] : [])
];
const io = new SocketServer(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? origensPermitidas : true,
    credentials: true
  }
});
app._io = io;
io.on('connection', (socket) => {
  // Identidade vem SEMPRE da sessao do servidor (cookie), nunca de dados enviados
  // pelo cliente no handshake — senao qualquer um personifica membros/entra na sala admin.
  const sess = socket.request.session;
  const membro = (sess && (sess.membroPortal || sess.portalMembro)) || null;
  if (membro && membro.tipo && membro.id) socket.join('membro_' + membro.tipo + '_' + membro.id);
  socket.on('chat_msg', async (data) => {
    try {
      if (!data.texto || !membro || !membro.tipo || !membro.id) return;
      const { query } = require('./models/database');
      const { registrarMensagemMembro } = require('./services/portal-chat');
      const r = await registrarMensagemMembro(query, membro.tipo, membro.id, data.texto);
      socket.emit('chat_msg_ok', { id: r.id, texto: data.texto, criado_em: r.criado_em, autor: 'membro' });
      io.to('admins').emit('chat_novo', { tipo: membro.tipo, id: membro.id, texto: data.texto, nome: r.nome, atendimentoId: r.atendimentoId });
    } catch(e) { console.error('chat_msg error:', e.message); }
  });
  // Sala de broadcast dos atendimentos: apenas equipe autenticada.
  socket.on('join_admin', () => { if (sess && sess.usuario) socket.join('admins'); });
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.use(express.static(path.join(__dirname, '../public')));
// Limite de 25mb: cobre anexos base64 que sobem pelo corpo JSON (assistente virtual,
// materiais cientificos, contratos assinados, midia de atendimento) — base64 infla ~33%,
// entao 25mb comporta arquivos de ~18mb. Ainda corta payloads gigantes usados em DoS.
// Uploads de arquivo comuns usam multer (multipart), com limite proprio (500mb).
// O webhook do PagBank TEM que ler o corpo cru, e por isso vem ANTES do express.json.
// Se o json global rodar primeiro, ele consome o stream e marca req._body=true; o
// express.raw da rota entao pula, req.body chega como objeto, req.body.toString() vira
// "[object Object]", o JSON.parse falha e a rota responde 200 descartando a notificacao.
// Foi exatamente isso: em toda a historia do sistema, ZERO notificacoes do PagBank foram
// processadas — pagamento no cartao caia no vazio e o membro seguia sendo cobrado.
app.use('/webhook/pagbank', express.raw({ type: '*/*', limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.json({ limit: '25mb' }));
app.use(methodOverride('_method'));
if (!process.env.SESSION_SECRET) {
  console.warn('AVISO: SESSION_SECRET nao definido no .env — usando segredo temporario gerado neste boot (sessoes serao invalidadas a cada restart). Configure SESSION_SECRET em producao.');
}
const sessionMiddleware = session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  }
});
app.use(sessionMiddleware);
// Compartilha a sessao com o Socket.io — expoe socket.request.session no handshake.
io.engine.use(sessionMiddleware);
app.use(flash());

const { csrfInjetar, csrfVerificar } = require('./middleware/csrf');
app.use(csrfInjetar);
app.use(csrfVerificar);

// Garante o app.js (modais de confirmacao/aviso padrao + override do alert nativo)
// em TODA pagina HTML do sistema, mesmo nas que nao o incluem manualmente.
// Nao duplica onde ja existe.
app.use((req, res, next) => {
  const origSend = res.send.bind(res);
  res.send = function(body) {
    if (typeof body === 'string' && body.includes('</body>') && !body.includes('/js/app.js')) {
      body = body.replace('</body>', '<script src="/js/app.js"></script></body>');
    }
    return origSend(body);
  };
  next();
});

app.use(async (req, res, next) => {
  res.locals.usuarioLogado = req.session.usuario || null;
  // O partial da sidebar depende de `usuario`: sem ele, cai p/ perfil 'visualizador' e some
  // metade do menu + o rodapé (nome/sair). Injetar aqui evita que uma rota esqueça de passar
  // (era o caso de /comunicados). Rotas que passam `usuario` no render sobrescrevem — mesmo valor.
  res.locals.usuario = req.session.usuario || null;
  res.locals.permissoesAtivas = req.session.permissoesAtivas || [];
  // Badge de correções de cadastro pendentes na sidebar (só p/ quem está logado no painel)
  res.locals.correcoesPendentesCount = 0;
  // Número do atendimento: as páginas públicas montam o link do WhatsApp com ele.
  // Injetado aqui porque quem mais usa são páginas sem login (inscrição, checkout,
  // desafio azul) e cada rota ter que lembrar de passar era o que gerou os 20 números
  // escritos à mão que isso veio substituir.
  try {
    res.locals.waAtendimento = await require('./services/contato').whatsappAtendimento();
  } catch (e) { res.locals.waAtendimento = require('./services/contato').PADRAO; }
  if (req.session.usuario) {
    try {
      const r = await query("SELECT COUNT(*) n FROM cadastro_correcoes WHERE status='pendente'");
      res.locals.correcoesPendentesCount = parseInt(r.rows[0].n) || 0;
    } catch (e) { /* badge é cosmético: nunca derruba a request */ }
  }
  next();
});

// Health check — só o essencial pra confirmar que o processo responde; __dirname/cwd/pid
// não tem por que estar público (nenhuma autenticação nessa rota).
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

app.use('/', routes);

app.use((req, res) => {
  res.status(404).render('pages/erro', { config: {}, mensagem: 'Página não encontrada.' });
});

// Inicia tudo após conectar ao banco
async function start() {
  try {
    await initSchema();
    // Staging roda com AGENDAMENTOS_OFF=true: sem cron de cobrança/lembrete e sem backup,
    // que são tarefas da produção e não devem rodar em duplicidade.
    if (process.env.AGENDAMENTOS_OFF === 'true') {
      console.log('⏸  Agendamentos e backup DESLIGADOS (AGENDAMENTOS_OFF=true)');
    } else {
      iniciarAgendamentos();
      agendarBackup();
    }
    // Aquece o número do atendimento: o rodapé dos e-mails lê de forma síncrona e
    // sem isso o primeiro e-mail após o boot sairia com o valor padrão do código.
    require('./services/contato').aquecer();
    httpServer.listen(PORT, () => {
      console.log('\n🏥 Liga Urologia — Sistema de Cobranças');
      console.log('🌐 Porta: ' + PORT + '\n');

      // Keep-alive: evita que o Render durma o app no plano gratuito
      const APP_URL = process.env.APP_URL;
      if (APP_URL) {
        const https = require('https');
        setInterval(() => {
          https.get(APP_URL + '/health', () => {}).on('error', () => {});
        }, 14 * 60 * 1000);
        console.log('💓 Keep-alive ativo → ' + APP_URL);
      }
    });
  } catch (err) {
    console.error('❌ Erro ao iniciar:', err.message);
    process.exit(1);
  }
}

start();
module.exports = app;
