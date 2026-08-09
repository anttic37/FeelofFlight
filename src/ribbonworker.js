// Shore ribbon: a strip of terrain re-tessellated ALONG the coastline instead of across the
// LOD grid, so the waterline is a mesh edge rather than wherever a square lattice happens to
// cross zero. RELATIVE imports only, nothing may touch 'three' — worker rules.
//
// THE CONTOUR IS FOLLOWED, NOT MARCHED. Marching squares over a grid fine enough to beat the
// 5 m LOD0 tiles means 4096 squared, which is 14.6 seconds of heightAt. Following it instead
// costs one step per 4 m of coast: take the gradient, step along its perpendicular, then
// Newton back onto zero — p -= g * h/|g|^2, which is exact for a locally linear field and
// converges in two or three goes on a real one. Roughly 40 km of coastline at 4 m a step is
// ten thousand steps and about fifty thousand samples: fifty milliseconds, not fifteen seconds.
//
// Seeds come from a coarse scan, one per connected piece, so islets and inland lakes get their
// own loops rather than being missed because the search started somewhere else.
import { heightAt, setTerrainSeed } from './heightcore.js';

const STEP = 4;          // along-contour spacing
// 6000 steps is 24 km, and a main island coastline is comfortably longer than that — so the
// loop hit the cap before it could ever reach its own start, was never marked closed, and the
// scan then re-seeded on the parts of it that had not been claimed yet. It traced 1246 km of
// coast on a 40 km island that way. This is the length of coastline a loop is ALLOWED to be,
// and it wants to be generous; the global budget below is what actually stops a runaway.
const MAX_STEPS = 24000;
const MAX_POINTS = 90000;   // 360 km of contour across every loop, then stop regardless
const GRAD_H = 2.0;      // finite-difference arm for the gradient

// ribbon cross-section: fractions of WIDTH inland from the waterline. Denser near the water
// because that is where the ground bends most and where the eye is.
//
// FIVE ROWS WAS COARSER THAN THE LAYER IT OVERDRAWS. [0, 0.12, 0.3, 0.58, 1.0] at WIDTH 46 is
// 5.5 / 8.3 / 12.9 / 19.3 m between rows, and ring0 resolves that same ground at 480/96 =
// 5.00 m (terrain.js RINGS). Because this strip wins every depth tie against the tiles, inside
// its own footprint the picture is not max(ribbon, tile) — it is always the ribbon, so a chord
// error here is unconditional, not a tie-break. The term that shows is the sand berm at
// heightcore.js:1306: alone among the shore layers it is NOT scaled by mSh (which is only ~0.11
// at the waterline, so every other detail layer is nearly absent on a beach), and it adds
// 1.9-3.3 m over h in [0.7, 2.2] — roughly 32 to 40 m inland here, squarely inside the old
// 26.7-46 m outer band. A 19.3 m chord across it sits over a metre low.
//
// 13 rows, no fractional step above 0.11, so the widest band is 5.06 m at WIDTH 46 and no band
// is ever coarser than the tile beneath it. Costs one more pass of heightAt in the worker
// (off-thread, once) and about 130k vertices instead of 50k.
const ROWS = [0, 0.04, 0.09, 0.15, 0.22, 0.30, 0.39, 0.48, 0.58, 0.68, 0.79, 0.89, 1.0];
const WIDTH = 46;        // covers LOD2's 40 m facets; beyond that nothing is resolvable
// The seaward edge sits UNDER the water surface rather than exactly on it. On the waterline it
// would z-fight the sea and stipple; a little below, the sea covers it and the visible edge
// becomes the contour itself, which is the entire point of building this.
//
// IT IS A DISTANCE SEAWARD, NOT A DROP IN Y — see the row loop. Sinking row 0 in y was a lie
// about the surface at a fixed lateral position, and a vertical lie moves the rendered y = 0
// crossing INLAND by OUTER_SINK * d1 / (h1 + OUTER_SINK), where d1 is the first band's width.
// With the band width proportional to the fold cap, that put the drawn waterline 0.3 to 4.2 m
// (locally 13.8 m) inland of the contour, in plateaus that step as the cap steps — i.e. the
// one quantity this mesh exists to fix was being set by the fold cap.
const OUTER_SINK = 0.35;

function grad(x, z, out) {
  const hx = heightAt(x + GRAD_H, z) - heightAt(x - GRAD_H, z);
  const hz = heightAt(x, z + GRAD_H) - heightAt(x, z - GRAD_H);
  out[0] = hx / (2 * GRAD_H);
  out[1] = hz / (2 * GRAD_H);
}

// Pull a point onto h = 0 along the gradient.
//
// THE CORRECTION HAS TO BE CLAMPED, and that is not belt-and-braces — it is the difference
// between this working and not. Newton's step is g * h/|g|^2, and a beach is a 2% slope: at
// h = 0.5 m and |g| = 0.02 the step is 25 metres. One of those throws the point clean off the
// coast, the next iteration starts from wherever it landed, and the follower wanders inland
// tracing nothing. Unclamped it produced 4.2 million vertices — 3400 km of "coastline" on a
// 40 km island — and sat 11 m off the contour on average. Six metres a go converges just as
// fast where the ground is steep and merely takes a few more where it is flat.
const MAX_CORR = 6;
// THE TOLERANCE IS METRES OF CONTOUR POSITION, NOT METRES OF HEIGHT. It used to test
// |h| < 0.02 at the TOP of the loop and return before correcting anything, which reads as
// tight and is not: what this mesh exists to get right is the LATERAL position of the
// waterline, and lateral error is |h| / |grad h|. On this beach |grad h| runs 0.02-0.08, so
// 0.02 m of height is 0.25 to 1.0 m of position — the project's own "measure the axis the eye
// actually sees" trap, in the one file whose entire justification is that axis.
//
// It is a BIAS, not noise. The trace is forward Euler on the contour field, so after a 4 m
// tangent step the height error is only |grad h| * STEP^2/(2R) — 0.0016 m at R = 100 m, three
// orders under the old tolerance, so no correction ran at all for several steps in a row. The
// lateral drift it hides accumulates at STEP^2/(2R) = 0.08-0.27 m a step and always to the
// OUTSIDE of the bend, so the polyline walks out to the full band over 4-12 steps and is then
// snapped back by one exact Newton step: a sawtooth of amplitude = the tolerance and period
// 16-100 m, against a STEP whose own chord sagitta is 4^2/(8*30) = 0.07 m.
//
// h^2 < TOL^2 * |g|^2 is the same test written in position. Cost is one gradient (4 heightAt)
// on the steps that used to return early plus roughly one more Newton step; the field has no
// wavelength under ~33 m near the waterline, so GRAD_H = 2 m arms see it as locally linear and
// Newton still lands in one unclamped step.
const TOL = 0.05;        // METRES OF CONTOUR POSITION
function snap(p) {
  const g = [0, 0];
  for (let i = 0; i < 12; i++) {
    const h = heightAt(p[0], p[1]);
    grad(p[0], p[1], g);
    const m2 = g[0] * g[0] + g[1] * g[1];
    if (m2 < 1e-8) return false;               // flat: no direction to correct along
    if (h * h < TOL * TOL * m2) return true;   // |h| / |g| < TOL: on the contour, laterally
    let dx = g[0] * h / m2, dz = g[1] * h / m2;
    const d = Math.hypot(dx, dz);
    if (d > MAX_CORR) { dx = dx / d * MAX_CORR; dz = dz / d * MAX_CORR; }
    p[0] -= dx; p[1] -= dz;
  }
  return Math.abs(heightAt(p[0], p[1])) < 0.35;
}

// CLOSURE IS THE WRONG TERMINATION CONDITION. Waiting for the trace to come back within a
// step of where it started assumes a tidy loop, and this coastline is not tidy — warped,
// fjorded and re-entrant, so a trace runs for fourteen kilometres, wanders into an inlet and
// never passes its own start. Every loop then ran to a failure instead of a finish, the scan
// re-seeded on coast it had already covered, and the same shoreline came back thirty-three
// times. What the ribbon actually needs is not loops: it is COVERAGE WITHOUT DUPLICATION. So
// a trace stops when it walks into ground a previous trace has already claimed, which is
// exactly the condition that makes the total work bounded by the length of the coast.
function followContour(sx, sz, visited, cellSize, gridN, half, id) {
  const pts = [];
  const p = [sx, sz];
  if (!snap(p)) return pts;
  const start = [p[0], p[1]];
  const g = [0, 0];
  // A SINGLE BAD SAMPLE MUST NOT END THE LOOP. Ending it on the first failed correction looks
  // careful and is the reason one coastline came back as forty-six separate loops of eleven
  // km each: the trace dies on the first flat patch it meets — a lagoon shelf, a runway
  // apron, anywhere the gradient goes quiet — the scan then re-seeds further along the SAME
  // coast, walks another eleven km, dies again. Carry the last good tangent across the dead
  // patch and only give up if it stays lost.
  let fails = 0, ltx = 0, ltz = 0;
  for (let i = 0; i < MAX_STEPS; i++) {
    grad(p[0], p[1], g);
    const m = Math.hypot(g[0], g[1]);
    let tx, tz;
    if (m < 1e-5) {
      if (ltx === 0 && ltz === 0) break;
      tx = ltx; tz = ltz;                       // coast straight on through the flat
    } else {
      tx = -g[1] / m; tz = g[0] / m;            // perpendicular: land stays on one side
      ltx = tx; ltz = tz;
    }
    p[0] += tx * STEP;
    p[1] += tz * STEP;
    // Keep only points that are actually ON the contour. Pushing the failures too kept the
    // strip continuous but dragged its outer edge nearly two metres off the waterline on
    // average, which is the one thing this mesh exists to get right. Skipping them costs
    // nothing: the strip is built from consecutive points, so a gap just makes one slightly
    // longer quad across the dead patch.
    if (snap(p)) { fails = 0; pts.push(p[0], p[1]); }
    else if (++fails > 20) break;
    // Claim the 3x3 of coarse cells around each step, not just the one it landed in. A 4 m
    // step through 64 m cells leaves corners of its own corridor unmarked, and the scan then
    // seeds again inside a loop it has already walked — which is the other half of why one
    // coastline came out thirty times over.
    const cx = Math.floor((p[0] + half) / cellSize), cz = Math.floor((p[1] + half) / cellSize);
    if (cx < 0 || cz < 0 || cx >= gridN || cz >= gridN) break;      // off the field
    const here = visited[cz * gridN + cx];
    if (i > 24 && here !== 0 && here !== id) break;                 // someone else's coast
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const ux = cx + a, uz = cz + b;
        if (ux >= 0 && uz >= 0 && ux < gridN && uz < gridN) {
          const c = uz * gridN + ux;
          if (visited[c] === 0) visited[c] = id;
        }
      }
    }
    if (i > 8 && Math.hypot(p[0] - start[0], p[1] - start[1]) < STEP * 1.2) break; // closed
  }
  return pts;
}

self.onmessage = (e) => {
  if (e.data.type === 'seed') { setTerrainSeed(e.data.seed); return; }
  const { size } = e.data;
  const half = size * 0.5;
  // coarse scan for seeds: a cell whose corners straddle zero has coast in it
  const N = 256, cell = size / N;
  const H = new Float32Array((N + 1) * (N + 1));
  for (let iz = 0; iz <= N; iz++) {
    for (let ix = 0; ix <= N; ix++) {
      H[iz * (N + 1) + ix] = heightAt(-half + ix * cell, -half + iz * cell);
    }
  }
  // 16-bit because each trace claims cells under its OWN id, and "already someone else's" is
  // the stop condition — a single shared flag cannot tell a trace's own corridor from a
  // neighbour's, so it would halt on its second step every time.
  const visited = new Uint16Array(N * N);
  const loops = [];
  let budget = MAX_POINTS, id = 0;
  for (let iz = 0; iz < N && budget > 0; iz++) {
    for (let ix = 0; ix < N && budget > 0; ix++) {
      if (visited[iz * N + ix]) continue;
      const a = H[iz * (N + 1) + ix], b = H[iz * (N + 1) + ix + 1];
      if ((a > 0) === (b > 0)) continue;
      // linear guess along the straddling edge, then the follower snaps it exactly
      const t = a / (a - b);
      id++;
      const pts = followContour(-half + (ix + t) * cell, -half + iz * cell,
        visited, cell, N, half, id);
      if (pts.length >= 12) { loops.push(pts); budget -= pts.length / 2; }  // ignore specks
      if (visited[iz * N + ix] === 0) visited[iz * N + ix] = id;
    }
  }

  // ── build the strip ────────────────────────────────────────────────────────────────────
  let total = 0;
  for (const l of loops) total += (l.length / 2) * ROWS.length;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const idx = [];
  let v = 0;
  const g = [0, 0];
  for (const l of loops) {
    const n = l.length / 2;
    const base = v;

    // ── WIDTH IS CAPPED BY THE LOCAL BEND ────────────────────────────────────────────────
    // Offsetting a polyline inland by a fixed distance folds it wherever the curve turns
    // tighter than that distance: neighbouring offsets cross, the strip doubles back, and the
    // reversed triangles catch the light at their own angle — flat angular shapes lying over
    // the water, which is precisely what this looked like. Measured at the fixed 46 m: no
    // folds at 5 m inland, 65 at 14 m, 1501 at 27 m and 2947 at 46 m. 4.8% of the strip.
    //
    // For a curve sampled at STEP, v = a + c - 2b points at the centre of curvature and its
    // length is about STEP^2/R, so R falls out of three consecutive points for nothing. Cap
    // the offset under that radius and the offsets can no longer meet.
    //
    // The width varying along the coast is free, and that is the nice part of building the
    // strip out of the same terrain the tiles draw: its inner boundary is invisible wherever
    // it lands, because both sides are the same surface. It can be narrow through a tight
    // cove and wide along an open beach and there is nothing to see.
    //
    // THE SAME CAP IS NEEDED ON THE SEAWARD SIDE NOW, because row 0 no longer sits on the
    // contour: it steps seaward (see the row loop) and can go tens of metres out where the
    // beach is flat. The gate below only ever narrowed the INLAND offset, since that was the
    // only side with geometry on it — so at a headland, where the curve bends toward the SEA,
    // cap stays the full 46 and a seaward offset is free to fold exactly the way the inland
    // one used to. capsO is the identical bound with the sign of the gate flipped. This is not
    // a second mechanism, it is the existing one applied to the side that grew geometry.
    const nxs = new Float32Array(n), nzs = new Float32Array(n), caps = new Float32Array(n);
    const capsO = new Float32Array(n);
    const rawx = new Float32Array(n), rawz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = l[i * 2], z = l[i * 2 + 1];
      grad(x, z, g);
      const m = Math.hypot(g[0], g[1]) || 1;
      // inland is UPHILL, straight from the gradient, so neighbouring samples agree and the
      // rows stay parallel instead of scissoring where the coast turns
      nxs[i] = g[0] / m; nzs[i] = g[1] / m;
      rawx[i] = nxs[i]; rawz[i] = nzs[i];
      let cap = WIDTH, capO = WIDTH;
      if (i > 0 && i < n - 1) {
        const vx = l[(i - 1) * 2] + l[(i + 1) * 2] - 2 * x;
        const vz = l[(i - 1) * 2 + 1] + l[(i + 1) * 2 + 1] - 2 * z;
        const vl = Math.hypot(vx, vz);
        // only the side the curve bends TOWARD can converge; bending away spreads them out
        if (vl > 1e-6) {
          const rc = Math.min(WIDTH, 0.55 * STEP * STEP / vl);
          if (vx * nxs[i] + vz * nzs[i] > 0) cap = rc; else capO = rc;
        }
      }
      // The FLOOR is what is left folding. At 6 m the last 198 quads were all places where
      // the coast bends tighter than 6 m and the clamp refused to go narrower; 2.5 m lets it.
      // A strip that thin covers almost nothing, and covering nothing is fine — it is the
      // same surface as the tile underneath, so where it narrows to a thread there is simply
      // nothing to see. A fold is not free in the same way.
      caps[i] = Math.max(2.5, cap);
      capsO[i] = Math.max(2.5, capO);
    }
    // SMOOTH THE OFFSET DIRECTION ALONG THE COAST. The curvature cap bounds how fast the
    // CONTOUR bends, but the offset does not run along the contour's own normal — it runs
    // along the terrain gradient, which can swing between neighbouring samples on ground the
    // contour crosses perfectly straight. That is what the last 200 folds were: not a tight
    // bend, but two adjacent normals pointing far enough apart to cross within 25 m. Lowering
    // the width floor did nothing for them, which is what said the cap was not the cause.
    for (let i = 0; i < n; i++) {
      let sx = 0, sz = 0;
      for (let k = -4; k <= 4; k++) {
        const j = i + k;
        if (j < 0 || j >= n) continue;
        sx += rawx[j]; sz += rawz[j];
      }
      const m = Math.hypot(sx, sz);
      if (m > 1e-6) { nxs[i] = sx / m; nzs[i] = sz / m; }
    }
    // a running minimum, because a quad spans two points and the tighter of the pair is what
    // decides whether it folds — and it smooths the width so the inner edge does not step
    const capS = new Float32Array(n), capOS = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let mn = caps[i], mo = capsO[i];
      for (let k = -3; k <= 3; k++) {
        const j = i + k;
        if (j < 0 || j >= n) continue;
        if (caps[j] < mn) mn = caps[j];
        if (capsO[j] < mo) mo = capsO[j];
      }
      capS[i] = mn;
      capOS[i] = mo;
    }

    const backs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = l[i * 2], z = l[i * 2 + 1];
      const nx = nxs[i], nz = nzs[i];
      // ROW 0 STEPS SEAWARD ALONG THE GROUND, IT IS NOT DROPPED THROUGH IT.
      //
      // It used to sit at the contour's own xz with y = -OUTER_SINK, which is the only vertex
      // in this mesh whose y is not heightAt — and a vertical lie at a fixed lateral position
      // moves the rendered y = 0 crossing inland by OUTER_SINK * d1 / (h1 + OUTER_SINK), where
      // d1 = ROWS[1] * capS[i]. The old first band was 0.12 * capS wide and capS genuinely
      // swings 2.5..46 (the gate above only narrows it where the curve bends inland, so every
      // convex or straight sample kept the full 46), so the drawn waterline stood 0.3 to 4.2 m
      // inland of the true contour — up to 13.8 m where the smoothed offset direction left the
      // first inland row at or below zero — and it STEPPED, in ~28 m plateaus, because the
      // running minimum above holds one low cap for seven samples. The mesh exists to put the
      // waterline on the contour and that error was set by the fold cap.
      //
      // Going seaward to where the ground is genuinely OUTER_SINK under the sea and taking its
      // true height keeps exactly what OUTER_SINK was for — the outer edge is ~0.35 m below the
      // water sheet, so it cannot z-fight it — while every vertex in the mesh is now on the
      // real surface. The chord row0 -> row1 is then a secant of the true terrain and crosses
      // y = 0 at the contour to first order, independent of capS. Capped by capOS so the
      // seaward offset cannot fold, and by a gradient floor of 0.008 so a dead-flat shelf asks
      // for 43 m rather than a kilometre.
      grad(x, z, g);
      const back = Math.min(capOS[i], OUTER_SINK / Math.max(Math.hypot(g[0], g[1]), 0.008));
      backs[i] = back;                        // kept for the span guard on the seaward quad
      for (let r = 0; r < ROWS.length; r++) {
        const d = r === 0 ? -back : ROWS[r] * capS[i];
        const px = x + nx * d, pz = z + nz * d;
        const y = heightAt(px, pz);           // every vertex on the true surface, row 0 included
        const o = v * 3;
        pos[o] = px; pos[o + 1] = y; pos[o + 2] = pz;
        // analytic normal, same construction the tiles use, so the lighting matches
        grad(px, pz, g);
        const ny = 1 / Math.sqrt(1 + g[0] * g[0] + g[1] * g[1]);
        nrm[o] = -g[0] * ny; nrm[o + 1] = ny; nrm[o + 2] = -g[1] * ny;
        v++;
      }
    }
    // DO NOT STITCH ACROSS A GAP. Points that could not be snapped onto the contour are
    // dropped, which is right — keeping them dragged the edge two metres off the waterline —
    // but the index buffer then happily bridged the hole with one quad, and a hole can be
    // twenty skipped steps wide. Those are the big flat tabs jutting out over the sea: 232 of
    // them, up to 87 m across, cutting the corner off every bay they spanned. They are half a
    // percent of the quads and essentially all of what you see, because one 87 m facet is
    // worth a thousand good 4 m ones.
    //
    // Worth recording that every metric I had was blind to them: each one treated a long jump
    // between consecutive points as a LOOP BOUNDARY and skipped it, which is exactly the quad
    // that was wrong. The strip simply ends at a gap and starts again on the far side.
    //
    // THE SAME GUARD BELONGS ON THE OTHER AXIS, and it was only ever applied to one. The test
    // above measures the spacing of the CONTOUR points, but the outer rows do not lie over the
    // contour — they lie ROWS[r] * capS inland of it, and capS[i] and capS[i+1] share six of
    // the seven samples in the running-min window, so one low value entering or leaving the
    // window moves the cap by its full range (46 -> 2.5) across a single 4 m step. The outer
    // quad then rakes 43.5 m of terrain across that step: exactly the shape of the 87 m flat
    // tabs MAX_SPAN was written to stop, differing only in which direction it is stretched.
    // Breaking rather than skipping keeps the inner rows, whose spans are still short — the
    // strip just narrows for one step, and the tile draws the same surface where it stops.
    const MAX_SPAN = STEP * 1.8;
    for (let i = 0; i < n - 1; i++) {
      const dx = l[(i + 1) * 2] - l[i * 2], dz = l[(i + 1) * 2 + 1] - l[i * 2 + 1];
      if (dx * dx + dz * dz > MAX_SPAN * MAX_SPAN) continue;
      for (let r = 0; r < ROWS.length - 1; r++) {
        // row 0 is offset by backs, not by ROWS * capS, so it needs its own span. Skipping
        // just that band rather than breaking keeps the land side of the strip, which is
        // fine — losing the seaward band for one step loses nothing the sea was not covering.
        const span = r === 0 ? Math.abs(backs[i + 1] - backs[i])
                             : ROWS[r + 1] * Math.abs(capS[i + 1] - capS[i]);
        if (span > MAX_SPAN) { if (r === 0) continue; break; }
        const a = base + i * ROWS.length + r;
        const b = a + ROWS.length;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const index = new Uint32Array(idx);
  self.postMessage({ type: 'ribbon', pos, nrm, index, loops: loops.length, verts: v },
    [pos.buffer, nrm.buffer, index.buffer]);
};
