/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	registerFramescaperNativeRenderInputMainIpc,
	type FramescaperNativeRenderInputMainIpcOptions,
} from '../desktop/native-services-render-input-main-ipc.ts';

test('a synchronously malformed render-input port is retired from active tracking', () => {
	let listener: ((event: unknown, value?: unknown) => void) | null = null;
	let closes = 0;
	const port = {
		postMessage: () => undefined,
		on: () => undefined,
		close: () => { closes += 1; },
	};
	const staging = {
		begin: async () => ({}), beginLive: async () => ({}),
		writeLive: async () => ({}), completeLive: async () => ({}),
		finalize: async () => ({}), abandon: async () => undefined,
		receive: () => { throw new TypeError('malformed receive request'); },
	} as unknown as FramescaperNativeRenderInputMainIpcOptions['staging'];
	const registration = registerFramescaperNativeRenderInputMainIpc({
		handle: () => undefined, removeHandler: () => undefined,
		on: (_channel, value) => { listener = value; },
		removeListener: () => undefined,
		authorizeOwner: () => ({}), staging,
	});
	assert.ok(listener);
	(listener as (event: unknown, value?: unknown) => void)({ ports: [port] }, { stageId: null });
	assert.equal(closes, 1);
	registration.dispose();
	assert.equal(closes, 1, 'dispose must not revisit a synchronously refused port');
});
