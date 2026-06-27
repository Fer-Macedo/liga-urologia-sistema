
const puppeteer = require('puppeteer-core');
const fs = require('fs');
(async () => {
  // Pega o timbrado do banco como faz a rota real
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const r = await pool.query("SELECT timbrado_chave FROM configuracoes LIMIT 1");
  await pool.end();
  const chave = r.rows[0]?.timbrado_chave;
  console.log('timbrado_chave:', chave);

  // Le a imagem do disco
  let timbB64 = null;
  if (chave) {
    const caminho = '/var/www/liga-urologia/public/uploads/' + chave;
    if (fs.existsSync(caminho)) {
      const ext = chave.split('.').pop().toLowerCase();
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      timbB64 = 'data:' + mime + ';base64,' + fs.readFileSync(caminho).toString('base64');
      console.log('imagem carregada, tamanho base64:', timbB64.length);
    } else {
      console.log('arquivo nao encontrado em:', caminho);
    }
  }

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],
    headless: true
  });
  const page = await browser.newPage();
  await page.setContent('<html><body><p style="margin-top:20px">LINHA 1</p><p>LINHA 2</p><p>LINHA 3</p></body></html>');

  const headerHtml = timbB64
    ? '<div style="width:210mm;height:67mm;margin:0;padding:0;overflow:hidden"><img src="' + timbB64 + '" style="width:100%;height:397mm;display:block;object-fit:cover;object-position:top"></div>'
    : '<div style="width:210mm;height:67mm;background:red;margin:0;padding:0;">SEM TIMBRADO</div>';

  const footerHtml = timbB64
    ? '<div style="width:210mm;height:47mm;margin:0;padding:0;overflow:hidden"><img src="' + timbB64 + '" style="width:100%;height:397mm;display:block;object-fit:cover;object-position:bottom"></div>'
    : '<div style="width:210mm;height:47mm;background:blue;margin:0;padding:0;">SEM TIMBRADO</div>';

  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: headerHtml,
    footerTemplate: footerHtml,
    margin: { top: '50mm', right: '22mm', bottom: '35mm', left: '22mm' }
  });
  fs.writeFileSync('/var/www/liga-urologia/public/teste_timb.pdf', pdf);
  await browser.close();
  console.log('PDF gerado!');
})().catch(e => { console.error(e); process.exit(1); });
