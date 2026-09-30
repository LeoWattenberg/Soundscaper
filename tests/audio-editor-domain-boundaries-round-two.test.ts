/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	normalizeAudioEditorPerformancePreferences,
} from '../src/common/editor/performance-preferences.ts';
import {
	validateVideoProxyOriginalMimeType,
} from '../src/common/editor/video-proxy-original-mime-type.ts';
import {
	interleavePlanarFloat32Chunk,
	planarFloat32Chunk,
} from '../src/common/editor/wavpack-float32-chunk-layout.ts';
import {
	waveformPeakBlockSizes,
} from '../src/common/editor/waveform-peak-contract.ts';
import {
	normalizeWaveformVisualizationPreferences,
} from '../src/common/editor/waveform-visualization-preferences.ts';

test('case 01: planar Float32 conversion rejects a zero channel count', () => {
	assert.throws(
		() => planarFloat32Chunk(new Uint8Array(), 0, 0, 0),
		/invalid interleaved Float32 PCM geometry/iu,
	);
});

test('case 02: planar Float32 conversion rejects a fractional frame offset', () => {
	assert.throws(
		() => planarFloat32Chunk(words([1, 2]), 0.5, 1, 1),
		/invalid interleaved Float32 PCM geometry/iu,
	);
});

test('case 03: planar Float32 conversion rejects a noncanonical negative-zero frame count', () => {
	assert.throws(
		() => planarFloat32Chunk(words([1]), 0, -0, 1),
		/invalid interleaved Float32 PCM geometry/iu,
	);
});

test('case 04: planar Float32 conversion rejects unsafe byte-length arithmetic before allocation', () => {
	assert.throws(
		() => planarFloat32Chunk(new Uint8Array(), 0, Number.MAX_SAFE_INTEGER, 1),
		/invalid interleaved Float32 PCM geometry/iu,
	);
});

test('case 05: planar Float32 conversion rejects source bytes that do not form Float32 words', () => {
	assert.throws(
		() => planarFloat32Chunk(new Uint8Array(5), 0, 1, 1),
		/invalid interleaved Float32 PCM geometry/iu,
	);
});

test('case 06: planar Float32 conversion rejects a source ending in a partial interleaved frame', () => {
	assert.throws(
		() => planarFloat32Chunk(words([1]), 0, 0, 2),
		/invalid interleaved Float32 PCM geometry/iu,
	);
});

test('case 07: planar Float32 conversion rejects a range beyond the available source frames', () => {
	assert.throws(
		() => planarFloat32Chunk(words([1, 2]), 1, 2, 1),
		/invalid interleaved Float32 PCM geometry/iu,
	);
});

test('case 08: planar Float32 conversion accepts an empty range at the source endpoint', () => {
	const result = planarFloat32Chunk(words([1, 2]), 2, 0, 1);

	assert.equal(result.byteLength, 0);
});

test('case 09: planar-to-interleaved conversion rejects zero channels before touching output', () => {
	const output = words([0xaaaa_aaaa, 0xbbbb_bbbb]);
	const before = output.slice();
	const failure = new RangeError('invalid geometry');

	assert.throws(
		() => interleavePlanarFloat32Chunk(new Uint8Array(), output, 0, 0, 0, () => failure),
		(error: unknown) => error === failure,
	);
	assert.deepEqual(output, before);
});

test('case 10: planar-to-interleaved conversion rejects fractional offsets before touching output', () => {
	const output = words([0xaaaa_aaaa, 0xbbbb_bbbb]);
	const before = output.slice();
	const failure = new RangeError('invalid geometry');

	assert.throws(
		() => interleavePlanarFloat32Chunk(words([1]), output, 0.5, 1, 1, () => failure),
		(error: unknown) => error === failure,
	);
	assert.deepEqual(output, before);
});

test('case 11: planar-to-interleaved conversion preflights its complete destination range', () => {
	const output = words([
		0xaaaa_aaaa, 0xaaaa_aaaa,
		0xaaaa_aaaa, 0xaaaa_aaaa,
		0xaaaa_aaaa, 0xaaaa_aaaa,
	]);
	const before = output.slice();
	const failure = new RangeError('invalid geometry');

	assert.throws(
		() => interleavePlanarFloat32Chunk(words([1, 2, 3, 4]), output, 2, 2, 2, () => failure),
		(error: unknown) => error === failure,
	);
	assert.deepEqual(output, before);
});

test('case 12: planar-to-interleaved conversion snapshots overlapping source bytes', () => {
	const storage = words([0x0000_0001, 0x0000_0002, 0x0000_0011, 0x0000_0012]);

	interleavePlanarFloat32Chunk(
		storage,
		storage,
		0,
		2,
		2,
		() => new RangeError('invalid geometry'),
	);

	assert.deepEqual(readWords(storage), [
		0x0000_0001, 0x0000_0011,
		0x0000_0002, 0x0000_0012,
	]);
});

test('case 13: omitted performance preferences produce an immutable memory-mode snapshot', () => {
	const result = normalizeAudioEditorPerformancePreferences(undefined);

	assert.deepEqual(result, { optimizeFor: 'memory' });
	assert.ok(Object.isFrozen(result));
});

test('case 14: explicit speed-mode performance preferences remain supported', () => {
	assert.deepEqual(
		normalizeAudioEditorPerformancePreferences({ optimizeFor: 'speed' }),
		{ optimizeFor: 'speed' },
	);
});

test('case 15: performance preferences reject inherited optimization state', () => {
	const inherited = Object.create({ optimizeFor: 'speed' }) as unknown;

	assert.throws(
		() => normalizeAudioEditorPerformancePreferences(inherited),
		/plain data object/iu,
	);
});

test('case 16: performance preferences reject accessors without invoking them', () => {
	let reads = 0;
	const hostile = Object.defineProperty({}, 'optimizeFor', {
		enumerable: true,
		get() { reads += 1; return 'speed'; },
	});

	assert.throws(
		() => normalizeAudioEditorPerformancePreferences(hostile),
		/enumerable data property/iu,
	);
	assert.equal(reads, 0);
});

test('case 17: performance preferences reject unsupported own fields', () => {
	assert.throws(
		() => normalizeAudioEditorPerformancePreferences({ optimizeFor: 'memory', surprise: true }),
		/unsupported field/iu,
	);
});

test('case 18: partial waveform visualization preferences fill the omitted default', () => {
	assert.deepEqual(
		normalizeWaveformVisualizationPreferences({ lowMidCrossoverHz: 320 }),
		{ lowMidCrossoverHz: 320, midHighCrossoverHz: 4_000 },
	);
});

test('case 19: waveform visualization preferences do not coerce numeric strings', () => {
	assert.throws(
		() => normalizeWaveformVisualizationPreferences({
			lowMidCrossoverHz: '320', midHighCrossoverHz: 4_000,
		}),
		/must be an integer/iu,
	);
});

test('case 20: waveform visualization preferences reject inherited crossover values', () => {
	const inherited = Object.create({
		lowMidCrossoverHz: 320,
		midHighCrossoverHz: 4_000,
	}) as unknown;

	assert.throws(
		() => normalizeWaveformVisualizationPreferences(inherited),
		/plain data object/iu,
	);
});

test('case 21: waveform visualization preferences reject accessors without invoking them', () => {
	let reads = 0;
	const hostile = Object.defineProperty({ midHighCrossoverHz: 4_000 }, 'lowMidCrossoverHz', {
		enumerable: true,
		get() { reads += 1; return 320; },
	});

	assert.throws(
		() => normalizeWaveformVisualizationPreferences(hostile),
		/enumerable data property/iu,
	);
	assert.equal(reads, 0);
});

test('case 22: waveform visualization normalization returns an immutable detached snapshot', () => {
	const input = { lowMidCrossoverHz: 320, midHighCrossoverHz: 5_000 };
	const result = normalizeWaveformVisualizationPreferences(input);
	input.lowMidCrossoverHz = 640;

	assert.deepEqual(result, { lowMidCrossoverHz: 320, midHighCrossoverHz: 5_000 });
	assert.ok(Object.isFrozen(result));
});

test('case 23: video proxy MIME admission accepts a canonical ordered codec list', () => {
	assert.equal(
		validateVideoProxyOriginalMimeType('video/webm;codecs=vp9,opus'),
		'video/webm;codecs=vp9,opus',
	);
});

test('case 24: video proxy MIME admission rejects noncanonical uppercase spellings', () => {
	assert.throws(
		() => validateVideoProxyOriginalMimeType('Video/webm;codecs=VP9'),
		/is invalid/iu,
	);
});

test('case 25: computed waveform peak block sizes expose an immutable contract', () => {
	const sizes = waveformPeakBlockSizes(4_096, 2);

	assert.ok(Object.isFrozen(sizes));
	assert.equal(Reflect.set(sizes, '0', 1), false);
});

function words(values: readonly number[]): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(values.length * Uint32Array.BYTES_PER_ELEMENT);
	const view = new DataView(output.buffer);
	values.forEach((value, index) => {
		view.setUint32(index * Uint32Array.BYTES_PER_ELEMENT, value, true);
	});
	return output;
}

function readWords(input: Uint8Array): number[] {
	const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
	return Array.from(
		{ length: input.byteLength / Uint32Array.BYTES_PER_ELEMENT },
		(_value, index) => view.getUint32(index * Uint32Array.BYTES_PER_ELEMENT, true),
	);
}
