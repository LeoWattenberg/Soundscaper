/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { initializePffft, isPffftReady } from '../src/common/editor/pffft.js';

test('PFFFT initialization retries after a transient module failure', async () => {
	const emptyWasmModule = new WebAssembly.Module(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0));
	await assert.rejects(initializePffft({ wasmModule: emptyWasmModule }));
	assert.equal(isPffftReady(), false);
	await initializePffft();
	assert.equal(isPffftReady(), true);
});
