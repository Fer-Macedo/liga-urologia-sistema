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
  if (mimetype.startsWith('image/')) return '🖼️';
  if (mimetype.startsWith('video/')) return '🎬';
  if (mimetype === 'application/pdf') return '📄';
  if (mimetype.includes('word') || mimetype.includes('document')) return '📝';
  if (mimetype.includes('excel') || mimetype.includes('spreadsheet') || mimetype === 'text/csv') return '📊';
  if (mimetype.includes('powerpoint') || mimetype.includes('presentation')) return '📑';
  return '📁';
}

async function uploadArquivo(buffer, nomeOriginal, mimetype, pasta) {
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

module.exports = { upload, uploadArquivo, deletarArquivo, gerarUrlDownload, listarArquivos, iconeArquivo, categoriaArquivo };
