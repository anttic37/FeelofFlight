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
    this.map = document.getElementById('minimap');
    this.mapCtx = this.map.getContext('2d');
    this._bake = bakeIslandMap();
    this._msgTimer = null;
    this._varioCls = '';
    this._gearState = '';
    this._brakeOn = false;
    this._gearWarnOn = false;
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

    this._drawMap(phys.pos, hdgRad);
  }

  _drawMap(pos, hdgRad) {
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
