// The tuning-panel shell, shared by both cloud systems (P opens whichever is running).
//
// This is chrome and bookkeeping only — sliders, section headings, the button bar, and the
// localStorage persistence. What is actually tunable lives in tweak.js (skyclouds) and
// tweakvol.js (the takram clouds), because the two have nothing in common: one exposes a
// plain params object, the other a library effect with per-layer packed uniforms.
//
// Settings persist as a DIFF from the code defaults, keyed by section and label, so a control
// that is later renamed or removed is skipped rather than restoring a stale number into
// whatever now sits at that index.
//
// THE DIFF IS THE WHOLE POINT, and it is worth knowing why, because the bug it fixes was
// close to invisible: the original save() wrote EVERY row whether or not it had been touched,
// and load() then restored all of them over the code defaults on every boot. The effect is
// that shipping a new default has NO EFFECT on anyone who has ever opened the panel — the
// browser quietly puts the old numbers back and renders exactly as before. A restored value
// never equals the code default, so it never gets pruned, and it survives forever.

export function createPanel({ store, footer }) {
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

  // opts.commit runs on mouse-up only, for anything too slow to do per-input — a texture
  // rebake, a buffer reallocation. The slider still tracks live; only the expensive half
  // waits for the release.
  const slider = (section, label, get, set, min, max, step, fmt, opts = {}) => {
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
    if (opts.commit) {
      const fire = () => opts.commit(+input.value);
      input.addEventListener('change', fire);      // covers keyboard as well as mouse-up
    }
    row.append(name, input, val);
    el.appendChild(row);
    rows.push({ section, label, get, set, input, show, commit: opts.commit });
    return row;
  };

  const toggle = (section, label, get, set) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:6px; margin:2px 0;';
    const name = document.createElement('div');
    name.style.cssText = 'width:112px; flex:0 0 112px; color:#9fb0c4;';
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = !!get();
    input.style.cssText = 'accent-color:#4a90e2;';
    const show = () => { input.checked = !!get(); };
    input.addEventListener('change', () => set(input.checked));
    row.append(name, input);
    el.appendChild(row);
    // stored as 0/1 so the same numeric diff/restore path covers it
    rows.push({ section, label, input, show,
      get: () => (get() ? 1 : 0), set: v => set(!!v), isToggle: true });
    return row;
  };

  const note = (text) => {
    const d = document.createElement('div');
    d.style.cssText = 'color:#6b7789; margin:2px 0 6px; font-size:10px;';
    d.textContent = text;
    el.appendChild(d);
  };

  // Called once the caller has added every control. Snapshot is taken BEFORE load() runs, so
  // it is the code default rather than whatever was restored, and a row matching it is not
  // persisted at all.
  const finish = ({ onCopy, onReset, slowLast } = {}) => {
    rows.forEach(r => { r.codeDefault = r.get(); });

    const save = () => {
      const diff = {};
      for (const r of rows) {
        const v = r.get();
        if (v === r.codeDefault) continue;
        diff[r.section + '|' + r.label] = v;
      }
      try { localStorage.setItem(store, JSON.stringify(diff)); } catch {}
    };
    const load = () => {
      let d; try { d = JSON.parse(localStorage.getItem(store) || 'null'); } catch {}
      if (!d) return 0;
      let n = 0;
      // slowLast names controls that reallocate or rebake, so they run after everything
      // else has settled rather than being triggered once per restored row
      const slow = new Set(slowLast || []);
      const ordered = rows.slice()
        .sort((a, b) => (slow.has(a.label) ? 1 : 0) - (slow.has(b.label) ? 1 : 0));
      for (const r of ordered) {
        const v = d[r.section + '|' + r.label];
        if (typeof v !== 'number' || !isFinite(v)) continue;
        r.set(v);
        if (r.isToggle) r.input.checked = !!v; else r.input.value = v;
        r.show();
        if (r.commit) r.commit(v);
        n++;
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
      const out = onCopy ? onCopy()
        : rows.reduce((o, r) => (o[r.section + '|' + r.label] = r.get(), o), {});
      navigator.clipboard.writeText(JSON.stringify(out, null, 2));
    });
    btn('Reset', () => {
      onReset && onReset();
      // every row, not just whatever onReset knows about — the original Reset restored two
      // nested objects and silently left the top-level lighting sliders wherever they were
      rows.forEach(r => {
        r.set(r.codeDefault);
        if (r.isToggle) r.input.checked = !!r.codeDefault; else r.input.value = r.codeDefault;
        r.show();
        if (r.commit) r.commit(r.codeDefault);
      });
    });
    btn('Forget saved', () => { try { localStorage.removeItem(store); } catch {} });
    el.appendChild(bar);

    const foot = document.createElement('div');
    foot.style.cssText = 'color:#6b7789; margin-top:6px; font-size:10px;';
    foot.textContent = footer || 'P closes.';
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
  };

  return { el, head, slider, toggle, note, finish, rows };
}
