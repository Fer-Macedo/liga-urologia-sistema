# 🚀 GUIA DE INSTALAÇÃO — RENDER.COM
## Sistema de Cobranças — Liga Acadêmica de Urologia
### Passo a passo completo para leigos — sem cartão de crédito

---

## ✅ O QUE VOCÊ VAI PRECISAR

| Item | Custo | Para que serve |
|------|-------|----------------|
| Conta no GitHub | Grátis | Guardar o código do sistema |
| Conta no Render.com | Grátis | Hospedar o sistema na internet |
| Token do PagBank | Grátis | Gerar links de pagamento |
| Conta Mega-API | ~R$ 29/mês | Enviar WhatsApp automático |
| Gmail / Google Workspace | Já tem! | Enviar e-mails automáticos |

---

## 📁 ETAPA 1 — Criar conta no GitHub e enviar o código (15 min)

### 1.1 — Criar conta no GitHub
1. Abra o navegador e acesse: **github.com**
2. Clique em **"Sign up"** (cadastrar)
3. Use o seu e-mail do Google Workspace
4. Escolha o plano **Free** (gratuito)
5. Confirme o e-mail que o GitHub enviou para você

### 1.2 — Criar um repositório (pasta no GitHub)
1. Após fazer login, clique no botão verde **"New"** no lado esquerdo
2. Em **"Repository name"** escreva: `liga-urologia`
3. Marque a opção **"Private"** (privado — mais seguro)
4. Clique no botão verde **"Create repository"**

### 1.3 — Enviar o código do sistema
1. Extraia o arquivo `.zip` do sistema em uma pasta no seu computador
2. Na página do repositório que você criou, procure o link **"uploading an existing file"** e clique
3. Abra a pasta onde extraiu o `.zip` no seu computador
4. Selecione **TODOS** os arquivos e arraste para a área cinza do GitHub
5. Aguarde o upload terminar (pode demorar 1 a 2 minutos)
6. Clique no botão verde **"Commit changes"**
7. Pronto! Seu código está salvo no GitHub ✅

---

## 🌐 ETAPA 2 — Criar conta no Render e publicar o sistema (20 min)

### 2.1 — Criar conta no Render
1. Acesse: **render.com**
2. Clique em **"Get Started for Free"**
3. Clique em **"Continue with GitHub"** (entrar com o GitHub)
4. Autorize o Render a acessar sua conta do GitHub
5. Você entrará no painel do Render automaticamente

### 2.2 — Criar o serviço (publicar o sistema)
1. No painel do Render, clique em **"New +"** (canto superior direito)
2. Selecione **"Web Service"**
3. Clique em **"Connect a repository"**
4. Selecione o repositório **"liga-urologia"** que você criou
5. Clique em **"Connect"**

### 2.3 — Configurar o serviço
Preencha os campos assim:

| Campo | O que colocar |
|-------|---------------|
| Name | liga-urologia |
| Region | Oregon (US West) ou qualquer um |
| Branch | main |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `node src/server.js` |
| Instance Type | **Free** (selecione "Free") |

6. Role a página até **"Advanced"** e clique para expandir
7. Clique em **"Add Disk"** (adicionar disco — onde os dados ficam salvos)
   - Name: `liga-data`
   - Mount Path: `/var/data`
   - Size: `1 GB`
8. Clique em **"Create Web Service"**
9. O Render vai publicar o sistema (aguarde 3 a 5 minutos — aparecerá uma barra de progresso)

### 2.4 — Anotar a URL do seu sistema
1. Após o deploy terminar, o Render mostrará uma URL no topo da página
2. Ela será algo como: `https://liga-urologia-xxxx.onrender.com`
3. **Anote essa URL — você vai precisar dela nos próximos passos**

---

## ⚙️ ETAPA 3 — Configurar as variáveis (senhas e chaves secretas) (15 min)

As variáveis são as "chaves secretas" do sistema. Siga estes passos:

1. No painel do Render, clique no seu serviço **"liga-urologia"**
2. Clique na aba **"Environment"**
3. Clique em **"Add Environment Variable"** para cada item abaixo:

### Variáveis obrigatórias para o sistema funcionar:

```
SESSION_SECRET   →  EscolhaUmaFraseLongaQualquer2024Liga!
APP_URL          →  https://liga-urologia-xxxx.onrender.com  (sua URL do passo 2.4)
NODE_ENV         →  production
RENDER           →  true
```

### Variáveis do e-mail (Google Workspace):
```
EMAIL_HOST       →  smtp.gmail.com
EMAIL_PORT       →  587
EMAIL_USER       →  seu@email.com.br
EMAIL_PASS       →  (senha de app do Google — veja Etapa 4)
EMAIL_FROM       →  Liga Urologia <seu@email.com.br>
```

### Variáveis do PagBank:
```
PAGBANK_TOKEN    →  (seu token — veja Etapa 5)
PAGBANK_BASE_URL →  https://api.pagseguro.com
```

### Variáveis do WhatsApp (Mega-API):
```
MEGAAPI_INSTANCE →  (sua instância — veja Etapa 6)
MEGAAPI_TOKEN    →  (seu token — veja Etapa 6)
MEGAAPI_BASE_URL →  https://api.mega-api.app.br
```

4. Após adicionar todas as variáveis, clique em **"Save Changes"**
5. O Render vai reiniciar o sistema automaticamente

---

## 📧 ETAPA 4 — Configurar o e-mail (Google Workspace) (10 min)

### 4.1 — Gerar senha de app no Google
1. Acesse: **myaccount.google.com**
2. Clique em **"Segurança"** no menu lateral
3. Procure **"Verificação em duas etapas"** e ative se ainda não estiver ativa
4. Após ativar, procure por **"Senhas de app"** e clique
5. Em "Selecionar app", escolha **"Outro (nome personalizado)"**
6. Digite: `Liga Urologia`
7. Clique em **"Gerar"**
8. Aparecerá uma senha com 16 letras, por exemplo: `abcd efgh ijkl mnop`
9. **Copie essa senha SEM espaços**: `abcdefghijklmnop`
10. Cole na variável **EMAIL_PASS** no Render

---

## 💳 ETAPA 5 — Configurar o PagBank (15 min)

### 5.1 — Obter o token de API
1. Acesse: **pagseguro.uol.com.br** e faça login
2. Clique em **"Minha Conta"** (canto superior direito)
3. Vá em **"Preferências"** → **"Integrações"**
4. Clique em **"Gerar Token"**
5. Copie o token gerado e cole na variável **PAGBANK_TOKEN** no Render

### 5.2 — Configurar recebimento automático de pagamentos (Webhook)
1. Na mesma tela do PagBank, procure **"Notificações"** ou **"Webhook"**
2. Cole a URL abaixo (substituindo pela SUA URL do Render):
   `https://liga-urologia-xxxx.onrender.com/webhook/pagbank`
3. Salve

---

## 📱 ETAPA 6 — Configurar WhatsApp com Mega-API (15 min)

### 6.1 — Criar conta na Mega-API
1. Acesse: **mega-api.app.br**
2. Clique em **"Criar conta"**
3. Escolha o plano que desejar (tem opção a partir de ~R$ 29/mês)

### 6.2 — Criar instância e conectar o WhatsApp
1. No painel da Mega-API, clique em **"Nova Instância"**
2. Dê o nome: `liga-urologia`
3. Clique em **"Criar"**
4. Aparecerá um QR Code na tela
5. No celular que enviará as mensagens automáticas:
   - Abra o **WhatsApp**
   - Toque nos **3 pontos** (⋮) no canto superior direito
   - Toque em **"Dispositivos conectados"**
   - Toque em **"Conectar um dispositivo"**
   - Aponte a câmera para o QR Code na tela do computador
6. Aguarde — aparecerá "Conectado" ✅

### 6.3 — Copiar as credenciais
1. Na Mega-API, clique na instância criada
2. Copie o **Instance ID** → cole em **MEGAAPI_INSTANCE** no Render
3. Copie o **Token** → cole em **MEGAAPI_TOKEN** no Render

---

## 🌍 ETAPA 7 — Apontar seu domínio .com para o sistema (10 min)

Você tem um domínio .com registrado. Vamos fazer `sistema.seudominio.com` abrir o sistema:

### 7.1 — Adicionar domínio no Render
1. No painel do Render, clique no seu serviço
2. Clique na aba **"Settings"**
3. Procure **"Custom Domains"** e clique em **"Add Custom Domain"**
4. Digite: `sistema.seudominio.com` (use o seu domínio real)
5. O Render mostrará um valor CNAME, algo como: `liga-urologia-xxxx.onrender.com`
6. **Copie esse valor**

### 7.2 — Configurar o DNS onde seu domínio está registrado
Acesse o painel onde seu domínio .com está registrado (pode ser Google Domains, GoDaddy, Registro.br, etc.):

1. Procure por **"DNS"** ou **"Gerenciar DNS"**
2. Clique em **"Adicionar registro"**
3. Preencha assim:
   - Tipo: **CNAME**
   - Nome/Host: `sistema`
   - Valor/Destino: (cole o valor que o Render te deu)
   - TTL: 3600 (ou deixe o padrão)
4. Salve

Aguarde até 1 hora e seu sistema estará acessível em `sistema.seudominio.com` ✅

---

## ✅ ETAPA 8 — Primeiro acesso e configuração inicial (5 min)

### 8.1 — Acessar o sistema
1. Abra: `https://sistema.seudominio.com` (ou a URL do Render se ainda não apontou o domínio)
2. **E-mail:** `admin@liga.org.br`
3. **Senha:** `admin123`

### 8.2 — Trocar a senha IMEDIATAMENTE
1. Vá em **Usuários**
2. Clique no ícone 🔑 ao lado do seu usuário
3. Defina uma senha forte

### 8.3 — Personalizar com a logo e cores da Liga
1. Vá em **Configurações**
2. Coloque o nome da organização
3. Escolha a cor da sua marca
4. Cole a URL da logomarca (se tiver)
5. Clique em **Salvar**

### 8.4 — Cadastrar o primeiro membro de teste
1. Vá em **Membros → Cadastrar membro**
2. Use seu próprio WhatsApp e e-mail para testar
3. Salve e vá em **Cobranças → Gerar cobranças do mês**
4. Clique em ✉ para enviar e verifique se chegou no WhatsApp e e-mail

---

## 🔄 COMO O SISTEMA FUNCIONA NO DIA A DIA

O sistema roda sozinho! Todo dia às 8h da manhã ele:

1. **Gera** as cobranças do mês para todos os membros ativos
2. **Verifica** quais pagamentos foram confirmados pelo PagBank
3. **Marca** como atrasado quem não pagou após o vencimento
4. **Envia** as notificações de cobrança (3 dias antes, no dia, após vencer)
5. **Envia** parabéns para quem faz aniversário

Você só precisa:
- Cadastrar novos membros quando entrar alguém novo
- Marcar pagamentos manuais (se alguém pagar em dinheiro)
- Verificar o dashboard para acompanhar a situação geral

---

## 🆘 PROBLEMAS COMUNS E SOLUÇÕES

| Problema | O que fazer |
|----------|-------------|
| Sistema não abre | Aguarde 1 min e tente de novo — pode estar "acordando" |
| WhatsApp não envia | Reconecte na Mega-API (escaneie o QR Code de novo) |
| E-mail não chega | Confirme a senha de app e o e-mail em EMAIL_USER |
| PagBank não gera link | Verifique o token no Render — pode ter espaço extra |
| Esqueci a senha admin | Apague o arquivo liga.db no Render e reinicie o serviço |
| Domínio não funciona | Aguarde até 24h — DNS demora para propagar |

---

## 💰 CUSTOS MENSAIS ESTIMADOS

| Serviço | Custo |
|---------|-------|
| Render.com (hospedagem) | **Grátis** |
| GitHub (código) | **Grátis** |
| PagBank (pagamentos) | **Grátis** (cobra % sobre vendas) |
| Mega-API (WhatsApp) | ~R$ 29/mês |
| Domínio .com | Já tem! |
| Google Workspace (e-mail) | Já tem! |
| **TOTAL ADICIONAL** | **~R$ 29/mês** |

Se quiser o sistema **sempre ligado** (sem adormecer), o upgrade no Render custa US$ 7/mês (~R$ 42). Mas para o uso da Liga, o plano gratuito funciona perfeitamente.

---

*Sistema desenvolvido para a Liga Acadêmica de Urologia*
*Versão para Render.com — Maio de 2025*
