// 11/08/2026: "gerar cupons para ligantes" dizia filtrar só quem está "em dia", mas o
// cálculo de atraso era descartado — TODO ligante ativo recebia cupom, inadimplente
// inclusive. Regra combinada com o usuário: ligante com 2+ mensalidades atrasadas NÃO
// recebe; com 0 ou 1 atrasada, recebe normalmente. Ligante não tem cobrança própria — o
// vínculo com o financeiro (membros/cobrancas) é por CPF ou e-mail, mesmo padrão já usado
// em ligantes.js pra sincronizar as duas tabelas.
//
// Achado no mesmo dia, na prática: o formulário postava pra /cupons/gerar-ligantes, que era
// uma rota MORTA (nunca respondia nada) — o nginx esperava até o timeout e devolvia 504.
// A rota "-v2" (com a lógica de verdade) nunca era alcançada. Corrigido consolidando as duas
// na rota certa e movendo o envio (cupom + WhatsApp/email de cada pessoa) pra depois da
// resposta HTTP já ter saído — 48+ envios sequenciais também já estourava o tempo sozinho.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MODULO = path.join(RAIZ, 'src/routes/eventos.js');

function montar({ ligantes, diretivos, atrasosPorCpfOuEmail, jaExistentes }) {
  const cupomInserts = [];
  const notificadoUpdates = []; // id (ligante_id ou diretivo_id) que teve notificado_em marcado nessa rodada
  const wppEnviados = [];
  const emailEnviados = [];
  // simula unicidade real do banco + a coluna notificado_em (controla quem já recebeu de fato).
  // Chave composta tipo:id — ligante e diretivo são tabelas/sequências diferentes, então um
  // ligante id=1 e um diretivo id=1 são pessoas distintas, não podem colidir no mock.
  const chave = (tipo, id) => tipo + ':' + id;
  const existentes = new Map((jaExistentes || []).map(e => {
    const tipo = e.diretivo_id !== undefined ? 'diretivo' : 'ligante';
    const id = e.diretivo_id !== undefined ? e.diretivo_id : e.ligante_id;
    return [chave(tipo, id), { codigo: e.codigo, notificado_em: e.notificado_em || null }];
  }));
  const rq = require.resolve(path.join(RAIZ, 'src/models/database.js'));
  require.cache[rq] = { id: rq, filename: rq, loaded: true, exports: {
    query: async (sql, params) => {
      if (/SELECT id, nome, email, whatsapp, cpf, 'ligante' as tipo FROM ligantes/.test(sql)) {
        return { rows: ligantes || [] };
      }
      if (/SELECT id, nome, email, whatsapp, cpf, 'diretivo' as tipo FROM diretivos/.test(sql)) {
        return { rows: diretivos || [] };
      }
      if (/FROM cobrancas c JOIN membros m ON m\.id = c\.membro_id/.test(sql)) {
        const [cpf, email] = params;
        const k = (cpf && cpf !== '') ? cpf : email;
        return { rows: [{ n: String((atrasosPorCpfOuEmail && atrasosPorCpfOuEmail[k]) || 0) }] };
      }
      if (/SELECT \* FROM eventos WHERE id=\$1/.test(sql)) return { rows: [{ id: 1, nome: 'Congresso Teste' }] };
      if (/SELECT chave,valor FROM configuracoes/.test(sql)) return { rows: [] };
      if (/SELECT codigo, notificado_em FROM evento_cupons WHERE evento_id=\$1 AND (ligante_id|diretivo_id)=\$2/.test(sql)) {
        const tipo = sql.includes('diretivo_id') ? 'diretivo' : 'ligante';
        const [, id] = params;
        const k = chave(tipo, id);
        return existentes.has(k) ? { rows: [existentes.get(k)] } : { rows: [] };
      }
      if (/SELECT codigo FROM evento_cupons WHERE evento_id=\$1 AND \(ligante_id IS NOT NULL OR diretivo_id IS NOT NULL\)/.test(sql)) {
        return { rows: Array.from(existentes.values()).map(v => ({ codigo: v.codigo })) };
      }
      if (/INSERT INTO evento_cupons/.test(sql)) {
        cupomInserts.push(params);
        const tipo = sql.includes('diretivo_id') ? 'diretivo' : 'ligante';
        const [, codigo, id] = params;
        const k = chave(tipo, id);
        if (existentes.has(k)) return { rows: [] }; // ON CONFLICT ... DO NOTHING
        existentes.set(k, { codigo, notificado_em: null });
        return { rows: [{ codigo }] };
      }
      if (/UPDATE evento_cupons SET notificado_em=NOW\(\) WHERE evento_id=\$1 AND (ligante_id|diretivo_id)=\$2/.test(sql)) {
        const tipo = sql.includes('diretivo_id') ? 'diretivo' : 'ligante';
        const [, id] = params;
        notificadoUpdates.push(id);
        const k = chave(tipo, id);
        if (existentes.has(k)) existentes.get(k).notificado_em = new Date();
        return { rows: [] };
      }
      return { rows: [] };
    }
  }};
  const rau = require.resolve(path.join(RAIZ, 'src/middleware/auth.js'));
  require.cache[rau] = { id: rau, filename: rau, loaded: true, exports: { requireAuth: (q,s,n)=>n(), requireAdmin: (q,s,n)=>n(), requirePermissao: () => (q,s,n)=>n() } };
  const rcfg = require.resolve(path.join(RAIZ, 'src/services/config.js'));
  require.cache[rcfg] = { id: rcfg, filename: rcfg, loaded: true, exports: { getConfig: async () => ({}) } };
  const re = require.resolve(path.join(RAIZ, 'src/services/email.js'));
  require.cache[re] = { id: re, filename: re, loaded: true, exports: { enviarEmail: async () => {}, emailBonito: () => '' } };
  const rev = require.resolve(path.join(RAIZ, 'src/services/eventos-email.js'));
  require.cache[rev] = { id: rev, filename: rev, loaded: true, exports: { enviarEmailConfirmacaoEvento: async () => {}, TEXTO_CONFIRMACAO_PADRAO: 'x' } };
  const rpg = require.resolve(path.join(RAIZ, 'src/services/pagbank.js'));
  require.cache[rpg] = { id: rpg, filename: rpg, loaded: true, exports: { criarPixEvento: async () => ({}), consultarPagamento: async () => ({}), obterChavePublica: async () => ({}), pagarComCartao: async () => ({}) } };
  const rnt = require.resolve(path.join(RAIZ, 'src/services/notificacoes.js'));
  require.cache[rnt] = { id: rnt, filename: rnt, loaded: true, exports: {
    enviarWhatsApp: async (numero) => { wppEnviados.push(numero); },
    enviarEmail: async (opts) => { emailEnviados.push(opts.para); }
  }};

  const rotas = {};
  const router = { get: () => {}, post: (rota, ...fns) => { rotas[rota] = fns[fns.length-1]; } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO)(router);
  return { rotas, cupomInserts, notificadoUpdates, wppEnviados, emailEnviados };
}

function resRedirect() {
  const r = { _redirect: null };
  r.redirect = (url) => { r._redirect = url; return r; };
  return r;
}

const ligantes = [
  { id: 1, nome: 'Zero atrasos', email: 'zero@x.com', whatsapp: null, cpf: '11111111111', tipo: 'ligante' },
  { id: 2, nome: 'Um atraso', email: 'um@x.com', whatsapp: null, cpf: '22222222222', tipo: 'ligante' },
  { id: 3, nome: 'Dois atrasos', email: 'dois@x.com', whatsapp: null, cpf: '33333333333', tipo: 'ligante' },
  { id: 4, nome: 'Tres atrasos', email: 'tres@x.com', whatsapp: null, cpf: '44444444444', tipo: 'ligante' }
];

function esperarSegundoPlano() { return new Promise(r => setTimeout(r, 30)); }

test('a rota responde na hora (não fica presa esperando os envios) — era a causa do 504', async () => {
  const { rotas } = montar({ ligantes, atrasosPorCpfOuEmail: {} });
  const req = { params: { id: '1' }, body: { prefixo: 'TESTE', destino: 'ligantes', enviar_wpp: 'off', enviar_email: 'off' }, session: {} };
  const res = resRedirect();
  await rotas['/eventos/:id/cupons/gerar-ligantes'](req, res);
  assert.strictEqual(res._redirect, '/eventos/1?tab=cupons', 'responde e redireciona antes de mandar qualquer WhatsApp/e-mail');
  assert.ok(req.session.msg[0].includes('segundo plano'), 'avisa que o envio continua em segundo plano');
  await esperarSegundoPlano();
});

test('0 ou 1 mensalidade atrasada recebe cupom; 2+ não recebe', async () => {
  const { rotas, cupomInserts } = montar({
    ligantes,
    atrasosPorCpfOuEmail: { '11111111111': 0, '22222222222': 1, '33333333333': 2, '44444444444': 3 }
  });
  const req = { params: { id: '1' }, body: { prefixo: 'TESTE', destino: 'ligantes', enviar_wpp: 'off', enviar_email: 'off' }, session: {} };
  const res = resRedirect();
  await rotas['/eventos/:id/cupons/gerar-ligantes'](req, res);
  await esperarSegundoPlano();

  const idsComCupom = cupomInserts.map(p => p[2]); // [eventoId, codigo, ligante_id]
  assert.deepStrictEqual(idsComCupom.sort(), [1, 2], 'só quem tem 0 ou 1 atraso pode receber cupom');
});

test('quem já tem cupom pro evento não ganha um segundo — reaproveita o código existente', async () => {
  const { rotas, cupomInserts } = montar({
    ligantes: [ligantes[0]],
    atrasosPorCpfOuEmail: { '11111111111': 0 },
    jaExistentes: [{ ligante_id: 1, codigo: 'TESTE-JAEXISTE', notificado_em: new Date() }]
  });
  const req = { params: { id: '1' }, body: { prefixo: 'TESTE', destino: 'ligantes', enviar_wpp: 'off', enviar_email: 'off' }, session: {} };
  await rotas['/eventos/:id/cupons/gerar-ligantes'](req, resRedirect());
  await esperarSegundoPlano();
  assert.strictEqual(cupomInserts.length, 0, 'não insere linha nova pra quem já tinha cupom nesse evento');
});

// 16/08/2026: pedido do usuário — botão de "sincronizar" pra rodar de novo depois que alguém
// bloqueado (2+ atrasos) quita a dívida e passa a ser elegível. Regra explícita: quem já
// recebeu o cupom NUNCA pode receber de novo nessa sincronia; só quem nunca foi notificado
// (novo elegível, ou cupom criado sem conseguir enviar da 1ª vez) recebe.
test('sincronizar: quem já recebeu o cupom (notificado_em setado) NÃO recebe WhatsApp/email de novo', async () => {
  const { rotas, wppEnviados, emailEnviados, notificadoUpdates } = montar({
    ligantes: [ligantes[0]], // 'Zero atrasos', tem whatsapp? não — usa email
    atrasosPorCpfOuEmail: { '11111111111': 0 },
    jaExistentes: [{ ligante_id: 1, codigo: 'TESTE-JAENVIADO', notificado_em: new Date('2026-08-01') }]
  });
  const req = { params: { id: '1' }, body: { prefixo: 'TESTE', destino: 'ligantes', enviar_wpp: 'on', enviar_email: 'on' }, session: {} };
  await rotas['/eventos/:id/cupons/gerar-ligantes'](req, resRedirect());
  await esperarSegundoPlano();
  assert.strictEqual(emailEnviados.length, 0, 'já tinha notificado_em — não reenvia');
  assert.strictEqual(wppEnviados.length, 0, 'já tinha notificado_em — não reenvia');
  assert.strictEqual(notificadoUpdates.length, 0, 'não mexe no notificado_em de quem já tinha');
});

// 16/08/2026: pedido do usuário — o prefixo é do EVENTO, não do clique. Sincronizar um evento
// cujos cupons já existentes são "JORNADA-..." tem que continuar gerando "JORNADA-...", mesmo
// que o campo do formulário tenha ficado com o valor padrão "LAURO" (bug real: 2 pessoas
// receberam cupom LAURO- num evento onde os outros 57 eram JORNADA-).
test('sincronizar: usa o prefixo já estabelecido do evento, ignora o texto digitado no formulário', async () => {
  const novoElegivel = { ...ligantes[2], id: 3 };
  const { rotas, cupomInserts } = montar({
    ligantes: [novoElegivel],
    atrasosPorCpfOuEmail: { '33333333333': 1 },
    jaExistentes: [
      { ligante_id: 10, codigo: 'JORNADA-AAAAAA', notificado_em: new Date() },
      { ligante_id: 11, codigo: 'JORNADA-BBBBBB', notificado_em: new Date() }
    ]
  });
  // formulário mandou "LAURO" (valor padrão) mesmo o evento já usando "JORNADA"
  const req = { params: { id: '1' }, body: { prefixo: 'LAURO', destino: 'ligantes', enviar_wpp: 'off', enviar_email: 'off' }, session: {} };
  await rotas['/eventos/:id/cupons/gerar-ligantes'](req, resRedirect());
  await esperarSegundoPlano();
  assert.strictEqual(cupomInserts.length, 1);
  assert.match(cupomInserts[0][1], /^JORNADA-/, 'segue o prefixo já estabelecido do evento, não o texto do formulário');
});

test('1ª geração (evento sem nenhum cupom ainda) usa o prefixo digitado no formulário', async () => {
  const { rotas, cupomInserts } = montar({
    ligantes: [ligantes[0]],
    atrasosPorCpfOuEmail: { '11111111111': 0 }
  });
  const req = { params: { id: '1' }, body: { prefixo: 'CONGRESSO', destino: 'ligantes', enviar_wpp: 'off', enviar_email: 'off' }, session: {} };
  await rotas['/eventos/:id/cupons/gerar-ligantes'](req, resRedirect());
  await esperarSegundoPlano();
  assert.match(cupomInserts[0][1], /^CONGRESSO-/, 'sem histórico prévio, usa o que foi digitado');
});

test('sincronizar: ligante que quitou o atraso e NUNCA recebeu cupom (bloqueado antes) recebe normalmente, e só ele', async () => {
  const jaRecebeu = { ...ligantes[0], id: 1 }; // já tinha cupom + notificado_em
  const novoElegivel = { ...ligantes[2], id: 3 }; // 'Dois atrasos' na fixture, mas agora quitou pra 1
  const { rotas, wppEnviados: _w, emailEnviados, notificadoUpdates, cupomInserts } = montar({
    ligantes: [jaRecebeu, novoElegivel],
    atrasosPorCpfOuEmail: { '11111111111': 0, '33333333333': 1 }, // ambos elegíveis agora (<=1)
    jaExistentes: [{ ligante_id: 1, codigo: 'TESTE-JAENVIADO', notificado_em: new Date('2026-08-01') }]
  });
  const req = { params: { id: '1' }, body: { prefixo: 'TESTE', destino: 'ligantes', enviar_wpp: 'off', enviar_email: 'on' }, session: {} };
  await rotas['/eventos/:id/cupons/gerar-ligantes'](req, resRedirect());
  await esperarSegundoPlano();
  assert.deepStrictEqual(cupomInserts.map(p => p[2]), [3], 'só cria cupom novo pro que nunca tinha recebido');
  assert.deepStrictEqual(emailEnviados, ['dois@x.com'], 'só o recém-elegível recebe o e-mail');
  assert.deepStrictEqual(notificadoUpdates, [3], 'notificado_em só é marcado pra quem recebeu agora');
});

// 17/08/2026: pedido do usuário — diretivo passava batido sem o crivo de atraso (entrava todo
// diretivo ativo, inadimplente inclusive), e por isso também nunca dava pra "sincronizar" um
// diretivo novo que ainda não tinha recebido cupom. Mesma regra do ligante: 0 ou 1 atraso
// recebe, 2+ não.
const diretivos = [
  { id: 1, nome: 'Diretiva Nova', email: 'nova@x.com', whatsapp: null, cpf: '55555555555', tipo: 'diretivo' },
  { id: 2, nome: 'Diretivo Um Atraso', email: 'umd@x.com', whatsapp: null, cpf: '66666666666', tipo: 'diretivo' },
  { id: 3, nome: 'Diretivo Dois Atrasos', email: 'doisd@x.com', whatsapp: null, cpf: '77777777777', tipo: 'diretivo' }
];

test('destino=diretivos: 0 ou 1 mensalidade atrasada recebe cupom; 2+ não recebe (mesma regra do ligante)', async () => {
  const { rotas, cupomInserts } = montar({
    diretivos,
    atrasosPorCpfOuEmail: { '55555555555': 0, '66666666666': 1, '77777777777': 2 }
  });
  const req = { params: { id: '1' }, body: { prefixo: 'TESTE', destino: 'diretivos', enviar_wpp: 'off', enviar_email: 'off' }, session: {} };
  await rotas['/eventos/:id/cupons/gerar-ligantes'](req, resRedirect());
  await esperarSegundoPlano();
  const idsComCupom = cupomInserts.map(p => p[2]);
  assert.deepStrictEqual(idsComCupom.sort(), [1, 2], 'só a diretiva nova (0 atrasos) e a de 1 atraso recebem — a de 2+ fica bloqueada');
});

test('destino=diretivos, sincronizar: diretiva nova que nunca recebeu cupom recebe agora, sem mexer em quem já tinha', async () => {
  const jaRecebeu = { ...diretivos[1], id: 2 }; // já tinha cupom + notificado_em
  const diretivaNova = { ...diretivos[0], id: 1 }; // acabou de entrar, nunca recebeu
  const { rotas, emailEnviados, notificadoUpdates, cupomInserts } = montar({
    diretivos: [jaRecebeu, diretivaNova],
    atrasosPorCpfOuEmail: { '55555555555': 0, '66666666666': 0 },
    jaExistentes: [{ diretivo_id: 2, codigo: 'TESTE-JAENVIADO', notificado_em: new Date('2026-08-01') }]
  });
  const req = { params: { id: '1' }, body: { prefixo: 'TESTE', destino: 'diretivos', enviar_wpp: 'off', enviar_email: 'on' }, session: {} };
  await rotas['/eventos/:id/cupons/gerar-ligantes'](req, resRedirect());
  await esperarSegundoPlano();
  assert.deepStrictEqual(cupomInserts.map(p => p[2]), [1], 'só cria cupom novo pra diretiva que nunca tinha recebido');
  assert.deepStrictEqual(emailEnviados, ['nova@x.com'], 'só a diretiva nova recebe o e-mail');
  assert.deepStrictEqual(notificadoUpdates, [1], 'notificado_em só é marcado pra quem recebeu agora');
});

test('destino=todos: aplica o crivo de atraso tanto pra ligante quanto pra diretivo, ao mesmo tempo', async () => {
  const { rotas, cupomInserts, emailEnviados } = montar({
    ligantes: [ligantes[0], ligantes[2]], // zero atrasos (passa), dois atrasos (bloqueado)
    diretivos: [diretivos[0], diretivos[2]], // zero atrasos (passa), dois atrasos (bloqueado)
    atrasosPorCpfOuEmail: { '11111111111': 0, '33333333333': 2, '55555555555': 0, '77777777777': 2 }
  });
  const req = { params: { id: '1' }, body: { prefixo: 'TESTE', destino: 'todos', enviar_wpp: 'off', enviar_email: 'on' }, session: {} };
  await rotas['/eventos/:id/cupons/gerar-ligantes'](req, resRedirect());
  await esperarSegundoPlano();
  assert.strictEqual(cupomInserts.length, 2, 'exatamente os 2 elegíveis, um de cada tipo — os 2 bloqueados (2+ atrasos) ficam de fora');
  assert.deepStrictEqual(emailEnviados.sort(), ['nova@x.com', 'zero@x.com'], 'o ligante e o diretivo em dia recebem — os dois bloqueados nem aparecem aqui');
});
