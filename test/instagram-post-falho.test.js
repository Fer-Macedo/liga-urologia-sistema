// 22/07/2026: o carrossel agendado para as 08:00 NÃO foi publicado. O painel mostrava só
// "Erro: Request failed with status code 400" — o axios resume a resposta HTTP e joga fora
// o corpo, que é justamente onde a Meta explica o motivo. Sem essa explicação, era
// impossível saber a causa: o log tinha o mesmo número e nada mais.
//
// Reproduzindo o post depois (sem publicar), os 7 slides e o carrossel foram aceitos com
// status FINISHED — mesmo token, mesmas imagens, mesma legenda. Ou seja: a falha foi
// PASSAGEIRA, e uma tentativa única transformou um soluço da Meta em post perdido.
//
// Três regras ficam presas aqui: a mensagem real é gravada, a publicação insiste, e a
// insistência nunca duplica um post que já está no ar.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

process.env.IG_RETRY_MS = '1';   // sem isso o teste espera 60s de relógio real

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/services/instagram.js');

function montar({ falhas = 0, erroDaMeta = null, jaNoAr = null } = {}) {
  let tentativas = 0;
  const updates = [];
  const emails = [];

  const rax = require.resolve('axios');
  require.cache[rax] = { id: rax, filename: rax, loaded: true, exports: {
    post: async (url) => {
      if (/media_publish/.test(url)) {
        tentativas++;
        if (tentativas <= falhas) {
          const e = new Error('Request failed with status code 400');
          e.response = { data: erroDaMeta || { error: { message: 'Falha temporaria', code: 2 } } };
          throw e;
        }
        return { data: { id: 'MEDIA_OK' } };
      }
      return { data: { id: 'CONTAINER' } };
    },
    get: async () => ({ data: { data: jaNoAr ? [{ caption: jaNoAr }] : [], status_code: 'FINISHED' } })
  }};

  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT \* FROM instagram_posts WHERE status='agendado'/.test(sql)) {
        return { rows: [{
          id: 2, tipo: 'feed', legenda: '5 señales de que necesitás consultar con un urólogo',
          agendado_para: '2026-07-22T08:00:00', midia_chave: 'instagram-posts/x.png', midia_url: 'https://antigo'
        }] };
      }
      if (/UPDATE instagram_posts/.test(sql)) { updates.push({ sql, params }); return { rows: [], rowCount: 1 }; }
      if (/FROM usuarios/.test(sql)) return { rows: [{ email: 'marketing@lauro.org' }] };
      return { rows: [] };
    }
  }};

  const rarq = require.resolve(path.join(RAIZ, 'src/services/arquivos.js'));
  require.cache[rarq] = { id: rarq, filename: rarq, loaded: true, exports: {
    gerarUrlInline: async () => 'https://r2/fresca.png', baixarArquivoBuffer: async () => Buffer.from(''), uploadArquivo: async () => ({})
  }};

  const rn = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rn] = { id: rn, filename: rn, loaded: true, exports: {
    enviarEmail: async (o) => { emails.push(o); return { ok: true }; }
  }};

  delete require.cache[require.resolve(MODULO)];
  return { mod: require(MODULO), updates, emails, contarTentativas: () => tentativas };
}

// A regressão exata: "status code 400" sozinho não permite consertar nada.
test('grava o motivo REAL da Meta, não só o número do erro', async () => {
  const { mod, updates } = montar({
    falhas: 99,
    erroDaMeta: { error: { message: 'The image is too large', code: 36003, error_user_title: 'Imagem grande demais' } }
  });
  await mod.processarPostsAgendados();
  const erro = updates.find(u => /status='erro'/.test(u.sql));
  assert.ok(erro, 'depois de esgotar as tentativas tem que marcar erro');
  assert.match(String(erro.params[0]), /Imagem grande demais|The image is too large/,
    'sem a mensagem da Meta ninguém consegue descobrir a causa');
  assert.match(String(erro.params[0]), /36003/, 'o código ajuda a procurar na documentação');
});

// O que matou o post de 22/07: falha passageira, tentativa única.
test('falha passageira não mata o post — a segunda tentativa publica', async () => {
  const { mod, updates, contarTentativas } = montar({ falhas: 1 });
  await mod.processarPostsAgendados();
  assert.strictEqual(contarTentativas(), 2, 'tinha que tentar de novo');
  assert.ok(updates.some(u => /status='publicado'/.test(u.sql)), 'e publicar');
  assert.ok(!updates.some(u => /status='erro'/.test(u.sql)), 'não pode ficar marcado como erro');
});

test('falha permanente desiste depois de 3 tentativas', async () => {
  const { mod, contarTentativas } = montar({ falhas: 99 });
  await mod.processarPostsAgendados();
  assert.strictEqual(contarTentativas(), 3, 'insistir para sempre viraria martelada na Meta');
});

// Insistir não pode virar post repetido no perfil da liga.
test('não republica o que já está no ar (checa a conta, não o banco)', async () => {
  const { mod, updates, contarTentativas } = montar({
    falhas: 99, jaNoAr: '5 señales de que necesitás consultar con un urólogo'
  });
  await mod.processarPostsAgendados();
  assert.strictEqual(contarTentativas(), 1, 'a 2a tentativa tem que parar ao ver o post no perfil');
  assert.ok(updates.some(u => /status='publicado'/.test(u.sql)), 'e reconhecer que ele foi publicado');
});

// A falha silenciosa: a data passa e ninguém fica sabendo.
test('quando desiste, avisa a equipe por e-mail', async () => {
  const { mod, emails } = montar({ falhas: 99 });
  await mod.processarPostsAgendados();
  assert.strictEqual(emails.length, 1, 'post que não saiu tem que gerar aviso');
  assert.match(emails[0].assunto, /não saiu/i);
  assert.match(emails[0].html, /22\/07\/2026/, 'o aviso precisa dizer qual publicação era');
});
