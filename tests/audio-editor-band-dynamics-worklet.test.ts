/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BandDynamicsProcessor } from '../src/common/editor/first-party-effects/dynamics/worklet.js';
import { applyDeesser } from '../src/common/editor/first-party-effects/deesser/dsp.ts';
import { applyMultibandCompressor } from '../src/common/editor/first-party-effects/multiband-compressor/dsp.ts';
import { ensureBandDynamicsWorklet, isBandDynamicsWorkletLoaded, createBandDynamicsNode } from '../src/common/editor/engine/band-dynamics-node.ts';

test('the actual AudioWorklet host renders the same samples as selection processing', () => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sampleRate');
	Object.defineProperty(globalThis, 'sampleRate', { configurable: true, value: 48000 });
	try {
		const input = [Float32Array.from({ length: 2048 }, (_, frame) => 0.7 * Math.sin(frame * 1.2))];
		for (const type of ['deesser', 'multiband-compressor']) {
			const processor = new BandDynamicsProcessor({ processorOptions: { type, channelCount: 1 } });
			const output = [new Float32Array(2048)];
			for (let offset = 0; offset < 2048; offset += 128) {
				assert.equal(processor.process([[input[0].subarray(offset, offset + 128)]],
					[[output[0].subarray(offset, offset + 128)]]), true);
			}
			const apply = type === 'deesser' ? applyDeesser : applyMultibandCompressor;
			assert.deepEqual(output, apply(input, 48000));
		}
	} finally {
		if (descriptor) Object.defineProperty(globalThis, 'sampleRate', descriptor);
		else Reflect.deleteProperty(globalThis, 'sampleRate');
	}
});

test('module loads are shared, failed loads can retry and unprepared racks cannot silently bypass', async () => {
	let loads = 0;
	let fail = true;
	const context = { audioWorklet: { async addModule() {
		loads += 1;
		if (fail) throw new Error('Unavailable processor');
	} } } as unknown as BaseAudioContext;
	assert.throws(() => createBandDynamicsNode(context, null, 'deesser', {}, 2), /not loaded/);
	await assert.rejects(ensureBandDynamicsWorklet(context), /Unavailable processor/);
	assert.equal(isBandDynamicsWorkletLoaded(context), false);
	fail = false;
	await Promise.all([ensureBandDynamicsWorklet(context), ensureBandDynamicsWorklet(context)]);
	assert.equal(loads, 2);
	assert.equal(isBandDynamicsWorkletLoaded(context), true);
	await ensureBandDynamicsWorklet(context);
	assert.equal(loads, 2);
});
