/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperVideoFrameAddressV27 } from '../src/framescaper/video-frame-address-v27.ts';

test('frame addressing is deterministic across random traversal, retry, and eviction', async () => {
	const captures: number[] = [];
	let failedOnce = false;
	const address = createFramescaperVideoFrameAddressV27({
		sources: new Map([['source-1', new Blob(['video'])]]),
		timingViewsBySourceId: new Map([['source-1', {
			kind: 'cfr' as const, rate: { num: 1, den: 1 }, frameCount: 5,
		}]]),
		maximumCacheBytes: 8,
		createDecoder: () => ({
			capture({ timestampSeconds, width, height }) {
				const ordinal = Math.floor(timestampSeconds);
				captures.push(ordinal);
				if (ordinal === 1 && !failedOnce) {
					failedOnce = true;
					throw new Error('transient decode');
				}
				return { width, height, pixels: Uint8Array.of(ordinal, ordinal, ordinal, 255) };
			},
			dispose() {},
		}),
	});
	const signal = new AbortController().signal;
	const resolve = (sourceFrame: number) => address.resolve({
		sourceId: 'source-1', sourceFrame, width: 1, height: 1, signal,
	});
	assert.equal((await resolve(3)).pixels[0], 3);
	assert.equal((await resolve(0)).pixels[0], 0);
	await assert.rejects(() => resolve(1), /transient decode/iu);
	assert.equal((await resolve(1)).pixels[0], 1, 'a failed decode is never retained as authority');
	assert.equal((await resolve(3)).pixels[0], 3, 'evicted frames decode to the same ordinal value');
	assert.deepEqual(captures, [3, 0, 1, 1, 3]);
	const mutable = await resolve(3);
	mutable.pixels[0] = 255;
	assert.equal((await resolve(3)).pixels[0], 3, 'callers cannot mutate a retained frame');
	await address.dispose();
	await assert.rejects(() => resolve(0), /closed/iu);
});

test('frame addressing binds CFR midpoint timestamps and exact requested geometry', async () => {
	const requests: Array<Readonly<{ timestampSeconds: number; width: number; height: number }>> = [];
	const address = createFramescaperVideoFrameAddressV27({
		sources: new Map([['source-1', new Blob(['video'])]]),
		timingViewsBySourceId: new Map([['source-1', {
			kind: 'cfr' as const, rate: { num: 30_000, den: 1_001 }, frameCount: 2,
		}]]),
		createDecoder: () => ({
			capture(request) {
				requests.push(request);
				return { width: 1, height: 1, pixels: Uint8Array.of(7, 8, 9, 255) };
			},
			dispose() {},
		}),
	});
	const frame = await address.resolve({
		sourceId: 'source-1', sourceFrame: 1, width: 2, height: 2,
		signal: new AbortController().signal,
	});
	assert.ok(Math.abs(requests[0]!.timestampSeconds - 1.5 * 1_001 / 30_000) < 1e-12);
	assert.deepEqual({ width: requests[0]!.width, height: requests[0]!.height }, { width: 2, height: 2 });
	assert.deepEqual({ width: frame.width, height: frame.height }, { width: 2, height: 2 });
	assert.deepEqual([...frame.pixels.subarray(0, 4)], [7, 8, 9, 255]);
	await address.dispose();
});
