// ═══ FLUXO DE APROVAÇÃO DOS PROJETOS ═══
// Estados: rascunho → aguardando_presidencia → aguardando_secretaria →
//          enviado_coordinacion → en_correccion → (volta a ensino/extensão) → ... → aprobado_final
// Anexos versionados por etapa + envio por email na thread única (Gmail da liga) + notificação ao secretário.

const { query } = require('../models/database');
const { requireAuth } = require('../middleware/auth');
const { upload, uploadArquivo } = require('../services/arquivos');

// Rótulos amigáveis das etapas (para exibir na tela)
const ETAPAS = {
  rascunho: 'Borrador (Enseñanza/Extensión)',
  aguardando_presidencia: 'Pendiente de Presidencia',
  aguardando_secretaria: 'Pendiente de Secretaría',
  enviado_coordinacion: 'Enviado a Coordinación de Ligas',
  en_correccion: 'En corrección (Enseñanza/Extensión)',
  aprobado_final: 'Aprobado y Finalizado'
};

module.exports = function (router) {

  // ── Verificação periódica de respostas da coordenação (Caminho B) ──
  // Roda a cada 3 minutos: checa o Gmail e marca projetos com resposta nova.
  let verificandoEmails = false;
  async function verificarRespostasPeriodicamente() {
    if (verificandoEmails) return;
    verificandoEmails = true;
    try {
      const { Pool } = require('pg');
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const cnt = await pool.query("SELECT COUNT(*)::int n FROM projetos_email_thread WHERE gmail_thread_id IS NOT NULL");
      if (cnt.rows[0].n > 0) {
        const { getClientAtualizado } = require('../services/google-drive');
        const { verificarRespostas } = require('../services/projeto-email-detect');
        const cfg = await pool.query("SELECT valor FROM configuracoes WHERE chave='email_liga_oficial'");
        const emailLiga = cfg.rows[0] ? cfg.rows[0].valor : '';
        const client = await getClientAtualizado(pool);
        await verificarRespostas(client, pool, emailLiga);
      }
      await pool.end();
    } catch (e) { /* silencioso, tenta de novo no próximo ciclo */ }
    verificandoEmails = false;
  }
  // primeira verificação 30s após subir, depois a cada 3 minutos
  setTimeout(verificarRespostasPeriodicamente, 30000);
  setInterval(verificarRespostasPeriodicamente, 180000);


  // Helpers locais
  async function buscar(id) {
    const r = await query('SELECT * FROM projetos_academicos WHERE id=$1', [id]);
    return r.rows[0] || null;
  }
  async function logH(pid, de, para, obs, uid) {
    try { await query('INSERT INTO projetos_historico(projeto_id,status_de,status_para,observacao,usuario_id) VALUES($1,$2,$3,$4,$5)', [pid, de, para, obs || '', uid]); } catch (e) {}
  }
  async function temModulo(uid, modulo) {
    try { const r = await query('SELECT id FROM usuario_permissoes WHERE usuario_id=$1 AND modulo=$2', [uid, modulo]); return r.rows.length > 0; } catch (e) { return false; }
  }
  function ehEnsinoExtensao(u, p) {
    return ['admin', 'presidencia'].includes(u.perfil) || temModulo(u.id, p.tipo);
  }
  async function getConfig() {
    const c = {}; try { const r = await query('SELECT chave,valor FROM configuracoes'); r.rows.forEach(x => c[x.chave] = x.valor); } catch (e) {} return c;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. ANEXAR documento em uma etapa (documento_final, correcao_presidencia,
  //    pedido_correccion, aprobado_final). Sobe ao R2 e registra em projetos_anexos.
  // ─────────────────────────────────────────────────────────────────────────
  router.post('/projetos/:id/anexar', requireAuth, (req, res) => {
    upload.single('arquivo')(req, res, async (err) => {
      try {
        if (err) { req.session.erro = ['Error al subir archivo: ' + err.message]; return res.redirect('/projetos/' + req.params.id); }
        const u = req.session.usuario;
        const p = await buscar(req.params.id);
        if (!p) return res.status(404).send('No encontrado');
        if (!req.file) { req.session.erro = ['Seleccione un archivo.']; return res.redirect('/projetos/' + req.params.id); }

        const tipo = req.body.tipo_anexo || 'documento_final';
        const obs = req.body.observacao || null;
        const r = await uploadArquivo(req.file.buffer, 'proj' + p.id + '-' + tipo + '-' + Date.now() + '.' + (req.file.originalname.split('.').pop() || 'pdf'), req.file.mimetype, 'projetos-docs');
        await query('INSERT INTO projetos_anexos (projeto_id,tipo,arquivo_chave,nome_original,mimetype,observacao,enviado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [p.id, tipo, r.chave, req.file.originalname, req.file.mimetype, obs, u.id]);
        await logH(p.id, p.etapa_atual, p.etapa_atual, 'Documento anexado: ' + tipo, u.id);
        req.session.msg = ['Documento anexado correctamente.'];
        res.redirect('/projetos/' + p.id);
      } catch (e) { req.session.erro = ['Error: ' + e.message]; res.redirect('/projetos/' + req.params.id); }
    });
  });

  // Baixar um anexo (URL assinada do R2)
  router.get('/projetos/:id/anexo/:anexoId', requireAuth, async (req, res) => {
    try {
      const a = await query('SELECT * FROM projetos_anexos WHERE id=$1 AND projeto_id=$2', [req.params.anexoId, req.params.id]);
      if (!a.rows[0]) return res.status(404).send('No encontrado');
      const { getUrlAssinada } = require('../services/desligamento');
      const url = await getUrlAssinada(a.rows[0].arquivo_chave);
      res.redirect(url);
    } catch (e) { res.status(500).send('Error'); }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. TRANSIÇÕES do fluxo
  // ─────────────────────────────────────────────────────────────────────────

  // Ensino/Extensão → Presidência
  router.post('/projetos/:id/enviar-presidencia', requireAuth, async (req, res) => {
    try {
      const u = req.session.usuario; const p = await buscar(req.params.id);
      if (!p) return res.status(404).json({ erro: 'No encontrado' });
      if (!(['admin', 'presidencia'].includes(u.perfil) || await temModulo(u.id, p.tipo)))
        return res.status(403).json({ erro: 'Sin permiso' });
      // Exige um documento final anexado
      const anx = await query("SELECT id FROM projetos_anexos WHERE projeto_id=$1 AND tipo='documento_final'", [p.id]);
      if (!anx.rows.length) return res.status(400).json({ erro: 'Adjunte el documento final (con membrete) antes de enviar.' });
      await query("UPDATE projetos_academicos SET etapa_atual='aguardando_presidencia', status='pendente', enviado_em=NOW(), updated_at=NOW() WHERE id=$1", [p.id]);
      await logH(p.id, p.etapa_atual, 'aguardando_presidencia', 'Enviado a Presidencia', u.id);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ erro: e.message }); }
  });

  // Presidência → Secretaria (com notificação piscante ao secretário)
  router.post('/projetos/:id/enviar-secretaria', requireAuth, async (req, res) => {
    try {
      const u = req.session.usuario; const p = await buscar(req.params.id);
      if (!p) return res.status(404).json({ erro: 'No encontrado' });
      if (!['admin', 'presidencia'].includes(u.perfil)) return res.status(403).json({ erro: 'Solo Presidencia/Admin' });
      await query("UPDATE projetos_academicos SET etapa_atual='aguardando_secretaria', status='liberado', notif_secretaria=true, updated_at=NOW() WHERE id=$1", [p.id]);
      await logH(p.id, p.etapa_atual, 'aguardando_secretaria', 'Aprobado por Presidencia, enviado a Secretaría', u.id);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ erro: e.message }); }
  });

  // Secretaria → Coordenação (dispara email na thread única, com o documento anexado)
  router.post('/projetos/:id/enviar-coordinacion', requireAuth, async (req, res) => {
    try {
      const u = req.session.usuario; const p = await buscar(req.params.id);
      if (!p) return res.status(404).json({ erro: 'No encontrado' });
      if (!['admin', 'secretaria'].includes(u.perfil)) return res.status(403).json({ erro: 'Solo Secretaría/Admin' });

      const cfg = await getConfig();
      const dest = (cfg.email_coordenacion_ligas || '').trim();
      if (!dest) return res.status(400).json({ erro: 'Configure el email de la Coordinación de Ligas en Configuraciones.' });

      // Pega o anexo mais recente (documento final ou corrigido) para enviar
      const anx = await query("SELECT * FROM projetos_anexos WHERE projeto_id=$1 AND tipo IN ('documento_final','correcao_presidencia','correccion_enseñanza') ORDER BY id DESC LIMIT 1", [p.id]);
      if (!anx.rows.length) return res.status(400).json({ erro: 'No hay documento para enviar.' });

      const { getClientAtualizado } = require('../services/google-drive');
      const { enviarEmailProjeto } = require('../services/projeto-email');
      const { imagemBase64 } = require('../services/desligamento');
      const { Pool } = require('pg');
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });

      // Baixa o anexo do R2 para anexar no email
      const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
      const R2 = new S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
      const obj = await R2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET || 'liga-urologia-files', Key: anx.rows[0].arquivo_chave }));
      const chunks = []; for await (const c of obj.Body) chunks.push(c);
      const buffer = Buffer.concat(chunks);

      const client = await getClientAtualizado(pool);
      const from = (cfg.email_liga_oficial || 'lauroucpcde@lauroucpcde.com');
      const tipoLabel = p.tipo === 'ensino' ? 'Enseñanza' : 'Extensión';
      const esCorreccion = await query("SELECT id FROM projetos_email_thread WHERE projeto_id=$1", [p.id]);
      const primeira = esCorreccion.rows.length === 0;
      const subject = 'Proyecto de ' + tipoLabel + ' – ' + p.nome + ' – Liga LAURO';
      const corpoHtml = primeira
        ? '<p>Estimada Coordinación de Ligas,</p><p>Adjuntamos el proyecto de ' + tipoLabel.toLowerCase() + ' <strong>"' + p.nome + '"</strong> de la Liga Académica de Urología (LAURO) para su evaluación.</p><p>Quedamos atentos a sus observaciones.</p><p>Atentamente,<br>Liga Académica de Urología – LAURO</p>'
        : '<p>Estimada Coordinación de Ligas,</p><p>Adjuntamos la versión corregida del proyecto <strong>"' + p.nome + '"</strong> conforme a las observaciones recibidas.</p><p>Quedamos atentos.</p><p>Atentamente,<br>Liga Académica de Urología – LAURO</p>';

      const r = await enviarEmailProjeto(client, pool, {
        projetoId: p.id, to: dest, from, subject, corpoHtml,
        anexos: [{ nome: anx.rows[0].nome_original || 'proyecto.pdf', mimetype: anx.rows[0].mimetype || 'application/pdf', buffer }]
      });

      await query("UPDATE projetos_academicos SET etapa_atual='enviado_coordinacion', status='revisao', notif_secretaria=false, updated_at=NOW() WHERE id=$1", [p.id]);
      await logH(p.id, p.etapa_atual, 'enviado_coordinacion', 'Enviado a Coordinación (' + (primeira ? 'inicial' : 'corrección') + ')', u.id);
      await pool.end();
      res.json({ ok: true, threadId: r.threadId });
    } catch (e) { res.status(500).json({ erro: e.message }); }
  });

  // Secretaria recebe correção da coordenação → anexa o pedido e devolve a Ensino/Extensão
  router.post('/projetos/:id/devolver-correccion', requireAuth, (req, res) => {
    upload.single('arquivo')(req, res, async (err) => {
      try {
        if (err) { req.session.erro = ['Error: ' + err.message]; return res.redirect('/projetos/' + req.params.id); }
        const u = req.session.usuario; const p = await buscar(req.params.id);
        if (!p) return res.status(404).send('No encontrado');
        if (!['admin', 'secretaria', 'presidencia'].includes(u.perfil)) { req.session.erro = ['Sin permiso']; return res.redirect('/projetos/' + p.id); }
        // anexa o pedido de correção (se enviou arquivo)
        if (req.file) {
          const r = await uploadArquivo(req.file.buffer, 'proj' + p.id + '-pedido-' + Date.now() + '.' + (req.file.originalname.split('.').pop() || 'pdf'), req.file.mimetype, 'projetos-docs');
          await query('INSERT INTO projetos_anexos (projeto_id,tipo,arquivo_chave,nome_original,mimetype,observacao,enviado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [p.id, 'pedido_correccion', r.chave, req.file.originalname, req.file.mimetype, req.body.observacao || null, u.id]);
        }
        await query("UPDATE projetos_academicos SET etapa_atual='en_correccion', status='revisao', updated_at=NOW() WHERE id=$1", [p.id]);
        await logH(p.id, p.etapa_atual, 'en_correccion', 'Devuelto a Enseñanza/Extensión para corrección', u.id);
        req.session.msg = ['Devolvido para correção.'];
        res.redirect('/projetos/' + p.id);
      } catch (e) { req.session.erro = ['Error: ' + e.message]; res.redirect('/projetos/' + req.params.id); }
    });
  });

  // Aprovação final (secretaria anexa o documento final aprobado y firmado)
  router.post('/projetos/:id/aprobar-final', requireAuth, (req, res) => {
    upload.single('arquivo')(req, res, async (err) => {
      try {
        if (err) { req.session.erro = ['Error: ' + err.message]; return res.redirect('/projetos/' + req.params.id); }
        const u = req.session.usuario; const p = await buscar(req.params.id);
        if (!p) return res.status(404).send('No encontrado');
        if (!['admin', 'secretaria', 'presidencia'].includes(u.perfil)) { req.session.erro = ['Sin permiso']; return res.redirect('/projetos/' + p.id); }
        if (req.file) {
          const r = await uploadArquivo(req.file.buffer, 'proj' + p.id + '-aprobado-' + Date.now() + '.' + (req.file.originalname.split('.').pop() || 'pdf'), req.file.mimetype, 'projetos-docs');
          await query('INSERT INTO projetos_anexos (projeto_id,tipo,arquivo_chave,nome_original,mimetype,observacao,enviado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [p.id, 'aprobado_final', r.chave, req.file.originalname, req.file.mimetype, req.body.observacao || null, u.id]);
        }
        await query("UPDATE projetos_academicos SET etapa_atual='aprobado_final', status='aprovado', aprovado_em=NOW(), updated_at=NOW() WHERE id=$1", [p.id]);
        await logH(p.id, p.etapa_atual, 'aprobado_final', 'Proyecto APROBADO y finalizado', u.id);
        req.session.msg = ['Proyecto aprobado y archivado.'];
        res.redirect('/projetos/' + p.id);
      } catch (e) { req.session.erro = ['Error: ' + e.message]; res.redirect('/projetos/' + req.params.id); }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Notificações piscantes para a secretaria (contador de pendências)
  // ─────────────────────────────────────────────────────────────────────────
  router.get('/api/projetos/pendencias-secretaria', requireAuth, async (req, res) => {
    try {
      const u = req.session.usuario;
      if (!['admin', 'secretaria'].includes(u.perfil)) return res.json({ count: 0 });
      const r = await query("SELECT COUNT(*)::int AS n FROM projetos_academicos WHERE notif_secretaria=true AND etapa_atual='aguardando_secretaria'");
      res.json({ count: r.rows[0].n });
    } catch (e) { res.json({ count: 0 }); }
  });

  // Lista de anexos de um projeto (para a view)
  router.get('/api/projetos/:id/anexos', requireAuth, async (req, res) => {
    try {
      const r = await query('SELECT id,tipo,nome_original,observacao,created_at FROM projetos_anexos WHERE projeto_id=$1 ORDER BY id DESC', [req.params.id]);
      res.json({ anexos: r.rows });
    } catch (e) { res.json({ anexos: [] }); }
  });


  // ── Pendências do usuário logado (para sino + modal de notificação) ──
  router.get('/api/minhas-pendencias', requireAuth, async (req, res) => {
    try {
      const u = req.session.usuario;
      const perfil = u.perfil;
      let itens = [];
      const ehAdminPres = ['admin','presidencia'].includes(perfil);
      const ehSecre = ['admin','secretaria'].includes(perfil);

      // Presidência/Admin: projetos aguardando presidência
      if (ehAdminPres) {
        const r = await query("SELECT id, nome, tipo FROM projetos_academicos WHERE etapa_atual='aguardando_presidencia' AND COALESCE(inativado,false)=false ORDER BY updated_at DESC");
        r.rows.forEach(p => itens.push({ id:p.id, nome:p.nome, motivo:'Aguardando sua revisão (Presidência)', tipo:p.tipo }));
      }
      // Secretaria/Admin: projetos aguardando secretaria
      if (ehSecre) {
        const r = await query("SELECT id, nome, tipo FROM projetos_academicos WHERE etapa_atual='aguardando_secretaria' AND COALESCE(inativado,false)=false ORDER BY updated_at DESC");
        r.rows.forEach(p => itens.push({ id:p.id, nome:p.nome, motivo:'Pronto para enviar à Coordenação', tipo:p.tipo }));
      }
      // Ensino/Extensão (e admin/presidência que acumulam): projetos em corrección
      const r2 = await query("SELECT id, nome, tipo, criado_por FROM projetos_academicos WHERE etapa_atual='en_correccion' AND COALESCE(inativado,false)=false ORDER BY updated_at DESC");
      for (const p of r2.rows) {
        // mostra para admin/presidência sempre; para ensino/extensão só os do seu módulo
        let mostra = ehAdminPres;
        if (!mostra) { mostra = await temModulo(u.id, p.tipo); }
        if (mostra) itens.push({ id:p.id, nome:p.nome, motivo:'Devolvido para correção', tipo:p.tipo });
      }

      // Respostas da coordenação (Caminho B): projetos com resposta nova não lida
      if (['admin','presidencia','secretaria'].includes(perfil)) {
        try {
          const rr = await query(`SELECT t.projeto_id AS id, p.nome, p.tipo, t.gmail_thread_id
            FROM projetos_email_thread t JOIN projetos_academicos p ON p.id=t.projeto_id
            WHERE t.tem_resposta_nova=true AND COALESCE(p.inativado,false)=false`);
          rr.rows.forEach(p => itens.push({ id:p.id, nome:p.nome, tipo:p.tipo,
            motivo:'A Coordenação respondeu o email', resposta:true,
            gmail_link: p.gmail_thread_id ? ('https://mail.google.com/mail/u/0/#all/'+p.gmail_thread_id) : null }));
        } catch(e) {}
      }

      // de-duplicar por id (admin pode cair em mais de uma regra)
      const vistos = {}; const unicos = [];
      for (const it of itens) { if (!vistos[it.id]) { vistos[it.id]=1; unicos.push(it); } }
      res.json({ count: unicos.length, itens: unicos });
    } catch(e) { res.json({ count:0, itens:[] }); }
  });

};
