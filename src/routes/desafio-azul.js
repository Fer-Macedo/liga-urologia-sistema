// ═══ LANDING DESAFÍO RUN AZUL 2026 ══════════════════════════════════════════
const { query } = require('../models/database');
const { limiterContato } = require('../services/rate-limiters');

module.exports = function (router) {

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


};
