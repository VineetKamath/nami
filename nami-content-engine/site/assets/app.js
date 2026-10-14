import { sound } from './sound.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(pointer: fine)').matches;
const API = ($('meta[name="nami-api"]')?.content || '').replace(/\/$/, '');

const mouse = { x: innerWidth / 2, y: innerHeight / 2, vx: 0, vy: 0, speed: 0 };
addEventListener('pointermove', (e) => {
  mouse.vx = e.clientX - mouse.x;
  mouse.vy = e.clientY - mouse.y;
  mouse.x = e.clientX;
  mouse.y = e.clientY;
}, { passive: true });

/* ---------------- boot ---------------- */
function boot() {
  const pct = $('#boot-pct'), fill = $('#boot-fill'), text = $('#boot-text');
  const phases = ['ESTABLISHING SIGNAL', 'WARMING TUBES', 'LOCKING FREQUENCY', 'ON AIR'];
  let p = 0;
  const step = () => {
    p = Math.min(100, p + Math.random() * (reduced ? 40 : 9));
    pct.textContent = String(Math.floor(p)).padStart(3, '0');
    fill.style.width = p + '%';
    text.textContent = phases[Math.min(phases.length - 1, Math.floor(p / 26))];
    if (p < 100) setTimeout(step, 60 + Math.random() * 90);
    else $('#boot-actions').hidden = false;
  };
  step();
  const enter = async (withSound) => {
    if (withSound) await sound.enable();
    syncSoundToggle();
    sound.click();
    $('#boot').classList.add('is-done');
    document.body.classList.remove('is-booting');
    document.body.classList.add('is-ready');
    setTimeout(() => scramble($('[data-scramble]')), 500);
  };
  $('#enter-sound').addEventListener('click', () => enter(true));
  $('#enter-silent').addEventListener('click', () => enter(false));
}

/* ---------------- sound toggle ---------------- */
function syncSoundToggle() {
  const btn = $('#sound-toggle');
  btn.setAttribute('aria-pressed', String(sound.enabled));
  $('#sound-label').textContent = sound.enabled ? 'sound on' : 'sound off';
}
$('#sound-toggle').addEventListener('click', async () => {
  if (sound.enabled) sound.disable(); else { await sound.enable(); sound.click(); }
  syncSoundToggle();
});

/* ---------------- cursor ---------------- */
function cursor() {
  if (!fine || reduced) return;
  document.documentElement.classList.add('has-cursor');
  const root = $('.cursor'), dot = $('.cursor-dot'), ring = $('.cursor-ring'), label = $('.cursor-label');
  const pos = { x: mouse.x, y: mouse.y };
  const loop = () => {
    pos.x = lerp(pos.x, mouse.x, 0.18);
    pos.y = lerp(pos.y, mouse.y, 0.18);
    dot.style.transform = `translate3d(${mouse.x}px, ${mouse.y}px, 0)`;
    ring.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
    requestAnimationFrame(loop);
  };
  loop();
  addEventListener('pointerdown', () => root.classList.add('is-down'));
  addEventListener('pointerup', () => root.classList.remove('is-down'));
  document.addEventListener('pointerleave', () => root.classList.add('is-hidden'));
  document.addEventListener('pointerenter', () => root.classList.remove('is-hidden'));
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest('[data-cursor]');
    root.classList.toggle('is-hover', Boolean(t));
    label.textContent = t ? t.dataset.cursor : '';
  });
}

/* hover + click sounds on everything interactive */
let lastHover = null;
document.addEventListener('pointerover', (e) => {
  const t = e.target.closest('[data-cursor], a, button');
  if (t && t !== lastHover) sound.blip(660 + Math.random() * 220, 0.03);
  lastHover = t;
});
document.addEventListener('click', (e) => { if (e.target.closest('a, button')) sound.click(); });

/* ---------------- background: rain + drifting signal dust ---------------- */
function background() {
  const c = $('#bg'), g = c.getContext('2d');
  let w, h, dpr, drops, dust;
  const resize = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = c.width = innerWidth * dpr;
    h = c.height = innerHeight * dpr;
    const n = Math.floor((innerWidth * innerHeight) / (fine ? 9000 : 18000));
    drops = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, l: (8 + Math.random() * 22) * dpr, v: (6 + Math.random() * 10) * dpr, a: 0.05 + Math.random() * 0.18 }));
    dust = Array.from({ length: Math.floor(n / 5) }, () => ({ x: Math.random() * w, y: Math.random() * h, r: (0.6 + Math.random() * 1.8) * dpr, v: (0.1 + Math.random() * 0.4) * dpr, p: Math.random() * 6.28 }));
  };
  resize();
  addEventListener('resize', resize);
  let running = true;
  document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) frame(); });
  const frame = () => {
    if (!running) return;
    g.clearRect(0, 0, w, h);
    // glow that follows the cursor
    const gx = mouse.x * dpr, gy = mouse.y * dpr;
    const grad = g.createRadialGradient(gx, gy, 0, gx, gy, 420 * dpr);
    grad.addColorStop(0, 'rgba(127,255,212,0.06)');
    grad.addColorStop(1, 'rgba(127,255,212,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const wind = (mouse.x / innerWidth - 0.5) * 3 * dpr;
    g.lineWidth = dpr;
    for (const d of drops) {
      g.strokeStyle = `rgba(170,220,230,${d.a})`;
      g.beginPath();
      g.moveTo(d.x, d.y);
      g.lineTo(d.x + wind * 2, d.y + d.l);
      g.stroke();
      d.y += d.v;
      d.x += wind;
      if (d.y > h) { d.y = -d.l; d.x = Math.random() * w; }
    }
    for (const p of dust) {
      p.p += 0.01;
      p.y -= p.v;
      p.x += Math.sin(p.p) * 0.3 * dpr;
      if (p.y < 0) { p.y = h; p.x = Math.random() * w; }
      g.fillStyle = `rgba(127,255,212,${0.25 + Math.sin(p.p * 3) * 0.2})`;
      g.beginPath();
      g.arc(p.x, p.y, p.r, 0, 6.28);
      g.fill();
    }
    if (!reduced) requestAnimationFrame(frame);
  };
  frame();
}

/* ---------------- clock ---------------- */
function clock() {
  const el = $('#clock');
  const tick = () => { el.textContent = new Date().toLocaleTimeString([], { hour12: false }); };
  tick();
  setInterval(tick, 1000);
}

/* ---------------- text effects ---------------- */
const GLYPHS = '!<>-_\\/[]{}—=+*^?#01ΔΣΩ';
function scramble(el, { speed = 1 } = {}) {
  if (!el || reduced) return;
  const final = el.dataset.final || el.textContent;
  el.dataset.final = final;
  let frame = 0;
  const total = final.length * 2.2 / speed;
  const run = () => {
    frame++;
    let out = '';
    for (let i = 0; i < final.length; i++) {
      const reveal = (i / final.length) * total;
      if (frame >= reveal + 6 || final[i] === ' ') out += final[i];
      else if (frame >= reveal) out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      else out += ' ';
    }
    el.textContent = out;
    if (frame % 3 === 0) sound.tick();
    if (frame < total + 6) requestAnimationFrame(run); else el.textContent = final;
  };
  run();
}
$$('.nav-links a').forEach((a) => a.addEventListener('pointerenter', () => scramble(a, { speed: 2 })));

function splitLines() {
  $$('[data-split]').forEach((el) => {
    const lines = el.innerHTML.split(/<br\s*\/?>/i);
    el.innerHTML = lines.map((l, i) => `<span class="split-line"><span style="transition-delay:${i * 0.09}s">${l}</span></span>`).join('');
  });
}

/* ---------------- reveal on scroll ---------------- */
function reveals() {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      if (e.target.matches('[data-scramble]')) scramble(e.target);
      $$('[data-count]', e.target).forEach(countUp);
      if (e.target.matches('[data-count]')) countUp(e.target);
      io.unobserve(e.target);
    }
  }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
  $$('[data-reveal], [data-split]').forEach((el) => io.observe(el));
}

function countUp(el) {
  if (el.dataset.done) return;
  el.dataset.done = '1';
  const target = Number(el.dataset.count), dec = Number(el.dataset.decimals || 0);
  const start = performance.now(), dur = reduced ? 1 : 1600;
  const step = (t) => {
    const k = clamp((t - start) / dur, 0, 1);
    const eased = 1 - Math.pow(1 - k, 4);
    el.textContent = (target * eased).toFixed(dec);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------------- tilt + spotlight + magnetic ---------------- */
function tilt() {
  if (!fine || reduced) return;
  $$('[data-tilt]').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      el.style.transform = `perspective(900px) rotateY(${(px - 0.5) * 10}deg) rotateX(${(0.5 - py) * 10}deg)`;
      el.style.setProperty('--mx', px * 100 + '%');
      el.style.setProperty('--my', py * 100 + '%');
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });
  $$('.btn, .sound-toggle').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.25}px, ${(e.clientY - r.top - r.height / 2) * 0.35}px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });
}

/* ---------------- hero title glitch ---------------- */
function heroTitle() {
  const letters = $$('#hero-title span');
  letters.forEach((s, i) => {
    s.dataset.c = s.textContent;
    const glitch = () => {
      s.classList.remove('glitch');
      void s.offsetWidth;
      s.classList.add('glitch');
    };
    s.addEventListener('pointerenter', () => { glitch(); sound.blip(330 * Math.pow(1.25, i), 0.05); });
    s.addEventListener('animationend', () => s.classList.remove('glitch'));
  });
  if (!reduced) setInterval(() => {
    const s = letters[Math.floor(Math.random() * letters.length)];
    s.classList.remove('glitch'); void s.offsetWidth; s.classList.add('glitch');
  }, 3200);
}

/* ---------------- oscilloscope ---------------- */
function scope() {
  const c = $('#scope'), g = c.getContext('2d');
  let w, h, dpr;
  const resize = () => { dpr = Math.min(devicePixelRatio || 1, 2); w = c.width = c.clientWidth * dpr; h = c.height = c.clientHeight * dpr; };
  resize();
  addEventListener('resize', resize);
  let energy = 0;
  const data = new Uint8Array(1024);
  const frame = (t) => {
    energy = lerp(energy, clamp(Math.hypot(mouse.vx, mouse.vy) / 40, 0, 1), 0.06);
    mouse.vx *= 0.9; mouse.vy *= 0.9;
    g.clearRect(0, 0, w, h);
    g.lineWidth = 1.5 * dpr;
    g.strokeStyle = '#7fffd4';
    g.shadowColor = '#7fffd4';
    g.shadowBlur = 10 * dpr;
    g.beginPath();
    const an = sound.analyser;
    if (an) an.getByteTimeDomainData(data);
    for (let x = 0; x <= w; x += 2 * dpr) {
      const k = x / w;
      let y;
      if (an) y = ((data[Math.floor(k * 1023)] - 128) / 128) * h * 1.6;
      else y = 0;
      y += Math.sin(k * 18 + t / 400) * h * (0.06 + energy * 0.3) * Math.sin(k * Math.PI);
      y += Math.sin(k * 61 - t / 160) * h * energy * 0.08;
      if (x === 0) g.moveTo(x, h / 2 + y); else g.lineTo(x, h / 2 + y);
    }
    g.stroke();
    if (!reduced) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* ---------------- scroll-driven: progress, parallax, pinned track ---------------- */
function scrollFx() {
  const bar = $('#scroll-progress');
  const parallax = $$('[data-speed]');
  const section = $('#transmissions'), track = $('#track');
  const desktop = matchMedia('(min-width: 761px)');
  let y = scrollY, target = scrollY;
  addEventListener('scroll', () => { target = scrollY; }, { passive: true });
  const frame = () => {
    y = reduced ? target : lerp(y, target, 0.12);
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
    for (const el of parallax) el.style.translate = desktop.matches ? `0 ${y * Number(el.dataset.speed)}px` : '';
    if (desktop.matches) {
      const r = section.getBoundingClientRect();
      const span = section.offsetHeight - innerHeight;
      const k = clamp(-r.top / span, 0, 1);
      const dist = Math.max(0, track.scrollWidth - innerWidth + 64);
      track.style.transform = `translate3d(${-k * dist}px, 0, 0)`;
    }
    requestAnimationFrame(frame);
  };
  frame();
}

/* ---------------- live data: transmissions + production ---------------- */
const SAMPLE_FEED = [
  { text: 'rain on the studio window again. what are you listening to right now?', kind: 'post' },
  { text: 'late shift. the CRT hums in B flat, i think. tell me yours.', kind: 'post' },
  { text: 'city pop after 2am hits different. one song, one reason. go.', kind: 'post' },
  { text: 'the last train leaves its reflection on the glass for a second longer than the train.', kind: 'post' },
  { text: 'new transmission in production. you can watch every shot being made below.', kind: 'video' },
];

async function getJson(path) {
  const res = await fetch(API + path, { cache: 'no-store' });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

function txCard(item, i) {
  const el = document.createElement('article');
  el.className = 'tx';
  el.dataset.cursor = item.postUrl ? 'open' : 'read';
  const media = document.createElement('div');
  media.className = 'tx-media';
  const video = item.media?.find((m) => m.type === 'video');
  const poster = item.media?.find((m) => m.role === 'poster');
  if (video) {
    const v = Object.assign(document.createElement('video'), { src: video.url, poster: poster?.url || '', muted: true, loop: true, playsInline: true, preload: 'metadata' });
    el.addEventListener('pointerenter', () => v.play().catch(() => {}));
    el.addEventListener('pointerleave', () => v.pause());
    media.append(v);
  } else if (poster) {
    media.append(Object.assign(document.createElement('img'), { src: poster.url, alt: poster.alt || '', loading: 'lazy' }));
  } else {
    const glyph = document.createElement('div');
    glyph.className = 'tx-glyph';
    glyph.textContent = ['n', '☾', '~', '◌', '✦'][i % 5];
    media.append(glyph);
  }
  const body = document.createElement('div');
  body.className = 'tx-body';
  const meta = document.createElement('div');
  meta.className = 'tx-meta mono';
  const when = item.publishedAt ? new Date(item.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'sample';
  meta.append(Object.assign(document.createElement('span'), { textContent: `TX-${String(i + 1).padStart(3, '0')}` }), Object.assign(document.createElement('span'), { textContent: when }));
  const p = Object.assign(document.createElement('p'), { className: 'tx-text', textContent: item.text });
  body.append(meta, p);
  el.append(media, body);
  if (item.postUrl) el.addEventListener('click', () => open(item.postUrl, '_blank', 'noopener'));
  return el;
}

async function feed() {
  let items = [];
  try { items = (await getJson('/api/feed')).items || []; } catch {}
  if (!items.length) items = SAMPLE_FEED;
  $('#track').replaceChildren(...items.slice(0, 12).map(txCard));
}

function ring(pct) {
  const r = 70, c = 2 * Math.PI * r;
  return `<div class="ring-wrap"><svg width="160" height="160" viewBox="0 0 160 160"><circle class="bgc" cx="80" cy="80" r="${r}"/><circle class="fgc" cx="80" cy="80" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-offset="${c * (1 - pct / 100)}"/></svg><div class="ring-pct">${pct}%</div></div>`;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

async function production() {
  const box = $('#prod');
  let data;
  try { data = await getJson('/api/progress'); } catch {
    box.innerHTML = '<div class="prod-empty mono">The studio board is offline right now. Check back after midnight.</div>';
    return;
  }
  if (!data.jobs.length) {
    box.innerHTML = '<div class="prod-empty mono">Nothing in production right now. The next broadcast is being written.</div>';
    return;
  }
  const b = data.budget;
  box.innerHTML = data.jobs.map((j) => `
    <article class="pjob">
      ${ring(j.percent)}
      <div>
        <h3>${esc(j.title)}</h3>
        ${j.waiting ? `<p class="wait mono">${esc(j.waiting)}</p>` : ''}
        <ul class="steps">${j.steps.map((s) => `<li class="${s.state}">${esc(s.label)}</li>`).join('')}</ul>
        <div class="shots">${j.shots.map((s) => `<div class="shot ${s.state}" data-cursor="shot ${s.n}">${s.preview ? `<video src="${esc(s.preview)}" muted loop autoplay playsinline></video>` : s.state === 'done' ? '✓' : s.n}</div>`).join('')}</div>
        <div class="budget-row mono"><span>Render budget <b>$${b.video.unlockedUsd}</b></span><span>Spent <b>$${b.video.spentUsd}</b></span><span>Updated ${new Date(j.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
      </div>
    </article>`).join('');
  requestAnimationFrame(() => $$('.fgc', box).forEach((c) => { c.style.strokeDashoffset = c.dataset.offset; }));
}

/* ---------------- tuner ---------------- */
function tuner() {
  const root = $('#tuner'), band = $('#band'), needle = $('#needle'), freqEl = $('#freq'), msg = $('#tuner-msg');
  const c = $('#static'), g = c.getContext('2d');
  const TARGET = 103.3;
  const STATIONS = [
    { f: 90.1, text: 'a weather report for a city that doesn’t exist.' },
    { f: 94.7, text: 'someone else’s lo-fi loop. close, but not her.' },
    { f: 98.5, text: '“the last train is now departing.” keep going.' },
    { f: TARGET, text: 'you found me. stay a while — the rain sounds better with company.' },
  ];
  let freq = 88, locked = false, dragging = false, staticAmt = 1;

  const set = (f) => {
    freq = clamp(Math.round(f * 10) / 10, 88, 108);
    const k = (freq - 88) / 20;
    needle.style.left = k * 100 + '%';
    freqEl.textContent = freq.toFixed(1);
    band.setAttribute('aria-valuenow', String(freq));
    const near = STATIONS.reduce((best, s) => (Math.abs(s.f - freq) < Math.abs(best.f - freq) ? s : best));
    const d = Math.abs(near.f - freq);
    staticAmt = clamp(d / 1.2, 0.04, 1);
    sound.setStatic(staticAmt, 600 + k * 3000);
    const isTarget = near.f === TARGET && d < 0.15;
    if (d < 0.25) msg.textContent = near.text;
    else msg.textContent = '· · · static · · ·';
    if (isTarget && !locked) { locked = true; root.classList.add('is-locked'); sound.chime(); }
    if (!isTarget && locked) { locked = false; root.classList.remove('is-locked'); }
  };
  const fromEvent = (e) => {
    const r = band.getBoundingClientRect();
    set(88 + clamp((e.clientX - r.left) / r.width, 0, 1) * 20);
  };
  band.addEventListener('pointerdown', (e) => { dragging = true; band.setPointerCapture(e.pointerId); fromEvent(e); });
  band.addEventListener('pointermove', (e) => { if (dragging) fromEvent(e); });
  band.addEventListener('pointerup', () => { dragging = false; });
  band.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { set(freq + 0.1); e.preventDefault(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { set(freq - 0.1); e.preventDefault(); }
  });
  // static only audible while the tuner is on screen
  new IntersectionObserver(([e]) => sound.setStatic(e.isIntersecting ? staticAmt : 0)).observe(root);

  const resize = () => { c.width = Math.ceil(c.clientWidth / 3); c.height = Math.ceil(c.clientHeight / 3); };
  resize();
  addEventListener('resize', resize);
  const frame = () => {
    const img = g.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255 * staticAmt;
      img.data[i] = v * 0.6; img.data[i + 1] = v; img.data[i + 2] = v * 0.9; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    if (!reduced) setTimeout(() => requestAnimationFrame(frame), 50);
  };
  frame();
  set(88);
}

/* ---------------- go ---------------- */
splitLines();
boot();
cursor();
background();
clock();
reveals();
tilt();
heroTitle();
scope();
scrollFx();
tuner();
feed();
production();
setInterval(production, 20000);
