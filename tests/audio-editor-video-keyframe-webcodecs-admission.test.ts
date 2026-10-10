/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRequest } from '../src/common/editor/video-keyframe-video-encoder-admission.ts';
import { encodeVideoKeyframeVideo } from '../src/common/editor/video-keyframe-video-encoder.ts';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';

function fixture() {
	return {
		frameSource: createVideoExactPictureExportFrameSource({
			sampleRate: 48_000, startFrame: 0, endFrame: 48_000,
			canvas: { width: 4, height: 2, frameRate: 1 },
		}),
		producer: { width: 4, height: 2, byteLength: 32, produce() {}, dispose() {} },
		format: 'mp4' as const,
	};
}

function decision() {
	return {
		codec: 'avc1.4d001e', bitrate: 100_000,
		encoderClass: class Encoder {}, videoFrameClass: class Frame {},
	};
}

test('direct native encoding rejects malformed WebCodecs decisions before resources or execution', async () => {
	const variants: readonly [Record<string, unknown>, RegExp][] = [
		[{ ...decision(), hardwareAcceleration: 'prefer-software' }, /hardwareAcceleration/u],
		[{ ...decision(), hardwareAcceleration: undefined }, /hardwareAcceleration/u],
		[{ ...decision(), undocumentedOption: true }, /unsupported field/u],
		[{ ...decision(), codec: '' }, /codec/u],
		[{ ...decision(), codec: 'a'.repeat(129) }, /codec/u],
		[{ ...decision(), bitrate: 0 }, /bitrate/u],
		[{ ...decision(), bitrate: Number.NaN }, /bitrate/u],
		[{ ...decision(), encoderClass: {} }, /encoderClass/u],
		[{ ...decision(), videoFrameClass: null }, /videoFrameClass/u],
	];
	for (const [webCodecs, message] of variants) {
		let operations = 0;
		await assert.rejects(encodeVideoKeyframeVideo(null, {
			...fixture(), webCodecs: webCodecs as never,
		}, {
			createJobToken() { operations += 1; return 'abcdef0123456789abcdef0123456789'; },
			executeBrowserWebCodecs() { operations += 1; throw new Error('Unexpected encoder execution'); },
		}), message);
		assert.equal(operations, 0, 'invalid decisions cannot acquire resources or reach a native encoder');
	}
});

test('direct native encoding refuses accessor-bearing decisions without invoking accessors', async () => {
	let calls = 0;
	const webCodecs = { ...decision() };
	Object.defineProperty(webCodecs, 'codec', { enumerable: true, get() { calls += 1; return 'avc1.4d001e'; } });
	await assert.rejects(encodeVideoKeyframeVideo(null, { ...fixture(), webCodecs }), /own data property/u);
	assert.equal(calls, 0);
});

test('WebCodecs admission captures a frozen decision including its optional hardware preference', () => {
	for (const hardware of [false, true]) {
		const webCodecs = { ...decision(), ...(hardware ? { hardwareAcceleration: 'prefer-hardware' as const } : {}) };
		const admitted = normalizeRequest({ ...fixture(), webCodecs });
		assert.deepEqual(admitted.webCodecs, webCodecs);
		assert.notEqual(admitted.webCodecs, webCodecs);
		assert.equal(Object.isFrozen(admitted.webCodecs), true);
		webCodecs.codec = 'changed';
		assert.equal(admitted.webCodecs?.codec, 'avc1.4d001e');
		assert.equal(admitted.webCodecs?.hardwareAcceleration, hardware ? 'prefer-hardware' : undefined);
	}
});
