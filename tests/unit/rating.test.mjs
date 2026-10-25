// Unit tests for the PURE rating-prompt policy (src/rating.ts).
// Runs under plain `node --test`; imports dist/rating.mjs. Prereq: `npm run compile`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  recordActivation,
  shouldPrompt,
  applyChoice,
  MIN_ACTIVATIONS,
  MIN_AGE_MS,
  SNOOZE_MS,
  REVIEW_URL,
} from '../../dist/rating.mjs';

const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

// Simulate N activations, the last one at `now`.
function after(n, now) {
  let s;
  for (let i = 0; i < n; i++) s = recordActivation(s, i === 0 ? T0 : now);
  return s;
}

test('first activation creates state with firstSeen = now', () => {
  assert.deepEqual(recordActivation(undefined, T0), { activations: 1, firstSeen: T0 });
});

test('activations accumulate; firstSeen is kept', () => {
  assert.deepEqual(after(3, T0 + DAY), { activations: 3, firstSeen: T0 });
});

test('no prompt before MIN_ACTIVATIONS even when old enough', () => {
  const s = after(MIN_ACTIVATIONS - 1, T0 + 30 * DAY);
  assert.equal(shouldPrompt(s, T0 + 30 * DAY), false);
});

test('no prompt before MIN_AGE_MS even with many activations (one-day trial)', () => {
  const s = after(20, T0 + DAY);
  assert.equal(shouldPrompt(s, T0 + DAY), false);
});

test('prompts once both thresholds are met', () => {
  const now = T0 + MIN_AGE_MS;
  assert.equal(shouldPrompt(after(MIN_ACTIVATIONS, now), now), true);
});

test('"later" / dismiss snoozes for SNOOZE_MS, then prompts again', () => {
  const now = T0 + 10 * DAY;
  const s = applyChoice(after(MIN_ACTIVATIONS, now), 'later', now);
  assert.equal(shouldPrompt(s, now), false);
  assert.equal(shouldPrompt(s, now + SNOOZE_MS - 1), false);
  assert.equal(shouldPrompt(s, now + SNOOZE_MS), true);
  assert.deepEqual(applyChoice(after(MIN_ACTIVATIONS, now), undefined, now), s, 'dismiss == later');
});

test('"rate" and "never" end the prompt for good', () => {
  const now = T0 + 10 * DAY;
  for (const choice of ['rate', 'never']) {
    const s = applyChoice(after(MIN_ACTIVATIONS, now), choice, now);
    assert.equal(s.done, true);
    assert.equal(shouldPrompt(s, now + 365 * DAY), false, choice);
    assert.equal(shouldPrompt(recordActivation(s, now + 365 * DAY), now + 365 * DAY), false, choice);
  }
});

test('review URL targets the cimos.kicad-dru review tab', () => {
  assert.match(REVIEW_URL, /itemName=cimos\.kicad-dru/);
  assert.match(REVIEW_URL, /#review-details$/);
});
