// Arte editorial do Instagram — carrossel (1080x1350) e story (1080x1920).
//
// Identidade institucional da LAURO: navy + verde, logo oficial, assinatura fixa. Peca de
// CAMPANHA usa a cor da campanha (ver carrossel do Julio Morado); peca editorial do dia a
// dia usa a cor institucional. Assim o feed fica coeso sem parecer que tudo e campanha.
//
// Todo texto que vai ao ar e em ESPANHOL (regra da universidade). Unica excecao no perfil
// e o quadro "Momento Revalida Brasil", que tem gerador proprio em revalida-quadro.js.
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const TINTA = '#0C2340', VERDE = '#17A34A';

function b64(rel, mime = 'image/png') {
  const fs = require('fs');
  return `data:${mime};base64,` + fs.readFileSync(path.join(RAIZ, rel)).toString('base64');
}

const ICONE_IG = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="#fff" stroke="none"/></svg>';

function fontes() {
  return `<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">`;
}

// ─── CARROSSEL 1080x1350 ──────────────────────────────────────────────────────
function htmlSlide(s, total, lauro, ucp) {
  const capa = s.capa;
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${fontes()}<style>
 *{margin:0;padding:0;box-sizing:border-box}
 body{width:1080px;height:1350px;background:${TINTA};font-family:'Barlow',sans-serif;color:#fff;position:relative;overflow:hidden}
 .selo{position:absolute;top:56px;${capa ? 'left:50%;transform:translateX(-50%)' : 'left:64px'};width:${capa ? 148 : 104}px;height:${capa ? 148 : 104}px;
       border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center}
 .selo img{width:${capa ? 137 : 96}px;height:${capa ? 137 : 96}px;object-fit:contain}
 .num{position:absolute;top:72px;right:64px;font-family:'Barlow Condensed',sans-serif;font-weight:700;
      font-size:28px;color:rgba(255,255,255,.5);letter-spacing:2px}
 .corpo{position:absolute;left:64px;right:64px;top:${capa ? 260 : 210}px;bottom:170px;display:flex;flex-direction:column;
        justify-content:${capa ? 'center' : 'flex-start'};text-align:${capa ? 'center' : 'left'}}
 .cap{font-family:'Barlow Condensed',sans-serif;font-weight:600;font-size:27px;letter-spacing:4px;
      text-transform:uppercase;color:${VERDE};margin-bottom:16px}
 h1{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:${capa ? 92 : 70}px;line-height:1.0;letter-spacing:-.5px}
 h1 em{font-style:normal;color:${VERDE};display:block}
 p{margin-top:24px;font-size:34px;line-height:1.45;color:#E3EBF5}
 p b{font-weight:600;color:#fff}
 .marca{position:absolute;left:64px;right:64px;bottom:64px;display:flex;align-items:center;justify-content:space-between}
 .marca .ar{display:flex;align-items:center;gap:12px;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:30px;letter-spacing:1px}
 .marca .ar svg{width:34px;height:34px;flex-shrink:0}
 .marca .ucp{width:78px;height:78px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center}
 .marca .ucp img{width:70px;height:70px;object-fit:contain}
</style></head><body>
 <div class="selo"><img src="${lauro}"></div>
 ${s.n ? `<div class="num">${s.n}/${total}</div>` : ''}
 <div class="corpo">
   ${s.cap ? `<div class="cap">${s.cap}</div>` : ''}
   <h1>${s.titulo}</h1>
   ${s.texto ? `<p>${s.texto}</p>` : ''}
 </div>
 <div class="marca">
   <div class="ar">${ICONE_IG}lauroucp.cde</div>
   <div class="ucp"><img src="${ucp}"></div>
 </div>
</body></html>`;
}

// ─── STORY 1080x1920 ──────────────────────────────────────────────────────────
function htmlStory(s, lauro, ucp) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${fontes()}<style>
 *{margin:0;padding:0;box-sizing:border-box}
 body{width:1080px;height:1920px;background:${TINTA};font-family:'Barlow',sans-serif;color:#fff;position:relative;overflow:hidden}
 .topo{position:absolute;top:150px;left:70px;right:70px;display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center}
 .selo{width:158px;height:158px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center}
 .selo img{width:146px;height:146px;object-fit:contain}
 .cap{font-family:'Barlow Condensed',sans-serif;font-weight:600;font-size:26px;letter-spacing:4px;text-transform:uppercase;color:${VERDE}}
 .corpo{position:absolute;left:70px;right:70px;top:520px;bottom:230px;display:flex;flex-direction:column;justify-content:center}
 h1{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:82px;line-height:1.02;letter-spacing:-.5px}
 h1 em{font-style:normal;color:${VERDE};display:block}
 p{margin-top:32px;font-size:36px;line-height:1.5;color:#E3EBF5}
 p b{font-weight:600;color:#fff}
 .nota{margin-top:34px;background:rgba(23,163,74,.12);border-left:6px solid ${VERDE};border-radius:0 10px 10px 0;padding:22px 26px}
 .nota span{font-size:30px;line-height:1.42;color:#EAF0F7}
 .nota span b{color:#fff;font-weight:600}
 .marca{position:absolute;left:70px;right:70px;bottom:80px;display:flex;align-items:center;justify-content:space-between}
 .marca .ar{display:flex;align-items:center;gap:13px;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:34px;letter-spacing:1px}
 .marca .ar svg{width:38px;height:38px;flex-shrink:0}
 .marca .ucp{width:86px;height:86px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center}
 .marca .ucp img{width:78px;height:78px;object-fit:contain}
</style></head><body>
 <div class="topo"><div class="selo"><img src="${lauro}"></div>${s.cap ? `<div class="cap">${s.cap}</div>` : ''}</div>
 <div class="corpo">
   <h1>${s.titulo}</h1>
   ${s.texto ? `<p>${s.texto}</p>` : ''}
   ${s.nota ? `<div class="nota"><span>${s.nota}</span></div>` : ''}
 </div>
 <div class="marca">
   <div class="ar">${ICONE_IG}lauroucp.cde</div>
   <div class="ucp"><img src="${ucp}"></div>
 </div>
</body></html>`;
}

// `peca` = { tipo: 'carrossel'|'story', slides: [...] }  → devolve array de Buffers PNG
async function gerarArte(peca) {
  const puppeteer = require('puppeteer');
  const chromium = require('@sparticuz/chromium');
  const lauro = b64('public/img/logo-lauro-oficial.png');
  const ucp = b64('public/desafio-azul/img/Copia de LOGO - MEDICINA 01.png');
  const carrossel = peca.tipo === 'carrossel';

  const navegador = await puppeteer.launch({
    args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    executablePath: await chromium.executablePath(), headless: 'new'
  });
  try {
    const pagina = await navegador.newPage();
    await pagina.setViewport({ width: 1080, height: carrossel ? 1350 : 1920, deviceScaleFactor: 2 });
    const imagens = [];
    for (const s of peca.slides) {
      const html = carrossel ? htmlSlide(s, peca.slides.length, lauro, ucp) : htmlStory(s, lauro, ucp);
      await pagina.setContent(html, { waitUntil: 'networkidle0' });
      imagens.push(await pagina.screenshot({ type: 'png' }));
    }
    return imagens;
  } finally { await navegador.close(); }
}

module.exports = { gerarArte };
