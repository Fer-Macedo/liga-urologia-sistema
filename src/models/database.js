const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Render fornece a variável DATABASE_URL automaticamente
// Para uso local, crie um .env com DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
  // Robustez para eventos com muitos acessos simultâneos. O modo cluster está DESLIGADO desde
  // 12/08/2026 (sessão do assistente de WhatsApp quebra entre processos — religar exige migrar
  // esse estado pro banco primeiro), então hoje só há 1 processo em produção usando este pool —
  // 30 fica com folga grande sob o limite de 100 do Postgres (staging usa outros 15; sobra >50).
  // 17/08/2026: subido de 15 pra 30 no dia do evento (~500 inscritos), pra reduzir o risco de
  // connectionTimeoutMillis estourar num pico de check-out simultâneo. Se o cluster for religado
  // no futuro, essa conta precisa ser revista (max × processos não pode passar de ~90).
  max: 30,                        // até 30 conexões neste processo (Postgres aceita 100 no total)
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
    -- 15/08/2026: achado cadastro duplicado (mesmo CPF, dois ids de membro) originado de um
    -- reimport em 2026-06-15 que não checou se a pessoa já existia — gerou mensalidade e
    -- presença fragmentadas entre os dois ids. CPF vazio continua permitido (NULL não colide
    -- com NULL em UNIQUE), só bloqueia um CPF repetido de verdade.
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'membros_cpf_key') THEN
        ALTER TABLE membros ADD CONSTRAINT membros_cpf_key UNIQUE (cpf);
      END IF;
    END $$;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefone TEXT;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_secret TEXT;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_ativo BOOLEAN DEFAULT false;
    -- default true: lotes já cadastrados continuam pedindo catraca como pediam antes,
    -- nada muda pra quem já configurou um lote sem essa opção existir.
    ALTER TABLE evento_lotes ADD COLUMN IF NOT EXISTS exige_catraca BOOLEAN DEFAULT true;
    -- Um cupom de isenção por pessoa por evento — a checagem em código (SELECT depois
    -- INSERT) não é atômica, e já produziu duplicata de verdade em produção (11/08/2026,
    -- 4 pares). Índice parcial (WHERE ligante_id/diretivo_id IS NOT NULL) porque cupom
    -- genérico, sem pessoa vinculada, continua permitido.
    CREATE UNIQUE INDEX IF NOT EXISTS evento_cupons_ligante_unico ON evento_cupons (evento_id, ligante_id) WHERE ligante_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS evento_cupons_diretivo_unico ON evento_cupons (evento_id, diretivo_id) WHERE diretivo_id IS NOT NULL;
    ALTER TABLE listas_assinaturas ADD COLUMN IF NOT EXISTS tipo_publico TEXT DEFAULT 'todos';
    -- Campos padrão (catraca, RG, semestre...) que fazem sentido pra UCP hoje mas não pra
    -- toda universidade que vier a usar o sistema no futuro. Chaves em src/routes/eventos.js
    -- (nome/email nunca entram aqui — o sistema todo depende deles).
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS campos_padrao_desativados TEXT[] DEFAULT '{}';
    -- 15/08/2026: eventos, evento_programacao, evento_inscricoes, evento_certificados,
    -- evento_presencas_online e evento_presencas_tempo só existiam no banco de produção, nunca
    -- tiveram CREATE TABLE no código (um ambiente novo quebraria no primeiro uso). IF NOT EXISTS
    -- é inofensivo no banco de hoje — só fecha essa lacuna pra qualquer ambiente futuro.
    CREATE TABLE IF NOT EXISTS eventos (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(200) NOT NULL,
      descricao TEXT,
      data_inicio TIMESTAMP,
      data_fim TIMESTAMP,
      local VARCHAR(200),
      endereco TEXT,
      banner_chave TEXT,
      vagas_total INTEGER DEFAULT 0,
      status VARCHAR(20) DEFAULT 'rascunho',
      publico BOOLEAN DEFAULT false,
      criado_por INTEGER,
      criado_em TIMESTAMP DEFAULT NOW(),
      cor_tema VARCHAR(20) DEFAULT '#1a3d2b',
      tipo_evento VARCHAR(20) DEFAULT 'presencial',
      email_inscricao TEXT,
      email_confirmacao TEXT,
      termos_texto TEXT,
      wpp_grupo TEXT,
      inscricao_unica BOOLEAN DEFAULT false,
      inscricao_gratuita_auto BOOLEAN DEFAULT true,
      notif_email VARCHAR(200),
      mostra_programacao BOOLEAN DEFAULT true,
      mostra_palestrantes BOOLEAN DEFAULT true,
      lgpd_texto TEXT,
      carga_horaria INTEGER DEFAULT 0,
      tipo_publico VARCHAR(20) DEFAULT 'misto',
      youtube_url TEXT,
      duracao_minutos INTEGER,
      cert_bg_chave TEXT,
      checkout_aberto BOOLEAN DEFAULT false,
      checkout_fecha_em TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS evento_programacao (
      id SERIAL PRIMARY KEY,
      evento_id INTEGER REFERENCES eventos(id) ON DELETE CASCADE,
      horario VARCHAR(20),
      titulo VARCHAR(200),
      descricao TEXT,
      local VARCHAR(200),
      ordem INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS evento_inscricoes (
      id SERIAL PRIMARY KEY,
      evento_id INTEGER REFERENCES eventos(id),
      lote_id INTEGER,
      nome VARCHAR(200),
      email VARCHAR(200),
      whatsapp VARCHAR(30),
      cpf VARCHAR(20),
      instituicao VARCHAR(200),
      dados_extras JSONB,
      status VARCHAR(20) DEFAULT 'pendente',
      qrcode TEXT,
      checkin_em TIMESTAMP,
      criado_em TIMESTAMP DEFAULT NOW(),
      rg TEXT,
      tipo_participante TEXT DEFAULT 'externo',
      catraca TEXT,
      semestre TEXT,
      turma TEXT,
      cupom_codigo VARCHAR(50),
      isento BOOLEAN DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS evento_certificados (
      id SERIAL PRIMARY KEY,
      inscricao_id INTEGER REFERENCES evento_inscricoes(id),
      chave TEXT,
      emitido_em TIMESTAMP DEFAULT NOW(),
      codigo_validacao VARCHAR(64) UNIQUE,
      enviado_email BOOLEAN DEFAULT false,
      enviado_wpp BOOLEAN DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS evento_presencas_online (
      id SERIAL PRIMARY KEY,
      inscricao_id INTEGER NOT NULL,
      evento_id INTEGER NOT NULL,
      token VARCHAR(64) NOT NULL UNIQUE,
      primeiro_acesso TIMESTAMP,
      ultimo_ping TIMESTAMP,
      tempo_total_segundos INTEGER DEFAULT 0,
      ativo BOOLEAN DEFAULT false,
      criado_em TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_epo_inscricao ON evento_presencas_online (inscricao_id);
    CREATE INDEX IF NOT EXISTS idx_epo_token ON evento_presencas_online (token);
    CREATE TABLE IF NOT EXISTS evento_presencas_tempo (
      id SERIAL PRIMARY KEY,
      inscricao_id INTEGER NOT NULL,
      evento_id INTEGER NOT NULL,
      entrada_em TIMESTAMP NOT NULL DEFAULT NOW(),
      saida_em TIMESTAMP,
      criado_em TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ept_evento ON evento_presencas_tempo (evento_id);
    CREATE INDEX IF NOT EXISTS idx_ept_inscricao ON evento_presencas_tempo (inscricao_id);
    ALTER TABLE evento_programacao ADD COLUMN IF NOT EXISTS foto_chave TEXT;
    ALTER TABLE evento_programacao ADD COLUMN IF NOT EXISTS palestrante_ids INTEGER[] DEFAULT '{}';
    -- eventos de vários dias (ex: jornada de 3 dias) tinham 2+ itens de programação com o
    -- MESMO horário (só a hora, sem data) e não dava pra saber qual item era de qual dia.
    ALTER TABLE evento_programacao ADD COLUMN IF NOT EXISTS data DATE;
    -- Transmissão de evento com vários dias: cada dia tem seu próprio vídeo/duração, preenchida
    -- SÓ DEPOIS que a aula termina (a duração real só se sabe no final, não dá pra prever antes).
    -- evento.youtube_url/duracao_minutos (campo único, sem dia) continua existindo como fallback
    -- pra eventos de um dia só que não usam a Programação por data.
    ALTER TABLE evento_programacao ADD COLUMN IF NOT EXISTS youtube_url TEXT;
    ALTER TABLE evento_programacao ADD COLUMN IF NOT EXISTS duracao_minutos INTEGER;
    -- Presença online quebrada por dia (programacao_id), pra somar por dia E pelo total do
    -- evento (ex: jornada de 4 dias — precisa saber se bateu 75% em CADA dia consultado E
    -- também 75% da carga horária total somada).
    CREATE TABLE IF NOT EXISTS evento_presencas_online_dias (
      id SERIAL PRIMARY KEY,
      presenca_id INTEGER NOT NULL REFERENCES evento_presencas_online(id) ON DELETE CASCADE,
      programacao_id INTEGER NOT NULL REFERENCES evento_programacao(id) ON DELETE CASCADE,
      tempo_total_segundos INTEGER NOT NULL DEFAULT 0,
      ultimo_ping TIMESTAMP,
      criado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(presenca_id, programacao_id)
    );
    -- Identifica a aba/sessão de navegador mais recente pra cada pessoa: um ping só conta se
    -- a sessão bater com a mais recente, senão a mesma pessoa com 2 abertas contava tempo em
    -- dobro (cada aba mandando seu próprio ping independente).
    ALTER TABLE evento_presencas_online ADD COLUMN IF NOT EXISTS sessao_atual TEXT;
    -- evento_checkouts só existia no banco (nunca teve CREATE no código) — fecha o mesmo tipo
    -- de lacuna já corrigida pras tabelas de presença online.
    CREATE TABLE IF NOT EXISTS evento_checkouts (
      id SERIAL PRIMARY KEY,
      evento_id INTEGER NOT NULL,
      inscricao_id INTEGER,
      email VARCHAR(255),
      cpf VARCHAR(50),
      nome_informado VARCHAR(255),
      ip VARCHAR(60),
      criado_em TIMESTAMP DEFAULT NOW(),
      email_enviado_em TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_checkout_evento ON evento_checkouts (evento_id);
    CREATE INDEX IF NOT EXISTS idx_checkout_inscricao ON evento_checkouts (inscricao_id);
    -- Check-out por dia: evento de vários dias tinha só 1 status aberto/fechado pro evento
    -- inteiro, mas cada dia tem sua própria sessão — precisa abrir/fechar e contar por dia,
    -- mesmo raciocínio já aplicado à transmissão e à presença online por dia.
    ALTER TABLE evento_programacao ADD COLUMN IF NOT EXISTS checkout_aberto BOOLEAN DEFAULT false;
    ALTER TABLE evento_programacao ADD COLUMN IF NOT EXISTS checkout_fecha_em TIMESTAMP;
    ALTER TABLE evento_checkouts ADD COLUMN IF NOT EXISTS programacao_id INTEGER REFERENCES evento_programacao(id) ON DELETE CASCADE;
    -- Avaliação obrigatória do evento, embutida no check-out do ÚLTIMO DIA (pedido do
    -- usuário 17/08/2026, perguntas de escala 1-6 [Péssimo..Excelente] + sugestões livre, pra
    -- gerar panorama do evento pra coordenação de ligas). As perguntas são CONFIGURÁVEIS por
    -- evento (pedido do usuário 17/08/2026: poder adicionar/excluir perguntas) — por isso não
    -- são colunas fixas, ficam como JSON (avaliacao_perguntas no evento, aval_respostas no
    -- check-out, na mesma ordem das perguntas vigentes quando a pessoa respondeu).
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS avaliacao_perguntas TEXT;
    ALTER TABLE evento_checkouts DROP COLUMN IF EXISTS aval_tema;
    ALTER TABLE evento_checkouts DROP COLUMN IF EXISTS aval_tempo;
    ALTER TABLE evento_checkouts DROP COLUMN IF EXISTS aval_palestrante;
    ALTER TABLE evento_checkouts DROP COLUMN IF EXISTS aval_suporte;
    ALTER TABLE evento_checkouts ADD COLUMN IF NOT EXISTS aval_respostas TEXT;
    ALTER TABLE evento_checkouts ADD COLUMN IF NOT EXISTS aval_sugestoes TEXT;
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
    -- sorteios/sorteio_participantes só existiam no banco (sem CREATE no código) — mesma
    -- lacuna já fechada pras outras tabelas.
    CREATE TABLE IF NOT EXISTS sorteios (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(255) NOT NULL,
      tipo VARCHAR(30) NOT NULL,
      descricao TEXT,
      status VARCHAR(20) DEFAULT 'rascunho',
      publico_alvo VARCHAR(20),
      participantes_manual TEXT,
      instagram_liga VARCHAR(100),
      tarefas TEXT,
      qtd_ganhadores INTEGER DEFAULT 1,
      ganhador_id INTEGER,
      ganhador_nome VARCHAR(255),
      ganhador_contato VARCHAR(255),
      brinde TEXT,
      validado BOOLEAN DEFAULT false,
      tarefas_cumpridas TEXT,
      observacoes_validacao TEXT,
      criado_por INTEGER,
      criado_em TIMESTAMP DEFAULT NOW(),
      sorteado_em TIMESTAMP,
      sorteado_por INTEGER
    );
    CREATE TABLE IF NOT EXISTS sorteio_participantes (
      id SERIAL PRIMARY KEY,
      sorteio_id INTEGER REFERENCES sorteios(id) ON DELETE CASCADE,
      nome VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      instagram VARCHAR(100),
      whatsapp VARCHAR(50),
      tarefas_marcadas TEXT,
      prints TEXT,
      chances INTEGER DEFAULT 1,
      validado BOOLEAN,
      criado_em TIMESTAMP DEFAULT NOW()
    );
    -- Sorteio direto dos inscritos CONCLUÍDOS (status='confirmado') de um evento ou processo
    -- seletivo — pedido do usuário 17/08/2026: puxar automaticamente em vez de digitar nomes
    -- na mão. origem_tipo diz de onde vêm ('evento' -> evento_inscricoes, 'pss' -> ps_candidatos).
    ALTER TABLE sorteios ADD COLUMN IF NOT EXISTS origem_tipo VARCHAR(20);
    ALTER TABLE sorteios ADD COLUMN IF NOT EXISTS origem_id INTEGER;

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
    ['msg_aniversario','Parabéns pelo seu aniversário, {nome}! A equipe da Liga Acadêmica de Urologia deseja um dia muito especial para você.'],
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

  // 21/08/2026: marca quando o e-mail de confirmação (com QR Code) foi mandado, pra o botão
  // "Confirmação a quem falta" (envio em massa) não reenviar pra quem já recebeu — só o botão
  // individual "Email" de cada inscrito reenvia sem essa checagem.
  await query('ALTER TABLE evento_inscricoes ADD COLUMN IF NOT EXISTS confirmacao_email_enviado_em TIMESTAMP');
  // Backfill (idempotente, só toca quem ainda está NULL): inscrições confirmadas ANTES desta
  // coluna existir já passaram pelo e-mail automático em algum destes 2 caminhos — isento (grátis,
  // confirma e manda na hora) ou pagamento aprovado (webhook/confirmação manual também manda na
  // hora). Quem não é nem isento nem tem pagamento pago (cadastro manual ou em lote pelo admin,
  // que NÃO manda e-mail sozinho) fica de propósito com a coluna NULL, pra o botão em massa
  // mandar pra essas pessoas quando for usado pela primeira vez.
  await query(`
    UPDATE evento_inscricoes i SET confirmacao_email_enviado_em = i.criado_em
    WHERE i.status='confirmado' AND i.confirmacao_email_enviado_em IS NULL
      AND (i.isento = true OR EXISTS (SELECT 1 FROM evento_pagamentos p WHERE p.inscricao_id=i.id AND p.status='pago'))
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
    console.log('Usuário admin criado: admin@liga.org.br');
    console.log('Defina ADMIN_SENHA_INICIAL no .env e TROQUE A SENHA APÓS O PRIMEIRO LOGIN!');
  }

  console.log('Banco de dados pronto!');
}

module.exports = { getDb, query, initSchema, pool };
