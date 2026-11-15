// AlgoWorld: a world explored by zooming, where the zoom closes into a loop.
// planet -> landscape -> grove -> surface -> cell -> planet -> ...
(function () {
  'use strict';
  const S = window.SHADERS;
  const TYPES = ['planet', 'landscape', 'grove', 'surface', 'cell'];
  const NAMES = ['Planet', 'Landscape', 'Grove', 'Bark', 'Cell'];
  const LAWS = [
    'standing waves on a sphere',
    'slime-mould rivers on fractal terrain',
    'chiral fractal trees, crystals in the clearings',
    'reaction-diffusion slime, pumped by a travelling wave',
    'excitable medium over the heartbeat checkerboard'];
  const Z = 8;                 // magnification per level
  const FADE0 = 0.68;          // child starts to appear at this fraction of a level
  const params = new URLSearchParams(location.search);
  const FAST = params.has('fast');

  const canvas = document.getElementById('gl');
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  const $ = id => document.getElementById(id);
  if (!gl) { $('fatal').hidden = false; $('fatal').textContent = 'This world needs WebGL 2, which this browser or device does not offer.'; return; }
  const extF = gl.getExtension('EXT_color_buffer_float');
  const extH = gl.getExtension('EXT_color_buffer_half_float');
  if (!extF && !extH) { $('fatal').hidden = false; $('fatal').textContent = 'This world needs float render targets, which this device does not offer.'; return; }
  gl.getExtension('OES_texture_float_linear');

  // ------------------------------------------------------------ GL helpers
  function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); console.error(log, src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n')); throw new Error(log); } return s; }
  function prog(fs, vs) { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs || S.vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); } return { p, u }; }
  const vao = gl.createVertexArray();
  function tex(w, h, ifmt, fmt, type, filter, data, mip) { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data || null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT); return t; }
  function fbo(t) { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return f; }
  function pair(w, h, ifmt, filter, mip) { const o = { t: [], f: [], i: 0, w, h }; for (let k = 0; k < 2; k++) { o.t[k] = tex(w, h, ifmt, gl.RGBA, gl.FLOAT, filter, null, mip); o.f[k] = fbo(o.t[k]); } return o; }
  function bindTex(unit, t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); }
  function quad() { gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3); }

  const P = {}; for (const t of TYPES) P[t] = prog(S[t]);
  const PG = { agent: prog(S.physAgent), point: prog(S.physPointFS, S.physPointVS), diff: prog(S.physDiffuse), gs: prog(S.gs), ex: prog(S.ex) };
  const AGF = extF ? gl.RGBA32F : gl.RGBA16F;
  const sim = {
    ag: pair(256, 256, AGF, gl.NEAREST), tr: pair(512, 512, gl.RGBA16F, gl.LINEAR, true),
    gs: pair(512, 512, gl.RGBA16F, gl.LINEAR), ex: pair(512, 512, gl.RGBA16F, gl.LINEAR),
    tree: tex(4, 4, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, null, true)
  };
  const probeTex = tex(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST); const probeFbo = fbo(probeTex);

  // ------------------------------------------------------------ randomness
  function rng(seed) { let a = (seed * 1e6) >>> 0 || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash3(a, b, c) { let h = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453; return (h - Math.floor(h)) * 997; }

  // ------------------------------------------------------------ world state
  const links = [true, true, true, true, true, true];   // 0..4: into level type k; 5: place -> heartbeat
  const ecg = new window.ECG(); let pulse = 0, pulseS = 0, clock = 0, ecgAcc = 0, beatEdge = false; const trace = new Float32Array(160); let tracePos = 0;
  let rootSeed = Math.floor(Math.random() * 99999) + 1;
  let frames = [], z = 0, lastPan = 0, auto = false, simTime = 0;

  function newFrame(d, seed, center, Pv, cell) {
    const fr = { d, type: d % 5, seed, center: center.slice(), P: Pv.slice(), cell, born: performance.now() };
    fr.hue = (hash3(seed, 3.3, 1.1) / 997 - 0.5) * 0.5; return fr;
  }
  function cellOf(fr) { return Math.floor(fr.center[0] * 8) + ',' + Math.floor(fr.center[1] * 8); }
  const fract = x => x - Math.floor(x);

  // ------------------------------------------------------------ simulations
  function initSim(fr) {
    const r = rng(fr.seed + 0.123), ty = fr.type; fr.ph = 0;
    if (ty === 1) {
      const n = 256 * 256, a = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { a[i * 4] = r(); a[i * 4 + 1] = r(); a[i * 4 + 2] = r() * 6.2832; a[i * 4 + 3] = 1; }
      for (let k = 0; k < 2; k++) { gl.bindTexture(gl.TEXTURE_2D, sim.ag.t[k]); gl.texImage2D(gl.TEXTURE_2D, 0, AGF, 256, 256, 0, gl.RGBA, gl.FLOAT, a);
        gl.bindFramebuffer(gl.FRAMEBUFFER, sim.tr.f[k]); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.bindTexture(gl.TEXTURE_2D, sim.tr.t[k]); gl.generateMipmap(gl.TEXTURE_2D); }
      stepPhys(fr, FAST ? 30 : 110);
    } else if (ty === 2) {
      growTrees(fr);
    } else if (ty === 3) {
      const N = 512, a = new Float32Array(N * N * 4);
      for (let i = 0; i < N * N; i++) { a[i * 4] = 1; a[i * 4 + 3] = 1; }
      const blobs = 60 + Math.floor(fr.P[0] * 120);
      for (let b = 0; b < blobs; b++) { const cx = Math.floor(r() * N), cy = Math.floor(r() * N), rad = 3 + Math.floor(r() * 5);
        for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad) { const j = (((cy + y + N) % N) * N + (cx + x + N) % N) * 4; a[j] = 0.5; a[j + 1] = 0.25 + 0.1 * r(); } }
      for (let k = 0; k < 2; k++) { gl.bindTexture(gl.TEXTURE_2D, sim.gs.t[k]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, N, N, 0, gl.RGBA, gl.FLOAT, a); }
      const ang = r() * 6.2832, kk = 2 + Math.floor(r() * 3), sgn = fr.P[2] >= 0.5 ? 1 : -1;
      fr.K = [Math.round(Math.cos(ang) * kk), Math.round(Math.sin(ang) * kk) * sgn]; if (!fr.K[0] && !fr.K[1]) fr.K[0] = 2;
      fr.F = 0.026 + 0.03 * fr.P[0]; fr.Kk = 0.057 + 0.004 * fr.P[0] + 0.0045 * fr.P[1];
      stepGS(fr, FAST ? 150 : 900);
    } else if (ty === 4) {
      const N = 512, a = new Float32Array(N * N * 4), G = 16, cells = [];
      for (let i = 0; i < G * G; i++) cells.push([r() < 0.3 ? 1 : 0, r() * 0.9]);
      const flip = fr.P[2] >= 0.5;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const xx = flip ? N - 1 - x : x; const c = cells[Math.floor(y / N * G) * G + Math.floor(xx / N * G)]; const j = (y * N + x) * 4;
        a[j] = c[0]; a[j + 1] = c[1] * ((xx % (N / G)) / (N / G)); a[j + 3] = 1; }
      for (let k = 0; k < 2; k++) { gl.bindTexture(gl.TEXTURE_2D, sim.ex.t[k]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, N, N, 0, gl.RGBA, gl.FLOAT, a); }
      fr.B = 0.085 - 0.06 * fr.P[0];
      stepEx(fr, FAST ? 40 : 160, false);
    }
  }
  function stepPhys(fr, n) {
    gl.bindVertexArray(vao);
    for (let s = 0; s < n; s++) {
      const a = sim.ag, t = sim.tr;
      gl.disable(gl.BLEND); gl.viewport(0, 0, 256, 256); gl.bindFramebuffer(gl.FRAMEBUFFER, a.f[1 - a.i]); gl.useProgram(PG.agent.p);
      bindTex(0, a.t[a.i]); bindTex(1, t.t[t.i]); gl.uniform1i(PG.agent.u.uAg, 0); gl.uniform1i(PG.agent.u.uTrail, 1);
      gl.uniform1f(PG.agent.u.uSeed, fr.seed); gl.uniform1f(PG.agent.u.uTime, simTime += 0.37); gl.uniform4fv(PG.agent.u.uP, fr.P); quad(); a.i = 1 - a.i;
      gl.viewport(0, 0, 512, 512); gl.bindFramebuffer(gl.FRAMEBUFFER, t.f[t.i]); gl.useProgram(PG.point.p); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      bindTex(0, a.t[a.i]); gl.uniform1i(PG.point.u.uAg, 0); gl.uniform1f(PG.point.u.uDep, 0.22);
      gl.drawArrays(gl.POINTS, 0, Math.floor(65536 * (0.3 + 0.7 * fr.P[0]))); gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.f[1 - t.i]); gl.useProgram(PG.diff.p); bindTex(0, t.t[t.i]); gl.uniform1i(PG.diff.u.uTrail, 0); quad(); t.i = 1 - t.i;
    }
    gl.bindTexture(gl.TEXTURE_2D, sim.tr.t[sim.tr.i]); gl.generateMipmap(gl.TEXTURE_2D);
  }
  function stepGS(fr, n) {
    const g = sim.gs; gl.disable(gl.BLEND); gl.viewport(0, 0, 512, 512); gl.useProgram(PG.gs.p);
    gl.uniform1f(PG.gs.u.uF, fr.F); gl.uniform1f(PG.gs.u.uKk, fr.Kk); gl.uniform2f(PG.gs.u.uK, fr.K[0], fr.K[1]); gl.uniform1i(PG.gs.u.uS, 0);
    for (let s = 0; s < n; s++) { fr.ph = (fr.ph || 0) + 0.006 * (0.5 + pulseS); gl.uniform1f(PG.gs.u.uPh, fr.ph);
      gl.bindFramebuffer(gl.FRAMEBUFFER, g.f[1 - g.i]); bindTex(0, g.t[g.i]); quad(); g.i = 1 - g.i; }
  }
  function stepEx(fr, n, stim) {
    const g = sim.ex; gl.disable(gl.BLEND); gl.viewport(0, 0, 512, 512); gl.useProgram(PG.ex.p);
    gl.uniform1f(PG.ex.u.uB, fr.B); gl.uniform1f(PG.ex.u.uSeed, fr.seed); gl.uniform1i(PG.ex.u.uS, 0);
    for (let s = 0; s < n; s++) { gl.uniform1f(PG.ex.u.uStim, stim && s === 0 ? 1 : 0); gl.bindFramebuffer(gl.FRAMEBUFFER, g.f[1 - g.i]); bindTex(0, g.t[g.i]); quad(); g.i = 1 - g.i; }
  }
  const owner = {};
  function own(fr) { if (fr.type && owner[fr.type] !== fr) { owner[fr.type] = fr; initSim(fr); } }
  function stepSim(fr) {
    own(fr);
    if (fr.type === 1) stepPhys(fr, 2); else if (fr.type === 3) stepGS(fr, 10); else if (fr.type === 4) { stepEx(fr, 3, beatEdge); }
  }

  // Trees: chiral fractals drawn into a canvas. Each branching decision is
  // rotated by the handed-down skew, so a whole grove shares one handedness.
  const treeCanvas = document.createElement('canvas'); treeCanvas.width = treeCanvas.height = FAST ? 1024 : 2048;
  function growTrees(fr) {
    const N = treeCanvas.width, c = treeCanvas.getContext('2d'), r = rng(fr.seed + 0.5), m = fr.P[0], skew = (fr.P[2] - 0.5) * 1.3;
    c.globalCompositeOperation = 'source-over'; c.fillStyle = '#000'; c.fillRect(0, 0, N, N); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
    const wood = [], leaves = [], vines = [];
    function branch(x, y, a, len, w, dep) {
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len; wood.push([x, y, x2, y2, w]);
      if (dep <= 0 || w < 0.0005) { leaves.push([x2, y2, len * (1.3 + r())]); return; }
      if (dep < 3) leaves.push([x2, y2, len * 0.7]);
      const kids = r() < 0.25 ? 3 : 2, spread = 0.42 + r() * 0.3;
      for (let k = 0; k < kids; k++) { const off = (k - (kids - 1) / 2) * spread * 2 / Math.max(1, kids - 1) + skew * 0.55 + (r() - 0.5) * 0.25;
        branch(x2, y2, a + off, len * (0.66 + r() * 0.14), w * 0.68, dep - 1); }
    }
    const count = 9 + Math.round(24 * m); const trunks = [];
    for (let t = 0; t < count; t++) { const x = r(), y = r(), big = 0.6 + r() * 0.8, limbs = 5 + Math.floor(r() * 3), a0 = r() * 6.2832; trunks.push([x, y]);
      wood.push([x, y, x + 1e-4, y, 0.009 * big]);
      for (let l = 0; l < limbs; l++) branch(x, y, a0 + l * 6.2832 / limbs + (r() - 0.5) * 0.3, 0.027 * big, 0.0042 * big, 6); }
    const nv = Math.round(m * m * 10);
    for (let v = 0; v < nv; v++) { const a = trunks[Math.floor(r() * trunks.length)]; let x = a[0], y = a[1], ang = r() * 6.2832; const pts = [[x, y]];
      for (let s = 0; s < 90; s++) { ang += skew * 0.12 + (r() - 0.5) * 0.7 + 0.25 * Math.sin(s * 0.5); x += Math.cos(ang) * 0.006; y += Math.sin(ang) * 0.006; pts.push([x, y]); } vines.push(pts); }
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      c.strokeStyle = 'rgb(255,0,0)';
      for (const s of wood) { if (Math.max(s[0], s[2]) + ox < -0.1 || Math.min(s[0], s[2]) + ox > 1.1 || Math.max(s[1], s[3]) + oy < -0.1 || Math.min(s[1], s[3]) + oy > 1.1) continue;
        c.lineWidth = Math.max(1.6, s[4] * N * 2); c.beginPath(); c.moveTo((s[0] + ox) * N, (s[1] + oy) * N); c.lineTo((s[2] + ox) * N, (s[3] + oy) * N); c.stroke(); }
      for (const l of leaves) { const x = (l[0] + ox) * N, y = (l[1] + oy) * N, rad = l[2] * N; if (x < -rad || x > N + rad || y < -rad || y > N + rad) continue;
        const g = c.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, 'rgba(0,255,0,0.3)'); g.addColorStop(1, 'rgba(0,255,0,0)'); c.fillStyle = g; c.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
      c.strokeStyle = 'rgb(0,0,255)'; c.lineWidth = Math.max(1.5, N * 0.0016);
      for (const pts of vines) { c.beginPath(); c.moveTo((pts[0][0] + ox) * N, (pts[0][1] + oy) * N); for (const q of pts) c.lineTo((q[0] + ox) * N, (q[1] + oy) * N); c.stroke(); }
    }
    gl.bindTexture(gl.TEXTURE_2D, sim.tree); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, treeCanvas); gl.generateMipmap(gl.TEXTURE_2D);
  }

  // ------------------------------------------------------------ drawing
  function setCommon(pr, fr, scale, alpha, w, h, probe) {
    const u = pr.u; gl.useProgram(pr.p);
    gl.uniform2f(u.uRes, w, h); gl.uniform2f(u.uCenter, fr.center[0], fr.center[1]); gl.uniform1f(u.uScale, scale);
    gl.uniform1f(u.uTime, performance.now() / 1000 % 3600); gl.uniform1f(u.uSeed, fr.seed); gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uPulse, links[0] || fr.type !== 0 ? pulseS : 0.5); gl.uniform1f(u.uClock, clock + fr.seed); gl.uniform1f(u.uHue, fr.hue);
    gl.uniform4fv(u.uP, fr.P); gl.uniform1i(u.uProbe, probe ? 1 : 0);
    if (fr.type === 1) { bindTex(0, sim.tr.t[sim.tr.i]); gl.uniform1i(u.uTrail, 0); }
    if (fr.type === 2) { bindTex(0, sim.tree); gl.uniform1i(u.uTree, 0); }
    if (fr.type === 3) { bindTex(0, sim.gs.t[sim.gs.i]); gl.uniform1i(u.uGS, 0); gl.uniform2f(u.uK, fr.K[0], fr.K[1]); gl.uniform1f(u.uPh, fr.ph || 0); }
    if (fr.type === 4) { bindTex(0, sim.ex.t[sim.ex.i]); gl.uniform1i(u.uEx, 0); gl.uniform1f(u.uSq, Math.min(1, Math.abs(ecg.sq) / 85)); }
  }
  function draw(fr, scale, alpha) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
    if (alpha < 1 || fr.type === 0) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); } else gl.disable(gl.BLEND);
    setCommon(P[TYPES[fr.type]], fr, scale, alpha, canvas.width, canvas.height, false); quad();
  }
  const pix = new Uint8Array(4);
  function probe(fr) {
    own(fr);
    gl.disable(gl.BLEND); gl.bindFramebuffer(gl.FRAMEBUFFER, probeFbo); gl.viewport(0, 0, 1, 1);
    setCommon(P[TYPES[fr.type]], fr, Z, 1, 1, 1, true); quad(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pix);
    return [pix[0] / 255, pix[1] / 255, pix[2] / 255, pix[3] / 255];
  }

  // ------------------------------------------------------------ frames
  function makeChild(d) {
    const par = frames[d], cell = cellOf(par);
    const ci = cell.split(',').map(Number);
    const seed = hash3(par.seed, ci[0] + 0.31, ci[1] + 0.77) + 0.01;
    const ty = (d + 1) % 5;
    const Pv = links[ty] ? probe(par) : [0.5, 0.5, 0.5, 0.5];
    const ch = newFrame(d + 1, seed, [fract(par.center[0] * 8), fract(par.center[1] * 8)], Pv, cell);
    if (ty === 0) ch.center[1] = 0.25 + 0.5 * ch.center[1];
    ch.parentSeed = par.seed; ch.raw = links[ty];
    frames.length = d + 1; frames[d + 1] = ch; own(ch); return ch;
  }
  function ensureChild(d, frac) {
    const par = frames[d], ch = frames[d + 1];
    if (!ch || ch.parentSeed !== par.seed) return makeChild(d);
    if (frac < FADE0 && (ch.cell !== cellOf(par) || ch.raw !== links[ch.type]) && performance.now() - lastPan > 140) return makeChild(d);
    return ch;
  }
  function reset(seed) {
    rootSeed = seed; frames = [newFrame(0, hash3(seed, 1.7, 2.9) + 0.01, [0.5, 0.5], [0.5, 0.5, 0.5, 0.5], 'root')]; z = -0.25; clock = hash3(seed, 9, 4) * 0.05; }

  // ------------------------------------------------------------ address
  function writeHash() {
    const d = Math.max(0, Math.floor(z));
    const p = frames.slice(0, d + 1).map(f => f.center[0].toFixed(5) + ',' + f.center[1].toFixed(5)).join(';');
    history.replaceState(null, '', '#w=' + rootSeed + '&z=' + z.toFixed(3) + '&c=' + clock.toFixed(2) + '&p=' + p);
  }
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1)); if (!h.get('w')) return false;
    reset(parseInt(h.get('w'), 10) || 1); clock = parseFloat(h.get('c')) || clock;
    const pts = (h.get('p') || '').split(';').filter(Boolean).map(s => s.split(',').map(Number));
    const zz = parseFloat(h.get('z')) || 0;
    for (let d = 0; d < pts.length; d++) { if (pts[d].length === 2 && pts[d].every(isFinite)) frames[d].center = pts[d]; if (d < pts.length - 1) makeChild(d); }
    z = Math.min(zz, pts.length - 1 + 0.999); return true;
  }

  // ------------------------------------------------------------ input
  function pan(dx, dy) {
    const d = Math.max(0, Math.floor(z)), frac = z - Math.floor(z), s = z < 0 ? Math.pow(Z, z) : Math.pow(Z, frac), H = canvas.clientHeight;
    const fr = frames[d]; lastPan = performance.now();
    function move(f, sc) {
      if (f.type === 0) { const lat = (f.center[1] - 0.5) * 3.0, k = 1 / (0.40 * sc * H);
        f.center[0] = fract(f.center[0] - dx * k / 6.2832 / Math.max(0.25, Math.cos(lat))); f.center[1] = Math.min(0.98, Math.max(0.02, f.center[1] - dy * k / 3.0 * -1)); }
      else { f.center[0] = fract(f.center[0] - dx / H * 0.5 / sc); f.center[1] = fract(f.center[1] + dy / H * 0.5 / sc); }
    }
    move(fr, s);
    const ch = frames[d + 1]; if (ch && frac >= FADE0 && z >= 0) move(ch, s / Z);
  }
  function zoom(dz, mx, my) {
    const before = z; z = Math.max(-0.6, z + dz);
    if (mx !== undefined && z > 0 && Math.floor(before) === Math.floor(z)) {
      const s0 = Math.pow(Z, before - Math.floor(before)), s1 = Math.pow(Z, z - Math.floor(z)), H = canvas.clientHeight, W = canvas.clientWidth;
      const ox = mx - W / 2, oy = my - H / 2, k = (s1 / s0 - 1); const keep = lastPan; pan(-ox * k, -oy * k); lastPan = keep;
    }
  }
  let drag = null; const touches = new Map(); let pinch = 0;
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); touches.set(e.pointerId, [e.clientX, e.clientY]); drag = [e.clientX, e.clientY]; pinch = 0; auto = false; syncUI(); });
  canvas.addEventListener('pointermove', e => { if (!touches.has(e.pointerId)) return; touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.size === 2) { const t = [...touches.values()], dist = Math.hypot(t[0][0] - t[1][0], t[0][1] - t[1][1]); if (pinch) zoom(Math.log(dist / pinch) / Math.log(Z), (t[0][0] + t[1][0]) / 2, (t[0][1] + t[1][1]) / 2); pinch = dist; }
    else if (drag) { pan(e.clientX - drag[0], e.clientY - drag[1]); drag = [e.clientX, e.clientY]; } });
  const up = e => { touches.delete(e.pointerId); drag = null; pinch = 0; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); auto = false; syncUI(); zoom(-e.deltaY * (e.deltaMode ? 0.03 : 0.0011), e.clientX, e.clientY); }, { passive: false });
  canvas.addEventListener('dblclick', e => zoom(0.35, e.clientX, e.clientY));
  window.addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; const k = e.key;
    if (k === '+' || k === '=') zoom(0.12); else if (k === '-') zoom(-0.12); else if (k === 'ArrowLeft') pan(40, 0); else if (k === 'ArrowRight') pan(-40, 0);
    else if (k === 'ArrowUp') pan(0, 40); else if (k === 'ArrowDown') pan(0, -40); else if (k === ' ') { auto = !auto; syncUI(); e.preventDefault(); } });

  // ------------------------------------------------------------ UI
  const linkNames = ['Heartbeat → planet (clock and tide)', 'Planet → landscape', 'Landscape → grove', 'Grove → bark', 'Bark → cell', 'Place → heartbeat'];
  const lk = $('links');
  linkNames.forEach((n, i) => { const l = document.createElement('label'); l.innerHTML = '<input type="checkbox" checked> <span></span>'; l.lastChild.textContent = n;
    l.firstChild.addEventListener('change', e => { links[i] = e.target.checked; }); lk.appendChild(l); });
  function syncUI() { $('dive').textContent = auto ? 'Stop diving' : 'Dive'; $('dive').setAttribute('aria-pressed', auto); }
  $('dive').onclick = () => { auto = !auto; syncUI(); };
  $('new').onclick = () => { reset(Math.floor(Math.random() * 99999) + 1); };
  $('copy').onclick = async () => { writeHash(); try { await navigator.clipboard.writeText(location.href); $('copy').textContent = 'Link copied'; } catch (e) { $('copy').textContent = 'Copy from the address bar'; } setTimeout(() => $('copy').textContent = 'Copy link to this place', 1800); };
  $('more').onclick = () => { const p = $('panel'); p.hidden = !p.hidden; $('more').setAttribute('aria-expanded', !p.hidden); };
  const tc = $('trace').getContext('2d');
  function drawTrace() { const w = 160, h = 34; tc.clearRect(0, 0, w, h); tc.strokeStyle = 'rgba(255,255,255,.85)'; tc.lineWidth = 1.3; tc.beginPath();
    for (let i = 0; i < 160; i++) { const v = trace[(tracePos + i) % 160], y = h - 3 - v * (h - 6); if (i) tc.lineTo(i, y); else tc.moveTo(i, y); } tc.stroke(); }
  let lastUI = 0;
  function updateUI(cur, now) {
    if (now - lastUI < 200) return; lastUI = now;
    $('lvl').textContent = NAMES[cur.type]; $('law').textContent = LAWS[cur.type];
    $('depth').textContent = 'depth ' + cur.d + (cur.d >= 5 ? ' · lap ' + (Math.floor(cur.d / 5) + 1) : '');
    const lab = ['moisture', 'stress', 'handedness', 'rhythm'];
    $('nums').innerHTML = cur.d === 0 ? '<span>nothing handed down: this is the root</span>' : lab.map((l, i) => '<span>' + l + ' <b>' + cur.P[i].toFixed(2) + '</b></span>').join('');
    $('fps').textContent = Math.round(fpsS) + ' fps';
    drawTrace(); writeHash();
  }

  // ------------------------------------------------------------ main loop
  let resScale = 1, fpsS = 60, slow = 0, lastT = performance.now();
  function resize() { const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * resScale; const w = Math.max(2, Math.floor(canvas.clientWidth * dpr)), h = Math.max(2, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } }
  function frame(now) {
    const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now; fpsS += (1 / Math.max(dt, 1e-3) - fpsS) * 0.05;
    if (!FAST) { if (fpsS < 38) slow++; else slow = Math.max(0, slow - 1); if (slow > 150 && resScale > 0.5) { resScale -= 0.25; slow = 0; } }
    resize();
    // heartbeat: the ECG loop at 20 ticks a second
    ecgAcc += dt; beatEdge = false;
    while (ecgAcc > 0.05) { ecgAcc -= 0.05; const prev = pulse; pulse = Math.min(1, Math.max(0, (ecg.tick() + 0.45) / 2.05)); if (pulse > 0.6 && prev <= 0.6) beatEdge = true; trace[tracePos] = pulse; tracePos = (tracePos + 1) % 160; }
    pulseS += (pulse - pulseS) * Math.min(1, dt * 9);
    clock += dt * (links[0] ? 0.015 + 0.11 * pulseS : 0.06);
    if (auto) z += dt * 0.16;
    const d = Math.max(0, Math.floor(z)), frac = z < 0 ? 0 : z - d, s = z < 0 ? Math.pow(Z, z) : Math.pow(Z, frac);
    while (frames.length <= d) makeChild(frames.length - 1);
    const cur = frames[d];
    ecg.setpointMod = links[5] && cur.d > 0 ? 0.2 + 1.6 * cur.P[3] : 1.0;
    let ch = null; if (frac > 0.5) ch = ensureChild(d, frac);
    stepSim(cur); if (ch) stepSim(ch);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0.01, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    draw(cur, s, 1);
    if (ch && frac > FADE0) { const a = (frac - FADE0) / (1 - FADE0); draw(ch, s / Z, a * a * (3 - 2 * a)); }
    updateUI(cur, now);
    requestAnimationFrame(frame);
  }
  if (!readHash()) reset(rootSeed);
  syncUI();
  window.ALGO = { get z() { return z; }, set z(v) { z = v; }, frames: () => frames, links, ecg, pan, get fps() { return fpsS; } };
  requestAnimationFrame(frame);
})();
