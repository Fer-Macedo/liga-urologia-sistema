// Gera a arte de aniversario (story) sobrepondo foto + nome + cargo na arte-modelo do Canva
const sharp = require('sharp');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

// Coordenadas calibradas para o modelo de arte fornecido pela liga (1080x1920, moldura tipo polaroid)
const PHOTO_W = 670, PHOTO_H = 666, PHOTO_ANGLE = -2.1;
const PHOTO_CENTER_X = 561, PHOTO_CENTER_Y = 844;
const NOME_Y = 1330, CARGO_Y = 1433;
const COR_TEXTO = '#004bae';

// Recorte do balao dourado que, no design original, fica NA FRENTE da foto (moldura da liga)
const BALAO_OVERLAY_PATH = path.join(__dirname, '..', 'assets', 'aniversario-balao-overlay.png');
const BALAO_X = 40, BALAO_Y = 380;

// Usa o Claude (vision) para localizar o centro do rosto na foto, evitando cortar a cabeca
// ao recortar para o formato quadrado da moldura. Se falhar, cai num centro levemente acima do meio.
async function detectarCentroRosto(fotoBuffer) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { x_pct: 50, y_pct: 35 };
  try {
    const pequena = await sharp(fotoBuffer).resize(400, 400, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
    const resp = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-5',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: pequena.toString('base64') } },
          { type: 'text', text: 'Responda APENAS com um JSON, sem nenhum texto adicional, no formato {"x_pct":NUMERO,"y_pct":NUMERO} indicando o centro do ROSTO da pessoa principal da foto, em percentual (0 a 100) da largura (x_pct) e altura (y_pct) da imagem.' }
        ]
      }]
    }, {
      headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': apiKey },
      timeout: 20000
    });
    const texto = resp.data.content?.[0]?.text || '';
    const match = texto.match(/\{[^}]+\}/);
    if (!match) return { x_pct: 50, y_pct: 35 };
    const json = JSON.parse(match[0]);
    const x_pct = Math.min(100, Math.max(0, Number(json.x_pct)));
    const y_pct = Math.min(100, Math.max(0, Number(json.y_pct)));
    if (isNaN(x_pct) || isNaN(y_pct)) return { x_pct: 50, y_pct: 35 };
    return { x_pct, y_pct };
  } catch (e) {
    console.error('detectarCentroRosto erro:', e.message);
    return { x_pct: 50, y_pct: 35 };
  }
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Nomes completos longos estouram a largura da arte - reduz o tamanho da fonte
// proporcionalmente ao numero de caracteres para sempre caber em uma linha.
function tamanhoFonteNome(nome) {
  const len = nome.length;
  if (len <= 16) return 64;
  if (len <= 24) return 52;
  if (len <= 32) return 42;
  return 34;
}

// Primeiro + ultimo nome (evita nomes completos gigantes quando nao ha override manual)
function nomeCurto(nomeCompleto) {
  const partes = String(nomeCompleto).trim().split(/\s+/);
  if (partes.length <= 2) return nomeCompleto;
  return `${partes[0]} ${partes[partes.length - 1]}`;
}

async function gerarArteAniversario({ templateBuffer, fotoBuffer, nome, cargo }) {
  const { x_pct, y_pct } = await detectarCentroRosto(fotoBuffer);

  const fotoMetaOriginal = await sharp(fotoBuffer).metadata();
  const W = fotoMetaOriginal.width, H = fotoMetaOriginal.height;
  const ar = PHOTO_W / PHOTO_H;
  let cropW, cropH;
  if (W / H > ar) { cropH = H; cropW = Math.round(cropH * ar); }
  else { cropW = W; cropH = Math.round(cropW / ar); }
  const cx = (x_pct / 100) * W, cy = (y_pct / 100) * H;
  const left0 = Math.min(Math.max(Math.round(cx - cropW / 2), 0), W - cropW);
  const top0 = Math.min(Math.max(Math.round(cy - cropH / 2), 0), H - cropH);

  const fotoRotacionada = await sharp(fotoBuffer)
    .extract({ left: left0, top: top0, width: cropW, height: cropH })
    .resize(PHOTO_W, PHOTO_H, { fit: 'cover' })
    .rotate(PHOTO_ANGLE, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const fotoMeta = await sharp(fotoRotacionada).metadata();
  const left = Math.round(PHOTO_CENTER_X - fotoMeta.width / 2);
  const top = Math.round(PHOTO_CENTER_Y - fotoMeta.height / 2);

  const fonteNome = tamanhoFonteNome(nome);
  const textoSvg = `<svg width="1080" height="1920">
    <text x="540" y="${NOME_Y}" font-family="Arial, sans-serif" font-weight="800" font-size="${fonteNome}" fill="${COR_TEXTO}" text-anchor="middle">${escapeXml(nome)}</text>
    <text x="540" y="${CARGO_Y}" font-family="Arial, sans-serif" font-weight="700" font-size="30" fill="${COR_TEXTO}" text-anchor="middle">${escapeXml(cargo)}</text>
  </svg>`;
  const balaoOverlay = fs.readFileSync(BALAO_OVERLAY_PATH);

  return sharp(templateBuffer)
    .composite([
      { input: fotoRotacionada, left, top },
      { input: balaoOverlay, left: BALAO_X, top: BALAO_Y },
      { input: Buffer.from(textoSvg), left: 0, top: 0 }
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}

module.exports = { gerarArteAniversario, nomeCurto };
