/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	startLoadedDesktopProjectLibraryProductRuntime,
} from '../desktop/project-library-product-runtime.js';

test('loaded desktop product adapters share startup and renderer registration routing', async () => {
	const calls = [];
	const host = {
		localHandshake: Object.freeze({ schemaFamily: 'test', schemaVersion: 1 }),
		snapshot: () => Object.freeze({ product: 'soundscaper' }),
		close: async () => { calls.push('close'); },
	};
	const onLeaseLost = () => undefined;
	const owner = Object.freeze({ product: 'soundscaper', processId: 7, instanceId: 'instance-1' });
	const runtime = await startLoadedDesktopProjectLibraryProductRuntime({
		productId: 'soundscaper',
		productName: 'Soundscaper',
		generation: '1.0',
		appDataPath: '/tmp/project-library-routing-test',
		owner,
		onLeaseLost,
		leaseTestControl: Object.freeze({
			leaseTtlMs: 30_000,
			renewIntervalMs: 10_000,
			checkpoint: 'after-open',
		}),
		createHandshake: () => Object.freeze({ product: 'soundscaper' }),
		startHost: async (options) => {
			calls.push(['start', options]);
			return host;
		},
		registerIpc: (options) => {
			calls.push(['register', options]);
			return Object.freeze({
				dispose: async () => { calls.push('dispose-registration'); },
				revokeOwner: () => undefined,
			});
		},
	});

	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0], ['start', {
		appDataPath: '/tmp/project-library-routing-test',
		owner,
		handshake: { product: 'soundscaper' },
		onLeaseLost,
		testControl: {
			leaseTtlMs: 30_000,
			renewIntervalMs: 10_000,
			checkpoint: 'after-open',
		},
	}]);
	assert.ok(Object.isFrozen(calls[0][1].testControl));

	const bridge = runtime.registerRendererBridge({
		desktopRoot: '/tmp',
		handle: () => undefined,
		ownerFor: () => owner,
		removeHandler: () => undefined,
		session: Object.freeze({
			registerPreloadScript: () => 'preload-1',
			unregisterPreloadScript: () => undefined,
		}),
	});
	assert.equal(calls.length, 2);
	assert.equal(calls[1][0], 'register');
	assert.equal(calls[1][1].main, host);
	await bridge.dispose();
	await runtime.close();
	assert.deepEqual(calls.slice(2), ['dispose-registration', 'close']);
});
