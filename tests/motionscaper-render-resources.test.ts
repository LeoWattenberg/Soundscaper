/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import type { MotionAsset } from '../src/common/editor/motion-asset.ts';
import { loadMotionscaperAssetBytes } from '../src/motionscaper/editor-render-resources.ts';

const bytes = Uint8Array.of(1, 2, 3, 4); const digest = createHash('sha256').update(bytes).digest('hex');
const asset: MotionAsset = { kind: 'image', id: 'image', name: 'image', byteLength: bytes.length, sha256: digest,
	storageKey: `motion-sha256:${digest}`, mimeType: 'image/png', width: 1, height: 1, hasAlpha: true };

test('render resources verify an exact asset closure from bounded retained byte chunks', async () => {
	const store = { readAsset: () => Promise.resolve({ size: 4, stream: () => new ReadableStream<Uint8Array>({ start(controller) {
		controller.enqueue(bytes.subarray(0, 2)); controller.enqueue(bytes.subarray(2)); controller.close();
	} }) }) };
	assert.deepEqual(await loadMotionscaperAssetBytes(asset, store), bytes);
	await assert.rejects(loadMotionscaperAssetBytes({ ...asset, sha256: '0'.repeat(64), storageKey: `motion-sha256:${'0'.repeat(64)}` }, store), /digest/u);
});

test('render resources refuse oversized or missing assets before reading and cancel truncated streams', async () => {
	let calls = 0;
	await assert.rejects(loadMotionscaperAssetBytes({ ...asset, byteLength: 64 * 1024 * 1024 + 1 }, {
		readAsset: () => { calls++; return Promise.resolve(null); },
	}), /64 MiB/u); assert.equal(calls, 0);
	await assert.rejects(loadMotionscaperAssetBytes(asset, { readAsset: () => Promise.resolve(null) }), /unavailable/u);
	await assert.rejects(loadMotionscaperAssetBytes(asset, { readAsset: () => Promise.resolve({ size: 4,
		stream: () => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.of(1)); controller.close(); } }),
	}) }), /truncated/u);
	const aborted = new AbortController(); aborted.abort();
	await assert.rejects(loadMotionscaperAssetBytes(asset, { readAsset: () => Promise.resolve(null) }, aborted.signal), { name: 'AbortError' });
});
