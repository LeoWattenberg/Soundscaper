/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePixelFrameWebGl2MaskBlendUniformsCurrentV1 as prepare } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-blend-glsl-current-v1.ts';

test('mask blend controls preserve each exact admitted policy and independent CA copies', () => {
	assert.deepEqual(prepare({ kind: 'generic' }), { policy: 0, copyRed: 0, copyBlue: 0 });
	assert.deepEqual(prepare({ kind: 'unchanged-components' }), { policy: 2, copyRed: 0, copyBlue: 0 });
	for (const copyRed of [false, true]) for (const copyBlue of [false, true]) {
		const controls = prepare({ kind: 'ca-copy', copyRed, copyBlue });
		assert.deepEqual(controls, { policy: 1, copyRed: Number(copyRed), copyBlue: Number(copyBlue) });
		assert.ok(Object.isFrozen(controls));
	}
});

test('mask blend control admission rejects missing, foreign, coerced and accessor controls', () => {
	for (const value of [null, {}, { kind: 'other' }, { kind: 'generic', copyRed: false },
		{ kind: 'unchanged-components', copyBlue: true }, { kind: 'ca-copy' },
		{ kind: 'ca-copy', copyRed: 0, copyBlue: false }, { kind: 'ca-copy', copyRed: true, copyBlue: 'false' },
		{ kind: 'ca-copy', copyRed: true, copyBlue: false, opacity: 1 }]) assert.throws(() => prepare(value));
	let reads = 0;
	assert.throws(() => prepare({ get kind() { reads++; return 'generic'; } }), TypeError);
	assert.equal(reads, 0, 'Closed scalar capture never invokes an accessor.');
});
