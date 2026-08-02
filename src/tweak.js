// Live tuning panel for the cloud system. Press P.
//
// Every control here writes straight into skyclouds' params object, which the cloud pass
// reads afresh each frame — so there is nothing to apply, nothing to rebuild, and no
// rebake. That was not true of the old panel: half its sliders were baked into a weather
// texture and needed a regenerate, which made tuning by feel impossible.
//
// Settings persist to localStorage as a DIFF from the code defaults, keyed by section
// and label, so a control that is later renamed or removed is skipped rather than
// restoring a stale number into whatever now sits at that index.

// Key bumped to v2 deliberately: every existing v1 store holds a full 45-slider snapshot
// written by the old save(), including cloud lighting values that predate the shading fix.
// Those would keep overriding the new defaults forever, since a restored value never
// equals the code default and so never gets pruned. Abandoning the old key is the only
// way to hand existing browsers the new defaults; anything retuned from here persists
// normally.
const STORE = 'flighfeel-tweak-sky-v2';

export function initTweakPanel({ sc, applyResize }) {
  const p = sc.params;
  const defaults = JSON.parse(JSON.stringify({ layers: p.layers, island: p.island }));
  const rows = [];

  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed; top:0; right:0; width:380px; max-height:100vh; overflow-y:auto;
    background:rgba(12,16,24,0.92); color:#cfd8e3; font:11px/1.45 ui-monospace,Consolas,monospace;
    padding:8px 10px 40px; z-index:60; display:none; box-sizing:border-box;
    border-left:1px solid rgba(255,255,255,0.12);`;
  // the camera orbits on window-level pointer events, so the panel must swallow its own
  el.addEventListener('pointerdown', e => e.stopPropagation());
  el.addEventListener('pointermove', e => e.stopPropagation());
  el.addEventListener('wheel', e => e.stopPropagation());

  const head = (t, sub) => {
    const h = document.createElement('div');
    h.style.cssText = 'margin:10px 0 4px; color:#7fb2ff; letter-spacing:.08em; font-size:10px;';
    h.textContent = t.toUpperCase();
    el.appendChild(h);
    if (sub) { const s = document.createElement('div');
      s.style.cssText = 'color:#6b7789; margin:-2px 0 5px; font-size:10px;';
      s.textContent = sub; el.appendChild(s); }
  };

  const slider = (section, label, get, set, min, max, step, fmt) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:6px; margin:2px 0;';
    const name = document.createElement('div');
    name.style.cssText = 'width:112px; flex:0 0 112px; color:#9fb0c4;';
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'range'; input.min = min; input.max = max; input.step = step;
    input.value = get();
    input.style.cssText = 'flex:1 1 auto; min-width:0; accent-color:#4a90e2;';
    const val = document.createElement('div');
    val.style.cssText = 'width:62px; flex:0 0 62px; text-align:right; color:#e6edf5;';
    const show = () => { val.textContent = fmt ? fmt(get()) : (+get()).toFixed(2); };
    show();
    input.addEventListener('input', () => { set(+input.value); show(); });
    row.append(name, input, val);
    el.appendChild(row);
    rows.push({ section, label, get, set, input, show });
  };

  head('render');
  slider('render', 'cloud res', () => p.cloudRes,
    v => { sc.setCloudRes(v); applyResize && applyResize(); }, 0.2, 1, 0.05);
  slider('render', 'max distance', () => p.maxDist, v => p.maxDist = v, 8000, 90000, 1000,
    v => (v / 1000).toFixed(0) + ' km');
  slider('render', 'wind speed', () => p.windSpeed, v => p.windSpeed = v, 0, 12, 0.1);

  head('island cap', 'how far cloud reaches from the island');
  slider('island', 'radius', () => p.island.radius, v => p.island.radius = v, 0, 40000, 250,
    v => (v / 1000).toFixed(1) + ' km');
  slider('island', 'fade', () => p.island.fade, v => p.island.fade = v, 250, 40000, 250,
    v => (v / 1000).toFixed(1) + ' km');
  slider('island', 'edge warp', () => p.island.edgeWarp, v => p.island.edgeWarp = v, 0, 20000, 200,
    v => (v / 1000).toFixed(1) + ' km');
  slider('island', 'open sea', () => p.island.seaFloorDensity,
    v => p.island.seaFloorDensity = v, 0, 1, 0.01);
  slider('island', 'centre X', () => p.island.centerX, v => p.island.centerX = v, -20000, 20000, 100,
    v => v.toFixed(0));
  slider('island', 'centre Z', () => p.island.centerZ, v => p.island.centerZ = v, -20000, 20000, 100,
    v => v.toFixed(0));

  head('lighting');
  slider('light', 'sun boost', () => p.sunBoost, v => p.sunBoost = v, 0, 24, 0.1);
  slider('light', 'ambient', () => p.ambientBoost, v => p.ambientBoost = v, 0, 2, 0.01);
  slider('light', 'base darken', () => p.baseDarken, v => p.baseDarken = v, 0, 1, 0.01);
  slider('light', 'silver lining', () => p.silver, v => p.silver = v, 0, 6, 0.05);
  slider('light', 'absorption', () => p.absorption, v => p.absorption = v, 0.005, 0.3, 0.005,
    v => v.toFixed(3));
  // The one that actually decides how lit the clouds look: it sets the optical depth of
  // the sun ray, so it is what darkens bases without touching tops. Was missing from the
  // panel entirely while it sat 12x too low.
  slider('light', 'self-shadow', () => p.lightAbsorb, v => p.lightAbsorb = v, 0.002, 0.08, 0.001,
    v => v.toFixed(3));
  slider('light', 'ms fill', () => p.msFalloff, v => p.msFalloff = v, 0, 0.9, 0.01);
  slider('light', 'ms scatter', () => p.msScatter, v => p.msScatter = v, 0.1, 1, 0.01);
  slider('light', 'powder', () => p.powderMix, v => p.powderMix = v, 0, 1, 0.01);
  // How finely the march samples inside cloud. This is what decides whether any of the
  // detail above is resolved at all — at 600 the clouds go back to flat blobs.
  slider('light', 'step fine', () => p.stepFine, v => p.stepFine = v, 25, 600, 5);

  p.layers.forEach((L, i) => {
    const sec = 'L' + (i + 1);
    head(`${sec} ${L.name}`);
    slider(sec, 'base', () => L.base, v => L.base = v, 0, 12000, 50, v => v.toFixed(0) + ' m');
    slider(sec, 'top', () => L.top, v => L.top = v, 0, 14000, 50, v => v.toFixed(0) + ' m');
    slider(sec, 'density', () => L.density, v => L.density = v, 0, 3, 0.01);
    slider(sec, 'coverage', () => L.coverage, v => L.coverage = v, 0, 1, 0.01);
    slider(sec, 'cloud size', () => L.featureSize, v => L.featureSize = v, 600, 40000, 100,
      v => (v / 1000).toFixed(1) + ' km');
    slider(sec, 'detail size', () => L.detailSize, v => L.detailSize = v, 80, 6000, 20,
      v => v.toFixed(0) + ' m');
    // 0..1 was the range for the old one-sided term, where anything near 1 dissolved the
    // layer. Centred, it carves and fills, so useful values now run past 2.
    slider(sec, 'detail', () => L.detailStrength, v => L.detailStrength = v, 0, 4, 0.02);
    slider(sec, 'billow', () => L.worleyMix, v => L.worleyMix = v, 0, 1, 0.01);
    slider(sec, 'flat base', () => L.flatBase, v => L.flatBase = v, 0, 1, 0.01);
  });

  // ---- persistence: store only what differs from the code defaults
  //
  // IT DID NOT ACTUALLY DO THAT, and the bug was close to invisible: save() wrote EVERY
  // row, so the store held all 45 sliders whether or not they had been touched, and load()
  // then restored all 45 over the code defaults on every single boot. The effect is that
  // shipping a new default has NO EFFECT on anyone who has ever opened the panel — a
  // retuned sunBoost/ambient/baseDarken went out, and every browser that had the panel
  // open at some point quietly put the old numbers back and rendered exactly as before.
  //
  // Snapshot taken BEFORE load() runs, so it is the code default rather than whatever was
  // restored, and a row that matches it is not persisted at all.
  rows.forEach(r => { r.codeDefault = r.get(); });
  const save = () => {
    const diff = {};
    for (const r of rows) {
      const v = r.get();
      if (v === r.codeDefault) continue;
      diff[r.section + '|' + r.label] = v;
    }
    try { localStorage.setItem(STORE, JSON.stringify(diff)); } catch {}
  };
  const load = () => {
    let d; try { d = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch {}
    if (!d) return 0;
    let n = 0;
    // cloud res last — it reallocates the buffer
    const ordered = rows.slice().sort((a, b) => (a.label === 'cloud res' ? 1 : 0) - (b.label === 'cloud res' ? 1 : 0));
    for (const r of ordered) {
      const v = d[r.section + '|' + r.label];
      if (typeof v !== 'number' || !isFinite(v)) continue;
      r.set(v); r.input.value = v; r.show(); n++;
    }
    return n;
  };

  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex; gap:6px; margin:12px 0 4px;';
  const btn = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `flex:1; background:#1d2836; color:#cfd8e3; border:1px solid #33445c;
      padding:5px 4px; font:11px ui-monospace,monospace; cursor:pointer; border-radius:3px;`;
    b.addEventListener('click', fn);
    bar.appendChild(b);
  };
  btn('Copy values', () => {
    const out = { layers: p.layers, island: p.island,
      absorption: p.absorption, lightAbsorb: p.lightAbsorb, baseDarken: p.baseDarken,
      silver: p.silver, sunBoost: p.sunBoost, ambientBoost: p.ambientBoost,
      msFalloff: p.msFalloff, msScatter: p.msScatter, powderMix: p.powderMix,
      maxDist: p.maxDist, windSpeed: p.windSpeed, cloudRes: p.cloudRes };
    navigator.clipboard.writeText(JSON.stringify(out, null, 2));
  });
  btn('Reset', () => {
    p.layers.forEach((L, i) => Object.assign(L, defaults.layers[i]));
    Object.assign(p.island, defaults.island);
    // Every row, not just the layer/island ones — the top-level lighting sliders were not
    // covered by the two Object.assigns above, so Reset left them wherever they were.
    rows.forEach(r => { r.set(r.codeDefault); r.input.value = r.codeDefault; r.show(); });
  });
  btn('Forget saved', () => { try { localStorage.removeItem(STORE); } catch {} });
  el.appendChild(bar);

  const foot = document.createElement('div');
  foot.style.cssText = 'color:#6b7789; margin-top:6px; font-size:10px;';
  foot.textContent = 'P closes. Everything here is live — no rebake.';
  el.appendChild(foot);

  document.body.appendChild(el);
  const restored = load();
  if (restored) console.log(`[flighfeel] tweak: restored ${restored} saved values`);
  window.addEventListener('beforeunload', save);

  return {
    el,
    toggle() {
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
      if (el.style.display === 'none') save();
      return el.style.display !== 'none';
    },
  };
}
