/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';

import { externalFfmpegExecutablePairClosureSha256 } from '../desktop/external-ffmpeg-node-runtime.ts';
import {
	createExternalFfmpegVideoOperationService,
	type ExternalFfmpegVideoChildProcess,
	type ExternalFfmpegVideoSpawn,
} from '../desktop/external-ffmpeg-video-operation-service.ts';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const PLAN = Object.freeze({
	schemaVersion: 1 as const, format: 'mp4' as const, quality: 'balanced' as const,
	width: 2, height: 2, frameRate: Object.freeze({ num: 1, den: 1 }), frameCount: 2,
	sampleRate: 48_000, durationFrames: 96_000, videoInputBytes: 32,
	audioInputBytes: null, ringCapacityBytes: 4_096, audioRingCapacityBytes: null,
	maximumOutputBytes: 1024 * 1024,
});

test('video service owns shell-free argv, streams with backpressure, and retains ranged output', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-service-test-'));
	const owner = {};
	const foreignOwner = {};
	const launches: Array<{ executable: string; arguments_: readonly string[]; options: unknown }> = [];
	let releaseWrite: (() => void) | null = null;
	const videoBytes: Buffer[] = [];
	const spawn: ExternalFfmpegVideoSpawn = (executable, arguments_, options) => {
		const child = fakeChild(new Writable({
			write(chunk, _encoding, callback) {
				videoBytes.push(Buffer.from(chunk));
				releaseWrite = callback;
			},
		}), null);
		launches.push({ executable, arguments_, options });
		child.stdio[3]!.once('finish', () => {
			void writeFile(String(arguments_.at(-1)), minimalMp4()).then(() => child.emit('close', 0, null));
		});
		return child;
	};
	const fixture = serviceFixture(root, spawn);
	try {
		const session = await fixture.service.begin(owner, PLAN);
		const executing = fixture.service.execute(owner, session.operationId);
		await assert.rejects(() => fixture.service.writeInput(foreignOwner, {
			operationId: session.operationId, role: 'video', offset: 0, bytes: Uint8Array.of(1),
		}), /owned/u);
		await assert.rejects(() => fixture.service.writeInput(owner, {
			operationId: session.operationId, role: 'video', offset: 1, bytes: Uint8Array.of(1),
		}), /offset|drift/u);
		await assert.rejects(() => fixture.service.writeInput(owner, {
			operationId: session.operationId, role: 'video', offset: 0,
			bytes: new Uint8Array(1024 * 1024 + 1),
		}), /chunk|limit/u);
		const writing = fixture.service.writeInput(owner, {
			operationId: session.operationId, role: 'video', offset: 0,
			bytes: new Uint8Array(32),
		});
		await waitFor(() => releaseWrite !== null);
		assert.equal(await pending(writing), true);
		releaseWrite?.();
		await writing;
		await fixture.service.closeInput(owner, {
			operationId: session.operationId, role: 'video', offset: 32,
		});
		assert.deepEqual(await executing, { exitCode: 0 });

		assert.equal(launches.length, 1);
		assert.equal(launches[0]?.executable, '/opt/ffmpeg');
		assert.equal((launches[0]?.options as { shell?: unknown }).shell, false);
		assert.ok(launches[0]?.arguments_.includes('pipe:3'));
		assert.ok(!launches[0]?.arguments_.includes('pipe:4'));
		assert.ok(launches[0]?.arguments_.includes('libx264'));
		assert.ok(launches[0]?.arguments_.includes('-fs'));
		assert.equal(Buffer.concat(videoBytes).byteLength, 32);

		await assert.rejects(
			() => fixture.service.statOutput(foreignOwner, session.operationId), /owned/u,
		);
		assert.deepEqual(await fixture.service.statOutput(owner, session.operationId), {
			byteLength: minimalMp4().byteLength,
		});
		assert.deepEqual(
			await fixture.service.readOutput(owner, {
				operationId: session.operationId, offset: 0, maximumBytes: 12,
			}),
			minimalMp4().subarray(0, 12),
		);
		assert.equal(await fixture.service.delete(owner, session.operationId), true);
		await assert.rejects(() => fixture.service.statOutput(owner, session.operationId), /unknown/u);
	} finally {
		fixture.service.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test('video service rejects byte drift and quarantines stale executable identity before spawn', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-service-stale-'));
	let launches = 0;
	const fixture = serviceFixture(root, () => { launches += 1; return fakeChild(new PassThrough(), null); }, {
		digest: async (path) => path.endsWith('ffmpeg') ? 'c'.repeat(64) : HASH_B,
	});
	try {
		const owner = {};
		const session = await fixture.service.begin(owner, PLAN);
		await assert.rejects(() => fixture.service.execute(fixture.owner, session.operationId), /owned/u);
		await assert.rejects(() => fixture.service.execute(owner, session.operationId), /identity/u);
		assert.equal(launches, 0);
		assert.deepEqual(fixture.invalidations, ['identity-changed']);
	} finally {
		fixture.service.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test('video service reserves an input offset while process startup is still pending', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-service-concurrent-write-'));
	const callbacks: Array<() => void> = [];
	const fixture = serviceFixture(root, () => fakeChild(new Writable({
		write(_chunk, _encoding, callback) { callbacks.push(callback); },
	}), null));
	try {
		const session = await fixture.service.begin(fixture.owner, PLAN);
		const first = fixture.service.writeInput(fixture.owner, {
			operationId: session.operationId, role: 'video', offset: 0,
			bytes: new Uint8Array(16),
		});
		const concurrent = fixture.service.writeInput(fixture.owner, {
			operationId: session.operationId, role: 'video', offset: 0,
			bytes: new Uint8Array(16),
		});
		const concurrentOutcome = concurrent.then(() => 'resolved', () => 'rejected');
		const executing = fixture.service.execute(fixture.owner, session.operationId);
		await waitFor(() => callbacks.length === 1);
		callbacks.shift()?.();
		await first;
		await new Promise<void>((resolve) => setImmediate(resolve));
		callbacks.shift()?.();
		assert.equal(await concurrentOutcome, 'rejected');
		await fixture.service.cancel(fixture.owner, session.operationId);
		await assert.rejects(executing);
	} finally {
		fixture.service.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test('video service rejects pending input when a ready session is cancelled or expires idle', async () => {
	for (const idle of [false, true]) {
		const root = await mkdtemp(join(tmpdir(), `soundscaper-video-service-${idle ? 'idle' : 'ready-cancel'}-`));
		let launches = 0;
		const fixture = serviceFixture(root, () => { launches += 1; return fakeChild(new PassThrough(), null); }, {
			...(idle ? { maximumIdleMs: 10 } : {}),
		});
		try {
			const session = await fixture.service.begin(fixture.owner, PLAN);
			const writing = fixture.service.writeInput(fixture.owner, {
				operationId: session.operationId, role: 'video', offset: 0,
				bytes: new Uint8Array(16),
			});
			const rejected = assert.rejects(writing, idle ? /idle|expired/u : /cancelled/u);
			if (!idle) assert.equal(await fixture.service.cancel(fixture.owner, session.operationId), true);
			await rejected;
			assert.equal(launches, 0);
			await fixture.service.begin(fixture.owner, PLAN);
		} finally {
			fixture.service.dispose();
			await rm(root, { recursive: true, force: true });
		}
	}
});

test('video service reserves input close while its private stream is finishing', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-service-concurrent-close-'));
	let finishInput: (() => void) | null = null;
	const fixture = serviceFixture(root, () => {
		const child = fakeChild(new Writable({
			write(_chunk, _encoding, callback) { callback(); },
			final(callback) { finishInput = callback; },
		}), null);
		child.stdio[3]!.once('finish', () => child.emit('close', 0, null));
		return child;
	});
	try {
		const session = await fixture.service.begin(fixture.owner, PLAN);
		const executing = fixture.service.execute(fixture.owner, session.operationId);
		await fixture.service.writeInput(fixture.owner, {
			operationId: session.operationId, role: 'video', offset: 0, bytes: new Uint8Array(32),
		});
		const closing = fixture.service.closeInput(fixture.owner, {
			operationId: session.operationId, role: 'video', offset: 32,
		});
		await waitFor(() => finishInput !== null);
		await assert.rejects(() => fixture.service.closeInput(fixture.owner, {
			operationId: session.operationId, role: 'video', offset: 32,
		}), /drift|closed/u);
		finishInput?.();
		await closing;
		await assert.rejects(executing, /output/u);
	} finally {
		fixture.service.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test('video service cancellation terminates the child and owner revocation drains the session', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-service-cancel-'));
	let killed = 0;
	let markSpawned!: () => void;
	const spawned = new Promise<void>((resolve) => { markSpawned = resolve; });
	const spawn: ExternalFfmpegVideoSpawn = () => {
		const child = fakeChild(new PassThrough(), null);
		child.kill = () => { killed += 1; queueMicrotask(() => child.emit('close', null, 'SIGTERM')); return true; };
		markSpawned();
		return child;
	};
	const fixture = serviceFixture(root, spawn);
	try {
		const session = await fixture.service.begin(fixture.owner, PLAN);
		const executing = fixture.service.execute(fixture.owner, session.operationId);
		await spawned;
		assert.equal(await fixture.service.cancel(fixture.owner, session.operationId), true);
		await assert.rejects(() => executing, /cancelled/u);
		assert.ok(killed > 0);

		await fixture.service.begin(fixture.owner, PLAN);
		assert.equal(await fixture.service.revokeOwner(fixture.owner), true);
		assert.equal(await fixture.service.revokeOwner(fixture.owner), false);
	} finally {
		fixture.service.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test('post-spawn private-pipe setup failure terminates the admitted child tree', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-service-pipe-'));
	let killed = 0;
	const fixture = serviceFixture(root, () => {
		const child = fakeChild(new PassThrough(), null);
		child.stdio = [null, child.stdout, child.stderr] as unknown as FakeChild['stdio'];
		child.kill = () => { killed += 1; queueMicrotask(() => child.emit('close', null, 'SIGKILL')); return true; };
		return child;
	});
	try {
		const session = await fixture.service.begin(fixture.owner, PLAN);
		await assert.rejects(() => fixture.service.execute(fixture.owner, session.operationId), /private input pipe/u);
		await waitFor(() => killed > 0);
	} finally {
		fixture.service.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

function serviceFixture(
	root: string,
	spawn: ExternalFfmpegVideoSpawn,
	overrides: Readonly<{
		digest?: (path: string) => Promise<string>;
		maximumIdleMs?: number;
	}> = {},
) {
	const owner = {};
	const invalidations: string[] = [];
	const identity = {
		version: '8.0.0', ffmpegSha256: HASH_A, ffprobePath: '/opt/ffprobe',
		ffprobeSha256: HASH_B,
		executablePairClosureSha256: externalFfmpegExecutablePairClosureSha256({
			ffmpegPath: '/opt/ffmpeg', ffmpegSha256: HASH_A,
			ffprobePath: '/opt/ffprobe', ffprobeSha256: HASH_B,
		}),
	};
	const admission = Object.freeze({
		executablePath: '/opt/ffmpeg', version: '8.0.0', capabilityGeneration: HASH_A,
		identity,
		capabilities: Object.freeze({
			encoders: ['libx264', 'aac', 'libvpx-vp9', 'libopus'],
			decoders: ['rawvideo', 'pcm_f32le'], muxers: ['mp4', 'webm'],
			demuxers: ['rawvideo', 'wav'], filters: ['apad'],
		}),
	});
	const service = createExternalFfmpegVideoOperationService({
		scratchRoot: root,
		preferences: {
			admission: () => admission,
			invalidateAdmission: async (_expected, reason) => { invalidations.push(reason); return {}; },
		},
		spawn,
		digestExecutable: overrides.digest ?? (async (path) => path.endsWith('ffmpeg') ? HASH_A : HASH_B),
		mintOperationId: () => `desktop-video-${'1'.repeat(32)}`,
		maximumDurationMs: 5_000,
		terminationGraceMs: 10,
		killWaitMs: 10,
		...(overrides.maximumIdleMs === undefined ? {} : { maximumIdleMs: overrides.maximumIdleMs }),
	});
	return { service, owner, invalidations };
}

interface FakeChild extends ExternalFfmpegVideoChildProcess, EventEmitter {
	stdio: [null, PassThrough, PassThrough, Writable, Writable?];
	kill: (signal: NodeJS.Signals) => boolean;
}

function fakeChild(video: Writable, audio: Writable | null): FakeChild {
	const child = new EventEmitter() as FakeChild;
	child.pid = 12_345;
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.stdio = [null, child.stdout, child.stderr, video, ...(audio ? [audio] : [])];
	child.kill = () => true;
	return child;
}

async function pending(promise: Promise<unknown>): Promise<boolean> {
	return Promise.race([promise.then(() => false, () => false), Promise.resolve(true)]);
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	throw new Error('Timed out waiting for test process state.');
}

function minimalMp4(): Uint8Array {
	return Uint8Array.from([
		0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70,
		0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0,
		0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32,
	]);
}
