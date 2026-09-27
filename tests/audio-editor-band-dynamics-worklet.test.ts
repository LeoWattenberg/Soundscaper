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

test('the multiband worklet emits bounded analysis windows without adding de-esser traffic', () => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sampleRate');
	Object.defineProperty(globalThis, 'sampleRate', { configurable: true, value: 48_000 });
	try {
		for (const type of ['deesser', 'multiband-compressor']) {
			const messages: unknown[] = [];
			const processor = new BandDynamicsProcessor({
				processorOptions: {
					type,
					channelCount: 1,
					params: type === 'multiband-compressor' ? {
						lowThreshold: -48, midThreshold: -48, highThreshold: -48,
						lowRatio: 20, midRatio: 20, highRatio: 20,
						attack: 0.0001,
					} : {},
				},
			});
			(processor as unknown as { port: { postMessage(message: unknown): void } }).port = {
				postMessage(message) { messages.push(message); },
			};
			for (let block = 0; block < 8; block += 1) {
				const input = [Float32Array.from({ length: 128 }, () => 0.9)];
				processor.process([input], [[new Float32Array(128)]]);
			}
			if (type === 'deesser') {
				assert.deepEqual(messages, []);
				continue;
			}
			assert.equal(messages.length, 1);
			assert.deepEqual(Object.keys(messages[0] as object).sort(), [
				'effectType', 'frames', 'inputPeak', 'outputPeak', 'reductionDb', 'seconds', 'sequence', 'type',
			].sort());
			assert.deepEqual(messages[0], {
				type: 'analysis',
				sequence: 1,
				effectType: 'multiband-compressor',
				frames: 896,
				seconds: 896 / 48_000,
				inputPeak: 0.8999999761581421,
				outputPeak: (messages[0] as { outputPeak: number }).outputPeak,
				reductionDb: (messages[0] as { reductionDb: number }).reductionDb,
			});
			assert.ok((messages[0] as { outputPeak: number }).outputPeak < 0.9);
			assert.ok((messages[0] as { reductionDb: number }).reductionDb < -12);
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
