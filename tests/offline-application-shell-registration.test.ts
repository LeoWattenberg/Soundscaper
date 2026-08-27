/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { webBuildRouting } from '../scripts/lib/product-web-routing.mjs';
import {
	registerOfflineApplicationShell,
	resolveOfflineApplicationShellTarget,
	scheduleOfflineApplicationShellRegistration,
} from '../src/common/offline/application-shell.ts';

const repositoryRoot = new URL('../', import.meta.url);

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

test('the Soundscaper build keeps registering the nested Framescaper worker', async () => {
	const calls: unknown[][] = [];
	await registerOfflineApplicationShell({
		desktop: false,
		builtProductId: 'soundscaper',
		productId: 'framescaper',
		location: new URL('https://soundscaper.org/framescaper/de/'),
		serviceWorker: { register: async (...args: unknown[]) => { calls.push(args); return {}; } },
	});
	assert.deepEqual(calls, [[
		'/framescaper/service-worker.js',
		{ scope: '/framescaper/', type: 'classic', updateViaCache: 'none' },
	]]);
});

test('the Framescaper build registers the root worker its own origin serves', async () => {
	const calls: unknown[][] = [];
	const result = await registerOfflineApplicationShell({
		desktop: false,
		builtProductId: 'framescaper',
		productId: 'framescaper',
		location: new URL('https://framescaper.org/de/?project=one'),
		serviceWorker: {
			register: async (...args: unknown[]) => {
				calls.push(args);
				return { scope: 'https://framescaper.org/' };
			},
		},
	});

	assert.equal(result.status, 'registered');
	assert.deepEqual(calls, [[
		'/service-worker.js',
		{ scope: '/', type: 'classic', updateViaCache: 'none' },
	]]);
});

test('every registration target is a worker the matching build actually emits', () => {
	for (const buildProductId of ['soundscaper', 'framescaper']) {
		const routing = webBuildRouting({ SCAPE_PRODUCT: buildProductId });
		for (const worker of routing.workers) {
			assert.deepEqual(
				{ ...resolveOfflineApplicationShellTarget(worker.productId, buildProductId) },
				{ scriptUrl: worker.scriptUrl, scope: worker.scope },
				`${buildProductId} build, ${String(worker.productId)} worker`,
			);
		}
	}
});

test('a build refuses to register a worker it does not emit', async () => {
	let registrations = 0;
	const result = await registerOfflineApplicationShell({
		desktop: false,
		builtProductId: 'framescaper',
		productId: 'soundscaper',
		location: new URL('https://framescaper.org/en/'),
		serviceWorker: { register: async () => { registrations += 1; return {}; } },
	});

	assert.equal(result.status, 'failed');
	assert.match(
		String((result as { error: unknown }).error),
		/framescaper build serves no soundscaper document/u,
	);
	assert.equal(registrations, 0);
	assert.throws(
		() => resolveOfflineApplicationShellTarget('lightscaper', 'soundscaper'),
		/Unsupported editor product/u,
	);
});

test('a Framescaper bundle registers the root worker without being told which build it is', () => {
	const script = [
		"globalThis.__SCAPE_PRODUCT__ = 'framescaper';",
		"const { registerOfflineApplicationShell } = await import('./src/common/offline/application-shell.ts');",
		'const calls = [];',
		'await registerOfflineApplicationShell({',
		'\tdesktop: false,',
		"\tproductId: 'framescaper',",
		"\tlocation: new URL('https://framescaper.org/en/'),",
		'\tserviceWorker: { register: async (...args) => { calls.push(args); return {}; } },',
		'});',
		'process.stdout.write(JSON.stringify(calls));',
	].join('\n');
	const output = execFileSync(process.execPath, [
		'--import', 'tsx',
		'--import', './scripts/node-style-asset-loader.mjs',
		'--input-type=module',
		'-e', script,
	], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

	assert.deepEqual(JSON.parse(output), [[
		'/service-worker.js',
		{ scope: '/', type: 'classic', updateViaCache: 'none' },
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
		builtProductId: 'framescaper',
		productId: 'framescaper',
		location: new URL('https://framescaper.org/en/'),
		serviceWorker: { register: async () => { throw failure; } },
	});

	assert.deepEqual(result, { status: 'failed', error: failure });
});
