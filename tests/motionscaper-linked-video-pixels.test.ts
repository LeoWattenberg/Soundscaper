/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyLinkedVideoPixels, type LinkedVideoObservation } from './browser/helpers/motion-linked-video-pixels.ts';

function observation(format: 'I420' | 'NV12' | 'BGRX' = 'I420'): LinkedVideoObservation {
	const rgb = format === 'BGRX';
	return {
		fileColorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
		frames: [0, 500_000].map(timestamp => ({
			format, timestamp, duration: 500_000, width: 96, height: 64,
			colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
			yuv: rgb ? null : [32, 239, 118], rgba: rgb ? [0, 0, 251, 255] : null,
			canvas: rgb ? [0, 0, 251, 255] : [1, 0, 241, 255],
			control: rgb ? [0, 0, 251, 255] : [1, 0, 241, 255],
		})),
		html: rgb ? [0, 0, 251, 255] : [1, 0, 241, 255],
	};
}

test('Motion downloaded 709 file keeps absolute 12-code fidelity separately from measured display approximation', () => {
	for (const format of ['I420', 'NV12'] as const) {
		const report = observation(format);
		const result = verifyLinkedVideoPixels(report);
		assert.deepEqual(result.classifications, ['normative-bt709-planes', 'normative-bt709-planes']);
		assert.ok(result.colors.every(color => Math.abs(color[2]! - 253.106735200587) < 1e-8));
		assert.equal(report.html[2], 241);
		assert.ok(Math.abs(report.html[2]! - 255) > 12, 'the historical absolute HTML oracle remains failed');
	}
});

test('Motion native RGB fallback is explicitly plane-unqualified and cannot replace authored fidelity with a control', () => {
	assert.deepEqual(verifyLinkedVideoPixels(observation('BGRX')).classifications, ['native-rgb-planes-unqualified', 'native-rgb-planes-unqualified']);
	const changed = observation('BGRX');
	for (const frame of changed.frames) { frame.rgba = [1, 0, 241, 255]; frame.canvas = [1, 0, 241, 255]; frame.control = [1, 0, 241, 255]; }
	changed.html = [1, 0, 241, 255];
	assert.throws(() => verifyLinkedVideoPixels(changed), /authored file color/u);
});

test('Motion file oracle rejects wrong or absent matrix/range, wrong planes, dimensions, count and timing', () => {
	const changes: ((report: LinkedVideoObservation) => void)[] = [
		r => { r.fileColorSpace.matrix = 'smpte170m'; }, r => { r.fileColorSpace.fullRange = true; },
		r => { r.fileColorSpace.transfer = null; }, r => { r.frames[0]!.colorSpace.matrix = 'smpte170m'; },
		r => { r.frames[0]!.yuv = [41, 240, 110]; }, r => { r.frames[0]!.yuv = [32, 239, Number.NaN]; },
		r => { r.frames[0]!.width = 95; }, r => { r.frames.pop(); },
		r => { r.frames[1]!.timestamp = 499_999; }, r => { r.frames[0]!.duration = 499_999; },
	];
	for (const change of changes) { const report = observation(); change(report); assert.throws(() => verifyLinkedVideoPixels(report)); }
});

test('Motion presentation control must agree with actual native and HTML measurements independently', () => {
	for (const field of ['canvas', 'control'] as const) {
		const report = observation(); report.frames[0]![field] = [1, 0, 253, 255];
		assert.throws(() => verifyLinkedVideoPixels(report), /presentation/u);
	}
	const report = observation(); report.html = [1, 0, 253, 255];
	assert.throws(() => verifyLinkedVideoPixels(report), /presentation/u);
});

test('Motion native RGB observations still require actual 709 metadata without conflicting or missing fields', () => {
	for (const colorSpace of [
		{ primaries: null, transfer: 'bt709', matrix: 'bt709', fullRange: false },
		{ primaries: 'bt709', transfer: 'smpte170m', matrix: 'bt709', fullRange: false },
		{ primaries: 'bt709', transfer: 'bt709', matrix: 'smpte170m', fullRange: false },
		{ primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: true },
	] satisfies VideoColorSpaceInit[]) {
		const report = observation('BGRX'); report.frames[0]!.colorSpace = colorSpace;
		assert.throws(() => verifyLinkedVideoPixels(report), /metadata/u);
	}
});
