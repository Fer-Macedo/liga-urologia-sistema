// 17/08/2026: achado em produção — a página de transmissão ao vivo (/live/:token) carregava
// normal e a contagem de presença funcionava (é só fetch/ping, não passa pelo CSP), mas o
// iframe do YouTube nunca aparecia — tela preta o tempo todo, mesmo com o link certo cadastrado.
// Causa: o frame-src do helmet (src/routes/index.js) não incluía youtube.com, então o próprio
// navegador bloqueava o iframe caladamente (Erro 153 do YouTube ao tentar embutir fora de um
// frame permitido). Esse teste é só uma trava de regressão baseada em texto — a asserção real
// (o navegador aceitando o iframe) foi conferida manualmente contra o embed de verdade.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.join(__dirname, '..', 'src/routes/index.js');

test('CSP frame-src permite embutir vídeo do YouTube (transmissão ao vivo do evento)', () => {
  const src = fs.readFileSync(ARQUIVO, 'utf8');
  const m = /frameSrc:\s*\[([^\]]*)\]/.exec(src);
  assert.ok(m, 'não achei a diretiva frameSrc no helmet — verifique se o CSP mudou de lugar/formato');
  assert.match(m[1], /https:\/\/www\.youtube\.com/, 'frame-src precisa incluir youtube.com, senão o iframe da transmissão é bloqueado pelo próprio navegador');
});
