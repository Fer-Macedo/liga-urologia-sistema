// Lembrete via WhatsApp para a equipe (marketing, presidencia, admin) sobre aniversarios
// de ligantes/diretivos: 1 dia antes (19h) e no dia (06h), lembrando de postar no grupo
// dos Ligantes e no grupo de Avisos.
const { query } = require('../models/database');
const dayjs = require('dayjs');

async function enviarLembreteAniversarioEquipe(momento) {
  try {
    const alvo = momento === 'dia' ? dayjs() : dayjs().add(1, 'day');
    const dataStr = alvo.format('YYYY-MM-DD');
    const md = alvo.format('MM-DD');

    const jaEnviado = await query('SELECT id FROM aniversario_lembretes_enviados WHERE data=$1 AND momento=$2', [dataStr, momento]);
    if (jaEnviado.rows.length) return;

    const aniversariantes = await query(
      `SELECT nome, 'Ligante' as tipo, COALESCE(foto_site_chave, foto_chave) as foto_chave FROM ligantes WHERE ativo=1 AND pendente=false AND data_nascimento IS NOT NULL AND TO_CHAR(data_nascimento::date,'MM-DD')=$1
       UNION ALL
       SELECT nome, 'Diretivo' as tipo, COALESCE(foto_site_chave, foto_chave) as foto_chave FROM diretivos WHERE ativo=1 AND pendente=false AND data_nascimento IS NOT NULL AND TO_CHAR(data_nascimento::date,'MM-DD')=$1`,
      [md]
    );
    if (!aniversariantes.rows.length) return;
    const semFoto = aniversariantes.rows.filter(a => !a.foto_chave);

    const destinatarios = await query(
      `SELECT DISTINCT u.telefone FROM usuarios u
       LEFT JOIN usuario_permissoes p ON p.usuario_id=u.id AND p.modulo='marketing'
       WHERE u.ativo=1 AND u.telefone IS NOT NULL AND u.telefone <> ''
         AND (u.perfil IN ('admin','presidencia','marketing') OR p.id IS NOT NULL)`
    );
    if (!destinatarios.rows.length) return;

    const nomes = aniversariantes.rows.map(a => `• ${a.nome} (${a.tipo})`).join('\n');
    const dataFormatada = alvo.format('DD/MM');
    const avisoFoto = semFoto.length
      ? `\n\n⚠️ Sem foto cadastrada: ${semFoto.map(a => a.nome).join(', ')}. Cadastre a foto até antes das 6h de amanhã, senão o Story automático dessa(s) pessoa(s) não sai.`
      : '';
    const mensagem = momento === 'dia'
      ? `🎂 *Aniversário hoje (${dataFormatada})*\n\n${nomes}\n\nNão esqueça de fazer o post de aniversário no grupo dos Ligantes e no grupo de Avisos!`
      : `🎂 *Aniversário amanhã (${dataFormatada})*\n\n${nomes}\n\nJá deixe preparado o post de aniversário para amanhã, no grupo dos Ligantes e no grupo de Avisos!${avisoFoto}`;

    // Usa a fila (nao "urgente") para respeitar o intervalo anti-banimento ja existente
    // entre cada envio, mesmo sendo poucos destinatarios (marketing/presidencia/admin).
    const { enviarWhatsApp } = require('./notificacoes');
    for (const d of destinatarios.rows) {
      try { await enviarWhatsApp(d.telefone, mensagem, { aniversario: true }); }
      catch (e) { console.error('[LEMBRETE ANIVERSARIO] erro ao enviar:', e.message); }
    }

    await query('INSERT INTO aniversario_lembretes_enviados (data, momento) VALUES ($1,$2) ON CONFLICT DO NOTHING', [dataStr, momento]);
  } catch (e) {
    console.error('[LEMBRETE ANIVERSARIO] erro geral:', e.message);
  }
}

module.exports = { enviarLembreteAniversarioEquipe };
