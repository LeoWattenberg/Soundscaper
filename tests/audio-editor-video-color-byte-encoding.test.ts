/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyPreparedManagedSdrByteFrameV1,
	createManagedSdrLinearByteEncoderV1,
	createManagedSdrUngradedByteLookupV1,
} from '../src/common/editor/video-color-byte-encoding.ts';
import {
	applyPreparedManagedSdrGradeStackLinearChannelsV1,
	defaultVideoSourceColorInterpretationV1,
	encodeManagedSdrLinearChannelsV1,
	prepareManagedSdrGradeStackV1,
} from '../src/common/editor/video-color-management-v27.ts';

const outputs = ['srgb', 'rec709', 'linear-rec709-d65'] as const;

test('prepared byte encoding matches the canonical SDR oracle at every byte and fractional boundaries', () => {
	for (const output of outputs) {
		const encode = createManagedSdrLinearByteEncoderV1(output);
		const values = [0, 1, 0.0031308, 0.018, 0.0031308 - 1e-12, 0.018 - 1e-12];
		for (let byte = 0; byte <= 255; byte += 1) {
			values.push(byte / 255, (byte + 0.25) / 256, (byte + 0.5) / 256);
		}
		for (const value of values) assert.equal(encode(value), Math.round(
			encodeManagedSdrLinearChannelsV1(value, value, value, 1, output)[0] * 255,
		));
		for (const value of [NaN, Infinity, -1e-12, 1 + 1e-12]) assert.throws(() => encode(value), RangeError);
	}
	assert.throws(() => createManagedSdrLinearByteEncoderV1('unsupported' as never), RangeError);
});

test('ungraded lookup reproduces every canonical byte under canvas and file interpretations', () => {
	for (const decoding of ['canvas-readback', 'file', 'linear'] as const) {
		for (const transfer of ['srgb', 'bt709'] as const) for (const range of ['full', 'limited'] as const) {
			const interpretation = { ...defaultVideoSourceColorInterpretationV1('video', 'source'), transfer, range, provenance: 'user-override' };
			const prepared = prepareManagedSdrGradeStackV1({ decoding, interpretation, grades: [] });
			for (const output of outputs) {
				const lookup = createManagedSdrUngradedByteLookupV1(prepared, output);
				assert.ok(lookup);
				for (let byte = 0; byte <= 255; byte += 1) {
					const linear = applyPreparedManagedSdrGradeStackLinearChannelsV1(prepared,
						byte / 255, byte / 255, byte / 255, 1);
					assert.equal(lookup[byte], Math.round(encodeManagedSdrLinearChannelsV1(
						linear[0], linear[1], linear[2], linear[3], output,
					)[0] * 255));
				}
			}
		}
	}
});

test('authored color grades retain the full canonical grade stack', () => {
	const prepared = prepareManagedSdrGradeStackV1({
		interpretation: defaultVideoSourceColorInterpretationV1('video', 'source'),
		grades: [{ schemaVersion: 1, exposureStops: 1, contrast: 1, pivot: 0.18,
			lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1, lut: null }],
	});
	assert.equal(createManagedSdrUngradedByteLookupV1(prepared, 'srgb'), null);
});

test('frame conversion preserves alpha, authored grades, cancellation and canonical pixels', () => {
	for (const grades of [[], [{ schemaVersion: 1, exposureStops: 1, contrast: 1, pivot: 0.18,
		lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1, lut: null }]]) {
		const prepared = prepareManagedSdrGradeStackV1({
			interpretation: defaultVideoSourceColorInterpretationV1('video', 'source'), grades,
		});
		const original = Uint8Array.from({ length: 256 * 4 }, (_unused, index) => (index * 37) % 256);
		for (const output of outputs) {
			const pixels = applyPreparedManagedSdrByteFrameV1(prepared, { width: 16, height: 16, pixels: original }, output);
			for (let offset = 0; offset < pixels.length; offset += 4) {
				const linear = applyPreparedManagedSdrGradeStackLinearChannelsV1(prepared,
					original[offset]! / 255, original[offset + 1]! / 255,
					original[offset + 2]! / 255, original[offset + 3]! / 255);
				const expected = encodeManagedSdrLinearChannelsV1(linear[0], linear[1], linear[2], linear[3], output);
				assert.deepEqual([...pixels.slice(offset, offset + 4)], expected.map((value) => Math.round(value * 255)));
			}
		}
		const abort = new AbortController();
		const reason = new Error('stop');
		abort.abort(reason);
		assert.throws(() => applyPreparedManagedSdrByteFrameV1(prepared,
			{ width: 16, height: 16, pixels: original }, 'srgb', abort.signal), (error: unknown) => error === reason);
	}
});
