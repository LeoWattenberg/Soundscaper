/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { scapeAudioSourceStream } from '../src/common/editor/scape-archive-media.ts';

test('audio source streaming preserves a read failure when iterator cleanup also fails', async () => {
	const primary = new Error('stored PCM is unavailable');
	const cleanup = new Error('stored PCM cleanup failed');
	const iterator: AsyncIterableIterator<readonly Float32Array[]> = {
		async next() { throw primary; },
		async return() { throw cleanup; },
		[Symbol.asyncIterator]() { return iterator; },
	};
	const stream = scapeAudioSourceStream({
		readSourceChunks() { return iterator; },
	}, {
		id: 'audio', frameCount: 1, channelCount: 1, chunkFrames: 1,
	}, {
		update() {},
		digest() { return new Uint8Array(); },
	}, () => undefined);

	await assert.rejects(stream.getReader().read(), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [primary, cleanup]);
		return true;
	});
});
