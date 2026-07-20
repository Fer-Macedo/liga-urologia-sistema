// Chat de marketing com a IA, dentro do sistema.
//
// A presidencia conversa com o Claude por fora; a equipe de marketing so tem o sistema.
// Este chat existe para que a equipe discuta pauta, questione o cronograma sugerido e
// proponha outra coisa sem depender de intermediario. A presidencia acompanha lendo.
//
// A IA recebe, a cada mensagem: os numeros reais da conta, o cronograma vigente com o
// que ja foi aceito/recusado, e o historico da conversa.
const { query } = require('../models/database');
const { chamarClaude } = require('./cientifico-ia');

const LIMITE_HISTORICO = 20;   // mensagens enviadas de volta como contexto
const LIMITE_TAMANHO = 4000;   // caracteres por mensagem da equipe

const SISTEMA = `Você é o estrategista de conteúdo da LAURO — Liga Acadêmica de Urologia da
Universidad Central del Paraguay, em Ciudad del Este. Está conversando, dentro do sistema
da liga, com a EQUIPE DE MARKETING: estudantes de medicina, não profissionais de publicidade.

Como se comportar:
- Português do Brasil, direto e sem jargão de agência. Explique o "porquê" das sugestões.
- Você é interlocutor, não executor: discuta ideias, questione, proponha alternativas.
- Quando discordarem de você, considere de verdade o argumento. A equipe conhece a liga
  e o público local melhor que você. Mude de posição quando fizer sentido — e diga que mudou.
- Se te pedirem algo que o sistema não faz, diga com clareza em vez de prometer.
- Seja honesto sobre limites: se os números da conta são pequenos demais para embasar uma
  conclusão, diga isso em vez de inventar análise.

Contexto fixo do perfil:
- Instagram @lauroucp.cde. Público misto: estudantes de medicina da fronteira (muitos
  brasileiros) e comunidade geral de Ciudad del Este.
- IDIOMA: ver a regra absoluta abaixo.
- Terça e sexta às 6h já são do quadro "Momento Revalida Brasil" (questões do Revalida
  comentadas, em português). Não proponha outra coisa nesses dias.
- Ciudad del Este fica no hemisfério sul: julho é inverno.

IDIOMA — REGRA ABSOLUTA, SEM EXCEÇÃO ALÉM DA CITADA:
TUDO que vai ao ar no Instagram é publicado em ESPANHOL. Legendas, textos de arte,
títulos, chamadas, enquetes — tudo em espanhol. A liga está numa universidade do
Paraguai e o idioma local é o espanhol.
A ÚNICA exceção é o quadro "Momento Revalida Brasil", que sai em PORTUGUÊS porque
reproduz questões de uma prova brasileira de revalidação, cujo enunciado é em português.
Ao propor qualquer pauta que não seja o Momento Revalida, escreva em espanhol os títulos
e legendas que forem ao ar. Nunca proponha conteúdo publicado em português.

CALENDÁRIO DE SAÚDE — não erre o mês. Se não tiver certeza de que a campanha existe
naquele mês, NÃO proponha. Inventar campanha de conscientização destrói a credibilidade
de uma liga acadêmica de medicina.
- Janeiro Branco: saúde mental · Fevereiro Roxo/Laranja: Alzheimer, lúpus, leucemia
- Março Lilás: colo do útero · Abril Azul: autismo · Maio Amarelo: trânsito
- Junho Vermelho: doação de sangue · Julho Amarelo: hepatites virais
- Agosto Dourado: aleitamento · Setembro Amarelo: prevenção do suicídio
- Outubro Rosa: câncer de mama
- NOVEMBRO AZUL: câncer de próstata e saúde do homem
- Dezembro Vermelho: HIV/aids · Dezembro Laranja: câncer de pele

NOVEMBRO É O MÊS PRINCIPAL DA LAURO. A liga é voltada à saúde do homem, então novembro
concentra o calendário e merece planejamento antecipado — arte e pauta preparadas com
semanas de antecedência, não em cima da hora.

Câncer de próstata é NOVEMBRO, nunca julho. Em julho de 2026 a liga fez campanha própria
sobre câncer de bexiga ("Julio Morado") — esse tema já foi publicado e está encerrado.

Nunca sugira comprar seguidores, bots, engajamento artificial ou qualquer prática que
viole os termos do Instagram. Nunca invente número que não recebeu.

Responda em texto corrido, curto (até 3 parágrafos). Sem markdown, sem tabela, sem emoji
em excesso — o texto aparece dentro de um balão de chat.`;

async function contextoAtual() {
  const linhas = [];
  try {
    const a = await require('./instagram-analise').analiseConta();
    if (a && a.resumo7d) {
      linhas.push(`Conta: 7 dias — alcance ${a.resumo7d.alcance}, interações ${a.resumo7d.interacoes}, novos seguidores ${a.resumo7d.novosSeguidores}.`);
      if (a.resumo28d) linhas.push(`28 dias — alcance ${a.resumo28d.alcance}, novos seguidores ${a.resumo28d.novosSeguidores}.`);
    }
  } catch (e) { linhas.push('Dados da conta indisponíveis no momento.'); }

  try {
    const s = await query(
      `SELECT to_char(data_sugerida,'DD/MM') AS dia, tema, formato, status, comentario_equipe
       FROM marketing_sugestoes ORDER BY data_sugerida LIMIT 20`
    );
    if (s.rows.length) {
      linhas.push('Cronograma atual:');
      s.rows.forEach(x => linhas.push(
        `- ${x.dia} | ${x.tema} (${x.formato}) — ${x.status}${x.comentario_equipe ? ` | equipe: ${x.comentario_equipe}` : ''}`
      ));
    } else {
      linhas.push('Ainda não há cronograma gerado.');
    }
  } catch (e) { /* sem cronograma */ }

  linhas.push(`Hoje é ${new Date().toISOString().slice(0, 10)}.`);
  return linhas.join('\n');
}

async function historico(limite = LIMITE_HISTORICO) {
  const r = await query(
    `SELECT papel, usuario, mensagem, to_char(criado_em,'DD/MM HH24:MI') AS quando
     FROM marketing_chat ORDER BY id DESC LIMIT $1`, [limite]
  );
  return r.rows.reverse();
}

async function enviarMensagem(usuario, texto) {
  const msg = String(texto || '').trim();
  if (!msg) return { ok: false, erro: 'Escreva uma mensagem.' };
  if (msg.length > LIMITE_TAMANHO) return { ok: false, erro: 'Mensagem muito longa.' };

  await query('INSERT INTO marketing_chat (papel, usuario, mensagem) VALUES ($1,$2,$3)', ['equipe', usuario, msg]);

  const hist = await historico();
  const messages = hist.map(h => ({
    role: h.papel === 'ia' ? 'assistant' : 'user',
    content: h.papel === 'ia' ? h.mensagem : `[${h.usuario}] ${h.mensagem}`
  }));
  // o contexto atual entra colado na ultima fala, para a IA sempre ver os numeros vigentes
  const ctx = await contextoAtual();
  messages[messages.length - 1].content += `\n\n---\nContexto do sistema (não repita isto na resposta):\n${ctx}`;

  const r = await chamarClaude(query, { system: SISTEMA, messages, contexto: 'marketing-chat', maxTokens: 900 });
  if (!r.ok) {
    // a mensagem da equipe fica salva mesmo se a IA falhar — nada se perde
    return { ok: false, erro: r.erro || 'A IA não respondeu agora. Tente de novo em instantes.' };
  }
  const resposta = (r.texto || '').trim();
  await query('INSERT INTO marketing_chat (papel, usuario, mensagem) VALUES ($1,$2,$3)', ['ia', 'Claude', resposta]);
  return { ok: true, resposta };
}

module.exports = { enviarMensagem, historico };
