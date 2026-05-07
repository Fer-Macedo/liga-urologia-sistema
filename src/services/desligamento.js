// ─── SERVIÇO DE DESLIGAMENTO — Geração de PDF ────────────────────────────────
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const R2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});
const BUCKET = process.env.R2_BUCKET || 'liga-urologia-files';

// Baixa imagem do R2 e converte para base64
async function imagemBase64(chave) {
  if (!chave) return null;
  try {
    const r = await R2.send(new GetObjectCommand({ Bucket: BUCKET, Key: chave }));
    const chunks = [];
    for await (const chunk of r.Body) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const ext = chave.split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'pdf' ? 'application/pdf' : 'image/jpeg';
    return 'data:' + mime + ';base64,' + buffer.toString('base64');
  } catch(e) {
    console.error('Erro ao carregar imagem:', e.message);
    return null;
  }
}

// Gera HTML do documento de desligamento
function gerarHTMLDesligamento(membro, config, data, tipo_membro) {
  const dataFormatada = new Date(data).toLocaleDateString('es-PY', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
  const [dia, mes, ano] = dataFormatada.split('/');

  // Usa base64 diretamente nas imagens
  const timbradoSrc = config.timbrado_b64 || null;
  const presidenteSrc = config.assinatura_presidente_b64 || null;
  const secretarioSrc = config.assinatura_secretario_b64 || null;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Times New Roman', serif; font-size: 12pt; color: #000; padding: 40px 60px; }
  .timbrado { width: 100%; margin-bottom: 30px; }
  .timbrado img { width: 100%; max-height: 120px; object-fit: contain; }
  .titulo { text-align: center; font-size: 14pt; font-weight: bold; text-transform: uppercase; margin-bottom: 30px; letter-spacing: 1px; }
  .corpo { text-align: justify; line-height: 2; margin-bottom: 30px; }
  .data { text-align: right; margin-bottom: 40px; }
  .assinaturas { margin-top: 60px; }
  .assinatura-bloco { margin-bottom: 50px; text-align: center; }
  .linha-assinatura { border-top: 1px solid #000; width: 80%; margin: 0 auto 8px; }
  .assinatura-img { max-height: 60px; margin-bottom: 4px; }
  .assinatura-nome { font-weight: bold; font-size: 11pt; }
  .assinatura-cargo { font-size: 10pt; }
</style>
</head>
<body>

  <div class="timbrado">
    ${timbradoSrc ? `<img src="${timbradoSrc}" alt="Timbrado">` : `<div style="border:2px solid #000;padding:20px;text-align:center;font-size:16pt;font-weight:bold">${config.org_nome || 'Liga Académica de Urología — LAURO'}</div>`}
  </div>

  <div class="titulo">Carta de Rescisión de la Liga Académica de Urología</div>

  <div class="corpo">
    <p>Yo, <strong>${membro.nome}</strong>, estudiante de Medicina, con CATRACA: <strong>${membro.catraca || '___________'}</strong>, portador del documento de identidad (RG): <strong>${membro.rg || '___________'}</strong>, por medio de la presente, comunico mi decisión de renunciar al cargo de <strong>${membro.cargo || 'LIGANTE'}</strong> de la Liga Académica de Urología - LAURO, con sede en la Universidad Central del Paraguay, en Ciudad del Este - PY, debido a razones personales/profesionales.</p>
    <br>
    <p>Agradezco la oportunidad brindada y la colaboración de todos los miembros de la Liga durante mi tiempo de participación.</p>
    <br>
    <p>Asimismo, reconozco y acepto que, con mi salida de la Liga, no tendré derecho a recibir un certificado de participación como LIGANTE de ésta, conforme a las normativas establecidas por la Coordinación de Ligas.</p>
    <br>
    <p>Sin otro particular, quedo a disposición para formalizar cualquier detalle relacionado con mi salida del cargo.</p>
    <br>
    <p>Atentamente,</p>
  </div>

  <div class="data">Ciudad del Este, ${dia} / ${mes} / ${ano}</div>

  <div class="assinaturas">
    <div class="assinatura-bloco">
      <div class="linha-assinatura"></div>
      <div class="assinatura-nome">${membro.nome}</div>
      <div class="assinatura-cargo">LIGANTE<br>Estudiante de Medicina – Universidad Central del Paraguay</div>
    </div>

    <div class="assinatura-bloco">
      ${presidenteSrc ? `<img src="${presidenteSrc}" class="assinatura-img">` : ''}
      <div class="linha-assinatura"></div>
      <div class="assinatura-nome">${config.presidente_nome || 'MANUEL FERNANDO MACEDO NETO'}</div>
      <div class="assinatura-cargo">PRESIDENTE</div>
    </div>

    <div class="assinatura-bloco">
      ${secretarioSrc ? `<img src="${secretarioSrc}" class="assinatura-img">` : ''}
      <div class="linha-assinatura"></div>
      <div class="assinatura-nome">${config.secretario_nome || 'KAUÊ TEIXEIRA LACERDA'}</div>
      <div class="assinatura-cargo">SECRETÁRIO</div>
    </div>
  </div>

</body>
</html>`;
}

async function getUrlAssinada(chave) {
  if (!chave) return null;
  try {
    return await getSignedUrl(R2, new GetObjectCommand({ Bucket: BUCKET, Key: chave }), { expiresIn: 3600 });
  } catch(e) { return null; }
}

async function uploadBuffer(buffer, chave, contentType) {
  await R2.send(new PutObjectCommand({ Bucket: BUCKET, Key: chave, Body: buffer, ContentType: contentType }));
}

module.exports = { gerarHTMLDesligamento, getUrlAssinada, uploadBuffer, imagemBase64 };
