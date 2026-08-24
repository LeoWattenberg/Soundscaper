/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { FramescaperMediaHostDescriptor } from '../desktop/framescaper-media-host-payload.ts';
import type { HelperDataPlaneBinding } from '../desktop/helper-data-plane.ts';
import {
	HelperDataPlaneInputSender,
	type HelperDataPlaneInputReservation,
} from '../desktop/helper-data-plane-input-reservation.ts';
import {
	sendHelperDataPlaneFile,
	type HelperDataPlaneByteSink,
	type HelperDataPlaneIoPort,
} from '../desktop/helper-data-plane-io.ts';
import {
	createNativeMediaHelperJobRunner,
	nativeMediaHostArguments,
	type NativeMediaHostInvocation,
	type NativeMediaHostProcessHandle,
} from '../desktop/native-media-helper-job.ts';
import { framescaperMediaHostDescriptorFixture } from './helpers/framescaper-media-host-descriptor-fixture.ts';
import { canonicalizeNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { nativeQueueKeyedPlanV7 } from './helpers/native-queue-plan-fixture.ts';

const VIDEO = new Uint8Array([1, 2, 3, 4, 5]);
const AUDIO = new Uint8Array([6, 7, 8, 9]);
const OUTPUT = Buffer.from('live encoded output');

test('the helper mounts exact stdin/fd3 roles and waits for both authenticated live trailers', async () => {
	const harness = await liveHarness();
	try {
		const process = successfulLiveProcess(harness.outputPath);
		const running = harness.run(process.handle, process.invocation);
		await within(Promise.race([
			harness.sendPlan(),
			running.completion.then(() => { throw new Error('job completed before plan transfer'); }),
		]), 'plan transfer');
		const invocation = await within(process.invocation.promise, 'host invocation');
		assert.deepEqual(nativeMediaHostArguments(invocation).filter((value) => (
			value === '--source-stream' || value === '--source-stream-fd' || value === 'stdin' || value === '3'
		)), ['--source-stream', 'stdin', '--source-stream-fd', '3']);
		assert.deepEqual(invocation.sources.map(({ path, sha256, role }) => ({ path, sha256, role })), [
			{ path: null, sha256: null, role: 'evaluated-rgba-frame-pack' },
			{ path: null, sha256: null, role: 'staged-audio-mix' },
		]);
		await within(Promise.all([
			sendLive(harness.videoReservation, harness.videoHost, VIDEO),
			sendLive(harness.audioReservation, harness.audioHost, AUDIO),
		]), 'live transfer');
		const result = await within(running.completion, 'job completion');
		assert.deepEqual(process.received, { video: [...VIDEO], audio: [...AUDIO] });
		assert.equal((result as { output: { sha256: string } }).output.sha256, digest(OUTPUT));
		assert.deepEqual(await readFile(harness.outputPath), OUTPUT);
	} finally { await harness.dispose(); }
});

test('an early native exit aborts both live sinks and removes any uninspected output', async () => {
	const harness = await liveHarness();
	try {
		let cancels = 0; let sinkAborts = 0;
		const invocation = deferred<NativeMediaHostInvocation>();
		const exited = deferred<{ exitCode: number; stdout: string; stderr: string }>();
		const handle: NativeMediaHostProcessHandle = {
			completion: exited.promise,
			inputs: ['evaluated-rgba-frame-pack', 'staged-audio-mix'].map((role) => ({
				role: role as 'evaluated-rgba-frame-pack' | 'staged-audio-mix',
				sink: sink({ abort: () => { sinkAborts += 1; } }),
			})),
			cancel: async () => { cancels += 1; },
		};
		const running = harness.run(handle, invocation);
		await harness.sendPlan();
		await invocation.promise;
		await writeFile(harness.outputPath, OUTPUT);
		exited.resolve({ exitCode: 70, stdout: '{"error":"native-early-exit"}', stderr: '' });
		await assert.rejects(running.completion, /native-early-exit/iu);
		assert.equal(cancels, 1);
		assert.equal(sinkAborts, 2);
		await assert.rejects(stat(harness.outputPath), /ENOENT/u);
	} finally { await harness.dispose(); }
});

test('a live trailer mismatch cancels the host and cannot retain its partial output', async () => {
	const harness = await liveHarness();
	try {
		const stopped = deferred<never>();
		let cancels = 0;
		const invocation = deferred<NativeMediaHostInvocation>();
		const handle: NativeMediaHostProcessHandle = {
			completion: stopped.promise,
			inputs: [
				{ role: 'evaluated-rgba-frame-pack', sink: sink({
					write: async () => { await writeFile(harness.outputPath, OUTPUT); },
				}) },
				{ role: 'staged-audio-mix', sink: sink() },
			],
			cancel: async () => { cancels += 1; stopped.reject(new Error('host cancelled')); },
		};
		const running = harness.run(handle, invocation);
		await harness.sendPlan(); await invocation.promise;
		const sender = new HelperDataPlaneInputSender(harness.videoReservation);
		harness.videoHost.postMessage(sender.createChunk(VIDEO));
		sender.acceptAck(await harness.videoHost.next());
		harness.videoHost.postMessage({ ...sender.complete(), sha256: '00'.repeat(32) });
		await assert.rejects(running.completion, /trailer disagrees/iu);
		assert.equal(cancels, 1);
		await assert.rejects(stat(harness.outputPath), /ENOENT/u);
	} finally { await harness.dispose(); }
});

test('queue cancellation interrupts a stalled native write with no output publication', async () => {
	const harness = await liveHarness();
	try {
		const entered = deferred<void>(); const stalled = deferred<void>();
		const hostDone = deferred<never>(); let sinkAborts = 0;
		const invocation = deferred<NativeMediaHostInvocation>();
		const handle: NativeMediaHostProcessHandle = {
			completion: hostDone.promise,
			inputs: [
				{ role: 'evaluated-rgba-frame-pack', sink: sink({
					write: () => { entered.resolve(); return stalled.promise; },
					abort: () => { sinkAborts += 1; stalled.reject(new Error('stdin closed')); },
				}) },
				{ role: 'staged-audio-mix', sink: sink({ abort: () => { sinkAborts += 1; } }) },
			],
			cancel: async () => { hostDone.reject(new Error('host cancelled')); },
		};
		const running = harness.run(handle, invocation);
		await harness.sendPlan(); await invocation.promise;
		const sender = new HelperDataPlaneInputSender(harness.videoReservation);
		harness.videoHost.postMessage(sender.createChunk(VIDEO));
		await entered.promise;
		await running.cancel();
		await assert.rejects(running.completion, /cancelled|aborted|closed/iu);
		assert.equal(sinkAborts, 2);
		assert.equal(harness.videoHost.received.some((value) => typeOf(value) === 'ack'), false);
		await assert.rejects(stat(harness.outputPath), /ENOENT/u);
	} finally { await harness.dispose(); }
});

async function liveHarness() {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-live-media-job-'));
	const executablePath = join(root, 'framescaper-media-host');
	const planPath = join(root, 'plan.json');
	const outputRoot = join(root, 'output'); const scratchRoot = join(root, 'scratch');
	const outputPath = join(outputRoot, '.live.tmp');
	const executableBytes = Buffer.from('synthetic executable');
	const planBytes = Buffer.from(canonicalizeNativeMediaPlan(nativeQueueKeyedPlanV7()));
	await Promise.all([
		writeFile(executablePath, executableBytes, { mode: 0o700 }), writeFile(planPath, planBytes),
		mkdir(outputRoot), mkdir(scratchRoot),
	]);
	const [outputIdentity, scratchIdentity] = await Promise.all([
		identity(outputRoot), identity(scratchRoot),
	]);
	const descriptor: FramescaperMediaHostDescriptor = framescaperMediaHostDescriptorFixture(Object.freeze({
		target: 'linux-x64', runtime: 'linux-x64', path: executablePath,
		byteLength: executableBytes.byteLength, sha256: digest(executableBytes),
		hostVersion: '1.0.0', ffmpegVersion: '9.0.1', identity: await identity(executablePath),
	}));
	const plan = binding(planBytes);
	const videoReservation = reservation('56', VIDEO.byteLength);
	const audioReservation = reservation('78', AUDIO.byteLength);
	const [planHost, planHelper] = portPair();
	const [videoHost, videoHelper] = portPair();
	const [audioHost, audioHelper] = portPair();
	return {
		root, descriptor, outputPath, videoReservation, audioReservation, planHost, planHelper, videoHost, audioHost,
		run(handle: NativeMediaHostProcessHandle, observed = deferred<NativeMediaHostInvocation>()) {
			const runner = createNativeMediaHelperJobRunner({ descriptor, invokeHost: (value) => {
				observed.resolve(value); return handle;
			} });
			return runner.run({
				kind: 'media-render', grant: {
					backend: 'native-cpu',
					executable: { role: 'ffmpeg', path: descriptor.path, bytes: descriptor.byteLength,
						sha256: descriptor.sha256, identity: descriptor.identity },
					plan,
					sources: [
						{ type: 'stream', role: 'evaluated-rgba-frame-pack', binding: videoReservation },
						{ type: 'stream', role: 'staged-audio-mix', binding: audioReservation },
					],
					output: { rootPath: outputRoot, rootIdentity: outputIdentity,
						temporaryPath: outputPath, finalPath: join(outputRoot, 'live.mov'), maximumBytes: 1_024 },
					scratch: { rootPath: scratchRoot, rootIdentity: scratchIdentity,
						reservationId: '9a'.repeat(20), maximumBytes: 4_096 },
				}, ports: [planHelper, videoHelper, audioHelper],
			});
		},
		sendPlan: () => sendHelperDataPlaneFile({ binding: plan, port: planHost, path: planPath }),
		dispose: () => rm(root, { recursive: true, force: true }),
	};
}

function successfulLiveProcess(outputPath: string) {
	const invocation = deferred<NativeMediaHostInvocation>();
	const completed = deferred<void>(); let completionCount = 0;
	const received = { video: [] as number[], audio: [] as number[] };
	const input = (role: 'evaluated-rgba-frame-pack' | 'staged-audio-mix', target: number[]) => ({
		role, sink: sink({ write: (bytes) => { target.push(...bytes); }, complete: async () => {
			completionCount += 1;
			if (completionCount === 2) { await writeFile(outputPath, OUTPUT); completed.resolve(); }
		} }),
	});
	const handle: NativeMediaHostProcessHandle = {
		completion: completed.promise.then(() => ({ exitCode: 0, stderr: '', stdout: JSON.stringify({
			contractVersion: 1, operation: 'media-render', byteLength: OUTPUT.byteLength, sha256: digest(OUTPUT),
		}) })),
		inputs: [input('evaluated-rgba-frame-pack', received.video), input('staged-audio-mix', received.audio)],
		cancel: async () => undefined,
	};
	return { handle, invocation, received };
}

function sink(overrides: Partial<HelperDataPlaneByteSink> = {}): HelperDataPlaneByteSink {
	return { write: () => undefined, complete: () => undefined, abort: () => undefined, ...overrides };
}
async function sendLive(reservationValue: HelperDataPlaneInputReservation, port: Port, bytes: Uint8Array) {
	const sender = new HelperDataPlaneInputSender(reservationValue);
	port.postMessage(sender.createChunk(bytes)); sender.acceptAck(await port.next());
	port.postMessage(sender.complete());
}
function reservation(prefix: string, byteLength: number): HelperDataPlaneInputReservation {
	return Object.freeze({ dataPlaneVersion: 1, transport: 'message-port', streamId: prefix.repeat(20),
		direction: 'host-to-helper', authentication: 'trailer-sha256-v1', byteLength,
		maximumChunkBytes: 16, maximumInFlightChunks: 1 });
}
function binding(bytes: Uint8Array): HelperDataPlaneBinding {
	return Object.freeze({ dataPlaneVersion: 1, transport: 'message-port', streamId: '12'.repeat(20),
		direction: 'host-to-helper', byteLength: bytes.byteLength, sha256: digest(bytes),
		maximumChunkBytes: 64, maximumInFlightChunks: 1 });
}
function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
async function identity(path: string) { const value = await stat(path); return { dev: value.dev, ino: value.ino }; }

class Port extends EventEmitter implements HelperDataPlaneIoPort {
	peer: Port | null = null; readonly received: unknown[] = []; readonly pending: unknown[] = [];
	started = false;
	postMessage(value: unknown): void { queueMicrotask(() => this.peer?.accept(value)); }
	start(): void {
		this.started = true;
		for (const value of this.pending.splice(0)) this.emit('message', { data: value });
	}
	close(): void {}
	accept(value: unknown): void {
		this.received.push(value);
		if (this.started) this.emit('message', { data: value }); else this.pending.push(value);
	}
	async next(): Promise<unknown> {
		const queued = this.received.shift();
		if (queued !== undefined) { this.pending.shift(); return queued; }
		if (!this.started) this.start();
		const [event] = await once(this, 'message') as [{ data: unknown }]; this.received.shift(); return event.data;
	}
}
function portPair(): readonly [Port, Port] { const a = new Port(); const b = new Port(); a.peer = b; b.peer = a; return [a, b]; }
function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void; let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject };
}
function typeOf(value: unknown): unknown { return (value as { type?: unknown } | null)?.type; }
async function within<T>(promise: PromiseLike<T>, label: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	try { return await Promise.race([Promise.resolve(promise), new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} timed out`)), 2_000);
	})]); } finally { if (timer) clearTimeout(timer); }
}
