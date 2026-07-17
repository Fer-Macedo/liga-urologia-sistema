// ═══ SISTEMA (busca global, backup manual, política de privacidade) ═════════
const { query } = require('../models/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getConfig } = require('../services/config');
const { executarBackup, dumpParaArquivo } = require('../services/backup');
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function (router) {

// BACKUP MANUAL — usa o mesmo pg_dump do backup automático (ver services/backup.js):
// dump completo (todas as tabelas) comprimido em .sql.gz. POST força um backup agora
// (salva em disco + e-mail); download gera um dump fresco na hora e envia pro navegador.
router.post('/admin/backup', requireAuth, requireAdmin, (req, res) => {
  res.json({ ok: true, msg: 'Backup iniciado — você receberá um e-mail em instantes.' });
  executarBackup();
});

router.get('/admin/backup/download', requireAuth, requireAdmin, async (req, res) => {
  const tmp = path.join(os.tmpdir(), 'backup-lauro-' + Date.now() + '.sql.gz');
  try {
    await dumpParaArquivo(tmp);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', 'attachment; filename="backup-lauro-' + new Date().toISOString().slice(0, 10) + '.sql.gz"');
    fs.createReadStream(tmp).pipe(res).on('close', () => fs.unlink(tmp, () => {}));
  } catch (e) {
    fs.unlink(tmp, () => {});
    res.status(500).send('Erro ao gerar backup: ' + e.message);
  }
});






// ─── BUSCA GLOBAL ─────────────────────────────────────────────────────────
router.get('/buscar', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  const like = '%' + q + '%';
  let ligantes = [], membros = [], diretivos = [], eventos = [], cobrancas = [];

  if (q.length >= 1) {
    try {
      const r = await query("SELECT id, nome, email, whatsapp, semestre, turma FROM ligantes WHERE nome ILIKE $1 OR email ILIKE $1 OR whatsapp ILIKE $1 OR rg ILIKE $1 OR cpf ILIKE $1 ORDER BY nome LIMIT 30", [like]);
      ligantes = r.rows;
    } catch (e) { console.error('busca ligantes:', e.message); }

    try {
      const r = await query("SELECT id, nome, email, whatsapp, status FROM membros WHERE nome ILIKE $1 OR email ILIKE $1 OR whatsapp ILIKE $1 OR cpf ILIKE $1 OR rg ILIKE $1 ORDER BY nome LIMIT 30", [like]);
      membros = r.rows;
    } catch (e) { console.error('busca membros:', e.message); }

    try {
      const r = await query("SELECT id, nome, email, whatsapp, cargo FROM diretivos WHERE nome ILIKE $1 OR email ILIKE $1 OR whatsapp ILIKE $1 OR rg ILIKE $1 OR cpf ILIKE $1 ORDER BY nome LIMIT 30", [like]);
      diretivos = r.rows;
    } catch (e) { console.error('busca diretivos:', e.message); }

    try {
      const r = await query("SELECT id, nome, status, data_inicio, local FROM eventos WHERE nome ILIKE $1 OR descricao ILIKE $1 OR local ILIKE $1 ORDER BY data_inicio DESC NULLS LAST LIMIT 30", [like]);
      eventos = r.rows;
    } catch (e) { console.error('busca eventos:', e.message); }

    try {
      const r = await query("SELECT c.*, m.nome AS membro_nome FROM cobrancas c LEFT JOIN membros m ON m.id = c.membro_id WHERE m.nome ILIKE $1 ORDER BY c.id DESC LIMIT 30", [like]);
      cobrancas = r.rows;
    } catch (e) { console.error('busca cobrancas:', e.message); }
  }

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const total = ligantes.length + membros.length + diretivos.length + eventos.length + cobrancas.length;
  const join = (arr) => arr.filter(Boolean).map(esc).join(' · ');
  const tag = (st) => {
    const s = String(st || '').toLowerCase();
    if (s.indexOf('atras') >= 0) return '<span class="tag t-at">atrasado</span>';
    if (s.indexOf('pag') >= 0) return '<span class="tag t-ok">pago</span>';
    if (s.indexOf('pend') >= 0) return '<span class="tag t-pe">pendente</span>';
    if (s) return '<span class="tag t-pe">' + esc(s) + '</span>';
    return '';
  };

  let corpo = '';
  if (ligantes.length) corpo += '<section class="grp"><h2>Ligantes <span>' + ligantes.length + '</span></h2><div class="cards">' +
    ligantes.map(function (l) { return '<a class="card" href="/ligantes"><div class="nm">' + esc(l.nome) + '</div><div class="meta">' + join([l.email, l.whatsapp, l.semestre && ('Sem. ' + l.semestre), l.turma && ('Turma ' + l.turma)]) + '</div></a>'; }).join('') + '</div></section>';

  if (membros.length) corpo += '<section class="grp"><h2>Membros <span>' + membros.length + '</span></h2><div class="cards">' +
    membros.map(function (m) { return '<a class="card" href="/membros"><div class="nm">' + esc(m.nome) + tag(m.status) + '</div><div class="meta">' + join([m.email, m.whatsapp]) + '</div></a>'; }).join('') + '</div></section>';

  if (diretivos.length) corpo += '<section class="grp"><h2>Diretivos <span>' + diretivos.length + '</span></h2><div class="cards">' +
    diretivos.map(function (d) { return '<a class="card" href="/diretivos"><div class="nm">' + esc(d.nome) + '</div><div class="meta">' + join([d.cargo, d.email, d.whatsapp]) + '</div></a>'; }).join('') + '</div></section>';

  if (eventos.length) corpo += '<section class="grp"><h2>Eventos <span>' + eventos.length + '</span></h2><div class="cards">' +
    eventos.map(function (ev) { var dt = ''; try { if (ev.data_inicio) dt = new Date(ev.data_inicio).toLocaleDateString('pt-BR'); } catch (e) {} return '<a class="card" href="/eventos/' + ev.id + '"><div class="nm">' + esc(ev.nome) + (ev.status ? tag(ev.status) : '') + '</div><div class="meta">' + join([dt, ev.local]) + '</div></a>'; }).join('') + '</div></section>';

  if (cobrancas.length) corpo += '<section class="grp"><h2>Cobranças <span>' + cobrancas.length + '</span></h2><div class="cards">' +
    cobrancas.map(function (c) { var val = (c.valor != null) ? ('R$ ' + Number(c.valor).toFixed(2).replace('.', ',')) : ''; return '<a class="card" href="/cobrancas"><div class="nm">' + esc(c.membro_nome || 'Cobrança') + tag(c.status) + '</div><div class="meta">' + join([val]) + '</div></a>'; }).join('') + '</div></section>';

  if (q && total === 0) corpo = '<div class="vazio">Nenhum resultado encontrado para "<b>' + esc(q) + '</b>".</div>';

  const html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Busca — LAURO</title><style>'
    + '*{box-sizing:border-box;margin:0;padding:0}'
    + 'body{font-family:Segoe UI,system-ui,sans-serif;background:#f4f6f3;color:#1c2620;padding:24px}'
    + '.wrap{max-width:880px;margin:0 auto}'
    + '.back{display:inline-flex;align-items:center;gap:6px;text-decoration:none;color:#fff;background:#1a3d2b;padding:9px 16px;border-radius:8px;font-size:14px;font-weight:600}'
    + '.back:hover{background:#2b6803}'
    + 'h1{font-size:20px;font-weight:700;margin:18px 0 4px}'
    + '.sub{color:#5b6b60;font-size:14px;margin-bottom:22px}'
    + 'form.bar{display:flex;gap:8px;margin-bottom:26px}'
    + 'form.bar input{flex:1;border:1px solid #cdd6cf;border-radius:8px;padding:11px 14px;font-size:15px}'
    + 'form.bar button{background:#2b6803;color:#fff;border:0;border-radius:8px;padding:0 20px;font-weight:600;cursor:pointer}'
    + '.grp{margin-bottom:24px}'
    + '.grp h2{font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#3a4a40;margin-bottom:10px;font-weight:700}'
    + '.grp h2 span{background:#e3ede5;color:#2b6803;border-radius:20px;padding:2px 9px;font-size:12px;margin-left:6px}'
    + '.cards{display:flex;flex-direction:column;gap:8px}'
    + '.card{display:block;background:#fff;border:1px solid #e6ece7;border-radius:10px;padding:13px 16px;text-decoration:none;color:inherit;transition:.15s}'
    + '.card:hover{border-color:#2b6803;box-shadow:0 3px 12px rgba(43,104,3,.10);transform:translateY(-1px)}'
    + '.card .nm{font-weight:600;font-size:15px;color:#172419}'
    + '.card .meta{font-size:13px;color:#69786e;margin-top:3px}'
    + '.tag{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;margin-left:8px;vertical-align:middle}'
    + '.t-at{background:#fdeaea;color:#c0392b}.t-ok{background:#e7f6ea;color:#1e7d34}.t-pe{background:#fef6e3;color:#b8860b}'
    + '.vazio{text-align:center;color:#7a897f;padding:50px 20px;background:#fff;border:1px dashed #d3ddd5;border-radius:12px}'
    + '</style></head><body><div class="wrap">'
    + '<a class="back" href="/dashboard">&larr; Voltar ao painel</a>'
    + '<h1>Resultados da busca</h1>'
    + '<div class="sub">' + (q ? ('Você buscou por "<b>' + esc(q) + '</b>" &mdash; ' + total + ' resultado(s)') : 'Digite algo para buscar') + '</div>'
    + '<form class="bar" action="/buscar" method="get"><input name="q" value="' + esc(q) + '" placeholder="Buscar ligantes, membros, eventos, cobranças..." autofocus><button type="submit">Buscar</button></form>'
    + corpo
    + '</div></body></html>';

  res.send(html);
});

// ─── POLÍTICA DE PRIVACIDADE PÚBLICA ─────────────────────────────────────────
router.get("/privacidade", (req, res) => {
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Política de Privacidad — LAURO Liga CDE</title><style>body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#333;line-height:1.7}h1{color:#1a3d2b}h2{color:#1a3d2b;margin-top:32px}a{color:#1a3d2b}</style></head><body><h1>Política de Privacidad</h1><p><strong>Liga Académica de Urología — UCP | Ciudad del Este</strong></p><p>Última actualización: junio de 2026</p><h2>1. Información que recopilamos</h2><p>Recopilamos la información proporcionada directamente por usted, como nombre, correo electrónico, número de WhatsApp y datos de pago, para fines de gestión de miembros y eventos académicos.</p><h2>2. Uso de la información</h2><p>La información recopilada se utiliza exclusivamente para comunicación institucional, cobro de cuotas, notificaciones de eventos y gestión de la liga académica.</p><h2>3. Compartición</h2><p>No compartimos sus datos con terceros, salvo cuando sea necesario para el procesamiento de pagos (PagBank) o el cumplimiento de obligaciones legales.</p><h2>4. Seguridad</h2><p>Adoptamos medidas técnicas y organizativas para proteger sus datos contra el acceso no autorizado, la pérdida o la divulgación indebida.</p><h2>5. Sus derechos</h2><p>Usted puede solicitar el acceso, la corrección o la eliminación de sus datos en cualquier momento a través del correo electrónico: <a href="mailto:fernando.macedoo@hotmail.com">fernando.macedoo@hotmail.com</a></p><h2>6. Contacto</h2><p>Para dudas sobre esta política, contáctese con la secretaría de la Liga Académica de Urología — UCP.</p></body></html>`);
});
// ─── FIM POLÍTICA DE PRIVACIDADE ──────────────────────────────────────────────

};
