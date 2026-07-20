// Alerta de pendencias do marketing — SO dispara quando falta alguma coisa.
//
// A regra e essa e nao pode ser afrouxada: alerta que chega toda semana independente do
// estado vira papel de parede e a equipe passa a ignorar. Se este e-mail chegou, e porque
// existe algo concreto a fazer. Quando esta tudo em ordem, o silencio e a resposta.
//
// Roda domingo e quarta as 8h — dois dias antes de cada envio do Momento Revalida
// (terca e sexta), dando margem para a equipe aprovar a tempo.
const { query } = require('../models/database');

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

// proximo dia da semana (0=dom … 6=sab) a partir de hoje, exclusive
function proximoDia(diasSemana) {
  const d = new Date();
  for (let i = 1; i <= 7; i++) {
    const t = new Date(d.getTime() + i * 86400000);
    if (diasSemana.includes(t.getDay())) return t;
  }
  return null;
}
const fmt = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

async function levantarPendencias() {
  const p = [];

  // 1. Momento Revalida — terca(2) e sexta(5). Sem questao aprovada, o cron nao envia nada.
  const envio = proximoDia([2, 5]);
  const apr = await query("SELECT COUNT(*) c FROM revalida_questoes WHERE status='aprovada' AND enviado_em IS NULL");
  const naFila = Number(apr.rows[0].c);
  if (envio && naFila === 0) {
    p.push({
      titulo: 'Momento Revalida sem questão aprovada',
      texto: `O próximo envio é <strong>${DIAS[envio.getDay()]}, ${fmt(envio)} às 6h</strong>, e não há nenhuma questão aprovada na fila. Sem aprovação, o sistema não envia nada e o quadro fica sem publicação nesse dia.`,
      acao: 'Marketing → Momento Revalida → Aprovar'
    });
  } else if (envio && naFila === 1) {
    p.push({
      titulo: 'Momento Revalida com apenas 1 questão na fila',
      texto: `Depois do envio de <strong>${DIAS[envio.getDay()]}, ${fmt(envio)}</strong>, a fila fica vazia. Vale aprovar mais algumas para não faltar no envio seguinte.`,
      acao: 'Marketing → Momento Revalida → Aprovar'
    });
  }

  // 2. Publicacoes automaticas nos proximos 10 dias
  const ag = await query(
    "SELECT COUNT(*) c FROM instagram_posts WHERE status='agendado' AND agendado_para BETWEEN NOW() AND NOW() + INTERVAL '10 days'"
  );
  if (Number(ag.rows[0].c) === 0) {
    p.push({
      titulo: 'Nenhuma publicação agendada para os próximos 10 dias',
      texto: 'Não há carrossel, feed nem story agendado. O perfil vai ficar sem publicação automática nesse período.',
      acao: 'Marketing → Estratégia → Gerar sugestões, aprovar e montar as peças'
    });
  }

  // 3. Ultima publicacao — cadencia
  const ult = await query(
    "SELECT EXTRACT(DAY FROM NOW() - MAX(publicado_em))::int d FROM instagram_posts WHERE status='publicado'"
  );
  const diasSemPostar = ult.rows[0].d;
  if (diasSemPostar !== null && diasSemPostar >= 7) {
    p.push({
      titulo: `${diasSemPostar} dias sem publicar`,
      texto: `A última publicação automática foi há ${diasSemPostar} dias. Frequência baixa reduz o alcance das publicações seguintes.`,
      acao: 'Marketing → Estratégia'
    });
  }

  // 4. Sugestoes paradas esperando decisao
  const sug = await query(
    "SELECT COUNT(*) c FROM marketing_sugestoes WHERE status='sugerida' AND criado_em < NOW() - INTERVAL '5 days'"
  );
  if (Number(sug.rows[0].c) > 0) {
    p.push({
      titulo: `${sug.rows[0].c} sugestão(ões) de pauta sem resposta`,
      texto: 'Há pautas propostas pela IA aguardando decisão há mais de 5 dias. Aceitar ou recusar (com o motivo) é o que faz a IA melhorar as próximas.',
      acao: 'Marketing → Estratégia → Cronograma sugerido'
    });
  }

  return p;
}

function corpo(pendencias) {
  const itens = pendencias.map(x => `
    <div style="border-left:4px solid #d97706;background:#fffbeb;padding:12px 16px;margin-bottom:12px;border-radius:0 6px 6px 0">
      <div style="font-weight:700;margin-bottom:4px">${x.titulo}</div>
      <div style="font-size:14px;line-height:1.5">${x.texto}</div>
      <div style="font-size:13px;color:#64748b;margin-top:8px">Onde resolver: <strong>${x.acao}</strong></div>
    </div>`).join('');
  return `
<p>Este e-mail só é enviado quando <strong>falta alguma coisa</strong>. Se ele chegou, há pendência:</p>
${itens}
<p style="color:#64748b;font-size:13px;margin-top:18px">
Quando estiver tudo em ordem, nenhum e-mail é disparado — o silêncio é o sinal de que está tudo certo.</p>`;
}

async function enviarAlertaPendencias() {
  const pendencias = await levantarPendencias();
  if (!pendencias.length) {
    console.log('[ALERTA MKT] Nada pendente — nenhum e-mail enviado.');
    return { ok: true, pendencias: 0 };
  }

  const dest = await query(
    `SELECT DISTINCT u.email FROM usuarios u
     LEFT JOIN usuario_permissoes p ON p.usuario_id=u.id AND p.modulo='marketing'
     WHERE u.ativo=1 AND u.email IS NOT NULL AND u.email <> ''
       AND (u.perfil IN ('admin','presidencia','marketing') OR p.id IS NOT NULL)`
  );
  if (!dest.rows.length) { console.warn('[ALERTA MKT] Sem destinatários.'); return { ok: false }; }

  const { enviarEmail } = require('./notificacoes');
  const assunto = pendencias.length === 1
    ? `Marketing: ${pendencias[0].titulo}`
    : `Marketing: ${pendencias.length} pendências`;

  let enviados = 0;
  for (const d of dest.rows) {
    const r = await enviarEmail({ para: d.email, assunto, html: corpo(pendencias) }).catch(() => ({ ok: false }));
    if (r && r.ok) enviados++;
  }
  console.log(`[ALERTA MKT] ${pendencias.length} pendência(s) — enviado para ${enviados}/${dest.rows.length}.`);
  return { ok: enviados > 0, pendencias: pendencias.length, enviados };
}

module.exports = { levantarPendencias, enviarAlertaPendencias };
