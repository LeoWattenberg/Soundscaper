/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { registerOfflineApplicationShell } from '../src/common/offline/application-shell.ts';

test('production web registration uses the stable root worker and bypasses HTTP cache updates', async () => {
	const calls: unknown[][] = [];
	const result = await registerOfflineApplicationShell({
		desktop: false,
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

test('Electron, non-HTTP documents, and browsers without service workers are unchanged', async () => {
	let registrations = 0;
	const serviceWorker = {
		register: async () => {
			registrations += 1;
			return {};
		},
	};
	for (const options of [
		{ desktop: true, location: new URL('https://soundscaper.org/en/'), serviceWorker },
		{ desktop: false, location: new URL('soundscaper-app://bundle/'), serviceWorker },
		{ desktop: false, location: new URL('https://soundscaper.org/en/'), serviceWorker: undefined },
	]) {
		assert.equal((await registerOfflineApplicationShell(options)).status, 'unsupported');
	}
	assert.equal(registrations, 0);
});

test('registration failure is reported without rejecting application startup', async () => {
	const failure = new Error('service workers disabled by policy');
	const result = await registerOfflineApplicationShell({
		desktop: false,
		location: new URL('https://framescaper.org/framescaper/en/'),
		serviceWorker: { register: async () => { throw failure; } },
	});

	assert.deepEqual(result, { status: 'failed', error: failure });
});
