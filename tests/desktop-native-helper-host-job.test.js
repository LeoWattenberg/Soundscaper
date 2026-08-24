/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	HOST_PROBE_BLOCKS,
	createNativePluginHostJobRunner,
} from '../desktop/native-helper-host-job.js';
import {
	NATIVE_HELPER_JOB_KINDS,
	createNativeHelperWorker,
	loadVerifiedNativeAddon,
} from '../desktop/native-helper-process.js';
import {
	FIXTURE_PLUGIN_SUFFIX,
	fixturePluginDirectory,
} from '../scripts/lib/native-fixture-plugins.mjs';
import {
	nativeHelperAddonTargetForRuntime,
	readNativeHelperAddonSourceManifest,
} from '../scripts/lib/native-helper-addon-build.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const manifest = readNativeHelperAddonSourceManifest(ROOT);
const hostTarget = nativeHelperAddonTargetForRuntime(process.platform, process.arch);
const built = hostTarget !== null
	&& manifest.targets[hostTarget.id]?.status === 'built'
	&& manifest.fixturePlugins?.targets?.[hostTarget.id]?.status === 'built';

const addonPath = built
	? join(ROOT, 'native/soundscaper-helper-addon/prebuilt', hostTarget.id, manifest.payloadName)
	: '';

function fixturePath(name) {
	return join(fixturePluginDirectory(ROOT, hostTarget.id), `${name}${FIXTURE_PLUGIN_SUFFIX}`);
}

async function digestOf(path) {
	const bytes = await readFile(path);
	return { byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function hostRunner() {
	const addonDigest = await digestOf(addonPath);
	return createNativePluginHostJobRunner({
		addonPath,
		addonSha256: addonDigest.sha256,
		loadAddon: loadVerifiedNativeAddon,
		hashFile: digestOf,
		hash: () => createHash('sha256'),
	});
}

async function grantFor(name) {
	const path = fixturePath(name);
	const digest = await digestOf(path);
	return {
		binaryPath: path,
		binaryBytes: digest.byteLength,
		binarySha256: digest.sha256,
		format: 'fixture',
		stableId: `fixture:${name}`,
		identity: { dev: 1, ino: 2 },
	};
}

/** A stand-in for the addon that records the instance lifecycle it is given. */
function recordingAddon({ failAtBlock = null } = {}) {
	const events = [];
	const selections = [];
	let live = 0;
	let processed = 0;
	return {
		events,
		live: () => live,
		selections,
		addon: {
			openPluginInstance: (...args) => {
				live += 1;
				selections.push(args[4]);
				events.push('open');
				return { instance: live };
			},
			closePluginInstance: () => {
				live -= 1;
				events.push('close');
			},
			pluginLatencyFrames: () => 64,
			processPluginBlock: () => {
				if (failAtBlock !== null && processed >= failAtBlock) throw new Error('the plug-in aborted');
				processed += 1;
				events.push('process');
			},
			savePluginState: () => {
				events.push('save');
				return new Uint8Array(8);
			},
		},
	};
}

const RECORDED_GRANT = Object.freeze({
	binaryPath: '/plug-ins/example.scapefx',
	binaryBytes: 16,
	binarySha256: 'a'.repeat(64),
	format: 'fixture',
	stableId: 'fixture:gain',
	identity: Object.freeze({ dev: 1, ino: 2 }),
});

function recordedRunner(recorder) {
	return createNativePluginHostJobRunner({
		addonPath: '/unused',
		addonSha256: 'f'.repeat(64),
		loadAddon: async () => recorder.addon,
		hashFile: async () => ({ byteLength: RECORDED_GRANT.binaryBytes, sha256: RECORDED_GRANT.binarySha256 }),
		hash: () => createHash('sha256'),
	});
}

test('a hosted instance is released on the path that succeeds', async () => {
	const recorder = recordingAddon();
	await recordedRunner(recorder)({ grant: RECORDED_GRANT, onProgress: () => {} }).completion;
	assert.equal(recorder.live(), 0, 'a probed plug-in must not stay resident in a long-lived helper');
	assert.equal(recorder.events.at(-1), 'close', 'the instance is released after its state is read');
	assert.deepEqual(recorder.selections, ['fixture:gain']);
});

test('a hosted instance is released when the plug-in fails mid-probe', async () => {
	const recorder = recordingAddon({ failAtBlock: 2 });
	await assert.rejects(
		recordedRunner(recorder)({ grant: RECORDED_GRANT, onProgress: () => {} }).completion,
		/the plug-in aborted/u,
	);
	assert.equal(recorder.live(), 0);
	assert.equal(recorder.events.filter((event) => event === 'close').length, 1);
});

test('a cancelled host job releases its instance and never saves state through it', async () => {
	const recorder = recordingAddon();
	const handle = recordedRunner(recorder)({ grant: RECORDED_GRANT, onProgress: () => {} });
	await new Promise((resolve_) => { setTimeout(resolve_, 1); });
	await handle.cancel();
	await handle.completion.catch(() => undefined);
	assert.equal(recorder.live(), 0);
	assert.equal(recorder.events.includes('save'), false,
		'a torn-down instance must not be asked for the state the caller believes is gone');
});

test('a binary that changed after it was granted never opens an instance at all', async () => {
	const recorder = recordingAddon();
	await assert.rejects(
		recordedRunner(recorder)({
			grant: { ...RECORDED_GRANT, binarySha256: 'b'.repeat(64) },
			onProgress: () => {},
		}).completion,
		/changed after it was granted/u,
	);
	assert.deepEqual(recorder.events, []);
});

test('the helper announces hosting alongside discovery and devices', () => {
	assert.deepEqual([...NATIVE_HELPER_JOB_KINDS], ['audio-device', 'plugin-scan', 'plugin-host']);
});

test('a host job runs the plug-in out of process and reports what it measured', { skip: !built }, async () => {
	const run = await hostRunner();
	const progress = [];
	const result = await run({ grant: await grantFor('gain-effect'), onProgress: (v) => progress.push(v) }).completion;
	assert.equal(result.format, 'fixture');
	assert.equal(result.blocksRendered, HOST_PROBE_BLOCKS);
	assert.equal(result.reportedLatencyFrames, 64);
	assert.equal(result.latencyStable, true);
	assert.match(result.renderedSha256, /^[a-f\d]{64}$/u);
	assert.equal(progress.length, HOST_PROBE_BLOCKS);
	assert.ok(result.stateBytes > 0);
});

test('the rendered digest is deterministic and differs per plug-in', { skip: !built }, async () => {
	const run = await hostRunner();
	const first = await run({ grant: await grantFor('gain-effect'), onProgress: () => {} }).completion;
	const again = await run({ grant: await grantFor('gain-effect'), onProgress: () => {} }).completion;
	const passthrough = await run({ grant: await grantFor('clean-effect'), onProgress: () => {} }).completion;
	assert.equal(first.renderedSha256, again.renderedSha256, 'the same plug-in must render identically');
	assert.notEqual(first.renderedSha256, passthrough.renderedSha256, 'gain must not render as passthrough');
});

test('a binary that changed after it was granted is refused before dlopen', { skip: !built }, async () => {
	const run = await hostRunner();
	const grant = { ...(await grantFor('clean-effect')), binarySha256: 'a'.repeat(64) };
	await assert.rejects(
		run({ grant, onProgress: () => {} }).completion,
		/changed after it was granted/u,
	);
});

test('an instrument is refused by the host even with a valid grant', { skip: !built }, async () => {
	const run = await hostRunner();
	await assert.rejects(
		run({ grant: await grantFor('instrument'), onProgress: () => {} }).completion,
		/refused/u,
	);
});

test('an oversize state costs eligibility without failing the job', { skip: !built }, async () => {
	const run = await hostRunner();
	const result = await run({ grant: await grantFor('oversize-state'), onProgress: () => {} }).completion;
	assert.equal(result.stateBytes, null);
	assert.match(result.stateRefusal, /state-too-large/u);
	assert.equal(result.blocksRendered, HOST_PROBE_BLOCKS, 'the audio work still completed');
});

test('a plug-in whose latency never settles is reported as unstable', { skip: !built }, async () => {
	const run = await hostRunner();
	const result = await run({ grant: await grantFor('unstable-latency'), onProgress: () => {} }).completion;
	assert.equal(result.latencyStable, false);
});

test('the worker routes a host job to the host runner and never to the device runner', { skip: !built }, async () => {
	const posted = [];
	const worker = createNativeHelperWorker({
		role: 'plugin-host',
		post: (message) => posted.push(message),
		runDeviceJob: () => { throw new Error('a host job must never reach the device runner'); },
		runScanJob: () => { throw new Error('a host job must never reach the scan runner'); },
		runHostJob: await hostRunner(),
		heartbeatIntervalMs: 1_000_000,
		exit: () => undefined,
	});
	worker.handleMessage({
		contractVersion: 1,
		type: 'job',
		jobId: 'c'.repeat(40),
		kind: 'plugin-host',
		jobContractVersion: 1,
		grant: await grantFor('clean-effect'),
		resourcePolicy: { maximumInputBytes: 1_048_576, maximumJobDurationMs: 60_000, maximumRssBytes: 1_024 ** 3 },
	});
	await new Promise((resolve_) => { setTimeout(resolve_, 120); });
	const result = posted.find(({ type }) => type === 'result');
	assert.ok(result, 'the host job must settle with a result');
	assert.equal(result.result.blocksRendered, HOST_PROBE_BLOCKS);
});
