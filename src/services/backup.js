// src/services/backup.js
// Backup automático diário do banco PostgreSQL às 3h da manhã.
// Usa pg_dump (pega TODAS as tabelas sozinho, com estrutura + dados, escape correto),
// comprime com gzip, guarda em disco no servidor com ROTAÇÃO (mantém os últimos N dias
// e apaga os mais antigos) e envia o arquivo por e-mail como ANEXO real (cópia off-site).
// Se o backup falhar, manda um e-mail de ALERTA — pra falha nunca passar em silêncio.

require('dotenv').config(); // garante DATABASE_URL/EMAIL ao rodar via CLI (`node src/services/backup.js`)
const { spawn } = require('child_process');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { query } = require('../models/database');
const { enviarEmail } = require('./notificacoes');

// Onde guardar os backups no servidor e quantos manter. Ajuste MANTER se quiser mais/menos
// histórico — cada arquivo é pequeno (poucos MB comprimidos). Manter só 1 é arriscado: se o
// dump da noite pegar o banco num estado ruim, você perde a única cópia boa. 7 = uma semana.
const BACKUP_DIR = process.env.BACKUP_DIR || '/var/backups/liga-urologia';
const MANTER = 7;
const MAX_ANEXO_MB = 20; // acima disso não anexa no e-mail (limite do Gmail ~25MB), só avisa o caminho

// Gera o dump comprimido no caminho indicado. Roda pg_dump com a mesma conexão do app
// (DATABASE_URL) e canaliza a saída por gzip direto pro arquivo, sem passar por shell
// (evita problema de escape na connection string).
function dumpParaArquivo(caminho) {
  return new Promise((resolve, reject) => {
    if (!process.env.DATABASE_URL) return reject(new Error('DATABASE_URL não definida.'));
    const dump = spawn('pg_dump', ['--no-owner', '--no-privileges', '--dbname', process.env.DATABASE_URL]);
    // mode 0o600: o dump tem senha com hash, CPF e dados financeiros — só o dono (root) le.
    const out = fs.createWriteStream(caminho, { mode: 0o600 });
    let stderr = '';
    let codigo = null;
    dump.stderr.on('data', d => { stderr += d.toString(); });
    dump.on('error', e => reject(new Error('Não foi possível iniciar o pg_dump (instalado?): ' + e.message)));
    dump.on('close', c => { codigo = c; });
    out.on('error', reject);
    out.on('finish', () => {
      if (codigo !== 0) return reject(new Error('pg_dump falhou (código ' + codigo + '): ' + stderr.slice(0, 300)));
      // Sanidade: um dump válido nunca é minúsculo. gz de dump vazio/quebrado fica ~20 bytes.
      const tam = fs.statSync(caminho).size;
      if (tam < 200) return reject(new Error('Backup gerado suspeito de vazio (' + tam + ' bytes).'));
      resolve(tam);
    });
    dump.stdout.pipe(zlib.createGzip()).pipe(out);
  });
}

// Apaga os backups mais antigos, mantendo os MANTER mais recentes. Os nomes começam com
// timestamp ISO, então ordenar alfabeticamente já é ordenar por data.
async function rotacionar() {
  const arquivos = (await fs.promises.readdir(BACKUP_DIR))
    .filter(f => /^backup-lauro-.*\.sql\.gz$/.test(f))
    .sort();
  const excedentes = arquivos.slice(0, Math.max(0, arquivos.length - MANTER));
  for (const f of excedentes) {
    try { await fs.promises.unlink(path.join(BACKUP_DIR, f)); } catch (_) {}
  }
  return { mantidos: arquivos.length - excedentes.length, removidos: excedentes.length };
}

// Para onde vai a cópia off-site: SOMENTE o(s) e-mail(s) do administrador (perfil 'admin').
// Decisão fixa do usuário (2026-07-17): backup não vai pra presidência, só pro admin.
async function destinatarios() {
  const r = await query(`SELECT DISTINCT email FROM usuarios WHERE ativo=1 AND email IS NOT NULL AND email <> '' AND perfil = 'admin'`);
  return r.rows.map(x => x.email).join(', ');
}

// Resumo de quantos registros há por tabela (estimativa do próprio Postgres, sem varrer tudo).
async function resumoTabelas() {
  try {
    const r = await query(
      `SELECT relname AS tabela, n_live_tup AS registros
       FROM pg_stat_user_tables ORDER BY relname`
    );
    return r.rows.map(t => `${t.tabela}: ${t.registros} registros`).join('\n');
  } catch (e) { return '(não foi possível gerar o resumo)'; }
}

async function executarBackup() {
  console.log('[BACKUP] Iniciando backup diário — ' + new Date().toISOString());
  let emailDestino;
  try {
    emailDestino = await destinatarios();

    await fs.promises.mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'); // 2026-07-17-03-00-00
    const nomeArquivo = `backup-lauro-${stamp}.sql.gz`;
    const caminho = path.join(BACKUP_DIR, nomeArquivo);

    const tamBytes = await dumpParaArquivo(caminho);
    const tamKB = Math.round(tamBytes / 1024);
    const rot = await rotacionar();
    const resumo = await resumoTabelas();

    console.log(`[BACKUP] ✅ ${nomeArquivo} — ${tamKB}KB — guardados ${rot.mantidos}, removidos ${rot.removidos} antigo(s)`);

    if (!emailDestino) {
      console.warn('[BACKUP] Backup salvo em disco, mas nenhum e-mail configurado para a cópia off-site.');
      return;
    }

    const anexos = tamBytes <= MAX_ANEXO_MB * 1024 * 1024
      ? [{ filename: nomeArquivo, path: caminho }]
      : undefined;
    const avisoTamanho = anexos ? '' :
      `<p style="color:#b45309"><strong>Obs.:</strong> o arquivo (${tamKB}KB) passou de ${MAX_ANEXO_MB}MB e não foi anexado. Ele está no servidor em <code>${caminho}</code>.</p>`;

    await enviarEmail({
      para: emailDestino,
      assunto: `🗄️ Backup LAURO — ${stamp.slice(0, 10)} (${tamKB}KB)`,
      titulo: 'Backup automático do banco de dados',
      faixaLabel: 'BACKUP',
      texto: `Backup automático do banco — ${stamp}. Arquivo: ${nomeArquivo} (${tamKB}KB). No servidor mantemos os últimos ${MANTER} dias.`,
      html: `
        <p>Backup automático do banco de dados concluído.</p>
        <p><strong>Arquivo:</strong> ${nomeArquivo}<br>
           <strong>Tamanho:</strong> ${tamKB} KB<br>
           <strong>No servidor:</strong> mantendo os últimos ${MANTER} dias (${rot.mantidos} em disco).</p>
        ${avisoTamanho}
        <p style="margin-top:16px"><strong>Registros por tabela:</strong></p>
        <pre style="background:#f8fafc;padding:12px;border-radius:8px;font-size:12px;white-space:pre-wrap">${resumo}</pre>
        <p style="color:#6b7280;font-size:12px;margin-top:16px">O arquivo em anexo está comprimido (.sql.gz). Para restaurar: <code>gunzip -c ${nomeArquivo} | psql "$DATABASE_URL"</code></p>
      `,
      anexos
    });
    console.log(`[BACKUP] Cópia off-site enviada para ${emailDestino}.`);
  } catch (e) {
    console.error('[BACKUP] ❌ Erro no backup:', e.message);
    // Falha de backup não pode passar em silêncio — avisa por e-mail (se der).
    if (emailDestino) {
      try {
        await enviarEmail({
          para: emailDestino,
          assunto: '⚠️ FALHA no backup do banco — LAURO',
          titulo: 'Falha no backup automático',
          faixaLabel: 'ALERTA',
          html: `<p>O backup automático do banco <strong>falhou</strong> em ${new Date().toLocaleString('pt-BR')}.</p>
                 <p><strong>Erro:</strong> ${e.message}</p>
                 <p>Verifique o servidor assim que possível — o banco pode estar sem backup do dia.</p>`
        });
      } catch (_) {}
    }
  }
}

// Agenda o backup diário às 3h da manhã.
function agendarBackup() {
  const agora = new Date();
  const proxima3h = new Date();
  proxima3h.setHours(3, 0, 0, 0);
  if (proxima3h <= agora) proxima3h.setDate(proxima3h.getDate() + 1);
  const msAte3h = proxima3h - agora;
  console.log(`[BACKUP] Próximo backup agendado para: ${proxima3h.toLocaleString('pt-BR')}`);
  setTimeout(() => {
    executarBackup();
    setInterval(executarBackup, 24 * 60 * 60 * 1000);
  }, msAte3h);
}

// Permite rodar um backup manual pela linha de comando: `node src/services/backup.js`
if (require.main === module) {
  executarBackup().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { agendarBackup, executarBackup, dumpParaArquivo };
