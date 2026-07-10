export class HUD {
  constructor() {
    this.spd = document.getElementById('spd');
    this.alt = document.getElementById('alt');
    this.g = document.getElementById('g');
    this.thrPct = document.getElementById('thr-pct');
    this.thrBar = document.getElementById('throttle-bar');
    this.stall = document.getElementById('stall');
    this.msgEl = document.getElementById('msg');
    this.flashEl = document.getElementById('flash');
    this._msgTimer = null;
  }

  update(phys) {
    this.spd.textContent = Math.round(phys.speed * 3.6);
    this.alt.textContent = Math.max(0, Math.round(phys.altitude));
    this.g.textContent = phys.gLoad.toFixed(1);
    const pct = Math.round(phys.throttle * 100);
    this.thrPct.textContent = pct;
    this.thrBar.style.width = pct + '%';
    this.stall.style.display = phys.stalled ? 'block' : 'none';
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
