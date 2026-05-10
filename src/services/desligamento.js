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

function gerarHTMLDesligamento(membro, config, data, tipo_membro) {
  const dataFormatada = new Date(data).toLocaleDateString('es-PY', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
  const [dia, mes, ano] = dataFormatada.split('/');

  const timbradoSrc = config.timbrado_b64 || null;
  const presidenteSrc = config.assinatura_presidente_b64 || null;
  const secretarioSrc = config.assinatura_secretario_b64 || null;

  const tipoMembro = tipo_membro || membro.cargo || 'LIGANTE';
  const catraca = membro.catraca || '___________________';
  const rg = membro.rg || '___________________';
  const cargo = membro.cargo || tipoMembro;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Times New Roman', serif; font-size: 12pt; color: #000; padding: 40px 60px; position: relative; min-height: 297mm; }
  .titulo { text-align: center; font-size: 14pt; font-weight: bold; text-transform: uppercase; margin-bottom: 30px; letter-spacing: 1px; padding-bottom: 10px; border-bottom: 1px solid #000; }
  .corpo { text-align: justify; line-height: 2; margin-bottom: 20px; }
  .corpo p { margin-bottom: 14px; }
  .data { text-align: right; margin: 30px 0; font-size: 11pt; }
  .assinaturas { margin-top: 50px; display: flex; justify-content: space-around; flex-wrap: wrap; gap: 20px; }
  .assinatura-bloco { text-align: center; min-width: 200px; flex: 1; }
  .assinatura-img-wrap { height: 100px; display: flex; align-items: flex-end; justify-content: center; margin-bottom: 6px; }
  .assinatura-img { max-height: 100px; max-width: 200px; object-fit: contain; }
  .linha-assinatura { border-top: 1.5px solid #000; width: 90%; margin: 0 auto 8px; }
  .assinatura-nome { font-weight: bold; font-size: 11pt; }
  .assinatura-cargo { font-size: 10pt; margin-top: 4px; }
  .espacador { height: 40px; }
</style>
</head>
<body>
  ${timbradoSrc ? `<img src="${timbradoSrc}" style="position:fixed;top:0;left:0;width:100vw;height:100vh;object-fit:cover;z-index:0;pointer-events:none;">` : ''}
  <div style="position:relative;z-index:1">
  <div class="espacador"></div>
  <div class="titulo">Carta de Rescisión de la Liga Académica de Urología</div>
  <div class="corpo">
    <p>Yo, <strong>${membro.nome}</strong>, estudiante de Medicina, con CATRACA: <strong>${catraca}</strong>, portador del documento de identidad (RG): <strong>${rg}</strong>, por medio de la presente, comunico mi decisión de renunciar al cargo de <strong>${cargo}</strong> de la Liga Académica de Urología - LAURO, con sede en la Universidad Central del Paraguay, en Ciudad del Este - PY, debido a razones personales/profesionales.</p>
    <p>Agradezco la oportunidad brindada y la colaboración de todos los miembros de la Liga durante mi tiempo de participación.</p>
    <p>Asimismo, reconozco y acepto que, con mi salida de la Liga, no tendré derecho a recibir un certificado de participación como <strong>${tipoMembro}</strong> de ésta, conforme a las normativas establecidas por la Coordinación de Ligas.</p>
    <p>Sin otro particular, quedo a disposición para formalizar cualquier detalle relacionado con mi salida del cargo.</p>
    <p>Atentamente,</p>
  </div>
  <div class="data">Ciudad del Este, ${dia} / ${mes} / ${ano}</div>
  <div class="assinaturas">
    <div class="assinatura-bloco">
      <div class="assinatura-img-wrap"></div>
      <div class="linha-assinatura"></div>
      <div class="assinatura-nome">${membro.nome}</div>
      <div class="assinatura-cargo">${tipoMembro}<br>Estudiante de Medicina – Universidad Central del Paraguay</div>
    </div>
    <div class="assinatura-bloco">
      <div class="assinatura-img-wrap">
        ${presidenteSrc ? `<img src="${presidenteSrc}" class="assinatura-img">` : ''}
      </div>
      <div class="linha-assinatura"></div>
      <div class="assinatura-nome">${config.presidente_nome || 'MANUEL FERNANDO MACEDO NETO'}</div>
      <div class="assinatura-cargo">PRESIDENTE</div>
    </div>
    <div class="assinatura-bloco">
      <div class="assinatura-img-wrap">
        ${secretarioSrc ? `<img src="${secretarioSrc}" class="assinatura-img">` : ''}
      </div>
      <div class="linha-assinatura"></div>
      <div class="assinatura-nome">${config.secretario_nome || 'KAUÊ TEIXEIRA LACERDA'}</div>
      <div class="assinatura-cargo">SECRETÁRIO</div>
    </div>
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
