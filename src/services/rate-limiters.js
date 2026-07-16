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

module.exports = { limiterApiPublica, limiterContato, limiterLogin, limiterCodigoRecuperacao, limiterEsqueciSenha, limiterPagamentoCartao };
