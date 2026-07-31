// ═══ DETECÇÃO DE RESPOSTAS DA COORDENAÇÃO (Caminho B) ═══
// Verifica cada thread de email de projeto e detecta se a coordenação respondeu
// (última mensagem da thread NÃO foi enviada pela conta da liga).
//
// Meio-termo decidido com o usuário (2026-07-30): a decisão OFICIAL (aprovar ou devolver
// para correção) continua sendo sempre de uma pessoa — a Secretaria, com Presidência/Admin
// como apoio (mesma permissão que já existe em /devolver-correccion e /aprobar-final).
// O que fica automático é o trabalho manual de ANTES da decisão: baixar o anexo que a
// Coordinación mandou e ler o e-mail so pra saber do que se trata. Por isso, quando uma
// resposta nova e detectada, alem de marcar tem_resposta_nova, o sistema:
//   1. anexa automaticamente qualquer arquivo da resposta ao projeto (tipo pedido_correccion
//      — o mesmo "balde" que ja era usado quando alguem anexava isso a mao);
//   2. guarda um resumo do texto e uma sugestao (aprovado/correcao) por palavras-chave, SO
//      como dica na tela — nunca muda o status do projeto sozinho.
const { google } = require('googleapis');

function base64UrlParaBuffer(b64url) {
  const b64 = String(b64url || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

// Percorre as partes MIME (podem vir aninhadas: multipart/mixed > multipart/alternative >
// text/plain + text/html, mais partes separadas para cada anexo) e junta texto + anexos.
function extrairPartesEmail(payload, acc) {
  acc = acc || { textoPlano: null, textoHtml: null, anexos: [] };
  if (!payload) return acc;
  const mime = payload.mimeType || '';
  if (payload.filename && payload.body && payload.body.attachmentId) {
    acc.anexos.push({ filename: payload.filename, mimeType: mime, attachmentId: payload.body.attachmentId });
  } else if (mime === 'text/plain' && payload.body && payload.body.data && !acc.textoPlano) {
    acc.textoPlano = base64UrlParaBuffer(payload.body.data).toString('utf8');
  } else if (mime === 'text/html' && payload.body && payload.body.data && !acc.textoHtml) {
    acc.textoHtml = base64UrlParaBuffer(payload.body.data).toString('utf8');
  }
  if (Array.isArray(payload.parts)) payload.parts.forEach(p => extrairPartesEmail(p, acc));
  return acc;
}

// Sugestao por palavras-chave — so como dica, nunca decide sozinho. Ambiguo (os dois
// sinais juntos, ou nenhum) devolve null de proposito: melhor nao sugerir nada do que
// sugerir errado numa aprovacao/devolucao oficial de projeto.
function classificarResposta(texto) {
  const t = (texto || '').toLowerCase();
  const pareceAprovado = /\baprovad[oa]s?\b|\baprobad[oa]s?\b/.test(t);
  const pareceCorrecao = /correcci[oó]n(es)?|corre[cç][aã]o|ajust(e|ar|es)|revis(ar|ão)|observaç(ão|ões)|observacion(es)?/.test(t);
  if (pareceAprovado && !pareceCorrecao) return 'aprovado';
  if (pareceCorrecao && !pareceAprovado) return 'correcao';
  return null;
}

// Pega todo texto de dentro de tags <w:t ...>...</w:t> (o texto de verdade, dentro do XML
// bruto do .docx — mesmo estilo de manipulacao regex ja usado em projeto-doc-timbrado.js,
// sem trazer um parser de XML novo so pra isso).
function extrairTextoW(xml) {
  return ((xml || '').match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
    .map(t => t.replace(/<w:t[^>]*>/, '').replace(/<\/w:t>/, ''))
    .join('');
}

// Achado real (2026-07-30, projeto "II Jornada de Salud del Hombre"): o Word costuma
// marcar o <w:commentRangeStart>/<w:commentRangeEnd> só em cima de um RÓTULO curto (ex:
// "Descripción del contenido:"), não da frase inteira — o texto que realmente diferencia
// ONDE está o problema ("El primer día...", "El segundo día...") fica no MESMO parágrafo,
// só que fora do trecho marcado. Pegar só o que está entre start/end faz três comentários
// diferentes (dia 1, dia 2, dia 3) mostrarem o mesmo trecho ambíguo "Descripción del
// contenido:" — impossível saber qual corrigir. Por isso agora pegamos o PARÁGRAFO INTEIRO
// que contém a marcação (não só o texto entre as tags) e também o parágrafo ANTERIOR como
// contexto (geralmente tem o título da seção ou o nome do palestrante) — o suficiente pra
// localizar no Word com Ctrl+F sem precisar reabrir o arquivo procurando às cegas.
function extrairParagrafos(docXml) {
  return (docXml || '').split(/(?=<w:p[ >])/).filter(p => /^<w:p[ >]/.test(p));
}

async function extrairComentariosDocx(buffer) {
  try {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(buffer);
    const commentsFile = zip.file('word/comments.xml');
    if (!commentsFile) return [];
    const commentsXml = await commentsFile.async('string');
    const docFile = zip.file('word/document.xml');
    const docXml = docFile ? await docFile.async('string') : '';
    const paragrafos = extrairParagrafos(docXml);

    const comentarios = [];
    const regexComment = /<w:comment\s+([^>]*)>([\s\S]*?)<\/w:comment>/g;
    let m;
    while ((m = regexComment.exec(commentsXml))) {
      const attrs = m[1], corpo = m[2];
      const idM = attrs.match(/w:id="(\d+)"/);
      const authorM = attrs.match(/w:author="([^"]*)"/);
      const texto = extrairTextoW(corpo).trim();
      if (!texto) continue;

      let trecho = '', contexto = '';
      if (idM) {
        const iStart = paragrafos.findIndex(p => p.includes('<w:commentRangeStart w:id="' + idM[1] + '"'));
        if (iStart >= 0) {
          let iEnd = paragrafos.findIndex((p, i) => i >= iStart && p.includes('<w:commentRangeEnd w:id="' + idM[1] + '"'));
          if (iEnd < iStart) iEnd = iStart;
          trecho = paragrafos.slice(iStart, iEnd + 1).map(extrairTextoW).join(' ').trim().slice(0, 300);
          for (let i = iStart - 1; i >= 0 && i >= iStart - 3; i--) {
            const anterior = extrairTextoW(paragrafos[i]).trim();
            if (anterior) { contexto = anterior.slice(0, 200); break; }
          }
        }
      }
      comentarios.push({ autor: authorM ? authorM[1] : '', texto, trecho, contexto });
    }
    return comentarios;
  } catch (e) {
    console.error('[REVISAO EMAIL] erro ao extrair comentarios do docx:', e.message);
    return [];
  }
}

// Baixa cada anexo da resposta e salva no projeto — mesmo INSERT que o upload manual ja
// usava, so que sem usuario (ninguem da liga fez essa acao; veio direto da Coordinación).
// Se for .docx, tambem extrai os comentarios do Word (caixinhas de revisao) — pra
// Ensino/Extensao ver o que precisa corrigir sem abrir o Word so pra achar as caixinhas.
async function anexarArquivosDaResposta(gmail, pool, { messageId, projetoId, anexos }) {
  if (!anexos.length) return;
  const { uploadArquivo } = require('./arquivos');
  for (const a of anexos) {
    try {
      const att = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: a.attachmentId });
      const buffer = base64UrlParaBuffer(att.data.data);
      const r = await uploadArquivo(buffer, a.filename, a.mimeType, 'projetos-docs');

      const ehDocx = /wordprocessingml/.test(a.mimeType || '') || /\.docx$/i.test(a.filename || '');
      const comentarios = ehDocx ? await extrairComentariosDocx(buffer) : [];

      await pool.query(
        'INSERT INTO projetos_anexos (projeto_id,tipo,arquivo_chave,nome_original,mimetype,observacao,enviado_por,comentarios) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [projetoId, 'pedido_correccion', r.chave, a.filename, a.mimeType, 'Anexado automaticamente da resposta da Coordinación', null,
         comentarios.length ? JSON.stringify(comentarios) : null]
      );
    } catch (e) { console.error('[REVISAO EMAIL] erro ao anexar arquivo da resposta:', a.filename, e.message); }
  }
}

// Verifica todas as threads ativas e marca as que têm resposta nova da coordenação.
// authClient: cliente OAuth da liga ; pool: conexão pg ; emailLiga: email oficial (remetente)
async function verificarRespostas(authClient, pool, emailLiga) {
  const gmail = google.gmail({ version: 'v1', auth: authClient });
  const threads = await pool.query('SELECT * FROM projetos_email_thread WHERE gmail_thread_id IS NOT NULL');
  let novas = 0;

  for (const t of threads.rows) {
    try {
      const th = await gmail.users.threads.get({ userId: 'me', id: t.gmail_thread_id, format: 'metadata', metadataHeaders: ['From', 'Date', 'Message-ID'] });
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
        // Resposta nova detectada. Guarda tambem o Message-ID real da coordenação: se nao
        // atualizarmos, o proximo envio nosso (correcao) responderia ao NOSSO ultimo
        // e-mail, nao ao dela — a thread continua correta gracas ao threadId explicito no
        // send, mas o cabecalho In-Reply-To ficaria desatualizado. Sem chave, mantem a
        // anterior (nunca perde a referencia por falta do header).
        const msgIdH = headers.find(h => h.name.toLowerCase() === 'message-id');

        // So agora (resposta nova de verdade) busca a mensagem INTEIRA — o check acima e
        // leve (so metadata) de proposito, pra nao pesar a varredura de 3 em 3 minutos
        // quando nao ha nada novo.
        let resumo = null, sugestao = null;
        try {
          const completa = await gmail.users.messages.get({ userId: 'me', id: ultimaId, format: 'full' });
          const partes = extrairPartesEmail(completa.data.payload);
          const textoBruto = partes.textoPlano || (partes.textoHtml || '').replace(/<[^>]+>/g, ' ');
          resumo = textoBruto.replace(/\s+/g, ' ').trim().slice(0, 500) || null;
          sugestao = classificarResposta(textoBruto);
          if (partes.anexos.length) {
            await anexarArquivosDaResposta(gmail, pool, { messageId: ultimaId, projetoId: t.projeto_id, anexos: partes.anexos });
          }
        } catch (e) { console.error('[REVISAO EMAIL] erro ao ler o conteudo da resposta:', e.message); }

        await pool.query(
          'UPDATE projetos_email_thread SET tem_resposta_nova=true, resposta_em=NOW(), ultima_msg_vista=$1, gmail_message_id=COALESCE($3, gmail_message_id), sugestao_status=$4, resposta_resumo=$5 WHERE id=$2',
          [ultimaId, t.id, msgIdH ? msgIdH.value : null, sugestao, resumo]
        );
        novas++;
      } else if (ehDaLiga) {
        // Última é da liga: atualiza o "visto", limpa flag de resposta e a sugestão antiga
        // (senão a próxima resposta da Coordinación herdaria uma dica que já foi resolvida).
        await pool.query('UPDATE projetos_email_thread SET tem_resposta_nova=false, ultima_msg_vista=$1, sugestao_status=NULL, resposta_resumo=NULL WHERE id=$2',
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

module.exports = { verificarRespostas, projetosComResposta, marcarRespostaVista, extrairComentariosDocx };
