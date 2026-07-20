// Fonte única do número de WhatsApp do atendimento.
//
// Antes esse número estava escrito à mão em 20 lugares (9 views públicas + o rodapé
// dos e-mails). Trocar de chip virava caçada — e bastava esquecer um arquivo para a
// pessoa cair num número que não existe mais. Agora vive na tabela `configuracoes`,
// chave `whatsapp_atendimento`, e se troca pela tela de Configurações, sem deploy.
const { query } = require('../models/database');

// Usado quando o banco ainda não tem a chave (primeiro boot após o deploy) ou quando
// a consulta falha. Nunca deixar a página sem link de contato por causa disso.
const PADRAO = '595994316286';

// ponytail: cache de 60s. O middleware roda em toda request; sem isso seria uma
// consulta por página só para montar um link que muda uma vez por ano.
let cache = null;
let expira = 0;

async function whatsappAtendimento() {
  if (cache && Date.now() < expira) return cache;
  try {
    const r = await query("SELECT valor FROM configuracoes WHERE chave='whatsapp_atendimento'");
    const v = (r.rows[0] && r.rows[0].valor || '').replace(/\D/g, '');
    cache = v || PADRAO;
  } catch (e) {
    console.error('[CONTATO] falha ao ler whatsapp_atendimento:', e.message);
    cache = cache || PADRAO;
  }
  expira = Date.now() + 60000;
  return cache;
}

// Versão síncrona, para quem monta HTML fora de contexto async — o rodapé dos e-mails.
// Só é confiável depois que `aquecer()` rodou no boot; antes disso devolve o padrão,
// que é o número correto de qualquer forma. Nunca faz I/O.
function whatsappAtendimentoSync() { return cache || PADRAO; }

// Roda uma vez no boot para que o rodapé dos e-mails já saia com o número do banco.
async function aquecer() { try { await whatsappAtendimento(); } catch (e) {} }

// Chamado ao salvar Configurações: sem isso a tela mostraria o número novo e as
// páginas continuariam com o antigo por até um minuto.
function limparCache() { cache = null; expira = 0; }

module.exports = { whatsappAtendimento, whatsappAtendimentoSync, aquecer, limparCache, PADRAO };
