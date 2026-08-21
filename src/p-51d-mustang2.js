import * as THREE from 'three';

// North American P-51D-25-NA Mustang — early 1945 European Theatre finish.
// World axes and all dimensions are part of the public asset contract:
// nose = -Z, tail = +Z, starboard = +X, up = +Y, units = metres.

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export const aircraftInfo = deepFreeze({
  name: 'North American P-51D-25-NA Mustang',
  shortName: 'P-51D Mustang',
  manufacturer: 'North American Aviation',
  variant: 'P-51D-25-NA',
  role: 'Single-seat long-range escort fighter',
  era: 'Early 1945',
  livery: 'USAAF natural metal, ETO field markings',
});

const flexJoint = (side, station, span, weight) => ({
  name: `${side} wing flex ${station}`,
  station,
  span,
  weight,
  axis: 'local-z',
});

// Machine-readable model documentation. Games should feature-detect this
// object rather than infer animation support from mesh names.
export const aircraftCapabilities = deepFreeze({
  schema: 'com.flighfeel.aircraft-asset-manifest',
  schemaVersion: 2,
  assetRevision: '1.3.1-p51d',
  geometryRevision: 3,
  canopyRevision: 2,
  tailRevision: 2,
  tailSilhouetteRevision: 2,
  landingGearGeometryRevision: 3,
  canopyBodyConnectionRevision: 1,
  cockpitVisuals: 'neutral-cavity',
  updatedAt: '2026-08-21',
  canopyAndCockpitRevision: {
    updatedAt: '2026-08-21',
    reasons: [
      'remove-unverified-visible-cockpit-equipment',
      'replace-interior-with-neutral-recessed-cavity',
      'remove-canopy-end-cap-layering',
      'use-single-clear-physical-acrylic-shell',
    ],
  },
  tailAndCanopyInterfaceRepair: {
    updatedAt: '2026-08-21',
    reasons: [
      'extend-fixed-fin-skin-to-rudder-hinge-at-every-height-station',
      'add-neutral-and-deflected-rudder-hinge-closure',
      'align-dorsal-fillet-and-fin-about-one-common-offset-axis',
      'anchor-aerial-wire-to-vertical-tail-hardware',
      'close-cockpit-aperture-with-continuous-coaming-sills-and-aft-deck',
    ],
  },
  tailAndGearRefinement: {
    updatedAt: '2026-08-21',
    reasons: [
      'round-coordinated-fin-and-rudder-crown-without-rescaling-tail-landmarks',
      'replace-cambered-wing-section-with-symmetric-vertical-tail-section',
      'merge-dorsal-fillet-into-fin-leading-edge-with-single-visible-contour',
      'replace-paddle-strut-doors-with-thin-bracket-mounted-doors',
      'replace-external-v-braces-with-compact-hydraulic-actuators-on-physical-strut-lugs',
      'preserve-fixed-gear-pivots-throughout-retraction',
      'use-broad-recessed-treaded-main-tires-and-a-single-cast-tailwheel-fork',
      'replace-silhouette-breaking-tread-blocks-with-conformal-tread-relief',
      'keep-strut-doors-and-their-brackets-rigidly-connected-through-retraction',
      'retract-and-steer-the-tailwheel-through-documented-local-pivots',
    ],
  },
  silhouetteRevision: {
    referenceAircraft: 'Caroline 44-13893 (P-51D-5-NA)',
    targetVariant: 'P-51D-25-NA',
    updatedAt: '2026-08-21',
    majorPrimaryMassChanges: [
      'long-taut-merlin-cowl',
      'forward-low-bubble-and-fixed-windscreen',
      'low-rear-deck-and-aft-fuselage-taper',
      'compact-integrated-radiator-keel',
      'production-dorsal-fillet-fin-and-rudder-outline',
      'lowered-wing-datum-and-rounded-planform-tips',
    ],
  },
  identity: {
    type: 'P-51 Mustang',
    variant: 'P-51D-25-NA',
    manufacturer: 'North American Aviation',
    operator: 'United States Army Air Forces',
    theatreAndDate: 'European Theatre, early 1945',
    modelingIntent: 'Reference-led game hero asset; historically coherent rather than a serial-number replica.',
    configuration: {
      bubbleCanopy: true,
      dorsalFinFillet: true,
      hamiltonStandardHydromatic: true,
      cuffedFourBladePropeller: true,
      metalElevators: true,
      fabricRudder: true,
      cockpitVisuals: 'neutral-cavity',
    },
  },
  dimensions: {
    units: 'metres',
    scale: 1,
    wingspan: 11.278,
    wingspanNominal: 11.28,
    length: 9.83,
    heightGearDown: 4.17,
    modeledUnpitchedBoundsHeight: 4.31,
    propellerDiameter: 3.404,
    wingRootChord: 2.642,
    wingTipChord: 1.270,
    horizontalTailSpan: 4.00,
    mainGearTread: 3.607,
    mainTireDiameter: 0.686,
    mainTireWidth: 0.220,
    tailTireDiameter: 0.318,
    tailTireWidth: 0.100,
  },
  geometry: {
    wing: {
      leadingEdgeSweepDeg: 3.592,
      dihedralDeg: 5.0,
      rootIncidenceDeg: 1.0,
      aerodynamicTwistDeg: -2.8,
      rootThicknessRatio: 0.15,
      tipThicknessRatio: 0.12,
      taperRatio: 0.481,
      areaSquareMetres: 22.30,
    },
    tail: {
      horizontalIncidenceDeg: 0.5,
      finOffsetDeg: -1.0,
      fixedFinTrailingEdgeChordFraction: 1.0,
      rudderHingeLocalZ: 1.20,
      crownPlateauMetres: 0.24,
      section: 'symmetric vertical-tail airfoil',
      verticalTailAreaSquareMetres: 1.860,
      fixedFinAreaExcludingDorsalSquareMetres: 0.893,
      rudderTrimTabAreaSquareMetres: 0.0753,
      rudderTrimTabRangeDeg: [-10, 10],
      tailLightAftLimitMetres: 4.85,
    },
  },
  coordinateSystem: {
    handedness: 'three.js right-handed',
    nose: '-Z',
    tail: '+Z',
    starboard: '+X',
    port: '-X',
    up: '+Y',
    origin: 'fuselage datum near wing aerodynamic centre',
  },
  animation: {
    inputs: {
      rollSm: { range: [-1, 1], drives: ['aileronL', 'aileronR'], upDeg: 15, downDeg: 15 },
      pitchSm: { range: [-1, 1], drives: ['elevatorL', 'elevatorR'], upDeg: 30, downDeg: 20 },
      yawSm: {
        range: [-1, 1],
        drives: ['rudder', 'tailWheelSteer'],
        leftDeg: 30,
        rightDeg: 30,
        tailwheelSteeringDeg: 6,
      },
      flapSm: { range: [0, 1], drives: ['flapL', 'flapR'], downDeg: 47 },
      wingFlexSm: { range: [-1, 1], drives: ['wingFlexJointsL', 'wingFlexJointsR'] },
      throttle: { source: 'physics.throttle', range: [0, 1], drives: ['propellerBlades', 'propellerBlur'] },
      gearTransit: {
        source: 'physics.gearTransit',
        range: [0, 1],
        semantics: '0 retracted, 1 down and locked',
        drives: ['gearL', 'gearR', 'innerDoorL', 'innerDoorR', 'tailWheel', 'tailDoorL', 'tailDoorR'],
      },
      radiatorDoorSm: { source: 'physics.radiatorDoorSm', range: [0, 1], drives: ['radiatorDoor'] },
    },
    namedParts: {
      controls: ['aileronL', 'aileronR', 'flapL', 'flapR', 'elevatorL', 'elevatorR', 'rudder'],
      gear: [
        'gearL', 'gearR', 'wheelL', 'wheelR', 'wellL', 'wellR', 'outerDoorL', 'outerDoorR',
        'innerDoorL', 'innerDoorR', 'tailWheel', 'tailWheelSteer', 'tailWheelSpin', 'tailDoorL', 'tailDoorR',
      ],
      propeller: ['propeller', 'blades', 'propDisc', 'spinner'],
      lights: ['navLightL', 'navLightR', 'tailLight', 'landingLight'],
      cockpit: ['canopy', 'gunsight', 'controlStick'],
      cooling: ['radiatorDoor'],
    },
  },
  features: {
    propeller: {
      type: 'Hamilton Standard Hydromatic 24D50-style cuffed four-blade',
      pitchRangeDeg: 42,
      feathering: false,
    },
    landingGear: {
      mainRetraction: 'hydraulic inward-folding',
      tailwheelRetraction: 'hydraulic forward into fuselage',
      nominalTransitSeconds: [10, 15],
      mainFoldDeg: 82.5,
      outerDoorDownAlignmentDeg: 3.0,
      outerDoorStowCorrectionDeg: 0,
      pivotInvariant: true,
      mainOleoType: 'Bendix cantilever oleo with one-sided cast lower spindle',
      visiblePolishedPistonMetres: 0.323,
      mainTireWidthMetres: 0.220,
      mainTireTread: 'conformal wartime chevron relief in the smooth-contour casing material',
      tailTireWidthMetres: 0.100,
      tailwheelCasterTrailMetres: 0.240,
      tailwheelFork: 'single swept cast hockey-stick fork',
      tailwheelFoldDeg: 118,
      tailwheelSteeringDeg: 6,
      stowedWheelCentres: 'Each wheel rotates into its own non-overlapping structural bay; no visibility swap is used.',
    },
    wingFlex: {
      version: 2,
      implementation: 'distributed-joints',
      updatedAt: '2026-08-21',
      supersedes: { version: 1, implementation: 'rigid-root-rotation' },
      input: 'wingFlexSm',
      semantics: 'Normalized signed aeroelastic load. Positive bends both tips upward; the fixed centre section does not rotate.',
      range: [-1, 1],
      maxTipDeflectionDeg: 3.0,
      cumulativeWeights: true,
      joints: {
        left: [
          flexJoint('Left', 'inboard', 0.28, 0.16),
          flexJoint('Left', 'midspan', 0.55, 0.32),
          flexJoint('Left', 'outboard', 0.79, 0.52),
        ],
        right: [
          flexJoint('Right', 'inboard', 0.28, 0.16),
          flexJoint('Right', 'midspan', 0.55, 0.32),
          flexJoint('Right', 'outboard', 0.79, 0.52),
        ],
      },
      integrationNotes: [
        'Use wingFlexJointsL/R in listed order; do not rotate wingAssemblyL/R as folding hinges.',
        'Weights sum to one per side and describe each joint contribution to maximum tip curvature.',
        'All wing-mounted controls, markings, lights and pitot inherit the flex hierarchy.',
      ],
    },
  },
  materialSlots: {
    aluminumSkin: 'Satin natural aluminum with deterministic directional micro-roughness',
    aluminumPanelLight: 'Slightly brighter replacement/polished panels',
    aluminumPanelDark: 'Heat-treated or grain-shifted panel variation',
    oliveDrabAntiglare: 'Low-sheen olive-drab forward deck',
    insignia: 'Conformal USAAF star-and-bar decals',
    invasionMarking: 'Opaque, weathered lower-wing remnants deliberately retained for an early-1945 ETO field finish',
    cockpitInterior: 'Continuous matte-charcoal recessed neutral cavity; detailed equipment intentionally omitted',
    glass: 'Single-layer clear physical acrylic glazing',
    exhaust: 'Heat-darkened steel with localized staining',
    rubber: 'Uncoated tyre rubber with conformal tread relief; no silhouette-breaking tread geometry',
  },
  lodAndPerformance: {
    authoredLod: 'hero',
    intendedUse: 'viewer, close gameplay camera, marketing stills',
    geometryPolicy: 'Finite indexed geometry, outward winding, no random runtime topology',
    texturePolicy: 'Deterministic procedural canvases; safe to cache per renderer',
    suggestedLods: {
      lod1: 'Remove external fasteners, brake lines and internal radiator vanes; retain the neutral cockpit cavity.',
      lod2: 'Merge control surfaces, gear details and small decals; replace propeller with blur disc.',
    },
  },
  referenceProvenance: {
    geometrySlots: [
      'North American Aviation P-51D general-arrangement dimensions and station drawings',
      'USAAF erection and maintenance documentation AN 01-60JE-2',
      'Surviving P-51D museum airframes for canopy, landing gear, radiator and surface junctions',
    ],
    finishSlots: [
      'Early-1945 ETO natural-metal Mustangs',
      'USAAF national insignia proportions and field-applied identification markings',
    ],
    caveat: 'Marking layout is representative and intentionally avoids claiming a specific historic serial.',
    sources: [
      { slot: 'official-three-view', title: 'NACA/NASA P-51D-20-NA three-view, RM L6J25', url: 'https://ntrs.nasa.gov/api/citations/20050019329/downloads/20050019329.pdf' },
      { slot: 'official-aerodynamics', title: 'NACA TR-1219 Mustang geometry', url: 'https://ntrs.nasa.gov/api/citations/19930092229/downloads/19930092229.pdf' },
      { slot: 'service-manual', title: 'USAAF P-51 pilot training and service data', url: 'https://www.armyaircorpsmuseum.org/docs/p51-training-manual.pdf' },
      { slot: 'museum-dimensions', title: 'National Museum of the USAF P-51D fact sheet', url: 'https://www.nationalmuseum.af.mil/Visit/Museum-Exhibits/Fact-Sheets/Display/Article/196263/north-american-p-51d-mustang/' },
      { slot: 'surviving-airframe-detail', title: 'Smithsonian P-51D-30-NA object and detail photography', url: 'https://airandspace.si.edu/collection-objects/north-american-p-51d-30-na-mustang/nasm_A19600300000' },
    ],
  },
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
    if (cutout?.capStart !== false) indices.push(noseCenter, next, i);
    if (cutout?.capEnd !== false) indices.push(tailCenter, lastRing + i, lastRing + next);
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
  const washout = (spec.incidence ?? 0) + THREE.MathUtils.lerp(0, spec.washout ?? 0, t);
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
  const uvs = [];
  const minX = Math.min(...corners.map(point => point.x));
  const maxX = Math.max(...corners.map(point => point.x));
  const minZ = Math.min(...corners.map(point => point.z));
  const maxZ = Math.max(...corners.map(point => point.z));
  const spanX = Math.max(1e-6, maxX - minX);
  const spanZ = Math.max(1e-6, maxZ - minZ);
  for (const side of [-0.5, 0.5]) {
    for (let i = 0; i < corners.length; i++) {
      const point = corners[i];
      positions.push(point.x, point.y + side * thicknesses[i], point.z);
      uvs.push((point.x - minX) / spanX, (point.z - minZ) / spanZ);
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
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
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
  reverseWinding(geometry);
  geometry.computeVertexNormals();
  return geometry;
}

function taperedProfileGeometry(pointsYZ, halfWidths) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const count = pointsYZ.length;
  const minY = Math.min(...pointsYZ.map(([y]) => y));
  const maxY = Math.max(...pointsYZ.map(([y]) => y));
  const minZ = Math.min(...pointsYZ.map(([, z]) => z));
  const maxZ = Math.max(...pointsYZ.map(([, z]) => z));
  const spanY = Math.max(1e-6, maxY - minY);
  const spanZ = Math.max(1e-6, maxZ - minZ);
  for (const sign of [-1, 1]) {
    for (let i = 0; i < count; i++) {
      const [y, z] = pointsYZ[i];
      positions.push(sign * halfWidths[i], y, z);
      uvs.push((z - minZ) / spanZ, (y - minY) / spanY);
    }
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
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  reverseWinding(geometry);
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
  const chordSteps = 13;
  const chordStart = 0.025;
  const chordEnd = 0.93;
  const positions = [];
  const uvs = [];
  const row = chordSteps + 1;

  const addSurface = surface => {
    for (let span = 0; span <= spanSteps; span++) {
      const spanN = span / spanSteps;
      // Keep the fairing compact like a formed root transition, not a broad
      // second wing skin. A tiny persistent offset prevents the feathered
      // outer row from z-fighting the cream wing below it.
      const spanT = THREE.MathUtils.lerp(0.004, 0.088, spanN);
      const blend = Math.pow(1 - THREE.MathUtils.smoothstep(spanN, 0, 1), 1.35);
      for (let chord = 0; chord <= chordSteps; chord++) {
        const chordN = chord / chordSteps;
        const chordT = THREE.MathUtils.lerp(chordStart, chordEnd, chordN);
        const frame = wingFrameAt(spec, sign, spanT, chordT, surface);
        const crown = Math.pow(Math.sin(Math.PI * chordN), 0.72) * blend;
        frame.point.x += sign * crown * 0.034;
        frame.point.y += (surface === 'upper' ? 0.043 : -0.012) * crown;
        const skinClearance = surface === 'upper' ? 0.0025 : -0.0015;
        frame.point.addScaledVector(
          frame.normal,
          skinClearance + (surface === 'upper' ? 0.004 : -0.0025) * blend,
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

// The Mustang's NAA low-drag section carries its maximum thickness much
// farther aft than a conventional trainer section. Values are normalized
// ordinates used by the procedural skin, not aerodynamic lookup data.
const MUSTANG_AIRFOIL = [
  [0.000, 0.000], [0.025, 0.22], [0.070, 0.45], [0.150, 0.68],
  [0.280, 0.90], [0.420, 1.00], [0.580, 0.91], [0.720, 0.69],
  [0.850, 0.39], [0.950, 0.13], [1.000, 0.000], [0.950, -0.10],
  [0.850, -0.28], [0.720, -0.49], [0.580, -0.64], [0.420, -0.71],
  [0.280, -0.66], [0.150, -0.51], [0.070, -0.32], [0.025, -0.14],
];

const MUSTANG_FIXED_AIRFOIL = [
  [0.000, 0.000], [0.025, 0.22], [0.070, 0.45], [0.150, 0.68],
  [0.280, 0.90], [0.420, 1.00], [0.580, 0.91], [0.700, 0.72],
  [0.720, 0.64], [0.720, -0.48], [0.700, -0.51], [0.580, -0.64],
  [0.420, -0.71], [0.280, -0.66], [0.150, -0.51], [0.070, -0.32],
  [0.025, -0.14],
];

// Symmetric section reserved for the vertical tail. Reusing the cambered wing
// ordinates here makes one side of the fin visibly fuller than the other.
const MUSTANG_VERTICAL_TAIL_AIRFOIL = [
  [0.000, 0.000], [0.025, 0.30], [0.075, 0.58], [0.160, 0.82],
  [0.300, 0.97], [0.430, 1.00], [0.580, 0.92], [0.720, 0.72],
  [0.840, 0.48], [0.935, 0.20], [1.000, 0.000], [0.935, -0.20],
  [0.840, -0.48], [0.720, -0.72], [0.580, -0.92], [0.430, -1.00],
  [0.300, -0.97], [0.160, -0.82], [0.075, -0.58], [0.025, -0.30],
];

function roundedTireGeometry(outerRadius, width, beadRadius, radialSegments = 40) {
  const halfWidth = width * 0.5;
  const profile = [
    new THREE.Vector2(beadRadius, -halfWidth * 0.76),
    new THREE.Vector2(outerRadius * 0.74, -halfWidth),
    new THREE.Vector2(outerRadius * 0.91, -halfWidth * 0.86),
    new THREE.Vector2(outerRadius * 0.985, -halfWidth * 0.43),
    new THREE.Vector2(outerRadius, 0),
    new THREE.Vector2(outerRadius * 0.985, halfWidth * 0.43),
    new THREE.Vector2(outerRadius * 0.91, halfWidth * 0.86),
    new THREE.Vector2(outerRadius * 0.74, halfWidth),
    new THREE.Vector2(beadRadius, halfWidth * 0.76),
  ];
  const geometry = new THREE.LatheGeometry(profile, radialSegments);
  geometry.rotateZ(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function tailWheelDoorGeometry(side, thickness = 0.018) {
  let corners = [
    [0.000, -0.250],
    [0.000, 0.250],
    [side * 0.115, 0.225],
    [side * 0.170, 0.125],
    [side * 0.180, -0.100],
    [side * 0.120, -0.225],
  ];
  if (side < 0) corners = corners.reverse();
  const positions = [];
  const indices = [];
  const half = thickness * 0.5;
  for (const y of [half, -half]) {
    for (const [x, z] of corners) positions.push(x, y, z);
  }
  const count = corners.length;
  for (let index = 1; index < count - 1; index++) {
    indices.push(0, index, index + 1);
    indices.push(count, count + index + 1, count + index);
  }
  for (let index = 0; index < count; index++) {
    const next = (index + 1) % count;
    indices.push(index, count + index, next, next, count + index, count + next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function deterministicTexture(size, pixel, repeat = [1, 1]) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  const hash = (x, y, seed = 0) => {
    let n = Math.imul(x + 31 + seed, 374761393) ^ Math.imul(y + 71, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a = 255] = pixel(x, y, hash);
      const i = (y * size + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = a;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  return texture;
}

function aluminumMicroTexture() {
  return deterministicTexture(256, (x, y, hash) => {
    const grain = (hash(x, y, 5) - 0.5) * 18;
    const brush = Math.sin(y * 0.62) * 3.2 + Math.sin(y * 0.11 + x * 0.013) * 2.1;
    const slow = Math.sin(x * 0.028 + y * 0.006) * 2.5;
    const value = Math.round(THREE.MathUtils.clamp(190 + grain + brush + slow, 162, 220));
    return [value, value, value, 255];
  }, [5, 2]);
}

function paintedMicroTexture() {
  return deterministicTexture(192, (x, y, hash) => {
    const grain = (hash(x, y, 13) - 0.5) * 12;
    const sprayed = Math.sin(x * 0.097 + y * 0.041) * 2;
    const value = Math.round(THREE.MathUtils.clamp(195 + grain + sprayed, 175, 212));
    return [value, value, value, 255];
  }, [3, 3]);
}

function tireTreadTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  context.fillStyle = '#a2a2a2';
  context.fillRect(0, 0, size, size);

  // LatheGeometry maps tyre circumference to U and casing section to V.
  // Restrict shallow chevrons to the crown so the sidewalls stay smooth and
  // the wartime tread never changes the physical tyre silhouette.
  context.save();
  context.beginPath();
  context.rect(0, 78, size, 100);
  context.clip();
  context.strokeStyle = '#747474';
  context.lineWidth = 3;
  context.lineCap = 'round';
  for (let x = -20; x <= size + 20; x += 16) {
    context.beginPath();
    context.moveTo(x - 9, 82);
    context.lineTo(x, 126);
    context.lineTo(x + 9, 174);
    context.stroke();
  }
  context.strokeStyle = '#8a8a8a';
  context.lineWidth = 1;
  for (const y of [92, 164]) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(size, y);
    context.stroke();
  }
  context.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  return texture;
}

function starBarTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#19345b';
  context.fillRect(24, 84, 464, 88);
  context.fillStyle = '#f2f0e7';
  context.fillRect(42, 96, 428, 64);
  context.fillStyle = '#19345b';
  context.beginPath();
  context.arc(256, 128, 108, 0, Math.PI * 2);
  context.fill();
  const outer = 78;
  const inner = outer * 0.382;
  context.fillStyle = '#f2f0e7';
  context.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 ? inner : outer;
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const x = 256 + Math.cos(angle) * radius;
    const y = 128 + Math.sin(angle) * radius;
    if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.closePath();
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function textStencilTexture(lines, color = '#1a1c1b') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, 512, 256);
  context.fillStyle = color;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '700 78px Arial Narrow, Arial, sans-serif';
  const list = Array.isArray(lines) ? lines : [lines];
  list.forEach((line, index) => context.fillText(line, 256, 128 + (index - (list.length - 1) / 2) * 76));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function smokeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 512, 0);
  gradient.addColorStop(0, 'rgba(52,42,35,0.38)');
  gradient.addColorStop(0.34, 'rgba(66,50,40,0.20)');
  gradient.addColorStop(1, 'rgba(78,61,48,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function wingSkinPatchGeometry(spec, sign, spanStart, spanEnd, chordStart, chordEnd, surface = 'upper', offset = 0.004) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const spanSteps = 5;
  const chordSteps = 4;
  for (let s = 0; s <= spanSteps; s++) {
    const spanT = THREE.MathUtils.lerp(spanStart, spanEnd, s / spanSteps);
    for (let c = 0; c <= chordSteps; c++) {
      const chordT = THREE.MathUtils.lerp(chordStart, chordEnd, c / chordSteps);
      const frame = wingFrameAt(spec, sign, spanT, chordT, surface, surface === 'upper' ? offset : -offset);
      positions.push(frame.point.x, frame.point.y, frame.point.z);
      uvs.push(s / spanSteps, c / chordSteps);
    }
  }
  const row = chordSteps + 1;
  for (let s = 0; s < spanSteps; s++) {
    for (let c = 0; c < chordSteps; c++) {
      const a = s * row + c;
      const b = a + 1;
      const d = (s + 1) * row + c + 1;
      const e = d - 1;
      indices.push(a, b, e, b, d, e);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  if ((sign < 0) !== (surface === 'lower')) reverseWinding(geometry);
  geometry.computeVertexNormals();
  return geometry;
}

function interpolateLoftStation(stations, z) {
  if (z <= stations[0].z) return { ...stations[0] };
  if (z >= stations[stations.length - 1].z) return { ...stations[stations.length - 1] };
  let index = 0;
  while (index < stations.length - 2 && stations[index + 1].z < z) index++;
  const a = stations[index];
  const b = stations[index + 1];
  const t = (z - a.z) / (b.z - a.z);
  return {
    z,
    width: THREE.MathUtils.lerp(a.width, b.width, t),
    height: THREE.MathUtils.lerp(a.height, b.height, t),
    y: THREE.MathUtils.lerp(a.y, b.y, t),
    exponent: THREE.MathUtils.lerp(a.exponent ?? 2, b.exponent ?? 2, t),
  };
}

function fuselagePatchGeometry(stations, sign, zStart, zEnd, angleStart, angleEnd, offset = 0.004, zSteps = 7, arcSteps = 5) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let iz = 0; iz <= zSteps; iz++) {
    const z = THREE.MathUtils.lerp(zStart, zEnd, iz / zSteps);
    const station = interpolateLoftStation(stations, z);
    for (let ia = 0; ia <= arcSteps; ia++) {
      const phi = THREE.MathUtils.lerp(angleStart, angleEnd, ia / arcSteps);
      const shapedSide = Math.pow(Math.max(0, Math.cos(phi)), 2 / station.exponent);
      const shapedY = Math.sign(Math.sin(phi)) * Math.pow(Math.abs(Math.sin(phi)), 2 / station.exponent);
      positions.push(
        sign * (station.width + offset) * shapedSide,
        station.y + (station.height + offset) * shapedY,
        z,
      );
      uvs.push(iz / zSteps, ia / arcSteps);
    }
  }
  const row = arcSteps + 1;
  for (let iz = 0; iz < zSteps; iz++) {
    for (let ia = 0; ia < arcSteps; ia++) {
      const a = iz * row + ia;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  if (sign > 0) reverseWinding(geometry);
  geometry.computeVertexNormals();
  return geometry;
}

function fuselageTopPatchGeometry(stations, zStart, zEnd, offset = 0.005) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const zSteps = 16;
  const arcSteps = 8;
  for (let iz = 0; iz <= zSteps; iz++) {
    const z = THREE.MathUtils.lerp(zStart, zEnd, iz / zSteps);
    const station = interpolateLoftStation(stations, z);
    const widthScale = THREE.MathUtils.lerp(0.62, 0.92, THREE.MathUtils.smoothstep(z, zStart, zEnd));
    for (let ia = 0; ia <= arcSteps; ia++) {
      const phi = THREE.MathUtils.lerp(Math.PI * 0.28, Math.PI * 0.72, ia / arcSteps);
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      const shapedX = Math.sign(c) * Math.pow(Math.abs(c), 2 / station.exponent);
      const shapedY = Math.pow(s, 2 / station.exponent);
      positions.push(shapedX * station.width * widthScale, station.y + shapedY * (station.height + offset), z);
      uvs.push(iz / zSteps, ia / arcSteps);
    }
  }
  const row = arcSteps + 1;
  for (let iz = 0; iz < zSteps; iz++) {
    for (let ia = 0; ia < arcSteps; ia++) {
      const a = iz * row + ia;
      indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  reverseWinding(geometry);
  geometry.computeVertexNormals();
  return geometry;
}

function lineLoop(parent, points, material, name) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.LineLoop(geometry, material);
  line.name = name;
  parent.add(line);
  return line;
}

function closedTube(parent, points, radius, material, tubularSegments = 32, radialSegments = 6, name = '') {
  const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
  return addMesh(parent, new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, true), material, [0, 0, 0], name);
}

function p51BubbleCanopyGeometry() {
  const stations = [
    { z: -1.05, width: 0.340, frameWidth: 0.370, base: 0.550, height: 0.550 },
    { z: -0.90, width: 0.375, frameWidth: 0.405, base: 0.550, height: 0.565 },
    { z: -0.68, width: 0.395, frameWidth: 0.430, base: 0.550, height: 0.590 },
    { z: -0.40, width: 0.405, frameWidth: 0.435, base: 0.550, height: 0.605 },
    { z: -0.17, width: 0.405, frameWidth: 0.435, base: 0.560, height: 0.585 },
    { z: 0.10, width: 0.400, frameWidth: 0.430, base: 0.580, height: 0.535 },
    { z: 0.36, width: 0.380, frameWidth: 0.410, base: 0.610, height: 0.430 },
    { z: 0.60, width: 0.330, frameWidth: 0.360, base: 0.650, height: 0.250 },
    { z: 0.79, width: 0.230, frameWidth: 0.280, base: 0.685, height: 0.085 },
    { z: 0.90, width: 0.035, frameWidth: 0.180, base: 0.700, height: 0.012 },
  ];
  const arcSegments = 24;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let s = 0; s < stations.length; s++) {
    const station = stations[s];
    for (let i = 0; i <= arcSegments; i++) {
      const angle = Math.PI - i / arcSegments * Math.PI;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      positions.push(
        cos * station.width,
        station.base + Math.pow(Math.max(0, sin), 0.92) * station.height,
        station.z,
      );
      uvs.push(s / (stations.length - 1), i / arcSegments);
    }
  }
  const row = arcSegments + 1;
  for (let s = 0; s < stations.length - 1; s++) {
    for (let i = 0; i < arcSegments; i++) {
      const a = s * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  // Both ends remain open: the fixed windscreen closes the forward seam and
  // the aft stations collapse tangentially into the rear deck. Flat caps here
  // create a second milky pane that never existed on the blown acrylic hood.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, stations, arcSegments };
}

function canopyLowerFrameGeometry(stations, sign, depth = 0.14) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i < stations.length; i++) {
    const station = stations[i];
    positions.push(sign * station.width, station.base + 0.003, station.z);
    positions.push(sign * station.frameWidth, station.base - depth, station.z);
    uvs.push(i / (stations.length - 1), 1, i / (stations.length - 1), 0);
  }
  for (let i = 0; i < stations.length - 1; i++) {
    const top = i * 2;
    const bottom = top + 1;
    const nextTop = top + 2;
    const nextBottom = top + 3;
    indices.push(top, bottom, nextTop, bottom, nextBottom, nextTop);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  if (sign > 0) reverseWinding(geometry);
  geometry.computeVertexNormals();
  return geometry;
}

// Solid longitudinal sill joining the outer fuselage aperture edge directly
// to the lower edge of the windscreen/bubble. The skirt extends below the
// loft cutout boundary so coarse fuselage rings cannot expose daylight.
function canopySillDeckGeometry(fuselageStations, canopyStations, sign, depth = 0.09) {
  const lowerFrameDepth = 0.14;
  const frameOverlap = 0.003;
  const stations = [
    { z: -1.78, width: 0.240, base: 0.510 },
    { z: -1.65, width: 0.330, base: 0.510 },
    { z: -1.34, width: 0.335, base: 0.510 },
    // Seat the sill underneath the structural lower frame, not at the clear
    // acrylic edge. Keeping the aft frame width prevents a false centre spike.
    ...canopyStations.slice(0, -2).map(({ z, frameWidth, base }) => ({
      z,
      width: Math.max(0.01, frameWidth - frameOverlap),
      base: base - lowerFrameDepth + frameOverlap,
    })),
  ];
  const positions = [];
  const uvs = [];
  const indices = [];
  const sectionSize = 4;

  for (let stationIndex = 0; stationIndex < stations.length; stationIndex++) {
    const station = stations[stationIndex];
    const fuselage = interpolateLoftStation(fuselageStations, station.z);
    const outerY = 0.490;
    const normalizedY = THREE.MathUtils.clamp(
      Math.abs((outerY - fuselage.y) / fuselage.height),
      0,
      1,
    );
    const outerX = fuselage.width * Math.pow(
      Math.max(0, 1 - Math.pow(normalizedY, fuselage.exponent)),
      1 / fuselage.exponent,
    );
    const innerX = Math.min(station.width, Math.max(0, outerX - 0.012));
    const u = stationIndex / (stations.length - 1);
    positions.push(
      sign * outerX, outerY, station.z,
      sign * innerX, station.base, station.z,
      sign * outerX, outerY - depth, station.z,
      sign * innerX, station.base - depth, station.z,
    );
    uvs.push(u, 0, u, 1, u, 0, u, 1);
  }

  for (let stationIndex = 0; stationIndex < stations.length - 1; stationIndex++) {
    const a = stationIndex * sectionSize;
    const b = a + sectionSize;
    // Top deck, underside, outer skirt and cavity-side return.
    indices.push(
      a, a + 1, b, a + 1, b + 1, b,
      a + 2, b + 2, a + 3, a + 3, b + 2, b + 3,
      a, b, a + 2, a + 2, b, b + 2,
      a + 1, a + 3, b + 1, a + 3, b + 3, b + 1,
    );
  }
  // Close both ends. The aft cap now terminates under the broad conformal deck
  // before the hood narrows, so it cannot form the former four-point spike.
  indices.push(0, 2, 1, 1, 2, 3);
  const end = (stations.length - 1) * sectionSize;
  indices.push(end, end + 1, end + 2, end + 1, end + 3, end + 2);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  if (sign < 0) reverseWinding(geometry);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function cockpitVoidGeometry(stations) {
  const positions = [];
  const indices = [];
  for (const station of stations) {
    positions.push(
      -station.width, station.top, station.z,
      -station.width * 0.82, station.bottom, station.z,
      station.width * 0.82, station.bottom, station.z,
      station.width, station.top, station.z,
    );
  }
  const quad = (a, b, c, d) => indices.push(a, b, c, b, d, c);
  for (let stationIndex = 0; stationIndex < stations.length - 1; stationIndex++) {
    const a = stationIndex * 4;
    const next = a + 4;
    quad(a, a + 1, next, next + 1); // port wall
    quad(a + 1, a + 2, next + 1, next + 2); // recessed floor
    quad(a + 2, a + 3, next + 2, next + 3); // starboard wall
  }
  indices.push(0, 2, 1, 0, 3, 2);
  const rear = (stations.length - 1) * 4;
  indices.push(rear, rear + 1, rear + 2, rear, rear + 2, rear + 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function quadGeometry(points, uvs = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap(point => [point.x, point.y, point.z]), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return geometry;
}

export function buildPlane() {
  const group = new THREE.Group();
  group.name = aircraftInfo.name;
  group.userData.aircraftInfo = aircraftInfo;
  group.userData.capabilities = aircraftCapabilities;
  group.userData.assetManifest = aircraftCapabilities;
  group.userData.units = 'metres';
  group.userData.axes = aircraftCapabilities.coordinateSystem;

  const aluminumMicro = aluminumMicroTexture();
  aluminumMicro.colorSpace = THREE.NoColorSpace;
  const paintMicro = paintedMicroTexture();
  paintMicro.colorSpace = THREE.NoColorSpace;
  const tireTread = tireTreadTexture();
  const materials = {
    aluminum: new THREE.MeshStandardMaterial({
      color: 0xc7cbd0,
      metalness: 0.84,
      roughness: 0.34,
      roughnessMap: aluminumMicro,
      bumpMap: aluminumMicro,
      bumpScale: 0.0022,
    }),
    aluminumLight: new THREE.MeshStandardMaterial({
      color: 0xd8dce0,
      metalness: 0.88,
      roughness: 0.27,
      roughnessMap: aluminumMicro,
    }),
    aluminumDark: new THREE.MeshStandardMaterial({
      color: 0x9ea5ab,
      metalness: 0.80,
      roughness: 0.41,
      roughnessMap: aluminumMicro,
    }),
    aluminumHardware: new THREE.MeshStandardMaterial({
      color: 0xb9bec2,
      metalness: 0.82,
      roughness: 0.37,
    }),
    wingLacquer: new THREE.MeshStandardMaterial({
      color: 0xc5c9cb,
      metalness: 0.66,
      roughness: 0.43,
      roughnessMap: paintMicro,
      bumpMap: paintMicro,
      bumpScale: 0.0015,
    }),
    olive: new THREE.MeshStandardMaterial({
      color: 0x343a25,
      metalness: 0.04,
      roughness: 0.84,
      roughnessMap: paintMicro,
      bumpMap: paintMicro,
      bumpScale: 0.002,
    }),
    blackPaint: new THREE.MeshStandardMaterial({ color: 0x15181a, metalness: 0.20, roughness: 0.61 }),
    whitePaint: new THREE.MeshStandardMaterial({ color: 0xe1e0d8, metalness: 0.14, roughness: 0.66 }),
    yellowPaint: new THREE.MeshStandardMaterial({ color: 0xe4b52d, metalness: 0.08, roughness: 0.52 }),
    interiorGreen: new THREE.MeshStandardMaterial({ color: 0x313b29, metalness: 0.06, roughness: 0.82 }),
    cockpitBlack: new THREE.MeshStandardMaterial({ color: 0x171b1c, metalness: 0.22, roughness: 0.67 }),
    instrumentFace: new THREE.MeshStandardMaterial({ color: 0x090b0c, metalness: 0.05, roughness: 0.74 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9ea7aa, metalness: 0.86, roughness: 0.31 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: 0x2a3032, metalness: 0.78, roughness: 0.41 }),
    exhaust: new THREE.MeshStandardMaterial({ color: 0x443a34, metalness: 0.71, roughness: 0.67 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x17191a, metalness: 0, roughness: 0.94 }),
    tireRubber: new THREE.MeshStandardMaterial({
      color: 0x17191a,
      metalness: 0,
      roughness: 0.94,
      bumpMap: tireTread,
      bumpScale: 0.004,
    }),
    leather: new THREE.MeshStandardMaterial({ color: 0x3f2d24, metalness: 0, roughness: 0.91 }),
    harness: new THREE.MeshStandardMaterial({ color: 0x9d8968, metalness: 0, roughness: 0.92 }),
    rudderFabric: new THREE.MeshStandardMaterial({
      color: 0xbfc3c5,
      metalness: 0.07,
      roughness: 0.68,
      roughnessMap: paintMicro,
      bumpMap: paintMicro,
      bumpScale: 0.004,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xbfd8df,
      metalness: 0,
      roughness: 0.045,
      transmission: 0,
      transparent: true,
      opacity: 0.23,
      thickness: 0.006,
      ior: 1.49,
      clearcoat: 0.85,
      clearcoatRoughness: 0.035,
      side: THREE.FrontSide,
      depthWrite: false,
    }),
    // NO TRANSMISSION IN THIS PROJECT. The canopy glass above already learned it
    // (transmission:0), but the gunsight lens still carried 0.45 — three's transmission
    // pass breaks the ocean's onBeforeCompile shader and renders the whole sea black
    // (fourth aircraft to arrive with this; see crimson-kestrel.js et al). Plain
    // transparency on a lens this small is indistinguishable.
    lens: new THREE.MeshPhysicalMaterial({
      color: 0xf6f1d8,
      transparent: true,
      opacity: 0.90,
      roughness: 0.10,
      clearcoat: 1,
    }),
    well: new THREE.MeshStandardMaterial({ color: 0x6e765a, metalness: 0.34, roughness: 0.69 }),
    line: new THREE.LineBasicMaterial({ color: 0x4a4f50, transparent: true, opacity: 0.52 }),
  };

  const fuselageStations = [
    { z: -4.11, width: 0.350, height: 0.453, y: 0.074, exponent: 3.35 },
    { z: -3.82, width: 0.405, height: 0.525, y: 0.044, exponent: 3.40 },
    { z: -3.28, width: 0.455, height: 0.610, y: 0.019, exponent: 3.45 },
    { z: -2.55, width: 0.480, height: 0.673, y: 0.006, exponent: 3.48 },
    { z: -1.78, width: 0.500, height: 0.690, y: 0.023, exponent: 3.42 },
    { z: -1.05, width: 0.525, height: 0.680, y: 0.020, exponent: 3.28 },
    { z: -0.70, width: 0.540, height: 0.665, y: 0.025, exponent: 3.18 },
    { z: -0.24, width: 0.545, height: 0.635, y: 0.030, exponent: 3.10 },
    { z: 0.32, width: 0.535, height: 0.590, y: 0.040, exponent: 3.02 },
    { z: 0.92, width: 0.500, height: 0.630, y: 0.070, exponent: 2.82 },
    { z: 1.34, width: 0.455, height: 0.610, y: 0.080, exponent: 2.62 },
    { z: 1.86, width: 0.405, height: 0.510, y: 0.140, exponent: 2.48 },
    { z: 2.48, width: 0.345, height: 0.430, y: 0.180, exponent: 2.34 },
    { z: 3.12, width: 0.285, height: 0.360, y: 0.200, exponent: 2.24 },
    { z: 3.72, width: 0.215, height: 0.260, y: 0.270, exponent: 2.14 },
    { z: 4.28, width: 0.135, height: 0.170, y: 0.330, exponent: 2.06 },
    { z: 4.78, width: 0.043, height: 0.050, y: 0.390, exponent: 2.00 },
  ];
  addMesh(group, loftGeometry(fuselageStations, 40, {
    zMin: -1.58,
    zMax: 0.92,
    yMin: 0.49,
  }), materials.aluminum, [0, 0, 0], 'Semi-monocoque fuselage shell');

  // The filled-and-sanded forward wing surface is deliberately more uniform
  // than the panel-varied fuselage; the contrast is a characteristic Mustang cue.
  addMesh(group, fuselageTopPatchGeometry(fuselageStations, -4.02, -1.08), materials.olive, [0, 0, 0], 'Olive-drab anti-glare deck');

  // Selected skin panels change grain and reflectivity without becoming a
  // checkerboard. They follow the loft instead of floating as flat plates.
  for (const [sign, z0, z1, material, name] of [
    [-1, -3.58, -2.78, materials.aluminumLight, 'Port upper cowling panel'],
    [1, -2.68, -1.82, materials.aluminumDark, 'Starboard accessory panel'],
    [-1, 1.70, 2.32, materials.aluminumDark, 'Port radio-bay skin panel'],
    [1, 2.55, 3.18, materials.aluminumLight, 'Starboard aft replacement panel'],
  ]) {
    addMesh(group, fuselagePatchGeometry(fuselageStations, sign, z0, z1, -0.36, 0.48, 0.003), material, [0, 0, 0], name);
  }

  const fuselageRing = (z, name) => {
    const station = interpolateLoftStation(fuselageStations, z);
    const points = [];
    for (let i = 0; i < 48; i++) {
      const angle = -Math.PI / 2 + i / 48 * Math.PI * 2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      points.push(new THREE.Vector3(
        Math.sign(c) * Math.pow(Math.abs(c), 2 / station.exponent) * (station.width + 0.004),
        station.y + Math.sign(s) * Math.pow(Math.abs(s), 2 / station.exponent) * (station.height + 0.004),
        z,
      ));
    }
    return lineLoop(group, points, materials.line, name);
  };
  [-3.80, -3.27, -2.54, -1.76, -1.05, 1.87, 2.49, 3.14].forEach((z, index) => fuselageRing(z, `Fuselage manufacturing joint ${index + 1}`));

  for (const sign of [-1, 1]) {
    const lowerSeam = [];
    for (let i = 0; i <= 14; i++) {
      const z = THREE.MathUtils.lerp(-3.72, 3.35, i / 14);
      const station = interpolateLoftStation(fuselageStations, z);
      lowerSeam.push(new THREE.Vector3(sign * station.width * 0.91, station.y - station.height * 0.38, z));
    }
    const seam = new THREE.Line(new THREE.BufferGeometry().setFromPoints(lowerSeam), materials.line);
    seam.name = sign < 0 ? 'Port lower longitudinal skin joint' : 'Starboard lower longitudinal skin joint';
    group.add(seam);
  }

  // Long Packard-Merlin cowling: six ejector stacks per bank, panel rails,
  // chin openings and small fasteners arranged by real removable panels.
  for (const sign of [-1, 1]) {
    addMesh(group, fuselagePatchGeometry(fuselageStations, sign, -3.48, -1.82, 0.08, 0.48, 0.009), materials.aluminumDark, [0, 0, 0], sign < 0 ? 'Port exhaust shroud' : 'Starboard exhaust shroud');
    const exhaustBase = [];
    for (let i = 0; i < 6; i++) {
      const z = -3.34 + i * 0.255;
      const root = new THREE.Vector3(sign * 0.505, 0.27 + Math.sin(i * 0.75) * 0.006, z);
      const tip = new THREE.Vector3(sign * (0.62 + i * 0.004), 0.25 - i * 0.005, z + 0.13);
      cylinderBetween(group, root, tip, 0.043, materials.exhaust, 10, `${sign < 0 ? 'Port' : 'Starboard'} exhaust ejector ${i + 1}`);
      const outlet = addMesh(group, new THREE.CircleGeometry(0.042, 12), materials.cockpitBlack, [0, 0, 0], 'Exhaust ejector hollow outlet');
      outlet.position.copy(tip);
      outlet.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tip.clone().sub(root).normalize());
      exhaustBase.push(root);
    }
    tube(group, exhaustBase, 0.028, materials.darkSteel, 30, 7, sign < 0 ? 'Port exhaust mounting rail' : 'Starboard exhaust mounting rail');
    const stainMaterial = new THREE.MeshBasicMaterial({
      map: smokeTexture(),
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    const stain = addMesh(group, fuselagePatchGeometry(fuselageStations, sign, -3.26, -1.10, -0.05, 0.42, 0.013), stainMaterial, [0, 0, 0], sign < 0 ? 'Port exhaust stain' : 'Starboard exhaust stain');
    stain.renderOrder = 1;

    for (const z of [-3.72, -2.63, -1.84]) {
      for (const y of [-0.16, 0.53]) {
        const station = interpolateLoftStation(fuselageStations, z);
        addMesh(group, new THREE.SphereGeometry(0.010, 7, 5), materials.darkSteel, [sign * (station.width + 0.007), y, z], 'Cowling Dzus fastener');
      }
    }
  }

  const chinOpening = addMesh(group, new THREE.CircleGeometry(1, 32), materials.cockpitBlack, [0, -0.30, -4.153], 'Merlin chin radiator opening');
  chinOpening.scale.set(0.295, 0.125, 1);
  chinOpening.rotation.y = Math.PI;
  const chinLipPoints = [];
  for (let i = 0; i < 28; i++) {
    const angle = i / 28 * Math.PI * 2;
    chinLipPoints.push(new THREE.Vector3(Math.cos(angle) * 0.303, -0.30 + Math.sin(angle) * 0.132, -4.160));
  }
  closedTube(group, chinLipPoints, 0.010, materials.aluminumDark, 40, 5, 'Flush formed chin-intake edge');
  const oilOpening = addMesh(group, new THREE.CircleGeometry(1, 24), materials.cockpitBlack, [0, -0.095, -4.154], 'Upper oil-cooler opening');
  oilOpening.scale.set(0.19, 0.07, 1);
  oilOpening.rotation.y = Math.PI;

  // Cockpit details are intentionally omitted until an evidence-backed
  // interior is authored. One continuous, low, non-specular liner creates a
  // convincing recessed void without presenting invented controls or seats.
  const cockpitVoidMaterial = new THREE.MeshStandardMaterial({
    color: 0x090c0e,
    metalness: 0,
    roughness: 0.96,
    side: THREE.DoubleSide,
  });
  const cockpitVoid = addMesh(group, cockpitVoidGeometry([
    { z: -1.05, width: 0.350, top: 0.460, bottom: 0.220 },
    { z: -0.72, width: 0.370, top: 0.460, bottom: 0.200 },
    { z: -0.18, width: 0.380, top: 0.460, bottom: 0.190 },
    { z: 0.36, width: 0.370, top: 0.460, bottom: 0.200 },
    { z: 0.68, width: 0.330, top: 0.460, bottom: 0.240 },
    { z: 0.88, width: 0.205, top: 0.460, bottom: 0.310 },
  ]), cockpitVoidMaterial, [0, 0, 0], 'Continuous matte-charcoal recessed cockpit cavity and rear closeout');
  cockpitVoid.userData.neutralInterior = true;

  const instrumentPanel = new THREE.Group();
  instrumentPanel.name = 'Instrument panel compatibility marker - visuals removed';
  instrumentPanel.userData.visualsRemoved = true;
  group.add(instrumentPanel);

  const gunsight = new THREE.Group();
  gunsight.name = 'K-14 gunsight compatibility handle - visuals removed';
  gunsight.userData.visualsRemoved = true;
  group.add(gunsight);

  const controlStick = new THREE.Group();
  controlStick.name = 'Control stick compatibility handle - visuals removed';
  controlStick.userData.visualsRemoved = true;
  group.add(controlStick);

  // Fixed armor-glass windscreen and separate bubble canopy sliding on rails.
  const windscreen = new THREE.Group();
  windscreen.name = 'Fixed framed windscreen';
  const frontLowerL = new THREE.Vector3(-0.33, 0.55, -1.65);
  const frontLowerR = new THREE.Vector3(0.33, 0.55, -1.65);
  const frontUpperL = new THREE.Vector3(-0.20, 1.06, -1.12);
  const frontUpperR = new THREE.Vector3(0.20, 1.06, -1.12);
  const armorGlass = materials.glass.clone();
  armorGlass.name = '38.1 mm laminated armor glass';
  armorGlass.thickness = 0.0381;
  armorGlass.color.set(0xb9d3cc);
  armorGlass.opacity = 0.30;
  addMesh(windscreen, quadGeometry([frontLowerR, frontLowerL, frontUpperL, frontUpperR]), armorGlass, [0, 0, 0], '38.1 mm windscreen armor-glass center pane');
  const rearLowerL = new THREE.Vector3(-0.34, 0.55, -1.05);
  const rearLowerR = new THREE.Vector3(0.34, 0.55, -1.05);
  const rearUpperL = new THREE.Vector3(-0.22, 1.09, -1.05);
  const rearUpperR = new THREE.Vector3(0.22, 1.09, -1.05);
  addMesh(windscreen, quadGeometry([frontLowerL, rearLowerL, rearUpperL, frontUpperL]), materials.glass, [0, 0, 0], 'Port windscreen quarter pane');
  addMesh(windscreen, quadGeometry([frontLowerR, frontUpperR, rearUpperR, rearLowerR]), materials.glass, [0, 0, 0], 'Starboard windscreen quarter pane');
  for (const [a, b, name] of [
    [frontLowerL, frontLowerR, 'Windscreen lower crossmember'],
    [frontLowerL, frontUpperL, 'Port windscreen post'],
    [frontLowerR, frontUpperR, 'Starboard windscreen post'],
    [frontUpperL, frontUpperR, 'Windscreen crown frame'],
  ]) cylinderBetween(windscreen, a, b, 0.019, materials.darkSteel, 10, name);
  group.add(windscreen);

  const canopyData = p51BubbleCanopyGeometry();
  const canopy = new THREE.Group();
  canopy.name = 'Sliding teardrop bubble canopy';
  const canopyGlass = addMesh(canopy, canopyData.geometry, materials.glass, [0, 0, 0], 'Single-piece clear acrylic bubble glazing');
  canopyGlass.renderOrder = 2;
  const firstStation = canopyData.stations[0];
  for (const station of [firstStation]) {
    const hoop = [];
    for (let i = 0; i <= 12; i++) {
      const angle = Math.PI - i / 12 * Math.PI;
      hoop.push(new THREE.Vector3(Math.cos(angle) * station.width, station.base + Math.pow(Math.sin(angle), 0.92) * station.height, station.z));
    }
    tube(canopy, hoop, 0.020, materials.aluminumDark, 30, 8, '40 mm front canopy bow and windshield seal');
  }
  for (const sign of [-1, 1]) {
    addMesh(
      canopy,
      canopyLowerFrameGeometry(canopyData.stations, sign, 0.14),
      materials.aluminumDark,
      [0, 0, 0],
      `${sign < 0 ? 'Port' : 'Starboard'} 140 mm deep lower sliding-frame panel`,
    );
    tube(canopy, canopyData.stations.map(station => new THREE.Vector3(sign * station.width, station.base, station.z)), 0.010, materials.darkSteel, 30, 7, `${sign < 0 ? 'Port' : 'Starboard'} flush acrylic seal rail`);
  }
  group.add(canopy);

  // The D-model hood sits on a continuous metal aperture ring, not over an
  // open black slot. These solid side sills meet the acrylic/lower frame with
  // a 3 mm overlap, while the fore and aft decks embed the windscreen feet and
  // merge the tapering hood into the low rear fuselage shoulder.
  const canopyBodyConnection = new THREE.Group();
  canopyBodyConnection.name = 'Continuous cockpit coaming and canopy sill deck';
  canopyBodyConnection.userData.bodyConnection = true;
  for (const sign of [-1, 1]) {
    const sill = addMesh(
      canopyBodyConnection,
      canopySillDeckGeometry(fuselageStations, canopyData.stations, sign),
      materials.aluminum,
      [0, 0, 0],
      `${sign < 0 ? 'Port' : 'Starboard'} closed canopy aperture sill and skirt`,
    );
    sill.userData.bodyConnection = true;
    sill.userData.frameToSillOverlapMm = 3;
  }
  const forwardCoaming = addMesh(canopyBodyConnection, prismGeometry([
    new THREE.Vector3(-0.240, 0.510, -1.78),
    new THREE.Vector3(0.240, 0.510, -1.78),
    new THREE.Vector3(0.330, 0.510, -1.65),
    new THREE.Vector3(-0.330, 0.510, -1.65),
  ], 0.080), materials.aluminum, [0, 0, 0], 'Embedded windscreen-foot forward coaming bridge');
  forwardCoaming.userData.bodyConnection = true;
  // The rear closeout is a conformal continuation of the fuselage crown. A
  // thick trapezoidal prism here reads as a detached arrowhead in three-quarter
  // view, whereas this offset skin patch follows the actual loft shoulder.
  const aftDeck = addMesh(
    canopyBodyConnection,
    fuselageTopPatchGeometry(fuselageStations, 0.52, 1.34, 0.008),
    materials.aluminum,
    [0, 0, 0],
    'Integrated conformal aft-canopy deck closeout',
  );
  aftDeck.userData.bodyConnection = true;
  for (const sign of [-1, 1]) {
    const aftShoulder = addMesh(
      canopyBodyConnection,
      fuselagePatchGeometry(fuselageStations, sign, 0.52, 1.34, 0.50, 1.46, 0.006, 12, 8),
      materials.aluminum,
      [0, 0, 0],
      `${sign < 0 ? 'Port' : 'Starboard'} conformal aft-canopy shoulder closeout`,
    );
    aftShoulder.userData.bodyConnection = true;
  }
  group.add(canopyBodyConnection);

  // Dorsal fin fillet and fin rotate about the same tail datum. Previously the
  // fillet was offset about the aircraft origin, pulling its aft join sideways.
  const dorsalFilletMount = new THREE.Group();
  dorsalFilletMount.position.z = 3.00;
  dorsalFilletMount.rotation.y = THREE.MathUtils.degToRad(-1.0);
  dorsalFilletMount.name = 'Common-axis production dorsal-fillet mount';
  const dorsalFillet = addMesh(dorsalFilletMount, taperedProfileGeometry([
    [0.61, -0.82], [0.67, -0.58], [0.74, -0.32], [0.83, -0.06],
    [0.97, 0.20], [1.20, 0.42], [1.45, 0.665],
    [0.54, 0.665], [0.55, 0.42], [0.56, 0.20], [0.58, -0.06],
    [0.60, -0.32], [0.62, -0.58], [0.60, -0.82],
  ], [
    0.016, 0.022, 0.032, 0.044, 0.058, 0.074, 0.086,
    0.074, 0.060, 0.047, 0.036, 0.027, 0.020, 0.015,
  ]), materials.aluminum, [0, 0, 0], 'Conformal structural dorsal fin fillet merged into fin leading edge');
  dorsalFillet.userData.tailConnection = true;
  dorsalFillet.userData.commonOffsetAxis = true;
  group.add(dorsalFilletMount);

  // Meredith-effect radiator scoop with boundary-layer gap, divided core and
  // movable outlet door; this is a second major silhouette, not a belly pod.
  const scoopStations = [
    { z: -0.82, width: 0.25, height: 0.10, y: -0.70, exponent: 3.20 },
    { z: -0.58, width: 0.32, height: 0.19, y: -0.69, exponent: 3.10 },
    { z: -0.18, width: 0.40, height: 0.29, y: -0.69, exponent: 2.95 },
    { z: 0.25, width: 0.42, height: 0.30, y: -0.66, exponent: 2.80 },
    { z: 0.65, width: 0.35, height: 0.23, y: -0.54, exponent: 2.55 },
    { z: 1.02, width: 0.22, height: 0.16, y: -0.41, exponent: 2.30 },
  ];
  addMesh(group, loftGeometry(scoopStations, 32, { capStart: false, capEnd: false }), materials.aluminum, [0, 0, 0], 'Open-throat ventral radiator scoop and blended duct');
  const scoopMouth = addMesh(group, new THREE.CircleGeometry(1, 32), materials.cockpitBlack, [0, -0.70, -0.808], 'Radiator boundary-layer intake darkness');
  scoopMouth.scale.set(0.225, 0.080, 1);
  scoopMouth.rotation.y = Math.PI;
  const scoopLipPoints = [];
  for (let i = 0; i < 28; i++) {
    const angle = i / 28 * Math.PI * 2;
    scoopLipPoints.push(new THREE.Vector3(Math.cos(angle) * 0.245, -0.70 + Math.sin(angle) * 0.097, -0.822));
  }
  closedTube(group, scoopLipPoints, 0.012, materials.aluminumDark, 42, 6, 'Flush formed radiator intake lip');
  const radiatorCore = addMesh(group, new THREE.PlaneGeometry(0.54, 0.25), materials.darkSteel, [0, -0.69, -0.47], 'Divided recessed radiator core');
  radiatorCore.rotation.y = Math.PI;
  cylinderBetween(group, new THREE.Vector3(0, -0.815, -0.465), new THREE.Vector3(0, -0.565, -0.465), 0.010, materials.aluminumDark, 6, 'Radiator core center divider');
  const radiatorExit = addMesh(group, new THREE.PlaneGeometry(0.39, 0.14), materials.cockpitBlack, [0, -0.41, 1.03], 'Radiator exit aperture');
  const radiatorDoor = new THREE.Group();
  radiatorDoor.name = 'Radiator outlet door';
  radiatorDoor.position.set(0, -0.50, 0.76);
  const radiatorDoorMesh = addMesh(radiatorDoor, new THREE.BoxGeometry(0.41, 0.030, 0.33), materials.aluminumDark, [0, -0.035, 0.16], 'Controllable radiator exit flap');
  radiatorDoorMesh.rotation.x = -0.24;
  group.add(radiatorDoor);

  // The wing uses the documented NAA planform: 5° dihedral, mild leading-edge
  // sweep, 2.08:1 chord taper and broad clipped-round tips. The fixed skin
  // ends at a real rear spar so controls do not overlap it.
  const wingSpec = {
    rootX: 0.47,
    tipX: 5.639,
    rootLead: -0.98,
    tipLead: -0.655,
    rootChord: 2.642,
    tipChord: 1.270,
    rootThickness: 0.282,
    tipThickness: 0.105,
    yRoot: -0.255,
    dihedral: Math.tan(THREE.MathUtils.degToRad(5.0)),
    dihedralCurve: 0.010,
    incidence: THREE.MathUtils.degToRad(1.0),
    washout: THREE.MathUtils.degToRad(-2.8),
    planformCurve: -0.012,
    tipRoundStart: 0.945,
    tipRound: 0.965,
    tipChordMinimum: 0.035,
    profile: MUSTANG_FIXED_AIRFOIL,
    surfaceProfile: MUSTANG_AIRFOIL,
  };
  const flexSpans = [0.28, 0.55, 0.79];
  const segmentBounds = [0, ...flexSpans, 1];
  const wingSegments = {};
  const wingFlexJoints = {};
  const wingAssemblies = {};
  const wingParents = {};
  const tipObjects = {};
  const ailerons = {};
  const flaps = {};

  for (const sign of [-1, 1]) {
    const sideName = sign < 0 ? 'Left' : 'Right';
    const rootPivot = wingFrameAt(wingSpec, sign, 0, 0.39, 'mid').point;
    const root = new THREE.Group();
    root.position.copy(rootPivot);
    root.name = `${sideName} fixed wing centre-section root`;
    group.add(root);
    wingAssemblies[sign] = root;

    const segments = [];
    let parentJoint = root;
    let parentPivot = rootPivot;
    for (let segmentIndex = 0; segmentIndex < segmentBounds.length - 1; segmentIndex++) {
      const spanStart = segmentBounds[segmentIndex];
      const spanEnd = segmentBounds[segmentIndex + 1];
      let joint = parentJoint;
      let pivot = parentPivot;
      if (segmentIndex > 0) {
        pivot = wingFrameAt(wingSpec, sign, spanStart, 0.39, 'mid').point;
        joint = new THREE.Group();
        joint.position.copy(pivot).sub(parentPivot);
        joint.name = `${sideName} wing flex ${['inboard', 'midspan', 'outboard'][segmentIndex - 1]}`;
        parentJoint.add(joint);
        parentJoint = joint;
        parentPivot = pivot;
      }
      const content = new THREE.Group();
      content.position.copy(pivot).multiplyScalar(-1);
      content.name = `${sideName} wing structural bay ${segmentIndex + 1}`;
      joint.add(content);
      addMesh(content, wingGeometry(wingSpec, sign, 8, {
        spanStart,
        spanEnd,
        capRoot: spanStart === 0,
        capTip: spanEnd === 1,
      }), materials.wingLacquer, [0, 0, 0], `${sideName} laminar-flow wing skin ${segmentIndex + 1}`);
      segments.push({ spanStart, spanEnd, joint, content, pivot });
    }
    wingSegments[sign] = segments;
    wingFlexJoints[sign] = segments.slice(1).map(segment => segment.joint);
    wingAssemblies[sign].userData.flexVersion = aircraftCapabilities.features.wingFlex.version;
    wingAssemblies[sign].userData.flexImplementation = aircraftCapabilities.features.wingFlex.implementation;
    wingParents[sign] = segments[0].content;

    for (let jointIndex = 0; jointIndex < flexSpans.length; jointIndex++) {
      const spanT = flexSpans[jointIndex];
      addMesh(
        segments[jointIndex].content,
        wingSkinPatchGeometry(wingSpec, sign, spanT - 0.009, spanT + 0.009, 0.035, 0.72, 'upper', 0.0028),
        materials.wingLacquer,
        [0, 0, 0],
        `${sideName} flexible flush skin bridge`,
      );
      addMesh(
        segments[jointIndex].content,
        wingSkinPatchGeometry(wingSpec, sign, spanT - 0.009, spanT + 0.009, 0.035, 0.72, 'lower', 0.0028),
        materials.wingLacquer,
        [0, 0, 0],
        `${sideName} lower flexible flush skin bridge`,
      );
    }
    addMesh(group, wingRootFairingGeometry(wingSpec, sign), materials.wingLacquer, [0, 0, 0], `${sideName} compound wing-root fillet`);
  }

  const segmentAt = (sign, spanT) => wingSegments[sign].find(segment => (
    spanT >= segment.spanStart - 1e-6 && spanT <= segment.spanEnd + 1e-6
  )) ?? wingSegments[sign][wingSegments[sign].length - 1];

  function addSplitControl(sign, spanStart, spanEnd, hingeFraction, material, label, controller) {
    const pieces = [];
    for (const segment of wingSegments[sign]) {
      const pieceStart = Math.max(spanStart, segment.spanStart);
      const pieceEnd = Math.min(spanEnd, segment.spanEnd);
      if (pieceEnd - pieceStart < 0.002) continue;
      const piece = makeWingSurface(segment.content, wingSpec, sign, pieceStart, pieceEnd, hingeFraction, material, `${label} section`, {
        capStart: Math.abs(pieceStart - spanStart) < 1e-5,
        capEnd: Math.abs(pieceEnd - spanEnd) < 1e-5,
      });
      pieces.push(piece);
    }
    controller.userData.surfaces.push(...pieces);
    return pieces;
  }

  const starBarMaterial = new THREE.MeshStandardMaterial({
    map: starBarTexture(),
    transparent: true,
    depthWrite: false,
    roughness: 0.52,
    metalness: 0.08,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    side: THREE.DoubleSide,
    alphaTest: 0.08,
  });
  const invasionWhite = materials.whitePaint.clone();
  invasionWhite.roughness = 0.78;
  const invasionBlack = materials.blackPaint.clone();
  invasionBlack.roughness = 0.82;

  for (const sign of [-1, 1]) {
    const sideName = sign < 0 ? 'Left' : 'Right';
    const flapController = new THREE.Group();
    flapController.name = `${sideName} flap controller`;
    flapController.userData.surfaces = [];
    group.add(flapController);
    flaps[sign] = flapController;
    const aileronController = new THREE.Group();
    aileronController.name = `${sideName} aileron controller`;
    aileronController.userData.surfaces = [];
    group.add(aileronController);
    ailerons[sign] = aileronController;

    addSplitControl(sign, 0.015, 0.535, 0.72, materials.aluminum, `${sideName} full inboard flap`, flapController);
    addSplitControl(sign, 0.548, 0.925, 0.72, materials.aluminumDark, `${sideName} sealed metal aileron`, aileronController);
    const fixedTrailingTip = makeWingSurface(
      segmentAt(sign, 0.965).content,
      wingSpec,
      sign,
      0.925,
      1.0,
      0.69,
      materials.wingLacquer,
      `${sideName} fixed broad trailing wingtip closure`,
      { capStart: true, capEnd: true },
    );
    fixedTrailingTip.userData.fixedStructure = true;
    // A few structurally motivated panel joints; no evenly spaced procedural grid.
    for (const [spanT, chord0, chord1] of [[0.18, 0.05, 0.70], [0.365, 0.13, 0.70], [0.535, 0.08, 0.70], [0.755, 0.18, 0.70]]) {
      const a = wingFrameAt(wingSpec, sign, spanT, chord0, 'upper', 0.004).point;
      const b = wingFrameAt(wingSpec, sign, spanT, chord1, 'upper', 0.004).point;
      const seam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), materials.line);
      seam.name = `${sideName} wing structural skin joint`;
      segmentAt(sign, spanT).content.add(seam);
    }

    // Staggered gun ports and large ammunition access covers.
    for (let gun = 0; gun < 3; gun++) {
      const spanT = 0.33 + gun * 0.083;
      const frame = wingFrameAt(wingSpec, sign, spanT, 0.004, 'mid');
      const rootPoint = frame.point.clone().add(new THREE.Vector3(0, -0.006 - gun * 0.006, 0.012 + gun * 0.025));
      const muzzle = rootPoint.clone().add(new THREE.Vector3(0, 0, -0.075 - gun * 0.020));
      cylinderBetween(segmentAt(sign, spanT).content, rootPoint, muzzle, 0.019, materials.darkSteel, 12, `${sideName} .50-calibre gun port ${gun + 1}`);
      const hollow = addMesh(segmentAt(sign, spanT).content, new THREE.CircleGeometry(0.0175, 14), materials.cockpitBlack, [0, 0, 0], 'Recessed gun muzzle');
      hollow.position.copy(muzzle);
      hollow.rotation.y = Math.PI;
    }
    const ammoParent = segmentAt(sign, 0.40).content;
    const ammoPatch = addMesh(ammoParent, wingSkinPatchGeometry(wingSpec, sign, 0.255, 0.515, 0.24, 0.53, 'upper', 0.0045), materials.wingLacquer, [0, 0, 0], `${sideName} flush ammunition access doors`);
    ammoPatch.userData.rounds = [400, 270, 270];
    for (const spanT of [0.255, 0.385, 0.515]) {
      const p0 = wingFrameAt(wingSpec, sign, spanT, 0.24, 'upper', 0.006).point;
      const p1 = wingFrameAt(wingSpec, sign, spanT, 0.53, 'upper', 0.006).point;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p0, p1]), materials.line);
      line.name = `${sideName} ammunition door break`;
      ammoParent.add(line);
    }

    // Only port upper and starboard lower receive the large national marking,
    // matching common late-war USAAF wing placement.
    if (sign < 0) {
      const insignia = addMesh(segmentAt(sign, 0.66).content, wingSkinPatchGeometry(wingSpec, sign, 0.57, 0.77, 0.16, 0.67, 'upper', 0.006), starBarMaterial, [0, 0, 0], 'Port upper USAAF star-and-bar');
      insignia.renderOrder = 2;
    } else {
      const insignia = addMesh(segmentAt(sign, 0.66).content, wingSkinPatchGeometry(wingSpec, sign, 0.57, 0.77, 0.16, 0.67, 'lower', 0.006), starBarMaterial, [0, 0, 0], 'Starboard lower USAAF star-and-bar');
      insignia.renderOrder = 2;
    }

    // Restrained remnants of field-applied invasion bands remain only on the
    // lower wing. Their softened opacity distinguishes them from factory paint.
    const stripes = [
      [0.305, 0.347, invasionBlack], [0.350, 0.392, invasionWhite],
      [0.395, 0.437, invasionBlack], [0.440, 0.482, invasionWhite],
      [0.485, 0.527, invasionBlack],
    ];
    for (const [span0, span1, material] of stripes) {
      const stripe = addMesh(segmentAt(sign, (span0 + span1) * 0.5).content, wingSkinPatchGeometry(wingSpec, sign, span0, span1, 0.05, 0.70, 'lower', 0.006), material, [0, 0, 0], `${sideName} weathered lower-wing invasion stripe`);
      stripe.renderOrder = 1;
    }

    const navColor = sign < 0 ? 0xd62929 : 0x24a651;
    const navMaterial = new THREE.MeshStandardMaterial({ color: navColor, emissive: navColor, emissiveIntensity: 1.7, roughness: 0.16 });
    const tipFrame = wingFrameAt(wingSpec, sign, 0.988, 0.33, 'upper', 0.005);
    const tipParent = segmentAt(sign, 0.988).content;
    const navLight = addMesh(tipParent, new THREE.SphereGeometry(0.038, 16, 10), navMaterial, [0, 0, 0], `${sideName} inset navigation light`);
    navLight.position.copy(tipFrame.point);
    navLight.scale.set(0.88, 0.55, 1.35);
    const tipObject = new THREE.Object3D();
    tipObject.position.copy(tipFrame.point);
    tipObject.name = `${sideName} wingtip reference`;
    tipParent.add(tipObject);
    tipObjects[sign] = tipObject;
  }

  // Purposeful one-sided equipment: pitot under right wing, landing light at
  // the left wheel well and three recognition lamps under the right outer wing.
  const pitotFrame = wingFrameAt(wingSpec, 1, 0.72, 0.055, 'lower', -0.015);
  const pitotParent = segmentAt(1, 0.72).content;
  cylinderBetween(pitotParent, pitotFrame.point, pitotFrame.point.clone().add(new THREE.Vector3(0, -0.06, -0.68)), 0.011, materials.steel, 9, 'Starboard underwing pitot tube');
  cylinderBetween(pitotParent, pitotFrame.point.clone().add(new THREE.Vector3(0, -0.06, -0.68)), pitotFrame.point.clone().add(new THREE.Vector3(0, -0.06, -0.82)), 0.006, materials.darkSteel, 8, 'Pitot sensing tip');

  const landingFrame = wingFrameAt(wingSpec, -1, 0.18, 0.47, 'lower', -0.010);
  const landingLight = addMesh(segmentAt(-1, 0.18).content, new THREE.CircleGeometry(0.115, 24), materials.lens, [0, 0, 0], 'Left wheel-well landing light');
  landingLight.position.copy(landingFrame.point);
  landingLight.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), landingFrame.normal.clone().multiplyScalar(-1));
  addMesh(segmentAt(-1, 0.18).content, wingSkinPatchGeometry(wingSpec, -1, 0.145, 0.215, 0.38, 0.56, 'lower', 0.007), materials.aluminumDark, [0, 0, 0], 'Landing-light service panel');

  const recognitionLights = [];
  const recognitionColors = [0xd52522, 0x2dae4b, 0xe0a52d];
  for (let index = 0; index < 3; index++) {
    const frame = wingFrameAt(wingSpec, 1, 0.835, 0.44 + index * 0.095, 'lower', -0.009);
    const material = new THREE.MeshStandardMaterial({
      color: recognitionColors[index],
      emissive: recognitionColors[index],
      emissiveIntensity: 0.55,
      roughness: 0.14,
    });
    const light = addMesh(segmentAt(1, 0.835).content, new THREE.SphereGeometry(0.035, 14, 8), material, [0, 0, 0], `${['Red', 'Green', 'Amber'][index]} recognition light`);
    light.position.copy(frame.point);
    light.scale.y = 0.55;
    recognitionLights.push(light);
  }

  // Port leading-edge gun-camera opening, separate from the cowling camera.
  const wingCameraFrame = wingFrameAt(wingSpec, -1, 0.585, 0.002, 'mid');
  const wingCamera = addMesh(segmentAt(-1, 0.585).content, new THREE.PlaneGeometry(0.090, 0.046), materials.cockpitBlack, [0, 0, 0], 'Port wing N-6 rectangular gun-camera aperture');
  wingCamera.position.copy(wingCameraFrame.point).add(new THREE.Vector3(0, 0, -0.012));
  wingCamera.rotation.y = Math.PI;
  const aileronTrimHost = ailerons[-1].userData.surfaces.at(-1);
  if (aileronTrimHost) addMesh(aileronTrimHost, new THREE.BoxGeometry(0.34, 0.010, 0.13), materials.aluminumDark, [-0.24, 0, 0.25], 'Port aileron ground-adjustable trim tab');

  // Fuselage national markings are wrapped over the curved skin rather than
  // stacked cylinders. The tail stencil is deliberately generic to avoid
  // falsely claiming a specific combat airframe.
  for (const sign of [-1, 1]) {
    const insignia = addMesh(group, fuselagePatchGeometry(fuselageStations, sign, 1.28, 2.52, -0.66, 0.66, 0.010, 12, 8), starBarMaterial, [0, 0, 0], `${sign < 0 ? 'Port' : 'Starboard'} fuselage USAAF star-and-bar`);
    insignia.renderOrder = 2;
  }

  // Late metal horizontal tail: approximately 4.00 m span, 0.5° incidence and zero dihedral.
  const tailSpec = {
    rootX: 0.15,
    tipX: 2.00,
    rootLead: 3.13,
    tipLead: 3.48,
    rootChord: 1.23,
    tipChord: 0.71,
    rootThickness: 0.098,
    tipThickness: 0.050,
    yRoot: 0.40,
    dihedral: 0,
    dihedralCurve: 0,
    incidence: THREE.MathUtils.degToRad(0.5),
    washout: 0,
    planformCurve: -0.006,
    tipRoundStart: 0.86,
    tipRound: 0.25,
    tipChordMinimum: 0.43,
    profile: MUSTANG_FIXED_AIRFOIL,
    surfaceProfile: MUSTANG_AIRFOIL,
  };
  for (const sign of [-1, 1]) {
    addMesh(group, wingGeometry(tailSpec, sign, 16), materials.aluminum, [0, 0, 0], sign < 0 ? 'Left all-metal horizontal stabilizer' : 'Right all-metal horizontal stabilizer');
  }
  const elevator = new THREE.Group();
  elevator.name = 'Elevator control assembly';
  group.add(elevator);
  const elevatorL = makeWingSurface(elevator, tailSpec, -1, 0.015, 0.98, 0.70, materials.aluminumDark, 'Left metal elevator');
  const elevatorR = makeWingSurface(elevator, tailSpec, 1, 0.015, 0.98, 0.70, materials.aluminumDark, 'Right metal elevator');
  addMesh(elevatorL, new THREE.BoxGeometry(0.28, 0.009, 0.12), materials.aluminumDark, [-0.23, 0, 0.20], 'Port elevator trim tab');

  // Production D-model fin with structural dorsal fillet and subtle official
  // one-degree left offset. The normal rudder is used, not the NACA test horn.
  const finAssembly = new THREE.Group();
  finAssembly.position.set(0, 0, 3.00);
  finAssembly.rotation.y = THREE.MathUtils.degToRad(-1.0);
  finAssembly.name = 'Offset production vertical-tail assembly';
  const finStations = [
    { y: 0.38, lead: -0.27, chord: 1.47, thickness: 0.086 },
    { y: 0.62, lead: -0.07, chord: 1.27, thickness: 0.082 },
    { y: 0.72, lead: 0.03, chord: 1.17, thickness: 0.080 },
    { y: 0.90, lead: 0.20, chord: 1.00, thickness: 0.074 },
    { y: 1.22, lead: 0.49, chord: 0.71, thickness: 0.064 },
    { y: 1.30, lead: 0.55, chord: 0.65, thickness: 0.060 },
    { y: 1.48, lead: 0.69, chord: 0.51, thickness: 0.052 },
    { y: 1.60, lead: 0.77, chord: 0.43, thickness: 0.046 },
    { y: 1.68, lead: 0.82, chord: 0.38, thickness: 0.041 },
    { y: 1.82, lead: 0.87, chord: 0.33, thickness: 0.031 },
    { y: 1.90, lead: 0.92, chord: 0.28, thickness: 0.022 },
    { y: 1.925, lead: 0.94, chord: 0.26, thickness: 0.016 },
    { y: 1.948, lead: 0.96, chord: 0.24, thickness: 0.010 },
  ];
  // Fin station chords terminate at local z=1.20, the rudder hinge. The wing's
  // 72%-chord fixed-surface profile is intentionally not used here: doing so
  // removes up to 0.412 m of fin and exposes the broken daylight wedge.
  const verticalFin = addMesh(finAssembly, verticalAirfoilGeometry(finStations, MUSTANG_VERTICAL_TAIL_AIRFOIL), materials.aluminum, [0, 0, 0], 'Full-chord airfoil vertical stabilizer to rudder hinge');
  verticalFin.userData.tailConnection = true;
  verticalFin.userData.trailingEdgeChordFraction = 1.0;
  verticalFin.userData.rudderHingeLocalZ = 1.20;
  const rudderHingeClosure = cylinderBetween(
    finAssembly,
    new THREE.Vector3(0, 0.40, 1.20),
    new THREE.Vector3(0, 1.92, 1.20),
    0.006,
    materials.aluminumDark,
    10,
    'Continuous rudder hinge cove and closure',
  );
  rudderHingeClosure.userData.tailConnection = true;
  rudderHingeClosure.userData.controlExtremesDeg = [-30, 30];
  const rudder = new THREE.Group();
  rudder.position.set(0, 0, 1.20);
  rudder.name = 'Fabric-covered production rudder hinge';
  const rudderStations = [
    { y: 0.40, lead: 0.00, chord: 0.58, thickness: 0.074 },
    { y: 0.72, lead: 0.00, chord: 0.57, thickness: 0.069 },
    { y: 0.90, lead: 0.00, chord: 0.56, thickness: 0.064 },
    { y: 1.30, lead: 0.00, chord: 0.51, thickness: 0.052 },
    { y: 1.60, lead: 0.00, chord: 0.47, thickness: 0.041 },
    { y: 1.75, lead: 0.00, chord: 0.45, thickness: 0.034 },
    { y: 1.82, lead: 0.00, chord: 0.44, thickness: 0.029 },
    { y: 1.84, lead: 0.00, chord: 0.44, thickness: 0.026 },
    { y: 1.90, lead: 0.00, chord: 0.42, thickness: 0.018 },
    { y: 1.925, lead: 0.00, chord: 0.18, thickness: 0.010 },
    { y: 1.948, lead: 0.00, chord: 0.01, thickness: 0.002 },
  ];
  addMesh(rudder, verticalControlGeometry(rudderStations), materials.rudderFabric, [0, 0, 0], 'Subtly ribbed fabric rudder skin');
  addMesh(rudder, new THREE.BoxGeometry(0.075, 0.27, 0.10), materials.aluminumDark, [0, 0.82, 0.52], 'Rudder trim tab');
  for (const y of [0.66, 0.96, 1.26, 1.55, 1.79]) {
    const chord = THREE.MathUtils.lerp(0.58, 0.39, THREE.MathUtils.smoothstep(y, 0.55, 1.88));
    for (const sign of [-1, 1]) {
      cylinderBetween(rudder, new THREE.Vector3(sign * 0.042, y, 0.04), new THREE.Vector3(sign * 0.025, y, chord), 0.0015, materials.aluminumLight, 5, 'Rudder rib tape');
    }
  }
  finAssembly.add(rudder);
  group.add(finAssembly);

  const aerialAnchorLocal = new THREE.Vector3(0, 1.84, 0.90);
  const aerialAnchor = addMesh(finAssembly, new THREE.SphereGeometry(0.024, 12, 8), materials.darkSteel, aerialAnchorLocal.toArray(), 'Vertical-fin aerial wire anchor and insulator');
  aerialAnchor.userData.tailConnection = true;
  const aerialAnchorWorld = aerialAnchorLocal.clone()
    .applyQuaternion(finAssembly.quaternion)
    .add(finAssembly.position);

  const tailLightFairing = addMesh(rudder, new THREE.ConeGeometry(0.046, 0.14, 16), materials.aluminumDark, [0, 0.48, 0.575], 'Rudder trailing tail-light fairing');
  tailLightFairing.rotation.x = Math.PI / 2;
  const tailLightMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.0, roughness: 0.12 });
  const tailLight = addMesh(rudder, new THREE.SphereGeometry(0.032, 12, 8), tailLightMaterial, [0, 0.48, 0.610], 'White tail navigation light');
  tailLight.scale.set(0.72, 0.76, 1.12);

  // Aerial mast, tension wire and belly antenna are small but purposeful.
  cylinderBetween(group, new THREE.Vector3(0, 0.58, 1.52), new THREE.Vector3(0, 1.35, 1.58), 0.016, materials.darkSteel, 9, 'Radio aerial mast');
  const aerial = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 1.35, 1.58),
    aerialAnchorWorld,
  ]), new THREE.LineBasicMaterial({ color: 0x1c2224, transparent: true, opacity: 0.82 }));
  aerial.name = 'Tensioned aerial wire';
  aerial.userData.tailConnection = true;
  group.add(aerial);

  // Hamilton Standard 24D50-type four-blade propeller. The broad cuffs,
  // progressive twist and yellow tips are built as airfoil meshes, not boxes.
  const propeller = new THREE.Group();
  propeller.position.set(0, 0.12, -4.10);
  propeller.rotation.x = THREE.MathUtils.degToRad(1.75);
  propeller.name = 'Hamilton Standard four-blade propeller assembly';
  const spinnerProfile = [
    new THREE.Vector2(0.355, 0.000),
    new THREE.Vector2(0.354, 0.075),
    new THREE.Vector2(0.338, 0.190),
    new THREE.Vector2(0.300, 0.335),
    new THREE.Vector2(0.241, 0.495),
    new THREE.Vector2(0.166, 0.635),
    new THREE.Vector2(0.083, 0.750),
    new THREE.Vector2(0.000, 0.815),
  ];
  const spinner = addMesh(propeller, new THREE.LatheGeometry(spinnerProfile, 48), materials.aluminumLight, [0, 0, 0], 'Tight ogive spinner');
  spinner.rotation.x = -Math.PI / 2;
  const spinnerBackplate = addMesh(propeller, new THREE.CylinderGeometry(0.357, 0.357, 0.035, 48), materials.darkSteel, [0, 0, 0.015], 'Spinner backplate');
  spinnerBackplate.rotation.x = Math.PI / 2;
  const blades = new THREE.Group();
  blades.name = 'Four cuffed propeller blades';
  blades.position.z = -0.015;
  const mainBladeGeometry = propBladeGeometry([
    { radius: 0.18, width: 0.34, thickness: 0.125, sweep: 0.00, twist: 0.76 },
    { radius: 0.38, width: 0.46, thickness: 0.118, sweep: 0.015, twist: 0.68 },
    { radius: 0.62, width: 0.45, thickness: 0.104, sweep: 0.045, twist: 0.58 },
    { radius: 0.90, width: 0.40, thickness: 0.087, sweep: 0.085, twist: 0.47 },
    { radius: 1.20, width: 0.33, thickness: 0.069, sweep: 0.128, twist: 0.36 },
    { radius: 1.48, width: 0.25, thickness: 0.052, sweep: 0.172, twist: 0.27 },
    { radius: 1.56, width: 0.215, thickness: 0.046, sweep: 0.188, twist: 0.24 },
  ], { capEnd: false });
  const yellowTipGeometry = propBladeGeometry([
    { radius: 1.56, width: 0.215, thickness: 0.046, sweep: 0.188, twist: 0.24 },
    { radius: 1.65, width: 0.155, thickness: 0.038, sweep: 0.208, twist: 0.21 },
    { radius: 1.702, width: 0.060, thickness: 0.025, sweep: 0.222, twist: 0.19 },
  ], { capStart: false });
  for (let bladeIndex = 0; bladeIndex < 4; bladeIndex++) {
    const holder = new THREE.Group();
    holder.name = `Propeller blade ${bladeIndex + 1}`;
    holder.rotation.z = bladeIndex * Math.PI / 2;
    addMesh(holder, mainBladeGeometry, materials.blackPaint, [0, 0, 0], 'Black cuffed blade body');
    addMesh(holder, yellowTipGeometry, materials.yellowPaint, [0, 0, 0], 'Yellow propeller blade tip');
    blades.add(holder);
  }
  propeller.add(blades);
  const propDisc = addMesh(propeller, new THREE.CircleGeometry(1.702, 64), new THREE.MeshBasicMaterial({
    map: propDiscTexture(),
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  }), [0, 0, -0.03], 'Propeller motion blur disc');
  propDisc.renderOrder = 3;
  group.add(propeller);

  // Fully retractable inward-folding main gear. Wells have depth, ribs and a
  // plausible hydraulic load path; tyre size and tread match the official data.
  const gearPivotX = 1.90;
  const innerDoors = {};
  const wheelWells = {};
  const wellVisuals = [];
  const navLights = { [-1]: null, [1]: null };
  // Recover named nav-light meshes from the flexed hierarchy.
  for (const sign of [-1, 1]) {
    wingAssemblies[sign].traverse(object => {
      if (object.name === `${sign < 0 ? 'Left' : 'Right'} inset navigation light`) navLights[sign] = object;
    });
  }

  for (const side of [-1, 1]) {
    const sideName = side < 0 ? 'Left' : 'Right';
    const wellCenter = new THREE.Vector3(side * 0.38, -0.21, 0.20);
    const wellReference = new THREE.Object3D();
    wellReference.position.copy(wellCenter);
    wellReference.name = `${sideName} wheel-well centre reference`;
    group.add(wellReference);
    wheelWells[side] = wellReference;
    const well = addMesh(group, new THREE.CylinderGeometry(0.345, 0.345, 0.13, 36, 1, true), materials.well, [wellCenter.x, wellCenter.y, wellCenter.z], `${sideName} open deep wheel well`);
    well.scale.set(0.92, 1, 1.02);
    const wellBack = addMesh(group, new THREE.CircleGeometry(0.345, 36), materials.cockpitBlack, [wellCenter.x, wellCenter.y + 0.067, wellCenter.z], `${sideName} recessed wheel-well roof`);
    wellBack.rotation.x = Math.PI / 2;
    wellBack.scale.set(0.92, 1.02, 1);
    const wellRim = addMesh(group, new THREE.TorusGeometry(0.345, 0.025, 8, 40), materials.aluminumDark, [wellCenter.x, wellCenter.y - 0.045, wellCenter.z], `${sideName} formed wheel-well lip`);
    wellRim.rotation.x = Math.PI / 2;
    wellRim.scale.set(0.92, 1.02, 1);
    wellVisuals.push(well, wellBack, wellRim);
    for (let rib = -2; rib <= 2; rib++) {
      const wellRib = cylinderBetween(group,
        new THREE.Vector3(wellCenter.x - side * 0.27, wellCenter.y - 0.06, wellCenter.z + rib * 0.105),
        new THREE.Vector3(wellCenter.x + side * 0.27, wellCenter.y - 0.06, wellCenter.z + rib * 0.105),
        0.009, materials.aluminumDark, 6, `${sideName} wheel-well rib`);
      wellVisuals.push(wellRib);
    }
    const innerDoor = new THREE.Group();
    innerDoor.position.set(side * 0.40, -0.28, 0.20);
    innerDoor.name = `${sideName} inner landing-gear door`;
    const doorMesh = addMesh(innerDoor, profileGeometry([
      [-0.02, -0.35], [-0.03, -0.12], [-0.02, 0.26], [0.08, 0.43],
      [0.24, 0.39], [0.34, 0.02], [0.25, -0.31],
    ], 0.010), materials.aluminumHardware, [0, 0, 0], `${sideName} thin contoured inner gear door skin`);
    doorMesh.rotation.z = side * Math.PI / 2;
    group.add(innerDoor);
    innerDoors[side] = innerDoor;
  }

  function buildMainGear(side) {
    const sideName = side < 0 ? 'Left' : 'Right';
    const gear = new THREE.Group();
    gear.position.set(side * gearPivotX, -0.18, 0.30);
    gear.userData.downY = -0.18;
    gear.userData.pivotInvariant = true;
    gear.name = `${sideName} inward-retracting main landing gear`;
    const barrelEnd = new THREE.Vector3(-side * 0.060, -1.06, -0.065);
    const pistonEnd = new THREE.Vector3(-side * 0.087, -1.38, -0.090);
    const axle = new THREE.Vector3(-side * 0.0965, -1.52, -0.10);
    cylinderBetween(gear, new THREE.Vector3(0, 0, 0), barrelEnd, 0.074, materials.aluminumDark, 16, `${sideName} Bendix main oleo outer barrel`);
    cylinderBetween(gear, barrelEnd, pistonEnd, 0.048, materials.steel, 16, `${sideName} 0.32-metre visible polished oleo piston`);
    cylinderBetween(gear, pistonEnd, axle, 0.066, materials.aluminumDark, 14, `${sideName} compact cast lower spindle housing`);
    cylinderBetween(gear, new THREE.Vector3(-0.14, 0, 0), new THREE.Vector3(0.14, 0, 0), 0.084, materials.darkSteel, 16, `${sideName} heavy upper trunnion`);
    cylinderBetween(gear, axle.clone().add(new THREE.Vector3(-0.125, 0, 0)), axle.clone().add(new THREE.Vector3(0.125, 0, 0)), 0.035, materials.darkSteel, 14, `${sideName} one-piece main-wheel spindle`);

    const actuatorLug = new THREE.Vector3(-side * 0.030, -0.52, -0.032);
    cylinderBetween(gear, new THREE.Vector3(side * 0.020, -0.06, 0.18), actuatorLug, 0.031, materials.darkSteel, 12, `${sideName} compact hydraulic retraction actuator`);
    const actuatorPin = addMesh(gear, new THREE.SphereGeometry(0.043, 12, 8), materials.aluminumDark, actuatorLug.toArray(), `${sideName} retraction-actuator strut lug`);
    actuatorPin.scale.x = 0.72;

    const torqueKnee = new THREE.Vector3(-side * 0.105, -1.205, -0.070);
    cylinderBetween(gear, new THREE.Vector3(-side * 0.070, -1.08, -0.058), torqueKnee, 0.019, materials.darkSteel, 8, `${sideName} upper compact torque link`);
    cylinderBetween(gear, torqueKnee, new THREE.Vector3(-side * 0.092, -1.34, -0.087), 0.019, materials.darkSteel, 8, `${sideName} lower compact torque link`);
    tube(gear, [
      new THREE.Vector3(-side * 0.035, -0.15, 0.07),
      new THREE.Vector3(-side * 0.045, -0.76, 0.02),
      new THREE.Vector3(-side * 0.075, -1.24, -0.05),
      new THREE.Vector3(-side * 0.096, -1.49, -0.09),
    ], 0.007, materials.rubber, 24, 5, `${sideName} brake hose`);

    const outerDoor = addMesh(gear, profileGeometry([
      [-0.06, -0.05], [-0.18, -0.14], [-1.15, -0.11], [-1.30, -0.04],
      [-1.18, 0.09], [-0.20, 0.12], [-0.06, 0.05],
    ], 0.010), materials.aluminumHardware, [side * 0.100, 0, 0], `${sideName} 20 mm thin bracket-mounted main strut door`);
    outerDoor.rotation.z = -side * THREE.MathUtils.degToRad(3.0);
    outerDoor.userData.side = side;
    outerDoor.userData.downRotationZ = outerDoor.rotation.z;
    outerDoor.userData.strutSurfaceGapMetres = [0.020, 0.030];
    outerDoor.userData.stowCorrectionDeg = 0;
    outerDoor.userData.rigidToStrut = true;
    for (const [y, z, strutX, doorInnerX] of [
      [-0.36, -0.022, -side * 0.020, side * 0.071],
      [-0.92, -0.055, -side * 0.052, side * 0.042],
    ]) {
      cylinderBetween(
        gear,
        new THREE.Vector3(strutX + side * 0.064, y, z),
        new THREE.Vector3(doorInnerX, y, z),
        0.011,
        materials.darkSteel,
        8,
        `${sideName} strut-door mounting bracket`,
      );
    }

    const wheelSpin = new THREE.Group();
    wheelSpin.position.copy(axle);
    wheelSpin.name = `${sideName} main wheel spin`;
    addMesh(wheelSpin, roundedTireGeometry(0.343, 0.220, 0.174, 64), materials.tireRubber, [0, 0, 0], `${sideName} 27-inch broad smooth-contour tyre with conformal tread relief`);
    const hub = addMesh(wheelSpin, new THREE.CylinderGeometry(0.165, 0.165, 0.152, 28), materials.aluminumLight, [0, 0, 0], `${sideName} recessed 0.33-metre cast wheel face`);
    hub.rotation.z = Math.PI / 2;
    const brake = addMesh(wheelSpin, new THREE.CylinderGeometry(0.128, 0.128, 0.132, 24), materials.darkSteel, [0, 0, 0], `${sideName} recessed brake drum`);
    brake.rotation.z = Math.PI / 2;
    for (let opening = 0; opening < 8; opening++) {
      const angle = opening / 8 * Math.PI * 2;
      const scallop = addMesh(wheelSpin, new THREE.SphereGeometry(0.020, 8, 5), materials.darkSteel, [0.078 * side, Math.cos(angle) * 0.112, Math.sin(angle) * 0.112], 'Recessed wheel-face scallop');
      scallop.scale.x = 0.24;
    }
    gear.add(wheelSpin);
    group.add(gear);
    return { gear, wheelSpin, outerDoor };
  }

  const leftGear = buildMainGear(-1);
  const rightGear = buildMainGear(1);

  // Fully retractable and rudder-linked steerable tailwheel with twin doors.
  const tailWheel = new THREE.Group();
  tailWheel.position.set(0, 0.25, 4.12);
  tailWheel.name = 'Retractable tailwheel assembly';
  tailWheel.userData.pivotInvariant = true;
  cylinderBetween(tailWheel, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.29, 0.02), 0.041, materials.aluminumDark, 12, 'Compact tailwheel steering cartridge');
  const tailWheelSteer = new THREE.Group();
  tailWheelSteer.position.set(0, -0.285, 0.02);
  tailWheelSteer.name = 'Rudder-linked tailwheel steering pivot';
  tailWheelSteer.userData.maxSteeringDeg = aircraftCapabilities.features.landingGear.tailwheelSteeringDeg;
  const steeringHead = addMesh(tailWheelSteer, new THREE.CylinderGeometry(0.058, 0.050, 0.105, 14), materials.darkSteel, [0, 0, 0], 'Tailwheel steering and declutch head');
  steeringHead.rotation.z = Math.PI / 2;
  tube(tailWheelSteer, [
    new THREE.Vector3(-0.050, -0.005, 0),
    new THREE.Vector3(-0.075, -0.085, 0.08),
    new THREE.Vector3(-0.062, -0.185, 0.22),
  ], 0.028, materials.aluminumDark, 24, 10, 'Single swept cast hockey-stick tailwheel fork');
  const tailWheelSpin = new THREE.Group();
  tailWheelSpin.position.set(0, -0.185, 0.22);
  tailWheelSpin.name = 'Tailwheel spin';
  addMesh(tailWheelSpin, roundedTireGeometry(0.159, 0.100, 0.072, 40), materials.tireRubber, [0, 0, 0], '12.5-inch rounded tail tyre');
  const tailHub = addMesh(tailWheelSpin, new THREE.CylinderGeometry(0.072, 0.072, 0.076, 18), materials.aluminumDark, [0, 0, 0], 'Recessed tailwheel hub');
  tailHub.rotation.z = Math.PI / 2;
  cylinderBetween(tailWheelSteer, new THREE.Vector3(-0.070, -0.185, 0.22), new THREE.Vector3(0.070, -0.185, 0.22), 0.020, materials.darkSteel, 10, 'Tailwheel cantilever axle');
  tailWheelSteer.add(tailWheelSpin);
  tailWheel.add(tailWheelSteer);
  group.add(tailWheel);
  const buildTailDoor = side => {
    const sideName = side < 0 ? 'Left' : 'Right';
    const door = new THREE.Group();
    door.position.set(side * 0.006, 0.130, 4.10);
    door.name = `${sideName} tailwheel door`;
    addMesh(
      door,
      tailWheelDoorGeometry(side, 0.018),
      materials.aluminumHardware,
      [0, 0, 0],
      `${sideName} curved tapered tailwheel-door skin`,
    );
    door.rotation.z = side * 0.58;
    group.add(door);
    return door;
  };
  const tailDoorL = buildTailDoor(-1);
  const tailDoorR = buildTailDoor(1);

  
  group.traverse(object => {
    if (!object.isMesh) return;
    const transparent = object.material?.transparent === true;
    object.castShadow = !transparent;
    object.receiveShadow = !transparent;
  });
  canopyGlass.castShadow = false;
  propDisc.castShadow = false;
  propDisc.receiveShadow = false;

  group.userData.rig = deepFreeze({
    animationContractRevision: aircraftCapabilities.assetRevision,
    wingFlexVersion: aircraftCapabilities.features.wingFlex.version,
    handles: aircraftCapabilities.animation.namedParts,
  });

  return {
    group,
    propeller,
    blades,
    propDisc,
    spinner,
    aileronL: ailerons[-1],
    aileronR: ailerons[1],
    flapL: flaps[-1],
    flapR: flaps[1],
    elevator,
    elevatorL,
    elevatorR,
    rudder,
    wingFlexJointsL: wingFlexJoints[-1],
    wingFlexJointsR: wingFlexJoints[1],
    wingFlexL: wingFlexJoints[-1][0],
    wingFlexR: wingFlexJoints[1][0],
    wingAssemblyL: wingAssemblies[-1],
    wingAssemblyR: wingAssemblies[1],
    tipL: tipObjects[-1],
    tipR: tipObjects[1],
    gearL: leftGear.gear,
    gearR: rightGear.gear,
    wheelL: leftGear.wheelSpin,
    wheelR: rightGear.wheelSpin,
    outerDoorL: leftGear.outerDoor,
    outerDoorR: rightGear.outerDoor,
    innerDoorL: innerDoors[-1],
    innerDoorR: innerDoors[1],
    wellL: wheelWells[-1],
    wellR: wheelWells[1],
    wellVisuals,
    tailWheel,
    tailGear: tailWheel,
    tailWheelSteer,
    tailWheelSpin,
    tailDoorL,
    tailDoorR,
    canopy,
    windscreen,
    gunsight,
    controlStick,
    radiatorDoor,
    navLightL: navLights[-1],
    navLightR: navLights[1],
    tailLight,
    landingLight,
    recognitionLights,
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
  plane.blades.rotation.z -= (5.5 + throttle * 62) * dt;
  plane.propDisc.material.opacity = Math.min(0.30, Math.max(0, throttle - 0.08) * 0.45);

  const roll = THREE.MathUtils.clamp(input.rollSm ?? 0, -1, 1);
  const pitch = THREE.MathUtils.clamp(input.pitchSm ?? 0, -1, 1);
  const yaw = THREE.MathUtils.clamp(input.yawSm ?? 0, -1, 1);
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
  const aileronAngle = roll * THREE.MathUtils.degToRad(15);
  const driveControl = (controller, angle) => {
    const surfaces = controller?.userData?.surfaces;
    if (surfaces?.length) surfaces.forEach(surface => { surface.rotation.x = angle; });
    else if (controller) controller.rotation.x = angle;
  };
  driveControl(plane.aileronL, aileronAngle);
  driveControl(plane.aileronR, aileronAngle);
  const elevatorAngle = THREE.MathUtils.degToRad(pitch >= 0 ? pitch * 30 : pitch * 20);
  if (plane.elevatorL && plane.elevatorR) {
    plane.elevatorL.rotation.x = elevatorAngle;
    plane.elevatorR.rotation.x = -elevatorAngle;
  } else {
    plane.elevator.rotation.x = -elevatorAngle;
  }
  plane.rudder.rotation.y = yaw * THREE.MathUtils.degToRad(30);
  if (plane.tailWheelSteer) {
    plane.tailWheelSteer.rotation.y = yaw
      * THREE.MathUtils.degToRad(aircraftCapabilities.features.landingGear.tailwheelSteeringDeg)
      * THREE.MathUtils.clamp(physics.gearTransit ?? 1, 0, 1);
  }

  const flapCommand = THREE.MathUtils.clamp(input.flapSm ?? physics.flapTransit ?? 0, 0, 1);
  const flapAngle = flapCommand * THREE.MathUtils.degToRad(47);
  driveControl(plane.flapL, -flapAngle);
  driveControl(plane.flapR, flapAngle);

  const gearTransit = THREE.MathUtils.clamp(physics.gearTransit ?? 1, 0, 1);
  const fold = (1 - gearTransit) * THREE.MathUtils.degToRad(aircraftCapabilities.features.landingGear.mainFoldDeg);
  plane.gearL.rotation.z = fold;
  plane.gearR.rotation.z = -fold;
  for (const door of [plane.outerDoorL, plane.outerDoorR]) {
    if (!door) continue;
    door.rotation.z = (door.userData.downRotationZ ?? 0)
      - (door.userData.side ?? 0) * (1 - gearTransit)
      * THREE.MathUtils.degToRad(door.userData.stowCorrectionDeg ?? 7.5);
  }
  plane.gearL.visible = true;
  plane.gearR.visible = true;
  if (plane.wellVisuals) plane.wellVisuals.forEach(object => { object.visible = true; });
  plane.innerDoorL.rotation.z = -gearTransit * THREE.MathUtils.degToRad(68);
  plane.innerDoorR.rotation.z = gearTransit * THREE.MathUtils.degToRad(68);
  plane.tailWheel.rotation.x = (1 - gearTransit)
    * THREE.MathUtils.degToRad(aircraftCapabilities.features.landingGear.tailwheelFoldDeg);
  plane.tailWheel.visible = true;
  plane.tailDoorL.rotation.z = -gearTransit * 0.58;
  plane.tailDoorR.rotation.z = gearTransit * 0.58;

  const cooling = THREE.MathUtils.clamp(physics.radiatorDoorSm ?? 0.18 + throttle * 0.58, 0, 1);
  plane.radiatorDoor.rotation.x = -cooling * THREE.MathUtils.degToRad(24);

  if (physics.grounded && (physics.speed ?? 0) > 0.2) {
    const wheelRotation = ((physics.speed ?? 0) / 0.342) * dt;
    plane.wheelL.rotation.x -= wheelRotation;
    plane.wheelR.rotation.x -= wheelRotation;
    plane.tailWheelSpin.rotation.x -= wheelRotation * 2.16;
  }

  plane.blinkT = (plane.blinkT + dt) % 1;
  if (plane.tailLight?.material) plane.tailLight.material.emissiveIntensity = 0.65;
}
