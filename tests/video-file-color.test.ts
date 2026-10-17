/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { avc64SrgbColors, type Avc64ColorObservation, type Avc64PixelPlan } from './browser/helpers/video-file-color.ts';

const plan: Avc64PixelPlan = { mode: 'all-two-at-2fps', points: [{ x: 16, y: 24 }, { x: 16, y: 40 }] };
function observation(format = 'I420'): Avc64ColorObservation {
	return {
		fileColorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
		frames: [0, 500_000].map(timestamp => ({
			format, timestamp, duration: 500_000, width: 64, height: 64,
			colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
			pixels: [[67, 101, 193], [46, 195, 110]].map(yuv => ({ yuv, rgba: null,
				canvas: [176, 31, 5, 255], control: [176, 31, 5, 255] })),
		})),
	};
}

test('MP4 native YUV midtones apply independent709 matrix and inverse transfer before authored sRGB comparison', () => {
	for (const format of ['I420', 'NV12']) {
		const result = avc64SrgbColors(observation(format), plan);
		assert.deepEqual(result.classifications, ['native-yuv-bt709-to-srgb', 'native-yuv-bt709-to-srgb']);
		for (const pixels of result.colors) {
			for (const [index, expected] of [[183.87976385987335, 46.29020941056953, 6.7434172243966035], [7.643378871493786, 46.023733739313364, 184.38137274931458]].entries()) {
				for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(pixels[index]![channel]! - expected[channel]!) < 1e-8);
				assert.equal(pixels[index]![3], 255);
			}
		}
	}
});

test('MP4 same-plane Canvas agreement cannot replace the authored file-color oracle', () => {
	const report = observation();
	for (const frame of report.frames) for (const pixel of frame.pixels) { pixel.yuv = [16, 128, 128]; pixel.canvas = [0, 0, 0, 255]; pixel.control = [0, 0, 0, 255]; }
	const result = avc64SrgbColors(report, plan);
	assert.throws(() => { for (const frame of result.colors) assert.ok(Math.abs(frame[0]![0]! - 191) <= 20, 'authored sRGB20 fidelity'); }, /authored sRGB20/u);
	assert.throws(() => { for (const frame of result.colors) assert.ok(Math.abs(frame[0]![0]! - 255) <= 12, 'authored sRGB12 fidelity'); }, /authored sRGB12/u);
});

test('MP4 native RGB outputs are explicitly classified and strictly measured in their declared transfer', () => {
	for (const format of ['RGBA', 'RGBX', 'BGRA', 'BGRX']) for (const transfer of ['iec61966-2-1', 'bt709'] as const) {
		const report = observation(format);
		for (const frame of report.frames) {
			frame.colorSpace = { primaries: 'bt709', transfer, matrix: 'rgb', fullRange: true };
			for (const pixel of frame.pixels) { pixel.yuv = null; pixel.rgba = [0, 0, 0, 255]; pixel.canvas = [0, 0, 0, 255]; pixel.control = [0, 0, 0, 255]; }
		}
		const result = avc64SrgbColors(report, plan);
		assert.ok(result.classifications.every(value => value.includes('native-rgb') && value.endsWith('no-yuv-proof')));
		assert.throws(() => { for (const frame of result.colors) assert.ok(Math.abs(frame[0]![0]! - 191) <= 20, 'authored RGB fidelity'); }, /authored RGB/u);
	}
});

test('MP4 native RGB midtones honor explicit sRGB versus709 rather than a silent raw-byte fallback', () => {
	for (const transfer of ['iec61966-2-1', 'bt709'] as const) {
		const report = observation('RGBX');
		for (const frame of report.frames) {
			frame.colorSpace = { primaries: 'bt709', transfer, matrix: 'rgb', fullRange: true };
			for (const pixel of frame.pixels) { pixel.yuv = null; pixel.rgba = [128, 128, 128, 255]; pixel.canvas = [128, 128, 128, 255]; pixel.control = [128, 128, 128, 255]; }
		}
		const expected = transfer === 'bt709' ? 139.8116148374954 : 128;
		for (const frame of avc64SrgbColors(report, plan).colors) for (const pixel of frame) {
			for (const channel of pixel.slice(0, 3)) assert.ok(Math.abs(channel - expected) < 1e-8);
		}
	}
});

test('MP4 native RGB refuses unknown transfer, conflicting primaries/matrix/range and missing alpha', () => {
	for (const changed of [
		{ primaries: 'bt470bg', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true },
		{ primaries: 'bt709', transfer: null, matrix: 'rgb', fullRange: true },
		{ primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
	] satisfies VideoColorSpaceInit[]) {
		const report = observation('RGBA');
		for (const frame of report.frames) { frame.colorSpace = changed; for (const pixel of frame.pixels) { pixel.yuv = null; pixel.rgba = [0, 0, 255, 255]; } }
		assert.throws(() => avc64SrgbColors(report, plan), /native RGB/u);
	}
	const report = observation('RGBA');
	for (const frame of report.frames) {
		frame.colorSpace = { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true };
		for (const pixel of frame.pixels) { pixel.yuv = null; pixel.rgba = [0, 0, 255, 254]; }
	}
	assert.throws(() => avc64SrgbColors(report, plan));
});

test('MP4 file-color measurement refuses changed metadata, frame order/count/geometry, invalid samples or presentation', () => {
	const changes: ((report: Avc64ColorObservation) => void)[] = [
		r => { r.fileColorSpace.transfer = null; }, r => { r.fileColorSpace.fullRange = true; },
		r => { r.frames[0]!.colorSpace.matrix = 'smpte170m'; }, r => { r.frames[0]!.colorSpace.transfer = 'smpte170m'; },
		r => { r.frames[0]!.pixels[0]!.yuv = [16, Number.NaN, 128]; }, r => { r.frames[0]!.pixels[0]!.yuv = [16, 128]; },
		r => { r.frames[1]!.timestamp = 499_999; }, r => { r.frames[0]!.duration = 499_999; }, r => { r.frames.reverse(); },
		r => { r.frames[0]!.width = 65; }, r => { r.frames.pop(); }, r => { r.frames[0]!.format = 'I422'; },
		r => { r.frames[0]!.pixels.pop(); }, r => { r.frames[0]!.pixels[0]!.control = [175, 31, 5, 255]; },
		r => { r.frames[0]!.pixels[0]!.canvas[3] = 254; },
	];
	for (const change of changes) { const report = observation(); change(report); assert.throws(() => avc64SrgbColors(report, plan)); }
});

test('MP4 image mode proves only first1fps frame and refuses an implicit extra-frame downgrade', () => {
	const firstPlan: Avc64PixelPlan = { mode: 'first-at-1fps', points: [{ x: 32, y: 32 }] };
	const report = observation(); report.frames = [report.frames[0]!]; report.frames[0]!.duration = 1_000_000;
	report.frames[0]!.pixels = [report.frames[0]!.pixels[0]!];
	assert.equal(avc64SrgbColors(report, firstPlan).colors.length, 1);
	assert.throws(() => avc64SrgbColors(report, plan), /decoded frame count/u);
	assert.throws(() => avc64SrgbColors(report, { ...firstPlan, points: [{ x: 64, y: 32 }] }));
});
