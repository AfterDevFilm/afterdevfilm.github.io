// Local-file-compatible production bundle: three waves, image pieces and film chips.
(() => {
// User-triggered decoration only; not a payment callback or payment verification.
const completionCopy = 'Ko-fi로 이동합니다.';
const motifs = ['cassette','strip','contact','slide','camera','tank','reel','print'];
const patterns = ['radial','twin','fountain','rain'];
// Web-trial tokens: accent #526b56, accent-pressed #435a47, warn #9a5b12, mist #e8ece7, plus the app icon's deep green.
const palettes = [['#526b56','#9a5b12','#e8ece7','#182d19'],['#435a47','#d7a935','#869188','#f6ebdd'],['#526b56','#a6402c','#ebf0ea','#29342d']];
const imageFiles = ['01_film_roll_short_leader','02_film_roll_long_leader','03_camera_front','04_camera_three_quarter','05_film_strip_s_curve','06_film_strip_tight_curl','07_slide_mount','08_film_canister'];
const DURATION = 2.8;
const NAVIGATE_AFTER_MS = 2200;

// Small copies (256 px) are preloaded once the page is idle, so the click does not wait for them.
const images = [];
function preloadImages() {
  if (images.length) return;
  for (const name of imageFiles) {
    const img = new Image();
    img.decoding = 'async';
    img.src = `assets/fireworks/sm/${name}.png`;
    images.push(img);
  }
}
if (document.readyState === 'complete') setTimeout(preloadImages, 200);
else window.addEventListener('load', () => setTimeout(preloadImages, 200), { once: true });

function readyImage(index) {
  const img = images[index % Math.max(images.length, 1)];
  return img && img.complete && img.naturalWidth ? img : null;
}

function wave(width, height, random, pattern, delay, count, palette) {
  const small = width < 700;
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + random() * .4;
    let x = width * .5, y = height * .58;
    let vx = Math.cos(angle) * width * (.3 + random() * .25), vy = Math.sin(angle) * height * (.28 + random() * .18) - height * .32;
    if (pattern === 'twin') { x = width * (i % 2 ? .86 : .14); y = height * .78; vx = (i % 2 ? -1 : 1) * width * (.12 + random() * .32); vy = -height * (.5 + random() * .35); }
    if (pattern === 'fountain') { x = width * .5; y = height * .9; vx = (i / Math.max(count - 1, 1) - .5) * width * .9; vy = -height * (.7 + random() * .3); }
    if (pattern === 'rain') { x = (i + .5) / count * width; y = -80 - random() * 160; vx = (random() - .5) * width * .14; vy = height * (.1 + random() * .12); }
    const useImage = random() < .62;
    return {
      delay, x, y, vx, vy,
      angle: random() * Math.PI * 2, spin: (random() - .5) * 5,
      kind: useImage ? 'image' : motifs[i % motifs.length],
      imageIndex: Math.floor(random() * imageFiles.length),
      color: palette[i % palette.length],
      size: useImage ? (small ? 46 + random() * 30 : 64 + random() * 40) : (small ? 34 + random() * 16 : 46 + random() * 22),
    };
  });
}

function confetti(width, height, random, count, palette) {
  return Array.from({ length: count }, () => {
    const angle = random() * Math.PI * 2;
    const speed = .25 + random() * .45;
    return {
      delay: random() * .9, x: width * (.2 + random() * .6), y: height * (.45 + random() * .25),
      vx: Math.cos(angle) * width * speed, vy: Math.sin(angle) * height * speed * .7 - height * .35,
      angle: random() * Math.PI * 2, spin: (random() - .5) * 9,
      kind: random() < .5 ? 'chip' : 'perf', color: palette[Math.floor(random() * palette.length)], size: 6 + random() * 7,
    };
  });
}

function createBurstPlan(width, height, random = Math.random) {
  const small = width < 700;
  const palette = palettes[Math.floor(random() * palettes.length)];
  const order = [...patterns].sort(() => random() - .5);
  const per = small ? 16 : 22;
  return {
    pieces: [
      ...wave(width, height, random, 'radial', 0, per, palette),
      ...wave(width, height, random, order[0] === 'radial' ? 'twin' : order[0], .32, per, palette),
      ...wave(width, height, random, order[1] === 'radial' ? 'fountain' : order[1], .64, Math.round(per * .8), palette),
    ],
    confetti: confetti(width, height, random, small ? 70 : 110, palette),
  };
}

function draw(ctx, p) {
  const ink = '#29342d', paper = '#ffffff'; ctx.lineWidth = 2; ctx.strokeStyle = ink; ctx.fillStyle = p.color;
  const rect = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); };
  const circle = (x, y, r, color) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.stroke(); };
  if (p.kind === 'image') {
    const img = readyImage(p.imageIndex);
    if (img) { ctx.drawImage(img, -36, -36, 72, 72); return; }
    p.kind = motifs[p.imageIndex % motifs.length];
  }
  if (p.kind === 'cassette') { rect(-17,-24,34,48,p.color); rect(-18,-25,36,7,ink); rect(-7,-32,14,7,ink); rect(-17,-7,34,16,paper); rect(17,-13,12,32,'#865638'); for (let y = -9; y < 17; y += 9) rect(24,y,3,4,paper); }
  if (p.kind === 'strip') { ctx.rotate(.25); rect(-14,-33,28,66,'#865638'); for (let y = -25; y < 25; y += 22) rect(-8,y,16,16,p.color); ctx.fillStyle = paper; for (let y = -29; y < 30; y += 10) { ctx.fillRect(-12,y,3,4); ctx.fillRect(9,y,3,4); } }
  if (p.kind === 'contact') { rect(-25,-30,50,60,ink); for (let y = -24; y < 23; y += 17) for (let x = -19; x < 20; x += 14) rect(x,y,10,12,p.color); ctx.fillStyle = paper; ctx.fillRect(-18,26,33,2); }
  if (p.kind === 'slide') { rect(-29,-26,58,52,paper); rect(-21,-18,42,30,p.color); ctx.fillStyle = '#526b56'; ctx.beginPath(); ctx.moveTo(-20,11); ctx.lineTo(-4,-8); ctx.lineTo(5,3); ctx.lineTo(12,-3); ctx.lineTo(20,11); ctx.fill(); circle(11,-10,4,'#e1b54a'); }
  if (p.kind === 'camera') { rect(-31,-18,62,39,p.color); rect(-21,-25,17,7,ink); rect(16,-13,11,7,paper); circle(-3,2,17,ink); circle(-3,2,11,'#8eaa9b'); circle(-3,2,6,ink); }
  if (p.kind === 'tank') { rect(-22,-25,44,53,p.color); rect(-25,-29,50,9,ink); rect(-8,-36,16,7,ink); rect(-18,-8,36,15,paper); ctx.beginPath(); ctx.moveTo(-12,0); ctx.lineTo(12,0); ctx.stroke(); }
  if (p.kind === 'reel') { circle(0,0,29,paper); circle(0,0,22,p.color); circle(0,0,9,paper); for (let i = 0; i < 6; i++) { ctx.save(); ctx.rotate(i * Math.PI / 3); rect(10,-3,16,6,paper); ctx.restore(); } circle(0,0,4,ink); }
  if (p.kind === 'print') { rect(-24,-30,48,61,paper); rect(-19,-25,38,39,p.color); ctx.fillStyle = '#526b56'; ctx.beginPath(); ctx.moveTo(-18,13); ctx.lineTo(-5,-9); ctx.lineTo(18,13); ctx.fill(); circle(10,-15,5,'#e1b54a'); }
}

function drawConfetti(ctx, c) {
  ctx.fillStyle = c.color;
  if (c.kind === 'chip') { ctx.fillRect(-c.size / 2, -c.size * .35, c.size, c.size * .7); return; }
  // A film perforation: a dark rounded slot.
  ctx.fillStyle = '#29342d';
  ctx.beginPath(); ctx.roundRect?.(-c.size * .35, -c.size * .5, c.size * .7, c.size, 1.5); if (!ctx.roundRect) ctx.rect(-c.size * .35, -c.size * .5, c.size * .7, c.size); ctx.fill();
}

let activeStop;
function playFilmFireworks({ random = Math.random, onComplete = () => {} } = {}) {
  activeStop?.();
  preloadImages();
  const canvas = document.createElement('canvas'), status = document.createElement('div');
  canvas.setAttribute('aria-hidden', 'true'); canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:30';
  status.setAttribute('role', 'status'); status.style.cssText = 'position:fixed;bottom:8px;left:50%;transform:translateX(-50%);width:min(696px,calc(100vw - 24px));min-height:48px;padding:11px 16px;border-radius:12px;background:#29342d;color:#f7f8f5;font:17px/25.5px "Noto Sans KR",system-ui,sans-serif;z-index:31;pointer-events:none'; status.textContent = completionCopy;
  const width = innerWidth, height = innerHeight, ratio = Math.min(devicePixelRatio || 1, 2), plan = createBurstPlan(width, height, random), motion = matchMedia('(prefers-reduced-motion: reduce)');
  canvas.width = width * ratio; canvas.height = height * ratio; document.body.append(canvas, status);
  const ctx = canvas.getContext('2d'); let frameId, ended = false, elapsed = 0, lastTime = null;
  function stop() { if (ended) return; ended = true; cancelAnimationFrame(frameId); canvas.remove(); status.remove(); window.removeEventListener('resize', stop); window.removeEventListener('pagehide', stop); document.removeEventListener('visibilitychange', hidden); motion.removeEventListener('change', stop); if (activeStop === stop) activeStop = null; onComplete(); }
  function hidden() { cancelAnimationFrame(frameId); lastTime = null; if (!document.hidden && !ended) frameId = requestAnimationFrame(frame); }
  activeStop = stop; window.addEventListener('resize', stop); window.addEventListener('pagehide', stop); document.addEventListener('visibilitychange', hidden); motion.addEventListener('change', stop);
  if (!ctx) { stop(); return stop; } ctx.scale(ratio, ratio);
  const gravity = height * .55;
  function frame(now) {
    if (ended || document.hidden) { lastTime = null; return; }
    if (lastTime !== null) elapsed += Math.min(now - lastTime, 100); lastTime = now;
    const t = elapsed / 1000; if (t >= DURATION) { stop(); return; }
    ctx.clearRect(0, 0, width, height);
    if (motion.matches) {
      plan.pieces.slice(0, 4).forEach((p, i) => { ctx.save(); ctx.translate(width / 2 + (i - 1.5) * Math.min(65, width / 5), height * .5); ctx.scale(.7, .7); draw(ctx, p); ctx.restore(); });
    } else {
      ctx.globalAlpha = Math.min(1, (DURATION - t) * 2.5);
      for (const c of plan.confetti) {
        const local = t - c.delay; if (local < 0) continue;
        ctx.save(); ctx.translate(c.x + c.vx * local * .9, c.y + c.vy * local + gravity * local * local); ctx.rotate(c.angle + c.spin * local); drawConfetti(ctx, c); ctx.restore();
      }
      for (const p of plan.pieces) {
        const local = t - p.delay; if (local < 0) continue;
        const pop = Math.min(1, local / .18);
        ctx.save(); ctx.translate(p.x + p.vx * local, p.y + p.vy * local + gravity * .5 * local * local); ctx.rotate(p.angle + p.spin * local);
        const s = (p.size / 60) * (.4 + .6 * pop); ctx.scale(s, s); draw(ctx, p); ctx.restore();
      }
    }
    frameId = requestAnimationFrame(frame);
  }
  frameId = requestAnimationFrame(frame); return stop;
}

// Ordinary/keyboard activation shows decoration before same-tab navigation.
// This is not payment confirmation. Native href remains the no-JS fallback.
let pendingTimer = null, stopEffect = null, activeLink = null;
function resetSupportNavigation() {
  if (pendingTimer !== null) clearTimeout(pendingTimer);
  pendingTimer = null;
  stopEffect?.(); stopEffect = null;
  if (activeLink) { activeLink.removeAttribute('aria-busy'); activeLink.classList.remove('is-opening'); }
  activeLink = null;
}
for (const link of document.querySelectorAll('[data-support-link]')) {
  link.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (activeLink) return;
    activeLink = link; link.setAttribute('aria-busy', 'true'); link.classList.add('is-opening');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) { try { stopEffect = playFilmFireworks(); } catch { /* Navigation still works. */ } }
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      const destination = link.href;
      resetSupportNavigation();
      window.location.assign(destination);
    }, reduced ? 0 : NAVIGATE_AFTER_MS);
  });
}
// Clear timers before leaving and after BFCache restoration: never navigate twice.
window.addEventListener('pagehide', resetSupportNavigation);
window.addEventListener('pageshow', resetSupportNavigation);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetSupportNavigation(); });

})();
