/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE,
	AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE,
	normalizeProjectSampleRate,
} from '../src/common/editor/project-foundation-validation.ts';

test('project factories share the exact admitted sample-rate bounds', () => {
	assert.equal(normalizeProjectSampleRate(AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE), 8_000);
	assert.equal(normalizeProjectSampleRate(AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE), 768_000);
	for (const value of [0, 7_999, 768_001, 48_000.5, '48000']) {
		assert.throws(() => normalizeProjectSampleRate(value), /project\.sampleRate/u);
	}
});
