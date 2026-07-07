// Gera a arte de aniversario (story) sobrepondo foto + nome + cargo na arte-modelo do Canva
const sharp = require('sharp');

// Coordenadas calibradas para o modelo de arte fornecido pela liga (1080x1920, moldura tipo polaroid)
const PHOTO_W = 670, PHOTO_H = 666, PHOTO_ANGLE = -2.1;
const PHOTO_CENTER_X = 561, PHOTO_CENTER_Y = 844;
const NOME_Y = 1330, CARGO_Y = 1433;
const COR_TEXTO = '#004bae';

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
  const fotoRotacionada = await sharp(fotoBuffer)
    .resize(PHOTO_W, PHOTO_H, { fit: 'cover', position: 'attention' })
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

  return sharp(templateBuffer)
    .composite([
      { input: fotoRotacionada, left, top },
      { input: Buffer.from(textoSvg), left: 0, top: 0 }
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}

module.exports = { gerarArteAniversario, nomeCurto };
