/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	oneShotLinkedOriginalRelease,
	possibleLinkedOriginalRelease,
	sameLinkedOriginalBinding,
} from '../src/common/editor/storage/linked-original-custody.ts';

test('linked-original release discovery admits only an enumerable own data operation', async () => {
	let getterCalls = 0;
	const accessor = Object.defineProperty({}, 'release', {
		enumerable: true,
		get() { getterCalls += 1; return () => undefined; },
	});
	assert.equal(possibleLinkedOriginalRelease(accessor), null);
	assert.equal(getterCalls, 0);
	assert.equal(possibleLinkedOriginalRelease(Object.create({ release() {} })), null);

	const owner = {
		calls: 0,
		release() { this.calls += 1; },
	};
	const release = possibleLinkedOriginalRelease(owner);
	assert.ok(release);
	await release();
	assert.equal(owner.calls, 1);
});

test('linked-original one-shot releases share successful and failed settlements', async () => {
	let calls = 0;
	const release = oneShotLinkedOriginalRelease(async () => { calls += 1; });
	const first = release();
	assert.strictEqual(release(), first);
	await first;
	await release();
	assert.equal(calls, 1);

	const failure = new Error('cleanup failed');
	const rejected = oneShotLinkedOriginalRelease(() => { throw failure; });
	const rejectedFirst = rejected();
	assert.strictEqual(rejected(), rejectedFirst);
	await assert.rejects(rejectedFirst, (error: unknown) => error === failure);
});

test('linked-original binding equality requires the token and complete normalized value', () => {
	const binding = Object.freeze({ bindingToken: 'token', sourceId: 'source', nested: Object.freeze({ size: 4 }) });
	assert.equal(sameLinkedOriginalBinding(binding, binding), true);
	assert.equal(sameLinkedOriginalBinding(binding, { ...binding }), true);
	assert.equal(sameLinkedOriginalBinding(binding, { ...binding, bindingToken: 'other' }), false);
	assert.equal(sameLinkedOriginalBinding(binding, { ...binding, sourceId: 'other' }), false);
});
