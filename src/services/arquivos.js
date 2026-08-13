// ─── MÓDULO DE ARQUIVOS — Cloudflare R2 ──────────────────────────────────────
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const R2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

const BUCKET = process.env.R2_BUCKET || 'liga-urologia-files';

// Tipos permitidos
const TIPOS_PERMITIDOS = [
  'image/jpeg','image/png','image/gif','image/webp',
  'application/pdf',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'video/mp4','video/mpeg','video/quicktime','video/x-msvideo',
  'text/plain','text/csv'
];

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    if (TIPOS_PERMITIDOS.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Tipo de arquivo não permitido'));
  }
});

function categoriaArquivo(mimetype) {
  if (mimetype.startsWith('image/')) return 'fotos';
  if (mimetype.startsWith('video/')) return 'videos';
  if (mimetype === 'application/pdf') return 'pdfs';
  if (mimetype.includes('word') || mimetype.includes('document')) return 'documentos';
  if (mimetype.includes('excel') || mimetype.includes('spreadsheet') || mimetype === 'text/csv') return 'planilhas';
  if (mimetype.includes('powerpoint') || mimetype.includes('presentation')) return 'apresentacoes';
  return 'outros';
}

function iconeArquivo(mimetype) {
  if (mimetype.startsWith('image/')) return '';
  if (mimetype.startsWith('video/')) return '';
  if (mimetype === 'application/pdf') return '';
  if (mimetype.includes('word') || mimetype.includes('document')) return '';
  if (mimetype.includes('excel') || mimetype.includes('spreadsheet') || mimetype === 'text/csv') return '';
  if (mimetype.includes('powerpoint') || mimetype.includes('presentation')) return '';
  return '';
}

// ─── ASSINATURA REAL DO ARQUIVO (magic bytes) ────────────────────────────────
// file.mimetype vem do navegador — o cliente escolhe o que quiser (um .exe
// renomeado pra .jpg passa pelo fileFilter tranquilo). Confere os primeiros
// bytes do conteúdo de verdade contra a assinatura conhecida da família de
// formato. text/plain e text/csv não têm assinatura (são texto livre) —
// ficam de fora dessa checagem, protegidos só pelo fileFilter de mimetype.
function assinaturaValida(buffer, mimetype) {
  if (!buffer || buffer.length < 4) return false;
  const b = buffer;
  if (mimetype === 'image/jpeg') return b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
  if (mimetype === 'image/png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
  if (mimetype === 'image/gif') return b.slice(0, 3).toString('ascii') === 'GIF';
  if (mimetype === 'image/webp') return b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP';
  if (mimetype === 'application/pdf') return b.slice(0, 4).toString('ascii') === '%PDF';
  if (mimetype === 'application/msword' || mimetype === 'application/vnd.ms-excel' || mimetype === 'application/vnd.ms-powerpoint') {
    return b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0; // OLE2 (formato legado do Office)
  }
  if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimetype === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    return b[0] === 0x50 && b[1] === 0x4B; // docx/xlsx/pptx são ZIP por dentro
  }
  if (mimetype === 'video/mp4' || mimetype === 'video/quicktime') return b.slice(4, 8).toString('ascii') === 'ftyp';
  if (mimetype === 'video/x-msvideo') return b.slice(0, 4).toString('ascii') === 'RIFF';
  if (mimetype === 'video/mpeg') return b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01;
  return true; // text/plain, text/csv e qualquer tipo sem assinatura conhecida
}

async function uploadArquivo(buffer, nomeOriginal, mimetype, pasta) {
  if (!assinaturaValida(buffer, mimetype)) {
    throw new Error('O conteúdo do arquivo não corresponde ao tipo informado.');
  }
  const ext = path.extname(nomeOriginal);
  const hash = crypto.randomBytes(8).toString('hex');
  const categoria = pasta || categoriaArquivo(mimetype);
  const chave = `${categoria}/${Date.now()}-${hash}${ext}`;

  await R2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: chave,
    Body: buffer,
    ContentType: mimetype,
    Metadata: { nome_original: encodeURIComponent(nomeOriginal) }
  }));

  return { chave, categoria, nome_original: nomeOriginal, mimetype, tamanho: buffer.length };
}

async function deletarArquivo(chave) {
  await R2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: chave }));
}

async function gerarUrlDownload(chave, nomeOriginal) {
  const cmd = new GetObjectCommand({
    Bucket: BUCKET,
    Key: chave,
    ResponseContentDisposition: `attachment; filename="${encodeURIComponent(nomeOriginal)}"`
  });
  return getSignedUrl(R2, cmd, { expiresIn: 3600 });
}

async function listarArquivos(prefixo) {
  const r = await R2.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefixo || ''
  }));
  return r.Contents || [];
}

async function gerarUrlInline(chave, mimetype) {
  const cmd = new GetObjectCommand({
    Bucket: BUCKET, Key: chave,
    ResponseContentDisposition: 'inline',
    ...(mimetype ? { ResponseContentType: mimetype } : {})
  });
  return getSignedUrl(R2, cmd, { expiresIn: 86400 });
}

async function gerarUrlTemporaria(chave, expiresIn) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: chave });
  return getSignedUrl(R2, cmd, { expiresIn: expiresIn || 300 });
}

async function baixarArquivoBuffer(chave) {
  const r = await R2.send(new GetObjectCommand({ Bucket: BUCKET, Key: chave }));
  const chunks = [];
  for await (const chunk of r.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Sobrepõe uma marca d'água (PNG com fundo transparente) no canto inferior direito da imagem
async function aplicarMarcaDagua(buffer, marcaChave) {
  if (!marcaChave) return buffer;
  try {
    const sharp = require('sharp');
    const marcaBuf = await baixarArquivoBuffer(marcaChave);
    const img = sharp(buffer).rotate();
    const meta = await img.metadata();
    const larguraMarca = Math.round((meta.width || 1200) * 0.22);
    const marcaResized = await sharp(marcaBuf).resize({ width: larguraMarca }).toBuffer();
    return await img.composite([{ input: marcaResized, gravity: 'southeast' }]).jpeg({ quality: 90 }).toBuffer();
  } catch (e) {
    console.error('Erro ao aplicar marca dagua:', e.message);
    return buffer;
  }
}

module.exports = { upload, uploadArquivo, deletarArquivo, gerarUrlDownload, listarArquivos, iconeArquivo, categoriaArquivo, gerarUrlInline, gerarUrlTemporaria, baixarArquivoBuffer, aplicarMarcaDagua, getSignedDownloadUrl: gerarUrlInline, assinaturaValida };
