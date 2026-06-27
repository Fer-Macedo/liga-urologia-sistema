// ═══ DETECÇÃO DE RESPOSTAS DA COORDENAÇÃO (Caminho B) ═══
// Verifica cada thread de email de projeto e detecta se a coordenação respondeu
// (última mensagem da thread NÃO foi enviada pela conta da liga).
// Apenas LÊ para detectar — a resposta continua sendo feita no Gmail (mais seguro).
const { google } = require('googleapis');

// Verifica todas as threads ativas e marca as que têm resposta nova da coordenação.
// authClient: cliente OAuth da liga ; pool: conexão pg ; emailLiga: email oficial (remetente)
async function verificarRespostas(authClient, pool, emailLiga) {
  const gmail = google.gmail({ version: 'v1', auth: authClient });
  const threads = await pool.query('SELECT * FROM projetos_email_thread WHERE gmail_thread_id IS NOT NULL');
  let novas = 0;

  for (const t of threads.rows) {
    try {
      const th = await gmail.users.threads.get({ userId: 'me', id: t.gmail_thread_id, format: 'metadata', metadataHeaders: ['From', 'Date'] });
      const msgs = th.data.messages || [];
      if (!msgs.length) continue;

      // Última mensagem da thread
      const ultima = msgs[msgs.length - 1];
      const ultimaId = ultima.id;
      const headers = (ultima.payload && ultima.payload.headers) || [];
      const fromH = headers.find(h => h.name.toLowerCase() === 'from');
      const fromVal = fromH ? fromH.value.toLowerCase() : '';

      // Se a última mensagem NÃO é da liga, é uma resposta da coordenação
      const ehDaLiga = fromVal.includes((emailLiga || '').toLowerCase());

      if (!ehDaLiga && ultimaId !== t.ultima_msg_vista) {
        // Resposta nova detectada
        await pool.query('UPDATE projetos_email_thread SET tem_resposta_nova=true, resposta_em=NOW(), ultima_msg_vista=$1 WHERE id=$2',
          [ultimaId, t.id]);
        novas++;
      } else if (ehDaLiga) {
        // Última é da liga: atualiza o "visto" e limpa flag de resposta
        await pool.query('UPDATE projetos_email_thread SET tem_resposta_nova=false, ultima_msg_vista=$1 WHERE id=$2',
          [ultimaId, t.id]);
      }
    } catch (e) { /* ignora thread com erro, continua as outras */ }
  }
  return { verificadas: threads.rows.length, novas };
}

// Lista projetos que têm resposta nova da coordenação (para notificar)
async function projetosComResposta(pool) {
  const r = await pool.query(`
    SELECT t.projeto_id, t.gmail_thread_id, t.resposta_em, p.nome, p.tipo
    FROM projetos_email_thread t
    JOIN projetos_academicos p ON p.id = t.projeto_id
    WHERE t.tem_resposta_nova = true AND COALESCE(p.inativado,false)=false
    ORDER BY t.resposta_em DESC`);
  return r.rows;
}

// Marca a resposta como vista (quando o usuário clica/abre)
async function marcarRespostaVista(pool, projetoId) {
  await pool.query('UPDATE projetos_email_thread SET tem_resposta_nova=false WHERE projeto_id=$1', [projetoId]);
}

module.exports = { verificarRespostas, projetosComResposta, marcarRespostaVista };
