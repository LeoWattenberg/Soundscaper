import assert from 'node:assert/strict';
import test from 'node:test';

import { applyAudacityEffect, applyAudacityEffectAsync } from '../src/common/editor/audacity-effects/index.js';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects.js';
import { isPffftReady } from '../src/common/editor/pffft.js';

test('non-FFT Apply jobs leave the FFT runtime cold and retain exact scalar/dynamics output', async () => {
	assert.equal(isPffftReady(), false);
	const input = [Float32Array.from({ length: 1_021 }, (_, frame) => 0.2 * Math.sin(frame * 0.03))];
	for (const type of ['audacity-amplify', 'audacity-invert', 'audacity-fade-in', 'audacity-fade-out',
		'audacity-normalize', 'audacity-compressor', 'audacity-limiter', 'audacity-echo']) {
		assert.deepEqual(await applyAudacityEffectAsync(type, input, 8_000), applyAudacityEffect(type, input, 8_000));
		assert.equal(isPffftReady(), false, `${type} must not instantiate the unused FFT runtime`);
	}
	await applyAudioSelectionEffectAsync('tremolo', input, 8_000);
	assert.equal(isPffftReady(), false);
	await applyAudacityEffectAsync('audacity-filter-curve-eq', input, 8_000, { filterLength: 101 });
	assert.equal(isPffftReady(), true, 'an FFT effect must initialize its own runtime');
});
