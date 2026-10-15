/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import CanvasKitInit from 'canvaskit-wasm';
import { createMotionMaximumIndexFixture } from '../desktop/motionscaper-native-maximum-index-fixture.ts';
import { MotionMaximumIndexPcmOracle, motionMaximumIndexPixel, inspectMotionMaximumIndexMetadata } from '../desktop/motionscaper-native-maximum-index-oracle.ts';
import { createMotionMediaProvider } from '../src/common/editor/motion-media-provider.ts';
import { createMotionAudioMixer } from '../src/common/editor/motion-audio-mixer.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { renderMotionCompositionFrame } from '../src/common/editor/motion-composition-renderer.ts';
import { MOTION_PRORES_DELIVERY_PROFILE } from '../src/common/editor/motion-desktop-delivery-contract.ts';
import { createMotionscaperDeliveryAuthority } from '../desktop/motionscaper-delivery-authority.ts';

const fixture = () => createMotionMaximumIndexFixture();

test('maximum native index fixture authors 32,768 animated pictures and explicit retained-source resets', () => {
	const { revision, bodies } = fixture(), composition = revision.project.compositions[0]!;
	assert.equal(MOTION_PRORES_DELIVERY_PROFILE.maximumFrames, 32768);
	assert.equal(composition.durationFrames, 32769, 'The same public project also exposes the first refused range.');
	assert.deepEqual([composition.width, composition.height, composition.frameRate], [16, 16, { num: 30, den: 1 }]);
	assert.equal(bodies.size, 1); assert.equal(bodies.get('sound')!.length, 7_680_044);
	assert.equal(composition.audio.length, 28);
	for (let index = 0; index < composition.audio.length; index++) {
		const placement = composition.audio[index]!;
		assert.deepEqual(placement.startFrame, { num: index * 1200, den: 1 });
		assert.deepEqual(placement.inFrame, { num: index * 1200, den: 1 });
		assert.deepEqual(placement.outFrame, { num: Math.min((index + 1) * 1200, 32769), den: 1 });
		assert.deepEqual(placement.sourceStart, { num: 0, den: 1 });
		assert.deepEqual(placement.timeScale, { num: 1, den: 1 });
	}
});

test('native main authority admits the full index with PCM and refuses picture32,769 before calling the output chooser', async () => {
	const { revision } = fixture(); let choosers = 0;
	const authority = createMotionscaperDeliveryAuthority({ chooseOutput: () => { choosers++; return Promise.resolve(null); },
		encoder: { encode: () => Promise.reject(new Error('No encoding is authorized by this preflight control.')) } });
	const plan = { identity: { projectId: revision.projectId, revisionDigest: revision.digest, compositionId: 'main' },
		width: 16, height: 16, frameRate: { num: 30, den: 1 }, firstFrame: 0, frameCount: 32768 };
	try {
		await assert.rejects(authority.begin({ plan: { ...plan, frameCount: 32769 }, suggestedName: 'refused.mov', audio: { sampleRate: 48000, channels: 2 } }), /bounded delivery profile/u);
		assert.equal(choosers, 0);
		assert.equal(await authority.begin({ plan, suggestedName: 'maximum.mov', audio: { sampleRate: 48000, channels: 2 } }), null);
		assert.equal(choosers, 1, 'The exact admitted boundary reaches the public destination choice.');
	} finally { await authority.dispose(); }
});

test('maximum native PCM expectation follows actual retained WAV remapping across every clip join and final output boundary', async () => {
	const { revision, bodies } = fixture(); let loads = 0;
	const provider = createMotionMediaProvider({ loadAsset: () => { loads++; return Promise.resolve(bodies.get('sound')!); } });
	const mixer = createMotionAudioMixer({ project: revision.project, provider, maximumCacheBytes: 32768 });
	try {
		for (const boundary of [0, ...Array.from({ length: 27 }, (_, index) => (index + 1) * 1_920_000), 52_428_800]) {
			const block = await mixer.mixBlock({ compositionId: 'main', startSample: boundary - 4, sampleCount: 8, sampleRate: 48000, channels: 2 });
			for (let index = 0; index < 8; index++) {
				const absolute = boundary - 4 + index;
				const expected = absolute < 0 ? 0 : ((absolute % 1_920_000) % 127 - 63) / 128;
				assert.equal(block.interleaved[index * 2], expected, `sample ${absolute}`);
				assert.equal(block.interleaved[index * 2 + 1], -expected || 0, `right sample ${absolute}`);
			}
			assert.ok(mixer.snapshot().cacheBytes <= 32768);
		}
		assert.equal(loads, 1);
		const end = await mixer.mixBlock({ compositionId: 'main', startSample: 32769 * 1600, sampleCount: 4, sampleRate: 48000, channels: 2 });
		assert.ok(end.interleaved.every(value => value === 0), 'Audio cannot extend beyond the authored final placement.');
	} finally { mixer.dispose(); provider.dispose(); }
});

test('independent maximum-index linear pixels match actual production rasterization at changing and endpoint pictures', async () => {
	const { revision } = fixture(), evaluator = compileMotionscaperProject(revision.project), kit = await CanvasKitInit();
	const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], loadAsset: () => Promise.reject(new Error('Only the audio asset is retained.')) });
	const images: Float32Array[] = [];
	for (const frame of [0, 16384, 32767]) {
		const output = await renderMotionCompositionFrame(evaluator.evaluate({ compositionId: 'main', time: { num: frame, den: 30 } }), { rasterizer });
		for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
			const expected = motionMaximumIndexPixel(frame, x, y), offset = (y * 16 + x) * 4;
			for (let c = 0; c < 4; c++) assert.ok(Math.abs(output.pixels[offset + c]! - expected[c]!) < 1e-7);
		}
		images.push(output.pixels);
	}
	assert.notDeepEqual(images[0], images[1]); assert.notDeepEqual(images[1], images[2]);
	assert.throws(() => motionMaximumIndexPixel(32768, 0, 0), /frame/u);
	assert.throws(() => motionMaximumIndexPixel(0, 16, 0), /pixel/u);
});

test('streaming maximum-index PCM oracle resets at asset joins and refuses continuous-ramp, truncated and oversized evidence', () => {
	const count = 1_920_004, oracle = new MotionMaximumIndexPcmOracle(count), continuous = new MotionMaximumIndexPcmOracle(count);
	const buffer = new Uint8Array(65536), view = new DataView(buffer.buffer);
	for (let first = 0; first < count; first += 8192) {
		const length = Math.min(8192, count - first);
		for (let index = 0; index < length; index++) {
			const expected = (((first + index) % 1_920_000) % 127 - 63) / 128;
			view.setFloat32(index * 8, expected, true); view.setFloat32(index * 8 + 4, -expected || 0, true);
		}
		const bytes = buffer.subarray(0, length * 8);
		oracle.write(bytes.subarray(0, 3)); oracle.write(bytes.subarray(3));
		if (first + length <= 1_920_000) continuous.write(bytes);
		else {
			const prefix = Math.max(0, 1_920_000 - first) * 8; continuous.write(bytes.subarray(0, prefix));
			const wrong = bytes.slice(prefix), changed = new DataView(wrong.buffer);
			changed.setFloat32(0, (1_920_000 % 127 - 63) / 128, true);
			assert.throws(() => continuous.write(wrong), /sample 1920000 channel 0/u);
		}
	}
	assert.deepEqual(oracle.finish(), { samples: count, channels: 2, sampleRate: 48000, exact: true });
	assert.throws(() => new MotionMaximumIndexPcmOracle(52_428_801), /sample admission/u);
	assert.throws(() => new MotionMaximumIndexPcmOracle(1).write(new Uint8Array(65537)), /window/u);
	assert.throws(() => new MotionMaximumIndexPcmOracle(1).finish(), /incomplete/u);
	const wrong = new Uint8Array(8); new DataView(wrong.buffer).setFloat32(0, 1, true);
	assert.throws(() => new MotionMaximumIndexPcmOracle(1).write(wrong), /sample 0 channel 0/u);
});

test('maximum-index native metadata requires every timestamp, complete PCM and exactly three selected pictures', () => {
	const metadata = { width: 16, height: 16, frameCount: 32768, selectedFrames: [0, 16384, 32767],
		firstTimestamp: { num: 0, den: 30 }, lastTimestamp: { num: 32767, den: 30 }, contiguousFrameTimes: true,
		profile: 4, colorDepth: 12, alphaDepth: 16, colorPrimaries: 1, colorTransfer: 1, colorSpace: 1,
		maximumReadBytes: 65536, maximumPacketBytes: 48000,
		audio: { sampleRate: 48000, channels: 2, sampleCount: 52_428_800, contiguous: true } };
	const inspect = (value: unknown, pictureBytes = 12288, pcmBytes = 419430400) => inspectMotionMaximumIndexMetadata(value, pictureBytes, pcmBytes);
	assert.deepEqual(inspect(metadata), metadata);
	assert.throws(() => inspect({ ...metadata, frameCount: 32767 }), /picture contract/u);
	assert.throws(() => inspect({ ...metadata, contiguousFrameTimes: false }), /timestamps/u);
	assert.throws(() => inspect({ ...metadata, lastTimestamp: { num: 32766, den: 30 } }), /timestamps/u);
	assert.throws(() => inspect({ ...metadata, selectedFrames: [0, 16383, 32767] }), /selected/u);
	assert.throws(() => inspect(metadata, 32768 * 16 * 16 * 16), /picture bytes/u);
	assert.throws(() => inspect(metadata, 12288, 419430392), /PCM/u);
	assert.throws(() => inspect({ ...metadata, maximumReadBytes: 65537 }), /window/u);
});
