/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLocalAssistanceSelectedVideoFramePacksV1,
	createLocalAssistanceSelectedVideoVisualFramePackV2,
	createLocalAssistanceSelectedVideoVisualFramePacksV2,
} from '../src/common/editor/controller/local-assistance-selected-video-frame-pack.ts';
import {
	reviewAssistanceFramePackV1,
} from '../src/common/editor/assistance/binary-formats-v1.ts';
import {
	reviewAssistanceVisualFramePackV2,
} from '../src/common/editor/assistance/visual-frame-pack-v2.ts';

const BODY = new Blob(['video'], { type: 'video/mp4' });

test('accurate selected-video preparation emits bounded exact RGBA packs with source timing', async () => {
	const captures: number[] = [];
	let disposed = 0;
	let currentChecks = 0;
	const packs = await createLocalAssistanceSelectedVideoFramePacksV1({
		body: BODY,
		timing: {
			timescale: 1_000,
			frames: [
				{ sourceFrame: 7, presentationTick: '400', timestampSeconds: 0.42 },
				{ sourceFrame: 8, presentationTick: '440', timestampSeconds: 0.46 },
				{ sourceFrame: 9, presentationTick: '500', timestampSeconds: 0.53 },
			],
		},
		signal: new AbortController().signal,
		assertCurrent: () => { currentChecks += 1; },
	}, {
		framesPerPack: 2,
		createDecoder: async (body, { signal }) => {
			assert.strictEqual(body, BODY);
			assert.equal(signal.aborted, false);
			return {
				async capture({ timestampSeconds }) {
					captures.push(timestampSeconds);
					return { width: 2, height: 1, rgba: Uint8Array.of(
						1, 2, 3, 255, 5, 6, 7, 255,
					) };
				},
				dispose() { disposed += 1; },
			};
		},
	});

	assert.equal(disposed, 1);
	assert.ok(currentChecks >= 7);
	assert.deepEqual(captures, [0.42, 0.46, 0.53]);
	assert.equal(packs.length, 2);
	assert.ok(packs.every((pack) => pack.type === 'application/vnd.soundscaper.frame-pack'));
	const first = reviewAssistanceFramePackV1(new Uint8Array(await packs[0]!.arrayBuffer()));
	assert.equal(first.width, 48);
	assert.equal(first.height, 27);
	assert.equal(first.timescale, 1_000);
	assert.equal(first.frameCount, 2);
	assert.deepEqual({
		sourceFrame: first.frame(0).sourceFrame,
		presentationTick: first.frame(0).presentationTick,
		firstPixel: Array.from(first.frame(0).rgba.subarray(0, 4)),
		lastPixel: Array.from(first.frame(0).rgba.subarray((48 * 27 - 1) * 4)),
	}, {
		sourceFrame: 7, presentationTick: '400',
		firstPixel: [1, 2, 3, 255], lastPixel: [5, 6, 7, 255],
	});
	const second = reviewAssistanceFramePackV1(new Uint8Array(await packs[1]!.arrayBuffer()));
	assert.equal(second.frameCount, 1);
	assert.equal(second.frame(0).sourceFrame, 9);
});

test('frame packing rejects stale, unordered, and excessive custody and always disposes', async () => {
	await assert.rejects(createLocalAssistanceSelectedVideoFramePacksV1({
		body: BODY,
		timing: { timescale: 1_000, frames: [
			{ sourceFrame: 2, presentationTick: '2', timestampSeconds: 0.2 },
			{ sourceFrame: 1, presentationTick: '3', timestampSeconds: 0.3 },
		] },
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
	}), /timing|ordered/iu);

	let disposed = 0;
	let current = true;
	await assert.rejects(createLocalAssistanceSelectedVideoFramePacksV1({
		body: BODY,
		timing: { timescale: 1_000, frames: [
			{ sourceFrame: 1, presentationTick: '2', timestampSeconds: 0.2 },
		] },
		signal: new AbortController().signal,
		assertCurrent: () => { if (!current) throw new Error('project changed'); },
	}, {
		createDecoder: async () => ({
			capture() { current = false; return { width: 1, height: 1,
				rgba: Uint8Array.of(1, 2, 3, 255) }; },
			dispose() { disposed += 1; },
		}),
	}), /project changed/iu);
	assert.equal(disposed, 1);
});

test('visual packing authenticates exact source geometry separately from its bounded raster', async () => {
	const captures: number[] = [];
	const body = await createLocalAssistanceSelectedVideoVisualFramePackV2({
		body: BODY, sourceWidth: 1_920, sourceHeight: 1_080, rasterWidth: 2, rasterHeight: 1,
		timing: { timescale: 1_000, frames: [
			{ sourceFrame: 7, presentationTick: '400', timestampSeconds: 0.42 },
		] }, signal: new AbortController().signal, assertCurrent() {},
	}, { createDecoder: async (_body, options) => {
		assert.deepEqual({ width: options.width, height: options.height }, { width: 2, height: 1 });
		return { capture({ timestampSeconds }) {
			captures.push(timestampSeconds);
			return { width: 2, height: 1, rgba: Uint8Array.of(
				1, 2, 3, 255, 5, 6, 7, 255,
			) };
		}, dispose() {} };
	} });
	assert.equal(body.type, 'application/vnd.soundscaper.frame-pack');
	assert.deepEqual(captures, [0.42]);
	const reviewed = reviewAssistanceVisualFramePackV2(new Uint8Array(await body.arrayBuffer()));
	assert.deepEqual({ sourceWidth: reviewed.sourceWidth, sourceHeight: reviewed.sourceHeight,
		rasterWidth: reviewed.rasterWidth, rasterHeight: reviewed.rasterHeight,
		timescale: reviewed.timescale, frameCount: reviewed.frameCount }, {
		sourceWidth: 1_920, sourceHeight: 1_080, rasterWidth: 2, rasterHeight: 1,
		timescale: 1_000, frameCount: 1,
	});
	assert.deepEqual(Array.from(reviewed.frame(0).rgba), [1, 2, 3, 255, 5, 6, 7, 255]);
});

test('visual packing chunks long timing without retaining one unbounded RGBA inventory', async () => {
	let disposed = 0;
	const packs = await createLocalAssistanceSelectedVideoVisualFramePacksV2({
		body: BODY, sourceWidth: 1_920, sourceHeight: 1_080, rasterWidth: 1, rasterHeight: 1,
		timing: { timescale: 1_000, frames: [1, 2, 3].map((sourceFrame) => ({ sourceFrame,
			presentationTick: String(sourceFrame * 10), timestampSeconds: sourceFrame / 10 })) },
		signal: new AbortController().signal, assertCurrent() {},
	}, { framesPerPack: 2, createDecoder: async () => ({
		capture: ({ timestampSeconds }) => ({ width: 1, height: 1,
			rgba: Uint8Array.of(Math.round(timestampSeconds * 10), 0, 0, 255) }),
		dispose() { disposed += 1; },
	}) });
	assert.equal(disposed, 1);
	assert.equal(packs.length, 2);
	const reviewed = await Promise.all(packs.map(async (pack) =>
		reviewAssistanceVisualFramePackV2(new Uint8Array(await pack.arrayBuffer()))));
	assert.deepEqual(reviewed.map(({ frameCount }) => frameCount), [2, 1]);
	assert.deepEqual(reviewed.flatMap((pack) => Array.from({ length: pack.frameCount },
		(_, index) => pack.frame(index).sourceFrame)), [1, 2, 3]);
});
