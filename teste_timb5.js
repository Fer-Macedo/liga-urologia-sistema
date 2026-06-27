
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

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],
    headless: true
  });
  const page = await browser.newPage();
  await page.setContent('<html><body><p>LINHA 1 TESTE</p><p>LINHA 2 TESTE</p><p>LINHA 3 TESTE</p></body></html>');

  // Tentativa: header 50mm real = 67mm no template
  // footer 35mm real = 47mm no template
  // margem top = 67mm (tamanho do template, nao 50mm)
  // margem bottom = 47mm (tamanho do template, nao 35mm)
  const headerHtml = '<div style="width:210mm;height:67mm;margin:0;padding:0;overflow:hidden"><img src="' + timbB64 + '" style="width:100%;height:397mm;display:block;object-fit:cover;object-position:top"></div>';
  const footerHtml = '<div style="width:210mm;height:47mm;margin:0;padding:0;overflow:hidden"><img src="' + timbB64 + '" style="width:100%;height:397mm;display:block;object-fit:cover;object-position:bottom"></div>';

  const pdf = await page.pdf({
    format: 'A4', printBackground: true, displayHeaderFooter: true,
    headerTemplate: headerHtml, footerTemplate: footerHtml,
    margin: { top: '67mm', right: '22mm', bottom: '47mm', left: '22mm' }
  });
  fs.writeFileSync('/var/www/liga-urologia/public/teste_timb5.pdf', pdf);
  await browser.close();
  console.log('PDF gerado: /teste_timb5.pdf');
})().catch(e => { console.error(e); process.exit(1); });
