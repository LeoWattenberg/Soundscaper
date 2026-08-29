/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSourcePcmReadSession } from '../src/common/editor/storage/source-pcm-read-session.ts';

test('backend AbortError cancellation stays local and preserves the request reason', async () => {
	const readStarted = deferred();
	let reads = 0;
	let releases = 0;
	const session = createSourcePcmReadSession({
		async readChunk(chunkIndex, signal) {
			reads += 1;
			if (reads > 1) {
				return { index: chunkIndex, frames: 1, channels: [Float32Array.of(0.5)] };
			}
			readStarted.resolve();
			return new Promise<never>((_resolve, reject) => {
				signal?.addEventListener('abort', () => {
					const error = new Error('backend cancellation');
					error.name = 'AbortError';
					reject(error);
				}, { once: true });
			});
		},
		async release() { releases += 1; },
		onRelease() { /* The test owns the session directly. */ },
	});
	const request = new AbortController();
	const cancellation = new Error('cancel only this in-flight request');
	const firstRead = session.chunk(0, { signal: request.signal });
	await readStarted.promise;
	request.abort(cancellation);

	await assert.rejects(firstRead, (error) => error === cancellation);
	assert.equal(releases, 0, 'request cancellation must not release the reusable session');
	assert.deepEqual([...((await session.chunk(0)).channels[0])], [0.5]);
	await session.release();
	assert.equal(releases, 1);
});

function deferred(): Readonly<{ promise: Promise<void>; resolve: () => void }> {
	let resolve!: () => void;
	const promise = new Promise<void>((accept) => { resolve = () => accept(); });
	return { promise, resolve };
}
