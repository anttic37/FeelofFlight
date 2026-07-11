import * as THREE from 'three';
import { heightAt } from './world.js';
import { RUNWAYS } from './runways.js';

// Minimap projection: north (-Z) is map up, east (+X) is map right — matching
// the out-the-window world. Compass heading = atan2(fx, -fz): right turn counts up.
const MAP_S = 280;      // backing pixels (140 css px at 2x)
const MAP_HALF = 7500;  // meters from map center to edge (island r~7000 fits)
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const _fwd = new THREE.Vector3();

function bakeIslandMap() {
  const N = 140;
  const img = new ImageData(N, N);
  const d = img.data;
  for (let j = 0; j < N; j++) {
    const z = ((j + 0.5) / N * 2 - 1) * MAP_HALF;
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N * 2 - 1) * MAP_HALF;
      const h = heightAt(x, z);
      const o = (j * N + i) * 4;
      let r, g, b, a = 242;
      if (h <= 0.1) {
        const deep = Math.min(1, Math.max(0, -h / 10));
        r = 60 - 22 * deep; g = 116 - 40 * deep; b = 152 - 42 * deep; a = 200;
      } else if (h < 2) { r = 214; g = 196; b = 146; }
      else if (h > 600) { r = 236; g = 240; b = 243; }
      else if (h > 420) { r = 139; g = 136; b = 128; }
      else {
        const k = h / 420;
        r = 111 - 35 * k; g = 165 - 43 * k; b = 82 - 21 * k;
      }
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a;
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = N;
  tmp.getContext('2d').putImageData(img, 0, 0);
  const bake = document.createElement('canvas');
  bake.width = bake.height = MAP_S;
  const g = bake.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.drawImage(tmp, 0, 0, MAP_S, MAP_S);
  const s = MAP_S / (MAP_HALF * 2);
  for (const rw of RUNWAYS) {
    g.save();
    g.translate(MAP_S / 2 + rw.x * s, MAP_S / 2 + rw.z * s);
    g.rotate(-rw.heading);
    const w = Math.max(2.4, rw.width * s), l = Math.max(9, rw.length * s);
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.fillRect(-w / 2, -l / 2, w, l);
    g.restore();
  }
  g.font = '600 13px ui-monospace, Consolas, monospace';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(234,244,255,0.65)';
  g.fillText('N', MAP_S / 2, 16);
  return bake;
}

export class HUD {
  constructor() {
    this.spd = document.getElementById('spd');
    this.alt = document.getElementById('alt');
    this.g = document.getElementById('g');
    this.vario = document.getElementById('vario');
    this.hdg = document.getElementById('hdg');
    this.hdgCard = document.getElementById('hdg-card');
    this.gearChip = document.getElementById('gear-chip');
    this.brakeChip = document.getElementById('brake-chip');
    this.gearWarn = document.getElementById('gearwarn');
    this.thrPct = document.getElementById('thr-pct');
    this.thrBar = document.getElementById('throttle-bar');
    this.stall = document.getElementById('stall');
    this.msgEl = document.getElementById('msg');
    this.flashEl = document.getElementById('flash');
    this.flapChip = document.getElementById('flap-chip');
    this.overspd = document.getElementById('overspd');
    this.stressTrack = document.getElementById('stress-track');
    this.stressBar = document.getElementById('stress-bar');
    this.gvign = document.getElementById('gvign');
    this.gvignRed = document.getElementById('gvign-red');
    this.map = document.getElementById('minimap');
    this.mapCtx = this.map.getContext('2d');
    this._bake = bakeIslandMap();
    this._msgTimer = null;
    this._varioCls = '';
    this._gearState = '';
    this._brakeOn = false;
    this._gearWarnOn = false;
    this._flapState = '';
    this._overspdOn = false;
    this._stressVis = false;
    this._vign = 0;
    this._vignRed = 0;
    this._vignShown = -1;
    this._vignRedShown = -1;
    this._pt = 0;
  }

  update(phys, input) {
    this.spd.textContent = Math.round(phys.speed * 3.6);
    this.alt.textContent = Math.max(0, Math.round(phys.altitude));
    this.g.textContent = phys.gLoad.toFixed(1);
    const pct = Math.round(phys.throttle * 100);
    this.thrPct.textContent = pct;
    this.thrBar.style.width = pct + '%';
    this.stall.style.display = phys.stalled ? 'block' : 'none';

    const vy = phys.vel.y;
    this.vario.textContent = (vy < -0.05 ? '▼' : '▲') + Math.abs(vy).toFixed(1);
    const vc = vy > 0.5 ? 'climb' : (vy < -0.5 ? 'sink' : '');
    if (vc !== this._varioCls) { this._varioCls = vc; this.vario.className = vc; }

    // north = -Z, heading increases N -> E per contract convention
    _fwd.set(0, 0, -1).applyQuaternion(phys.quat);
    const hdgRad = Math.atan2(_fwd.x, -_fwd.z);
    const deg = (hdgRad * 180 / Math.PI + 360) % 360;
    this.hdg.textContent = String(Math.round(deg) % 360).padStart(3, '0');
    this.hdgCard.textContent = CARDINALS[Math.round(deg / 45) % 8];

    const gt = phys.gearTransit;
    const gs = (gt > 0.02 && gt < 0.98) ? 'transit' : (phys.gearDown ? 'down' : 'up');
    if (gs !== this._gearState) {
      this._gearState = gs;
      this.gearChip.className = 'chip ' + gs;
      this.gearChip.textContent = gs === 'down' ? 'GEAR ▼' : (gs === 'transit' ? 'GEAR ··' : 'GEAR UP');
    }

    const bk = !!(input && input.brake);
    if (bk !== this._brakeOn) { this._brakeOn = bk; this.brakeChip.className = bk ? 'chip on' : 'chip'; }

    const warn = !phys.gearDown && phys.altitude < 90 && phys.speed < 45 && vy < 0;
    if (warn !== this._gearWarnOn) { this._gearWarnOn = warn; this.gearWarn.style.display = warn ? 'block' : 'none'; }

    // flaps chip: dim UP / amber 1 / amber 2, blinking while between detents
    const fs = phys.flapSetting ?? 0;
    const ft = phys.flapTransit ?? 0;
    const detent = Math.min(Math.abs(ft), Math.abs(ft - 0.5), Math.abs(ft - 1));
    const fState = (fs === 0 ? 'up' : 'f' + fs) + (detent > 0.02 ? ' transit' : '');
    if (fState !== this._flapState) {
      this._flapState = fState;
      this.flapChip.className = 'chip ' + fState;
      this.flapChip.textContent = fs === 0 ? 'FLAPS UP' : 'FLAPS ' + fs;
    }

    // overspeed: red speed readout + pulsing banner (small hysteresis vs flicker)
    const ov = phys.overspeed ?? 0;
    const oOn = this._overspdOn ? ov > 0.12 : ov > 0.15;
    if (oOn !== this._overspdOn) {
      this._overspdOn = oOn;
      this.overspd.style.display = oOn ? 'block' : 'none';
      this.spd.className = oOn ? 'over' : '';
    }

    // airframe stress bar under the G readout
    const st = phys.stress ?? 0;
    const sVis = st > 0.05;
    if (sVis !== this._stressVis) { this._stressVis = sVis; this.stressTrack.style.display = sVis ? 'block' : 'none'; }
    if (sVis) this.stressBar.style.width = Math.min(100, st * 100).toFixed(0) + '%';

    this._updateVignette(phys.gLoad);
    this._drawMap(phys, hdgRad);
  }

  // grey-out toward high positive g, red-out below -0.8 g; wall-clock smoothed
  // (~3/s) because update() gets no dt
  _updateVignette(gLoad) {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - (this._pt || now)) / 1000));
    this._pt = now;
    const k = 1 - Math.exp(-3 * dt);
    const vT = Math.min(1, Math.max(0, (gLoad - 3.2) / 2.2)) * 0.85;
    const rT = Math.min(1, Math.max(0, (-0.8 - gLoad) / 2.0)) * 0.8;
    this._vign += (vT - this._vign) * k;
    this._vignRed += (rT - this._vignRed) * k;
    if (this._vign < 0.004) this._vign = 0;
    if (this._vignRed < 0.004) this._vignRed = 0;
    if (Math.abs(this._vign - this._vignShown) > 0.003) {
      this._vignShown = this._vign;
      this.gvign.style.opacity = this._vign.toFixed(3);
    }
    if (Math.abs(this._vignRed - this._vignRedShown) > 0.003) {
      this._vignRedShown = this._vignRed;
      this.gvignRed.style.opacity = this._vignRed.toFixed(3);
    }
  }

  _drawMap(phys, hdgRad) {
    const pos = phys.pos;
    const g = this.mapCtx, s = MAP_S / (MAP_HALF * 2);
    g.clearRect(0, 0, MAP_S, MAP_S);
    g.drawImage(this._bake, 0, 0);
    const px = Math.min(MAP_S - 8, Math.max(8, MAP_S / 2 + pos.x * s));
    const py = Math.min(MAP_S - 8, Math.max(8, MAP_S / 2 + pos.z * s));
    g.save();
    g.translate(px, py);
    g.rotate(hdgRad);
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 46, -Math.PI / 2 - 0.48, -Math.PI / 2 + 0.48);
    g.closePath();
    g.fill();
    g.fillStyle = '#ff5a4d';
    g.strokeStyle = 'rgba(255,240,220,0.95)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(0, -7);
    g.lineTo(5, 6);
    g.lineTo(0, 3);
    g.lineTo(-5, 6);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();

    // wind: bottom-left corner — arrow points where the wind blows TOWARD in the
    // same north-up frame as the map, speed in m/s below it
    const w = phys.wind;
    const wx = w ? w.x : 0, wz = w ? w.z : 0;
    const ws = Math.hypot(wx, wz);
    g.fillStyle = 'rgba(6,13,22,0.55)';
    g.fillRect(8, MAP_S - 64, 48, 56);
    if (ws > 0.05) {
      g.save();
      g.translate(32, MAP_S - 42);
      g.rotate(Math.atan2(wx, -wz));
      g.strokeStyle = 'rgba(160,220,255,0.95)';
      g.fillStyle = 'rgba(160,220,255,0.95)';
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(0, 11);
      g.lineTo(0, -4);
      g.stroke();
      g.beginPath();
      g.moveTo(0, -12);
      g.lineTo(4.8, -3.5);
      g.lineTo(-4.8, -3.5);
      g.closePath();
      g.fill();
      g.restore();
    }
    g.font = '600 12px ui-monospace, Consolas, monospace';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(210,235,255,0.9)';
    g.fillText(ws > 0.05 ? ws.toFixed(1) + ' m/s' : 'CALM', 32, MAP_S - 15);
  }

  msg(text, ms = 2200) {
    this.msgEl.textContent = text;
    this.msgEl.style.opacity = 1;
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => { this.msgEl.style.opacity = 0; }, ms);
  }

  flash() {
    this.flashEl.classList.remove('fade');
    this.flashEl.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.flashEl.classList.remove('on');
      this.flashEl.classList.add('fade');
    }));
  }
}
