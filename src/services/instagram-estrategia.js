// src/services/instagram-estrategia.js
// Análise ESTRATÉGICA do Instagram por IA (Claude): pega os dados reais da conta
// (via instagram-analise.js) e gera um diagnóstico + plano de ação para a equipe de
// marketing executar — engajamento, crescimento e melhoria do perfil. Guarda cada
// análise em instagram_estrategias, mostra na aba Marketing e envia semanalmente.
const { query } = require('../models/database');
const { analiseConta } = require('./instagram-analise');
const { chamarClaude } = require('./cientifico-ia');

const SISTEMA = `Você é um estrategista sênior de redes sociais, especializado em CRESCIMENTO e ENGAJAMENTO no Instagram, trabalhando para uma liga acadêmica de medicina — a LAURO (Liga Acadêmica de Urologia), de Ciudad del Este, Paraguai. O perfil é institucional e educacional; o público são estudantes de medicina, residentes e médicos jovens da região de fronteira (Ciudad del Este / Foz do Iguaçu).

Você recebe DADOS REAIS da conta (seguidores, crescimento, alcance, público, melhores posts, cadência de postagem). Sua tarefa é entregar um PLANO DE AÇÃO prático que a equipe execute na semana — não um relatório genérico.

Regras:
- Baseie CADA recomendação nos dados fornecidos e cite os números (ex: "vocês ficaram 7 dias sem postar", "seus 5 melhores posts são Reels", "público majoritário 25-34 de Ciudad del Este"). Nada de conselho genérico desconectado dos dados.
- Ações CONCRETAS e executáveis por um time de estudantes: o que postar, quantas vezes, qual formato, qual tema de urologia/medicina, qual chamada para ação. Dê exemplos reais de pauta.
- Seja honesto: se o crescimento está lento, diga com clareza. Metas realistas, não fantasiosas.
- NUNCA sugira comprar seguidores, bots, seguir/curtir/comentar em massa, apps de crescimento ou qualquer coisa que viole os termos do Instagram — isso derruba a conta. Crescimento é conteúdo + constância + engajamento real.
- Português do Brasil, tom direto e motivador, para a equipe interna.

Responda APENAS com um fragmento HTML (sem <html>/<body>), usando SOMENTE estas tags: <h4>, <p>, <ul>, <li>, <strong>. Estruture nesta ordem exata:
<h4>📊 Diagnóstico</h4> (2-4 frases do estado atual, com números)
<h4>🎯 Plano de ação desta semana</h4> (lista de 4-6 ações concretas)
<h4>💡 Ideias de conteúdo</h4> (lista de 4-6 pautas específicas de urologia/liga acadêmica)
<h4>📈 Metas realistas</h4> (2-3 metas numéricas para a próxima semana/mês)
Não escreva nada fora dessas seções nem fora do HTML.`;

function resumoParaPrompt(a) {
  const lista = arr => arr.slice(0, 4).map(x => `${x.chave}: ${x.valor}`).join(', ');
  const tops = a.topPosts.map(p => `${p.tipo} (${p.engaj} interações)`).join('; ');
  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  return `Hoje é ${hoje}. Ao citar prazos (ex: "até domingo"), use esta data como referência.

DADOS DA CONTA @${a.conta.username}:
- Seguidores: ${a.conta.seguidores} | Seguindo: ${a.conta.seguindo} | Total de posts: ${a.conta.posts}
- Novos seguidores: ${a.resumo7d.novosSeguidores} nos últimos 7 dias, ${a.resumo28d.novosSeguidores} nos últimos 28 dias
- Alcance: ${a.resumo7d.alcance} contas (7 dias), ${a.resumo28d.alcance} (28 dias)
- Visitas ao perfil (7 dias): ${a.resumo7d.visitas} | Interações (7 dias): ${a.resumo7d.interacoes}
- Público por idade: ${lista(a.publico.idade)}
- Público por gênero: ${lista(a.publico.genero)}
- Principais cidades: ${lista(a.publico.cidades)}
- 5 posts com mais engajamento (formato e interações): ${tops || 'sem dados'}
- Observações automáticas do sistema (por regra): ${a.recomendacoes.join(' | ')}

Gere o plano de ação da equipe com base NESTES números.`;
}

async function gerarEstrategia(criadoPor) {
  const a = await analiseConta();
  if (!a.conta.username) return { ok: false, erro: 'Não há dados da conta do Instagram para analisar.' };
  const r = await chamarClaude(query, { system: SISTEMA, content: resumoParaPrompt(a), contexto: 'instagram-estrategia', maxTokens: 1800 });
  if (!r.ok) return r;
  const html = (r.texto || '').replace(/```html|```/g, '').trim();
  const ins = await query(
    'INSERT INTO instagram_estrategias (dados_json, analise_html, criado_por) VALUES ($1,$2,$3) RETURNING id, gerado_em',
    [JSON.stringify(a), html, criadoPor || 'sistema']
  );
  return { ok: true, id: ins.rows[0].id, geradoEm: ins.rows[0].gerado_em, html };
}

async function ultimaEstrategia() {
  const r = await query('SELECT id, gerado_em, analise_html, criado_por FROM instagram_estrategias ORDER BY id DESC LIMIT 1');
  return r.rows[0] || null;
}

// Cron semanal: gera uma análise nova e manda pra equipe (marketing/presidência/admin).
async function enviarRelatorioEstrategico() {
  const g = await gerarEstrategia('cron-semanal');
  if (!g.ok) { console.warn('[IG ESTRATEGIA] não gerou:', g.erro); return; }
  const { enviarEmail } = require('./notificacoes');
  const dest = await query(
    `SELECT DISTINCT u.email FROM usuarios u
     LEFT JOIN usuario_permissoes p ON p.usuario_id=u.id AND p.modulo='marketing'
     WHERE u.ativo=1 AND u.email IS NOT NULL AND u.email <> ''
       AND (u.perfil IN ('admin','presidencia','marketing') OR p.id IS NOT NULL)`
  );
  const emails = dest.rows.map(r => r.email).join(', ');
  if (!emails) { console.warn('[IG ESTRATEGIA] sem destinatários.'); return; }
  await enviarEmail({
    para: emails,
    assunto: '📈 Plano de ação do Instagram — resumo da semana',
    titulo: 'Estratégia do Instagram',
    faixaLabel: 'ESTRATÉGIA',
    html: g.html + '<p style="color:#6b7280;font-size:12px;margin-top:16px">Plano gerado automaticamente por IA a partir dos dados reais da conta. Veja e gere novas análises na aba Marketing → Estratégia.</p>'
  });
  console.log('[IG ESTRATEGIA] Plano semanal enviado para', emails);
}

module.exports = { gerarEstrategia, ultimaEstrategia, enviarRelatorioEstrategico };
