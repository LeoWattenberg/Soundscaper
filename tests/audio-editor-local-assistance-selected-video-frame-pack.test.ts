/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLocalAssistanceSelectedVideoFramePacksV1,
} from '../src/common/editor/controller/local-assistance-selected-video-frame-pack.ts';
import {
	reviewAssistanceFramePackV1,
} from '../src/common/editor/assistance/binary-formats-v1.ts';

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
