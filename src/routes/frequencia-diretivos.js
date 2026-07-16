// ═══ FREQUÊNCIA DIRETIVOS ═══════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requirePermissao, requireSecretaria } = require('../middleware/auth');
const { getConfig } = require('../services/config');

module.exports = function (router) {

// ─── FREQUÊNCIA DIRETIVOS ─────────────────────────────────────────────────────

router.get('/frequencia-diretivos', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];

  const turmasR = await query('SELECT * FROM diretivo_turmas WHERE ativo=1 ORDER BY nome');
  const turmas = turmasR.rows;

  let turmaAtual = null, atividades = [], membrosFrequencia = [], resumo = { aptos:0, risco:0, inaptos:0 }, todosDiretivos = [];

  const turmaId = req.query.turma;
  if (turmaId) { const tR = await query('SELECT * FROM diretivo_turmas WHERE id=$1', [turmaId]); turmaAtual = tR.rows[0] || null; }
  if (!turmaAtual && turmas.length > 0) turmaAtual = turmas[0];

  const todosR = await query('SELECT id, nome FROM diretivos WHERE ativo=1 ORDER BY nome');
  todosDiretivos = todosR.rows;

  if (turmaAtual) {
    const atR = await query(
      `SELECT a.*, 
        (SELECT COUNT(*) FROM diretivo_presencas p WHERE p.atividade_id=a.id AND p.presente=1) as presentes,
        (SELECT COUNT(*) FROM diretivo_turma_membros tm JOIN diretivos dx ON dx.id=tm.diretivo_id WHERE tm.turma_id=a.turma_id AND dx.ativo=1) as total_membros
       FROM diretivo_atividades a WHERE a.turma_id=$1 ORDER BY a.data_atividade DESC`, [turmaAtual.id]
    );
    for (const at of atR.rows) {
      const mR = await query(
        `SELECT d.id as diretivo_id, d.nome, COALESCE(p.presente,0) as presente
         FROM diretivo_turma_membros tm JOIN diretivos d ON d.id=tm.diretivo_id
         LEFT JOIN diretivo_presencas p ON p.atividade_id=$1 AND p.diretivo_id=d.id
         WHERE tm.turma_id=$2 ORDER BY d.nome`, [at.id, turmaAtual.id]
      );
      at.membros = mR.rows; atividades.push(at);
    }
    const mfR = await query(
      `SELECT d.id as membro_id, d.nome, d.cargo, tm.data_entrada,
        (SELECT COUNT(*) FROM diretivo_atividades a WHERE a.turma_id=$1) as total_atividades,
        (SELECT COUNT(*) FROM diretivo_presencas p JOIN diretivo_atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1 AND p.diretivo_id=d.id AND p.presente=1) as presencas
       FROM diretivo_turma_membros tm JOIN diretivos d ON d.id=tm.diretivo_id WHERE tm.turma_id=$1 AND d.ativo=1 ORDER BY d.nome`, [turmaAtual.id]
    );
    membrosFrequencia = mfR.rows;
    membrosFrequencia.forEach(m => {
      const pct = m.total_atividades > 0 ? Math.round((m.presencas/m.total_atividades)*100) : 0;
      if (pct >= 75) resumo.aptos++; else if (pct >= 50) resumo.risco++; else resumo.inaptos++;
    });
  }

  res.render('pages/frequencia-diretivos', {
    config, msg, erro, usuario: req.session.usuario,
    turmas: turmas.sort((a,b) => a.nome.localeCompare(b.nome)),
    turmaAtual, atividades, membrosFrequencia, resumo, todosDiretivos
  });
});

router.post('/frequencia-diretivos/turma', requireAuth, requireSecretaria, async (req, res) => {
  const { nome, data_inicio, data_fim } = req.body;
  await query('INSERT INTO diretivo_turmas (nome,data_inicio,data_fim) VALUES ($1,$2,$3)', [nome, data_inicio, data_fim||null]);
  req.session.msg = ['Turma criada com sucesso!'];
  res.redirect('/frequencia-diretivos');
});

router.post('/frequencia-diretivos/atividade', requireAuth, requireSecretaria, async (req, res) => {
  try {
    const { tipo, descricao, data_atividade } = req.body;
    const turmas_ids = [].concat(req.body.turmas_ids || req.body.turma_id_sel || req.body.turma_id || []).filter(Boolean);
    if (!turmas_ids.length) { req.session.erro=['Selecione ao menos uma turma.']; return res.redirect('/frequencia-diretivos'); }
    let lastTurmaId = turmas_ids[0];
    for (const turma_id of turmas_ids) {
      const r = await query('INSERT INTO diretivo_atividades (turma_id,tipo,descricao,data_atividade) VALUES ($1,$2,$3,$4) RETURNING id', [turma_id, tipo, descricao, data_atividade]);
      const membros = await query('SELECT dtm.diretivo_id FROM diretivo_turma_membros dtm JOIN diretivos d ON d.id=dtm.diretivo_id WHERE dtm.turma_id=$1 AND d.ativo=1', [turma_id]);
      for (const m of membros.rows) { await query('INSERT INTO diretivo_presencas (atividade_id,diretivo_id,presente) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [r.rows[0].id, m.diretivo_id]); }
      lastTurmaId = turma_id;
    }
    req.session.msg = ['Atividade criada!'];
    res.redirect('/frequencia-diretivos?turma=' + lastTurmaId);
  } catch(e) { console.error('ERRO criar atividade diretivos:', e.message); req.session.erro=[e.message]; res.redirect('/frequencia-diretivos'); }
});

router.post('/frequencia-diretivos/atividade/:id/presenca', requireAuth, requireSecretaria, async (req, res) => {
  const atR = await query('SELECT * FROM diretivo_atividades WHERE id=$1', [req.params.id]);
  const at = atR.rows[0];
  if (!at) return res.redirect('/frequencia-diretivos');
  const membros = await query('SELECT dtm.diretivo_id FROM diretivo_turma_membros dtm JOIN diretivos d ON d.id=dtm.diretivo_id WHERE dtm.turma_id=$1 AND d.ativo=1', [at.turma_id]);
  const presentes = [].concat(req.body.presentes || []).map(Number);
  for (const m of membros.rows) {
    await query('INSERT INTO diretivo_presencas (atividade_id,diretivo_id,presente) VALUES ($1,$2,$3) ON CONFLICT (atividade_id,diretivo_id) DO UPDATE SET presente=$3', [at.id, m.diretivo_id, presentes.includes(m.diretivo_id) ? 1 : 0]);
  }
  req.session.msg = ['Presenças salvas!'];
  res.redirect('/frequencia-diretivos?turma=' + at.turma_id);
});

router.post('/frequencia-diretivos/atividade/:id/editar', requireAuth, requireSecretaria, async (req, res) => {
  const { tipo, descricao, data_atividade } = req.body;
  const r = await query('SELECT turma_id FROM diretivo_atividades WHERE id=$1', [req.params.id]);
  const turmaId = r.rows[0]?.turma_id;
  await query('UPDATE diretivo_atividades SET tipo=$1, descricao=$2, data_atividade=$3 WHERE id=$4',
    [tipo, descricao, data_atividade, req.params.id]);
  res.redirect('/frequencia-diretivos?turma=' + turmaId + '&tab=atividades');
});
router.post('/frequencia-diretivos/atividade/:id/deletar', requireAuth, requireSecretaria, async (req, res) => {
  const atR = await query('SELECT turma_id FROM diretivo_atividades WHERE id=$1', [req.params.id]);
  const turma_id = atR.rows[0]?.turma_id;
  await query('DELETE FROM diretivo_presencas WHERE atividade_id=$1', [req.params.id]);
  await query('DELETE FROM diretivo_atividades WHERE id=$1', [req.params.id]);
  req.session.msg = ['Atividade removida!'];
  res.redirect('/frequencia-diretivos?turma=' + turma_id);
});

router.post('/frequencia-diretivos/turma/:id/adicionar-membro', requireAuth, requireSecretaria, async (req, res) => {
  const { diretivo_id, data_entrada } = req.body;
  await query('INSERT INTO diretivo_turma_membros (turma_id,diretivo_id,data_entrada) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.params.id, diretivo_id, data_entrada]);
  const ats = await query('SELECT id FROM diretivo_atividades WHERE turma_id=$1', [req.params.id]);
  for (const at of ats.rows) { await query('INSERT INTO diretivo_presencas (atividade_id,diretivo_id,presente) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [at.id, diretivo_id]); }
  req.session.msg = ['Diretivo adicionado à turma!'];
  res.redirect('/frequencia-diretivos?turma=' + req.params.id);
});

router.post('/frequencia-diretivos/turma/:id/remover-membro', requireAuth, requireSecretaria, async (req, res) => {
  await query('DELETE FROM diretivo_turma_membros WHERE turma_id=$1 AND diretivo_id=$2', [req.params.id, req.body.diretivo_id]);
  req.session.msg = ['Diretivo removido da turma!'];
  res.redirect('/frequencia-diretivos?turma=' + req.params.id);
});

router.post('/frequencia-diretivos/turma/:id/sincronizar', requireAuth, async (req, res) => {
  try {
    const turmaId = req.params.id;
    const diretivos = await query('SELECT id FROM diretivos WHERE ativo=1');
    let adicionados = 0;
    for (const d of diretivos.rows) {
      const existe = await query('SELECT id FROM diretivo_turma_membros WHERE turma_id=$1 AND diretivo_id=$2',[turmaId,d.id]);
      if (existe.rows.length === 0) {
        await query('INSERT INTO diretivo_turma_membros (turma_id,diretivo_id,data_entrada) VALUES ($1,$2,NOW())',[turmaId,d.id]);
        adicionados++;
      }
    }
    req.flash('msg', adicionados > 0 ? adicionados+' diretivos sincronizados!' : 'Todos os diretivos já estão na turma.');
    res.redirect('/frequencia-diretivos?turma='+turmaId);
  } catch(e) { req.flash('erro','Erro: '+e.message); res.redirect('/frequencia-diretivos'); }
});

router.get('/frequencia-diretivos/integridade/:id', requireAuth, async (req, res) => {
  try {
    const turmaId = req.params.id;
    const diretivos = await query('SELECT id, nome FROM diretivos WHERE ativo=1 ORDER BY nome');
    const membros = await query('SELECT dtm.diretivo_id FROM diretivo_turma_membros dtm JOIN diretivos d ON d.id=dtm.diretivo_id WHERE dtm.turma_id=$1 AND d.ativo=1',[turmaId]);
    const ids = new Set(membros.rows.map(m=>m.diretivo_id));
    const faltando = diretivos.rows.filter(d=>!ids.has(d.id));
    const problemas = [];
    if (faltando.length > 0) problemas.push({ severidade:'aviso', descricao: faltando.length+' diretivo(s) ativo(s) não estão na turma: '+faltando.slice(0,5).map(d=>d.nome).join(', ')+(faltando.length>5?' e mais '+(faltando.length-5)+'...':'') });
    res.json({ totalProblemas: problemas.length, problemas });
  } catch(e) { res.json({ok:false, totalProblemas:1, problemas:[{severidade:'erro',descricao:'Erro: '+e.message}]}); }
});

router.get('/frequencia-diretivos/relatorio/:turmaId', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const turmaR = await query('SELECT * FROM diretivo_turmas WHERE id=$1', [req.params.turmaId]);
  const turma = turmaR.rows[0];
  if (!turma) return res.redirect('/frequencia-diretivos');
  const [membrosR2, atividadesR2, presencasR2] = await Promise.all([
    query(`SELECT d.id, d.nome, d.cargo FROM diretivo_turma_membros tm JOIN diretivos d ON d.id=tm.diretivo_id WHERE tm.turma_id=$1 ORDER BY d.nome`, [req.params.turmaId]),
    query('SELECT id, tipo, descricao, data_atividade FROM diretivo_atividades WHERE turma_id=$1 ORDER BY data_atividade', [req.params.turmaId]),
    query('SELECT p.diretivo_id, p.atividade_id, p.presente FROM diretivo_presencas p JOIN diretivo_atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1', [req.params.turmaId])
  ]);
  const atividades = atividadesR2;
  const totalAt2 = atividades.rows.length;
  const pd = {};
  presencasR2.rows.forEach(p => { if(!pd[p.atividade_id]) pd[p.atividade_id]={}; pd[p.atividade_id][p.diretivo_id]=p.presente; });
  const membros = { rows: membrosR2.rows.map(d => ({
    ...d,
    total_atividades: totalAt2,
    presencas: presencasR2.rows.filter(p => p.diretivo_id===d.id && p.presente===1).length
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
    return `<tr><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;font-weight:600">${m.nome}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b">${m.cargo||''}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center;color:#10b981;font-weight:700">${m.presencas}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center;color:#ef4444;font-weight:700">${faltas}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center;color:#64748b">${m.total_atividades}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center"><div style="display:flex;align-items:center;gap:8px;justify-content:center"><div style="width:80px;height:6px;background:#e2e8f0;border-radius:3px"><div style="width:${pct}%;height:100%;background:${barC};border-radius:3px"></div></div><span style="font-weight:700">${pct}%</span></div></td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center"><span style="background:${bgS};color:${corS};padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700">${status}</span></td></tr>`;
  }).join('');
  let headerAt = `<th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b">Diretivo</th><th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b">Cargo</th>`;
  for (const at of atividades.rows) {
    const dt = new Date(at.data_atividade).toLocaleDateString('pt-BR',{timeZone:'UTC',day:'2-digit',month:'2-digit'});
    headerAt += `<th style="padding:10px 8px;text-align:center;font-size:10px;font-weight:700;color:#64748b;min-width:70px">${dt}<br><span style="font-weight:400;opacity:.7">${at.tipo.substring(0,10)}</span></th>`;
  }
  let linhasAt = '';
  for (const m of membros.rows) {
    let cols = `<td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;font-weight:600">${m.nome}</td><td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b">${m.cargo||''}</td>`;
    for (const at of atividades.rows) {
      const presente = pd[at.id] && pd[at.id][m.id] ? 1 : 0;
      cols += presente
        ? `<td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:center;background:#f0fdf4;color:#10b981;font-weight:700">S</td>`
        : `<td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:center;background:#fff1f2;color:#ef4444;font-weight:700">N</td>`;
    }
    linhasAt += `<tr>${cols}</tr>`;
  }
  const logoEl2 = orgLogo ? `<img src="${orgLogo}" style="width:72px;height:72px;border-radius:50%;border:3px solid rgba(255,255,255,.35);object-fit:cover">` : `<div style="width:72px;height:72px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#fff">${orgNome.substring(0,2).toUpperCase()}</div>`;
  const htmlDir = `<!DOCTYPE html><html><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box;border-radius:0!important;font-family:'Inter',sans-serif}body{background:#f0f4f0;padding:32px;min-height:100vh}.header-bar{background:linear-gradient(160deg,#0a1a08,#1a3410,#253d18);padding:24px 32px;display:flex;align-items:center;gap:16px;margin:-32px -32px 28px}.header-bar img{width:72px;height:72px;border-radius:50%!important;border:3px solid rgba(255,255,255,.35);object-fit:cover}.header-bar-info h1{font-size:20px;font-weight:800;color:#fff}.header-bar-info p{font-size:12px;color:rgba(255,255,255,.65);margin-top:3px}.card{background:white;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,.06)}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:16px}.stat{background:white;border:1px solid #e2e8f0;padding:18px 20px}.stat.verde{border-top:3px solid #10b981}.stat.ambar{border-top:3px solid #f59e0b}.stat.verm{border-top:3px solid #ef4444}.stat-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:6px}.stat-num{font-size:28px;font-weight:800}.stat.verde .stat-num{color:#10b981}.stat.ambar .stat-num{color:#f59e0b}.stat.verm .stat-num{color:#ef4444}.card-titulo{padding:14px 20px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:700;color:#1a3410;background:#f8faf6;text-transform:uppercase;letter-spacing:.04em}table{width:100%;border-collapse:collapse}thead th{background:linear-gradient(135deg,#1a3410,#253d18);color:#fff;padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}tbody tr:hover{background:#f0f7eb}td{padding:11px 16px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#374151;vertical-align:middle}.btn{background:linear-gradient(135deg,#1a3410,#253d18);color:white;border:none;padding:11px 28px;cursor:pointer;font-size:14px;font-weight:700;margin-bottom:24px;display:inline-flex;align-items:center;gap:8px}@media print{.btn{display:none}body{background:white;padding:16px}.header-bar{margin:-16px -16px 20px}}</style></head><body>`
    + `<div class="header-bar">${logoEl2}<div class="header-bar-info"><h1>${turma.nome}</h1><p>${dataInicio ? dataInicio+' · ' : ''}${atividades.rows.length} atividades · Mínimo 75% para aprovação</p></div></div>`
    + '<button class="btn" onclick="window.print()">Imprimir / Salvar PDF</button>'
    + `<div class="stats"><div class="stat verde"><div class="stat-lbl">Aptos ≥75%</div><div class="stat-num">${aptos}</div></div><div class="stat ambar"><div class="stat-lbl">Em risco 50-74%</div><div class="stat-num">${risco}</div></div><div class="stat verm"><div class="stat-lbl">Não aptos &lt;50%</div><div class="stat-num">${inaptos}</div></div></div>`
    + '<div class="card"><div class="card-titulo">Resumo por Diretivo</div>'
    + '<table><thead><tr>'
    + '<th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700">Diretivo</th>'
    + '<th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700">Cargo</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Presencas</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Faltas</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Total</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Frequencia</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700">Status</th>'
    + '</tr></thead><tbody>' + linhasMembros + '</tbody></table></div>'
    + '<div class="card"><div style="padding:16px 20px;border-bottom:1px solid #f1f5f9;font-size:14px;font-weight:700">Presencas por atividade</div>'
    + '<div style="overflow-x:auto"><table><thead><tr>' + headerAt + '</tr></thead><tbody>' + linhasAt + '</tbody></table></div></div>'
    + '</body></html>';
  res.send(htmlDir);
});

};
