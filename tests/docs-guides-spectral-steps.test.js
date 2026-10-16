/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { spectralRange } from '../handbook/guides/spectral-steps.mjs';
import { describeStep, isStepKind } from '../handbook/guides/steps.mjs';

test('spectral steps pair frequency bounds and gain with the actual dialog controls', () => {
	const entry = spectralRange({ minimum: 400, maximum: 500, operation: 'amplify', gain: 3 });
	assert.equal(isStepKind(entry.kind), true);
	const prose = describeStep(entry, { fixture: () => null });
	assert.match(prose, /\*\*Minimum frequency \(Hz\)\*\* to `400`/u);
	assert.match(prose, /\*\*Maximum frequency \(Hz\)\*\* to `500`/u);
	assert.match(prose, /\*\*Gain \(dB\)\*\* to `3`/u);
	assert.match(prose, /press \*\*Spectral Amplify\*\*/u);
	assert.ok(Object.isFrozen(entry));
});

test('spectral deletion and selection use their own dialog buttons', () => {
	for (const [operation, button] of [['delete', 'Spectral Delete'], ['select', 'Select range']]) {
		const prose = describeStep(spectralRange({ minimum: 0, maximum: 1000, operation }), { fixture: () => null });
		assert.ok(prose.includes(`press **${button}**`));
		assert.ok(!prose.includes('**Gain (dB)**'));
	}
});

test('spectral steps reject reversed, nonfinite and negative bounds and unsupported gain', () => {
	for (const options of [
		{ minimum: -1, maximum: 500 }, { minimum: 500, maximum: 500 },
		{ minimum: 600, maximum: 500 }, { minimum: 0, maximum: Infinity },
		{ minimum: 0, maximum: 500, operation: 'fade' },
		{ minimum: 0, maximum: 500, gain: 61 },
	]) assert.throws(() => spectralRange(options), RangeError);
});
