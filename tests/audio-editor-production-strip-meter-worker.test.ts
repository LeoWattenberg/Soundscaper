/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createProductionStripMeterWorkerClient,
	type ProductionStripMeterWorkerPort,
} from '../src/common/editor/engine/production-strip-meter-worker-client.ts';
import {
	PRODUCTION_STRIP_METER_WORKER_PROTOCOL_VERSION,
	createProductionStripMeterWorkerRuntime,
	type ProductionStripMeterWorkerResponse,
} from '../src/common/editor/engine/production-strip-meter-worker-runtime.ts';
import type { StripRef } from '../src/common/editor/parameter-address.ts';

const track = (id: string): StripRef => ({ kind: 'track', id });

test('worker runtime preserves strip math and resets its sequence for a new generation', () => {
	const responses: ProductionStripMeterWorkerResponse[] = [];
	const runtime = createProductionStripMeterWorkerRuntime({ post: (value) => responses.push(value) });
	runtime.handleMessage({
		type: 'sample', protocolVersion: PRODUCTION_STRIP_METER_WORKER_PROTOCOL_VERSION,
		generation: 1, requestId: 1,
		samples: [{
			strip: track('stereo'), channelLabels: ['L', 'R'],
			channels: [Float32Array.of(1, 0, -1, 0), Float32Array.of(1, 0, -1, 0)],
		}],
	});
	const first = responses.at(-1);
	assert.equal(first?.type, 'result');
	if (first?.type !== 'result') return;
	assert.equal(first.snapshot[0]?.channels[0]?.peak, 1);
	assert.equal(first.snapshot[0]?.channels[0]?.rms, Math.SQRT1_2);
	assert.equal(first.snapshot[0]?.correlation, 1);
	assert.equal(first.snapshot[0]?.sequence, 1);

	runtime.handleMessage({
		type: 'sample', protocolVersion: PRODUCTION_STRIP_METER_WORKER_PROTOCOL_VERSION,
		generation: 1, requestId: 2,
		samples: [{ strip: track('mono'), channelLabels: ['M'], channels: [Float32Array.of(0.5)] }],
	});
	const second = responses.at(-1);
	assert.equal(second?.type, 'result');
	if (second?.type !== 'result') return;
	assert.deepEqual(second.snapshot.map(({ strip, sequence }) => [strip, sequence]), [
		[track('stereo'), 1], [track('mono'), 2],
	]);

	runtime.handleMessage({
		type: 'sample', protocolVersion: PRODUCTION_STRIP_METER_WORKER_PROTOCOL_VERSION,
		generation: 2, requestId: 3,
		samples: [{ strip: track('mono'), channelLabels: ['M'], channels: [Float32Array.of(0.25)] }],
	});
	const third = responses.at(-1);
	assert.equal(third?.type, 'result');
	if (third?.type !== 'result') return;
	assert.deepEqual(third.snapshot.map(({ strip, sequence }) => [strip, sequence]), [[track('mono'), 1]]);
});

test('client transfers owned PCM and admits only one unfinished batch', () => {
	const worker = new FakeWorker();
	const client = createProductionStripMeterWorkerClient({ createWorker: () => worker });
	assert.equal(worker.posts.length, 0, 'worker is lazy');
	const left = Float32Array.of(1, 0, -1, 0);
	const right = left.slice();
	assert.equal(client.submit([{ strip: track('a'), channelLabels: ['L', 'R'], channels: [left, right] }]), true);
	assert.equal(client.busy(), true);
	assert.deepEqual(worker.posts[0]?.transfer, [left.buffer, right.buffer]);
	assert.equal(client.submit([{ strip: track('skipped'), channelLabels: ['M'], channels: [Float32Array.of(1)] }]), false);
	assert.equal(worker.posts.length, 1);
	worker.replyWithRuntime();
	assert.equal(client.busy(), false);
	assert.equal(client.snapshot()[0]?.strip.kind, 'track');
	assert.equal(client.snapshot()[0]?.correlation, 1);
	assert.equal(Object.isFrozen(client.snapshot()), true);
	assert.equal(Object.isFrozen(client.snapshot()[0]?.channels), true);
	assert.equal(client.submit([{ strip: track('b'), channelLabels: ['M'], channels: [Float32Array.of(0.25)] }]), true);
	assert.equal(worker.posts.length, 2);
	client.dispose();
	assert.equal(worker.terminated, true);
});

test('reset clears visible state and rejects an earlier generation without queuing more PCM', () => {
	const worker = new FakeWorker();
	const client = createProductionStripMeterWorkerClient({ createWorker: () => worker });
	assert.equal(client.submit([{ strip: track('old'), channelLabels: ['M'], channels: [Float32Array.of(1)] }]), true);
	client.reset();
	assert.deepEqual(client.snapshot(), []);
	assert.equal(client.busy(), true);
	assert.equal(client.submit([{ strip: track('blocked'), channelLabels: ['M'], channels: [Float32Array.of(1)] }]), false);
	worker.replyWithRuntime();
	assert.deepEqual(client.snapshot(), [], 'stale result is discarded');
	assert.equal(client.busy(), false);
	assert.equal(client.submit([{ strip: track('new'), channelLabels: ['M'], channels: [Float32Array.of(0.5)] }]), true);
	worker.replyWithRuntime();
	assert.deepEqual(client.snapshot().map(({ strip, sequence }) => [strip, sequence]), [[track('new'), 1]]);
	client.dispose();
});

test('worker failures terminate the client and expose a fallback signal to the engine', () => {
	const worker = new FakeWorker();
	const client = createProductionStripMeterWorkerClient({ createWorker: () => worker });
	assert.equal(client.submit([{ strip: track('a'), channelLabels: ['M'], channels: [Float32Array.of(1)] }]), true);
	worker.emit('messageerror', {});
	assert.equal(worker.terminated, true);
	assert.equal(client.busy(), false);
	assert.match(client.failed()?.message ?? '', /unreadable/iu);
	assert.equal(client.submit([{ strip: track('b'), channelLabels: ['M'], channels: [Float32Array.of(1)] }]), false);
	worker.replyWithRuntime();
	assert.deepEqual(client.snapshot(), []);
	client.dispose();
});

test('a malformed worker snapshot fails closed before it reaches an engine meter listener', () => {
	const worker = new FakeWorker();
	const client = createProductionStripMeterWorkerClient({ createWorker: () => worker });
	assert.equal(client.submit([{ strip: track('a'), channelLabels: ['M'], channels: [Float32Array.of(1)] }]), true);
	const request = worker.posts[0]?.message as { generation: number; requestId: number };
	worker.emit('message', { data: {
		type: 'result', protocolVersion: PRODUCTION_STRIP_METER_WORKER_PROTOCOL_VERSION,
		generation: request.generation, requestId: request.requestId,
		snapshot: [{
			strip: track('a'), sequence: 1, channelCount: 1,
			channels: [{ label: 'M', peak: Number.NaN, rms: 1 }],
			correlation: null, phaseDegrees: null,
		}],
	} });
	assert.equal(worker.terminated, true);
	assert.deepEqual(client.snapshot(), []);
	assert.ok(client.failed());
	client.dispose();
});

test('a stalled worker times out, including while a reset waits for the old reply', () => {
	const worker = new FakeWorker();
	const clock = new FakeClock();
	const client = createProductionStripMeterWorkerClient({
		createWorker: () => worker,
		setTimeout: clock.setTimeout,
		clearTimeout: clock.clearTimeout,
	});
	assert.equal(client.submit([{ strip: track('a'), channelLabels: ['M'], channels: [Float32Array.of(1)] }]), true);
	assert.deepEqual(clock.delays, [2_000]);
	client.reset();
	assert.equal(client.busy(), true);
	assert.equal(clock.pending(), 1);
	clock.fire();
	assert.equal(client.busy(), false);
	assert.equal(worker.terminated, true);
	assert.match(client.failed()?.message ?? '', /timed out/iu);
	assert.equal(clock.pending(), 0);
	client.dispose();
});

test('successful response and disposal cancel their response timers', () => {
	const worker = new FakeWorker();
	const clock = new FakeClock();
	const client = createProductionStripMeterWorkerClient({
		createWorker: () => worker,
		setTimeout: clock.setTimeout,
		clearTimeout: clock.clearTimeout,
	});
	assert.equal(client.submit([{ strip: track('a'), channelLabels: ['M'], channels: [Float32Array.of(1)] }]), true);
	assert.equal(clock.pending(), 1);
	worker.replyWithRuntime();
	assert.equal(clock.pending(), 0);
	assert.equal(client.submit([{ strip: track('b'), channelLabels: ['M'], channels: [Float32Array.of(1)] }]), true);
	assert.equal(clock.pending(), 1);
	client.dispose();
	assert.equal(clock.pending(), 0);
});

test('client rejects borrowed or oversized PCM before starting a worker', () => {
	let creates = 0;
	const client = createProductionStripMeterWorkerClient({ createWorker: () => { creates += 1; return new FakeWorker(); } });
	const shared = new Float32Array(4);
	assert.throws(() => client.submit([{ strip: track('shared'), channelLabels: ['L', 'R'], channels: [shared, shared] }]), /unique/iu);
	const partial = new Float32Array(new ArrayBuffer(16), 4, 2);
	assert.throws(() => client.submit([{ strip: track('partial'), channelLabels: ['M'], channels: [partial] }]), /exact-span/iu);
	assert.throws(() => client.submit([{ strip: track('long'), channelLabels: ['M'], channels: [new Float32Array(257)] }]), /256/iu);
	assert.equal(creates, 0);
	client.dispose();
});

class FakeWorker implements ProductionStripMeterWorkerPort {
	readonly posts: { message: unknown; transfer: readonly Transferable[] }[] = [];
	readonly listeners = new Map<string, Set<(event: { data?: unknown; error?: unknown; message?: string }) => void>>();
	readonly responses: ProductionStripMeterWorkerResponse[] = [];
	readonly runtime = createProductionStripMeterWorkerRuntime({ post: (value) => this.responses.push(value) });
	private replyIndex = 0;
	terminated = false;

	addEventListener(type: 'message' | 'messageerror' | 'error', listener: (event: { data?: unknown; error?: unknown; message?: string }) => void): void {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: 'message' | 'messageerror' | 'error', listener: (event: { data?: unknown; error?: unknown; message?: string }) => void): void {
		this.listeners.get(type)?.delete(listener);
	}

	postMessage(message: unknown, transfer: readonly Transferable[] = []): void {
		this.posts.push({ message, transfer });
	}

	terminate(): void { this.terminated = true; }

	replyWithRuntime(): void {
		const post = this.posts[this.replyIndex++];
		if (!post) throw new Error('No pending worker request.');
		this.runtime.handleMessage(post.message);
		const response = this.responses.shift();
		if (!response) throw new Error('The worker did not respond.');
		this.emit('message', { data: structuredClone(response) });
	}

	emit(type: 'message' | 'messageerror' | 'error', event: { data?: unknown; error?: unknown; message?: string }): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}

class FakeClock {
	readonly delays: number[] = [];
	private callbacks = new Set<() => void>();
	readonly setTimeout = ((callback: () => void, delay: number) => {
		this.delays.push(delay);
		this.callbacks.add(callback);
		return { unref() {} } as ReturnType<typeof globalThis.setTimeout>;
	}) as typeof globalThis.setTimeout;
	readonly clearTimeout = ((_timer: ReturnType<typeof globalThis.setTimeout>) => {
		this.callbacks.clear();
	}) as typeof globalThis.clearTimeout;
	pending(): number { return this.callbacks.size; }
	fire(): void {
		const callbacks = [...this.callbacks];
		this.callbacks.clear();
		for (const callback of callbacks) callback();
	}
}
