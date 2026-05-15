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
  const nome = membro.nome || '___________________';
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
body { font-family:'Times New Roman',serif; font-size:11pt; color:#000; }
.pagina {
  width: 210mm;
  height: 297mm;
  position: relative;
  overflow: hidden;
}
.bg {
  position: absolute;
  top: 0; left: 0;
  width: 210mm;
  height: 297mm;
  z-index: 0;
}
.bg img { width: 210mm; height: 297mm; display: block; }
.texto {
  position: absolute;
  top: 52mm; left: 22mm;
  width: 166mm;
  height: 203mm;
  z-index: 1;
  display: flex;
  flex-direction: column;
}
.titulo { text-align:center; font-size:12pt; font-weight:bold; text-transform:uppercase; margin-bottom:12px; }
.corpo { text-align:justify; line-height:1.5; flex:1; }
.corpo p { margin-bottom:7px; }
.data { text-align:right; margin:8px 0; font-size:10pt; }
.assinaturas { display:flex; flex-direction:column; gap:12px; align-items:center; }
.assinatura-bloco { text-align:center; width:70%; }
.assinatura-img-wrap { height:50px; display:flex; align-items:flex-end; justify-content:center; margin-bottom:3px; }
.assinatura-img { max-height:50px; max-width:130px; object-fit:contain; }
.linha { border-top:1.5px solid #000; width:90%; margin:0 auto 3px; }
.assinatura-nome { font-weight:bold; font-size:8.5pt; text-transform:uppercase; }
.assinatura-cargo { font-size:8pt; margin-top:2px; }
</style>
</head>
<body>
<div class="pagina">
  <div class="bg">${timbrado ? `<img src="${timbrado}">` : ''}</div>
  <div class="texto">
    <div class="titulo">Carta de Rescisión de la Liga Académica de Urología</div>
    <div class="corpo">
      <p>Yo, <strong>${nome}</strong>, estudiante de Medicina, con CATRACA: <strong>${catraca}</strong>, portador del documento de identidad (RG): <strong>${rg}</strong>, por medio de la presente, comunico mi decisión de renunciar al cargo de <strong>${cargo}</strong> de la Liga Académica de Urología - LAURO, con sede en la Universidad Central del Paraguay, en Ciudad del Este - PY, debido a razones personales/profesionales.</p>
      <p>Agradezco la oportunidad brindada y la colaboración de todos los miembros de la Liga durante mi tiempo de participación.</p>
      <p>Asimismo, reconozco y acepto que, con mi salida de la Liga, no tendré derecho a recibir un certificado de participación como <strong>${tipoMembro}</strong> de ésta, conforme a las normativas establecidas por la Coordinación de Ligas.</p>
      <p>Sin otro particular, quedo a disposición para formalizar cualquier detalle relacionado con mi salida del cargo.</p>
      <p>Atentamente,</p>
    </div>
    <div class="data">Ciudad del Este, ${dia} / ${mes} / ${ano}</div>
    <div class="assinaturas">
      <div class="assinatura-bloco">
        <div class="assinatura-img-wrap"></div>
        <div class="linha"></div>
        <div class="assinatura-nome">${(membro.nome||'').toUpperCase()}</div>
        <div class="assinatura-cargo">${tipoMembro}<br>Estudiante de Medicina – UCP</div>
      </div>
      <div class="assinatura-bloco">
        <div class="assinatura-img-wrap">${presidente ? `<img src="${presidente}" class="assinatura-img">` : ''}</div>
        <div class="linha"></div>
        <div class="assinatura-nome">${nomePresidente}</div>
        <div class="assinatura-cargo">PRESIDENTE</div>
      </div>
      <div class="assinatura-bloco">
        <div class="assinatura-img-wrap">${secretario ? `<img src="${secretario}" class="assinatura-img">` : ''}</div>
        <div class="linha"></div>
        <div class="assinatura-nome">${nomeSecretario}</div>
        <div class="assinatura-cargo">SECRETÁRIO</div>
      </div>
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


function gerarHTMLContrato(d, config, texto) {
  const timb = config.timbrado_b64 || null;
  const assP = config.assinatura_presidente_b64 || null;
  const assV = config.assinatura_vicepresidente_b64 || null;
  const assS = config.assinatura_secretario_b64 || null;
  const assO = config.assinatura_orientador_b64 || null;
  const nomeP = (config.presidente_nome||'MANUEL FERNANDO MACEDO NETO').toUpperCase();
  const nomeV = (config.vicepresidente_nome||'LEYRIANE').toUpperCase();
  const nomeS = (config.secretario_nome||'KAUE TEIXEIRA LACERDA').toUpperCase();
  const nomeO = (config.orientador_nome||'DIOGENES DURANONES').toUpperCase();
  function assBl(b64,nm,cg){
    return '<div class="ab">'+(b64?'<img class="ai" src="'+b64+'">':'<div class="ae"></div>')+'<div class="al"></div><div class="an">'+nm+'</div><div class="ac">'+cg+'</div></div>';
  }
  const css='*{margin:0;padding:0;box-sizing:border-box}body{font-family:Times New Roman,serif;font-size:11pt;color:#000;width:210mm;margin:0 auto}@page{size:A4;margin:0}.pagina{width:210mm;position:relative}.bg{position:fixed;top:0;left:0;width:210mm;height:297mm;z-index:0;pointer-events:none}.bg img{width:210mm;height:297mm;display:block}.tx{position:relative;z-index:1;padding:50mm 22mm 88mm 22mm;width:210mm;box-sizing:border-box}.tit{text-align:center;font-weight:bold;font-size:12pt;margin-bottom:10px;text-transform:uppercase}.dados{font-size:10.5pt;line-height:2;margin-bottom:10px}.co{font-size:10pt;line-height:1.6}.co p{margin-bottom:6px}.co p.ql-align-center{text-align:center!important}.co p.ql-align-right{text-align:right!important}.co p.ql-align-justify{text-align:justify!important}.co p.ql-align-left{text-align:left!important}.ass{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:20px;page-break-inside:avoid}.ab{text-align:center}.ai{max-height:40px;max-width:110px;object-fit:contain;display:block;margin:0 auto 3px}.ae{height:40px}.al{border-top:1.5px solid #000;width:85%;margin:0 auto 3px}.an{font-size:9pt;font-weight:bold;text-transform:uppercase}.ac{font-size:8.5pt}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.bg{position:fixed!important}}';
  const dataIng = d.data_inicio ? new Date(d.data_inicio).toLocaleDateString('pt-BR') : '';
  const dados = '<div class="dados"><strong>MIEMBRO:</strong> '+d.nome+'<br><strong>R.G./C.I:</strong> '+(d.rg||'')+'<br><strong>Catraca:</strong> '+(d.catraca||'')+'<br><strong>Fecha de ingreso:</strong> '+dataIng+'</div>';
  const asss = '<div class="ass">'+assBl(null,(d.nome||'').toUpperCase(),'Miembro Activo')+assBl(assP,nomeP,'Presidente')+assBl(assV,nomeV,'Vice-Presidente')+assBl(assS,nomeS,'Secretario')+assBl(assO,nomeO,'Docente Orientador')+'</div>';
  const tit = '<div class="tit">CONTRATO DE LIGA ACADEMICA Y MIEMBRO ACTIVO<br>LIGA ACADEMICA DE UROLOGIA - LAURO</div>';
  const bg = timb ? '<div class="bg"><img src="'+timb+'"></div>' : '';
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>'+css+'</style></head><body><div class="pagina">'+bg+'<div class="tx">'+tit+dados+'<div class="co">'+texto+'</div>'+asss+'</div></div><script>window.onload=function(){window.print()}<\/script></body></html>';
}


module.exports = { gerarHTMLDesligamento, gerarHTMLContrato, getUrlAssinada, uploadBuffer, imagemBase64 };
