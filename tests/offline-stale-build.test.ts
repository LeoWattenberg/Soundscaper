/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createStaleBuildController } from '../src/common/offline/stale-build-controller.ts';
import {
	discardStaleBuild,
	isModuleLoadFailure,
	probeStaleBuild,
	SHELL_CACHE_NAME_PREFIX,
	type ShellInventoryFetch,
	type StaleBuildVerdict,
} from '../src/common/offline/stale-build.ts';

const RUNNING_MODULE = 'https://soundscaper.org/assets/index-D6uVhEs0.js';

function inventoryFetch(paths: readonly string[], calls: string[] = []): ShellInventoryFetch {
	return (url, init) => {
		assert.equal(init.cache, 'no-store');
		calls.push(url);
		return Promise.resolve({
			ok: true,
			json: () => Promise.resolve({
				schemaVersion: 2,
				assets: paths.map((path) => ({ url: path, byteLength: 1, sha256: 'a'.repeat(64) })),
			}),
		});
	};
}

test('module load failures are recognized across engine phrasings and nothing else is', () => {
	const failures = [
		new TypeError('Failed to fetch dynamically imported module: https://soundscaper.org/assets/ExportDialog-a1.js'),
		new TypeError('error loading dynamically imported module: https://soundscaper.org/assets/ExportDialog-a1.js'),
		new TypeError('Importing a module script failed.'),
		new TypeError('Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html".'),
		new Error('Unable to preload CSS for /assets/LocalAssistanceDialog-b2.css'),
		'error loading dynamically imported module',
	];
	for (const failure of failures) assert.equal(isModuleLoadFailure(failure), true, String(failure));

	const unrelated = [
		new TypeError('Failed to fetch'),
		new Error('The action failed: decoding stalled'),
		new RangeError('Offline shell asset descriptor is invalid.'),
		null,
		undefined,
		{ message: 'Failed to fetch dynamically imported module' },
	];
	for (const value of unrelated) assert.equal(isModuleLoadFailure(value), false, String(value));
});

test('the probe answers stale only when the live inventory has dropped this tab own chunk', async () => {
	const calls: string[] = [];
	assert.equal(await probeStaleBuild({
		moduleUrl: RUNNING_MODULE,
		fetchImpl: inventoryFetch(['/en/', '/assets/index-D6uVhEs0.js'], calls),
	}), 'current');
	assert.deepEqual(calls, ['https://soundscaper.org/offline-shell.json']);

	assert.equal(await probeStaleBuild({
		moduleUrl: RUNNING_MODULE,
		fetchImpl: inventoryFetch(['/en/', '/assets/index-Bq7Zm4tX.js']),
	}), 'stale');
});

test('the probe declines to guess when it cannot read a published inventory', async () => {
	const offline: ShellInventoryFetch = () => Promise.reject(new TypeError('Failed to fetch'));
	const missing: ShellInventoryFetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
	const unparsable: ShellInventoryFetch = () => Promise.resolve({
		ok: true,
		json: () => Promise.reject(new SyntaxError('Unexpected token <')),
	});
	const empty: ShellInventoryFetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ assets: [] }) });

	for (const fetchImpl of [offline, missing, unparsable, empty]) {
		assert.equal(await probeStaleBuild({ moduleUrl: RUNNING_MODULE, fetchImpl }), 'unknown');
	}
	// A desktop shell and a dev server both fail this check before any request.
	assert.equal(await probeStaleBuild({
		moduleUrl: 'file:///opt/soundscaper/resources/app/assets/index.js',
		fetchImpl: inventoryFetch(['/assets/index-D6uVhEs0.js']),
	}), 'unknown');
});

test('discarding a stale build clears both shell cache generations, the worker and the document', async () => {
	const deleted: string[] = [];
	const unregistered: string[] = [];
	const revalidated: string[] = [];
	let reloads = 0;
	await discardStaleBuild({
		cacheStorage: {
			keys: () => Promise.resolve([
				`${SHELL_CACHE_NAME_PREFIX}-v2-soundscaper-${'a'.repeat(64)}`,
				`${SHELL_CACHE_NAME_PREFIX}-v1-${'b'.repeat(64)}`,
				'local-model-weights',
			]),
			delete: (name) => { deleted.push(name); return Promise.resolve(true); },
		},
		serviceWorker: {
			getRegistrations: () => Promise.resolve([
				{ unregister: () => { unregistered.push('shell'); return Promise.resolve(true); } },
			]),
		},
		documentUrl: 'https://soundscaper.org/en/',
		fetchImpl: (url) => { revalidated.push(url); return Promise.resolve({ ok: true, json: () => Promise.resolve(null) }); },
		reload: () => { reloads += 1; },
	});
	assert.deepEqual(deleted.sort(), [
		`${SHELL_CACHE_NAME_PREFIX}-v1-${'b'.repeat(64)}`,
		`${SHELL_CACHE_NAME_PREFIX}-v2-soundscaper-${'a'.repeat(64)}`,
	]);
	assert.deepEqual(unregistered, ['shell']);
	assert.deepEqual(revalidated, ['https://soundscaper.org/en/']);
	assert.equal(reloads, 1);
});

test('a browser that refuses every clearing step still reloads', async () => {
	let reloads = 0;
	await discardStaleBuild({
		cacheStorage: {
			keys: () => Promise.reject(new DOMException('denied', 'SecurityError')),
			delete: () => Promise.resolve(false),
		},
		serviceWorker: { getRegistrations: () => Promise.reject(new Error('unavailable')) },
		documentUrl: 'https://soundscaper.org/en/',
		fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
		reload: () => { reloads += 1; },
	});
	assert.equal(reloads, 1);
});

test('the controller prompts only after staleness is proved, and never for an unrelated fault', async () => {
	const seen: string[] = [];
	const controller = createStaleBuildController({
		moduleUrl: RUNNING_MODULE,
		probe: () => Promise.resolve<StaleBuildVerdict>('stale'),
		discard: () => Promise.resolve(),
		reload: () => undefined,
	});
	controller.subscribe((snapshot) => seen.push(snapshot.status));

	controller.report(new Error('The action failed: decoding stalled'));
	assert.equal(controller.snapshot().status, 'idle');

	controller.report(new TypeError('Failed to fetch dynamically imported module: /assets/ExportDialog-a1.js'));
	assert.equal(controller.snapshot().status, 'checking');
	assert.equal(controller.snapshot().prompting, false);
	await controller.settled();
	assert.equal(controller.snapshot().prompting, true);
	assert.deepEqual(seen, ['checking', 'prompting']);
});

test('an unproved verdict leaves the tab alone and probes again on the next failure', async () => {
	const verdicts: StaleBuildVerdict[] = ['unknown', 'current', 'stale'];
	let probes = 0;
	const controller = createStaleBuildController({
		moduleUrl: RUNNING_MODULE,
		probe: () => { probes += 1; return Promise.resolve(verdicts.shift() ?? 'unknown'); },
		discard: () => Promise.resolve(),
		reload: () => undefined,
	});
	const failure = new TypeError('Failed to fetch dynamically imported module: /assets/NyquistDialog-a1.js');

	controller.report(failure);
	await controller.settled();
	assert.equal(controller.snapshot().status, 'idle');
	controller.report(failure);
	await controller.settled();
	assert.equal(controller.snapshot().status, 'idle');
	controller.report(failure);
	await controller.settled();
	assert.equal(controller.snapshot().status, 'prompting');
	assert.equal(probes, 3);
});

test('cancelling hides the prompt and the next unloaded feature brings it straight back', async () => {
	let probes = 0;
	const controller = createStaleBuildController({
		moduleUrl: RUNNING_MODULE,
		probe: () => { probes += 1; return Promise.resolve<StaleBuildVerdict>('stale'); },
		discard: () => Promise.resolve(),
		reload: () => undefined,
	});
	const failure = new TypeError('Failed to fetch dynamically imported module: /assets/EditorDialog-a1.js');

	controller.report(failure);
	await controller.settled();
	controller.dismiss();
	assert.equal(controller.snapshot().status, 'dismissed');

	controller.report(failure);
	assert.equal(controller.snapshot().status, 'prompting');
	assert.equal(probes, 1, 'a proved verdict is not re-probed');
});

test('reloading discards the build once and ignores failures reported while it happens', async () => {
	let discards = 0;
	let reloads = 0;
	const controller = createStaleBuildController({
		moduleUrl: RUNNING_MODULE,
		probe: () => Promise.resolve<StaleBuildVerdict>('stale'),
		discard: async (options) => { discards += 1; options.reload(); await Promise.resolve(); },
		reload: () => { reloads += 1; },
	});
	controller.report(new TypeError('Failed to fetch dynamically imported module: /assets/ExportDialog-a1.js'));
	await controller.settled();

	await controller.reload();
	assert.equal(controller.snapshot().status, 'reloading');
	assert.equal(discards, 1);
	assert.equal(reloads, 1);

	controller.report(new TypeError('Failed to fetch dynamically imported module: /assets/GeneratorDialog-a1.js'));
	await controller.reload();
	assert.equal(controller.snapshot().status, 'reloading');
	assert.equal(discards, 1);
});
