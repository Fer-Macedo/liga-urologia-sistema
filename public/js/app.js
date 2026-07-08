// ─── Modal de confirmação padrão (substitui o confirm() nativo do navegador) ──
(function() {
  var _callback = null;

  function garantirModalConfirmacao() {
    if (document.getElementById('modal-confirmacao-global')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="modal-overlay" id="modal-confirmacao-global" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:3000;align-items:center;justify-content:center">' +
        '<div class="modal" style="max-width:420px;width:90%;background:#fff;border:1px solid #e2e8f0;padding:0;border-radius:0;box-shadow:none">' +
          '<div style="padding:24px 24px 0">' +
            '<div id="mcg-icone" style="width:44px;height:44px;background:#fef2f2;border:1px solid #fecaca;display:flex;align-items:center;justify-content:center;margin-bottom:16px">' +
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>' +
            '</div>' +
            '<h3 id="mcg-titulo" style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 8px">Confirmar ação</h3>' +
            '<p id="mcg-mensagem" style="font-size:13px;color:#64748b;line-height:1.6;margin:0"></p>' +
          '</div>' +
          '<div style="display:flex;gap:10px;padding:20px 24px;margin-top:16px;border-top:1px solid #e2e8f0">' +
            '<button type="button" id="mcg-cancelar" style="flex:1;padding:9px;font-size:13px;font-weight:600;border:1px solid #e2e8f0;background:#fff;color:#0f172a;cursor:pointer;border-radius:0">Cancelar</button>' +
            '<button type="button" id="mcg-confirmar" style="flex:1;padding:9px;font-size:13px;font-weight:600;border:none;background:#b91c1c;color:#fff;cursor:pointer;border-radius:0">Confirmar</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
    document.getElementById('mcg-cancelar').addEventListener('click', fecharModalConfirmacao);
    document.getElementById('mcg-confirmar').addEventListener('click', function() {
      var cb = _callback;
      fecharModalConfirmacao();
      if (cb) cb();
    });
  }

  // confirmarAcao(mensagem, callback, opts) — mostra o modal e executa callback() se confirmado.
  // opts: { titulo, textoConfirmar, corConfirmar }
  window.confirmarAcao = function(mensagem, callback, opts) {
    garantirModalConfirmacao();
    opts = opts || {};
    document.getElementById('mcg-titulo').textContent = opts.titulo || 'Confirmar ação';
    document.getElementById('mcg-mensagem').textContent = mensagem;
    document.getElementById('mcg-confirmar').textContent = opts.textoConfirmar || 'Confirmar';
    document.getElementById('mcg-confirmar').style.background = opts.corConfirmar || '#b91c1c';
    _callback = callback;
    document.getElementById('modal-confirmacao-global').style.display = 'flex';
    return false;
  };

  window.fecharModalConfirmacao = function() {
    var m = document.getElementById('modal-confirmacao-global');
    if (m) m.style.display = 'none';
  };

  // ─── Aviso padrão (substitui o alert() nativo do navegador) ──
  function garantirModalAviso() {
    if (document.getElementById('modal-aviso-global')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="modal-overlay" id="modal-aviso-global" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:3000;align-items:center;justify-content:center">' +
        '<div class="modal" style="max-width:420px;width:90%;background:#fff;border:1px solid #e2e8f0;padding:0;border-radius:0;box-shadow:none">' +
          '<div style="padding:24px 24px 0">' +
            '<div id="mag-icone" style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;margin-bottom:16px"></div>' +
            '<h3 id="mag-titulo" style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 8px"></h3>' +
            '<p id="mag-mensagem" style="font-size:13px;color:#64748b;line-height:1.6;margin:0"></p>' +
          '</div>' +
          '<div style="display:flex;padding:20px 24px;margin-top:16px;border-top:1px solid #e2e8f0">' +
            '<button type="button" id="mag-ok" style="flex:1;padding:9px;font-size:13px;font-weight:600;border:none;color:#fff;cursor:pointer;border-radius:0">OK</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
    document.getElementById('mag-ok').addEventListener('click', window.fecharModalAviso);
    document.getElementById('modal-aviso-global').addEventListener('click', function(e){ if(e.target===this) window.fecharModalAviso(); });
  }

  var ICONE_ERRO = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>';
  var ICONE_SUCESSO = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  // mostrarAviso(mensagem, tipo, opts) — tipo: 'erro' (padrão) ou 'sucesso'. opts: { titulo }
  window.mostrarAviso = function(mensagem, tipo, opts) {
    garantirModalAviso();
    opts = opts || {};
    var sucesso = tipo === 'sucesso';
    document.getElementById('mag-titulo').textContent = opts.titulo || (sucesso ? 'Sucesso' : 'Erro');
    document.getElementById('mag-mensagem').textContent = mensagem;
    var icone = document.getElementById('mag-icone');
    icone.style.background = sucesso ? '#f0fdf4' : '#fef2f2';
    icone.style.border = '1px solid ' + (sucesso ? '#bbf7d0' : '#fecaca');
    icone.innerHTML = sucesso ? ICONE_SUCESSO : ICONE_ERRO;
    document.getElementById('mag-ok').style.background = sucesso ? '#15803d' : '#b91c1c';
    document.getElementById('modal-aviso-global').style.display = 'flex';
  };

  window.fecharModalAviso = function() {
    var m = document.getElementById('modal-aviso-global');
    if (m) m.style.display = 'none';
  };

  // ─── Modal de entrada de texto (substitui prompt()). Retorna Promise<string|null> ──
  var _ptResolve = null;
  function garantirModalTexto() {
    if (document.getElementById('modal-texto-global')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="modal-overlay" id="modal-texto-global" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:3000;align-items:center;justify-content:center">' +
        '<div class="modal" style="max-width:440px;width:90%;background:#fff;border:1px solid #e2e8f0;padding:0;border-radius:0;box-shadow:none">' +
          '<div style="padding:24px 24px 0">' +
            '<h3 id="mtg-titulo" style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 8px">Informação</h3>' +
            '<p id="mtg-mensagem" style="font-size:13px;color:#64748b;line-height:1.6;margin:0 0 14px;white-space:pre-line"></p>' +
            '<textarea id="mtg-input" rows="2" style="width:100%;padding:9px;font-size:13px;border:1px solid #e2e8f0;border-radius:0;font-family:inherit;resize:vertical;box-sizing:border-box"></textarea>' +
          '</div>' +
          '<div style="display:flex;gap:10px;padding:20px 24px;margin-top:16px;border-top:1px solid #e2e8f0">' +
            '<button type="button" id="mtg-cancelar" style="flex:1;padding:9px;font-size:13px;font-weight:600;border:1px solid #e2e8f0;background:#fff;color:#0f172a;cursor:pointer;border-radius:0">Cancelar</button>' +
            '<button type="button" id="mtg-confirmar" style="flex:1;padding:9px;font-size:13px;font-weight:600;border:none;background:#0f766e;color:#fff;cursor:pointer;border-radius:0">Confirmar</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
    function fechar(val) {
      document.getElementById('modal-texto-global').style.display = 'none';
      var r = _ptResolve; _ptResolve = null; if (r) r(val);
    }
    document.getElementById('mtg-cancelar').addEventListener('click', function(){ fechar(null); });
    document.getElementById('mtg-confirmar').addEventListener('click', function(){ fechar(document.getElementById('mtg-input').value); });
    document.getElementById('modal-texto-global').addEventListener('click', function(e){ if (e.target === this) fechar(null); });
  }
  window.pedirTexto = function(mensagem, opts) {
    return new Promise(function(resolve) {
      garantirModalTexto();
      opts = opts || {};
      document.getElementById('mtg-titulo').textContent = opts.titulo || 'Informação';
      document.getElementById('mtg-mensagem').textContent = mensagem || '';
      var inp = document.getElementById('mtg-input');
      inp.value = opts.valor || '';
      _ptResolve = resolve;
      document.getElementById('modal-texto-global').style.display = 'flex';
      setTimeout(function(){ inp.focus(); }, 50);
    });
  };

  // ─── Modal para exibir um texto copiavel (substitui prompt('Copie:', link)) ──
  var _copText = '';
  function garantirModalCopiar() {
    if (document.getElementById('modal-copiar-global')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="modal-overlay" id="modal-copiar-global" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:3000;align-items:center;justify-content:center">' +
        '<div class="modal" style="max-width:460px;width:90%;background:#fff;border:1px solid #e2e8f0;padding:0;border-radius:0;box-shadow:none">' +
          '<div style="padding:24px 24px 0">' +
            '<h3 id="mcp-titulo" style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 8px">Copiar</h3>' +
            '<p id="mcp-mensagem" style="font-size:13px;color:#64748b;line-height:1.6;margin:0 0 14px"></p>' +
            '<input id="mcp-input" readonly style="width:100%;padding:9px;font-size:13px;border:1px solid #e2e8f0;border-radius:0;background:#f8fafc;box-sizing:border-box">' +
          '</div>' +
          '<div style="display:flex;gap:10px;padding:20px 24px;margin-top:16px;border-top:1px solid #e2e8f0">' +
            '<button type="button" id="mcp-fechar" style="flex:1;padding:9px;font-size:13px;font-weight:600;border:1px solid #e2e8f0;background:#fff;color:#0f172a;cursor:pointer;border-radius:0">Fechar</button>' +
            '<button type="button" id="mcp-copiar" style="flex:1;padding:9px;font-size:13px;font-weight:600;border:none;background:#0f766e;color:#fff;cursor:pointer;border-radius:0">Copiar</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
    document.getElementById('mcp-fechar').addEventListener('click', function(){ document.getElementById('modal-copiar-global').style.display = 'none'; });
    document.getElementById('modal-copiar-global').addEventListener('click', function(e){ if (e.target === this) this.style.display = 'none'; });
    document.getElementById('mcp-copiar').addEventListener('click', function(){
      var inp = document.getElementById('mcp-input'); inp.select(); inp.setSelectionRange(0, 99999);
      var btn = document.getElementById('mcp-copiar');
      function ok(){ btn.textContent = 'Copiado!'; setTimeout(function(){ btn.textContent = 'Copiar'; }, 1500); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(_copText).then(ok).catch(function(){ try { document.execCommand('copy'); ok(); } catch(e){} });
      } else { try { document.execCommand('copy'); ok(); } catch(e){} }
    });
  }
  window.mostrarTextoCopiavel = function(mensagem, texto, opts) {
    garantirModalCopiar();
    opts = opts || {};
    _copText = texto || '';
    document.getElementById('mcp-titulo').textContent = opts.titulo || 'Copiar';
    document.getElementById('mcp-mensagem').textContent = mensagem || '';
    document.getElementById('mcp-input').value = texto || '';
    document.getElementById('modal-copiar-global').style.display = 'flex';
    setTimeout(function(){ document.getElementById('mcp-input').select(); }, 50);
  };

  // Substitui o alert() nativo do navegador pelo modal de aviso padrao do sistema,
  // em qualquer chamada existente ou futura, sem precisar editar cada tela.
  var _alertNativo = window.alert;
  window.alert = function(mensagem) {
    try { window.mostrarAviso(mensagem == null ? '' : String(mensagem), undefined, { titulo: 'Aviso' }); }
    catch (e) { _alertNativo(mensagem); }
  };
})();

// ─── Modais ──────────────────────────────────────────────────────────────────
function abrirModal(id) {
  const el = document.getElementById(id);
  if (el) { el.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
}

function fecharModal(id) {
  const el = document.getElementById(id);
  if (el) { el.style.display = 'none'; document.body.style.overflow = ''; }
}

// Fechar modal clicando fora
document.addEventListener('click', function(e) {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.style.display = 'none';
    document.body.style.overflow = '';
  }
});

// Fechar modal com ESC
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay').forEach(el => {
      el.style.display = 'none';
    });
    document.body.style.overflow = '';
  }
});

// ─── Auto-fechar alertas após 5s ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  const alertas = document.querySelectorAll('.alerta');
  alertas.forEach(a => {
    setTimeout(() => {
      a.style.transition = 'opacity 0.5s';
      a.style.opacity = '0';
      setTimeout(() => a.remove(), 500);
    }, 5000);
  });

  // Máscara de telefone
  document.querySelectorAll('input[name="whatsapp"]').forEach(input => {
    input.addEventListener('input', function() {
      let v = this.value.replace(/\D/g, '').substring(0, 11);
      if (v.length >= 7) {
        v = `(${v.substring(0,2)}) ${v.substring(2,7)}-${v.substring(7)}`;
      } else if (v.length >= 3) {
        v = `(${v.substring(0,2)}) ${v.substring(2)}`;
      }
      this.value = v;
    });
  });

  // Máscara de CPF
  document.querySelectorAll('input[name="cpf"]').forEach(input => {
    input.addEventListener('input', function() {
      let v = this.value.replace(/\D/g, '').substring(0, 11);
      if (v.length >= 10) {
        v = `${v.substring(0,3)}.${v.substring(3,6)}.${v.substring(6,9)}-${v.substring(9)}`;
      } else if (v.length >= 7) {
        v = `${v.substring(0,3)}.${v.substring(3,6)}.${v.substring(6)}`;
      } else if (v.length >= 4) {
        v = `${v.substring(0,3)}.${v.substring(3)}`;
      }
      this.value = v;
    });
  });

  // Confirmar antes de deslogar (modal padrao do sistema)
  const btnSair = document.querySelector('.btn-sair');
  if (btnSair) {
    btnSair.addEventListener('click', function(e) {
      e.preventDefault();
      var destino = btnSair.getAttribute('href') || '/logout';
      confirmarAcao('Deseja sair do sistema?', function(){ window.location.href = destino; }, { titulo: 'Sair', textoConfirmar: 'Sair' });
    });
  }
});


// ── Mobile sidebar hamburguer ────────────────────────────────
(function(){
  function initMobileSidebar(){
    var sidebar=document.querySelector('aside.sidebar,.sidebar');
    if(!sidebar)return;
    var ham=document.createElement('button');
    ham.className='btn-hamburger';
    ham.innerHTML='&#9776;';
    ham.setAttribute('aria-label','Menu');
    document.body.appendChild(ham);
    var overlay=document.createElement('div');
    overlay.className='sidebar-overlay';
    document.body.appendChild(overlay);
    function openNav(){ sidebar.classList.add('mobile-aberta'); overlay.classList.add('ativo'); ham.innerHTML='&#10005;'; }
    function closeNav(){ sidebar.classList.remove('mobile-aberta'); overlay.classList.remove('ativo'); ham.innerHTML='&#9776;'; }
    ham.addEventListener('click',function(){ sidebar.classList.contains('mobile-aberta')?closeNav():openNav(); });
    overlay.addEventListener('click',closeNav);
    sidebar.querySelectorAll('a').forEach(function(a){
      a.addEventListener('click',function(){ if(window.innerWidth<=768)closeNav(); });
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',initMobileSidebar);
  else initMobileSidebar();
})();