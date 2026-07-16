// Protecao CSRF (Cross-Site Request Forgery) para todo o sistema.
// Estrategia: token vinculado a sessao (padrao synchronizer token, via o pacote "csrf").
// Como o app tem centenas de views/formularios, em vez de editar cada .ejs manualmente:
//   1. Gera o token e injeta um <script> automatico antes de </body> em toda resposta HTML,
//      que adiciona o campo _csrf em todo form POST/PUT/PATCH/DELETE e o header
//      X-CSRF-Token em toda chamada fetch()/XMLHttpRequest do lado do cliente.
//   2. Verifica o token em toda requisicao que muda estado (POST/PUT/PATCH/DELETE),
//      exceto rotas explicitamente isentas (webhooks de terceiros, API publica com CORS).
const Tokens = require('csrf');
const tokens = new Tokens();

// Rotas que NAO podem ter CSRF: webhooks de servicos externos (nao tem sessao de navegador)
// e a API publica com CORS liberado (protegida por rate limit, nao por sessao/cookie).
const ROTAS_ISENTAS = [
  '/webhook/pagbank',
  '/webhook/whatsapp',
  '/webhook/whatsapp-oficial',
  '/api/contato-site',
];

// /live/:token/ping e /live/:token/sair sao chamados via navigator.sendBeacon (fecho de aba),
// que nao permite enviar headers customizados - ficam isentos, ja protegidos pelo proprio
// token aleatorio e imprevisivel na URL (equivalente a uma chave de uso unico).
const PADROES_ISENTOS = [
  /^\/live\/[^/]+\/(ping|sair)$/,
];

function rotaIsenta(path) {
  if (ROTAS_ISENTAS.some(r => path === r || path.startsWith(r + '/'))) return true;
  return PADROES_ISENTOS.some(re => re.test(path));
}

const SCRIPT_TEMPLATE = (token) => `
<script>
(function(){
  var CSRF_TOKEN=${JSON.stringify(token)};
  function injetarForms(root){
    (root||document).querySelectorAll('form').forEach(function(f){
      var m=(f.getAttribute('method')||'GET').toUpperCase();
      if(m==='GET') return;
      if(!f.querySelector('input[name="_csrf"]')){
        var inp=document.createElement('input');
        inp.type='hidden'; inp.name='_csrf'; inp.value=CSRF_TOKEN;
        f.appendChild(inp);
      }
      // Forms multipart (upload de arquivo) so tem o corpo interpretado pelo multer DEPOIS
      // do middleware global de CSRF - por isso, alem do campo oculto, manda o token tambem
      // na propria URL do form (query string), que ja esta disponivel antes do multer rodar.
      var enctype=(f.getAttribute('enctype')||'').toLowerCase();
      if(enctype.indexOf('multipart')!==-1){
        try{
          var url=new URL(f.action||location.href, location.href);
          url.searchParams.set('_csrf', CSRF_TOKEN);
          f.setAttribute('action', url.pathname+url.search+url.hash);
        }catch(e){}
      }
    });
  }
  injetarForms();
  if(window.MutationObserver){
    new MutationObserver(function(muts){
      muts.forEach(function(mu){
        mu.addedNodes && mu.addedNodes.forEach(function(n){
          if(n.nodeType===1){ if(n.tagName==='FORM') injetarForms(n.parentNode); else if(n.querySelectorAll) injetarForms(n); }
        });
      });
    }).observe(document.body,{childList:true,subtree:true});
  }
  // Reforco no momento do envio: paginas que trocam form.action via JS depois do carregamento
  // (ex: reaproveitar um modal de "novo" para "editar") podem apagar o token que foi colocado
  // na URL/campo na hora do carregamento. Esta funcao garante o token de novo, bem antes de
  // enviar de verdade, nao importa o que a pagina tenha feito com o form nesse meio tempo.
  function garantirToken(f){
    if(!f || f.tagName!=='FORM') return;
    var m=(f.getAttribute('method')||'GET').toUpperCase();
    if(m==='GET') return;
    var campo=f.querySelector('input[name="_csrf"]');
    if(campo) campo.value=CSRF_TOKEN;
    else{
      campo=document.createElement('input');
      campo.type='hidden'; campo.name='_csrf'; campo.value=CSRF_TOKEN;
      f.appendChild(campo);
    }
    var enctype=(f.getAttribute('enctype')||'').toLowerCase();
    if(enctype.indexOf('multipart')!==-1){
      try{
        var url=new URL(f.action||location.href, location.href);
        url.searchParams.set('_csrf', CSRF_TOKEN);
        f.setAttribute('action', url.pathname+url.search+url.hash);
      }catch(e2){}
    }
  }
  // Cobre envio via clique/Enter (evento "submit" real, fase de captura - roda antes de
  // qualquer coisa que a pagina faca).
  document.addEventListener('submit', function(e){ garantirToken(e.target); }, true);
  // Cobre envio programatico via form.submit() - esse metodo NAO dispara o evento "submit"
  // (comportamento padrao do navegador), entao precisa de uma segunda garantia aqui. Padrao
  // usado em varias telas do sistema: criar/pegar um form, ajustar o action, e chamar
  // f.submit() direto (ex: dentro de confirmarAcao(...) apos o usuario confirmar).
  var origSubmit=HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit=function(){ garantirToken(this); return origSubmit.apply(this,arguments); };
  var origFetch=window.fetch;
  if(origFetch){
    window.fetch=function(input,init){
      init=init||{};
      var method=(init.method||(input&&input.method)||'GET').toUpperCase();
      if(method!=='GET' && method!=='HEAD'){
        if(init.headers instanceof Headers){ init.headers.set('X-CSRF-Token',CSRF_TOKEN); }
        else { init.headers=Object.assign({},init.headers,{'X-CSRF-Token':CSRF_TOKEN}); }
      }
      return origFetch.call(this,input,init);
    };
  }
  var origOpen=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method){
    this._csrfMethod=(method||'GET').toUpperCase();
    return origOpen.apply(this,arguments);
  };
  var origSend=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send=function(){
    if(this._csrfMethod && this._csrfMethod!=='GET' && this._csrfMethod!=='HEAD'){
      try{ this.setRequestHeader('X-CSRF-Token',CSRF_TOKEN); }catch(e){}
    }
    return origSend.apply(this,arguments);
  };
})();
</script>`;

// Gera/reaproveita o token da sessao e injeta o script de auto-protecao em respostas HTML.
function csrfInjetar(req, res, next) {
  if (!req.session.csrfSecret) req.session.csrfSecret = tokens.secretSync();
  const token = tokens.create(req.session.csrfSecret);
  res.locals.csrfToken = token;

  const originalSend = res.send.bind(res);
  res.send = function(body) {
    if (typeof body === 'string' && body.includes('</body>')) {
      // Injeta antes do ULTIMO </body> (o fechamento real da pagina). Usar replace()
      // no primeiro </body> quebrava paginas que tem "</body>" dentro de uma string JS
      // (ex: cobrancas monta um relatorio com "...</body></html>" num template literal):
      // o <script> do CSRF caia dentro do <script> da pagina e vazava o resto como texto.
      const idx = body.lastIndexOf('</body>');
      body = body.slice(0, idx) + SCRIPT_TEMPLATE(token) + body.slice(idx);
      // A pagina carrega um token CSRF preso a esta sessao. Se o navegador
      // reaproveitar uma copia em cache (token antigo) apos um restart/deploy,
      // o envio falha com "Sessao expirada". no-store impede esse reuso.
      res.setHeader('Cache-Control', 'no-store');
    }
    return originalSend(body);
  };
  next();
}

// Verifica o token em requisicoes que mudam estado.
function csrfVerificar(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (rotaIsenta(req.path)) return next();

  const enviado = (req.body && req.body._csrf) || req.query._csrf || req.headers['x-csrf-token'] || req.headers['csrf-token'];
  const secret = req.session && req.session.csrfSecret;
  if (!secret || !enviado || !tokens.verify(secret, enviado)) {
    const querJson = req.xhr || (req.headers.accept || '').includes('application/json') || (req.headers['content-type'] || '').includes('application/json');
    if (querJson) return res.status(403).json({ ok: false, erro: 'Sessao expirada ou formulario desatualizado. Recarregue a pagina e tente novamente.' });
    return res.status(403).send('Sessao expirada ou formulario desatualizado. Volte, recarregue a pagina e tente novamente.');
  }
  next();
}

module.exports = { csrfInjetar, csrfVerificar };
