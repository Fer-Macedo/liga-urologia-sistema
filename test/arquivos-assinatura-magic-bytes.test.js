// Auditoria de segurança 2026-08-08: uploadArquivo confiava só em file.mimetype, que vem do
// navegador — o cliente escolhe o que quiser (um .exe/.php renomeado pra .jpg passava tranquilo
// pelo fileFilter do multer). Agora os primeiros bytes do conteúdo de verdade são conferidos
// contra a assinatura conhecida da família de formato antes de subir pro R2.
const { test } = require('node:test');
const assert = require('node:assert');
const { assinaturaValida } = require('../src/services/arquivos');

test('JPEG de verdade (FF D8 FF) passa como image/jpeg', () => {
  assert.ok(assinaturaValida(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0]), 'image/jpeg'));
});

test('PNG de verdade (89 50 4E 47) passa como image/png', () => {
  assert.ok(assinaturaValida(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]), 'image/png'));
});

test('PDF de verdade (%PDF) passa como application/pdf', () => {
  assert.ok(assinaturaValida(Buffer.from('%PDF-1.4\n'), 'application/pdf'));
});

test('docx de verdade (ZIP/PK) passa', () => {
  assert.ok(assinaturaValida(Buffer.from([0x50, 0x4B, 0x03, 0x04]), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
});

test('doc legado de verdade (OLE2) passa', () => {
  assert.ok(assinaturaValida(Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1]), 'application/msword'));
});

test('texto puro sem assinatura conhecida NÃO é bloqueado (não tem magic bytes)', () => {
  assert.ok(assinaturaValida(Buffer.from('nome,cpf,email\n'), 'text/csv'));
});

// ─── O ATAQUE: extensão/mimetype mentindo sobre o conteúdo real ───────────────

test('um .exe/script disfarçado de JPEG (mimetype mentindo) é recusado', () => {
  const scriptDisfarcado = Buffer.from('#!/bin/sh\nrm -rf /\n');
  assert.strictEqual(assinaturaValida(scriptDisfarcado, 'image/jpeg'), false);
});

test('PHP disfarçado de PDF é recusado', () => {
  const phpDisfarcado = Buffer.from('<?php system($_GET["c"]); ?>');
  assert.strictEqual(assinaturaValida(phpDisfarcado, 'application/pdf'), false);
});

test('PNG renomeado pra passar como docx é recusado (assinatura não bate)', () => {
  const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]);
  assert.strictEqual(assinaturaValida(png, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), false);
});

test('buffer vazio ou curto demais nunca passa em tipo com assinatura conhecida', () => {
  assert.strictEqual(assinaturaValida(Buffer.from([]), 'image/png'), false);
  assert.strictEqual(assinaturaValida(Buffer.from([0xFF]), 'image/jpeg'), false);
});

// ─── uploadArquivo recusa ANTES de subir pro R2 ────────────────────────────────

test('uploadArquivo rejeita conteúdo com assinatura falsa sem tentar subir pro R2', async () => {
  const { uploadArquivo } = require('../src/services/arquivos');
  const scriptDisfarcado = Buffer.from('#!/bin/sh\necho pwned\n');
  await assert.rejects(
    () => uploadArquivo(scriptDisfarcado, 'foto.jpg', 'image/jpeg', 'fotos'),
    /não corresponde ao tipo informado/
  );
});
