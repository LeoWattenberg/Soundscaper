/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { SourceReadRepository } from '../src/common/editor/storage/source-read-repository.ts';

test('copy-on-write reads return their replacement iterator when the first read is cancelled', async () => {
	const controller = new AbortController();
	let iteratorReturns = 0;
	const replacementIterator = {
		async next() {
			controller.abort(new DOMException('cancel derived read', 'AbortError'));
			return {
				done: false as const,
				value: { index: 0, sourceToken: 'replacement-token', frames: 1 },
			};
		},
		async return() {
			iteratorReturns += 1;
			return { done: true as const, value: undefined };
		},
	};
	const repository = new SourceReadRepository({
		records: {
			getMetadata: async () => ({
				id: 'derived',
				storage: 'copy-on-write',
				sourceToken: 'replacement-token',
				baseSourceId: 'base',
				chunkCount: 1,
			}),
			chunks: () => ({ [Symbol.asyncIterator]: () => replacementIterator }),
		} as never,
		pcm: {} as never,
		opfs: {} as never,
	});

	const iterator = repository.chunks('derived', { signal: controller.signal })[Symbol.asyncIterator]();
	await assert.rejects(
		iterator.next(),
		(error: unknown) => error instanceof Error && error.name === 'AbortError',
	);
	assert.equal(iteratorReturns, 1);
});
