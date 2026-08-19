// 15/08/2026: pedido explícito — testar a transmissão só com Ligantes/Diretivos antes de abrir
// pro público geral (evento com centenas de inscritos, erro em produção teria repercussão
// ruim). Casa CPF normalizado (só dígitos) ou e-mail — mesma lógica da correção de cadastro
// duplicado desta sessão, porque CPF pode estar formatado diferente entre as tabelas.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar({ inscritos, ligantes = [], diretivos = [], hojeProgramacao = null, diasComData = [] }) {
  const wppEnviados = [], emailEnviados = [], emailsCompletos = [];
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT \* FROM eventos WHERE id=\$1/.test(sql)) return { rows: [{ id: 5, nome: 'Jornada' }] };
      if (/LOWER\(nome\) LIKE LOWER\(\$2\)/.test(sql)) {
        // simula o ILIKE por trecho de nome/e-mail da rota de reenvio avulso
        const termo = (params[1] || '').replace(/%/g, '').toLowerCase();
        return { rows: inscritos.filter(i => (i.nome||'').toLowerCase().includes(termo) || (i.email||'').toLowerCase().includes(termo)) };
      }
      if (/SELECT \* FROM evento_inscricoes WHERE evento_id=\$1 AND status='confirmado'/.test(sql)) return { rows: inscritos };
      // 19/08/2026: a query real agora tem "WHERE ativo=1 AND pendente=false" — o dublê aplica
      // esse mesmo filtro nos fixtures (em vez de devolver tudo sempre), senão o teste não
      // provaria nada sobre esse WHERE (só provaria que o código "chama a query", não que ela
      // filtra certo).
      if (/SELECT cpf, email, nome FROM ligantes/.test(sql)) {
        const filtrar = /WHERE ativo=1 AND pendente=false/.test(sql);
        return { rows: filtrar ? ligantes.filter(l => l.ativo !== 0 && l.pendente !== true) : ligantes };
      }
      if (/SELECT cpf, email, nome FROM diretivos/.test(sql)) {
        const filtrar = /WHERE ativo=1 AND pendente=false/.test(sql);
        return { rows: filtrar ? diretivos.filter(d => d.ativo !== 0 && d.pendente !== true) : diretivos };
      }
      // resolverDiaTransmissao: dia de hoje / dia mais próximo (mesma lógica usada por /live)
      if (/WHERE evento_id=\$1 AND data=CURRENT_DATE/.test(sql)) return { rows: hojeProgramacao ? [hojeProgramacao] : [] };
      if (/WHERE evento_id=\$1 AND data IS NOT NULL ORDER BY ABS/.test(sql)) return { rows: [] };
      // ordinal do dia (Día 1 de N) — diaAtualParaEnvioLive
      if (/SELECT id FROM evento_programacao WHERE evento_id=\$1 AND data IS NOT NULL ORDER BY data/.test(sql)) return { rows: diasComData };
      if (/SELECT token FROM evento_presencas_online/.test(sql)) return { rows: [] };
      if (/INSERT INTO evento_presencas_online/.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({ org_nome: 'LAURO' }) } };
  const re = require.resolve(path.join(RAIZ, 'src/services/email.js'));
  require.cache[re] = { id: re, filename: re, loaded: true, exports: { enviarEmail: async () => {}, emailBonito: () => '' } };
  const rpg = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  require.cache[rpg] = { id: rpg, filename: rpg, loaded: true, exports: { criarPixEvento: async () => ({}), consultarPagamento: async () => ({}), obterChavePublica: async () => ({}), pagarComCartao: async () => ({}) } };
  const rev = require.resolve(path.join(RAIZ, 'src/services/eventos-email.js'));
  require.cache[rev] = { id: rev, filename: rev, loaded: true, exports: { enviarEmailConfirmacaoEvento: async () => {}, TEXTO_CONFIRMACAO_PADRAO: 'x' } };
  const rrl = require.resolve(path.join(RAIZ, 'src/services/rate-limiters.js'));
  require.cache[rrl] = { id: rrl, filename: rrl, loaded: true, exports: { limiterPagamentoCartao: (q,s,n)=>n() } };
  const rfx = require.resolve(path.join(RAIZ, 'src/services/fluxo-eventos.js'));
  require.cache[rfx] = { id: rfx, filename: rfx, loaded: true, exports: { calcularLiquidoEvento: (v) => v } };
  const wppMsgs = [];
  const rnt = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rnt] = { id: rnt, filename: rnt, loaded: true, exports: {
    enviarWhatsApp: async (numero, msg) => { wppEnviados.push(numero); wppMsgs.push(msg); },
    enviarEmail: async (opts) => { emailEnviados.push(opts.para); emailsCompletos.push(opts); }
  }};

  const rotas = {};
  const router = { get: (rota, ...fns) => { rotas['GET '+rota] = fns[fns.length-1]; }, post: (rota, ...fns) => { rotas['POST '+rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, wppEnviados, emailEnviados, wppMsgs, emailsCompletos };
}

function resJson() { const r = {}; r.json = (b) => { r._body = b; return r; }; return r; }

const INSCRITOS = [
  { id: 1, nome: 'Ana Externa', email: 'ana@x.com', whatsapp: '595111', cpf: '', status: 'confirmado' },
  { id: 2, nome: 'Bruno Ligante', email: 'bruno@x.com', whatsapp: '595222', cpf: '111.222.333-44', status: 'confirmado' },
  { id: 3, nome: 'Carla Diretiva', email: 'carla@x.com', whatsapp: '595333', cpf: '555.666.777-88', status: 'confirmado' }
];
const LIGANTES = [{ cpf: '11122233344', email: 'bruno@x.com' }]; // mesmo CPF do Bruno, sem pontuação
const DIRETIVOS = [{ cpf: '55566677788', email: 'carla@x.com' }];

test('filtro "todos": envia pra todo mundo confirmado, sem checar ligante/diretivo', async () => {
  const { rotas, wppEnviados } = montar({ inscritos: INSCRITOS, ligantes: LIGANTES, diretivos: DIRETIVOS });
  const res = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: { filtro: 'todos' } }, res);
  assert.strictEqual(wppEnviados.length, 3);
});

test('filtro "ligantes": só quem bate CPF/email com a tabela ligantes, mesmo com CPF formatado diferente', async () => {
  const { rotas, wppEnviados } = montar({ inscritos: INSCRITOS, ligantes: LIGANTES, diretivos: DIRETIVOS });
  const res = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: { filtro: 'ligantes' } }, res);
  assert.strictEqual(wppEnviados.length, 1);
  assert.strictEqual(wppEnviados[0], '595222', 'só o Bruno (é ligante)');
});

test('filtro "diretivos": só quem bate com a tabela diretivos', async () => {
  const { rotas, wppEnviados } = montar({ inscritos: INSCRITOS, ligantes: LIGANTES, diretivos: DIRETIVOS });
  const res = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: { filtro: 'diretivos' } }, res);
  assert.strictEqual(wppEnviados.length, 1);
  assert.strictEqual(wppEnviados[0], '595333', 'só a Carla (é diretiva)');
});

test('filtro "membros": ligantes OU diretivos, exclui só o externo puro', async () => {
  const { rotas, wppEnviados } = montar({ inscritos: INSCRITOS, ligantes: LIGANTES, diretivos: DIRETIVOS });
  const res = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: { filtro: 'membros' } }, res);
  assert.strictEqual(wppEnviados.length, 2);
  assert.ok(!wppEnviados.includes('595111'), 'Ana (externa pura) não deve receber no filtro "membros"');
});

// 19/08/2026: achado em produção — ligante/diretivo INATIVO (ou cadastro ainda pendente de
// aprovação) recebia o link igual, porque as consultas não filtravam ativo/pendente nenhum.
test('ligante INATIVO não recebe o link, mesmo com CPF/e-mail batendo (regra: inativo não recebe nada)', async () => {
  const { rotas, wppEnviados } = montar({
    inscritos: INSCRITOS,
    ligantes: [{ cpf: '11122233344', email: 'bruno@x.com', ativo: 0, pendente: false }],
    diretivos: []
  });
  const res = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: { filtro: 'ligantes' } }, res);
  assert.strictEqual(wppEnviados.length, 0, 'Bruno é ligante mas está INATIVO — não pode receber');
});

test('diretivo com cadastro PENDENTE (ainda não aprovado) não recebe o link', async () => {
  const { rotas, wppEnviados } = montar({
    inscritos: INSCRITOS,
    ligantes: [],
    diretivos: [{ cpf: '55566677788', email: 'carla@x.com', ativo: 1, pendente: true }]
  });
  const res = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: { filtro: 'diretivos' } }, res);
  assert.strictEqual(wppEnviados.length, 0, 'cadastro pendente ainda não foi aprovado — não é diretivo de verdade ainda');
});

// Caso relatado pelo usuário: alguém que TROCOU de papel (ex: era ligante, virou diretivo — ou
// o inverso) fica com um cadastro antigo INATIVO na tabela de onde saiu, e o cadastro novo ATIVO
// na tabela pra onde foi. Antes da correção, o cadastro antigo inativo ainda contava — a pessoa
// recebia o link DUAS vezes (uma por cada tabela) em vez de uma só, pelo papel atual.
test('quem trocou de papel (ligante inativo + diretivo ativo, mesmo CPF) recebe o link só UMA vez, pelo papel atual', async () => {
  const inscritos = [{ id: 9, nome: 'Renata Michelle', email: 'renata@x.com', whatsapp: '595999', cpf: '999.888.777-66', status: 'confirmado' }];
  const { rotas, wppEnviados } = montar({
    inscritos,
    ligantes: [{ cpf: '99988877766', email: 'renata@x.com', ativo: 1, pendente: false }], // papel atual: ligante
    diretivos: [{ cpf: '99988877766', email: 'renata@x.com', ativo: 0, pendente: false }] // cadastro antigo, agora inativo
  });
  const resMembros = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: { filtro: 'membros' } }, resMembros);
  assert.strictEqual(wppEnviados.length, 1, '"membros" (ligantes OU diretivos) manda só 1 vez, não 2, mesmo tendo cadastro nas duas tabelas');

  const resDiretivos = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: { filtro: 'diretivos' } }, resDiretivos);
  assert.strictEqual(resDiretivos._body.logs?.length || 0, 0, 'o cadastro de diretivo dela está INATIVO — "Só Diretivos" não pode achá-la mais');
});

// 19/08/2026 (2ª rodada): caso relatado pelo usuário — Rafael de Lima Oliveira é ligante ativo e
// estava inscrito no evento, mas não recebeu o link. Não existe vínculo de verdade (chave
// estrangeira) entre a inscrição do evento e o cadastro de ligante — a inscrição foi preenchida
// com um e-mail diferente do cadastrado como ligante, e o CPF ficou em branco (comum: o
// formulário público de inscrição não exige CPF). Nem CPF nem e-mail bateram, só o NOME — que
// virou o 3º critério de correspondência.
test('CPF em branco + e-mail diferente na inscrição, mas nome idêntico ao cadastro de ligante — ainda assim recebe (caso real: Rafael de Lima Oliveira)', async () => {
  const inscritos = [{ id: 344, nome: 'Rafael de Lima Oliveira', email: 'drrafael_oliveira@hotmail.com', whatsapp: '595777', cpf: '', status: 'confirmado' }];
  const { rotas, wppEnviados } = montar({
    inscritos,
    ligantes: [{ cpf: '00881500119', email: 'drrafaelloliveira@gmail.com', nome: 'Rafael de Lima Oliveira', ativo: 1, pendente: false }],
    diretivos: []
  });
  const res = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: { filtro: 'ligantes' } }, res);
  assert.strictEqual(wppEnviados.length, 1, 'CPF vazio e e-mail diferente não podem excluir alguém cujo nome bate exatamente com o cadastro de ligante');
});

test('nome com acento/maiúsculas diferentes ainda bate (comparação ignora acento, caixa e espaço duplicado)', async () => {
  const inscritos = [{ id: 1, nome: '  JOSÉ   ÁLVARES  ', email: 'diferente@x.com', whatsapp: '595555', cpf: '', status: 'confirmado' }];
  const { rotas, wppEnviados } = montar({
    inscritos,
    ligantes: [{ cpf: '', email: 'outro@x.com', nome: 'José Álvares', ativo: 1, pendente: false }],
    diretivos: []
  });
  const res = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: { filtro: 'ligantes' } }, res);
  assert.strictEqual(wppEnviados.length, 1);
});

test('sem filtro no body (undefined): comporta como "todos" (retrocompatível)', async () => {
  const { rotas, wppEnviados } = montar({ inscritos: INSCRITOS, ligantes: [], diretivos: [] });
  const res = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: {} }, res);
  assert.strictEqual(wppEnviados.length, 3);
});

test('conta WhatsApp e e-mail SEPARADAMENTE (antes só contava WhatsApp, mensagem final mentia)', async () => {
  const { rotas, emailEnviados } = montar({ inscritos: INSCRITOS, ligantes: [], diretivos: [] });
  const res = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: { filtro: 'todos' } }, res);
  assert.strictEqual(emailEnviados.length, 3);
  assert.match(res._body.msg, /3 WhatsApp e 3 e-mails/);
});

// 17/08/2026: pedido do usuário — gente reclamando que não recebeu o link, sem forma de
// identificar quem recebeu de fato nem de reenviar só pra uma pessoa. A resposta do envio em
// massa agora traz "logs" por pessoa (pra montar a tela de "quem recebeu"), e existe uma rota
// de reenvio avulso por nome/e-mail.
test('resposta do envio em massa traz "logs" com o status de cada pessoa (WhatsApp e e-mail)', async () => {
  const { rotas } = montar({ inscritos: INSCRITOS, ligantes: [], diretivos: [] });
  const res = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: { filtro: 'todos' } }, res);
  assert.strictEqual(res._body.logs.length, 3);
  const ana = res._body.logs.find(l => l.nome === 'Ana Externa');
  assert.strictEqual(ana.wppStatus, 'enviado');
  assert.strictEqual(ana.emailStatus, 'enviado');
});

test('reenviar-link-live: busca por trecho do nome (case-insensitive) e reenvia só pra quem bate', async () => {
  const { rotas, wppEnviados, emailEnviados } = montar({ inscritos: INSCRITOS, ligantes: [], diretivos: [] });
  const res = resJson();
  await rotas['POST /eventos/:id/reenviar-link-live']({ params: { id: '5' }, body: { busca: 'carla' } }, res);
  assert.strictEqual(res._body.ok, true);
  assert.strictEqual(wppEnviados.length, 1);
  assert.strictEqual(wppEnviados[0], '595333');
  assert.strictEqual(emailEnviados[0], 'carla@x.com');
  assert.strictEqual(res._body.logs.length, 1);
});

test('reenviar-link-live: busca por e-mail também funciona', async () => {
  const { rotas, wppEnviados } = montar({ inscritos: INSCRITOS, ligantes: [], diretivos: [] });
  const res = resJson();
  await rotas['POST /eventos/:id/reenviar-link-live']({ params: { id: '5' }, body: { busca: 'bruno@x.com' } }, res);
  assert.strictEqual(wppEnviados.length, 1);
  assert.strictEqual(wppEnviados[0], '595222');
});

test('reenviar-link-live: ninguém encontrado — não quebra, avisa e não envia nada', async () => {
  const { rotas, wppEnviados, emailEnviados } = montar({ inscritos: INSCRITOS, ligantes: [], diretivos: [] });
  const res = resJson();
  await rotas['POST /eventos/:id/reenviar-link-live']({ params: { id: '5' }, body: { busca: 'ninguem-com-esse-nome' } }, res);
  assert.strictEqual(res._body.ok, false);
  assert.strictEqual(wppEnviados.length, 0);
  assert.strictEqual(emailEnviados.length, 0);
});

test('reenviar-link-live: busca vazia não faz nada, avisa pra digitar', async () => {
  const { rotas, wppEnviados } = montar({ inscritos: INSCRITOS, ligantes: [], diretivos: [] });
  const res = resJson();
  await rotas['POST /eventos/:id/reenviar-link-live']({ params: { id: '5' }, body: { busca: '' } }, res);
  assert.strictEqual(res._body.ok, false);
  assert.strictEqual(wppEnviados.length, 0);
});

// 17/08/2026: pedido do usuário — o e-mail (e o WhatsApp) do link de acesso não dizia qual dia
// do evento era, virando "Segunda Jornada" solto na caixa de entrada — impossível saber se era
// dia 1, 2, 3 ou 4, nem qual o tema daquela aula específica. Agora o dia (Dia X de N — data) e
// o tema entram no assunto, na faixa do topo e no corpo do e-mail, e no texto do WhatsApp.
test('evento com Programação por data: e-mail e WhatsApp saem com "Dia X de N", a data e o tema da aula', async () => {
  const { rotas, emailsCompletos, wppMsgs } = montar({
    inscritos: [INSCRITOS[0]],
    hojeProgramacao: { id: 10, titulo: 'Promoción y Prevención de la Salud del Hombre', youtube_url: 'https://youtube.com/live/abc', data: '2026-08-17' },
    diasComData: [{ id: 9 }, { id: 10 }, { id: 11 }, { id: 12 }] // dia 10 é o 2º da lista
  });
  const res = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: { filtro: 'todos' } }, res);
  const email = emailsCompletos[0];
  assert.match(email.assunto, /Dia 2 de 4/, 'assunto (visível na caixa de entrada sem abrir o e-mail) precisa dizer qual dia é');
  assert.match(email.assunto, /17\/08\/2026/);
  assert.match(email.faixaLabel, /Dia 2 de 4/, 'faixa do topo do e-mail também mostra o dia');
  assert.match(email.html, /Promoción y Prevención de la Salud del Hombre/, 'corpo do e-mail mostra o tema da aula');
  assert.match(wppMsgs[0], /Dia 2 de 4/, 'WhatsApp também informa o dia');
  assert.match(wppMsgs[0], /Promoción y Prevención de la Salud del Hombre/, 'WhatsApp também informa o tema');
});

test('evento legado (sem Programação por data): e-mail continua saindo normal, sem "Dia X de N" nenhum', async () => {
  const { rotas, emailsCompletos } = montar({
    inscritos: [INSCRITOS[0]],
    hojeProgramacao: null,
    diasComData: []
  });
  const res = resJson();
  await rotas['POST /eventos/:id/enviar-link-live']({ params: { id: '5' }, body: { filtro: 'todos' } }, res);
  const email = emailsCompletos[0];
  assert.ok(!/Dia \d+ de \d+/.test(email.assunto), 'evento sem dias cadastrados não inventa um "Dia X de N"');
  assert.strictEqual(email.faixaLabel, 'LINK DE ACESSO');
});
