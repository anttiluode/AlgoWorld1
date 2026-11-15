// The PerceptionLab "ECG accident" (ecg.json, 14 Feb 2026) as a plain function.
// coupler -> checkerboard -> image-to-vector -> splitter -> coupler, with the
// host's one-tick delay on every edge. Ported from coupler.py (edge_of_chaos
// mode), checkerboardnode.py, imagetovectornode.py and vectorsplitternode.py.
// With the saved settings the coupler output repeats every 59 ticks.
(function (root) {
  function ECG() {
    this.setpoint = 0.5; this.sharp = 3.0; this.targetVar = 0.1; this.win = 50;
    this.setpointMod = 1.0;           // the Constant Signal node (value 1.0)
    this.hist = [];
    this.out = 0; this.img = null; this.vec = new Float32Array(256); this.split = [0, 0, 0, 0];
    this.sq = 10; this.regime = 0; this.t = 0;
    this._img = new Uint8Array(256 * 256);
  }
  ECG.prototype.tick = function () {
    // transfer previous outputs along edges
    const cIn = this.split[0] + this.split[1] + this.split[2] + this.split[3];
    const kIn = this.out, vIn = this.img, sIn = this.vec;
    // --- coupler (edge_of_chaos)
    const sp = this.setpoint + this.setpointMod * 0.1;
    this.hist.push(cIn); if (this.hist.length > 200) this.hist.shift();
    let v = 0;
    if (this.hist.length > 10) {
      const r = this.hist.slice(-this.win); let m = 0; for (const x of r) m += x; m /= r.length;
      for (const x of r) v += (x - m) * (x - m); v /= r.length;
    }
    const ve = v - this.targetVar, err = cIn - sp; let o;
    if (ve > 0) { o = sp + (2 / (1 + Math.exp(-err * this.sharp)) - 1) / this.sharp; this.regime = -1; }
    else { const amp = sp + err * (1 + Math.abs(ve) * 10); o = sp + Math.tanh((amp - sp) * 2); this.regime = 1; }
    const newOut = o;
    // --- splitter (first four of the vector)
    const newSplit = [sIn[0], sIn[1], sIn[2], sIn[3]];
    // --- image -> vector (area mean to 16x16, normalise by max)
    let newVec = this.vec;
    if (vIn) {
      newVec = new Float32Array(256); let mx = 0;
      for (let by = 0; by < 16; by++) for (let bx = 0; bx < 16; bx++) {
        let s = 0; for (let y = 0; y < 16; y++) { const row = (by * 16 + y) * 256 + bx * 16; for (let x = 0; x < 16; x++) s += vIn[row + x]; }
        const a = s / 256; newVec[by * 16 + bx] = a; if (a > mx) mx = a;
      }
      if (mx > 0) for (let i = 0; i < 256; i++) newVec[i] /= mx;
    }
    // --- checkerboard (square size from the coupler signal)
    const sizeIn = kIn ? kIn : 0.1; const sq = Math.trunc(5 + sizeIn * 50);
    let newImg = this.img;
    if (sq !== 0) {
      newImg = new Uint8Array(256 * 256);
      for (let y = 0; y < 256; y++) { const fy = Math.floor(y / sq); for (let x = 0; x < 256; x++) newImg[y * 256 + x] = (((Math.floor(x / sq) + fy) % 2) + 2) % 2; }
      this.sq = sq;
    }
    this.out = newOut; this.split = newSplit; this.vec = newVec; this.img = newImg; this.t++;
    return newOut;
  };
  root.ECG = ECG;
  if (typeof module !== 'undefined') module.exports = ECG;
})(typeof window !== 'undefined' ? window : globalThis);
