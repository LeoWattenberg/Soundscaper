/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Deterministic coverage of the native helper's control plane with injected
 * seams. The real-process proof shows the whole stack works across Electron's
 * utility-process boundary; this shows each contract duty and fault path
 * without a 6-second Electron launch per case.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { validateHelperProcessMessage } from '../desktop/helper-contract.ts';
import {
	NATIVE_AUDIO_INVENTORY_BOUNDS,
	NATIVE_AUDIO_INVENTORY_DEVICE_HANDLE,
	NATIVE_HELPER_JOB_KINDS,
	SYNTHETIC_ENGINE_MODES,
	SYNTHETIC_LOOPBACK_DEVICE_HANDLE,
	createNativeDeviceJobRunner,
	createNativeHelperWorker,
	loadVerifiedNativeAddon,
} from '../desktop/native-helper-process.js';
import {
	MAXIMUM_NATIVE_AUDIO_DEVICES,
	MAXIMUM_NATIVE_AUDIO_DEVICE_CHANNELS,
	MAXIMUM_NATIVE_AUDIO_DEVICE_TEXT_BYTES,
	MAXIMUM_NATIVE_AUDIO_INVENTORY_DETAIL_BYTES,
	validateHelperAudioDeviceInventoryResult,
	validateHelperAudioDeviceOpenResult,
} from '../desktop/native-helper-results.ts';
import { NATIVE_AUDIO_INVENTORY_HANDLE } from '../desktop/native-helper-service.ts';

const JOB_ID = 'a'.repeat(40);
const OTHER_JOB_ID = 'b'.repeat(40);
const GRANT = Object.freeze({
	backend: 'synthetic',
	deviceHandle: SYNTHETIC_LOOPBACK_DEVICE_HANDLE,
	direction: 'duplex',
	mode: 'shared',
});
const POLICY = Object.freeze({ maximumInputBytes: 1_024, maximumJobDurationMs: 30_000, maximumRssBytes: 1_024 ** 3 });

function jobMessage(jobId = JOB_ID, grant = GRANT, kind = 'audio-device') {
	return { contractVersion: 1, type: 'job', jobId, kind, grant, resourcePolicy: POLICY };
}

function createWorker(runDeviceJob) {
	const posted = [];
	const exits = [];
	const worker = createNativeHelperWorker({
		post: (message) => posted.push(message),
		runDeviceJob,
		heartbeatIntervalMs: 1_000_000,
		exit: (code) => exits.push(code),
	});
	return { posted, exits, worker, types: () => posted.map(({ type }) => type) };
}

function manualJob() {
	let settle;
	let cancelled = false;
	const completion = new Promise((resolve, reject) => { settle = { resolve, reject }; });
	const handle = {
		completion,
		cancel: async () => { cancelled = true; settle.reject(new Error('cancelled')); },
	};
	return { handle, settle, wasCancelled: () => cancelled };
}

/** A stand-in for the addon that needs no compiler and no native bytes. */
function fakeAddon({ failAt = null } = {}) {
	return {
		describe: () => ({
			addonVersion: '1.0.0',
			buildId: '1.0.0+test',
			napiVersion: 8,
			maximumChannelCount: 32,
			maximumFrameCount: 65_536,
		}),
		createSyntheticEngine: (config) => ({ config, next: 0 }),
		renderSyntheticBlock: (engine, startFrame, frameCount, _input, channels) => {
			if (failAt !== null && startFrame >= failAt) throw new Error('synthetic engine failure');
			assert.equal(startFrame, engine.next);
			engine.next += frameCount;
			for (const [index, channel] of channels.entries()) {
				channel.fill(index + 1, 0, frameCount);
			}
			return engine.next;
		},
	};
}

test('the helper announces exactly the kinds it implements', () => {
	const { types, posted } = createWorker(() => manualJob().handle);
	assert.deepEqual(types(), ['hello']);
	assert.deepEqual(posted[0].kinds, [...NATIVE_HELPER_JOB_KINDS]);
	assert.deepEqual([...NATIVE_HELPER_JOB_KINDS], ['audio-device', 'plugin-scan', 'plugin-host']);
});

test('an unannounced kind is refused without taking the helper down', () => {
	const { worker, posted, exits, types } = createWorker(() => manualJob().handle);
	worker.handleMessage(jobMessage(JOB_ID, {
		mediaPath: '/media.mp4', mediaBytes: 4, identity: { dev: 1, ino: 2 },
	}, 'probe-video-source'));
	assert.deepEqual(types(), ['hello', 'error']);
	assert.match(posted[1].error.message, /does not implement probe-video-source jobs/u);
	assert.deepEqual(exits, []);
});

test('an announced kind with no runner is refused rather than run as a device job', () => {
	const { worker, posted, exits, types } = createWorker(() => {
		throw new Error('a plug-in scan must never reach the device runner');
	});
	worker.handleMessage(jobMessage(JOB_ID, {
		rootPath: '/plug-ins', format: 'fixture', identity: { dev: 1, ino: 2 },
	}, 'plugin-scan'));
	assert.deepEqual(types(), ['hello', 'error']);
	assert.match(posted[1].error.message, /does not implement plugin-scan jobs/u);
	assert.deepEqual(exits, []);
});

test('a second concurrent job and a malformed host message each fail closed', () => {
	const concurrent = createWorker(() => manualJob().handle);
	concurrent.worker.handleMessage(jobMessage(JOB_ID));
	concurrent.worker.handleMessage(jobMessage(OTHER_JOB_ID));
	assert.deepEqual(concurrent.exits, [1]);

	const malformed = createWorker(() => manualJob().handle);
	malformed.worker.handleMessage({ contractVersion: 1, type: 'job', jobId: 'short' });
	assert.deepEqual(malformed.exits, [1]);

	const wrongDirection = createWorker(() => manualJob().handle);
	wrongDirection.worker.handleMessage({ contractVersion: 1, type: 'hello', kinds: ['audio-device'] });
	assert.deepEqual(wrongDirection.exits, [1]);
});

test('shutdown stops the helper cleanly and cancels any job in flight', () => {
	const job = manualJob();
	const { worker, exits } = createWorker(() => job.handle);
	worker.handleMessage(jobMessage());
	worker.handleMessage({ contractVersion: 1, type: 'shutdown' });
	assert.deepEqual(exits, [0]);
	assert.equal(job.wasCancelled(), true);
});

test('a cancelled job acknowledges cancellation and never also answers', async () => {
	const job = manualJob();
	const { worker, types } = createWorker(() => job.handle);
	worker.handleMessage(jobMessage());
	worker.handleMessage({ contractVersion: 1, type: 'cancel', jobId: JOB_ID });
	await new Promise((resolve) => { setTimeout(resolve, 0); });
	assert.deepEqual(types(), ['hello', 'cancelled']);
});

test('a result that arrives after cancellation is suppressed rather than sent', async () => {
	let handle;
	const { worker, types } = createWorker(() => {
		let resolveCompletion;
		const completion = new Promise((resolve) => { resolveCompletion = resolve; });
		handle = { completion, cancel: async () => resolveCompletion({ late: true }) };
		return handle;
	});
	worker.handleMessage(jobMessage());
	worker.handleMessage({ contractVersion: 1, type: 'cancel', jobId: JOB_ID });
	await new Promise((resolve) => { setTimeout(resolve, 0); });
	assert.deepEqual(types(), ['hello', 'cancelled']);
});

test('cancelling a job the helper does not own is ignored', async () => {
	const job = manualJob();
	const { worker, types } = createWorker(() => job.handle);
	worker.handleMessage(jobMessage());
	worker.handleMessage({ contractVersion: 1, type: 'cancel', jobId: OTHER_JOB_ID });
	await new Promise((resolve) => { setTimeout(resolve, 0); });
	assert.deepEqual(types(), ['hello']);
	job.settle.resolve({ ok: true });
	await new Promise((resolve) => { setTimeout(resolve, 0); });
	assert.deepEqual(types(), ['hello', 'result']);
});

test('the device runner refuses any device but the synthetic loopback', async () => {
	const runner = createNativeDeviceJobRunner({
		addonPath: '/unused', addonSha256: 'f'.repeat(64),
		loadAddon: async () => fakeAddon(),
		hash: () => createHash('sha256'),
	});
	await assert.rejects(
		runner({ grant: { ...GRANT, deviceHandle: 'alsa:hw:0,0' }, onProgress: () => {} }).completion,
		/implements only the synthetic:loopback device/u,
	);
	await assert.rejects(
		runner({ grant: { ...GRANT, backend: 'alsa' }, onProgress: () => {} }).completion,
		/implements only the synthetic:loopback device/u,
	);
});

test('the device runner reports bounded monotonic progress and an admissible result', async () => {
	const progress = [];
	const runner = createNativeDeviceJobRunner({
		addonPath: '/unused', addonSha256: 'f'.repeat(64),
		loadAddon: async () => fakeAddon(),
		hash: () => createHash('sha256'),
		blockFrames: 64,
		blocks: 4,
		yieldBetweenBlocks: () => Promise.resolve(),
	});
	const result = await runner({ grant: GRANT, onProgress: (value) => progress.push(value) }).completion;
	assert.deepEqual(progress, [0.25, 0.5, 0.75, 1]);
	const admitted = validateHelperAudioDeviceOpenResult(result);
	assert.equal(admitted.blockFrames, 64);
	assert.equal(admitted.blocksRendered, 4);
	assert.equal(admitted.framesRendered, 256);
	assert.equal(admitted.channelCount, 2);
	assert.equal(admitted.addon.napiVersion, 8);
});

test('a cancelled device session stops early and reports only what it rendered', async () => {
	let started = 0;
	const runner = createNativeDeviceJobRunner({
		addonPath: '/unused', addonSha256: 'f'.repeat(64),
		loadAddon: async () => fakeAddon(),
		hash: () => createHash('sha256'),
		blockFrames: 32,
		blocks: 64,
		yieldBetweenBlocks: () => new Promise((resolve) => { setTimeout(resolve, 0); }),
	});
	const handle = runner({ grant: GRANT, onProgress: () => { started += 1; } });
	await new Promise((resolve) => { setTimeout(resolve, 5); });
	await handle.cancel();
	const result = await handle.completion;
	assert.ok(result.blocksRendered < 64, 'cancellation must stop the session before it completes');
	assert.ok(started >= 1, 'the session must have demonstrably started');
	assert.equal(result.framesRendered, result.blocksRendered * 32);
});

test('a mono direction opens one channel and a native failure surfaces as a job error', async () => {
	const mono = createNativeDeviceJobRunner({
		addonPath: '/unused', addonSha256: 'f'.repeat(64),
		loadAddon: async () => fakeAddon(),
		hash: () => createHash('sha256'),
		blockFrames: 16,
		blocks: 2,
		yieldBetweenBlocks: () => Promise.resolve(),
	});
	const result = await mono({ grant: { ...GRANT, direction: 'input' }, onProgress: () => {} }).completion;
	assert.equal(result.channelCount, 1);

	const failing = createNativeDeviceJobRunner({
		addonPath: '/unused', addonSha256: 'f'.repeat(64),
		loadAddon: async () => fakeAddon({ failAt: 32 }),
		hash: () => createHash('sha256'),
		blockFrames: 16,
		blocks: 8,
		yieldBetweenBlocks: () => Promise.resolve(),
	});
	await assert.rejects(failing({ grant: GRANT, onProgress: () => {} }).completion, /synthetic engine failure/u);
});

test('the engine mode vocabulary is the one the addon defines', () => {
	assert.deepEqual(SYNTHETIC_ENGINE_MODES, { passthrough: 0, gain: 1, tone: 2, impulse: 3 });
});

test('a backend inventory job describes one backend and never publishes the synthetic one', async () => {
	const runner = createNativeDeviceJobRunner({
		addonPath: '/unused',
		addonSha256: 'f'.repeat(64),
		hash: () => createHash('sha256'),
		loadAddon: async () => ({
			...fakeAddon(),
			enumerateAudioBackends: () => [
				{
					backend: 'alsa',
					status: 'available',
					detail: '',
					devices: [{ handle: 'hw:0,0', label: 'Built-in', direction: 'duplex' }],
				},
				{ backend: 'jack', status: 'server-absent', detail: 'No JACK server is running.', devices: [] },
			],
		}),
	});
	const inventory = async (backend) => validateHelperAudioDeviceInventoryResult(await runner({
		grant: { ...GRANT, backend, deviceHandle: NATIVE_AUDIO_INVENTORY_DEVICE_HANDLE },
		onProgress: () => {},
	}).completion);

	const alsa = await inventory('alsa');
	assert.equal(alsa.status, 'available');
	assert.deepEqual(alsa.devices.map(({ handle }) => handle), ['hw:0,0']);

	const jack = await inventory('jack');
	assert.equal(jack.status, 'server-absent');
	assert.deepEqual(jack.devices, []);

	const synthetic = await inventory('synthetic');
	assert.equal(synthetic.status, 'unsupported-platform');
	assert.deepEqual(synthetic.devices, [], 'the loopback proof backend must never be offered as a device');

	const absent = await inventory('coreaudio');
	assert.equal(absent.status, 'unsupported-platform');
	assert.match(absent.detail, /does not implement the coreaudio backend/u);
});

test('a device inventory carries the channel count the backend reported', async () => {
	const runner = createNativeDeviceJobRunner({
		addonPath: '/unused',
		addonSha256: 'f'.repeat(64),
		hash: () => createHash('sha256'),
		loadAddon: async () => ({
			...fakeAddon(),
			enumerateAudioBackends: () => [{
				backend: 'alsa',
				status: 'available',
				detail: '',
				devices: [
					{ handle: 'hw:0,0', label: 'Built-in', direction: 'duplex', channelCount: 8 },
					{ handle: 'hw:1,0', label: 'Unmeasured', direction: 'output' },
				],
			}],
		}),
	});
	const inventory = validateHelperAudioDeviceInventoryResult(await runner({
		grant: { ...GRANT, backend: 'alsa', deviceHandle: NATIVE_AUDIO_INVENTORY_DEVICE_HANDLE },
		onProgress: () => {},
	}).completion);
	assert.equal(inventory.devices[0].channelCount, 8, 'stereo-pair routing needs the reported topology');
	assert.equal(Object.hasOwn(inventory.devices[1], 'channelCount'), false,
		'a backend that does not report a count must not have one invented for it');
});

test('the largest inventory the schema admits is one the helper wire can carry', () => {
	const maximalText = (prefix) => prefix.padEnd(MAXIMUM_NATIVE_AUDIO_DEVICE_TEXT_BYTES - 2, 'x');
	const admitted = validateHelperAudioDeviceInventoryResult({
		backend: 'alsa'.padEnd(254, 'x'),
		status: 'available',
		detail: 'd'.repeat(MAXIMUM_NATIVE_AUDIO_INVENTORY_DETAIL_BYTES - 2),
		devices: Array.from({ length: MAXIMUM_NATIVE_AUDIO_DEVICES }, (_, index) => ({
			handle: maximalText(`hw:${String(index)},0`),
			label: maximalText('ALSA PCM hint'),
			direction: 'duplex',
			channelCount: MAXIMUM_NATIVE_AUDIO_DEVICE_CHANNELS,
		})),
	});
	assert.equal(admitted.devices.length, MAXIMUM_NATIVE_AUDIO_DEVICES);
	validateHelperProcessMessage({ contractVersion: 1, type: 'result', jobId: JOB_ID, result: admitted });
	assert.throws(() => validateHelperAudioDeviceInventoryResult({
		backend: 'alsa',
		status: 'available',
		detail: '',
		devices: [{ handle: 'hw:0,0'.padEnd(256, 'h'), label: 'Built-in', direction: 'duplex' }],
	}), /audio device handle must be bounded/u);
});

test('an inventory larger than one answer is trimmed deliberately rather than fatally', async () => {
	const runner = createNativeDeviceJobRunner({
		addonPath: '/unused',
		addonSha256: 'f'.repeat(64),
		hash: () => createHash('sha256'),
		loadAddon: async () => ({
			...fakeAddon(),
			enumerateAudioBackends: () => [{
				backend: 'alsa',
				status: 'available',
				detail: '',
				devices: [
					{ handle: 'z'.repeat(300), label: 'Unnameable', direction: 'input' },
					...Array.from({ length: 400 }, (_, index) => ({
						handle: `hw:${String(index)},0`.padEnd(190, 'h'),
						label: 'An ALSA PCM hint with a description far longer than one answer can carry'.repeat(8),
						direction: 'input',
					})),
				],
			}],
		}),
	});
	const admitted = validateHelperAudioDeviceInventoryResult(await runner({
		grant: { ...GRANT, backend: 'alsa', deviceHandle: NATIVE_AUDIO_INVENTORY_DEVICE_HANDLE },
		onProgress: () => {},
	}).completion);
	assert.equal(admitted.devices.length, MAXIMUM_NATIVE_AUDIO_DEVICES);
	assert.equal(admitted.devices.some(({ handle }) => handle.startsWith('z')), false,
		'a device whose handle cannot be carried must be omitted, not renamed');
	assert.match(admitted.detail, /Only 128 of 401 devices fit/u);
	validateHelperProcessMessage({ contractVersion: 1, type: 'result', jobId: JOB_ID, result: admitted });
});

test('the helper and the main-process schema agree on the inventory wire vocabulary', () => {
	assert.equal(NATIVE_AUDIO_INVENTORY_DEVICE_HANDLE, NATIVE_AUDIO_INVENTORY_HANDLE);
	assert.deepEqual(NATIVE_AUDIO_INVENTORY_BOUNDS, {
		devices: MAXIMUM_NATIVE_AUDIO_DEVICES,
		textBytes: MAXIMUM_NATIVE_AUDIO_DEVICE_TEXT_BYTES,
		detailBytes: MAXIMUM_NATIVE_AUDIO_INVENTORY_DETAIL_BYTES,
	});
});

test('an inventory result that contradicts itself or repeats a handle is refused', () => {
	assert.throws(() => validateHelperAudioDeviceInventoryResult({
		backend: 'alsa',
		status: 'library-absent',
		detail: '',
		devices: [{ handle: 'hw:0,0', label: 'Built-in', direction: 'duplex' }],
	}), /not available must publish no devices/u);
	assert.throws(() => validateHelperAudioDeviceInventoryResult({
		backend: 'alsa',
		status: 'available',
		detail: '',
		devices: [
			{ handle: 'hw:0,0', label: 'A', direction: 'input' },
			{ handle: 'hw:0,0', label: 'B', direction: 'output' },
		],
	}), /same device handle twice/u);
	assert.throws(() => validateHelperAudioDeviceInventoryResult({
		backend: 'alsa', status: 'invented', detail: '', devices: [],
	}), /known backend status/u);
	assert.throws(() => validateHelperAudioDeviceInventoryResult({
		backend: 'alsa',
		status: 'available',
		detail: '',
		devices: Array.from({ length: MAXIMUM_NATIVE_AUDIO_DEVICES + 1 }, (_, index) => ({
			handle: `hw:${String(index)}`, label: 'Device', direction: 'duplex',
		})),
	}), /at most 128 devices/u);
});

test('a payload whose digest does not match is never handed to the module loader', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-native-load-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, 'not-really-an-addon.node');
	await writeFile(path, 'these bytes are not the pinned bytes');
	await assert.rejects(
		loadVerifiedNativeAddon({ addonPath: path, addonSha256: '0'.repeat(64) }),
		/does not match its pinned digest/u,
	);
});
