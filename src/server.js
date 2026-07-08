require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');

const { initSchema } = require('./models/database');
const routes = require('./routes/index');
const { iniciarAgendamentos } = require('./services/agendamentos');
const { agendarBackup } = require('./services/backup');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const http = require('http');
const { Server: SocketServer } = require('socket.io');
const httpServer = http.createServer(app);
const io = new SocketServer(httpServer, { cors: { origin: '*' } });
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
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use(methodOverride('_method'));
if (!process.env.SESSION_SECRET) {
  console.warn('AVISO: SESSION_SECRET nao definido no .env — usando segredo temporario gerado neste boot (sessoes serao invalidadas a cada restart). Configure SESSION_SECRET em producao.');
}
const sessionMiddleware = session({
  store: new pgSession({ conString: process.env.DATABASE_URL, tableName: 'session', createTableIfMissing: true }),
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

app.use((req, res, next) => {
  res.locals.usuarioLogado = req.session.usuario || null;
  res.locals.permissoesAtivas = req.session.permissoesAtivas || [];
  next();
});

// Health check para o Render
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now(), __dirname, views: app.get('views'), cwd: process.cwd(), pid: process.pid }));

app.use('/', routes);

app.use((req, res) => {
  res.status(404).render('pages/erro', { config: {}, mensagem: 'Página não encontrada.' });
});

// Inicia tudo após conectar ao banco
async function start() {
  try {
    await initSchema();
    iniciarAgendamentos();
    agendarBackup();
    httpServer.listen(PORT, () => {
      console.log('\n🏥 Liga Urologia — Sistema de Cobranças');
      console.log('🌐 Porta: ' + PORT);
      console.log('📧 Login: admin@liga.org.br | Senha: admin123\n');

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
