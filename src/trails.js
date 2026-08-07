import * as THREE from 'three';
import { SURFACE_TINT } from './atmosphere.js';

// Wingtip vortex ribbons: camera-facing tapered triangle strips, additive.
// Intensity comes from G-load / near-stall AoA, so hard pulls draw the air.
// The vertex shader expands each history point ±width/2 along
// cross(viewDir, segDir) using the built-in cameraPosition uniform; segment
// directions are computed CPU-side into a 'dir' attribute every frame.

const N = 118; // history points, one per frame — the ribbon's length in time

const VERT = `
attribute float side;
attribute float age;
attribute float intensity;
attribute vec3 dir;
varying float vAlpha;
void main() {
  vec3 wp = position;
  vec3 perp = cross(cameraPosition - wp, dir);
  float pl = length(perp);
  perp = pl > 1e-4 ? perp / pl : vec3(0.0, 1.0, 0.0);
  wp += perp * (side * 0.5 * mix(0.30, 0.05, age));
  // gentler falloff (was 1.5): with a longer ribbon a steep curve faded the
  // tail out early and gave back the length the extra history points bought
  vAlpha = intensity * pow(1.0 - age, 1.15);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

// THE COLOUR IS NOT A CONSTANT ANY MORE. It used to be a flat cool white baked into the
// shader, which is right at midday and wrong at every other hour — a vortex is condensed
// water, the same stuff as a cloud, so it takes the colour of whatever is lighting it. Flying
// into a sunset the whole sky went orange and two ice-white streaks stayed exactly as they
// were. uTint holds the shared SURFACE_TINT object by reference, so daynight writing it once
// reaches this without trails.js knowing daynight exists.
const FRAG = `
uniform vec3 uTint;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(vec3(0.72, 0.93, 1.0) * uTint, vAlpha * 0.85);
}`;

let ribbonMat = null;
function getRibbonMat() {
  if (!ribbonMat) {
    ribbonMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uTint: { value: SURFACE_TINT } },
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, // strip winding flips as the plane maneuvers
    });
  }
  return ribbonMat;
}

class Ribbon {
  constructor(scene) {
    this.centers = new Float32Array(N * 3); // world-space history, newest first
    this.intens = new Float32Array(N);
    const V = N * 2;
    const geo = new THREE.BufferGeometry();
    this.posA = new THREE.BufferAttribute(new Float32Array(V * 3), 3);
    this.dirA = new THREE.BufferAttribute(new Float32Array(V * 3), 3);
    this.intA = new THREE.BufferAttribute(new Float32Array(V), 1);
    const side = new Float32Array(V);
    const age = new Float32Array(V);
    for (let i = 0; i < N; i++) {
      side[i * 2] = 1;
      side[i * 2 + 1] = -1;
      age[i * 2] = age[i * 2 + 1] = i / (N - 1);
    }
    const idx = new Uint16Array((N - 1) * 6);
    for (let i = 0, k = 0; i < N - 1; i++) {
      const a = i * 2;
      idx[k++] = a; idx[k++] = a + 1; idx[k++] = a + 2;
      idx[k++] = a + 1; idx[k++] = a + 3; idx[k++] = a + 2;
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setAttribute('position', this.posA);
    geo.setAttribute('dir', this.dirA);
    geo.setAttribute('intensity', this.intA);
    geo.setAttribute('side', new THREE.BufferAttribute(side, 1));
    geo.setAttribute('age', new THREE.BufferAttribute(age, 1));
    this.mesh = new THREE.Mesh(geo, getRibbonMat());
    this.mesh.frustumCulled = false; // verts are world-space, bounds never updated
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
  }

  reset(p) {
    for (let i = 0; i < N; i++) {
      const ci = i * 3;
      this.centers[ci] = p.x;
      this.centers[ci + 1] = p.y;
      this.centers[ci + 2] = p.z;
      this.intens[i] = 0;
    }
    this.push(p, 0);
  }

  push(p, val) {
    const c = this.centers, w = this.intens;
    c.copyWithin(3, 0, (N - 1) * 3);
    c[0] = p.x; c[1] = p.y; c[2] = p.z;
    w.copyWithin(1, 0, N - 1);
    w[0] = val;
    const pos = this.posA.array, dir = this.dirA.array, inten = this.intA.array;
    let dx = 0, dy = 0, dz = 1; // carried into degenerate (stationary) segments
    for (let i = 0; i < N; i++) {
      const ci = i * 3, vi = i * 6;
      const j = i < N - 1 ? ci + 3 : ci;
      const ex = c[ci] - c[j], ey = c[ci + 1] - c[j + 1], ez = c[ci + 2] - c[j + 2];
      const len = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (len > 1e-5) { dx = ex / len; dy = ey / len; dz = ez / len; }
      pos[vi] = pos[vi + 3] = c[ci];
      pos[vi + 1] = pos[vi + 4] = c[ci + 1];
      pos[vi + 2] = pos[vi + 5] = c[ci + 2];
      dir[vi] = dir[vi + 3] = dx;
      dir[vi + 1] = dir[vi + 4] = dy;
      dir[vi + 2] = dir[vi + 5] = dz;
      inten[i * 2] = inten[i * 2 + 1] = w[i];
    }
    this.posA.needsUpdate = true;
    this.dirA.needsUpdate = true;
    this.intA.needsUpdate = true;
  }
}

export class WingTrails {
  constructor(scene, tipL, tipR) {
    this.tipL = tipL;
    this.tipR = tipR;
    this.l = new Ribbon(scene);
    this.r = new Ribbon(scene);
    this.smoothed = 0;
    this._p = new THREE.Vector3();
  }

  reset() {
    this.l.reset(this.tipL.getWorldPosition(this._p));
    this.r.reset(this.tipR.getWorldPosition(this._p));
    this.smoothed = 0;
  }

  update(dt, phys) {
    // thresholds sit low on purpose: the vortices should show up in an ordinary
    // turn, not only in a hard pull (was 2.1 g / 0.22 rad, which needed a yank)
    let target = 0;
    if (phys.speed > 22) {
      target = Math.max(
        Math.min(1, (Math.abs(phys.gLoad) - 1.45) / 1.5),
        phys.stalled ? 0.85 : 0,
        Math.min(1, (Math.abs(phys.aoa) - 0.15) / 0.12) * 0.8,
      );
      target = Math.max(0, target);
    }
    this.smoothed += (target - this.smoothed) * Math.min(1, dt * 7);
    this.l.push(this.tipL.getWorldPosition(this._p), this.smoothed);
    this.r.push(this.tipR.getWorldPosition(this._p), this.smoothed);
  }
}
