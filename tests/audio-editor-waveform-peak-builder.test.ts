/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createWaveformPeakBuilder } from '../src/common/editor/waveform-peak-builder.ts';
import { waveformPeakBlockSizes, WAVEFORM_PEAKS_VERSION } from '../src/common/editor/waveform-peak-contract.ts';

function referencePeaks(channels: readonly Float32Array[]) {
	return {
		version: WAVEFORM_PEAKS_VERSION,
		channelCount: channels.length,
		levels: waveformPeakBlockSizes(channels[0]!.length, channels.length).map((blockSize) => ({
			blockSize,
			channels: channels.map((samples) => {
				const count = Math.ceil(samples.length / blockSize);
				const minimums = new Float32Array(count);
				const maximums = new Float32Array(count);
				const rms = new Float32Array(count);
				for (let bucket = 0; bucket < count; bucket++) {
					let minimum = Infinity;
					let maximum = -Infinity;
					let squareSum = 0;
					const end = Math.min(samples.length, (bucket + 1) * blockSize);
					for (let frame = bucket * blockSize; frame < end; frame++) {
						const sample = samples[frame]!;
						minimum = Math.min(minimum, sample);
						maximum = Math.max(maximum, sample);
						squareSum += sample * sample;
					}
					minimums[bucket] = minimum;
					maximums[bucket] = maximum;
					rms[bucket] = Math.sqrt(squareSum / (end - bucket * blockSize));
				}
				return { minimums, maximums, rms };
			}),
		})),
	};
}

test('hierarchical peaks match independent sample scans at every resolution across partial chunks', () => {
	for (const frameCount of [0, 1, 7, 8, 9, 65, 65_537, 131_079]) {
		const channels = [0, 1].map((channel) => Float32Array.from({ length: frameCount }, (_, frame) => (
			Math.sin(frame * (0.013 + channel * 0.021)) * 1.9
		)));
		const builder = createWaveformPeakBuilder({ frameCount, channelCount: 2 });
		for (let offset = 0; offset < frameCount; offset += 37) {
			builder.append(channels.map((channel) => channel.subarray(offset, offset + 37)));
		}
		assert.deepEqual(builder.finish(), referencePeaks(channels), `frame count ${String(frameCount)}`);
	}
});

test('hierarchical RMS uses unrounded square sums and sample weights for a partial final bucket', () => {
	const samples = Float32Array.from({ length: 73 }, (_, frame) => frame < 64 ? 0.1 : 2.1);
	const builder = createWaveformPeakBuilder({ frameCount: samples.length, channelCount: 1 });
	builder.append([samples.subarray(0, 65)]);
	builder.append([samples.subarray(65)]);
	assert.deepEqual(builder.finish(), referencePeaks([samples]));
});

test('peak builders reject malformed or incomplete PCM before publishing a pyramid', () => {
	const builder = createWaveformPeakBuilder({ frameCount: 10, channelCount: 2 });
	assert.throws(() => builder.append([new Float32Array(1)]), /channel count/u);
	assert.throws(() => builder.append([new Float32Array(1), new Float32Array(2)]), /channel lengths/u);
	assert.throws(() => builder.append([new Float32Array(11), new Float32Array(11)]), /frame count/u);
	assert.throws(() => builder.finish(), /frame count/u);
	builder.append([new Float32Array(10), new Float32Array(10)]);
	const peaks = builder.finish();
	assert.equal(builder.finish(), peaks);
	assert.throws(() => builder.append([new Float32Array(), new Float32Array()]), /finished/u);
});

test('coarsened long-source peaks retain the source memory budget', () => {
	const frameCount = 3_000_001;
	const samples = new Float32Array(frameCount).fill(1.5);
	samples[frameCount - 1] = -1.75;
	const builder = createWaveformPeakBuilder({ frameCount, channelCount: 1 });
	builder.append([samples]);
	assert.deepEqual(builder.finish(), referencePeaks([samples]));
});

test('the peak worker publishes the same hierarchy from transferred chunks and rejects invalid geometry', async () => {
	const previousSelf = Reflect.get(globalThis, 'self') as unknown;
	const messages: Array<{ type: string; levels?: unknown; message?: string }> = [];
	const transfers: unknown[][] = [];
	const endpoint = {
		onmessage: null as ((event: { data: unknown }) => void) | null,
		postMessage(message: { type: string; levels?: unknown; message?: string }, transfer: unknown[] = []) {
			messages.push(message); transfers.push(transfer);
		},
	};
	Reflect.set(globalThis, 'self', endpoint);
	try {
		await import('../src/common/editor/peaks-worker.js');
		const samples = Float32Array.from({ length: 73 }, (_, index) => Math.sin(index) * 1.5);
		endpoint.onmessage!({ data: { type: 'start', frameCount: samples.length, channelCount: 1 } });
		for (const channel of [samples.slice(0, 31), samples.slice(31)]) {
			endpoint.onmessage!({ data: { type: 'chunk', channels: [channel.buffer] } });
		}
		endpoint.onmessage!({ data: { type: 'finish' } });
		assert.deepEqual(messages.map(({ type }) => type), ['ready', 'ack', 'ack', 'result']);
		assert.deepEqual(messages[3]!.levels, referencePeaks([samples]).levels);
		assert.equal(transfers[3]!.length, 27);
		endpoint.onmessage!({ data: { type: 'start', frameCount: 10, channelCount: 1 } });
		endpoint.onmessage!({ data: { type: 'finish' } });
		assert.equal(messages.at(-1)!.type, 'error');
		assert.match(messages.at(-1)!.message!, /frame count/u);
	} finally {
		if (previousSelf === undefined) Reflect.deleteProperty(globalThis, 'self');
		else Reflect.set(globalThis, 'self', previousSelf);
	}
});
