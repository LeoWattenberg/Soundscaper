/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { nyquistMaximumOutputFrames } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts';

test('a Nyquist generator can render its requested duration within the existing hard limit', () => {
	assert.equal(nyquistMaximumOutputFrames({ sampleRate: 48_000, inputFrames: 0,
		preview: false, generate: true }), 48_000 * 300);
	assert.equal(nyquistMaximumOutputFrames({ sampleRate: 48_000, inputFrames: 0,
		preview: true, generate: true }), 48_000 * 6);
	assert.equal(nyquistMaximumOutputFrames({ sampleRate: 48_000, inputFrames: 0,
		preview: false, generate: true, requested: 48_000 * 90 }), 48_000 * 90);
});

test('existing process inference and explicit generator ceilings remain bounded', () => {
	assert.equal(nyquistMaximumOutputFrames({ sampleRate: 48_000, inputFrames: 48_000,
		preview: false }), 48_000 * 60);
	assert.equal(nyquistMaximumOutputFrames({ sampleRate: 48_000, inputFrames: 0,
		preview: false, generate: true, requested: 48_000 * 600 }), 48_000 * 300);
});
