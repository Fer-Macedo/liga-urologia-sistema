#!/usr/bin/env python3
# Adiciona suporte a IMAGENS DE ASSINATURA ao gerador projeto-doc-timbrado.js
# Estratégia: baixar PNGs do R2, injetar no pacote .docx (media + rels + content-types),
# e trocar a linha "___" pela imagem quando houver assinatura cadastrada.
import re

f = '/var/www/liga-urologia/src/services/projeto-doc-timbrado.js'
src = open(f).read()

if 'firmaImg' in src:
    print('Suporte a imagens já aplicado')
    raise SystemExit

# ── 1. Adicionar função que gera o XML de imagem inline (acima do nome) ──
helper_img = '''
// ── XML de uma imagem inline de assinatura (centralizada) ──
function imagemAssinaturaXml(rId, larguraEmu, alturaEmu, idNum, nome) {
  return '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr>' +
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="' + larguraEmu + '" cy="' + alturaEmu + '"/>' +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:docPr id="' + idNum + '" name="' + nome + '"/>' +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:nvPicPr><pic:cNvPr id="' + idNum + '" name="' + nome + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="' + rId + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + larguraEmu + '" cy="' + alturaEmu + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
}
'''
# inserir o helper logo antes de montarCorpo
src = src.replace('// ── monta todo o corpo do projeto ──',
                  helper_img + '\n// ── monta todo o corpo do projeto ──')

# ── 2. montarCorpo: a função firma passa a aceitar uma imagem (rId) opcional ──
firma_antiga = '''  const firma = (nome, cargo) => vazio(2) +
    parXml([{ t: '__________________________', b: true }], 'center') +
    parXml([{ t: nome || '(nombre)', b: true }], 'center') +
    parXml([{ t: cargo, b: true }], 'center');'''
firma_nova = '''  // firma(nome, cargo, imgInfo) — se imgInfo existe, mostra a assinatura no lugar da linha
  const firma = (nome, cargo, imgInfo) => vazio(2) +
    (imgInfo
      ? imagemAssinaturaXml(imgInfo.rId, imgInfo.w, imgInfo.h, imgInfo.id, imgInfo.nome)
      : parXml([{ t: '__________________________', b: true }], 'center')) +
    parXml([{ t: nome || '(nombre)', b: true }], 'center') +
    parXml([{ t: cargo, b: true }], 'center');'''
src = src.replace(firma_antiga, firma_nova)

# ── 3. as 4 firmas da liga passam a usar cfg._firmas (preparado no gerarProjetoTimbrado) ──
bloco_antigo = '''  const directorNome = p.tipo === 'extension' ? (cfg.director_extension_nome || '') : (cfg.director_ensino_nome || '');
  x += firma(cfg.presidente_nome || '', 'Presidente');
  x += firma(directorNome, 'Director responsable del proyecto');
  x += firma(cfg.secretario_nome || '', 'Secretario');
  x += firma(cfg.orientador_nome || p.docente_orientador || '', 'Docente Orientador');'''
bloco_novo = '''  const directorNome = p.tipo === 'extension' ? (cfg.director_extension_nome || '') : (cfg.director_ensino_nome || '');
  const F = cfg._firmas || {};
  x += firma(cfg.presidente_nome || '', 'Presidente', F.presidente);
  x += firma(directorNome, 'Director responsable del proyecto', F.director);
  x += firma(cfg.secretario_nome || '', 'Secretario', F.secretario);
  x += firma(cfg.orientador_nome || p.docente_orientador || '', 'Docente Orientador', F.orientador);'''
src = src.replace(bloco_antigo, bloco_novo)

# ── 4. gerarProjetoTimbrado: baixar imagens do R2, injetar no pacote, preparar cfg._firmas ──
antigo_chamada = '''  // Monta o novo corpo
  const corpo = montarCorpo(p, cfg);'''
novo_chamada = '''  // ── Preparar as IMAGENS DE ASSINATURA da liga (se cadastradas) ──
  // Baixa do R2, injeta no pacote .docx e prepara os rId para o corpo.
  cfg._firmas = {};
  try {
    const { imagemBase64 } = require('./desligamento');
    // mapa cargo -> chave da imagem no R2
    const dirChave = p.tipo === 'extension' ? cfg.assinatura_director_extension_chave : cfg.assinatura_director_ensino_chave;
    const mapa = {
      presidente: cfg.assinatura_presidente_chave,
      director:   dirChave,
      secretario: cfg.assinatura_secretario_chave,
      orientador: cfg.assinatura_orientador_chave
    };
    // localizar/garantir o document.xml.rels e o [Content_Types].xml
    let relsPath = 'word/_rels/document.xml.rels';
    let relsXml = zip.file(relsPath) ? await zip.file(relsPath).async('string') : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    let ctPath = '[Content_Types].xml';
    let ctXml = await zip.file(ctPath).async('string');
    // garante que PNG tem content-type default
    if (ctXml.indexOf('Extension="png"') === -1) {
      ctXml = ctXml.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
    }
    let idx = 9000; // ids altos para não colidir
    for (const cargo of Object.keys(mapa)) {
      const chave = mapa[cargo];
      if (!chave) continue;
      const dataUri = await imagemBase64(chave);
      if (!dataUri) continue;
      const b64 = dataUri.split(',')[1];
      if (!b64) continue;
      const buf = Buffer.from(b64, 'base64');
      idx++;
      const nomeImg = 'firma_' + cargo + '.png';
      const mediaPath = 'word/media/' + nomeImg;
      zip.file(mediaPath, buf);
      const rId = 'rIdFirma' + idx;
      // adiciona relationship
      relsXml = relsXml.replace('</Relationships>',
        '<Relationship Id="' + rId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + nomeImg + '"/></Relationships>');
      // dimensões: largura fixa ~3.5cm, altura proporcional (assinaturas costumam ser largas)
      const w = Math.round(3.5 * 360000);
      const h = Math.round(1.4 * 360000);
      cfg._firmas[cargo] = { rId: rId, w: w, h: h, id: idx, nome: nomeImg };
    }
    zip.file(relsPath, relsXml);
    zip.file(ctPath, ctXml);
  } catch (e) { /* se falhar, segue sem imagens (linhas em branco) */ }

  // Monta o novo corpo
  const corpo = montarCorpo(p, cfg);'''
src = src.replace(antigo_chamada, novo_chamada)

open(f, 'w').write(src)
print('OK: suporte a imagens de assinatura adicionado ao gerador')
