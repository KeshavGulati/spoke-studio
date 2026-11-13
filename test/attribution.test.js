import test from 'node:test';
import assert from 'node:assert/strict';
import { maskAttribution } from '../public/attribution.js';

const owner = { username: 'Alice', user_id: '0123456789abcdef0123456789abcdef', timestamp: '2026-11-13T10:30:00.000Z' };

test('saved masks show the contributor and complete ID on hover', () => {
  const result = maskAttribution({ saved: true, mask_attribution: owner });
  assert.equal(result.hidden, false);
  assert.equal(result.text, 'Mask saved by Alice');
  assert.ok(result.title.includes('0123456789abcdef0123456789abcdef'));
  assert.ok(result.title.includes(new Date(owner.timestamp).toLocaleString()));
});

test('unsaved edits do not misattribute unsaved changes', () => {
  const result = maskAttribution({ saved: true, mask_attribution: owner }, { dirty: true });
  assert.equal(result.text, 'Unsaved edits · Last saved by Alice');
});

test('the badge hides when the mask is hidden or no frame is loaded', () => {
  assert.equal(maskAttribution({ saved: true, mask_attribution: owner }, { visible: false }).hidden, true);
  assert.equal(maskAttribution(null).hidden, true);
});

test('older saved masks and unsaved masks have distinct messages', () => {
  assert.equal(maskAttribution({ saved: true }).text, 'Saved mask · contributor unknown');
  assert.equal(maskAttribution({ saved: false }).text, 'No saved mask');
  assert.equal(maskAttribution({ saved: false }, { dirty: true }).text, 'Unsaved new mask');
});
