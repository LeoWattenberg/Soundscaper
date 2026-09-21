/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	normalizeSelectionEffectWorkerContext,
} from '../src/common/editor/selection-effects-worker-context.ts';

test('selection effect workers admit only non-executable context fields', () => {
	const normalized = normalizeSelectionEffectWorkerContext({
		afterChannels: [[3, 4]],
		beforeChannels: [Float32Array.of(1, 2)],
		controlChannels: [[5, 6]],
		effectId: 'effect-1',
		noiseProfile: { bands: [1] },
		spectralSelection: { minimumFrequency: 100 },
		staffPadRuntime: { createSession() {} },
		staffPadWasmSource: Uint8Array.of(0, 97, 115, 109),
	});

	assert.deepEqual(normalized, {
		afterChannels: [Float32Array.of(3, 4)],
		beforeChannels: [Float32Array.of(1, 2)],
		controlChannels: [Float32Array.of(5, 6)],
		effectId: 'effect-1',
		noiseProfile: { bands: [1] },
		spectralSelection: { minimumFrequency: 100 },
	});
	assert.equal('staffPadRuntime' in normalized, false);
	assert.equal('staffPadWasmSource' in normalized, false);
});

test('selection effect worker context rejects malformed container values', () => {
	assert.deepEqual(normalizeSelectionEffectWorkerContext(null), {});
	assert.deepEqual(normalizeSelectionEffectWorkerContext('staffpad.wasm'), {});
});
