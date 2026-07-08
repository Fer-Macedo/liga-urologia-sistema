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
  const tipo = socket.handshake.auth?.tipo;
  const id = socket.handshake.auth?.id;
  if (tipo && id) socket.join('membro_' + tipo + '_' + id);
  socket.on('chat_msg', async (data) => {
    try {
      if (!data.texto || !tipo || !id) return;
      const { query } = require('./models/database');
      const { registrarMensagemMembro } = require('./services/portal-chat');
      const r = await registrarMensagemMembro(query, tipo, id, data.texto);
      socket.emit('chat_msg_ok', { id: r.id, texto: data.texto, criado_em: r.criado_em, autor: 'membro' });
      io.to('admins').emit('chat_novo', { tipo, id, texto: data.texto, nome: r.nome, atendimentoId: r.atendimentoId });
    } catch(e) { console.error('chat_msg error:', e.message); }
  });
  socket.on('join_admin', () => { socket.join('admins'); });
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
app.use(session({
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
}));
app.use(flash());

const { csrfInjetar, csrfVerificar } = require('./middleware/csrf');
app.use(csrfInjetar);
app.use(csrfVerificar);

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
