// Lembrete por email para a equipe (marketing, presidencia, admin) sobre aniversarios
// de ligantes/diretivos: 1 dia antes (19h) e no dia (06h), lembrando de postar no grupo
// dos Ligantes e no grupo de Avisos. WhatsApp suspenso aqui (aviso interno, nao e a
// excecao de "assistente virtual"/"parabens ao aniversariante") ate segunda ordem.
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

    const nomes = aniversariantes.rows.map(a => `• ${a.nome} (${a.tipo})`).join('\n');
    const dataFormatada = alvo.format('DD/MM');
    const avisoFoto = semFoto.length
      ? `\n\n⚠️ Sem foto cadastrada: ${semFoto.map(a => a.nome).join(', ')}. Cadastre a foto até antes das 6h de amanhã, senão o Story automático dessa(s) pessoa(s) não sai.`
      : '';
    const mensagem = momento === 'dia'
      ? `🎂 *Aniversário hoje (${dataFormatada})*\n\n${nomes}\n\nNão esqueça de fazer o post de aniversário no grupo dos Ligantes e no grupo de Avisos!`
      : `🎂 *Aniversário amanhã (${dataFormatada})*\n\n${nomes}\n\nJá deixe preparado o post de aniversário para amanhã, no grupo dos Ligantes e no grupo de Avisos!${avisoFoto}`;

    // Aviso interno a equipe suspenso no WhatsApp (nao e o "assistente virtual" nem
    // "parabens ao aniversariante" — e aviso de operacao, fora da unica excecao liberada
    // durante o aquecimento do numero). Vai só por email ate segunda ordem.
    const { enviarEmail } = require('./notificacoes');

    // Email para a equipe. Destinatarios por email podem diferir dos de telefone (ex: quem nao tem telefone cadastrado).
    const destEmail = await query(
      `SELECT DISTINCT u.email FROM usuarios u
       LEFT JOIN usuario_permissoes p ON p.usuario_id=u.id AND p.modulo='marketing'
       WHERE u.ativo=1 AND u.email IS NOT NULL AND u.email <> ''
         AND (u.perfil IN ('admin','presidencia','marketing') OR p.id IS NOT NULL)`
    );
    const htmlEmail = mensagem.replace(/\*(.*?)\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    const assuntoEmail = momento === 'dia' ? `Aniversário hoje (${dataFormatada})` : `Aniversário amanhã (${dataFormatada})`;

    // No dia do aniversario, anexa a arte de cada aniversariante ao email para a
    // equipe baixar e postar manualmente no grupo do WhatsApp. Gera uma vez e
    // reaproveita o mesmo anexo para todos os destinatarios.
    let anexos;
    if (momento === 'dia') {
      try {
        const { aniversariantesDoDia, gerarArteAniversarioPessoa } = require('./instagram');
        const { baixarArquivoBuffer } = require('./arquivos');
        const cfgTpl = await query("SELECT valor FROM configuracoes WHERE chave='aniversario_template_chave'");
        const templateChave = cfgTpl.rows[0] && cfgTpl.rows[0].valor;
        if (templateChave) {
          const templateBuffer = await baixarArquivoBuffer(templateChave);
          const pessoas = await aniversariantesDoDia(md);
          anexos = [];
          for (const p of pessoas) {
            if (!p.foto_chave) continue;
            try {
              const arte = await gerarArteAniversarioPessoa(p, templateBuffer);
              const primeiroNome = p.nome.trim().split(/\s+/)[0];
              anexos.push({ filename: `aniversario-${primeiroNome}.jpg`, content: arte, contentType: 'image/jpeg' });
            } catch (e) { console.error('[LEMBRETE ANIVERSARIO] erro ao gerar arte de', p.nome, e.message); }
          }
          if (!anexos.length) anexos = undefined;
        }
      } catch (e) { console.error('[LEMBRETE ANIVERSARIO] erro ao preparar anexos:', e.message); }
    }

    for (const em of destEmail.rows) {
      try { await enviarEmail({ para: em.email, assunto: assuntoEmail, html: htmlEmail, titulo: assuntoEmail, faixaLabel: 'ANIVERSÁRIO', anexos }); }
      catch (err) { console.error('[LEMBRETE ANIVERSARIO] erro email:', err.message); }
    }

    await query('INSERT INTO aniversario_lembretes_enviados (data, momento) VALUES ($1,$2) ON CONFLICT DO NOTHING', [dataStr, momento]);
  } catch (e) {
    console.error('[LEMBRETE ANIVERSARIO] erro geral:', e.message);
  }
}

module.exports = { enviarLembreteAniversarioEquipe };
