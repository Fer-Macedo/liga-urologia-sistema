
require('dotenv').config({ path: '/var/www/liga-urologia/.env' });
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const R2 = new S3Client({
  endpoint: process.env.R2_ENDPOINT,
  region: 'auto',
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
});
const BUCKET = process.env.R2_BUCKET || 'liga-urologia-files';

async function imagemBase64(chave) {
  const r = await R2.send(new GetObjectCommand({ Bucket: BUCKET, Key: chave }));
  const chunks = [];
  for await (const chunk of r.Body) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  return 'data:image/jpeg;base64,' + buffer.toString('base64');
}

(async () => {
  const timbB64 = await imagemBase64('timbrados/1778853403253-a0bfc79336c1b73d.jpg');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Times New Roman',serif; font-size:11pt; color:#000; }
  .timbrado-bg {
    position: fixed;
    top: 0; left: 0;
    width: 210mm; height: 297mm;
    z-index: -1;
  }
  .timbrado-bg img {
    width: 100%;
    height: 100%;
    display: block;
  }
  .conteudo {
    padding: 52mm 22mm 45mm 22mm;
  }
</style>
</head>
<body>
  <div class="timbrado-bg">
    <img src="${timbB64}">
  </div>
  <div class="conteudo">
    <p>LINHA 1 TESTE</p>
    <p>LINHA 2 TESTE</p>
    <p>LINHA 3 TESTE</p>
    <p>LINHA 4 TESTE</p>
    <p>LINHA 5 TESTE</p>
  </div>
</body>
</html>`;

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],
    headless: true
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });

  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: false,
    margin: { top: '0', right: '0', bottom: '0', left: '0' }
  });
  fs.writeFileSync('/var/www/liga-urologia/public/teste_timb6.pdf', pdf);
  await browser.close();
  console.log('PDF gerado: /teste_timb6.pdf');
})().catch(e => { console.error(e); process.exit(1); });
