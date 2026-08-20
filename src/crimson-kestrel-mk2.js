import * as THREE from 'three';

// Crimson Kestrel KX-2
// A semi-realistic, game-ready procedural taildragger. Nose points along -Z,
// +Y is up, and every animated surface keeps the original plane.js API.

export const aircraftInfo = Object.freeze({
  name: 'Crimson Kestrel KX-2',
  shortName: 'KX-2',
  manufacturer: 'Aurelia Aeroworks',
  role: 'Sport / reconnaissance taildragger',
});

const freezeJointList = joints => Object.freeze(joints.map(joint => Object.freeze(joint)));

// Public animation contract. Consumers can discover the distributed-flex rig
// without depending on the construction details in buildPlane().
export const aircraftCapabilities = Object.freeze({
  schemaVersion: 1,
  assetRevision: '2.0.0',
  features: Object.freeze({
    wingFlex: Object.freeze({
      version: 2,
      implementation: 'distributed-joints',
      updatedAt: '2026-08-20',
      supersedes: Object.freeze({ version: 1, implementation: 'rigid-root-rotation' }),
      input: 'wingFlexSm',
      semantics: 'A normalized signed aeroelastic load command; positive values bend both tips upward.',
      axis: 'local-z',
      range: Object.freeze([-1, 1]),
      maxTipDeflectionDeg: 7,
      joints: Object.freeze({
        left: freezeJointList([
          { name: 'Left wing flex inboard', span: 0.24, weight: 0.20 },
          { name: 'Left wing flex midspan', span: 0.52, weight: 0.33 },
          { name: 'Left wing flex outboard', span: 0.77, weight: 0.47 },
        ]),
        right: freezeJointList([
          { name: 'Right wing flex inboard', span: 0.24, weight: 0.20 },
          { name: 'Right wing flex midspan', span: 0.52, weight: 0.33 },
          { name: 'Right wing flex outboard', span: 0.77, weight: 0.47 },
        ]),
      }),
      changelog: Object.freeze([
        '2.0.0: replaced rigid root folding with three cumulative spanwise flex joints per wing',
        '2.0.0: kept the inner wing and root fairing fixed while distributing curvature toward the tip',
      ]),
    }),
  }),
});

function paint(color, extra = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.08,
    roughness: 0.32,
    clearcoat: 0.82,
    clearcoatRoughness: 0.19,
    ...extra,
  });
}

function standard(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.56, metalness: 0.08, ...extra });
}

function paintSurfaceTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  const hash = (x, y) => {
    let value = Math.imul(x + 17, 374761393) ^ Math.imul(y + 41, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const grain = (hash(x, y) - 0.5) * 8;
      const sprayed = Math.sin(x * 0.071 + y * 0.037) * 1.8
        + Math.sin(x * 0.019 - y * 0.043) * 1.2;
      const value = Math.round(THREE.MathUtils.clamp(238 + grain + sprayed, 224, 248));
      const index = (y * size + x) * 4;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  return texture;
}

function addMesh(parent, geometry, material, position = [0, 0, 0], name = '') {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.name = name;
  parent.add(mesh);
  return mesh;
}

function taperedBoxGeometry(width, height, depth, topScale = 0.72) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    if (position.getY(i) > 0) position.setX(i, position.getX(i) * topScale);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function loftGeometry(stations, radialSegments = 24, cutout = null) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const ringY = [];
  const ringSize = radialSegments + 1;

  for (let stationIndex = 0; stationIndex < stations.length; stationIndex++) {
    const station = stations[stationIndex];
    const exponent = station.exponent ?? 2.15;
    const ys = [];
    for (let i = 0; i <= radialSegments; i++) {
      // Duplicate the circumference seam and hide it on the underside.
      const angle = -Math.PI * 0.5 + (i / radialSegments) * Math.PI * 2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const shapedX = Math.sign(c) * Math.pow(Math.abs(c), 2 / exponent);
      const shapedY = Math.sign(s) * Math.pow(Math.abs(s), 2 / exponent);
      const y = station.y + shapedY * station.height;
      positions.push(
        shapedX * station.width,
        y,
        station.z,
      );
      uvs.push(stationIndex / (stations.length - 1), i / radialSegments);
      ys.push(y);
    }
    ringY.push(ys);
  }

  for (let ring = 0; ring < stations.length - 1; ring++) {
    for (let i = 0; i < radialSegments; i++) {
      const next = i + 1;
      const zMid = (stations[ring].z + stations[ring + 1].z) * 0.5;
      const yMid = (
        ringY[ring][i] + ringY[ring][next]
        + ringY[ring + 1][i] + ringY[ring + 1][next]
      ) * 0.25;
      if (
        cutout
        && zMid > cutout.zMin
        && zMid < cutout.zMax
        && yMid > cutout.yMin
      ) continue;
      const a = ring * ringSize + i;
      const b = ring * ringSize + next;
      const c = a + ringSize;
      const d = b + ringSize;
      indices.push(a, b, c, b, d, c);
    }
  }

  const noseCenter = positions.length / 3;
  positions.push(0, stations[0].y, stations[0].z - 0.035);
  uvs.push(0, 0.5);
  const tailCenter = positions.length / 3;
  const lastStation = stations[stations.length - 1];
  positions.push(0, lastStation.y, lastStation.z + 0.035);
  uvs.push(1, 0.5);
  const lastRing = (stations.length - 1) * ringSize;

  for (let i = 0; i < radialSegments; i++) {
    const next = i + 1;
    indices.push(noseCenter, next, i);
    indices.push(tailCenter, lastRing + i, lastRing + next);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

const AIRFOIL = [
  [0.000, 0.000],
  [0.045, 0.48],
  [0.155, 0.88],
  [0.350, 1.00],
  [0.610, 0.70],
  [0.845, 0.30],
  [1.000, 0.000],
  [0.845, -0.18],
  [0.610, -0.31],
  [0.350, -0.40],
  [0.155, -0.34],
  [0.045, -0.17],
];

// Fixed wing skin stops just ahead of the control-surface hinge. The closing
// pair forms a real rear spar, so moving surfaces never overlap the base wing.
const FIXED_AIRFOIL = [
  [0.000, 0.000],
  [0.045, 0.48],
  [0.155, 0.88],
  [0.350, 1.00],
  [0.610, 0.70],
  [0.690, 0.52],
  [0.690, -0.27],
  [0.610, -0.31],
  [0.350, -0.40],
  [0.155, -0.34],
  [0.045, -0.17],
];

function wingSection(spec, spanT) {
  const t = THREE.MathUtils.clamp(spanT, 0, 1);
  const unsignedX = THREE.MathUtils.lerp(spec.rootX, spec.tipX, t);
  const baseChord = THREE.MathUtils.lerp(spec.rootChord, spec.tipChord, t);
  const tipBlend = THREE.MathUtils.smoothstep(t, spec.tipRoundStart ?? 0.80, 1);
  const chord = Math.max(spec.tipChordMinimum ?? 0.16, baseChord * (1 - (spec.tipRound ?? 0.76) * tipBlend * tipBlend));
  const rootQuarter = spec.rootLead + spec.rootChord * 0.25;
  const tipQuarter = spec.tipLead + spec.tipChord * 0.25;
  const quarterChord = THREE.MathUtils.lerp(rootQuarter, tipQuarter, t)
    + Math.sin(Math.PI * t) * (spec.planformCurve ?? -0.055);
  const lead = quarterChord - chord * 0.25;
  const thickness = THREE.MathUtils.lerp(spec.rootThickness, spec.tipThickness, t)
    * THREE.MathUtils.lerp(1, 0.86, tipBlend);
  const washout = THREE.MathUtils.lerp(0, spec.washout ?? 0, t);
  const centerY = spec.yRoot
    + (unsignedX - spec.rootX) * spec.dihedral
    + (spec.dihedralCurve ?? 0.045) * t * t;
  return { t, unsignedX, chord, lead, thickness, washout, centerY };
}

function sampleAirfoil(profile, chordT, upper) {
  const u = THREE.MathUtils.clamp(chordT, 0, 1);
  const values = [];
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i];
    const b = profile[(i + 1) % profile.length];
    const minU = Math.min(a[0], b[0]) - 1e-6;
    const maxU = Math.max(a[0], b[0]) + 1e-6;
    if (u < minU || u > maxU || Math.abs(a[0] - b[0]) < 1e-7) continue;
    const f = (u - a[0]) / (b[0] - a[0]);
    if (f >= -1e-6 && f <= 1 + 1e-6) values.push(THREE.MathUtils.lerp(a[1], b[1], f));
  }
  if (!values.length) return 0;
  return upper ? Math.max(...values) : Math.min(...values);
}

function wingSurfacePosition(spec, sign, spanT, chordT, surface = 'mid') {
  const section = wingSection(spec, spanT);
  const profile = spec.surfaceProfile ?? AIRFOIL;
  const upper = sampleAirfoil(profile, chordT, true);
  const lower = sampleAirfoil(profile, chordT, false);
  const profileV = surface === 'upper' ? upper : surface === 'lower' ? lower : (upper + lower) * 0.5;
  const localZ = section.chord * chordT;
  return new THREE.Vector3(
    sign * section.unsignedX,
    section.centerY + profileV * section.thickness + section.washout * localZ,
    section.lead + localZ,
  );
}

// Canonical attachment frame used by paint, lights, seams and control surfaces.
function wingFrameAt(spec, sign, spanT, chordT, surface = 'upper', offset = 0) {
  const point = wingSurfacePosition(spec, sign, spanT, chordT, surface);
  const e = 0.0008;
  const spanA = wingSurfacePosition(spec, sign, Math.max(0, spanT - e), chordT, surface);
  const spanB = wingSurfacePosition(spec, sign, Math.min(1, spanT + e), chordT, surface);
  const chordA = wingSurfacePosition(spec, sign, spanT, Math.max(0, chordT - e), surface);
  const chordB = wingSurfacePosition(spec, sign, spanT, Math.min(1, chordT + e), surface);
  const spanTangent = spanB.sub(spanA).normalize();
  const chordTangent = chordB.sub(chordA).normalize();
  const normal = chordTangent.clone().cross(spanTangent).normalize();
  if (normal.y < 0) normal.multiplyScalar(-1);
  point.addScaledVector(normal, offset);
  return { point, normal, spanTangent, chordTangent, section: wingSection(spec, spanT) };
}

function wingPoint(spec, sign, spanT, chordT, height = 0) {
  return wingFrameAt(spec, sign, spanT, chordT, 'mid', height).point;
}

function wingSurfacePoint(spec, sign, spanT, chordT) {
  return wingFrameAt(spec, sign, spanT, chordT, 'mid').point;
}

function wingGeometry(spec, sign, spanSegments = 20, options = {}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const profile = spec.profile ?? AIRFOIL;
  const profileCount = profile.length;
  const sectionSize = profileCount + 1;
  const spanStart = options.spanStart ?? 0;
  const spanEnd = options.spanEnd ?? 1;

  for (let span = 0; span <= spanSegments; span++) {
    const t = THREE.MathUtils.lerp(spanStart, spanEnd, span / spanSegments);
    const section = wingSection(spec, t);

    for (let profileIndex = 0; profileIndex <= profileCount; profileIndex++) {
      const [u, v] = profile[profileIndex % profileCount];
      const localZ = section.chord * u;
      positions.push(
        sign * section.unsignedX,
        section.centerY + v * section.thickness + section.washout * localZ,
        section.lead + localZ,
      );
      uvs.push(t, profileIndex / profileCount);
    }
  }

  for (let span = 0; span < spanSegments; span++) {
    for (let i = 0; i < profileCount; i++) {
      const next = i + 1;
      const a = span * sectionSize + i;
      const b = span * sectionSize + next;
      const c = a + sectionSize;
      const d = b + sectionSize;
      indices.push(a, b, c, b, d, c);
    }
  }

  if (options.capRoot ?? spanStart === 0) {
    for (let i = 1; i < profileCount - 1; i++) indices.push(0, i + 1, i);
  }
  if (options.capTip ?? spanEnd === 1) {
    const tipBase = spanSegments * sectionSize;
    for (let i = 1; i < profileCount - 1; i++) indices.push(tipBase, tipBase + i, tipBase + i + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  if (sign < 0) reverseWinding(geometry);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function reverseWinding(geometry) {
  const index = geometry.index;
  if (!index) return geometry;
  for (let i = 0; i < index.count; i += 3) {
    const second = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, second);
  }
  index.needsUpdate = true;
  return geometry;
}

function prismGeometry(corners, thickness = 0.07) {
  const thicknesses = Array.isArray(thickness)
    ? thickness
    : corners.map(() => thickness);
  const positions = [];
  for (const side of [-0.5, 0.5]) {
    for (let i = 0; i < corners.length; i++) {
      const point = corners[i];
      positions.push(point.x, point.y + side * thicknesses[i], point.z);
    }
  }
  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  reverseWinding(geometry);
  const faceted = geometry.toNonIndexed();
  faceted.computeVertexNormals();
  return faceted;
}

const CONTROL_PROFILE = [
  [0.000, 0.00],
  [0.035, 0.40],
  [0.180, 0.52],
  [0.480, 0.38],
  [0.780, 0.17],
  [1.000, 0.00],
  [0.780, -0.12],
  [0.480, -0.25],
  [0.180, -0.34],
  [0.035, -0.26],
];

function wingControlGeometry(spec, sign, spanStart, spanEnd, hingeFraction, pivot, inverseAlignment, options = {}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const spanSegments = Math.max(2, Math.ceil((spanEnd - spanStart) * 18));
  const profileCount = CONTROL_PROFILE.length;
  const sectionSize = profileCount + 1;

  for (let span = 0; span <= spanSegments; span++) {
    const spanT = THREE.MathUtils.lerp(spanStart, spanEnd, span / spanSegments);
    const section = wingSection(spec, spanT);
    for (let i = 0; i <= profileCount; i++) {
      const [surfaceT, profileV] = CONTROL_PROFILE[i % profileCount];
      const chordT = THREE.MathUtils.lerp(hingeFraction, 0.995, surfaceT);
      const frame = wingFrameAt(spec, sign, spanT, chordT, 'mid');
      const taper = 0.14 + Math.pow(1 - surfaceT, 0.72) * 0.70;
      const point = frame.point.addScaledVector(frame.normal, profileV * section.thickness * taper);
      point.sub(pivot).applyQuaternion(inverseAlignment);
      positions.push(point.x, point.y, point.z);
      uvs.push(span / spanSegments, i / profileCount);
    }
  }

  for (let span = 0; span < spanSegments; span++) {
    for (let i = 0; i < profileCount; i++) {
      const next = i + 1;
      const a = span * sectionSize + i;
      const b = span * sectionSize + next;
      const c = a + sectionSize;
      const d = b + sectionSize;
      indices.push(a, b, c, b, d, c);
    }
  }
  if (options.capStart ?? true) {
    for (let i = 1; i < profileCount - 1; i++) indices.push(0, i + 1, i);
  }
  if (options.capEnd ?? true) {
    const tipBase = spanSegments * sectionSize;
    for (let i = 1; i < profileCount - 1; i++) indices.push(tipBase, tipBase + i, tipBase + i + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  // Mirroring the port wing reverses parity in this local hinge basis.
  // Correct the winding so both sides retain outward-facing normals.
  if (sign < 0) reverseWinding(geometry);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeWingSurface(parent, spec, sign, spanStart, spanEnd, hingeFraction, material, name, options = {}) {
  const hingeA = wingFrameAt(spec, sign, spanStart, hingeFraction, 'mid').point;
  const hingeB = wingFrameAt(spec, sign, spanEnd, hingeFraction, 'mid').point;
  const trailB = wingFrameAt(spec, sign, spanEnd, 0.992, 'mid').point;
  const trailA = wingFrameAt(spec, sign, spanStart, 0.992, 'mid').point;
  const pivot = hingeA.clone().add(hingeB).multiplyScalar(0.5);
  const hingeAxis = hingeB.clone().sub(hingeA).normalize();
  const trailingAxis = trailA.clone().add(trailB).multiplyScalar(0.5).sub(pivot);
  trailingAxis.addScaledVector(hingeAxis, -trailingAxis.dot(hingeAxis)).normalize();
  const normalAxis = trailingAxis.clone().cross(hingeAxis).normalize();
  const basis = new THREE.Matrix4().makeBasis(hingeAxis, normalAxis, trailingAxis);
  const alignment = new THREE.Quaternion().setFromRotationMatrix(basis);
  const inverseAlignment = alignment.clone().invert();

  const mount = new THREE.Group();
  mount.position.copy(pivot);
  mount.quaternion.copy(alignment);
  mount.name = `${name} mount`;

  const hinge = new THREE.Group();
  hinge.name = name;
  addMesh(
    hinge,
    wingControlGeometry(spec, sign, spanStart, spanEnd, hingeFraction, pivot, inverseAlignment, options),
    material,
    [0, 0, 0],
    `${name} mesh`,
  );
  mount.add(hinge);
  parent.add(mount);
  return hinge;
}

function profileGeometry(pointsYZ, halfWidth) {
  const positions = [];
  const indices = [];
  const count = pointsYZ.length;
  for (const x of [-halfWidth, halfWidth]) {
    for (const [y, z] of pointsYZ) positions.push(x, y, z);
  }
  for (let i = 1; i < count - 1; i++) {
    indices.push(0, i + 1, i);
    indices.push(count, count + i, count + i + 1);
  }
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    indices.push(i, next, count + i, next, count + next, count + i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function verticalAirfoilGeometry(stations, profile = FIXED_AIRFOIL) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const profileCount = profile.length;
  const row = profileCount + 1;
  for (let stationIndex = 0; stationIndex < stations.length; stationIndex++) {
    const station = stations[stationIndex];
    for (let i = 0; i <= profileCount; i++) {
      const [u, v] = profile[i % profileCount];
      positions.push(v * station.thickness, station.y, station.lead + u * station.chord);
      uvs.push(stationIndex / (stations.length - 1), i / profileCount);
    }
  }
  for (let station = 0; station < stations.length - 1; station++) {
    for (let i = 0; i < profileCount; i++) {
      const a = station * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  for (let i = 1; i < profileCount - 1; i++) {
    indices.push(0, i, i + 1);
    const tip = (stations.length - 1) * row;
    indices.push(tip, tip + i + 1, tip + i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function verticalControlGeometry(stations) {
  return verticalAirfoilGeometry(stations, CONTROL_PROFILE);
}

function cylinderBetween(parent, from, to, radius, material, radialSegments = 10, name = '') {
  const direction = to.clone().sub(from);
  const mesh = addMesh(
    parent,
    new THREE.CylinderGeometry(radius, radius, direction.length(), radialSegments, 1, false),
    material,
    [0, 0, 0],
    name,
  );
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function ribbonBetween(parent, from, to, width, thickness, material, name = '') {
  const direction = to.clone().sub(from);
  const mesh = addMesh(
    parent,
    new THREE.BoxGeometry(width, thickness, direction.length()),
    material,
    [0, 0, 0],
    name,
  );
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.normalize());
  return mesh;
}

function tube(parent, points, radius, material, tubularSegments = 32, radialSegments = 6, name = '') {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return addMesh(
    parent,
    new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false),
    material,
    [0, 0, 0],
    name,
  );
}

function canopyGeometry() {
  const stations = [
    { z: -1.42, width: 0.48, base: 0.53, height: 0.22 },
    { z: -1.12, width: 0.55, base: 0.52, height: 0.67 },
    { z: -0.55, width: 0.56, base: 0.53, height: 0.79 },
    { z: 0.05, width: 0.51, base: 0.55, height: 0.70 },
    { z: 0.58, width: 0.38, base: 0.58, height: 0.43 },
    { z: 0.82, width: 0.25, base: 0.60, height: 0.22 },
  ];
  const arcSegments = 10;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let stationIndex = 0; stationIndex < stations.length; stationIndex++) {
    const station = stations[stationIndex];
    for (let i = 0; i <= arcSegments; i++) {
      const angle = Math.PI - (i / arcSegments) * Math.PI;
      positions.push(
        Math.cos(angle) * station.width,
        station.base + Math.sin(angle) * station.height,
        station.z,
      );
      uvs.push(stationIndex / (stations.length - 1), i / arcSegments);
    }
  }

  const row = arcSegments + 1;
  for (let station = 0; station < stations.length - 1; station++) {
    for (let i = 0; i < arcSegments; i++) {
      const a = station * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  // Close the windshield and rear transparency while leaving the bottom open
  // to the cockpit aperture.
  for (let i = 1; i < arcSegments; i++) indices.push(0, i, i + 1);
  const rear = (stations.length - 1) * row;
  for (let i = 1; i < arcSegments; i++) indices.push(rear, rear + i + 1, rear + i);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, stations, arcSegments };
}

const PROPELLER_PROFILE = [
  [-0.50, 0.00],
  [-0.42, 0.31],
  [-0.14, 0.50],
  [0.20, 0.40],
  [0.50, 0.00],
  [0.20, -0.23],
  [-0.14, -0.31],
  [-0.42, -0.20],
];

function propBladeGeometry(sections, { capStart = true, capEnd = true } = {}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const sectionSize = PROPELLER_PROFILE.length;
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex];
    const twist = section.twist;
    for (let profileIndex = 0; profileIndex < PROPELLER_PROFILE.length; profileIndex++) {
      const [profileX, profileZ] = PROPELLER_PROFILE[profileIndex];
      const x = profileX * section.width;
      const z = profileZ * section.thickness;
      positions.push(
        section.sweep + x * Math.cos(twist) - z * Math.sin(twist),
        section.radius,
        x * Math.sin(twist) + z * Math.cos(twist),
      );
      uvs.push(sectionIndex / (sections.length - 1), profileIndex / sectionSize);
    }
  }
  for (let section = 0; section < sections.length - 1; section++) {
    const base = section * sectionSize;
    const nextBase = base + sectionSize;
    for (let i = 0; i < sectionSize; i++) {
      const next = (i + 1) % sectionSize;
      indices.push(base + i, nextBase + i, base + next, base + next, nextBase + i, nextBase + next);
    }
  }
  if (capStart) for (let i = 1; i < sectionSize - 1; i++) indices.push(0, i + 1, i);
  const end = (sections.length - 1) * sectionSize;
  if (capEnd) for (let i = 1; i < sectionSize - 1; i++) indices.push(end, end + i, end + i + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function propDiscTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(128, 128, 10, 128, 128, 124);
  gradient.addColorStop(0, 'rgba(220,228,234,0)');
  gradient.addColorStop(0.42, 'rgba(220,228,234,0.08)');
  gradient.addColorStop(0.78, 'rgba(238,241,242,0.34)');
  gradient.addColorStop(0.94, 'rgba(238,241,242,0.16)');
  gradient.addColorStop(1, 'rgba(238,241,242,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = 'rgba(255,255,255,0.12)';
  context.lineWidth = 2;
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2;
    context.beginPath();
    context.arc(128, 128, 96, angle, angle + 0.34);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function roundelTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, 256, 256);
  for (const [radius, color] of [[122, '#e8dec8'], [82, '#a92f2b'], [35, '#17384a']]) {
    context.beginPath();
    context.arc(128, 128, radius, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function wingPatchGeometry(spec, sign, spanStart, spanEnd, chordStart, chordEnd, offset = 0.004) {
  const positions = [];
  const uvs = [];
  const spanSteps = 4;
  const chordSteps = 3;
  for (let span = 0; span <= spanSteps; span++) {
    const t = THREE.MathUtils.lerp(spanStart, spanEnd, span / spanSteps);
    for (let chord = 0; chord <= chordSteps; chord++) {
      const u = THREE.MathUtils.lerp(chordStart, chordEnd, chord / chordSteps);
      const frame = wingFrameAt(spec, sign, t, u, 'upper', offset);
      positions.push(frame.point.x, frame.point.y, frame.point.z);
      uvs.push(span / spanSteps, chord / chordSteps);
    }
  }
  const indices = [];
  const row = chordSteps + 1;
  for (let span = 0; span < spanSteps; span++) {
    for (let chord = 0; chord < chordSteps; chord++) {
      const a = span * row + chord;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  if (sign < 0) reverseWinding(geometry);
  geometry.computeVertexNormals();
  return geometry;
}

function wingRootFairingGeometry(spec, sign) {
  const spanSteps = 7;
  const chordSteps = 10;
  const chordStart = 0.035;
  const chordEnd = 0.69;
  const positions = [];
  const uvs = [];
  const row = chordSteps + 1;

  const addSurface = surface => {
    for (let span = 0; span <= spanSteps; span++) {
      const spanN = span / spanSteps;
      // Keep the fairing compact like a formed root transition, not a broad
      // second wing skin. A tiny persistent offset prevents the feathered
      // outer row from z-fighting the cream wing below it.
      const spanT = THREE.MathUtils.lerp(0.004, 0.115, spanN);
      const blend = Math.pow(1 - THREE.MathUtils.smoothstep(spanN, 0, 1), 1.25);
      for (let chord = 0; chord <= chordSteps; chord++) {
        const chordN = chord / chordSteps;
        const chordT = THREE.MathUtils.lerp(chordStart, chordEnd, chordN);
        const frame = wingFrameAt(spec, sign, spanT, chordT, surface);
        const crown = Math.pow(Math.sin(Math.PI * chordN), 0.72) * blend;
        frame.point.x += sign * crown * 0.055;
        frame.point.y += (surface === 'upper' ? 0.070 : -0.022) * crown;
        const skinClearance = surface === 'upper' ? 0.0025 : -0.0015;
        frame.point.addScaledVector(
          frame.normal,
          skinClearance + (surface === 'upper' ? 0.007 : -0.004) * blend,
        );
        positions.push(frame.point.x, frame.point.y, frame.point.z);
        uvs.push(spanN, chordN);
      }
    }
  };
  addSurface('upper');
  const lowerOffset = positions.length / 3;
  addSurface('lower');

  const indices = [];
  for (let span = 0; span < spanSteps; span++) {
    for (let chord = 0; chord < chordSteps; chord++) {
      const a = span * row + chord;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
      const la = lowerOffset + a;
      const lb = lowerOffset + b;
      const lc = lowerOffset + c;
      const ld = lowerOffset + d;
      indices.push(la, lc, lb, lb, lc, ld);
    }
  }
  for (let span = 0; span < spanSteps; span++) {
    const topLead = span * row;
    const nextTopLead = (span + 1) * row;
    const lowLead = lowerOffset + topLead;
    const nextLowLead = lowerOffset + nextTopLead;
    indices.push(topLead, nextTopLead, lowLead, nextTopLead, nextLowLead, lowLead);

    const topTrail = span * row + chordSteps;
    const nextTopTrail = (span + 1) * row + chordSteps;
    const lowTrail = lowerOffset + topTrail;
    const nextLowTrail = lowerOffset + nextTopTrail;
    indices.push(topTrail, lowTrail, nextTopTrail, lowTrail, nextLowTrail, nextTopTrail);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  if (sign < 0) reverseWinding(geometry);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function addRoundel(parent, spec, sign, spanT, chordT, material) {
  const frame = wingFrameAt(spec, sign, spanT, chordT, 'upper', 0.006);
  const roundel = addMesh(parent, new THREE.CircleGeometry(0.37, 48), material, [0, 0, 0], 'Wing roundel decal');
  roundel.position.copy(frame.point);
  roundel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.normal);
  roundel.renderOrder = 1;
  return roundel;
}

export function buildPlane() {
  const group = new THREE.Group();
  group.name = aircraftInfo.name;
  group.userData.aircraftInfo = aircraftInfo;
  group.userData.capabilities = aircraftCapabilities;

  const paintMicro = paintSurfaceTexture();
  const coatedPaint = (color, extra = {}) => paint(color, {
    roughnessMap: paintMicro,
    bumpMap: paintMicro,
    bumpScale: 0.0035,
    ...extra,
  });
  const materials = {
    crimson: coatedPaint(0xa92f2b, { roughness: 0.34, clearcoat: 0.72, clearcoatRoughness: 0.24 }),
    crimsonDark: coatedPaint(0x6f1f22, { roughness: 0.40, clearcoat: 0.56, clearcoatRoughness: 0.30 }),
    cream: coatedPaint(0xe8dec8, { metalness: 0.02, roughness: 0.45, clearcoat: 0.48, clearcoatRoughness: 0.32 }),
    navy: coatedPaint(0x17384a, { roughness: 0.28, clearcoat: 0.84 }),
    steel: standard(0xaeb8bd, { metalness: 0.82, roughness: 0.25 }),
    darkMetal: standard(0x242c31, { metalness: 0.68, roughness: 0.34 }),
    exhaust: standard(0x342b29, { metalness: 0.72, roughness: 0.52 }),
    rubber: standard(0x161a1d, { metalness: 0, roughness: 0.93 }),
    cockpit: standard(0x172127, { metalness: 0.18, roughness: 0.68 }),
    leather: standard(0x5b2d25, { metalness: 0, roughness: 0.82 }),
    webbing: standard(0xb9a47d, { metalness: 0, roughness: 0.92 }),
    seam: standard(0x27333b, { metalness: 0.35, roughness: 0.6 }),
    // NO TRANSMISSION IN THIS PROJECT, and this is the second time it has tried to get in.
    // `transmission` forces three's transmission pass, which breaks the ocean's
    // onBeforeCompile shader — the whole water sheet renders black (debugged the hard way
    // on the KX-1; see the same note in crimson-kestrel.js). Plain transparency reads
    // almost identically on a canopy this small and costs the renderer nothing.
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xc7e1e7,
      metalness: 0,
      roughness: 0.08,
      transparent: true,
      opacity: 0.66,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      side: THREE.FrontSide,
      depthWrite: false,
    }),
  };

  // Smooth superellipse fuselage, with extra stations around the cockpit and cowl.
  const fuselageStations = [
    { z: -3.72, width: 0.46, height: 0.45, y: -0.02, exponent: 2.0 },
    { z: -3.46, width: 0.57, height: 0.55, y: -0.01, exponent: 2.3 },
    { z: -2.95, width: 0.64, height: 0.62, y: 0.00, exponent: 2.45 },
    { z: -2.20, width: 0.68, height: 0.67, y: 0.02, exponent: 2.55 },
    { z: -1.48, width: 0.675, height: 0.67, y: 0.03, exponent: 2.55 },
    { z: -0.95, width: 0.665, height: 0.66, y: 0.04, exponent: 2.52 },
    { z: -0.25, width: 0.625, height: 0.62, y: 0.075, exponent: 2.45 },
    { z: 0.40, width: 0.55, height: 0.56, y: 0.12, exponent: 2.35 },
    { z: 0.82, width: 0.50, height: 0.52, y: 0.15, exponent: 2.30 },
    { z: 1.10, width: 0.47, height: 0.49, y: 0.17, exponent: 2.25 },
    { z: 1.85, width: 0.37, height: 0.40, y: 0.24, exponent: 2.15 },
    { z: 2.55, width: 0.26, height: 0.29, y: 0.31, exponent: 2.0 },
    { z: 3.12, width: 0.16, height: 0.19, y: 0.37, exponent: 2.0 },
    { z: 3.58, width: 0.075, height: 0.10, y: 0.40, exponent: 2.0 },
  ];
  addMesh(group, loftGeometry(fuselageStations, 32, {
    zMin: -1.48,
    zMax: 0.82,
    yMin: 0.47,
  }), materials.crimson, [0, 0, 0], 'Fuselage shell with cockpit aperture');

  // Cream belly fairing and raised coach lines soften the large painted body.
  addMesh(group, loftGeometry([
    { z: -3.02, width: 0.12, height: 0.045, y: -0.54, exponent: 2.0 },
    { z: -2.45, width: 0.25, height: 0.085, y: -0.60, exponent: 2.2 },
    { z: -1.55, width: 0.30, height: 0.10, y: -0.61, exponent: 2.3 },
    { z: -0.58, width: 0.27, height: 0.085, y: -0.53, exponent: 2.2 },
    { z: 0.42, width: 0.12, height: 0.04, y: -0.39, exponent: 2.0 },
  ], 14), materials.cream, [0, 0, 0], 'Belly fairing');
  for (const sign of [-1, 1]) {
    tube(group, [
      new THREE.Vector3(sign * 0.575, 0.00, -2.75),
      new THREE.Vector3(sign * 0.665, 0.04, -1.85),
      new THREE.Vector3(sign * 0.615, 0.09, -0.62),
      new THREE.Vector3(sign * 0.47, 0.18, 0.93),
      new THREE.Vector3(sign * 0.29, 0.29, 2.22),
    ], 0.002, materials.cream, 40, 5, 'Fuselage coach line paint edge');
  }

  // A deliberately asymmetric set of service features gives the airframe a
  // plausible operating side and remains legible at normal game distance.
  const stepRootFront = new THREE.Vector3(-0.54, -0.08, 0.12);
  const stepRootRear = new THREE.Vector3(-0.52, -0.07, 0.42);
  const stepOuterFront = new THREE.Vector3(-0.76, -0.14, 0.15);
  const stepOuterRear = new THREE.Vector3(-0.75, -0.13, 0.39);
  cylinderBetween(group, stepRootFront, stepOuterFront, 0.012, materials.darkMetal, 8, 'Port boarding step forward arm');
  cylinderBetween(group, stepRootRear, stepOuterRear, 0.012, materials.darkMetal, 8, 'Port boarding step rear arm');
  cylinderBetween(group, stepOuterFront, stepOuterRear, 0.014, materials.darkMetal, 8, 'Port boarding step tread');

  const hatchGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0.505, 0.10, 0.80),
    new THREE.Vector3(0.475, 0.10, 1.24),
    new THREE.Vector3(0.455, 0.42, 1.24),
    new THREE.Vector3(0.500, 0.45, 0.80),
  ]);
  const hatch = new THREE.LineLoop(hatchGeometry, new THREE.LineBasicMaterial({ color: 0x3d2222, transparent: true, opacity: 0.70 }));
  hatch.name = 'Starboard baggage hatch outline';
  group.add(hatch);

  const staticPort = addMesh(group, new THREE.CircleGeometry(0.018, 18), materials.darkMetal, [0, 0, 0], 'Port static pressure port');
  staticPort.position.set(-0.676, 0.12, -1.66);
  staticPort.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0));
  cylinderBetween(
    group,
    new THREE.Vector3(0.12, -0.57, -0.91),
    new THREE.Vector3(0.12, -0.66, -0.89),
    0.007,
    materials.darkMetal,
    7,
    'Belly drain mast',
  );

  // Open annular cowl, inner duct, panel rings and subtle fasteners.
  // Broad at the fuselage and narrower at the intake: the cowl tapers forward.
  const cowl = addMesh(group, new THREE.CylinderGeometry(0.59, 0.52, 0.46, 28, 2, true), materials.crimsonDark, [0, -0.015, -3.65], 'Engine cowling');
  cowl.rotation.x = Math.PI / 2;
  const cowlLip = addMesh(group, new THREE.TorusGeometry(0.515, 0.052, 10, 32), materials.darkMetal, [0, -0.015, -3.90], 'Cowl lip');
  cowlLip.scale.y = 0.97;
  const cowlIntake = addMesh(group, new THREE.CircleGeometry(0.455, 48), materials.cockpit, [0, -0.015, -3.79], 'Recessed cowl backing');
  cowlIntake.rotation.y = Math.PI;
  const innerHub = addMesh(group, new THREE.CylinderGeometry(0.24, 0.18, 0.30, 20), materials.darkMetal, [0, -0.015, -3.84], 'Propeller gearbox');
  innerHub.rotation.x = Math.PI / 2;
  // A readable nine-cylinder radial sits just behind the lip instead of an
  // unexplained black disc.
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2;
    const inner = new THREE.Vector3(Math.cos(angle) * 0.20, -0.015 + Math.sin(angle) * 0.20, -3.84);
    const outer = new THREE.Vector3(Math.cos(angle) * 0.405, -0.015 + Math.sin(angle) * 0.405, -3.84);
    cylinderBetween(group, inner, outer, 0.070, materials.steel, 10, 'Radial engine cylinder');
    const head = addMesh(group, new THREE.BoxGeometry(0.125, 0.075, 0.11), materials.darkMetal, [outer.x, outer.y, outer.z], 'Radial cylinder head');
    head.rotation.z = angle;
  }
  for (const [z, radius] of [[-3.43, 0.586], [-3.72, 0.544]]) {
    const seam = addMesh(group, new THREE.TorusGeometry(radius, 0.005, 5, 32), materials.seam, [0, -0.015, z], 'Cowling panel seam');
    seam.scale.y = 1.02;
  }

  const fastenerGeo = new THREE.SphereGeometry(0.009, 6, 4);
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    addMesh(group, fastenerGeo, materials.steel, [Math.cos(angle) * 0.560, -0.015 + Math.sin(angle) * 0.560, -3.69], 'Cowl fastener');
  }

  // Intake duct and restrained rocker-clearance blisters.
  const intake = addMesh(group, new THREE.CylinderGeometry(0.155, 0.19, 0.52, 16, 2, false), materials.crimsonDark, [0, -0.58, -2.91], 'Belly intake');
  intake.rotation.x = Math.PI / 2;
  const intakeOpening = addMesh(group, new THREE.CircleGeometry(0.135, 16), materials.cockpit, [0, -0.58, -3.185], 'Belly intake opening');
  intakeOpening.rotation.y = Math.PI;
  for (const sign of [-1, 1]) {
    const cover = addMesh(group, new THREE.CapsuleGeometry(0.052, 0.48, 5, 10), materials.crimsonDark, [sign * 0.25, 0.53, -2.58], 'Cowling blister');
    cover.rotation.x = Math.PI / 2;
    cover.scale.y = 0.76;
  }

  // Paired collector outlets are mechanically consistent with the radial.
  for (const sign of [-1, 1]) {
    cylinderBetween(
      group,
      new THREE.Vector3(sign * 0.53, -0.26, -3.28),
      new THREE.Vector3(sign * 0.72, -0.36, -3.04),
      0.058,
      materials.exhaust,
      12,
      'Radial collector exhaust',
    );
  }

  // Cockpit interior: tub, seat, headrest, panel, gauges and control stick.
  addMesh(group, taperedBoxGeometry(0.88, 0.24, 1.74, 0.90), materials.cockpit, [0, 0.34, -0.32], 'Cockpit tub');
  addMesh(group, new THREE.BoxGeometry(0.055, 0.33, 1.70), materials.cockpit, [-0.45, 0.48, -0.32], 'Left cockpit sidewall');
  addMesh(group, new THREE.BoxGeometry(0.055, 0.33, 1.70), materials.cockpit, [0.45, 0.48, -0.32], 'Right cockpit sidewall');
  const leftCoaming = [
    new THREE.Vector3(-0.49, 0.50, -1.48),
    new THREE.Vector3(-0.52, 0.49, -0.95),
    new THREE.Vector3(-0.49, 0.50, -0.25),
    new THREE.Vector3(-0.42, 0.53, 0.40),
    new THREE.Vector3(-0.30, 0.57, 0.82),
  ];
  const rightCoaming = leftCoaming.map(point => new THREE.Vector3(-point.x, point.y, point.z));
  tube(group, leftCoaming, 0.018, materials.crimsonDark, 30, 7, 'Left cockpit coaming');
  tube(group, rightCoaming, 0.018, materials.crimsonDark, 30, 7, 'Right cockpit coaming');
  cylinderBetween(group, leftCoaming[0], rightCoaming[0], 0.018, materials.crimsonDark, 8, 'Forward cockpit coaming');
  cylinderBetween(group, leftCoaming[4], rightCoaming[4], 0.018, materials.crimsonDark, 8, 'Rear cockpit coaming');
  const seatBack = addMesh(group, taperedBoxGeometry(0.50, 0.50, 0.10, 0.72), materials.leather, [0, 0.72, 0.24], 'Pilot seat');
  seatBack.rotation.x = 0.16;
  addMesh(group, new THREE.BoxGeometry(0.60, 0.12, 0.52), materials.leather, [0, 0.51, -0.08], 'Seat cushion');
  const headrest = addMesh(group, new THREE.CapsuleGeometry(0.105, 0.13, 6, 10), materials.leather, [0, 0.87, 0.34], 'Headrest');
  headrest.scale.z = 0.82;
  const instrumentPanel = new THREE.Group();
  instrumentPanel.position.set(0, 0.75, -1.04);
  instrumentPanel.rotation.x = -0.10;
  instrumentPanel.name = 'Instrument panel assembly';
  addMesh(instrumentPanel, taperedBoxGeometry(0.74, 0.36, 0.060, 0.73), materials.cockpit, [0, 0, 0], 'Instrument panel');
  const gaugeGeo = new THREE.CylinderGeometry(0.060, 0.060, 0.016, 18);
  for (const [x, y] of [[-0.21, 0.08], [0, 0.10], [0.21, 0.08], [-0.12, -0.07], [0.12, -0.07]]) {
    const gauge = addMesh(instrumentPanel, gaugeGeo, materials.steel, [x, y, 0.047], 'Instrument bezel');
    gauge.rotation.x = Math.PI / 2;
    addMesh(instrumentPanel, new THREE.CircleGeometry(0.045, 16), materials.cockpit, [x, y, 0.058], 'Instrument face');
  }
  group.add(instrumentPanel);
  cylinderBetween(group, new THREE.Vector3(0, 0.53, -0.44), new THREE.Vector3(0.08, 0.94, -0.55), 0.025, materials.darkMetal, 8, 'Control stick');
  addMesh(group, new THREE.TorusGeometry(0.075, 0.018, 6, 16), materials.leather, [0.08, 0.96, -0.55], 'Control grip').rotation.x = Math.PI / 2;

  // Purposeful cockpit hardware remains readable through the canopy without
  // filling the cabin with decorative noise.
  for (const sign of [-1, 1]) {
    ribbonBetween(
      group,
      new THREE.Vector3(sign * 0.14, 0.97, 0.27),
      new THREE.Vector3(sign * 0.07, 0.61, -0.13),
      0.055,
      0.010,
      materials.webbing,
      sign < 0 ? 'Left shoulder harness' : 'Right shoulder harness',
    );
    ribbonBetween(
      group,
      new THREE.Vector3(sign * 0.25, 0.59, -0.02),
      new THREE.Vector3(sign * 0.055, 0.58, -0.15),
      0.050,
      0.010,
      materials.webbing,
      sign < 0 ? 'Left lap belt' : 'Right lap belt',
    );
    const pedalRodEnd = new THREE.Vector3(sign * 0.17, 0.48, -0.84);
    cylinderBetween(group, new THREE.Vector3(sign * 0.17, 0.36, -0.64), pedalRodEnd, 0.010, materials.darkMetal, 8, 'Rudder pedal linkage');
    const pedal = addMesh(group, new THREE.BoxGeometry(0.14, 0.025, 0.075), materials.darkMetal, [pedalRodEnd.x, pedalRodEnd.y, pedalRodEnd.z], 'Rudder pedal');
    pedal.rotation.x = -0.24;
  }
  addMesh(group, new THREE.BoxGeometry(0.105, 0.026, 0.085), materials.steel, [0, 0.585, -0.15], 'Harness buckle');
  addMesh(group, taperedBoxGeometry(0.10, 0.16, 0.25, 0.82), materials.cockpit, [-0.405, 0.66, -0.43], 'Throttle quadrant');
  const throttleBase = new THREE.Vector3(-0.39, 0.72, -0.47);
  const throttleTip = new THREE.Vector3(-0.34, 0.88, -0.51);
  cylinderBetween(group, throttleBase, throttleTip, 0.012, materials.steel, 8, 'Throttle lever');
  addMesh(group, new THREE.SphereGeometry(0.034, 12, 8), materials.crimsonDark, [throttleTip.x, throttleTip.y, throttleTip.z], 'Throttle knob');

  // Curved transparent canopy with conforming hoops and longitudinal frames.
  const canopyData = canopyGeometry();
  const canopyGlass = addMesh(group, canopyData.geometry, materials.glass, [0, 0, 0], 'Canopy glass');
  canopyGlass.renderOrder = 2;
  const frameStations = [0, 2, 4, 5];
  for (const stationIndex of frameStations) {
    const station = canopyData.stations[stationIndex];
    const points = [];
    for (let i = 0; i <= 8; i++) {
      const angle = Math.PI - (i / 8) * Math.PI;
      points.push(new THREE.Vector3(
        Math.cos(angle) * station.width,
        station.base + Math.sin(angle) * station.height,
        station.z,
      ));
    }
    tube(group, points, 0.016, materials.crimsonDark, 24, 6, 'Canopy hoop');
  }
  for (const side of [-1, 1]) {
    tube(group, canopyData.stations.map(station => new THREE.Vector3(side * station.width, station.base, station.z)), 0.020, materials.crimsonDark, 28, 6, 'Canopy sill');
  }
  tube(group, canopyData.stations.map(station => new THREE.Vector3(0, station.base + station.height, station.z)), 0.014, materials.crimsonDark, 28, 6, 'Canopy spine');

  // Wings: smooth NACA-like sections, dihedral, washout and separate surfaces.
  const wingSpec = {
    rootX: 0.48,
    tipX: 5.28,
    rootLead: -1.55,
    tipLead: -1.10,
    rootChord: 2.48,
    tipChord: 1.18,
    rootThickness: 0.185,
    tipThickness: 0.085,
    yRoot: -0.20,
    dihedral: 0.060,
    dihedralCurve: 0.055,
    washout: -0.014,
    planformCurve: -0.065,
    tipRoundStart: 0.79,
    tipRound: 0.78,
    tipChordMinimum: 0.18,
    profile: FIXED_AIRFOIL,
    surfaceProfile: AIRFOIL,
  };
  const tipObjects = {};
  const ailerons = {};
  const wingAssemblies = {};
  const wingParents = {};
  const flexSpans = [0.24, 0.52, 0.77];
  const segmentBounds = [0, ...flexSpans, 1];
  const wingFlexJoints = {};
  const wingSegments = {};

  // Four nested span sections create a cumulative bend. Internal boundaries
  // share the same uncapped section; a thin conformal top cover hides the seam.
  for (const sign of [-1, 1]) {
    const sideName = sign < 0 ? 'Left' : 'Right';
    const segments = [];
    const rootPivot = wingFrameAt(wingSpec, sign, 0, 0.42, 'mid').point;
    const root = new THREE.Group();
    root.position.copy(rootPivot);
    root.name = `${sideName} fixed wing root`;
    group.add(root);
    wingAssemblies[sign] = root;

    let parentJoint = root;
    let parentPivot = rootPivot;
    for (let segmentIndex = 0; segmentIndex < segmentBounds.length - 1; segmentIndex++) {
      const spanStart = segmentBounds[segmentIndex];
      const spanEnd = segmentBounds[segmentIndex + 1];
      let joint = parentJoint;
      let pivot = parentPivot;
      if (segmentIndex > 0) {
        pivot = wingFrameAt(wingSpec, sign, spanStart, 0.42, 'mid').point;
        joint = new THREE.Group();
        joint.position.copy(pivot).sub(parentPivot);
        joint.name = `${sideName} wing flex ${['inboard', 'midspan', 'outboard'][segmentIndex - 1]}`;
        parentJoint.add(joint);
        parentJoint = joint;
        parentPivot = pivot;
      }
      const content = new THREE.Group();
      content.position.copy(pivot).multiplyScalar(-1);
      content.name = `${sideName} wing span ${segmentIndex + 1}`;
      joint.add(content);
      addMesh(content, wingGeometry(wingSpec, sign, 5, {
        spanStart,
        spanEnd,
        capRoot: spanStart === 0,
        capTip: spanEnd === 1,
      }), materials.cream, [0, 0, 0], `${sideName} wing skin ${segmentIndex + 1}`);
      segments.push({ spanStart, spanEnd, joint, content, pivot });
    }
    wingSegments[sign] = segments;
    wingFlexJoints[sign] = segments.slice(1).map(segment => segment.joint);
    wingParents[sign] = segments[0].content;

    for (let jointIndex = 0; jointIndex < flexSpans.length; jointIndex++) {
      const spanT = flexSpans[jointIndex];
      addMesh(
        segments[jointIndex].content,
        wingPatchGeometry(wingSpec, sign, spanT - 0.010, spanT + 0.010, 0.035, 0.69, 0.003),
        materials.cream,
        [0, 0, 0],
        `${sideName} flexible skin joint cover`,
      );
    }

    addMesh(
      group,
      wingRootFairingGeometry(wingSpec, sign),
      materials.crimson,
      [0, 0, 0],
      `${sideName} blended wing root fairing`,
    );
  }

  const segmentAt = (sign, spanT) => wingSegments[sign].find(segment => (
    spanT >= segment.spanStart - 1e-6 && spanT <= segment.spanEnd + 1e-6
  )) ?? wingSegments[sign][wingSegments[sign].length - 1];

  function addSplitSurface(sign, spanStart, spanEnd, material, label, controller = null) {
    const pieces = [];
    for (const segment of wingSegments[sign]) {
      const pieceStart = Math.max(spanStart, segment.spanStart);
      const pieceEnd = Math.min(spanEnd, segment.spanEnd);
      if (pieceEnd - pieceStart < 0.002) continue;
      const piece = makeWingSurface(segment.content, wingSpec, sign, pieceStart, pieceEnd, 0.705, material, `${label} section`, {
        capStart: pieceStart === spanStart,
        capEnd: pieceEnd === spanEnd,
      });
      pieces.push(piece);
    }
    if (controller) controller.userData.surfaces.push(...pieces);
    return pieces;
  }

  const roundelMaterial = new THREE.MeshStandardMaterial({
    map: roundelTexture(),
    transparent: true,
    depthWrite: false,
    roughness: 0.44,
    metalness: 0.02,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });

  for (const sign of [-1, 1]) {
    const sideName = sign < 0 ? 'Left' : 'Right';
    const aileronController = new THREE.Group();
    aileronController.name = `${sideName} aileron controller`;
    aileronController.userData.surfaces = [];
    group.add(aileronController);
    ailerons[sign] = aileronController;

    addSplitSurface(sign, 0.00, 0.075, materials.cream, `${sideName} root trailing panel`);
    addSplitSurface(sign, 0.08, 0.46, materials.crimsonDark, `${sideName} flap`);
    addSplitSurface(sign, 0.47, 0.92, materials.crimson, `${sideName} aileron`, aileronController);
    addSplitSurface(sign, 0.925, 1.00, materials.cream, `${sideName} tip trailing panel`);

    // Conformal paint and markings replace floating boxes and stacked coins.
    const outerSegment = segmentAt(sign, 0.88);
    addMesh(outerSegment.content, wingPatchGeometry(wingSpec, sign, 0.855, 0.905, 0.12, 0.63), materials.crimson, [0, 0, 0], 'Wing identification band decal');
    const roundelSegment = segmentAt(sign, 0.58);
    addRoundel(roundelSegment.content, wingSpec, sign, 0.58, 0.43, roundelMaterial);

    const navMaterial = standard(sign < 0 ? 0xff352f : 0x35ec72, {
      emissive: sign < 0 ? 0xff1f18 : 0x18df58,
      emissiveIntensity: 2.3,
      roughness: 0.20,
    });
    const tipFrame = wingFrameAt(wingSpec, sign, 0.992, 0.31, 'upper', 0.008);
    const tipSegment = segmentAt(sign, 0.992);
    const navLight = addMesh(tipSegment.content, new THREE.SphereGeometry(0.047, 16, 10), navMaterial, [0, 0, 0], 'Inset navigation light');
    navLight.position.copy(tipFrame.point);
    navLight.scale.set(1.18, 0.62, 1.34);
    const tip = new THREE.Object3D();
    tip.position.copy(tipFrame.point);
    tipSegment.content.add(tip);
    tipObjects[sign] = tip;

    for (const spanT of [0.20, 0.38, 0.65, 0.82]) {
      const start = wingFrameAt(wingSpec, sign, spanT, 0.09, 'upper', 0.004).point;
      const end = wingFrameAt(wingSpec, sign, spanT, 0.69, 'upper', 0.004).point;
      const seamGeometry = new THREE.BufferGeometry().setFromPoints([start, end]);
      const seam = new THREE.Line(seamGeometry, new THREE.LineBasicMaterial({ color: 0x665e56, transparent: true, opacity: 0.42 }));
      seam.name = `${sideName} wing panel seam`;
      segmentAt(sign, spanT).content.add(seam);
    }
  }

  const fuelCapFrame = wingFrameAt(wingSpec, 1, 0.205, 0.38, 'upper', 0.005);
  const fuelCapParent = segmentAt(1, 0.205).content;
  const fuelCap = addMesh(fuelCapParent, new THREE.CircleGeometry(0.071, 28), materials.darkMetal, [0, 0, 0], 'Starboard fuel filler cap');
  fuelCap.position.copy(fuelCapFrame.point);
  fuelCap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), fuelCapFrame.normal);
  const fuelCapRim = addMesh(fuelCapParent, new THREE.RingGeometry(0.071, 0.086, 28), materials.steel, [0, 0, 0], 'Starboard fuel filler rim');
  fuelCapRim.position.copy(fuelCapFrame.point).addScaledVector(fuelCapFrame.normal, 0.001);
  fuelCapRim.quaternion.copy(fuelCap.quaternion);

  // Pitot and landing lamp use the same exact local surface frame as the skin.
  const pitotFrame = wingFrameAt(wingSpec, -1, 0.73, 0.025, 'mid');
  const pitotParent = segmentAt(-1, 0.73).content;
  cylinderBetween(pitotParent, pitotFrame.point, pitotFrame.point.clone().add(new THREE.Vector3(0, 0, -0.58)), 0.009, materials.steel, 8, 'Pitot tube');
  const lampMaterial = standard(0xffffff, { emissive: 0xfff1cc, emissiveIntensity: 1.8, roughness: 0.12 });
  const lampFrame = wingFrameAt(wingSpec, -1, 0.33, 0.015, 'mid');
  const lamp = addMesh(segmentAt(-1, 0.33).content, new THREE.SphereGeometry(0.075, 16, 10), lampMaterial, [0, 0, 0], 'Recessed landing light');
  lamp.position.copy(lampFrame.point);
  lamp.scale.set(1.18, 0.52, 0.38);

  // Thin airfoil tailplanes and two elevator panels on a single hinge group.
  const tailSpec = {
    rootX: 0.22,
    tipX: 2.05,
    rootLead: 2.18,
    tipLead: 2.621,
    rootChord: 1.35,
    tipChord: 0.72,
    rootThickness: 0.095,
    tipThickness: 0.045,
    yRoot: 0.38,
    dihedral: 0,
    dihedralCurve: 0,
    washout: 0,
    planformCurve: -0.02,
    tipRoundStart: 0.76,
    tipRound: 0.62,
    tipChordMinimum: 0.13,
    profile: FIXED_AIRFOIL,
    surfaceProfile: AIRFOIL,
  };
  for (const sign of [-1, 1]) {
    addMesh(group, wingGeometry(tailSpec, sign, 10), materials.cream, [0, 0, 0], sign < 0 ? 'Left stabilizer' : 'Right stabilizer');
  }
  const elevator = new THREE.Group();
  elevator.name = 'Elevator controller';
  group.add(elevator);
  const elevatorL = makeWingSurface(elevator, tailSpec, -1, 0.00, 1.00, 0.705, materials.crimson, 'Left elevator');
  const elevatorR = makeWingSurface(elevator, tailSpec, 1, 0.00, 1.00, 0.705, materials.crimson, 'Right elevator');

  // Multi-station airfoil fin and a tapered, rounded rudder replace flat slabs.
  const finStations = [
    { y: 0.36, lead: 2.08, chord: 1.34, thickness: 0.105 },
    { y: 0.78, lead: 2.18, chord: 1.19, thickness: 0.096 },
    { y: 1.25, lead: 2.34, chord: 0.96, thickness: 0.082 },
    { y: 1.72, lead: 2.50, chord: 0.73, thickness: 0.064 },
    { y: 2.08, lead: 2.63, chord: 0.55, thickness: 0.045 },
    { y: 2.25, lead: 2.72, chord: 0.40, thickness: 0.026 },
  ];
  addMesh(group, verticalAirfoilGeometry(finStations), materials.crimson, [0, 0, 0], 'Airfoil vertical stabilizer');
  const rudder = new THREE.Group();
  rudder.position.set(0, 0, 3.02);
  rudder.name = 'Rudder hinge';
  const rudderStations = [
    { y: 0.40, lead: 0.00, chord: 0.43, thickness: 0.080 },
    { y: 0.90, lead: 0.00, chord: 0.41, thickness: 0.072 },
    { y: 1.40, lead: 0.00, chord: 0.36, thickness: 0.060 },
    { y: 1.85, lead: 0.00, chord: 0.27, thickness: 0.043 },
    { y: 2.18, lead: 0.00, chord: 0.12, thickness: 0.020 },
  ];
  addMesh(rudder, verticalControlGeometry(rudderStations), materials.crimsonDark, [0, 0, 0], 'Airfoil rudder');
  group.add(rudder);

  // The white tail lens sits in an aft-pointing fairing attached to the rudder,
  // so it is visible at the actual tail and follows rudder movement.
  const tailLightFairing = addMesh(rudder, new THREE.ConeGeometry(0.050, 0.13, 16), materials.crimsonDark, [0, 0.47, 0.43], 'Tail light fairing');
  tailLightFairing.rotation.x = Math.PI / 2;
  const tailLight = addMesh(rudder, new THREE.SphereGeometry(0.038, 12, 8), standard(0xffffff, { emissive: 0xffffff, emissiveIntensity: 1.8 }), [0, 0.47, 0.495], 'Tail light');
  tailLight.scale.set(0.70, 0.78, 1.10);

  // Integrated fin beacon, aerial mast and wire.
  const beaconMaterial = standard(0x7a1113, { emissive: 0xff2025, emissiveIntensity: 0.12, roughness: 0.18 });
  const beacon = addMesh(group, new THREE.SphereGeometry(0.070, 12, 8), beaconMaterial, [0, 2.225, 2.76], 'Fin beacon');
  beacon.scale.set(0.82, 0.65, 0.82);
  cylinderBetween(group, new THREE.Vector3(0, 0.67, 1.07), new THREE.Vector3(0, 1.16, 1.02), 0.009, materials.darkMetal, 8, 'Aerial mast');
  const aerialGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 1.16, 1.02),
    new THREE.Vector3(0, 2.18, 2.70),
  ]);
  group.add(new THREE.Line(aerialGeometry, new THREE.LineBasicMaterial({ color: 0x262a2c, transparent: true, opacity: 0.78 })));

  // Profiled, twisted blades and a curved ogive spinner replace box blades and
  // the former straight-sided cone.
  const propeller = new THREE.Group();
  propeller.position.set(0, -0.015, -4.02);
  propeller.name = 'Propeller assembly';
  const spinnerProfile = [
    new THREE.Vector2(0.285, -0.275),
    new THREE.Vector2(0.292, -0.215),
    new THREE.Vector2(0.270, -0.080),
    new THREE.Vector2(0.220, 0.065),
    new THREE.Vector2(0.145, 0.180),
    new THREE.Vector2(0.060, 0.255),
    new THREE.Vector2(0.000, 0.275),
  ];
  const spinner = addMesh(propeller, new THREE.LatheGeometry(spinnerProfile, 40), materials.crimson, [0, 0, -0.275], 'Ogive spinner');
  spinner.rotation.x = -Math.PI / 2;
  const spinnerBackplate = addMesh(propeller, new THREE.CylinderGeometry(0.288, 0.288, 0.030, 40), materials.darkMetal, [0, 0, -0.010], 'Spinner backplate');
  spinnerBackplate.rotation.x = Math.PI / 2;
  const blades = new THREE.Group();
  // Keep the pitched blade roots forward of the cowl lip while the spinner
  // still overlaps and visually captures their inner ends.
  blades.position.z = -0.055;
  blades.name = 'Propeller blades';
  const bladeGeometry = propBladeGeometry([
    { radius: 0.16, width: 0.23, thickness: 0.085, sweep: 0.00, twist: 0.58 },
    { radius: 0.42, width: 0.31, thickness: 0.072, sweep: 0.035, twist: 0.51 },
    { radius: 0.66, width: 0.315, thickness: 0.064, sweep: 0.058, twist: 0.44 },
    { radius: 0.88, width: 0.28, thickness: 0.055, sweep: 0.08, twist: 0.38 },
    { radius: 1.20, width: 0.21, thickness: 0.043, sweep: 0.13, twist: 0.29 },
  ], { capEnd: false });
  const tipGeometry = propBladeGeometry([
    { radius: 1.20, width: 0.21, thickness: 0.043, sweep: 0.13, twist: 0.29 },
    { radius: 1.34, width: 0.16, thickness: 0.036, sweep: 0.15, twist: 0.25 },
    { radius: 1.43, width: 0.11, thickness: 0.030, sweep: 0.17, twist: 0.22 },
  ], { capStart: false });
  for (let i = 0; i < 3; i++) {
    const bladeHolder = new THREE.Group();
    bladeHolder.rotation.z = (i / 3) * Math.PI * 2;
    addMesh(bladeHolder, bladeGeometry, materials.darkMetal, [0, 0, 0], 'Propeller blade');
    addMesh(bladeHolder, tipGeometry, materials.cream, [0, 0, 0], 'Propeller blade tip');
    blades.add(bladeHolder);
  }
  propeller.add(blades);
  const propDisc = addMesh(
    propeller,
    new THREE.CircleGeometry(1.50, 48),
    new THREE.MeshBasicMaterial({ map: propDiscTexture(), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    [0, 0, -0.075],
    'Propeller blur',
  );
  propDisc.renderOrder = 3;
  group.add(propeller);

  // Retractable gear with wheel wells, oleo struts, forks, brake hubs and doors.
  const wheelWellMaterial = standard(0x20272c, { metalness: 0.28, roughness: 0.72 });
  const gearPivotX = 1.48;
  const gearFoldAngle = 1.72;
  const deployedAxle = side => new THREE.Vector3(side * 0.17, -1.06, 0.055);
  for (const side of [-1, 1]) {
    const foldedAxle = deployedAxle(side).applyAxisAngle(new THREE.Vector3(0, 0, 1), -side * gearFoldAngle);
    foldedAxle.add(new THREE.Vector3(side * gearPivotX, -0.22, -0.66));
    const well = addMesh(wingParents[side], new THREE.CylinderGeometry(0.37, 0.37, 0.022, 32), wheelWellMaterial, [foldedAxle.x, -0.31, foldedAxle.z], 'Wheel well aligned to folded wheel');
    well.scale.set(0.92, 1, 1.08);
    const pivotSocket = addMesh(wingParents[side], new THREE.CylinderGeometry(0.13, 0.13, 0.026, 24), wheelWellMaterial, [side * gearPivotX, -0.215, -0.66], 'Gear pivot socket');
    pivotSocket.scale.z = 1.25;
  }

  function buildGear(side) {
    const gear = new THREE.Group();
    gear.position.set(side * gearPivotX, -0.22, -0.66);
    gear.name = side < 0 ? 'Left landing gear' : 'Right landing gear';
    const knee = new THREE.Vector3(side * 0.11, -0.69, 0.02);
    const axle = deployedAxle(side);
    cylinderBetween(gear, new THREE.Vector3(0, 0, 0), knee, 0.064, materials.steel, 12, 'Main strut');
    cylinderBetween(gear, knee, axle, 0.052, materials.darkMetal, 12, 'Oleo piston');
    cylinderBetween(gear, new THREE.Vector3(side * 0.04, -0.82, 0.03), new THREE.Vector3(side * 0.25, -1.04, 0.055), 0.030, materials.steel, 8, 'Wheel fork');
    const door = addMesh(gear, profileGeometry([
      [-0.10, -0.08],
      [-0.74, -0.03],
      [-0.80, 0.10],
      [-0.13, 0.09],
    ], 0.052), materials.cream, [side * 0.13, 0, 0], 'Contoured gear door');
    door.rotation.z = -side * 0.075;
    // Torque links and a restrained brake hose give the leg a believable load path.
    const linkTop = new THREE.Vector3(side * 0.10, -0.66, 0.045);
    const linkKnee = new THREE.Vector3(side * 0.24, -0.79, 0.07);
    const linkBottom = new THREE.Vector3(side * 0.13, -0.91, 0.055);
    cylinderBetween(gear, linkTop, linkKnee, 0.018, materials.darkMetal, 8, 'Upper torque link');
    cylinderBetween(gear, linkKnee, linkBottom, 0.018, materials.darkMetal, 8, 'Lower torque link');
    tube(gear, [
      new THREE.Vector3(-side * 0.025, -0.18, 0.065),
      new THREE.Vector3(-side * 0.030, -0.62, 0.075),
      new THREE.Vector3(side * 0.08, -0.97, 0.075),
    ], 0.007, materials.rubber, 18, 5, 'Brake hose');

    const wheelSpin = new THREE.Group();
    wheelSpin.position.copy(axle);
    wheelSpin.name = 'Main wheel spin';
    const tireMesh = addMesh(wheelSpin, new THREE.TorusGeometry(0.25, 0.09, 12, 28), materials.rubber, [0, 0, 0], 'Main tire');
    tireMesh.rotation.y = Math.PI / 2;
    const hub = addMesh(wheelSpin, new THREE.CylinderGeometry(0.125, 0.125, 0.17, 20), materials.crimsonDark, [0, 0, 0], 'Wheel hub');
    hub.rotation.z = Math.PI / 2;
    const brake = addMesh(wheelSpin, new THREE.CylinderGeometry(0.095, 0.095, 0.176, 20), materials.steel, [0, 0, 0], 'Brake disc');
    brake.rotation.z = Math.PI / 2;
    const hubRim = addMesh(wheelSpin, new THREE.TorusGeometry(0.142, 0.012, 6, 18), materials.steel, [0, 0, 0], 'Hub rim');
    hubRim.rotation.y = Math.PI / 2;
    gear.add(wheelSpin);
    wingParents[side].add(gear);
    return { gear, wheelSpin };
  }

  const leftGear = buildGear(-1);
  const rightGear = buildGear(1);

  // Articulated tail wheel.
  const tailWheel = new THREE.Group();
  tailWheel.position.set(0, 0.26, 3.10);
  tailWheel.name = 'Tail wheel';
  cylinderBetween(tailWheel, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.62, 0.12), 0.035, materials.steel, 8, 'Tail wheel strut');
  const tailForkEnd = new THREE.Vector3(0, -0.68, 0.16);
  cylinderBetween(tailWheel, new THREE.Vector3(-0.07, -0.52, 0.12), new THREE.Vector3(-0.07, -0.68, 0.16), 0.022, materials.darkMetal, 8, 'Tail wheel fork');
  cylinderBetween(tailWheel, new THREE.Vector3(0.07, -0.52, 0.12), new THREE.Vector3(0.07, -0.68, 0.16), 0.022, materials.darkMetal, 8, 'Tail wheel fork');
  const tailWheelSpin = new THREE.Group();
  tailWheelSpin.position.copy(tailForkEnd);
  const tailTire = addMesh(tailWheelSpin, new THREE.TorusGeometry(0.145, 0.052, 9, 20), materials.rubber, [0, 0, 0], 'Tail tire');
  tailTire.rotation.y = Math.PI / 2;
  const tailHub = addMesh(tailWheelSpin, new THREE.CylinderGeometry(0.065, 0.065, 0.12, 14), materials.crimsonDark, [0, 0, 0], 'Tail wheel hub');
  tailHub.rotation.z = Math.PI / 2;
  tailWheel.add(tailWheelSpin);
  group.add(tailWheel);

  group.traverse(object => {
    if (!object.isMesh) return;
    const transparent = object.material?.transparent === true;
    object.castShadow = !transparent && object !== propDisc;
    object.receiveShadow = !transparent;
  });
  canopyGlass.castShadow = false;
  propDisc.castShadow = false;

  return {
    group,
    blades,
    propDisc,
    aileronL: ailerons[-1],
    aileronR: ailerons[1],
    elevator,
    elevatorL,
    elevatorR,
    rudder,
    tipL: tipObjects[-1],
    tipR: tipObjects[1],
    wingFlexJointsL: wingFlexJoints[-1],
    wingFlexJointsR: wingFlexJoints[1],
    // Backward-compatible aliases now point at the first real bend joints;
    // fixed root assemblies are exposed separately for hierarchy inspection.
    wingFlexL: wingFlexJoints[-1][0],
    wingFlexR: wingFlexJoints[1][0],
    wingAssemblyL: wingAssemblies[-1],
    wingAssemblyR: wingAssemblies[1],
    gearL: leftGear.gear,
    gearR: rightGear.gear,
    tailWheel,
    wheelL: leftGear.wheelSpin,
    wheelR: rightGear.wheelSpin,
    tailWheelSpin,
    beacon,
    capabilities: aircraftCapabilities,
    blinkT: 0,
  };
}

const compatibilityPhysics = { throttle: 0, gearTransit: 1, grounded: false, speed: 0 };

export function updatePlaneVisual(plane, input = {}, physics = compatibilityPhysics, dt = 0) {
  if (typeof physics === 'number') {
    compatibilityPhysics.throttle = physics;
    physics = compatibilityPhysics;
  }

  const throttle = THREE.MathUtils.clamp(physics.throttle ?? 0, 0, 1);
  plane.blades.rotation.z -= (4.5 + throttle * 57) * dt;
  plane.propDisc.material.opacity = Math.min(0.28, Math.max(0, throttle - 0.10) * 0.48);

  const roll = input.rollSm ?? 0;
  const pitch = input.pitchSm ?? 0;
  const yaw = input.yawSm ?? 0;
  const wingFlex = THREE.MathUtils.clamp(input.wingFlexSm ?? 0, -1, 1);
  const wingFlexAngle = wingFlex * THREE.MathUtils.degToRad(aircraftCapabilities.features.wingFlex.maxTipDeflectionDeg);
  const flexContract = aircraftCapabilities.features.wingFlex.joints;
  if (plane.wingFlexJointsL?.length && plane.wingFlexJointsR?.length) {
    plane.wingFlexJointsL.forEach((joint, index) => {
      joint.rotation.z = -wingFlexAngle * flexContract.left[index].weight;
    });
    plane.wingFlexJointsR.forEach((joint, index) => {
      joint.rotation.z = wingFlexAngle * flexContract.right[index].weight;
    });
  } else {
    // Compatibility with v1 assets passed into the current updater.
    plane.wingFlexL.rotation.z = -wingFlexAngle;
    plane.wingFlexR.rotation.z = wingFlexAngle;
  }
  const aileronAngle = roll * 0.46;
  const driveControl = (controller, angle) => {
    const surfaces = controller?.userData?.surfaces;
    if (surfaces?.length) surfaces.forEach(surface => { surface.rotation.x = angle; });
    else if (controller) controller.rotation.x = angle;
  };
  driveControl(plane.aileronL, aileronAngle);
  driveControl(plane.aileronR, aileronAngle);
  const elevatorAngle = -pitch * 0.46;
  if (plane.elevatorL && plane.elevatorR) {
    plane.elevatorL.rotation.x = -elevatorAngle;
    plane.elevatorR.rotation.x = elevatorAngle;
  } else {
    plane.elevator.rotation.x = elevatorAngle;
  }
  plane.rudder.rotation.y = yaw * 0.48;

  const gearTransit = THREE.MathUtils.clamp(physics.gearTransit ?? 1, 0, 1);
  const fold = (1 - gearTransit) * 1.72;
  plane.gearL.rotation.z = fold;
  plane.gearR.rotation.z = -fold;

  if (physics.grounded && (physics.speed ?? 0) > 0.2) {
    const wheelRotation = ((physics.speed ?? 0) / 0.30) * dt;
    plane.wheelL.rotation.x -= wheelRotation;
    plane.wheelR.rotation.x -= wheelRotation;
    plane.tailWheelSpin.rotation.x -= wheelRotation * 2.05;
  }

  plane.blinkT = (plane.blinkT + dt) % 1;
  plane.beacon.material.emissiveIntensity = plane.blinkT < 0.15 ? 3.5 : 0.12;
}
