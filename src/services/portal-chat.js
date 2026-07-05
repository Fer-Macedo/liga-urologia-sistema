// Atendimento do chat interno do Portal de Membros — reaproveita a tabela
// lauro_atendimentos (mesma usada pelo assistente de WhatsApp), marcando
// origem='portal' para diferenciar. Cada conversa fica aberta ('aguardando')
// ate ser encerrada pelo admin ou reaberta automaticamente na proxima mensagem.

async function nomeMembroPortal(query, tipo, id) {
  const tabela = tipo === 'ligante' ? 'ligantes' : 'diretivos';
  const r = await query(`SELECT nome FROM ${tabela} WHERE id=$1`, [id]);
  return r.rows.length ? r.rows[0].nome : null;
}

// Retorna o atendimento aberto (nao encerrado) do membro, criando um novo se necessario.
async function obterOuCriarAtendimento(query, tipo, id, nomeMembro) {
  const numeroMembro = 'portal-' + tipo + '-' + id;
  const aberto = await query(
    "SELECT id FROM lauro_atendimentos WHERE numero_membro=$1 AND origem='portal' AND status!='encerrado' ORDER BY criado_em DESC LIMIT 1",
    [numeroMembro]
  );
  if (aberto.rows.length) return aberto.rows[0].id;
  const criado = await query(
    `INSERT INTO lauro_atendimentos (numero_membro, area, numero_area, idioma, status, nome_contato, origem)
     VALUES ($1, 'secretaria', '', 'pt', 'aguardando', $2, 'portal') RETURNING id`,
    [numeroMembro, nomeMembro || null]
  );
  return criado.rows[0].id;
}

// Registra a mensagem do membro: garante atendimento aberto e grava com nome do remetente.
async function registrarMensagemMembro(query, tipo, id, texto) {
  const nome = await nomeMembroPortal(query, tipo, id);
  const atendimentoId = await obterOuCriarAtendimento(query, tipo, id, nome);
  const r = await query(
    'INSERT INTO portal_mensagens (origem_tipo, origem_id, autor, texto, remetente_nome, atendimento_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, criado_em',
    [tipo, id, 'membro', texto, nome, atendimentoId]
  );
  return { id: r.rows[0].id, criado_em: r.rows[0].criado_em, atendimentoId, nome };
}

module.exports = { nomeMembroPortal, obterOuCriarAtendimento, registrarMensagemMembro };
