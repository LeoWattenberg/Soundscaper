/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectMotionMaximumSceneMetadata, motionMaximumNativeProfile } from '../desktop/motionscaper-native-maximum-profile.ts';
import { inspectMotionMaximumNativePictures, inspectMotionMaximumPreview } from '../desktop/motionscaper-native-maximum-pictures.ts';
import { motionMaximumIndexPixel } from '../desktop/motionscaper-native-maximum-index-oracle.ts';
import { inspectMotionMaximumMemory, inspectMotionMaximumIndexRetention } from '../desktop/motionscaper-native-maximum-observation.ts';
import { MOTION_SUSTAINED_PLAN, type MotionSustainedMemorySample } from '../scripts/performance/motionscaper-sustained-plan.ts';

test('closed maximum scene decoder evidence refuses geometry, sample/PTS gaps, foreign audio and unbounded reads', () => {
	for (const kind of ['quality', 'planes', 'lights'] as const) {
		const profile = motionMaximumNativeProfile(kind), size = profile.width * profile.height * 16 * profile.selectedFrames.length;
		const metadata = { width: profile.width, height: profile.height, frameCount: profile.frames, selectedFrames: profile.selectedFrames,
			firstTimestamp: { num: 0, den: 30 }, lastTimestamp: { num: profile.frames - 1, den: 30 }, contiguousFrameTimes: true,
			profile: 4, colorDepth: 12, alphaDepth: 16, colorPrimaries: 1, colorTransfer: 1, colorSpace: 1,
			maximumReadBytes: 65536, maximumPacketBytes: 48000, audio: null };
		const inspect = (value: unknown, pictures = size, pcm = 0) => inspectMotionMaximumSceneMetadata(value, kind, pictures, pcm);
		assert.deepEqual(inspect(metadata), metadata);
		for (const wrong of [{ width: 16 }, { frameCount: 32768 }, { alphaDepth: 8 }, { colorTransfer: 13 }]) assert.throws(() => inspect({ ...metadata, ...wrong }), /picture contract/u);
		assert.throws(() => inspect({ ...metadata, contiguousFrameTimes: false }), /timestamps/u);
		assert.throws(() => inspect({ ...metadata, lastTimestamp: { num: profile.frames, den: 30 } }), /timestamps/u);
		assert.throws(() => inspect({ ...metadata, selectedFrames: [] }), /selected/u);
		assert.throws(() => inspect({ ...metadata, audio: {} }), /PCM/u);
		assert.throws(() => inspect(metadata, size, 8), /PCM/u);
		assert.throws(() => inspect(metadata, size - 16), /picture\/PCM/u);
		assert.throws(() => inspect({ ...metadata, maximumPacketBytes: 1048577 }), /window/u);
	}
});

test('independent picture checks reject stale/reordered native pictures, invalid values, changed alpha endpoints and excessive colors', () => {
	const bytes = new Float32Array(3 * 16 * 16 * 4);
	for (const [index, frame] of [0, 16384, 32767].entries()) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
		const source = motionMaximumIndexPixel(frame, x, y), offset = (index * 256 + y * 16 + x) * 4, alpha = source[3]!;
		for (let c = 0; c < 3; c++) {
			const value = alpha ? source[c]! / alpha : 0;
			bytes[offset + c] = value < .018 ? value * 4.5 : 1.099 * value ** .45 - .099;
		}
		bytes[offset + 3] = alpha;
	}
	assert.ok(inspectMotionMaximumNativePictures('index', bytes).maximumColorError < 1e-7);
	const stale = bytes.slice(); stale.copyWithin(1024, 0, 1024);
	assert.throws(() => inspectMotionMaximumNativePictures('index', stale), /bounds/u);
	const endpoint = bytes.slice(); endpoint[(8 * 16 + 8) * 4 + 3] = .001;
	assert.throws(() => inspectMotionMaximumNativePictures('index', endpoint), /endpoint/u);
	const invalid = bytes.slice(); invalid[0] = NaN;
	assert.throws(() => inspectMotionMaximumNativePictures('index', invalid), /invalid SDR/u);
	const excessive = bytes.slice(); excessive[0] += 9 / 1023;
	assert.throws(() => inspectMotionMaximumNativePictures('index', excessive), /bounds/u);
});

test('preview check preserves the original one-code premultiplied bound and exact quantized alpha', () => {
	const bytes = new Uint8Array(1024);
	for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
		const source = motionMaximumIndexPixel(0, x, y), alpha = source[3]!, offset = (y * 16 + x) * 4;
		bytes[offset + 3] = Math.round(alpha * 255);
		for (let c = 0; c < 3; c++) {
			const value = alpha ? source[c]! / alpha : 0;
			bytes[offset + c] = Math.round(255 * (value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055));
		}
	}
	assert.equal(inspectMotionMaximumPreview('index', 0, bytes).maximumPremultipliedCodeError, 0);
	const wrong = bytes.slice(); wrong[0] += 3;
	assert.throws(() => inspectMotionMaximumPreview('index', 0, wrong), /one premultiplied code/u);
	const alpha = bytes.slice(); alpha[3]--;
	assert.throws(() => inspectMotionMaximumPreview('index', 0, alpha), /alpha/u);
});

const memory = (frame = 0): MotionSustainedMemorySample => ({ elapsedMs: 100, telemetryElapsedMs: 100, completedFrames: frame,
	telemetrySequence: 1, rssBytes: 600_000_000, pssBytes: 400_000_000,
	isolateUsedHeapBytes: [60_000_000], isolateTotalHeapBytes: [80_000_000], wasmCapacityBytes: [32_000_000] });
test('maximum-index observer keeps the fixed policy bytes/cadence and rejects every memory operand and evidence gap', () => {
	assert.equal(MOTION_SUSTAINED_PLAN.maximumPhaseMs, 600000);
	assert.equal(motionMaximumNativeProfile('index').timeoutMs, 1800000);
	const accepted = memory(); inspectMotionMaximumMemory(accepted, null, 32768, 1800000);
	for (const wrong of [{ rssBytes: 2147483649 }, { pssBytes: 1610612737, rssBytes: 2147483648 },
		{ isolateUsedHeapBytes: [536870913], isolateTotalHeapBytes: [600000000] }, { wasmCapacityBytes: [268435457] },
		{ pssBytes: 600000001 }, { isolateUsedHeapBytes: [90000000] }]) assert.throws(() => inspectMotionMaximumMemory({ ...accepted, ...wrong }, null, 32768, 1800000), /ceiling/u);
	assert.throws(() => inspectMotionMaximumMemory({ ...accepted, rssBytes: NaN }, null, 32768, 1800000), /finite/u);
	assert.throws(() => inspectMotionMaximumMemory({ ...accepted, isolateUsedHeapBytes: [] }, null, 32768, 1800000), /isolate/u);
	assert.throws(() => inspectMotionMaximumMemory({ ...accepted, completedFrames: 32769 }, null, 32768, 1800000), /progress/u);
	assert.throws(() => inspectMotionMaximumMemory({ ...accepted, elapsedMs: 1101 }, null, 32768, 1800000), /cadence/u);
	assert.throws(() => inspectMotionMaximumMemory({ ...accepted, telemetrySequence: 2 }, null, 32768, 1800000), /isolate/u);
});

test('maximum-index retained-memory comparison refuses linear frame retention without padding missing observations', () => {
	const warm = [memory(120), memory(150), memory(180)], tail = [memory(32708), memory(32738), memory(32768)];
	assert.equal(inspectMotionMaximumIndexRetention(warm, tail).pssGrowthBytes, 0);
	assert.throws(() => inspectMotionMaximumIndexRetention(warm, tail.slice(0, 2)), /three genuine/u);
	assert.throws(() => inspectMotionMaximumIndexRetention(warm, tail.map(value => ({ ...value, pssBytes: value.pssBytes + 64 * 1024 * 1024 + 1 }))), /growth/u);
	assert.throws(() => inspectMotionMaximumIndexRetention(warm, tail.map(value => ({ ...value, wasmCapacityBytes: [] }))), /WASM/u);
});
