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

module.exports = { requireAuth, requireAdmin, requireFinanceiro, requireSecretaria };
