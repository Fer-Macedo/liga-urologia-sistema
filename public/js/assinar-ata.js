(function() {
  // Invalidar token ao abrir a página — segurança uso único
  fetch('/assinar-ata-aberto/' + window.TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/json' } });

  var canvas = document.getElementById('canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#1a3d2b';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  var drawing = false, lx = 0, ly = 0, hasDrawn = false;

  function getPos(e) {
    var r = canvas.getBoundingClientRect();
    var scX = canvas.width / r.width;
    var scY = canvas.height / r.height;
    if (e.touches) {
      return { x: (e.touches[0].clientX - r.left) * scX, y: (e.touches[0].clientY - r.top) * scY };
    }
    return { x: (e.clientX - r.left) * scX, y: (e.clientY - r.top) * scY };
  }

  canvas.addEventListener('mousedown', function(e) { drawing = true; var p = getPos(e); lx = p.x; ly = p.y; });
  canvas.addEventListener('mousemove', function(e) {
    if (!drawing) return;
    var p = getPos(e);
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(p.x, p.y); ctx.stroke();
    lx = p.x; ly = p.y; hasDrawn = true;
  });
  canvas.addEventListener('mouseup', function() { drawing = false; });
  canvas.addEventListener('mouseleave', function() { drawing = false; });
  canvas.addEventListener('touchstart', function(e) { e.preventDefault(); drawing = true; var p = getPos(e); lx = p.x; ly = p.y; }, { passive: false });
  canvas.addEventListener('touchmove', function(e) {
    e.preventDefault();
    if (!drawing) return;
    var p = getPos(e);
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(p.x, p.y); ctx.stroke();
    lx = p.x; ly = p.y; hasDrawn = true;
  }, { passive: false });
  canvas.addEventListener('touchend', function() { drawing = false; });

  document.getElementById('btn-limpar').addEventListener('click', function() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn = false;
  });

  document.getElementById('btn-salvar').addEventListener('click', function() {
    if (!hasDrawn) { alert('Por favor, realize sua assinatura antes de confirmar.'); return; }
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Salvando...';
    fetch('/assinar-ata/' + window.TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assinatura_digital: canvas.toDataURL('image/png') })
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.ok) {
        var logo = window.ORG_LOGO ? '<img src="'+window.ORG_LOGO+'" style="width:64px;height:64px;border-radius:50%;border:3px solid rgba(255,255,255,.3);display:block;margin:0 auto 12px">' : '';
        document.querySelector('.card').innerHTML =
          '<div style="background:linear-gradient(160deg,#1a3d2b 0%,#0a1f1a 100%);padding:28px 32px;text-align:center;color:white">'+logo+'<p style="font-size:12px;opacity:.7;margin:0">Liga Academica de Urologia — LAURO</p></div>' +
          '<div style="padding:60px 32px;text-align:center">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#1a3d2b" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>' +
          '<h2 style="color:#1a3d2b;margin:16px 0 8px;font-family:Arial">Assinatura confirmada!</h2>' +
          '<p style="color:#475569;font-family:Arial;font-size:14px">Obrigado, '+window.MEMBRO_NOME+'! Sua assinatura foi registrada com sucesso.</p>' +
          '</div>' +
          '<div style="padding:16px 32px;background:#f8fafc;text-align:center;font-size:11px;color:#94a3b8">Liga Academica de Urologia — LAURO | UCP | Ciudad del Este</div>';
      } else {
        alert(d.erro || 'Erro ao salvar.');
        btn.disabled = false;
        btn.textContent = 'Confirmar Assinatura';
      }
    })
    .catch(function() {
      alert('Erro de conexao. Tente novamente.');
      btn.disabled = false;
      btn.textContent = 'Confirmar Assinatura';
    });
  });
})();
