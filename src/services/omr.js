// Motor OMR DETERMINISTICO (sem IA) para o cartao-resposta da Liga.
// Estrategia: nos controlamos a impressao -> sabemos a posicao canonica exata de cada
// bolha e dos 22 marcadores (via ?coords=1 da rota do cartao). Aqui: detecta os
// marcadores na foto, calcula a homografia (corrige rotacao/perspectiva) e MEDE o
// preenchimento de cada bolha. Nada de "adivinhar" resposta.
const sharp = require('sharp');
const W = 1000; // largura de trabalho (px)

// --- 1) normaliza + threshold adaptativo + connected components ---
async function analisarFoto(photo) {
  const { data: g, info } = await sharp(photo).rotate().resize({ width: W })
    .greyscale().raw().toBuffer({ resolveWithObject: true });
  const H = info.height;
  // integral image p/ media local O(1)
  const II = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let r = 0; for (let x = 0; x < W; x++) { r += g[y * W + x]; II[(y + 1) * (W + 1) + (x + 1)] = II[y * (W + 1) + (x + 1)] + r; } }
  const rad = Math.round(W / 22), C = 12;
  const bm = (x, y) => { const x0 = Math.max(0, x - rad), y0 = Math.max(0, y - rad), x1 = Math.min(W - 1, x + rad), y1 = Math.min(H - 1, y + rad); const a = (x1 - x0 + 1) * (y1 - y0 + 1); const s = II[(y1 + 1) * (W + 1) + (x1 + 1)] - II[y0 * (W + 1) + (x1 + 1)] - II[(y1 + 1) * (W + 1) + x0] + II[y0 * (W + 1) + x0]; return s / a; };
  const bin = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) bin[y * W + x] = (g[y * W + x] < bm(x, y) - C) ? 1 : 0;
  return { g, bin, H };
}

function componentes(bin, H) {
  const lbl = new Int32Array(W * H), comps = [], st = new Int32Array(W * H); let cur = 0;
  for (let i = 0; i < W * H; i++) {
    if (bin[i] !== 1 || lbl[i]) continue;
    cur++; let sp = 0; st[sp++] = i; let mnx = W, mny = H, mxx = 0, mxy = 0, ar = 0, sx = 0, sy = 0;
    while (sp > 0) { const p = st[--sp]; if (lbl[p]) continue; lbl[p] = cur; const px = p % W, py = (p / W) | 0; ar++; sx += px; sy += py; if (px < mnx) mnx = px; if (px > mxx) mxx = px; if (py < mny) mny = py; if (py > mxy) mxy = py;
      if (px > 0 && bin[p - 1] && !lbl[p - 1]) st[sp++] = p - 1; if (px < W - 1 && bin[p + 1] && !lbl[p + 1]) st[sp++] = p + 1; if (py > 0 && bin[p - W] && !lbl[p - W]) st[sp++] = p - W; if (py < H - 1 && bin[p + W] && !lbl[p + W]) st[sp++] = p + W; }
    const bw = mxx - mnx + 1, bh = mxy - mny + 1; comps.push({ bw, bh, area: ar, cx: sx / ar, cy: sy / ar, solidity: ar / (bw * bh) });
  }
  return comps;
}

const median = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

// --- 2) isola os 2 trilhos de marcadores (colineares, passo regular, span cheio) ---
function trilhos(comps, H) {
  const e = Math.round(W / 297 * 6); // ~tamanho do marcador em px
  // solidez 0.68: tolera inclinacao ate ~12 graus sem admitir bolhas cheias como marcador.
  // Alem disso falha ALTO ("marcadores nao encontrados") em vez de ler errado em silencio.
  const cand = comps.filter(c => c.bw >= e * 0.5 && c.bw <= e * 2.1 && c.bh >= e * 0.5 && c.bh <= e * 2.1 && Math.abs(c.bw - c.bh) <= e * 0.9 && c.solidity > 0.68);
  const N = cand.length, tol = W * 0.02, lines = [];
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const a = cand[i], b = cand[j]; const dx = b.cx - a.cx, dy = b.cy - a.cy; const L = Math.hypot(dx, dy); if (L < H * 0.55) continue;
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const inl = []; for (const c of cand) if (Math.abs((c.cx - a.cx) * nx + (c.cy - a.cy) * ny) < tol) inl.push(c);
    if (inl.length < 9) continue;
    const proj = inl.map(c => ({ c, p: (c.cx - a.cx) * ux + (c.cy - a.cy) * uy })).sort((p, q) => p.p - q.p);
    const gaps = []; for (let k = 1; k < proj.length; k++) gaps.push(proj[k].p - proj[k - 1].p);
    const m = median(gaps); if (m <= 0) continue;
    const regular = gaps.filter(gp => gp > 0.55 * m && gp < 1.7 * m).length;
    const span = proj[proj.length - 1].p - proj[0].p;
    if (span < H * 0.6 || regular < 6) continue;
    lines.push({ inl: proj.map(o => o.c), span, count: inl.length, regular, cx: inl.reduce((s, c) => s + c.cx, 0) / inl.length });
  }
  lines.sort((p, q) => q.regular - p.regular || q.count - p.count || q.span - p.span);
  if (!lines.length) throw new Error('marcadores nao encontrados (foto ruim: enquadre a folha inteira, sem brilho, reta)');
  // Os 2 trilhos ficam nas BORDAS (esq/dir). Escolhe o melhor de cada banda -> nao
  // confunde com as colunas de respostas (que sao regulares mas ficam no meio).
  const r1 = lines.find(l => l.cx < W * 0.30) || lines[0];
  const r2 = lines.find(l => l.cx > W * 0.70) || lines.find(l => Math.abs(l.cx - r1.cx) > W * 0.4);
  if (!r2) throw new Error('so um trilho de marcadores encontrado (aproxime e enquadre a folha inteira)');
  const order = r => r.inl.slice().sort((a, b) => a.cy - b.cy);
  let Lr = order(r1), Rr = order(r2); if (Lr[0].cx > Rr[0].cx)[Lr, Rr] = [Rr, Lr];
  return { L: Lr, R: Rr };
}

// --- 3) homografia 4 pontos canonico(src)->foto(dst) ---
function homografia(src, dst) {
  const A = [], b = [];
  for (let k = 0; k < 4; k++) { const [X, Y] = src[k], [x, y] = dst[k]; A.push([X, Y, 1, 0, 0, 0, -X * x, -Y * x]); b.push(x); A.push([0, 0, 0, X, Y, 1, -X * y, -Y * y]); b.push(y); }
  const n = 8; for (let i = 0; i < n; i++) A[i].push(b[i]);
  for (let col = 0; col < n; col++) { let piv = col; for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;[A[col], A[piv]] = [A[piv], A[col]]; const d = A[col][col]; for (let c = col; c <= n; c++) A[col][c] /= d; for (let r = 0; r < n; r++) { if (r === col) continue; const f = A[r][col]; for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c]; } }
  const h = A.map(r => r[n]); h.push(1);
  return (X, Y) => { const w = h[6] * X + h[7] * Y + h[8]; return [(h[0] * X + h[1] * Y + h[2]) / w, (h[3] * X + h[4] * Y + h[5]) / w]; };
}

// homografia por MINIMOS QUADRADOS (N>=4 correspondencias) canonico->foto.
// Minimiza erro global -> bolhas caem no centro mesmo sob rotacao/perspectiva.
function homografiaLS(src, dst) {
  const ATA = Array.from({ length: 8 }, () => new Float64Array(8)), ATb = new Float64Array(8);
  const acc = (row, r) => { for (let i = 0; i < 8; i++) { for (let j = 0; j < 8; j++) ATA[i][j] += row[i] * row[j]; ATb[i] += row[i] * r; } };
  for (let k = 0; k < src.length; k++) {
    const [X, Y] = src[k], [x, y] = dst[k];
    acc([X, Y, 1, 0, 0, 0, -X * x, -Y * x], x);
    acc([0, 0, 0, X, Y, 1, -X * y, -Y * y], y);
  }
  const A = ATA.map((r, i) => [...r, ATb[i]]), n = 8;
  for (let col = 0; col < n; col++) { let piv = col; for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;[A[col], A[piv]] = [A[piv], A[col]]; const d = A[col][col]; for (let c = col; c <= n; c++) A[col][c] /= d; for (let r = 0; r < n; r++) { if (r === col) continue; const f = A[r][col]; for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c]; } }
  const h = A.map(r => r[n]); h.push(1);
  return (X, Y) => { const w = h[6] * X + h[7] * Y + h[8]; return [(h[0] * X + h[1] * Y + h[2]) / w, (h[3] * X + h[4] * Y + h[5]) / w]; };
}

// --- 4) mede preenchimento: fracao de tinta no disco interno da bolha ---
function preenchimento(g, cx, cy, rr) {
  const r = Math.max(3, rr * 0.62); // disco interno (evita o anel impresso)
  let dark = 0, tot = 0, sum = 0;
  const x0 = Math.max(0, (cx - r) | 0), x1 = Math.min(W - 1, (cx + r) | 0), y0 = Math.max(0, (cy - r) | 0), y1 = Math.min(g.length / W - 1, (cy + r) | 0);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
    tot++; sum += g[y * W + x];
  }
  const mean = sum / tot;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
    if (g[y * W + x] < mean - 25 || g[y * W + x] < 90) dark++; // pixel de tinta
  }
  return { frac: dark / tot, mean };
}

// Le o cartao. coords = objeto do ?coords=1 (bolhas + marcadores canonicos).
// Retorna { fila, registro, respostas:{n:'A'..}, incertas:[n], scores }.
async function readCard(photo, coords) {
  const { g, bin, H } = await analisarFoto(photo);
  const { L, R } = trilhos(componentes(bin, H), H);
  const M = coords.marcadores;
  const minX = Math.min(...M.map(m => m.x)), maxX = Math.max(...M.map(m => m.x)), minY = Math.min(...M.map(m => m.y)), maxY = Math.max(...M.map(m => m.y));
  const src = [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]];
  const dst = [[L[0].cx, L[0].cy], [R[0].cx, R[0].cy], [L[L.length - 1].cx, L[L.length - 1].cy], [R[R.length - 1].cx, R[R.length - 1].cy]];
  let map = homografia(src, dst); // inicial (4 cantos)
  // REFINA: projeta os 22 marcadores canonicos, casa com os detectados, resolve LS
  const det = [...L, ...R];
  const cs = [], cd = [];
  for (const m of M) { const [px, py] = map(m.x, m.y); let best = null, bd = 1e9; for (const d of det) { const dist = (d.cx - px) ** 2 + (d.cy - py) ** 2; if (dist < bd) { bd = dist; best = d; } } if (best && bd < (W * 0.03) ** 2) { cs.push([m.x, m.y]); cd.push([best.cx, best.cy]); } }
  if (cs.length >= 6) map = homografiaLS(cs, cd);
  const scaleR = (dst[3][0] - dst[0][0]) / (maxX - minX); // canonico->foto (raio)
  const fill = (key) => { const c = coords.bolhas[key]; if (!c) return null; const [x, y] = map(c.x, c.y); return preenchimento(g, x, y, c.r * scaleR); };

  const THRESH = 0.40; // fracao de tinta p/ considerar marcada (calibrar com foto real)
  // questoes
  const nums = Object.keys(coords.bolhas).filter(k => /^q\d+-A$/.test(k)).map(k => +k.match(/\d+/)[0]).sort((a, b) => a - b);
  const respostas = {}, incertas = [], scores = {};
  for (const n of nums) {
    const fs = ['A', 'B', 'C', 'D'].map(l => ({ l, f: (fill('q' + n + '-' + l) || { frac: 0 }).frac }));
    scores[n] = fs;
    const ord = fs.slice().sort((a, b) => b.f - a.f);
    if (ord[0].f < THRESH) { respostas[n] = null; incertas.push(n); } // em branco
    else { respostas[n] = ord[0].l; if (ord[1].f >= THRESH && ord[1].f >= 0.6 * ord[0].f) incertas.push(n); } // dupla marcacao real
  }
  // fila (conjunto A/B/C)
  const filaFs = ['A', 'B', 'C'].map(l => ({ l, f: (fill('conj-' + l) || { frac: 0 }).frac })).sort((a, b) => b.f - a.f);
  const fila = filaFs[0].f >= THRESH ? filaFs[0].l : null;
  // numero de registro: 3 colunas, digito mais preenchido por coluna
  let registro = '';
  for (let col = 0; col < 3; col++) {
    const ds = [];
    for (let d = 0; d <= 9; d++) { const f = fill('reg' + col + '-' + d); if (f) ds.push({ d, f: f.frac }); }
    ds.sort((a, b) => b.f - a.f);
    registro += (ds[0] && ds[0].f >= THRESH) ? ds[0].d : '?';
  }
  return { fila, registro, respostas, incertas, scores };
}

module.exports = { readCard, analisarFoto, componentes, trilhos, homografia, preenchimento, W };
