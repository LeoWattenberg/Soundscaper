/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createStaffPadRuntimeLoader } from '../src/common/editor/staffpad/runtime-loader.js';

test('StaffPad runtime loading retries a transient failure', async () => {
	let calls = 0;
	const expected = { runtime: true };
	const getRuntime = createStaffPadRuntimeLoader(async (url) => {
		calls += 1;
		assert.equal(url, '/staffpad.wasm');
		if (calls === 1) throw new Error('transient fetch failure');
		return expected;
	});

	await assert.rejects(getRuntime('/staffpad.wasm'), /transient fetch failure/u);
	assert.strictEqual(await getRuntime('/staffpad.wasm'), expected);
	assert.equal(calls, 2);
});

test('StaffPad runtime loading shares matching requests and respects URL changes', async () => {
	const calls = [];
	const getRuntime = createStaffPadRuntimeLoader(async (url) => {
		calls.push(url);
		return { url };
	});

	const first = getRuntime('/first.wasm');
	assert.strictEqual(getRuntime('/first.wasm'), first);
	assert.deepEqual(await first, { url: '/first.wasm' });
	assert.deepEqual(await getRuntime('/second.wasm'), { url: '/second.wasm' });
	assert.deepEqual(calls, ['/first.wasm', '/second.wasm']);
});
