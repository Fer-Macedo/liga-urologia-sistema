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
      dia_vencimento INTEGER DEFAULT 5,
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
    ['notif_pos1_ativo','1'],
    ['notif_pos7_ativo','1'],
    ['notif_aniversario_ativo','1'],
    ['notif_atrasados_diario','1']
  ];

  for (const [chave, valor] of cfgs) {
    await query(
      'INSERT INTO configuracoes (chave, valor) VALUES ($1, $2) ON CONFLICT (chave) DO NOTHING',
      [chave, valor]
    );
  }

  // Admin padrão
  const admin = await query("SELECT id FROM usuarios WHERE perfil = 'admin'");
  if (admin.rows.length === 0) {
    const senha = bcrypt.hashSync('admin123', 10);
    await query(
      'INSERT INTO usuarios (nome, email, senha, perfil) VALUES ($1, $2, $3, $4)',
      ['Administrador', 'admin@liga.org.br', senha, 'admin']
    );
    console.log('✅ Usuário admin criado: admin@liga.org.br');
    console.log('⚠️  TROQUE A SENHA APÓS O PRIMEIRO LOGIN!');
  }

  console.log('✅ Banco de dados pronto!');
}

module.exports = { getDb, query, initSchema };
