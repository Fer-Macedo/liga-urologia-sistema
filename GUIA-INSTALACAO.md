# 📋 GUIA DE INSTALAÇÃO COMPLETO
## Sistema de Cobranças — Liga Acadêmica de Urologia
### Passo a passo para leigos — do zero ao sistema funcionando na internet

---

## ✅ O QUE VOCÊ VAI PRECISAR (tudo gratuito ou de baixo custo)

| Item | Custo | Para que serve |
|------|-------|----------------|
| Conta no GitHub | Grátis | Guardar o código do sistema |
| Conta no Railway | Grátis (depois ~R$5/mês) | Hospedar o sistema na internet |
| Token do PagBank | Grátis | Receber pagamentos |
| Conta Mega-API | ~R$29/mês | Enviar WhatsApp automático |
| Gmail Workspace | Já tem! | Enviar e-mails automáticos |

---

## 📁 ETAPA 1 — Baixar e preparar o código (10 minutos)

### 1.1 — Criar conta no GitHub
1. Acesse **github.com** e clique em **Sign up**
2. Use seu e-mail do Google Workspace para criar a conta
3. Escolha o plano **Free** (gratuito)

### 1.2 — Criar um repositório
1. Após fazer login no GitHub, clique no botão verde **"New"** (canto superior esquerdo)
2. Em "Repository name", escreva: `liga-urologia-sistema`
3. Deixe marcado como **Private** (privado — mais seguro)
4. Clique em **"Create repository"**

### 1.3 — Enviar o código para o GitHub
1. Baixe o arquivo `.zip` do sistema que você recebeu
2. Extraia o arquivo `.zip` em uma pasta no seu computador
3. No GitHub, na página do repositório que você criou, clique em **"uploading an existing file"**
4. Arraste **todos os arquivos e pastas** do sistema para a área indicada
5. Clique em **"Commit changes"** (botão verde no final da página)
6. Aguarde o envio terminar ✅

---

## 🚀 ETAPA 2 — Colocar o sistema na internet com Railway (15 minutos)

### 2.1 — Criar conta no Railway
1. Acesse **railway.app**
2. Clique em **"Login"** → **"Login with GitHub"**
3. Autorize o Railway a acessar seu GitHub
4. Você entrará no painel do Railway automaticamente

### 2.2 — Criar o projeto
1. Clique em **"New Project"**
2. Selecione **"Deploy from GitHub repo"**
3. Escolha o repositório `liga-urologia-sistema` que você criou
4. Clique em **"Deploy Now"**
5. Aguarde o processo terminar (aparecerá uma barra de progresso)

### 2.3 — Configurar as variáveis de ambiente (IMPORTANTE!)
> Estas são as "chaves secretas" do sistema — nunca compartilhe com ninguém.

1. No Railway, clique no seu projeto
2. Clique na aba **"Variables"**
3. Clique em **"Add Variable"** e adicione cada item abaixo:

```
SESSION_SECRET    →  escreva uma frase longa qualquer, ex: MinhaSenhaSecretaLiga2024!
PORT              →  3000
PAGBANK_TOKEN     →  (você vai obter na Etapa 3)
PAGBANK_BASE_URL  →  https://api.pagseguro.com
MEGAAPI_INSTANCE  →  (você vai obter na Etapa 4)
MEGAAPI_TOKEN     →  (você vai obter na Etapa 4)
MEGAAPI_BASE_URL  →  https://api.mega-api.app.br
EMAIL_HOST        →  smtp.gmail.com
EMAIL_PORT        →  587
EMAIL_USER        →  seu@email.com.br
EMAIL_PASS        →  (você vai obter na Etapa 5)
EMAIL_FROM        →  Liga Urologia <seu@email.com.br>
ORG_NOME          →  Liga Acadêmica de Urologia
ORG_COR           →  #1a56db
APP_URL           →  (URL que o Railway vai te dar — veja abaixo)
```

### 2.4 — Obter a URL do sistema
1. Vá na aba **"Settings"** do projeto no Railway
2. Em **"Domains"**, clique em **"Generate Domain"**
3. Você receberá uma URL tipo: `liga-urologia.up.railway.app`
4. **Copie essa URL** e cole na variável `APP_URL` do passo anterior

### 2.5 — Acessar o sistema
1. Abra a URL no navegador: `https://liga-urologia.up.railway.app`
2. Login inicial:
   - **E-mail:** `admin@liga.org.br`
   - **Senha:** `admin123`
3. ⚠️ **MUDE A SENHA IMEDIATAMENTE** após o primeiro acesso!

---

## 💳 ETAPA 3 — Configurar o PagBank (20 minutos)

### 3.1 — Gerar o Token de API
1. Acesse **pagseguro.uol.com.br** e faça login com sua conta PagBank
2. Clique em **"Minha Conta"** (canto superior direito)
3. Vá em **"Preferências"** → **"Integrações"**
4. Clique em **"Gerar Token"**
5. O token aparecerá na tela — **copie e guarde com segurança**
6. Cole esse token na variável `PAGBANK_TOKEN` no Railway

### 3.2 — Configurar o Webhook (para confirmação automática de pagamento)
1. Na mesma tela do PagBank, procure por **"Notificações"** ou **"Webhook"**
2. Cole a URL: `https://SUA-URL.up.railway.app/webhook/pagbank`
3. (Substitua SUA-URL pela URL que o Railway te deu)
4. Salve as configurações

---

## 📱 ETAPA 4 — Configurar WhatsApp com Mega-API (15 minutos)

### 4.1 — Criar conta na Mega-API
1. Acesse **mega-api.app.br**
2. Clique em **"Criar conta"** ou **"Começar grátis"**
3. Complete o cadastro com seus dados
4. Escolha o plano que atende sua necessidade (planos a partir de ~R$29/mês)

### 4.2 — Criar uma instância e conectar o WhatsApp
1. No painel da Mega-API, clique em **"Nova Instância"**
2. Dê um nome como `liga-urologia`
3. Clique em **"Criar"**
4. Aparecerá um QR Code na tela
5. No celular que será usado para enviar as mensagens:
   - Abra o WhatsApp
   - Toque nos 3 pontos (⋮) → **Dispositivos conectados**
   - Toque em **"Conectar um dispositivo"**
   - Aponte a câmera para o QR Code na tela
6. Aguarde a conexão (aparecerá "Conectado" em verde)

### 4.3 — Copiar as credenciais
1. Na Mega-API, clique na sua instância
2. Copie o **"Instance ID"** → cole em `MEGAAPI_INSTANCE` no Railway
3. Copie o **"Token"** → cole em `MEGAAPI_TOKEN` no Railway

---

## 📧 ETAPA 5 — Configurar e-mail com Google Workspace (10 minutos)

### 5.1 — Gerar senha de app no Google
1. Acesse **myaccount.google.com**
2. Clique em **"Segurança"**
3. Em "Como você faz login no Google", clique em **"Verificação em duas etapas"**
   - Se não estiver ativada, ative agora (obrigatório para o próximo passo)
4. Role a página e procure **"Senhas de app"**
5. Clique em **"Senhas de app"**
6. Em "Selecionar app", escolha **"Outro (nome personalizado)"**
7. Digite: `Liga Urologia Sistema`
8. Clique em **"Gerar"**
9. Aparecerá uma senha de 16 letras — **copie ela** (ex: `abcd efgh ijkl mnop`)
10. Cole essa senha (sem espaços) na variável `EMAIL_PASS` no Railway
11. Em `EMAIL_USER`, coloque o e-mail que gerou a senha

---

## ✅ ETAPA 6 — Verificar se tudo está funcionando

### 6.1 — Teste básico
1. Acesse o sistema pela URL do Railway
2. Faça login com `admin@liga.org.br` / `admin123`
3. Mude a senha imediatamente em **Usuários → Redefinir senha**

### 6.2 — Cadastrar o primeiro membro de teste
1. Vá em **Membros** → **Cadastrar membro**
2. Coloque o seu próprio WhatsApp e e-mail para testar
3. Salve

### 6.3 — Gerar a primeira cobrança
1. Vá em **Cobranças** → **Gerar cobranças do mês**
2. A cobrança aparecerá na lista
3. Clique no ícone ✉ para enviar a notificação de teste

### 6.4 — Verificar e-mail e WhatsApp
- Cheque se o e-mail chegou na caixa de entrada
- Cheque se o WhatsApp recebeu a mensagem

---

## ⚙️ ETAPA 7 — Personalizar o sistema

### 7.1 — Colocar a logo e cores da Liga
1. No sistema, vá em **Configurações**
2. Altere o nome da organização
3. Escolha a cor da sua marca clicando no seletor de cores
4. Cole a URL da sua logomarca (se tiver hospedada online)
5. Clique em **Salvar**

### 7.2 — Configurar as mensagens de cobrança
1. Vá em **Notificações**
2. Edite os textos das mensagens de WhatsApp e e-mail
3. Use as variáveis disponíveis: `{nome}`, `{data}`, `{valor_desc}`, `{link}`, etc.
4. Salve

### 7.3 — Configurar valores da mensalidade
1. Vá em **Configurações**
2. Defina o valor padrão da mensalidade
3. Defina o percentual de desconto por pontualidade
4. Defina o dia de vencimento padrão
5. Salve

---

## 👥 COMO USAR O SISTEMA NO DIA A DIA

### Cadastrar novos membros
- Membros → Cadastrar membro → preencher os dados → Salvar

### Gerar cobranças mensais
- O sistema gera automaticamente todo dia 1 do mês
- Você pode forçar manualmente: Cobranças → "Gerar cobranças do mês"

### As notificações são enviadas automaticamente:
- **3 dias antes do vencimento** → WhatsApp + e-mail com link e desconto
- **No dia do vencimento** → lembrete final com desconto
- **1 dia após o vencimento** → cobrança de atraso
- **7 dias após o vencimento** → reforço de cobrança
- **No aniversário do membro** → mensagem de parabéns

### Registrar pagamento manual
- Cobranças → encontre o membro → clique no ícone ✓ verde

### Adicionar novos usuários ao sistema
- Usuários → Novo usuário → defina o perfil (Financeiro ou Visualizador)

---

## 🆘 PROBLEMAS COMUNS E SOLUÇÕES

| Problema | Solução |
|----------|---------|
| Sistema não abre | Verifique se o Railway está rodando (aba "Deployments") |
| WhatsApp não envia | Reconecte a instância na Mega-API (QR Code pode ter expirado) |
| E-mail não chega | Verifique a senha de app do Google e o e-mail em EMAIL_USER |
| PagBank erro | Confirme se o token foi copiado corretamente sem espaços |
| Esqueceu a senha | No Railway, apague o banco `data/liga.db` e reinicie |

---

## 📞 SUPORTE

Em caso de dúvidas técnicas:
- Mega-API: suporte disponível no site mega-api.app.br
- Railway: documentação em docs.railway.app
- PagBank: suporte em pagseguro.uol.com.br/atendimento

---

*Sistema desenvolvido exclusivamente para a Liga Acadêmica de Urologia*
*Versão 1.0 — Maio de 2025*
