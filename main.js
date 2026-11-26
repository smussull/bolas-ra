// Bolas RA — juego WebXR de realidad mixta para Meta Quest 3.
// Fases: escaneo de la habitación (planos + malla de la escena) → bolas de goma ligera que caen del
// techo y colisionan con la geometría real → cogerlas (puño, pinza o botón de agarre), girarlas y
// lanzarlas → fusionar iguales. Juntar los puños y separarlos crea una raqueta.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ---------- Ajustes ----------
const G = 9.81;
const INITIAL_BALLS = 42, MAX_BALLS = 80;
const DROP_MIN = 2.0, DROP_MAX = 4.5;   // s entre bolas que caen del techo
const BALL_R = 0.06;                   // radio base (m)
// Goma ligera hinchada sobre superficie dura
const REST_HARD = 0.8;     // rebote contra suelo, paredes y muebles
const REST_BALL = 0.75;    // rebote entre bolas
const MU = 0.6;            // fricción de deslizamiento (convierte deslizar en rodar)
const ROLL = 0.22;         // resistencia a la rodadura (m/s²)
const DRAG_LIN = 0.06, DRAG_QUAD = 0.05;   // aire (pelota ligera)
const MIN_BOUNCE = 0.15;   // por debajo de esta velocidad normal ya no rebota (se asienta)
const MERGE_WINDOW = 3.0;  // s tras lanzar/golpear una bola en los que puede fusionarse
// Manos (medido en la Quest: pinza 0.007–0.03; mano abierta: pinza 0.05–0.12)
const PINCH_ON = 0.03, PINCH_OFF = 0.045;   // umbral de soltar cercano: se suelta en cuanto se abre
const FIST_ON = 0.075, FIST_OFF = 0.085;    // media punta→centro de la palma
const GRAB_REACH = 0.12;   // m desde la superficie de la bola
const GRAB_GRACE = 0.35;   // s: cerrar la mano un poco antes de tocar la bola también la coge
const SNAP_TIME = 0.08;    // s que tarda la bola en colocarse dentro de la mano
const THROW_BOOST = 1.05;
const THROW_WINDOW = 0.12;   // s: se usa el pico de velocidad de la bola en este intervalo antes de abrir la mano
// Raqueta
const RACKET_TOUCH = 0.14, RACKET_PULL = 0.38, RACKET_REST = 0.85;
const RK = { hy: 0.33, ax: 0.115, ay: 0.15 };   // centro y semiejes de la cabeza (m, local)
// Escaneo y rejilla
const SCAN_SWEEP = 2.5, SCAN_MIN = 5.0, CELL = 0.25;


// ---------- Render ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 50);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(1, 3, 1.5); scene.add(sun);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------- Texturas de las bolas ----------
function canvasTex(draw, w = 512, h = 256) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.wrapS = THREE.RepeatWrapping; return t;
}
const rnd = (a, b) => a + Math.random() * (b - a);

const texStripes = canvasTex((g, w, h) => {
  g.fillStyle = '#e8322a'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff'; g.fillRect(0, h * 0.44, w, h * 0.12);
  g.fillStyle = '#ffd23a'; g.fillRect(0, h * 0.2, w, h * 0.05); g.fillRect(0, h * 0.75, w, h * 0.05);
  g.fillStyle = '#fff'; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(w * (i + 0.5) / 4, h * 0.5, 14, 0, 7); g.fill(); }
});
const texSteel = canvasTex((g, w, h) => {
  g.fillStyle = '#d0d6dd'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '60,70,80'},${rnd(.05, .18)})`; g.fillRect(rnd(0, w), rnd(0, h), rnd(20, 90), 1); }
  g.fillStyle = '#5b636c'; g.fillRect(0, h * 0.49, w, 4); g.fillRect(w * 0.25, 0, 4, h); g.fillRect(w * 0.75, 0, 4, h);
});
const texWood = canvasTex((g, w, h) => {
  g.fillStyle = '#b8743f'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 3) {
    const k = Math.sin(y * 0.11) * 0.5 + Math.sin(y * 0.037) * 0.5;
    g.fillStyle = `rgba(90,45,15,${0.15 + 0.25 * Math.abs(k)})`;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.02 + y * 0.05) * 3);
    g.lineTo(w, y + 2); g.lineTo(0, y + 2); g.fill();
  }
  g.fillStyle = 'rgba(70,35,10,.6)'; g.beginPath(); g.ellipse(w * .3, h * .4, 18, 8, 0, 0, 7); g.fill();
});
const texTennis = canvasTex((g, w, h) => {
  g.fillStyle = '#d4ee3a'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(255,255,200,${rnd(0, .25)})`; g.fillRect(rnd(0, w), rnd(0, h), 2, 2); }
  g.strokeStyle = '#fbfff0'; g.lineWidth = 10; g.beginPath();
  for (let x = 0; x <= w; x += 4) { const y = h / 2 + Math.sin(x / w * Math.PI * 4) * h * 0.28; x ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
});
const texNeon = canvasTex((g, w, h) => {
  g.fillStyle = '#2a0030'; g.fillRect(0, 0, w, h);
  const n = 8, m = 4;
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) if ((i + j) % 2 === 0) { g.fillStyle = '#ff2fd0'; g.fillRect(i * w / n, j * h / m, w / n, h / m); }
  g.fillStyle = '#7dfcff'; for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) if ((i + j) % 2) { g.beginPath(); g.arc((i + .5) * w / n, (j + .5) * h / m, 10, 0, 7); g.fill(); }
});
const texGlass = canvasTex((g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#bfe6ff'); gr.addColorStop(.5, '#3a9cff'); gr.addColorStop(1, '#0b3d91');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.5)'; for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(rnd(0, w), rnd(0, h), rnd(2, 7), 0, 7); g.fill(); }
});

// Todas son pelotas de goma ligera; cambian el aspecto y el tono del bote
const TYPES = [
  { name: 'Roja',    snd: 190, mat: new THREE.MeshStandardMaterial({ map: texStripes, roughness: 0.55 }) },
  { name: 'Plata',   snd: 230, mat: new THREE.MeshStandardMaterial({ map: texSteel, metalness: 0.7, roughness: 0.3 }) },
  { name: 'Madera',  snd: 165, mat: new THREE.MeshStandardMaterial({ map: texWood, roughness: 0.7 }) },
  { name: 'Tenis',   snd: 260, mat: new THREE.MeshStandardMaterial({ map: texTennis, roughness: 1 }) },
  { name: 'Cristal', snd: 300, mat: new THREE.MeshPhysicalMaterial({ map: texGlass, roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.8 }) },
  { name: 'Neón',    snd: 340, mat: new THREE.MeshStandardMaterial({ map: texNeon, emissiveMap: texNeon, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.4 }) },
];

const TYPE_COLORS = [0xff4a3a, 0xd8e0e8, 0xc98a52, 0xd4ee3a, 0x4aa8ff, 0xff2fd0];

// ---------- Sombras de contacto ----------
const shadowTex = canvasTex((g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(.5, 'rgba(0,0,0,.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}, 128, 128);
const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

// ---------- Audio espacial ----------
let actx = null, master = null;
function initAudio() {
  if (actx) return;
  actx = new (window.AudioContext || window.webkitAudioContext)();
  master = actx.createGain(); master.gain.value = 0.9; master.connect(actx.destination);
}
function panAt(p) {
  const pn = actx.createPanner();
  pn.panningModel = 'HRTF'; pn.distanceModel = 'inverse'; pn.refDistance = 0.6; pn.rolloffFactor = 1.2;
  if (pn.positionX) { pn.positionX.value = p.x; pn.positionY.value = p.y; pn.positionZ.value = p.z; } else pn.setPosition(p.x, p.y, p.z);
  pn.connect(master); return pn;
}
function tone(dest, f, type, vol, t0, dur, fEnd) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t0);
  if (fEnd) o.frequency.exponentialRampToValueAtTime(fEnd, t0 + dur);
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
  o.connect(g).connect(dest); o.start(t0); o.stop(t0 + dur + 0.02);
}
let noiseBuf = null;
function noise(dest, vol, t0, dur, freq) {
  if (!noiseBuf) { noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.1, actx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noiseBuf; s.loop = true; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
  s.connect(f).connect(g).connect(dest); s.start(t0); s.stop(t0 + dur + 0.02);
}
function sndBounce(b, speed) {   // "boing" de goma
  if (!actx) return;
  const t = actx.currentTime;
  if (t - b.lastSnd < 0.06) return;
  const vol = Math.min(1, speed / 4) * 0.5; if (vol < 0.03) return;
  b.lastSnd = t;
  const f = TYPES[b.t].snd * Math.pow(BALL_R / b.r, 0.7), p = panAt(b.pos);
  tone(p, f * 1.5, 'sine', vol, t, 0.11, f * 0.75);
  noise(p, vol * 0.35, t, 0.03, f * 6);
}
function sndRacket(pos, speed) {
  if (!actx) return;
  const t = actx.currentTime, p = panAt(pos), vol = Math.min(1, speed / 6) * 0.7 + 0.15;
  tone(p, 640, 'triangle', vol, t, 0.07, 300); noise(p, vol * 0.6, t, 0.04, 2500);
}
function sndMerge(pos, level) {
  if (!actx) return;
  const t = actx.currentTime, p = panAt(pos), base = 392 * Math.pow(2, Math.min(level, 12) / 6);
  [1, 1.25, 1.5, 2].forEach((k, i) => tone(p, base * k, 'sine', 0.35, t + i * 0.05, 0.5));
  tone(p, 90, 'sine', 0.6, t, 0.25, 40);
}
function sndGrab(pos) { if (actx) tone(panAt(pos), 880, 'sine', 0.15, actx.currentTime, 0.06, 1200); }
function sndZip(pos, up) { if (actx) tone(panAt(pos), up ? 300 : 900, 'sawtooth', 0.12, actx.currentTime, 0.3, up ? 1100 : 250); }
function sndDrop(pos) { if (actx) tone(panAt(pos), 1300, 'sine', 0.08, actx.currentTime, 0.35, 500); }

function updateListener(pos, q) {
  if (!actx) return;
  const L = actx.listener, f = new THREE.Vector3(0, 0, -1).applyQuaternion(q), u = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  if (L.positionX) {
    L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z;
    L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z;
  } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
}

// ---------- Paneles de texto en el mundo ----------
// Carteles: blanco ligeramente transparente, texto negro, esquinas redondeadas.
// El texto se parte en líneas y se reduce hasta que cabe entero dentro de los márgenes.
const PANEL_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const PX_PER_M = 2000;
function makePanel(w, h, sizes = { title: 0.21, body: 0.125 }) {
  const k = Math.max(PX_PER_M, 320 / h);   // carteles pequeños: más resolución para que el texto sea nítido
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  mesh.renderOrder = 20; mesh.visible = false; scene.add(mesh);
  return { mesh, c, g: c.getContext('2d'), tex, txt: '', sizes };
}
function wrapText(g, text, maxW) {
  const out = []; let cur = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    const t = cur ? cur + ' ' + w : w;
    if (!cur || g.measureText(t).width <= maxW) cur = t; else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out.flatMap(l => {          // una palabra más ancha que la caja se parte por caracteres
    if (g.measureText(l).width <= maxW) return [l];
    const parts = []; let p = '';
    for (const ch of l) { if (p && g.measureText(p + ch).width > maxW) { parts.push(p); p = ch; } else p += ch; }
    if (p) parts.push(p); return parts;
  });
}
function layoutPanel(g, lines, W, H, sizes) {
  const pad = Math.min(W, H) * 0.15, maxW = W - pad * 2, maxH = H - pad * 2;
  let lay = null;
  for (let s = 1; s >= 0.2; s -= 0.04) {
    const rows = []; let tot = 0, widest = 0;
    lines.forEach((l, i) => {
      const size = H * (i ? sizes.body : sizes.title) * s, font = `${i ? 400 : 650} ${size}px ${PANEL_FONT}`;
      g.font = font;
      // viñetas "• texto": las líneas partidas quedan sangradas bajo el texto, no bajo la viñeta
      const bullet = i > 0 && l.startsWith('• '), indent = bullet ? g.measureText('• ').width : 0;
      if (bullet && i > 1) { rows.push({ gap: size * 0.38 }); tot += size * 0.38; }
      wrapText(g, bullet ? l.slice(2) : l, maxW - indent).forEach((t, k) => {
        const w = indent + g.measureText(t).width;
        rows.push({ t: bullet && !k ? '• ' + t : t, font, size, body: i > 0, indent: bullet && k ? indent : 0, color: i ? 'rgba(0,0,0,0.68)' : '#000' });
        tot += size * 1.28; widest = Math.max(widest, w);
      });
      if (!i && lines.length > 1) { rows.push({ gap: size * 0.45 }); tot += size * 0.45; }
    });
    lay = { rows, tot };
    if (tot <= maxH && widest <= maxW) break;
  }
  return lay;
}
function drawPanel(P, lines) {
  const key = lines.join('|'); if (key === P.txt) return; P.txt = key;
  const { g, c } = P, W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.82)'; g.beginPath(); g.roundRect(2, 2, W - 4, H - 4, Math.min(W, H) * 0.2); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.07)'; g.lineWidth = 2; g.stroke();
  const { rows, tot } = layoutPanel(g, lines, W, H, P.sizes);
  g.textBaseline = 'middle';
  const left = P.sizes.align === 'left', pad = Math.min(W, H) * 0.15;
  let y = (H - tot) / 2;
  for (const r of rows) {
    if (r.gap) { y += r.gap; continue; }
    g.font = r.font; g.fillStyle = r.color; g.textAlign = left && r.body ? 'left' : 'center';
    g.fillText(r.t, left && r.body ? pad + (r.indent || 0) : W / 2, y + r.size * 0.64); y += r.size * 1.28;
  }
  P.tex.needsUpdate = true;
}
const info = makePanel(0.56, 0.24);
const wrist = makePanel(0.12, 0.06, { title: 0.36, body: 0.17 });
// ---------- Instrucciones con dibujos animados (sin texto) ----------
// Izquierda: la pinza coge la bola y al abrir la mano se lanza.
// Derecha: juntar los puños y separarlos saca la raqueta; repetirlo la guarda.
const HOW_INK = '#161616', HOW_SKIN = '#f1ede6', HOW_BALL = '#ff4a3a', HOW_RK = '#17b8ff';
const ease = k => k < 0 ? 0 : k > 1 ? 1 : k * k * (3 - 2 * k);
const seg = (t, a, b) => ease((t - a) / (b - a));
const lerpN = (a, b, k) => a + (b - a) * k;
// primitivas con contorno: primero todos los contornos, luego los rellenos (las piezas se funden)
function inked(g, shapes) {
  for (const pass of [0, 1]) for (const s of shapes) {
    g.lineCap = 'round'; g.lineJoin = 'round';
    const col = pass ? (s.fill || HOW_SKIN) : HOW_INK, ext = pass ? 0 : 7;
    if (s.cap) { g.strokeStyle = col; g.lineWidth = s.w + ext; g.beginPath(); g.moveTo(s.cap[0], s.cap[1]); g.lineTo(s.cap[2], s.cap[3]); g.stroke(); }
    if (s.ell) { g.fillStyle = col; g.beginPath(); g.ellipse(s.ell[0], s.ell[1], s.ell[2] + ext / 2, s.ell[3] + ext / 2, s.ell[4] || 0, 0, 7); g.fill(); }
    if (s.rr) { g.fillStyle = col; g.beginPath(); g.roundRect(s.rr[0] - ext / 2, s.rr[1] - ext / 2, s.rr[2] + ext, s.rr[3] + ext, s.rr[4]); g.fill(); }
  }
}
function ball(g, x, y, r, a = 1) {
  g.globalAlpha = a; g.fillStyle = HOW_BALL; g.strokeStyle = HOW_INK; g.lineWidth = 5;
  g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 4; g.beginPath(); g.arc(x - r * 0.25, y - r * 0.25, r * 0.5, 3.6, 4.6); g.stroke();
  g.globalAlpha = 1;
}
// mano de perfil: (px, py) = punta de la pinza; k = apertura (0 cerrada, 1 abierta)
function pinchHand(g, px, py, k) {
  inked(g, [
    { cap: [px - 185, py + 75, px - 120, py + 42], w: 40 },                       // antebrazo
    { ell: [px - 100, py + 22, 50, 40, -0.35] },                                  // palma
    { cap: [px - 92, py + 52, px - 8, py + 12 + 26 * k], w: 23 },                 // pulgar
    { cap: [px - 88, py - 6, px - 6, py - 8 - 30 * k], w: 21 },                   // índice
  ]);
  g.strokeStyle = HOW_INK; g.lineWidth = 4;                                       // dedos doblados
  for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(px - 108 + i * 6, py + 8 + i * 12, 16, -0.4, 1.4); g.stroke(); }
}
function drawGrab(g, t) {
  const B = [250, 210];
  // 0–0.9 acercar · 0.9–1.3 pinza · 1.3–2.0 llevarla atrás · 2.0–2.25 lanzar · 2.25–3.0 vuela · 3.0–3.6 vuelve
  const ap = seg(t, 0, 0.9), cl = seg(t, 0.9, 1.3), back = seg(t, 1.3, 2.0), thr = seg(t, 2.0, 2.25), op = seg(t, 2.2, 2.35);
  const ret = seg(t, 2.9, 3.35);                                                  // la mano vuelve al inicio
  let px = lerpN(150, B[0] - 24, ap), py = B[1];
  px = lerpN(px, 185, back); py = lerpN(py, 235, back);
  px = lerpN(px, 265, thr); py = lerpN(py, 170, thr);
  px = lerpN(px, 150, ret); py = lerpN(py, B[1], ret);
  const k = t < 0.9 ? 1 : t < 2.2 ? 1 - cl : op;
  const held = t >= 1.3 && t < 2.25;
  const fly = seg(t, 2.25, 2.95), gone = t > 2.95;
  const reappear = seg(t, 3.25, 3.55);
  if (!held && t < 1.3) ball(g, B[0], B[1], 24);
  if (held) ball(g, px + 24, py, 24);
  if (t >= 2.25 && !gone) {                                                       // vuelo con estela
    const fx = lerpN(289, 385, fly), fy = lerpN(170, 70, fly) - Math.sin(fly * Math.PI) * 25;
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 5;
    for (let i = 1; i <= 3; i++) { g.beginPath(); g.moveTo(fx - 30 - i * 14, fy + 8 * i - 6); g.lineTo(fx - 50 - i * 14, fy + 10 * i); g.stroke(); }
    ball(g, fx, fy, 24, 1 - fly * 0.4);
  }
  if (gone && t > 3.25) ball(g, B[0], B[1], 24 * reappear, reappear);
  pinchHand(g, px, py, k);
  if (t > 0.95 && t < 1.35) {                                                     // destello de la pinza
    g.strokeStyle = 'rgba(255,170,0,0.9)'; g.lineWidth = 5;
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.beginPath(); g.moveTo(B[0] + Math.cos(a) * 34, B[1] + Math.sin(a) * 34); g.lineTo(B[0] + Math.cos(a) * 46, B[1] + Math.sin(a) * 46); g.stroke(); }
  }
}
// puño de frente (sd = -1 izquierdo, 1 derecho)
function fist(g, cx, cy, sd, a = 1) {
  g.globalAlpha = a;
  inked(g, [
    { cap: [cx, cy + 40, cx + sd * 12, cy + 140], w: 42 },                        // antebrazo
    { rr: [cx - 40, cy - 34, 80, 72, 22] },                                       // puño
  ]);
  g.strokeStyle = HOW_INK; g.lineWidth = 4;
  for (let i = 0; i < 3; i++) { const x = cx - 22 + i * 20; g.beginPath(); g.moveTo(x, cy - 30); g.lineTo(x, cy - 8); g.stroke(); }   // nudillos
  g.lineWidth = 5; g.beginPath(); g.moveTo(cx - sd * 32, cy + 12); g.quadraticCurveTo(cx, cy + 4, cx + sd * 26, cy + 20); g.stroke();   // pulgar
  g.globalAlpha = 1;
}
function racketPic(g, cx, cy, sc) {
  if (sc <= 0.01) return;
  g.save(); g.translate(cx, cy - 34); g.scale(sc, sc);
  g.lineCap = 'round';
  g.strokeStyle = HOW_INK; g.lineWidth = 16; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -70); g.stroke();
  g.strokeStyle = '#333'; g.lineWidth = 9; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -70); g.stroke();
  g.save(); g.beginPath(); g.ellipse(0, -130, 40, 56, 0, 0, 7); g.clip();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
  for (let x = -40; x <= 40; x += 10) { g.beginPath(); g.moveTo(x, -190); g.lineTo(x, -70); g.stroke(); }
  for (let y = -190; y <= -70; y += 10) { g.beginPath(); g.moveTo(-45, y); g.lineTo(45, y); g.stroke(); }
  g.restore();
  g.strokeStyle = HOW_INK; g.lineWidth = 13; g.beginPath(); g.ellipse(0, -130, 40, 56, 0, 0, 7); g.stroke();
  g.strokeStyle = HOW_RK; g.lineWidth = 8; g.beginPath(); g.ellipse(0, -130, 40, 56, 0, 0, 7); g.stroke();
  g.restore();
}
function flash(g, x, y, k) {
  if (k <= 0 || k >= 1) return;
  g.strokeStyle = `rgba(255,170,0,${1 - k})`; g.lineWidth = 6;
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, r0 = 50 + k * 20, r1 = 66 + k * 30; g.beginPath(); g.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); g.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1); g.stroke(); }
}
function drawRacketDemo(g, t) {
  // 0–0.8 juntar · 0.8–1.6 separar (línea) → raqueta · 2.8–3.5 juntar · 3.6–4.4 separar → desaparece
  const y = 230, near = [158, 242], far = [85, 315];
  let ins = seg(t, 0, 0.8) - seg(t, 0.8, 1.6) + seg(t, 2.8, 3.5) - seg(t, 3.6, 4.4);
  const lx = lerpN(far[0], near[0], ins), rx = lerpN(far[1], near[1], ins);
  const pulling = (t > 0.8 && t < 1.6) || (t > 3.6 && t < 4.4);
  if (pulling) {                                                                  // línea luminosa entre los puños
    g.save(); g.shadowColor = HOW_RK; g.shadowBlur = 18; g.strokeStyle = HOW_RK; g.lineWidth = 8;
    g.beginPath(); g.moveTo(lx + 40, y - 10); g.lineTo(rx - 40, y - 10); g.stroke(); g.restore();
  }
  const show = seg(t, 1.45, 1.75) * (1 - seg(t, 3.7, 4.0));
  racketPic(g, rx, y, show);
  if (t > 3.7 && t < 4.2) {                                                       // "puf" al guardarla
    const k = seg(t, 3.7, 4.2); g.fillStyle = `rgba(23,184,255,${0.5 * (1 - k)})`;
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; g.beginPath(); g.arc(rx + Math.cos(a) * 60 * k, y - 160 + Math.sin(a) * 60 * k, 9 * (1 - k) + 2, 0, 7); g.fill(); }
  }
  fist(g, lx, y, -1); fist(g, rx, y, 1);
  flash(g, 200, y - 5, (t - 0.75) / 0.35); flash(g, 200, y - 5, (t - 3.45) / 0.35);
}
const howto = makePanel(0.62, 0.3);
howto.c.width = 1240; howto.c.height = 600;   // resolución moderada: se redibuja animado
let howtoUntil = 0, howtoT0 = 0, howtoLast = -1;
function drawHowto(t) {
  const { g, c } = howto, W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.82)'; g.beginPath(); g.roundRect(2, 2, W - 4, H - 4, H * 0.12); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.07)'; g.lineWidth = 2; g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 3; g.beginPath(); g.moveTo(W / 2, H * 0.12); g.lineTo(W / 2, H * 0.88); g.stroke();
  const s = Math.min((W / 2) / 420, H / 330);
  for (const [i, fn, period] of [[0, drawGrab, 3.6], [1, drawRacketDemo, 4.8]]) {
    g.save(); g.beginPath(); g.rect(i * W / 2, 0, W / 2, H); g.clip();
    g.translate(i * W / 2 + (W / 2 - 400 * s) / 2, (H - 330 * s) / 2); g.scale(s, s);
    fn(g, t % period);
    g.restore();
  }
  howto.tex.needsUpdate = true;
}
function showHowto(secs) { howto.mesh.visible = true; howtoUntil = now + secs; howtoT0 = now; info.mesh.visible = false; drawHowto(0); }
function updateHowto() { if (howto.mesh.visible && now - howtoLast > 1 / 24) { howtoLast = now; drawHowto(now - howtoT0); } }
let infoUntil = 0;
function showInfo(lines, secs = 4) { if (howto.mesh.visible && now < howtoUntil) return; drawPanel(info, lines); info.mesh.visible = true; infoUntil = secs ? now + secs : Infinity; }

const floaters = []; // "+puntos"
function floatText(txt, pos, color, big = false) {
  const W = big ? 768 : 256, c = document.createElement('canvas'); c.width = W; c.height = 128;
  const g = c.getContext('2d'); g.font = '900 84px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(txt, W / 2, 64);
  g.fillStyle = '#' + new THREE.Color(color).getHexString(); g.fillText(txt, W / 2, 64);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(big ? 0.48 : 0.16, 0.08), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  m.renderOrder = 21; m.position.copy(pos); scene.add(m); floaters.push({ m, t: 0 });
}

// ---------- Partículas ----------
const bursts = [];
function burst(pos, color, r) {
  const n = 36, geo = new THREE.BufferGeometry(), p = new Float32Array(n * 3), v = [];
  for (let i = 0; i < n; i++) {
    const d = new THREE.Vector3().randomDirection();
    p.set([pos.x + d.x * r, pos.y + d.y * r, pos.z + d.z * r], i * 3);
    v.push(d.multiplyScalar(rnd(0.8, 2.2)));
  }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const mat = new THREE.PointsMaterial({ color, size: 0.018, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(geo, mat); scene.add(pts); bursts.push({ pts, v, t: 0 });
}

// ---------- Geometría del mundo real ----------
// Planos detectados (XRPlane) y mallas de la escena (XRMesh) → colisionadores + visual de escaneo + oclusores
const scanUniforms = { uO: { value: new THREE.Vector3() }, uR: { value: 0 }, uA: { value: 1 } };
function scanMat(color, fill) {
  return new THREE.ShaderMaterial({
    uniforms: { ...scanUniforms, uC: { value: new THREE.Color(color) }, uF: { value: fill } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 uO,uC; uniform float uR,uA,uF; varying vec3 vW;
      void main(){ float d=distance(vW,uO);
        float front=smoothstep(uR-0.5,uR,d)*(1.-smoothstep(uR,uR+0.04,d));
        float behind=(1.-step(uR,d))*uF;
        float a=(front*(0.4+uF*2.)+behind)*uA; if(a<0.003) discard;
        gl_FragColor=vec4(mix(uC,vec3(1.),front*.7),a); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
}
// Oclusor: escribe solo profundidad y se empuja 4 cm hacia atrás (en la dirección de la vista),
// así las bolas apoyadas en el suelo o en una mesa no quedan tapadas por la propia superficie
// (la malla del escaneo tiene unos centímetros de error); sí se ocultan detrás de muebles y paredes.
const OCC_PUSH = 0.04;
const occluderMat = new THREE.ShaderMaterial({
  vertexShader: `void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); mv.xyz += normalize(mv.xyz)*${OCC_PUSH.toFixed(3)}; gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `void main(){ gl_FragColor = vec4(0.); }`,
  colorWrite: false, side: THREE.DoubleSide,
});
const LABEL_COLOR = { floor: 0x37e6ff, wall: 0x6f7dff, ceiling: 0x9a6bff, table: 0x3bf08a, couch: 0xffb13b, bed: 0xffb13b, screen: 0xff4fa8 };

const planes = new Map();   // XRPlane → datos
const meshes = new Map();   // XRMesh → datos
let colPlanes = [];         // lista plana para la física
let virtualPlanes = [];     // sala virtual si no hay escaneo
let tris = new Float32Array(0), triN = new Float32Array(0), grid = new Map(), triStamp = new Uint32Array(0), stampId = 1;
const roomMin = new THREE.Vector3(), roomMax = new THREE.Vector3(); let roomValid = false;
let floorY = 0, ceilY = 2.5, worldDirty = false, virtualRoom = false, occlusionOn = false;

const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _q = new THREE.Quaternion();
function poseMatrix(pose, out) {
  const p = pose.transform.position, o = pose.transform.orientation;
  return out.compose(_v.set(p.x, p.y, p.z), _q.set(o.x, o.y, o.z, o.w), new THREE.Vector3(1, 1, 1));
}
function polyArea(poly) { let a = 0; for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) a += (poly[j] * poly[i + 1] - poly[i] * poly[j + 1]); return Math.abs(a / 2); }
function inPoly(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], zi = poly[i + 1], xj = poly[j], zj = poly[j + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function updateWorld(frame, ref) {
  // --- planos ---
  const dp = frame.detectedPlanes;
  if (dp) {
    for (const [p, d] of planes) if (!dp.has(p)) { scene.remove(d.vis, d.occ); planes.delete(p); worldDirty = true; }
    for (const p of dp) {
      const pose = frame.getPose(p.planeSpace, ref); if (!pose) continue;
      let d = planes.get(p);
      if (!d) { d = { t: -1, mat: new THREE.Matrix4(), inv: new THREE.Matrix4(), n: new THREE.Vector3() }; planes.set(p, d); }
      poseMatrix(pose, d.mat); d.inv.copy(d.mat).invert();
      d.n.set(0, 1, 0).transformDirection(d.mat);
      if (d.t !== p.lastChangedTime) {
        d.t = p.lastChangedTime; worldDirty = true;
        d.poly = new Float32Array(p.polygon.flatMap(q => [q.x, q.z]));
        d.area = polyArea(d.poly); d.label = (p.semanticLabel || '').toLowerCase();
        const contour = []; for (let i = 0; i < d.poly.length; i += 2) contour.push(new THREE.Vector2(d.poly[i], d.poly[i + 1]));
        const idx = THREE.ShapeUtils.triangulateShape(contour, []).flat();
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(contour.flatMap(v => [v.x, 0, v.y])), 3));
        geo.setIndex(idx);
        if (d.vis) { scene.remove(d.vis, d.occ); d.vis.geometry.dispose(); }
        d.vis = new THREE.Mesh(geo, scanMat(LABEL_COLOR[d.label] ?? 0x37e6ff, 0.12));
        d.occ = new THREE.Mesh(geo, occluderMat); d.occ.renderOrder = -1;
        for (const o of [d.vis, d.occ]) { o.matrixAutoUpdate = false; scene.add(o); }
        d.vis.visible = scanVisible; d.occ.visible = occlusionOn && meshes.size === 0;
      }
      d.vis.matrix.copy(d.mat); d.occ.matrix.copy(d.mat);
    }
  }
  // --- mallas (Quest 3: malla de la habitación de la Configuración del espacio) ---
  const dm = frame.detectedMeshes;
  if (dm) {
    for (const [m, d] of meshes) if (!dm.has(m)) { scene.remove(d.wire, d.occ); meshes.delete(m); worldDirty = true; }
    for (const m of dm) {
      let d = meshes.get(m);
      if (d && d.t === m.lastChangedTime) continue;
      const pose = frame.getPose(m.meshSpace, ref); if (!pose) continue;
      if (!d) { d = { t: -1 }; meshes.set(m, d); }
      d.t = m.lastChangedTime; worldDirty = true;
      poseMatrix(pose, _m);
      const v = m.vertices, w = new Float32Array(v.length);
      for (let i = 0; i < v.length; i += 3) { _v.set(v[i], v[i + 1], v[i + 2]).applyMatrix4(_m); w[i] = _v.x; w[i + 1] = _v.y; w[i + 2] = _v.z; }
      d.pos = w; d.idx = m.indices; d.label = (m.semanticLabel || '').toLowerCase();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(w, 3)); geo.setIndex(new THREE.BufferAttribute(new Uint32Array(m.indices), 1));
      if (d.wire) { scene.remove(d.wire, d.occ); d.wire.geometry.dispose(); d.occ.geometry.dispose(); }
      d.wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo), scanMat(LABEL_COLOR[d.label] ?? 0x37e6ff, 0.05));
      d.occ = new THREE.Mesh(geo, occluderMat); d.occ.renderOrder = -1;
      d.wire.visible = scanVisible; d.occ.visible = occlusionOn;
      scene.add(d.wire, d.occ);
    }
  }
  if (worldDirty) rebuildColliders();
}

const _flipZ = new THREE.Matrix4().makeRotationZ(Math.PI);
function rebuildColliders() {
  worldDirty = false;
  colPlanes = [...virtualPlanes];
  let fy = Infinity, cy = -Infinity; const floorTriY = [];
  for (const d of planes.values()) {
    const up = d.n.y > 0.8, down = d.n.y < -0.8, y = d.mat.elements[13];
    let mat = d.mat, inv = d.inv, n = d.n, poly = d.poly;
    // La Quest da algunas paredes con la normal hacia fuera de la habitación: se giran para que
    // miren hacia dentro (hacia el jugador). Giro de 180° sobre el eje Z local: x→-x, y→-y.
    if (Math.abs(d.n.y) < 0.3 && _v.setFromMatrixPosition(d.mat).sub(headPos).negate().dot(d.n) < 0) {
      mat = d.mat.clone().multiply(_flipZ); inv = mat.clone().invert(); n = d.n.clone().negate();
      poly = new Float32Array(d.poly); for (let i = 0; i < poly.length; i += 2) poly[i] = -poly[i];
    }
    colPlanes.push({ mat, inv, n, poly, area: d.area, label: d.label, up, down,
      wall: Math.abs(n.y) < 0.3 && (d.label === 'wall' || d.label === '') });
    if (up && (d.label === 'floor' || d.area > 2)) fy = Math.min(fy, y);
    if (down || d.label === 'ceiling') cy = Math.max(cy, y);
  }
  // triángulos de todas las mallas + rejilla espacial
  let nt = 0; for (const d of meshes.values()) nt += d.idx.length / 3;
  tris = new Float32Array(nt * 9); triN = new Float32Array(nt * 3); triStamp = new Uint32Array(nt); grid = new Map();
  roomMin.set(Infinity, Infinity, Infinity); roomMax.set(-Infinity, -Infinity, -Infinity); let meshTop = -Infinity;
  let k = 0;
  for (const d of meshes.values()) {
    const P = d.pos, I = d.idx;
    for (let i = 0; i < I.length; i += 3, k++) {
      let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
      for (let j = 0; j < 3; j++) {
        const o = I[i + j] * 3, x = P[o], y = P[o + 1], z = P[o + 2];
        tris[k * 9 + j * 3] = x; tris[k * 9 + j * 3 + 1] = y; tris[k * 9 + j * 3 + 2] = z;
        mnx = Math.min(mnx, x); mny = Math.min(mny, y); mnz = Math.min(mnz, z); mxx = Math.max(mxx, x); mxy = Math.max(mxy, y); mxz = Math.max(mxz, z);
      }
      roomMin.min(_v.set(mnx, mny, mnz)); roomMax.max(_v.set(mxx, mxy, mxz)); meshTop = Math.max(meshTop, mxy);
      // triángulos horizontales bajos → candidatos a suelo (la mediana evita el ruido del escaneo)
      const o = k * 9, ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2],
        vx = tris[o + 6] - tris[o], vy = tris[o + 7] - tris[o + 1], vz = tris[o + 8] - tris[o + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz);
      if (nl > 1e-12) { triN[k * 3] = nx / nl; triN[k * 3 + 1] = ny / nl; triN[k * 3 + 2] = nz / nl; }
      const cyT = (tris[o + 1] + tris[o + 4] + tris[o + 7]) / 3;
      if (nl > 1e-9 && Math.abs(ny / nl) > 0.95 && cyT < 0.4) floorTriY.push(cyT);
      for (let ix = Math.floor(mnx / CELL); ix <= Math.floor(mxx / CELL); ix++)
        for (let iy = Math.floor(mny / CELL); iy <= Math.floor(mxy / CELL); iy++)
          for (let iz = Math.floor(mnz / CELL); iz <= Math.floor(mxz / CELL); iz++) {
            const key = cellKey(ix, iy, iz); let a = grid.get(key); if (!a) grid.set(key, a = []); a.push(k);
          }
    }
  }
  if (fy === Infinity && floorTriY.length > 20) { floorTriY.sort((a, b) => a - b); fy = floorTriY[floorTriY.length >> 1]; }
  if (fy !== Infinity) floorY = fy > 0.6 ? 0 : fy;   // una malla de mesa no cuenta como suelo
  console.log('[bolas] suelo y =', floorY.toFixed(3), '· planos', planes.size, '· triángulos', nt);
  if (cy !== -Infinity) ceilY = cy;
  else if (meshTop > floorY + 1.8) ceilY = Math.min(meshTop, floorY + 3.5);
  else ceilY = floorY + 2.5;
  // caja de la habitación (seguridad anti-fugas): de la malla o de las paredes detectadas
  for (const d of planes.values()) if (Math.abs(d.n.y) < 0.3 && d.poly)
    for (let i = 0; i < d.poly.length; i += 2) { _v.set(d.poly[i], 0, d.poly[i + 1]).applyMatrix4(d.mat); roomMin.min(_v); roomMax.max(_v); }
  for (const P of virtualPlanes) if (Math.abs(P.n.y) < 0.3) { _v.setFromMatrixPosition(P.mat); roomMin.min(_v); roomMax.max(_v); }
  roomValid = isFinite(roomMin.x) && roomMax.x - roomMin.x > 1 && roomMax.z - roomMin.z > 1;
  if (roomValid) { roomMin.x -= 0.03; roomMin.z -= 0.03; roomMax.x += 0.03; roomMax.z += 0.03; }
}
const cellKey = (x, y, z) => (x + 512) + (y + 512) * 1024 + (z + 512) * 1048576;

function setupVirtualRoom(head) {
  // Sin geometría detectada: suelo en y=0 y una caja de 5×5 m alrededor del jugador
  virtualRoom = true; floorY = 0; ceilY = 2.6;
  const mk = (pos, nrm) => {
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm);
    mat.compose(pos, q, new THREE.Vector3(1, 1, 1));
    return { mat, inv: mat.clone().invert(), n: nrm.clone(), poly: null, area: 25, label: 'virtual', up: nrm.y > 0.8, down: false, wall: Math.abs(nrm.y) < 0.3 };
  };
  const c = new THREE.Vector3(head.x, 0, head.z);
  virtualPlanes.push(mk(c.clone(), new THREE.Vector3(0, 1, 0)));
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) virtualPlanes.push(mk(c.clone().add(new THREE.Vector3(dx * 2.5, 0, dz * 2.5)), new THREE.Vector3(-dx, 0, -dz)));
}

// Punto más cercano de un triángulo (Ericson, RTCD 5.1.5)
let cpx = 0, cpy = 0, cpz = 0;
function closestPtTri(px, py, pz, o) {
  const T = tris;
  const ax = T[o], ay = T[o + 1], az = T[o + 2], bx = T[o + 3], by = T[o + 4], bz = T[o + 5], cx = T[o + 6], cy = T[o + 7], cz = T[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { cpx = ax; cpy = ay; cpz = az; return; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { cpx = bx; cpy = by; cpz = bz; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); cpx = ax + v * abx; cpy = ay + v * aby; cpz = az + v * abz; return; }
  const qx = px - cx, qy = py - cy, qz = pz - cz;
  const d5 = abx * qx + aby * qy + abz * qz, d6 = acx * qx + acy * qy + acz * qz;
  if (d6 >= 0 && d5 <= d6) { cpx = cx; cpy = cy; cpz = cz; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); cpx = ax + w * acx; cpy = ay + w * acy; cpz = az + w * acz; return; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); cpx = bx + w * (cx - bx); cpy = by + w * (cy - by); cpz = bz + w * (cz - bz); return; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  cpx = ax + abx * v + acx * w; cpy = ay + aby * v + acy * w; cpz = az + abz * v + acz * w;
}


// ---------- Bolas ----------
const balls = [];
const ballGeo = new THREE.SphereGeometry(1, 40, 24);
let now = 0, score = 0;
const V = () => new THREE.Vector3();

function makeBall(t, r, pos, vel) {
  const mesh = new THREE.Mesh(ballGeo, TYPES[t].mat);
  mesh.position.copy(pos); mesh.quaternion.random(); mesh.scale.setScalar(0.001); scene.add(mesh);
  const sh = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  sh.renderOrder = 1; scene.add(sh);
  const b = { mesh, sh, t, r, m: r * r * r, pos: mesh.position, prev: pos.clone(), vel: vel ? vel.clone() : V(),
    w: new THREE.Vector3(rnd(-4, 4), rnd(-4, 4), rnd(-4, 4)), cn: V(), contact: false,
    held: null, qRel: new THREE.Quaternion(), snapFrom: V(), thrownAt: -99, level: 1, grow: 0, lastSnd: 0,
    alive: true, sleep: false, sleepT: 0 };
  balls.push(b); return b;
}
function wake(b) { b.sleep = false; b.sleepT = 0; }
function removeBall(b) {
  b.alive = false; scene.remove(b.mesh, b.sh); b.sh.material.dispose();
  const i = balls.indexOf(b); if (i >= 0) balls.splice(i, 1);
  for (const h of Object.values(hands)) if (h.ball === b) h.ball = null;
  for (const o of balls) if (o.pos.distanceTo(b.pos) < o.r + b.r + 0.08) wake(o);   // pierden el apoyo
}

// ---------- Lluvia de bolas desde el techo ----------
const drops = [];
let nextDrop = Infinity;
const ringGeo = new THREE.RingGeometry(0.05, 0.075, 40).rotateX(Math.PI / 2);
function dropPoint(head) {
  const floors = colPlanes.filter(p => p.up && p.poly && Math.abs(p.mat.elements[13] - floorY) < 0.15);
  for (let tries = 0; tries < 40; tries++) {
    let x, z;
    if (floors.length) {
      const P = floors[Math.floor(Math.random() * floors.length)];
      let mnx = 1e9, mnz = 1e9, mxx = -1e9, mxz = -1e9;
      for (let i = 0; i < P.poly.length; i += 2) { mnx = Math.min(mnx, P.poly[i]); mxx = Math.max(mxx, P.poly[i]); mnz = Math.min(mnz, P.poly[i + 1]); mxz = Math.max(mxz, P.poly[i + 1]); }
      const lx = rnd(mnx, mxx), lz = rnd(mnz, mxz); if (!inPoly(P.poly, lx, lz)) continue;
      const w = new THREE.Vector3(lx, 0, lz).applyMatrix4(P.mat); x = w.x; z = w.z;
    } else {
      const a = rnd(0, Math.PI * 2), d = rnd(0.4, 2.2); x = head.x + Math.cos(a) * d; z = head.z + Math.sin(a) * d;
    }
    const hd = Math.hypot(x - head.x, z - head.z);
    if (hd > 2.6 || hd < 0.35) continue;
    if (roomValid && (x < roomMin.x + 0.15 || x > roomMax.x - 0.15 || z < roomMin.z + 0.15 || z > roomMax.z - 0.15)) continue;
    return new THREE.Vector3(x, ceilY - 0.02, z);
  }
  const a = rnd(0, Math.PI * 2), d = rnd(0.5, 1.5);
  return new THREE.Vector3(head.x + Math.cos(a) * d, ceilY - 0.02, head.z + Math.sin(a) * d);
}
function queueDrop(at, t) { drops.push({ at, t: t ?? Math.floor(Math.random() * TYPES.length), pos: null, ring: null }); }
function updateDrops(head) {
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    if (!d.pos && now >= d.at - 0.45) {   // aviso: un anillo de luz en el techo
      d.pos = dropPoint(head);
      d.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: TYPE_COLORS[d.t], transparent: true, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      d.ring.renderOrder = 12; d.ring.position.copy(d.pos); scene.add(d.ring);
    }
    if (d.ring) { const k = 1 - Math.max(0, d.at - now) / 0.45; d.ring.scale.setScalar(0.3 + k); d.ring.material.opacity = 0.9 * (1 - k * 0.5); }
    if (now >= d.at && d.pos) {
      const r = BALL_R * rnd(0.88, 1.12), p = d.pos.clone(); p.y = ceilY - r - 0.03;
      makeBall(d.t, r, p, new THREE.Vector3(rnd(-0.2, 0.2), -0.3, rnd(-0.2, 0.2)));
      sndDrop(p); scene.remove(d.ring); d.ring.material.dispose(); drops.splice(i, 1);
    }
  }
  if (now > nextDrop) {
    if (balls.length + drops.length < MAX_BALLS) queueDrop(now + 0.5);
    nextDrop = now + rnd(DROP_MIN, DROP_MAX);
  }
}

// ---------- Manos y mandos ----------
const hands = {};   // 'left' / 'right'
const _bx = V(), _by = V(), _bz = V(), _bm = new THREE.Matrix4();
function basisQuat(f, n, out) {   // Y = hacia los dedos, Z = normal de la palma, X = Y × Z
  _bx.crossVectors(f, n).normalize(); _bz.copy(n).normalize(); _by.crossVectors(_bz, _bx);
  return out.setFromRotationMatrix(_bm.makeBasis(_bx, _by, _bz));
}
function handState(key) {
  if (!hands[key]) {
    const cur = new THREE.Mesh(new THREE.SphereGeometry(0.007, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: false }));
    cur.renderOrder = 15; scene.add(cur);
    const halo = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(halo);
    hands[key] = { key, ok: false, isCtrl: false, raw: false, prevRaw: false, mode: '', pinch: 1, fist: 1,
      palm: V(), q: new THREE.Quaternion(), qInit: false, wrist: null, hist: [], cols: null, colPts: [], colActive: false,
      ball: null, snap: 1, closedAt: -9, openSince: 0, lv: null, av: null, src: null, cur, halo, lastThrow: 0 };
  }
  return hands[key];
}
const J = (frame, src, name, ref) => { const j = src.hand.get(name); const p = j && frame.getJointPose(j, ref); return p ? new THREE.Vector3(p.transform.position.x, p.transform.position.y, p.transform.position.z) : null; };
const _qn = new THREE.Quaternion();

function readInput(frame, ref, src, H) {
  if (src.hand) {
    const wr = J(frame, src, 'wrist', ref), th = J(frame, src, 'thumb-tip', ref), ix = J(frame, src, 'index-finger-tip', ref),
      md = J(frame, src, 'middle-finger-tip', ref), rg = J(frame, src, 'ring-finger-tip', ref), pk = J(frame, src, 'pinky-finger-tip', ref),
      ixk = J(frame, src, 'index-finger-phalanx-proximal', ref), mdk = J(frame, src, 'middle-finger-phalanx-proximal', ref),
      pkk = J(frame, src, 'pinky-finger-phalanx-proximal', ref);
    if (!(wr && th && ix && md && rg && pk && ixk && mdk && pkk)) return false;
    H.isCtrl = false; H.lv = H.av = null;
    H.palm.copy(wr).lerp(mdk, 0.55);
    const f = V().subVectors(mdk, wr).normalize();
    const n = V().crossVectors(V().subVectors(ixk, wr), V().subVectors(pkk, wr)).multiplyScalar(H.key === 'left' ? -1 : 1);
    n.addScaledVector(f, -n.dot(f)).normalize();
    basisQuat(f, n, _qn);
    if (H.qInit) H.q.slerp(_qn, 0.6); else { H.q.copy(_qn); H.qInit = true; }
    H.pinch = th.distanceTo(ix);
    H.fist = (ix.distanceTo(H.palm) + md.distanceTo(H.palm) + rg.distanceTo(H.palm) + pk.distanceTo(H.palm)) / 4;
    if (!H.raw) {
      if (H.pinch < PINCH_ON) { H.raw = true; H.mode = 'pinza'; }
      else if (H.fist < FIST_ON) { H.raw = true; H.mode = 'puño'; }
    } else H.raw = H.pinch < PINCH_OFF || H.fist < FIST_OFF;
    H.wrist = wr;
    H.colPts = [[H.palm, 0.035], [ix, 0.011], [md, 0.011], [rg, 0.011], [pk, 0.010], [th, 0.012]];
    H.colActive = !H.raw && !H.ball && rk.holder !== H && H.pinch > 0.05;
    return true;
  }
  if (src.gripSpace) {
    const p = frame.getPose(src.gripSpace, ref); if (!p) return false;
    const t = p.transform.position, o = p.transform.orientation;
    H.isCtrl = true; H.palm.set(t.x, t.y, t.z);
    const qg = new THREE.Quaternion(o.x, o.y, o.z, o.w);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(qg), n = new THREE.Vector3(H.key === 'right' ? -1 : 1, 0, 0).applyQuaternion(qg);
    basisQuat(f, n, H.q); H.qInit = true;
    H.lv = p.linearVelocity ? new THREE.Vector3(p.linearVelocity.x, p.linearVelocity.y, p.linearVelocity.z) : null;
    H.av = p.angularVelocity ? new THREE.Vector3(p.angularVelocity.x, p.angularVelocity.y, p.angularVelocity.z) : null;
    const bt = src.gamepad?.buttons || [];
    H.raw = !!(bt[1]?.pressed || bt[0]?.pressed); H.mode = 'botón';
    H.wrist = H.palm.clone();
    H.colPts = [[H.palm, 0.04]];
    H.colActive = !H.raw && !H.ball && rk.holder !== H;
    return true;
  }
  return false;
}
function holdLocal(H, r, out) {   // la bola queda dentro de la mano, apoyada en la palma
  return H.isCtrl ? out.set(0, 0.02, r * 0.75 + 0.02) : out.set(0, 0.015, r * 0.85 + 0.008);
}
function holdWorld(H, r, out) { return holdLocal(H, r, out).applyQuaternion(H.q).add(H.palm); }
function pulse(H, k, ms) { H.src?.gamepad?.hapticActuators?.[0]?.pulse?.(k, ms); }

function updateHands(frame, ref, dt) {
  const seen = new Set();
  for (const src of frame.session.inputSources) {
    if (src.targetRayMode !== 'tracked-pointer' || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
    const H = handState(src.handedness); H.src = src;
    H.ok = readInput(frame, ref, src, H);
    if (!H.ok) continue;
    seen.add(H.key);
    // colisionadores de la mano (con velocidad respecto al frame anterior)
    const prev = H.cols || [];
    H.cols = H.colPts.map(([p, r], i) => ({ p: p.clone(), r,
      v: H.isCtrl && H.lv ? H.lv.clone() : prev[i] ? p.clone().sub(prev[i].p).divideScalar(Math.max(dt, 1e-3)) : V() }));
    H.hist.push({ t: now, p: H.palm.clone(), q: H.q.clone() }); while (H.hist.length && now - H.hist[0].t > 0.35) H.hist.shift();

    if (H.raw && !H.prevRaw) H.closedAt = now;
    if (!H.raw) { if (!H.openSince) H.openSince = now; } else H.openSince = 0;
    H.prevRaw = H.raw;

    // bola candidata
    let best = null, bd = GRAB_REACH;
    if (!H.ball && rk.holder !== H) {
      const hp = holdWorld(H, BALL_R, V()), pts = [hp, ...H.colPts.map(c => c[0])];
      for (const b of balls) {
        if (b.held) continue;
        for (const q of pts) { const d = b.pos.distanceTo(q) - b.r; if (d < bd) { bd = d; best = b; } }
      }
    }
    if (!H.ball && best && H.raw && now - H.closedAt < GRAB_GRACE) grab(H, best);
    else if (H.ball && !H.raw) release(H);          // instantáneo: en el primer frame con la mano abierta

    const hp = holdWorld(H, H.ball ? H.ball.r : BALL_R, V());
    H.cur.visible = rk.holder !== H; H.cur.position.copy(hp);
    H.cur.material.color.set(H.ball ? 0x3bf08a : H.raw ? 0xffd23a : 0xffffff);
    H.halo.visible = !!best && !H.ball;
    if (best) { H.halo.position.copy(best.pos); H.halo.scale.setScalar(best.r * 1.18); H.halo.material.color.set(TYPE_COLORS[best.t]); }
  }
  for (const H of Object.values(hands)) if (!seen.has(H.key)) {
    if (H.ok && H.ball) release(H);
    H.ok = false; H.raw = H.prevRaw = false; H.cols = null; H.qInit = false; H.hist = [];
    H.cur.visible = false; H.halo.visible = false;
  }
}

function grab(H, b) {
  H.ball = b; b.held = H; wake(b); H.snap = 0; b.snapFrom.copy(b.pos); H.bh = [];
  b.qRel.copy(H.q).invert().multiply(b.mesh.quaternion);   // así la bola gira igual que la mano
  sndGrab(b.pos); pulse(H, 0.4, 40);
}
// Velocidad lineal y angular de la mano entre t0 y t1 (regresión lineal; giro entre la primera y la última muestra)
function handMotion(H, t0, t1) {
  let s = H.hist.filter(x => x.t >= t0 && x.t <= t1);
  if (s.length < 3) s = H.hist.slice(-4);
  const lv = V(), av = V();
  if (s.length < 2) return { lv, av };
  let tm = 0; const pm = V();
  for (const x of s) { tm += x.t; pm.add(x.p); } tm /= s.length; pm.divideScalar(s.length);
  let den = 0; for (const x of s) { const dt = x.t - tm; den += dt * dt; lv.addScaledVector(_l.subVectors(x.p, pm), dt); }
  if (den > 1e-9) lv.divideScalar(den); else lv.set(0, 0, 0);
  const a = s[0], z = s[s.length - 1], T = z.t - a.t;
  if (T > 1e-3) {
    const dq = z.q.clone().multiply(a.q.clone().invert()); if (dq.w < 0) { dq.x *= -1; dq.y *= -1; dq.z *= -1; dq.w *= -1; }
    const ang = 2 * Math.acos(Math.min(1, dq.w)), sn = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
    if (sn > 1e-5) av.set(dq.x / sn, dq.y / sn, dq.z / sn).multiplyScalar(ang / T);
  }
  return { lv, av };
}
// velocidad suavizada (3 muestras ≈ 35 ms) del centro de la bola en la mano
function ballVelAt(bh, i, out) {
  if (i < 1) return out.set(0, 0, 0);
  const a = bh[Math.max(0, i - 3)], z = bh[i];
  return out.subVectors(z.p, a.p).divideScalar(Math.max(z.t - a.t, 1e-3));
}
const _bv = new THREE.Vector3();
function ballSpeedAt(bh, i) { return bh && i >= 1 ? ballVelAt(bh, i, _bv).length() : 0; }
const lastThrows = [];
function release(H, drop = false) {
  const b = H.ball; H.ball = null; if (!b || !b.alive) return;
  b.held = null; b.thrownAt = now; wake(b); b.prev.copy(b.pos);
  if (drop) { b.vel.set(0, 0, 0); b.w.set(0, 0, 0); return; }
  let lv, av;
  if (H.isCtrl && H.lv) { lv = H.lv.clone(); av = H.av ? H.av.clone() : handMotion(H, now - 0.06, now).av; }
  let peak = 0;
  if (H.isCtrl) {
    const off = V().subVectors(b.pos, H.palm);
    if (!lv) ({ lv, av } = handMotion(H, now - 0.06, now));
    b.vel.copy(lv).add(V().crossVectors(av, off));   // velocidad del punto de la mano donde está la bola
  } else {
    // pico de velocidad del centro de la bola justo antes de abrir (incluye el giro de la muñeca)
    const bh = H.bh || [], v = V(); lv = V();
    for (let i = 1; i < bh.length; i++) if (now - bh[i].t <= THROW_WINDOW) { ballVelAt(bh, i, v); if (v.lengthSq() > lv.lengthSq()) lv.copy(v); }
    peak = lv.length();
    av = handMotion(H, now - 0.12, now).av;
    b.vel.copy(lv).multiplyScalar(THROW_BOOST);
  }
  if (b.vel.length() > 14) b.vel.setLength(14);
  b.w.copy(av);
  H.lastThrow = b.vel.length();
  lastThrows.push({ t: +now.toFixed(2), mano: H.key, v: +H.lastThrow.toFixed(2), giro: +av.length().toFixed(1), modo: H.mode, pico: +peak.toFixed(2), muestras: (H.bh || []).length });
  if (lastThrows.length > 20) lastThrows.shift();
}
// Mover la bola cogida: sigue la posición y el giro de la mano, sin atravesar superficies
function updateHeld(dt) {
  for (const H of Object.values(hands)) {
    const b = H.ball; if (!b || !H.ok) continue;
    const target = holdWorld(H, b.r, V());
    if (H.snap < 1) { H.snap = Math.min(1, H.snap + dt / SNAP_TIME); const k = 1 - (1 - H.snap) ** 3; target.lerpVectors(b.snapFrom, target, k); }
    const old = b.pos.clone(), delta = V().subVectors(target, b.pos);
    const steps = Math.min(12, Math.max(1, Math.ceil(delta.length() / (0.3 * b.r))));
    delta.divideScalar(steps);
    for (let i = 0; i < steps; i++) { b.prev.copy(b.pos); b.pos.add(delta); collideWorld(b, 0, true); }
    b.vel.subVectors(b.pos, old).divideScalar(Math.max(dt, 1e-3));
    b.mesh.quaternion.copy(H.q).multiply(b.qRel);
    { const pv = b.prev.clone(); b.prev.copy(old); checkGoals(b); b.prev.copy(pv); }   // mate: meterla con la mano
    H.bh.push({ t: now, p: target.clone() }); while (H.bh.length && now - H.bh[0].t > 0.4) H.bh.shift();
    if (b.pos.distanceTo(target) > 0.45) release(H, true);   // la mano se ha metido en una pared: se suelta
  }
}

// ---------- Raqueta ----------
const rk = { holder: null, valid: false, p0: V(), p1: V(), q0: new THREE.Quaternion(), q1: new THREE.Quaternion(),
  M0: new THREE.Matrix4(), M1: new THREE.Matrix4(), group: new THREE.Group() };
(function buildRacket() {
  const g = rk.group, frameMat = new THREE.MeshStandardMaterial({ color: 0x17d4ff, emissive: 0x0a6a90, emissiveIntensity: 0.8, metalness: 0.3, roughness: 0.35 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.07, 10, 64), frameMat);
  ring.scale.set(RK.ax, RK.ay, RK.ax); ring.position.y = RK.hy; g.add(ring);
  const face = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
  face.scale.set(RK.ax, RK.ay, 1); face.position.y = RK.hy; g.add(face);
  const pts = [];
  for (let x = -RK.ax + 0.016; x < RK.ax; x += 0.019) { const h = RK.ay * Math.sqrt(Math.max(0, 1 - (x / RK.ax) ** 2)); pts.push(x, RK.hy - h, 0, x, RK.hy + h, 0); }
  for (let y = -RK.ay + 0.016; y < RK.ay; y += 0.019) { const w = RK.ax * Math.sqrt(Math.max(0, 1 - (y / RK.ay) ** 2)); pts.push(-w, RK.hy + y, 0, w, RK.hy + y, 0); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: 0xf4fbff, transparent: true, opacity: 0.75 })));
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.2, 16), new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.8 }));
  handle.position.y = 0.04; g.add(handle);
  const throat = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, RK.hy - RK.ay - 0.14, 10), frameMat);
  throat.position.y = 0.14 + (RK.hy - RK.ay - 0.14) / 2; g.add(throat);
  g.visible = false; scene.add(g);
})();
const pullLine = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 1, 10), new THREE.MeshBasicMaterial({ color: 0x7ff4ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending }));
pullLine.visible = false; scene.add(pullLine);
const gest = { phase: 'idle', t: 0 };
const _Y = new THREE.Vector3(0, 1, 0), _one = new THREE.Vector3(1, 1, 1);

function updateRacket(dt) {
  const L = hands.left, R = hands.right, both = L && R && L.ok && R.ok;
  const dist = both ? L.palm.distanceTo(R.palm) : 9;
  // gesto: juntar los puños cerrados y separarlos
  if (gest.phase === 'idle') {
    if (both && L.raw && R.raw && !L.ball && !R.ball && dist < RACKET_TOUCH) { gest.t += dt; if (gest.t > 0.15) { gest.phase = 'armed'; sndZip(L.palm, true); } }
    else gest.t = 0;
  } else if (gest.phase === 'armed') {
    if (!both || !L.raw || !R.raw) { gest.phase = 'idle'; gest.t = 0; }
    else if (dist > RACKET_PULL) {
      if (!rk.holder) { rk.holder = R; rk.valid = false; showInfo(['¡Raqueta!', 'Junta los puños otra vez para guardarla'], 3); sndZip(R.palm, true); }
      else { rk.holder = null; sndZip(R.palm, false); }
      pulse(L, 0.6, 60); pulse(R, 0.6, 60);
      gest.phase = 'cool';
    }
  } else if (!both || !L.raw || !R.raw) { gest.phase = 'idle'; gest.t = 0; }
  // línea entre las manos mientras se estira
  pullLine.visible = gest.phase === 'armed';
  if (pullLine.visible) {
    const d = V().subVectors(R.palm, L.palm);
    pullLine.position.copy(L.palm).addScaledVector(d, 0.5);
    pullLine.quaternion.setFromUnitVectors(_Y, d.clone().normalize());
    pullLine.scale.set(1, d.length(), 1);
    pullLine.material.opacity = 0.6 + 0.4 * Math.sin(now * 30);
  }
  // seguir a la mano que la sostiene
  const H = rk.holder;
  if (H && H.ok) {
    rk.p0.copy(rk.p1); rk.q0.copy(rk.q1);
    rk.p1.copy(H.palm); rk.q1.copy(H.q);
    if (!rk.valid) { rk.p0.copy(rk.p1); rk.q0.copy(rk.q1); rk.valid = true; }
    rk.M0.compose(rk.p0, rk.q0, _one); rk.M1.compose(rk.p1, rk.q1, _one);
    rk.group.visible = true; rk.group.position.copy(rk.p1); rk.group.quaternion.copy(rk.q1);
  } else { rk.group.visible = false; rk.valid = false; }
}
function racketTipSpeed(dt) {
  if (!rk.holder || !rk.valid) return 0;
  const tip = new THREE.Vector3(0, RK.hy + RK.ay, 0);
  return tip.clone().applyMatrix4(rk.M1).distanceTo(tip.applyMatrix4(rk.M0)) / Math.max(dt, 1e-3);
}
const _rp = V(), _rq = new THREE.Quaternion(), _Ms = new THREE.Matrix4(), _Mi = new THREE.Matrix4(), _Mp = new THREE.Matrix4(),
  _lp = V(), _lpp = V(), _rz = V(), _pc = V(), _vr = V();
function racketCollide(k, n, dtFrame) {
  if (!rk.holder || !rk.valid) return;
  _rp.lerpVectors(rk.p0, rk.p1, (k + 1) / n); _rq.slerpQuaternions(rk.q0, rk.q1, (k + 1) / n);
  _Ms.compose(_rp, _rq, _one); _Mi.copy(_Ms).invert();
  _rp.lerpVectors(rk.p0, rk.p1, k / n); _rq.slerpQuaternions(rk.q0, rk.q1, k / n);
  _Mp.compose(_rp, _rq, _one).invert();
  _rz.set(0, 0, 1).transformDirection(_Ms);
  for (const b of balls) {
    if (b.held) continue;
    _lp.copy(b.pos).applyMatrix4(_Mi);
    const ex = _lp.x / (RK.ax + b.r * 0.3), ey = (_lp.y - RK.hy) / (RK.ay + b.r * 0.3);
    if (ex * ex + ey * ey > 1) continue;
    _lpp.copy(b.prev).applyMatrix4(_Mp);
    const crossed = (_lp.z > 0) !== (_lpp.z > 0);
    if (Math.abs(_lp.z) >= b.r + 0.004 && !crossed) continue;
    const side = Math.abs(_lpp.z) > 1e-5 ? Math.sign(_lpp.z) : (Math.sign(_lp.z) || 1);
    b.pos.addScaledVector(_rz, side * (b.r + 0.004) - _lp.z);
    // velocidad del punto de impacto de la raqueta
    _pc.set(_lp.x, _lp.y, 0); _vr.copy(_pc).applyMatrix4(rk.M1).sub(_pc.applyMatrix4(rk.M0)).divideScalar(Math.max(dtFrame, 1e-3));
    const nx = _rz.x * side, ny = _rz.y * side, nz = _rz.z * side;
    const rn = (b.vel.x - _vr.x) * nx + (b.vel.y - _vr.y) * ny + (b.vel.z - _vr.z) * nz;
    if (rn < 0) {
      wake(b);
      const jn = -(1 + RACKET_REST) * rn;
      b.vel.x += nx * jn; b.vel.y += ny * jn; b.vel.z += nz * jn;
      friction(b, nx, ny, nz, jn, 0.5, _vr);
      b.thrownAt = now; sndRacket(b.pos, -rn); pulse(rk.holder, Math.min(1, -rn / 5 + 0.3), 30);
    }
  }
}

// ---------- Física ----------
const mergeQ = [], _rv = V(), _rt = V(), _l2 = V(), _wc = V(), _zero = V();
// Fricción en el punto de contacto con giro: el deslizamiento se convierte en rodadura (esfera hueca, I = 2/3·m·r²)
function friction(b, nx, ny, nz, jn, mu, vs) {
  const r = b.r, v = b.vel, w = b.w;
  const rcx = -nx * r, rcy = -ny * r, rcz = -nz * r;
  let vcx = v.x + (w.y * rcz - w.z * rcy) - vs.x, vcy = v.y + (w.z * rcx - w.x * rcz) - vs.y, vcz = v.z + (w.x * rcy - w.y * rcx) - vs.z;
  const vcn = vcx * nx + vcy * ny + vcz * nz;
  vcx -= vcn * nx; vcy -= vcn * ny; vcz -= vcn * nz;
  const vtl = Math.hypot(vcx, vcy, vcz); if (vtl < 1e-6) return;
  const Jt = Math.min(vtl / 2.5, mu * jn), tx = vcx / vtl, ty = vcy / vtl, tz = vcz / vtl;
  v.x -= tx * Jt; v.y -= ty * Jt; v.z -= tz * Jt;
  const k = -Jt * 1.5 / (r * r);
  w.x += (rcy * tz - rcz * ty) * k; w.y += (rcz * tx - rcx * tz) * k; w.z += (rcx * ty - rcy * tx) * k;
}
function contact(b, nx, ny, nz, pen, h, kin) {
  b.pos.x += nx * pen; b.pos.y += ny * pen; b.pos.z += nz * pen;
  if (kin) return;
  b.contact = true; b.cn.set(nx, ny, nz);
  const v = b.vel, vn = v.x * nx + v.y * ny + v.z * nz;
  if (vn >= 0) return;
  const imp = -vn, e = imp < MIN_BOUNCE ? 0 : REST_HARD, jn = (1 + e) * imp;
  v.x += nx * jn; v.y += ny * jn; v.z += nz * jn;
  friction(b, nx, ny, nz, jn, MU, _zero);
  if (imp > 0.4) sndBounce(b, imp);
}
const _l = V(), _lq = V();
function collideWorld(b, h, kin) {
  const r = b.r, p = b.pos;
  if (b.inMatrix) { if (p.y < floorY + r) contact(b, 0, 1, 0, floorY + r - p.y, h, kin); return; }   // ya está en el mundo Matrix
  // planos: solo por su cara (si venía de detrás, no colisiona) → no se atraviesan aunque vaya rápida
  for (const P of colPlanes) {
    _l.copy(p).applyMatrix4(P.inv);
    if (_l.y >= r) continue;
    _lq.copy(b.prev).applyMatrix4(P.inv);
    if (_lq.y < -0.01) continue;
    if (P.poly && !inPoly(P.poly, _l.x, _l.z)) continue;
    if (P.wall) {
      const qx = p.x - P.n.x * _l.y, qy = p.y - P.n.y * _l.y, qz = p.z - P.n.z * _l.y;
      if (holes.length && inHole(qx, qy, qz, r * 0.6)) continue;          // cabe por el agujero
      const vn = -(b.vel.x * P.n.x + b.vel.y * P.n.y + b.vel.z * P.n.z);
      if (!kin && vn > WALL_BREAK) queueHole(P, new THREE.Vector3(qx, qy, qz), vn);
    }
    contact(b, P.n.x, P.n.y, P.n.z, r - _l.y, h, kin);
  }
  // malla de la habitación
  if (tris.length) {
    stampId++;
    const x0 = Math.floor((Math.min(p.x, b.prev.x) - r) / CELL), x1 = Math.floor((Math.max(p.x, b.prev.x) + r) / CELL),
      y0 = Math.floor((Math.min(p.y, b.prev.y) - r) / CELL), y1 = Math.floor((Math.max(p.y, b.prev.y) + r) / CELL),
      z0 = Math.floor((Math.min(p.z, b.prev.z) - r) / CELL), z1 = Math.floor((Math.max(p.z, b.prev.z) + r) / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) for (let iz = z0; iz <= z1; iz++) {
      const a = grid.get(cellKey(ix, iy, iz)); if (!a) continue;
      for (const t of a) {
        if (triStamp[t] === stampId) continue; triStamp[t] = stampId;
        closestPtTri(p.x, p.y, p.z, t * 9);
        const dx = p.x - cpx, dy = p.y - cpy, dz = p.z - cpz, d2 = dx * dx + dy * dy + dz * dz;
        const o = t * 9, tnx = triN[t * 3], tny = triN[t * 3 + 1], tnz = triN[t * 3 + 2];
        const sp = (b.prev.x - tris[o]) * tnx + (b.prev.y - tris[o + 1]) * tny + (b.prev.z - tris[o + 2]) * tnz;
        const sc = (p.x - tris[o]) * tnx + (p.y - tris[o + 1]) * tny + (p.z - tris[o + 2]) * tnz;
        if (d2 >= r * r) continue;
        if (holes.length && inHole(cpx, cpy, cpz, 0)) continue;
        if (sp * sc < 0 && Math.abs(sp) > 1e-4) {        // el centro ha cruzado el triángulo: devolverla a su lado
          const s = sp > 0 ? 1 : -1; contact(b, tnx * s, tny * s, tnz * s, r + Math.abs(sc), h, kin);
        } else {
          const d = Math.sqrt(d2);
          if (d > 1e-6) contact(b, dx / d, dy / d, dz / d, r - d, h, kin);
          else { const s = sp >= 0 ? 1 : -1; contact(b, tnx * s, tny * s, tnz * s, r, h, kin); }
        }
      }
    }
  }
  collideProps(b, h, kin);
  // suelo y caja de la habitación de seguridad
  if (p.y < floorY + r) contact(b, 0, 1, 0, floorY + r - p.y, h, kin);
  if (roomValid && !(holes.length && inHole(p.x, p.y, p.z, 0))) {
    if (p.x < roomMin.x + r) contact(b, 1, 0, 0, roomMin.x + r - p.x, h, kin);
    if (p.x > roomMax.x - r) contact(b, -1, 0, 0, p.x - roomMax.x + r, h, kin);
    if (p.z < roomMin.z + r) contact(b, 0, 0, 1, roomMin.z + r - p.z, h, kin);
    if (p.z > roomMax.z - r) contact(b, 0, 0, -1, p.z - roomMax.z + r, h, kin);
  }
  if (p.y > ceilY - r) contact(b, 0, -1, 0, p.y - ceilY + r, h, kin);
}
function canMerge(a, b) { return a.held || b.held || now - a.thrownAt < MERGE_WINDOW || now - b.thrownAt < MERGE_WINDOW; }

function substep(h, k, n, dtFrame) {
  for (const b of balls) {
    if (b.held || b.sleep || b.scored) continue;
    b.prev.copy(b.pos); b.contact = false;
    b.vel.y -= G * h;
    const sp = b.vel.length(); b.vel.multiplyScalar(Math.max(0, 1 - (DRAG_LIN + DRAG_QUAD * sp) * h));
    b.w.multiplyScalar(1 - 0.1 * h);
    b.pos.addScaledVector(b.vel, h);
    collideWorld(b, h, false);
    checkGoals(b);
    if (holes.length && !b.inMatrix) checkThroughHole(b);
    if (b.contact && b.cn.y > 0.3) {   // rodando sobre una superficie: resistencia a la rodadura y al giro sobre sí misma
      const c = b.cn, vn = b.vel.dot(c), vt = _rt.copy(b.vel).addScaledVector(c, -vn), vtl = vt.length(), dec = ROLL * h;
      const s = vtl > dec ? 1 - dec / vtl : 0;
      b.vel.copy(c).multiplyScalar(vn).addScaledVector(vt, s);
      b.w.multiplyScalar(s > 0 ? s : 0); b.w.addScaledVector(c, -b.w.dot(c) * Math.min(1, 3 * h));
    }
  }
  // mano abierta sólida: palma y yemas empujan, frenan o hacen rodar
  for (const H of Object.values(hands)) {
    if (!H.ok || !H.colActive || !H.cols) continue;
    for (const C of H.cols) for (const b of balls) {
      if (b.held) continue;
      const d = b.pos.distanceTo(C.p), rr = b.r + C.r; if (d >= rr || d < 1e-5) continue;
      const nn = _l2.subVectors(b.pos, C.p).divideScalar(d);
      b.pos.addScaledVector(nn, rr - d);
      const rv = _rv.subVectors(b.vel, C.v).dot(nn);
      if (rv < 0) {
        wake(b); const jn = -(1 + 0.5) * rv;
        b.vel.addScaledVector(nn, jn); friction(b, nn.x, nn.y, nn.z, jn, 0.8, C.v);
        if (-rv > 0.7) { b.thrownAt = now; sndBounce(b, -rv); }
      }
    }
  }
  racketCollide(k, n, dtFrame);
  // bola–bola
  for (let i = 0; i < balls.length; i++) {
    const A = balls[i];
    for (let j = i + 1; j < balls.length; j++) {
      const B = balls[j];
      if (A.sleep && B.sleep) continue;
      const dx = B.pos.x - A.pos.x, dy = B.pos.y - A.pos.y, dz = B.pos.z - A.pos.z, rr = A.r + B.r, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= rr * rr) continue;
      if (A.t === B.t && canMerge(A, B)) { mergeQ.push([A, B]); continue; }
      const ia = A.held ? 0 : 1 / A.m, ib = B.held ? 0 : 1 / B.m, s = ia + ib; if (!s) continue;
      const d = Math.sqrt(d2) || 1e-6, nx = dx / d, ny = dy / d, nz = dz / d, pen = rr - d;
      if (pen > 0.002) { wake(A); wake(B); }
      A.pos.x -= nx * pen * ia / s; A.pos.y -= ny * pen * ia / s; A.pos.z -= nz * pen * ia / s;
      B.pos.x += nx * pen * ib / s; B.pos.y += ny * pen * ib / s; B.pos.z += nz * pen * ib / s;
      const rvn = (B.vel.x - A.vel.x) * nx + (B.vel.y - A.vel.y) * ny + (B.vel.z - A.vel.z) * nz;
      if (rvn < 0) {
        wake(A); wake(B);
        const e = -rvn < MIN_BOUNCE ? 0 : REST_BALL, jn = -(1 + e) * rvn / s;
        A.vel.x -= nx * jn * ia; A.vel.y -= ny * jn * ia; A.vel.z -= nz * jn * ia;
        B.vel.x += nx * jn * ib; B.vel.y += ny * jn * ib; B.vel.z += nz * jn * ib;
        if (-rvn > 0.4) { sndBounce(A, -rvn); sndBounce(B, -rvn); }
      }
    }
  }
  // dormir las bolas paradas (estables y sin temblores)
  for (const b of balls) {
    if (b.held || b.sleep) continue;
    if (b.contact && b.vel.lengthSq() < 0.0009 && b.w.lengthSq() * b.r * b.r < 0.0009) {
      b.sleepT += h; if (b.sleepT > 0.4) { b.sleep = true; b.vel.set(0, 0, 0); b.w.set(0, 0, 0); }
    } else b.sleepT = 0;
  }
}
function doMerges() {
  for (const [A, B] of mergeQ) {
    if (!A.alive || !B.alive) continue;
    const keep = B.held && !A.held ? B : A, gone = keep === A ? B : A;
    const m = A.m + B.m;
    if (!keep.held) keep.pos.multiplyScalar(keep.m / m).addScaledVector(gone.pos, gone.m / m);
    keep.vel.multiplyScalar(keep.m / m).addScaledVector(gone.vel, gone.m / m);
    keep.r = Math.cbrt(A.r ** 3 + B.r ** 3); keep.m = keep.r ** 3; keep.level = A.level + B.level; keep.grow = 0;
    keep.thrownAt = Math.max(A.thrownAt, B.thrownAt); wake(keep);
    if (keep.held) pulse(keep.held, 0.8, 80);
    const pts = 10 * keep.level; score += pts;
    burst(keep.pos, TYPE_COLORS[keep.t], keep.r); sndMerge(keep.pos, keep.level);
    floatText('+' + pts, keep.pos.clone().add(new THREE.Vector3(0, keep.r + 0.05, 0)), TYPE_COLORS[keep.t]);
    removeBall(gone);
  }
  mergeQ.length = 0;
}
function physics(dt) {
  let vmax = 0; for (const b of balls) if (!b.held && !b.sleep) vmax = Math.max(vmax, b.vel.length());
  let hv = 0; for (const H of Object.values(hands)) if (H.ok && H.cols) for (const C of H.cols) hv = Math.max(hv, C.v.length());
  const n = Math.min(24, Math.max(2, Math.ceil(vmax * dt / 0.012), Math.ceil(hv * dt / 0.02), Math.ceil(racketTipSpeed(dt) * dt / 0.02)));
  for (let k = 0; k < n; k++) substep(dt / n, k, n, dt);
  doMerges();
}

// ---------- Visual por frame ----------
const _dq = new THREE.Quaternion(), _ax = V();
function updateBallVisuals(dt, head) {
  for (const b of [...balls]) {
    if (b.pos.y < floorY - 1.5 || b.pos.distanceTo(head) > 12) { if (b.held) release(b.held, true); removeBall(b); continue; }
    if (!b.held) {   // el giro sale de la física (rodar, efecto al lanzar)
      const wl = b.w.length();
      if (wl > 1e-4) { _dq.setFromAxisAngle(_ax.copy(b.w).divideScalar(wl), wl * dt); b.mesh.quaternion.premultiply(_dq); }
    }
    b.grow = Math.min(1, b.grow + dt * 3.5);
    const g = b.grow, s = 1 + Math.sin(g * Math.PI) * 0.25 * (1 - g);
    b.mesh.scale.setScalar(b.r * Math.min(1, g * 1.6) * s);
    // sombra sobre la superficie horizontal más cercana por debajo
    let best = Infinity, by = floorY;
    for (const P of colPlanes) {
      if (!P.up) continue;
      _l.copy(b.pos).applyMatrix4(P.inv);
      if (_l.y < -0.01 || _l.y > best) continue;
      if (P.poly && !inPoly(P.poly, _l.x, _l.z)) continue;
      best = _l.y; by = b.pos.y - _l.y;
    }
    if (best === Infinity) { best = b.pos.y - floorY; by = floorY; }
    const hgt = Math.max(0, best - b.r);
    b.sh.position.set(b.pos.x, by + 0.002, b.pos.z);
    b.sh.scale.setScalar(b.r * 2.4 * (1 + hgt * 0.8));
    b.sh.material.opacity = 0.55 * Math.max(0, 1 - hgt / 1.2) * Math.min(1, b.grow * 2);
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i]; f.t += dt; f.m.position.y += dt * 0.15; f.m.material.opacity = 1 - f.t / 1.4; f.m.lookAt(head);
    if (f.t > 1.4) { scene.remove(f.m); f.m.material.map.dispose(); f.m.material.dispose(); floaters.splice(i, 1); }
  }
  for (let i = bursts.length - 1; i >= 0; i--) {
    const B = bursts[i]; B.t += dt; const p = B.pts.geometry.attributes.position;
    for (let k = 0; k < B.v.length; k++) { B.v[k].y -= G * 0.3 * dt; p.array[k * 3] += B.v[k].x * dt; p.array[k * 3 + 1] += B.v[k].y * dt; p.array[k * 3 + 2] += B.v[k].z * dt; B.v[k].multiplyScalar(1 - 2.5 * dt); }
    p.needsUpdate = true; B.pts.material.opacity = 1 - B.t / 0.9;
    if (B.t > 0.9) { scene.remove(B.pts); B.pts.geometry.dispose(); B.pts.material.dispose(); bursts.splice(i, 1); }
  }
}

// ---------- Canastas y papelera ----------
// Son agujeros profundos: la bola que entra por arriba cae dentro, aterriza en la diana del fondo
// y puntúa según el anillo (centro 100 · 50 · 30 · 20).
const HR = 0.255, NET_H = 0.3;    // canasta de pared: radio de la boca y profundidad
const BR = 0.51, BH = 0.45;       // canasta de suelo: radio y altura
const BOTTOM_K = 0.82;            // el fondo es un poco más estrecho que la boca
const hoops = [], bins = [], swallowed = [];
const _hz = new THREE.Vector3(0, 0, 1);

// Red de cuerda naranja: rombos de cuerda trenzada con nudos, huecos transparentes
const netTex = canvasTex((g, w, h) => {
  g.clearRect(0, 0, w, h);
  const step = 64, rope = (x0, y0, x1, y1) => {
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(70,22,6,0.95)'; g.lineWidth = 12; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = '#ff7a2e'; g.lineWidth = 8; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = 'rgba(255,190,130,0.9)'; g.lineWidth = 2; g.setLineDash([5, 6]); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.setLineDash([]);
  };
  for (let x = -h; x < w + h; x += step) { rope(x, 0, x + h, h); rope(x + h, 0, x, h); }
  g.fillStyle = '#ffa060';
  for (let x = 0; x <= w; x += step) for (let y = 0; y <= h; y += step) { g.beginPath(); g.arc(x + (y / step % 2 ? step / 2 : 0), y, 8, 0, 7); g.fill(); }
}, 512, 256);
netTex.wrapT = THREE.RepeatWrapping;
// Diana del fondo
const RINGS = [[0.18, 100, '#ffd21f'], [0.42, 50, '#e8262b'], [0.7, 30, '#2a62ff'], [1.0, 20, '#141414']];
const dianaTex = canvasTex((g, w, h) => {
  const c = w / 2;
  for (let i = RINGS.length - 1; i >= 0; i--) {
    const [k, , col] = RINGS[i], inner = i ? RINGS[i - 1][0] : 0;
    g.fillStyle = col; g.beginPath(); g.arc(c, c, k * c, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.beginPath(); g.arc(c, c, (k + inner) / 2 * c, 0, 7); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 4; g.beginPath(); g.arc(c, c, k * c - 2, 0, 7); g.stroke();
  }
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 3; g.beginPath(); g.moveTo(c - 12, c); g.lineTo(c + 12, c); g.moveTo(c, c - 12); g.lineTo(c, c + 12); g.stroke();
}, 512, 512);
// Pared interior: azul profundo, más oscura abajo, con líneas que marcan la profundidad
function insideMat(depth) {
  return new THREE.ShaderMaterial({ uniforms: { uD: { value: depth } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uD; varying vec2 vUv;
      void main(){
        vec3 c = mix(vec3(0.02, 0.03, 0.07), vec3(0.14, 0.19, 0.34), pow(vUv.y, 0.8));
        float hl = step(0.9, fract(vUv.y * uD / 0.1)), vl = step(0.93, fract(vUv.x * 32.0));
        c *= 1.0 + 0.45 * max(hl, vl);
        gl_FragColor = vec4(c, 1.0); }`,
    side: THREE.BackSide });
}
function netBasket(R, depth) {
  const g = new THREE.Group(), rB = R * BOTTOM_K;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, rB, depth, 64, 1, true), insideMat(depth));
  wall.position.y = -depth / 2;
  const t = netTex.clone(); t.needsUpdate = true; t.repeat.set(Math.round(R * 2 * Math.PI / (8 * 0.09)), depth / (4 * 0.09));   // rombos de ~9 cm
  const net = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.985, rB * 0.985, depth, 64, 1, true),
    new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.85 }));
  net.position.y = -depth / 2;
  const diana = new THREE.Mesh(new THREE.CircleGeometry(rB * 0.98, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: dianaTex, color: 0xd8d8d8 }));
  diana.position.y = -depth + 0.004;
  const under = new THREE.Mesh(new THREE.CircleGeometry(rB, 64).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1a1d24 }));
  under.position.y = -depth;
  g.add(wall, net, diana, under);
  return { g, net };
}
function makeHoop(pos, nH) {
  const g = new THREE.Group();
  g.position.copy(pos); g.quaternion.setFromUnitVectors(_hz, nH);
  const orange = new THREE.MeshStandardMaterial({ color: 0xff6a1a, metalness: 0.55, roughness: 0.35 });
  g.add(new THREE.Mesh(new THREE.TorusGeometry(HR, 0.014, 12, 72).rotateX(Math.PI / 2), orange));
  const { g: nb, net } = netBasket(HR, NET_H); g.add(nb);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 40).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.5 }));
  plate.position.set(0, -0.03, -(HR + 0.055)); g.add(plate);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.025, 0.06), orange); arm.position.set(0, 0, -(HR + 0.025)); g.add(arm);
  scene.add(g); g.updateMatrixWorld(true);
  hoops.push({ g, c: pos.clone(), top: pos.y, net, netT: 9, R: HR, depth: NET_H });
}
function makeBin(pos) {
  const g = new THREE.Group(); g.position.copy(pos);
  const { g: nb, net } = netBasket(BR, BH); nb.position.y = BH; g.add(nb);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(BR, 0.022, 14, 96).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xff6a1a, metalness: 0.55, roughness: 0.35 }));
  rim.position.y = BH; g.add(rim);
  scene.add(g);
  bins.push({ g, c: pos.clone().add(new THREE.Vector3(0, BH, 0)), top: pos.y + BH, net, netT: 9, R: BR, depth: BH });
}
function placeProps(head) {
  const walls = colPlanes.filter(P => P.wall && P.poly && P.area > 1.0);
  const hoopY = Math.min(floorY + 1.55, ceilY - 0.35);
  const cands = [];
  for (const P of walls) {
    let mnx = 1e9, mnz = 1e9, mxx = -1e9, mxz = -1e9;
    for (let i = 0; i < P.poly.length; i += 2) { mnx = Math.min(mnx, P.poly[i]); mxx = Math.max(mxx, P.poly[i]); mnz = Math.min(mnz, P.poly[i + 1]); mxz = Math.max(mxz, P.poly[i + 1]); }
    const nH = new THREE.Vector3(P.n.x, 0, P.n.z).normalize(), side = new THREE.Vector3().crossVectors(_Y, nH);
    if (_v.setFromMatrixPosition(P.mat).sub(head).negate().dot(nH) < 0) nH.negate();   // siempre hacia la sala
    let best = null;
    for (let k = 0; k < 40; k++) {
      const w = new THREE.Vector3(rnd(mnx, mxx), 0, rnd(mnz, mxz)).applyMatrix4(P.mat); w.y = hoopY;
      const inside = (dx, dy) => { const q = w.clone().addScaledVector(side, dx).add(new THREE.Vector3(0, dy, 0)).applyMatrix4(P.inv); return inPoly(P.poly, q.x, q.z); };
      if (![[-HR - 0.05, 0], [0, 0], [HR + 0.05, 0], [0, 0.15], [0, -NET_H]].every(([dx, dy]) => inside(dx, dy))) continue;
      const d = Math.hypot(w.x - head.x, w.z - head.z); if (d < 1.2 || d > 4.5) continue;
      const sc = Math.abs(d - 2.4); if (!best || sc < best.sc) best = { w, nH, sc };
    }
    if (best) cands.push(best);
  }
  cands.sort((a, b) => a.sc - b.sc);
  const chosen = [];
  for (const c of cands) { if (chosen.length >= 3) break; if (chosen.every(o => o.w.distanceTo(c.w) > 1.5)) chosen.push(c); }
  for (const c of chosen) makeHoop(c.w.clone().addScaledVector(c.nH, HR + 0.06), c.nH);
  if (!chosen.length) {   // sin paredes detectadas: una canasta flotando delante
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(headQuat); f.y = 0; f.normalize();
    makeHoop(new THREE.Vector3(head.x, hoopY, head.z).addScaledVector(f, 2.2), f.clone().negate());
  }
  return;   // sin canasta de suelo: solo en las paredes
  // canasta de suelo, a 1.6–3 m, lejos de paredes, canastas y muebles
  for (let k = 0; k < 80; k++) {
    const a = rnd(0, Math.PI * 2), d = rnd(1.6, 3), p = new THREE.Vector3(head.x + Math.cos(a) * d, floorY, head.z + Math.sin(a) * d);
    if (roomValid && (p.x < roomMin.x + BR + 0.25 || p.x > roomMax.x - BR - 0.25 || p.z < roomMin.z + BR + 0.25 || p.z > roomMax.z - BR - 0.25)) continue;
    if (hoops.some(h => Math.hypot(h.c.x - p.x, h.c.z - p.z) < HR + BR + 0.4)) continue;
    if (colPlanes.some(P => P.up && P.poly && P.mat.elements[13] > floorY + 0.15 && P.mat.elements[13] < floorY + 1.3 &&
      [[0, 0], [BR, 0], [-BR, 0], [0, BR], [0, -BR]].some(([dx, dz]) => { const q = p.clone().add(new THREE.Vector3(dx, 0, dz)).applyMatrix4(P.inv); return inPoly(P.poly, q.x, q.z); }))) continue;   // no debajo de muebles
    makeBin(p); break;
  }
}
const _pl = new THREE.Vector3();
const allProps = () => hoops.length + bins.length ? [...hoops, ...bins] : [];
// Por fuera son sólidas (rebotan en el costado); por la boca se tragan la bola
function collideProps(b, h, kin) {
  const r = b.r;
  for (const P of allProps()) {
    const dx = b.pos.x - P.c.x, dz = b.pos.z - P.c.z, dr = Math.hypot(dx, dz), ly = b.pos.y - P.top;
    if (dr > P.R + r + 0.02 || ly > 0 || ly < -P.depth - r || dr < 1e-5) continue;
    if (Math.hypot(b.prev.x - P.c.x, b.prev.z - P.c.z) < P.R) continue;   // ya estaba dentro
    const pen = P.R + r + 0.004 - dr;
    if (pen > 0) contact(b, dx / dr, 0, dz / dr, pen, h, kin);
  }
}
const goalQ = [];
function processGoals() { for (const [b, P] of goalQ) if (b.alive) goal(b, P); goalQ.length = 0; }
function checkGoals(b) {
  if (!b.alive || b.scored) return;
  for (const P of allProps()) {
    if (b.prev.y >= P.top - 0.01 && b.pos.y < P.top && Math.hypot(b.pos.x - P.c.x, b.pos.z - P.c.z) < P.R + b.r * 0.25) { b.scored = true; goalQ.push([b, P]); return; }
  }
}
// La bola entra: cae dentro con gravedad hasta la diana del fondo y puntúa al aterrizar
function goal(b, P) {
  const shot = !!b.held || now - b.thrownAt < 8;   // las que caen del techo no puntúan
  if (b.held) release(b.held, true);
  const m = new THREE.Mesh(ballGeo, TYPES[b.t].mat); m.position.copy(b.pos); m.quaternion.copy(b.mesh.quaternion); m.scale.copy(b.mesh.scale);
  scene.add(m);
  const rB = P.R * BOTTOM_K, off = new THREE.Vector2(b.pos.x - P.c.x, b.pos.z - P.c.z);
  const maxOff = Math.max(0, rB - b.r); if (off.length() > maxOff) off.setLength(maxOff);
  swallowed.push({ m, P, x: P.c.x + off.x, z: P.c.z + off.y, y: b.pos.y, vy: Math.min(b.vel.y, 0), r: b.r, w: b.w.clone(),
    rel: off.length() / rB, shot, landed: 0, t: 0, ball: { t: b.t } });
  P.netT = 0; sndSwish(P.c);
  removeBall(b);
}
function updateProps(dt) {
  for (const P of allProps()) {   // la red se estira al tragarse una bola
    P.netT += dt; const k = Math.min(1, P.netT / 0.55), w = Math.sin(k * Math.PI) * (1 - k);
    P.net.scale.set(1 - 0.05 * w, 1 + 0.12 * w, 1 - 0.05 * w);
  }
  for (let i = swallowed.length - 1; i >= 0; i--) {
    const S = swallowed[i], floorIn = S.P.top - S.P.depth + S.r + 0.004;
    S.t += dt; S.vy -= G * dt; S.y += S.vy * dt;
    if (S.y <= floorIn) {
      S.y = floorIn;
      if (!S.landed) {
        S.landed = now;
        const ring = RINGS.find(([k]) => S.rel <= k) || RINGS[RINGS.length - 1], pts = S.shot ? ring[1] : 0;
        if (pts) {
          score += pts;
          const label = pts === 100 ? '¡DIANA! +100' : `¡CANASTA! +${pts}`;
          floatText(label, new THREE.Vector3(S.P.c.x, S.P.top + 0.3, S.P.c.z), pts === 100 ? 0xffd21f : 0xffb02e, true);
          sndBasket(S.P.c, pts);
        }
        burst(new THREE.Vector3(S.x, S.y, S.z), TYPE_COLORS[S.ball.t], S.r);
      }
      S.vy = Math.abs(S.vy) > 0.4 ? -S.vy * 0.45 : 0;
    }
    const wl = S.w.length(); if (wl > 1e-4) { _dq.setFromAxisAngle(_ax.copy(S.w).divideScalar(wl), wl * dt); S.m.quaternion.premultiply(_dq); }
    S.m.position.set(S.x, S.y, S.z);
    if (S.landed && now - S.landed > 1.2) {   // se queda un momento en la diana y desaparece
      const k = Math.min(1, (now - S.landed - 1.2) / 0.3); S.m.scale.setScalar(S.r * (1 - k));
      if (k >= 1) { scene.remove(S.m); swallowed.splice(i, 1); }
    }
    if (S.t > 6) { scene.remove(S.m); swallowed.splice(i, 1); }
  }
}
function sndSwish(pos) { if (actx) noise(panAt(pos), 0.45, actx.currentTime, 0.28, 3200); }
function sndBasket(pos, pts) {
  if (!actx) return;
  const t = actx.currentTime, p = panAt(pos), notes = pts >= 100 ? [523, 659, 784, 1047, 1319] : pts >= 50 ? [523, 659, 784, 1047] : [523, 659, 784];
  tone(p, 110, 'sine', 0.5, t, 0.18, 60);
  notes.forEach((f, i) => tone(p, f, 'triangle', 0.22, t + 0.05 + i * 0.07, 0.45));
}

// ---------- Agujeros en las paredes + mundo Matrix detrás ----------
const WALL_BREAK = 4.5;       // m/s de impacto (componente normal) para agujerear una pared
const RACKET_BREAK = 2.2;     // m/s de la cabeza de la raqueta contra la pared
const holes = [], holeQ = [];
const debris = [];
let lastRacketWall = -9;
const stencilEq = { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp };
// 1) la forma del agujero marca el stencil (solo donde la pared es visible)
const maskMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide,
  stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
// 2) dentro del agujero se borra la profundidad: lo que hay "detrás de la pared" pasa a verse
const depthClearMat = new THREE.ShaderMaterial({
  vertexShader: `void main(){ gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `void main(){ gl_FragColor = vec4(0.); gl_FragDepth = 1.0; }`,
  colorWrite: false, depthWrite: true, depthFunc: THREE.AlwaysDepth, side: THREE.DoubleSide, ...stencilEq });

const glyphTex = canvasTex((g, w, h) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 52px monospace';
  const s = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワ0123456789Z:・=*+-<>¦|';
  for (let i = 0; i < 64; i++) { const x = i % 8, y = Math.floor(i / 8); g.fillText(s[i % s.length], x * 64 + 32, y * 64 + 34); }
}, 512, 512);
glyphTex.generateMipmaps = false; glyphTex.minFilter = THREE.LinearFilter; glyphTex.colorSpace = THREE.NoColorSpace;
const matrixU = { uT: { value: 0 }, uG: { value: glyphTex } };
const RAIN_FS = `
uniform sampler2D uG; uniform float uT, uCell, uDim; varying vec3 vW; varying vec3 vN;
float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec3 n = abs(vN);
  vec2 uv = (n.x > n.y && n.x > n.z) ? vW.zy : ((n.z > n.y) ? vW.xy : vW.xz);
  uv /= uCell;
  vec2 cell = floor(uv), f = fract(uv);
  float col = cell.x;
  float sp = 3.0 + h1(vec2(col, 1.0)) * 7.0, len = 10.0 + h1(vec2(col, 3.0)) * 24.0;
  float tr = fract((-cell.y - uT * sp + h1(vec2(col, 7.0)) * 200.0) / len);
  float b = pow(tr, 2.5);
  float gi = floor(h1(cell + floor(uT * (0.7 + h1(cell) * 3.0))) * 64.0);
  vec2 guv = (vec2(mod(gi, 8.0), floor(gi / 8.0)) + clamp(vec2(f.x, 1.0 - f.y), 0.06, 0.94)) / 8.0;
  float g = texture2D(uG, vec2(guv.x, 1.0 - guv.y)).r;
  vec3 c = vec3(0.12, 1.0, 0.38) * g * b + vec3(0.75, 1.0, 0.8) * g * step(0.965, tr);
  gl_FragColor = vec4((c + vec3(0.0, 0.035, 0.015)) * uDim, 1.0);
}`;
function rainMat(cell, dim) {
  return new THREE.ShaderMaterial({ uniforms: { ...matrixU, uCell: { value: cell }, uDim: { value: dim } },
    vertexShader: `varying vec3 vW; varying vec3 vN; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: RAIN_FS, side: THREE.DoubleSide, ...stencilEq });
}
let matrixPts = null;
function buildMatrix() {
  const c = roomValid ? roomMin.clone().add(roomMax).multiplyScalar(0.5) : headPos.clone(); c.y = floorY;
  const box = new THREE.Mesh(new THREE.BoxGeometry(44, 24, 44), rainMat(0.45, 0.55)); box.position.set(c.x, floorY + 6, c.z); box.renderOrder = -0.4; scene.add(box);
  const half = roomValid ? Math.max(roomMax.x - roomMin.x, roomMax.z - roomMin.z) / 2 : 3;
  for (let i = 0; i < 46; i++) {   // columnas de código en profundidad (paralaje)
    const a = rnd(0, Math.PI * 2), d = half + rnd(1.5, 14), s = rnd(0.3, 1.3), hgt = rnd(2.5, 9);
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, hgt, s), rainMat(rnd(0.09, 0.16), rnd(0.7, 1.1)));
    m.position.set(c.x + Math.cos(a) * d, floorY + hgt / 2, c.z + Math.sin(a) * d); m.renderOrder = -0.39; scene.add(m);
  }
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `varying vec3 vW; uniform float uT; void main(){ vec2 g = abs(fract(vW.xz) - 0.5); float l = smoothstep(0.47, 0.5, max(g.x, g.y));
      float pulse = 0.5 + 0.5 * sin(length(vW.xz) * 1.5 - uT * 3.0); gl_FragColor = vec4(vec3(0.1, 1.0, 0.4) * l * (0.35 + 0.65 * pulse), 1.0); }`,
    uniforms: { uT: matrixU.uT }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, ...stencilEq }));
  grid.position.set(c.x, floorY + 0.002, c.z); grid.renderOrder = -0.38; scene.add(grid);
  const N = 900, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const a = rnd(0, Math.PI * 2), d = half + rnd(0.3, 10); pos.set([c.x + Math.cos(a) * d, floorY + rnd(0, 6), c.z + Math.sin(a) * d], i * 3); }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  matrixPts = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x5bff9a, size: 0.035, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, ...stencilEq }));
  matrixPts.renderOrder = -0.37; scene.add(matrixPts);
}
function updateMatrix(dt) {
  matrixU.uT.value = now;
  if (holes.length && matrixPts) {
    const a = matrixPts.geometry.attributes.position.array;
    for (let i = 1; i < a.length; i += 3) { a[i] -= dt * (1.2 + (i % 7) * 0.35); if (a[i] < floorY) a[i] += 6; }
    matrixPts.geometry.attributes.position.needsUpdate = true;
  }
}
function queueHole(P, point, speed) {
  if (holeQ.some(q => q.point.distanceTo(point) < 0.1)) return;
  holeQ.push({ P, point: point.clone(), speed });
}
function processHoles() {
  for (const q of holeQ) {
    if (holes.some(h => h.c.distanceTo(q.point) < 0.05 && now - h.t < 0.3)) continue;
    makeHole(q.P, q.point, THREE.MathUtils.clamp(0.1 + (q.speed - WALL_BREAK) * 0.05, 0.1, 0.32));
  }
  holeQ.length = 0;
}
function makeHole(P, pw, R) {
  if (holes.length >= 40) return;
  const lc = pw.clone().applyMatrix4(P.inv); lc.y = 0;
  const N = 22, ring = [];
  for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2 + rnd(-0.08, 0.08), rr = R * rnd(0.72, 1.08); ring.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
  const pos = [0, 0, 0], idx = [];
  ring.forEach(([x, z]) => pos.push(x, 0, z));
  for (let i = 0; i < N; i++) idx.push(0, 1 + i, 1 + ((i + 1) % N));
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
  const grp = new THREE.Group(); grp.matrixAutoUpdate = false;
  grp.matrix.copy(P.mat).multiply(new THREE.Matrix4().makeTranslation(lc.x, 0.002, lc.z)); grp.matrixWorldNeedsUpdate = true;
  const mask = new THREE.Mesh(geo, maskMat); mask.renderOrder = -0.6;
  const dc = new THREE.Mesh(geo, depthClearMat); dc.renderOrder = -0.5;
  // borde roto: verde digital por dentro, oscuro por fuera
  const rp = [], rc = [], ri = [];
  ring.forEach(([x, z]) => { const k = rnd(1.1, 1.25); rp.push(x, 0.001, z, x * k, 0.001, z * k); rc.push(0.25, 1, 0.45, 0.12, 0.12, 0.12); });
  for (let i = 0; i < N; i++) { const a = i * 2, b = ((i + 1) % N) * 2; ri.push(a, a + 1, b + 1, a, b + 1, b); }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3)); rg.setIndex(ri);
  const rim = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false }));
  rim.renderOrder = 2;
  // grietas
  const cp = [];
  for (let k = 0; k < 8; k++) {
    let a = rnd(0, Math.PI * 2), rr = R * 1.05, x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const end = R * rnd(1.5, 2.7);
    while (rr < end) { rr += R * rnd(0.15, 0.35); a += rnd(-0.25, 0.25); const nx = Math.cos(a) * rr, nz = Math.sin(a) * rr; cp.push(x, 0.002, z, nx, 0.002, nz); x = nx; z = nz; }
  }
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  const cracks = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0x161616, transparent: true, opacity: 0.8 }));
  cracks.renderOrder = 2;
  grp.add(mask, dc, rim, cracks); scene.add(grp);
  const c = new THREE.Vector3().setFromMatrixPosition(grp.matrix);
  holes.push({ P, c, n: P.n.clone(), R, grp, t: now });
  spawnDebris(c, P.n, R); sndCrash(c, R);
  for (const o of balls) if (o.pos.distanceTo(c) < R + 0.3) wake(o);
  for (const H of Object.values(hands)) pulse(H, 1, 120);
}
const chunkGeo = new THREE.IcosahedronGeometry(1, 0), cubeGeo = new THREE.BoxGeometry(1, 1, 1);
const plasterMat = new THREE.MeshStandardMaterial({ color: 0xd9d5cc, roughness: 0.95, flatShading: true });
const digiMat = new THREE.MeshStandardMaterial({ color: 0x063, emissive: 0x22ff66, emissiveIntensity: 1.3, flatShading: true });
function spawnDebris(c, n, R) {
  const N = Math.min(70, 16 + Math.floor(R * 120));
  const t1 = new THREE.Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? _Y : _hz).normalize(), t2 = new THREE.Vector3().crossVectors(n, t1);
  for (let i = 0; i < N; i++) {
    const dig = Math.random() < 0.3, s = dig ? rnd(0.006, 0.016) : rnd(0.008, 0.03) * (0.7 + R * 2);
    const off = t1.clone().multiplyScalar(rnd(-R, R) * 0.8).addScaledVector(t2, rnd(-R, R) * 0.8);
    const m = new THREE.Mesh(dig ? cubeGeo : chunkGeo, dig ? digiMat : plasterMat);
    m.position.copy(c).add(off).addScaledVector(n, 0.02);
    m.scale.set(s * rnd(0.6, 1.4), s * rnd(0.5, 1.2), s * rnd(0.6, 1.4)); m.quaternion.random(); scene.add(m);
    const v = n.clone().multiplyScalar(rnd(0.4, 2.4)).addScaledVector(off.normalize(), rnd(0.2, 1.2)); v.y += rnd(-0.2, 1.0);
    debris.push({ m, v, w: new THREE.Vector3(rnd(-12, 12), rnd(-12, 12), rnd(-12, 12)), s, t: 0, life: rnd(7, 11) });
  }
  while (debris.length > 450) { const d = debris.shift(); scene.remove(d.m); }
}
function updateDebris(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i], p = d.m.position; d.t += dt;
    if (!d.rest) {
      d.v.y -= G * dt; p.addScaledVector(d.v, dt);
      if (p.y < floorY + d.s) { p.y = floorY + d.s; if (d.v.y < 0) d.v.y = -d.v.y * 0.3; d.v.x *= 0.65; d.v.z *= 0.65; d.w.multiplyScalar(0.5); if (d.v.lengthSq() < 0.01) d.rest = true; }
      const wl = d.w.length(); if (wl > 1e-3) { _dq.setFromAxisAngle(_ax.copy(d.w).divideScalar(wl), wl * dt); d.m.quaternion.premultiply(_dq); }
    }
    if (d.t > d.life) { const k = 1 - (d.t - d.life); if (k <= 0) { scene.remove(d.m); debris.splice(i, 1); } else d.m.scale.multiplyScalar(0.96); }
  }
}
function sndCrash(pos, R) {
  if (!actx) return;
  const t = actx.currentTime, p = panAt(pos);
  tone(p, 75, 'sine', 0.9, t, 0.45, 32); noise(p, 0.8, t, 0.45, 700); noise(p, 0.4, t + 0.03, 0.6, 2400);
  tone(p, 160, 'square', 0.1, t + 0.08, 0.35, 1600);
}
// ¿el punto está dentro de algún agujero? (para no chocar con la pared/malla allí)
function inHole(x, y, z, shrink) {
  for (const H of holes) {
    const dx = x - H.c.x, dy = y - H.c.y, dz = z - H.c.z, dn = dx * H.n.x + dy * H.n.y + dz * H.n.z;
    if (Math.abs(dn) > 0.25) continue;
    const lat2 = dx * dx + dy * dy + dz * dz - dn * dn, R = H.R - shrink;
    if (R > 0 && lat2 < R * R) return true;
  }
  return false;
}
function checkThroughHole(b) {
  for (const H of holes) {
    const dx = b.pos.x - H.c.x, dy = b.pos.y - H.c.y, dz = b.pos.z - H.c.z, dn = dx * H.n.x + dy * H.n.y + dz * H.n.z;
    if (dn < 0 && dn > -0.5 && dx * dx + dy * dy + dz * dz - dn * dn < H.R * H.R) { b.inMatrix = now; return; }
  }
}
function racketVsWalls(dt) {
  if (!rk.holder || !rk.valid || now - lastRacketWall < 0.3) return;
  for (const lp of [[0, RK.hy, 0], [0, RK.hy + RK.ay, 0], [RK.ax, RK.hy, 0], [-RK.ax, RK.hy, 0]]) {
    const a = new THREE.Vector3(...lp).applyMatrix4(rk.M0), z = new THREE.Vector3(...lp).applyMatrix4(rk.M1);
    const sp = a.distanceTo(z) / Math.max(dt, 1e-3); if (sp < RACKET_BREAK) continue;
    for (const P of colPlanes) {
      if (!P.wall) continue;
      const la = a.clone().applyMatrix4(P.inv), lz = z.clone().applyMatrix4(P.inv);
      if (la.y > 0 && lz.y < 0.01 && P.poly && inPoly(P.poly, lz.x, lz.z)) {
        lz.y = 0; queueHole(P, lz.applyMatrix4(P.mat), WALL_BREAK + (sp - RACKET_BREAK) * 1.5);
        lastRacketWall = now; pulse(rk.holder, 1, 100); return;
      }
    }
  }
}

// ---------- Bucle principal ----------
let state = 'intro', scanT0 = -1, foundAt = 0, roomCaptureTried = false, scanVisible = true, scanFade = 1, lastT = 0, worldTimer = 0;
const headPos = V(), headQuat = new THREE.Quaternion();

function setScanVisible(v) {
  scanVisible = v;
  for (const d of planes.values()) d.vis.visible = v;
  for (const d of meshes.values()) d.wire.visible = v;
}
function setOcclusion(v) {
  occlusionOn = v;
  for (const d of meshes.values()) d.occ.visible = v;
  for (const d of planes.values()) d.occ.visible = v && meshes.size === 0;
}

function loop(t, frame) {
  if (!frame) return renderer.render(scene, camera);
  const ref = renderer.xr.getReferenceSpace();
  now = t / 1000; const dt = Math.min(0.033, lastT ? now - lastT : 0.016); lastT = now;
  const vp = frame.getViewerPose(ref);
  if (vp) { const p = vp.transform.position, o = vp.transform.orientation; headPos.set(p.x, p.y, p.z); headQuat.set(o.x, o.y, o.z, o.w); updateListener(headPos, headQuat); }

  if (state === 'scan') {
    updateWorld(frame, ref);
    if (scanT0 < 0) scanT0 = now;
    const st = now - scanT0, found = planes.size > 0 || meshes.size > 0;
    scanUniforms.uO.value.copy(headPos); scanUniforms.uR.value = (st % SCAN_SWEEP) / SCAN_SWEEP * 7;
    if (found && !foundAt) foundAt = now;
    if (!found && st > 2.5 && !roomCaptureTried && frame.session.initiateRoomCapture) {
      roomCaptureTried = true; frame.session.initiateRoomCapture().catch(e => console.warn('[bolas] initiateRoomCapture', e));
    }
    const pct = found ? Math.min(100, Math.round((now - foundAt) / SCAN_MIN * 100)) : 0;
    showInfo(['Escaneando la sala…', found ? `${planes.size} superficies · ${meshes.size} mallas · ${pct}%` : 'Mira a tu alrededor'], 0);
    if (found && now - foundAt > SCAN_MIN) beginPlay();
    else if (!found && st > 14) { setupVirtualRoom(headPos); rebuildColliders(); beginPlay(); }
  } else if (state === 'play') {
    worldTimer += dt; if (worldTimer > 1) { worldTimer = 0; updateWorld(frame, ref); }
    if (scanFade > 0) { scanFade = Math.max(0, scanFade - dt / 1.5); scanUniforms.uA.value = scanFade; scanUniforms.uR.value += dt * 4; if (!scanFade) setScanVisible(false); }
    updateDrops(headPos);
    updateHands(frame, ref, dt);
    updateRacket(dt);
    racketVsWalls(dt);
    updateHeld(dt);
    physics(dt);
    processGoals();
    processHoles();
    for (const b of [...balls]) if (b.inMatrix && now - b.inMatrix > 2.5) {   // absorbida por Matrix
      score += 5; burst(b.pos, 0x3bff7a, b.r); removeBall(b);
    }
    updateProps(dt); updateDebris(dt); updateMatrix(dt);
    const L = hands.left;   // panel de muñeca
    if (L && L.ok && L.wrist && rk.holder !== L) {
      wrist.mesh.visible = true; drawPanel(wrist, [`${score}`, `${balls.length} bolas`]);
      wrist.mesh.position.copy(L.wrist).add(new THREE.Vector3(0, 0.07, 0)); wrist.mesh.lookAt(headPos);
    } else wrist.mesh.visible = false;
  }
  if (state !== 'intro') {
    updateBallVisuals(dt, headPos);
    updateHowto();
    // carteles flotando delante (siguen la mirada con retardo)
    for (const [P, dist, dy, until] of [[info, 1.1, -0.12, infoUntil], [howto, 1.15, -0.1, howtoUntil]]) {
      if (!P.mesh.visible) continue;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(headQuat); fwd.y = 0; fwd.normalize();
      const target = headPos.clone().addScaledVector(fwd, dist).add(new THREE.Vector3(0, dy, 0));
      P.mesh.position.lerp(target, P.mesh.userData.placed ? Math.min(1, dt * 2.5) : 1); P.mesh.userData.placed = true;
      P.mesh.lookAt(headPos);
      if (now > until) P.mesh.visible = false;
    }
  }
  renderer.render(scene, camera);
}

function beginPlay() {
  state = 'play'; scanFade = 1; setOcclusion(true); rebuildColliders();
  placeProps(headPos); buildMatrix();
  for (let i = 0; i < INITIAL_BALLS; i++) queueDrop(now + 0.8 + i * 0.09, i % TYPES.length);
  nextDrop = now + 0.8 + INITIAL_BALLS * 0.09 + rnd(DROP_MIN, DROP_MAX);
  showHowto(20);
  if (virtualRoom) setTimeout(() => showInfo(['Sala virtual de 5×5 m', 'Haz la configuración del espacio de la Quest'], 5), 16500);
}

// ---------- Arranque ----------
const btn = document.getElementById('go'), msg = document.getElementById('msg');
async function check() {
  if (!navigator.xr) { btn.textContent = 'WebXR no disponible'; msg.textContent = 'Abre esta página en el navegador de la Meta Quest 3 (http://localhost o https).'; return; }
  const ok = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (!ok) { btn.textContent = 'RA no soportada'; msg.textContent = 'Este navegador no admite immersive-ar. Usa la Meta Quest 3.'; return; }
  btn.disabled = false; btn.textContent = 'Empezar en RA';
}
btn.addEventListener('click', async () => {
  initAudio(); actx.resume();
  try {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking', 'plane-detection', 'mesh-detection', 'anchors'],
    });
    await renderer.xr.setSession(session);
    document.getElementById('intro').style.display = 'none';
    state = 'scan'; scanT0 = -1; foundAt = 0; lastT = 0;
    session.addEventListener('end', () => location.reload());
  } catch (e) { console.error('[bolas]', e); msg.textContent = 'No se pudo iniciar la sesión RA: ' + e.message; }
});
window.__bolas = { hands, balls, rk, gest, lastThrows, hoops, bins, holes, debris, get score() { return score; }, get state() { return state; },
  get floorY() { return floorY; }, get ceilY() { return ceilY; }, get room() { return roomValid ? [roomMin.toArray(), roomMax.toArray()] : null; } };
renderer.setAnimationLoop(loop);
check();
