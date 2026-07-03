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

  // Confirmar antes de deslogar
  const btnSair = document.querySelector('.btn-sair');
  if (btnSair) {
    btnSair.addEventListener('click', function(e) {
      if (!confirm('Deseja sair do sistema?')) e.preventDefault();
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