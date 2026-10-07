/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { fft, initializePffft } from '../src/common/editor/pffft.js';

test('warm PFFFT plans retain heap views instead of allocating views for each transform', async (context) => {
	await initializePffft();
	const real = new Float64Array(128);
	const imaginary = new Float64Array(128);
	fft(real, imaginary);
	const Original = Float32Array;
	let views = 0;
	const Tracked = new Proxy(Original, { construct(target, args: [ArrayBuffer, number, number]) {
		if (args.length === 3) views++;
		return new target(...args);
	} });
	context.mock.property(globalThis, 'Float32Array', Tracked);
	for (let iteration = 0; iteration < 10; iteration++) fft(real, imaginary, iteration % 2 === 1);
	assert.equal(views, 0);
	// Allocating a large new plan can grow the WASM heap. Old plans must refresh.
	fft(new Float64Array(65536), new Float64Array(65536));
	real[0] = 1;
	imaginary.fill(0);
	fft(real, imaginary);
	assert.ok(real.every(Number.isFinite));
});
