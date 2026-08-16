// 11/08/2026: o formulário de ADICIONAR palestrante usa o editor rico Quill pra bio, mas
// faltava a linha que copia o texto digitado (_qBioAdd.root.innerHTML) pro campo escondido
// que de fato é enviado no POST — o formulário de EDITAR já tinha isso certo. Resultado: bio
// de palestrante novo nunca salvava, mesmo com a pessoa digitando e clicando em salvar, mas
// foto/nome funcionavam normalmente (campos comuns, sem editor rico).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const ejs = require('ejs');
const fs = require('fs');

const ARQUIVO = path.join(__dirname, '..', 'views/pages/evento-detalhe.ejs');

function renderizar() {
  const evento = { id: 1, nome: 'Congresso', cor_tema: '#1a3d2b', vagas_total: 100, total_inscritos: 0 };
  const locals = {
    config: {}, usuario: { nome: 'Teste', perfil: 'admin' }, msg: [], erro: [],
    evento, lotes: [], inscricoes: [], pagamentos: [], certificados: [],
    stats: { total: 0, confirmados: 0, checkins: 0, receita: 0 },
    campos: [], programacao: [], palestrantes: [], patrocinadores: [], cupons: [], prefixoCupomEvento: 'LAURO'
  };
  return ejs.render(fs.readFileSync(ARQUIVO, 'utf8'), locals, { filename: ARQUIVO });
}

test('formulário de ADICIONAR palestrante sincroniza o Quill (_qBioAdd) com o campo enviado antes do submit', () => {
  const html = renderizar();
  const iForm = html.indexOf('/palestrantes" method="POST"');
  assert.ok(iForm !== -1, 'formulário de adicionar palestrante precisa existir');
  const trechoForm = html.slice(iForm, html.indexOf('>', iForm) + 1);
  assert.match(trechoForm, /onsubmit="[^"]*_qBioAdd\.root\.innerHTML/, 'sem isso, a bio digitada no editor rico nunca chega no servidor');
});

test('só existe UMA rota de editar palestrante (a duplicata morta foi removida)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/routes/eventos.js'), 'utf8');
  const ocorrencias = src.match(/router\.post\('\/eventos\/:id\/palestrantes\/:pid\/editar'/g) || [];
  assert.strictEqual(ocorrencias.length, 1, 'a rota duplicada era código morto (Express só usa a primeira) e confundia quem fosse mexer aqui depois');
});
