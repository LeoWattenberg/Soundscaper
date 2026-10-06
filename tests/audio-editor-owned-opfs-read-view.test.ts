/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PCM_CONTAINER_STORAGE_TYPE } from '../src/common/editor/wavpack/index.js';
import { sourceFixture, sourceRecord } from './helpers/owned-source-read-session-fixture.ts';

function fixture() {
	let openings = 0;
	let releases = 0;
	const reads: number[] = [];
	const source = sourceRecord('source', 'token', { storage: PCM_CONTAINER_STORAGE_TYPE, path: 'source.scpcm', chunkCount: 2 });
	let afterOpen = () => {};
	let afterRead = () => {};
	const state = sourceFixture([source], [], {
		opfs: {
			async openPcmContainerReadView() {
				openings += 1;
				afterOpen();
				return {
					maximumConcurrentReads: 2,
					async chunk(index: number, signal?: AbortSignal) {
						signal?.throwIfAborted();
						reads.push(index);
						afterRead();
						return { index, frames: 1, channels: [Float32Array.of(index / 10)] };
					},
					async release() { releases += 1; },
				};
			},
			async readPcmContainerChunk() { throw new Error('The retained positional view must own this read.'); },
		} as never,
	});
	return { ...state, counts: () => ({ openings, releases, reads }),
		afterOpen: (callback: () => void) => { afterOpen = callback; },
		afterRead: (callback: () => void) => { afterRead = callback; },
		replace: () => { state.metadata.set('source', { ...source, sourceToken: 'new-token' }); } };
}

test('owned OPFS sessions bind and release one positional read view', async () => {
	const f = fixture();
	const session = await f.reader.openSession('source');
	assert.ok(session);
	assert.deepEqual([...(await session.chunk(1)).channels[0]!], [Math.fround(0.1)]);
	assert.deepEqual([...(await session.chunk(0)).channels[0]!], [0]);
	await session.release();
	await session.release();
	assert.deepEqual(f.counts(), { openings: 1, releases: 1, reads: [1, 0] });
});

test('owned OPFS session admission fences replacement while the positional view opens', async () => {
	const f = fixture();
	f.afterOpen(f.replace);
	await assert.rejects(f.reader.openSession('source'), /generation changed/iu);
	assert.deepEqual(f.counts(), { openings: 1, releases: 1, reads: [] });
});

test('owned OPFS session post-read fences still reject a replacement and close its view', async () => {
	const f = fixture();
	const session = await f.reader.openSession('source');
	assert.ok(session);
	f.afterRead(f.replace);
	await assert.rejects(session.chunk(0), /generation changed/iu);
	assert.deepEqual(f.counts(), { openings: 1, releases: 1, reads: [0] });
});

test('cancelled owned OPFS admission releases its view and preserves the request reason', async () => {
	const f = fixture();
	const abort = new AbortController();
	const reason = new Error('withdraw the source session');
	f.afterOpen(() => abort.abort(reason));
	await assert.rejects(f.reader.openSession('source', { signal: abort.signal }), (error) => error === reason);
	assert.deepEqual(f.counts(), { openings: 1, releases: 1, reads: [] });
});
