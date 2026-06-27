
const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],
    headless: true
  });
  const page = await browser.newPage();
  await page.setContent('<html><body><p>teste</p></body></html>');
  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: `<div style="width:210mm;background:red;font-size:8px;color:white;padding:0;margin:0;">HEADER TOP</div>`,
    footerTemplate: `<div style="width:210mm;background:blue;font-size:8px;color:white;padding:0;margin:0;">FOOTER BOTTOM</div>`,
    margin: { top: '50mm', right: '22mm', bottom: '35mm', left: '22mm' }
  });
  require('fs').writeFileSync('/var/www/liga-urologia/public/teste_margem.pdf', pdf);
  await browser.close();
  console.log('PDF gerado!');
})();
