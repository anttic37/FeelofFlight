import * as THREE from 'three';

// ---------------------------------------------------------------------------
// AIRFLOW STREAKS. Thin wisps of moving air, drawn only when you are going fast
// enough to deserve them.
//
// Speed is not a number on the HUD, it is a thing you feel against something. High
// up there is nothing to feel it against — the ground is too far to whip past and
// the clouds are further — so above about 200 km/h the air itself starts to show.
//
// THE STREAKS DO NOT MOVE. They are placed in world space and left there; the plane
// flies through them. That is both free and exactly right — the parallax, the way
// they rush past faster when you dive and hang when you slow, all falls out of the
// plane's own motion rather than being animated to imitate it.
//
// Additive, which puts them where they belong physically: a pale wisp is invisible
// against a bright sky and shows against dark ground and dark water. Getting that
// the wrong way round is what makes speed lines read as a cartoon overlay.
// ---------------------------------------------------------------------------

const PARAMS = new URLSearchParams(location.search);
const OFF = PARAMS.get('streaks') === '0';

const N = 150;
// Nothing at all below FADE_IN. Cruise sits well under it, so in normal flight this
// system is invisible and free; it is a reward for actually pushing.
const FADE_IN = 52, FADE_FULL = 98;      // m/s
const AHEAD_MIN = 25, AHEAD_MAX = 120;   // spawned this far in front
const TUBE_MIN = 7, TUBE_MAX = 48;       // ...and this far off the flight line
const BEHIND = 35;                       // recycled once this far past you

export function createAirflow(scene) {
  if (OFF) return { update() {}, stats: () => ({ off: true }) };

  const pos = new Float32Array(N * 2 * 3);
  const col = new Float32Array(N * 2 * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
    // fog would ADD haze colour under additive blending, which brightens every
    // streak with distance instead of dimming it. Distance fade is done in the
    // vertex colours instead, where it can go the right way.
    fog: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 3;
  scene.add(lines);

  // live[i] = false means "needs a new home"; there is no lifetime, a streak dies
  // when the plane has passed it
  const p = Array.from({ length: N }, () => new THREE.Vector3());
  const live = new Uint8Array(N);
  // Per-streak length multiplier. Without it every wisp is exactly the same length,
  // and a screenful of identical dashes reads as a ruled overlay rather than air.
  const stretch = new Float32Array(N);
  const fwd = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3();
  let shown = 0;      // segments drawn last frame, for stats only

  function place(i, planePos) {
    const a = Math.random() * Math.PI * 2;
    const r = TUBE_MIN + Math.random() * (TUBE_MAX - TUBE_MIN);
    const d = AHEAD_MIN + Math.random() * (AHEAD_MAX - AHEAD_MIN);
    p[i].copy(planePos)
      .addScaledVector(fwd, d)
      .addScaledVector(side, Math.cos(a) * r)
      .addScaledVector(up, Math.sin(a) * r);
    stretch[i] = 0.55 + Math.random() * 1.05;
    live[i] = 1;
  }

  function update(dt, phys) {
    const speed = phys.vel.length();
    const k = Math.min(1, Math.max(0, (speed - FADE_IN) / (FADE_FULL - FADE_IN)));
    if (k <= 0) {
      lines.visible = false;
      shown = 0;
      // Everything is invalidated while hidden, so re-entry does not dump 150
      // streaks that were positioned around wherever you were a minute ago.
      live.fill(0);
      return;
    }
    lines.visible = true;
    mat.opacity = 0.30 * k;

    fwd.copy(phys.vel).normalize();
    side.crossVectors(fwd, UP);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0); else side.normalize();
    up.crossVectors(side, fwd).normalize();

    // Length grows with speed: the streak is how far the air moves while the eye
    // integrates it, so at 350 km/h it is a long scratch and at 200 a short dash.
    const len = 2.5 + speed * 0.085;
    let n = 0;
    for (let i = 0; i < N; i++) {
      if (!live[i]) place(i, phys.pos);
      tmp.subVectors(p[i], phys.pos);
      const along = tmp.dot(fwd);
      if (along < -BEHIND || tmp.lengthSq() > 260 * 260) { live[i] = 0; continue; }

      // Fade in at the far end and out as it goes by, so nothing ever appears or
      // vanishes at full brightness in the middle of the frame.
      const near = Math.min(1, Math.max(0, (along + BEHIND) / 26));
      const far = 1 - Math.min(1, Math.max(0, (along - AHEAD_MAX * 0.6) / (AHEAD_MAX * 0.5)));
      const v = 0.85 * near * far;
      const L = len * stretch[i];
      const o = n * 6;
      pos[o] = p[i].x; pos[o + 1] = p[i].y; pos[o + 2] = p[i].z;
      pos[o + 3] = p[i].x - fwd.x * L; pos[o + 4] = p[i].y - fwd.y * L; pos[o + 5] = p[i].z - fwd.z * L;
      // Bright at the leading end, dark at the tail — a streak with a direction
      // reads as motion; an evenly lit one reads as a stick.
      col[o] = v; col[o + 1] = v; col[o + 2] = v * 1.04;
      col[o + 3] = 0; col[o + 4] = 0; col[o + 5] = 0;
      n++;
    }
    geo.setDrawRange(0, n * 2);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    shown = n;
  }

  return { update, stats: () => ({ streaks: shown, visible: lines.visible }) };
}
