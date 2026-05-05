function requireAuth(req, res, next) {
  if (req.session && req.session.usuario) return next();
  req.flash('erro', 'Faça login para continuar.');
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session?.usuario?.perfil === 'admin') return next();
  req.flash('erro', 'Acesso restrito ao administrador.');
  res.redirect('/dashboard');
}

function requireFinanceiro(req, res, next) {
  const perfil = req.session?.usuario?.perfil;
  if (perfil === 'admin' || perfil === 'financeiro') return next();
  req.flash('erro', 'Sem permissão para esta ação.');
  res.redirect('/dashboard');
}

function requireSecretaria(req, res, next) {
  const perfil = req.session?.usuario?.perfil;
  if (perfil === 'admin' || perfil === 'secretaria') return next();
  req.flash('erro', 'Acesso restrito ao secretário e administrador.');
  res.redirect('/dashboard');
}

// Middleware flexivel — verifica permissao no banco
function requirePermissao(modulo) {
  return async function(req, res, next) {
    const usuario = req.session?.usuario;
    if (!usuario) { req.flash('erro', 'Faça login para continuar.'); return res.redirect('/login'); }

    // Admin tem acesso total
    if (usuario.perfil === 'admin') return next();

    // Verifica permissao no banco
    try {
      const { query } = require('../models/database');
      const r = await query(
        'SELECT id FROM usuario_permissoes WHERE usuario_id=$1 AND modulo=$2',
        [usuario.id, modulo]
      );
      if (r.rows.length > 0) return next();
    } catch(e) { console.error('Erro ao verificar permissao:', e.message); }

    req.flash('erro', 'Você não tem permissão para acessar este módulo.');
    res.redirect('/dashboard');
  };
}

module.exports = { requireAuth, requireAdmin, requireFinanceiro, requireSecretaria, requirePermissao };
