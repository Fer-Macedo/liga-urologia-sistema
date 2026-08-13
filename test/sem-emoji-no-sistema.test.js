// 13/08/2026: regra do projeto (CLAUDE.md) — nenhum emoji em nada que o sistema produz,
// exceto mensagens de WhatsApp. Varredura grande feita nesta data removeu ~250 ocorrências
// (Unicode cru + entidades HTML tipo &#128203;) espalhadas por 50+ arquivos. Este teste é o
// guarda-corpo: falha se alguém reintroduzir emoji fora dos arquivos exclusivos de WhatsApp.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const RAIZ = path.join(__dirname, '..');

// Únicos arquivos onde emoji é permitido — texto que vai só pro WhatsApp.
const ARQUIVOS_ISENTOS = [
  'src/services/lauro.js',
  'src/services/canal-assistente.js'
];

const EMOJI_RAW = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;
const EMOJI_ENTIDADE = /&#1(2[5-9]|3[0-9])[0-9]{3};/g;

function listarArquivos(dir, extensoes) {
  let out = [];
  for (const nome of fs.readdirSync(dir)) {
    const p = path.join(dir, nome);
    if (nome === 'node_modules' || nome.startsWith('.')) continue;
    const stat = fs.statSync(p);
    if (stat.isDirectory()) out = out.concat(listarArquivos(p, extensoes));
    else if (extensoes.some(ext => nome.endsWith(ext))) out.push(p);
  }
  return out;
}

test('nenhum emoji (Unicode ou entidade HTML) fora dos arquivos exclusivos de WhatsApp', () => {
  const alvos = [
    ...listarArquivos(path.join(RAIZ, 'src'), ['.js']),
    ...listarArquivos(path.join(RAIZ, 'views'), ['.ejs'])
  ];
  const isentosAbs = ARQUIVOS_ISENTOS.map(f => path.join(RAIZ, f));
  const achados = [];

  for (const arquivo of alvos) {
    if (isentosAbs.includes(arquivo)) continue;
    const conteudo = fs.readFileSync(arquivo, 'utf8');
    const relPath = path.relative(RAIZ, arquivo);
    const linhas = conteudo.split('\n');
    // Arquivos mistos (WhatsApp + e-mail) marcam o texto que vai só pro WhatsApp com
    // // whatsapp-only:inicio ... // whatsapp-only:fim — o resto do arquivo continua coberto.
    let dentroBlocoWpp = false;
    linhas.forEach((linha, i) => {
      if (/whatsapp-only:inicio/.test(linha)) { dentroBlocoWpp = true; return; }
      if (/whatsapp-only:fim/.test(linha)) { dentroBlocoWpp = false; return; }
      if (dentroBlocoWpp) return;
      if (EMOJI_RAW.test(linha) || EMOJI_ENTIDADE.test(linha)) {
        achados.push(`${relPath}:${i + 1}: ${linha.trim().slice(0, 120)}`);
      }
      EMOJI_RAW.lastIndex = 0;
      EMOJI_ENTIDADE.lastIndex = 0;
    });
  }

  assert.deepStrictEqual(achados, [], 'emoji encontrado fora do WhatsApp:\n' + achados.join('\n'));
});
