#!/usr/bin/env python3
path = '/opt/render/project/src/src/routes/index.js'
c = open(path).read()

new_code = (
    "  req.session.msg = ['Diretivo atualizado com sucesso!'];\n"
    "  res.redirect('/diretivos');\n"
    "});\n"
    "\n"
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
    "});\n"
    "\n"
)

# Encontra o ponto de insercao — logo apos o bloco do editar
marker = "req.session.msg = ['Diretivo atualizado com sucesso!'];\n  res.redirect('/diretivos');\n});"
idx = c.find(marker)

if idx < 0:
    print('FALHOU - marcador nao encontrado')
    print('Contexto do arquivo (busca por Diretivo atualizado):')
    i2 = c.find('Diretivo atualizado')
    if i2 >= 0:
        print(repr(c[i2:i2+150]))
else:
    insert_at = idx + len(marker)
    # Verifica se ja tem a rota foto
    if "diretivos/:id/foto" in c:
        print('Rota foto JA existe no arquivo - nada a fazer')
    else:
        c = c[:insert_at] + "\n\n" + (
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
            "});\n"
        ) + c[insert_at:]
        open(path, 'w').write(c)
        print('OK - rota foto e toggle inseridos!')
        print('Verificando...')
        print('  foto:', 'diretivos/:id/foto' in c)
        print('  toggle:', 'Diretivo reativado' in c)
