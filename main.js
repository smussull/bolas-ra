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
scene.add(new THREE.HemisphereLight(0xffffff, 0x5a6270, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.1); sun.position.set(1, 3, 1.5); scene.add(sun);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.85;  // reflejos para el cobre y el acero
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------- Texturas de las bolas ----------
function canvasTex(draw, w = 512, h = 256) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.wrapS = THREE.RepeatWrapping; return t;
}
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- Paletas de color ----------
// Cuatro paletas elegibles en el menú de la palma. Todo lo que se puede recolorear lee de aquí.
const rgb = h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const PALETTES = {
  grafito: { name: 'Grafito y cobre', swatch: ['#2b2d31', '#b87333', '#ece9e4'],
    balls: [{ k: 'lines', base: '#2b2d31', pat: '#3d4046', rough: 0.7 }, { k: 'band', base: '#ece9e4', pat: '#d3cec6', rough: 0.25, clear: 0.8 },
      { k: 'brushed', base: '#b87333', pat: '#5a2d0f', metal: 0.85, rough: 0.32 }, { k: 'rings', base: '#8a8f96', pat: '#282d32', metal: 0.8, rough: 0.35 },
      { k: 'dots', base: '#5b6670', pat: '#6d7882', rough: 0.75 }, { k: 'seam', base: '#c9b79c', pat: '#e0d4c0', rough: 0.8 }],
    fx: [0x6a6e75, 0xf3f0ea, 0xd08a4a, 0xb4b9c0, 0x8794a0, 0xddcdb3],
    rim: { c: 0xb87333, metal: 0.85, rough: 0.3 }, plate: { c: 0x2b2d31, rough: 0.55 },
    net: { o: 'rgba(20,21,24,0.85)', m: '#4a4d53', h: 'rgba(110,114,121,0.9)', k: '#5c6067' }, inside: [0x0f1013, 0x3d4047, 0.35],
    rings: ['#b87333', '#ece9e4', '#5b6670', '#2b2d31'],
    gun: { body: { c: 0x2b2d31, rough: 0.55 }, barrel: { c: 0x8a8f96, metal: 0.8, rough: 0.35 }, detail: { c: 0xb87333, metal: 0.85, rough: 0.3 }, dark: { c: 0x1f2124, rough: 0.7 } },
    racket: { frame: { c: 0xb87333, metal: 0.85, rough: 0.3 }, handle: { c: 0x2b2d31, rough: 0.7 }, strings: 0xece9e4 },
    q: { bg: 0xece8e4, trace: 0x5c616b, chip: 0xccc7bd, glow: 0xb87333, node: 0x3d4047, pulse: 0xd98538 },
    tower: { metal: { c: 0xb87333, metal: 0.85, rough: 0.28 }, coil: { c: 0x2b2d31, rough: 0.5 }, qubit: { c: 0xf3efe8, e: 0xe0b48c, ei: 0.5 } },
    pts: 0xc58a52, holeIn: 0xd1854a, holeOut: 0x2b2b30, crack: 0x2b2d31, digi: { c: 0xb87333, metal: 0.85, rough: 0.3 },
    accent: 0xd08a4a, accent2: 0xe0a060, menuBtn: ['#ece9e4', '#e2ddd5', '#ece9e4'], menuActive: '#dba878', how: ['#b87333', '#8a8f96'] },
  mono: { name: 'Monocromo', swatch: ['#1c1c1c', '#ff5a3c', '#f4f4f2'],
    balls: [{ k: 'band', base: '#f4f4f2', pat: '#dcdcda', rough: 0.25, clear: 0.8 }, { k: 'lines', base: '#a9a9a6', pat: '#939390', rough: 0.6 },
      { k: 'dots', base: '#6f6f6c', pat: '#868683', rough: 0.6 }, { k: 'rings', base: '#3c3c3a', pat: '#252523', rough: 0.5 },
      { k: 'lines', base: '#1c1c1c', pat: '#2e2e2e', rough: 0.2, clear: 1 }, { k: 'seam', base: '#ff5a3c', pat: '#ffd0c4', rough: 0.45 }],
    fx: [0xffffff, 0xe0e0de, 0xb0b0ad, 0x7a7a78, 0x5a5a58, 0xff7a60],
    rim: { c: 0xff5a3c, rough: 0.4 }, plate: { c: 0x1c1c1c, rough: 0.5 },
    net: { o: 'rgba(0,0,0,0.55)', m: '#f4f4f2', h: 'rgba(200,200,198,0.9)', k: '#e2e2e0' }, inside: [0x0d0d0d, 0x333333, 0.3],
    rings: ['#ff5a3c', '#f4f4f2', '#8c8c89', '#1c1c1c'],
    gun: { body: { c: 0x1c1c1c, rough: 0.35 }, barrel: { c: 0xf4f4f2, rough: 0.4 }, detail: { c: 0xff5a3c, rough: 0.4 }, dark: { c: 0x4a4a48, rough: 0.6 } },
    racket: { frame: { c: 0x1c1c1c, rough: 0.35 }, handle: { c: 0xff5a3c, rough: 0.5 }, strings: 0xf4f4f2 },
    q: { bg: 0xf2f2f2, trace: 0x404040, chip: 0xd8d8d8, glow: 0xff5a3c, node: 0x1a1a1a, pulse: 0xff5a3c },
    tower: { metal: { c: 0xd9d9d9, metal: 0.7, rough: 0.3 }, coil: { c: 0x1c1c1c, rough: 0.5 }, qubit: { c: 0xffffff, e: 0xff5a3c, ei: 0.4 } },
    pts: 0xff7a60, holeIn: 0xff5c3d, holeOut: 0x1e1e1e, crack: 0x1c1c1c, digi: { c: 0xff5a3c, rough: 0.4 },
    accent: 0xff5a3c, accent2: 0xff8a70, menuBtn: ['#f4f4f2', '#e6e6e4', '#f4f4f2'], menuActive: '#ff8a70', how: ['#ff5a3c', '#4a4a48'] },
  joyas: { name: 'Joyas', swatch: ['#1f6f5c', '#c9a227', '#5b3f8c'],
    balls: [{ k: 'rings', base: '#1f6f5c', pat: '#2a8a73', rough: 0.2, clear: 1 }, { k: 'band', base: '#24477a', pat: '#3360a0', rough: 0.2, clear: 1 },
      { k: 'dots', base: '#8c2f39', pat: '#a8414c', rough: 0.2, clear: 1 }, { k: 'brushed', base: '#c9a227', pat: '#6b520e', metal: 0.9, rough: 0.3 },
      { k: 'lines', base: '#5b3f8c', pat: '#7556ab', rough: 0.2, clear: 1 }, { k: 'seam', base: '#1e1e22', pat: '#3a3a42', rough: 0.15, clear: 1 }],
    fx: [0x3fae92, 0x4f7fc4, 0xc4505e, 0xe8c45a, 0x8a6cc4, 0x707078],
    rim: { c: 0xc9a227, metal: 0.9, rough: 0.25 }, plate: { c: 0x1e1e22, rough: 0.4 },
    net: { o: 'rgba(8,8,10,0.9)', m: '#2a2a30', h: 'rgba(90,90,100,0.9)', k: '#c9a227' }, inside: [0x0a0d17, 0x242a44, 0.4],
    rings: ['#c9a227', '#8c2f39', '#24477a', '#1e1e22'],
    gun: { body: { c: 0x24477a, rough: 0.3 }, barrel: { c: 0xc9a227, metal: 0.9, rough: 0.3 }, detail: { c: 0xc9a227, metal: 0.9, rough: 0.3 }, dark: { c: 0x1e1e22, rough: 0.5 } },
    racket: { frame: { c: 0xc9a227, metal: 0.9, rough: 0.25 }, handle: { c: 0x1e1e22, rough: 0.5 }, strings: 0xf3efe8 },
    q: { bg: 0x10131f, trace: 0x9e8034, chip: 0x232838, glow: 0x7556ab, node: 0xc9a227, pulse: 0xffd866 },
    tower: { metal: { c: 0xc9a227, metal: 0.9, rough: 0.25 }, coil: { c: 0x24477a, rough: 0.4 }, qubit: { c: 0xe8e0ff, e: 0x8a6cc4, ei: 0.8 } },
    pts: 0xe8c45a, holeIn: 0xe6bf4d, holeOut: 0x1a1a21, crack: 0x1e1e22, digi: { c: 0xc9a227, metal: 0.9, rough: 0.3 },
    accent: 0xe8c45a, accent2: 0xffd866, menuBtn: ['#efe9dc', '#e6e0d2', '#efe9dc'], menuActive: '#e3c46a', how: ['#8c2f39', '#c9a227'] },
  nordico: { name: 'Nórdico', swatch: ['#c8a27a', '#8a9a7b', '#b5654a'],
    balls: [{ k: 'grain', base: '#c8a27a', pat: '#a8835c', rough: 0.8 }, { k: 'seam', base: '#e6ddd0', pat: '#f5efe6', rough: 0.85 },
      { k: 'dots', base: '#8a9a7b', pat: '#9cab8e', rough: 0.8 }, { k: 'band', base: '#b5654a', pat: '#c87d62', rough: 0.75 },
      { k: 'rings', base: '#5e7186', pat: '#495a6c', rough: 0.7 }, { k: 'lines', base: '#3a3a38', pat: '#4a4a47', rough: 0.75 }],
    fx: [0xe0c09a, 0xf3ede4, 0xaab99c, 0xd08a70, 0x8698ad, 0x6a6a66],
    rim: { c: 0xb5654a, rough: 0.6 }, plate: { c: 0xc8a27a, rough: 0.7 },
    net: { o: 'rgba(90,75,55,0.7)', m: '#e6ddd0', h: 'rgba(205,193,176,0.9)', k: '#d9cdbb' }, inside: [0x4d4238, 0x9e8f7a, 0.2],
    rings: ['#b5654a', '#e6ddd0', '#8a9a7b', '#5e7186'],
    gun: { body: { c: 0xe6ddd0, rough: 0.7 }, barrel: { c: 0x5e7186, rough: 0.6 }, detail: { c: 0xb5654a, rough: 0.6 }, dark: { c: 0xc8a27a, rough: 0.7 } },
    racket: { frame: { c: 0xc8a27a, rough: 0.6 }, handle: { c: 0x3a3a38, rough: 0.7 }, strings: 0xe6ddd0 },
    q: { bg: 0xe6ded2, trace: 0x857867, chip: 0xccbca8, glow: 0x8a9a7b, node: 0x5c544c, pulse: 0xc76b4d },
    tower: { metal: { c: 0xc8a27a, rough: 0.7 }, coil: { c: 0x8a9a7b, rough: 0.7 }, qubit: { c: 0xf3ede4, e: 0xb5654a, ei: 0.35 } },
    pts: 0xb5654a, holeIn: 0xc77352, holeOut: 0x4d453d, crack: 0x4a4540, digi: { c: 0xb5654a, rough: 0.6 },
    accent: 0xc57a5f, accent2: 0xd49a82, menuBtn: ['#efe8dd', '#e6ddd0', '#efe8dd'], menuActive: '#d49a82', how: ['#b5654a', '#5e7186'] },
};
const PAL_KEYS = Object.keys(PALETTES);
// Nórdico por defecto; la que elijas en el menú se recuerda (clave nueva: todos empiezan en Nórdico una vez)
const PAL_STORE = 'bolas-paleta-v2';
let PAL = PALETTES.nordico, palKey = 'nordico';
try { const k = localStorage.getItem(PAL_STORE); if (PALETTES[k]) { PAL = PALETTES[k]; palKey = k; } } catch (e) {}
// textura de bola según el tipo de dibujo (sutil, para que se note el giro)
function ballTex(B) {
  return canvasTex((g, w, h) => {
    g.fillStyle = B.base; g.fillRect(0, 0, w, h);
    const p = B.pat;
    if (B.k === 'lines') { g.strokeStyle = p; g.lineWidth = 6; for (let y = h / 8; y < h; y += h / 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } }
    else if (B.k === 'band') { g.fillStyle = p; g.fillRect(0, h * 0.46, w, h * 0.08); }
    else if (B.k === 'brushed') { for (let i = 0; i < 900; i++) { g.globalAlpha = rnd(0.04, 0.12); g.fillStyle = Math.random() < 0.5 ? '#ffffff' : p; g.fillRect(rnd(0, w), rnd(0, h), rnd(30, 120), 1); } g.globalAlpha = 0.4; g.fillStyle = p; g.fillRect(0, h * 0.49, w, 3); g.globalAlpha = 1; }
    else if (B.k === 'rings') { g.strokeStyle = p; g.globalAlpha = 0.55; g.lineWidth = 4; for (const x of [w * 0.25, w * 0.75]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke(); g.globalAlpha = 1; }
    else if (B.k === 'dots') { g.fillStyle = p; for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) { g.beginPath(); g.arc((i + (j % 2) * 0.5) * w / 8, (j + 0.5) * h / 4, 9, 0, 7); g.fill(); } }
    else if (B.k === 'seam') { g.strokeStyle = p; g.lineWidth = 7; g.beginPath(); for (let x = 0; x <= w; x += 4) { const y = h / 2 + Math.sin(x / w * Math.PI * 4) * h * 0.26; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    else if (B.k === 'grain') { for (let y = 0; y < h; y += 3) { g.globalAlpha = 0.15 + 0.25 * Math.abs(Math.sin(y * 0.11)); g.fillStyle = p; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.02 + y * 0.05) * 3); g.lineTo(w, y + 2); g.lineTo(0, y + 2); g.fill(); } g.globalAlpha = 1; }
  });
}
// Todas son pelotas de goma ligera; cambian el aspecto y el tono del bote
const TYPES = [190, 230, 165, 260, 300, 340].map(snd => ({ snd, mat: new THREE.MeshPhysicalMaterial({ roughness: 0.6 }) }));
const TYPE_COLORS = [0, 0, 0, 0, 0, 0];   // colores de efectos de cada tipo (los rellena la paleta)
// materiales compartidos que recolorea la paleta
const PM = {
  rim: new THREE.MeshStandardMaterial(), plate: new THREE.MeshStandardMaterial(),
  gunBody: new THREE.MeshStandardMaterial(), gunBarrel: new THREE.MeshStandardMaterial(), gunDetail: new THREE.MeshStandardMaterial(), gunDark: new THREE.MeshStandardMaterial(),
  rkFrame: new THREE.MeshStandardMaterial(), rkHandle: new THREE.MeshStandardMaterial(), rkStrings: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.8 }),
  inside: { uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }, uK: { value: 0.3 } },
  tower: null,
};
function setMat(m, spec) {
  m.color.setHex(spec.c); m.metalness = spec.metal || 0; m.roughness = spec.rough ?? 0.5;
  if ('clearcoat' in m) { m.clearcoat = spec.clear || 0; m.clearcoatRoughness = 0.2; }
}

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
// Música ambiental suave y generativa: acordes de pad lentos y notas sueltas de una escala pentatónica
let musicGain = null, musicOn = true, musicTimer = null, musicNext = 0, musicStep = 0;
const CHORDS = [[261.6, 329.6, 392.0, 493.9], [220.0, 261.6, 329.6, 392.0], [174.6, 220.0, 261.6, 329.6], [196.0, 246.9, 293.7, 392.0]];
const PENTA = [523.3, 587.3, 659.3, 784.0, 880.0, 1046.5];
function startMusic() {
  if (!actx || musicTimer) return;
  musicGain = actx.createGain(); musicGain.gain.value = musicOn ? 0.22 : 0;
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
  const dl = actx.createDelay(1.0), fb = actx.createGain(); dl.delayTime.value = 0.42; fb.gain.value = 0.32;
  musicGain.connect(lp).connect(master); lp.connect(dl); dl.connect(fb).connect(dl); dl.connect(master);
  musicNext = actx.currentTime + 0.2;
  musicTimer = setInterval(() => {
    while (musicNext < actx.currentTime + 1.0) {
      const t = musicNext, ch = CHORDS[Math.floor(musicStep / 8) % CHORDS.length];
      if (musicStep % 8 === 0) ch.forEach((f, i) => pad(f / (i ? 1 : 2), t, 4.2));     // acorde cada 4 s
      if (Math.random() < 0.45) pluck(PENTA[Math.floor(Math.random() * PENTA.length)], t);
      musicNext += 0.5; musicStep++;
    }
  }, 250);
}
function pad(f, t, dur) {
  const o = actx.createOscillator(), g = actx.createGain(); o.type = 'triangle'; o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09, t + 1.2); g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(musicGain); o.start(t); o.stop(t + dur + 0.05);
}
function pluck(f, t) {
  const o = actx.createOscillator(), g = actx.createGain(); o.type = 'sine'; o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.07, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  o.connect(g).connect(musicGain); o.start(t); o.stop(t + 1.5);
}
function setMusic(on) {
  musicOn = on;
  if (musicGain) musicGain.gain.setTargetAtTime(on ? 0.22 : 0, actx.currentTime, 0.3);
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
const HOW_INK = '#2a2d33', HOW_SKIN = '#f4f5f7';
let HOW_BALL = '#b87333', HOW_RK = '#8a8f96';
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
// ---- manos realistas: piel con degradado, falanges con pliegues y uñas ----
const SKIN_L = '#f7dcc7', SKIN = '#e8b996', SKIN_D = '#c48a66', SKIN_LINE = 'rgba(122,74,48,0.8)', NAIL = '#f4dcd2';
function skinGrad(g, x0, y0, x1, y1) { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, SKIN_L); gr.addColorStop(0.5, SKIN); gr.addColorStop(1, SKIN_D); return gr; }
// dedo afilado a lo largo de sus articulaciones (pts), con punta redondeada, pliegues y uña
function finger(g, pts, w0, w1, nail = true) {
  const n = pts.length, L = [], R = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const w = (w0 + (w1 - w0) * i / (n - 1)) / 2;
    L.push([pts[i][0] - dy * w, pts[i][1] + dx * w]); R.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
  }
  const t = pts[n - 1], p = pts[n - 2], ang = Math.atan2(t[1] - p[1], t[0] - p[0]);
  g.beginPath(); g.moveTo(L[0][0], L[0][1]);
  for (let i = 1; i < n; i++) { const m = [(L[i - 1][0] + L[i][0]) / 2, (L[i - 1][1] + L[i][1]) / 2]; g.quadraticCurveTo(L[i - 1][0], L[i - 1][1], m[0], m[1]); }
  g.lineTo(L[n - 1][0], L[n - 1][1]);
  g.arc(t[0], t[1], w1 / 2, ang + Math.PI / 2, ang - Math.PI / 2, true);
  for (let i = n - 2; i >= 0; i--) { const m = [(R[i + 1][0] + R[i][0]) / 2, (R[i + 1][1] + R[i][1]) / 2]; g.quadraticCurveTo(R[i + 1][0], R[i + 1][1], m[0], m[1]); }
  g.lineTo(R[0][0], R[0][1]); g.closePath();
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
  g.fillStyle = skinGrad(g, Math.min(...xs), Math.min(...ys) - w0, Math.max(...xs), Math.max(...ys) + w0); g.fill();
  g.strokeStyle = SKIN_LINE; g.lineWidth = 2.2; g.stroke();
  g.strokeStyle = 'rgba(122,74,48,0.45)'; g.lineWidth = 1.6;           // pliegues de las articulaciones
  for (let i = 1; i < n - 1; i++) {
    const a = pts[i - 1], b = pts[i + 1]; let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const w = (w0 + (w1 - w0) * i / (n - 1)) * 0.3;
    g.beginPath(); g.moveTo(pts[i][0] - dy * w, pts[i][1] + dx * w); g.quadraticCurveTo(pts[i][0] + dx * 2, pts[i][1] + dy * 2, pts[i][0] + dy * w, pts[i][1] - dx * w); g.stroke();
  }
  if (nail) {                                                          // uña
    g.save(); g.translate(t[0] - Math.cos(ang) * w1 * 0.32, t[1] - Math.sin(ang) * w1 * 0.32); g.rotate(ang);
    g.fillStyle = NAIL; g.strokeStyle = 'rgba(160,110,90,0.7)'; g.lineWidth = 1.4;
    g.beginPath(); g.ellipse(0, -w1 * 0.08, w1 * 0.36, w1 * 0.27, 0, 0, 7); g.fill(); g.stroke(); g.restore();
  }
}
// mano de perfil (lado del pulgar): (px, py) = punta de la pinza; k = apertura (0 cerrada, 1 abierta)
function pinchHand(g, px, py, k) {
  finger(g, [[px - 250, py + 108], [px - 200, py + 80], [px - 150, py + 50]], 50, 46, false);   // antebrazo
  g.beginPath();                                                                                // palma y dorso
  g.moveTo(px - 158, py + 24);
  g.bezierCurveTo(px - 128, py - 10, px - 96, py - 16, px - 68, py - 10);
  g.lineTo(px - 60, py + 12);
  g.bezierCurveTo(px - 66, py + 42, px - 88, py + 64, px - 120, py + 70);
  g.bezierCurveTo(px - 142, py + 72, px - 156, py + 64, px - 160, py + 50); g.closePath();
  g.fillStyle = skinGrad(g, px - 150, py - 15, px - 80, py + 75); g.fill(); g.strokeStyle = SKIN_LINE; g.lineWidth = 2.2; g.stroke();
  for (let i = 2; i >= 0; i--)                                                                  // corazón, anular y meñique doblados
    finger(g, [[px - 74, py + 10 + i * 13], [px - 52, py + 14 + i * 13], [px - 46, py + 30 + i * 11], [px - 58, py + 40 + i * 9]], 16 - i, 13 - i, false);
  finger(g, [[px - 72, py - 2], [px - 46, py - 6 - 10 * k], [px - 22, py - 9 - 20 * k], [px - 5, py - 8 - 30 * k]], 19, 14);       // índice
  finger(g, [[px - 128, py + 50], [px - 84, py + 54], [px - 42, py + 40 + 10 * k], [px - 8, py + 12 + 26 * k]], 25, 17);         // pulgar
  g.strokeStyle = 'rgba(122,74,48,0.35)'; g.lineWidth = 1.5;                                    // tendón y nudillo
  g.beginPath(); g.moveTo(px - 140, py + 18); g.quadraticCurveTo(px - 110, py + 4, px - 78, py + 2); g.stroke();
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
// puño de frente, con los dedos doblados hacia el espectador (sd = -1 izquierdo, 1 derecho)
function fist(g, cx, cy, sd, a = 1) {
  g.globalAlpha = a;
  finger(g, [[cx + sd * 14, cy + 160], [cx + sd * 6, cy + 100], [cx, cy + 42]], 46, 50, false);   // antebrazo
  g.beginPath(); g.roundRect(cx - 42, cy - 30, 84, 74, 24);                                        // mano
  g.fillStyle = skinGrad(g, cx - 42, cy - 30, cx + 42, cy + 44); g.fill(); g.strokeStyle = SKIN_LINE; g.lineWidth = 2.2; g.stroke();
  for (let i = 0; i < 4; i++) {                                                                    // cuatro dedos doblados
    const x = cx - 31 + i * 20.5, top = cy - 36 + (i === 0 || i === 3 ? 5 : 0), h = 40 - (i === 3 ? 6 : 0);
    g.beginPath(); g.roundRect(x - 10, top, 20, h, 9);
    g.fillStyle = skinGrad(g, x - 10, top, x + 10, top + h); g.fill(); g.strokeStyle = SKIN_LINE; g.lineWidth = 2; g.stroke();
    g.strokeStyle = 'rgba(122,74,48,0.45)'; g.lineWidth = 1.5;                                     // pliegue de la articulación
    g.beginPath(); g.moveTo(x - 6, top + h * 0.52); g.quadraticCurveTo(x, top + h * 0.58, x + 6, top + h * 0.52); g.stroke();
  }
  finger(g, [[cx - sd * 46, cy + 30], [cx - sd * 22, cy + 22], [cx + sd * 4, cy + 14], [cx + sd * 20, cy + 10]], 24, 18);   // pulgar por delante
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
const LABEL_COLOR = { floor: 0xe8d6c2, wall: 0xd9d3ca, ceiling: 0xcfc7bd, table: 0xe0b48c, couch: 0xd9c2a8, bed: 0xd9c2a8, screen: 0xc9b79c };

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
  let fy = Infinity, cy = -Infinity; const floorTriY = [], ceilTriY = [];
  for (const d of planes.values()) {
    let mat = d.mat, inv = d.inv, n = d.n, poly = d.poly;
    // La Quest da algunas superficies (paredes, techo) con la normal hacia fuera de la habitación:
    // se giran para que miren hacia el jugador. Giro de 180° sobre el eje Z local: x→-x, y→-y.
    if (_v.setFromMatrixPosition(d.mat).sub(headPos).negate().dot(d.n) < 0) {
      mat = d.mat.clone().multiply(_flipZ); inv = mat.clone().invert(); n = d.n.clone().negate();
      poly = new Float32Array(d.poly); for (let i = 0; i < poly.length; i += 2) poly[i] = -poly[i];
    }
    const up = n.y > 0.8, down = n.y < -0.8, y = mat.elements[13];
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
      if (nl > 1e-9 && Math.abs(ny / nl) > 0.9 && cyT > 1.5) ceilTriY.push(cyT);
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
  else {
    // sin plano de techo: el punto más alto de la malla puede ser ruido o un hueco alto. Se usa la
    // superficie horizontal alta más baja que sea habitual (percentil 20 de los triángulos de techo).
    const c = ceilTriY.filter(y => y > floorY + 1.8).sort((a, b) => a - b);
    if (c.length > 10) ceilY = Math.min(c[Math.floor(c.length * 0.2)], floorY + 3.5);
    else if (meshTop > floorY + 1.8) ceilY = Math.min(meshTop, floorY + 3.0);
    else ceilY = floorY + 2.5;
  }
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
// Rayo vertical hacia arriba desde (x, y0, z): altura de la primera superficie (techo, mueble alto…)
function ceilingAt(x, y0, z) {
  let best = Infinity;
  for (const P of colPlanes) {                       // planos de techo (normal hacia abajo)
    if (!P.down && P.label !== 'ceiling') continue;
    const py = P.mat.elements[13]; if (py <= y0 || py >= best) continue;
    _v.set(x, py, z).applyMatrix4(P.inv);
    if (!P.poly || inPoly(P.poly, _v.x, _v.z)) best = py;
  }
  if (tris.length) {                                 // malla: triángulos de la columna (x, z)
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    stampId++;
    for (let iy = Math.floor(y0 / CELL); iy <= Math.floor((floorY + 6) / CELL); iy++) {
      if ((iy * CELL) > best) break;
      const a = grid.get(cellKey(ix, iy, iz)); if (!a) continue;
      for (const t of a) {
        if (triStamp[t] === stampId) continue; triStamp[t] = stampId;
        const o = t * 9, T = tris;
        // intersección del rayo vertical con el triángulo (coordenadas baricéntricas en XZ)
        const ax = T[o], az = T[o + 2], bx = T[o + 3], bz = T[o + 5], cx = T[o + 6], cz = T[o + 8];
        const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(den) < 1e-9) continue;
        const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den, w = 1 - u - v;
        if (u < 0 || v < 0 || w < 0) continue;
        const y = u * T[o + 1] + v * T[o + 4] + w * T[o + 7];
        if (y > y0 + 0.3 && y < best) best = y;
      }
    }
  }
  return best === Infinity ? ceilY : Math.min(best, ceilY + 0.5);
}
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
    return new THREE.Vector3(x, ceilingAt(x, head.y, z) - 0.02, z);
  }
  const a = rnd(0, Math.PI * 2), d = rnd(0.5, 1.5);
  const fx = head.x + Math.cos(a) * d, fz = head.z + Math.sin(a) * d;
  return new THREE.Vector3(fx, ceilingAt(fx, head.y, fz) - 0.02, fz);
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
      const r = BALL_R * rnd(0.88, 1.12), p = d.pos.clone(); p.y = Math.max(d.pos.y, floorY + 2.2) + 0.3 + r;   // por encima del techo: lo atraviesa al caer
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
    const dIx = ix.distanceTo(H.palm), dMd = md.distanceTo(H.palm), dRg = rg.distanceTo(H.palm), dPk = pk.distanceTo(H.palm);
    H.fist = (dIx + dMd + dRg + dPk) / 4;
    H.ixExt = dIx;
    // gesto V: índice y corazón estirados y separados, anular y meñique doblados
    H.vSign = dIx > 0.1 && dMd > 0.1 && dRg < 0.08 && dPk < 0.08 && ix.distanceTo(md) > 0.035;
    if (!H.raw) {
      if (H.pinch < PINCH_ON) { H.raw = true; H.mode = 'pinza'; }
      else if (H.fist < FIST_ON) { H.raw = true; H.mode = 'puño'; }
    } else H.raw = H.pinch < PINCH_OFF || H.fist < FIST_OFF;
    H.wrist = wr; H.n = n.clone(); H.tip = ix.clone();
    H.colPts = [[H.palm, 0.035], [ix, 0.011], [md, 0.011], [rg, 0.011], [pk, 0.010], [th, 0.012]];
    H.colActive = !H.raw && !H.ball && rk.holder !== H && gun.holder !== H && H.pinch > 0.05;
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
    H.wrist = H.palm.clone(); H.n = n.clone(); H.tip = H.palm.clone().addScaledVector(f, 0.07);
    H.colPts = [[H.palm, 0.04]];
    H.colActive = !H.raw && !H.ball && rk.holder !== H && gun.holder !== H;
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
    if (!H.ball && rk.holder !== H && gun.holder !== H) {
      const hp = holdWorld(H, BALL_R, V()), pts = [hp, ...H.colPts.map(c => c[0])];
      for (const b of balls) {
        if (b.held) continue;
        for (const q of pts) { const d = b.pos.distanceTo(q) - b.r; if (d < bd) { bd = d; best = b; } }
      }
    }
    if (!H.ball && best && H.raw && now - H.closedAt < GRAB_GRACE) grab(H, best);
    else if (H.ball && !H.raw) release(H);          // instantáneo: en el primer frame con la mano abierta

    const hp = holdWorld(H, H.ball ? H.ball.r : BALL_R, V());
    H.cur.visible = rk.holder !== H && gun.holder !== H; H.cur.position.copy(hp);
    H.cur.material.color.set(H.ball ? PAL.accent : H.raw ? 0xece9e4 : 0xffffff);
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
  const g = rk.group, frameMat = PM.rkFrame;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.07, 10, 64), frameMat);
  ring.scale.set(RK.ax, RK.ay, RK.ax); ring.position.y = RK.hy; g.add(ring);
  const face = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
  face.scale.set(RK.ax, RK.ay, 1); face.position.y = RK.hy; g.add(face);
  const pts = [];
  for (let x = -RK.ax + 0.016; x < RK.ax; x += 0.019) { const h = RK.ay * Math.sqrt(Math.max(0, 1 - (x / RK.ax) ** 2)); pts.push(x, RK.hy - h, 0, x, RK.hy + h, 0); }
  for (let y = -RK.ay + 0.016; y < RK.ay; y += 0.019) { const w = RK.ax * Math.sqrt(Math.max(0, 1 - (y / RK.ay) ** 2)); pts.push(-w, RK.hy + y, 0, w, RK.hy + y, 0); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(sg, PM.rkStrings));
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.2, 16), PM.rkHandle);
  handle.position.y = 0.04; g.add(handle);
  const throat = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, RK.hy - RK.ay - 0.14, 10), frameMat);
  throat.position.y = 0.14 + (RK.hy - RK.ay - 0.14) / 2; g.add(throat);
  g.visible = false; scene.add(g);
})();
const pullLine = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 1, 10), new THREE.MeshBasicMaterial({ color: 0xd08a4a, transparent: true, opacity: 0.9 }));
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

// ---------- Pistola de juguete (gesto V) ----------
// Gesto V (índice y corazón estirados, anular y meñique doblados) mantenido un momento: aparece la
// pistola en esa mano; repetirlo la guarda. Disparo: doblar el índice como al apretar un gatillo.
// Con mandos: botón A/X la saca o guarda y el gatillo dispara.
const GUN_SPEED = 9;                       // m/s de la bola al salir
const V_HOLD = 0.35;                       // s manteniendo la V
const TRIG_ON = 0.085, TRIG_OFF = 0.1;     // índice punta→palma: doblado / estirado
const gun = { holder: null, group: new THREE.Group(), model: new THREE.Group(), kick: 0, lastToggle: -9,
  muzzle: new THREE.Vector3(0, 0.045, -0.43), trigger: null, hopperBalls: [] };
(function buildGun() {
  const g = gun.model;
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1, ...extra });
  // pistola: cuerpo grafito, cañón de acero, detalles de cobre
  const orange = PM.gunBody, blue = PM.gunBarrel, yellow = PM.gunDetail, dark = PM.gunDark;
  const add = (geo, m, x, y, z, rx = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.x = rx; g.add(o); return o; };
  add(new THREE.BoxGeometry(0.075, 0.095, 0.27), orange, 0, 0.03, -0.1);                                  // cuerpo
  add(new THREE.BoxGeometry(0.08, 0.02, 0.2), yellow, 0, -0.022, -0.12);                                   // franja
  add(new THREE.CylinderGeometry(0.03, 0.034, 0.2, 28).rotateX(Math.PI / 2), blue, 0, 0.045, -0.32);       // cañón
  add(new THREE.TorusGeometry(0.036, 0.009, 10, 32), yellow, 0, 0.045, -0.42);                              // boca
  add(new THREE.BoxGeometry(0.055, 0.14, 0.065), blue, 0, -0.08, 0.015, 0.28);                             // empuñadura
  add(new THREE.TorusGeometry(0.028, 0.006, 8, 24, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), dark, 0, -0.03, -0.045);   // guardamonte
  gun.trigger = add(new THREE.BoxGeometry(0.012, 0.035, 0.014), yellow, 0, -0.035, -0.04, 0.3);            // gatillo
  const dome = add(new THREE.SphereGeometry(0.055, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.05, clearcoat: 1 }), 0, 0.077, -0.06);
  for (let i = 0; i < 3; i++) gun.hopperBalls.push(add(new THREE.SphereGeometry(0.022, 16, 10), TYPES[i * 2].mat, (i - 1) * 0.026, 0.1, -0.06));
  gun.group.add(g); gun.group.visible = false; scene.add(gun.group);
})();
const _gx = new THREE.Vector3(), _gy = new THREE.Vector3(), _gz = new THREE.Vector3(), _gf = new THREE.Vector3(), _gm = new THREE.Matrix4();
function gunAxes(H) {   // adelante = hacia los dedos; arriba = lado del pulgar (el dorso del puño en la empuñadura)
  const F = _gf.set(0, 1, 0).applyQuaternion(H.q), U = _gy.set(1, 0, 0).applyQuaternion(H.q).multiplyScalar(H.key === 'right' ? 1 : -1);
  return { F, U };
}
function toggleGun(H) {
  gun.lastToggle = now;
  if (gun.holder === H) { gun.holder = null; sndZip(H.palm, false); }
  else { gun.holder = H; H.trig = true; sndZip(H.palm, true); if (H.ball) release(H, true); }
  pulse(H, 0.6, 60);
}
function updateGun(dt) {
  for (const H of Object.values(hands)) {
    if (!H.ok) { H.vT = 0; continue; }
    if (H.isCtrl) {                                  // mandos: A / X saca o guarda la pistola
      const bt = H.src?.gamepad?.buttons || [], a = !!bt[4]?.pressed;
      if (a && !H.aPrev && now - gun.lastToggle > 0.4 && rk.holder !== H) toggleGun(H);
      H.aPrev = a;
    } else {
      if (!H.vSign) H.vLock = false;                 // hay que deshacer la V antes de volver a usarla
      H.vT = H.vSign && !H.vLock && !H.ball && rk.holder !== H ? (H.vT || 0) + dt : 0;
      if (H.vT > V_HOLD && now - gun.lastToggle > 0.8) { H.vT = 0; H.vLock = true; toggleGun(H); }
    }
  }
  const H = gun.holder;
  if (!H || !H.ok) { gun.group.visible = false; return; }
  // colocar la pistola en la mano: empuñadura en la palma, cañón hacia delante
  const { F, U } = gunAxes(H);
  _gx.crossVectors(U, _gz.copy(F).negate());
  _gm.makeBasis(_gx, U, _gz);   // Z del modelo = -adelante
  gun.group.quaternion.setFromRotationMatrix(_gm);
  gun.group.position.copy(H.palm).addScaledVector(U, 0.035);
  gun.kick = Math.max(0, gun.kick - dt * 8);
  gun.model.position.z = gun.kick * 0.04; gun.model.rotation.x = gun.kick * 0.25;
  gun.group.visible = true;
  // gatillo
  let pull = false;
  if (H.isCtrl) { const t = !!H.src?.gamepad?.buttons?.[0]?.pressed; pull = t && !H.trig; H.trig = t; gun.trigger.rotation.x = t ? -0.2 : 0.3; }
  else {
    if (!H.trig && H.ixExt < TRIG_ON) { H.trig = true; pull = true; }
    else if (H.trig && H.ixExt > TRIG_OFF) H.trig = false;
    gun.trigger.rotation.x = H.trig ? -0.2 : 0.3;
  }
  if (pull) fireGun(H, F);
  gun.hopperBalls.forEach((b, i) => { b.position.y = 0.1 + Math.sin(now * 9 + i * 2) * 0.006; });
}
function fireGun(H, F) {
  gun.group.updateMatrixWorld(true);
  const p = gun.muzzle.clone().applyMatrix4(gun.group.matrixWorld);
  const hv = H.cols && H.cols[0] ? H.cols[0].v : V();
  const b = makeBall(Math.floor(Math.random() * TYPES.length), BALL_R * rnd(0.9, 1.05), p, F.clone().multiplyScalar(GUN_SPEED).add(hv));
  b.thrownAt = now; b.grow = 0.7; b.w.set(rnd(-8, 8), rnd(-8, 8), rnd(-8, 8));
  // sin pasarse del máximo: se quita la bola más antigua que no esté en una mano
  if (balls.length > MAX_BALLS + 20) { const old = balls.find(o => !o.held && o !== b); if (old) removeBall(old); }
  gun.kick = 1; pulse(H, 0.7, 40); sndShoot(p);
}
function sndShoot(pos) {
  if (!actx) return;
  const t = actx.currentTime, p = panAt(pos);
  tone(p, 420, 'square', 0.12, t, 0.09, 140); noise(p, 0.35, t, 0.07, 1800); tone(p, 90, 'sine', 0.4, t, 0.12, 50);
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
        if (Math.abs(tny) > 0.7 && cpy > floorY + 1.9 && b.prev.y > cpy) continue;   // techo permeable desde arriba
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
  if (p.y > ceilY - r && b.prev.y <= ceilY - r + 0.02) contact(b, 0, -1, 0, p.y - ceilY + r, h, kin);   // solo desde abajo
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
const HR = 0.2, NET_H = 0.25;      // canasta de pared: radio de la boca y profundidad
const BR = 0.51, BH = 0.45;       // canasta de suelo: radio y altura
const BOTTOM_K = 0.82;            // el fondo es un poco más estrecho que la boca
const hoops = [], bins = [], swallowed = [];
const _hz = new THREE.Vector3(0, 0, 1);

// Red de cuerda naranja: rombos de cuerda trenzada con nudos, huecos transparentes
function drawNet(g, w, h) {   // colores de la cuerda según la paleta
  const N = PAL.net; g.clearRect(0, 0, w, h);
  const step = 64, rope = (x0, y0, x1, y1) => {
    g.lineCap = 'round';
    g.strokeStyle = N.o; g.lineWidth = 12; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = N.m; g.lineWidth = 8; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = N.h; g.lineWidth = 2; g.setLineDash([5, 6]); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.setLineDash([]);
  };
  for (let x = -h; x < w + h; x += step) { rope(x, 0, x + h, h); rope(x + h, 0, x, h); }
  g.fillStyle = N.k;
  for (let x = 0; x <= w; x += step) for (let y = 0; y <= h; y += step) { g.beginPath(); g.arc(x + (y / step % 2 ? step / 2 : 0), y, 8, 0, 7); g.fill(); }
}
const netTex = canvasTex(drawNet, 512, 256), netTexList = [];
netTex.wrapT = THREE.RepeatWrapping;
// Diana del fondo
const RINGS = [[0.18, 100, '#b87333'], [0.42, 50, '#ece9e4'], [0.7, 30, '#5b6670'], [1.0, 20, '#2b2d31']];
function drawDiana(g, w, h) {
  const c = w / 2; g.clearRect(0, 0, w, h);
  for (let i = RINGS.length - 1; i >= 0; i--) {
    const [k, , col] = RINGS[i], inner = i ? RINGS[i - 1][0] : 0;
    g.fillStyle = col; g.beginPath(); g.arc(c, c, k * c, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 2; g.beginPath(); g.arc(c, c, (k + inner) / 2 * c, 0, 7); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 4; g.beginPath(); g.arc(c, c, k * c - 2, 0, 7); g.stroke();
  }
  g.strokeStyle = 'rgba(90,96,106,0.6)'; g.lineWidth = 3; g.beginPath(); g.moveTo(c - 12, c); g.lineTo(c + 12, c); g.moveTo(c, c - 12); g.lineTo(c, c + 12); g.stroke();
}
const dianaTex = canvasTex(drawDiana, 512, 512);
// Pared interior: azul profundo, más oscura abajo, con líneas que marcan la profundidad
function insideMat(depth) {
  return new THREE.ShaderMaterial({ uniforms: { uD: { value: depth }, ...PM.inside },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uD, uK; uniform vec3 uA, uB; varying vec2 vUv;
      void main(){
        vec3 c = mix(uA, uB, pow(vUv.y, 0.8));
        float hl = step(0.9, fract(vUv.y * uD / 0.1)), vl = step(0.93, fract(vUv.x * 32.0));
        c *= 1.0 + uK * max(hl, vl);
        gl_FragColor = vec4(c, 1.0); }`,
    side: THREE.BackSide });
}
function netBasket(R, depth) {
  const g = new THREE.Group(), rB = R * BOTTOM_K;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, rB, depth, 64, 1, true), insideMat(depth));
  wall.position.y = -depth / 2;
  const t = netTex.clone(); t.needsUpdate = true; netTexList.push(t); t.repeat.set(Math.round(R * 2 * Math.PI / (8 * 0.09)), depth / (4 * 0.09));   // rombos de ~9 cm
  const net = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.985, rB * 0.985, depth, 64, 1, true),
    new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.85 }));
  net.position.y = -depth / 2;
  const diana = new THREE.Mesh(new THREE.CircleGeometry(rB * 0.98, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: dianaTex, color: 0xe4e4e4 }));
  diana.position.y = -depth + 0.004;
  const under = new THREE.Mesh(new THREE.CircleGeometry(rB, 64).rotateX(Math.PI / 2), PM.plate);
  under.position.y = -depth;
  g.add(wall, net, diana, under);
  return { g, net };
}
function makeHoop(pos, nH) {
  const g = new THREE.Group();
  g.position.copy(pos); g.quaternion.setFromUnitVectors(_hz, nH);
  const orange = PM.rim;   // aro (color de la paleta)
  g.add(new THREE.Mesh(new THREE.TorusGeometry(HR, 0.012, 12, 72).rotateX(Math.PI / 2), orange));
  const { g: nb, net } = netBasket(HR, NET_H); g.add(nb);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 40).rotateX(Math.PI / 2), PM.plate);
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
  for (const c of cands) { if (chosen.length >= 2) break; if (chosen.every(o => o.w.distanceTo(c.w) > 1.5)) chosen.push(c); }
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
          floatText(label, new THREE.Vector3(S.P.c.x, S.P.top + 0.3, S.P.c.z), pts === 100 ? PAL.accent2 : PAL.accent, true);
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

// Mundo detrás de los agujeros: un "ordenador cuántico" de fantasía, blanco y luminoso, con pistas de
// circuito por las que viajan pulsos de luz pastel, chips que respiran y estructuras flotantes.
const matrixU = { uT: { value: 0 }, uBg: { value: new THREE.Color() }, uTrace: { value: new THREE.Color() }, uChip: { value: new THREE.Color() },
  uGlow: { value: new THREE.Color() }, uNode: { value: new THREE.Color() }, uPulse: { value: new THREE.Color() } };
const CIRCUIT_FS = `
uniform float uT, uCell, uDim; uniform vec3 uBg, uTrace, uChip, uGlow, uNode, uPulse; varying vec3 vW; varying vec3 vN;
float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float seg(float d, float w){ return 1.0 - smoothstep(w, w * 1.7, d); }
void main(){
  vec3 n = abs(vN);
  vec2 uv = (n.x > n.y && n.x > n.z) ? vW.zy : ((n.z > n.y) ? vW.xy : vW.xz);
  uv /= uCell;
  vec2 id = floor(uv), f = fract(uv);
  float rowOn = step(0.35, h1(vec2(7.0, id.y))), hy = 0.2 + 0.6 * h1(vec2(3.0, id.y)), hSeg = step(0.28, h1(id + vec2(0.0, 13.0)));
  float H = rowOn * hSeg * seg(abs(f.y - hy), 0.03);
  float colOn = step(0.45, h1(vec2(id.x, 5.0))), vx = 0.2 + 0.6 * h1(vec2(id.x, 9.0)), vSeg = step(0.35, h1(id + vec2(21.0, 0.0)));
  float Vt = colOn * vSeg * seg(abs(f.x - vx), 0.03);
  float cross = rowOn * colOn * hSeg * vSeg, dn = length(f - vec2(vx, hy));
  float node = cross * (1.0 - smoothstep(0.06, 0.085, dn)), ring = cross * seg(abs(dn - 0.13), 0.015);
  float chipOn = step(0.93, h1(id + vec2(31.0, 17.0)));
  vec2 q = abs(f - 0.5); float m = max(q.x, q.y);
  float chip = chipOn * (1.0 - smoothstep(0.26, 0.28, m));
  float pins = chipOn * step(0.29, m) * step(m, 0.37) * step(0.5, fract((q.x > q.y ? f.y : f.x) * 8.0));
  float line = max(max(H, Vt), max(ring, pins));
  float ph = fract(uv.x * 0.12 - uT * (0.25 + 0.35 * h1(vec2(1.0, id.y))) + h1(vec2(2.0, id.y)));
  float pv = fract(uv.y * 0.12 - uT * (0.25 + 0.35 * h1(vec2(id.x, 4.0))) + h1(vec2(id.x, 6.0)));
  float pulse = H * smoothstep(0.9, 1.0, ph) + Vt * smoothstep(0.9, 1.0, pv);
  vec3 c = uBg;
  c = mix(c, uTrace, line * 0.85);
  c = mix(c, uChip, chip);
  c = mix(c, uGlow, chip * (0.5 + 0.5 * sin(uT * 2.0 + h1(id) * 6.28)) * 0.35);
  c = mix(c, uNode, node);
  c = mix(c, uPulse, clamp(pulse, 0.0, 1.0));
  gl_FragColor = vec4(c * uDim, 1.0);
}`;
function circuitMat(cell, dim = 1) {
  return new THREE.ShaderMaterial({ uniforms: { ...matrixU, uCell: { value: cell }, uDim: { value: dim } },
    vertexShader: `varying vec3 vW; varying vec3 vN; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: CIRCUIT_FS, side: THREE.DoubleSide, ...stencilEq });
}
let matrixPts = null;
const matrixObjs = [], quantumSpin = [];
function addQ(o, order) { o.renderOrder = order; scene.add(o); matrixObjs.push(o); return o; }
// "lámpara" de ordenador cuántico: discos plateados apilados, varillas, bobinas pastel y cúbits que brillan
function quantumTower(x, z, scale) {
  if (!PM.tower) { PM.tower = { metal: new THREE.MeshStandardMaterial(stencilEq), coil: new THREE.MeshStandardMaterial(stencilEq), qubit: new THREE.MeshStandardMaterial(stencilEq) }; paintTower(); }
  const g = new THREE.Group(), silver = PM.tower.metal, coil = PM.tower.coil, qubit = PM.tower.qubit;
  let y = 0; const radii = [0.75, 0.62, 0.5, 0.4, 0.3];
  radii.forEach((r, i) => {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.06, 48), silver); disc.position.y = y; g.add(disc);
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2, rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 8), silver); rod.position.set(Math.cos(a) * r * 0.75, y - 0.24, Math.sin(a) * r * 0.75); g.add(rod); }
    const c = new THREE.Mesh(new THREE.TorusGeometry(r * 0.55, 0.018, 8, 40).rotateX(Math.PI / 2), coil); c.position.y = y - 0.2; g.add(c);
    y -= 0.48;
  });
  for (let k = 0; k < 4; k++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), qubit); s.position.set((k - 1.5) * 0.08, y + 0.1, 0); g.add(s); }
  g.position.set(x, floorY + 0.5 + (radii.length * 0.48) * scale + 0.5, z); g.scale.setScalar(scale);
  quantumSpin.push({ g, w: rnd(0.08, 0.2) * (Math.random() < 0.5 ? -1 : 1) });
  return addQ(g, -0.39);
}
function buildMatrix() {
  const c = roomValid ? roomMin.clone().add(roomMax).multiplyScalar(0.5) : headPos.clone(); c.y = floorY;
  addQ(new THREE.Mesh(new THREE.BoxGeometry(44, 24, 44), circuitMat(0.4, 0.97)), -0.4).position.set(c.x, floorY + 6, c.z);
  addQ(new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), circuitMat(0.22, 1.0)), -0.395).position.set(c.x, floorY + 0.002, c.z);
  const half = roomValid ? Math.max(roomMax.x - roomMin.x, roomMax.z - roomMin.z) / 2 : 3;
  for (let i = 0; i < 26; i++) {   // columnas de circuito en profundidad (paralaje)
    const a = rnd(0, Math.PI * 2), d = half + rnd(1.5, 14), s = rnd(0.25, 0.9), hgt = rnd(2.5, 8);
    addQ(new THREE.Mesh(new THREE.BoxGeometry(s, hgt, s), circuitMat(rnd(0.07, 0.12))), -0.39).position.set(c.x + Math.cos(a) * d, floorY + hgt / 2, c.z + Math.sin(a) * d);
  }
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2 + rnd(-0.2, 0.2), d = half + rnd(1.2, 7); quantumTower(c.x + Math.cos(a) * d, c.z + Math.sin(a) * d, rnd(0.6, 1.2)); }
  const N = 700, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const a = rnd(0, Math.PI * 2), d = half + rnd(0.3, 10); pos.set([c.x + Math.cos(a) * d, floorY + rnd(0, 6), c.z + Math.sin(a) * d], i * 3); }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  matrixPts = addQ(new THREE.Points(pg, new THREE.PointsMaterial({ color: PAL.pts, size: 0.03, transparent: true, opacity: 0.8, depthWrite: false, ...stencilEq })), -0.37);
}
function clearMatrix() {
  for (const o of matrixObjs) scene.remove(o);
  matrixObjs.length = 0; quantumSpin.length = 0; matrixPts = null;
}
function updateMatrix(dt) {
  matrixU.uT.value = now;
  if (!holes.length) return;
  for (const q of quantumSpin) q.g.rotation.y += q.w * dt;
  if (matrixPts) {   // chispas que suben despacio
    const a = matrixPts.geometry.attributes.position.array;
    for (let i = 1; i < a.length; i += 3) { a[i] += dt * (0.15 + (i % 5) * 0.05); if (a[i] > floorY + 6) a[i] -= 6; }
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
  ring.forEach(([x, z]) => { const k = rnd(1.1, 1.25); rp.push(x, 0.001, z, x * k, 0.001, z * k); rc.push(...rgb(PAL.holeIn), ...rgb(PAL.holeOut)); });
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
  const cracks = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: PAL.crack, transparent: true, opacity: 0.75 }));
  cracks.renderOrder = 2;
  grp.add(mask, dc, rim, cracks); scene.add(grp);
  const c = new THREE.Vector3().setFromMatrixPosition(grp.matrix);
  holes.push({ P, c, n: P.n.clone(), R, grp, t: now });
  spawnDebris(c, P.n, R); sndCrash(c, R);
  for (const o of balls) if (o.pos.distanceTo(c) < R + 0.3) wake(o);
  for (const H of Object.values(hands)) pulse(H, 1, 120);
}
const chunkGeo = new THREE.IcosahedronGeometry(1, 0), cubeGeo = new THREE.BoxGeometry(1, 1, 1);
const plasterMat = new THREE.MeshStandardMaterial({ color: 0xeceae6, roughness: 0.95, flatShading: true });
const digiMat = new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.85, roughness: 0.3, flatShading: true });
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

// ---------- Menú en la palma izquierda ----------
// Al mirar la palma abierta de la mano izquierda aparece un menú; se pulsa tocándolo con el índice
// derecho (o con el mando derecho). RESET: nueva partida · SCAN: volver a escanear · MUTE: música.
// Debajo, cuatro muestras para elegir la paleta de colores.
const MENU_W = 0.2, MENU_H = 0.145;
const MENU_ITEMS = [
  { id: 'reset', label: 'RESET', x: -0.064, y: 0.012, w: 0.056, h: 0.05 },
  { id: 'scan',  label: 'SCAN',  x: 0,      y: 0.012, w: 0.056, h: 0.05 },
  { id: 'mute',  label: 'MUTE',  x: 0.064,  y: 0.012, w: 0.056, h: 0.05 },
  ...PAL_KEYS.map((k, i) => ({ id: 'pal:' + k, pal: k, x: -0.0675 + i * 0.045, y: -0.046, w: 0.04, h: 0.036 })),
];
const menu = makePanel(MENU_W, MENU_H);
menu.c.width = 800; menu.c.height = 580; menu.mesh.renderOrder = 25;
menu.mesh.material.depthTest = false;
let menuShowT = 0, menuHideT = 0, menuHover = -1, menuPressed = -1, menuFlash = { i: -1, t: 0 }, menuKey = '';
function menuIcon(g, id, cx, cy, s, on) {
  g.strokeStyle = '#3a3f47'; g.fillStyle = '#3a3f47'; g.lineWidth = s * 0.12; g.lineCap = 'round';
  if (id === 'reset') {
    const a0 = Math.PI * 0.15, a1 = Math.PI * 1.75, R = s * 0.4;                // flecha circular
    g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
    const x = cx + Math.cos(a1) * R, y = cy + Math.sin(a1) * R, tx = -Math.sin(a1), ty = Math.cos(a1), nx = Math.cos(a1), ny = Math.sin(a1);
    g.beginPath(); g.moveTo(x + tx * s * 0.22, y + ty * s * 0.22); g.lineTo(x + nx * s * 0.17, y + ny * s * 0.17); g.lineTo(x - nx * s * 0.17, y - ny * s * 0.17); g.closePath(); g.fill();
  } else if (id === 'scan') {
    for (const r of [0.16, 0.32, 0.48]) { g.beginPath(); g.arc(cx, cy, s * r, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
    g.beginPath(); g.arc(cx, cy, s * 0.07, 0, 7); g.fill();
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + s * 0.34, cy - s * 0.34); g.stroke();
  } else {
    g.beginPath(); g.ellipse(cx - s * 0.16, cy + s * 0.26, s * 0.16, s * 0.12, -0.4, 0, 7); g.fill();
    g.beginPath(); g.moveTo(cx - s * 0.02, cy + s * 0.24); g.lineTo(cx - s * 0.02, cy - s * 0.36); g.lineTo(cx + s * 0.3, cy - s * 0.24); g.stroke();
    if (!on) { g.strokeStyle = '#c0533f'; g.lineWidth = s * 0.13; g.beginPath(); g.moveTo(cx - s * 0.42, cy - s * 0.42); g.lineTo(cx + s * 0.42, cy + s * 0.42); g.stroke(); }
  }
}
function drawMenu() {
  const key = [menuHover, menuPressed, menuFlash.i, musicOn, score, balls.length, palKey].join('|'); if (key === menuKey) return; menuKey = key;
  const { g, c } = menu, W = c.width, H = c.height, k = W / MENU_W, px = x => (x / MENU_W + 0.5) * W, py = y => (0.5 - y / MENU_H) * H;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.88)'; g.beginPath(); g.roundRect(2, 2, W - 4, H - 4, 64); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.07)'; g.lineWidth = 2; g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.font = `500 34px ${PANEL_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(`${score} puntos  ·  ${balls.length} bolas`, W / 2, py(0.057));
  g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 2; g.beginPath(); g.moveTo(px(-0.088), py(-0.02)); g.lineTo(px(0.088), py(-0.02)); g.stroke();
  MENU_ITEMS.forEach((b, i) => {
    const x0 = px(b.x - b.w / 2), y0 = py(b.y + b.h / 2), bw = b.w * k, bh = b.h * k;
    const hot = menuHover === i, down = menuPressed === i || menuFlash.i === i;
    g.save(); if (down) { g.translate(x0 + bw / 2, y0 + bh / 2); g.scale(0.94, 0.94); g.translate(-x0 - bw / 2, -y0 - bh / 2); }
    if (b.pal) {                                      // muestra de paleta: tres colores
      const P = PALETTES[b.pal], sel = b.pal === palKey;
      g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(x0, y0, bw, bh, bh * 0.28); g.fill();
      P.swatch.forEach((col, j) => { g.fillStyle = col; g.beginPath(); g.arc(x0 + bw * (0.27 + j * 0.23), y0 + bh / 2, bh * 0.2, 0, 7); g.fill(); });
      g.strokeStyle = sel ? '#2a2d33' : hot ? 'rgba(40,45,52,0.45)' : 'rgba(0,0,0,0.12)'; g.lineWidth = sel ? 7 : 3;
      g.beginPath(); g.roundRect(x0, y0, bw, bh, bh * 0.28); g.stroke();
    } else {
      const active = b.id === 'mute' && !musicOn;
      g.fillStyle = active ? PAL.menuActive : PAL.menuBtn[i]; g.beginPath(); g.roundRect(x0, y0, bw, bh, bh * 0.22); g.fill();
      if (hot || down) { g.strokeStyle = 'rgba(40,45,52,0.55)'; g.lineWidth = 5; g.stroke(); }
      menuIcon(g, b.id, x0 + bw / 2, y0 + bh * 0.4, bh * 0.42, musicOn);
      g.fillStyle = '#3a3f47'; g.font = `600 ${bh * 0.17}px ${PANEL_FONT}`; g.fillText(b.label, x0 + bw / 2, y0 + bh * 0.82);
    }
    g.restore();
  });
  menu.tex.needsUpdate = true;
}
const _mt = new THREE.Vector3(), _mh = new THREE.Vector3();
function updateMenu(dt) {
  const L = hands.left, R = hands.right;
  let want = false;
  if (L && L.ok && L.n && !L.ball && !L.raw && rk.holder !== L && gun.holder !== L) {
    _mh.subVectors(headPos, L.palm).normalize();
    want = L.n.dot(_mh) > 0.6;                       // palma mirando a la cara
  }
  if (want) { menuShowT += dt; menuHideT = 0; } else { menuHideT += dt; menuShowT = 0; }
  if (!menu.mesh.visible && menuShowT > 0.25) {
    menu.mesh.visible = true; menu.mesh.userData.placed = false; if (actx) tone(master, 1320, 'sine', 0.05, actx.currentTime, 0.08);
  }
  if (menu.mesh.visible && menuHideT > 0.4) { menu.mesh.visible = false; menuHover = menuPressed = -1; }
  if (!menu.mesh.visible) return;
  if (L && L.ok && L.n) {   // sobre la palma, mirando a la cabeza
    _mt.copy(L.palm).addScaledVector(L.n, 0.09).add(new THREE.Vector3(0, 0.04, 0));
    menu.mesh.position.lerp(_mt, menu.mesh.userData.placed ? Math.min(1, dt * 14) : 1); menu.mesh.userData.placed = true;
    menu.mesh.lookAt(headPos);
  }
  menu.mesh.updateMatrixWorld();
  menuHover = -1;
  if (R && R.ok && R.tip) {   // pulsar con el índice derecho
    const lp = menu.mesh.worldToLocal(_mt.copy(R.tip));
    MENU_ITEMS.forEach((b, i) => { if (Math.abs(lp.x - b.x) < b.w / 2 && Math.abs(lp.y - b.y) < b.h / 2 && lp.z < 0.04 && lp.z > -0.04) menuHover = i; });
    if (menuHover >= 0 && lp.z < 0.012 && menuPressed < 0 && now - menuFlash.t > 0.5) {
      menuPressed = menuHover; menuFlash = { i: menuHover, t: now };
      if (actx) tone(master, 880, 'sine', 0.12, actx.currentTime, 0.07, 1300); pulse(R, 0.5, 30);
      menuAction(MENU_ITEMS[menuHover]);
    }
    if (menuPressed >= 0 && (menuHover !== menuPressed || lp.z > 0.025)) menuPressed = -1;
  }
  if (menuFlash.i >= 0 && now - menuFlash.t > 0.25) menuFlash.i = -1;
  drawMenu();
}
function menuAction(item) {
  if (item.pal) applyPalette(item.pal);
  else if (item.id === 'mute') setMusic(!musicOn);
  else if (item.id === 'reset') resetGame(true);
  else if (item.id === 'scan') rescan();
}
// Vacía la partida: bolas, agujeros, trozos, raqueta y pistola
function clearGame() {
  for (const b of [...balls]) { if (b.held) b.held.ball = null; removeBall(b); }
  for (const d of drops) if (d.ring) { scene.remove(d.ring); d.ring.material.dispose(); }
  drops.length = 0;
  for (const S of swallowed) scene.remove(S.m); swallowed.length = 0;
  for (const d of debris) scene.remove(d.m); debris.length = 0;
  for (const h of holes) scene.remove(h.grp); holes.length = 0; holeQ.length = 0; goalQ.length = 0; mergeQ.length = 0;
  for (const b of bursts) scene.remove(b.pts); bursts.length = 0;
  rk.holder = null; gun.holder = null; score = 0;
}
function resetGame(rain) {
  clearGame();
  if (rain) {
    for (let i = 0; i < INITIAL_BALLS; i++) queueDrop(now + 0.6 + i * 0.09, i % TYPES.length);
    nextDrop = now + 0.6 + INITIAL_BALLS * 0.09 + rnd(DROP_MIN, DROP_MAX);
    showInfo(['Nueva partida', '¡Llueven pelotas!'], 3);
  }
}
// Vuelve a escanear la habitación: borra la geometría conocida, canastas y mundo cuántico, y repite el escaneo
function rescan() {
  clearGame(); nextDrop = Infinity;
  for (const H of hoops) scene.remove(H.g); hoops.length = 0;
  for (const B of bins) scene.remove(B.g); bins.length = 0;
  clearMatrix();
  setOcclusion(false);
  for (const d of planes.values()) scene.remove(d.vis, d.occ); planes.clear();
  for (const d of meshes.values()) scene.remove(d.wire, d.occ); meshes.clear();
  virtualPlanes = []; virtualRoom = false; colPlanes = []; worldDirty = true;
  scanVisible = true; scanFade = 1; scanUniforms.uA.value = 1;
  state = 'scan'; scanT0 = -1; foundAt = 0; roomCaptureTried = true;
  menu.mesh.visible = false;
  const s = renderer.xr.getSession();
  if (s && s.initiateRoomCapture) s.initiateRoomCapture().catch(e => console.warn('[bolas] initiateRoomCapture', e));
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
    updateGun(dt);
    updateMenu(dt);
    racketVsWalls(dt);
    updateHeld(dt);
    physics(dt);
    processGoals();
    processHoles();
    for (const b of [...balls]) if (b.inMatrix && now - b.inMatrix > 2.5) {   // absorbida por Matrix
      score += 5; burst(b.pos, PAL.accent, b.r); removeBall(b);
    }
    updateProps(dt); updateDebris(dt); updateMatrix(dt);
    const L = hands.left;   // panel de muñeca
    if (L && L.ok && L.wrist && rk.holder !== L && !menu.mesh.visible) {
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

// ---------- Aplicar una paleta ----------
function paintTower() {
  if (!PM.tower) return;
  const T = PAL.tower; setMat(PM.tower.metal, T.metal); setMat(PM.tower.coil, T.coil);
  PM.tower.qubit.color.setHex(T.qubit.c); PM.tower.qubit.emissive.setHex(T.qubit.e); PM.tower.qubit.emissiveIntensity = T.qubit.ei;
}
function applyPalette(key) {
  PAL = PALETTES[key] || PALETTES.nordico; palKey = PALETTES[key] ? key : 'nordico';
  try { localStorage.setItem(PAL_STORE, palKey); } catch (e) {}
  PAL.balls.forEach((B, i) => {
    const m = TYPES[i].mat, old = m.map;
    m.map = ballTex(B); setMat(m, { c: 0xffffff, metal: B.metal, rough: B.rough, clear: B.clear }); m.needsUpdate = true;
    if (old) old.dispose();
    TYPE_COLORS[i] = PAL.fx[i];
  });
  setMat(PM.rim, PAL.rim); setMat(PM.plate, PAL.plate);
  setMat(PM.gunBody, PAL.gun.body); setMat(PM.gunBarrel, PAL.gun.barrel); setMat(PM.gunDetail, PAL.gun.detail); setMat(PM.gunDark, PAL.gun.dark);
  setMat(PM.rkFrame, PAL.racket.frame); setMat(PM.rkHandle, PAL.racket.handle); PM.rkStrings.color.setHex(PAL.racket.strings);
  const raw = THREE.LinearSRGBColorSpace;   // los shaders propios usan el color tal cual (sin conversión)
  PM.inside.uA.value.setHex(PAL.inside[0], raw); PM.inside.uB.value.setHex(PAL.inside[1], raw); PM.inside.uK.value = PAL.inside[2];
  drawNet(netTex.image.getContext('2d'), netTex.image.width, netTex.image.height); netTex.needsUpdate = true; for (const t of netTexList) t.needsUpdate = true;
  PAL.rings.forEach((c, i) => { RINGS[i][2] = c; });
  drawDiana(dianaTex.image.getContext('2d'), dianaTex.image.width, dianaTex.image.height); dianaTex.needsUpdate = true;
  const Q = PAL.q; matrixU.uBg.value.setHex(Q.bg, raw); matrixU.uTrace.value.setHex(Q.trace, raw); matrixU.uChip.value.setHex(Q.chip, raw);
  matrixU.uGlow.value.setHex(Q.glow, raw); matrixU.uNode.value.setHex(Q.node, raw); matrixU.uPulse.value.setHex(Q.pulse, raw);
  paintTower(); if (matrixPts) matrixPts.material.color.setHex(PAL.pts);
  setMat(digiMat, PAL.digi); pullLine.material.color.setHex(PAL.accent);
  HOW_BALL = PAL.how[0]; HOW_RK = PAL.how[1];
  menuKey = '';
}
// ---------- Arranque ----------
// En el navegador: botón «Empezar en RA». Como aplicación instalada (APK en modo inmersivo) la sesión
// de RA se pide sola al abrir; si el sistema exige un gesto, queda el botón como respaldo.
const btn = document.getElementById('go'), msg = document.getElementById('msg');
const IS_APP = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;
const xrLog = [];
let starting = false;
async function startAR(auto) {
  if (starting || state !== 'intro') return; starting = true;
  initAudio(); actx.resume().catch(() => {});
  try {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking', 'plane-detection', 'mesh-detection', 'anchors'],
    });
    await renderer.xr.setSession(session);
    document.getElementById('intro').style.display = 'none';
    state = 'scan'; scanT0 = -1; foundAt = 0; lastT = 0;
    startMusic();
    xrLog.push((auto ? 'auto' : 'botón') + ': sesión iniciada');
    session.addEventListener('end', () => { if (IS_APP) sessionStorage.setItem('bolas-fin', '1'); location.reload(); });
    // el audio puede quedar suspendido sin gesto: se reanuda con la primera interacción
    session.addEventListener('selectstart', () => actx.resume().catch(() => {}), { once: true });
  } catch (e) {
    xrLog.push((auto ? 'auto' : 'botón') + ': ' + e.name + ' ' + e.message);
    console.warn('[bolas]', e);
    if (!auto) msg.textContent = 'No se pudo iniciar la realidad mixta.';
  }
  starting = false;
}
async function check() {
  if (!navigator.xr) { btn.textContent = 'WebXR no disponible'; msg.textContent = 'Abre esta página en el navegador de la Meta Quest 3.'; return; }
  const ok = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  xrLog.push('app=' + IS_APP + ' immersive-ar=' + ok);
  btn.disabled = false; btn.textContent = 'Empezar en RA';
  if (IS_APP && !sessionStorage.getItem('bolas-fin')) startAR(true);   // como app: directa a la RA
  else if (!ok) msg.textContent = 'Este navegador no parece admitir realidad mixta; puedes intentarlo igualmente.';
}
btn.addEventListener('click', () => startAR(false));
window.__bolas = { menu, gun, ceilingAt, xrLog, hands, balls, rk, gest, lastThrows, hoops, bins, holes, debris, get score() { return score; }, get state() { return state; },
  get floorY() { return floorY; }, get ceilY() { return ceilY; }, get room() { return roomValid ? [roomMin.toArray(), roomMax.toArray()] : null; } };
applyPalette(palKey);
renderer.setAnimationLoop(loop);
check();
