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