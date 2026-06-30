# CLAUDE.md — liga-urologia-sistema

Contexto local do projeto para economizar tokens. Complementa o CLAUDE.md global em /root/.claude/CLAUDE.md.

---

## Comandos

```bash
# Produção (PM2 no servidor 46.225.150.104)
pm2 restart liga-urologia

# Local
npm start          # node src/server.js
npm run dev        # nodemon src/server.js
```

O entry point real usado em produção é **`src/server.js`** (não `server.js` na raiz, que é legado).

---

## Tecnologias

- **Node.js + Express** — framework principal
- **EJS** — template engine de todas as views (`views/`)
- **PostgreSQL** — banco de dados (lib `pg`), queries via `src/models/database.js` → função `query(sql, params)`
- **Socket.IO** — chat em tempo real (Lauro bot + portal científico)
- **Multer + Cloudflare R2** — upload de arquivos (`src/services/arquivos.js`)
- **PagBank** — pagamentos (link de checkout via coluna `pagbank_link` na tabela `cobrancas`)
- **W-API** — WhatsApp Business API (instância `LITE-C64M58-DM5PHH`, bot Lauro em `src/services/lauro.js`)
- **bcryptjs** — hash de senhas (portal científico e portal do membro usam instâncias separadas)
- **Nodemailer** — envio de e-mails (`src/services/notificacoes.js`)
- **Timezone** — `process.env.TZ = 'America/Asuncion'` definido como primeira linha de `src/server.js`

---

## Estrutura de pastas

```
liga-urologia-sistema/
├── src/
│   ├── server.js          ← entry point (PM2 aponta aqui)
│   ├── models/
│   │   └── database.js    ← conexão PG + função query()
│   ├── routes/
│   │   └── index.js       ← TODAS as rotas (~8000+ linhas)
│   └── services/
│       ├── lauro.js       ← bot WhatsApp (Lauro)
│       ├── arquivos.js    ← upload/download R2
│       ├── notificacoes.js← e-mails
│       ├── agendamentos.js← cron jobs (cobranças, lembretes)
│       └── backup.js      ← backup SQL diário por e-mail
├── views/
│   ├── pages/
│   │   ├── portal/        ← Portal Científico (login, dashboard, grupo, trocar-senha, esqueci-senha)
│   │   ├── membro/        ← Portal do Membro (dashboard, financeiro, etc.)
│   │   └── *.ejs          ← Admin (cobranças, membros, eventos, etc.)
│   └── partials/          ← nav, footer, componentes reutilizáveis
└── public/                ← assets estáticos (CSS, JS, imagens)
```

---

## Rotas principais

| Prefixo | Descrição |
|---|---|
| `/portal/*` | Portal Científico (membro de pesquisa) |
| `/membro/*` | Portal do Membro (ligante) |
| `/admin/*` | Área administrativa |
| `/lauro/*` | Webhook do bot WhatsApp |
| `/eventos/*` | Gestão e inscrição em eventos |
| `/cientifico/*` | Projetos científicos (admin) |

---

## Tabelas relevantes

| Tabela | Uso |
|---|---|
| `membros` | Ligantes/membros da liga |
| `diretivos` | Membros da diretoria |
| `cobrancas` | Mensalidades — colunas: `valor_desconto`, `valor_cheio`, `pagbank_link`, `data_pagamento` |
| `lauro_atendimentos` | Atendimentos do bot (status: `aguardando` / `encerrado`) |
| `portal_cientifico_senhas` | Senhas do portal científico (`primeiro_acesso` boolean) |
| `grupos_cientificos` | Grupos de pesquisa |
| `grupo_versoes` | Versões de trabalhos enviados |
| `materiais_estudo` | Materiais de estudo (upload via R2) |

---

## Observações importantes

- **Multer + async**: erros dentro do callback do multer NÃO são capturados por try-catch externo — o try-catch deve estar DENTRO do callback.
- **Proxy Lauro**: comparação de números usa últimos 8 dígitos (`_ult8`) para lidar com variações de formato (12 vs 13 dígitos).
- **Valores de cobrança**: dia de pagamento ≤ 15 → `valor_desconto`; dia > 15 ou status `atrasado` → `valor_cheio`.
- **Deploy**: push para `claude/whatsapp-connection-setup-ixtjr2` → GitHub Actions → SSH no servidor → `git pull && pm2 restart liga-urologia`.
