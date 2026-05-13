#!/usr/bin/env python3
# fix_index.py — aplicar no Render via: python3 fix_index.py
# Coloque em /tmp/fix_index.py e execute

import os

path = '/opt/render/project/src/src/routes/index.js'

with open(path, 'r') as f:
    c = f.read()

# CORRECAO 1: rota foto + toggle com toggle real
old1 = "router.post('/diretivos/:id/toggle', requireAuth, requireAdmin, async (req, res) => {\n  await query('UPDATE diretivos SET ativo=0 WHERE id=$1', [req.params.id]);\n  req.session.msg = ['Diretivo removido.'];\n  res.redirect('/diretivos');\n});"

new1 = (
    "router.get('/diretivos/:id/foto', requireAuth, async (req, res) => {\n"
    "  try {\n"
    "    const r = await query('SELECT foto_chave FROM diretivos WHERE id=$1', [req.params.id]);\n"
    "    const d = r.rows[0];\n"
    "    if (!d || !d.foto_chave) return res.status(404).send('Foto nao encontrada');\n"
    "    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');\n"
    "    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');\n"
    "    const R2 = new S3Client({ region:'auto', endpoint:process.env.R2_ENDPOINT, credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY } });\n"
    "    const url = await getSignedUrl(R2, new GetObjectCommand({ Bucket: process.env.R2_BUCKET||'liga-urologia-files', Key: d.foto_chave }), { expiresIn: 3600 });\n"
    "    res.redirect(url);\n"
    "  } catch(e) { res.status(500).send('Erro'); }\n"
    "});\n"
    "\n"
    "router.post('/diretivos/:id/toggle', requireAuth, requireAdmin, async (req, res) => {\n"
    "  const r = await query('SELECT ativo FROM diretivos WHERE id=$1', [req.params.id]);\n"
    "  const atual = r.rows[0]?.ativo;\n"
    "  await query('UPDATE diretivos SET ativo=$1 WHERE id=$2', [atual == 0 ? 1 : 0, req.params.id]);\n"
    "  req.session.msg = [atual == 0 ? 'Diretivo reativado!' : 'Diretivo desativado.'];\n"
    "  res.redirect('/diretivos' + (req.query.status ? '?status=' + req.query.status : ''));\n"
    "});"
)

# CORRECAO 2: filtro status na query GET /diretivos
old2 = "  const r = await query('SELECT * FROM diretivos WHERE ativo=1 ORDER BY cargo, nome');"
new2 = (
    "  const statusFiltro = req.query.status || 'ativos';\n"
    "  const whereAtivo = statusFiltro === 'inativos' ? 'ativo=0' : statusFiltro === 'todos' ? '1=1' : 'ativo=1';\n"
    "  const r = await query('SELECT * FROM diretivos WHERE ' + whereAtivo + ' ORDER BY cargo, nome');"
)

# CORRECAO 3: passar statusFiltro para a view
old3 = (
    "  res.render('pages/diretivos', {\n"
    "    config, msg, erro, diretivos: r.rows, usuario: req.session.usuario,\n"
    "    appUrl: process.env.APP_URL || 'https://liga-urologia.onrender.com'\n"
    "  });"
)
new3 = (
    "  res.render('pages/diretivos', {\n"
    "    config, msg, erro, diretivos: r.rows, usuario: req.session.usuario,\n"
    "    appUrl: process.env.APP_URL || 'https://liga-urologia.onrender.com',\n"
    "    statusFiltro\n"
    "  });"
)

# Aplicar
c1 = c.replace(old1, new1, 1)
c2 = c1.replace(old2, new2, 1)
c3 = c2.replace(old3, new3, 1)

# Verificar
ok = True
checks = [
    ("rota /diretivos/:id/foto", "diretivos/:id/foto" in c3),
    ("toggle reativado", "Diretivo reativado" in c3),
    ("statusFiltro na query", "statusFiltro" in c3),
    ("statusFiltro na view", "statusFiltro\n  });" in c3),
]
for nome, passou in checks:
    status = "OK" if passou else "FALHOU"
    print(f"  {status}: {nome}")
    if not passou:
        ok = False

if ok:
    with open(path, 'w') as f:
        f.write(c3)
    print(f"\nArquivo salvo! ({len(c3)} chars, {c3.count(chr(10))} linhas)")
else:
    print("\nALGUMA CORRECAO FALHOU - arquivo NAO salvo")
    print("Verifique se o texto no index.js nao foi alterado")
