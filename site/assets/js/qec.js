// Core quantum error correction logic. Pure functions, no DOM access,
// so the same module runs in the browser and under `node --test`.

// ---------------------------------------------------------------------------
// Pauli algebra
// ---------------------------------------------------------------------------

const PAULI_RE = /^[IXYZ]+$/;

export function normalizePauli(input) {
  return String(input).replace(/[\s_·]/g, '').toUpperCase();
}

export function isPauliString(s, length) {
  return PAULI_RE.test(s) && (length === undefined || s.length === length);
}

// Two Pauli strings commute when they differ (both non-identity) on an even
// number of positions.
export function commutes(a, b) {
  if (a.length !== b.length) throw new RangeError('Pauli strings must have equal length');
  let anti = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== 'I' && b[i] !== 'I' && a[i] !== b[i]) anti ^= 1;
  }
  return anti === 0;
}

// Multiply single-qubit Paulis, ignoring global phase.
const TO_BITS = { I: [0, 0], X: [1, 0], Z: [0, 1], Y: [1, 1] };
const FROM_BITS = ['I', 'Z', 'X', 'Y']; // index = x * 2 + z

export function multiplyPauli(a, b) {
  const [ax, az] = TO_BITS[a];
  const [bx, bz] = TO_BITS[b];
  return FROM_BITS[(ax ^ bx) * 2 + (az ^ bz)];
}

// ---------------------------------------------------------------------------
// Small stabilizer codes
// ---------------------------------------------------------------------------

export const CODES = {
  bitflip: {
    name: '3-qubit bit-flip code',
    params: '[[3,1,1]]',
    note: 'Corrects any single X error; blind to Z errors.',
    stabilizers: ['ZZI', 'IZZ'],
  },
  five: {
    name: 'Five-qubit code',
    params: '[[5,1,3]]',
    note: 'Smallest code that corrects an arbitrary single-qubit error.',
    stabilizers: ['XZZXI', 'IXZZX', 'XIXZZ', 'ZXIXZ'],
  },
  steane: {
    name: 'Steane code',
    params: '[[7,1,3]]',
    note: 'CSS code built from the classical [7,4,3] Hamming code.',
    stabilizers: ['IIIXXXX', 'IXXIIXX', 'XIXIXIX', 'IIIZZZZ', 'IZZIIZZ', 'ZIZIZIZ'],
  },
  shor: {
    name: 'Shor code',
    params: '[[9,1,3]]',
    note: 'Concatenates the bit-flip and phase-flip repetition codes.',
    stabilizers: [
      'ZZIIIIIII', 'IZZIIIIII', 'IIIZZIIII', 'IIIIZZIII', 'IIIIIIZZI', 'IIIIIIIZZ',
      'XXXXXXIII', 'IIIXXXXXX',
    ],
  },
};

export function codeLength(code) {
  return code.stabilizers[0].length;
}

// Syndrome bit i is 1 when the error anticommutes with stabilizer i.
export function syndrome(code, error) {
  const n = codeLength(code);
  if (!isPauliString(error, n)) {
    throw new RangeError(`Error must be ${n} characters from I, X, Y, Z`);
  }
  return code.stabilizers.map((s) => (commutes(s, error) ? 0 : 1));
}

// Every weight-1 error grouped by the syndrome it produces.
export function singleQubitTable(code) {
  const n = codeLength(code);
  const table = new Map();
  for (let q = 0; q < n; q++) {
    for (const p of ['X', 'Y', 'Z']) {
      const err = 'I'.repeat(q) + p + 'I'.repeat(n - q - 1);
      const key = syndrome(code, err).join('');
      if (!table.has(key)) table.set(key, []);
      table.get(key).push({ qubit: q + 1, pauli: p, error: err });
    }
  }
  return table;
}

// ---------------------------------------------------------------------------
// Rotated surface code
// ---------------------------------------------------------------------------
// Data qubit (r, c) sits on a d x d grid. Stabilizer (i, j), 0 <= i, j <= d,
// sits on the face whose corners are qubits (i-1, j-1) .. (i, j). Face type
// alternates X / Z; weight-2 X faces close the top and bottom boundaries and
// weight-2 Z faces close the left and right boundaries. Logical X is a
// vertical string of X, logical Z a horizontal string of Z.

export function buildSurfaceCode(d) {
  if (!Number.isInteger(d) || d < 3 || d % 2 === 0) {
    throw new RangeError('Distance must be an odd integer of at least 3');
  }
  const stabilizers = [];
  for (let i = 0; i <= d; i++) {
    for (let j = 0; j <= d; j++) {
      const type = (i + j) % 2 === 0 ? 'X' : 'Z';
      const bulk = i > 0 && i < d && j > 0 && j < d;
      const topBottom = (i === 0 || i === d) && j > 0 && j < d && type === 'X';
      const leftRight = (j === 0 || j === d) && i > 0 && i < d && type === 'Z';
      if (!bulk && !topBottom && !leftRight) continue;
      const qubits = [];
      for (const [r, c] of [[i - 1, j - 1], [i - 1, j], [i, j - 1], [i, j]]) {
        if (r >= 0 && r < d && c >= 0 && c < d) qubits.push(r * d + c);
      }
      stabilizers.push({ id: stabilizers.length, type, i, j, qubits });
    }
  }
  const code = { d, n: d * d, stabilizers };
  // Z-type checks detect X errors and vice versa.
  code.graphs = {
    X: buildDecodingGraph(code, 'Z'),
    Z: buildDecodingGraph(code, 'X'),
  };
  return code;
}

// Decoding graph: one node per check of `checkType`, plus a single boundary
// node. Each data qubit is an edge between the (one or two) checks it touches.
function buildDecodingGraph(code, checkType) {
  const checks = code.stabilizers.filter((s) => s.type === checkType);
  const m = checks.length;
  const boundary = m;
  const adj = Array.from({ length: m + 1 }, () => []);
  const touching = Array.from({ length: code.n }, () => []);
  checks.forEach((s, local) => s.qubits.forEach((q) => touching[q].push(local)));
  for (let q = 0; q < code.n; q++) {
    const t = touching[q];
    if (t.length === 2) {
      adj[t[0]].push([t[1], q]);
      adj[t[1]].push([t[0], q]);
    } else if (t.length === 1) {
      adj[t[0]].push([boundary, q]);
      adj[boundary].push([t[0], q]);
    }
  }
  // All-pairs shortest paths by BFS (unit edge weights).
  const dist = [];
  const parent = [];
  for (let s = 0; s <= m; s++) {
    const ds = new Array(m + 1).fill(Infinity);
    const ps = new Array(m + 1).fill(null);
    ds[s] = 0;
    const queue = [s];
    for (let h = 0; h < queue.length; h++) {
      const u = queue[h];
      for (const [v, q] of adj[u]) {
        if (ds[v] === Infinity) {
          ds[v] = ds[u] + 1;
          ps[v] = [u, q];
          queue.push(v);
        }
      }
    }
    dist.push(ds);
    parent.push(ps);
  }
  return { checkType, checks, m, boundary, dist, parent };
}

function pathQubits(graph, s, t) {
  const qubits = [];
  let v = t;
  while (v !== s) {
    const step = graph.parent[s][v];
    if (!step) throw new Error('Decoding graph is disconnected');
    qubits.push(step[1]);
    v = step[0];
  }
  return qubits;
}

// Errors are stored per qubit as two bit arrays: x[q] and z[q].
export function emptyError(n) {
  return { x: new Uint8Array(n), z: new Uint8Array(n) };
}

export function pauliAt(err, q) {
  return FROM_BITS[err.x[q] * 2 + err.z[q]];
}

export function applyPauli(err, q, p) {
  const [px, pz] = TO_BITS[p];
  err.x[q] ^= px;
  err.z[q] ^= pz;
}

// Returns, for every stabilizer, 1 when it anticommutes with the error.
export function surfaceSyndrome(code, err) {
  return code.stabilizers.map((s) => {
    const bits = s.type === 'X' ? err.z : err.x;
    let parity = 0;
    for (const q of s.qubits) parity ^= bits[q];
    return parity;
  });
}

const EXACT_MATCHING_LIMIT = 12;

// Minimum-weight matching of defects to each other or to the boundary.
// Exact (bitmask dynamic programming) up to EXACT_MATCHING_LIMIT defects,
// greedy shortest-pair-first above that.
function matchDefects(graph, defects) {
  const k = defects.length;
  const B = graph.boundary;
  const pairs = [];
  if (k === 0) return { pairs, exact: true };

  if (k <= EXACT_MATCHING_LIMIT) {
    const size = 1 << k;
    const cost = new Float64Array(size).fill(Infinity);
    const choice = new Int8Array(size).fill(-2);
    const full = size - 1;
    cost[full] = 0;
    for (let mask = full - 1; mask >= 0; mask--) {
      let i = 0;
      while (mask & (1 << i)) i++;
      const bi = 1 << i;
      let best = graph.dist[defects[i]][B] + cost[mask | bi];
      let pick = -1;
      for (let j = i + 1; j < k; j++) {
        const bj = 1 << j;
        if (mask & bj) continue;
        const c = graph.dist[defects[i]][defects[j]] + cost[mask | bi | bj];
        if (c < best) {
          best = c;
          pick = j;
        }
      }
      cost[mask] = best;
      choice[mask] = pick;
    }
    let mask = 0;
    while (mask !== full) {
      let i = 0;
      while (mask & (1 << i)) i++;
      const j = choice[mask];
      if (j === -1) {
        pairs.push([defects[i], B]);
        mask |= 1 << i;
      } else {
        pairs.push([defects[i], defects[j]]);
        mask |= (1 << i) | (1 << j);
      }
    }
    return { pairs, exact: true };
  }

  const candidates = [];
  for (let a = 0; a < k; a++) {
    candidates.push([graph.dist[defects[a]][B], a, -1]);
    for (let b = a + 1; b < k; b++) {
      candidates.push([graph.dist[defects[a]][defects[b]], a, b]);
    }
  }
  candidates.sort((u, v) => u[0] - v[0] || u[1] - v[1] || u[2] - v[2]);
  const used = new Uint8Array(k);
  for (const [, a, b] of candidates) {
    if (used[a]) continue;
    if (b === -1) {
      used[a] = 1;
      pairs.push([defects[a], B]);
    } else if (!used[b]) {
      used[a] = used[b] = 1;
      pairs.push([defects[a], defects[b]]);
    }
  }
  return { pairs, exact: false };
}

// Decode one error type ('X' or 'Z') from the full stabilizer syndrome.
function decodeType(code, synd, errType) {
  const graph = code.graphs[errType];
  const defects = [];
  graph.checks.forEach((s, local) => {
    if (synd[s.id]) defects.push(local);
  });
  const { pairs, exact } = matchDefects(graph, defects);
  const flips = new Uint8Array(code.n);
  for (const [a, b] of pairs) {
    for (const q of pathQubits(graph, a, b)) flips[q] ^= 1;
  }
  return { flips, exact, defects: defects.length };
}

// Full decode: returns the correction, the residual error and whether the
// residual is a logical operator.
export function decodeSurface(code, err) {
  const synd = surfaceSyndrome(code, err);
  const dx = decodeType(code, synd, 'X');
  const dz = decodeType(code, synd, 'Z');
  const correction = { x: dx.flips, z: dz.flips };
  const residual = emptyError(code.n);
  for (let q = 0; q < code.n; q++) {
    residual.x[q] = err.x[q] ^ correction.x[q];
    residual.z[q] = err.z[q] ^ correction.z[q];
  }
  const logical = logicalFlips(code, residual);
  return { correction, residual, logical, exact: dx.exact && dz.exact };
}

// For an error with trivial syndrome: logical X flips when it anticommutes
// with logical Z (row 0); logical Z flips when it anticommutes with logical X
// (column 0).
export function logicalFlips(code, err) {
  const { d } = code;
  let lx = 0;
  let lz = 0;
  for (let c = 0; c < d; c++) lx ^= err.x[c];
  for (let r = 0; r < d; r++) lz ^= err.z[r * d];
  return { X: lx === 1, Z: lz === 1 };
}

// ---------------------------------------------------------------------------
// Noise and Monte Carlo
// ---------------------------------------------------------------------------

export const NOISE_MODELS = {
  bitflip: 'Bit flip (X with probability p)',
  phaseflip: 'Phase flip (Z with probability p)',
  depolarizing: 'Depolarizing (X, Y, Z each with p/3)',
};

// Deterministic 32-bit PRNG so simulations are reproducible from a seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleError(n, p, model, rng) {
  const err = emptyError(n);
  for (let q = 0; q < n; q++) {
    const u = rng();
    if (u >= p) continue;
    if (model === 'bitflip') err.x[q] = 1;
    else if (model === 'phaseflip') err.z[q] = 1;
    else if (model === 'depolarizing') {
      const k = Math.floor((u / p) * 3);
      if (k === 0) err.x[q] = 1;
      else if (k === 1) err.z[q] = 1;
      else { err.x[q] = 1; err.z[q] = 1; }
    } else throw new RangeError(`Unknown noise model: ${model}`);
  }
  return err;
}

export function runTrials(code, p, trials, model, rng) {
  let failures = 0;
  for (let t = 0; t < trials; t++) {
    const err = sampleError(code.n, p, model, rng);
    const { logical } = decodeSurface(code, err);
    if (logical.X || logical.Z) failures++;
  }
  return failures;
}

// Wilson score interval (95%) for a binomial proportion.
export function wilson(failures, trials, z = 1.96) {
  if (trials === 0) return [0, 1];
  const phat = failures / trials;
  const denom = 1 + (z * z) / trials;
  const centre = phat + (z * z) / (2 * trials);
  const spread = z * Math.sqrt((phat * (1 - phat)) / trials + (z * z) / (4 * trials * trials));
  return [Math.max(0, (centre - spread) / denom), Math.min(1, (centre + spread) / denom)];
}

// ---------------------------------------------------------------------------
// Resource estimation (surface code scaling heuristic)
// ---------------------------------------------------------------------------
// p_L(d) ~= A * (p / p_th)^((d + 1) / 2) per logical qubit per code cycle.

export function logicalErrorRate(p, d, { pth = 0.01, A = 0.1 } = {}) {
  return A * Math.pow(p / pth, (d + 1) / 2);
}

export function requiredDistance(p, target, opts = {}, maxD = 201) {
  const pth = opts.pth ?? 0.01;
  if (!(p > 0) || !(target > 0) || p >= pth) return null;
  for (let d = 3; d <= maxD; d += 2) {
    if (logicalErrorRate(p, d, opts) <= target) return d;
  }
  return null;
}

// Rotated surface code: d^2 data qubits + d^2 - 1 measurement qubits.
export function physicalQubitsPerLogical(d) {
  return 2 * d * d - 1;
}

export function estimateResources({ p, pth, A, logicalQubits, cycles, budget, cycleTimeUs }) {
  const target = budget / (logicalQubits * cycles);
  const d = requiredDistance(p, target, { pth, A });
  if (d === null) return { target, d: null };
  const perLogical = physicalQubitsPerLogical(d);
  return {
    target,
    d,
    lambda: pth / p,
    pL: logicalErrorRate(p, d, { pth, A }),
    perLogical,
    total: perLogical * logicalQubits,
    runtimeSeconds: (cycles * cycleTimeUs) / 1e6,
  };
}
