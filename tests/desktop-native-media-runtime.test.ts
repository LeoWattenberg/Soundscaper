/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { HelperChannel } from '../desktop/helper-supervisor.ts';
import {
	assertFramescaperMediaHostSelfTest,
	assertFramescaperMediaHostSelectedV20RenderSelfTest,
	assertFramescaperMediaHostSelectedV28V14RenderSelfTest,
	startFramescaperNativeMediaRuntime,
} from '../desktop/native-media-runtime.ts';

const SELF_TEST = Object.freeze({
	contractVersion: 1, ffmpeg: '9.0.1', networkInitialized: false,
	versionsMatch: true, exactRetimeMatches: true, proresProxyEncoderPresent: true,
	professionalCharacteristicsMatches: true,
});

const SELECTED_V20_RENDER_SELF_TEST = Object.freeze({
	contractVersion: 1, operation: 'media-render', profile: 'selected-v20-v7-v8',
	planVersions: [7, 8] as const, exactPictureOrdinals: true,
	keyedEvaluatedRgbaExecutor: true, staticCompositionExecutor: true,
	maximumInFlightFrames: 1, evaluatedRgbaInputBound: true,
	staticGeometryAdapterBound: true, captionDeliveryAdapterBound: true,
	stagedAudioInputBound: true,
	deliveryCodecSetAvailable: true, frameCoreReady: true, ready: true,
});
const SELECTED_V28_V14_RENDER_SELF_TEST = Object.freeze({
	contractVersion: 1, operation: 'media-render', profile: 'selected-v28-v14-carrier',
	planVersion: 14, rgbaFramePackVersion: 1, exactPictureOrdinals: true,
	evaluatedRgbaExecutor: true, maximumInFlightFrames: 1,
	stagedAudioInputBound: true, deliveryCodecSetAvailable: true, ready: true,
});

test('an authenticated payload self-tests before a default two-worker pool accepts work', async () => {
	const fixture = await runtimeFixture();
	try {
		let spawns = 0;
		const runtime = await startFramescaperNativeMediaRuntime({
			location: fixture.location,
			payloadPorts: fixture.payloadPorts,
			runHostSelfTest: async () => SELF_TEST,
			runSelectedV20RenderSelfTest: async () => SELECTED_V20_RENDER_SELF_TEST,
			runSelectedV28V14RenderSelfTest: async () => SELECTED_V28_V14_RENDER_SELF_TEST,
			spawnHelper: () => { spawns += 1; return new Channel(); },
			mintJobId: () => 'cd'.repeat(20),
		});
		assert.equal(runtime.available(), true);
		assert.equal(runtime.snapshot()?.configuredWorkers, 2);
		assert.deepEqual(runtime.selfTestResult(), SELF_TEST);
		assert.deepEqual(
			runtime.selectedV20RenderSelfTestResult(),
			SELECTED_V20_RENDER_SELF_TEST,
		);
		assert.deepEqual(runtime.selectedV28V14RenderSelfTestResult(), SELECTED_V28_V14_RENDER_SELF_TEST);
		assert.equal(spawns, 2, 'every default-pool worker negotiates its isolated self-test before availability');
		assert.deepEqual(await runtime.runJob({
			kind: 'probe-video-source',
			grant: {
				mediaPath: '/media/source.mov', mediaBytes: 10, identity: { dev: 1, ino: 2 },
			},
		}), { probed: true });
		assert.equal(spawns, 2, 'work reuses the already verified supervised utility process');
		assert.equal(runtime.dispose(), true);
		assert.equal(runtime.dispose(), false);
		assert.equal(runtime.available(), false);
	} finally {
		await fixture.dispose();
	}
});

test('an authenticated payload stays dormant until the user enables native media', async () => {
	const fixture = await runtimeFixture();
	try {
		let enabled = false;
		let hostSelfTests = 0;
		let selectedV20SelfTests = 0;
		let selectedV28SelfTests = 0;
		let spawns = 0;
		const runtime = await startFramescaperNativeMediaRuntime({
			location: fixture.location,
			payloadPorts: fixture.payloadPorts,
			enabled: () => enabled,
			runHostSelfTest: async () => { hostSelfTests += 1; return SELF_TEST; },
			runSelectedV20RenderSelfTest: async () => {
				selectedV20SelfTests += 1;
				return SELECTED_V20_RENDER_SELF_TEST;
			},
			runSelectedV28V14RenderSelfTest: async () => {
				selectedV28SelfTests += 1;
				return SELECTED_V28_V14_RENDER_SELF_TEST;
			},
			spawnHelper: () => { spawns += 1; return new Channel(); },
		});
		assert.equal(runtime.payloadAvailability.status, 'available',
			'the dormant runtime may authenticate its payload without executing it');
		assert.equal(runtime.available(), false);
		assert.equal(runtime.snapshot(), null);
		assert.equal(runtime.reason, 'native-media-disabled');
		assert.deepEqual(
			{ hostSelfTests, selectedV20SelfTests, selectedV28SelfTests, spawns },
			{ hostSelfTests: 0, selectedV20SelfTests: 0, selectedV28SelfTests: 0, spawns: 0 },
			'the default-off boundary performs no executable self-test and starts no helper',
		);

		enabled = true;
		assert.equal(await runtime.activate(), true);
		assert.equal(runtime.available(), true);
		assert.deepEqual(
			{ hostSelfTests, selectedV20SelfTests, selectedV28SelfTests, spawns },
			{ hostSelfTests: 1, selectedV20SelfTests: 1, selectedV28SelfTests: 1, spawns: 2 },
		);

		enabled = false;
		assert.equal(runtime.deactivate(), true);
		assert.equal(runtime.available(), false);
		assert.equal(runtime.snapshot(), null);
		assert.equal(runtime.reason, 'native-media-disabled');
		assert.equal(runtime.dispose(), true);
	} finally {
		await fixture.dispose();
	}
});

test('a rapid disable and re-enable retries a superseded activation', async () => {
	const fixture = await runtimeFixture();
	try {
		let enabled = false;
		let releaseFirstSelfTest: () => void = () => undefined;
		const firstSelfTest = new Promise<void>((resolve) => { releaseFirstSelfTest = resolve; });
		let hostSelfTests = 0;
		const runtime = await startFramescaperNativeMediaRuntime({
			location: fixture.location,
			payloadPorts: fixture.payloadPorts,
			enabled: () => enabled,
			runHostSelfTest: async () => {
				hostSelfTests += 1;
				if (hostSelfTests === 1) await firstSelfTest;
				return SELF_TEST;
			},
			runSelectedV20RenderSelfTest: async () => SELECTED_V20_RENDER_SELF_TEST,
			runSelectedV28V14RenderSelfTest: async () => SELECTED_V28_V14_RENDER_SELF_TEST,
			spawnHelper: () => new Channel(),
		});
		enabled = true;
		const superseded = runtime.activate();
		while (hostSelfTests === 0) await new Promise<void>((resolve) => setImmediate(resolve));
		enabled = false;
		runtime.deactivate();
		enabled = true;
		const retried = runtime.activate();
		releaseFirstSelfTest();

		assert.equal(await superseded, false);
		assert.equal(await retried, true);
		assert.equal(hostSelfTests, 2);
		assert.equal(runtime.available(), true);
		runtime.dispose();
	} finally {
		await fixture.dispose();
	}
});

test('empty manifests and failed self-tests remain unavailable without spawning a helper', async () => {
	const repository = await startFramescaperNativeMediaRuntime({
		location: {
			applicationRoot: process.cwd(), packaged: false, resourcesPath: '/unused',
			platform: 'linux', arch: 'x64',
		},
		spawnHelper: () => { throw new Error('must not spawn'); },
	});
	assert.equal(repository.available(), false);
	assert.match(repository.reason ?? '', /payload-pending-external/u);
	assert.equal(repository.snapshot(), null);
	assert.equal(repository.selfTestResult(), null);
	assert.equal(repository.selectedV20RenderSelfTestResult(), null);
	assert.equal(repository.selectedV28V14RenderSelfTestResult(), null);

	const fixture = await runtimeFixture();
	try {
		let spawns = 0;
		const failed = await startFramescaperNativeMediaRuntime({
			location: fixture.location,
			payloadPorts: fixture.payloadPorts,
			runHostSelfTest: async () => SELF_TEST,
			runSelectedV20RenderSelfTest: async () => SELECTED_V20_RENDER_SELF_TEST,
			runSelectedV28V14RenderSelfTest: async () => SELECTED_V28_V14_RENDER_SELF_TEST,
			spawnHelper: () => { spawns += 1; return new FailedChannel(); },
		});
		assert.equal(failed.available(), false);
		assert.match(failed.reason ?? '', /self-test-failed/u);
		assert.ok(spawns >= 1 && spawns <= 2, 'startup rejects as soon as a supervised worker fails verification');
	} finally {
		await fixture.dispose();
	}
});

test('a failed authenticated host self-test blocks the pool before helpers spawn', async () => {
	const fixture = await runtimeFixture();
	try {
		let spawns = 0;
		const runtime = await startFramescaperNativeMediaRuntime({
			location: fixture.location,
			payloadPorts: fixture.payloadPorts,
			runHostSelfTest: async () => { throw new Error('professional probe mismatch'); },
			spawnHelper: () => { spawns += 1; return new Channel(); },
		});
		assert.equal(runtime.available(), false);
		assert.equal(runtime.selfTestResult(), null);
		assert.equal(runtime.selectedV20RenderSelfTestResult(), null);
		assert.equal(runtime.selectedV28V14RenderSelfTestResult(), null);
		assert.match(runtime.reason ?? '', /professional probe mismatch/u);
		assert.equal(spawns, 0);
	} finally {
		await fixture.dispose();
	}
});

test('a missing selected-V20 operation result leaves other media operations available', async () => {
	const fixture = await runtimeFixture();
	try {
		const runtime = await startFramescaperNativeMediaRuntime({
			location: fixture.location,
			payloadPorts: fixture.payloadPorts,
			runHostSelfTest: async () => SELF_TEST,
			runSelectedV20RenderSelfTest: async () => {
				throw new Error('selected V20 operation is not ready');
			},
			runSelectedV28V14RenderSelfTest: async () => SELECTED_V28_V14_RENDER_SELF_TEST,
			spawnHelper: () => new Channel(),
		});
		assert.equal(runtime.available(), true);
		assert.equal(runtime.reason, null);
		assert.equal(runtime.selectedV20RenderSelfTestResult(), null);
		assert.deepEqual(runtime.selectedV28V14RenderSelfTestResult(), SELECTED_V28_V14_RENDER_SELF_TEST);
		runtime.dispose();
	} finally {
		await fixture.dispose();
	}
});

test('self-test validation is closed to exact FFmpeg and retime results', () => {
	assert.doesNotThrow(() => assertFramescaperMediaHostSelfTest(SELF_TEST));
	for (const value of [
		{ ...SELF_TEST, extra: true },
		{ ...SELF_TEST, ffmpeg: '9.0.0' },
		{ ...SELF_TEST, networkInitialized: true },
		{ ...SELF_TEST, exactRetimeMatches: false },
		{ ...SELF_TEST, professionalCharacteristicsMatches: false },
	]) {
		assert.throws(() => assertFramescaperMediaHostSelfTest(value));
	}
});

test('selected-V20 render validation is closed to exact end-to-end operation results', () => {
	assert.doesNotThrow(() => (
		assertFramescaperMediaHostSelectedV20RenderSelfTest(SELECTED_V20_RENDER_SELF_TEST)
	));
	for (const value of [
		{ ...SELECTED_V20_RENDER_SELF_TEST, extra: true },
		{ ...SELECTED_V20_RENDER_SELF_TEST, planVersions: [7] },
		{ ...SELECTED_V20_RENDER_SELF_TEST, operation: 'media-encode' },
		{ ...SELECTED_V20_RENDER_SELF_TEST, maximumInFlightFrames: 2 },
		{ ...SELECTED_V20_RENDER_SELF_TEST, staticGeometryAdapterBound: false },
		{ ...SELECTED_V20_RENDER_SELF_TEST, captionDeliveryAdapterBound: false },
	]) {
		assert.throws(() => assertFramescaperMediaHostSelectedV20RenderSelfTest(value));
	}
});

test('selected-V28 queue validation is closed to its separate exact V14 carrier result', () => {
	assert.doesNotThrow(() => (
		assertFramescaperMediaHostSelectedV28V14RenderSelfTest(SELECTED_V28_V14_RENDER_SELF_TEST)
	));
	for (const value of [
		{ ...SELECTED_V28_V14_RENDER_SELF_TEST, extra: true },
		{ ...SELECTED_V28_V14_RENDER_SELF_TEST, planVersion: 8 },
		{ ...SELECTED_V28_V14_RENDER_SELF_TEST, rgbaFramePackVersion: 2 },
		{ ...SELECTED_V28_V14_RENDER_SELF_TEST, stagedAudioInputBound: false },
	]) assert.throws(() => assertFramescaperMediaHostSelectedV28V14RenderSelfTest(value));
});

class Channel implements HelperChannel {
	#message: ((message: unknown) => void) | null = null;
	#exit: ((code: number | null) => void) | null = null;

	postMessage(message: unknown): void {
		const record = message as Readonly<{ type?: unknown; jobId?: unknown }>;
		if (record.type === 'job') queueMicrotask(() => this.#message?.({
			contractVersion: 1, type: 'result', jobId: record.jobId, result: { probed: true },
		}));
	}
	onMessage(listener: (message: unknown) => void): void {
		this.#message = listener;
		queueMicrotask(() => listener({
			contractVersion: 1, type: 'hello',
			kinds: ['probe-video-source', 'media-decode', 'media-encode', 'media-render', 'media-proxy'],
		}));
	}
	onExit(listener: (code: number | null) => void): void { this.#exit = listener; }
	kill(): void { this.#exit?.(0); }
}

class FailedChannel implements HelperChannel {
	postMessage(): void {}
	onMessage(): void {}
	onExit(listener: (code: number | null) => void): void { queueMicrotask(() => listener(1)); }
	kill(): void {}
}

async function runtimeFixture() {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-media-runtime-'));
	const payloadPath = join(
		root, 'native/framescaper-media-host/prebuilt/linux-x64/framescaper-media-host',
	);
	const isolationRoot = join(root, 'native/framescaper-media-host/prebuilt/linux-x64/isolation');
	const libraryRoot = join(root, 'native/framescaper-media-host/prebuilt/linux-x64/lib');
	const launcherPath = join(isolationRoot, 'milestone5-native-isolation-launcher');
	const profilePath = join(isolationRoot, 'milestone5-native-isolation-profile.json');
	const brokerPath = join(isolationRoot, 'milestone5-native-isolation-broker.json');
	const libraryPath = join(libraryRoot, 'libframescaper-media.so');
	const bytes = Buffer.from('synthetic executable');
	const launcher = Buffer.from('synthetic launcher');
	const profile = Buffer.from('synthetic profile');
	const broker = Buffer.from('synthetic broker');
	const library = Buffer.from('synthetic runtime library');
	await mkdir(join(root, 'config'), { recursive: true });
	await mkdir(join(root, 'native/framescaper-media-host/prebuilt/linux-x64'), { recursive: true });
	await mkdir(isolationRoot, { recursive: true });
	await mkdir(libraryRoot, { recursive: true });
	await Promise.all([
		writeFile(payloadPath, bytes, { mode: 0o700 }),
		writeFile(launcherPath, launcher, { mode: 0o700 }),
		writeFile(profilePath, profile), writeFile(brokerPath, broker), writeFile(libraryPath, library),
	]);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const identity = await stat(payloadPath);
	const payload = {
		path: 'native/framescaper-media-host/prebuilt/linux-x64/framescaper-media-host',
		byteLength: bytes.byteLength, sha256,
	};
	const descriptor = (path: string, body: Buffer) => ({
		path, byteLength: body.byteLength, sha256: createHash('sha256').update(body).digest('hex'),
	});
	const isolationPayload = {
		launcherPayload: descriptor(
			'native/framescaper-media-host/prebuilt/linux-x64/isolation/milestone5-native-isolation-launcher',
			launcher,
		),
		sandboxProfilePayload: descriptor(
			'native/framescaper-media-host/prebuilt/linux-x64/isolation/milestone5-native-isolation-profile.json',
			profile,
		),
		brokerPolicyPayload: descriptor(
			'native/framescaper-media-host/prebuilt/linux-x64/isolation/milestone5-native-isolation-broker.json',
			broker,
		),
		runtimeLibraryPayloads: [descriptor(
			'native/framescaper-media-host/prebuilt/linux-x64/lib/libframescaper-media.so', library,
		)],
	};
	const targets = [
		{ id: 'linux-x64', runtime: 'linux-x64', status: 'built', blockedBy: null, payload,
			isolationPayload },
		...[
			['linux-arm64', 'linux-arm64'], ['mac-arm64', 'darwin-arm64'],
			['win-x64', 'win32-x64'], ['win-arm64', 'win32-arm64'],
		].map(([id, runtime]) => ({
			id, runtime, status: 'pending-external',
			blockedBy: 'No synthetic payload has been built.', payload: null,
			isolationPayload: null,
		})),
	];
	await writeFile(join(root, 'config/framescaper-media-host-payload-manifest.json'), JSON.stringify({
		schemaVersion: 1,
		id: 'framescaper-media-host-1.0.0',
		sourceManifestPath: 'native/framescaper-media-host/source-manifest.json',
		ffmpeg: {
			version: '9.0.1',
			sha256: 'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635',
		},
		runtimePrefix: 'native/framescaper-media-host',
		payloads: [{ id: 'linux-x64', runtime: 'linux-x64', ...payload, isolationPayload }],
		targets,
	}));
	return {
		location: {
			applicationRoot: root, packaged: false, resourcesPath: '/unused',
			platform: 'linux', arch: 'x64',
		},
		payloadPorts: {
			readFile,
			stat,
		},
		identity: { dev: identity.dev, ino: identity.ino },
		dispose: () => rm(root, { recursive: true, force: true }),
	};
}
