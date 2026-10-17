/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withDecodedRawFrameV1, withRawEmbeddedPreviewV1,
	type LibRawWorkerPortV1, type LibRawRuntimeOptionsV1 } from '../src/common/editor/raw/libraw-runtime-v1.ts';

// These explicit transport doubles qualify ownership/lifetime only. Decoder
// pixels and native ABI are independently exercised by the actual-Wasm tests.
const MODULE = new WebAssembly.Module(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0));
type EventName = 'message' | 'error' | 'messageerror';
type Listener = (event: Readonly<{ data?: unknown }>) => void;
function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>(yes => { resolve = yes; }); return { promise, resolve };
}
function observed<Result>(promise: Promise<Result>) {
	return promise.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}
class TransportWorker implements LibRawWorkerPortV1 {
	readonly listeners = new Map<EventName, Set<Listener>>();
	readonly posted = deferred<void>();
	readonly retiring = deferred<void>();
	readonly retirement = deferred<void>();
	input: Uint8Array | undefined;
	retired = false;
	terminations = 0;
	constructor(hold = false) { if (!hold) this.retirement.resolve(); }
	addEventListener(type: EventName, listener: Listener): void {
		let group = this.listeners.get(type); if (!group) { group = new Set(); this.listeners.set(type, group); } group.add(listener);
	}
	removeEventListener(type: EventName, listener: Listener): void { this.listeners.get(type)?.delete(listener); }
	postMessage(message: unknown, transfer: Transferable[]): void {
		const delivered: unknown = structuredClone(message, { transfer });
		assert.ok(typeof delivered === 'object' && delivered !== null);
		const bytes: unknown = Object.getOwnPropertyDescriptor(delivered, 'bytes')?.value;
		assert.ok(bytes instanceof Uint8Array); this.input = bytes; this.posted.resolve();
	}
	async terminate(): Promise<void> {
		this.terminations++; this.retiring.resolve(); await this.retirement.promise; this.input?.fill(0); this.retired = true;
	}
	reply(value: unknown): void { for (const listener of this.listeners.get('message') ?? []) listener({ data: value }); }
}
function options(worker: TransportWorker): Readonly<LibRawRuntimeOptionsV1> {
	return { loadModule: async () => MODULE, createWorker: () => worker };
}
function frameResponse() {
	return { schemaVersion: 1, kind: 'frame', frame: {
		descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' },
		pixels: Uint16Array.of(1, 257, 32769, 65535),
	} };
}

test('RAW transport captures input and option methods before loading and joins worker exit before the held consumer', async () => {
	const worker = new TransportWorker(true), loading = deferred<WebAssembly.Module>(), entered = deferred<void>(), release = deferred<void>();
	const bytes = Uint8Array.of(1, 2, 3, 4), response = frameResponse(); let consumed = false;
	const config = {
		loadModule(): Promise<WebAssembly.Module> { assert.equal(this, config); return loading.promise; },
		createWorker(): TransportWorker { assert.equal(this, config); return worker; },
	};
	const work = observed(withDecodedRawFrameV1({ bytes }, async frame => {
		assert.equal(worker.retired, true); consumed = true; entered.resolve(); await release.promise; return [...frame.pixels];
	}, config));
	bytes.fill(9); config.createWorker = () => { throw new Error('Late factory replacement.'); };
	loading.resolve(MODULE); await worker.posted.promise; assert.deepEqual([...worker.input!], [1, 2, 3, 4]);
	worker.terminate = async () => { throw new Error('Late termination replacement.'); };
	worker.reply(response); await worker.retiring.promise; assert.equal(consumed, false);
	assert.deepEqual([...response.frame.pixels], [1, 257, 32769, 65535]); worker.retirement.resolve(); await entered.promise;
	assert.equal(response.frame.pixels[2], 32769); release.resolve(); const outcome = await work;
	assert.ok(outcome.ok); assert.deepEqual(outcome.value, [1, 257, 32769, 65535]);
	assert.deepEqual([...response.frame.pixels], [0, 0, 0, 0]); assert.deepEqual([...bytes], [9, 9, 9, 9]); assert.equal(worker.terminations, 1);
});

test('pending native cancellation joins asynchronous termination and preserves an opaque reason without delivering output', async () => {
	const worker = new TransportWorker(true), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); let consumed = false, settled = false;
	const bytes = Uint8Array.of(1, 2, 3);
	const work = observed(withDecodedRawFrameV1({ bytes, signal: stop.signal }, () => { consumed = true; }, options(worker)));
	void work.then(() => { settled = true; }); await worker.posted.promise; stop.abort(opaque.proxy); await worker.retiring.promise;
	assert.equal(settled, false); assert.equal(consumed, false); worker.retirement.resolve(); const outcome = await work;
	assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, opaque.proxy)); assert.equal(worker.retired, true); assert.deepEqual([...bytes], [1, 2, 3]);
});

test('a late physically transferred frame after abort is wiped while asynchronous worker termination joins', async () => {
	const worker = new TransportWorker(true), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	const response = frameResponse(), transferred = structuredClone(response, { transfer: [response.frame.pixels.buffer] });
	let consumed = false, settled = false;
	const work = observed(withDecodedRawFrameV1({ bytes: Uint8Array.of(1), signal: stop.signal }, () => { consumed = true; }, options(worker)));
	void work.then(() => { settled = true; });
	try {
		await worker.posted.promise; stop.abort(opaque.proxy); await worker.retiring.promise;
		assert.equal(response.frame.pixels.byteLength, 0); assert.equal(settled, false);
		// The transport has moved ownership to the host, independently of whether
		// the aborted operation still admits consumer publication.
		worker.reply(transferred); worker.retirement.resolve(); const outcome = await work;
		assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, opaque.proxy)); assert.equal(consumed, false);
		assert.ok(transferred.frame.pixels.every(value => value === 0), 'The late host-owned physical frame must retire before the aborted scope settles.');
	} finally { worker.retirement.resolve(); await work; transferred.frame.pixels.fill(0); }
});

test('held RAW consumer remains joined through abort and wipes the pinned physical plane despite view shadows', async () => {
	const worker = new TransportWorker(), stop = new AbortController(), release = deferred<void>(), entered = deferred<void>();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const response = frameResponse(), backing = response.frame.pixels.buffer;
	const work = observed(withDecodedRawFrameV1({ bytes: Uint8Array.of(1), signal: stop.signal }, async frame => {
		Object.defineProperty(frame.pixels, 'buffer', { value: new ArrayBuffer(0) }); entered.resolve(); await release.promise;
	}, options(worker)));
	await worker.posted.promise; worker.reply(response); await entered.promise; stop.abort(opaque.proxy);
	assert.equal(new Uint16Array(backing)[2], 32769); release.resolve(); const outcome = await work;
	assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, opaque.proxy)); assert.deepEqual([...new Uint16Array(backing)], [0, 0, 0, 0]);
});

test('consumer transfer retains its opaque primary plus independent physical retirement failure', async () => {
	const worker = new TransportWorker(), opaque = Proxy.revocable({}, {}); opaque.revoke(); const response = frameResponse();
	const work = observed(withDecodedRawFrameV1({ bytes: Uint8Array.of(1) }, frame => {
		structuredClone(frame.pixels.buffer, { transfer: [frame.pixels.buffer] }); throw opaque.proxy;
	}, options(worker)));
	await worker.posted.promise; worker.reply(response); const outcome = await work;
	assert.ok(!outcome.ok); assert.ok(outcome.error instanceof AggregateError); assert.ok(Object.is(outcome.error.cause, opaque.proxy));
	assert.ok(outcome.error.errors.some((error: unknown) => Object.is(error, opaque.proxy)));
	assert.ok(outcome.error.errors.some((error: unknown) => !Object.is(error, opaque.proxy) && error instanceof TypeError));
});

test('abort and independent worker retirement failure both survive without inspecting either opaque value', async () => {
	const worker = new TransportWorker(), stop = new AbortController();
	const aborted = Proxy.revocable({}, {}), cleanup = Proxy.revocable({}, {}); aborted.revoke(); cleanup.revoke();
	worker.terminate = async () => { worker.terminations++; throw cleanup.proxy; };
	const work = observed(withDecodedRawFrameV1({ bytes: Uint8Array.of(1), signal: stop.signal }, () => assert.fail(), options(worker)));
	await worker.posted.promise; stop.abort(aborted.proxy); const outcome = await work;
	assert.ok(!outcome.ok); assert.ok(outcome.error instanceof AggregateError); assert.ok(Object.is(outcome.error.cause, aborted.proxy));
	assert.ok(outcome.error.errors.some((error: unknown) => Object.is(error, aborted.proxy)));
	assert.ok(outcome.error.errors.some((error: unknown) => Object.is(error, cleanup.proxy))); worker.input?.fill(0);
});

test('missing and bitmap embedded previews stay typed and their payload is retired after the consumer', async () => {
	for (const preview of [null, { type: 'bitmap', width: 2, height: 1, channels: 1, bits: 16, rawFlip: 6, bytes: Uint8Array.of(1, 0, 1, 1) }]) {
		const worker = new TransportWorker();
		const work = withRawEmbeddedPreviewV1({ bytes: Uint8Array.of(1) }, value => {
			assert.equal(worker.retired, true); assert.deepEqual(value, preview); return value?.rawFlip ?? null;
		}, options(worker));
		await worker.posted.promise; worker.reply({ schemaVersion: 1, kind: 'preview', preview });
		assert.equal(await work, preview?.rawFlip ?? null); assert.equal(preview?.bytes.every(value => value === 0) ?? true, true);
	}
});

test('malformed responses never reach a consumer and their transferred plane is still physically retired', async () => {
	for (const defect of ['future', 'geometry', 'profile', 'padding']) {
		const worker = new TransportWorker(), response = frameResponse();
		if (defect === 'future') Object.assign(response, { future: true });
		if (defect === 'geometry') response.frame.descriptor.width = 2;
		if (defect === 'profile') response.frame.descriptor.transfer = 'srgb';
		if (defect === 'padding') response.frame.pixels = new Uint16Array(Uint16Array.of(9, 1, 257, 32769, 65535, 9).buffer, 2, 4);
		const work = observed(withDecodedRawFrameV1({ bytes: Uint8Array.of(1) }, () => assert.fail('Malformed output cannot be consumed.'), options(worker)));
		await worker.posted.promise; worker.reply(response); const outcome = await work;
		assert.ok(!outcome.ok); assert.equal(worker.retired, true); assert.deepEqual([...response.frame.pixels], [0, 0, 0, 0]);
		if (defect === 'padding') assert.deepEqual([...new Uint16Array(response.frame.pixels.buffer)], [0, 0, 0, 0, 0, 0]);
	}
});

test('preabort, hostile metadata and noncallable consumers refuse before loader or worker acquisition', async () => {
	let loads = 0, workers = 0, reads = 0;
	const config = { loadModule: async () => { loads++; return MODULE; }, createWorker: () => { workers++; return new TransportWorker(); } };
	const stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); stop.abort(opaque.proxy);
	const cancelled = await observed(withDecodedRawFrameV1({ bytes: Uint8Array.of(1), signal: stop.signal }, () => undefined, config));
	assert.ok(!cancelled.ok); assert.ok(Object.is(cancelled.error, opaque.proxy));
	const getter = Object.defineProperty({}, 'bytes', { enumerable: true, get() { reads++; return Uint8Array.of(1); } });
	for (const value of [getter, { bytes: new Uint8Array() }, { bytes: Uint16Array.of(1) }, { bytes: Uint8Array.of(1), future: true }]) {
		assert.ok(!(await observed(withDecodedRawFrameV1(value, () => undefined, config))).ok);
	}
	const notCallable = undefined as unknown as () => void;
	assert.ok(!(await observed(withDecodedRawFrameV1({ bytes: Uint8Array.of(1) }, notCallable, config))).ok);
	assert.ok(!(await observed(withRawEmbeddedPreviewV1({ bytes: Uint8Array.of(1) }, notCallable, config))).ok);
	assert.equal(loads, 0); assert.equal(workers, 0); assert.equal(reads, 0);
});

test('incomplete worker capabilities still invoke the pinned termination method without invoking getters', async () => {
	const worker = new TransportWorker(); let reads = 0;
	Object.defineProperty(worker, 'postMessage', { get() { reads++; throw new Error('Accessor is not callable authority.'); } });
	const outcome = await observed(withDecodedRawFrameV1({ bytes: Uint8Array.of(1) }, () => assert.fail(), options(worker)));
	assert.ok(!outcome.ok); assert.equal(reads, 0); assert.equal(worker.terminations, 1); assert.equal(worker.retired, true);
});
