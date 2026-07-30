// Live tuning panel (P). Every control here writes straight to a running uniform, so
// the sky changes under your hand — no reload, no rebuild, no asking someone else to
// run an A/B for you.
//
// ONLY LIVE PARAMETERS ARE LISTED. That is the whole point: a slider that silently does
// nothing is worse than no slider, because you conclude the parameter does not matter.
// Anything baked into the weather map at generation time (the island cap, the district
// clustering, the weather tile size) cannot be here and is called out in the panel as
// needing a reload instead.
//
// The library proxies its raymarch settings through accessors on the options object, so
// assigning clouds.clouds.minStepSize really does reach the shader — verified by setting
// it to 600 and watching both the image and the frame time move.

const FMT = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4));

// applyResize must be the game's OWN resize path. Two controls here reallocate render
// targets and have to re-derive the sizes afterwards, and getting that wrong is how the
// screen went black: passing renderer.domElement.width to composer.setSize hands it the
// DRAWING BUFFER size, which it multiplies by the pixel ratio again. On a 1.5x display
// each slider tick grew the canvas 1.5x — 1920 to 2880 to 4320 px wide — with the CSS
// size ballooning past the window, so the viewport showed a corner of a giant canvas.
// It never showed up here because this browser reports a ratio of 1.
export function initTweakPanel({ clouds, bloom, applyResize, setWeatherRepeat }) {
  if (!clouds) return null;

  const root = document.createElement('div');
  root.id = 'tweak';
  root.style.cssText = `
    position: fixed; top: 0; right: 0; bottom: 0; width: 330px; overflow-y: auto;
    background: rgba(8,16,26,0.88); border-left: 1px solid rgba(160,210,255,0.22);
    backdrop-filter: blur(4px); color: #dceaf8; z-index: 50; display: none;
    font: 11px/1.5 ui-monospace, Consolas, monospace; padding: 8px 10px 40px;`;
  document.body.appendChild(root);

  // The camera listens for pointerdown/move/wheel on WINDOW to orbit and zoom. Without
  // this, dragging a slider also swings the camera and scrolling the panel zooms it.
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'contextmenu']) {
    root.addEventListener(ev, e => e.stopPropagation(), { capture: true });
  }
  // and keystrokes typed at the panel must not fly the aeroplane
  for (const ev of ['keydown', 'keyup']) root.addEventListener(ev, e => e.stopPropagation());

  const rows = [];   // { get, set, def, el, num, path }
  // Every layer has a slider called "height", so the label alone cannot identify a row.
  // Rows carry their section, and the copy output is keyed "L3 big masses / height" —
  // otherwise the handover says "height: 1500" and nobody knows which layer moved.
  let curSection = '';

  const section = (title, note) => {
    curSection = title;
    const h = document.createElement('div');
    h.style.cssText = 'margin: 10px 0 4px; color: #9ecbff; letter-spacing: 1.5px; font-size: 10px;';
    h.textContent = title.toUpperCase();
    root.appendChild(h);
    if (note) {
      const n = document.createElement('div');
      n.style.cssText = 'color: rgba(190,215,240,0.45); font-size: 10px; margin: -2px 0 4px;';
      n.textContent = note;
      root.appendChild(n);
    }
  };

  // onChange sliders fire on MOUSE-UP, not while dragging — for anything too expensive
  // to run per pixel of travel, like re-rendering the weather map.
  const slider = (label, get, set, min, max, step, onRelease) => {
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display: grid; grid-template-columns: 118px 1fr 46px; gap: 5px; align-items: center; margin: 1px 0;';
    const name = document.createElement('span');
    name.textContent = label;
    name.style.cssText = 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
    const input = document.createElement('input');
    input.type = 'range'; input.min = min; input.max = max; input.step = step;
    input.style.cssText = 'width: 100%; accent-color: #6fb4ff; height: 14px;';
    const num = document.createElement('span');
    num.style.cssText = 'text-align: right; color: #8fd0ff;';
    const row = { get, set, def: get(), el: input, num, path: curSection + ' / ' + label };
    const sync = () => { const v = get(); input.value = v; num.textContent = FMT(v); };
    if (onRelease) {
      // show the number while dragging, but only do the expensive work on release
      input.addEventListener('input', () => { num.textContent = FMT(parseFloat(input.value)); });
      input.addEventListener('change', () => { set(parseFloat(input.value)); sync(); });
    } else {
      input.addEventListener('input', () => { set(parseFloat(input.value)); num.textContent = FMT(parseFloat(input.value)); });
    }
    row.sync = sync;
    sync();
    wrap.append(name, input, num);
    root.appendChild(wrap);
    rows.push(row);
    return row;
  };

  const toggle = (label, get, set) => {
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display: grid; grid-template-columns: 118px 1fr; gap: 5px; align-items: center; margin: 2px 0;';
    const name = document.createElement('span'); name.textContent = label;
    const input = document.createElement('input'); input.type = 'checkbox';
    input.style.cssText = 'accent-color: #6fb4ff; justify-self: start;';
    input.checked = !!get();
    input.addEventListener('change', () => set(input.checked));
    const row = { get, set, def: get(), el: input, path: curSection + ' / ' + label,
                  sync: () => { input.checked = !!get(); } };
    wrap.append(name, input);
    root.appendChild(wrap);
    rows.push(row);
    return row;
  };

  const C = clouds.clouds, L = clouds.cloudLayers;
  const num = (o, k) => [() => o[k], v => { o[k] = v; }];

  // ---- header -------------------------------------------------------------
  const head = document.createElement('div');
  head.style.cssText = 'color: #9ecbff; letter-spacing: 2px; border-bottom: 1px solid rgba(160,210,255,0.2); padding-bottom: 5px;';
  head.textContent = 'CLOUD TUNING — P TO CLOSE';
  root.appendChild(head);
  const perf = document.createElement('div');
  perf.style.cssText = 'color: #8fd0ff; margin: 4px 0 2px;';
  root.appendChild(perf);

  // ---- global -------------------------------------------------------------
  section('Coverage & size', 'cloud WIDTH is the tile — release to rebuild');
  slider('coverage', ...num(clouds, 'coverage'), 0.10, 0.60, 0.005);
  // THE MISSING CONTROL. Nothing in the layer settings says how wide a cloud is: height
  // is a layer field, width comes from the blob size in the weather map, i.e. the tile.
  // Smaller number = bigger tile in world terms = wider clouds. A layer is only a slab
  // with flat vertical sides when its height outruns its width, so this is the other
  // half of the aspect ratio.
  if (setWeatherRepeat) {
    slider('cloud width', () => clouds.localWeatherRepeat.x, v => setWeatherRepeat(Math.round(v)),
      30, 260, 5, true);
  }
  // resolutionScale only re-derives the targets on a resize, so nudge the game's own
  // resize path — never composer.setSize with hand-computed dimensions (see the note
  // above the function)
  slider('cloud res', () => clouds.resolutionScale, v => {
    clouds.resolutionScale = v;
    applyResize();
  }, 0.25, 1.0, 0.01);
  slider('turbulence', ...num(clouds, 'turbulenceDisplacement'), 0, 400, 5);

  section('Shape noise', 'world period = 1 / value, in metres');
  for (const ax of ['x', 'y', 'z']) {
    slider('shapeRepeat ' + ax, () => clouds.shapeRepeat[ax], v => { clouds.shapeRepeat[ax] = v; }, 0.0004, 0.004, 0.00005);
  }

  // ---- layers -------------------------------------------------------------
  const NAMES = ['L1 small puffs', 'L2 strong cells', 'L3 big masses', 'L4 cirrus veil'];
  for (let i = 0; i < 4; i++) {
    section(NAMES[i]);
    slider('altitude', ...num(L[i], 'altitude'), 200, 6000, 10);
    slider('height', ...num(L[i], 'height'), 60, 3500, 10);
    slider('density', ...num(L[i], 'densityScale'), 0, 2, 0.01);
    slider('coverFilter', ...num(L[i], 'coverageFilterWidth'), 0.05, 0.95, 0.01);
    slider('weatherExp', ...num(L[i], 'weatherExponent'), 0.5, 4, 0.05);
    slider('shapeBias', ...num(L[i], 'shapeAlteringBias'), 0.1, 1.2, 0.01);
    slider('shapeAmount', ...num(L[i], 'shapeAmount'), 0, 1, 0.01);
    slider('detailAmount', ...num(L[i], 'shapeDetailAmount'), 0, 1, 0.01);
    toggle('casts shadow', () => L[i].shadow, v => { L[i].shadow = v; });
  }

  // ---- raymarch -----------------------------------------------------------
  section('Raymarch', 'cost lives here');
  slider('minStep', ...num(C, 'minStepSize'), 10, 400, 5);
  slider('maxStep', ...num(C, 'maxStepSize'), 20, 600, 5);
  slider('stepGrowth', ...num(C, 'perspectiveStepScale'), 1.0, 1.05, 0.001);
  slider('iterations', ...num(C, 'maxIterationCount'), 50, 1000, 10);
  slider('sun steps', ...num(C, 'maxIterationCountToSun'), 1, 12, 1);
  slider('sun stepSize', ...num(C, 'minSecondaryStepSize'), 10, 300, 5);
  slider('sun growth', ...num(C, 'secondaryStepScale'), 1, 3, 0.05);
  slider('minTransmit', ...num(C, 'minTransmittance'), 0.001, 0.2, 0.001);

  section('Shadows');
  slider('cascades', () => clouds.shadow.cascadeCount, v => { clouds.shadow.cascadeCount = Math.round(v); }, 1, 3, 1);
  slider('shadow map', () => clouds.shadow.mapSize.x, v => clouds.shadow.mapSize.set(v, v), 512, 2048, 512);

  section('History', 'off = full but smaller buffer');
  toggle('temporal', () => clouds.temporalUpscale, v => {
    clouds.temporalUpscale = v;
    clouds.shadow.temporalPass = v; clouds.shadow.temporalJitter = v;
    applyResize();
  });

  if (bloom) {
    section('Bloom');
    slider('intensity', ...num(bloom, 'intensity'), 0, 3, 0.02);
    slider('threshold', () => bloom.luminanceMaterial.threshold, v => { bloom.luminanceMaterial.threshold = v; }, 0, 3, 0.01);
    slider('smoothing', () => bloom.luminanceMaterial.smoothing, v => { bloom.luminanceMaterial.smoothing = v; }, 0, 1, 0.01);
  }

  section('Needs a reload', 'baked into the weather map');
  const note = document.createElement('div');
  note.style.cssText = 'color: rgba(190,215,240,0.5); font-size: 10px; margin-bottom: 6px;';
  note.innerHTML = '?wrepeat= cloud size &nbsp; ?cap=0 no island mask<br>?cluster=0 no districts &nbsp; ?seed= island';
  root.appendChild(note);

  // ---- buttons ------------------------------------------------------------
  const bar = document.createElement('div');
  bar.style.cssText = 'display: flex; gap: 6px; margin: 10px 0 4px;';
  const mkBtn = (text, fn) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = `flex: 1; background: rgba(110,180,255,0.14); color: #dceaf8; cursor: pointer;
      border: 1px solid rgba(160,210,255,0.3); border-radius: 4px; padding: 5px 4px; font: inherit;`;
    b.addEventListener('click', fn);
    bar.appendChild(b);
    return b;
  };
  const syncAll = () => rows.forEach(r => r.sync());

  mkBtn('Reset', () => { rows.forEach(r => r.set(r.def)); syncAll(); });

  // The point of this button: it prints ONLY what you actually moved, as JSON, so the
  // changes can be handed over verbatim instead of described from memory.
  const out = document.createElement('textarea');
  out.readOnly = true;
  out.style.cssText = `width: 100%; height: 90px; margin-top: 6px; background: rgba(0,0,0,0.35);
    color: #9fe0a0; border: 1px solid rgba(160,210,255,0.2); border-radius: 4px; font: inherit; padding: 4px;`;
  mkBtn('Copy changes', () => {
    const diff = {};
    rows.forEach(r => {
      const v = r.get();
      if (v !== r.def) diff[r.path] = typeof v === 'number' ? +v.toFixed(5) : v;
    });
    const text = Object.keys(diff).length ? JSON.stringify(diff, null, 1) : '(nothing changed)';
    out.value = text;
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  });
  root.appendChild(bar);
  root.appendChild(out);

  // ---- fps ---------------------------------------------------------------
  let last = performance.now(), acc = 0, frames = 0;
  const tick = () => {
    const now = performance.now();
    acc += now - last; last = now; frames++;
    if (acc > 400) {
      perf.textContent = `${(frames / acc * 1000).toFixed(0)} fps  ·  ${(acc / frames).toFixed(1)} ms/frame`;
      acc = 0; frames = 0;
    }
  };

  let open = false;
  return {
    toggle() {
      open = !open;
      root.style.display = open ? 'block' : 'none';
      if (open) syncAll();
      return open;
    },
    get open() { return open; },
    tick,
  };
}
