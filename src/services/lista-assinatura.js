// Gera o HTML (papel timbrado + bloco de assinaturas da diretoria) de uma lista de presença
// e firma. Extraída de lista-assinaturas.js pra ser reaproveitada por qualquer tela que
// precise do mesmo documento (ex.: lista de assinatura de um evento específico).

// titulo/dataStr/descricao viram o cabeçalho impresso; pessoas é [{nome,rg,catraca}], já na
// ordem que deve sair impressa.
async function gerarHTMLLista(titulo, dataStr, descricao, pessoas, config) {
  const timbrado = config.timbrado_b64 || null;
  const presidenteSrc = config.assinatura_presidente_b64 || null;
  const viceSrc = config.assinatura_vicepresidente_b64 || null;
  const secretarioSrc = config.assinatura_secretario_b64 || null;
  const nomePresidente = (config.presidente_nome || 'PRESIDENTE').toUpperCase();
  const nomeVice = (config.vicepresidente_nome || 'VICE-PRESIDENTE').toUpperCase();
  const nomeSecretario = (config.secretario_nome || 'SECRETÁRIO').toUpperCase();
  const d = dataStr || '___/___/______';
  const LINHAS_POR_PAGINA = 32;
  const paginas = [];
  for (let i = 0; i < pessoas.length; i += LINHAS_POR_PAGINA) { paginas.push(pessoas.slice(i, i + LINHAS_POR_PAGINA)); }
  if (paginas.length === 0) paginas.push([]);
  const bgHtml = timbrado ? `<img src="${timbrado}" style="position:fixed;top:0;left:0;width:210mm;height:297mm;z-index:0;display:block">` : '';
  const paginasHtml = paginas.map((grupo, pi) => {
    const linhas = grupo.map((p, i) => `<tr><td style="text-align:center;padding:4px 3px;border:1px solid #555">${pi*LINHAS_POR_PAGINA+i+1}</td><td style="padding:4px 6px;border:1px solid #555">${p.nome}</td><td style="text-align:center;padding:4px 3px;border:1px solid #555">${p.rg||'—'}</td><td style="text-align:center;padding:4px 3px;border:1px solid #555">${p.catraca||'—'}</td><td style="padding:4px 3px;border:1px solid #555">&nbsp;</td></tr>`).join('');
    const isUltima = pi === paginas.length - 1;
    const assinaturasHtml = isUltima ? `<div style="display:flex;justify-content:space-around;margin-top:20px;gap:10px"><div style="text-align:center;flex:1"><div style="height:45px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:3px">${presidenteSrc?`<img src="${presidenteSrc}" style="max-height:45px;max-width:120px;object-fit:contain">`:''}</div><div style="border-top:1.5px solid #000;width:90%;margin:0 auto 3px"></div><div style="font-weight:bold;font-size:8pt;text-transform:uppercase">${nomePresidente}</div><div style="font-size:7.5pt">PRESIDENTE</div></div><div style="text-align:center;flex:1"><div style="height:45px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:3px">${viceSrc?`<img src="${viceSrc}" style="max-height:45px;max-width:120px;object-fit:contain">`:''}</div><div style="border-top:1.5px solid #000;width:90%;margin:0 auto 3px"></div><div style="font-weight:bold;font-size:8pt;text-transform:uppercase">${nomeVice}</div><div style="font-size:7.5pt">VICE-PRESIDENTE</div></div><div style="text-align:center;flex:1"><div style="height:45px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:3px">${secretarioSrc?`<img src="${secretarioSrc}" style="max-height:45px;max-width:120px;object-fit:contain">`:''}</div><div style="border-top:1.5px solid #000;width:90%;margin:0 auto 3px"></div><div style="font-weight:bold;font-size:8pt;text-transform:uppercase">${nomeSecretario}</div><div style="font-size:7.5pt">SECRETÁRIO</div></div></div>` : '';
    return `<div style="position:relative;width:210mm;min-height:297mm;page-break-after:always">${bgHtml}<div style="position:relative;z-index:1;padding:45mm 18mm 25mm 18mm"><div style="text-align:center;font-size:12pt;font-weight:bold;text-transform:uppercase;margin-bottom:3px">Lista de Presencia y Firmas</div><div style="text-align:center;font-size:9.5pt;margin-bottom:12px">${titulo} — ${d}${descricao?'<br><small>'+descricao+'</small>':''}</div><table style="width:100%;border-collapse:collapse;font-size:8.5pt"><thead><tr><th style="width:5%;background:#1a3d2b;color:white;padding:5px 3px;border:1px solid #333;text-align:center">#</th><th style="width:36%;background:#1a3d2b;color:white;padding:5px 6px;border:1px solid #333">Nombre Completo</th><th style="width:16%;background:#1a3d2b;color:white;padding:5px 3px;border:1px solid #333;text-align:center">RG</th><th style="width:16%;background:#1a3d2b;color:white;padding:5px 3px;border:1px solid #333;text-align:center">Catraca</th><th style="width:27%;background:#1a3d2b;color:white;padding:5px 3px;border:1px solid #333;text-align:center">Firma</th></tr></thead><tbody>${linhas}</tbody></table>${assinaturasHtml}</div></div>`;
  }).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}@page{size:A4;margin:0}body{font-family:'Times New Roman',serif;color:#000}@media print{.pagina{page-break-after:always}}</style></head><body>${paginasHtml}</body></html>`;
}

module.exports = { gerarHTMLLista };
