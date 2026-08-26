/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';

import { createDesktopExternalFfmpegVideoCapabilities } from '../desktop/desktop-video-codec-operation-contract.ts';
import { externalFfmpegExecutablePairClosureSha256 } from '../desktop/external-ffmpeg-node-runtime.ts';
import {
	createExternalFfmpegVideoOperationService,
	type ExternalFfmpegVideoChildProcess,
	type ExternalFfmpegVideoSpawn,
} from '../desktop/external-ffmpeg-video-operation-service.ts';
import type { ExternalFfmpegVideoQualifier } from '../desktop/external-ffmpeg-video-qualified-capabilities.ts';

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
	const releaseWrite = { current: null as (() => void) | null };
	const videoBytes: Buffer[] = [];
	const spawn: ExternalFfmpegVideoSpawn = (executable, arguments_, options) => {
		const child = fakeChild(new Writable({
			write(chunk, _encoding, callback) {
				videoBytes.push(Buffer.from(chunk));
				releaseWrite.current = callback;
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
		await waitFor(() => releaseWrite.current !== null);
		assert.equal(await pending(writing), true);
		releaseWrite.current?.();
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
		await fixture.service.dispose();
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
		await fixture.service.dispose();
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
		await fixture.service.dispose();
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
			if (idle) assert.deepEqual([await fixture.service.revokeOwner(fixture.owner), await readdir(root)], [true, []]);
			await fixture.service.begin(fixture.owner, PLAN);
		} finally {
			await fixture.service.dispose();
			await rm(root, { recursive: true, force: true });
		}
	}
});

test('video service reserves input close while its private stream is finishing', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-service-concurrent-close-'));
	const finishInput = { current: null as (() => void) | null };
	const fixture = serviceFixture(root, () => {
		const child = fakeChild(new Writable({
			write(_chunk, _encoding, callback) { callback(); },
			final(callback) { finishInput.current = callback; },
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
		await waitFor(() => finishInput.current !== null);
		await assert.rejects(() => fixture.service.closeInput(fixture.owner, {
			operationId: session.operationId, role: 'video', offset: 32,
		}), /drift|closed/u);
		finishInput.current?.();
		await closing;
		await assert.rejects(executing, /output/u);
	} finally {
		await fixture.service.dispose();
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
		const cancelling = fixture.service.cancel(fixture.owner, session.operationId);
		await assert.rejects(fixture.service.begin(fixture.owner, PLAN), /active|busy/iu);
		assert.equal(await cancelling, true);
		await assert.rejects(() => executing, /cancelled/u);
		assert.ok(killed > 0);

		await fixture.service.begin(fixture.owner, PLAN);
		assert.equal(await fixture.service.revokeOwner(fixture.owner), true);
		assert.equal(await fixture.service.revokeOwner(fixture.owner), false);
	} finally {
		await fixture.service.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test('cancelling executed output removes scratch and releases owner capacity', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-service-cancel-output-'));
	const fixture = serviceFixture(root, (_executable, arguments_) => {
		const child = fakeChild(new PassThrough(), null);
		child.stdio[3]!.once('finish', () => {
			void writeFile(String(arguments_.at(-1)), minimalMp4()).then(() => child.emit('close', 0, null));
		});
		return child;
	});
	try {
		const session = await fixture.service.begin(fixture.owner, PLAN);
		const executing = fixture.service.execute(fixture.owner, session.operationId);
		await fixture.service.writeInput(fixture.owner, {
			operationId: session.operationId, role: 'video', offset: 0, bytes: new Uint8Array(32),
		});
		await fixture.service.closeInput(fixture.owner, {
			operationId: session.operationId, role: 'video', offset: 32,
		});
		await executing;
		assert.equal(await fixture.service.cancel(fixture.owner, session.operationId), true);
		assert.deepEqual(await readdir(root), []);
		const replacement = await fixture.service.begin(fixture.owner, PLAN);
		await fixture.service.cancel(fixture.owner, replacement.operationId);
	} finally {
		await fixture.service.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test('service shutdown retries a previously failed session cleanup', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-service-retry-cleanup-'));
	const fixture = serviceFixture(root, (_executable, arguments_) => {
		const child = fakeChild(new PassThrough(), null);
		child.stdio[3]!.once('finish', () => {
			void writeFile(String(arguments_.at(-1)), minimalMp4()).then(() => child.emit('close', 0, null));
		});
		return child;
	});
	try {
		const session = await fixture.service.begin(fixture.owner, PLAN);
		const executing = fixture.service.execute(fixture.owner, session.operationId);
		await fixture.service.writeInput(fixture.owner, {
			operationId: session.operationId, role: 'video', offset: 0, bytes: new Uint8Array(32),
		});
		await fixture.service.closeInput(fixture.owner, {
			operationId: session.operationId, role: 'video', offset: 32,
		});
		await executing; await chmod(root, 0o000);
		await assert.rejects(fixture.service.cancel(fixture.owner, session.operationId), /cleanup/iu);
		await chmod(root, 0o700); assert.equal(await fixture.service.revokeOwner(fixture.owner), true);
		assert.deepEqual(await readdir(root), []);
		await fixture.service.dispose();
	} finally {
		await chmod(root, 0o700).catch(() => undefined);
		await fixture.service.dispose().catch(() => undefined);
		await rm(root, { recursive: true, force: true });
	}
});

test('post-spawn private-pipe setup failure terminates the admitted child tree', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-service-pipe-'));
	let killed = 0;
	const fixture = serviceFixture(root, () => {
		const child = fakeChild(new PassThrough(), null, true);
		child.kill = () => { killed += 1; queueMicrotask(() => child.emit('close', null, 'SIGKILL')); return true; };
		return child;
	});
	try {
		const session = await fixture.service.begin(fixture.owner, PLAN);
		await assert.rejects(() => fixture.service.execute(fixture.owner, session.operationId), /private input pipe/u);
		await waitFor(() => killed > 0);
	} finally {
		await fixture.service.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test('video service coalesces qualification, reruns it for a new admission, and gates begin', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-service-qualification-'));
	let qualificationCalls = 0;
	let qualified = true;
	const fixture = serviceFixture(root, () => fakeChild(new PassThrough(), null), {
		qualify: async (value) => {
			qualificationCalls += 1;
			const capabilities = createDesktopExternalFfmpegVideoCapabilities(value);
			return qualified ? capabilities : Object.freeze({
				schemaVersion: 1 as const,
				formats: Object.freeze({
					...capabilities.formats,
					mp4: Object.freeze({
						available: false, provider: null,
						reason: 'The configured FFmpeg failed exact H264/AAC MP4 execution qualification.',
					}),
				}),
			});
		},
	});
	try {
		const [first, second] = await Promise.all([
			fixture.service.capabilities(), fixture.service.capabilities(),
		]);
		assert.equal(first.formats.mp4.available, true);
		assert.equal(second.formats.mp4.available, true);
		assert.equal(qualificationCalls, 1);
		fixture.setAdmission(Object.freeze({ ...fixture.admission }));
		qualified = false;
		assert.equal((await fixture.service.capabilities()).formats.mp4.available, false);
		assert.equal(qualificationCalls, 2);
		await assert.rejects(() => fixture.service.begin(fixture.owner, PLAN), /execution qualification/iu);
	} finally {
		await fixture.service.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test('video service reserves owner capacity while asynchronous qualification is pending', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-service-concurrent-begin-'));
	let release!: () => void;
	const qualificationReady = new Promise<void>((resolve) => { release = resolve; });
	const fixture = serviceFixture(root, () => fakeChild(new PassThrough(), null), {
		qualify: async (value) => {
			await qualificationReady;
			return createDesktopExternalFfmpegVideoCapabilities(value);
		},
	});
	try {
		const first = fixture.service.begin(fixture.owner, PLAN);
		await assert.rejects(() => fixture.service.begin(fixture.owner, PLAN), /already active|busy/iu);
		release();
		const session = await first;
		assert.equal(await fixture.service.cancel(fixture.owner, session.operationId), true);
	} finally {
		await fixture.service.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test('an identical rescan admission cannot inherit in-flight qualification authority', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-service-rescan-identity-'));
	let release!: () => void;
	const qualificationReady = new Promise<void>((resolve) => { release = resolve; });
	let calls = 0;
	const fixture = serviceFixture(root, () => fakeChild(new PassThrough(), null), {
		qualify: async (value) => {
			calls += 1; await qualificationReady;
			return createDesktopExternalFfmpegVideoCapabilities(value);
		},
	});
	try {
		const first = fixture.service.capabilities();
		await waitFor(() => calls === 1);
		fixture.setAdmission(Object.freeze({ ...fixture.admission }));
		release();
		assert.equal((await first).formats.mp4.available, false);
		assert.equal((await fixture.service.capabilities()).formats.mp4.available, true);
		assert.equal(calls, 2);
	} finally {
		await fixture.service.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test('owner revocation cancels and drains a begin that is awaiting qualification', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-service-revoke-begin-'));
	let release!: () => void;
	const qualificationReady = new Promise<void>((resolve) => { release = resolve; });
	const fixture = serviceFixture(root, () => fakeChild(new PassThrough(), null), {
		qualify: async (value) => {
			await qualificationReady;
			return createDesktopExternalFfmpegVideoCapabilities(value);
		},
	});
	try {
		const beginning = fixture.service.begin(fixture.owner, PLAN);
		const revoking = fixture.service.revokeOwner(fixture.owner);
		assert.equal(await pending(revoking), true);
		release();
		assert.equal(await revoking, true);
		await assert.rejects(beginning, /revoked|cancelled/iu);
		const session = await fixture.service.begin(fixture.owner, PLAN);
		await fixture.service.cancel(fixture.owner, session.operationId);
	} finally {
		await fixture.service.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test('service disposal aborts and drains an in-flight real qualification child', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-service-dispose-qualification-'));
	const child = { current: null as FakeChild | null };
	let killed = 0;
	let markSpawned!: () => void;
	const spawned = new Promise<void>((resolve) => { markSpawned = resolve; });
	const fixture = serviceFixture(root, () => {
		child.current = fakeChild(new PassThrough(), new PassThrough());
		child.current.kill = () => { killed += 1; return true; };
		markSpawned();
		return child.current;
	}, { qualify: null });
	try {
		const capabilities = assert.rejects(fixture.service.capabilities(), /abort|stopped/iu);
		await spawned;
		const disposal = fixture.service.dispose();
		await waitFor(() => killed > 0);
		assert.equal(await pending(disposal), true);
		child.current?.emit('close', null, 'SIGTERM');
		await disposal;
		await capabilities;
		assert.deepEqual(await readdir(root), []);
	} finally {
		await fixture.service.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test('service disposal is a barrier for running child termination and scratch cleanup', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-service-dispose-running-'));
	const child = { current: null as FakeChild | null };
	let killed = 0;
	const fixture = serviceFixture(root, () => {
		child.current = fakeChild(new PassThrough(), null);
		child.current.kill = () => { killed += 1; return true; };
		return child.current;
	});
	try {
		const session = await fixture.service.begin(fixture.owner, PLAN);
		const executing = fixture.service.execute(fixture.owner, session.operationId);
		await waitFor(() => child.current !== null);
		const disposal = fixture.service.dispose();
		await waitFor(() => killed > 0);
		assert.equal(await pending(disposal), true);
		child.current?.emit('close', null, 'SIGTERM');
		await disposal;
		await assert.rejects(executing, /cancelled/iu);
		assert.deepEqual(await readdir(root), []);
	} finally {
		await fixture.service.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test('service disposal reports cleanup failures after draining every cleanup task', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-service-dispose-failure-'));
	const fixture = serviceFixture(root, () => fakeChild(new PassThrough(), null));
	await mkdir(join(root, 'qualification'));
	await chmod(root, 0o000);
	try {
		const disposal = fixture.service.dispose();
		assert.strictEqual(fixture.service.dispose(), disposal);
		await assert.rejects(disposal, (error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.match(String(error.errors[0]), /EACCES|permission/iu);
			return true;
		});
	} finally {
		await chmod(root, 0o700);
		await rm(root, { recursive: true, force: true });
	}
});

function serviceFixture(
	root: string,
	spawn: ExternalFfmpegVideoSpawn,
	overrides: Readonly<{
		digest?: (path: string) => Promise<string>;
		maximumIdleMs?: number;
		qualify?: ExternalFfmpegVideoQualifier | null;
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
	let currentAdmission = admission;
	const service = createExternalFfmpegVideoOperationService({
		productId: 'soundscaper',
		scratchRoot: root,
		preferences: {
			admission: () => currentAdmission,
			invalidateAdmission: async (_expected, reason) => {
				invalidations.push(reason);
				return Object.freeze({
					state: 'quarantined' as const, location: '/opt/ffmpeg', version: null,
					detail: reason, canInstall: false, canBrowse: true, canClear: true,
				});
			},
		},
		spawn,
		digestExecutable: overrides.digest ?? (async (path) => path.endsWith('ffmpeg') ? HASH_A : HASH_B),
		mintOperationId: () => `desktop-video-${'1'.repeat(32)}`,
		...(overrides.qualify === null ? {} : {
			qualifyAdmission: overrides.qualify
				?? (async (value) => createDesktopExternalFfmpegVideoCapabilities(value)),
		}),
		maximumDurationMs: 5_000,
		terminationGraceMs: 10,
		killWaitMs: 10,
		...(overrides.maximumIdleMs === undefined ? {} : { maximumIdleMs: overrides.maximumIdleMs }),
	});
	return {
		service, owner, invalidations, admission,
		setAdmission(value: typeof admission) { currentAdmission = value; },
	};
}

type FakeChild = ExternalFfmpegVideoChildProcess & Pick<EventEmitter, 'emit'> & Readonly<{
	stdio: [null, PassThrough, PassThrough, Writable, Writable?] | [null, PassThrough, PassThrough];
}>;

function fakeChild(video: Writable, audio: Writable | null, omitPrivatePipes = false): FakeChild {
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	const stdio = omitPrivatePipes
		? [null, stdout, stderr]
		: [null, stdout, stderr, video, ...(audio ? [audio] : [])];
	return Object.assign(new EventEmitter(), {
		pid: 12_345, stdout, stderr, stdio, kill: () => true,
	}) as unknown as FakeChild;
}

async function pending(promise: Promise<unknown>): Promise<boolean> {
	return Promise.race([promise.then(() => false, () => false), Promise.resolve(true)]);
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (await predicate()) return;
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
