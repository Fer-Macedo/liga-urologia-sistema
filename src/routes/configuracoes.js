// ═══ CONFIGURAÇÕES (+ tela de notificações) ═════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requireAdmin, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');

module.exports = function (router) {

// ─── NOTIFICAÇÕES ──────────────────────────────────────────────────────────────

router.get('/notificacoes', requireAuth, requirePermissao('notificacoes'), async (req, res) => {
  res.render('pages/notificacoes', { config: await getConfig(), usuario: req.session.usuario, msg: req.flash('msg') });
});

router.post('/notificacoes', requireAuth, requireAdmin, async (req, res) => {
  const campos = ['notif_pre_ativo','notif_dia_ativo','notif_aniversario_ativo','notif_atrasados_diario',
    'msg_cobranca_pre','msg_cobranca_dia','msg_cobranca_pos','msg_aniversario'];
  for (const c of campos) {
    const val = req.body[c] !== undefined ? (req.body[c] === 'on' ? '1' : req.body[c]) : '0';
    await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', [c, val]);
  }
  req.flash('msg', 'Configurações salvas!');
  res.redirect('/notificacoes');
});

// ─── CONFIGURAÇÕES ─────────────────────────────────────────────────────────────

router.get('/configuracoes', requireAuth, requirePermissao('configuracoes'), async (req, res) => {
  res.render('pages/configuracoes', { config: await getConfig(), usuario: req.session.usuario, msg: req.flash('msg'), erro: req.flash('erro') });
});

router.post('/configuracoes', requireAuth, requireAdmin, async (req, res) => {
  const {upload:upCfg, uploadArquivo:upArqCfg} = require('../services/arquivos');
  // O multer processa o multipart/form-data. SÓ DEPOIS dele o req.body fica preenchido.
  upCfg.fields([{name:'assinatura_presidente'},{name:'assinatura_vicepresidente'},{name:'assinatura_secretario'},{name:'assinatura_financeiro'},{name:'assinatura_director_ensino'},{name:'assinatura_director_extension'},{name:'timbrado'}])(req, res, async(err)=>{
    try {
      if (err) { req.flash('erro','Error al subir archivo: '+err.message); return res.redirect('/configuracoes'); }
      const camposCheckbox = ['notif_pre_ativo','notif_dia_ativo','notif_aniversario_ativo','notif_atrasados_diario'];
      const ignorar = ['_csrf'];
      // Salva DINAMICAMENTE qualquer campo de texto (escalável p/ outras ligas)
      for (const chave of Object.keys(req.body || {})) {
        if (ignorar.includes(chave)) continue;
        let val = req.body[chave];
        if (Array.isArray(val)) val = val[val.length - 1];
        if (camposCheckbox.includes(chave)) { val = (val === 'on' || val === '1') ? '1' : '0'; }
        await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', [chave, val]);
      }
      // Checkboxes desmarcados (não enviados) viram '0'
      for (const c of camposCheckbox) {
        if (req.body[c] === undefined) {
          await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2', [c, '0']);
        }
      }
      // Uploads de arquivos
      for(const campo of ['assinatura_presidente','assinatura_vicepresidente','assinatura_secretario','assinatura_financeiro','assinatura_director_ensino','assinatura_director_extension','timbrado']){
        if(req.files && req.files[campo] && req.files[campo][0]){
          const ff=req.files[campo][0];
          const r=await upArqCfg(ff.buffer,ff.originalname,ff.mimetype,campo);
          await query('INSERT INTO configuracoes (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=$2',[campo+'_chave',r.chave]);
        }
      }
      req.flash('msg', 'Configurações salvas!');
      res.redirect('/configuracoes');
    } catch(e) { console.error('salvar config:', e); req.flash('erro', e.message); res.redirect('/configuracoes'); }
  });
});

router.post('/configuracoes/logo-url', requireAuth, requireAdmin, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.json({ ok: false });
  await query("INSERT INTO configuracoes (chave,valor) VALUES ('org_logo',$1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [url]);
  res.json({ ok: true });
});

};
