// Testes de fumaça: sobem os fluxos que doem se quebrarem.
// Rodam SEMPRE contra o staging, NUNCA contra a produção (trava abaixo).
//
//   npm test                 -> usa https://sistema-teste.lauroucpcde.com
//   BASE_URL=... npm test
//
// Precisam de banco (o seed cria um admin e um ligante de teste no banco alvo) e,
// como o staging fica atrás de senha no nginx, de STAGING_AUTH no .env dele.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const { query } = require('../src/models/database');

// Por HTTPS de propósito: o cookie de sessão é `secure` (server.js), então por HTTP
// ele nem é aceito — não haveria sessão e todo POST cairia no CSRF (403).
const BASE = process.env.BASE_URL || 'https://sistema-teste.lauroucpcde.com';

// ─── TRAVA: nunca rodar contra produção ───────────────────────────────────────
// Um teste que apaga/aprova coisas no banco real seria catastrófico.
const ALVO_PROIBIDO = /:3000|\/\/sistema\.lauroucpcde\.com/;
if (ALVO_PROIBIDO.test(BASE)) {
  console.error('\n  ABORTADO: ' + BASE + ' parece ser a PRODUÇÃO.\n  Os testes escrevem no banco. Use o staging.\n');
  process.exit(1);
}

// O staging fica atrás de senha no nginx (STAGING_AUTH="usuario:senha" no .env dele).
const AUTH = process.env.STAGING_AUTH
  ? { Authorization: 'Basic ' + Buffer.from(process.env.STAGING_AUTH).toString('base64') }
  : {};

const ADMIN = { email: 'smoke-admin@staging.local', senha: 'smoke-' + Math.random().toString(36).slice(2) };
const MEMBRO_SENHA = 'smoke-' + Math.random().toString(36).slice(2);
let ligante = null;

// ─── helpers: sessão com cookie + token CSRF ──────────────────────────────────
function criarSessao() {
  let cookie = '';
  const guardaCookie = (res) => {
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (set.length) cookie = set.map(c => c.split(';')[0]).join('; ');
  };
  return {
    get cookie() { return cookie; },
    async get(path) {
      const res = await fetch(BASE + path, { headers: { ...AUTH, cookie }, redirect: 'manual' });
      guardaCookie(res);
      return res;
    },
    // O CSRF do sistema injeta o token num <script> da página; pegamos de lá.
    async token(path = '/login') {
      const res = await this.get(path);
      const html = await res.text();
      const m = html.match(/var CSRF_TOKEN="([^"]+)"/);
      assert.ok(m, 'não achei o token CSRF em ' + path + ' (HTTP ' + res.status + ')');
      return m[1];
    },
    async post(path, dados, origem = '/login') {
      const csrf = await this.token(origem);
      const res = await fetch(BASE + path, {
        method: 'POST', redirect: 'manual',
        headers: { ...AUTH, cookie, 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': csrf },
        body: new URLSearchParams(dados).toString()
      });
      guardaCookie(res);
      return res;
    }
  };
}
const req = (path, opts = {}) => fetch(BASE + path, { ...opts, headers: { ...AUTH, ...(opts.headers || {}) } });

before(async () => {
  const db = (await query('SELECT current_database() AS d')).rows[0].d;
  assert.ok(!/^ligadb$/.test(db), 'ABORTADO: o banco é a PRODUÇÃO (' + db + ')');

  // admin de teste
  const hash = await bcrypt.hash(ADMIN.senha, 10);
  await query(`INSERT INTO usuarios (nome,email,senha,perfil,ativo) VALUES ('Smoke Test',$1,$2,'admin',1)
               ON CONFLICT (email) DO UPDATE SET senha=$2, ativo=1, perfil='admin'`, [ADMIN.email, hash]);

  // um ligante ativo com edição liberada, p/ exercitar a correção de cadastro
  const l = await query("SELECT id, email FROM ligantes WHERE ativo=1 AND pendente=false ORDER BY id LIMIT 1");
  assert.ok(l.rows.length, 'o banco de staging não tem nenhum ligante ativo');
  ligante = l.rows[0];
  await query('UPDATE ligantes SET edicao_liberada=true WHERE id=$1', [ligante.id]);
  await query("DELETE FROM cadastro_correcoes WHERE origem_tipo='ligante' AND origem_id=$1 AND status='pendente'", [ligante.id]);
  const mh = await bcrypt.hash(MEMBRO_SENHA, 10);
  await query(`INSERT INTO portal_cientifico_senhas (origem_tipo, origem_id, senha_hash, primeiro_acesso)
               VALUES ('ligante',$1,$2,false)
               ON CONFLICT (origem_tipo, origem_id) DO UPDATE SET senha_hash=$2, primeiro_acesso=false`, [ligante.id, mh]);
});

after(async () => {
  await query('DELETE FROM usuarios WHERE email=$1', [ADMIN.email]);
});

// ─── o app está de pé ─────────────────────────────────────────────────────────
test('o sistema responde', async () => {
  const r = await req('/health');
  assert.equal(r.status, 200);
});

// ─── login do painel ──────────────────────────────────────────────────────────
test('login do admin funciona (e senha errada é recusada)', async () => {
  const errada = criarSessao();
  const r1 = await errada.post('/login', { email: ADMIN.email, senha: 'nao-e-essa' });
  const dest1 = r1.headers.get('location') || '';
  // 429 = o rate limit do login barrou antes; também é uma recusa válida.
  assert.ok(dest1.includes('/login') || r1.status === 429, 'senha errada deveria ser recusada (deu ' + r1.status + ' -> ' + dest1 + ')');

  const s = criarSessao();
  const r2 = await s.post('/login', ADMIN);
  assert.notEqual(r2.status, 429, 'rate limit do login estourou — reinicie o staging antes de testar');
  const dest2 = r2.headers.get('location') || '';
  assert.ok(!dest2.includes('/login'), 'login correto não deveria voltar p/ o login (foi p/ ' + dest2 + ')');
});

// ─── as telas do dia a dia abrem ──────────────────────────────────────────────
test('as telas principais do painel carregam', async () => {
  const s = criarSessao();
  await s.post('/login', ADMIN);
  const telas = ['/dashboard', '/ligantes', '/diretivos', '/cobrancas', '/calendario', '/correcoes-cadastro', '/eventos',
                 '/processo-seletivo', '/inscricoes-pss', '/sorteios', '/lista-assinaturas', '/fluxo-caixa', '/desvinculacoes', '/contratos', '/comunicados', '/carta-cobranca', '/carta-notificacao', '/palestrantes', '/assistente-virtual'];
  for (const t of telas) {
    const r = await s.get(t);
    // 200 exigido: aceitar 302 faria este teste passar mesmo com o login quebrado.
    assert.equal(r.status, 200, t + ' devolveu ' + r.status + ' (esperado 200, já logado)');
  }
});

// ─── a sidebar precisa vir INTEIRA em toda tela do painel ─────────────────────
// Se a rota esquecer de passar `usuario`, o partial cai p/ perfil 'visualizador':
// some metade do menu e o rodapé (nome/sair). Foi o que aconteceu em /comunicados.
test('a sidebar vem completa (menu de admin + rodapé) em todas as telas', async () => {
  const s = criarSessao();
  await s.post('/login', ADMIN);
  for (const tela of ['/comunicados', '/dashboard', '/ligantes', '/cobrancas']) {
    const html = await (await s.get(tela)).text();
    assert.ok(html.includes('sidebar-user'), tela + ': o rodapé da sidebar (nome/sair) sumiu');
    assert.ok(html.includes('/usuarios'), tela + ': os itens de admin do menu sumiram');
  }
});

// ─── proteções ────────────────────────────────────────────────────────────────
test('sem login, o painel redireciona para o login', async () => {
  const r = await req('/ligantes', { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.ok((r.headers.get('location') || '').includes('/login'));
});

test('CSRF bloqueia POST sem token', async () => {
  const r = await req('/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'email=x@x.com&senha=x'
  });
  assert.equal(r.status, 403, 'POST sem CSRF deveria dar 403');
});

// ─── processo seletivo (domínio extraído p/ routes/processo-seletivo.js) ──────
test('processo seletivo: a página pública de inscrição abre', async () => {
  const p = await query("SELECT id FROM ps_processos ORDER BY id DESC LIMIT 1");
  if (!p.rows.length) return; // sem processo cadastrado, nada a testar
  const r = await req('/pss/' + p.rows[0].id + '/inscricao', { redirect: 'manual' });
  assert.equal(r.status, 200, 'a inscrição pública devolveu ' + r.status);
  const html = await r.text();
  assert.ok(html.includes('nome'), 'o formulário de inscrição não veio na página');
});

// ─── APIs públicas (domínio extraído p/ routes/api-publica.js) ────────────────
test('APIs públicas do site respondem sem exigir login', async () => {
  const r1 = await req('/api/stats-publicas');
  assert.equal(r1.status, 200, '/api/stats-publicas devolveu ' + r1.status);
  const j1 = await r1.json();
  assert.ok(typeof j1.ligantes === 'number', '/api/stats-publicas não veio no formato esperado');

  const r2 = await req('/api/eventos-publicos');
  assert.equal(r2.status, 200, '/api/eventos-publicos devolveu ' + r2.status);
  assert.ok(Array.isArray(await r2.json()), '/api/eventos-publicos deveria devolver uma lista');
});

// ─── o que foi removido continua removido ─────────────────────────────────────
test('rotas removidas respondem 404', async () => {
  for (const rota of ['/agenda', '/calendario.ics', '/portal/meus-dados']) {
    const r = await req(rota, { redirect: 'manual' });
    assert.equal(r.status, 404, rota + ' deveria estar removida (deu ' + r.status + ')');
  }
});

// ─── o fluxo que quebrou hoje: correção de cadastro ponta a ponta ─────────────
test('correção de cadastro: membro envia → admin aprova → aplica e refecha a edição', async () => {
  // 1. o membro entra no portal e vê que pode editar
  const m = criarSessao();
  const login = await m.post('/membro/login', { email: ligante.email, senha: MEMBRO_SENHA }, '/membro/login');
  assert.notEqual(login.status, 429, 'rate limit do login estourou — reinicie o staging antes de testar');
  assert.ok(!(login.headers.get('location') || '').includes('/membro/login'), 'membro não conseguiu logar');

  const dados = await (await m.get('/membro/perfil/dados')).json();
  assert.equal(dados.podeEditar, true, 'edição deveria estar liberada');

  // 2. envia a correção (todos os campos obrigatórios preenchidos)
  const novoNome = 'Smoke Teste ' + Date.now();
  const campos = { ...dados.dados, nome: novoNome };
  delete campos.id; delete campos.tipo; delete campos.foto_chave; delete campos.edicao_liberada;
  campos.data_nascimento = String(campos.data_nascimento || '2000-01-01').substring(0, 10);
  for (const k of Object.keys(campos)) if (campos[k] == null) campos[k] = 'teste';

  const envio = await m.post('/membro/perfil/atualizar', campos, '/membro/dashboard');
  const res = await envio.json();
  assert.equal(res.ok, true, 'envio falhou: ' + (res.erro || ''));

  // 3. virou pendência para o admin
  const pend = await query("SELECT id FROM cadastro_correcoes WHERE origem_tipo='ligante' AND origem_id=$1 AND status='pendente'", [ligante.id]);
  assert.equal(pend.rows.length, 1, 'a correção não virou pendência');

  // 4. o admin aprova
  const a = criarSessao();
  await a.post('/login', ADMIN);
  const ap = await a.post('/correcoes-cadastro/' + pend.rows[0].id + '/aprovar', {}, '/correcoes-cadastro');
  assert.ok([200, 302].includes(ap.status), 'aprovação devolveu ' + ap.status);

  // 5. os dados foram aplicados E a liberação individual se refechou
  const depois = (await query('SELECT nome, edicao_liberada FROM ligantes WHERE id=$1', [ligante.id])).rows[0];
  assert.equal(depois.nome, novoNome, 'o nome novo não foi aplicado ao cadastro');
  assert.equal(depois.edicao_liberada, false, 'a edição deveria ter se refechado após aprovar');
});
