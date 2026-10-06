/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderConformedStem } from '../src/common/editor/controller/export/internal/archive/render-conformed-stem.ts';

test('failed stem conformance releases encoded staging before ownership reaches the archive', async () => {
	let cleanup = 0;
	const failure = new Error('Conformance read failed');
	const encoded = { bytes: new Uint8Array(4), cleanup: async () => { cleanup += 1; } };
	await assert.rejects(renderConformedStem({ render: async () => encoded, conform: async () => { throw failure; } }),
		(error: unknown) => error === failure);
	assert.equal(cleanup, 1);
});

test('successful conformance transfers staging cleanup to its archive consumer', async () => {
	let cleanup = 0;
	const encoded = { cleanup: async () => { cleanup += 1; } };
	const result = await renderConformedStem({ render: async () => encoded, conform: async () => ['verified'] });
	assert.strictEqual(result.encoded, encoded); assert.deepEqual(result.conformance, ['verified']); assert.equal(cleanup, 0);
	await result.encoded.cleanup(); assert.equal(cleanup, 1);
});

test('stem cleanup failure retains the primary conformance failure and does not retry cleanup', async () => {
	let cleanup = 0;
	const primary = new Error('Conformance failed'), secondary = new Error('Staging removal failed');
	await assert.rejects(renderConformedStem({ render: async () => ({ cleanup() { cleanup += 1; throw secondary; } }),
		conform: async () => { throw primary; } }), (error: unknown) => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, secondary]); return true;
	});
	assert.equal(cleanup, 1);
});
