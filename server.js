require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');

const { initSchema } = require('./models/database');
const routes = require('./routes/index');
const { iniciarAgendamentos } = require('./services/agendamentos');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'liga-urologia-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(flash());

app.use((req, res, next) => {
  res.locals.usuarioLogado = req.session.usuario || null;
  next();
});

// Health check para o Render
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

app.use('/', routes);

app.use((req, res) => {
  res.status(404).render('pages/erro', { config: {}, mensagem: 'Página não encontrada.' });
});

// Inicia tudo após conectar ao banco
async function start() {
  try {
    await initSchema();
    iniciarAgendamentos();
    app.listen(PORT, () => {
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
