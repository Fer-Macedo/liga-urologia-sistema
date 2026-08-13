// ═══ FREQUÊNCIA (LIGANTES) ══════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requirePermissao, requireSecretaria } = require('../middleware/auth');
const { getConfig } = require('../services/config');

// Emoji é permitido só no WhatsApp — algumas mensagens são reaproveitadas como fallback de
// texto puro do e-mail (campo "texto:") ou interpoladas direto num badge de HTML, que
// precisam ficar sem emoji nenhum.
function semEmoji(str) {
  return String(str || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '').replace(/[ \t]{2,}/g, ' ').trim();
}

module.exports = function (router) {

router.get('/frequencia', requireAuth, requirePermissao('frequencia'), async (req, res) => {
  const config = await getConfig();
  const turmaId = req.query.turma;
  const turmasR = await query('SELECT * FROM turmas WHERE ativo=1 ORDER BY data_inicio DESC');
  const turmas = turmasR.rows;
  let turmaAtual = null, atividades = [], membrosFrequencia = [], todosMembros = [];
  let resumo = { aptos: 0, risco: 0, inaptos: 0 };

  if (turmaId) {
    const tr = await query('SELECT * FROM turmas WHERE id=$1', [turmaId]);
    turmaAtual = tr.rows[0];
    if (turmaAtual) {
      const atR = await query(
        `SELECT a.*,
          (SELECT COUNT(*) FROM presencas p WHERE p.atividade_id=a.id AND p.presente=1) as presentes,
          (SELECT COUNT(*) FROM turma_membros tm JOIN membros mx ON mx.id=tm.membro_id WHERE tm.turma_id=a.turma_id AND mx.status='ativo') as total_membros
         FROM atividades a WHERE a.turma_id=$1 ORDER BY a.data_atividade DESC`, [turmaId]
      );
      for (const at of atR.rows) {
        const membR = await query(
          `SELECT m.id as membro_id, m.nome,
            COALESCE((SELECT p.presente FROM presencas p WHERE p.atividade_id=$1 AND p.membro_id=m.id),0) as presente
           FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id
           WHERE tm.turma_id=$2 AND m.status='ativo' ORDER BY m.nome`, [at.id, turmaId]
        );
        at.membros = membR.rows;
        atividades.push(at);
      }
      const mfR = await query(
        `SELECT m.id as membro_id, m.nome, m.whatsapp, m.email, tm.data_entrada,
          (SELECT COUNT(*) FROM atividades a WHERE a.turma_id=$1) as total_atividades,
          (SELECT COUNT(*) FROM presencas p JOIN atividades a ON a.id=p.atividade_id
           WHERE a.turma_id=$1 AND p.membro_id=m.id AND p.presente=1) as presencas
         FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id
         WHERE tm.turma_id=$1 AND m.status='ativo' ORDER BY m.nome`, [turmaId]
      );
      membrosFrequencia = mfR.rows;
      membrosFrequencia.forEach(m => {
        const pct = m.total_atividades > 0 ? (m.presencas / m.total_atividades) * 100 : 0;
        if (pct >= 75) resumo.aptos++;
        else if (pct >= 50) resumo.risco++;
        else resumo.inaptos++;
      });
    }
  }

  const tmR = await query('SELECT * FROM membros WHERE ativo=1 ORDER BY nome');
  todosMembros = tmR.rows;

  res.render('pages/frequencia', {
    config, usuario: req.session.usuario,
    turmas, turmaAtual, atividades, membrosFrequencia, todosMembros, resumo,
    msg: req.flash('msg'), erro: req.flash('erro')
  });
});

router.post('/frequencia/turma', requireAuth, requireSecretaria, async (req, res) => {
  const { nome, data_inicio, data_fim } = req.body;
  await query('INSERT INTO turmas (nome,data_inicio,data_fim) VALUES ($1,$2,$3)', [nome, data_inicio, data_fim||null]);
  req.flash('msg', 'Turma ' + nome + ' criada!');
  res.redirect('/frequencia');
});

router.post('/frequencia/atividade', requireAuth, requireSecretaria, async (req, res) => {
  let turma_ids = req.body.turmas_ids || req.body.turma_id_sel || req.body.turma_id;
  if (!Array.isArray(turma_ids)) turma_ids = turma_ids ? [turma_ids] : [];
  turma_ids = turma_ids.filter(Boolean);
  if (!turma_ids.length) { req.flash('erro', 'Selecione ao menos uma turma.'); return res.redirect('/frequencia'); }
  const { tipo, descricao, data_atividade } = req.body;
  for (const turma_id of turma_ids) {
    const r = await query(
      'INSERT INTO atividades (turma_id,tipo,descricao,data_atividade) VALUES ($1,$2,$3,$4) RETURNING id',
      [turma_id, tipo, descricao, data_atividade]
    );
    const membros = await query("SELECT tm.membro_id FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id WHERE tm.turma_id=$1 AND m.status='ativo'", [turma_id]);
    for (const m of membros.rows) {
      await query('INSERT INTO presencas (atividade_id,membro_id,presente) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [r.rows[0].id, m.membro_id]);
    }
  }
  req.flash('msg', 'Atividade criada em ' + turma_ids.length + ' turma(s)!');
  res.redirect('/frequencia?turma=' + turma_ids[0]);
});

router.post('/frequencia/atividade/:id/presenca', requireAuth, requireSecretaria, async (req, res) => {
  const atId = req.params.id;
  const presentes = [].concat(req.body.presentes || []);
  const at = await query('SELECT turma_id FROM atividades WHERE id=$1', [atId]);
  if (!at.rows[0]) return res.redirect('/frequencia');
  const turmaId = at.rows[0].turma_id;
  const membros = await query("SELECT tm.membro_id FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id WHERE tm.turma_id=$1 AND m.status='ativo'", [turmaId]);
  for (const m of membros.rows) {
    const presente = presentes.includes(String(m.membro_id)) ? 1 : 0;
    await query(
      'INSERT INTO presencas (atividade_id,membro_id,presente) VALUES ($1,$2,$3) ON CONFLICT (atividade_id,membro_id) DO UPDATE SET presente=$3',
      [atId, m.membro_id, presente]
    );
  }
  req.flash('msg', 'Presenças salvas!');
  res.redirect('/frequencia?turma=' + turmaId);
});

router.post('/frequencia/atividade/:id/editar', requireAuth, requireSecretaria, async (req, res) => {
  const { tipo, descricao, data_atividade } = req.body;
  const r = await query('SELECT turma_id FROM atividades WHERE id=$1', [req.params.id]);
  const turmaId = r.rows[0]?.turma_id;
  await query('UPDATE atividades SET tipo=$1, descricao=$2, data_atividade=$3 WHERE id=$4',
    [tipo, descricao, data_atividade, req.params.id]);
  res.redirect('/frequencia?turma=' + turmaId + '&tab=atividades');
});
router.post('/frequencia/atividade/:id/deletar', requireAuth, requireSecretaria, async (req, res) => {
  const at = await query('SELECT turma_id FROM atividades WHERE id=$1', [req.params.id]);
  const turmaId = at.rows[0]?.turma_id;
  await query('DELETE FROM presencas WHERE atividade_id=$1', [req.params.id]);
  await query('DELETE FROM atividades WHERE id=$1', [req.params.id]);
  req.flash('msg', 'Atividade excluída!');
  res.redirect('/frequencia?turma=' + turmaId);
});

router.post('/frequencia/turma/:id/adicionar-membro', requireAuth, requireSecretaria, async (req, res) => {
  const { membro_id, data_entrada } = req.body;
  await query('INSERT INTO turma_membros (turma_id,membro_id,data_entrada) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.params.id, membro_id, data_entrada]);
  const ats = await query('SELECT id FROM atividades WHERE turma_id=$1', [req.params.id]);
  for (const at of ats.rows) {
    await query('INSERT INTO presencas (atividade_id,membro_id,presente) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [at.id, membro_id]);
  }
  req.flash('msg', 'Membro adicionado à turma!');
  res.redirect('/frequencia?turma=' + req.params.id);
});

router.post('/frequencia/turma/:id/remover-membro', requireAuth, requireSecretaria, async (req, res) => {
  const { membro_id } = req.body;
  await query('DELETE FROM turma_membros WHERE turma_id=$1 AND membro_id=$2', [req.params.id, membro_id]);
  req.flash('msg', 'Membro removido da turma!');
  res.redirect('/frequencia?turma=' + req.params.id);
});

router.get('/frequencia/relatorio/:turmaId', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const turmaR = await query('SELECT * FROM turmas WHERE id=$1', [req.params.turmaId]);
  const turma = turmaR.rows[0];
  if (!turma) return res.redirect('/frequencia');
  const [membrosR, atividadesR, presencasR] = await Promise.all([
    query(`SELECT m.id, m.nome, m.email FROM turma_membros tm JOIN ligantes m ON m.id=tm.membro_id WHERE tm.turma_id=$1 AND m.ativo=1 AND m.pendente=false ORDER BY m.nome`, [req.params.turmaId]),
    query('SELECT id, tipo, descricao, data_atividade FROM atividades WHERE turma_id=$1 ORDER BY data_atividade', [req.params.turmaId]),
    query('SELECT p.membro_id, p.atividade_id, p.presente FROM presencas p JOIN atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1', [req.params.turmaId])
  ]);
  const atividades = atividadesR;
  const totalAtividades = atividades.rows.length;
  const pd = {};
  presencasR.rows.forEach(p => { if(!pd[p.atividade_id]) pd[p.atividade_id]={}; pd[p.atividade_id][p.membro_id]=p.presente; });
  const membros = { rows: membrosR.rows.map(m => ({
    ...m,
    total_atividades: totalAtividades,
    presencas: presencasR.rows.filter(p => p.membro_id===m.id && p.presente===1).length
  }))};
  const orgNome = config.org_nome || 'Liga Academica de Urologia';
  const orgCor = config.org_cor || '#1a56db';
  const orgLogo = config.org_logo || null;
  const logoHtml = orgLogo ? `<img src="${orgLogo}" style="max-height:56px;object-fit:contain">` : `<span style="font-size:20px;font-weight:800;color:${orgCor}">${orgNome}</span>`;
  const aptos = membros.rows.filter(m => m.total_atividades > 0 && (m.presencas/m.total_atividades)*100 >= 75).length;
  const risco = membros.rows.filter(m => m.total_atividades > 0 && (m.presencas/m.total_atividades)*100 >= 50 && (m.presencas/m.total_atividades)*100 < 75).length;
  const inaptos = membros.rows.length - aptos - risco;
  const dataInicio = turma.data_inicio ? new Date(turma.data_inicio+'T12:00:00').toLocaleDateString('pt-BR') : '';
  const dataFim = turma.data_fim ? new Date(turma.data_fim+'T12:00:00').toLocaleDateString('pt-BR') : '';
  let linhasMembros = membros.rows.map(m => {
    const pct = m.total_atividades > 0 ? Math.round((m.presencas/m.total_atividades)*100) : 0;
    const faltas = Number(m.total_atividades) - Number(m.presencas);
    const status = pct>=75?'Apto':pct>=50?'Em risco':'Nao apto';
    const corS = pct>=75?'#166534':pct>=50?'#92400e':'#991b1b';
    const bgS = pct>=75?'#dcfce7':pct>=50?'#fef3c7':'#fee2e2';
    const barC = pct>=75?'#10b981':pct>=50?'#f59e0b':'#ef4444';
    return `<tr><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;font-weight:600">${m.nome}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center;color:#10b981;font-weight:700">${m.presencas}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center;color:#ef4444;font-weight:700">${faltas}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center;color:#64748b">${m.total_atividades}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center"><div style="display:flex;align-items:center;gap:8px;justify-content:center"><div style="width:80px;height:6px;background:#e2e8f0;border-radius:3px"><div style="width:${pct}%;height:100%;background:${barC};border-radius:3px"></div></div><span style="font-weight:700">${pct}%</span></div></td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center"><span style="background:${bgS};color:${corS};padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700">${status}</span></td></tr>`;
  }).join('');
  let headerAt = `<th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b">Ligante</th>`;
  for (const at of atividades.rows) {
    const dt = new Date(at.data_atividade).toLocaleDateString('pt-BR',{timeZone:'UTC',day:'2-digit',month:'2-digit'});
    headerAt += `<th style="padding:10px 8px;text-align:center;font-size:10px;font-weight:700;color:#64748b;min-width:70px">${dt}<br><span style="font-weight:400;opacity:.7">${at.tipo.substring(0,10)}</span></th>`;
  }
  let linhasAt = '';
  for (const m of membros.rows) {
    let cols = `<td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;font-weight:600">${m.nome}</td>`;
    for (const at of atividades.rows) {
      const presente = pd[at.id] && pd[at.id][m.id] ? 1 : 0;
      cols += presente
        ? `<td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:center;background:#f0fdf4;color:#10b981;font-weight:700">S</td>`
        : `<td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:center;background:#fff1f2;color:#ef4444;font-weight:700">N</td>`;
    }
    linhasAt += `<tr>${cols}</tr>`;
  }

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;border-radius:0!important;font-family:'Inter',sans-serif}
body{background:#f0f4f0;padding:32px;min-height:100vh}
.header-bar{background:linear-gradient(160deg,#0a1a08,#1a3410,#253d18);padding:24px 32px;display:flex;align-items:center;gap:16px;margin:-32px -32px 28px}
.header-bar img{width:72px;height:72px;border-radius:50%!important;border:3px solid rgba(255,255,255,.35);object-fit:cover}
.header-bar-info h1{font-size:20px;font-weight:800;color:#fff}
.header-bar-info p{font-size:12px;color:rgba(255,255,255,.65);margin-top:3px}
.card{background:white;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:16px}
.stat{background:white;border:1px solid #e2e8f0;padding:18px 20px;border-top:3px solid #1a3410}
.stat.verde{border-top-color:#10b981}
.stat.ambar{border-top-color:#f59e0b}
.stat.verm{border-top-color:#ef4444}
.stat-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:6px}
.stat-num{font-size:28px;font-weight:800;color:#1a3410}
.stat.verde .stat-num{color:#10b981}
.stat.ambar .stat-num{color:#f59e0b}
.stat.verm .stat-num{color:#ef4444}
.card-titulo{padding:14px 20px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:700;color:#1a3410;background:#f8faf6;text-transform:uppercase;letter-spacing:.04em}
table{width:100%;border-collapse:collapse}
thead th{background:linear-gradient(135deg,#1a3410,#253d18);color:#fff;padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
tbody tr:hover{background:#f0f7eb}
td{padding:11px 16px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#374151;vertical-align:middle}
.btn{background:linear-gradient(135deg,#1a3410,#253d18);color:white;border:none;padding:11px 28px;cursor:pointer;font-size:14px;font-weight:700;margin-bottom:24px;display:inline-flex;align-items:center;gap:8px;transition:transform .12s ease,box-shadow .12s ease}
.btn:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(37,61,24,.35)}
@media print{.btn{display:none}body{background:white;padding:16px}.header-bar{margin:-16px -16px 20px}}
</style></head><body>`
  const logoEl = orgLogo ? `<img src="${orgLogo}" alt="${orgNome}">` : `<div style="width:72px;height:72px;border-radius:50%!important;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#fff">${orgNome.substring(0,2).toUpperCase()}</div>`;
  const htmlDir = `<div class="header-bar">${logoEl}<div class="header-bar-info"><h1>${turma.nome}</h1><p>${dataInicio ? dataInicio+' · ' : ''}${atividades.rows.length} atividades · Mínimo 75% para aprovação</p></div></div>`
    + '<button class="btn" onclick="window.print()"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Imprimir / Salvar PDF</button>'
    + `<div class="stats"><div class="stat verde"><div class="stat-lbl">Aptos ≥75%</div><div class="stat-num">${aptos}</div></div><div class="stat ambar"><div class="stat-lbl">Em risco 50-74%</div><div class="stat-num">${risco}</div></div><div class="stat verm"><div class="stat-lbl">Não aptos &lt;50%</div><div class="stat-num">${inaptos}</div></div></div>`
    + '<div class="card"><div class="card-titulo">Resumo por Ligante</div>'
    + '<table><thead><tr>'
    + '<th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700">Ligante</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Presencas</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Faltas</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Total</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Frequencia</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Status</th>'
    + '</tr></thead><tbody>' + linhasMembros + '</tbody></table></div>'
    + '<div class="card"><div class="card-titulo">Presenças por Atividade</div>'
    + '<div style="overflow-x:auto"><table><thead><tr>' + headerAt + '</tr></thead><tbody>' + linhasAt + '</tbody></table></div></div>'
    + '</body></html>';
  res.send(html + htmlDir);
});

router.get('/frequencia/integridade/:id', requireAuth, async (req, res) => {
  try {
    const turmaId = req.params.id;
    const ligantes = await query('SELECT id, nome FROM ligantes WHERE ativo=1 ORDER BY nome');
    const membros = await query("SELECT tm.membro_id FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id WHERE tm.turma_id=$1 AND m.status='ativo'",[turmaId]);
    const ids = new Set(membros.rows.map(m=>m.membro_id));
    const faltando = ligantes.rows.filter(l=>!ids.has(l.id));
    const problemas = [];
    if (faltando.length > 0) {
      problemas.push({ severidade:'aviso', descricao: faltando.length + ' ligante(s) ativo(s) nao estao na turma: ' + faltando.slice(0,5).map(l=>l.nome).join(', ') + (faltando.length>5?' e mais '+(faltando.length-5)+'...':'') });
    }
    // checar presencas orfas
    const orfas = await query("SELECT COUNT(*) as total FROM presencas p JOIN atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1 AND p.membro_id NOT IN (SELECT tm.membro_id FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id WHERE tm.turma_id=$1 AND m.status='ativo')",[ turmaId]);
    if (parseInt(orfas.rows[0].total) > 0) {
      problemas.push({ severidade:'erro', descricao: orfas.rows[0].total + ' presenca(s) de membros que nao estao mais na turma' });
    }
    res.json({ totalProblemas: problemas.length, problemas });
  } catch(e) { res.json({ok:false, totalProblemas:1, problemas:[{severidade:'erro',descricao:'Erro interno: '+e.message}]}); }
});

router.post('/frequencia/turma/:id/sincronizar', requireAuth, async (req, res) => {
  try {
    const turmaId = req.params.id;
    const ligantes = await query('SELECT id FROM ligantes WHERE ativo=1');
    let adicionados = 0;
    for (const l of ligantes.rows) {
      const existe = await query('SELECT id FROM turma_membros WHERE turma_id=$1 AND membro_id=$2',[turmaId,l.id]);
      if (existe.rows.length === 0) {
        await query('INSERT INTO turma_membros (turma_id,membro_id,data_entrada,criado_em) VALUES ($1,$2,NOW(),NOW())',[turmaId,l.id]);
        adicionados++;
      }
    }
    req.flash('msg', adicionados > 0 ? adicionados+' ligantes sincronizados!' : 'Todos os ligantes já estão na turma.');
    res.redirect('/frequencia?turma='+turmaId);
  } catch(e) { req.flash('erro','Erro: '+e.message); res.redirect('/frequencia'); }
});

router.post('/frequencia/turma/:id/enviar', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const { enviarWhatsApp, enviarEmail } = require('../services/notificacoes');
  const turmaR = await query('SELECT * FROM turmas WHERE id=$1', [req.params.id]);
  const turma = turmaR.rows[0];

  const membrosSelecionados = [].concat(req.body.membros_ids || []);

  let sqlFiltro = '';
  let params = [req.params.id];
  if (membrosSelecionados.length > 0) {
    sqlFiltro = ' AND m.id = ANY($2::int[])';
    params.push(membrosSelecionados.map(Number));
  }

  const membros = await query(
    `SELECT m.*, tm.data_entrada,
      (SELECT COUNT(*) FROM atividades a WHERE a.turma_id=$1) as total_atividades,
      (SELECT COUNT(*) FROM presencas p JOIN atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1 AND p.membro_id=m.id AND p.presente=1) as presencas
     FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id WHERE tm.turma_id=$1 AND m.status='ativo'` + sqlFiltro, params
  );
  const orgNome = config.org_nome || 'Liga Academica de Urologia';
  let enviados = 0;
  for (const m of membros.rows) {
    const pct = m.total_atividades > 0 ? Math.round((m.presencas / m.total_atividades) * 100) : 0;
    // whatsapp-only:inicio — status/msgWpp vão pro WhatsApp abaixo; o badge de e-mail e o
    // fallback de texto puro do e-mail usam semEmoji(status)/semEmoji(msgWpp) à parte.
    const status = pct >= 75 ? 'APTO ✅' : pct >= 50 ? 'EM RISCO ⚠️' : 'NÃO APTO ❌';
    const msgWpp = `*${orgNome}* 📊\n\nOlá, *${m.nome.split(' ')[0]}*!\n\nSeu relatório de frequência da turma *${turma.nome}*:\n\n📅 Atividades realizadas: *${m.total_atividades}*\n✅ Suas presenças: *${m.presencas}*\n📊 Frequência: *${pct}%*\n🎓 Status: *${status}*\n\n${pct >= 75 ? 'Parabéns! Você está apto para o certificado! 🎉' : pct >= 50 ? 'Atenção! Você está em risco. Não falte às próximas atividades! ⚠️' : 'Atenção! Você está abaixo do mínimo exigido (75%). Participe mais! ❌'}\n\nQualquer dúvida, entre em contato com a secretaria.`;
    // whatsapp-only:fim
    if (m.whatsapp) { try { await enviarWhatsApp(m.whatsapp, msgWpp); enviados++; } catch(e) {} }
    if (m.email) {
      const orgCor = config.org_cor || '#2b6803';
      const pn = m.nome.split(' ')[0];
      const corStatus = pct>=75?'#166534':pct>=50?'#92400e':'#991b1b';
      const bgStatus  = pct>=75?'#dcfce7':pct>=50?'#fef3c7':'#fee2e2';
      const barW = Math.round(pct);
      const barColor = pct>=75?'#22c55e':pct>=50?'#f59e0b':'#ef4444';
      const html = `<div style="border-left:3px solid ${orgCor};padding-left:14px;margin-bottom:24px"><p style="margin:0;font-size:11px;font-weight:700;color:${orgCor};letter-spacing:1.5px;text-transform:uppercase">Curso</p><h2 style="margin:4px 0 0;font-size:20px;font-weight:700;color:#0f172a">${turma.nome}</h2></div><p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7">¡Hola, <strong>${pn}</strong>! A continuación encontrarás tu reporte de asistencia actualizado.</p><table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;margin-bottom:24px"><tr style="background:#f8fafc"><td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0">Actividades realizadas</td><td style="padding:12px 16px;font-size:14px;font-weight:700;color:#0f172a;text-align:right;border-bottom:1px solid #e2e8f0">${m.total_atividades}</td></tr><tr><td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0">Tus asistencias</td><td style="padding:12px 16px;font-size:14px;font-weight:700;color:#0f172a;text-align:right;border-bottom:1px solid #e2e8f0">${m.presencas}</td></tr><tr style="background:#f8fafc"><td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0">Frecuencia</td><td style="padding:12px 16px;font-size:14px;font-weight:700;color:#0f172a;text-align:right;border-bottom:1px solid #e2e8f0">${pct}%</td></tr><tr><td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600">Estado</td><td style="padding:12px 16px;text-align:right"><span style="background:${bgStatus};color:${corStatus};padding:4px 12px;border-radius:4px;font-size:12px;font-weight:700">${semEmoji(status)}</span></td></tr></table><div style="margin-bottom:24px"><div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:12px;color:#64748b;font-weight:600">Progreso</span><span style="font-size:12px;font-weight:700;color:${barColor}">${pct}%</span></div><div style="background:#e2e8f0;border-radius:99px;height:10px;overflow:hidden"><div style="width:${barW}%;background:${barColor};height:10px;border-radius:99px"></div></div><div style="display:flex;justify-content:flex-end;margin-top:4px"><span style="font-size:10px;color:#94a3b8">Mínimo requerido: 75%</span></div></div><div style="background:#f8fafc;border-radius:8px;padding:16px 20px;border:1px solid #e2e8f0"><p style="margin:0;font-size:12px;color:#64748b;line-height:1.7">${pct>=75?'¡Felicitaciones! Estás <strong>apto para el certificado</strong> de 1 año de liga.':pct>=50?'¡Atención! Estás en riesgo. <strong>No faltes a las próximas actividades</strong> para garantizar el certificado.':'Estás por debajo del mínimo requerido (75%). <strong>¡Participa más</strong> en las actividades para revertir esta situación!'}</p></div>`;
      try { await enviarEmail({ para: m.email, assunto: 'Relatório de Frequência — ' + turma.nome, html, texto: semEmoji(msgWpp), faixaLabel: 'RELATÓRIO DE FREQUÊNCIA' }); } catch(e) {}
    }
  }
  res.json({ ok: true, msg: 'Frequência enviada para ' + enviados + ' membros!' });
});

};
