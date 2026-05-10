// ─── SERVIÇO DE DESLIGAMENTO ─────────────────────────────────────────────────
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
  const nomeCompleto = (membro.nome || '').toUpperCase();
  const presidente = (config.presidente_nome || 'MANUEL FERNANDO MACEDO NETO').toUpperCase();
  const secretario = (config.secretario_nome || 'KAUÊ TEIXEIRA LACERDA').toUpperCase();

  // Logo LAURO SVG inline
  const logoLauro = `<svg width="90" height="90" viewBox="0 0 90 90" xmlns="http://www.w3.org/2000/svg">
    <circle cx="45" cy="45" r="43" fill="none" stroke="#1a3d2b" stroke-width="3"/>
    <circle cx="45" cy="45" r="36" fill="#1a3d2b"/>
    <text x="45" y="20" text-anchor="middle" fill="#2e8b7a" font-size="7" font-family="Arial" font-weight="bold">LIGA ACADÊMICA DE</text>
    <text x="45" y="72" text-anchor="middle" fill="#2e8b7a" font-size="7" font-family="Arial" font-weight="bold">UROLOGÍA • UCP •</text>
    <text x="45" y="50" text-anchor="middle" fill="white" font-size="13" font-family="Arial" font-weight="bold">LAURO</text>
    <text x="45" y="62" text-anchor="middle" fill="#2e8b7a" font-size="8" font-family="Arial">🫘</text>
  </svg>`;

  // Logo UCP texto
  const logoUCP = `<div style="text-align:right;line-height:1.3">
    <div style="font-size:11pt;font-weight:bold;color:#1a3d2b">UNIVERSIDAD</div>
    <div style="font-size:11pt;font-weight:bold;color:#1a3d2b">CENTRAL DEL</div>
    <div style="font-size:11pt;font-weight:bold;color:#2e8b7a">PARAGUAY</div>
    <div style="font-size:8pt;color:#2e8b7a">Ciudad del Este</div>
  </div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Times New Roman', serif; font-size: 12pt; color: #000; background: white; }
  .pagina { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 20mm 25mm 20mm 25mm; display: flex; flex-direction: column; }
  .cabecalho { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #1a3d2b; padding-bottom: 12px; margin-bottom: 30px; }
  .titulo { text-align: center; font-size: 14pt; font-weight: bold; text-transform: uppercase; margin-bottom: 30px; letter-spacing: 1px; color: #1a3d2b; }
  .corpo { text-align: justify; line-height: 1.8; margin-bottom: 20px; flex: 1; }
  .corpo p { margin-bottom: 16px; }
  .data { text-align: right; margin: 20px 0; font-size: 11pt; }
  .assinaturas { display: flex; justify-content: space-around; margin-top: 40px; gap: 20px; }
  .assinatura-bloco { text-align: center; flex: 1; min-width: 150px; }
  .assinatura-img-wrap { height: 80px; display: flex; align-items: flex-end; justify-content: center; margin-bottom: 4px; }
  .assinatura-img { max-height: 80px; max-width: 180px; object-fit: contain; }
  .linha-assinatura { border-top: 1.5px solid #000; width: 90%; margin: 0 auto 6px; }
  .assinatura-nome { font-weight: bold; font-size: 10pt; text-transform: uppercase; }
  .assinatura-cargo { font-size: 9pt; margin-top: 3px; color: #1a3d2b; font-weight: bold; }
  .rodape { border-top: 3px solid #1a3d2b; margin-top: 30px; padding-top: 12px; display: flex; justify-content: space-between; align-items: center; }
  .rodape-ucp { font-size: 9pt; color: #1a3d2b; font-weight: bold; line-height: 1.4; }
  .rodape-lauro { font-size: 9pt; color: #2e8b7a; text-align: right; line-height: 1.4; }
  @media print { body { margin: 0; } .pagina { width: 100%; padding: 15mm 20mm; } }
</style>
</head>
<body>
<div class="pagina">

  <!-- CABEÇALHO -->
  <div class="cabecalho">
    <div style="display:flex;align-items:center;gap:12px">
      ${timbradoSrc ? `<img src="${timbradoSrc}" style="height:80px;width:auto;object-fit:contain;">` : logoLauro}
    </div>
    ${logoUCP}
  </div>

  <!-- TÍTULO -->
  <div class="titulo">Carta de Rescisión de la Liga Académica de Urología</div>

  <!-- CORPO -->
  <div class="corpo">
    <p>Yo, <strong>${membro.nome}</strong>, estudiante de Medicina, con CATRACA: <strong>${catraca}</strong>, portador del documento de identidad (RG): <strong>${rg}</strong>, por medio de la presente, comunico mi decisión de renunciar al cargo de <strong>${cargo}</strong> de la Liga Académica de Urología - LAURO, con sede en la Universidad Central del Paraguay, en Ciudad del Este - PY, debido a razones personales/profesionales.</p>
    <p>Agradezco la oportunidad brindada y la colaboración de todos los miembros de la Liga durante mi tiempo de participación.</p>
    <p>Asimismo, reconozco y acepto que, con mi salida de la Liga, no tendré derecho a recibir un certificado de participación como <strong>${tipoMembro}</strong> de ésta, conforme a las normativas establecidas por la Coordinación de Ligas.</p>
    <p>Sin otro particular, quedo a disposición para formalizar cualquier detalle relacionado con mi salida del cargo.</p>
    <p>Atentamente,</p>
  </div>

  <!-- DATA -->
  <div class="data">Ciudad del Este, ${dia} / ${mes} / ${ano}</div>

  <!-- ASSINATURAS -->
  <div class="assinaturas">
    <div class="assinatura-bloco">
      <div class="assinatura-img-wrap"></div>
      <div class="linha-assinatura"></div>
      <div class="assinatura-nome">${nomeCompleto}</div>
      <div class="assinatura-cargo">${tipoMembro}<br>Estudiante de Medicina – UCP</div>
    </div>
    <div class="assinatura-bloco">
      <div class="assinatura-img-wrap">
        ${presidenteSrc ? `<img src="${presidenteSrc}" class="assinatura-img">` : ''}
      </div>
      <div class="linha-assinatura"></div>
      <div class="assinatura-nome">${presidente}</div>
      <div class="assinatura-cargo">PRESIDENTE</div>
    </div>
    <div class="assinatura-bloco">
      <div class="assinatura-img-wrap">
        ${secretarioSrc ? `<img src="${secretarioSrc}" class="assinatura-img">` : ''}
      </div>
      <div class="linha-assinatura"></div>
      <div class="assinatura-nome">${secretario}</div>
      <div class="assinatura-cargo">SECRETÁRIO</div>
    </div>
  </div>

  <!-- RODAPÉ -->
  <div class="rodape">
    <div class="rodape-ucp">
      UNIVERSIDAD CENTRAL DEL PARAGUAY<br>
      <span style="color:#2e8b7a;font-weight:normal">Ciudad del Este, Paraguay</span>
    </div>
    <div class="rodape-lauro">
      LAURO — Liga Acadêmica de Urología<br>
      <span style="color:#1a3d2b">liga.urologia@ucp.edu.py</span>
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
