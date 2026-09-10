/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRetainedCaptureVideoBody } from '../src/common/editor/controller/capture/internal/framescaper-capture-retained-media.ts';

void test('retained capture probes receive canonical bytes with subclass overrides removed', async () => {
	class StoredMedia extends Blob {
		override get size(): number { throw new Error('Untrusted size getter'); }
		override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('Untrusted byte reader'); }
	}
	const body = await loadRetainedCaptureVideoBody({
		loadMediaAsset: () => Promise.resolve(new StoredMedia(['video'])),
	}, 'capture', 5, null);
	assert.equal(body.size, 5);
	assert.equal(await body.text(), 'video');
	assert.equal(Object.getPrototypeOf(body), Blob.prototype);
});

for (const stored of [null, new Blob(['short']), { size: 10, arrayBuffer: () => new ArrayBuffer(10) }]) {
	void test(`retained capture refuses invalid body ${String(stored)}`, async () => {
		await assert.rejects(loadRetainedCaptureVideoBody({ loadMediaAsset: () => Promise.resolve(stored) },
			'capture', 10, null), /missing or truncated|genuine Blob/u);
	});
}

void test('capture cancellation fences the retained media read on both sides', async () => {
	const abort = new AbortController();
	const reason = new Error('Cancelled');
	let reads = 0;
	const store = { loadMediaAsset: () => {
		reads += 1;
		abort.abort(reason);
		return Promise.resolve(new Blob(['video']));
	} };
	await assert.rejects(loadRetainedCaptureVideoBody(store, 'capture', 5, abort.signal), error => error === reason);
	await assert.rejects(loadRetainedCaptureVideoBody(store, 'capture', 5, abort.signal), error => error === reason);
	assert.equal(reads, 1);
});
