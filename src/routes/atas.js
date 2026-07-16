// ═══ ATAS DE REUNIÃO ════════════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');

module.exports = function (router) {

// Página pública de assinatura — token único
router.get('/assinar-ata/:token', async (req, res) => {
  try {
    const pR = await query(`
      SELECT ap.*, ar.numero, ar.tipo, ar.data_reuniao, ar.hora_inicio, ar.local
      FROM atas_presentes ap
      JOIN atas_reuniao ar ON ar.id=ap.ata_id
      WHERE ap.token_assinatura=$1
    `, [req.params.token]);
    const cfg = await query("SELECT chave,valor FROM configuracoes WHERE chave IN ('org_logo','org_nome')");
    const cfgMap = {}; cfg.rows.forEach(r => cfgMap[r.chave]=r.valor);
    const orgLogo = cfgMap.org_logo || null;
    const orgNome = cfgMap.org_nome || 'LAURO';
    if (!pR.rows.length) return res.status(404).send('<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LAURO — Assinatura de Ata</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:#f1f5f9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:white;max-width:420px;width:100%;border-radius:8px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)}.header{background:linear-gradient(160deg,#1a3d2b 0%,#0a1f1a 100%);padding:28px 32px;text-align:center;color:white}.header p{font-size:12px;opacity:.7;margin:0}.body{padding:48px 32px;text-align:center}.footer{padding:16px 32px;background:#f8fafc;text-align:center;font-size:11px;color:#94a3b8}</style></head><body><div class="card"><div class="header"><img src="\'+orgLogo+\'" style="width:64px;height:64px;border-radius:50%;border:3px solid rgba(255,255,255,.3);display:block;margin:0 auto 12px"><p>\'+orgNome+\'</p></div><div class="body"><svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg><h2 style="color:#dc2626;margin:16px 0 8px;font-size:20px">Link invalido ou expirado</h2><p style="color:#475569;font-size:14px;line-height:1.6">Este link nao e mais valido. Solicite um novo link ao administrador da Liga.</p></div><div class="footer">Liga Academica de Urologia — LAURO | UCP | Ciudad del Este</div></div></body></html>'.replace("'+orgLogo+'", orgLogo||'').replace("'+orgNome+'", orgNome));
    const p = pR.rows[0];
    if (p.token_usado) return res.send('<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LAURO — Assinatura de Ata</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:#f1f5f9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:white;max-width:420px;width:100%;border-radius:8px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)}.header{background:linear-gradient(160deg,#1a3d2b 0%,#0a1f1a 100%);padding:28px 32px;text-align:center;color:white}.header p{font-size:12px;opacity:.7;margin:0}.body{padding:48px 32px;text-align:center}.footer{padding:16px 32px;background:#f8fafc;text-align:center;font-size:11px;color:#94a3b8}</style></head><body><div class="card"><div class="header"><img src="\'+orgLogo+\'" style="width:64px;height:64px;border-radius:50%;border:3px solid rgba(255,255,255,.3);display:block;margin:0 auto 12px"><p>\'+orgNome+\'</p></div><div class="body"><svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#1a3d2b" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg><h2 style="color:#1a3d2b;margin:16px 0 8px;font-size:20px">Ata ja assinada!</h2><p style="color:#475569;font-size:14px;line-height:1.6">Voce ja assinou esta ata anteriormente. Nao e possivel assinar novamente.</p></div><div class="footer">Liga Academica de Urologia — LAURO | UCP | Ciudad del Este</div></div></body></html>'.replace("'+orgLogo+'", orgLogo||'').replace("'+orgNome+'", orgNome));
    if (p.token_expira_em && new Date(p.token_expira_em) < new Date()) return res.send('<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LAURO — Assinatura de Ata</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:#f1f5f9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:white;max-width:420px;width:100%;border-radius:8px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)}.header{background:linear-gradient(160deg,#1a3d2b 0%,#0a1f1a 100%);padding:28px 32px;text-align:center;color:white}.header p{font-size:12px;opacity:.7;margin:0}.body{padding:48px 32px;text-align:center}.footer{padding:16px 32px;background:#f8fafc;text-align:center;font-size:11px;color:#94a3b8}</style></head><body><div class="card"><div class="header"><img src="\'+orgLogo+\'" style="width:64px;height:64px;border-radius:50%;border:3px solid rgba(255,255,255,.3);display:block;margin:0 auto 12px"><p>\'+orgNome+\'</p></div><div class="body"><svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><h2 style="color:#dc2626;margin:16px 0 8px;font-size:20px">Link expirado</h2><p style="color:#475569;font-size:14px;line-height:1.6">O prazo para assinatura deste link expirou. Solicite um novo link ao administrador.</p></div><div class="footer">Liga Academica de Urologia — LAURO | UCP | Ciudad del Este</div></div></body></html>'.replace("'+orgLogo+'", orgLogo||'').replace("'+orgNome+'", orgNome));
    const numAta = p.numero || p.ata_id;
    const tipoAta = p.tipo === 'ordinaria' ? 'Ordinaria' : p.tipo === 'extraordinaria' ? 'Extraordinaria' : 'Especial';
    const dataFormatada = p.data_reuniao ? new Date(p.data_reuniao).toLocaleDateString('pt-BR',{timeZone:'UTC',day:'2-digit',month:'2-digit',year:'numeric'}) : '';
    res.render('pages/assinar-ata-publica', {
      token: req.params.token,
      numAta,
      tipoAta,
      dataFormatada,
      membroNome: p.membro_nome,
      membroCargo: p.membro_cargo || '',
      orgLogo,
      orgNome
    });
  } catch(e) { console.error('assinar-ata GET:', e.message); res.status(500).send('Erro interno.'); }
});

// Marca token como visualizado — invalida ao abrir a página
router.post('/assinar-ata-aberto/:token', async (req, res) => {
  try {
    await query("UPDATE atas_presentes SET token_usado=true WHERE token_assinatura=$1 AND token_usado=false AND assinatura_digital IS NULL", [req.params.token]);
    res.json({ok:true});
  } catch(e) { res.json({ok:false}); }
});

router.post('/assinar-ata/:token', async (req, res) => {
  try {
    const pR = await query('SELECT * FROM atas_presentes WHERE token_assinatura=$1', [req.params.token]);
    if (!pR.rows.length) return res.json({ok:false, erro:'Link invalido.'});
    const p = pR.rows[0];
    if (p.token_usado) return res.json({ok:false, erro:'Este link ja foi utilizado.'});
    if (p.token_expira_em && new Date(p.token_expira_em) < new Date()) return res.json({ok:false, erro:'Link expirado.'});
    const { assinatura_digital } = req.body;
    if (!assinatura_digital) return res.json({ok:false, erro:'Assinatura nao encontrada.'});
    await query('UPDATE atas_presentes SET assinatura_digital=$1, assinou_em=NOW(), token_usado=true WHERE id=$2', [assinatura_digital, p.id]);
    res.json({ok:true});
  } catch(e) { console.error('assinar-ata POST:', e.message); res.json({ok:false, erro:'Erro interno.'}); }
});

// ─── ATAS DE REUNIÃO ──────────────────────────────────────────────────────────
router.get('/atas', requireAuth, requirePermissao('atas'), async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const page = parseInt(req.query.page)||1;
  const limit = 20;
  const offset = (page-1)*limit;
  const [atasR, totalR, diretivosR, ligantesR, ultimaR] = await Promise.all([
    query('SELECT a.*, u.nome as criado_por_nome FROM atas_reuniao a LEFT JOIN usuarios u ON u.id=a.criado_por ORDER BY a.criado_em DESC LIMIT $1 OFFSET $2', [limit, offset]),
    query('SELECT COUNT(*) as total FROM atas_reuniao'),
    query("SELECT id,nome,cargo FROM diretivos WHERE ativo=1 AND pendente=false ORDER BY nome"),
    query("SELECT id,nome FROM ligantes WHERE ativo=1 AND pendente=false ORDER BY nome"),
    query('SELECT numero FROM atas_reuniao ORDER BY id DESC LIMIT 1')
  ]);
  // Gerar próximo número automático
  const ano = new Date().getFullYear();
  let proximoSeq = '001';
  if(ultimaR.rows.length) {
    const ultimo = ultimaR.rows[0].numero||'000/'+ano;
    const partes = ultimo.split('/');
    const ultimoAno = parseInt(partes[1])||ano;
    const ultimoSeq = parseInt(partes[0])||0;
    // Se mudou o ano, reinicia sequência
    if(ultimoAno === ano) {
      proximoSeq = String(ultimoSeq+1).padStart(3,'0');
    } else {
      proximoSeq = '001';
    }
  }
  const total = parseInt(totalR.rows[0].total);
  const totalPages = Math.ceil(total/limit);
  res.render('pages/atas', { config, usuario: req.session.usuario, msg, erro, atas: atasR.rows, diretivos: diretivosR.rows, ligantes: ligantesR.rows, proximoSeq, page, totalPages });
});

router.post('/atas', requireAuth, requirePermissao('atas'), async (req, res) => {
  try {
    let { numero, tipo, data_reuniao, hora_inicio, hora_fim, local, pauta, corpo, membros_json } = req.body;
    if (Array.isArray(numero)) numero = numero[0]; // campo duplicado no form antigo podia mandar array
    if (numero) numero = String(numero).slice(0, 20);
    const r = await query(
      'INSERT INTO atas_reuniao(numero,tipo,data_reuniao,hora_inicio,hora_fim,local,pauta,corpo,status,criado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
      [numero||null, tipo, data_reuniao, hora_inicio||null, hora_fim||null, local, pauta, corpo, 'rascunho', req.session.usuario.id]
    );
    const ataId = r.rows[0].id;
    if(membros_json) {
      const membros = JSON.parse(membros_json);
      for(const m of membros) {
        await query('INSERT INTO atas_presentes(ata_id,membro_tipo,membro_id,membro_nome,membro_cargo,presente) VALUES($1,$2,$3,$4,$5,$6)',
          [ataId, m.tipo, m.id, m.nome, m.cargo||'', true]);
      }
    }
    req.session.msg = ['Ata criada com sucesso!'];
    res.redirect('/atas');
  } catch(e) {
    console.error('[Atas] Erro ao criar ata:', e.message);
    req.session.erro = ['Erro ao criar a ata: ' + e.message];
    res.redirect('/atas');
  }
});

router.get('/atas/:id', requireAuth, requirePermissao('atas'), async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const ata = await query('SELECT a.*,u.nome as criado_por_nome FROM atas_reuniao a LEFT JOIN usuarios u ON u.id=a.criado_por WHERE a.id=$1', [req.params.id]);
  if(!ata.rows.length) return res.redirect('/atas');
  const presentes = await query('SELECT * FROM atas_presentes WHERE ata_id=$1 ORDER BY membro_nome', [req.params.id]);
  const diretivos = await query("SELECT id,nome,cargo FROM diretivos WHERE ativo=1 AND pendente=false ORDER BY nome");
  const ligantes = await query("SELECT id,nome FROM ligantes WHERE ativo=1 AND pendente=false ORDER BY nome");
  res.render('pages/ata-detalhe', { config, usuario: req.session.usuario, ata: ata.rows[0], presentes: presentes.rows, diretivos: diretivos.rows, ligantes: ligantes.rows, msg, erro });
});

// Gera token de assinatura, envia o email de convite/reenvio e registra o resultado em notificacoes_log
async function notificarAssinaturaAta(ata, presente, { reenvio } = {}) {
  const crypto = require('crypto');
  const { enviarEmail } = require('../services/notificacoes');
  const chaveLog = 'ata_' + ata.id + '_presente_' + presente.id;
  if (!presente.email) {
    await query("INSERT INTO notificacoes_log(tipo,canal,status,observacao,criado_em) VALUES('ata_assinatura','email','sem_email',$1,NOW())", [chaveLog]);
    return;
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await query('UPDATE atas_presentes SET token_assinatura=$1, token_usado=false, token_expira_em=$2 WHERE id=$3', [token, expira, presente.id]);
  const appUrl = (process.env.APP_URL || 'https://sistema.lauroucpcde.com').replace(/\/$/, '');
  const linkAssinar = appUrl + '/assinar-ata/' + token;
  const primeiroNome = presente.membro_nome.split(' ')[0];
  const numAta = ata.numero || ata.id;
  const dataFormatada = ata.data_reuniao ? new Date(ata.data_reuniao).toLocaleDateString('pt-BR',{timeZone:'UTC',day:'2-digit',month:'2-digit',year:'numeric'}) : '';
  const tipoAta = ata.tipo === 'ordinaria' ? 'Ordinaria' : ata.tipo === 'extraordinaria' ? 'Extraordinaria' : 'Especial';
  const tituloEmail = (reenvio ? 'REENVIO — ' : '') + 'ASSINATURA DE ATA';
  const assunto = (reenvio ? 'Reenvio — ' : '') + 'Ata N' + numAta + ' aguarda sua assinatura — LAURO';
  const html = '<h2 style="margin:0 0 8px;font-size:20px;color:#0f172a">Ola, ' + primeiroNome + '!</h2><p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7">A <strong>Ata N' + numAta + '</strong> (Reuniao ' + tipoAta + ' — ' + dataFormatada + ') aguarda sua assinatura digital.</p><p style="text-align:center;margin:28px 0"><a href="' + linkAssinar + '" style="background:#1a3d2b;color:#fff;padding:14px 32px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block">Assinar Ata</a></p><p style="margin:0;font-size:12px;color:#94a3b8;text-align:center">Link de uso unico — expira apos a assinatura ou em 30 dias.</p>';
  const r = await enviarEmail({ para: presente.email, assunto, html, texto: 'Ola ' + primeiroNome + ', acesse: ' + linkAssinar, faixaLabel: tituloEmail });
  await query("INSERT INTO notificacoes_log(tipo,canal,status,observacao,criado_em) VALUES('ata_assinatura','email',$1,$2,NOW())", [r.ok ? 'ok' : 'erro', chaveLog]);
  return { link: linkAssinar };
}

router.post('/atas/:id/status', requireAuth, requirePermissao('atas'), async (req, res) => {
  const novoStatus = req.body.status;
  await query('UPDATE atas_reuniao SET status=$1,atualizado_em=NOW() WHERE id=$2', [novoStatus, req.params.id]);

  // Notificar presentes quando enviado para assinatura
  if (novoStatus === 'em_assinatura') {
    try {
      const { enviarWhatsApp } = require('../services/notificacoes');
      const ata = await query('SELECT * FROM atas_reuniao WHERE id=$1', [req.params.id]);
      const presentes = await query(`
        SELECT ap.*,
          COALESCE(d.email, l.email) as email,
          COALESCE(d.whatsapp, l.whatsapp) as whatsapp
        FROM atas_presentes ap
        LEFT JOIN diretivos d ON d.id=ap.membro_id AND ap.membro_tipo='diretivo'
        LEFT JOIN ligantes l ON l.id=ap.membro_id AND ap.membro_tipo='ligante'
        WHERE ap.ata_id=$1
      `, [req.params.id]);
      const a = ata.rows[0];
      const dataFormatada = a.data_reuniao ? new Date(a.data_reuniao).toLocaleDateString('pt-BR',{timeZone:'UTC',day:'2-digit',month:'2-digit',year:'numeric'}) : '';
      for (const p of presentes.rows) {
        let resultado;
        try { resultado = await notificarAssinaturaAta(a, p); } catch(e) { console.error('Email ata:', e.message); }
        if (p.whatsapp && resultado && resultado.link) {
          try {
            const jaNotif = await query("SELECT id FROM notificacoes_log WHERE tipo='ata_assinatura' AND canal='whatsapp' AND status='ok' AND observacao=$1", ['ata_' + req.params.id + '_presente_' + p.id]);
            if (!jaNotif.rows.length) {
              const primeiroNome = p.membro_nome.split(' ')[0];
              const tipoAta = a.tipo === 'ordinaria' ? 'Ordinaria' : a.tipo === 'extraordinaria' ? 'Extraordinaria' : 'Especial';
              const numAta = a.numero || a.id;
              const msgWapp = '*LAURO — Assinatura de Ata*\n\nOla, ' + primeiroNome + '!\n\nA *Ata N ' + numAta + '* (Reuniao ' + tipoAta + ' — ' + dataFormatada + ') aguarda sua assinatura.\n\nLink de uso unico (expira em 30 dias):\n' + resultado.link + '\n\n_Liga Academica de Urologia — LAURO | UCP | CDE_';
              // Enfileira (rate-limited). Antes era {urgente:true} em LOOP -> furava o
              // anti-ban mandando direto a varios de uma vez. Fire-and-forget: a fila paga o ritmo.
              enviarWhatsApp(p.whatsapp, msgWapp);
              await query("INSERT INTO notificacoes_log(tipo,canal,status,observacao,criado_em) VALUES('ata_assinatura','whatsapp','ok',$1,NOW())", ['ata_' + req.params.id + '_presente_' + p.id]);
            }
          } catch(e) { console.error('Wapp ata:', e.message); }
        }
      }
    } catch(e) { console.error('Erro notif ata:', e.message); }
  }

  res.json({ok:true});
});

router.post('/atas/:id/assinatura', requireAuth, requirePermissao('atas'), async (req, res) => {
  const { presente_id, assinatura_digital } = req.body;
  await query('UPDATE atas_presentes SET assinatura_digital=$1,assinou_em=NOW() WHERE id=$2 AND ata_id=$3',
    [assinatura_digital, presente_id, req.params.id]);
  res.json({ok:true});
});

router.post('/atas/:id/pdf-upload', requireAuth, requirePermissao('atas'), async (req, res) => {
  // Upload do PDF físico assinado via Cloudflare R2 (mesmo sistema dos contratos)
  res.json({ok:false, erro:'Use o formulário de upload'});
});

router.post('/atas/:id/presentes', requireAuth, requirePermissao('atas'), async (req, res) => {
  const { membro_id, membro_tipo, membro_nome, membro_cargo } = req.body;
  const r = await query('INSERT INTO atas_presentes(ata_id,membro_tipo,membro_id,membro_nome,membro_cargo,presente) VALUES($1,$2,$3,$4,$5,true) RETURNING id',
    [req.params.id, membro_tipo, membro_id, membro_nome, membro_cargo||'']);
  // Se a ata ja estiver em assinatura, notifica o novo presente imediatamente (nao depende de trocar o status de novo)
  try {
    const ataR = await query('SELECT * FROM atas_reuniao WHERE id=$1', [req.params.id]);
    if (ataR.rows[0] && ataR.rows[0].status === 'em_assinatura') {
      const pR = await query(`
        SELECT ap.*, COALESCE(d.email, l.email) as email
        FROM atas_presentes ap
        LEFT JOIN diretivos d ON d.id=ap.membro_id AND ap.membro_tipo='diretivo'
        LEFT JOIN ligantes l ON l.id=ap.membro_id AND ap.membro_tipo='ligante'
        WHERE ap.id=$1
      `, [r.rows[0].id]);
      if (pR.rows[0]) await notificarAssinaturaAta(ataR.rows[0], pR.rows[0]);
    }
  } catch(e) { console.error('Notif novo presente:', e.message); }
  res.json({ok:true});
});
router.post('/atas/:id/presentes/:presenteId/reenviar', requireAuth, requirePermissao('atas'), async (req, res) => {
  try {
    const ata = await query('SELECT * FROM atas_reuniao WHERE id=$1', [req.params.id]);
    const pR = await query(`
      SELECT ap.*, COALESCE(d.email, l.email) as email
      FROM atas_presentes ap
      LEFT JOIN diretivos d ON d.id=ap.membro_id AND ap.membro_tipo='diretivo'
      LEFT JOIN ligantes l ON l.id=ap.membro_id AND ap.membro_tipo='ligante'
      WHERE ap.id=$1 AND ap.ata_id=$2
    `, [req.params.presenteId, req.params.id]);
    if (!pR.rows.length) return res.json({ok:false, erro:'Presente não encontrado'});
    // Reenvio: somente email — WhatsApp só na primeira vez para evitar ban
    await notificarAssinaturaAta(ata.rows[0], pR.rows[0], { reenvio: true });
    res.json({ok:true});
  } catch(e) { console.error('Reenviar ata:', e.message); res.json({ok:false, erro:e.message}); }
});

router.delete('/atas/:id/presentes/:presenteId', requireAuth, async (req, res) => {
  await query('DELETE FROM atas_presentes WHERE id=$1 AND ata_id=$2', [req.params.presenteId, req.params.id]);
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({ok:true});
  }
  res.redirect('/atas/' + req.params.id + '?tab=assinaturas');
});
router.get('/atas/:id/docx', requireAuth, requirePermissao('atas'), async (req, res) => {
  try {
    const { gerarAtaDocx } = require('../services/gerarAtaDocx');
    const ata = await query('SELECT * FROM atas_reuniao WHERE id=$1', [req.params.id]);
    if(!ata.rows.length) return res.status(404).json({erro:'Ata não encontrada'});
    const presentes = await query('SELECT * FROM atas_presentes WHERE ata_id=$1 ORDER BY membro_nome', [req.params.id]);
    const buf = await gerarAtaDocx(ata.rows[0], presentes.rows);
    const num = (ata.rows[0].numero||ata.rows[0].id).toString().replace('/','_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Acta_${num}.docx"`);
    res.send(buf);
  } catch(e) {
    console.error('[DOCX]', e);
    res.status(500).json({erro: e.message});
  }
});
router.delete('/atas/:id', requireAuth, async (req, res) => {
  await query('DELETE FROM atas_reuniao WHERE id=$1', [req.params.id]);
  res.json({ok:true});
});

router.post('/atas/:id/editar', requireAuth, requirePermissao('atas'), async (req, res) => {
  const { tipo, data_reuniao, hora_inicio, hora_fim, local, pauta, corpo } = req.body;
  await query(
    'UPDATE atas_reuniao SET tipo=$1, data_reuniao=$2, hora_inicio=$3, hora_fim=$4, local=$5, pauta=$6, corpo=$7, atualizado_em=NOW() WHERE id=$8',
    [tipo, data_reuniao, hora_inicio||null, hora_fim||null, local, pauta, corpo, req.params.id]
  );
  req.session.msg = ['Ata atualizada com sucesso!'];
  res.redirect('/atas/'+req.params.id);
});

const multerAudio = require('multer')({
  storage: require('multer').memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }
});
router.post('/atas/:id/transcrever', requireAuth, requirePermissao('atas'), multerAudio.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.json({ ok: false, erro: 'Nenhum audio recebido.' });
    const { transcreverAudio, gerarAtaDeTranscricao } = require('../services/atas-ia');
    const t = await transcreverAudio(req.file.buffer, req.file.originalname, req.file.mimetype);
    if (!t.ok) return res.json(t);
    const ataR = await query('SELECT tipo FROM atas_reuniao WHERE id=$1', [req.params.id]);
    const g = await gerarAtaDeTranscricao(query, { transcricao: t.texto, tipoReuniao: ataR.rows[0] && ataR.rows[0].tipo });
    if (!g.ok) return res.json(g);
    res.json({ ok: true, transcricao: t.texto, pauta: g.pauta, corpo: g.corpo });
  } catch (e) {
    console.error('[ATAS TRANSCREVER]', e);
    res.json({ ok: false, erro: 'Erro ao processar a gravacao.' });
  }
});
// ─── FIM ATAS ─────────────────────────────────────────────────────────────────

};
