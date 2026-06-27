# SOLUCOES CONFIRMADAS - SISTEMA LAURO
## Arquivo de referencia: atacar PRIMEIRO por aqui antes de tentar outras solucoes

---

## 1. BOTOES NAO CLICAVEIS NA PAGINA (onclick nao funciona)
Causa raiz: CSP do helmet bloqueando event handlers inline
Sintoma: Botoes visiveis mas nao respondem. Console mostra: Content Security Policy directive script-src-attr none
Solucao: Em src/routes/index.js, no helmet(), adicionar:
  scriptSrcAttr: ["'unsafe-inline'"],
  E em scriptSrc adicionar: "'unsafe-hashes'"

---

## 2. ELEMENTO INVISIVEL BLOQUEANDO CLIQUES
Causa raiz: Modal sem style="display:none" cobre a pagina toda
Sintoma: Botoes visiveis mas nao clicaveis, sem erro no console
Diagnostico no console do browser:
  document.querySelectorAll('.topbar-acoes button').forEach(btn => {
    const rect = btn.getBoundingClientRect();
    const el = document.elementFromPoint(rect.left + rect.width/2, rect.top + rect.height/2);
    console.log('Em cima:', el.tagName, el.className, el.id);
  });
Solucao: Adicionar style="display:none" no modal-overlay que estava sem ele

---

## 3. DIV FORA DO MAIN BLOQUEANDO CLIQUES
Causa raiz: pag-wrap fora do /main flutua sobre a pagina
Sintoma: Botoes do topbar nao clicaveis, resto da pagina funciona
Solucao: Mover div class="pag-wrap" para dentro do div class="content" antes de fechar

---

## 4. WHATSAPP - FORA DO HORARIO (8h-20h)
Causa raiz: Sistema bloqueia envios fora do horario permitido
Sintoma: [FILA WAPP] Fora do horario (8h-20h). Tentando em 30min...
Solucao: Normal - aguardar horario ou enviar manualmente

---

## 5. ASSISTENTE VIRTUAL - ERRO 404 (modelo invalido)
Causa raiz: Modelo da API Anthropic desatualizado
Sintoma: AV aprender: Request failed with status code 404
Solucao: Trocar em src/routes/index.js:
  ERRADO: model: 'claude-sonnet-4-20250514'
  CORRETO: model: 'claude-sonnet-4-6'

---

## 6. PIX NAO GERADO - CPF INVALIDO
Causa raiz: CPF com digito verificador errado rejeitado pelo PagBank
Sintoma: error_messages code 40002 must be a valid CPF or CNPJ
Diagnostico - validar CPF:
  const nums = cpf.split('').map(Number);
  let s1=0; for(let i=0;i<9;i++) s1+=nums[i]*(10-i);
  let d1=11-(s1%11); if(d1>=10) d1=0;
  // d1 deve ser igual a nums[9]
Solucao: Corrigir CPF na tabela ligantes e regerar PIX

---

## 7. PIX - ERRO cannot be created with PIX QR code
Causa raiz: Nao pode ter charges PIX e qr_codes juntos no mesmo payload
Solucao: Usar SOMENTE qr_codes, remover o bloco charges do payload

---

## 8. FREQUENCIA ERRADA NO PORTAL DO MEMBRO
Causa raiz: Portal usava ligantes.id mas tabela presencas usa membros.id
Solucao:
  const membroR = await query('SELECT id FROM membros WHERE LOWER(email)=LOWER((SELECT email FROM ligantes WHERE id=$1))', [id]);
  const membroId = membroR.rows[0]?.id;

---

## 9. UPLOAD DE FOTO - ERRO 413 (Request Entity Too Large)
Causa raiz: Nginx sem client_max_body_size no vhost do subdominio
Sintoma: 413 Request Entity Too Large ao enviar foto
Solucao: Adicionar no nginx do subdominio afetado:
  client_max_body_size 20M;

---

## 10. DATA Invalid Date NO CADASTRO
Causa raiz: Campo date vazio ou mal formatado salvo como string invalida
Solucao: (data_nascimento && data_nascimento.trim() && data_nascimento != 'Invalid Date' ? data_nascimento : null)

---

## 11. NODE -E FALHANDO COM event not found
Causa raiz: Bash interpreta ! dentro de strings como historico de comandos
Solucao: Nunca usar node -e com ! - criar arquivo .js temporario:
  cat > /var/www/liga-urologia/script.js << 'JSEOF'
  // codigo aqui
  JSEOF
  node script.js && rm script.js

---

## 12. SISTEMA CAINDO APOS EDICAO COM SED
Causa raiz: sed -i com substituicao complexa pode cortar linhas e criar sintaxe invalida
Solucao: Sempre usar Python para substituicoes complexas:
  with open(path, 'r') as f: content = f.read()
  content = content.replace(old, new)
  with open(path, 'w') as f: f.write(content)
Verificar sempre: node -e "require('./src/routes/index.js')" antes de reiniciar

---

## 13. COBRANCAS MARCADAS COMO ATRASADAS INDEVIDAMENTE
Causa raiz: Cron as 01h marca pendente para atrasado onde data_vencimento < CURRENT_DATE
Timezone: Servidor em UTC, vencimento 15/06 vira 14/06 se salvo sem timezone
Solucao: Salvar vencimento com timezone explicito:
  UPDATE cobrancas SET data_vencimento='2026-06-15 12:00:00-03' WHERE id IN (...)

---

## 14. BOTOES LIBERAR/RECUSAR PENDENTES NAO FUNCIONAM
Causa raiz: button onclick="window.location=..." bloqueado pelo CSP
Solucao: Trocar button onclick por a href com onclick="return confirm(...)":
  <a href="/diretivos/<id>/aprovar" onclick="return confirm('Liberar?')">Liberar</a>

---

## 15. DNS NAO PROPAGA (IPs Squarespace)
Causa raiz: Dominio registrado no Squarespace com IPs proprios
Solucao: No painel Squarespace -> DNS -> Adicionar registros A personalizados:
  @ -> 46.225.150.104
  www -> 46.225.150.104
Aguardar propagacao (5min a 2h)

---

## 16. ERRO column does not exist NO BANCO
Causa raiz: Query referencia coluna que nao existe na tabela
Sintoma: column "criado_em" of relation "diretivo_turma_membros" does not exist
Diagnostico:
  node -e "require('dotenv').config();const {Pool}=require('pg');const pool=new Pool({connectionString:process.env.DATABASE_URL});pool.query(\"SELECT column_name FROM information_schema.columns WHERE table_name='NOME_TABELA' ORDER BY ordinal_position\").then(r=>{console.log(r.rows.map(c=>c.column_name).join(', '));pool.end();});"
Solucao: Remover a coluna inexistente da query INSERT/SELECT

---

## 17. ERRO column m.status does not exist EM LIGANTES/DIRETIVOS
Causa raiz: Tabelas ligantes e diretivos nao tem coluna status
Sintoma: Pagina em branco ou erro ao carregar relatorio/frequencia
Solucao: Substituir m.status='ativo' por m.ativo=1 AND m.pendente=false

---

## 18. MEMBRO DUPLICADO / LIGANTE SEM VINCULO COM MEMBRO
Causa raiz: Email diferente entre tabela ligantes e membros impede o JOIN
Sintoma: Ligante aparece duplicado na frequencia, ou nao aparece, ou tem presencas erradas
Diagnostico SQL:
  SELECT l.id, l.nome, l.email as email_lig, m.id as mem_id, m.email as email_mem
  FROM ligantes l LEFT JOIN membros m ON LOWER(m.email)=LOWER(l.email)
  WHERE m.id IS NULL;
Solucao: UPDATE membros SET email='email_correto@gmail.com' WHERE id=X;
REGRA: O JOIN ligante<->membro e sempre feito por LOWER(m.email)=LOWER(l.email)
NUNCA criar membro manualmente sem verificar o email exato do ligante primeiro

---

## 19. PRESENCAS EM TURMA ERRADA
Causa raiz: Membro vinculado a turma errada - presencas de turma A aparecem na turma B
Diagnostico SQL:
  SELECT a.turma_id, t.nome, COUNT(*) total, SUM(CASE WHEN p.presente=1 THEN 1 ELSE 0 END) presentes
  FROM presencas p JOIN atividades a ON a.id=p.atividade_id JOIN turmas t ON t.id=a.turma_id
  WHERE p.membro_id=X GROUP BY a.turma_id, t.nome;
Solucao: UPDATE turma_membros SET turma_id=TURMA_CORRETA WHERE membro_id=X;
NUNCA deletar presencas sem confirmar a qual turma pertencem!

---

## 20. DEFAULTS ERRADOS AO CRIAR MEMBRO MANUALMENTE
Causa raiz: INSERT de membros usava dia_vencimento=5, mensalidade=100, desconto=10
Solucao: Corrigido para dia_vencimento=15, mensalidade=25, desconto_pontualidade=20
Localizacao: src/routes/index.js - rota POST /membros

---

## 21. VERIFICACAO COMPLETA PORTAL DO MEMBRO - CHECKLIST
Quando suspeitar: Frequencia ou pagamento diferente entre sistema e portal
Script de diagnostico:
  cat > /var/www/liga-urologia/check_membro.js << 'JSEOF'
  require('dotenv').config({ path: '/var/www/liga-urologia/.env' });
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  async function verificar(email) {
    const mem = await pool.query('SELECT id,nome FROM membros WHERE LOWER(email)=LOWER($1)',[email]);
    if (!mem.rows[0]) { console.log('ERRO: sem membro!'); pool.end(); return; }
    const memId = mem.rows[0].id;
    const turma = await pool.query('SELECT tm.turma_id,t.nome FROM turma_membros tm JOIN turmas t ON t.id=tm.turma_id WHERE tm.membro_id=$1 ORDER BY tm.criado_em DESC LIMIT 1',[memId]);
    const turmaId = turma.rows[0]?.turma_id;
    const freq = await pool.query('SELECT COUNT(a.id) total, SUM(CASE WHEN p.presente=1 THEN 1 ELSE 0 END) presencas FROM atividades a LEFT JOIN presencas p ON p.atividade_id=a.id AND p.membro_id=$1 WHERE a.turma_id=$2',[memId,turmaId]);
    const cob = await pool.query('SELECT id,referencia,status,valor_desconto FROM cobrancas WHERE membro_id=$1 ORDER BY criado_em DESC',[memId]);
    console.log('MEMBRO id:', memId, '| TURMA:', turma.rows[0]?.nome);
    console.log('FREQUENCIA:', freq.rows[0]);
    console.log('COBRANCAS:', cob.rows);
    pool.end();
  }
  verificar(process.argv[2]);
  JSEOF
  node check_membro.js EMAIL_DO_MEMBRO && rm check_membro.js

---

## 22. BOTAO DENTRO DE ELEMENTO CLICAVEL NAO FUNCIONA
Causa raiz: Botao filho herda o onclick do elemento pai - stopPropagation nao resolve quando o pai tem onclick inline
Solucao: Separar area clicavel em div interno, deixando botoes de acao FORA:
  ERRADO: <div onclick="abrirA()"><button onclick="event.stopPropagation();abrirB()">
  CORRETO: <div style="display:flex"><div style="flex:1" onclick="abrirA()">...</div><div><button onclick="abrirB()">

---

## 23. ONCLICK INLINE COM DADOS DINAMICOS CAUSA SYNTAX ERROR
Causa raiz: JSON.stringify dentro de atributo onclick="" gera aspas duplas que quebram o HTML
Sintoma: Uncaught SyntaxError: Unexpected end of input no console, botao nao funciona
Solucao: Usar data-attributes + event listener:
  <button class="btn-editar" data-id="<%- id %>" data-desc="<%- texto.replace(/"/g,'&quot;') %>">
  document.querySelectorAll('.btn-editar').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      abrir(this.dataset.id, this.dataset.desc);
    });
  });

---

## 24. APOS SALVAR FORMULARIO VOLTA PARA ABA ERRADA
Causa raiz: Redirect do servidor vai para URL base sem preservar a aba ativa
Solucao 1 - No redirect do servidor: res.redirect('/frequencia?turma=' + turmaId + '&tab=atividades');
Solucao 2 - Na view no DOMContentLoaded:
  var tabParam = new URLSearchParams(window.location.search).get('tab');
  if (tabParam) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('ativo'));
    document.querySelectorAll('.freq-tab').forEach(t => t.classList.remove('ativo'));
    var tabEl = document.getElementById('tab-' + tabParam);
    if (tabEl) tabEl.classList.add('ativo');
  }

---

## 25. OPCAO FALTANDO NO SELECT DE TIPO DE ATIVIDADE
Causa raiz: Select criado sem incluir todos os tipos existentes no sistema
Tipos corretos: Aula Presencial, Aula On-line, Reuniao, Evento, Taller, Bienvenidas, Extensao, Expoligas, Outro
Localizacao: views/pages/frequencia.ejs e views/pages/frequencia-diretivos.ejs

---

## COMANDOS UTEIS DE DIAGNOSTICO

pm2 logs liga-urologia --lines 20 --nostream
pm2 restart liga-urologia --update-env
node -e "require('./src/routes/index.js')" 2>&1 | head -5
pm2 status
nginx -t && nginx -s reload
/usr/local/bin/backup-lauro.sh

Atualizado: 15/06/2026 - Sistema LAURO v1.0

---

## 26. DOCX TIMBRADO HEADER/FOOTER FULL-BLEED A4

**Problema:** Header e footer não ocupavam largura total A4. Espaço branco excessivo entre header e texto.

**3 causas raiz:**

1. docx-js usa PIXELS (96dpi), NAO pontos: transformation:{width,height} = pixels
   - 595pt errado → gera 5.667.375 EMU (imagem pequena)
   - 794px correto → gera 7.562.850 EMU (A4 completo)

2. Imagem header-lauro.jpg tinha 109px de branco puro no fundo (29% da altura)
   causando espaco visual falso entre header e texto
   Solucao: cortar com PIL antes de salvar

3. Indent negativo obrigatorio para sangrar alem das margens laterais (1134 DXA):
   indent: { left: -1134, right: -1134 } no paragrafo do header/footer

**Valores corretos confirmados (A4, margens left/right=1134 DXA):**
  Header: width=794, height=177 (imagem cortada 1242x277px)
  Footer: width=794, height=202 (imagem 1242x316px)
  margin: { top: 2656, right: 1134, bottom: 1701, left: 1134, header: 0, footer: 0 }
  spacing: { before: 0, after: 0 } no paragrafo do header

**Script PIL para cortar branco (sem numpy):**
  from PIL import Image
  img = Image.open('header.jpg')
  w, h = img.size
  ultima = 0
  for i in range(h-1, -1, -1):
      row = [img.getpixel((x, i)) for x in range(0, w, 20)]
      if not all(r > 240 and g > 240 and b > 240 for r,g,b in row):
          ultima = i
          break
  img.crop((0, 0, w, ultima + 5)).save('header.jpg', quality=95)

**Formulas para recalcular se imagens mudarem:**
  width_px  = 794  (fixo para A4 full-bleed a 96dpi)
  height_px = round(794 * img_height_px / img_width_px)
  margin_top_DXA = round(height_px * 1440 / 96)

**Arquivos:**
  src/services/gerarAtaDocx.js
  public/img/header-lauro.jpg (1242x277px apos corte)
  public/img/footer-ucp.jpg (1242x316px)

---

---

## 27. DOCX ATA — BOTAO X REMOVER PRESENTE NAO FUNCIONAVA
Causa raiz: CSP bloqueando onclick inline + fetch DELETE nao enviava cookie de sessao.
Solucao: Trocar botao X por form POST com _method=DELETE (method-override ja configurado).
Rota DELETE retorna redirect quando nao vier header Accept:application/json.
Codigo correto:
  <form method="POST" action="/atas/ID/presentes/PID?_method=DELETE" onsubmit="return confirm('Remover?')">
    <button type="submit">x</button>
  </form>
  router.delete('/atas/:id/presentes/:presenteId', requireAuth, async (req, res) => {
    await query('DELETE FROM atas_presentes WHERE id=$1 AND ata_id=$2', [...]);
    if (req.headers.accept?.includes('application/json')) return res.json({ok:true});
    res.redirect('/atas/' + req.params.id + '?tab=assinaturas');
  });

---

## 28. ABAS NAO CLICAVEIS — CSP BLOQUEANDO ONCLICK INLINE
Causa raiz: Helmet CSP bloqueia onclick="..." inline em botoes.
Solucao: data-attributes + addEventListener para TODOS os botoes interativos.
  ERRADO: <button onclick="showTab('info',this)">
  CORRETO: <button data-tab="info">
  document.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', function(){ showTab(this.dataset.tab,this); }));
Apos redirect, usar URLSearchParams para reabrir aba correta:
  var tab = new URLSearchParams(window.location.search).get('tab');
  if(tab) document.querySelector('[data-tab="'+tab+'"]')?.click();

---

## 29. FETCH NAO ENVIA COOKIE — REQUIREAUTH REDIRECIONA SILENCIOSAMENTE
Causa raiz: fetch() sem credentials:'same-origin' nao envia cookie de sessao.
Sintoma: requireAuth redireciona para /login, fetch recebe HTML em vez de JSON, erro silencioso.
Solucao:
  1. Sempre usar credentials:'same-origin' e headers:{'Accept':'application/json'} no fetch
  2. requireAuth retornar JSON 401 para requisicoes ajax:
     if (req.xhr || req.headers.accept?.includes('application/json'))
       return res.status(401).json({ok:false,erro:'Sessao expirada.'});

---

## 30. PAGINA PUBLICA COM CANVAS — CSP BLOQUEANDO SCRIPT INLINE
Causa raiz: Helmet CSP bloqueia script inline mesmo dentro de res.send() como string.
Solucao: Separar em arquivos distintos:
  1. View EJS: views/pages/assinar-ata-publica.ejs (HTML/CSS apenas)
  2. JS externo: public/js/assinar-ata.js (toda logica do canvas)
  3. Passar dados via window.TOKEN, window.ORG_LOGO, window.MEMBRO_NOME no EJS
  4. Rota usa res.render('pages/assinar-ata-publica', {...}) em vez de res.send()
REGRA: NUNCA colocar logica JS complexa dentro de res.send() — sempre usar arquivo em /public/js/

---

## 31. LINK DE ASSINATURA USO UNICO — EXPIRA AO ABRIR
Colunas adicionadas em atas_presentes:
  ALTER TABLE atas_presentes
    ADD COLUMN token_assinatura VARCHAR(64) UNIQUE,
    ADD COLUMN token_usado BOOLEAN DEFAULT false,
    ADD COLUMN token_expira_em TIMESTAMP;
Fluxo:
  1. Enviar para assinatura: gerar token (crypto.randomBytes(32).toString('hex')), salvar, enviar link /assinar-ata/:token
  2. Abrir o link: POST /assinar-ata-aberto/:token seta token_usado=true (invalida imediatamente)
  3. Assinar: POST /assinar-ata/:token salva assinatura_digital
  4. Reentrada: token_usado=true mostra pagina "link invalido" com layout padrao LAURO
Regras anti-ban WhatsApp:
  - Primeira notificacao: WhatsApp + Email
  - Reenvio: somente Email (nunca reenviar por WhatsApp)
  - 15s de espera entre cada membro no loop de envio
  - Verificar notificacoes_log antes de enviar para evitar duplicidade

---

---

## 32. ASSINATURA DIGITAL NAO APARECIA NO DOCX DA ATA

**Problema:** DOCX gerado tinha linha de assinatura vazia — imagem digital coletada mas nao inserida no documento.
**Causa raiz:** gerarAtaDocx.js gerava apenas espaco em branco no primeiro TableRow, sem ler o campo assinatura_digital do banco.

**Solucao — 2 alteracoes em src/services/gerarAtaDocx.js:**

1. Adicionar helper sigImageRun antes do loop de assinaturas:
```javascript
function sigImageRun(b64) {
  if (!b64) return null;
  try {
    const buf = Buffer.from(b64.replace(/^data:image\/png;base64,/, ''), 'base64');
    return new ImageRun({ data: buf, type: 'png', transformation: { width: 160, height: 60 } });
  } catch(e) { return null; }
}
```

2. No loop, gerar imagens antes da tabela:
```javascript
const leftImg = sigImageRun(left.assinatura_digital);
const rightImg = right ? sigImageRun(right.assinatura_digital) : null;
```

3. Substituir celulas de espaco vazio pelas celulas com imagem:
```javascript
children: [new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 80, after: 80 },
  children: leftImg ? [leftImg] : [new TextRun({ text: '', size: 36 })]
})]
```

**REGRA:** Sempre verificar se campo existe no banco E se esta sendo passado para o servico de geracao DOCX.
**CUIDADO ao editar gerarAtaDocx.js:** usar python replace cirurgico. Nunca editar por linha — risco de duplicar celulas da tabela e gerar SyntaxError.
**Validar sempre:** `node -e "require('./src/services/gerarAtaDocx.js')" 2>&1 | head -3` antes do pm2 restart.


---

## 33. BOTAO EDITAR ATIVIDADE NAO ABRIA MODAL — FREQUENCIA DIRETIVOS
Causa raiz: onclick inline com JSON.stringify bloqueado pelo CSP (mesma causa da solucao #23).
Solucao: data-attributes + addEventListener (mesmo padrao da solucao #23).
  ERRADO: onclick="abrirEditarAtividade(<%- a.id %>,<%- JSON.stringify(a.descricao) %>,...)"
  CORRETO:
    <button class="btn-editar-atividade-dir"
      data-id="<%- a.id %>"
      data-desc="<%- (a.descricao||'').replace(/\"/g,'&quot;') %>"
      data-tipo="<%- a.tipo||'' %>"
      data-data="<%= a.data_atividade ? new Date(a.data_atividade).toISOString().substring(0,10) : '' %>">
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('.btn-editar-atividade-dir');
      if(btn) abrirEditarAtividade(btn.dataset.id, btn.dataset.desc, btn.dataset.tipo, btn.dataset.data);
    });

---

## 34. ROTA EDITAR ATIVIDADE DIRETIVOS USAVA TABELA ERRADA
Causa raiz: rota POST /frequencia-diretivos/atividade/:id/editar buscava e atualizava tabela 'atividades' em vez de 'diretivo_atividades'.
Sintoma: erro pg_strtoint32_safe — turma_id nulo porque nao encontrava o registro.
Solucao:
  ERRADO: SELECT turma_id FROM atividades / UPDATE atividades
  CORRETO: SELECT turma_id FROM diretivo_atividades / UPDATE diretivo_atividades
REGRA: rotas /frequencia-diretivos/* sempre usam tabelas diretivo_* — nunca as tabelas de ligantes.

---

## 35. ABAS NAO CLICAVEIS E NAO RETORNAVAM ABA CORRETA — FREQUENCIA DIRETIVOS
Causa raiz 1: botoes de aba com onclick inline bloqueado pelo CSP.
Causa raiz 2: URLSearchParams inserido DENTRO da funcao mostrarTab em vez de ANTES dela.
Causa raiz 3: redirect passava ?tab=atividades mas getElementById buscava 'tab-atividades' (prefixo diferente).
Solucao completa:
  1. Botoes: trocar onclick por data-tab
     <button class="freq-tab" data-tab="tab-atividades">
  2. Listeners ANTES da funcao mostrarTab:
     document.querySelectorAll('.freq-tab[data-tab]').forEach(function(btn){
       btn.addEventListener('click', function(){ mostrarTab(this.dataset.tab, this); });
     });
  3. URLSearchParams com correcao de prefixo:
     var tab = new URLSearchParams(window.location.search).get('tab');
     var tabId = tab.startsWith('tab-') ? tab : 'tab-' + tab;
     var el = document.getElementById(tabId);
REGRA GERAL: redirect deve passar o mesmo valor que o data-tab do botao, OU o URLSearchParams deve normalizar o prefixo.


---

## 36. MEMBROS DUPLICADOS — CAUSA RAIZ E CORRECAO

**Problema:** Membros aparecem duplicados na lista de participantes do sorteio e no sistema.

**Causa raiz:** Dois cadastros criados para a mesma pessoa — um via sincronizacao automatica do ligante (JOIN por email) e outro criado manualmente com email diferente. O sistema cria membro automaticamente via email do ligante, mas se alguem cadastrar manualmente com outro email, gera duplicata.

**Como identificar duplicados:**
```sql
SELECT MIN(nome) as nome, COUNT(*) as total, array_agg(email) as emails, array_agg(id) as ids
FROM membros WHERE ativo=1
GROUP BY LOWER(nome)
HAVING COUNT(*) > 1
ORDER BY MIN(nome);
```

**Procedimento de correcao (sem perder dados):**
1. Identificar qual ID tem mais presencas (dados corretos)
2. Verificar presenças de cada ID por atividade
3. Migrar presencas do ID incorreto para o ID correto por atividade_id
4. Atualizar email do ID correto para o email do ligante (JOIN funcionar)
5. Desativar ID incorreto: UPDATE membros SET ativo=0 WHERE id=X
6. Remover da turma: DELETE FROM turma_membros WHERE membro_id=X
7. NUNCA usar DELETE em membros — sempre desativar com ativo=0

**REGRA CRITICA:** O JOIN ligante-membro e feito por LOWER(email). Se o email do membro nao bater com o email do ligante, o portal do membro nao funciona corretamente e podem aparecer dados incorretos.

**Casos corrigidos em 17/06/2026:**
- Rafael de Lima Oliveira: id=46 (desativado) → id=62 (ativo, email corrigido, 6/6 presencas migradas)
- Hugo Fernando Carvalho Massaferro: id=58 (desativado, turma errada) → id=19 (ativo, email corrigido)
- Lucas Dos Santos Pereira: id=61 (desativado, turma errada) → id=38 (ativo)


---

## 37. MODAL DETALHES LIGANTE NAO ABRIA — CSP + STOPROPAGATION + ID TYPE MISMATCH

**Problema:** Botao "Detalhes" na pagina de ligantes nao abria o modal.

**3 causas raiz:**
1. onclick="abrirDetalhe(...)" bloqueado pelo CSP
2. div pai com onclick="event.stopPropagation()" bloqueava o click antes de chegar ao addEventListener
3. Comparacao x.id === id falhava porque dataset retorna string e ligantes.id e number

**Solucao:**
1. Trocar onclick por data-ligante-id + addEventListener com e.target.closest()
2. Remover onclick="event.stopPropagation()" do div pai
3. Corrigir comparacao: String(x.id) === String(id)

**Codigo correto:**
```javascript
document.addEventListener('click', function(e) {
  var btn = e.target.closest('.btn-abrir-detalhe-card');
  if(btn) { e.stopPropagation(); abrirDetalhe(btn.dataset.liganteId); }
});
function abrirDetalhe(id) {
  const l = ligantes.find(x => String(x.id) === String(id));
  ...
}
```

**REGRA:** Sempre usar String() ao comparar IDs vindos de dataset com IDs de objetos JS.

---

## PROBLEMA: Botões da sidebar não clicáveis (JS quebrado)
**Sintoma:** Nenhum botão da sidebar responde ao clique. Console mostra SyntaxError.
**Causa raiz:** Erro de sintaxe JavaScript no arquivo dashboard.ejs quebra TODO o JS da página, impedindo qualquer event listener de funcionar.
**Como diagnosticar:** Abrir DevTools (F12) → Console → procurar SyntaxError ou ReferenceError.

**Causas já encontradas e corrigidas (atacar nesta ordem):**

1. Regex /\s+/ dentro de EJS — Fix: .split(' ').filter(function(x){return x;})
2. onerror com aspas conflitantes — Fix: usar this.style.display='none' ou &quot;
3. onclick com aspas simples em JS dinamico — Fix: usar data-pix attribute
4. replace(/'/g) em JS — Fix: .split("'").join("&apos;")
5. replace(/<[^>]*>/g) em JS — Fix: remover ou usar .substring() direto

**Verificacao rapida:**
python3 -c "import re; c=open('/var/www/liga-urologia/views/pages/membro/dashboard.ejs').read(); js=re.sub(r'<%[^%]*%>','null',c); scripts=re.findall(r'<script[^>]*>(.*?)</script>',js,re.DOTALL); open('/tmp/check_js.js','w').write('\n'.join(scripts))"
node --check /tmp/check_js.js 2>&1 | head -5


---

## [2026-06-20] VISUALIZADOR DE ARQUIVOS NO PORTAL DO MEMBRO

### Problema
Arquivos (PDF, DOCX, vídeo) abriam em nova aba ou mostravam "Este conteúdo está bloqueado" ao tentar abrir em iframe dentro do portal.

### Causas raiz identificadas
1. `frameSrc: ["'none'"]` no helmet CSP bloqueava qualquer iframe
2. `require('./arquivos')` com caminho errado — correto é `require('../services/arquivos')`
3. `req.body` lido ANTES do multer processar o form → campos chegavam `undefined`
4. `getSignedDownloadUrl` não existia em `services/arquivos.js` — função correta é `gerarUrlInline`
5. Botões com `onclick="fn('+var+','+JSON.stringify(tipo)+')"` quebravam HTML quando tipo continha aspas duplas — solução: usar `data-mid` e `data-mtipo` + delegação de evento
6. Rota `/materiais/:id/arquivo` sem prefixo `/membro/` era bloqueada pelo nginx do domínio membro

### Solução aplicada
1. CSP: `frameSrc: ["'self'", "https://view.officeapps.live.com"]`
2. Rota proxy `/membro/materiais/:id/proxy` — serve o arquivo direto pelo Node (evita X-Frame-Options do R2)
3. Rota `/membro/materiais/:id/arquivo?inline=1` retorna JSON `{ url, nome, tipo }`
4. Modal interno com lógica por tipo:
   - PDF → `<iframe src="/membro/materiais/ID/proxy">`
   - DOCX → `<iframe src="https://view.officeapps.live.com/op/embed.aspx?src=...">`
   - Vídeo → `<video controls>`
   - Imagem → `<img>`
5. Botões usam `data-mid` e `data-mtipo` + `document.addEventListener('click', e.target.closest('.btn-mat-ver'))`
6. `req.body` movido para DENTRO do callback do multer (após o `upload.single()(req,res,cb)`)

### Arquivos modificados
- `/var/www/liga-urologia/src/routes/index.js` — rotas, CSP, proxy
- `/var/www/liga-urologia/src/services/arquivos.js` — adicionado `gerarUrlTemporaria` e alias `getSignedDownloadUrl`
- `/var/www/liga-urologia/views/pages/membro/dashboard.ejs` — modal + botões com data-attributes

---

## [2026-06-20] PIX EXPIRADO + VALOR ERRADO NO PORTAL + CPF INVÁLIDO

### Problema
1. PIX de todos os membros expiravam dia 15 (data de vencimento) — após essa data o QR Code fica inválido no PagBank
2. Portal do membro mostrava R$20 mesmo após dia 15 — lógica de data com `new Date('YYYY-MM-DD')` interpreta como UTC e retorna dia errado no fuso -03:00
3. Thayane Cristina (membro_id=55) com CPF 178.088.447-89 (dígito errado) — PagBank rejeita CPF inválido matematicamente. CPF correto: 178.088.447-80

### Causa raiz
1. `new Date('2026-06-15')` em JS = UTC meia-noite = dia 14 no fuso -03:00 → `hoje.getMonth() === venc.getMonth()` sempre verdadeiro mesmo após vencimento
2. PIX gerado com `expiration_date` = data de vencimento (dia 15) → expira junto com o vencimento
3. CPF cadastrado com dígito verificador errado (89 em vez de 80)

### Solução aplicada
1. Lógica de data corrigida — usar `.substring(0,10).split('-')` para comparar ano/mês/dia sem conversão de fuso:
```js
   var vencParts = vencStr.split('-');
   var dentroDesc = hoje.getFullYear()===parseInt(vencParts[0]) && hoje.getMonth()+1===parseInt(vencParts[1]) && hoje.getDate() <= 15;
```
2. PIX regerado com vencimento 30/06/2026 (último dia do mês) via script `regerar_pix.js`
3. CPF da Thayane corrigido no banco: `UPDATE membros SET cpf='178.088.447-80' WHERE id=55`

### Regra de negócio confirmada
- Vencimento = dia 15 do mês
- Até dia 15: R$20,00 (com desconto)
- A partir do dia 16: R$25,00 (valor cheio)
- PIX deve ser gerado com expiration_date = último dia do mês (não dia 15!)

### Ação preventiva necessária
- Rotina mensal deve gerar PIX com vencimento no último dia do mês
- Nunca usar `expiration_date` = dia 15 (data de desconto ≠ data de expiração do PIX)
- Sempre validar CPF matematicamente antes de salvar no banco
- PagBank limita PIX a máximo 180 dias — nunca usar mais que isso
- PagBank NÃO permite regerar PIX de ordem já existente com PIX ativo — esperar expirar ou criar nova ordem
- Rotina `atualizarPixAtrasados()` roda diariamente às 8h e gera PIX para cobranças sem gateway

---

## [2026-06-20] PIX LONGA DURAÇÃO + ROTINA AUTOMÁTICA + VALOR CORRETO

### Problema estrutural corrigido na raiz
1. PIX gerado com vencimento = dia 15 → expirava junto com o desconto
2. PIX gerado com valor_desconto (R$20) → PagBank não muda valor automaticamente
3. Sem rotina para atualizar PIX de cobranças atrasadas → intervenção manual todo mês

### Solução definitiva implementada
1. `agendamentos.js` — PIX agora gerado com `valor_cheio` (R$25) e vencimento `hoje + 365 dias`
2. `pagbank.js` — `toExpDate` padrão alterado de 7 dias para 365 dias
3. Nova função `atualizarPixAtrasados()` — roda todo dia às 8h, gera PIX para quem não tem
4. Portal do membro exibe R$20 se até dia 15, R$25 se depois — sem gerar novo PIX

### Arquivos modificados
- `/var/www/liga-urologia/src/services/agendamentos.js`
- `/var/www/liga-urologia/src/services/pagbank.js`

### Regra definitiva
- PIX → sempre valor_cheio + vencimento 365 dias
- Portal → calcula desconto na exibição (não no PIX)
- Cron 8h diário → gera PIX faltante automaticamente

---

## [2026-06-20] MENSALIDADE ERRADA NO CADASTRO DE MEMBROS

### Problema
4 membros cadastrados com mensalidade=100 e desconto_pontualidade=10 em vez de 25/20.
Isso causou cobrança de R$100 para o usuário teste (id=64) e valores inconsistentes
para Hugo (id=58), Lucas (id=61) e Rafael (id=62).

### Causa raiz
Cadastro de novos membros não tinha valor padrão fixo para mensalidade e desconto.
Quando o campo vinha vazio ou com valor herdado errado, salvava qualquer número.

### Solução aplicada no banco
```sql
UPDATE membros SET mensalidade=25, desconto_pontualidade=20 WHERE id IN (58, 61, 62, 64);
```

### Solução estrutural — validação na rota de cadastro
Adicionar sanitização obrigatória em toda rota que salva membro:
- mensalidade → sempre 25 se não informado ou inválido
- desconto_pontualidade → sempre 20 se não informado ou inválido

### Query de verificação (rodar quando suspeitar)
```sql
SELECT id, nome, mensalidade, desconto_pontualidade
FROM membros WHERE ativo=1 AND mensalidade != 25
ORDER BY mensalidade DESC;
```
Se retornar rows além de diretivos/casos especiais → corrigir imediatamente.

### Regra de negócio confirmada
- Todos os ligantes: mensalidade=25, desconto_pontualidade=20
- Valor cheio: R$25,00 (após dia 15)
- Valor com desconto: R$20,00 (até dia 15)

---

## [2026-06-20] CAUSA RAIZ MENSALIDADE ERRADA — PADRÃO 100/10 NA ROTA DE EDIÇÃO

### Problema
Membros sendo salvos com mensalidade=100 e desconto_pontualidade=10 ao editar cadastro.
Afetou: Hugo (id=58), Lucas (id=61), Rafael (id=62), Teste (id=64).

### Causa raiz exata
Rota `POST /membros/:id/editar` em `index.js` linha ~1015 tinha fallback errado:
```js
parseFloat(mensalidade)||100   // ERRADO — salvava 100 quando campo vazio
parseFloat(desconto_pontualidade)||10  // ERRADO — salvava 10 quando campo vazio
```

### Correção aplicada
```js
parseFloat(mensalidade)||25    // CORRETO — padrão ligante
parseFloat(desconto_pontualidade)||20  // CORRETO — padrão 20%
```

### Correção no banco
```sql
UPDATE membros SET mensalidade=25, desconto_pontualidade=20 WHERE id IN (58, 61, 62, 64);
UPDATE cobrancas SET valor_cheio=25, valor_desconto=20 WHERE referencia='64-2026-06';
```

### Query de auditoria — rodar mensalmente
```sql
SELECT id, nome, mensalidade, desconto_pontualidade
FROM membros WHERE ativo=1 AND mensalidade != 25
ORDER BY mensalidade DESC;
```
Resultado esperado: 0 rows. Se houver rows → corrigir imediatamente.

### PIX usuário teste (id=64, cobrança 140)
Gerado manualmente com 30 dias de validade pois PagBank rejeita
regerar PIX de ordem antiga com mais de 180 dias.
Rotina automática `atualizarPixAtrasados()` cobre futuros casos.

### Limites confirmados do PagBank
- PIX: máximo 180 dias de validade a partir de HOJE
- Não é possível regerar PIX de ordem com PIX ainda ativo
- Ordens antigas (criadas há meses) aceitam no máximo ~30 dias de nova validade
- Checkout cartão: requer allowlist (aguardando liberação chamado 1381618991)

---

## [2026-06-20] SIDEBAR E DASHBOARD SEM CONTROLE DE PERMISSÕES

### Problema
Sidebar mostrava TODOS os itens para todos os usuários independente das permissões.
Dashboard tinha links clicáveis (Acesso Rápido, "Ver todas", "Gerar Cobranças") sem verificação.

### Causa raiz
`sidebar.ejs` não verificava `permissoesAtivas` em nenhum item do menu.
`dashboard.ejs` tinha links fixos sem condicionais de permissão.

### Solução aplicada
1. `sidebar.ejs` reescrita com função `temPerm(modulo)` verificando cada item
2. `dashboard.ejs` — Acesso Rápido, botão "Gerar Cobranças", "Ver todas", "Ver todos" protegidos com `_tp(modulo)`
3. `permissoesAtivas` já estava em `res.locals` via `server.js` — disponível globalmente

### Regra
- Admin vê tudo sempre
- Outros usuários veem APENAS o que está em `usuario_permissoes`
- Grupos de menu só aparecem se o usuário tiver pelo menos 1 permissão do grupo
- Rotas protegidas por middleware `requirePermissao(modulo)` no backend — dupla proteção

---

## [2026-06-20] BLINDAGEM COMPLETA DO SISTEMA DE PERMISSÕES

### Problema raiz
Sistema tinha proteção APENAS na sidebar (visual) mas não no backend.
Qualquer usuário logado podia digitar a URL diretamente e acessar qualquer página.

### Dupla proteção implementada (frontend + backend)

#### Frontend — sidebar.ejs
- Reescrita completa com função `temPerm(modulo)`
- Cada item do menu verifica permissão antes de renderizar
- Grupos inteiros somem se nenhuma permissão do grupo existir
- Admin vê tudo; outros veem apenas o que foi concedido

#### Frontend — dashboard.ejs
- Botão "Gerar Cobranças" → só aparece com permissão `cobrancas`
- Acesso Rápido: Ligantes, Frequência, Eventos, Cobranças, Marketing, Aniversários → cada um verificado
- "Ver todas cobranças" e "Ver todos aniversários" → verificados

#### Backend — rotas protegidas com requirePermissao()
Rotas que tinham apenas requireAuth e foram blindadas:
- GET /ligantes + sub-rotas → requirePermissao('ligantes')
- GET /marketing + sub-rotas → requirePermissao('marketing')
- GET /contratos → requirePermissao('contratos')
- GET /fluxo-caixa + sub-rotas → requirePermissao('fluxo-caixa')
- GET /arquivos → requirePermissao('arquivos')
- GET /carta-cobranca + sub-rotas → requirePermissao('carta-cobranca')
- GET /sorteios + sub-rotas → requirePermissao('sorteios')
- GET /inventario + sub-rotas → requirePermissao('inventario')
- GET /atas + sub-rotas → requirePermissao('atas')
- GET /comunicados → requirePermissao('comunicados')

### Como funciona requirePermissao()
```js
// middleware/auth.js
function requirePermissao(modulo) {
  return async (req, res, next) => {
    if (usuario.perfil === 'admin') return next(); // admin passa sempre
    const r = await query('SELECT id FROM usuario_permissoes WHERE usuario_id=$1 AND modulo=$2', [usuario.id, modulo]);
    if (r.rows.length > 0) return next(); // tem permissão → passa
    req.flash('erro', 'Você não tem permissão para acessar este módulo.');
    res.redirect('/dashboard'); // sem permissão → volta pro dashboard
  };
}
```

### Regras definitivas do sistema
1. Admin (perfil=admin) → acesso total a tudo
2. Outros perfis → acesso APENAS ao que está em `usuario_permissoes`
3. Toda nova rota criada DEVE ter `requirePermissao('modulo')` além do `requireAuth`
4. Toda nova entrada na sidebar DEVE ter `<% if (temPerm('modulo')) { %>` em volta
5. Dashboard — qualquer novo link ou botão DEVE ter `<% if (_tp('modulo')) { %>`

### Pendência
- Aguardar confirmação de Renata e Kauê que a sidebar está correta
- Verificar se há outras rotas POST sem proteção de permissão

### Query de auditoria — verificar rotas sem proteção
```bash
grep -n "router.get\|router.post" /var/www/liga-urologia/src/routes/index.js | grep "requireAuth, async" | grep -v "requirePermissao\|requireAdmin\|requireSecretaria\|requireFinanceiro\|requirePresidencia"
```

---

## [2026-06-20] QR CODE PIX E REFERÊNCIA DE COBRANÇA NO PORTAL DO MEMBRO

### Problema 1 — QR Code decorativo
Seção Início mostrava 3 quadradinhos SVG estáticos em vez do QR Code real escaneável.

### Causa raiz
`pix_qr_image` (URL PNG do PagBank) estava vazio em todas cobranças.
O SVG era apenas decorativo, não representava o PIX real.

### Solução
Gerar QR Code dinamicamente no browser via `qrcodejs` a partir do `pix_copia_cola`:
- Adicionado `qrcode.min.js` do cdnjs
- `<canvas id="qr-canvas-inicio">` substitui o SVG estático
- Script inicializa QRCode com o texto do `#pixCode` após DOM carregado
- Funciona para TODOS os membros automaticamente — correção na raiz do template

### Problema 2 — Referência no formato errado
Cobranças geradas pelo sistema mostravam `64-2026-06` em vez de `JUN/2026`.
Cobranças manuais de teste usavam `MAR/2026` etc. — dois formatos diferentes.

### Causa raiz
Regex com grupos de captura errados: usava `_refM[2]` para mês quando deveria ser `_refM[3]`.

### Solução
Regex corrigido: `/^\d+-(\d{4})-(\d{2})$/` com grupos simples:
- `_refParts[1]` = ano (2026)
- `_refParts[2]` = mês (06)
- Resultado: `_mesesJs[parseInt(_refParts[2])-1]+'/'+_refParts[1]` → `JUN/2026`
Aplicado em DOIS lugares: seção Inicio (EJS) e seção Financeiro (JS AJAX)

### Formato padrão das referências
- Sistema automático: `ID-AAAA-MM` ex: `64-2026-06` → exibido como `JUN/2026`
- Cobranças manuais: `MES/AAAA` ex: `JUN/2026` → exibido como está

---

## [2026-06-20] COBRANÇAS DUPLICADAS — DIAGNÓSTICO E CORREÇÃO

### Problema
3 membros com 2 cobranças de junho/2026:
- Hugo Fernando (membro 19→58): paga + atrasada duplicada
- Lucas Dos Santos (membro 38→61): paga + atrasada duplicada  
- Teste Ligante (136+140): manual sem PIX + automática com PIX

### Causa raiz
Quando regeramos os PIX manualmente (script regerar_pix.js), o sistema criou
novas cobranças com referências novas (58-2026-06, 61-2026-06) para membros
que já tinham cobranças pagas com IDs antigos (19-2026-06, 38-2026-06).
Isso aconteceu porque Hugo e Lucas tinham IDs de membro diferentes dos IDs
usados nas referências originais (membros recém-cadastrados com IDs 58,61
mas cobranças antigas com IDs 19,38).

### Solução aplicada
```sql
UPDATE cobrancas SET status='cancelado' WHERE id IN (131, 134, 136);
```

### Query de auditoria — rodar mensalmente
```sql
SELECT m.nome, 
       SUBSTRING(c.referencia FROM '\d{4}-\d{2}$') as mes_ano,
       COUNT(*) as qtd,
       array_agg(c.referencia ORDER BY c.id) as referencias,
       array_agg(c.status ORDER BY c.id) as status_list
FROM cobrancas c
JOIN membros m ON m.id = c.membro_id
WHERE c.referencia ~ '^\d+-\d{4}-\d{2}$'
GROUP BY m.nome, SUBSTRING(c.referencia FROM '\d{4}-\d{2}$')
HAVING COUNT(*) > 1
ORDER BY m.nome;
```
Resultado esperado: 0 rows. Se houver → cancelar a duplicata mais recente.

### Prevenção
O script regerar_pix.js foi removido após uso.
A rotina atualizarPixAtrasados() atualiza PIX existentes sem criar novos registros.

---

## [2026-06-20] COBRANÇAS CANCELADAS APARECENDO NO PORTAL DO MEMBRO

### Problema
Portal do membro exibia cobranças com status='cancelado' nas seções Início e Financeiro.

### Causa raiz
3 queries sem filtro de status='cancelado':
1. `/membro/financeiro/dados` — retornava TODAS as cobranças incluindo canceladas
2. `/membro/financeiro` (page render) — mesma query sem filtro
3. `/membro/dashboard` — pegava a cobrança mais recente por data_vencimento DESC podendo pegar cancelada

### Correção aplicada nas 3 queries
```sql
-- Antes
WHERE membro_id=(...) ORDER BY data_vencimento DESC

-- Depois
WHERE membro_id=(...) AND status != 'cancelado' ORDER BY data_vencimento DESC

-- Dashboard (cobrança atual) — filtro adicional
WHERE membro_id=(...) AND status != 'cancelado' AND status IN ('pendente','atrasado')
ORDER BY data_vencimento DESC LIMIT 1
```

### Regra definitiva
Toda query que busca cobranças para exibir ao membro DEVE filtrar `status != 'cancelado'`

### Resultado confirmado
✅ Correção validada em 20/06/2026 — portal do membro exibe apenas cobranças ativas.
Usuário teste passou de 2 cobranças para 1 cobrança de junho após filtro aplicado.

---

## [2026-06-20] COMUNICADOS — PONTO VERMELHO E BADGE SIDEBAR

### Problema
1. Ponto vermelho do comunicado não desaparecia após leitura
2. Badge número na sidebar não atualizava após leitura
3. Sistema usava índice `i < comunicadosNaoLidos` em vez de rastrear leituras individuais

### Causa raiz
Não existia tabela de leituras — sistema usava `ultimo_acesso_comunicados` de outra tabela,
que não rastreava comunicados individuais lidos.

### Solução aplicada
1. Criada tabela `comunicados_leituras`:
```sql
CREATE TABLE comunicados_leituras (
  id SERIAL PRIMARY KEY,
  comunicado_id INTEGER REFERENCES comunicados(id) ON DELETE CASCADE,
  membro_tipo VARCHAR(20),
  membro_id INTEGER,
  lido_em TIMESTAMP DEFAULT NOW(),
  UNIQUE(comunicado_id, membro_tipo, membro_id)
);
```
2. Query do dashboard atualizada com LEFT JOIN para retornar campo `lido` por comunicado
3. Rota `POST /membro/comunicado/:id/lido` criada para registrar leitura
4. `dashboard.ejs` — dots usam `!comunicados[i].lido` em vez de índice
5. Função `marcarLido()` no JS — apaga dot, remove classe `unr`, atualiza badge sidebar
6. Badge da sidebar tem `id="ni-bdg-comunicados"` para ser encontrado pelo JS

---

## [2026-06-20] CHAT BOTÃO FLUTUANTE — NÃO CLICÁVEL E POSIÇÃO ERRADA

### Problema
1. Botão do chat estava sendo coberto pelo rodapé (não clicável)
2. Chat não abria ao clicar
3. Código JS solto fora de função causava SyntaxError quebrando todo o JS da página

### Causa raiz
1. `z-index:500` do chat menor que elementos do layout
2. Footer com `z-index` sem definição sobrepunha o botão
3. Durante fix de referência de cobrança, código do `forEach` financeiro ficou
   duplicado e solto fora de qualquer função — quebrando todo o JS

### Solução aplicada
1. `chat-btn` → `bottom:80px`, `z-index:9990`, `pointer-events:all`
2. `chat-panel` → `bottom:140px`, `z-index:9990`
3. `footer` → `z-index:10` (menor que chat)
4. Código JS solto removido com busca por índice de string
5. Verificação obrigatória após qualquer edição:
```bash
python3 -c "
import re
c=open('/var/www/liga-urologia/views/pages/membro/dashboard.ejs').read()
js=re.sub(r'<%[^%]*%>','null',c)
scripts=re.findall(r'<script[^>]*>(.*?)</script>',js,re.DOTALL)
open('/tmp/check_js.js','w').write('\n'.join(scripts))
"
node --check /tmp/check_js.js 2>&1
```
Resultado esperado: nenhuma saída (sem erros)

---

## [2026-06-21] ERRO htmlDir is not defined — ROTA inscritos-pdf

### Problema
`GET /eventos/:id/inscritos-pdf` retornava "Erro: htmlDir is not defined"

### Causa raiz
A rota terminava com `res.send(html + htmlDir)` mas `htmlDir` nunca foi definido
nessa rota — é uma variável de outras rotas de relatório que foi copiada incorretamente.

### Correção
```js
// Antes
res.send(html + htmlDir);
// Depois  
res.send(html);
```

### Prevenção
Toda rota que usa `htmlDir` deve defini-la localmente antes de usar.
Nunca assumir que variável existe por estar em outra rota do mesmo arquivo.

---

## [2026-06-21] DOWNLOAD EXCEL/CSV DE INSCRITOS EM EVENTOS

### Implementação
Nova rota `GET /eventos/:id/inscritos-excel` criada para exportar inscritos em CSV.

### Funcionalidades
- Mesmos filtros do PDF: status, tipo, busca, lote
- Campos exportados: #, Nome, Email, WhatsApp, CPF, RG, Instituição, Lote, Status, Isento, Semestre, Turma, Tipo Participante, Check-in, Inscrito em
- BOM UTF-8 para abertura correta no Excel (caracteres especiais)
- Separador ponto-e-vírgula (padrão Excel Brasil)
- Nome do arquivo gerado automaticamente: `NOME_EVENTO_inscritos.csv`

### Botão adicionado
`evento-detalhe.ejs` linha 582 — botão verde "⬇ Excel / CSV" ao lado de "Imprimir filtrados"

### Função JS
```js
function exportarExcel(){
  var p = new URLSearchParams();
  // captura filtros ativos (busca, status, tipo, lote)
  window.location.href='/eventos/ID/inscritos-excel?'+p.toString();
}
```

### Validação
- Evento 4: 139 confirmados + 20 cancelados
- Filtro `?status=confirmado` retorna exatamente 139 registros ✅
- Filtro `?status=cancelado` retorna exatamente 20 registros ✅

---

## [2026-06-21] htmlDir is not defined — 8 ROTAS AFETADAS

### Problema
Múltiplas rotas de relatório PDF retornavam "Erro: htmlDir is not defined"

### Rotas afetadas (linhas)
2746, 3622, 3756, 3863, 4663, 4827, 4874, 5501

### Causa raiz
`htmlDir` é definido apenas em algumas rotas mas `res.send(html + htmlDir)` 
foi copiado para outras rotas sem a variável ser definida.

### Correção em massa
```python
# Script de diagnóstico — identifica rotas sem htmlDir
for lineno in ocorrencias:
    bloco = linhas[lineno-100:lineno]
    tem_htmlDir = 'const htmlDir' in bloco or 'var htmlDir' in bloco
    
# Correção — substitui 'html + htmlDir' por 'html' nas rotas sem definição
line.replace('res.send(html + htmlDir)', 'res.send(html)')
```

### Prevenção
Antes de usar qualquer variável em `res.send()`, verificar se ela foi definida
na mesma função/rota. Nunca copiar `res.send()` de outra rota sem revisar.

### Query de auditoria futura
```bash
grep -n "res.send(html + htmlDir)" /var/www/liga-urologia/src/routes/index.js
# Verificar se todas as ocorrências têm htmlDir definido nas 100 linhas anteriores
```

---

## [2026-06-21] ABA MALA DIRETA NÃO FUNCIONAVA — QUILL INICIALIZADO ANTES DO DOM

### Problema
Aba "Mala Direta" no evento-detalhe não abria/funcionava.

### Causa raiz
`var _qMassaEv = new Quill('#quill-massa-evento')` era executado imediatamente
no carregamento da página, antes do elemento estar visível (estava em aba oculta).
Isso causava erro silencioso no Quill que quebrava outras funcionalidades da página.

### Solução
Converter para inicialização lazy (sob demanda):
```js
// Antes — executava no carregamento
var _qMassaEv = new Quill('#quill-massa-evento', {...});

// Depois — inicializa só quando aba é aberta
var _qMassaEv = null;
function initQuilMassaEv() {
  if (_qMassaEv) return; // evita reinicialização
  var el = document.getElementById('quill-massa-evento');
  if (!el) return;
  _qMassaEv = new Quill('#quill-massa-evento', {...});
}
// Chamado em showTab():
if (id === 'inscritos') { initQuilMassaEv(); }
if (id === 'mala-direta') { initQuilMala(); carregarHistorico(); }
```

### Regra definitiva
Qualquer editor Quill dentro de aba oculta DEVE ser inicializado lazy.
Nunca instanciar `new Quill()` diretamente no carregamento se o elemento
pode estar em aba/modal oculto.

---

## [PENDENTE] PAGBANK CARTÃO — HOMOLOGAÇÃO

### Status
Aguardando liberação do PagBank em produção.
Chamado: 1381618991
Contato: Alan Alves — Integrações PagBank

### O que foi feito
- Testes Sandbox realizados em 21/06/2026
- PIX: ORDE_A67D1C8A-0B54-4081-BB4E-0D156A1C298A → HTTP 201 ✅
- Checkout Cartão: CHEC_4D12E5DA → HTTP 201 ✅
- Logs enviados ao Alan por email

### Quando liberar
1. Remover badge "Em breve" do botão Cartão no portal do membro
2. Implementar fluxo de pagamento com cartão
3. Testar em produção

---

## [2026-06-21] INVALID DATE — DATA DE NASCIMENTO EM DIRETIVOS E LIGANTES

### Problema
Data de nascimento exibida como "Invalid Date" na tela de detalhes de diretivos.

### Causa raiz
`new Date('1988-01-21')` sem timezone → interpretado como UTC meia-noite
→ ao converter para horário local (UTC-4 Paraguai) → regride para dia anterior
→ em alguns navegadores resulta em "Invalid Date".

### Solução aplicada em 6 arquivos
Substituir `new Date(d.data_nascimento)` por `new Date(String(d.data_nascimento).substring(0,10)+'T12:00:00')`:
- `diretivos.ejs` ✅
- `diretivos-relatorio.ejs` ✅
- `ligantes.ejs` ✅
- `ligantes-relatorio.ejs` ✅
- `ligante-editar.ejs` ✅
- `membro-editar.ejs` ✅

### Regra definitiva
SEMPRE usar `String(data).substring(0,10)+'T12:00:00'` ao converter datas do banco para exibição.
NUNCA usar `new Date('YYYY-MM-DD')` diretamente — causa problema de fuso horário.

### Pente fino realizado
- 12 diretivos verificados — todos com formato correto no banco ✅
- 57+ ligantes verificados — todos com formato correto no banco ✅
- Problema era apenas na exibição, não nos dados armazenados

---

## [2026-06-21] ROLETA ANIMADA — SELEÇÃO MISTA DE PARTICIPANTES

### Problema
Roleta animada não permitia selecionar participantes individuais — só aceitava todos os ligantes, todos os diretivos ou lista manual sem misturar.

### Solução implementada
Nova opção "Selecionar da lista (ligantes + diretivos)" com:
1. Checkboxes individuais para cada ligante (verde) e diretivo (azul)
2. Botões "Todos ligantes", "Todos diretivos" e "Limpar"
3. Campo de externos para adicionar nomes não cadastrados
4. Contador de selecionados em tempo real
5. Roleta sorteia APENAS os selecionados + externos digitados

### Bugs corrigidos no processo
- `overflow: hidden` no body bloqueava scroll → corrigido para `overflow-x:hidden; overflow-y:auto`
- Função `iniciarRoleta()` duplicada — segunda versão sem modo seleção sobrescrevia a correta → removida
- `\n` literal dentro de `.split()` causava SyntaxError → corrigido com regex
- Bloco JS solto fora do `</html>` → removido
- Função `atualizarFonte()` não chamada no carregamento → adicionado `atualizarFonte()` antes do `</script>`
- `campoManual` aparecia por padrão → adicionado `style="display:none"` e select inicia com `selecao selected`
- Nomes dos checkboxes invisíveis (cor escura) → adicionado `color:#fff` nos labels

### Verificação final
- JS sem erros de sintaxe ✅
- 1 única função `iniciarRoleta` ✅
- Modo seleção presente ✅
- Overflow corrigido ✅
- Funcionamento confirmado em produção ✅

---

## [2026-06-22] WHATSAPP BLOQUEADO — LIMITE DE MENSAGENS EXCEDIDO

### Problema
WhatsApp Business banido novamente. Sistema enviou 15 mensagens de atrasados de uma vez.

### Causa raiz
`LIMITE_DIARIO = 999` — sem limite real de proteção.
Função de atrasados não tinha teto máximo por execução, enviando para todos os atrasados de uma vez.

### Correção aplicada
1. `LIMITE_DIARIO` reduzido de 999 → **20 mensagens/dia** total
2. Função `enviarAtrasados()` limitada a **máx 5 mensagens por execução**
3. Todas as notificações pausadas exceto aniversários

### Estado atual dos disparos
- Aniversários: ✅ Ativo (poucos, esporádicos)
- Atrasados diário: ⏸ Pausado (aguardar liberação WA)
- Dia do vencimento: ⏸ Pausado
- Pós 1 dia: ⏸ Pausado
- Pós 7 dias: ⏸ Pausado
- Pré-evento: ⏸ Pausado

### Regra definitiva
NUNCA reativar disparos em massa sem limites rígidos.
Antes de reativar qualquer disparo, verificar:
- LIMITE_DIARIO <= 20
- MAX por função <= 5
- Intervalo entre mensagens >= 120s
- Pausa entre lotes >= 900s

### Ação pendente
Aguardar análise do WhatsApp (até 24h).
Após liberação: reativar gradualmente, 1 notificação por vez, monitorando por 48h antes de adicionar outra.

---

## [2026-06-22] MIGRACAO Z-API PARA EVOLUTION API

### Problema
Z-API causava bloqueios recorrentes. Custo R$100/mes sem servico confiavel.

### Solucao
Evolution API v1.8.2 open source instalada no proprio servidor Hetzner. Custo zero.

### Instalacao
- Docker v29.6.0 instalado
- Evolution API v1.8.2 porta 8080
- Instancia: lauro-liga
- API Key: lauro-evolution-2026-key
- Webhook: https://sistema.lauroucpcde.com/webhook/whatsapp
- Auto-restart configurado

### Arquivos modificados
- src/services/lauro.js - funcoes de envio migradas
- src/routes/index.js - webhook atualizado para formato Evolution API
- .env - variaveis ZAPI removidas, EVOLUTION adicionadas

### Pendencia
Aguardar liberacao do numero WhatsApp para escanear QR Code.

---

## [2026-06-22] FLUXO DE CAIXA - MENSALIDADES NAO LANCADAS AUTOMATICAMENTE

### Problema
15 pagamentos de mensalidades confirmados nao entraram no fluxo de caixa.
`lancado_fluxo = false` em cobrancas com status `pago`.

### Causa raiz
1. Pagamentos antigos feitos antes da funcao `lancarMensalidadeNoFluxo` existir
2. Webhook PagBank nao extraia `metodo` do `processarWebhook()` corretamente

### Correcoes aplicadas
1. Corrigido destructuring: `const { orderId, referencia, status, pago, metodo }`
2. Criada funcao `auditarFluxoCaixa()` no agendamentos.js que:
   - Busca todas cobrancas com status=pago e lancado_fluxo=false
   - Lanca automaticamente no fluxo de caixa
   - Roda diariamente as 8h junto com outras rotinas
3. Lancados manualmente os 15 pagamentos pendentes

### Regra de calculo do valor liquido
- Pago ate o vencimento (dia 15): valor COM desconto (R$20) * 0.981 = R$19,62
- Pago apos o vencimento: valor CHEIO (R$25) * 0.981 = R$24,53
- Taxa PagBank PIX: 1.9%
- Taxa PagBank Cartao: 4%

### Verificacao pos-correcao
```sql
SELECT COUNT(*) FROM cobrancas WHERE status='pago' AND lancado_fluxo=false;
-- Resultado esperado: 0
```

---

## [2026-06-22] FLUXO DE CAIXA - VALOR ERRADO POS DIA 15

### Problema
Mensalidades pagas apos dia 15 estavam sendo lancadas com valor de desconto (R$19,62)
em vez do valor cheio liquido (R$24,53).

### Causa raiz
Logica de calculo usava `data_vencimento` da cobranca para decidir qual valor usar.
Porem algumas cobranças tinham vencimento incorreto (ex: dia 30).
A regra real do sistema e: vencimento FIXO dia 15 de cada mes.

### Correcao na raiz (fluxo-mensalidade.js)
```js
// ANTES - usava data_vencimento da cobranca (podia estar errada)
const vencDia = new Date(venc.getFullYear(), venc.getMonth(), venc.getDate());

// DEPOIS - vencimento fixo dia 15 do mes do pagamento
const diaVenc = new Date(pag.getFullYear(), pag.getMonth(), 15);
```

### Regra definitiva
- Pago ate dia 15: bruto R$20,00 → liquido R$19,62 (taxa PIX 1.9%)
- Pago apos dia 15: bruto R$25,00 → liquido R$24,53 (taxa PIX 1.9%)

### Correcao retroativa
3 lancamentos corrigidos manualmente:
- Rafael de Lima Oliveira (id 975): R$19,62 → R$24,53
- Edison Goulart Flores Junior (id 989): R$19,62 → R$24,53
- Brenda Santos Lao Oliveira (id 990): R$19,62 → R$24,53

---

## [2026-06-22] FLUXO DE CAIXA - MELHORIAS E CORRECOES

### 1. Botoes Visualizar e Baixar documentos
Adicionados botoes de olho (visualizar) e seta (baixar) na coluna de acoes
de cada lancamento que possui NF/Comprovante anexado.
Rotas criadas: GET /fluxo-caixa/doc/visualizar e GET /fluxo-caixa/doc/baixar

### 2. Suporte a 2 documentos por lancamento
- Novas colunas no banco: nf_chave2, nf_nome_original2
- Upload de ate 2 arquivos por lancamento (imagem ou PDF)
- Util para anexar comprovante PIX + nota fiscal em Guarani

### 3. Documento obrigatorio para Saidas
Lancamentos de SAIDA bloqueados se nao houver ao menos 1 documento anexado.
Validacao no frontend (JS) com alerta ao usuario.
Asterisco vermelho aparece no campo quando tipo = Saida.
Edicao de lancamentos ja existentes com NF nao exige novo upload.

### Arquivos modificados
- views/pages/fluxo-caixa.ejs
- src/routes/index.js (rotas novo, editar, visualizar, baixar)
- Banco: ALTER TABLE fluxo_caixa ADD COLUMN nf_chave2, nf_nome_original2

### Regra definitiva
Todo lancamento de SAIDA deve ter comprovante anexado.
Sistema bloqueia o salvamento sem documento para saidas.

---

## [2026-06-22] ERRO 413 REQUEST ENTITY TOO LARGE — UPLOAD DE MATERIAIS

### Problema
Upload de arquivos grandes retornava erro 413 do nginx.

### Causa raiz
`client_max_body_size` configurado como 50m no nginx.conf global.

### Correcao
Aumentado para 500M em todos os arquivos:
- /etc/nginx/nginx.conf: 50m → 500M
- /etc/nginx/sites-enabled/liga-urologia: → 500M
- /etc/nginx/sites-enabled/membro-lauro: → 500M
- /etc/nginx/sites-enabled/cientifico-lauro: → 500M
- /etc/nginx/sites-enabled/inscricao-lauro: → 500M

## [26] Carta de Notificacao — 23/06/2026
- Tabela: cartas_notificacao (membro_id, ligante_id, diretivo_id, texto_livre, status, numero_carta, numero_ordinal)
- 3 tipos de destinatario: Membro, Ligante, Diretivo
- Editor rico Quill.js (Snow, CDN) no modal de criacao e edicao
- Numeracao global automatica: seq_numero_carta (compartilhada com cartas_cobranca)
- Ordinal por pessoa: calcularOrdinalPessoa() conta cobranca+notificacao antes do INSERT
- Frase automatica em toda carta: "Esta es su [Primera/...] notificacion oficial"
- Contagem unificada (cobranca+notificacao) com badges laranja(2) e vermelho(3+)
- Botao Editar: so para status=pendente, modal Quill pre-carregado, bloqueado apos envio
- Assinaturas: Presidente + Secretario lado a lado
- Sidebar: grupo Gestao | Permissao: carta-notificacao | Perfis: admin, presidencia, secretaria
- GRANT ALL ON TABLE cartas_notificacao TO ligauser + sequences
- Carta de Cobranca tambem atualizada: N°, coluna Notificacoes, frase ordinal no PDF

## [27] Regra Raiz — Permissoes PostgreSQL — 23/06/2026
- Toda tabela criada via sudo -u postgres psql precisa:
  GRANT ALL ON TABLE <tabela> TO ligauser;
  GRANT USAGE, SELECT ON SEQUENCE <tabela>_id_seq TO ligauser;
- Sequencias customizadas tambem precisam de GRANT USAGE, SELECT para ligauser

## [29] Remocao Botao Novo Cadastro Financeiro — 23/06/2026
- Removido botao "+ Novo cadastro" da topbar de /membros
- Removido modal "modal-membro" completo (4807 chars) da view membros.ejs
- Rota POST /membros/nova mantida no backend por seguranca (nao exposta na UI)
- Cadastro financeiro agora e 100% automatico via aprovacao de ligante
- Garante: sem falhas de cadastro manual, sem divergencia de dados, sem cobranças indevidas

## [30] Filtros na Carta de Notificacao — 23/06/2026
- Filtros no backend (query string GET): status, tipo, notif, busca
- Filtro Status: Todos | Enviadas | Pendentes
- Filtro Tipo: Todos | Ligantes | Diretivos | Membros
- Filtro Notificacoes: Todas | 1 notif. | 2 notif. (laranja) | 3+ notif. (vermelho)
- Busca por nome com debounce 400ms (submit automatico do form)
- Label de filtros ativos com contador de resultados
- Botao "Limpar filtros" aparece quando algum filtro esta ativo
- HAVING clause para filtro por contagem (subquery com total_notif_pessoa)
- Busca via LOWER/LIKE no backend — nao mais JS frontend

## [31] Fluxo de Caixa — Layout Docs sem scroll horizontal — 23/06/2026
- Problema: 2 documentos em flex-direction:column aumentavam altura da celula e ativavam overflow-x
- Correcao: docs em flex-direction:row com flex-wrap — badges compactos D1/D2 lado a lado
- Removido overflow-x:auto do container da tabela
- Arquivo: views/pages/fluxo-caixa.ejs

## [31] Fluxo de Caixa — Layout colunas alinhadas — 23/06/2026
- Separadas em colunas distintas: Documentos (110px) e Acoes (64px)
- Removidos botoes duplicados de doc da coluna de acoes
- Coluna Documentos: D1/D2 empilhados verticalmente, badges verdes compactos
- Coluna Acoes: apenas Editar + Excluir, alinhados a direita
- CSS: col-docs, col-acoes, docs-grupo, docs-wrap, fc-acoes com justify-content:flex-end
- Removido overflow-x:auto do container da tabela

## [31] Fluxo de Caixa — Layout colunas alinhadas — 23/06/2026
- Separadas em 2 colunas distintas: Documentos (col-docs) e Acoes (col-acoes 68px)
- Removidos botoes duplicados de doc da coluna de acoes
- Coluna Acoes: apenas Editar + Excluir, justify-content:flex-end, sem flex-wrap
- Script de correcao: /tmp/fix_fluxo.py (leitura de ancoras por posicao, nao por substituicao de string com escapes)
- LICAO: para editar EJS com aspas mistas, usar Python com cat > /tmp/script.py << 'EOF' — nunca heredoc node inline no bash

## [32] Fluxo de Caixa — Upload PDF timeout e categoria nula — 23/06/2026
- Problema 1: 504 Gateway Time-out ao fazer upload de PDF
  - nginx: client_body_timeout 12s → 120s, send_timeout 10s → 120s
  - proxy_read_timeout 300s e proxy_send_timeout 300s adicionados ao location /
  - proxy_request_buffering off para upload direto sem buffer
- Problema 2: categoria=null ao editar lancamento com categoria 'Mensalidades'
  - Select do formulario tinha 'Mensalidade' (singular), banco tinha 'Mensalidades' (plural)
  - UPDATE fluxo_caixa SET categoria='Mensalidade' WHERE categoria='Mensalidades' (94 registros)
  - Raiz: padronizar sempre 'Mensalidade' singular — igual ao option do select

## [33] Fluxo de Caixa — Conciliação bancária Abril-Junho/2026 — 23/06/2026
- Problema: saldo do fluxo nao batia com extrato PagBank
- Causa: entradas automaticas webhook + lancamentos manuais gerando divergencias
- Solucao: ajustes de conciliacao lancados no ultimo dia de cada mes
  - 30/04: saida R$229.74 (ajuste abril)
  - 31/05: saida R$1.055.08 (ajuste maio)
  - 23/06: entrada R$7.26 (ajuste junho)
- Saldos finais: abril R$1.352,70 | maio R$1.573,60 | junho R$1.099,15
- A partir de julho os lancamentos entram em dia e o fluxo fica conciliado automaticamente

## [34] Cobranças — Vencimento dia errado (dia 30 em vez de dia 15) — 23/06/2026
- Problema: cobranças de junho geradas com data_vencimento=30/06 em vez de 15/06
- Causa raiz: hoje.date(diaVenc) no dayjs retorna dia incorreto quando o dia ja passou no mes
- Correcao: agendamentos.js linha 65 — substituido por template literal fixo: mes-diaVenc
- Corrigidas 19 cobranças de junho no banco para data_vencimento=2026-06-15
- Arquivo: src/services/agendamentos.js

## [35] Portal Membro — Valor desconto exibido incorretamente após dia 15 — 23/06/2026
- Problema: portal mostrava R$20 mesmo após dia 15 (dentro do periodo de desconto errado)
- Causa raiz: logica comparava vencimento com mes/ano atual em vez de simplesmente hoje.getDate() <= 15
- Correcao: dashboard.ejs — 2 pontos corrigidos
  - Bloco cobrancaAtual: dentroDesconto = hoje.getDate() <= diaDesconto
  - Historico cobranças: dentroDesc = hoje.getDate() <= 15
- Arquivo: views/pages/membro/dashboard.ejs

## [36] Dashboard — Contador atrasados divergia da tela de cobranças — 23/06/2026
- Problema: dashboard mostrava 14 atrasados, tela cobranças mostrava 13
- Causa raiz: dashboard contava TODOS os meses atrasados, cobranças filtrava so mes atual
- Correcao: dashboard query atrasados agora filtra por referencia LIKE mes atual E m.ativo=1
- Mesmo padrao aplicado no COUNT e no SUM de atrasados
- Arquivo: src/routes/index.js linha ~939

## [37] Materiais — 413 Request Entity Too Large ao fazer upload — 24/06/2026
- Problema: erro 413 ao tentar subir arquivo em /materiais/criar
- Causa raiz: sites-available/liga-urologia tinha client_max_body_size 10M sobrescrevendo o 500M do nginx.conf
- Correcao: client_max_body_size 10M → 500M em /etc/nginx/sites-available/liga-urologia
- nginx reload aplicado

## [38] Palestrantes — Campo CPF adicionado — 27/06/2026
- Adicionado coluna cpf VARCHAR(20) na tabela palestrantes
- Campo CPF adicionado no formulario de edicao interno (palestrantes.ejs)
- Campo CPF adicionado no formulario publico (form-palestrante.ejs) como obrigatorio
- CPF populado corretamente no modal de edicao via abrirEditar()
- Rotas POST /palestrantes/novo e /palestrantes/:id/editar atualizadas para incluir cpf
- Corrigido bug visual: spans aninhados dentro de option e bandeira textContent → emojis de pais
