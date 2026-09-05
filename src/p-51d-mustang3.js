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
  schemaVersion: 3,
  assetRevision: '2.1.1-p51d',
  geometryRevision: 7,
  canopyRevision: 4,
  tailRevision: 5,
  tailSilhouetteRevision: 5,
  landingGearGeometryRevision: 6,
  surfaceClosureRevision: 3,
  canopyBodyConnectionRevision: 3,
  cockpitVisuals: 'neutral-cavity',
  updatedAt: '2026-09-05',
  apertureClosureRevision: {
    version: 1,
    updatedAt: '2026-09-05',
    changes: ['exact-clipped-cockpit-body-boundary', 'solid-canopy-lower-frames',
      'windscreen-feet-seated-on-closed-coaming', 'closed-conformal-aft-deck',
      'aft-frame-taper-seated-on-body', 'outward-propeller-faces', 'capped-wing-root-fairings'],
    policy: 'Exterior seams require actual backing surfaces, not only overlapping bounds. Intentional intake and cockpit openings have recessed opaque interiors.',
  },
  craftsmanshipRevision: {
    version: 1,
    updatedAt: '2026-09-05',
    changes: [
      'gear-bays-contained-within-wing-planform-and-upper-surface',
      'compound-main-gear-retraction-into-conformal-enclosed-pockets',
      'unified-dorsal-and-vertical-fin-leading-contour',
      'continuous-leading-edge-normals-and-narrow-control-seams',
      'swept-oval-exhaust-ejectors-with-thick-lips-and-recessed-interiors',
      'restrained-satin-metal-and-fine-surface-grain',
    ],
    wingFlexContract: 'Unchanged: features.wingFlex.version=3; use updatePlaneVisual or updateWingFlex.',
  },
  geometryBasis: {
    exactData: ['nominal dimensions', 'UIUC P-51D root and tip wing ordinates', 'propeller-plane to wing-quarter-chord station'],
    drawingCalibrated: ['canopy landmarks', 'landing-gear pivot and axle stations', 'radiator mouth and outlet stations'],
    modeledApproximation: ['horizontal-tail symmetric section', 'gear-bay internal structure and compound retraction', 'fuselage intermediate loft stations', 'oval exhaust ejector sections'],
  },
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
  referenceAlignmentRevision: {
    updatedAt: '2026-09-04',
    reasons: [
      'move-wing-quarter-chord-to-dimensioned-stock-three-view-station',
      'replace-generic-wing-sections-with-measured-root-and-tip-ordinates',
      'remove-control-surface-neutral-steps-and-tail-overlap',
      'join-windscreen-and-bubble-hood-on-one-shared-contour',
      'shorten-and-register-main-gear-from-dimensioned-thrust-line-height',
      'cut-connected-wheel-and-strut-bays-through-the-actual-lower-skin',
      'replace-decorative-retraction-rods-with-airframe-anchored-actuators',
      'replace-invented-cowl-oval-with-one-recessed-carburetor-smile',
      'flatten-and-extend-radiator-installation-to-the-aft-outlet',
    ],
  },
  closureRefinement: {
    updatedAt: '2026-09-04',
    reasons: [
      'replace-the-detached-triangular-dorsal-wedge-with-a-continuous-p51d-fin-fillet',
      'seat-the-fin-fillet-into-both-the-fuselage-spine-and-fixed-fin-root',
      'enclose-every-main-wheel-and-strut-opening-with-a-continuous-structural-bay-tub',
      'remove-overlapping-decorative-bay-rings-that-read-as-open-wire-loops',
      'retain-an-unbroken-fuselage-belly-through-the-wing-centre-section',
      'verify-tail-joins-and-gear-bay-depth-with-runtime-geometric-leak-tests',
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
      rootThicknessRatio: 0.16515,
      tipThicknessRatio: 0.1141822,
      rootLeadingEdgeZ: -2.066,
      quarterChordReferenceZ: -1.4055,
      sectionData: 'UIUC P-51D root BL17.5 and tip BL215 ordinates, spanwise interpolated',
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
    origin: 'authoring datum on fuselage centreline; not the current wing aerodynamic centre',
  },
  gameIntegration: {
    viewerPose: 'Suspended presentation pose; not a collision or contact solution.',
    groundedPose: {
      pitchDeg: 11.2,
      groupTranslationYMetres: 1.19,
      source: 'Computed three-point attitude from modeled tyre contacts after reference-registered gear correction.',
      applyOrder: ['set gearTransit=1', 'set group.rotation.x', 'set group.position.y'],
    },
    geometryQueries: 'buildPlane().geometryQueries exposes wing section/frame/surface functions in model coordinates.',
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
      wingFlexSm: { range: [-1, 1], drives: ['updateWingFlex', 'wingFlexJointsL', 'wingFlexJointsR'] },
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
        'innerDoorL', 'innerDoorR', 'actuatorL', 'actuatorR', 'tailWheel', 'tailWheelSteer', 'tailWheelSpin', 'tailDoorL', 'tailDoorR',
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
      mainWheelPreFoldDeg: 28,
      mainRetractionRotationOrder: 'ZXY',
      mainRetractionModel: 'Authored compound trunnion approximation: inward 82.5-degree fold and -28-degree fore-aft rotation place the wheels in conformal, enclosed wing pockets; not a manufacturing linkage simulation.',
      mainPivotMetres: { x: 1.90, y: -0.17, z: -1.68 },
      downAxleMetres: { x: 1.8035, y: -1.2302, z: -1.90 },
      connectedGearBayAperture: true,
      enclosedGearBayTubs: true,
      fuselageBellyRemainsClosedAcrossMainGearStation: true,
      airframeAnchoredRetractionActuators: true,
      outerDoorDownAlignmentDeg: 0,
      outerDoorStowCorrectionDeg: 0,
      pivotInvariant: true,
      mainOleoType: 'Bendix cantilever oleo with one-sided cast lower spindle',
      visiblePolishedPistonMetres: 0.20,
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
      version: 3,
      implementation: 'continuous-cpu-skin-deformation-with-compatible-joint-handles',
      updatedAt: '2026-09-04',
      supersedes: { version: 2, implementation: 'distributed-rigid-segments' },
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
        'Call updatePlaneVisual, or updateWingFlex directly only after applying control-surface angles.',
        'Skin, controls, markings, lights, pitot, positions, normals and raycast bounds share one continuous bending field.',
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
    geometryPolicy: 'Finite geometry, outward winding, closed primary shells, and enclosed structural tubs behind every intentional aperture',
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
      { slot: 'official-three-view', title: 'Stock P-51D three-view reproduced in NTSB Airworthiness Group Appendix A, Figure 1', url: 'https://data.ntsb.gov/Docket/Document/docBLOB?ID=40468432&FileExtension=.PDF&FileName=Airworthiness%20Group%20Chairman%27s%20Factual%20Report-Appendix%20A-Figures-Master.PDF' },
      { slot: 'measured-wing-root', title: 'UIUC P-51D root BL17.5 airfoil coordinates', url: 'https://m-selig.web.engr.illinois.edu/ads/coord/p51droot.dat' },
      { slot: 'measured-wing-tip', title: 'UIUC P-51D tip BL215 airfoil coordinates', url: 'https://m-selig.web.engr.illinois.edu/ads/coord/p51dtip.dat' },
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

// The skin is cut as two overlapping convex apertures because the triangle
// clipper deliberately stays simple and robust.  The visible well, however,
// follows their single rounded union outline so there is no doubled circular
// rim or unsupported gap between the wheel pocket and strut channel.
const MAIN_GEAR = Object.freeze({ pivotX: 1.90, pivotY: -0.17, pivotZ: -1.68,
  axleX: 0.0965, axleY: -1.0602, axleZ: -0.22, foldDeg: 82.5,
  preFoldDeg: -28, wheelBayX: 0.856912, wheelBayZ: -1.376515 });
const GEAR_WHEEL_OPENING = Array.from({ length: 28 }, (_, i) => {
  const angle = i / 28 * Math.PI * 2;
  return [MAIN_GEAR.wheelBayX + Math.cos(angle) * 0.370,
    MAIN_GEAR.wheelBayZ + Math.sin(angle) * 0.365];
});
const GEAR_STRUT_OPENING = [
  [0.86, -1.51], [2.03, -1.795], [2.03, -1.515], [0.86, -1.24],
];
const GEAR_BAY_OPENINGS = [GEAR_WHEEL_OPENING, GEAR_STRUT_OPENING];
const GEAR_BAY_TUB_ARC_START = 0.48;
const GEAR_BAY_TUB_ARC_END = Math.PI * 2 - 1.00;
const gearBayTubArcPoint = angle => [
  MAIN_GEAR.wheelBayX + Math.cos(angle) * 0.385,
  MAIN_GEAR.wheelBayZ + Math.sin(angle) * 0.380,
];
const GEAR_BAY_TUB_OUTLINE = [
  gearBayTubArcPoint(GEAR_BAY_TUB_ARC_END),
  [2.050, -1.817],
  [2.050, -1.493],
  ...Array.from({ length: 25 }, (_, i) => gearBayTubArcPoint(
    THREE.MathUtils.lerp(GEAR_BAY_TUB_ARC_START, GEAR_BAY_TUB_ARC_END, i / 25),
  )),
];

// Closed stamped panels share the same wing-surface evaluator as the skin.
// Subdividing the fill is essential: merely lifting an outline into the wing
// leaves large flat triangles crossing the curved upper skin near the nose.
function gearConformalPanelGeometry(outline, surfaceY, thickness = 0.006) {
  const contour = outline.map(([x, z]) => new THREE.Vector2(x, z));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  const top = [], bottom = [], sides = [];
  const point = ([x, z], offset = 0) => [x, surfaceY(x, z) + offset, z];
  const area = outline.reduce((sum, a, i) => {
    const b = outline[(i + 1) % outline.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0);
  const emit = (a, b, c, depth = 0) => {
    const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (depth < 6 && Math.max(distance(a, b), distance(b, c), distance(c, a)) > 0.09) {
      const mid = (p, q) => [(p[0] + q[0]) * 0.5, (p[1] + q[1]) * 0.5];
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      emit(a, ab, ca, depth + 1); emit(ab, b, bc, depth + 1);
      emit(ca, bc, c, depth + 1); emit(ab, bc, ca, depth + 1);
      return;
    }
    const winding = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const upper = winding > 0 ? [a, c, b] : [a, b, c];
    upper.forEach(p => top.push(...point(p)));
    [...upper].reverse().forEach(p => bottom.push(...point(p, -thickness)));
  };
  triangles.forEach(([a, b, c]) => emit(outline[a], outline[b], outline[c]));
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.04));
    for (let step = 0; step < steps; step++) {
      const p = a.map((value, j) => THREE.MathUtils.lerp(value, b[j], step / steps));
      const q = a.map((value, j) => THREE.MathUtils.lerp(value, b[j], (step + 1) / steps));
      const points = [point(p), point(q), point(p, -thickness),
        point(q), point(q, -thickness), point(p, -thickness)];
      if (area < 0) points.reverse();
      points.forEach(v => sides.push(...v));
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([...top, ...bottom, ...sides], 3));
  geometry.addGroup(0, top.length / 3, 0);
  geometry.addGroup(top.length / 3, bottom.length / 3, 1);
  geometry.addGroup((top.length + bottom.length) / 3, sides.length / 3, 2);
  geometry.computeVertexNormals();
  // A formed skin is smooth across the tessellation, but keeps a crisp rolled
  // perimeter. Derive face normals from the same continuous wing surface.
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const epsilon = 0.001;
  const skinVertexCount = (top.length + bottom.length) / 3;
  for (let i = 0; i < skinVertexCount; i++) {
    const x = position.getX(i), z = position.getZ(i);
    const dx = (surfaceY(x + epsilon, z) - surfaceY(x - epsilon, z)) / (2 * epsilon);
    const dz = (surfaceY(x, z + epsilon) - surfaceY(x, z - epsilon)) / (2 * epsilon);
    const sign = i < top.length / 3 ? 1 : -1;
    const length = Math.hypot(dx, 1, dz);
    normal.setXYZ(i, -dx * sign / length, sign / length, -dz * sign / length);
  }
  return geometry;
}

// Subtract convex vertical prisms from the selected faces. Exact triangle
// clipping preserves the original smooth normals and UVs at every new edge;
// centroid-only face deletion would leave a jagged, resolution-dependent hole.
function clipGearBayOpenings(source, predicate = null) {
  const names = Object.keys(source.attributes);
  const output = Object.fromEntries(names.map(name => [name, []]));
  const holes = [-1, 1].flatMap(side => GEAR_BAY_OPENINGS
    .map(outline => outline.map(([x, z]) => [side * x, z])));
  const position = source.getAttribute('position');
  const indices = source.index?.array;
  const count = indices?.length ?? position.count;
  const vertex = index => Object.fromEntries(names.map(name => {
    const attr = source.getAttribute(name);
    return [name, Array.from({ length: attr.itemSize }, (_, c) => attr.array[index * attr.itemSize + c])];
  }));
  const interpolate = (a, b, t) => Object.fromEntries(names.map(name => [name,
    a[name].map((value, i) => THREE.MathUtils.lerp(value, b[name][i], t))]));
  const subtract = (polygon, hole) => {
    const area = hole.reduce((sum, a, i) => {
      const b = hole[(i + 1) % hole.length];
      return sum + a[0] * b[1] - b[0] * a[1];
    }, 0);
    const winding = Math.sign(area);
    let inside = polygon;
    const retained = [];
    for (let edge = 0; edge < hole.length && inside.length > 2; edge++) {
      const a = hole[edge], b = hole[(edge + 1) % hole.length];
      const distance = v => winding * ((b[0] - a[0]) * (v.position[2] - a[1])
        - (b[1] - a[1]) * (v.position[0] - a[0]));
      const inn = [], out = [];
      for (let i = 0; i < inside.length; i++) {
        const p = inside[i], q = inside[(i + 1) % inside.length];
        const dp = distance(p), dq = distance(q);
        const pInside = dp >= 0, qInside = dq >= 0;
        (pInside ? inn : out).push(p);
        if (pInside !== qInside) {
          const intersection = interpolate(p, q, dp / (dp - dq));
          inn.push(intersection); out.push(intersection);
        }
      }
      if (out.length > 2) retained.push(out);
      inside = inn;
    }
    return retained;
  };
  for (let i = 0; i < count; i += 3) {
    const triangle = [0, 1, 2].map(j => vertex(indices ? indices[i + j] : i + j));
    const p = triangle.map(v => new THREE.Vector3(...v.position));
    const normal = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0])).normalize();
    const center = p[0].clone().add(p[1]).add(p[2]).multiplyScalar(1 / 3);
    const eligible = predicate ? predicate(center, normal) : normal.y < -0.15;
    let polygons = [triangle];
    if (eligible) for (const hole of holes) polygons = polygons.flatMap(poly => subtract(poly, hole));
    for (const polygon of polygons) for (let j = 1; j < polygon.length - 1; j++) {
      const tri = [polygon[0], polygon[j], polygon[j + 1]];
      const a = new THREE.Vector3(...tri[0].position), b = new THREE.Vector3(...tri[1].position), c = new THREE.Vector3(...tri[2].position);
      if (b.sub(a).cross(c.sub(a)).lengthSq() < 1e-16) continue;
      for (const v of tri) for (const name of names) output[name].push(...v[name]);
    }
  }
  const result = new THREE.BufferGeometry();
  for (const name of names) result.setAttribute(name,
    new THREE.Float32BufferAttribute(output[name], source.getAttribute(name).itemSize));
  result.normalizeNormals();
  result.computeBoundingBox(); result.computeBoundingSphere();
  result.userData = { ...source.userData, gearBayOpenings: true };
  source.dispose();
  return result;
}

// Shape-preserving cubic interpolation keeps the measured station landmarks
// and extrema, while removing the straight axial highlight breaks between them.
// Body skin, markings, sills and attachment queries all use this same evaluator.
function smoothStationValue(stations, index, t, key, axis = 'z', fallback = 0) {
  const value = i => stations[i][key] ?? fallback;
  const interval = i => stations[i + 1][axis] - stations[i][axis];
  const secant = i => (value(i + 1) - value(i)) / interval(i);
  const tangent = i => {
    if (i === 0) return secant(0);
    if (i === stations.length - 1) return secant(i - 1);
    const before = secant(i - 1);
    const after = secant(i);
    if (before * after <= 0) return 0;
    const h0 = interval(i - 1);
    const h1 = interval(i);
    const w0 = 2 * h1 + h0;
    const w1 = h1 + 2 * h0;
    return (w0 + w1) / (w0 / before + w1 / after);
  };
  const h = interval(index);
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * value(index)
    + (t3 - 2 * t2 + t) * h * tangent(index)
    + (-2 * t3 + 3 * t2) * value(index + 1)
    + (t3 - t2) * h * tangent(index + 1);
}

function loftGeometry(sourceStations, radialSegments = 24, cutout = null) {
  const sampleZ = new Set(sourceStations.map(station => station.z));
  for (let i = 0; i < sourceStations.length - 1; i++) {
    const a = sourceStations[i].z;
    const b = sourceStations[i + 1].z;
    const steps = Math.max(1, Math.ceil((b - a) / 0.12));
    for (let j = 1; j < steps; j++) sampleZ.add(THREE.MathUtils.lerp(a, b, j / steps));
  }
  for (const z of [cutout?.zMin, cutout?.zMax, ...(cutout?.extraZ ?? [])]) {
    if (Number.isFinite(z) && z > sourceStations[0].z && z < sourceStations.at(-1).z) sampleZ.add(z);
  }
  const stations = [...sampleZ].sort((a, b) => a - b).map(z => interpolateLoftStation(sourceStations, z));
  radialSegments = Math.max(radialSegments, 80);
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
      uvs.push((station.z - stations[0].z) / (stations.at(-1).z - stations[0].z), i / radialSegments);
      ys.push(y);
    }
    ringY.push(ys);
  }

  const skinVertexCount = positions.length / 3;
  const clippedEdges = new Map();
  const emitSkinTriangle = (a, b, c, trim) => {
    if (!trim) { indices.push(a, b, c); return; }
    const intersection = (i, j) => {
      const key = `${Math.min(i, j)}:${Math.max(i, j)}`;
      if (clippedEdges.has(key)) return clippedEdges.get(key);
      const t = (cutout.yMin - positions[i * 3 + 1]) / (positions[j * 3 + 1] - positions[i * 3 + 1]);
      if (t < 1e-8) return i;
      if (t > 1 - 1e-8) return j;
      const result = positions.length / 3;
      for (let axis = 0; axis < 3; axis++) positions.push(axis === 1 ? cutout.yMin
        : THREE.MathUtils.lerp(positions[i * 3 + axis], positions[j * 3 + axis], t));
      for (let axis = 0; axis < 2; axis++) uvs.push(THREE.MathUtils.lerp(uvs[i * 2 + axis], uvs[j * 2 + axis], t));
      clippedEdges.set(key, result);
      return result;
    };
    const input = [a, b, c], output = [];
    for (let i = 0; i < 3; i++) {
      const p = input[i], q = input[(i + 1) % 3];
      const pInside = positions[p * 3 + 1] <= cutout.yMin;
      const qInside = positions[q * 3 + 1] <= cutout.yMin;
      if (pInside) output.push(p);
      if (pInside !== qInside) output.push(intersection(p, q));
    }
    const unique = output.filter((index, i) => index !== output[(i + output.length - 1) % output.length]);
    for (let i = 1; i < unique.length - 1; i++) indices.push(unique[0], unique[i], unique[i + 1]);
  };

  for (let ring = 0; ring < stations.length - 1; ring++) {
    for (let i = 0; i < radialSegments; i++) {
      const next = i + 1;
      const zMid = (stations[ring].z + stations[ring + 1].z) * 0.5;
      const yMid = (
        ringY[ring][i] + ringY[ring][next]
        + ringY[ring + 1][i] + ringY[ring + 1][next]
      ) * 0.25;
      const corners = [ring * ringSize + i, ring * ringSize + next,
        (ring + 1) * ringSize + i, (ring + 1) * ringSize + next]
        .map(index => new THREE.Vector3().fromArray(positions, index * 3));
      const xMid = corners.reduce((sum, point) => sum + point.x, 0) * 0.25;
      const trim = cutout && Number.isFinite(cutout.yMin)
        && zMid > cutout.zMin && zMid < cutout.zMax;
      if (cutout?.skipFace?.({ x: xMid, y: yMid, z: zMid, vertices: corners })) continue;
      const a = ring * ringSize + i;
      const b = ring * ringSize + next;
      const c = a + ringSize;
      const d = b + ringSize;
      emitSkinTriangle(a, b, c, trim);
      emitSkinTriangle(b, d, c, trim);
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
  // UV seam vertices remain duplicated, but they share a geometric normal.
  const normals = geometry.getAttribute('normal');
  for (let ring = 0; ring < stations.length; ring++) {
    const a = ring * ringSize;
    const b = a + radialSegments;
    const average = new THREE.Vector3().fromBufferAttribute(normals, a)
      .add(new THREE.Vector3().fromBufferAttribute(normals, b)).normalize();
    normals.setXYZ(a, average.x, average.y, average.z);
    normals.setXYZ(b, average.x, average.y, average.z);
  }
  geometry.computeBoundingSphere();
  geometry.userData.loftSampling = {
    ringCount: stations.length,
    maxAxialSpacing: Math.max(...stations.slice(1).map((station, i) => station.z - stations[i].z)),
    distanceMappedUv: true,
    circumferenceSeamNormalsShared: true,
    radialSegments,
    skinVertexCount,
    exactCockpitBoundary: clippedEdges.size > 0,
  };
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
  // Thickness is the FULL upper-to-lower distance, not an ordinate scale.
  // Closing the planform must also close its section; retaining the nominal
  // tip thickness here produces the old thick paddle at the rounded tip.
  const thicknessRatio = THREE.MathUtils.lerp(
    spec.rootThicknessRatio ?? spec.rootThickness / spec.rootChord,
    spec.tipThicknessRatio ?? spec.tipThickness / spec.tipChord,
    t,
  );
  const thickness = chord * thicknessRatio;
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

function sectionOrdinate(spec, spanT, chordT, upper) {
  const root = sampleAirfoil(spec.surfaceProfile ?? AIRFOIL, chordT, upper);
  if (!spec.tipSurfaceProfile) return root;
  return THREE.MathUtils.lerp(root, sampleAirfoil(spec.tipSurfaceProfile, chordT, upper), spanT);
}

function wingSurfacePosition(spec, sign, spanT, chordT, surface = 'mid') {
  const section = wingSection(spec, spanT);
  const upper = sectionOrdinate(spec, spanT, chordT, true);
  const lower = sectionOrdinate(spec, spanT, chordT, false);
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
      let [u, v, coveAngle] = profile[profileIndex % profileCount];
      if (coveAngle !== undefined) {
        const upper = sectionOrdinate(spec, t, spec.hingeFraction, true);
        const lower = sectionOrdinate(spec, t, spec.hingeFraction, false);
        const halfHeight = (upper - lower) * 0.5;
        u = spec.hingeFraction - halfHeight * section.thickness * Math.sin(coveAngle) / section.chord;
        v = (upper + lower) * 0.5 + halfHeight * Math.cos(coveAngle);
      } else if (spec.surfaceProfile) v = sectionOrdinate(spec, t, u, v >= 0);
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
      if (spec.cutout) {
        const center = new THREE.Vector3(
          (positions[a * 3] + positions[b * 3] + positions[c * 3] + positions[d * 3]) * 0.25,
          (positions[a * 3 + 1] + positions[b * 3 + 1] + positions[c * 3 + 1] + positions[d * 3 + 1]) * 0.25,
          (positions[a * 3 + 2] + positions[b * 3 + 2] + positions[c * 3 + 2] + positions[d * 3 + 2]) * 0.25,
        );
        const lower = profile[i][1] < 0 || profile[next % profileCount][1] < 0;
        if (lower && spec.cutout(center, sign)) continue;
      }
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

  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  if (sign < 0) reverseWinding(geometry);
  geometry.computeVertexNormals();
  smoothRingSeamNormals(geometry, sectionSize, spanSegments + 1);
  if (spec.gearBays) geometry = clipGearBayOpenings(geometry);
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

// The same surface vertex is duplicated at a UV seam. Share its normal so
// continuous sheet metal does not acquire an artificial knife-edge highlight.
function smoothRingSeamNormals(geometry, ringSize, ringCount) {
  const normal = geometry.getAttribute('normal');
  const average = new THREE.Vector3();
  for (let ring = 0; ring < ringCount; ring++) {
    const a = ring * ringSize, b = a + ringSize - 1;
    average.set(normal.getX(a) + normal.getX(b), normal.getY(a) + normal.getY(b),
      normal.getZ(a) + normal.getZ(b)).normalize();
    normal.setXYZ(a, average.x, average.y, average.z);
    normal.setXYZ(b, average.x, average.y, average.z);
  }
  normal.needsUpdate = true;
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

const CONTROL_CHORD_SAMPLES = [0, 0.035, 0.09, 0.18, 0.32, 0.50, 0.70, 0.88, 0.975, 1];

function wingControlGeometry(spec, sign, spanStart, spanEnd, hingeFraction, pivot, inverseAlignment, options = {}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const spanSegments = Math.max(6, Math.ceil((spanEnd - spanStart) * 64));
  const noseSegments = 8;
  const skinCount = CONTROL_CHORD_SAMPLES.length * 2 - 1;
  const profileCount = skinCount + noseSegments - 1;
  const sectionSize = profileCount + 1;

  for (let span = 0; span <= spanSegments; span++) {
    const spanT = THREE.MathUtils.lerp(spanStart, spanEnd, span / spanSegments);
    const section = wingSection(spec, spanT);
    for (let i = 0; i <= profileCount; i++) {
      const profileIndex = i % profileCount;
      const hingeUpper = sectionOrdinate(spec, spanT, hingeFraction, true);
      const hingeLower = sectionOrdinate(spec, spanT, hingeFraction, false);
      const hingeMid = (hingeUpper + hingeLower) * 0.5;
      const radius = Math.max(0.0004, (hingeUpper - hingeLower) * section.thickness * 0.5
        - (options.fixedStructure ? 0 : spec.hingeGapMetres ?? 0.004));
      let chordT;
      let ordinate;
      if (profileIndex >= skinCount) {
        const angle = Math.PI * (1 - (profileIndex - skinCount + 1) / noseSegments);
        chordT = hingeFraction - radius * Math.sin(angle) / section.chord;
        ordinate = hingeMid + radius * Math.cos(angle) / section.thickness;
      } else {
        const upper = profileIndex < CONTROL_CHORD_SAMPLES.length;
        const sampleIndex = upper ? profileIndex : skinCount - 1 - profileIndex;
        const surfaceT = CONTROL_CHORD_SAMPLES[sampleIndex];
        chordT = THREE.MathUtils.lerp(hingeFraction, 1, surfaceT);
        const canonical = sectionOrdinate(spec, spanT, chordT, upper);
        const nose = hingeMid + (upper ? radius : -radius) / section.thickness;
        ordinate = THREE.MathUtils.lerp(nose, canonical, THREE.MathUtils.smoothstep(surfaceT, 0, 0.12));
      }
      const localZ = section.chord * chordT;
      const point = new THREE.Vector3(sign * section.unsignedX,
        section.centerY + ordinate * section.thickness + section.washout * localZ,
        section.lead + localZ);
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
  smoothRingSeamNormals(geometry, sectionSize, spanSegments + 1);
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

// Shared, deterministic CPU skin deformation. Public flex joints remain
// inspectable handles; their rigid transforms are compensated in the skin so
// a single C1 bending field drives shell, paint, controls, pipes and markers.
// This also keeps CPU bounds/raycast geometry in sync with the rendered mesh.
function createContinuousWingDeformer(group, spec, assemblies, jointArrays, markers) {
  let entries;
  let controls;
  let lastPose = null;
  const markerRest = markers.map(marker => marker.position.clone());
  const joints = jointArrays.flat();
  const inverseGroup = new THREE.Matrix4();
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 0, 1);
  const bendStart = 0.18;
  const fullSpan = spec.tipX - spec.rootX;
  const bendSpan = fullSpan * (1 - bendStart);

  function bendPoint(position, amount) {
    const sign = position.x < 0 ? -1 : 1;
    const span = Math.abs(position.x) - spec.rootX;
    const v = THREE.MathUtils.clamp((span - fullSpan * bendStart) / bendSpan, 0, 1);
    const amplitude = amount * THREE.MathUtils.degToRad(3);
    const slope = amplitude * (3 * v * v - 2 * v * v * v);
    // Integrals of the smoothstep slope, including second-order shortening.
    const rise = amplitude * bendSpan * (v ** 3 - 0.5 * v ** 4);
    const shortening = 0.5 * amplitude * amplitude * bendSpan
      * (1.8 * v ** 5 - 2 * v ** 6 + (4 / 7) * v ** 7);
    const centerY = spec.yRoot + span * spec.dihedral
      + (spec.dihedralCurve ?? 0) * (span / fullSpan) ** 2;
    const offsetY = position.y - centerY;
    position.x = sign * (Math.abs(position.x) - shortening - offsetY * Math.sin(slope));
    position.y = centerY + rise + offsetY * Math.cos(slope);
    return sign * slope;
  }

  function bind() {
    entries = [];
    controls = [];
    for (const assembly of assemblies) {
      assembly.traverse(object => {
        if (object.isGroup && /continuous section$/.test(object.name)) controls.push(object);
        if ((!object.isMesh && !object.isLine) || !object.geometry?.getAttribute('position')) return;
        // Never mutate a shared primitive used by the opposite wing or gear.
        object.geometry = object.geometry.clone();
        const positions = object.geometry.getAttribute('position');
        const normals = object.geometry.getAttribute('normal');
        positions.setUsage(THREE.DynamicDrawUsage);
        normals?.setUsage(THREE.DynamicDrawUsage);
        entries.push({ object, restPosition: new Float32Array(positions.array),
          restNormal: normals ? new Float32Array(normals.array) : null,
          mountPosition: object.position.clone(), neutral: new THREE.Matrix4(),
          neutralNormal: new THREE.Matrix3(), inverse: new THREE.Matrix4(),
          inverseNormal: new THREE.Matrix3() });
      });
    }
  }

  return function updateWingFlex(amount = 0) {
    if (!entries) bind();
    amount = THREE.MathUtils.clamp(amount, -1, 1);
    const pose = [amount, ...controls.map(control => control.rotation.x),
      ...joints.map(joint => joint.rotation.z)].join(',');
    if (pose === lastPose) return;
    lastPose = pose;
    const jointAngles = joints.map(joint => joint.rotation.z);
    joints.forEach(joint => { joint.rotation.z = 0; });
    entries.forEach(entry => entry.object.position.copy(entry.mountPosition));
    markers.forEach((marker, index) => marker.position.copy(markerRest[index]));
    group.updateMatrixWorld(true);
    inverseGroup.copy(group.matrixWorld).invert();
    for (const entry of entries) {
      entry.neutral.multiplyMatrices(inverseGroup, entry.object.matrixWorld);
      entry.neutralNormal.getNormalMatrix(entry.neutral);
    }
    const markerNeutral = markers.map(marker => marker.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseGroup));
    joints.forEach((joint, index) => { joint.rotation.z = jointAngles[index]; });
    group.updateMatrixWorld(true);

    // Move mesh origins as well as vertices so named lights remain useful
    // attachment points to a consuming game, not stale unbent coordinates.
    for (const entry of entries) {
      point.set(0, 0, 0).applyMatrix4(entry.neutral);
      bendPoint(point, amount);
      point.applyMatrix4(group.matrixWorld);
      entry.object.parent.worldToLocal(point);
      entry.object.position.copy(point);
    }
    markers.forEach((marker, index) => {
      point.copy(markerNeutral[index]);
      bendPoint(point, amount);
      point.applyMatrix4(group.matrixWorld);
      marker.parent.worldToLocal(point);
      marker.position.copy(point);
    });
    group.updateMatrixWorld(true);
    for (const entry of entries) {
      const modelMatrix = new THREE.Matrix4().multiplyMatrices(inverseGroup, entry.object.matrixWorld);
      entry.inverse.copy(modelMatrix).invert();
      entry.inverseNormal.getNormalMatrix(entry.inverse);
      const positions = entry.object.geometry.getAttribute('position');
      const normals = entry.object.geometry.getAttribute('normal');
      for (let i = 0; i < positions.count; i++) {
        point.fromArray(entry.restPosition, i * 3).applyMatrix4(entry.neutral);
        const angle = bendPoint(point, amount);
        point.applyMatrix4(entry.inverse);
        positions.setXYZ(i, point.x, point.y, point.z);
        if (entry.restNormal) {
          normal.fromArray(entry.restNormal, i * 3).applyNormalMatrix(entry.neutralNormal);
          normal.applyAxisAngle(axis, angle).applyNormalMatrix(entry.inverseNormal);
          normals.setXYZ(i, normal.x, normal.y, normal.z);
        }
      }
      positions.needsUpdate = true;
      if (normals) normals.needsUpdate = true;
      entry.object.geometry.computeBoundingBox();
      entry.object.geometry.computeBoundingSphere();
    }
  };
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

// The dorsal leading contour belongs to the fin skin itself. This separate
// closed shell is only the low, rolled attachment to the fuselage crown; its
// top is inside the fin, so no broad cap intersects a razor-thin leading edge.
function dorsalFinFairingGeometry(sourceStations, fuselageStations, mountZ) {
  const stations = [];
  for (let i = 0; i < sourceStations.length - 1; i++) {
    const count = Math.max(1, Math.ceil((sourceStations[i + 1].z - sourceStations[i].z) / 0.035));
    for (let j = 0; j < count; j++) {
      const t = j / count;
      stations.push({
        z: THREE.MathUtils.lerp(sourceStations[i].z, sourceStations[i + 1].z, t),
        rise: smoothStationValue(sourceStations, i, t, 'rise'),
        halfWidth: smoothStationValue(sourceStations, i, t, 'halfWidth'),
        embed: smoothStationValue(sourceStations, i, t, 'embed'),
      });
    }
  }
  stations.push(sourceStations.at(-1));
  const section = Array.from({ length: 48 }, (_, i) => {
    const angle = i / 48 * Math.PI * 2;
    const c = Math.cos(angle);
    return [Math.sin(angle), c >= 0 ? c ** 4 : c * 0.06];
  });
  const positions = [];
  const uvs = [];
  const indices = [];
  const ringSize = section.length;

  for (let stationIndex = 0; stationIndex < stations.length; stationIndex++) {
    const station = stations[stationIndex];
    const fuselage = interpolateLoftStation(fuselageStations, mountZ + station.z);
    const crown = fuselage.y + fuselage.height;
    const bottom = crown - station.embed;
    const top = crown + station.rise;
    const height = top - bottom;
    for (let pointIndex = 0; pointIndex < ringSize; pointIndex++) {
      const [x, y] = section[pointIndex];
      positions.push(x * station.halfWidth, bottom + y * height, station.z);
      uvs.push(stationIndex / (stations.length - 1), pointIndex / ringSize);
    }
  }

  // The section is clockwise when viewed from aft. This winding points the
  // connected side faces outward on both rolled shoulders.
  for (let stationIndex = 0; stationIndex < stations.length - 1; stationIndex++) {
    const row = stationIndex * ringSize;
    const nextRow = row + ringSize;
    for (let pointIndex = 0; pointIndex < ringSize; pointIndex++) {
      const nextPoint = (pointIndex + 1) % ringSize;
      const a = row + pointIndex;
      const b = row + nextPoint;
      const c = nextRow + pointIndex;
      const d = nextRow + nextPoint;
      indices.push(a, c, b, b, c, d);
    }
  }

  // Reuse the perimeter vertices for the end caps so the fairing remains a
  // genuinely closed indexed shell rather than a visually capped open mesh.
  const addCapCenter = stationIndex => {
    const station = stations[stationIndex];
    const fuselage = interpolateLoftStation(fuselageStations, mountZ + station.z);
    const crown = fuselage.y + fuselage.height;
    positions.push(0, crown + (station.rise - station.embed) * 0.5, station.z);
    uvs.push(stationIndex, 0.5);
    return positions.length / 3 - 1;
  };
  const frontCenter = addCapCenter(0);
  const aftCenter = addCapCenter(stations.length - 1);
  const aftRow = (stations.length - 1) * ringSize;
  for (let pointIndex = 0; pointIndex < ringSize; pointIndex++) {
    const nextPoint = (pointIndex + 1) % ringSize;
    indices.push(frontCenter, pointIndex, nextPoint);
    indices.push(aftCenter, aftRow + nextPoint, aftRow + pointIndex);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function verticalAirfoilGeometry(sourceStations, profile = FIXED_AIRFOIL) {
  // Closely sampled, shape-preserving station curves keep the side silhouette
  // and polished highlights smooth without moving the authored landmarks.
  const stations = [];
  for (let i = 0; i < sourceStations.length - 1; i++) {
    const count = Math.max(1, Math.ceil((sourceStations[i + 1].y - sourceStations[i].y) / 0.025));
    for (let j = 0; j < count; j++) {
      const t = j / count;
      stations.push({
        y: THREE.MathUtils.lerp(sourceStations[i].y, sourceStations[i + 1].y, t),
        lead: smoothStationValue(sourceStations, i, t, 'lead', 'y'),
        chord: smoothStationValue(sourceStations, i, t, 'chord', 'y'),
        thickness: smoothStationValue(sourceStations, i, t, 'thickness', 'y'),
      });
    }
  }
  stations.push(sourceStations.at(-1));
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
  // Fan from an interior point rather than the leading-edge vertex. At the
  // narrow crown an edge fan creates needle triangles beside the rounded nose.
  const rootCenter = positions.length / 3;
  positions.push(0, stations[0].y, stations[0].lead + stations[0].chord * 0.38);
  uvs.push(0, 0.5);
  const tipCenter = positions.length / 3;
  positions.push(0, stations.at(-1).y, stations.at(-1).lead + stations.at(-1).chord * 0.38);
  uvs.push(1, 0.5);
  const tip = (stations.length - 1) * row;
  for (let i = 0; i < profileCount; i++) {
    const next = (i + 1) % profileCount;
    indices.push(rootCenter, i, next);
    indices.push(tipCenter, tip + next, tip + i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Both tail sections are symmetric. Share reflected normals as well as
  // positions, including the duplicated leading-edge UV seam.
  if (profile === MUSTANG_VERTICAL_TAIL_AIRFOIL || profile === MUSTANG_RUDDER_PROFILE) {
    const normal = geometry.getAttribute('normal');
    const buckets = new Map();
    for (let i = 0; i < positions.length / 3; i++) {
      const x = positions[i * 3];
      const key = [Math.abs(x), positions[i * 3 + 1], positions[i * 3 + 2]].map(value => value.toFixed(7)).join(':');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(i);
    }
    for (const indices of buckets.values()) {
      const average = new THREE.Vector3();
      for (const i of indices) {
        const x = positions[i * 3];
        average.add(new THREE.Vector3(normal.getX(i) * (x < -1e-8 ? -1 : 1), normal.getY(i), normal.getZ(i)));
      }
      if (Math.abs(positions[indices[0] * 3]) < 1e-8) average.x = 0;
      average.normalize();
      for (const i of indices) normal.setXYZ(i, average.x * (positions[i * 3] < -1e-8 ? -1 : 1), average.y, average.z);
    }
  }
  geometry.computeBoundingSphere();
  return geometry;
}

const MUSTANG_RUDDER_PROFILE = (() => {
  // A continuous rounded nose and taut fabric afterbody. Bias samples toward
  // the rounded nose only: packing samples against the sharp trailing edge
  // makes sub-10-micron slivers where the crown tapers to its 10 mm chord.
  const upper = Array.from({ length: 41 }, (_, i) => {
    const u = i === 40 ? 1 : 1 - Math.cos(i / 40 * Math.PI * 0.5);
    const width = Math.sqrt(u) * (1 - u) * (1 - 0.48 * u);
    return [u, width];
  });
  const maximum = Math.max(...upper.map(([, width]) => width));
  const points = upper.map(([u, width]) => [u, width / maximum * 0.44]);
  return [...points, ...points.slice(1, -1).reverse().map(([u, width]) => [u, -width])];
})();

function verticalControlGeometry(stations) {
  return verticalAirfoilGeometry(stations, MUSTANG_RUDDER_PROFILE);
}

function rudderRibTapeGeometry(stations, height, side) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const steps = 24;
  for (const y of [height - 0.006, height + 0.006]) {
    let stationIndex = 0;
    while (stationIndex < stations.length - 2 && stations[stationIndex + 1].y < y) stationIndex++;
    const a = stations[stationIndex];
    const b = stations[stationIndex + 1];
    const t = THREE.MathUtils.clamp((y - a.y) / (b.y - a.y), 0, 1);
    const chord = smoothStationValue(stations, stationIndex, t, 'chord', 'y');
    const lead = smoothStationValue(stations, stationIndex, t, 'lead', 'y');
    const thickness = smoothStationValue(stations, stationIndex, t, 'thickness', 'y');
    for (let i = 0; i <= steps; i++) {
      const u = THREE.MathUtils.lerp(0.035, 0.965, i / steps);
      const halfWidth = sampleAirfoil(MUSTANG_RUDDER_PROFILE, u, true) * thickness;
      positions.push(side * (halfWidth + 0.0007), y, lead + u * chord);
      uvs.push(i / steps, y < height ? 0 : 1);
    }
  }
  const row = steps + 1;
  for (let i = 0; i < steps; i++) indices.push(i, i + 1, i + row, i + 1, i + row + 1, i + row);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  if (side > 0) reverseWinding(geometry);
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

// Swept pressed-metal ejector with an oval outlet, a 4.5 mm rolled lip and
// recessed inner wall. The inner end is capped so a close camera cannot see
// through the exhaust and the airframe. Dimensions are authored approximations.
function exhaustEjectorGeometry(side, z, y) {
  const centers = [
    [side * 0.440, y, z], [side * 0.485, y, z + 0.010],
    [side * 0.545, y - 0.004, z + 0.045],
    [side * 0.601, y - 0.009, z + 0.101],
    [side * 0.630, y - 0.013, z + 0.155],
  ].map(p => new THREE.Vector3(...p));
  const positions = [], indices = [], uvs = [];
  const ringSize = 24;
  const frameAt = i => {
    const tangent = centers[Math.min(i + 1, centers.length - 1)].clone()
      .sub(centers[Math.max(0, i - 1)]).normalize();
    const vertical = new THREE.Vector3(0, 1, 0).addScaledVector(tangent, -tangent.y).normalize();
    return { tangent, vertical, lateral: tangent.clone().cross(vertical).normalize() };
  };
  const appendRing = (center, frame, height, width) => {
    const base = positions.length / 3;
    for (let j = 0; j < ringSize; j++) {
      const angle = j / ringSize * Math.PI * 2;
      const point = center.clone().addScaledVector(frame.vertical, Math.cos(angle) * height)
        .addScaledVector(frame.lateral, Math.sin(angle) * width);
      positions.push(...point.toArray()); uvs.push(j / ringSize, base / 168);
    }
    return base;
  };
  const frames = centers.map((_, i) => frameAt(i));
  centers.forEach((center, i) => appendRing(center, frames[i], 0.044 - i * 0.003, 0.055 + i * 0.002));
  const connect = (a, b) => {
    for (let j = 0; j < ringSize; j++) {
      const k = (j + 1) % ringSize;
      indices.push(a + j, a + k, b + j, a + k, b + k, b + j);
    }
  };
  for (let i = 0; i < centers.length - 1; i++) connect(i * ringSize, (i + 1) * ringSize);
  const innerLip = appendRing(centers.at(-1), frames.at(-1), 0.0275, 0.0585);
  connect(4 * ringSize, innerLip);
  const exteriorCount = indices.length;
  const innerBackCenter = centers.at(-1).clone().addScaledVector(frames.at(-1).tangent, -0.085);
  const innerBack = appendRing(innerBackCenter, frames.at(-1), 0.026, 0.054);
  connect(innerLip, innerBack);
  const cap = (base, center, reverse) => {
    const c = positions.length / 3; positions.push(...center.toArray()); uvs.push(0.5, 0.5);
    for (let j = 0; j < ringSize; j++) {
      const k = (j + 1) % ringSize;
      indices.push(c, base + (reverse ? k : j), base + (reverse ? j : k));
    }
  };
  cap(innerBack, innerBackCenter, false);
  cap(0, centers[0], true);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.addGroup(0, exteriorCount, 0);
  geometry.addGroup(exteriorCount, indices.length - exteriorCount, 1);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

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
      // Profile travels clockwise when viewed from the blade tip. Match the
      // outward root/tip caps; the former side winding exposed blade interiors.
      indices.push(base + i, base + next, nextBase + i, base + next, nextBase + next, nextBase + i);
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

  // Close both span ends of the formed fairing. The outer skirt sits a few
  // millimetres above the wing skin, so leaving this perimeter uncapped made
  // a thin open slot even though the main wing below was intact. Separate cap
  // vertices retain the skin's rolled normals and a crisp sheet-metal edge.
  for (const end of [0, spanSteps]) {
    const capBase = positions.length / 3;
    for (const offset of [0, lowerOffset]) {
      for (let chord = 0; chord <= chordSteps; chord++) {
        const source = offset + end * row + chord;
        positions.push(...positions.slice(source * 3, source * 3 + 3));
        uvs.push(chord / chordSteps, offset === 0 ? 1 : 0);
      }
    }
    for (let chord = 0; chord < chordSteps; chord++) {
      const a = capBase + chord;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      if (end === 0) indices.push(a, c, b, b, c, d);
      else indices.push(a, b, c, b, d, c);
    }
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

// Published P-51D BL17.5 and BL215 ordinates from the UIUC airfoil data set:
// https://m-selig.web.engr.illinois.edu/ads/coord/p51droot.dat
// https://m-selig.web.engr.illinois.edu/ads/coord/p51dtip.dat
// Columns: x/c, root upper, root lower, tip upper, tip lower. Tiny differences
// in the source root/tip x coordinates (<0.000001c) share the root stations.
const MUSTANG_SECTION_DATA = [
  [0, 0, 0, 0, 0],
  [0.005585, 0.015258, -0.013319, 0.0080857, -0.0072395],
  [0.022214, 0.030339, -0.026406, 0.0171943, -0.0141771],
  [0.049516, 0.044768, -0.036992, 0.0265966, -0.0199017],
  [0.086881, 0.058429, -0.046725, 0.0357669, -0.0253040],
  [0.133474, 0.069751, -0.054740, 0.0443234, -0.0305286],
  [0.188255, 0.079882, -0.061409, 0.0519490, -0.0350210],
  [0.250000, 0.087311, -0.067201, 0.0586048, -0.0385206],
  [0.317330, 0.093243, -0.070078, 0.0639389, -0.0414433],
  [0.388740, 0.094701, -0.070449, 0.0675523, -0.0429331],
  [0.462635, 0.090031, -0.067352, 0.0700939, -0.0440883],
  [0.537365, 0.081477, -0.059454, 0.0689003, -0.0435437],
  [0.611261, 0.071686, -0.047939, 0.0620020, -0.0389807],
  [0.682671, 0.061562, -0.036264, 0.0504744, -0.0301552],
  [0.750000, 0.050766, -0.026548, 0.0370719, -0.0205715],
  [0.811745, 0.038145, -0.018118, 0.0250994, -0.0123279],
  [0.866526, 0.024587, -0.010593, 0.0161636, -0.0063297],
  [0.913119, 0.013701, -0.005384, 0.0094824, -0.0029648],
  [0.950485, 0.006720, -0.002509, 0.0047928, -0.0014429],
  [0.977786, 0.002797, -0.001020, 0.0020193, -0.0006126],
  [1, 0, 0, 0, 0],
];
const MUSTANG_ROOT_THICKNESS_RATIO = 0.165150;
const MUSTANG_TIP_THICKNESS_RATIO = 0.1141822;
function dataSectionProfile(upperColumn, lowerColumn, ratio) {
  return [
    ...MUSTANG_SECTION_DATA.map(row => [row[0], row[upperColumn] / ratio]),
    ...MUSTANG_SECTION_DATA.slice(1, -1).reverse().map(row => [row[0], row[lowerColumn] / ratio]),
  ];
}
function fixedSectionProfile(profile, hingeFraction) {
  const upper = profile.filter(([u, v]) => u < hingeFraction && v >= 0);
  const lower = profile.filter(([u, v]) => u < hingeFraction && v < 0);
  return [...upper,
    [hingeFraction, sampleAirfoil(profile, hingeFraction, true)],
    ...Array.from({ length: 7 }, (_, index) => [hingeFraction, 0, (index + 1) * Math.PI / 8]),
    [hingeFraction, sampleAirfoil(profile, hingeFraction, false)],
    ...lower,
  ];
}
const MUSTANG_AIRFOIL = dataSectionProfile(1, 2, MUSTANG_ROOT_THICKNESS_RATIO);
const MUSTANG_TIP_AIRFOIL = dataSectionProfile(3, 4, MUSTANG_TIP_THICKNESS_RATIO);
const MUSTANG_FIXED_AIRFOIL = fixedSectionProfile(MUSTANG_AIRFOIL, 0.72);
// Explicitly an approximation for the horizontal tail, not invented Mustang
// ordinate data: symmetric closed-TE NACA four-digit thickness distribution.
const HORIZONTAL_TAIL_AIRFOIL = (() => {
  const upper = MUSTANG_SECTION_DATA.map(([x]) => [x,
    5 * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x
      + 0.2843 * x ** 3 - 0.1036 * x ** 4),
  ]);
  const normalization = 2 * Math.max(...upper.map(([, y]) => y));
  return [
    ...upper.map(([x, y]) => [x, y / normalization]),
    ...upper.slice(1, -1).reverse().map(([x, y]) => [x, -y / normalization]),
  ];
})();
const HORIZONTAL_TAIL_FIXED_AIRFOIL = fixedSectionProfile(HORIZONTAL_TAIL_AIRFOIL, 0.70);

// Symmetric section reserved for the vertical tail. Reusing the cambered wing
// ordinates here makes one side of the fin visibly fuller than the other.
const MUSTANG_VERTICAL_TAIL_AIRFOIL = (() => {
  const upper = Array.from({ length: 49 }, (_, i) => {
    const u = (1 - Math.cos(i / 48 * Math.PI)) * 0.5;
    const width = Math.max(0, 0.2969 * Math.sqrt(u) - 0.1260 * u
      - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
    return [u, i === 48 ? 0 : width];
  });
  const maximum = Math.max(...upper.map(([, width]) => width));
  const points = upper.map(([u, width]) => [u, width / maximum]);
  return [...points, ...points.slice(1, -1).reverse().map(([u, width]) => [u, -width])];
})();

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
  const pixels = context.createImageData(512, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 512; x++) {
    const u = x / 511, v = y / 127;
    const center = 0.53 + Math.sin(u * 5.3) * 0.035;
    const feather = Math.exp(-(((v - center) / (0.14 + u * 0.16)) ** 2));
    const taper = Math.sin(Math.PI * u) ** 0.55 * Math.exp(-u * 1.65);
    const grain = 0.88 + 0.12 * Math.sin(x * 1.713 + y * 0.829) * Math.sin(y * 2.177);
    const index = (y * 512 + x) * 4;
    pixels.data[index] = 52; pixels.data[index + 1] = 43; pixels.data[index + 2] = 36;
    pixels.data[index + 3] = Math.round(100 * feather * taper * grain);
  }
  context.putImageData(pixels, 0, 0);
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
    width: smoothStationValue(stations, index, t, 'width'),
    height: smoothStationValue(stations, index, t, 'height'),
    y: smoothStationValue(stations, index, t, 'y'),
    exponent: smoothStationValue(stations, index, t, 'exponent', 'z', 2.15),
  };
}

function fuselagePatchGeometry(stations, sign, zStart, zEnd, angleStart, angleEnd, offset = 0.004, zSteps = 24, arcSteps = 16) {
  zSteps = Math.max(zSteps, Math.ceil((zEnd - zStart) / 0.10));
  arcSteps = Math.max(arcSteps, Math.ceil(Math.abs(angleEnd - angleStart) / 0.045));
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
  const zSteps = Math.max(16, Math.ceil((zEnd - zStart) / 0.10));
  const arcSteps = 28;
  for (let iz = 0; iz <= zSteps; iz++) {
    const z = THREE.MathUtils.lerp(zStart, zEnd, iz / zSteps);
    const station = interpolateLoftStation(stations, z);
    const widthScale = THREE.MathUtils.lerp(0.62, 0.92, THREE.MathUtils.smoothstep(z, zStart, zEnd));
    // Preserve the intended plan-view paint width by changing angular coverage.
    // Scaling X alone pushed the old patch several centimetres into the cowl.
    const edgeX = Math.pow(Math.cos(Math.PI * 0.28), 2 / station.exponent) * widthScale;
    const edgeAngle = Math.acos(Math.pow(edgeX, station.exponent / 2));
    for (let ia = 0; ia <= arcSteps; ia++) {
      const phi = THREE.MathUtils.lerp(edgeAngle, Math.PI - edgeAngle, ia / arcSteps);
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      const shapedX = Math.sign(c) * Math.pow(Math.abs(c), 2 / station.exponent);
      const shapedY = Math.pow(s, 2 / station.exponent);
      positions.push(shapedX * (station.width + offset), station.y + shapedY * (station.height + offset), z);
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

function canopyArcPoint(station, angle) {
  return new THREE.Vector3(
    Math.cos(angle) * station.width,
    station.base + Math.pow(Math.max(0, Math.sin(angle)), 0.92) * station.height,
    station.z,
  );
}

// The windshield's rear edges and canopy bow sample the exact same curve.
// A ruled pane joins a straight forward armor edge to the curved rear seal;
// this is an exterior glazing surface, never an artificial hood end cap.
function windscreenGlazingGeometry(frontA, frontB, rearStation, angleA, angleB) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const arcSteps = 16;
  const depthSteps = 4;
  for (let d = 0; d <= depthSteps; d++) {
    for (let a = 0; a <= arcSteps; a++) {
      const u = a / arcSteps;
      const front = frontA.clone().lerp(frontB, u);
      const rear = canopyArcPoint(rearStation, THREE.MathUtils.lerp(angleA, angleB, u));
      const point = front.lerp(rear, d / depthSteps);
      positions.push(point.x, point.y, point.z);
      uvs.push(u, d / depthSteps);
    }
  }
  const row = arcSteps + 1;
  for (let d = 0; d < depthSteps; d++) {
    for (let a = 0; a < arcSteps; a++) {
      const i = d * row + a;
      indices.push(i, i + row, i + 1, i + 1, i + row, i + row + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function p51BubbleCanopyGeometry() {
  const sourceStations = [
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
  ].map(station => ({ ...station, z: station.z + 0.15 }));
  const stations = [];
  for (let i = 0; i < sourceStations.length - 1; i++) {
    const steps = Math.max(2, Math.ceil((sourceStations[i + 1].z - sourceStations[i].z) / 0.055));
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      const station = { z: THREE.MathUtils.lerp(sourceStations[i].z, sourceStations[i + 1].z, t) };
      for (const key of ['width', 'frameWidth', 'base', 'height']) station[key] = smoothStationValue(sourceStations, i, t, key);
      stations.push(station);
    }
  }
  stations.push(sourceStations.at(-1));
  const arcSegments = 48;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let s = 0; s < stations.length; s++) {
    const station = stations[s];
    for (let i = 0; i <= arcSegments; i++) {
      const angle = Math.PI - i / arcSegments * Math.PI;
      const point = canopyArcPoint(station, angle);
      positions.push(point.x, point.y, point.z);
      uvs.push((station.z - stations[0].z) / (stations.at(-1).z - stations[0].z), i / arcSegments);
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

function canopyFrameBase(station, fuselageStations, depth = 0.14) {
  const nominal = station.base - depth;
  if (!fuselageStations) return nominal;
  const body = interpolateLoftStation(fuselageStations, station.z);
  const x = Math.min(0.999, station.frameWidth / body.width);
  const deckY = body.y + body.height * Math.max(0, 1 - x ** body.exponent) ** (1 / body.exponent);
  const seated = Math.max(nominal, Math.min(station.base - 0.007, deckY - 0.003));
  return THREE.MathUtils.lerp(nominal, seated, THREE.MathUtils.smoothstep(station.z, 0.58, 0.665));
}

function canopyLowerFrameGeometry(stations, sign, depth = 0.14, fuselageStations = null) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i < stations.length; i++) {
    const station = stations[i];
    const bottomY = canopyFrameBase(station, fuselageStations, depth);
    positions.push(sign * station.width, station.base + 0.003, station.z);
    positions.push(sign * station.frameWidth, bottomY, station.z);
    positions.push(sign * (station.frameWidth - 0.006), bottomY, station.z);
    positions.push(sign * Math.max(0.001, station.width - 0.006), station.base + 0.003, station.z);
    uvs.push(i / (stations.length - 1), 1, i / (stations.length - 1), 0,
      i / (stations.length - 1), 0, i / (stations.length - 1), 1);
  }
  for (let i = 0; i < stations.length - 1; i++) {
    const a = i * 4, b = a + 4;
    for (let j = 0; j < 4; j++) {
      const k = (j + 1) % 4;
      indices.push(a + j, a + k, b + j, a + k, b + k, b + j);
    }
  }
  indices.push(0, 2, 1, 0, 3, 2);
  const end = (stations.length - 1) * 4;
  indices.push(end, end + 1, end + 2, end, end + 2, end + 3);
  // The 6 mm return edges must not average their normals with the broad
  // outside/inside faces. Keep smooth longitudinal strips and hard edges.
  const splitPositions = [], splitUvs = [], splitIndices = [];
  const copyVertex = i => {
    splitPositions.push(...positions.slice(i * 3, i * 3 + 3));
    splitUvs.push(...uvs.slice(i * 2, i * 2 + 2));
  };
  for (let edge = 0; edge < 4; edge++) {
    const base = splitPositions.length / 3;
    for (let i = 0; i < stations.length; i++) {
      copyVertex(i * 4 + edge); copyVertex(i * 4 + (edge + 1) % 4);
    }
    for (let i = 0; i < stations.length - 1; i++) {
      const a = base + i * 2;
      splitIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  for (const cap of [[0, 2, 1, 0, 3, 2], [end, end + 1, end + 2, end, end + 2, end + 3]]) {
    for (const i of cap) { splitIndices.push(splitPositions.length / 3); copyVertex(i); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(splitPositions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(splitUvs, 2));
  geometry.setIndex(splitIndices);
  if (sign > 0) reverseWinding(geometry);
  geometry.computeVertexNormals();
  return geometry;
}

// Solid longitudinal sill joining the outer fuselage aperture edge directly
// to the lower edge of the windscreen/bubble. The skirt extends below the
// loft cutout boundary so coarse fuselage rings cannot expose daylight.
function canopySillDeckGeometry(fuselageStations, canopyStations, sign, depth = 0.09, windscreenFoundation = false) {
  const lowerFrameDepth = 0.14;
  const frameOverlap = 0.003;
  const stations = windscreenFoundation ? Array.from({ length: 13 }, (_, i) => {
    const t = i / 12;
    return { z: THREE.MathUtils.lerp(-1.352, canopyStations[0].z + 0.003, t),
      width: THREE.MathUtils.lerp(0.326, canopyStations[0].width - 0.004, t),
      base: THREE.MathUtils.lerp(0.678, canopyStations[0].base + 0.003, t) };
  }) : [
    // Seat the sill underneath the structural lower frame, not at the clear
    // acrylic edge. Keeping the aft frame width prevents a false centre spike.
    ...canopyStations.filter(station => station.z <= 0.75001).map(station => ({
      z: station.z,
      width: Math.max(0.01, station.frameWidth - frameOverlap),
      base: canopyFrameBase(station, fuselageStations, lowerFrameDepth) + frameOverlap,
    })),
  ];
  const positions = [];
  const uvs = [];
  const indices = [];
  const sectionSize = 4;

  for (let stationIndex = 0; stationIndex < stations.length; stationIndex++) {
    const station = stations[stationIndex];
    const fuselage = interpolateLoftStation(fuselageStations, station.z);
    const outerY = 0.480;
    const normalizedY = THREE.MathUtils.clamp(
      Math.abs((outerY - fuselage.y) / fuselage.height),
      0,
      1,
    );
    const outerX = 0.001 + fuselage.width * Math.pow(
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

// Closed, structured shell for the fore/aft coaming. All face grids share an
// exact perimeter; this is a solid part, not an unbacked surface patch.
function canopyDeckShellGeometry(sample, zSteps = 16, xSteps = 32, thickness = 0.07) {
  const positions = [], indices = [], uvs = [];
  const row = xSteps + 1;
  const layer = row * (zSteps + 1);
  for (let side = 0; side < 2; side++) {
    for (let z = 0; z <= zSteps; z++) {
      for (let x = 0; x <= xSteps; x++) {
        const p = sample(x / xSteps, z / zSteps);
        positions.push(p.x, p.y - side * thickness, p.z);
        uvs.push(x / xSteps, z / zSteps);
      }
    }
  }
  for (let z = 0; z < zSteps; z++) for (let x = 0; x < xSteps; x++) {
    const a = z * row + x, b = a + 1, c = a + row, d = c + 1;
    indices.push(a, c, b, b, c, d, a + layer, b + layer, c + layer,
      b + layer, d + layer, c + layer);
  }
  const perimeter = [];
  for (let x = 0; x < xSteps; x++) perimeter.push(x);
  for (let z = 0; z < zSteps; z++) perimeter.push(z * row + xSteps);
  for (let x = xSteps; x > 0; x--) perimeter.push(zSteps * row + x);
  for (let z = zSteps; z > 0; z--) perimeter.push(z * row);
  for (let i = 0; i < perimeter.length; i++) {
    const a = perimeter[i], b = perimeter[(i + 1) % perimeter.length];
    const edge = positions.length / 3;
    for (const source of [a, b, a + layer, b + layer]) {
      positions.push(...positions.slice(source * 3, source * 3 + 3));
      uvs.push(...uvs.slice(source * 2, source * 2 + 2));
    }
    indices.push(edge, edge + 1, edge + 2, edge + 1, edge + 3, edge + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function cockpitBodyCrossSection(stations, z, u) {
  const station = interpolateLoftStation(stations, z);
  const ordinate = THREE.MathUtils.clamp((0.480 - station.y) / station.height, 0, 1);
  const angle = Math.asin(ordinate ** (station.exponent / 2));
  const phi = THREE.MathUtils.lerp(Math.PI - angle, angle, u);
  const c = Math.cos(phi), s = Math.sin(phi);
  return new THREE.Vector3(Math.sign(c) * Math.abs(c) ** (2 / station.exponent) * (station.width + 0.001),
    station.y + s ** (2 / station.exponent) * (station.height + 0.001), z);
}

function canopyForwardDeckGeometry(stations) {
  return canopyDeckShellGeometry((u, v) => {
    const z = THREE.MathUtils.lerp(-1.485, -1.348, v);
    const p = cockpitBodyCrossSection(stations, z, u);
    const outerX = Math.abs(cockpitBodyCrossSection(stations, z, 0).x);
    const footY = THREE.MathUtils.lerp(0.678, 0.480,
      THREE.MathUtils.smoothstep(Math.abs(p.x), 0.334, outerX));
    p.y = THREE.MathUtils.lerp(p.y, footY, THREE.MathUtils.smoothstep(v, 0, 1));
    return p;
  }, 12, 40, 0.10);
}

function canopyAftDeckGeometry(stations) {
  return canopyDeckShellGeometry((u, v) => cockpitBodyCrossSection(stations,
    THREE.MathUtils.lerp(0.665, 1.080, v), u), 16, 40, 0.09);
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
      roughness: 0.48,
      roughnessMap: aluminumMicro,
      bumpMap: aluminumMicro,
      bumpScale: 0.00035,
    }),
    aluminumLight: new THREE.MeshStandardMaterial({
      color: 0xcdd1d5,
      metalness: 0.88,
      roughness: 0.41,
      roughnessMap: aluminumMicro,
    }),
    aluminumDark: new THREE.MeshStandardMaterial({
      color: 0xbec3c7,
      metalness: 0.80,
      roughness: 0.50,
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
      bumpScale: 0.00025,
    }),
    olive: new THREE.MeshStandardMaterial({
      color: 0x343a25,
      metalness: 0.04,
      roughness: 0.84,
      roughnessMap: paintMicro,
      bumpMap: paintMicro,
      bumpScale: 0.0003,
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
      color: 0xdbe8ed,
      metalness: 0,
      roughness: 0.075,
      transmission: 0.72,
      transparent: true,
      opacity: 0.34,
      thickness: 0.004,
      ior: 1.49,
      clearcoat: 0.50,
      clearcoatRoughness: 0.055,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    lens: new THREE.MeshPhysicalMaterial({
      color: 0xf6f1d8,
      transmission: 0.45,
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
  // The wheel wells terminate against the wing carry-through structure.  Keep
  // the monocoque belly continuous; cutting the overlapping inboard wheel
  // circle through this shell made a false see-through hole at the centreline.
  const fuselageShell = addMesh(group, loftGeometry(fuselageStations, 40, {
    zMin: -1.48,
    zMax: 1.07,
    yMin: 0.49,
    capStart: false,
  }), materials.aluminum, [0, 0, 0], 'Semi-monocoque fuselage shell');
  fuselageShell.userData.continuousBellyAboveWheelWells = true;
  fuselageShell.userData.gearBayCutThrough = false;

  // The filled-and-sanded forward wing surface is deliberately more uniform
  // than the panel-varied fuselage; the contrast is a characteristic Mustang cue.
  addMesh(group, fuselageTopPatchGeometry(fuselageStations, -4.02, -1.487), materials.olive, [0, 0, 0], 'Olive-drab anti-glare deck');

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
    for (let i = 0; i < 6; i++) {
      const z = -3.34 + i * 0.255;
      const ejector = addMesh(group, exhaustEjectorGeometry(sign, z, 0.269 - i * 0.002),
        [materials.exhaust, materials.cockpitBlack], [0, 0, 0],
        `${sign < 0 ? 'Port' : 'Starboard'} swept oval exhaust ejector ${i + 1}`);
      ejector.userData.closedShell = true;
      ejector.userData.recessedOutletDepthMetres = 0.085;
    }
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

  const intakeOutline = (width, height, y, z, exponent = 4, segments = 64) =>
    Array.from({ length: segments }, (_, i) => {
      const a = -Math.PI / 2 + i / segments * Math.PI * 2;
      return new THREE.Vector3(Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** (2 / exponent) * width,
        y + Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** (2 / exponent) * height, z);
    });
  const frontOuter = intakeOutline(0.350, 0.453, 0.074, -4.11, 3.35);
  const chinLipPoints = intakeOutline(0.270, 0.075, -0.245, -4.116, 3.8);
  const noseShape = new THREE.Shape(frontOuter.map(point => new THREE.Vector2(point.x, point.y)));
  noseShape.holes.push(new THREE.Path(chinLipPoints.slice().reverse()
    .map(point => new THREE.Vector2(point.x, point.y))));
  const noseRing = new THREE.ShapeGeometry(noseShape, 64);
  noseRing.rotateY(Math.PI);
  addMesh(group, noseRing, materials.aluminum, [0, 0, -4.11], 'Formed front cowling around carburetor smile intake');
  closedTube(group, chinLipPoints, 0.0055, materials.aluminumHardware, 80, 6, 'Thin continuous carburetor-intake lip');
  const ductMaterial = materials.darkSteel.clone(); ductMaterial.side = THREE.BackSide;
  addMesh(group, loftGeometry([
    { z: -4.113, width: 0.270, height: 0.075, y: -0.245, exponent: 3.8 },
    { z: -3.98, width: 0.263, height: 0.083, y: -0.230, exponent: 3.8 },
    { z: -3.73, width: 0.245, height: 0.090, y: -0.200, exponent: 3.8 },
  ], 64, { capStart: false, capEnd: false }), ductMaterial, [0, 0, 0], 'Recessed carburetor induction duct');
  const chinBack = addMesh(group, new THREE.PlaneGeometry(0.51, 0.19), materials.cockpitBlack,
    [0, -0.20, -3.729], 'Carburetor duct recessed shadow back');
  chinBack.rotation.y = Math.PI;
  // The oil cooler is in the belly installation. The cowl sides carry small
  // induction grilles; there is no second invented oval above the smile.
  for (const side of [-1, 1]) {
    for (let slot = 0; slot < 5; slot++) {
      const z = -3.87 + slot * 0.049;
      const station = interpolateLoftStation(fuselageStations, z);
      const y = -0.11;
      const fraction = Math.abs((y - station.y) / station.height);
      const x = station.width * Math.pow(1 - fraction ** station.exponent, 1 / station.exponent);
      const grille = addMesh(group, new THREE.PlaneGeometry(0.020, 0.067), materials.cockpitBlack,
        [side * (x + 0.002), y, z], `${side < 0 ? 'Port' : 'Starboard'} induction grille slot ${slot + 1}`);
      grille.rotation.y = side * Math.PI / 2;
    }
  }

  // Cockpit details are intentionally omitted until an evidence-backed
  // interior is authored. One continuous, low, non-specular liner creates a
  // convincing recessed void without presenting invented controls or seats.
  const canopyData = p51BubbleCanopyGeometry();
  const cockpitVoidMaterial = new THREE.MeshStandardMaterial({
    color: 0x090c0e,
    metalness: 0,
    roughness: 0.96,
    side: THREE.DoubleSide,
  });
  const cockpitVoid = addMesh(group, cockpitVoidGeometry([
    { z: -1.350, width: 0.328, top: 0.677, bottom: 0.200 },
    { z: -0.904, width: 0.338, top: 0.553, bottom: 0.200 },
    ...canopyData.stations.filter(station => station.z <= 0.75001).map(station => ({
      z: station.z, width: station.frameWidth - 0.004,
      top: canopyFrameBase(station, fuselageStations) + 0.006, bottom: 0.190,
    })),
    { z: 0.800, width: 0.330, top: 0.530, bottom: 0.240 },
  ]), cockpitVoidMaterial, [0, 0, 0], 'Continuous matte-charcoal recessed cockpit cavity and rear closeout');
  cockpitVoid.userData.neutralInterior = true;
  cockpitVoid.userData.canopyClosureRole = 'cavity';

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
  const firstStation = canopyData.stations[0];
  const windscreen = new THREE.Group();
  windscreen.name = 'Fixed framed windscreen';
  const frontLowerL = new THREE.Vector3(-0.33, 0.675, -1.35);
  const frontLowerR = new THREE.Vector3(0.33, 0.675, -1.35);
  const frontUpperL = new THREE.Vector3(-0.20, 1.06, -0.97);
  const frontUpperR = new THREE.Vector3(0.20, 1.06, -0.97);
  const armorGlass = materials.glass.clone();
  armorGlass.name = '38.1 mm laminated armor glass';
  armorGlass.thickness = 0.0381;
  armorGlass.color.set(0xb9d3cc);
  armorGlass.transmission = 0.78;
  addMesh(windscreen, quadGeometry([frontLowerR, frontLowerL, frontUpperL, frontUpperR]), armorGlass, [0, 0, 0], '38.1 mm windscreen armor-glass center pane');
  const crownAngle = Math.PI / 3;
  const rearUpperL = canopyArcPoint(firstStation, Math.PI - crownAngle);
  const rearUpperR = canopyArcPoint(firstStation, crownAngle);
  addMesh(windscreen, windscreenGlazingGeometry(frontLowerL, frontUpperL, firstStation, Math.PI, Math.PI - crownAngle), materials.glass, [0, 0, 0], 'Port windscreen quarter pane');
  addMesh(windscreen, windscreenGlazingGeometry(frontUpperR, frontLowerR, firstStation, crownAngle, 0), materials.glass, [0, 0, 0], 'Starboard windscreen quarter pane');
  addMesh(windscreen, windscreenGlazingGeometry(frontUpperL, frontUpperR, firstStation, Math.PI - crownAngle, crownAngle), materials.glass, [0, 0, 0], 'Curved windscreen crown glazing to shared canopy bow');
  windscreen.userData.sharedCanopyInterface = {
    revision: 2,
    localZ: firstStation.z,
    contour: 'canopyArcPoint',
    maximumJoinGapMetres: 0,
  };
  for (const [a, b, name] of [
    [frontLowerL, frontLowerR, 'Windscreen lower crossmember'],
    [frontLowerL, frontUpperL, 'Port windscreen post'],
    [frontLowerR, frontUpperR, 'Starboard windscreen post'],
    [frontUpperL, frontUpperR, 'Windscreen crown frame'],
    [frontUpperL, rearUpperL, 'Port windshield upper glazing seam'],
    [frontUpperR, rearUpperR, 'Starboard windshield upper glazing seam'],
  ]) cylinderBetween(windscreen, a, b, 0.019, materials.darkSteel, 10, name);
  group.add(windscreen);

  const canopy = new THREE.Group();
  canopy.name = 'Sliding teardrop bubble canopy';
  const canopyGlass = addMesh(canopy, canopyData.geometry, materials.glass, [0, 0, 0], 'Single-piece clear acrylic bubble glazing');
  canopyGlass.renderOrder = 2;
  canopy.userData.sharedWindscreenInterface = windscreen.userData.sharedCanopyInterface;
  for (const station of [firstStation]) {
    const hoop = [];
    for (let i = 0; i <= 12; i++) {
      const angle = Math.PI - i / 12 * Math.PI;
      hoop.push(canopyArcPoint(station, angle));
    }
    tube(canopy, hoop, 0.020, materials.aluminumDark, 30, 8, '40 mm front canopy bow and windshield seal');
  }
  for (const sign of [-1, 1]) {
    const lowerFrame = addMesh(
      canopy,
      canopyLowerFrameGeometry(canopyData.stations, sign, 0.14, fuselageStations),
      materials.aluminumDark,
      [0, 0, 0],
      `${sign < 0 ? 'Port' : 'Starboard'} 140 mm deep lower sliding-frame panel`,
    );
    lowerFrame.userData.canopyClosureRole = 'lower-frame';
    lowerFrame.userData.closedShell = true;
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
    sill.userData.canopyClosureRole = 'sill';
    sill.userData.closedShell = true;
    const foundation = addMesh(canopyBodyConnection,
      canopySillDeckGeometry(fuselageStations, canopyData.stations, sign, 0.16, true),
      materials.aluminum, [0, 0, 0],
      `${sign < 0 ? 'Port' : 'Starboard'} solid windscreen-foot side foundation`);
    foundation.userData.canopyClosureRole = 'windscreen-foundation';
    foundation.userData.closedShell = true;
  }
  const forwardCoaming = addMesh(canopyBodyConnection, canopyForwardDeckGeometry(fuselageStations),
    materials.olive, [0, 0, 0], 'Embedded windscreen-foot forward coaming bridge');
  forwardCoaming.userData.bodyConnection = true;
  forwardCoaming.userData.canopyClosureRole = 'forward-coaming';
  forwardCoaming.userData.closedShell = true;
  // The rear closeout is a conformal continuation of the fuselage crown. A
  // thick trapezoidal prism here reads as a detached arrowhead in three-quarter
  // view, whereas this offset skin patch follows the actual loft shoulder.
  const aftDeck = addMesh(
    canopyBodyConnection,
    canopyAftDeckGeometry(fuselageStations),
    materials.aluminum,
    [0, 0, 0],
    'Integrated conformal aft-canopy deck closeout',
  );
  aftDeck.userData.bodyConnection = true;
  aftDeck.userData.canopyClosureRole = 'aft-deck';
  aftDeck.userData.closedShell = true;
  group.add(canopyBodyConnection);

  // The fin owns the dorsal extension, with one continuous visible airfoil.
  // This low fairing rolls that skin into the fuselage instead of ending a
  // separate tall wedge at the fin's narrow leading edge.
  const dorsalFilletMount = new THREE.Group();
  dorsalFilletMount.position.z = 3.00;
  dorsalFilletMount.rotation.y = THREE.MathUtils.degToRad(-1.0);
  dorsalFilletMount.name = 'Common-axis production dorsal-fillet mount';
  const dorsalFilletStations = [
    { z: -1.08, rise: 0.002, halfWidth: 0.030, embed: 0.038 },
    { z: -0.94, rise: 0.018, halfWidth: 0.055, embed: 0.042 },
    { z: -0.76, rise: 0.044, halfWidth: 0.080, embed: 0.046 },
    { z: -0.55, rise: 0.061, halfWidth: 0.096, embed: 0.050 },
    { z: -0.33, rise: 0.072, halfWidth: 0.105, embed: 0.054 },
    { z: -0.12, rise: 0.078, halfWidth: 0.108, embed: 0.057 },
    { z: 0.07, rise: 0.080, halfWidth: 0.101, embed: 0.060 },
    { z: 0.23, rise: 0.077, halfWidth: 0.088, embed: 0.062 },
    { z: 0.37, rise: 0.071, halfWidth: 0.068, embed: 0.064 },
    { z: 0.49, rise: 0.063, halfWidth: 0.039, embed: 0.065 },
    { z: 0.56, rise: 0.050, halfWidth: 0.021, embed: 0.065 },
  ];
  const dorsalFillet = addMesh(
    dorsalFilletMount,
    dorsalFinFairingGeometry(dorsalFilletStations, fuselageStations, dorsalFilletMount.position.z),
    materials.aluminum,
    [0, 0, 0],
    'Closed conformal structural dorsal fin fillet merged into fin leading edge',
  );
  dorsalFillet.userData.tailConnection = true;
  dorsalFillet.userData.commonOffsetAxis = true;
  dorsalFillet.userData.closedShell = true;
  dorsalFillet.userData.fuselageCrownEmbedMetres = [0.038, 0.065];
  dorsalFillet.userData.finOverlapLocalZ = [0.49, 0.56];
  dorsalFillet.userData.integratedLeadingContourOnFin = true;
  group.add(dorsalFilletMount);

  // Meredith-effect radiator scoop with boundary-layer gap, divided core and
  // movable outlet door; this is a second major silhouette, not a belly pod.
  const scoopStations = [
    { z: -0.76, width: 0.32, height: 0.095, y: -0.795, exponent: 4.60 },
    { z: -0.50, width: 0.37, height: 0.180, y: -0.748, exponent: 4.00 },
    { z: -0.10, width: 0.41, height: 0.275, y: -0.680, exponent: 3.50 },
    { z: 0.34, width: 0.41, height: 0.280, y: -0.647, exponent: 3.30 },
    { z: 0.80, width: 0.36, height: 0.245, y: -0.576, exponent: 3.10 },
    { z: 1.26, width: 0.29, height: 0.155, y: -0.528, exponent: 3.30 },
    { z: 1.59, width: 0.235, height: 0.085, y: -0.507, exponent: 4.20 },
  ];
  addMesh(group, loftGeometry(scoopStations, 32, { capStart: false, capEnd: false }), materials.aluminum, [0, 0, 0], 'Open-throat ventral radiator scoop and blended duct');
  const scoopLipPoints = intakeOutline(0.32, 0.095, -0.795, -0.761, 4.60);
  closedTube(group, scoopLipPoints, 0.006, materials.aluminumHardware, 80, 6, 'Thin rolled flattened radiator intake lip');
  addMesh(group, loftGeometry([
    { z: -0.759, width: 0.313, height: 0.089, y: -0.795, exponent: 4.6 },
    { z: -0.52, width: 0.337, height: 0.107, y: -0.786, exponent: 4.0 },
    { z: -0.27, width: 0.335, height: 0.130, y: -0.770, exponent: 3.8 },
  ], 48, { capStart: false, capEnd: false }), ductMaterial, [0, 0, 0], 'Deep radiator intake inner walls');
  const radiatorCore = addMesh(group, new THREE.PlaneGeometry(0.675, 0.265), materials.cockpitBlack, [0, -0.77, -0.265], 'Divided recessed radiator core');
  radiatorCore.rotation.y = Math.PI;
  cylinderBetween(group, new THREE.Vector3(0, -0.896, -0.275), new THREE.Vector3(0, -0.644, -0.275), 0.009, materials.darkSteel, 6, 'Radiator core center divider');
  for (let fin = -8; fin <= 8; fin++) cylinderBetween(group,
    new THREE.Vector3(fin * 0.038, -0.887, -0.277), new THREE.Vector3(fin * 0.038, -0.653, -0.277),
    0.0018, materials.aluminumDark, 4, 'Recessed radiator core fin');
  addMesh(group, new THREE.BoxGeometry(0.48, 0.025, 0.30), materials.cockpitBlack,
    [0, -0.676, -0.58], 'Recessed upper boundary-layer passage');
  const radiatorExit = addMesh(group, new THREE.PlaneGeometry(0.44, 0.14), materials.cockpitBlack, [0, -0.507, 1.56], 'Radiator exit aperture');
  const radiatorDoor = new THREE.Group();
  radiatorDoor.name = 'Radiator outlet door';
  radiatorDoor.position.set(0, -0.659, 1.27);
  const radiatorDoorMesh = addMesh(radiatorDoor, new THREE.BoxGeometry(0.45, 0.012, 0.36), materials.aluminumHardware, [0, 0.033, 0.17], 'Controllable radiator exit flap');
  radiatorDoorMesh.rotation.x = -0.19;
  group.add(radiatorDoor);

  // The wing uses the documented NAA planform: 5° dihedral, mild leading-edge
  // sweep, 2.08:1 chord taper and broad clipped-round tips. The fixed skin
  // ends at a real rear spar so controls do not overlap it.
  const wingSpec = {
    rootX: 0.47,
    tipX: 5.639,
    rootLead: -2.066,
    tipLead: -1.741,
    rootChord: 2.642,
    tipChord: 1.270,
    rootThicknessRatio: MUSTANG_ROOT_THICKNESS_RATIO,
    tipThicknessRatio: MUSTANG_TIP_THICKNESS_RATIO,
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
    tipSurfaceProfile: MUSTANG_TIP_AIRFOIL,
    hingeFraction: 0.72,
    hingeGapMetres: 0.004,
    gearBays: true,
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
      segments.push({ spanStart, spanEnd, joint, content, pivot });
    }
    wingSegments[sign] = segments;
    wingFlexJoints[sign] = segments.slice(1).map(segment => segment.joint);
    wingAssemblies[sign].userData.flexVersion = aircraftCapabilities.features.wingFlex.version;
    wingAssemblies[sign].userData.flexImplementation = aircraftCapabilities.features.wingFlex.implementation;
    wingParents[sign] = segments[0].content;

    // A single continuous skin, not independently shaded rigid wing bays.
    addMesh(segments[0].content, wingGeometry(wingSpec, sign, 96),
      materials.wingLacquer, [0, 0, 0], `${sideName} continuous laminar-flow wing skin`);
    addMesh(group, wingRootFairingGeometry(wingSpec, sign), materials.wingLacquer, [0, 0, 0], `${sideName} compound wing-root fillet`);
  }

  const segmentAt = (sign, spanT) => wingSegments[sign].find(segment => (
    spanT >= segment.spanStart - 1e-6 && spanT <= segment.spanEnd + 1e-6
  )) ?? wingSegments[sign][wingSegments[sign].length - 1];

  function addSplitControl(sign, spanStart, spanEnd, hingeFraction, material, label, controller) {
    const segment = segmentAt(sign, (spanStart + spanEnd) * 0.5);
    const pieces = [makeWingSurface(segment.content, wingSpec, sign,
      spanStart, spanEnd, hingeFraction, material, `${label} continuous section`)];
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

    // A 7 mm physical end clearance replaces the old 67 mm daylight slot.
    addSplitControl(sign, 0.015, 0.5428, 0.72, materials.aluminum, `${sideName} full inboard flap`, flapController);
    addSplitControl(sign, 0.5442, 0.925, 0.72, materials.aluminumDark, `${sideName} sealed metal aileron`, aileronController);
    const fixedTrailingTip = makeWingSurface(
      segmentAt(sign, 0.965).content,
      wingSpec,
      sign,
      0.925,
      1.0,
      0.72,
      materials.wingLacquer,
      `${sideName} fixed broad trailing wingtip closure`,
      { capStart: true, capEnd: true, fixedStructure: true },
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

  const updateWingFlex = createContinuousWingDeformer(group, wingSpec,
    [wingAssemblies[-1], wingAssemblies[1]],
    [wingFlexJoints[-1], wingFlexJoints[1]], [tipObjects[-1], tipObjects[1]]);

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
    rootThicknessRatio: 0.10,
    tipThicknessRatio: 0.09,
    yRoot: 0.40,
    dihedral: 0,
    dihedralCurve: 0,
    incidence: THREE.MathUtils.degToRad(0.5),
    washout: 0,
    planformCurve: -0.006,
    tipRoundStart: 0.86,
    tipRound: 0.25,
    tipChordMinimum: 0.43,
    profile: HORIZONTAL_TAIL_FIXED_AIRFOIL,
    surfaceProfile: HORIZONTAL_TAIL_AIRFOIL,
    hingeFraction: 0.70,
    hingeGapMetres: 0.003,
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
    { y: 0.38, lead: -1.09, chord: 2.29, thickness: 0.066 },
    { y: 0.62, lead: -1.09, chord: 2.29, thickness: 0.065 },
    { y: 0.64, lead: -1.07, chord: 2.27, thickness: 0.065 },
    { y: 0.675, lead: -0.92, chord: 2.12, thickness: 0.064 },
    { y: 0.72, lead: -0.68, chord: 1.88, thickness: 0.062 },
    { y: 0.80, lead: -0.38, chord: 1.58, thickness: 0.059 },
    { y: 0.90, lead: -0.13, chord: 1.33, thickness: 0.054 },
    { y: 1.02, lead: 0.10, chord: 1.10, thickness: 0.047 },
    { y: 1.15, lead: 0.33, chord: 0.87, thickness: 0.040 },
    { y: 1.30, lead: 0.55, chord: 0.65, thickness: 0.033 },
    { y: 1.48, lead: 0.69, chord: 0.51, thickness: 0.027 },
    { y: 1.60, lead: 0.77, chord: 0.43, thickness: 0.023 },
    { y: 1.68, lead: 0.82, chord: 0.38, thickness: 0.021 },
    { y: 1.82, lead: 0.87, chord: 0.33, thickness: 0.018 },
    { y: 1.90, lead: 0.92, chord: 0.28, thickness: 0.014 },
    { y: 1.925, lead: 0.94, chord: 0.26, thickness: 0.010 },
    { y: 1.948, lead: 0.96, chord: 0.24, thickness: 0.005 },
  ];
  // Fin station chords terminate at local z=1.20, the rudder hinge. The wing's
  // 72%-chord fixed-surface profile is intentionally not used here: doing so
  // removes up to 0.412 m of fin and exposes the broken daylight wedge.
  const verticalFin = addMesh(finAssembly, verticalAirfoilGeometry(finStations, MUSTANG_VERTICAL_TAIL_AIRFOIL), materials.aluminum, [0, 0, 0], 'Full-chord airfoil vertical stabilizer to rudder hinge');
  verticalFin.userData.tailConnection = true;
  verticalFin.userData.trailingEdgeChordFraction = 1.0;
  verticalFin.userData.rudderHingeLocalZ = 1.20;
  verticalFin.userData.integratedDorsalLeadingContour = true;
  verticalFin.userData.maximumHalfThicknessMetres = 0.066;
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
  addMesh(rudder, new THREE.BoxGeometry(0.008, 0.27, 0.10), materials.aluminumDark, [0, 0.82, 0.52], 'Rudder trim tab');
  for (const y of [0.66, 0.96, 1.26, 1.55, 1.79]) {
    for (const sign of [-1, 1]) {
      addMesh(rudder, rudderRibTapeGeometry(rudderStations, y, sign), materials.rudderFabric, [0, 0, 0], 'Conformal 12 mm rudder rib tape');
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
  const gearPivotX = MAIN_GEAR.pivotX;
  const innerDoors = {};
  const wheelWells = {};
  const wellVisuals = [];
  const gearBayQueries = {};
  const mainGearActuators = {};
  const wellInteriorMaterial = materials.well.clone();
  wellInteriorMaterial.name = 'Opaque zinc-chromate wheel-well interior';
  wellInteriorMaterial.side = THREE.DoubleSide;
  const navLights = { [-1]: null, [1]: null };
  // Recover named nav-light meshes from the flexed hierarchy.
  for (const sign of [-1, 1]) {
    wingAssemblies[sign].traverse(object => {
      if (object.name === `${sign < 0 ? 'Left' : 'Right'} inset navigation light`) navLights[sign] = object;
    });
  }

  for (const side of [-1, 1]) {
    const sideName = side < 0 ? 'Left' : 'Right';
    const skinY = (x, z, surface) => {
      const spanT = THREE.MathUtils.clamp((Math.abs(x) - wingSpec.rootX) / (wingSpec.tipX - wingSpec.rootX), 0, 1);
      const section = wingSection(wingSpec, spanT);
      return wingSurfacePosition(wingSpec, side, spanT,
        (z - section.lead) / section.chord, surface).y;
    };
    const lowerSkinY = (x, z) => skinY(x, z, 'lower');
    const upperSkinY = (x, z) => skinY(x, z, 'upper');
    const roofY = (x, z) => upperSkinY(x, z) - 0.018;
    const wellCenter = new THREE.Vector3(side * MAIN_GEAR.wheelBayX,
      roofY(MAIN_GEAR.wheelBayX, MAIN_GEAR.wheelBayZ), MAIN_GEAR.wheelBayZ);
    const wellReference = new THREE.Object3D();
    wellReference.position.copy(wellCenter);
    wellReference.name = `${sideName} wheel-well centre reference`;
    group.add(wellReference);
    wheelWells[side] = wellReference;
    const outline = GEAR_BAY_TUB_OUTLINE.map(([x, z]) => new THREE.Vector3(side * x, 0, z));
    gearBayQueries[side] = () => ({
      apertures: GEAR_BAY_OPENINGS.map(loop => loop.map(([x, z]) => [side * x, z])),
      tubOutline: outline.map(p => [p.x, p.z]), roofY, lowerSkinY, upperSkinY,
      wheelCenter: [side * MAIN_GEAR.wheelBayX, -0.2099925087, MAIN_GEAR.wheelBayZ],
      roofReference: wellCenter.toArray(),
      planform: x => {
        const section = wingSection(wingSpec, (Math.abs(x) - wingSpec.rootX) / (wingSpec.tipX - wingSpec.rootX));
        return { lead: section.lead, trail: section.lead + section.chord };
      },
    });

    // One opaque roof closes the complete connected aperture.  A double-sided
    // interior is intentional here: the well must never turn into a background
    // coloured hole at grazing underside/rear camera angles.
    const roofGeometry = gearConformalPanelGeometry(outline.map(p => [p.x, p.z]), roofY, 0.006);
    const roof = addMesh(group, roofGeometry, [wellInteriorMaterial, wellInteriorMaterial, wellInteriorMaterial], [0, 0, 0], `${sideName} opaque connected wheel-and-strut bay roof`);
    roof.userData.enclosedBayTub = true;
    roof.userData.backgroundLeakProof = true;
    roof.userData.gearBayRole = 'roof';

    // Return walls follow a slightly oversize rounded union perimeter hidden
    // behind the lower skin and extend through it by a few millimetres.  This
    // overlap removes hairline leaks without a thick tube floating below it.
    const wallPositions = [], wallIndices = [];
    const wallOutline = outline.flatMap((p, i) => {
      const q = outline[(i + 1) % outline.length];
      const steps = Math.max(1, Math.ceil(p.distanceTo(q) / 0.035));
      return Array.from({ length: steps }, (_, step) => p.clone().lerp(q, step / steps));
    });
    wallOutline.forEach((p, i) => {
      const skinY = lowerSkinY(Math.abs(p.x), p.z) - 0.005;
      wallPositions.push(p.x, skinY, p.z, p.x, roofY(p.x, p.z) - 0.003, p.z);
      const next = (i + 1) % wallOutline.length;
      wallIndices.push(i * 2, next * 2, i * 2 + 1, next * 2, next * 2 + 1, i * 2 + 1);
    });
    const wallGeometry = new THREE.BufferGeometry();
    wallGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wallPositions, 3));
    wallGeometry.setIndex(wallIndices); wallGeometry.computeVertexNormals();
    const walls = addMesh(group, wallGeometry, wellInteriorMaterial, [0, 0, 0], `${sideName} sealed wheel-well return walls`);
    walls.userData.enclosedBayTub = true;
    walls.userData.skinOverlapMetres = 0.005;
    walls.userData.gearBayRole = 'wall';
    wellVisuals.push(roof, walls);

    // Shallow, attached pressed ribs give the roof scale without reintroducing
    // full circular outlines that read as loose wire rings from below.
    for (const [x0, z0, x1, z1] of [
      [0.62, -1.18, 1.06, -1.18],
      [0.52, -1.38, 1.20, -1.38],
      [0.61, -1.57, 1.09, -1.57],
      [1.22, -1.42, 1.94, -1.64],
    ]) {
      const rib = tube(group, Array.from({ length: 9 }, (_, i) => {
        const x = side * THREE.MathUtils.lerp(x0, x1, i / 8);
        const z = THREE.MathUtils.lerp(z0, z1, i / 8);
        return new THREE.Vector3(x, roofY(x, z) - 0.014, z);
      }), 0.005, materials.aluminumDark, 16, 6, `${sideName} attached pressed bay-roof rib`);
      rib.userData.enclosedBayTub = true;
      rib.userData.gearBayRole = 'rib';
      wellVisuals.push(rib);
    }

    const innerDoor = new THREE.Group();
    const doorHingeZ = MAIN_GEAR.wheelBayZ;
    const doorClosedY = lowerSkinY(0.472, doorHingeZ) - 0.003;
    innerDoor.position.set(side * 0.472, doorClosedY, doorHingeZ);
    innerDoor.name = `${sideName} inner landing-gear door`;
    const doorOutline = Array.from({ length: 32 }, (_, i) => {
      const angle = i / 32 * Math.PI * 2;
      return [side * (MAIN_GEAR.wheelBayX + Math.cos(angle) * 0.385),
        MAIN_GEAR.wheelBayZ + Math.sin(angle) * 0.380];
    });
    const doorGeometry = gearConformalPanelGeometry(doorOutline, (x, z) => lowerSkinY(x, z) - 0.003);
    doorGeometry.translate(-innerDoor.position.x, -innerDoor.position.y, -innerDoor.position.z);
    const doorMesh = addMesh(innerDoor, doorGeometry,
      [wellInteriorMaterial, materials.aluminumHardware, materials.aluminumHardware],
      [0, 0, 0], `${sideName} overlapping formed wheel-pocket door skin`);
    doorMesh.userData.pressedStiffening = true;
    doorMesh.userData.gearBayRole = 'door';
    doorMesh.userData.closedSealOverlapMetres = 0.015;
    doorMesh.userData.sealsWheelPocket = true;
    innerDoor.userData.skinMesh = doorMesh;
    innerDoor.userData.closedY = doorClosedY;
    innerDoor.userData.hingeAxis = 'local-z';
    for (const z of [-1.20, -1.39, -1.56]) tube(innerDoor,
      Array.from({ length: 7 }, (_, i) => {
        const x = side * THREE.MathUtils.lerp(0.65, 1.05, i / 6);
        return new THREE.Vector3(x, lowerSkinY(x, z) + 0.007, z).sub(innerDoor.position);
      }), 0.006, materials.aluminumDark, 12, 6, `${sideName} inner-door pressed stiffening channel`);
    group.add(innerDoor);
    innerDoors[side] = innerDoor;
  }

  function buildMainGear(side) {
    const sideName = side < 0 ? 'Left' : 'Right';
    const gear = new THREE.Group();
    gear.position.set(side * gearPivotX, MAIN_GEAR.pivotY, MAIN_GEAR.pivotZ);
    // The trunnion has a small fore/aft component. A compound ZXY transform
    // preserves the deployed axle station while laying the tyre inside the
    // full-depth laminar wing pocket, behind the leading-edge spar. This is a
    // documented rig approximation, not a hidden translation of the aircraft.
    gear.rotation.order = 'ZXY';
    gear.userData.preFoldDeg = MAIN_GEAR.preFoldDeg;
    gear.userData.stowEulerOrder = 'ZXY';
    gear.userData.downY = MAIN_GEAR.pivotY;
    gear.userData.referenceRegistered = true;
    gear.userData.pivotInvariant = true;
    gear.name = `${sideName} inward-retracting main landing gear`;
    const barrelEnd = new THREE.Vector3(-side * 0.060, -0.76, -0.145);
    const pistonEnd = new THREE.Vector3(-side * 0.087, -0.955, -0.200);
    const axle = new THREE.Vector3(-side * MAIN_GEAR.axleX, MAIN_GEAR.axleY, MAIN_GEAR.axleZ);
    const barrelNeck = new THREE.Vector3(-side * 0.014, -0.18, -0.034);
    cylinderBetween(gear, new THREE.Vector3(0, 0, 0), barrelNeck, 0.044, materials.darkSteel, 16, `${sideName} upper oleo trunnion neck`);
    cylinderBetween(gear, barrelNeck, barrelEnd, 0.074, materials.aluminumDark, 16, `${sideName} Bendix main oleo outer barrel`);
    cylinderBetween(gear, barrelEnd, pistonEnd, 0.048, materials.steel, 16, `${sideName} 0.20-metre visible polished oleo piston`);
    cylinderBetween(gear, pistonEnd, axle, 0.066, materials.aluminumDark, 14, `${sideName} compact cast lower spindle housing`);
    // Bearing housing is fixed to the wing structure. Parenting the complete
    // bearing to the moving leg turned it vertically through the closed door.
    const trunnion = cylinderBetween(group,
      gear.position.clone().add(new THREE.Vector3(-0.14, 0, 0)),
      gear.position.clone().add(new THREE.Vector3(0.14, 0, 0)),
      0.039, materials.darkSteel, 16, `${sideName} fixed airframe upper trunnion bearing`);
    trunnion.userData.mainGearMechanism = true;
    trunnion.userData.airframeAnchored = true;
    cylinderBetween(gear, axle.clone().add(new THREE.Vector3(-0.125, 0, 0)), axle.clone().add(new THREE.Vector3(0.125, 0, 0)), 0.035, materials.darkSteel, 14, `${sideName} one-piece main-wheel spindle`);

    const actuatorLug = new THREE.Vector3(-side * 0.030, -0.47, -0.050);
    const actuatorPin = addMesh(gear, new THREE.SphereGeometry(0.043, 12, 8), materials.aluminumDark, actuatorLug.toArray(), `${sideName} retraction-actuator strut lug`);
    actuatorPin.scale.x = 0.72;

    const torqueKnee = new THREE.Vector3(-side * 0.105, -0.835, -0.170);
    cylinderBetween(gear, new THREE.Vector3(-side * 0.070, -0.765, -0.148), torqueKnee, 0.019, materials.darkSteel, 8, `${sideName} upper compact torque link`);
    cylinderBetween(gear, torqueKnee, new THREE.Vector3(-side * 0.092, -0.945, -0.195), 0.019, materials.darkSteel, 8, `${sideName} lower compact torque link`);
    tube(gear, [
      new THREE.Vector3(-side * 0.035, -0.15, 0.07),
      new THREE.Vector3(-side * 0.045, -0.57, -0.09),
      new THREE.Vector3(-side * 0.075, -0.86, -0.17),
      new THREE.Vector3(-side * 0.096, -1.04, -0.215),
    ], 0.007, materials.rubber, 24, 5, `${sideName} brake hose`);

    const bay = gearBayQueries[side]();
    const strutDoorOutline = [
      [1.12, -1.61], [1.94, -1.81], [2.05, -1.817],
      [2.05, -1.493], [1.18, -1.265], [1.13, -1.30],
    ].map(([x, z]) => [side * x, z]);
    const strutDoorGeometry = gearConformalPanelGeometry(strutDoorOutline,
      (x, z) => bay.lowerSkinY(x, z) - 0.003, 0.006);
    const stowedTransform = new THREE.Matrix4().compose(gear.position,
      new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(MAIN_GEAR.preFoldDeg), 0,
        -side * THREE.MathUtils.degToRad(MAIN_GEAR.foldDeg), 'ZXY')),
      new THREE.Vector3(1, 1, 1));
    strutDoorGeometry.applyMatrix4(stowedTransform.invert());
    const outerDoor = addMesh(gear, strutDoorGeometry,
      [wellInteriorMaterial, materials.aluminumHardware, materials.aluminumHardware],
      [0, 0, 0], `${sideName} narrow bracket-mounted main strut door`);
    outerDoor.rotation.z = 0;
    outerDoor.userData.side = side;
    outerDoor.userData.gearBayRole = 'door';
    outerDoor.userData.downRotationZ = outerDoor.rotation.z;
    outerDoor.userData.strutSurfaceGapMetres = [0.018, 0.070];
    outerDoor.userData.stowCorrectionDeg = 0;
    outerDoor.userData.rigidToStrut = true;
    outerDoor.userData.closedSealOverlapMetres = 0.015;
    outerDoor.userData.sealsStrutChannel = true;
    for (const [y, z, strutX, doorInnerX] of [
      [-0.31, -0.060, -side * 0.020, side * 0.066],
      [-0.72, -0.140, -side * 0.052, side * 0.068],
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
    const actuator = new THREE.Group();
    actuator.name = `${sideName} articulated main-gear retraction actuator`;
    const barrel = addMesh(actuator, new THREE.CylinderGeometry(0.042, 0.042, 1, 14), materials.darkSteel, [0, 0, 0], `${sideName} actuator body`);
    const piston = addMesh(actuator, new THREE.CylinderGeometry(0.024, 0.024, 1, 12), materials.steel, [0, 0, 0], `${sideName} moving actuator piston`);
    group.add(actuator);
    const bodyAnchor = new THREE.Vector3(side * 1.65, -0.055, -1.54);
    actuator.userData.bodyAnchor = bodyAnchor.toArray();
    actuator.userData.gearLugLocal = actuatorLug.toArray();
    actuator.userData.airframeAnchored = true;
    mainGearActuators[side] = { actuator, barrel, piston, gear, bodyAnchor, actuatorLug };
    return { gear, wheelSpin, outerDoor, actuator };
  }

  const leftGear = buildMainGear(-1);
  const rightGear = buildMainGear(1);
  const updateMainGearActuators = () => {
    const alignCylinder = (mesh, start, end) => {
      const delta = end.clone().sub(start);
      mesh.position.copy(start).add(end).multiplyScalar(0.5);
      mesh.scale.set(1, delta.length(), 1);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    };
    for (const entry of Object.values(mainGearActuators)) {
      entry.gear.updateMatrix();
      const lug = entry.actuatorLug.clone().applyMatrix4(entry.gear.matrix);
      const bodyEnd = entry.bodyAnchor.clone().lerp(lug, 0.62);
      const pistonStart = entry.bodyAnchor.clone().lerp(lug, 0.52);
      alignCylinder(entry.barrel, entry.bodyAnchor, bodyEnd);
      alignCylinder(entry.piston, pistonStart, lug);
      entry.actuator.userData.currentLengthMetres = entry.bodyAnchor.distanceTo(lug);
      entry.actuator.userData.bodyEnd = bodyEnd.toArray();
      entry.actuator.userData.lugEnd = lug.toArray();
    }
  };
  updateMainGearActuators();

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
    updateWingFlex,
    geometryQueries: {
      wingSpec,
      wingSection: spanT => wingSection(wingSpec, spanT),
      wingPoint: (side, spanT, chordT, surface = 'upper') => wingSurfacePosition(wingSpec, side, spanT, chordT, surface),
      wingFrame: (side, spanT, chordT, surface = 'upper', offset = 0) => wingFrameAt(wingSpec, side, spanT, chordT, surface, offset),
      gearBay: side => gearBayQueries[side < 0 ? -1 : 1](),
      tailSection: spanT => wingSection(tailSpec, spanT),
      tailPoint: (side, spanT, chordT, surface = 'upper') => wingSurfacePosition(tailSpec, side, spanT, chordT, surface),
    },
    tipL: tipObjects[-1],
    tipR: tipObjects[1],
    gearL: leftGear.gear,
    gearR: rightGear.gear,
    wheelL: leftGear.wheelSpin,
    wheelR: rightGear.wheelSpin,
    outerDoorL: leftGear.outerDoor,
    outerDoorR: rightGear.outerDoor,
    actuatorL: leftGear.actuator,
    actuatorR: rightGear.actuator,
    updateMainGearActuators,
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
  // v3 flex evaluates control transforms first, then bends all wing vertices,
  // normals, markings and fittings through one continuous spanwise field.
  plane.updateWingFlex?.(wingFlex);

  const gearTransit = THREE.MathUtils.clamp(physics.gearTransit ?? 1, 0, 1);
  const fold = (1 - gearTransit) * THREE.MathUtils.degToRad(aircraftCapabilities.features.landingGear.mainFoldDeg);
  plane.gearL.rotation.z = fold;
  plane.gearR.rotation.z = -fold;
  for (const gear of [plane.gearL, plane.gearR]) {
    gear.rotation.x = (1 - gearTransit) * THREE.MathUtils.degToRad(gear.userData.preFoldDeg ?? 0);
  }
  plane.updateMainGearActuators?.();
  for (const door of [plane.outerDoorL, plane.outerDoorR]) {
    if (!door) continue;
    door.rotation.z = (door.userData.downRotationZ ?? 0)
      - (door.userData.side ?? 0) * (1 - gearTransit)
      * THREE.MathUtils.degToRad(door.userData.stowCorrectionDeg ?? 7.5);
  }
  plane.gearL.visible = true;
  plane.gearR.visible = true;
  if (plane.wellVisuals) plane.wellVisuals.forEach(object => { object.visible = true; });
  plane.innerDoorL.rotation.z = gearTransit * THREE.MathUtils.degToRad(68);
  plane.innerDoorR.rotation.z = -gearTransit * THREE.MathUtils.degToRad(68);
  for (const door of [plane.innerDoorL, plane.innerDoorR]) {
    const skin = door?.userData?.skinMesh;
    if (skin?.userData.downMaterial && skin?.userData.closedMaterial) {
      skin.material = gearTransit > 0.4 ? skin.userData.downMaterial : skin.userData.closedMaterial;
    }
  }
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
