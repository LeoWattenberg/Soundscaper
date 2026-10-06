import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { spectralBinInterval } from '../src/common/editor/spectral-bin-interval.ts';
import { applySpectralGain, applySpectralReplacement } from '../src/common/editor/spectral-edit.js';
import { initializePffft } from '../src/common/editor/pffft.js';

await initializePffft();

function adjacent(value: number, direction: bigint): number {
	const view = new DataView(new ArrayBuffer(8));
	view.setFloat64(0, value);
	view.setBigUint64(0, view.getBigUint64(0) + direction);
	return view.getFloat64(0);
}

test('the precomputed interval matches original bin-frequency comparisons at adjacent floating point boundaries', () => {
	for (const sampleRate of [8_000, 44_100, 384_000]) for (const windowSize of [32, 256, 16_384]) {
		for (const bin of [1, 3, windowSize / 4, windowSize / 2 - 1]) {
			const frequency = bin * sampleRate / windowSize;
			for (const [minimum, maximum] of [
				[0, sampleRate / 2], [adjacent(frequency, -1n), frequency],
				[frequency, adjacent(frequency, 1n)], [adjacent(frequency, 1n), adjacent(frequency, 1n)],
			]) {
				const selected = Array.from({ length: windowSize / 2 + 1 }, (_, candidate) => candidate)
					.filter((candidate) => candidate * sampleRate / windowSize >= minimum && candidate * sampleRate / windowSize <= maximum);
				const [first, end] = spectralBinInterval(sampleRate, windowSize, minimum, maximum);
				assert.deepEqual(Array.from({ length: end - first }, (_, index) => first + index), selected);
			}
		}
	}
});

test('spectral gain and replacement retain exact output for full, narrow and empty bin intervals', () => {
	const input = [0, 1].map((channel) => Float32Array.from({ length: 1_701 }, (_, frame) => Math.sin(frame * 0.071 + channel) * 0.3));
	const replacement = input.map((channel) => Float32Array.from(channel, (sample) => sample * 0.3));
	for (const [minimumFrequency, maximumFrequency, gainHash, replacementHash] of [
		[123.456, 333.33, 'bfb1068cc218adc752a5e69aadc9f403be9da278427e91a4e0a17cd5cd52e6e2', '666b425e0d8ca5f4312a09a109638738dc87aed7c0a6bb544fc11bbe4ddcc600'],
		[0, 4_000, '3c43dbbb5c540ca0a2027daaadfcd0e2181ecfab00fec65a3f9b2485da19f6c7', '8baca17d818c59c9a364ceb2f348d693f8d70aeb9e9c910eaedbca2e1ff4c877'],
		[125, 125.000001, '9599832846913dbe18801c5e0d6653b07ad44e1ff4032d17448daa97d2e2a95b', 'b700db3e3faa00af134b61666a6eb25e37f7d8e6f51eb9013c0a24d423de2dd1'],
		[125.000001, 126, '6b074f2045406120a697784173dcd8ffc077753a4e3c2f9e60bd3c0009c0ac37', '6b074f2045406120a697784173dcd8ffc077753a4e3c2f9e60bd3c0009c0ac37'],
	] as const) {
		const options = { sampleRate: 8_000, startFrame: 9, endFrame: 1_609, windowSize: 256,
			hopSize: 64, minimumFrequency, maximumFrequency, gainDb: -9 };
		for (const [actual, expected] of [
			[applySpectralGain(input, options), gainHash], [applySpectralReplacement(input, replacement, options), replacementHash],
		] as const) {
			const hash = createHash('sha256');
			for (const channel of actual) hash.update(new Uint8Array(channel.buffer));
			assert.equal(hash.digest('hex'), expected);
		}
	}
});
