const rateLimit = require('express-rate-limit');

// Rate limit específico para APIs públicas (mais permissivo para o site)
const limiterApiPublica = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { erro: 'Muitas requisições. Aguarde 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limit para contato (anti-spam) - compartilhado entre /api/contato-site e /desafio-azul/contato
const limiterContato = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { erro: 'Limite de mensagens atingido. Tente em 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { limiterApiPublica, limiterContato };
