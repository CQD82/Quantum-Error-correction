import {
  CODES, normalizePauli, isPauliString, commutes, syndrome, singleQubitTable, codeLength,
  buildSurfaceCode, emptyError, pauliAt, applyPauli, surfaceSyndrome, decodeSurface,
  logicalFlips, mulberry32, runTrials, wilson, estimateResources, logicalErrorRate,
  physicalQubitsPerLogical,
} from './qec.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = (sel) => document.querySelector(sel);

function svg(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (parent) parent.appendChild(el);
  return el;
}

function html(tag, attrs = {}, text) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

const SUPERSCRIPT = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const SUBSCRIPT = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };

function fmtSci(x, digits = 1) {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return '0';
  if (x >= 1e-3 && x < 1e4) return String(Number(x.toPrecision(digits + 1)));
  const [m, e] = x.toExponential(digits).split('e');
  const exp = String(Number(e)).split('').map((ch) => SUPERSCRIPT[ch]).join('');
  return `${m} × 10${exp}`;
}

const fmtInt = (x) => Math.round(x).toLocaleString('en-US');
const sub = (n) => String(n).split('').map((ch) => SUBSCRIPT[ch]).join('');

function fmtDuration(seconds) {
  if (seconds < 1) return `${Number((seconds * 1000).toPrecision(3))} ms`;
  if (seconds < 120) return `${Number(seconds.toPrecision(3))} s`;
  if (seconds < 7200) return `${Number((seconds / 60).toPrecision(3))} min`;
  if (seconds < 172800) return `${Number((seconds / 3600).toPrecision(3))} h`;
  return `${Number((seconds / 86400).toPrecision(3))} days`;
}

// ---------------------------------------------------------------------------
// Theme toggle (explicit choice stored per browser; default follows the OS)
// ---------------------------------------------------------------------------

function initTheme() {
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem('qec-theme');
    if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  } catch { /* storage unavailable: follow the OS setting */ }
  const button = $('#theme-toggle');
  if (!button) return;
  button.addEventListener('click', () => {
    const current = root.getAttribute('data-theme')
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('qec-theme', next); } catch { /* not persisted */ }
  });
}

// ---------------------------------------------------------------------------
// Surface code lab
// ---------------------------------------------------------------------------

function initLab() {
  const S = 56;          // qubit pitch in SVG units
  const PAD = 40;        // margin around the lattice
  const R = S / 2;       // boundary half-disc radius
  const svgEl = $('#lattice');
  const status = $('#lab-status');
  const decodeBtn = $('#lab-decode');
  const rng = mulberry32((Math.random() * 2 ** 32) >>> 0);

  const state = { d: 5, code: null, err: null, brush: 'X', result: null };

  const pos = (q) => {
    const r = Math.floor(q / state.d);
    const c = q % state.d;
    return [PAD + c * S, PAD + r * S];
  };

  function setDistance(d, seedExample) {
    state.d = d;
    state.code = buildSurfaceCode(d);
    state.err = emptyError(state.code.n);
    state.result = null;
    if (seedExample) {
      const q = (r, c) => r * d + c;
      applyPauli(state.err, q(1, 1), 'X');
      applyPauli(state.err, q(1, 2), 'X');
      applyPauli(state.err, q(3, 3), 'Z');
    }
    $('#hero-d').textContent = String(d);
    render();
  }

  function faceShape(s, group) {
    const { d } = state;
    const cls = `face face-${s.type.toLowerCase()}`;
    if (s.qubits.length === 4) {
      const [a, b, c, e] = s.qubits; // (i-1,j-1) (i-1,j) (i,j-1) (i,j)
      const pts = [a, b, e, c].map((q) => pos(q).join(',')).join(' ');
      return svg('polygon', { points: pts, class: cls }, group);
    }
    const [q1, q2] = s.qubits;
    let [x1, y1] = pos(q1);
    let [x2, y2] = pos(q2);
    // Order the endpoints so a clockwise arc bulges away from the lattice.
    if (s.i === d || s.j === 0) [x1, y1, x2, y2] = [x2, y2, x1, y1];
    return svg('path', { d: `M${x1},${y1} A${R},${R} 0 0 1 ${x2},${y2} Z`, class: cls }, group);
  }

  function faceCentre(s) {
    const pts = s.qubits.map(pos);
    let x = pts.reduce((t, p) => t + p[0], 0) / pts.length;
    let y = pts.reduce((t, p) => t + p[1], 0) / pts.length;
    if (s.qubits.length === 2) {
      const off = R * 0.48;
      if (s.i === 0) y -= off;
      else if (s.i === state.d) y += off;
      else if (s.j === 0) x -= off;
      else x += off;
    }
    return [x, y];
  }

  function render() {
    const { d, code, err, result } = state;
    const size = (d - 1) * S + 2 * PAD;
    svgEl.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svgEl.replaceChildren();
    const synd = surfaceSyndrome(code, err);

    const faces = svg('g', {}, svgEl);
    const marks = svg('g', {}, svgEl);
    code.stabilizers.forEach((s) => {
      const shape = faceShape(s, faces);
      if (synd[s.id]) {
        shape.classList.add('lit');
        const [cx, cy] = faceCentre(s);
        svg('circle', { cx, cy, r: 7, class: 'defect-pulse' }, marks);
        svg('circle', { cx, cy, r: 7, class: 'defect' }, marks);
      }
    });

    const qubits = svg('g', {}, svgEl);
    for (let q = 0; q < code.n; q++) {
      const [x, y] = pos(q);
      const p = pauliAt(err, q);
      const r = Math.floor(q / d) + 1;
      const c = (q % d) + 1;
      const g = svg('g', {
        class: `qubit e-${p}`,
        tabindex: 0,
        role: 'button',
        'data-q': q,
        'aria-label': `Qubit row ${r}, column ${c}: ${p === 'I' ? 'no error' : `${p} error`}`,
      }, qubits);
      svg('circle', { cx: x, cy: y, r: 22, fill: 'transparent' }, g);
      svg('circle', { cx: x, cy: y, r: 14, class: 'q' }, g);
      if (p !== 'I') svg('text', { x, y }, g).textContent = p;
      if (result && (result.correction.x[q] || result.correction.z[q])) {
        svg('circle', { cx: x, cy: y, r: 21, class: 'corr-ring' }, g);
      }
    }
    renderStatus(synd);
  }

  function chip(cls, text) {
    return html('span', { class: `chip ${cls}` }, text);
  }

  function stat(label, value) {
    const el = html('span', { class: 'stat' }, `${label} `);
    el.appendChild(html('b', {}, String(value)));
    return el;
  }

  function renderStatus(synd) {
    const { code, err, result } = state;
    let weight = 0;
    for (let q = 0; q < code.n; q++) if (err.x[q] || err.z[q]) weight++;
    const defects = synd.reduce((t, b) => t + b, 0);
    const items = [stat('errors', weight), stat('defects', defects)];

    if (result) {
      let cw = 0;
      for (let q = 0; q < code.n; q++) if (result.correction.x[q] || result.correction.z[q]) cw++;
      items.push(stat('correction weight', cw));
      const { X, Z } = result.logical;
      if (!X && !Z) items.push(chip('chip-good', 'Decoder succeeds: logical qubit intact'));
      else items.push(chip('chip-bad', `Decoder fails: logical ${X && Z ? 'Y' : X ? 'X' : 'Z'} error`));
      if (!result.exact) items.push(chip('chip-info', 'greedy matching (many defects)'));
      decodeBtn.textContent = 'Apply correction';
    } else {
      decodeBtn.textContent = 'Decode';
      if (weight === 0) {
        items.push(chip('chip-info', 'Click a qubit or sprinkle errors'));
      } else if (defects === 0) {
        const { X, Z } = logicalFlips(code, err);
        items.push(X || Z
          ? chip('chip-bad', 'Undetectable: this is a logical operator')
          : chip('chip-good', 'Harmless: the error is a product of stabilizers'));
      }
    }
    status.replaceChildren(...items);
  }

  function toggle(q) {
    applyPauli(state.err, q, state.brush);
    state.result = null;
    render();
    const el = svgEl.querySelector(`[data-q="${q}"]`);
    if (el) el.focus({ preventScroll: true });
  }

  svgEl.addEventListener('click', (e) => {
    const g = e.target.closest('.qubit');
    if (g) toggle(Number(g.dataset.q));
  });
  svgEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const g = e.target.closest('.qubit');
    if (!g) return;
    e.preventDefault();
    toggle(Number(g.dataset.q));
  });

  document.querySelectorAll('[data-brush]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.brush = btn.dataset.brush;
      document.querySelectorAll('[data-brush]').forEach((b) => {
        b.setAttribute('aria-checked', String(b === btn));
      });
    });
  });

  $('#lab-d').addEventListener('change', (e) => setDistance(Number(e.target.value), false));

  const pInput = $('#lab-p');
  const pOut = $('#lab-p-out');
  pInput.addEventListener('input', () => { pOut.textContent = `${pInput.value}%`; });

  $('#lab-random').addEventListener('click', () => {
    const p = Number(pInput.value) / 100;
    state.err = emptyError(state.code.n);
    for (let q = 0; q < state.code.n; q++) {
      const u = rng();
      if (u < p) applyPauli(state.err, q, ['X', 'Z', 'Y'][Math.floor((u / p) * 3)]);
    }
    state.result = null;
    render();
  });

  decodeBtn.addEventListener('click', () => {
    if (state.result) {
      state.err = state.result.residual;
      state.result = null;
    } else {
      state.result = decodeSurface(state.code, state.err);
    }
    render();
  });

  $('#lab-clear').addEventListener('click', () => {
    state.err = emptyError(state.code.n);
    state.result = null;
    render();
  });

  setDistance(Number($('#lab-d').value), true);
}

// ---------------------------------------------------------------------------
// Threshold simulator
// ---------------------------------------------------------------------------

const P_GRID = [0.02, 0.04, 0.06, 0.08, 0.10, 0.12, 0.14, 0.16];

function initSimulator() {
  const form = $('#sim-form');
  const chart = $('#sim-chart');
  const progress = $('#sim-progress');
  const runBtn = $('#sim-run');
  let runId = 0;

  const W = 640;
  const H = 400;
  const M = { l: 62, r: 54, t: 18, b: 50 };
  const xMin = 0;
  const xMax = 0.17;

  function drawChart(series, trials) {
    const labels = [];
    const yMin = Math.pow(10, Math.floor(Math.log10(1 / (trials * 2))));
    const yMax = 1;
    const sx = (p) => M.l + ((p - xMin) / (xMax - xMin)) * (W - M.l - M.r);
    const sy = (v) => {
      const lv = Math.log10(Math.max(v, yMin));
      return M.t + (1 - (lv - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin))) * (H - M.t - M.b);
    };
    chart.setAttribute('viewBox', `0 0 ${W} ${H}`);
    chart.replaceChildren();

    for (let e = Math.log10(yMin); e <= 0; e++) {
      const y = sy(10 ** e);
      svg('line', { x1: M.l, x2: W - M.r, y1: y, y2: y, class: 'grid' }, chart);
      svg('text', { x: M.l - 8, y: y + 4, 'text-anchor': 'end' }, chart).textContent = e === 0 ? '1' : `10${String(e).split('').map((ch) => SUPERSCRIPT[ch]).join('')}`;
    }
    for (const p of [0, 0.04, 0.08, 0.12, 0.16]) {
      const x = sx(p);
      svg('line', { x1: x, x2: x, y1: M.t, y2: H - M.b, class: 'grid' }, chart);
      svg('text', { x, y: H - M.b + 18, 'text-anchor': 'middle' }, chart).textContent = `${Math.round(p * 100)}%`;
    }
    svg('line', { x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b, class: 'axis' }, chart);
    svg('line', { x1: M.l, x2: M.l, y1: M.t, y2: H - M.b, class: 'axis' }, chart);
    svg('text', { x: (M.l + W - M.r) / 2, y: H - 8, 'text-anchor': 'middle', class: 'axis-title' }, chart).textContent = 'Physical error rate p';
    svg('text', { x: 14, y: (M.t + H - M.b) / 2, 'text-anchor': 'middle', class: 'axis-title', transform: `rotate(-90 14 ${(M.t + H - M.b) / 2})` }, chart).textContent = 'Logical error rate';

    // Break-even reference: an unencoded qubit fails with probability p.
    const be = [xMin + 0.005, xMax].map((p) => `${sx(p)},${sy(p)}`);
    svg('path', { d: `M${be[0]} L${be[1]}`, class: 'grid', 'stroke-dasharray': '4 4' }, chart);
    svg('text', { x: sx(0.03), y: sy(0.03) - 8 }, chart).textContent = 'unencoded';

    if (!series.length) {
      svg('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'empty' }, chart).textContent = 'Select at least one distance and run the simulation.';
      return;
    }

    series.forEach((s, idx) => {
      const cls = `s${idx + 1}`;
      const pts = s.points.filter((pt) => pt.done);
      if (!pts.length) return;
      const upper = pts.map((pt) => `${sx(pt.p)},${sy(pt.hi)}`);
      const lower = pts.slice().reverse().map((pt) => `${sx(pt.p)},${sy(pt.lo)}`);
      svg('path', { d: `M${upper.join(' L')} L${lower.join(' L')} Z`, class: `band ${cls}` }, chart);
      const visible = pts.filter((pt) => pt.rate > 0);
      if (visible.length > 1) {
        svg('path', { d: `M${visible.map((pt) => `${sx(pt.p)},${sy(pt.rate)}`).join(' L')}`, class: `line ${cls}` }, chart);
      }
      visible.forEach((pt) => {
        const c = svg('circle', { cx: sx(pt.p), cy: sy(pt.rate), r: 3.5, class: `pt ${cls}` }, chart);
        svg('title', {}, c).textContent = `d = ${s.d}, p = ${Math.round(pt.p * 100)}%: ${pt.failures} / ${pt.trials} failed`;
      });
      const last = visible[visible.length - 1];
      if (last) {
        labels.push({ x: sx(last.p) + 8, y: sy(last.rate) + 4, cls, text: `d=${s.d}` });
      }
    });
    // Spread end labels vertically so they never overlap.
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) {
      labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 14);
    }
    labels.forEach((l) => {
      svg('text', { x: l.x, y: l.y, class: `series-label ${l.cls}` }, chart).textContent = l.text;
    });
  }

  function run() {
    const id = ++runId;
    const model = $('#sim-model').value;
    const trials = Number($('#sim-trials').value);
    const seedRaw = Number($('#sim-seed').value);
    const seed = Number.isInteger(seedRaw) && seedRaw > 0 ? seedRaw : 2024;
    const ds = ['#sim-d3', '#sim-d5', '#sim-d7'].map((s) => $(s)).filter((el) => el.checked).map((el) => Number(el.value));
    const series = ds.map((d) => ({
      d,
      code: buildSurfaceCode(d),
      points: P_GRID.map((p) => ({ p, failures: 0, trials: 0, done: false })),
    }));
    drawChart(series, trials);
    if (!series.length) {
      progress.textContent = '';
      return;
    }
    const jobs = [];
    series.forEach((s, si) => s.points.forEach((pt, pi) => jobs.push([si, pi])));
    const rng = mulberry32(seed);
    let j = 0;
    runBtn.disabled = true;
    const started = performance.now();

    const step = () => {
      if (id !== runId) return;
      const until = performance.now() + 30;
      while (j < jobs.length && performance.now() < until) {
        const [si, pi] = jobs[j];
        const s = series[si];
        const pt = s.points[pi];
        const batch = Math.min(200, trials - pt.trials);
        pt.failures += runTrials(s.code, pt.p, batch, model, rng);
        pt.trials += batch;
        if (pt.trials >= trials) {
          pt.done = true;
          pt.rate = pt.failures / pt.trials;
          [pt.lo, pt.hi] = wilson(pt.failures, pt.trials);
          j++;
        }
      }
      drawChart(series, trials);
      if (j < jobs.length) {
        progress.textContent = `Simulating… ${Math.round((j / jobs.length) * 100)}%`;
        setTimeout(step, 0);
      } else {
        runBtn.disabled = false;
        const secs = ((performance.now() - started) / 1000).toFixed(1);
        progress.textContent = `${fmtInt(jobs.length * trials)} decodes in ${secs} s · seed ${seed}`;
      }
    };
    step();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    run();
  });
  run();
}

// ---------------------------------------------------------------------------
// Syndrome calculator
// ---------------------------------------------------------------------------

function initSyndrome() {
  const codeSel = $('#syn-code');
  const input = $('#syn-error');
  const msg = $('#syn-error-msg');
  const rows = $('#syn-rows');
  const bits = $('#syn-bits');
  const diag = $('#syn-diagnosis');
  const note = $('#syn-note');

  function pauliSpan(str, error) {
    const wrap = html('span', { class: 'pstr' });
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const el = html('span', { class: `p${ch}` }, ch);
      if (error && ch !== 'I' && error[i] !== 'I' && ch !== error[i]) el.classList.add('hit');
      wrap.appendChild(el);
    }
    return wrap;
  }

  function update() {
    const code = CODES[codeSel.value];
    const n = codeLength(code);
    const error = normalizePauli(input.value);
    note.textContent = `${code.params}: ${code.note}`;
    if (!isPauliString(error, n)) {
      input.setAttribute('aria-invalid', 'true');
      msg.textContent = !isPauliString(error)
        ? 'Use only the letters I, X, Y and Z.'
        : `This code has ${n} qubits. Enter exactly ${n} letters (you entered ${error.length}).`;
      return;
    }
    input.removeAttribute('aria-invalid');
    msg.textContent = '';
    const s = syndrome(code, error);
    bits.textContent = s.join('');

    rows.replaceChildren(...code.stabilizers.map((stab, i) => {
      const tr = html('tr');
      tr.appendChild(html('td', {}, `S${sub(i + 1)}`));
      const td = html('td');
      td.appendChild(pauliSpan(stab, error));
      tr.appendChild(td);
      const anti = !commutes(stab, error);
      tr.appendChild(html('td', { class: `bit bit-${anti ? 1 : 0}` }, anti ? '1 · anticommutes' : '0 · commutes'));
      return tr;
    }));

    const key = s.join('');
    const weight = [...error].filter((ch) => ch !== 'I').length;
    if (weight === 0) {
      diag.textContent = 'No error. Every check returns 0.';
    } else if (!key.includes('1')) {
      diag.textContent = 'Zero syndrome but a non-trivial error. It commutes with every stabilizer, so it is either a stabilizer itself (harmless) or a logical operator that the code cannot detect.';
    } else {
      const matches = singleQubitTable(code).get(key) || [];
      if (matches.length === 1) {
        const m = matches[0];
        diag.textContent = `Matches a single ${m.pauli} error on qubit ${m.qubit}. A lookup decoder applies ${m.pauli}${sub(m.qubit)} to undo it${weight > 1 ? ', which fails if the real error has more than one qubit' : ''}.`;
      } else if (matches.length > 1) {
        diag.textContent = `Several single-qubit errors share this syndrome: ${matches.map((m) => `${m.pauli}${sub(m.qubit)}`).join(', ')}. In a degenerate code like Shor's they differ by a stabilizer, so correcting any one of them works.`;
      } else {
        diag.textContent = 'No single-qubit error produces this syndrome, so at least two qubits are affected. A distance-3 code cannot reliably correct it.';
      }
    }
  }

  function setRandomSingle() {
    const n = codeLength(CODES[codeSel.value]);
    const q = Math.floor(Math.random() * n);
    const p = ['X', 'Y', 'Z'][Math.floor(Math.random() * 3)];
    input.value = 'I'.repeat(q) + p + 'I'.repeat(n - q - 1);
    update();
  }

  codeSel.addEventListener('change', () => {
    const n = codeLength(CODES[codeSel.value]);
    const mid = Math.floor(n / 2);
    input.value = 'I'.repeat(mid) + 'X' + 'I'.repeat(n - mid - 1);
    update();
  });
  input.addEventListener('input', update);
  $('#syn-form').addEventListener('submit', (e) => e.preventDefault());
  $('#syn-random').addEventListener('click', setRandomSingle);
  $('#syn-reset').addEventListener('click', () => {
    input.value = 'I'.repeat(codeLength(CODES[codeSel.value]));
    update();
  });
  update();
}

// ---------------------------------------------------------------------------
// Resource estimator
// ---------------------------------------------------------------------------

function initEstimator() {
  const form = $('#est-form');
  const msg = $('#est-msg');
  const kpis = $('#est-kpis');
  const rows = $('#est-rows');
  const num = (id) => Number($(id).value);

  function kpi(label, value, main) {
    const div = html('div', main ? { class: 'kpi-main' } : {});
    div.appendChild(html('dt', {}, label));
    div.appendChild(html('dd', {}, value));
    return div;
  }

  function update() {
    const v = {
      p: num('#est-p'),
      pth: num('#est-pth'),
      A: num('#est-a'),
      logicalQubits: num('#est-n'),
      cycles: num('#est-cycles'),
      budget: num('#est-budget'),
      cycleTimeUs: num('#est-cycle'),
    };
    const problems = [];
    if (!(v.p > 0)) problems.push('physical error rate must be above 0');
    if (!(v.pth > 0)) problems.push('threshold must be above 0');
    if (!(v.A > 0)) problems.push('prefactor must be above 0');
    if (!Number.isInteger(v.logicalQubits) || v.logicalQubits < 1) problems.push('logical qubits must be a whole number of at least 1');
    if (!(v.cycles >= 1)) problems.push('code cycles must be at least 1');
    if (!(v.budget > 0 && v.budget < 1)) problems.push('failure budget must be between 0 and 1');
    if (!(v.cycleTimeUs > 0)) problems.push('cycle time must be above 0');
    if (problems.length) {
      msg.textContent = `Check the inputs: ${problems.join('; ')}.`;
      return;
    }

    const est = estimateResources(v);
    if (est.d === null) {
      msg.textContent = v.p >= v.pth
        ? 'The physical error rate is at or above threshold. Adding distance makes things worse, so no code size reaches the target.'
        : 'The target needs a distance above 201. Lower the physical error rate or relax the budget.';
      kpis.replaceChildren(kpi('Target p_L per qubit per cycle', fmtSci(est.target)), kpi('Code distance', 'none', true));
    } else {
      msg.textContent = '';
      kpis.replaceChildren(
        kpi('Code distance', `d = ${est.d}`, true),
        kpi('Total physical qubits', fmtInt(est.total), true),
        kpi('Target p_L per qubit per cycle', fmtSci(est.target)),
        kpi('Suppression Λ per d + 2', `${Number(est.lambda.toPrecision(3))}×`),
        kpi('Qubits per logical qubit', fmtInt(est.perLogical)),
        kpi('Wall-clock time', fmtDuration(est.runtimeSeconds)),
      );
    }

    const top = est.d === null ? 25 : Math.min(est.d + 6, 99);
    const trs = [];
    for (let d = 3; d <= top; d += 2) {
      const pL = logicalErrorRate(v.p, d, { pth: v.pth, A: v.A });
      const tr = html('tr', d === est.d ? { class: 'is-choice' } : {});
      tr.appendChild(html('td', { class: 'mono' }, String(d)));
      tr.appendChild(html('td', { class: 'mono' }, fmtSci(pL)));
      tr.appendChild(html('td', { class: 'mono' }, fmtInt(physicalQubitsPerLogical(d))));
      tr.appendChild(html('td', {}, pL <= est.target ? (d === est.d ? 'Yes · smallest' : 'Yes') : 'No'));
      trs.push(tr);
    }
    rows.replaceChildren(...trs);
  }

  form.addEventListener('input', update);
  form.addEventListener('submit', (e) => e.preventDefault());
  update();
}

// ---------------------------------------------------------------------------

initTheme();
initLab();
initSyndrome();
initEstimator();
initSimulator();
