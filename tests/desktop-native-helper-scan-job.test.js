/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	SCANNABLE_PLUGIN_FORMATS,
	createNativePluginScanJobRunner,
} from '../desktop/native-helper-scan-job.js';
import { createNativeHelperWorker } from '../desktop/native-helper-process.js';
import { fixturePluginDirectory } from '../scripts/lib/native-fixture-plugins.mjs';
import {
	nativeHelperAddonTargetForRuntime,
	readNativeHelperAddonSourceManifest,
} from '../scripts/lib/native-helper-addon-build.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const manifest = readNativeHelperAddonSourceManifest(ROOT);
const hostTarget = nativeHelperAddonTargetForRuntime(process.platform, process.arch);
const built = hostTarget !== null && manifest.fixturePlugins?.targets?.[hostTarget.id]?.status === 'built';

/** A stand-in addon so the contract paths are testable with no compiler. */
function fakeAddon(candidates, inspections = {}, pluginFormats = ['fixture']) {
	return {
		describe: () => ({ pluginFormats }),
		listPluginCandidates: (root, suffix) => {
			if (root === '/unreadable') throw new Error('The plug-in root could not be read.');
			return candidates.filter((path) => path.endsWith(suffix));
		},
		inspectPluginCandidate: (path) => inspections[path] ?? {
			status: 'ok', stableId: `id:${path}`, name: 'Fixture', vendor: 'Vendor', version: '1.0.0',
			classification: 'effect', inputChannels: 2, outputChannels: 2,
			realtime: true, offline: true, reportedLatencyFrames: 0,
		},
	};
}

function runner(addon, hashFile = async (path) => ({ byteLength: path.length, sha256: 'a'.repeat(64) })) {
	return createNativePluginScanJobRunner({
		addonPath: '/unused', addonSha256: 'f'.repeat(64), hashFile, loadAddon: async () => addon,
	});
}

test('an authenticated professional payload can inspect an admitted VST3 bundle', async () => {
	const inspected = [];
	const addon = fakeAddon(['/roots/a.vst3'], {}, ['vst3']);
	const scan = runner({
		...addon,
		inspectPluginCandidate: (path, format) => {
			inspected.push([path, format]);
			return addon.inspectPluginCandidate(path, format);
		},
	});
	const result = await scan({
		grant: { rootPath: '/roots', format: 'vst3', identity: { dev: 1, ino: 2 } },
		onProgress: () => {},
	}).completion;
	assert.equal(result.status, 'scanned');
	assert.deepEqual(inspected, [['/roots/a.vst3', 'vst3']]);
	assert.equal(result.entries[0].binaryPath, '/roots/a.vst3');
});

test('one authenticated bundle publishes each exact format-native descriptor', async () => {
	let hashes = 0;
	const result = await runner(fakeAddon(['/roots/multi.clap'], {
		'/roots/multi.clap': [
			{ status: 'ok', stableId: 'org.example.delay', name: 'Delay', vendor: 'Example', version: '1',
				classification: 'effect', inputChannels: 1, outputChannels: 2,
				realtime: true, offline: true, reportedLatencyFrames: 7 },
			{ status: 'ok', stableId: 'org.example.reverb', name: 'Reverb', vendor: 'Example', version: '1',
				classification: 'effect', inputChannels: 2, outputChannels: 2,
				realtime: true, offline: true, reportedLatencyFrames: 11 },
		],
	}, ['clap']), async () => {
		hashes += 1;
		return { byteLength: 99, sha256: '9'.repeat(64) };
	})({
		grant: { rootPath: '/roots', format: 'clap', identity: { dev: 1, ino: 2 } },
		onProgress: () => {},
	}).completion;
	assert.equal(hashes, 1, 'a bundle body has one identity no matter how many descriptors it exposes');
	assert.deepEqual(result.entries.map(({ stableId }) => stableId), [
		'org.example.delay', 'org.example.reverb',
	]);
	assert.deepEqual(result.entries.map(({ binaryPath, binarySha256 }) => ({ binaryPath, binarySha256 })), [
		{ binaryPath: '/roots/multi.clap', binarySha256: '9'.repeat(64) },
		{ binaryPath: '/roots/multi.clap', binarySha256: '9'.repeat(64) },
	]);
});

test('a bundle descriptor set refuses empty, unbounded, or duplicate native IDs', async () => {
	for (const stableIds of [[''], ['x'.repeat(513)], ['duplicate', 'duplicate']]) {
		const result = await runner(fakeAddon(['/roots/ambiguous.clap'], {
			'/roots/ambiguous.clap': stableIds.map((stableId) => ({
				status: 'ok', stableId, name: 'Ambiguous', vendor: 'Example', version: '1',
				classification: 'effect', inputChannels: 2, outputChannels: 2,
				realtime: true, offline: true, reportedLatencyFrames: 0,
			})),
		}, ['clap']))({
			grant: { rootPath: '/roots', format: 'clap', identity: { dev: 1, ino: 2 } },
			onProgress: () => {},
		}).completion;
		assert.equal(result.entries.length, 1);
		assert.equal(result.entries[0].compatibility, 'malformed');
		assert.match(result.entries[0].stableId, /^unreadable:/u);
	}
});

test('the helper names every implemented suffix but requires payload capability', async () => {
	assert.deepEqual(Object.keys(SCANNABLE_PLUGIN_FORMATS), ['fixture', 'vst3', 'clap', 'au', 'lv2']);
	const result = await runner(fakeAddon(['/roots/a.vst3']))({
		grant: { rootPath: '/roots', format: 'vst3', identity: { dev: 1, ino: 2 } }, onProgress: () => {},
	}).completion;
	assert.equal(result.status, 'unsupported-format');
});

test('an unreadable root is a status rather than a thrown scan', async () => {
	const scan = runner(fakeAddon([]));
	const result = await scan({
		grant: { rootPath: '/unreadable', format: 'fixture', identity: { dev: 1, ino: 2 } },
		onProgress: () => {},
	}).completion;
	assert.equal(result.status, 'root-unreadable');
	assert.deepEqual(result.entries, []);
});

test('progress names the candidate before it is touched, not after', async () => {
	const order = [];
	const candidates = ['/roots/one.scapefx', '/roots/two.scapefx'];
	const addon = fakeAddon(candidates);
	const watched = {
		...addon,
		inspectPluginCandidate: (path) => {
			order.push(`inspect:${path}`);
			return addon.inspectPluginCandidate(path);
		},
	};
	const scan = runner(watched, async (path) => {
		order.push(`hash:${path}`);
		return { byteLength: 4, sha256: 'b'.repeat(64) };
	});
	await scan({
		grant: { rootPath: '/roots', format: 'fixture', identity: { dev: 1, ino: 2 } },
		onProgress: (value) => order.push(`progress:${String(value)}`),
	}).completion;
	assert.equal(order[0], 'progress:0.5', 'the candidate must be announced before anything dangerous happens');
	assert.equal(order.indexOf('progress:0.5') < order.indexOf('inspect:/roots/one.scapefx'), true);
});

test('a candidate that will not load keeps a digest-keyed identity and reports why', async () => {
	const addon = fakeAddon(['/roots/broken.scapefx'], {
		'/roots/broken.scapefx': { status: 'not-a-module', detail: 'bad ELF' },
	});
	const scan = runner(addon, async () => ({ byteLength: 8, sha256: 'c'.repeat(64) }));
	const result = await scan({
		grant: { rootPath: '/roots', format: 'fixture', identity: { dev: 1, ino: 2 } },
		onProgress: () => {},
	}).completion;
	const [entry] = result.entries;
	assert.equal(entry.compatibility, 'wrong-architecture');
	assert.equal(entry.stableId, `unreadable:${'c'.repeat(64)}`);
	assert.equal(entry.classification, 'unknown');
	assert.deepEqual(entry.channelSupport, []);
	assert.equal(entry.reportedLatencyFrames, null);
});

test('no scan claims a signature verdict it did not compute', async () => {
	const scan = runner(fakeAddon(['/roots/one.scapefx']));
	const result = await scan({
		grant: { rootPath: '/roots', format: 'fixture', identity: { dev: 1, ino: 2 } },
		onProgress: () => {},
	}).completion;
	assert.equal(result.entries[0].signature, 'unverifiable');
});

test('a cancelled scan stops early and keeps what it already inspected', async () => {
	const candidates = Array.from({ length: 40 }, (_, index) => `/roots/${String(index)}.scapefx`);
	const scan = runner(fakeAddon(candidates));
	const handle = scan({
		grant: { rootPath: '/roots', format: 'fixture', identity: { dev: 1, ino: 2 } },
		onProgress: () => {},
	});
	await new Promise((resolve_) => { setTimeout(resolve_, 5); });
	await handle.cancel();
	const result = await handle.completion;
	assert.ok(result.entries.length > 0, 'the scan must have demonstrably started');
	assert.ok(result.entries.length < candidates.length, 'cancellation must stop the scan early');
});

test('the helper announces scanning and routes a scan job to the scan runner', async () => {
	const posted = [];
	const worker = createNativeHelperWorker({
		role: 'plugin-scanner',
		post: (message) => posted.push(message),
		runDeviceJob: () => { throw new Error('a scan must never reach the device runner'); },
		runScanJob: runner(fakeAddon(['/roots/one.scapefx'])),
		heartbeatIntervalMs: 1_000_000,
		exit: () => undefined,
	});
	assert.deepEqual(posted[0].kinds, ['plugin-scan']);
	worker.handleMessage({
		contractVersion: 1,
		type: 'job',
		jobId: 'a'.repeat(40),
		kind: 'plugin-scan',
		jobContractVersion: 1,
		grant: { rootPath: '/roots', format: 'fixture', identity: { dev: 1, ino: 2 } },
		resourcePolicy: { maximumInputBytes: 1_024, maximumJobDurationMs: 60_000, maximumRssBytes: 1_024 ** 3 },
	});
	await new Promise((resolve_) => { setTimeout(resolve_, 20); });
	const result = posted.find(({ type }) => type === 'result');
	assert.ok(result, 'the scan must settle with a result');
	assert.equal(result.result.status, 'scanned');
});

test('a real scan of the fixture root classifies every benign candidate', { skip: !built }, async (context) => {
	const { loadVerifiedNativeAddon } = await import('../desktop/native-helper-process.js');
	const addonPath = join(ROOT, 'native/soundscaper-helper-addon/prebuilt', hostTarget.id, manifest.payloadName);
	const bytes = await readFile(addonPath);
	const scan = createNativePluginScanJobRunner({
		addonPath,
		addonSha256: createHash('sha256').update(bytes).digest('hex'),
		loadAddon: loadVerifiedNativeAddon,
		hashFile: async (path) => {
			const file = await readFile(path);
			return { byteLength: file.byteLength, sha256: createHash('sha256').update(file).digest('hex') };
		},
	});
	// The crash and hang fixtures really abort and really hang — that is what
	// they are for — so this scans a root built from the benign ones only. A
	// supervised helper is the only place the hostile ones may be inspected.
	const benignRoot = await mkdtemp(join(tmpdir(), 'soundscaper-benign-fixtures-'));
	context.after(() => rm(benignRoot, { recursive: true, force: true }));
	const source = fixturePluginDirectory(ROOT, hostTarget.id);
	for (const name of await readdir(source)) {
		if (name.startsWith('crash') || name.startsWith('hang')) continue;
		await copyFile(join(source, name), join(benignRoot, name));
	}
	const result = await scan({
		grant: { rootPath: benignRoot, format: 'fixture', identity: { dev: 1, ino: 2 } },
		onProgress: () => {},
	}).completion;
	assert.equal(result.status, 'scanned');
	const byName = new Map(result.entries.map((entry) => [entry.name, entry]));
	assert.equal(byName.get('Fixture Clean Effect')?.compatibility, 'compatible');
	assert.equal(byName.get('Fixture Instrument')?.classification, 'instrument');
	assert.equal(byName.get('Fixture Gain')?.reportedLatencyFrames, 64);
	assert.equal(byName.get('not-a-module.scapefx')?.compatibility, 'wrong-architecture');
	assert.equal(byName.get('no-entry-point.scapefx')?.compatibility, 'unsupported-format');
	for (const entry of result.entries) assert.match(entry.binarySha256, /^[a-f\d]{64}$/u);
});
