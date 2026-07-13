# DYNAMIC TERRAIN — handoff brief for the ultracode session

**Mission**: kill the static single-mesh terrain and replace it with a dynamic, chunked,
LOD-streamed terrain system. Do not change how the island LOOKS or how the game PLAYS —
change how the ground gets onto the GPU.

**Why**: today the whole 15.6 km island is ONE `PlaneGeometry(15600, 15600, 500, 500)` —
251,001 vertices / 500k triangles at a fixed ~31 m density. That is too coarse up close
(low passes look blocky), wasteful at distance (fog hides everything past 6.5 km anyway),
frozen at startup (~340k–800k synchronous `heightAt` calls before the first frame), and a
hard ceiling on world size and detail.

---

## 1. The one insight that shapes the whole design

**`heightAt(x, z)` is a pure, deterministic, allocation-free analytic function — and it
must STAY the single source of truth.** Verified: the entire chain
`heightAt → baseHeight → biomeWeights/hillsH/desertH/forestH/mtnH → canyonLocate/carveCanyon
→ carveTribs → applyPlatforms → applyCorridors → applyRunwayFlattening` uses only `Math.*`,
`noise2/fbm` (sin-hash value noise, fully deterministic), plain objects, and module-scratch
scalars. **Zero THREE usage in the height path.** THREE appears only in mesh building.

Consequences:
- **Physics/camera/HUD never depend on tiles.** They keep calling analytic
  `heightAt`/`surfaceAt` directly (7 evaluations/frame today — see §4). Collision can never
  pop, lag, or wait on streaming. This decouples gameplay from rendering completely.
- **Tiles are just caches of heightAt.** Any tile at any LOD bakes by sampling the same
  function. Determinism guarantees seams agree analytically.
- **The height math can move to a Web Worker almost verbatim** (see §5 extraction recipe).

## 2. Current implementation — verified facts

Files: `src/world.js` (716 lines), `src/runways.js` (233), `src/water.js` (83),
`src/noise.js` (33, pure). Exports that are LOAD-BEARING CONTRACTS:

- `world.js`: `heightAt(x,z)`, `surfaceAt(x,z)` → **REUSED** `{h, type:'runway'|'water'|'grass'}`
  (callers copy, never retain), `createWorld(scene)` → `{update(planePos, time)}`.
- `runways.js`: `RUNWAYS` (6 strips: Coast/Desert/Forest/Canyon/Summit/Hills with
  `{name,x,z,heading,length,width,elev,m,pad}` + cached `_c/_s/_r2`), `onRunway`,
  `runwayInfluence`, `applyRunwayFlattening`, `createRunways`, anchors
  `HILLS_C/DESERT_C/FOREST_C/MTN_A/MTN_B/PEAK`, `CANYON_PATH` (11 waypoints).
  **Circular import**: runways.js imports `heightAt` from world.js — legal only because it's
  called post-evaluation inside `createRunways`, and `heightAt` is a hoisted function
  declaration. Preserve this property or restructure carefully.

Terrain construction today (all synchronous, inside `createWorld`):
- Height bake: 251,001 heightAt calls, then `computeVertexNormals()`.
- Vertex-color loop: 251,001 iterations re-running `biomeWeights`, `canyonLocate`,
  `tribLocate`×2, `runwayInfluence`, noise jitters. ~25 THREE.Color constants; rules for
  biome blend, steep-face rock (`1 − normal.y` based!), desert strata bands, dune crests,
  forest outcrops, scree aprons, canyon bench strata, beach/wet sand, underwater tint,
  snowline 420±38, runway dirt aprons. **Colors are the art direction — port them faithfully.**
- Material: `MeshStandardMaterial({vertexColors: true, flatShading: true, roughness: 1})`.
- Vegetation: 6 InstancedMeshes (pines ≤1600, deciduous trunks+leaves ≤1100, cacti 2×225,
  rocks ≤900), rejection-sampled with deterministic `noise2` sequences, keep-outs via
  `runwayInfluence > 0.02`, canyon/tributary proximity, `nearCorridor`. Each attempt costs
  1–5 heightAt (slopeAt = 4-call central difference).
- World scale: island r≈7000 (R_MASK 7200, beach r 6600–7400, seabed −20 by r 8700).
  Peak ~650 m. Fog `(0xbcd8ee, 1500, 6500)`. camera.far 12000. Sky dome r 8500.
  Shadow: one directional, 2048², ±160 m ortho box following the plane.

Perf baseline to beat/hold: ~87–105 draw calls, ~640k tris total scene, 0.5–1.5 ms/frame
stepped on this machine, page loads ~1–2 s. No hitches (nothing dynamic exists yet).

## 3. Proposed architecture (recommendation — final call belongs to the implementing session)

**Quadtree/ring-LOD tiles centered on the plane, baked in a Web Worker from heightAt.**

- **Tile grid**: world-aligned square tiles. Suggested: LOD0 tile 480 m @ 96×96 quads (5 m
  triangles near the plane — 6× today's density); each LOD ring doubles tile size with the
  same quad count (480/960/1920/3840 m). Stream radius ≥ fog.far 6500 → roughly ~30–60 live
  tiles. Budget: comparable or fewer tris than today's 500k, but concentrated where the
  camera is.
- **Cracks**: use **skirts** (drop tile edges down ~2–4 m) rather than index stitching —
  radically simpler, invisible with flat shading + fog. Revisit only if visibly wrong.
- **Normals/flat shading**: today's look comes from `flatShading: true` (face normals from
  triangle geometry) — tiles inherit the look automatically; no normal seam work needed.
  The color loop's `steep` term uses smooth vertex normals — in the worker, compute that
  from an analytic central-difference gradient of heightAt instead (seam-consistent).
- **Worker bake**: worker owns the pure height+color math; main thread sends
  `{tileX, tileZ, size, res}`; worker returns transferable Float32Arrays (positions,
  colors) + veg placement lists. Main thread builds BufferGeometry (indices/skirts can be
  precomputed per res), one Mesh per tile, disposes on evict. Budget ~1–2 tile builds
  applied per frame; build ahead in the flight direction; hysteresis so tile boundaries
  don't thrash.
- **Vegetation per tile**: scatter deterministically KEYED BY TILE COORDS (noise2 of tile
  ids — placement identical every time a tile rebuilds; NO Math.random). Per-tile
  InstancedMesh per species (or pooled). Only spawn vegetation on LOD0/LOD1 tiles; fade or
  drop beyond — the fog hides it (today trees exist island-wide but are invisible past 6.5 km).
- **Keep static**: water sheet + shoreDepth bake (90,601 heightAt, one-time — fine),
  minimap bake (19,600), runway meshes/windsocks/hangar, sky/sun/clouds, far ocean plane.
  These are not the problem. (Optionally move their bakes into the worker later to cut
  startup, but that's stretch scope.)
- **A/B flag**: keep the static path selectable via URL param (e.g. `?terrain=static`)
  until parity is proven, then delete it. The parity test is pixel-level screenshots at
  fixed poses (see §7) plus identical heightAt values by construction.

## 4. Consumers of the height functions (verified — none of these may break)

| Consumer | What | When | Volume |
|---|---|---|---|
| physics.js | `surfaceAt` ×2 per `update()` (AGL + contact) | per frame ×2 substeps | 4/frame |
| hud.js | `phys.altitude` getter → surfaceAt | per frame | 2/frame |
| camera.js | `heightAt` ground clamp | per frame | 1/frame |
| water.js | shoreDepth bake | startup | 90,601 |
| hud.js | minimap bake | startup | 19,600 |
| world.js | terrain mesh + colors + vegetation | startup | ~250k–700k |
| runways.js | windsock/hangar grounding | startup | 7 |
| main.js | passes `surfaceAt`→FlightModel, `heightAt`→ChaseCam; T-spawn via RUNWAYS | wiring | — |

Per-frame analytic total is only ~7 calls — cheap. The startup bakes are what the dynamic
system replaces/spreads out.

## 5. The Web Worker gotcha (do not learn this the hard way)

**Import maps do NOT apply inside Web Workers.** `import * as THREE from 'three'` in a
worker throws (bare specifier). And both world.js and runways.js import THREE at top level,
so neither can be worker-loaded as-is.

**Extraction recipe (verified line ranges)**: create a dependency-free `src/heightcore.js`:
- from runways.js: everything above `createRunways` — anchors, `CANYON_PATH`, `RUNWAYS`
  + `_c/_s/_r2` init, `stripWeight`, `onRunway`, `runwayInfluence`, `applyRunwayFlattening`
  (≈ lines 13–88);
- from world.js: everything above `createWorld` — `R_MASK` through `surfaceAt`
  (≈ lines 20–359): ridge/canyon/trib distance fields, platforms, corridors, biome fields,
  `baseHeight`, `heightAt`, `surfaceAt`;
- plus `noise.js` (already pure — import it unchanged).
world.js and runways.js then re-export from heightcore for backwards compatibility (keep
the public contract identical), and the worker imports heightcore + noise via **relative**
paths (module workers resolve relative imports fine — only bare specifiers fail).
Also port the color rules into a pure `colorAt`-style function usable by the worker
(colors as plain `[r,g,b]` numbers, not THREE.Color).
**Verify byte-identical heights** after extraction: sample a few thousand (x,z) in-browser
against the old build (git worktree or A/B flag) before building anything on top.
Note: the module-scratch pattern (`_cd/_cs/_wH/...`) is non-reentrant but safe in a
single-threaded worker; do not share one module instance across threads.

## 6. Hard constraints — things that must survive unchanged

1. **Public contracts**: `heightAt`, `surfaceAt` (reused-object semantics), `createWorld`
   → `{update(planePos, time)}`, all runways.js exports, `window.__ff` debug hook
   (main.js:90–107 — `step(dt)`/`render()` + exposed objects) — the entire test harness
   drives the game through it.
2. **Strip guarantees**: every strip exactly flat at `elev` inside its rect (flattening is
   part of heightAt — tiles inherit it automatically ✓), approach corridors capped, six
   T-spawns grounded at `elev + 1.55`.
3. **The look**: flat-shaded vertex-color low-poly, same palette, same biome/canyon/strata
   color rules, fog 1500–6500 (fog is ALSO the streaming budget — keep them coupled).
4. **Gameplay**: physics untouched. All regression numbers in §7.
5. **Perf**: ≥60 fps equivalent (≤ ~4 ms/frame stepped headless), no frame hitch > ~5 ms
   from tile building (that's what the worker is for), stable memory over a 10-minute
   circumnavigation (dispose evicted geometries — `geometry.dispose()`, and InstancedMesh
   cleanup for per-tile vegetation).

## 7. Verification harness (use it — it's all built)

- Server: `fly.bat` or `.claude/flighfeel-server.ps1` (parent dir) → http://localhost:5601,
  `Cache-Control: no-store`. **POST `/shot?name=x`** with base64 JPEG body saves to
  `%LOCALAPPDATA%\Temp\flighfeel-shots\x.jpg` — the screenshot pipeline for visual QA
  (render → downscale to canvas → toDataURL → fetch POST; then Read the .jpg).
- The Browser-pane tab is usually HIDDEN → rAF paused. Drive everything manually:
  `__ff.step(1/60)` in loops + `__ff.render()`. Never wait for animation.
- Standard regression battery (all previously green): six T-spawn cycles grounded at
  elev+1.55 on surface 'runway'; rotation takeoff (~28 m/s); managed-approach landing —
  **WARNING: naive open-loop scripted approaches crash 60–90% in EVERY version — they are
  bad pilots, not regressions (hard-won lesson). Use throttle-managed glide + gentle flare,
  or compare A/B against the static build at identical gust phase.** Crash matrix
  (belly/hard/fast/wingtip/water/'the wings tore off'); canyon cross-sections (rim-to-rim
  630–740 m, flat 72 m floor ±150 m lateral along the strip); perf probe (60 stepped+rendered
  frames, report ms/frame + renderer.info draws/tris); console error sweep after every load.
- NEW tests to add for dynamic terrain: fly a full island circumnavigation at 90 m/s
  crossing all biomes — assert zero frames > 5 ms, memory plateau, no visible cracks in
  screenshots (canyon rim + mesa edges are the crack-prone shots); teleport stress (rapid
  T-cycling through all six strips — tiles must catch up without physics ever noticing);
  vegetation determinism (leave and return to a tile → identical instance matrices).

## 8. Known pitfalls from this project's history (session-tested)

- `surfaceAt` returns a REUSED object — never retain it across calls.
- Circular import world↔runways: `heightAt` must remain a hoisted function declaration.
- No Node.js on this machine — all verification happens in the browser via `__ff`.
- NEVER use `transmission` in materials (three's transmission pass breaks the ocean's
  onBeforeCompile shader — whole sea renders black; bitten twice).
- `Math.random()` never at runtime/placement — deterministic `noise2` only.
- Keep heightAt allocation-free and fast: physics calls it every frame; the worker will
  call it millions of times over a session.
- The gust/wind system makes flight stochastic — A/B any flight-behavior comparison at
  matched phases (`phys.time` drives gusts), or compare distributions, not single runs.
- Windows/PowerShell 5.1 environment; git repo root is the PARENT folder
  (`claude local`), commit style `vX.Y: description`, LF→CRLF warnings are noise.
- Current HEAD at time of writing: `09c3c6b` (v4.4). 14 commits, v1 baseline → v4.4.

## 9. Suggested phasing for the ultracode run

1. **heightcore extraction** (small, surgical): pure module + re-exports + worker-load
   smoke test + byte-identical height verification. Commit before proceeding.
2. **Tile engine behind `?terrain=dynamic`**: tile manager (ring LOD, load/evict,
   hysteresis), worker bake (positions+colors+skirts), per-tile Mesh lifecycle. Static
   path untouched. Verify: visual parity screenshots, perf, hitch budget.
3. **Vegetation per tile** (deterministic per-tile scatter, pooled InstancedMeshes),
   remove global scatter from the dynamic path.
4. **Flip the default + delete the static path**, move water/minimap bakes to the worker
   if startup time still matters, full regression + biome screenshot tour + README/memory.

Each phase = one commit minimum, regression battery green before the next.

## 10. Open decisions for the implementing session (pick, don't ask)

- Exact tile size / quads / ring counts (start from §3 suggestion, tune by perf probe).
- Skirt depth, evict hysteresis distance, builds-per-frame budget.
- Whether LOD0 density should exceed 5 m near the plane (looks great low, costs tris).
- Whether to keep the 500² static mesh as a permanent far-shell under the tiles instead
  of far LOD rings (legitimate shortcut: static coarse shell + dynamic near-field detail
  tiles on top — avoids most LOD machinery; consider seriously as Phase-2-lite).
- Per-tile vegetation pooling strategy (per-tile meshes vs global pools with slot ranges).
