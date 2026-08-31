/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperWebVcrController } from
	'../src/common/editor/controller/framescaper-web-vcr-controller.ts';

test('disposing during the Web VCR handshake never installs a late subscription', async () => {
	const handshake = deferred<Readonly<Record<string, unknown>>>();
	let subscriptions = 0;
	let unsubscriptions = 0;
	const controller = createFramescaperWebVcrController({
		enabled: true,
		cropRuntimeAvailable: true,
		bridge: {
			handshake: () => handshake.promise,
			subscribe() {
				subscriptions += 1;
				return () => { unsubscriptions += 1; };
			},
		} as never,
		getCapture: () => ({ snapshot: { phase: 'inactive', sources: [] }, actions: {} }) as never,
		adapter: { select() {}, freezeCrop() {} },
		startAdmission: { begin() { throw new Error('not used'); } },
	});

	const initializing = controller.initialize();
	await Promise.resolve();
	await controller.dispose();
	handshake.resolve({
		version: 1,
		capability: { status: 'available', resolutions: ['1080p'] },
		captureGrantTtlMs: 10_000,
	});
	await initializing;

	assert.equal(subscriptions, 0);
	assert.equal(unsubscriptions, 0);
});

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return Object.freeze({ promise, resolve });
}
