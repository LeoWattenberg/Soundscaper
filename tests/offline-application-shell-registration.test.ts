/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	registerOfflineApplicationShell,
	scheduleOfflineApplicationShellRegistration,
} from '../src/common/offline/application-shell.ts';

test('production web registration uses the stable root worker and bypasses HTTP cache updates', async () => {
	const calls: unknown[][] = [];
	const result = await registerOfflineApplicationShell({
		desktop: false,
		productId: 'soundscaper',
		location: new URL('https://soundscaper.org/de/?project=one'),
		serviceWorker: {
			register: async (...args: unknown[]) => {
				calls.push(args);
				return { scope: 'https://soundscaper.org/' };
			},
		},
	});

	assert.equal(result.status, 'registered');
	assert.deepEqual(calls, [[
		'/service-worker.js',
		{ scope: '/', type: 'classic', updateViaCache: 'none' },
	]]);
});

test('Framescaper registers the nested worker with the product scope', async () => {
	const calls: unknown[][] = [];
	await registerOfflineApplicationShell({
		desktop: false,
		productId: 'framescaper',
		location: new URL('https://soundscaper.org/framescaper/de/'),
		serviceWorker: { register: async (...args: unknown[]) => { calls.push(args); return {}; } },
	});
	assert.deepEqual(calls, [[
		'/framescaper/service-worker.js',
		{ scope: '/framescaper/', type: 'classic', updateViaCache: 'none' },
	]]);
});

test('registration scheduling waits for load, editor readiness, and an idle turn', async () => {
	let loaded = false;
	let ready = false;
	let idleCallback: () => void = () => assert.fail('idle callback was not scheduled');
	let registrations = 0;
	const scheduled = scheduleOfflineApplicationShellRegistration({
		desktop: false,
		productId: 'soundscaper',
		location: new URL('https://soundscaper.org/en/'),
		serviceWorker: { register: async () => { registrations += 1; return {}; } },
		waitForLoad: async () => { loaded = true; },
		waitForEditor: async () => { assert.equal(loaded, true); ready = true; },
		waitForIdle: () => new Promise<void>((resolve) => { idleCallback = resolve; }),
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(ready, true);
	assert.equal(registrations, 0);
	idleCallback();
	assert.equal((await scheduled).status, 'registered');
	assert.equal(registrations, 1);
});

test('Electron, non-HTTP documents, and browsers without service workers are unchanged', async () => {
	let registrations = 0;
	const serviceWorker = {
		register: async () => {
			registrations += 1;
			return {};
		},
	};
	for (const options of [
		{ desktop: true, productId: 'soundscaper' as const, location: new URL('https://soundscaper.org/en/'), serviceWorker },
		{ desktop: false, productId: 'soundscaper' as const, location: new URL('soundscaper-app://bundle/'), serviceWorker },
		{ desktop: false, productId: 'soundscaper' as const, location: new URL('https://soundscaper.org/en/'), serviceWorker: undefined },
	]) {
		assert.equal((await registerOfflineApplicationShell(options)).status, 'unsupported');
	}
	assert.equal(registrations, 0);
});

test('registration failure is reported without rejecting application startup', async () => {
	const failure = new Error('service workers disabled by policy');
	const result = await registerOfflineApplicationShell({
		desktop: false,
		productId: 'framescaper',
		location: new URL('https://framescaper.org/framescaper/en/'),
		serviceWorker: { register: async () => { throw failure; } },
	});

	assert.deepEqual(result, { status: 'failed', error: failure });
});
