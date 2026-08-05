import { OD_GAIN } from './physics.js';

// Light-aircraft instrument panel: a row of real round dials across the bottom
// of the screen in place of text readouts. Layout follows the classic six-pack
// reading order — airspeed, attitude, altimeter, heading, vertical speed — plus
// the tachometer and G-meter this airframe actually needs.
//
// The static half of every dial (bezel, ticks, numbers, colour arcs, caption)
// is baked ONCE into an offscreen canvas; each frame only the needles and the
// moving horizon/compass card are drawn over that blit. Redrawing the faces
// every frame costs several times more for a picture that never changes.
//
// Arc markings are the airframe's real numbers (physics.js): 1 g stall 98 km/h,
// full-flap stall 86, caution 389, Vne 414.

const R = 50;      // dial radius, design units
const CELL = 116;  // horizontal pitch between dials
const HGT = 128;   // dial + caption strip below it
const DPR = 2;
// Everything below is authored in design units and the whole context is scaled
// by SCALE, so ticks, fonts, needles and boxes all grow together — resizing R
// alone would leave the text and needle widths behind.
const SCALE = 1.26;

const A0 = 135, SWEEP = 270;   // standard sweep: 7:30 clockwise to 4:30
const D2R = Math.PI / 180;

const ASI = 0, ATT = 1, ALT = 2, HDG = 3, VSI = 4, TAC = 5, GEE = 6;
const N = 7;

const FACE = '#0b1119';
const INK = 'rgba(228,241,255,0.94)';
const DIM = 'rgba(168,204,240,0.5)';
const WARN = '#ff5a4d';
const V_MAX = 450;   // ASI full scale, km/h
const VS_MAX = 15;   // VSI full scale, m/s
const RPM_MAX = 3000;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sweepAng = (t) => (A0 + SWEEP * clamp01(t)) * D2R;

function ring(g, cx, cy, r, a, b, color, w) {
  g.strokeStyle = color; g.lineWidth = w;
  g.beginPath(); g.arc(cx, cy, r, a, b); g.stroke();
}

function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// A real panel screw: bright on the top-left where the light is, dark under, and a slot.
// Tiny, but it is most of what says "instrument bolted into a panel" rather than "circle".
function screw(g, x, y) {
  const head = g.createLinearGradient(x - 2.6, y - 2.6, x + 2.6, y + 2.6);
  head.addColorStop(0, '#79838f');
  head.addColorStop(0.5, '#454e59');
  head.addColorStop(1, '#232931');
  g.fillStyle = head;
  g.beginPath(); g.arc(x, y, 2.6, 0, 6.2832); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 0.7;
  g.beginPath(); g.arc(x, y, 2.6, 0, 6.2832); g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x - 1.6, y - 0.7); g.lineTo(x + 1.6, y + 0.7); g.stroke();
}

// THE DEPTH IS ALL IN THE SHADING, and it is four separate passes rather than one gradient:
// a bolted housing plate behind the dial, a rim lit from above and bouncing at the bottom,
// a face that falls off DARK toward its edge, and an inner shadow cast by the rim lip onto
// that face. A single flat fill plus one linear gradient — what this was — reads as a
// sticker; the vignette and the lip shadow are what make it read as a recess with glass in
// it. Baked once, so all of this is free per frame.
function bezel(g, cx, cy) {
  const H = R + 4;

  // --- housing plate, top-lit
  const plate = g.createLinearGradient(cx, cy - H, cx, cy + H);
  plate.addColorStop(0, '#3c444f');
  plate.addColorStop(0.45, '#262c34');
  plate.addColorStop(1, '#161b21');
  g.fillStyle = plate;
  roundRectPath(g, cx - H, cy - H, H * 2, H * 2, 10);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1;
  roundRectPath(g, cx - H, cy - H, H * 2, H * 2, 10);
  g.stroke();

  const s = H - 6;
  screw(g, cx - s, cy - s); screw(g, cx + s, cy - s);
  screw(g, cx - s, cy + s); screw(g, cx + s, cy + s);

  // --- rim: bright along the top edge, dark through the middle, a little bounce underneath
  const rim = g.createLinearGradient(cx, cy - R, cx, cy + R);
  rim.addColorStop(0, '#616d7c');
  rim.addColorStop(0.42, '#2a313a');
  rim.addColorStop(0.78, '#1b212a');
  rim.addColorStop(1, '#49535f');
  g.fillStyle = rim;
  g.beginPath(); g.arc(cx, cy, R, 0, 6.2832); g.fill();

  // --- face, offset toward the light so the vignette is not a symmetric donut
  const face = g.createRadialGradient(cx - R * 0.22, cy - R * 0.26, R * 0.08, cx, cy, R);
  face.addColorStop(0, '#1b2431');
  face.addColorStop(0.5, '#111924');
  face.addColorStop(1, '#05080c');
  g.fillStyle = face;
  g.beginPath(); g.arc(cx, cy, R - 5, 0, 6.2832); g.fill();

  // --- shadow the rim lip casts down onto the face
  const lip = g.createRadialGradient(cx, cy, R - 17, cx, cy, R - 5);
  lip.addColorStop(0, 'rgba(0,0,0,0)');
  lip.addColorStop(1, 'rgba(0,0,0,0.72)');
  g.fillStyle = lip;
  g.beginPath(); g.arc(cx, cy, R - 5, 0, 6.2832); g.fill();
  ring(g, cx, cy, R - 5, 0, 6.2832, 'rgba(0,0,0,0.65)', 1.4);
}

// Glass, laid over the markings once the dial is drawn: a soft diagonal sheen across the
// upper left and a faint bright arc where the cover curves away at the top.
function glass(g, cx, cy) {
  g.save();
  g.beginPath(); g.arc(cx, cy, R - 5, 0, 6.2832); g.clip();
  const sheen = g.createLinearGradient(cx - R, cy - R, cx + R * 0.5, cy + R * 0.75);
  sheen.addColorStop(0, 'rgba(214,236,255,0.13)');
  sheen.addColorStop(0.38, 'rgba(214,236,255,0.045)');
  sheen.addColorStop(0.52, 'rgba(214,236,255,0)');
  g.fillStyle = sheen;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);
  g.restore();
  ring(g, cx, cy, R - 6.6, 200 * D2R, 320 * D2R, 'rgba(226,242,255,0.10)', 1.6);
}

// tick fan between two absolute angles (degrees, clockwise on screen)
function ticks(g, cx, cy, degA, degB, count, majorEvery, rOut, len, lenMaj) {
  for (let i = 0; i <= count; i++) {
    const a = (degA + (degB - degA) * (i / count)) * D2R;
    const maj = i % majorEvery === 0;
    const l = maj ? lenMaj : len;
    g.strokeStyle = maj ? INK : DIM;
    g.lineWidth = maj ? 1.9 : 1;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut);
    g.lineTo(cx + Math.cos(a) * (rOut - l), cy + Math.sin(a) * (rOut - l));
    g.stroke();
  }
}

function label(g, cx, cy, deg, text, r, size = 9) {
  const a = deg * D2R;
  g.fillStyle = INK;
  g.font = `700 ${size}px ui-monospace, Consolas, monospace`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
}

// captions sit BELOW the bezel: inside the face they collided with the
// bottom tick numbers on every dial
function caption(g, cx, cy, text) {
  g.fillStyle = 'rgba(158,198,236,0.72)';
  g.font = '600 8px ui-monospace, Consolas, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, cx, cy + R + 10);
}

function needle(g, cx, cy, ang, len, color, w = 2.6, tail = 10) {
  g.save();
  g.translate(cx, cy); g.rotate(ang);
  // A needle sits ABOVE the face on a real instrument, and the shadow it drops is what
  // says so. Canvas shadow offsets ignore the current transform, so this stays down-right
  // whatever angle the needle is at, instead of swinging around with it.
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = 3;
  g.shadowOffsetX = 1.3; g.shadowOffsetY = 1.9;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(-tail, 0); g.lineTo(0, -w); g.lineTo(len, 0); g.lineTo(0, w);
  g.closePath(); g.fill();
  g.restore();
}

// Three flat arcs rather than a radial gradient: this runs for every dial every frame, and
// a cached-nothing gradient per hub per frame is pure garbage for the same picture.
function hub(g, cx, cy) {
  g.fillStyle = '#11171e';
  g.beginPath(); g.arc(cx, cy, 4.4, 0, 6.2832); g.fill();
  g.fillStyle = '#4a5562';
  g.beginPath(); g.arc(cx, cy, 3.0, 0, 6.2832); g.fill();
  g.fillStyle = '#7b8899';
  g.beginPath(); g.arc(cx - 0.8, cy - 0.9, 1.4, 0, 6.2832); g.fill();
}

// small dark digital window under the hub
function digital(g, cx, cy, text, color = INK) {
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(cx - 18, cy + 11, 36, 13);
  g.strokeStyle = 'rgba(150,190,230,0.28)'; g.lineWidth = 1;
  g.strokeRect(cx - 18, cy + 11, 36, 13);
  g.fillStyle = color;
  g.font = '700 10px ui-monospace, Consolas, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, cx, cy + 18);
}

export class Gauges {
  constructor(canvas) {
    this.W = CELL * N;
    canvas.width = Math.round(this.W * SCALE * DPR); canvas.height = Math.round(HGT * SCALE * DPR);
    canvas.style.width = Math.round(this.W * SCALE) + 'px';
    canvas.style.height = Math.round(HGT * SCALE) + 'px';
    this.g = canvas.getContext('2d');
    this.g.scale(DPR * SCALE, DPR * SCALE);
    this.cx = [];
    for (let i = 0; i < N; i++) this.cx.push(CELL * i + CELL / 2);
    this.cy = R + 4;
    this.bake = this._bakeFaces();
  }

  _bakeFaces() {
    const c = document.createElement('canvas');
    c.width = Math.round(this.W * SCALE * DPR); c.height = Math.round(HGT * SCALE * DPR);
    const g = c.getContext('2d');
    g.scale(DPR * SCALE, DPR * SCALE);
    const cy = this.cy;

    for (let i = 0; i < N; i++) bezel(g, this.cx[i], cy);

    // --- airspeed: colour arcs are this airframe's real speeds
    let cx = this.cx[ASI];
    const tv = (kmh) => kmh / V_MAX;
    ring(g, cx, cy, R - 11, sweepAng(tv(86)), sweepAng(tv(200)), 'rgba(240,248,255,0.85)', 3);   // flap range
    ring(g, cx, cy, R - 15, sweepAng(tv(98)), sweepAng(tv(389)), 'rgba(110,225,140,0.9)', 3);    // normal
    ring(g, cx, cy, R - 15, sweepAng(tv(389)), sweepAng(tv(414)), 'rgba(255,200,80,0.95)', 3);   // caution
    ring(g, cx, cy, R - 15, sweepAng(tv(414)), sweepAng(1), WARN, 3);                            // never exceed
    ticks(g, cx, cy, A0, A0 + SWEEP, 18, 2, R - 6, 3.5, 7);
    for (let v = 0; v <= 400; v += 100) label(g, cx, cy, A0 + SWEEP * tv(v), String(v), R - 20, 8.5);
    caption(g, cx, cy, 'AIRSPEED km/h');

    // --- attitude: only the fixed bank scale is static
    cx = this.cx[ATT];
    for (const d of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const a = (270 + d) * D2R;
      const maj = d === 0 || Math.abs(d) === 30 || Math.abs(d) === 60;
      const l = maj ? 7 : 4;
      g.strokeStyle = maj ? INK : DIM;
      g.lineWidth = maj ? 1.8 : 1;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (R - 5), cy + Math.sin(a) * (R - 5));
      g.lineTo(cx + Math.cos(a) * (R - 5 - l), cy + Math.sin(a) * (R - 5 - l));
      g.stroke();
    }
    caption(g, cx, cy, 'ATTITUDE');

    // --- altimeter: one revolution = 1000 m, digits are hundreds
    cx = this.cx[ALT];
    ticks(g, cx, cy, -90, 270, 50, 5, R - 6, 3, 6.5);
    for (let d = 0; d < 10; d++) label(g, cx, cy, -90 + 36 * d, String(d), R - 18, 9);
    caption(g, cx, cy, 'ALTITUDE m');

    // --- heading: card rotates, so only the lubber line is static
    cx = this.cx[HDG];
    g.fillStyle = '#ffd36b';
    g.beginPath();
    g.moveTo(cx, cy - R + 8); g.lineTo(cx - 4.5, cy - R + 1); g.lineTo(cx + 4.5, cy - R + 1);
    g.closePath(); g.fill();
    caption(g, cx, cy, 'HEADING');

    // --- vertical speed: zero at 9 o'clock, gap on the right
    cx = this.cx[VSI];
    ticks(g, cx, cy, 30, 330, 30, 5, R - 6, 3.5, 7);
    for (const v of [-15, -10, -5, 0, 5, 10, 15]) {
      label(g, cx, cy, 180 + 150 * (v / VS_MAX), String(Math.abs(v)), R - 19, 8.5);
    }
    ring(g, cx, cy, R - 13, 180 * D2R - 0.06, 180 * D2R + 0.06, 'rgba(110,225,140,0.9)', 3);
    caption(g, cx, cy, 'VERT SPD m/s');

    // --- tachometer
    cx = this.cx[TAC];
    const tr = (r) => r / RPM_MAX;
    ring(g, cx, cy, R - 13, sweepAng(tr(1800)), sweepAng(tr(2700)), 'rgba(110,225,140,0.9)', 3);
    ring(g, cx, cy, R - 13, sweepAng(tr(2800)), sweepAng(1), WARN, 3);
    ticks(g, cx, cy, A0, A0 + SWEEP, 30, 5, R - 6, 3.5, 7);
    for (let r = 5; r <= 30; r += 5) label(g, cx, cy, A0 + SWEEP * tr(r * 100), String(r), R - 19, 8.5);
    caption(g, cx, cy, 'RPM x100');

    // --- G meter: amber from sustained-load territory, red at the 4.5 g limit
    cx = this.cx[GEE];
    const tg = (v) => (v + 3) / 10;
    ring(g, cx, cy, R - 13, sweepAng(tg(-1)), sweepAng(tg(3.5)), 'rgba(110,225,140,0.9)', 3);
    ring(g, cx, cy, R - 13, sweepAng(tg(3.5)), sweepAng(tg(4.5)), 'rgba(255,200,80,0.95)', 3);
    ring(g, cx, cy, R - 13, sweepAng(tg(4.5)), sweepAng(1), WARN, 3);
    ticks(g, cx, cy, A0, A0 + SWEEP, 20, 2, R - 6, 3.5, 7);
    for (const v of [-2, 0, 2, 4, 6]) label(g, cx, cy, A0 + SWEEP * tg(v), String(v), R - 19, 8.5);
    caption(g, cx, cy, 'G LOAD');

    // glass last, so it lies over the markings rather than under them
    for (let i = 0; i < N; i++) glass(g, this.cx[i], cy);

    return c;
  }

  // pitch/bank/heading come in already resolved from the quaternion by hud.js
  update(phys, input, att) {
    const g = this.g, cy = this.cy;
    g.clearRect(0, 0, this.W, HGT);
    g.drawImage(this.bake, 0, 0, this.W, HGT);

    const dead = !!phys.crashed;

    // AIRSPEED
    let cx = this.cx[ASI];
    const kmh = phys.airspeed * 3.6;
    const hot = (phys.overspeed ?? 0) > 0.12;
    needle(g, cx, cy, sweepAng(kmh / V_MAX), R - 12, hot ? WARN : INK);
    hub(g, cx, cy);
    digital(g, cx, cy, String(Math.round(kmh)), phys.stalled ? WARN : INK);

    // ATTITUDE
    this._attitude(g, this.cx[ATT], cy, att);

    // ALTIMETER — long needle hundreds, short needle thousands, AGL digital
    cx = this.cx[ALT];
    const msl = Math.max(0, phys.pos.y);
    needle(g, cx, cy, (-90 + 360 * ((msl / 1000) % 1)) * D2R, R - 12, INK, 2.4);
    needle(g, cx, cy, (-90 + 360 * ((msl / 10000) % 1)) * D2R, R - 26, INK, 3.4, 8);
    hub(g, cx, cy);
    digital(g, cx, cy, Math.round(Math.max(0, phys.altitude)) + 'a', INK);

    // HEADING — the whole card turns under a fixed lubber line
    this._compass(g, this.cx[HDG], cy, att.hdg);

    // VERTICAL SPEED
    cx = this.cx[VSI];
    const vy = Math.max(-VS_MAX, Math.min(VS_MAX, phys.vel.y));
    needle(g, cx, cy, (180 + 150 * (vy / VS_MAX)) * D2R, R - 12, INK);
    hub(g, cx, cy);

    // TACHOMETER — engine dies with the airframe
    cx = this.cx[TAC];
    // Reads POWER, not lever position, so overdrive shows as the needle going past the
    // redline and the window saying 150%. This is the clearest statement in the game that
    // there is something beyond full throttle, and it costs one multiply.
    const od = dead ? 0 : (phys.overdrive || 0);
    const power = dead ? 0 : phys.throttle * (1 + OD_GAIN * od);
    const rpm = dead ? 0 : 600 + power * 2400;
    // clamped just past full scale so the needle PINS against the stop rather than
    // wrapping back around the dial and reading as a low RPM
    needle(g, cx, cy, sweepAng(Math.min(1.04, rpm / RPM_MAX)), R - 12, od > 0.05 ? WARN : INK);
    hub(g, cx, cy);
    digital(g, cx, cy, Math.round(power * 100) + '%', od > 0.05 ? WARN : INK);

    // G METER — stress rides the rim as a filling red arc
    cx = this.cx[GEE];
    const gl = Math.max(-3, Math.min(7, phys.gLoad));
    const st = phys.stress ?? 0;
    if (st > 0.02) ring(g, cx, cy, R - 7.5, sweepAng(0), sweepAng(st), WARN, 2.5);
    needle(g, cx, cy, sweepAng((gl + 3) / 10), R - 12, gl > 4.5 || gl < -1.5 ? WARN : INK);
    hub(g, cx, cy);
    digital(g, cx, cy, phys.gLoad.toFixed(1), st > 0.35 ? WARN : INK);
  }

  _attitude(g, cx, cy, att) {
    const r = R - 5.5;
    g.save();
    g.beginPath(); g.arc(cx, cy, r, 0, 6.2832); g.clip();
    g.translate(cx, cy);
    g.rotate(att.bank);
    const ppd = r / 32;             // pixels per degree of pitch
    const off = att.pitchDeg * ppd; // nose up pushes the horizon down
    // each half must stay covered at ANY attitude: at 90 deg of pitch the
    // horizon sits ~2.8 r off centre, and 2r-tall fills left a black wedge
    // across the dial in steep dives and in a tumbling wreck
    const F = r * 8;
    g.fillStyle = '#2f74ac';
    g.fillRect(-F, off - F, F * 2, F);
    g.fillStyle = '#7a5330';
    g.fillRect(-F, off, F * 2, F);
    g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(-r * 2, off); g.lineTo(r * 2, off); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1;
    for (const d of [-30, -20, -10, 10, 20, 30]) {
      const y = off - d * ppd;
      const w = d % 20 === 0 ? 13 : 7;
      g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke();
    }
    g.restore();

    // moving bank pointer, then the fixed aircraft symbol on top
    g.save();
    g.translate(cx, cy); g.rotate(att.bank);
    g.fillStyle = '#ffd36b';
    g.beginPath();
    g.moveTo(0, -r + 1); g.lineTo(-4, -r + 8); g.lineTo(4, -r + 8);
    g.closePath(); g.fill();
    g.restore();

    g.strokeStyle = '#ffd36b'; g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(cx - 19, cy); g.lineTo(cx - 7, cy);
    g.moveTo(cx + 7, cy); g.lineTo(cx + 19, cy);
    g.moveTo(cx, cy - 3); g.lineTo(cx, cy + 3);
    g.stroke();
  }

  _compass(g, cx, cy, hdgRad) {
    const r = R - 5.5;
    g.save();
    g.beginPath(); g.arc(cx, cy, r, 0, 6.2832); g.clip();
    g.translate(cx, cy);
    g.rotate(-hdgRad);  // card turns opposite the aircraft
    for (let d = 0; d < 360; d += 10) {
      const a = (d - 90) * D2R;
      const maj = d % 30 === 0;
      const l = maj ? 7 : 4;
      g.strokeStyle = maj ? INK : DIM;
      g.lineWidth = maj ? 1.8 : 1;
      g.beginPath();
      g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      g.lineTo(Math.cos(a) * (r - l), Math.sin(a) * (r - l));
      g.stroke();
    }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let d = 0; d < 360; d += 30) {
      const a = (d - 90) * D2R;
      const x = Math.cos(a) * (r - 15), y = Math.sin(a) * (r - 15);
      const card = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d];
      g.save();
      g.translate(x, y);
      g.rotate(hdgRad); // keep the glyphs upright as the card turns
      g.fillStyle = card ? '#ffd36b' : INK;
      g.font = card ? '700 10px ui-monospace, Consolas, monospace' : '700 8px ui-monospace, Consolas, monospace';
      g.fillText(card || String(d / 10), 0, 0);
      g.restore();
    }
    g.restore();
    hub(g, cx, cy);
    digital(g, cx, cy, String(Math.round(hdgRad * 180 / Math.PI + 360) % 360).padStart(3, '0'), INK);
  }
}
