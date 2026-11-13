import test from 'node:test';
import assert from 'node:assert/strict';
import { SCALE_MODES, applyScale, autoLevels, stretch } from '../public/viewer-scales.js';

function pixels(values) {
  const rgba = new Uint8ClampedArray(values.length * 4);
  values.forEach((value, i) => {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = value;
    rgba[i * 4 + 3] = 255;
  });
  return rgba;
}

test('all requested scale modes preserve the black/white endpoints', () => {
  assert.deepEqual(SCALE_MODES.map(([mode]) => mode),
    ['linear', 'log', 'power', 'sqrt', 'squared', 'asinh', 'sinh', 'histogram']);
  for (const [mode] of SCALE_MODES) {
    if (mode === 'histogram') continue;
    assert.ok(Math.abs(stretch(mode, 0)) < 1e-12, mode);
    assert.ok(Math.abs(stretch(mode, 1) - 1) < 1e-12, mode);
    assert.ok(stretch(mode, 0.5) >= 0 && stretch(mode, 0.5) <= 1, mode);
  }
});

test('stretch functions have the expected normalized values', () => {
  assert.equal(stretch('sqrt', 0.25), 0.5);
  assert.equal(stretch('squared', 0.5), 0.25);
  assert.equal(stretch('log', 0.5), Math.log1p(500) / Math.log1p(1000));
  assert.equal(stretch('power', 0.5), (1000 ** 0.5 - 1) / 999);
  assert.equal(stretch('asinh', 0.5), Math.asinh(5) / Math.asinh(10));
  assert.equal(stretch('sinh', 0.5), Math.sinh(1.5) / Math.sinh(3));
  assert.equal(stretch('linear', -1), 0);
  assert.equal(stretch('linear', 2), 1);
});

test('rendering applies scale, black/white, brightness, contrast, and gamma', () => {
  const data = pixels([0, 64, 128, 255]);
  applyScale(data, { mode: 'sqrt', black: 0, white: 255, brightness: 0, contrast: 1, gamma: 1 });
  assert.equal(data[0], 0);
  assert.equal(data[4], Math.round(Math.sqrt(64 / 255) * 255));
  assert.equal(data[12], 255);
  const constrained = pixels([0, 255]);
  applyScale(constrained, { mode: 'histogram', black: 128, white: 128 });
  assert.equal(constrained[0], 0);
  assert.equal(constrained[4], 0);
});

test('histogram equalization distributes distinct intensity levels monotonically', () => {
  const data = pixels([0, 0, 0, 0, 100, 100, 150, 200, 255]);
  applyScale(data, { mode: 'histogram', black: 0, white: 255 });
  const intensities = [...new Set(Array.from({ length: data.length / 4 }, (_, i) => data[i * 4]))];
  assert.deepEqual([...intensities].sort((a, b) => a - b), intensities);
  assert.equal(intensities[0], 0);
  assert.equal(intensities[intensities.length - 1], 255);
  assert.ok(data[4 * 4] > data[0]);
});

test('min/max examines every pixel and handles constant images', () => {
  const values = [20, 30, 250, 60];
  assert.deepEqual(autoLevels(pixels(values), 'minmax'), { black: 20, white: 250 });
  assert.deepEqual(autoLevels(pixels([40, 40]), 'minmax'), { black: 40, white: 40 });
});

test('ZScale returns usable finite limits for uniform ramps and flat data', () => {
  const ramp = pixels(Array.from({ length: 1024 }, (_, index) => index % 256));
  const limits = autoLevels(ramp);
  assert.ok(Number.isFinite(limits.black) && Number.isFinite(limits.white));
  assert.ok(limits.black >= 0 && limits.black < limits.white && limits.white <= 255);
  assert.deepEqual(autoLevels(pixels(Array(100).fill(80))), { black: 80, white: 80 });
});
