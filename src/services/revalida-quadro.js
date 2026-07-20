// Momento Revalida Brasil — quadro fixo dos stories, 2x por semana.
//
// A API do Instagram nao cria enquete (adesivo so existe no app), entao este quadro
// NAO publica sozinho: gera as duas artes, manda por e-mail para marketing/presidencia/
// admin as 6h e a equipe publica pelo app encaixando a enquete no espaco reservado.
// Mesmo padrao do lembrete de aniversario (aniversario-lembrete.js).
//
// As questoes sao reais do Revalida (INEP) e so entram com GABARITO DEFINITIVO —
// questoes anuladas ficam de fora, e gabarito preliminar tambem (muda apos recursos).
const path = require('path');
const { query } = require('../models/database');

const RAIZ = path.join(__dirname, '..', '..');
const TINTA = '#0C2340', VERDE = '#17A34A';

function b64(rel, mime = 'image/png') {
  const fs = require('fs');
  return `data:${mime};base64,` + fs.readFileSync(path.join(RAIZ, rel)).toString('base64');
}

// ─── ARTE ─────────────────────────────────────────────────────────────────────
// Layout aprovado pela presidencia em 2026-07-19. O espaco da enquete tem 690x640,
// medido no aparelho: o adesivo real de 4 opcoes ocupa ~655x609 em 1080x1920. O espaco
// e vazio de proposito — nao desenhar moldura, ela aparece em volta do adesivo.
function estiloBase() {
  return `
 *{margin:0;padding:0;box-sizing:border-box}
 body{width:1080px;height:1920px;background:${TINTA};font-family:'Barlow',sans-serif;color:#fff;position:relative;overflow:hidden}
 .topo{position:absolute;top:76px;left:70px;right:70px;display:flex;flex-direction:column;align-items:center;gap:15px;text-align:center}
 .selo{width:170px;height:170px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0}
 .selo img{width:158px;height:158px;object-fit:contain}
 .quadro{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:41px;letter-spacing:3px;line-height:1.0;text-align:center}
 .quadro em{font-style:normal;display:block;color:${VERDE};font-size:41px;letter-spacing:3px}
 .quadro span{display:block;font-size:21px;font-weight:600;letter-spacing:4px;color:${VERDE};margin-top:5px}
 .risco{position:absolute;top:444px;left:50%;transform:translateX(-50%);width:84px;height:6px;background:${VERDE}}
 .fonte{position:absolute;bottom:168px;left:70px;right:70px;font-size:22px;color:#8AA0BE;font-weight:500;text-align:center}
 .pe{position:absolute;bottom:64px;left:70px;right:70px;display:flex;align-items:center;justify-content:space-between}
 .pe .ar{display:flex;align-items:center;gap:14px;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:36px;letter-spacing:1.2px}
 .pe .ar svg{width:40px;height:40px;flex-shrink:0}
 .pe .ucp{width:92px;height:92px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center}
 .pe .ucp img{width:84px;height:84px;object-fit:contain}`;
}

const ICONE_IG = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="#fff" stroke="none"/></svg>';

function cabecalho(lauro, sub) {
  return `<div class="topo"><div class="selo"><img src="${lauro}"></div>
 <div class="quadro">MOMENTO REVALIDA<em>BRASIL</em><span>${sub}</span></div></div><div class="risco"></div>`;
}
function rodape(ucp, fonte) {
  return `<div class="fonte">${fonte}</div><div class="pe">
 <div class="ar">${ICONE_IG}lauroucp.cde</div><div class="ucp"><img src="${ucp}"></div></div>`;
}
function cabeca() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">`;
}

function htmlPergunta(q, lauro, ucp) {
  const paragrafos = String(q.caso).split('\n').filter(Boolean).map(p => `<p>${p}</p>`).join('');
  return `${cabeca()}<style>${estiloBase()}
 .corpo{position:absolute;top:492px;bottom:216px;left:70px;right:70px;display:flex;flex-direction:column}
 .caso{font-size:31px;line-height:1.38;color:#E3EBF5}
 .caso p{margin-bottom:17px}
 .caso p:last-child{margin-bottom:0}
 .caso b{color:#fff;font-weight:600}
 .alts{margin-top:24px;display:flex;flex-direction:column;gap:10px}
 .alt{display:flex;gap:15px;align-items:flex-start;background:rgba(255,255,255,.07);border-left:5px solid ${VERDE};
      border-radius:0 10px 10px 0;padding:13px 18px}
 .alt .l{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:31px;color:${VERDE};flex-shrink:0;line-height:1.15}
 .alt .t{font-size:29px;line-height:1.3;color:#EAF0F7}
 /* Espaco reservado para a enquete: INVISIVEL de proposito. A moldura tracejada que
    ficava aqui aparecia em volta do adesivo na hora de publicar e ficava feia. A area
    continua reservada; o centro e dado pela linha da fonte, logo abaixo. */
 .slot{margin-top:52px;align-self:center;width:690px;height:640px}
</style></head><body>
 ${cabecalho(lauro, 'QUESTÃO COMENTADA · UROLOGIA')}
 <div class="corpo">
   <div class="caso">${paragrafos}</div>
   <div class="alts">${q.alternativas.map(a => `<div class="alt"><div class="l">${a.letra}</div><div class="t">${a.texto}</div></div>`).join('')}</div>
   <div class="slot"></div>
 </div>
 ${rodape(ucp, q.fonte)}
</body></html>`;
}

function htmlResposta(q, lauro, ucp) {
  const certa = q.alternativas.find(a => a.letra === q.gabarito) || { texto: '' };
  const erradas = q.alternativas.filter(a => a.letra !== q.gabarito);
  return `${cabeca()}<style>${estiloBase()}
 .corpoR{position:absolute;top:492px;bottom:216px;left:70px;right:70px;display:flex;flex-direction:column}
 .rotulo{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:29px;letter-spacing:2.6px;color:${VERDE};margin-bottom:14px}
 .certa{background:${VERDE};border-radius:14px;padding:26px 30px;display:flex;gap:22px;align-items:center}
 .certa .l{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:96px;line-height:.85}
 .certa .t{font-size:33px;line-height:1.3;font-weight:600}
 .porque{margin-top:38px}
 .porque h3{font-family:'Barlow Condensed',sans-serif;font-size:27px;letter-spacing:3.5px;color:${VERDE};margin-bottom:14px}
 .porque p{font-size:33px;line-height:1.45;color:#E3EBF5}
 .porque p b{color:#fff;font-weight:600}
 .peg{margin-top:26px;background:rgba(234,179,8,.12);border-left:6px solid #eab308;border-radius:0 10px 10px 0;padding:20px 24px}
 .peg b.tit{display:block;font-family:'Barlow Condensed',sans-serif;font-size:24px;letter-spacing:3px;color:#eab308;margin-bottom:9px}
 .peg span{font-size:30px;line-height:1.38;color:#EAF0F7}
 .peg span b{color:#fff;font-weight:600}
 .erradas{margin-top:auto;display:flex;flex-direction:column;gap:12px}
 .err{background:rgba(255,255,255,.06);border-left:5px solid #64748b;border-radius:0 10px 10px 0;padding:15px 19px;display:flex;gap:14px}
 .err .l{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:29px;color:#94a3b8;flex-shrink:0}
 .err .t{font-size:29px;line-height:1.32;color:#CBD5E1}
 .rev{margin-top:26px;font-size:22px;color:#8FA6C4;line-height:1.4;border-top:1px solid rgba(255,255,255,.14);padding-top:16px}
</style></head><body>
 ${cabecalho(lauro, 'A RESPOSTA')}
 <div class="corpoR">
   <div class="rotulo">A RESPOSTA DA QUESTÃO ANTERIOR É:</div>
   <div class="certa"><div class="l">${q.gabarito}</div><div class="t">${certa.texto}</div></div>
   <div class="porque"><h3>POR QUE</h3><p>${q.porque}</p></div>
   ${q.pegadinha ? `<div class="peg"><b class="tit">A PEGADINHA</b><span>${q.pegadinha}</span></div>` : ''}
   <div class="erradas">${erradas.map(a => `<div class="err"><div class="l">${a.letra}</div><div class="t">${(q.distratores || {})[a.letra] || ''}</div></div>`).join('')}</div>
   <div class="rev">Conteúdo clínico revisado pela orientação médica da LAURO antes da publicação.</div>
 </div>
 ${rodape(ucp, q.fonte + ' · gabarito oficial definitivo: ' + q.gabarito)}
</body></html>`;
}

async function gerarArtes(q) {
  const puppeteer = require('puppeteer');
  const chromium = require('@sparticuz/chromium');
  const lauro = b64('public/img/logo-lauro-oficial.png');
  const ucp = b64('public/desafio-azul/img/Copia de LOGO - MEDICINA 01.png');
  const navegador = await puppeteer.launch({
    args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    executablePath: await chromium.executablePath(), headless: 'new'
  });
  try {
    const pagina = await navegador.newPage();
    await pagina.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 2 });
    const artes = {};
    for (const [nome, html] of [['pergunta', htmlPergunta(q, lauro, ucp)], ['resposta', htmlResposta(q, lauro, ucp)]]) {
      await pagina.setContent(html, { waitUntil: 'networkidle0' });
      artes[nome] = await pagina.screenshot({ type: 'png' });
    }
    return artes;
  } finally { await navegador.close(); }
}

// ─── ENVIO ────────────────────────────────────────────────────────────────────
// A ordem da fila segue o eixo tematico do mes (ver marketing-cronograma.js). Em julho
// de 2026 as primeiras sao de hematuria e cancer de bexiga, para conversar com a campanha
// "Julio Morado" que a liga publicou em 19/07 — conteudo solto parece falta de linha
// editorial. Para mudar a ordem, basta atualizar a coluna `ordem`.
async function proximaQuestao() {
  const r = await query(
    "SELECT * FROM revalida_questoes WHERE status='aprovada' AND enviado_em IS NULL ORDER BY ordem, id LIMIT 1"
  );
  return r.rows[0] || null;
}

function corpoEmail(q) {
  const alts = q.alternativas.map(a => `<tr><td style="padding:4px 10px 4px 0;font-weight:700">${a.letra}</td><td style="padding:4px 0">${a.texto}</td></tr>`).join('');
  return `
<p>Bom dia! Hoje sai o <strong>Momento Revalida Brasil</strong>. As duas artes estão anexadas.</p>

<p><strong>Como publicar</strong></p>
<ol>
  <li>Publique o story <em>revalida-pergunta.png</em>.</li>
  <li>Adicione a <strong>enquete</strong> e encaixe na moldura tracejada.</li>
  <li>Digite as opções: <strong>A</strong>, <strong>B</strong>, <strong>C</strong> e <strong>D</strong>.</li>
  <li>Algumas horas depois, publique <em>revalida-resposta.png</em>.</li>
</ol>

<p><strong>Questão</strong> — ${q.fonte}</p>
<table style="border-collapse:collapse;font-size:14px">${alts}</table>

<p style="margin-top:14px"><strong>Resposta correta: ${q.gabarito}</strong> (gabarito oficial do INEP)</p>

<p><strong>Legenda sugerida para o story da pergunta</strong><br>
<em>${q.legenda || 'Sabe responder? Vota aí 👇 A resposta sai no próximo story.'}</em></p>

<p style="color:#64748b;font-size:13px;margin-top:18px">
Conteúdo clínico revisado pela orientação médica da liga. Se identificar qualquer
imprecisão, <strong>não publique</strong> e avise antes.</p>`;
}

async function enviarQuadroRevalida() {
  const q = await proximaQuestao();
  if (!q) { console.log('[REVALIDA] Nenhuma questão aprovada na fila — nada enviado.'); return { ok: false, motivo: 'fila vazia' }; }

  const destinatarios = await query(
    `SELECT DISTINCT u.email FROM usuarios u
     LEFT JOIN usuario_permissoes p ON p.usuario_id=u.id AND p.modulo='marketing'
     WHERE u.ativo=1 AND u.email IS NOT NULL AND u.email <> ''
       AND (u.perfil IN ('admin','presidencia','marketing') OR p.id IS NOT NULL)`
  );
  if (!destinatarios.rows.length) { console.warn('[REVALIDA] Sem destinatários — envio abortado.'); return { ok: false, motivo: 'sem destinatários' }; }

  const artes = await gerarArtes(q);
  const { enviarEmail } = require('./notificacoes');
  const anexos = [
    { filename: 'revalida-pergunta.png', content: artes.pergunta, contentType: 'image/png' },
    { filename: 'revalida-resposta.png', content: artes.resposta, contentType: 'image/png' }
  ];

  let enviados = 0;
  for (const d of destinatarios.rows) {
    const r = await enviarEmail({
      para: d.email,
      assunto: `Momento Revalida Brasil — publicar hoje (${q.fonte})`,
      html: corpoEmail(q),
      anexos
    }).catch(e => ({ ok: false, erro: e.message }));
    if (r && r.ok) enviados++;
  }

  await query('UPDATE revalida_questoes SET enviado_em=NOW() WHERE id=$1', [q.id]);
  console.log(`[REVALIDA] Questão ${q.id} (${q.fonte}) enviada para ${enviados}/${destinatarios.rows.length} destinatários.`);
  return { ok: enviados > 0, enviados, questao: q.id };
}


// ─── OPERACAO PELA TELA ───────────────────────────────────────────────────────
// O quadro e hibrido: o sistema manda as artes por e-mail e a equipe publica pelo app.
// Sem estas funcoes a fila era invisivel — ninguem via o que ia sair, o que ja saiu, nem
// se alguem chegou a publicar.
async function listarFila() {
  const r = await query(
    `SELECT id, ordem, fonte, gabarito, status,
            to_char(enviado_em,'DD/MM HH24:MI') AS enviado,
            to_char(publicado_em,'DD/MM HH24:MI') AS publicado,
            aprovado_por, publicado_por
     FROM revalida_questoes ORDER BY ordem, id`
  );
  return r.rows;
}

async function definirStatus(id, status, usuario) {
  if (!['rascunho', 'aprovada'].includes(status)) return { ok: false, erro: 'Status inválido.' };
  await query('UPDATE revalida_questoes SET status=$1, aprovado_por=$2 WHERE id=$3',
    [status, status === 'aprovada' ? usuario : null, id]);
  return { ok: true };
}

// Confirmacao manual: quem publicou pelo app marca aqui, senao nao existe registro de
// que a peca foi ao ar — o sistema so sabe que mandou o e-mail.
async function marcarPublicado(id, usuario) {
  await query('UPDATE revalida_questoes SET publicado_em=NOW(), publicado_por=$1 WHERE id=$2', [usuario, id]);
  return { ok: true };
}

async function questaoPorId(id) {
  const r = await query('SELECT * FROM revalida_questoes WHERE id=$1', [id]);
  return r.rows[0] || null;
}

module.exports = { gerarArtes, enviarQuadroRevalida, proximaQuestao, listarFila, definirStatus, marcarPublicado, questaoPorId };
