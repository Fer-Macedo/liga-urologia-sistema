// src/services/backup.js
// Backup automático diário do banco PostgreSQL
// Exporta todas as tabelas em formato SQL e envia por e-mail

const { query } = require('../models/database');
const { enviarEmail } = require('./notificacoes');

// Lista de tabelas para backup
const TABELAS = [
  'usuarios', 'configuracoes',
  'membros', 'diretivos',
  'cobrancas', 'fluxo_caixa',
  'eventos', 'evento_lotes', 'evento_inscricoes', 'evento_pagamentos',
  'evento_certificados', 'evento_campos', 'evento_cupons',
  'evento_programacao', 'evento_palestrantes', 'evento_patrocinadores',
  'listas_assinaturas', 'desvinculacoes', 'cartas_cobranca',
  'calendario_atividades', 'calendario_categorias',
  'sorteios', 'sorteio_participantes',
  'palestrantes',
  'marketing_posts', 'marketing_midias', 'marketing_config',
  'contratos_diretivos'
];

async function gerarBackupSQL() {
  const linhas = [];
  const agora = new Date().toISOString();

  linhas.push(`-- ================================================`);
  linhas.push(`-- BACKUP SISTEMA LAURO — ${agora}`);
  linhas.push(`-- Gerado automaticamente pelo sistema`);
  linhas.push(`-- ================================================`);
  linhas.push('');
  linhas.push('SET client_encoding = \'UTF8\';');
  linhas.push('BEGIN;');
  linhas.push('');

  for (const tabela of TABELAS) {
    try {
      // Verificar se tabela existe
      const existe = await query(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
        [tabela]
      );
      if (!existe.rows[0].exists) continue;

      // Buscar dados
      const r = await query(`SELECT * FROM ${tabela} ORDER BY 1`);
      if (r.rows.length === 0) {
        linhas.push(`-- Tabela ${tabela}: vazia`);
        continue;
      }

      linhas.push(`-- ---- ${tabela} (${r.rows.length} registros) ----`);

      // Gerar INSERTs
      for (const row of r.rows) {
        const cols = Object.keys(row).map(c => `"${c}"`).join(', ');
        const vals = Object.values(row).map(v => {
          if (v === null) return 'NULL';
          if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
          if (typeof v === 'number') return v;
          if (v instanceof Date) return `'${v.toISOString()}'`;
          // Escapar strings
          const str = String(v).replace(/'/g, "''").replace(/\\/g, '\\\\');
          return `'${str}'`;
        }).join(', ');
        linhas.push(`INSERT INTO ${tabela} (${cols}) VALUES (${vals}) ON CONFLICT DO NOTHING;`);
      }
      linhas.push('');
    } catch (e) {
      linhas.push(`-- ERRO ao exportar ${tabela}: ${e.message}`);
    }
  }

  linhas.push('COMMIT;');
  linhas.push('');
  linhas.push(`-- FIM DO BACKUP — ${agora}`);

  return linhas.join('\n');
}

async function executarBackup() {
  console.log('[BACKUP] Iniciando backup diário — ' + new Date().toISOString());

  try {
    // Buscar config para email
    const cfgR = await query(`SELECT chave, valor FROM configuracoes`);
    const cfg = {};
    cfgR.rows.forEach(r => cfg[r.chave] = r.valor);

    const emailDestino = cfg.email_sistema || cfg.email_contato;
    if (!emailDestino) {
      console.warn('[BACKUP] Nenhum e-mail configurado para envio do backup.');
      return;
    }

    const sql = await gerarBackupSQL();
    const dataStr = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    const nomeArquivo = `backup-lauro-${dataStr}.sql`;
    const tamanhoKB = Math.round(Buffer.byteLength(sql, 'utf8') / 1024);

    // Contar registros por tabela para o relatório
    const resumo = [];
    for (const tabela of TABELAS) {
      try {
        const r = await query(`SELECT COUNT(*) n FROM ${tabela}`);
        resumo.push(`${tabela}: ${r.rows[0].n} registros`);
      } catch (e) {}
    }

    // Enviar por email com o SQL como anexo no corpo
    await enviarEmail({
      para: emailDestino,
      assunto: `🗄️ Backup LAURO — ${dataStr} (${tamanhoKB}KB)`,
      texto: `Backup automático do banco de dados — ${dataStr}\n\nResumo:\n${resumo.join('\n')}\n\nO arquivo SQL está no corpo abaixo.`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#2b6803;padding:20px 24px;border-radius:8px 8px 0 0;">
            <h2 style="color:#fff;margin:0;font-size:18px;">🗄️ Backup Automático — LAURO</h2>
          </div>
          <div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-radius:0 0 8px 8px;">
            <p style="color:#374151;margin:0 0 16px"><strong>Data:</strong> ${dataStr}</p>
            <p style="color:#374151;margin:0 0 16px"><strong>Tamanho:</strong> ${tamanhoKB} KB</p>
            <p style="color:#374151;margin:0 0 16px"><strong>Tabelas exportadas:</strong></p>
            <pre style="background:#f8fafc;padding:16px;border-radius:8px;font-size:12px;color:#374151;overflow:auto">${resumo.join('\n')}</pre>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
            <p style="color:#6b7280;font-size:12px">Este backup é gerado automaticamente todo dia às 3h. Guarde em local seguro.</p>
          </div>
        </div>
        <pre style="font-size:10px;color:#374151;margin-top:24px;background:#f8fafc;padding:16px;border-radius:8px;overflow:auto;white-space:pre-wrap">${sql.substring(0, 50000)}${sql.length > 50000 ? '\n\n... (truncado — arquivo muito grande para email)' : ''}</pre>
      `
    });

    console.log(`[BACKUP] ✅ Backup enviado para ${emailDestino} — ${tamanhoKB}KB — ${resumo.length} tabelas`);

  } catch (e) {
    console.error('[BACKUP] ❌ Erro no backup:', e.message);
  }
}

// Agendar backup diário às 3h da manhã
function agendarBackup() {
  const agora = new Date();
  const proxima3h = new Date();
  proxima3h.setHours(3, 0, 0, 0);
  if (proxima3h <= agora) proxima3h.setDate(proxima3h.getDate() + 1);

  const msAte3h = proxima3h - agora;

  console.log(`[BACKUP] Próximo backup agendado para: ${proxima3h.toLocaleString('pt-BR', {timeZone:'America/Asuncion'})}`);

  setTimeout(() => {
    executarBackup();
    // Repetir a cada 24 horas
    setInterval(executarBackup, 24 * 60 * 60 * 1000);
  }, msAte3h);
}

// Rota manual para admin forçar backup
function rotaBackupManual(router, requireAdmin) {
  router.post('/admin/backup', requireAdmin, async (req, res) => {
    try {
      res.json({ ok: true, msg: 'Backup iniciado — você receberá um e-mail em instantes.' });
      executarBackup(); // executa em background
    } catch (e) {
      res.json({ ok: false, msg: e.message });
    }
  });

  router.get('/admin/backup/download', requireAdmin, async (req, res) => {
    try {
      const sql = await gerarBackupSQL();
      const dataStr = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="backup-lauro-${dataStr}.sql"`);
      res.send(sql);
    } catch (e) {
      res.status(500).send('Erro: ' + e.message);
    }
  });
}

module.exports = { agendarBackup, executarBackup, rotaBackupManual };
