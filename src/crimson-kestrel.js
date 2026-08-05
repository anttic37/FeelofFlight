import * as THREE from 'three';

// Crimson Kestrel KX-1
// A semi-realistic, game-ready procedural taildragger. Nose points along -Z,
// +Y is up, and every animated surface keeps the original plane.js API.

export const aircraftInfo = Object.freeze({
  name: 'Crimson Kestrel KX-1',
  shortName: 'KX-1',
  manufacturer: 'Aurelia Aeroworks',
  role: 'Sport / reconnaissance taildragger',
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

function loftGeometry(stations, radialSegments = 20) {
  const positions = [];
  const indices = [];

  for (const station of stations) {
    const exponent = station.exponent ?? 2.15;
    for (let i = 0; i < radialSegments; i++) {
      const angle = (i / radialSegments) * Math.PI * 2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const shapedX = Math.sign(c) * Math.pow(Math.abs(c), 2 / exponent);
      const shapedY = Math.sign(s) * Math.pow(Math.abs(s), 2 / exponent);
      positions.push(
        shapedX * station.width,
        station.y + shapedY * station.height,
        station.z,
      );
    }
  }

  for (let ring = 0; ring < stations.length - 1; ring++) {
    for (let i = 0; i < radialSegments; i++) {
      const next = (i + 1) % radialSegments;
      const a = ring * radialSegments + i;
      const b = ring * radialSegments + next;
      const c = a + radialSegments;
      const d = b + radialSegments;
      indices.push(a, b, c, b, d, c);
    }
  }

  const noseCenter = positions.length / 3;
  positions.push(0, stations[0].y, stations[0].z - 0.035);
  const tailCenter = positions.length / 3;
  const lastStation = stations[stations.length - 1];
  positions.push(0, lastStation.y, lastStation.z + 0.035);
  const lastRing = (stations.length - 1) * radialSegments;

  for (let i = 0; i < radialSegments; i++) {
    const next = (i + 1) % radialSegments;
    indices.push(noseCenter, next, i);
    indices.push(tailCenter, lastRing + i, lastRing + next);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
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

function wingPoint(spec, sign, spanT, chordT, height = 0) {
  const rootX = spec.rootX;
  const tipX = spec.tipX;
  const unsignedX = THREE.MathUtils.lerp(rootX, tipX, spanT);
  const lead = THREE.MathUtils.lerp(spec.rootLead, spec.tipLead, spanT);
  const chord = THREE.MathUtils.lerp(spec.rootChord, spec.tipChord, spanT);
  const localZ = chord * chordT;
  const washout = THREE.MathUtils.lerp(0, spec.washout ?? 0, spanT);
  const y = spec.yRoot + (unsignedX - rootX) * spec.dihedral + washout * localZ + height;
  return new THREE.Vector3(sign * unsignedX, y, lead + chord * chordT);
}

function wingSurfacePoint(spec, sign, spanT, chordT) {
  const thickness = THREE.MathUtils.lerp(spec.rootThickness, spec.tipThickness, spanT);
  const camberOffset = (1 - chordT) * thickness * 0.50;
  return wingPoint(spec, sign, spanT, chordT, camberOffset);
}

function wingGeometry(spec, sign, spanSegments = 7) {
  const positions = [];
  const indices = [];
  const profile = spec.profile ?? AIRFOIL;
  const sectionSize = profile.length;

  for (let span = 0; span <= spanSegments; span++) {
    const t = span / spanSegments;
    const unsignedX = THREE.MathUtils.lerp(spec.rootX, spec.tipX, t);
    const lead = THREE.MathUtils.lerp(spec.rootLead, spec.tipLead, t);
    const chord = THREE.MathUtils.lerp(spec.rootChord, spec.tipChord, t);
    const thickness = THREE.MathUtils.lerp(spec.rootThickness, spec.tipThickness, t);
    const washout = THREE.MathUtils.lerp(0, spec.washout ?? -0.018, t);
    const centerY = spec.yRoot + (unsignedX - spec.rootX) * spec.dihedral;

    for (const [u, v] of profile) {
      const localZ = chord * u;
      positions.push(
        sign * unsignedX,
        centerY + v * thickness + washout * localZ,
        lead + localZ,
      );
    }
  }

  for (let span = 0; span < spanSegments; span++) {
    for (let i = 0; i < sectionSize; i++) {
      const next = (i + 1) % sectionSize;
      const a = span * sectionSize + i;
      const b = span * sectionSize + next;
      const c = a + sectionSize;
      const d = b + sectionSize;
      indices.push(a, b, c, b, d, c);
    }
  }

  for (let i = 1; i < sectionSize - 1; i++) {
    indices.push(0, i + 1, i);
    const tipBase = spanSegments * sectionSize;
    indices.push(tipBase, tipBase + i, tipBase + i + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
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

function makeWingSurface(parent, spec, sign, spanStart, spanEnd, hingeFraction, material, name) {
  const hingeA = wingSurfacePoint(spec, sign, spanStart, hingeFraction);
  const hingeB = wingSurfacePoint(spec, sign, spanEnd, hingeFraction);
  const trailB = wingSurfacePoint(spec, sign, spanEnd, 0.992);
  const trailA = wingSurfacePoint(spec, sign, spanStart, 0.992);
  const pivot = hingeA.clone().add(hingeB).multiplyScalar(0.5);
  const hingeAxis = hingeB.clone().sub(hingeA).normalize();
  const trailingAxis = trailA.clone().add(trailB).multiplyScalar(0.5).sub(pivot);
  trailingAxis.addScaledVector(hingeAxis, -trailingAxis.dot(hingeAxis)).normalize();
  const normalAxis = trailingAxis.clone().cross(hingeAxis).normalize();
  const basis = new THREE.Matrix4().makeBasis(hingeAxis, normalAxis, trailingAxis);
  const alignment = new THREE.Quaternion().setFromRotationMatrix(basis);
  const inverseAlignment = alignment.clone().invert();
  const corners = [hingeA, hingeB, trailB, trailA].map(point => (
    point.clone().sub(pivot).applyQuaternion(inverseAlignment)
  ));
  const hingeThicknessA = THREE.MathUtils.lerp(spec.rootThickness, spec.tipThickness, spanStart) * 0.79;
  const hingeThicknessB = THREE.MathUtils.lerp(spec.rootThickness, spec.tipThickness, spanEnd) * 0.79;

  const mount = new THREE.Group();
  mount.position.copy(pivot);
  mount.quaternion.copy(alignment);
  mount.name = `${name} mount`;

  const hinge = new THREE.Group();
  hinge.name = name;
  addMesh(
    hinge,
    prismGeometry(corners, [hingeThicknessA, hingeThicknessB, 0.012, 0.012]),
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
  const indices = [];

  for (const station of stations) {
    for (let i = 0; i <= arcSegments; i++) {
      const angle = Math.PI - (i / arcSegments) * Math.PI;
      positions.push(
        Math.cos(angle) * station.width,
        station.base + Math.sin(angle) * station.height,
        station.z,
      );
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

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, stations, arcSegments };
}

function propBladeGeometry(sections, { capStart = true, capEnd = true } = {}) {
  const positions = [];
  const indices = [];
  for (const section of sections) {
    const twist = section.twist;
    const corners = [
      [-section.width / 2, -section.thickness / 2],
      [section.width / 2, -section.thickness / 2],
      [section.width / 2, section.thickness / 2],
      [-section.width / 2, section.thickness / 2],
    ];
    for (const [x, z] of corners) {
      positions.push(
        section.sweep + x * Math.cos(twist) - z * Math.sin(twist),
        section.radius,
        x * Math.sin(twist) + z * Math.cos(twist),
      );
    }
  }
  for (let section = 0; section < sections.length - 1; section++) {
    const base = section * 4;
    const nextBase = base + 4;
    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      indices.push(base + i, nextBase + i, base + next, base + next, nextBase + i, nextBase + next);
    }
  }
  if (capStart) indices.push(0, 1, 2, 0, 2, 3);
  const end = (sections.length - 1) * 4;
  if (capEnd) indices.push(end, end + 2, end + 1, end, end + 3, end + 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
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

function addRoundel(parent, x, y, z, sign, materials) {
  const outer = addMesh(parent, new THREE.CylinderGeometry(0.38, 0.38, 0.018, 28), materials.cream, [x, y, z], 'Wing roundel');
  outer.rotation.z = sign * 0.058;
  const middle = addMesh(parent, new THREE.CylinderGeometry(0.255, 0.255, 0.021, 28), materials.crimson, [x, y + 0.014, z], 'Wing roundel middle');
  middle.rotation.z = sign * 0.058;
  const center = addMesh(parent, new THREE.CylinderGeometry(0.105, 0.105, 0.024, 24), materials.navy, [x, y + 0.028, z], 'Wing roundel center');
  center.rotation.z = sign * 0.058;
  return [outer, middle, center];
}

export function buildPlane() {
  const group = new THREE.Group();
  group.name = aircraftInfo.name;
  group.userData.aircraftInfo = aircraftInfo;

  const materials = {
    crimson: paint(0xa92f2b, { roughness: 0.29, clearcoat: 0.92 }),
    crimsonDark: paint(0x6f1f22, { roughness: 0.34, clearcoat: 0.72 }),
    cream: paint(0xe8dec8, { metalness: 0.03, roughness: 0.39, clearcoat: 0.64 }),
    navy: paint(0x17384a, { roughness: 0.28, clearcoat: 0.84 }),
    steel: standard(0xaeb8bd, { metalness: 0.82, roughness: 0.25 }),
    darkMetal: standard(0x242c31, { metalness: 0.68, roughness: 0.34 }),
    exhaust: standard(0x342b29, { metalness: 0.72, roughness: 0.52 }),
    rubber: standard(0x161a1d, { metalness: 0, roughness: 0.93 }),
    cockpit: standard(0x172127, { metalness: 0.18, roughness: 0.68 }),
    leather: standard(0x5b2d25, { metalness: 0, roughness: 0.82 }),
    seam: standard(0x27333b, { metalness: 0.35, roughness: 0.6 }),
    // no transmission: it forces three's transmission pass, which breaks the
    // ocean's onBeforeCompile shader (whole water sheet renders black)
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x8fc4d6,
      metalness: 0,
      roughness: 0.08,
      transparent: true,
      opacity: 0.46,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  };

  // Smooth superellipse fuselage, with extra stations around the cockpit and cowl.
  const fuselageStations = [
    { z: -3.72, width: 0.46, height: 0.45, y: -0.02, exponent: 2.0 },
    { z: -3.46, width: 0.57, height: 0.55, y: -0.01, exponent: 2.3 },
    { z: -2.95, width: 0.64, height: 0.62, y: 0.00, exponent: 2.45 },
    { z: -2.20, width: 0.68, height: 0.67, y: 0.02, exponent: 2.55 },
    { z: -1.42, width: 0.67, height: 0.67, y: 0.03, exponent: 2.55 },
    { z: -0.55, width: 0.63, height: 0.63, y: 0.06, exponent: 2.45 },
    { z: 0.32, width: 0.56, height: 0.57, y: 0.11, exponent: 2.35 },
    { z: 1.10, width: 0.47, height: 0.49, y: 0.17, exponent: 2.25 },
    { z: 1.85, width: 0.37, height: 0.40, y: 0.24, exponent: 2.15 },
    { z: 2.55, width: 0.26, height: 0.29, y: 0.31, exponent: 2.0 },
    { z: 3.12, width: 0.16, height: 0.19, y: 0.37, exponent: 2.0 },
    { z: 3.58, width: 0.075, height: 0.10, y: 0.40, exponent: 2.0 },
  ];
  addMesh(group, loftGeometry(fuselageStations), materials.crimson, [0, 0, 0], 'Fuselage');

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
    ], 0.035, materials.cream, 40, 6, 'Fuselage coach line');
  }

  // Open annular cowl, inner duct, panel rings and subtle fasteners.
  // Broad at the fuselage and narrower at the intake: the cowl tapers forward.
  const cowl = addMesh(group, new THREE.CylinderGeometry(0.59, 0.52, 0.46, 28, 2, true), materials.crimsonDark, [0, -0.015, -3.65], 'Engine cowling');
  cowl.rotation.x = Math.PI / 2;
  const cowlLip = addMesh(group, new THREE.TorusGeometry(0.515, 0.052, 10, 32), materials.darkMetal, [0, -0.015, -3.90], 'Cowl lip');
  cowlLip.scale.y = 0.97;
  const cowlIntake = addMesh(group, new THREE.RingGeometry(0.245, 0.455, 36), materials.cockpit, [0, -0.015, -3.78], 'Recessed cowl intake');
  cowlIntake.rotation.y = Math.PI;
  const innerHub = addMesh(group, new THREE.CylinderGeometry(0.24, 0.18, 0.30, 20), materials.darkMetal, [0, -0.015, -3.84], 'Propeller gearbox');
  innerHub.rotation.x = Math.PI / 2;
  for (const [z, radius] of [[-3.43, 0.586], [-3.72, 0.544]]) {
    const seam = addMesh(group, new THREE.TorusGeometry(radius, 0.012, 5, 28), materials.seam, [0, -0.015, z], 'Cowling panel seam');
    seam.scale.y = 1.02;
  }

  const fastenerGeo = new THREE.SphereGeometry(0.021, 6, 4);
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    addMesh(group, fastenerGeo, materials.steel, [Math.cos(angle) * 0.560, -0.015 + Math.sin(angle) * 0.560, -3.69], 'Cowl fastener');
  }

  // Intake duct and paired aerodynamic gun/rocker covers.
  const intake = addMesh(group, new THREE.CylinderGeometry(0.155, 0.19, 0.52, 16, 2, false), materials.crimsonDark, [0, -0.58, -2.91], 'Belly intake');
  intake.rotation.x = Math.PI / 2;
  const intakeOpening = addMesh(group, new THREE.CircleGeometry(0.135, 16), materials.cockpit, [0, -0.58, -3.185], 'Belly intake opening');
  intakeOpening.rotation.y = Math.PI;
  for (const sign of [-1, 1]) {
    const cover = addMesh(group, new THREE.CapsuleGeometry(0.075, 0.72, 5, 10), materials.crimsonDark, [sign * 0.25, 0.52, -2.55], 'Cowling blister');
    cover.rotation.x = Math.PI / 2;
    cover.scale.y = 0.76;
  }

  // Eight tapered exhaust stacks with a warm, heat-stained finish.
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = -3.12 + i * 0.27;
      cylinderBetween(
        group,
        new THREE.Vector3(sign * 0.58, -0.17, z - 0.08),
        new THREE.Vector3(sign * 0.70, -0.28, z + 0.13),
        0.044,
        materials.exhaust,
        8,
        'Exhaust stack',
      );
    }
  }

  // Cockpit interior: tub, seat, headrest, panel, gauges and control stick.
  addMesh(group, new THREE.BoxGeometry(0.90, 0.22, 1.72), materials.cockpit, [0, 0.44, -0.33], 'Cockpit tub');
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

  // Curved transparent canopy with conforming hoops and longitudinal frames.
  const canopyData = canopyGeometry();
  const canopyGlass = addMesh(group, canopyData.geometry, materials.glass, [0, 0, 0], 'Canopy glass');
  canopyGlass.renderOrder = 2;
  const frameStations = [1, 3, 5];
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
    tube(group, points, 0.026, materials.crimsonDark, 24, 6, 'Canopy hoop');
  }
  for (const side of [-1, 1]) {
    tube(group, canopyData.stations.map(station => new THREE.Vector3(side * station.width, station.base, station.z)), 0.030, materials.crimsonDark, 28, 6, 'Canopy sill');
  }
  tube(group, canopyData.stations.map(station => new THREE.Vector3(0, station.base + station.height, station.z)), 0.024, materials.crimsonDark, 28, 6, 'Canopy spine');

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
    washout: -0.014,
    profile: FIXED_AIRFOIL,
  };
  const tipObjects = {};
  const ailerons = {};
  const flaps = {};
  const wingAssemblies = {};
  const wingParents = {};
  const wingJoint = { x: 0.62, y: -0.060, z: -0.31 };

  // Each complete wing lives in a root-pivot assembly. The counter-offset
  // child lets all existing aircraft-space coordinates remain exact while the
  // parent rotates around a fore-aft hinge line at the wing root.
  for (const sign of [-1, 1]) {
    const pivot = new THREE.Vector3(sign * wingJoint.x, wingJoint.y, wingJoint.z);
    const flexRoot = new THREE.Group();
    flexRoot.position.copy(pivot);
    flexRoot.name = sign < 0 ? 'Left wing flex joint' : 'Right wing flex joint';
    const content = new THREE.Group();
    content.position.copy(pivot).multiplyScalar(-1);
    content.name = sign < 0 ? 'Left complete wing' : 'Right complete wing';
    flexRoot.add(content);
    group.add(flexRoot);
    wingAssemblies[sign] = flexRoot;
    wingParents[sign] = content;
  }

  for (const sign of [-1, 1]) {
    const wingParent = wingParents[sign];
    addMesh(wingParent, wingGeometry(wingSpec, sign), materials.cream, [0, 0, 0], sign < 0 ? 'Left wing' : 'Right wing');
    const fillet = addMesh(group, new THREE.SphereGeometry(1, 20, 10), materials.crimson, [sign * 0.57, -0.16, -0.24], 'Wing root fillet');
    fillet.scale.set(0.36, 0.095, 0.64);
    fillet.rotation.z = sign * 0.045;

    makeWingSurface(wingParent, wingSpec, sign, 0.00, 0.075, 0.705, materials.cream, sign < 0 ? 'Left root trailing panel' : 'Right root trailing panel');
    flaps[sign] = makeWingSurface(wingParent, wingSpec, sign, 0.08, 0.46, 0.705, materials.crimsonDark, sign < 0 ? 'Left flap' : 'Right flap');
    const aileron = makeWingSurface(wingParent, wingSpec, sign, 0.47, 0.92, 0.705, materials.crimson, sign < 0 ? 'Left aileron' : 'Right aileron');
    makeWingSurface(wingParent, wingSpec, sign, 0.925, 1.00, 0.705, materials.cream, sign < 0 ? 'Left tip trailing panel' : 'Right tip trailing panel');
    ailerons[sign] = aileron;

    // Coaxial exposed hinge along the upper root spar. Alternating fixed and
    // moving knuckles, collars and mounting ears make the articulation legible.
    const axle = addMesh(
      group,
      new THREE.CylinderGeometry(0.023, 0.023, 1.56, 12),
      materials.darkMetal,
      [sign * wingJoint.x, wingJoint.y, -0.55],
      sign < 0 ? 'Left wing hinge axle' : 'Right wing hinge axle',
    );
    axle.rotation.x = Math.PI / 2;
    const sleeveData = [
      { z: -1.18, parent: group, material: materials.darkMetal },
      { z: -0.54, parent: wingParent, material: materials.steel },
      { z: 0.04, parent: group, material: materials.darkMetal },
    ];
    for (const sleeve of sleeveData) {
      const barrel = addMesh(
        sleeve.parent,
        new THREE.CylinderGeometry(0.060, 0.060, 0.30, 16),
        sleeve.material,
        [sign * wingJoint.x, wingJoint.y, sleeve.z],
        sign < 0 ? 'Left wing hinge sleeve' : 'Right wing hinge sleeve',
      );
      barrel.rotation.x = Math.PI / 2;
      for (const endOffset of [-0.151, 0.151]) {
        addMesh(
          sleeve.parent,
          new THREE.TorusGeometry(0.063, 0.008, 5, 16),
          materials.steel,
          [sign * wingJoint.x, wingJoint.y, sleeve.z + endOffset],
          'Wing hinge retaining collar',
        );
      }
    }
    for (const earZ of [-1.18, 0.04]) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.16, 0.06, 0.18),
        materials.crimsonDark,
        [sign * 0.54, -0.055, earZ],
        sign < 0 ? 'Left fixed hinge ear' : 'Right fixed hinge ear',
      );
    }
    addMesh(
      wingParent,
      new THREE.BoxGeometry(0.20, 0.06, 0.18),
      materials.crimson,
      [sign * 0.72, -0.055, -0.54],
      sign < 0 ? 'Left moving hinge ear' : 'Right moving hinge ear',
    );

    // Outer span color band and inset navigation lens.
    const bandPoint = wingSurfacePoint(wingSpec, sign, 0.88, 0.34);
    bandPoint.y += 0.012;
    const band = addMesh(wingParent, new THREE.BoxGeometry(0.34, 0.022, 0.46), materials.crimson, [bandPoint.x, bandPoint.y, bandPoint.z], 'Wing identification band');
    band.rotation.z = sign * 0.060;
    const navMaterial = standard(sign < 0 ? 0xff352f : 0x35ec72, {
      emissive: sign < 0 ? 0xff1f18 : 0x18df58,
      emissiveIntensity: 2.6,
      roughness: 0.15,
    });
    const tipPoint = wingPoint(wingSpec, sign, 1, 0.34, 0.015);
    addMesh(wingParent, new THREE.SphereGeometry(0.064, 12, 8), navMaterial, [tipPoint.x, tipPoint.y, tipPoint.z], 'Navigation light').scale.set(1.12, 0.70, 1.38);
    const tip = new THREE.Object3D();
    tip.position.copy(tipPoint);
    wingParent.add(tip);
    tipObjects[sign] = tip;

    const roundelPoint = wingPoint(wingSpec, sign, 0.58, 0.43, 0.125);
    addRoundel(wingParent, roundelPoint.x, roundelPoint.y, roundelPoint.z, sign, materials);
  }

  // Per-side seam objects flex with their complete wing assemblies.
  for (const sign of [-1, 1]) {
    const seamPositions = [];
    for (const spanT of [0.20, 0.38, 0.65, 0.82]) {
      const start = wingSurfacePoint(wingSpec, sign, spanT, 0.09);
      const end = wingSurfacePoint(wingSpec, sign, spanT, 0.69);
      start.y += 0.006;
      end.y += 0.006;
      seamPositions.push(start.x, start.y, start.z, end.x, end.y, end.z);
    }
    const seamGeometry = new THREE.BufferGeometry();
    seamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(seamPositions, 3));
    const wingSeams = new THREE.LineSegments(seamGeometry, new THREE.LineBasicMaterial({ color: 0x776d62, transparent: true, opacity: 0.52 }));
    wingSeams.name = sign < 0 ? 'Left wing panel seams' : 'Right wing panel seams';
    wingParents[sign].add(wingSeams);
  }

  // Pitot tube and a clear-covered landing lamp.
  const pitotRoot = wingPoint(wingSpec, -1, 0.73, 0.03, -0.02);
  cylinderBetween(wingParents[-1], pitotRoot, pitotRoot.clone().add(new THREE.Vector3(0, 0, -0.62)), 0.018, materials.steel, 8, 'Pitot tube');
  const lampMaterial = standard(0xffffff, { emissive: 0xfff1cc, emissiveIntensity: 2.0, roughness: 0.1 });
  const lampPoint = wingPoint(wingSpec, -1, 0.33, 0.012, -0.01);
  addMesh(wingParents[-1], new THREE.SphereGeometry(0.105, 14, 8), lampMaterial, [lampPoint.x, lampPoint.y, lampPoint.z], 'Landing light').scale.set(1.25, 0.58, 0.42);

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
    washout: 0,
    profile: FIXED_AIRFOIL,
  };
  for (const sign of [-1, 1]) {
    addMesh(group, wingGeometry(tailSpec, sign, 4), materials.cream, [0, 0, 0], sign < 0 ? 'Left stabilizer' : 'Right stabilizer');
  }
  const elevator = new THREE.Group();
  elevator.name = 'Elevator controller';
  group.add(elevator);
  const elevatorL = makeWingSurface(elevator, tailSpec, -1, 0.00, 1.00, 0.705, materials.crimson, 'Left elevator');
  const elevatorR = makeWingSurface(elevator, tailSpec, 1, 0.00, 1.00, 0.705, materials.crimson, 'Right elevator');

  // Swept fin with a true separate rudder instead of intersecting slab geometry.
  addMesh(group, profileGeometry([
    [0.36, 2.08],
    [2.25, 2.70],
    [2.20, 3.02],
    [0.38, 3.02],
  ], 0.095), materials.crimson, [0, 0, 0], 'Vertical stabilizer');
  const finInset = addMesh(group, profileGeometry([
    [0.94, 2.54],
    [1.24, 2.63],
    [1.18, 2.95],
    [0.84, 2.99],
  ], 0.101), materials.cream, [0, 0, 0], 'Fin identification flash');
  finInset.scale.y = 0.96;
  const rudder = new THREE.Group();
  rudder.position.set(0, 0, 3.02);
  rudder.name = 'Rudder hinge';
  const rudderProfile = [
    [0.40, 0.00],
    [2.20, 0.00],
    [2.05, 0.49],
    [0.43, 0.54],
  ];
  addMesh(rudder, profileGeometry(rudderProfile, 0.075), materials.crimsonDark, [0, 0, 0], 'Rudder');
  group.add(rudder);

  // The white tail lens sits in an aft-pointing fairing attached to the rudder,
  // so it is visible at the actual tail and follows rudder movement.
  const tailLightFairing = addMesh(rudder, new THREE.ConeGeometry(0.082, 0.18, 16), materials.crimsonDark, [0, 0.47, 0.57], 'Tail light fairing');
  tailLightFairing.rotation.x = Math.PI / 2;
  const tailLight = addMesh(rudder, new THREE.SphereGeometry(0.055, 12, 8), standard(0xffffff, { emissive: 0xffffff, emissiveIntensity: 1.8 }), [0, 0.47, 0.655], 'Tail light');
  tailLight.scale.set(0.70, 0.78, 1.10);

  // Integrated fin beacon, aerial mast and wire.
  const beaconMaterial = standard(0x7a1113, { emissive: 0xff2025, emissiveIntensity: 0.12, roughness: 0.18 });
  const beacon = addMesh(group, new THREE.SphereGeometry(0.070, 12, 8), beaconMaterial, [0, 2.225, 2.76], 'Fin beacon');
  beacon.scale.set(0.82, 0.65, 0.82);
  cylinderBetween(group, new THREE.Vector3(0, 0.67, 1.07), new THREE.Vector3(0, 1.16, 1.02), 0.019, materials.darkMetal, 8, 'Aerial mast');
  const aerialGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 1.16, 1.02),
    new THREE.Vector3(0, 2.18, 2.70),
  ]);
  group.add(new THREE.Line(aerialGeometry, new THREE.LineBasicMaterial({ color: 0x262a2c, transparent: true, opacity: 0.78 })));

  // Three twisted blades, polished spinner and a throttle-driven blur disc.
  const propeller = new THREE.Group();
  propeller.position.set(0, -0.015, -4.02);
  propeller.name = 'Propeller assembly';
  const spinner = addMesh(propeller, new THREE.ConeGeometry(0.27, 0.58, 24, 4), materials.crimson, [0, 0, -0.28], 'Spinner');
  spinner.rotation.x = -Math.PI / 2;
  const blades = new THREE.Group();
  // Keep the pitched blade roots forward of the cowl lip while the spinner
  // still overlaps and visually captures their inner ends.
  blades.position.z = -0.055;
  blades.name = 'Propeller blades';
  const bladeGeometry = propBladeGeometry([
    { radius: 0.16, width: 0.23, thickness: 0.085, sweep: 0.00, twist: 0.58 },
    { radius: 0.42, width: 0.31, thickness: 0.072, sweep: 0.035, twist: 0.51 },
    { radius: 0.88, width: 0.28, thickness: 0.055, sweep: 0.08, twist: 0.38 },
    { radius: 1.20, width: 0.21, thickness: 0.043, sweep: 0.13, twist: 0.29 },
  ], { capEnd: false });
  const tipGeometry = propBladeGeometry([
    { radius: 1.20, width: 0.21, thickness: 0.043, sweep: 0.13, twist: 0.29 },
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
  for (const side of [-1, 1]) {
    const well = addMesh(wingParents[side], new THREE.CylinderGeometry(0.37, 0.37, 0.026, 24), wheelWellMaterial, [side * 0.41, -0.31, -0.605], 'Wheel well');
    well.scale.set(0.92, 1, 1.08);
    const pivotSocket = addMesh(wingParents[side], new THREE.CylinderGeometry(0.15, 0.15, 0.030, 18), wheelWellMaterial, [side * 1.48, -0.215, -0.66], 'Gear pivot socket');
    pivotSocket.scale.z = 1.25;
  }

  function buildGear(side) {
    const gear = new THREE.Group();
    gear.position.set(side * 1.48, -0.22, -0.66);
    gear.name = side < 0 ? 'Left landing gear' : 'Right landing gear';
    const knee = new THREE.Vector3(side * 0.11, -0.69, 0.02);
    const axle = new THREE.Vector3(side * 0.17, -1.06, 0.055);
    cylinderBetween(gear, new THREE.Vector3(0, 0, 0), knee, 0.064, materials.steel, 12, 'Main strut');
    cylinderBetween(gear, knee, axle, 0.052, materials.darkMetal, 12, 'Oleo piston');
    cylinderBetween(gear, new THREE.Vector3(side * 0.04, -0.82, 0.03), new THREE.Vector3(side * 0.25, -1.04, 0.055), 0.030, materials.steel, 8, 'Wheel fork');
    const door = addMesh(gear, new THREE.CapsuleGeometry(0.13, 0.54, 6, 12), materials.cream, [side * 0.13, -0.46, 0.02], 'Gear door');
    door.scale.set(0.42, 1.0, 1.18);
    door.rotation.z = -side * 0.075;

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
    flapL: flaps[-1],
    flapR: flaps[1],
    elevator,
    elevatorL,
    elevatorR,
    rudder,
    tipL: tipObjects[-1],
    tipR: tipObjects[1],
    wingFlexL: wingAssemblies[-1],
    wingFlexR: wingAssemblies[1],
    gearL: leftGear.gear,
    gearR: rightGear.gear,
    tailWheel,
    wheelL: leftGear.wheelSpin,
    wheelR: rightGear.wheelSpin,
    tailWheelSpin,
    beacon,
    // shared by all eight stacks, so one material drives the whole glow
    exhaustMat: materials.exhaust,
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

  // OVERDRIVE: the stacks run hot. Emissive rather than an added sprite, so it is the metal
  // itself glowing and it sits correctly behind the wing when you look from ahead. Pushed
  // past 1 on purpose — the bloom threshold is 1.25, so this is what makes it bleed light
  // rather than just turn orange. The flicker is combustion, not a sine wave: two
  // incommensurate rates so it never settles into a visible beat.
  if (plane.exhaustMat) {
    const od = THREE.MathUtils.clamp(physics.overdrive ?? 0, 0, 1);
    const t = physics.time ?? 0;
    const flick = 1 + 0.20 * Math.sin(t * 47.3) + 0.11 * Math.sin(t * 111.7);
    // Ramped LINEARLY, not squared: od*od held the glow near nothing through most of the
    // spool-up, so the light only arrived once the surge was already over. This lights as
    // the power builds, which is the point of it.
    plane.exhaustMat.emissive.setRGB(1.0, 0.26, 0.05);
    plane.exhaustMat.emissiveIntensity = od * 6.5 * flick;
  }

  const roll = input.rollSm ?? 0;
  const pitch = input.pitchSm ?? 0;
  const yaw = input.yawSm ?? 0;
  const wingFlex = THREE.MathUtils.clamp(input.wingFlexSm ?? 0, -1, 1);
  const wingFlexAngle = wingFlex * THREE.MathUtils.degToRad(8);
  plane.wingFlexL.rotation.z = -wingFlexAngle;
  plane.wingFlexR.rotation.z = wingFlexAngle;
  // mirrored hinge bases: one shared angle deflects the sides oppositely in
  // world space; negated so roll-right drops the LEFT trailing edge
  const aileronAngle = -roll * 0.46;
  plane.aileronL.rotation.x = aileronAngle;
  plane.aileronR.rotation.x = aileronAngle;

  // flaps: opposite local angles = both trailing edges DOWN (elevator pattern)
  if (plane.flapL && plane.flapR) {
    const flapAngle = (physics.flapTransit ?? 0) * 0.6;
    plane.flapL.rotation.x = -flapAngle;
    plane.flapR.rotation.x = flapAngle;
  }
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
