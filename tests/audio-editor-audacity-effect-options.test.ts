/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { audacityAdvancedParameters } from '../src/common/editor/ui/inspector/audacity-effect-options.ts';

test('processing options absent from the Qt views stay reachable through their existing effect menu', () => {
	assert.deepEqual(audacityAdvancedParameters('audacity-filter-curve-eq'), ['filterLength']);
	assert.deepEqual(audacityAdvancedParameters('audacity-graphic-eq'), ['interpolation', 'filterLength']);
	for (const type of ['audacity-change-pitch', 'audacity-sliding-stretch']) {
		assert.deepEqual(audacityAdvancedParameters(type), ['preserveFormants']);
	}
	assert.deepEqual(audacityAdvancedParameters('noise-gate'), ['lookahead']);
	assert.deepEqual(audacityAdvancedParameters('multi-tap-delay'), ['mix']);
	assert.deepEqual(audacityAdvancedParameters('vocoder'), ['outputGain']);
	for (const type of ['eq', 'audacity-compressor', 'audacity-reverb', 'highpass-filter', 'tremolo']) {
		assert.deepEqual(audacityAdvancedParameters(type), []);
	}
});
