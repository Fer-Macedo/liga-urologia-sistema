
require('dotenv').config({ path: '/var/www/liga-urologia/.env' });
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Pool } = require('pg');
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const R2 = new S3Client({
  endpoint: process.env.R2_ENDPOINT,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  region: 'auto',
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
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
  } catch(e) { console.error('R2 erro:', e.message); return null; }
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const r = await pool.query("SELECT timbrado_chave FROM configuracoes LIMIT 1");
  await pool.end();
  const chave = r.rows[0]?.timbrado_chave;
  console.log('chave:', chave);

  const timbB64 = await imagemBase64(chave);
  console.log('timbrado tamanho:', timbB64 ? timbB64.length : 'NULL');
  if (!timbB64) { console.log('ERRO: timbrado nao carregado'); process.exit(1); }

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],
    headless: true
  });
  const page = await browser.newPage();
  await page.setContent('<html><body><p>LINHA 1 TESTE</p><p>LINHA 2 TESTE</p><p>LINHA 3 TESTE</p></body></html>');

  const headerHtml = '<div style="width:210mm;height:67mm;margin:0;padding:0;overflow:hidden"><img src="' + timbB64 + '" style="width:100%;height:397mm;display:block;object-fit:cover;object-position:top"></div>';
  const footerHtml = '<div style="width:210mm;height:47mm;margin:0;padding:0;overflow:hidden"><img src="' + timbB64 + '" style="width:100%;height:397mm;display:block;object-fit:cover;object-position:bottom"></div>';

  const pdf = await page.pdf({
    format: 'A4', printBackground: true, displayHeaderFooter: true,
    headerTemplate: headerHtml, footerTemplate: footerHtml,
    margin: { top: '50mm', right: '22mm', bottom: '35mm', left: '22mm' }
  });
  fs.writeFileSync('/var/www/liga-urologia/public/teste_timb3.pdf', pdf);
  await browser.close();
  console.log('PDF gerado: acesse /teste_timb3.pdf');
})().catch(e => { console.error(e); process.exit(1); });
