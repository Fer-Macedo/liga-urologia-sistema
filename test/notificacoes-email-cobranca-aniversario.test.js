// Dois problemas reportados em 2026-07-28:
//
//   1. O e-mail de aniversário (notificarAniversario) usava htmlCobranca() — o mesmo
//      construtor da cobrança — que SEMPRE renderiza a faixa "LEMBRETE DE COBRANÇA" e a
//      seção "Opções de pagamento" (PIX/cartão), mesmo passando linkCartao/pixCode nulos.
//      Resultado: "Feliz Aniversário, Ellen!" saiu dentro de um layout de cobrança, com
//      instrução de PIX. Corrigido: usa htmlSimples() (mesmo header/rodapé, sem a seção
//      de pagamento), com faixaLabel='ANIVERSÁRIO'.
//
//   2. E-mails de cobrança (enviados todo dia, sem limite) inundavam a caixa "Enviados"
//      do Gmail da liga — 1.468+ mensagens, perdendo o controle da correspondência real.
//      A entrega continua normal (SMTP); depois de enviar, uma chamada best-effort ao
//      Gmail API (mesma caixa, confirmado: lauroucpcde@lauroucpcde.com nos dois) tira a
//      mensagem de "Enviados". PRIMEIRA TENTATIVA (deploy af0de34) tentava
//      messages.modify({removeLabelIds:['SENT']}) — parecia certo, mas o Gmail RECUSA
//      remover esse rótulo específico ("Invalid label: SENT"), só descoberto em produção
//      quando o e-mail continuou aparecendo em Enviados no dia seguinte. Confirmado ao
//      vivo contra a API de verdade (não só documentação): messages.trash() é o caminho
//      que funciona — a mensagem some de "in:sent" mesmo com o rótulo SENT ainda presente
//      por baixo. Vai para a Lixeira (~30 dias, expira sozinha); o registro de quem foi
//      avisado e quando já vive em notificacoes_log, não depende da cópia do e-mail.
process.env.GMAIL_RETRY_MS = '1'; // sem isso o teste de retentativa espera segundos de relógio real

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/notificacoes.js');

function montar({ falhaRemocao = false, achaMensagem = true } = {}) {
  const emailsEnviados = [];      // { to, subject, html }
  const buscas = [];
  const trashes = [];   // chamadas a messages.trash (o que de fato tira de Enviados)
  const modifies = [];  // chamadas a messages.modify — NENHUMA deveria acontecer mais

  process.env.EMAIL_USER = 'lauroucpcde@lauroucpcde.com';
  process.env.EMAIL_PASS = 'senha-teste';

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql) => {
      if (/SELECT chave, valor FROM configuracoes/.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  }};

  const rnm = require.resolve('nodemailer');
  require.cache[rnm] = { id: rnm, filename: rnm, loaded: true, exports: {
    createTransport: () => ({
      sendMail: async (opts) => { emailsEnviados.push(opts); return { messageId: '<msg-teste-123@mail.gmail.com>' }; }
    })
  }};

  const rgd = require.resolve(path.join(RAIZ, 'src/services/google-drive.js'));
  require.cache[rgd] = { id: rgd, filename: rgd, loaded: true, exports: {
    getClientAtualizado: async () => ({ /* client fake */ })
  }};

  const rgg = require.resolve('googleapis');
  require.cache[rgg] = { id: rgg, filename: rgg, loaded: true, exports: {
    google: {
      gmail: () => ({
        users: {
          messages: {
            list: async (opts) => {
              buscas.push(opts.q);
              if (falhaRemocao) throw new Error('falha simulada de rede');
              return { data: { messages: achaMensagem ? [{ id: 'GMAIL_MSG_1' }] : [] } };
            },
            // O Gmail RECUSA modify({removeLabelIds:['SENT']}) na vida real ("Invalid
            // label: SENT") — o mock reproduz essa rejeição, para o teste falhar se o
            // código voltar a depender desse caminho quebrado.
            modify: async (opts) => { modifies.push(opts); throw new Error('Invalid label: SENT'); },
            trash: async (opts) => { trashes.push(opts); return { data: { labelIds: ['TRASH', 'SENT'] } }; }
          }
        }
      })
    }
  }};

  delete require.cache[require.resolve(MODULO)];
  const mod = require(MODULO);
  return { mod, emailsEnviados, buscas, trashes, modifies };
}

// ─── FALHA 1: aniversário no layout errado ────────────────────────────────────

test('notificarAniversario: usa o layout genérico, não o de cobrança', async () => {
  const { mod, emailsEnviados } = montar();
  await mod.notificarAniversario({ membro: { id: 1, nome: 'Ellen Cordeiro', email: 'ellen@teste.com', whatsapp: null } });
  assert.strictEqual(emailsEnviados.length, 1);
  const html = emailsEnviados[0].html;
  assert.match(html, /ANIVERSÁRIO/, 'a faixa do topo precisa dizer ANIVERSÁRIO');
  assert.doesNotMatch(html, /LEMBRETE DE COBRAN/i, 'não pode sair com a faixa de cobrança');
  assert.doesNotMatch(html, /Op[cç][oõ]es de pagamento/i, 'aniversário não tem seção de pagamento');
  assert.doesNotMatch(html, /PIX/i, 'nada de instrução de PIX numa mensagem de aniversário');
});

// 17/08/2026: o layout de e-mail (htmlSimples/htmlCobranca) não declarava font-family em
// lugar nenhum — o e-mail saía com a fonte padrão do cliente (ex: Times New Roman, serifada),
// diferente da fonte usada no resto do sistema. Corrigido no body e na tabela raiz do wrap.
test('notificarAniversario: e-mail sai com font-family definida, não com a fonte padrão do cliente', async () => {
  const { mod, emailsEnviados } = montar();
  await mod.notificarAniversario({ membro: { id: 1, nome: 'Ellen Cordeiro', email: 'ellen@teste.com', whatsapp: null } });
  const html = emailsEnviados[0].html;
  assert.match(html, /font-family:'Segoe UI',Arial,sans-serif/, 'precisa declarar a fonte usada no resto do sistema, não deixar o cliente de e-mail escolher');
});

test('notificarAniversario: o corpo da mensagem de parabéns continua presente', async () => {
  const { mod, emailsEnviados } = montar();
  await mod.notificarAniversario({ membro: { id: 1, nome: 'Ellen Cordeiro', email: 'ellen@teste.com', whatsapp: null } });
  assert.match(emailsEnviados[0].html, /Ellen/, 'o nome da pessoa precisa aparecer no corpo do e-mail');
});

// ─── FALHA 2: cobrança poluindo a caixa de Enviados ───────────────────────────

test('notificarCobranca: pede pra sair de Enviados (alto volume, diário)', async () => {
  const { mod, buscas, trashes, modifies } = montar();
  const membro = { id: 1, nome: 'Fulano', email: 'fulano@teste.com', whatsapp: null };
  const cobranca = { id: 10, data_vencimento: '2026-07-15', valor_desconto: 20, valor_cheio: 25 };
  await mod.notificarCobranca({ membro, cobranca, tipo: 'pos' });
  assert.strictEqual(buscas.length, 1, 'tem que procurar a mensagem recém-enviada no Gmail');
  assert.match(buscas[0], /rfc822msgid:/, 'a busca usa o Message-ID real do e-mail enviado');
  assert.strictEqual(trashes.length, 1, 'tem que mover a mensagem pra Lixeira — é isso que tira ela de Enviados');
  assert.strictEqual(trashes[0].id, 'GMAIL_MSG_1');
  assert.strictEqual(modifies.length, 0,
    'NUNCA usar messages.modify pra isso — o Gmail recusa remover o rótulo SENT (foi o bug do primeiro deploy)');
});

test('notificarCobranca: e-mail (htmlCobranca) também sai com a font-family corrigida', async () => {
  const { mod, emailsEnviados } = montar();
  const membro = { id: 1, nome: 'Fulano', email: 'fulano@teste.com', whatsapp: null };
  const cobranca = { id: 10, data_vencimento: '2026-07-15', valor_desconto: 20, valor_cheio: 25 };
  await mod.notificarCobranca({ membro, cobranca, tipo: 'pos' });
  assert.match(emailsEnviados[0].html, /font-family:'Segoe UI',Arial,sans-serif/);
});

test('notificarAniversario: NÃO tira de Enviados (baixo volume, um por vez)', async () => {
  const { mod, trashes } = montar();
  await mod.notificarAniversario({ membro: { id: 1, nome: 'Ellen', email: 'ellen@teste.com', whatsapp: null } });
  assert.strictEqual(trashes.length, 0, 'aniversário pode continuar visível em Enviados');
});

test('a entrega do e-mail não depende de conseguir tirar de Enviados', async () => {
  const { mod, emailsEnviados } = montar({ falhaRemocao: true });
  const membro = { id: 1, nome: 'Fulano', email: 'fulano@teste.com', whatsapp: null };
  const cobranca = { id: 10, data_vencimento: '2026-07-15', valor_desconto: 20, valor_cheio: 25 };
  const r = await mod.notificarCobranca({ membro, cobranca, tipo: 'pos' });
  assert.strictEqual(emailsEnviados.length, 1, 'o e-mail já saiu de verdade, isso não pode ser desfeito por uma falha aqui');
});

test('quando o Gmail ainda não indexou a mensagem, não trava nem quebra nada', async () => {
  const { mod, buscas } = montar({ achaMensagem: false });
  const membro = { id: 1, nome: 'Fulano', email: 'fulano@teste.com', whatsapp: null };
  const cobranca = { id: 10, data_vencimento: '2026-07-15', valor_desconto: 20, valor_cheio: 25 };
  await mod.notificarCobranca({ membro, cobranca, tipo: 'pos' });
  assert.strictEqual(buscas.length, 3, 'tenta algumas vezes antes de desistir');
});
