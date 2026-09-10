/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeferredArchiveRuntime } from '../src/common/editor/controller/deferred-archive-runtime.ts';

test('the lazy Audacity facade forwards planning and streams with consumer backpressure', async () => {
	const events: string[] = [];
	const implementation = {
		planImport: async () => { events.push('plan'); return { project: {}, sources: [] }; },
		async *readSourceChunks(_id: string, _source: string, { signal }: { signal: AbortSignal }) {
			try {
				for (let index = 0; index < 2; index += 1) {
					signal.throwIfAborted(); events.push(`read:${index}`); yield [Float32Array.of(index)];
				}
			} finally { events.push('close'); }
		},
	};
	const facade = createDeferredArchiveRuntime({ aup4: async () => {
		events.push('load');
		return { createAup4Client: () => implementation } as unknown as typeof import('../src/common/editor/aup4-client.js');
	} }).createAup4Client();
	assert.deepEqual(events, []);
	const signal = new AbortController().signal;
	await facade.planImport!('id', { title: 'test.aup3', signal, onProgress: () => undefined });
	const stream = facade.readSourceChunks!('id', 'source', { signal })[Symbol.asyncIterator]();
	assert.deepEqual(events, ['load', 'plan']);
	const first = await stream.next();
	assert.equal(first.value?.[0]?.[0], 0);
	assert.deepEqual(events, ['load', 'plan', 'read:0']);
	await stream.return?.();
	assert.deepEqual(events, ['load', 'plan', 'read:0', 'close']);
});
