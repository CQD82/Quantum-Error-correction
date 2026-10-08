import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODES, commutes, multiplyPauli, syndrome, singleQubitTable, codeLength,
  buildSurfaceCode, emptyError, applyPauli, surfaceSyndrome, decodeSurface,
  logicalFlips, mulberry32, runTrials, wilson, logicalErrorRate,
  requiredDistance, physicalQubitsPerLogical, estimateResources,
} from '../site/assets/js/qec.js';

test('Pauli commutation and multiplication', () => {
  assert.equal(commutes('XX', 'ZZ'), true);
  assert.equal(commutes('XI', 'ZI'), false);
  assert.equal(commutes('XYZ', 'XYZ'), true);
  assert.equal(multiplyPauli('X', 'Z'), 'Y');
  assert.equal(multiplyPauli('Y', 'Y'), 'I');
  assert.throws(() => commutes('X', 'XX'), RangeError);
});

test('small-code stabilizers commute with each other', () => {
  for (const [key, code] of Object.entries(CODES)) {
    for (const a of code.stabilizers) {
      for (const b of code.stabilizers) {
        assert.ok(commutes(a, b), `${key}: ${a} vs ${b}`);
      }
    }
  }
});

test('distance-3 codes give every single-qubit error a unique syndrome', () => {
  for (const key of ['five', 'steane']) {
    const table = singleQubitTable(CODES[key]);
    const n = codeLength(CODES[key]);
    assert.equal(table.size, 3 * n, key);
    assert.ok(!table.has('0'.repeat(CODES[key].stabilizers.length)), key);
  }
});

test('bit-flip code identifies each X error and rejects bad input', () => {
  assert.deepEqual(syndrome(CODES.bitflip, 'XII'), [1, 0]);
  assert.deepEqual(syndrome(CODES.bitflip, 'IXI'), [1, 1]);
  assert.deepEqual(syndrome(CODES.bitflip, 'IIX'), [0, 1]);
  assert.deepEqual(syndrome(CODES.bitflip, 'ZZZ'), [0, 0]);
  assert.throws(() => syndrome(CODES.bitflip, 'XI'), RangeError);
  assert.throws(() => syndrome(CODES.bitflip, 'XQI'), RangeError);
});

test('surface code has d^2 - 1 commuting stabilizers', () => {
  for (const d of [3, 5, 7, 9]) {
    const code = buildSurfaceCode(d);
    assert.equal(code.stabilizers.length, d * d - 1);
    for (const a of code.stabilizers) {
      for (const b of code.stabilizers) {
        if (a.type === b.type) continue;
        const shared = a.qubits.filter((q) => b.qubits.includes(q)).length;
        assert.equal(shared % 2, 0, `d=${d}`);
      }
    }
  }
  assert.throws(() => buildSurfaceCode(4), RangeError);
});

test('logical operators have trivial syndrome and flip the logical qubit', () => {
  const d = 5;
  const code = buildSurfaceCode(d);
  const xl = emptyError(code.n);
  for (let r = 0; r < d; r++) applyPauli(xl, r * d + 2, 'X');
  assert.ok(surfaceSyndrome(code, xl).every((b) => b === 0));
  assert.deepEqual(logicalFlips(code, xl), { X: true, Z: false });
  const zl = emptyError(code.n);
  for (let c = 0; c < d; c++) applyPauli(zl, 3 * d + c, 'Z');
  assert.ok(surfaceSyndrome(code, zl).every((b) => b === 0));
  assert.deepEqual(logicalFlips(code, zl), { X: false, Z: true });
});

test('decoder corrects every error of weight up to (d-1)/2', () => {
  for (const d of [3, 5]) {
    const code = buildSurfaceCode(d);
    const t = (d - 1) / 2;
    const singles = [];
    for (let q = 0; q < code.n; q++) for (const p of ['X', 'Y', 'Z']) singles.push([q, p]);
    const check = (ops) => {
      const err = emptyError(code.n);
      for (const [q, p] of ops) applyPauli(err, q, p);
      const { residual, logical } = decodeSurface(code, err);
      assert.ok(surfaceSyndrome(code, residual).every((b) => b === 0));
      assert.ok(!logical.X && !logical.Z, `d=${d} ops=${JSON.stringify(ops)}`);
    };
    for (const a of singles) check([a]);
    if (t >= 2) {
      for (let i = 0; i < singles.length; i++) {
        for (let j = i + 1; j < singles.length; j++) {
          if (singles[i][0] !== singles[j][0]) check([singles[i], singles[j]]);
        }
      }
    }
  }
});

test('larger codes suppress logical errors below threshold', () => {
  const p = 0.03;
  const trials = 3000;
  const f3 = runTrials(buildSurfaceCode(3), p, trials, 'bitflip', mulberry32(1));
  const f7 = runTrials(buildSurfaceCode(7), p, trials, 'bitflip', mulberry32(1));
  assert.ok(f7 < f3, `d=7 failures ${f7} should be below d=3 failures ${f3}`);
});

test('Wilson interval brackets the estimate', () => {
  const [lo, hi] = wilson(10, 100);
  assert.ok(lo < 0.1 && hi > 0.1 && lo >= 0 && hi <= 1);
  assert.deepEqual(wilson(0, 0), [0, 1]);
});

test('resource estimator', () => {
  assert.equal(physicalQubitsPerLogical(3), 17);
  assert.ok(Math.abs(logicalErrorRate(0.001, 3) - 0.1 * 0.01) < 1e-15);
  assert.equal(requiredDistance(0.02, 1e-9), null);
  const d = requiredDistance(0.001, 1e-12);
  assert.ok(logicalErrorRate(0.001, d) <= 1e-12);
  assert.ok(logicalErrorRate(0.001, d - 2) > 1e-12);
  const est = estimateResources({
    p: 0.001, pth: 0.01, A: 0.1, logicalQubits: 100, cycles: 1e8, budget: 0.01, cycleTimeUs: 1,
  });
  assert.equal(est.total, est.perLogical * 100);
  assert.ok(Math.abs(est.lambda - 10) < 1e-9);
  assert.equal(est.runtimeSeconds, 100);
});
