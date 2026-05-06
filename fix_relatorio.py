import re

# Le o arquivo atual
f = open('/opt/render/project/src/src/routes/index.js', 'r')
content = f.read()
f.close()

# Nova rota do relatorio
nova_rota = """router.get('/frequencia/relatorio/:turmaId', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const turmaR = await query('SELECT * FROM turmas WHERE id=$1', [req.params.turmaId]);
  const turma = turmaR.rows[0];
  if (!turma) return res.redirect('/frequencia');
  const membros = await query(`SELECT m.id, m.nome, (SELECT COUNT(*) FROM atividades a WHERE a.turma_id=$1) as total_atividades, (SELECT COUNT(*) FROM presencas p JOIN atividades a ON a.id=p.atividade_id WHERE a.turma_id=$1 AND p.membro_id=m.id AND p.presente=1) as presencas FROM turma_membros tm JOIN membros m ON m.id=tm.membro_id WHERE tm.turma_id=$1 ORDER BY m.nome`, [req.params.turmaId]);
  const atividades = await query('SELECT id, tipo, descricao, data_atividade FROM atividades WHERE turma_id=$1 ORDER BY data_atividade', [req.params.turmaId]);
  const pd = {};
  for (const at of atividades.rows) {
    const pr = await query('SELECT membro_id, presente FROM presencas WHERE atividade_id=$1', [at.id]);
    pd[at.id] = {};
    pr.rows.forEach(p => { pd[at.id][p.membro_id] = p.presente; });
  }
  const orgNome = config.org_nome || 'Liga Urologia';
  const orgCor = config.org_cor || '#1a56db';
  const orgLogo = config.org_logo || null;
  const logoHtml = orgLogo ? '<div style="text-align:center;margin-bottom:16px"><img src="' + orgLogo + '" style="max-height:90px;object-fit:contain"></div>' : '';
  let linhasMembros = membros.rows.map(m => {
    const pct = m.total_atividades > 0 ? Math.round((m.presencas / m.total_atividades) * 100) : 0;
    const faltas = Number(m.total_atividades) - Number(m.presencas);
    const status = pct >= 75 ? 'APTO' : pct >= 50 ? 'EM RISCO' : 'NAO APTO';
    const cor = pct >= 75 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
    return '<tr><td style="padding:10px;border:1px solid #e5e7eb">' + m.nome + '</td>'
      + '<td style="padding:10px;border:1px solid #e5e7eb;text-align:center;color:#22c55e;font-weight:600">' + m.presencas + '</td>'
      + '<td style="padding:10px;border:1px solid #e5e7eb;text-align:center;color:#ef4444;font-weight:600">' + faltas + '</td>'
      + '<td style="padding:10px;border:1px solid #e5e7eb;text-align:center">' + m.total_atividades + '</td>'
      + '<td style="padding:10px;border:1px solid #e5e7eb;text-align:center"><strong>' + pct + '%</strong></td>'
      + '<td style="padding:10px;border:1px solid #e5e7eb;text-align:center;color:' + cor + ';font-weight:bold">' + status + '</td></tr>';
  }).join('');
  let headerAt = '<th style="padding:10px;background:' + orgCor + ';color:white;text-align:left;min-width:150px">Membro</th>';
  for (const at of atividades.rows) {
    const dt = new Date(at.data_atividade + 'T12:00:00').toLocaleDateString('pt-BR');
    headerAt += '<th style="padding:8px;background:' + orgCor + ';color:white;text-align:center;font-size:11px;min-width:80px">' + dt + '<br>' + at.tipo + '<br>' + at.descricao.substring(0, 15) + '</th>';
  }
  let linhasAt = '';
  for (const m of membros.rows) {
    let cols = '<td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">' + m.nome + '</td>';
    for (const at of atividades.rows) {
      const presente = pd[at.id] && pd[at.id][m.id] ? 1 : 0;
      cols += '<td style="padding:8px;border:1px solid #e5e7eb;text-align:center;background:' + (presente ? '#dcfce7' : '#fee2e2') + ';color:' + (presente ? '#166534' : '#991b1b') + ';font-weight:600">' + (presente ? 'SIM' : 'NAO') + '</td>';
    }
    linhasAt += '<tr>' + cols + '</tr>';
  }
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Relatorio</title><style>body{font-family:Arial,sans-serif;padding:30px}table{width:100%;border-collapse:collapse}h3{color:' + orgCor + '}@media print{.no-print{display:none}}</style></head><body>'
    + '<div class="no-print" style="margin-bottom:20px"><button onclick="window.print()" style="background:' + orgCor + ';color:white;border:none;padding:10px 24px;border-radius:6px;cursor:pointer">Imprimir / Salvar PDF</button></div>'
    + logoHtml
    + '<div style="text-align:center;padding-bottom:16px;border-bottom:3px solid ' + orgCor + ';margin-bottom:24px">'
    + '<h1 style="margin:0 0 6px;color:' + orgCor + '">Relatorio de Frequencia</h1>'
    + '<p style="margin:0;color:#6b7280">Turma: <strong>' + turma.nome + '</strong> | Gerado em: ' + new Date().toLocaleString('pt-BR') + '</p>'
    + '<p style="margin:4px 0 0;color:#6b7280">Total atividades: <strong>' + atividades.rows.length + '</strong> | Criterio: minimo 75%</p>'
    + '</div>'
    + '<h3>Resumo por membro</h3>'
    + '<table><thead><tr>'
    + '<th style="padding:10px;background:' + orgCor + ';color:white;text-align:left">Membro</th>'
    + '<th style="padding:10px;background:' + orgCor + ';color:white;text-align:center">Presencas</th>'
    + '<th style="padding:10px;background:' + orgCor + ';color:white;text-align:center">Faltas</th>'
    + '<th style="padding:10px;background:' + orgCor + ';color:white;text-align:center">Total</th>'
    + '<th style="padding:10px;background:' + orgCor + ';color:white;text-align:center">Frequencia</th>'
    + '<th style="padding:10px;background:' + orgCor + ';color:white;text-align:center">Status</th>'
    + '</tr></thead><tbody>' + linhasMembros + '</tbody></table>'
    + '<br><h3>Presencas por atividade</h3>'
    + '<div style="overflow-x:auto"><table><thead><tr>' + headerAt + '</tr></thead><tbody>' + linhasAt + '</tbody></table></div>'
    + '</body></html>';
  res.send(html);
});"""

# Encontra e substitui a rota antiga
linhas = content.split('\n')
start = None
for i, l in enumerate(linhas):
    if "router.get('/frequencia/relatorio/:turmaId'" in l:
        start = i
        break

depth = 0
end = start
for i in range(start, len(linhas)):
    depth += linhas[i].count('{') - linhas[i].count('}')
    if i > start and depth <= 0:
        end = i
        break

linhas[start:end+1] = nova_rota.split('\n')
open('/opt/render/project/src/src/routes/index.js', 'w').write('\n'.join(linhas))
print('OK - relatorio corrigido')
