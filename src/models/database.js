const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Render fornece a variável DATABASE_URL automaticamente
// Para uso local, crie um .env com DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
  // Robustez para eventos com muitos acessos simultâneos
  max: 25,                        // até 25 conexões simultâneas (Postgres aceita 100)
  idleTimeoutMillis: 30000,       // libera conexão ociosa após 30s
  connectionTimeoutMillis: 5000,  // desiste de pegar conexão após 5s (evita travar)
  maxUses: 7500                   // recicla conexão após 7500 usos (evita memory leak)
});

// Log de erros do pool (não derruba o processo se uma conexão falhar)
pool.on('error', function(err){
  console.error('Pool PG erro inesperado:', err.message);
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

// Retorna objeto compatível com a interface anterior (prepare/run/get/all)
function getDb() {
  return {
    query,
    prepare: (sql) => ({
      run: (...params) => query(sql, params),
      get: (...params) => query(sql, params).then(r => r.rows[0] || null),
      all: (...params) => query(sql, params).then(r => r.rows)
    }),
    exec: (sql) => query(sql)
  };
}

async function initSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      senha TEXT NOT NULL,
      perfil TEXT DEFAULT 'financeiro',
      ativo INTEGER DEFAULT 1,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS membros (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      cpf TEXT,
      email TEXT,
      whatsapp TEXT,
      data_nascimento TEXT,
      dia_vencimento INTEGER DEFAULT 15,
      mensalidade REAL DEFAULT 100.00,
      desconto_pontualidade REAL DEFAULT 10.00,
      ativo INTEGER DEFAULT 1,
      observacoes TEXT,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cobrancas (
      id SERIAL PRIMARY KEY,
      membro_id INTEGER NOT NULL REFERENCES membros(id),
      referencia TEXT NOT NULL,
      valor_cheio REAL NOT NULL,
      valor_desconto REAL NOT NULL,
      data_vencimento TEXT NOT NULL,
      data_pagamento TEXT,
      status TEXT DEFAULT 'pendente',
      pagbank_charge_id TEXT,
      pagbank_link TEXT,
      criado_em TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE cobrancas ADD COLUMN IF NOT EXISTS valor_pago REAL;
    -- Ao regerar o PIX/link do atrasado, o link antigo era SOBRESCRITO. Quem pagasse no
    -- link velho virava dinheiro sem dono: o checkout some do nosso lado e o PagBank nao
    -- deixa buscar pedido por referencia. Aqui a gente guarda os links anteriores para
    -- conseguir reconciliar depois.
    ALTER TABLE cobrancas ADD COLUMN IF NOT EXISTS pagbank_links_antigos TEXT;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cobrancas_referencia_key') THEN
        ALTER TABLE cobrancas ADD CONSTRAINT cobrancas_referencia_key UNIQUE (referencia);
      END IF;
    END $$;
    ALTER TABLE membros ALTER COLUMN dia_vencimento SET DEFAULT 15;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefone TEXT;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_secret TEXT;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_ativo BOOLEAN DEFAULT false;
    ALTER TABLE listas_assinaturas ADD COLUMN IF NOT EXISTS tipo_publico TEXT DEFAULT 'todos';
    ALTER TABLE ligantes ADD COLUMN IF NOT EXISTS foto_site_chave TEXT;
    ALTER TABLE diretivos ADD COLUMN IF NOT EXISTS foto_site_chave TEXT;
    ALTER TABLE diretivos ADD COLUMN IF NOT EXISTS sexo TEXT;
    ALTER TABLE ligantes ADD COLUMN IF NOT EXISTS edicao_liberada BOOLEAN DEFAULT false;
    ALTER TABLE diretivos ADD COLUMN IF NOT EXISTS edicao_liberada BOOLEAN DEFAULT false;
    -- rastreio de entrega do WhatsApp: id da mensagem na Meta (wamid) + status de entrega
    -- (sent/delivered/read/failed) atualizado pelos recibos do webhook /webhook/whatsapp-oficial
    ALTER TABLE notificacoes_log ADD COLUMN IF NOT EXISTS wamid TEXT;
    ALTER TABLE notificacoes_log ADD COLUMN IF NOT EXISTS entrega TEXT;
    ALTER TABLE notificacoes_log ADD COLUMN IF NOT EXISTS entrega_em TIMESTAMP;
    -- carta de cobranca: snapshot dos meses em atraso no momento da geracao (JSON: [{mes,venc,ymd}])
    ALTER TABLE cartas_cobranca ADD COLUMN IF NOT EXISTS meses_json TEXT;
    -- ponytail: IF EXISTS pq as tabelas ps_* vivem só no banco (não há CREATE no código)
    ALTER TABLE IF EXISTS ps_processos ADD COLUMN IF NOT EXISTS edital_chave TEXT;
    -- check-in de presença do PSS (aula magna, prova, entrevista): qrcode gerado sob demanda
    -- no e-mail de confirmação; ps_checkins registra 1 presença por candidato+ocasião
    ALTER TABLE IF EXISTS ps_candidatos ADD COLUMN IF NOT EXISTS qrcode TEXT;
    CREATE TABLE IF NOT EXISTS ps_checkins (
      id SERIAL PRIMARY KEY,
      candidato_id INTEGER NOT NULL,
      ocasiao TEXT NOT NULL,
      checkin_em TIMESTAMP NOT NULL DEFAULT NOW(),
      checkin_por INTEGER REFERENCES usuarios(id),
      UNIQUE(candidato_id, ocasiao)
    );

    CREATE TABLE IF NOT EXISTS cadastro_correcoes (
      id SERIAL PRIMARY KEY,
      origem_tipo TEXT NOT NULL CHECK (origem_tipo IN ('ligante','diretivo')),
      origem_id INTEGER NOT NULL,
      dados JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente',
      criado_em TIMESTAMP DEFAULT NOW(),
      avaliado_por INTEGER,
      avaliado_em TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS marketing_calendario (
      id SERIAL PRIMARY KEY,
      titulo TEXT NOT NULL,
      descricao TEXT,
      data_inicio TIMESTAMP NOT NULL,
      data_fim TIMESTAMP,
      cor TEXT DEFAULT '#0F6E56',
      criado_por INTEGER,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS instagram_estrategias (
      id SERIAL PRIMARY KEY,
      gerado_em TIMESTAMP DEFAULT NOW(),
      dados_json TEXT,
      analise_html TEXT,
      criado_por TEXT
    );

    CREATE TABLE IF NOT EXISTS marketing_notas (
      id SERIAL PRIMARY KEY,
      texto TEXT NOT NULL,
      cor TEXT DEFAULT '#fff3b0',
      fixado BOOLEAN DEFAULT false,
      criado_por INTEGER,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS site_banners (
      id SERIAL PRIMARY KEY,
      titulo TEXT,
      imagem_chave TEXT NOT NULL,
      link_url TEXT,
      ativo BOOLEAN DEFAULT true,
      ordem INTEGER DEFAULT 0,
      criado_por INTEGER,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS rascunhos_trabalho (
      id SERIAL PRIMARY KEY,
      grupo_id INTEGER NOT NULL UNIQUE,
      titulo TEXT,
      norma TEXT DEFAULT 'abnt',
      texto TEXT,
      google_file_id TEXT,
      google_doc_url TEXT,
      google_embed_url TEXT,
      dono_tipo TEXT,
      dono_id INTEGER,
      atualizado_por_tipo TEXT,
      atualizado_por_id INTEGER,
      atualizado_em TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE rascunhos_trabalho ADD COLUMN IF NOT EXISTS dono_tipo TEXT;
    ALTER TABLE rascunhos_trabalho ADD COLUMN IF NOT EXISTS dono_id INTEGER;

    CREATE TABLE IF NOT EXISTS versao_trabalho_eventos (
      id SERIAL PRIMARY KEY,
      versao_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      comentario TEXT,
      autor_tipo TEXT,
      autor_id INTEGER,
      autor_nome TEXT,
      destino_nome TEXT,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS aniversario_lembretes_enviados (
      id SERIAL PRIMARY KEY,
      data DATE NOT NULL,
      momento TEXT NOT NULL,
      criado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(data, momento)
    );

    CREATE TABLE IF NOT EXISTS galerias_eventos (
      id SERIAL PRIMARY KEY,
      nome_evento TEXT NOT NULL,
      data_evento TEXT,
      ativo BOOLEAN DEFAULT true,
      criado_por INTEGER,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS galeria_fotos (
      id SERIAL PRIMARY KEY,
      galeria_id INTEGER NOT NULL REFERENCES galerias_eventos(id) ON DELETE CASCADE,
      imagem_chave TEXT NOT NULL,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS aniversario_stories_postados (
      id SERIAL PRIMARY KEY,
      pessoa_tipo TEXT NOT NULL,
      pessoa_id INTEGER NOT NULL,
      data DATE NOT NULL,
      criado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(pessoa_tipo, pessoa_id, data)
    );

    CREATE TABLE IF NOT EXISTS notificacoes_log (
      id SERIAL PRIMARY KEY,
      membro_id INTEGER,
      cobranca_id INTEGER,
      tipo TEXT,
      canal TEXT,
      status TEXT,
      enviado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS configuracoes (
      chave TEXT PRIMARY KEY,
      valor TEXT
    );

    CREATE TABLE IF NOT EXISTS anthropic_uso (
      id SERIAL PRIMARY KEY,
      contexto TEXT,
      modelo TEXT,
      tokens_entrada INT DEFAULT 0,
      tokens_saida INT DEFAULT 0,
      custo_estimado NUMERIC(10,6) DEFAULT 0,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cientifico_notas (
      id SERIAL PRIMARY KEY,
      grupo_id INTEGER NOT NULL,
      texto TEXT NOT NULL,
      cor TEXT DEFAULT '#fff3b0',
      fixado BOOLEAN DEFAULT false,
      criado_por INTEGER,
      criado_em TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE cientifico_notas ADD COLUMN IF NOT EXISTS membro_tipo TEXT;
    ALTER TABLE cientifico_notas ADD COLUMN IF NOT EXISTS membro_id INTEGER;

    CREATE TABLE IF NOT EXISTS leads_patrocinio (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      empresa TEXT NOT NULL,
      cargo TEXT,
      telefone TEXT,
      whatsapp TEXT,
      email TEXT NOT NULL,
      plano TEXT,
      mensagem TEXT,
      criado_em TIMESTAMP DEFAULT NOW()
    );
  `);

  // Insere configs padrão
  const cfgs = [
    ['org_nome','Liga Acadêmica de Urologia'],
    ['org_cor','#1a56db'],
    ['org_logo',''],
    ['mensalidade_padrao','100.00'],
    ['desconto_padrao','10'],
    ['dia_vencimento_padrao','5'],
    ['multa_atraso','2'],
    ['msg_aniversario','Parabéns pelo seu aniversário, {nome}! A equipe da Liga Acadêmica de Urologia deseja um dia muito especial para você. 🎉'],
    ['msg_cobranca_pre','Olá {nome}! Sua mensalidade da Liga Acadêmica de Urologia vence em {dias} dias ({data}). Valor com desconto: R$ {valor_desc}. Pague agora: {link}'],
    ['msg_cobranca_dia','Olá {nome}! Hoje é o último dia para pagar sua mensalidade com desconto (R$ {valor_desc}). Após hoje o valor será R$ {valor_cheio}. Pague agora: {link}'],
    ['msg_cobranca_pos','Olá {nome}, sua mensalidade da Liga está em atraso desde {data}. Valor: R$ {valor_cheio}. Regularize agora: {link}'],
    ['notif_pre_ativo','1'],
    ['notif_dia_ativo','1'],
    ['notif_aniversario_ativo','1']
  ];

  for (const [chave, valor] of cfgs) {
    await query(
      'INSERT INTO configuracoes (chave, valor) VALUES ($1, $2) ON CONFLICT (chave) DO NOTHING',
      [chave, valor]
    );
  }

  // NAO adicionar ALTER TABLE em instagram_posts aqui: a tabela pertence ao usuario
  // `postgres`, e o `ligauser` da aplicacao recebe "must be owner of table". DDL que
  // falha no initSchema encerra o processo e derruba o app com 502 — ja aconteceu em
  // 2026-07-12. Colunas nessa tabela sao aplicadas a mao, como postgres.
  // A coluna midia_chave foi criada assim em 2026-07-19.

  // Chat de marketing com a IA. A equipe so tem acesso ao sistema; e aqui que ela
  // discute pauta e questiona o cronograma sem depender de intermediario.
  await query(`
    CREATE TABLE IF NOT EXISTS marketing_chat (
      id SERIAL PRIMARY KEY,
      papel VARCHAR(10) NOT NULL,
      usuario VARCHAR(120),
      mensagem TEXT NOT NULL,
      criado_em TIMESTAMP DEFAULT NOW()
    )
  `);

  // Colunas de operacao do quadro Revalida. ALTER e seguro aqui: revalida_questoes foi
  // criada por este initSchema, entao pertence ao ligauser (testado). Diferente de
  // instagram_posts, que e do postgres — ver o comentario mais acima.
  await query('ALTER TABLE revalida_questoes ADD COLUMN IF NOT EXISTS aprovado_por VARCHAR(120)');
  await query('ALTER TABLE revalida_questoes ADD COLUMN IF NOT EXISTS publicado_em TIMESTAMP');
  await query('ALTER TABLE revalida_questoes ADD COLUMN IF NOT EXISTS publicado_por VARCHAR(120)');

  // status_de/status_para eram VARCHAR(20) — curto demais para as etapas do fluxo de
  // projetos ('aguardando_presidencia' tem 22, 'aguardando_secretaria' tem 21). Como
  // logH() (projeto-fluxo.js) engole erro em catch(e){}, todo INSERT nessas duas etapas
  // vinha falhando CALADO desde sempre: o historico do projeto simplesmente nao registrava
  // essas transicoes, sem ninguem perceber. Alargar e idempotente — repetir nao da erro.
  await query('ALTER TABLE projetos_historico ALTER COLUMN status_de TYPE VARCHAR(30)');
  await query('ALTER TABLE projetos_historico ALTER COLUMN status_para TYPE VARCHAR(30)');

  // A norma da Coordinación exige UMA thread de e-mail por projeto, do primeiro envio ate
  // o projeto ser concluido. projetos_email_thread ja existia (criada fora do initSchema),
  // mas SEM unique em projeto_id — a garantia de "uma thread so" dependia so do codigo
  // (SELECT antes de INSERT em enviarEmailProjeto), sem trava no banco. Numa corrida (duplo
  // clique, duas abas), duas linhas de thread para o mesmo projeto criariam DUAS conversas
  // por e-mail — exatamente o que a norma proibe, e ninguem perceberia.
  await query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projetos_email_thread_projeto_id_key') THEN
        ALTER TABLE projetos_email_thread ADD CONSTRAINT projetos_email_thread_projeto_id_key UNIQUE (projeto_id);
      END IF;
    END $$;
  `);

  // Quando a Coordinación responde, o vigia (projeto-email-detect.js) agora le a mensagem
  // inteira e guarda um resumo + uma sugestao de leitura (aprovado/correcao), pra Secretaria
  // decidir com o texto na tela em vez de precisar abrir o Gmail so pra saber do que se trata.
  await query('ALTER TABLE projetos_email_thread ADD COLUMN IF NOT EXISTS sugestao_status TEXT');
  await query('ALTER TABLE projetos_email_thread ADD COLUMN IF NOT EXISTS resposta_resumo TEXT');

  // Quando a Coordinación devolve um .docx com comentarios (as caixinhas na lateral do
  // Word), o anexo automatico ja guarda o TEXTO de cada comentario + o trecho do
  // documento que ele marca — pra Ensino/Extensao ver na tela, sem abrir o Word so pra
  // achar as caixinhas. JSON (array) guardado como texto, mesmo padrao ja usado noutras
  // colunas deste projeto (ex: objetivos_especificos).
  await query('ALTER TABLE projetos_anexos ADD COLUMN IF NOT EXISTS comentarios TEXT');

  // Cronograma de conteudo sugerido pela IA + resposta da equipe. E conversa, nao
  // monologo: o que a equipe recusa ou comenta volta como contexto na proxima geracao,
  // para a IA parar de repetir o que ja foi descartado.
  await query(`
    CREATE TABLE IF NOT EXISTS marketing_sugestoes (
      id SERIAL PRIMARY KEY,
      data_sugerida DATE NOT NULL,
      tema TEXT NOT NULL,
      formato VARCHAR(20) DEFAULT 'feed',
      justificativa TEXT,
      status VARCHAR(20) DEFAULT 'sugerida',
      comentario_equipe TEXT,
      respondido_por VARCHAR(120),
      respondido_em TIMESTAMP,
      criado_por VARCHAR(120),
      criado_em TIMESTAMP DEFAULT NOW()
    )
  `);

  // Momento Revalida Brasil — fila de questoes do quadro dos stories (2x/semana).
  // Questoes reais do Revalida/INEP; so entram com gabarito DEFINITIVO (anuladas e
  // gabarito preliminar ficam de fora). status='aprovada' = liberada pela orientacao
  // medica; o cron so envia o que estiver aprovado.
  await query(`
    CREATE TABLE IF NOT EXISTS revalida_questoes (
      id SERIAL PRIMARY KEY,
      fonte TEXT NOT NULL,
      caso TEXT NOT NULL,
      alternativas JSONB NOT NULL,
      gabarito CHAR(1) NOT NULL,
      porque TEXT NOT NULL,
      pegadinha TEXT,
      distratores JSONB,
      legenda TEXT,
      ordem INTEGER DEFAULT 0,
      status VARCHAR(20) DEFAULT 'rascunho',
      enviado_em TIMESTAMP,
      criado_em TIMESTAMP DEFAULT NOW()
    )
  `);

  // Contador diário de envios pela W-API (canal do assistente) — protege contra o
  // padrão que já restringiu/baniu o número 3x: conta nova/recém-reconectada em
  // automação não-oficial mandando volume acima do que uma conversa humana teria.
  // Um dia por linha, incrementado a cada envio de texto/imagem/documento.
  await query(`
    CREATE TABLE IF NOT EXISTS wapi_envios_diarios (
      dia DATE PRIMARY KEY,
      total INTEGER NOT NULL DEFAULT 0
    );

    -- Bloqueio de força bruta e tokens de "esqueci senha" — antes viviam em objeto JS em
    -- memória (zerava a cada restart/deploy, e não escala com mais de um processo).
    CREATE TABLE IF NOT EXISTS login_tentativas (
      ip TEXT PRIMARY KEY,
      tentativas INTEGER NOT NULL DEFAULT 0,
      bloqueado_ate TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tokens_senha (
      token TEXT PRIMARY KEY,
      usuario_id INTEGER NOT NULL,
      expira TIMESTAMP NOT NULL
    )
  `);

  // Admin padrão
  const admin = await query("SELECT id FROM usuarios WHERE perfil = 'admin'");
  if (admin.rows.length === 0) {
    // ponytail: senha inicial vem do ambiente; fallback só p/ instalação nova sem env
    const senha = bcrypt.hashSync(process.env.ADMIN_SENHA_INICIAL || 'admin123', 10);
    await query(
      'INSERT INTO usuarios (nome, email, senha, perfil) VALUES ($1, $2, $3, $4)',
      ['Administrador', 'admin@liga.org.br', senha, 'admin']
    );
    console.log('✅ Usuário admin criado: admin@liga.org.br');
    console.log('⚠️  Defina ADMIN_SENHA_INICIAL no .env e TROQUE A SENHA APÓS O PRIMEIRO LOGIN!');
  }

  console.log('✅ Banco de dados pronto!');
}

module.exports = { getDb, query, initSchema };
