/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PIXEL_FRAME_HARD_LIMITS_V1,
	planPixelFrameV1,
	readPixelFrameDescriptorV1,
	readPixelFrameV1,
	type PixelFrameDescriptorV1,
} from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import {
	admitPixelFrameV1,
	PIXEL_FRAME_CURRENT_PROFILES_V1,
	type PixelFrameProfileV1,
} from '../src/common/editor/imaging/pixel-frame-admission-v1.ts';

function descriptor(overrides: Partial<PixelFrameDescriptorV1> = {}): PixelFrameDescriptorV1 {
	return {
		schemaVersion: 1,
		width: 2,
		height: 1,
		sampleFormat: 'unorm8',
		primaries: 'srgb',
		transfer: 'srgb',
		...overrides,
	};
}

test('pixel descriptor round trips declared depth and gamut without changing version', () => {
	for (const sampleFormat of ['unorm8', 'unorm16', 'float32'] as const) {
		for (const primaries of ['srgb', 'bt709', 'display-p3', 'bt2020'] as const) {
			for (const transfer of ['srgb', 'bt709', 'linear', 'pq', 'hlg'] as const) {
				const original = descriptor({ sampleFormat, primaries, transfer });
				const read = readPixelFrameDescriptorV1(JSON.parse(JSON.stringify(original)) as unknown);
				assert.deepEqual(read, original);
				assert.equal(Object.isFrozen(read), true);
				assert.notEqual(read, original);
			}
		}
	}
});

test('pixel frame planning proves sample and byte counts before any allocation', () => {
	for (const [sampleFormat, bytesPerSample] of [
		['unorm8', 1], ['unorm16', 2], ['float32', 4],
	] as const) {
		const original = descriptor({ sampleFormat, width: 3, height: 2 });
		assert.deepEqual(planPixelFrameV1(original), {
			descriptor: original,
			pixelCount: 6,
			sampleCount: 24,
			rowByteLength: 12 * bytesPerSample,
			byteLength: 24 * bytesPerSample,
		});
	}
});

test('current admission accepts exactly unorm8 sRGB and never implies a conversion', () => {
	assert.deepEqual(PIXEL_FRAME_CURRENT_PROFILES_V1, [
		{ sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' },
	]);
	const current = descriptor();
	assert.deepEqual(admitPixelFrameV1(current), planPixelFrameV1(current));
	for (const original of [
		descriptor({ sampleFormat: 'unorm16' }),
		descriptor({ sampleFormat: 'float32' }),
		descriptor({ primaries: 'display-p3' }),
		descriptor({ primaries: 'bt709', transfer: 'bt709' }),
		descriptor({ transfer: 'linear' }),
		descriptor({ primaries: 'bt2020', transfer: 'pq' }),
	]) {
		assert.deepEqual(readPixelFrameDescriptorV1(original), original);
		assert.throws(() => admitPixelFrameV1(original), /not admitted/u);
	}
});

test('widening an admitted profile needs no schema, descriptor, or buffer change', () => {
	const original = descriptor({ sampleFormat: 'unorm16', primaries: 'display-p3' });
	const serialized = JSON.stringify(original);
	const profiles: readonly PixelFrameProfileV1[] = [
		...PIXEL_FRAME_CURRENT_PROFILES_V1,
		{ sampleFormat: 'unorm16', primaries: 'display-p3', transfer: 'srgb' },
	];
	assert.throws(() => admitPixelFrameV1(original), /not admitted/u);
	const widened = admitPixelFrameV1(JSON.parse(serialized) as unknown, { profiles });
	assert.equal(widened.descriptor.schemaVersion, 1);
	assert.equal(JSON.stringify(widened.descriptor), serialized);
	assert.equal(widened.byteLength, 16);
	const pixels = new Uint16Array([0, 32_768, 65_535, 65_535, 4, 8, 12, 0]);
	assert.equal(readPixelFrameV1({ descriptor: widened.descriptor, pixels }).pixels, pixels);
	assert.throws(() => admitPixelFrameV1(descriptor({ primaries: 'display-p3' }), { profiles }), /not admitted/u);
	assert.throws(() => admitPixelFrameV1(descriptor({ sampleFormat: 'unorm16' }), { profiles }), /not admitted/u);
});

test('float linear HDR RGB is representable while nonfinite samples and invalid alpha fail', () => {
	const original = descriptor({ sampleFormat: 'float32', primaries: 'bt2020', transfer: 'linear' });
	const pixels = new Float32Array([-0.5, 4, 2, 1, 0, 0.25, 12, 0]);
	const frame = readPixelFrameV1({ descriptor: original, pixels });
	assert.equal(frame.pixels, pixels);
	assert.equal(Object.isFrozen(frame), true);
	assert.throws(() => admitPixelFrameV1(original), /not admitted/u);
	assert.doesNotThrow(() => admitPixelFrameV1(original, {
		profiles: [{ sampleFormat: 'float32', primaries: 'bt2020', transfer: 'linear' }],
	}));
	for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
		const samples = pixels.slice();
		samples[0] = invalid;
		assert.throws(() => readPixelFrameV1({ descriptor: original, pixels: samples }), /finite/u);
	}
	for (const invalid of [-0.1, 1.1]) {
		const samples = pixels.slice();
		samples[3] = invalid;
		assert.throws(() => readPixelFrameV1({ descriptor: original, pixels: samples }), /alpha/u);
	}
});

test('malformed dimensions, unknown profiles, and future schema versions fail closed', () => {
	for (const field of ['width', 'height'] as const) {
		for (const invalid of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER, '2', null]) {
			assert.throws(() => planPixelFrameV1({ ...descriptor(), [field]: invalid }), /dimension/u);
		}
	}
	for (const [field, invalid] of [
		['schemaVersion', 2], ['schemaVersion', '1'], ['sampleFormat', 'uint8'],
		['primaries', 'unknown'], ['transfer', 'unknown'], ['primaries', 'adobe-rgb'],
	] as const) {
		assert.throws(() => readPixelFrameDescriptorV1({ ...descriptor(), [field]: invalid }));
	}
	assert.throws(() => readPixelFrameDescriptorV1({ ...descriptor(), byteLength: 8 }), /unsupported field/u);
	const missing: Record<string, unknown> = { ...descriptor() };
	delete missing.transfer;
	assert.throws(() => readPixelFrameDescriptorV1(missing), /required/u);
});

test('dimension, pixel and byte limits are independent and inclusive', () => {
	assert.doesNotThrow(() => planPixelFrameV1(descriptor({
		width: PIXEL_FRAME_HARD_LIMITS_V1.maximumSidePixels, height: 1,
	})));
	assert.throws(() => planPixelFrameV1(descriptor({
		width: PIXEL_FRAME_HARD_LIMITS_V1.maximumSidePixels + 1,
	})), /dimension/u);
	assert.throws(() => planPixelFrameV1(descriptor({ width: 65_536, height: 65_536 })), /pixel count/u);
	const limits = { maximumSidePixels: 4, maximumPixels: 4, maximumBytes: 16 };
	assert.doesNotThrow(() => planPixelFrameV1(descriptor({ width: 2, height: 2 }), limits));
	assert.throws(() => planPixelFrameV1(descriptor({ width: 5 }), limits), /dimension/u);
	assert.throws(() => planPixelFrameV1(descriptor({ width: 3, height: 2 }), limits), /pixel count/u);
	assert.throws(() => planPixelFrameV1(descriptor({ sampleFormat: 'unorm16', width: 2, height: 2 }), limits), /byte length/u);
	assert.throws(() => admitPixelFrameV1(descriptor({ width: 2, height: 2 }), {
		limits: { ...limits, maximumBytes: 15 },
	}), /byte length/u);
	for (const field of ['maximumSidePixels', 'maximumPixels', 'maximumBytes'] as const) {
		for (const invalid of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER]) {
			assert.throws(() => planPixelFrameV1(descriptor(), { ...limits, [field]: invalid }), /limit/u);
		}
	}
	assert.throws(() => planPixelFrameV1(descriptor(), { ...limits, maximumRows: 4 }), /unsupported field/u);
});

test('descriptor, frame, limits and profile validation never invokes accessors', () => {
	let reads = 0;
	const getter = () => { reads += 1; return 1; };
	const malformed = { ...descriptor() };
	Object.defineProperty(malformed, 'width', { enumerable: true, get: getter });
	assert.throws(() => readPixelFrameDescriptorV1(malformed), /data property/u);
	assert.throws(() => readPixelFrameDescriptorV1(Object.assign(Object.create(descriptor()) as object, { width: 2 })), /plain object/u);
	assert.throws(() => readPixelFrameDescriptorV1({ ...descriptor(), [Symbol('hidden')]: true }), /unsupported field/u);
	const hidden = { ...descriptor() };
	Object.defineProperty(hidden, 'transfer', { enumerable: false, value: 'srgb' });
	assert.throws(() => readPixelFrameDescriptorV1(hidden), /data property/u);
	const frame = { descriptor: descriptor() };
	Object.defineProperty(frame, 'pixels', { enumerable: true, get: getter });
	assert.throws(() => readPixelFrameV1(frame), /data property/u);
	const limits = { ...PIXEL_FRAME_HARD_LIMITS_V1 };
	Object.defineProperty(limits, 'maximumBytes', { enumerable: true, get: getter });
	assert.throws(() => planPixelFrameV1(descriptor(), limits), /data property/u);
	const profile = { ...PIXEL_FRAME_CURRENT_PROFILES_V1[0] };
	Object.defineProperty(profile, 'sampleFormat', { enumerable: true, get: getter });
	assert.throws(() => admitPixelFrameV1(descriptor(), { profiles: [profile] }), /data property/u);
	assert.equal(reads, 0);
});

test('buffer format and exact contiguous RGBA sample count must match the descriptor', () => {
	const eight = descriptor();
	for (const pixels of [new Uint8Array(8), new Uint8ClampedArray(8)]) {
		assert.equal(readPixelFrameV1({ descriptor: eight, pixels }).pixels, pixels);
	}
	const backing = new Uint8Array(16);
	assert.equal(readPixelFrameV1({ descriptor: eight, pixels: backing.subarray(4, 12) }).pixels.byteLength, 8);
	for (const pixels of [new Uint8Array(7), new Uint8Array(9)]) {
		assert.throws(() => readPixelFrameV1({ descriptor: eight, pixels }), /sample count/u);
	}
	for (const pixels of [new Uint16Array(8), new Int8Array(8), new Float32Array(8), new DataView(new ArrayBuffer(8)), Array(8).fill(0) as unknown[], null]) {
		assert.throws(() => readPixelFrameV1({ descriptor: eight, pixels }), /sample format/u);
	}
	assert.throws(() => readPixelFrameV1({ descriptor: descriptor({ sampleFormat: 'unorm16' }), pixels: new Uint8Array(8) }), /sample format/u);
	assert.throws(() => readPixelFrameV1({ descriptor: eight, pixels: new Uint8Array(8), rowStride: 8 }), /unsupported field/u);
});

test('shared, resizable, detached, and shadowed pixel buffers are rejected', () => {
	const original = descriptor();
	assert.throws(() => readPixelFrameV1({ descriptor: original, pixels: new Uint8Array(new SharedArrayBuffer(8)) }), /fixed ArrayBuffer/u);
	const ResizableArrayBuffer = ArrayBuffer as new (byteLength: number, options: { maxByteLength: number }) => ArrayBuffer;
	const resizable = new ResizableArrayBuffer(8, { maxByteLength: 16 });
	assert.throws(() => readPixelFrameV1({ descriptor: original, pixels: new Uint8Array(resizable) }), /fixed ArrayBuffer/u);
	const detached = new Uint8Array(8);
	structuredClone(detached.buffer, { transfer: [detached.buffer] });
	assert.throws(() => readPixelFrameV1({ descriptor: original, pixels: detached }), /sample count/u);
	const shadowed = new Uint8Array(8);
	Object.defineProperty(shadowed, 'byteLength', { value: 1 });
	assert.throws(() => readPixelFrameV1({ descriptor: original, pixels: shadowed }), /shadow/u);
});

test('invalid and empty admission profile sets fail closed without changing defaults', () => {
	assert.throws(() => admitPixelFrameV1(descriptor(), { profiles: [] }), /not admitted/u);
	assert.throws(() => admitPixelFrameV1(descriptor(), { profiles: [
		{ sampleFormat: 'unorm32', primaries: 'srgb', transfer: 'srgb' },
	] }), /sample format/u);
	assert.throws(() => admitPixelFrameV1(descriptor(), { profiles: [
		{ sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb', fallback: true },
	] }), /unsupported field/u);
	assert.throws(() => admitPixelFrameV1(descriptor(), { profiles: new Array(1) as unknown[] }), /data property/u);
	assert.throws(() => admitPixelFrameV1(descriptor(), { profiles: Array(257).fill(PIXEL_FRAME_CURRENT_PROFILES_V1[0]) as unknown[] }), /entries/u);
	assert.throws(() => admitPixelFrameV1(descriptor(), { allowUnknown: true }), /unsupported field/u);
	assert.equal(Object.isFrozen(PIXEL_FRAME_CURRENT_PROFILES_V1), true);
	assert.equal(Object.isFrozen(PIXEL_FRAME_CURRENT_PROFILES_V1[0]), true);
	assert.doesNotThrow(() => admitPixelFrameV1(descriptor()));
});
