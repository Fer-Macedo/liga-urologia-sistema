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
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    return 'data:' + mime + ';base64,' + buffer.toString('base64');
  } catch(e) { return null; }
}

function gerarHTMLDesligamento(membro, config, data, tipo_membro) {
  const dataFormatada = new Date(data).toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const [dia, mes, ano] = dataFormatada.split('/');
  const timbrado = config.timbrado_b64 || null;
  const presidente = config.assinatura_presidente_b64 || null;
  const secretario = config.assinatura_secretario_b64 || null;
  const tipoMembro = tipo_membro || membro.cargo || 'LIGANTE';
  const catraca = membro.catraca || '___________________';
  const rg = membro.rg || '___________________';
  const cargo = membro.cargo || tipoMembro;
  const nomePresidente = (config.presidente_nome || 'MANUEL FERNANDO MACEDO NETO').toUpperCase();
  const nomeSecretario = (config.secretario_nome || 'KAUÊ TEIXEIRA LACERDA').toUpperCase();

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:210mm; height:297mm; overflow:hidden; }
#timbrado-bg {
  position: fixed;
  top: 0; left: 0;
  width: 210mm;
  height: 297mm;
  z-index: 0;
}
#timbrado-bg img {
  width: 100%;
  height: 100%;
  display: block;
}
#conteudo {
  position: relative;
  z-index: 1;
  width: 210mm;
  min-height: 297mm;
  padding: 55mm 22mm 40mm 22mm;
  font-family: 'Times New Roman', serif;
  font-size: 11pt;
  color: #000;
}
.titulo { text-align:center; font-size:13pt; font-weight:bold; text-transform:uppercase; margin-bottom:25px; }
.corpo { text-align:justify; line-height:1.6; }
.corpo p { margin-bottom:10px; }
.data { text-align:right; margin:20px 0; font-size:11pt; }
.assinaturas { display:flex; justify-content:space-around; margin-top:40px; gap:15px; }
.assinatura-bloco { text-align:center; flex:1; }
.assinatura-img-wrap { height:70px; display:flex; align-items:flex-end; justify-content:center; margin-bottom:4px; }
.assinatura-img { max-height:70px; max-width:160px; object-fit:contain; }
.linha-assinatura { border-top:1.5px solid #000; width:90%; margin:0 auto 5px; }
.assinatura-nome { font-weight:bold; font-size:10pt; text-transform:uppercase; }
.assinatura-cargo { font-size:9pt; margin-top:3px; }
</style>
</head>
<body>

${timbrado ? `<div id="timbrado-bg"><img src="${timbrado}"></div>` : ''}

<div id="conteudo">
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
      <div class="assinatura-nome">${(membro.nome||'').toUpperCase()}</div>
      <div class="assinatura-cargo">${tipoMembro}<br>Estudiante de Medicina – UCP</div>
    </div>
    <div class="assinatura-bloco">
      <div class="assinatura-img-wrap">
        ${presidente ? `<img src="${presidente}" class="assinatura-img">` : ''}
      </div>
      <div class="linha-assinatura"></div>
      <div class="assinatura-nome">${nomePresidente}</div>
      <div class="assinatura-cargo">PRESIDENTE</div>
    </div>
    <div class="assinatura-bloco">
      <div class="assinatura-img-wrap">
        ${secretario ? `<img src="${secretario}" class="assinatura-img">` : ''}
      </div>
      <div class="linha-assinatura"></div>
      <div class="assinatura-nome">${nomeSecretario}</div>
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
