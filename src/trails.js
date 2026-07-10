import * as THREE from 'three';

// Wingtip vortex ribbons. Additive lines that fade along their length;
// intensity comes from G-load / near-stall AoA, so hard pulls draw the air.

const N = 70;

class Ribbon {
  constructor(scene) {
    this.positions = new Float32Array(N * 3);
    this.intensity = new Float32Array(N);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.colors = new Float32Array(N * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.line.frustumCulled = false;
    scene.add(this.line);
  }

  reset(p) {
    for (let i = 0; i < N; i++) {
      this.positions.set([p.x, p.y, p.z], i * 3);
      this.intensity[i] = 0;
    }
  }

  push(p, val) {
    this.positions.copyWithin(3, 0, (N - 1) * 3);
    this.positions.set([p.x, p.y, p.z], 0);
    this.intensity.copyWithin(1, 0, N - 1);
    this.intensity[0] = val;
    for (let i = 0; i < N; i++) {
      const v = this.intensity[i] * (1 - i / N) * 0.85;
      this.colors.set([v, v, v], i * 3);
    }
    this.line.geometry.attributes.position.needsUpdate = true;
    this.line.geometry.attributes.color.needsUpdate = true;
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
    let target = 0;
    if (phys.speed > 30) {
      target = Math.max(
        Math.min(1, (Math.abs(phys.gLoad) - 2.1) / 1.4),
        phys.stalled ? 0.8 : 0,
        Math.min(1, (Math.abs(phys.aoa) - 0.22) / 0.12) * 0.7,
      );
      target = Math.max(0, target);
    }
    this.smoothed += (target - this.smoothed) * Math.min(1, dt * 6);
    this.l.push(this.tipL.getWorldPosition(this._p), this.smoothed);
    this.r.push(this.tipR.getWorldPosition(this._p), this.smoothed);
  }
}
