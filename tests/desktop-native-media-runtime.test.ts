/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { HelperChannel } from '../desktop/helper-supervisor.ts';
import {
	assertFramescaperMediaHostSelfTest,
	startFramescaperNativeMediaRuntime,
} from '../desktop/native-media-runtime.ts';

const SELF_TEST = Object.freeze({
	contractVersion: 1, ffmpeg: '9.0.1', networkInitialized: false,
	versionsMatch: true, exactRetimeMatches: true, proresProxyEncoderPresent: true,
	professionalCharacteristicsMatches: true,
});

test('an authenticated payload self-tests before a default two-worker pool accepts work', async () => {
	const fixture = await runtimeFixture();
	try {
		let spawns = 0;
		const runtime = await startFramescaperNativeMediaRuntime({
			location: fixture.location,
			runHostSelfTest: async () => SELF_TEST,
			spawnHelper: () => { spawns += 1; return new Channel(); },
			mintJobId: () => 'cd'.repeat(20),
		});
		assert.equal(runtime.available(), true);
		assert.equal(runtime.snapshot()?.configuredWorkers, 2);
		assert.deepEqual(runtime.selfTestEvidence(), SELF_TEST);
		assert.equal(spawns, 2, 'every default-pool worker negotiates its isolated self-test before availability');
		assert.deepEqual(await runtime.runJob({
			kind: 'probe-video-source',
			grant: {
				mediaPath: '/media/source.mov', mediaBytes: 10, identity: { dev: 1, ino: 2 },
			},
		}), { probed: true });
		assert.equal(spawns, 2, 'work reuses the already attested supervised utility process');
		assert.equal(runtime.dispose(), true);
		assert.equal(runtime.dispose(), false);
		assert.equal(runtime.available(), false);
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
	assert.equal(repository.selfTestEvidence(), null);

	const fixture = await runtimeFixture();
	try {
		let spawns = 0;
		const failed = await startFramescaperNativeMediaRuntime({
			location: fixture.location,
			runHostSelfTest: async () => SELF_TEST,
			spawnHelper: () => { spawns += 1; return new FailedChannel(); },
		});
		assert.equal(failed.available(), false);
		assert.match(failed.reason ?? '', /self-test-failed/u);
		assert.ok(spawns >= 1 && spawns <= 2, 'startup rejects as soon as a supervised worker fails attestation');
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
			runHostSelfTest: async () => { throw new Error('professional probe mismatch'); },
			spawnHelper: () => { spawns += 1; return new Channel(); },
		});
		assert.equal(runtime.available(), false);
		assert.equal(runtime.selfTestEvidence(), null);
		assert.match(runtime.reason ?? '', /professional probe mismatch/u);
		assert.equal(spawns, 0);
	} finally {
		await fixture.dispose();
	}
});

test('self-test admission is closed to exact FFmpeg and retime evidence', () => {
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
	const bytes = Buffer.from('synthetic executable');
	await mkdir(join(root, 'config'), { recursive: true });
	await mkdir(join(root, 'native/framescaper-media-host/prebuilt/linux-x64'), { recursive: true });
	await writeFile(payloadPath, bytes, { mode: 0o700 });
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const identity = await stat(payloadPath);
	const payload = {
		path: 'native/framescaper-media-host/prebuilt/linux-x64/framescaper-media-host',
		byteLength: bytes.byteLength, sha256,
	};
	const targets = [
		{ id: 'linux-x64', runtime: 'linux-x64', status: 'built', blockedBy: null, payload },
		...[
			['linux-arm64', 'linux-arm64'], ['mac-arm64', 'darwin-arm64'],
			['win-x64', 'win32-x64'], ['win-arm64', 'win32-arm64'],
		].map(([id, runtime]) => ({
			id, runtime, status: 'pending-external',
			blockedBy: 'No qualified synthetic payload exists.', payload: null,
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
		payloads: [{ id: 'linux-x64', runtime: 'linux-x64', ...payload }],
		targets,
	}));
	return {
		location: {
			applicationRoot: root, packaged: false, resourcesPath: '/unused',
			platform: 'linux', arch: 'x64',
		},
		identity: { dev: identity.dev, ino: identity.ino },
		dispose: () => rm(root, { recursive: true, force: true }),
	};
}
