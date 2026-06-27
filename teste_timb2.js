
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const https = require('https');

function baixarImagem(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve('data:image/png;base64,' + buf.toString('base64'));
      });
      res.on('error', reject);
    });
  });
}

(async () => {
  const timbB64 = await baixarImagem('https://i.imgur.com/LPrFxrF.png');
  console.log('imagem baixada, tamanho:', timbB64.length);

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],
    headless: true
  });
  const page = await browser.newPage();
  await page.setContent('<html><body><p>LINHA 1</p><p>LINHA 2</p><p>LINHA 3</p></body></html>');

  const headerHtml = '<div style="width:210mm;height:67mm;margin:0;padding:0;overflow:hidden"><img src="' + timbB64 + '" style="width:100%;height:397mm;display:block;object-fit:cover;object-position:top"></div>';
  const footerHtml = '<div style="width:210mm;height:47mm;margin:0;padding:0;overflow:hidden"><img src="' + timbB64 + '" style="width:100%;height:397mm;display:block;object-fit:cover;object-position:bottom"></div>';

  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: headerHtml,
    footerTemplate: footerHtml,
    margin: { top: '50mm', right: '22mm', bottom: '35mm', left: '22mm' }
  });
  fs.writeFileSync('/var/www/liga-urologia/public/teste_timb2.pdf', pdf);
  await browser.close();
  console.log('PDF gerado: /teste_timb2.pdf');
})().catch(e => { console.error(e); process.exit(1); });
