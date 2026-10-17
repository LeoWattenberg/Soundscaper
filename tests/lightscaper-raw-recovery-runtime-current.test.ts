/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withDecodedRawRecoveryFrameV2, type LibRawWorkerPortV2,
	type LibRawRuntimeOptionsV2, type RawRecoveryProfileV2 } from '../src/common/editor/raw/libraw-runtime-v2.ts';

// These explicit transport doubles qualify lifecycle and boundary admission.
// Actual Float32 reconstruction is proved separately with the pinned native
// artifact and the production worker, not by these modeled response pixels.
const MODULE = new WebAssembly.Module(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0));
const PROFILE: RawRecoveryProfileV2 = 'highlight-recovery-v1';
type EventName = 'message' | 'error' | 'messageerror';
type Listener = (event: Readonly<{ data?: unknown }>) => void;
function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>(yes => { resolve = yes; }); return { promise, resolve };
}
function observed<Result>(promise: Promise<Result>) {
	return promise.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}
class TransportWorker implements LibRawWorkerPortV2 {
	readonly listeners = new Map<EventName, Set<Listener>>();
	readonly posted = deferred<void>();
	readonly retiring = deferred<void>();
	readonly retirement = deferred<void>();
	input: Uint8Array | undefined;
	request: unknown;
	retired = false;
	terminations = 0;
	constructor(held = false) { if (!held) this.retirement.resolve(); }
	addEventListener(type: EventName, listener: Listener): void {
		const group = this.listeners.get(type) ?? new Set<Listener>(); group.add(listener); this.listeners.set(type, group);
	}
	removeEventListener(type: EventName, listener: Listener): void { this.listeners.get(type)?.delete(listener); }
	postMessage(message: unknown, transfer: Transferable[]): void {
		const delivered: unknown = structuredClone(message, { transfer }); this.request = delivered;
		assert.ok(typeof delivered === 'object' && delivered !== null);
		const bytes: unknown = Object.getOwnPropertyDescriptor(delivered, 'bytes')?.value;
		assert.ok(bytes instanceof Uint8Array); this.input = bytes; this.posted.resolve();
	}
	async terminate(): Promise<void> {
		this.terminations++; this.retiring.resolve(); await this.retirement.promise; this.input?.fill(0); this.retired = true;
	}
	reply(value: unknown): void { for (const listener of this.listeners.get('message') ?? []) listener({ data: value }); }
}
function options(worker: TransportWorker): Readonly<LibRawRuntimeOptionsV2> {
	return { loadModule: async () => MODULE, createWorker: () => worker };
}
function response(profile: RawRecoveryProfileV2 = PROFILE) {
	const pixels = new Float32Array(16 * 16 * 4);
	for (let index = 0; index < pixels.length; index += 4) pixels.set([-0.25, 1.5, 2 ** -25, 1], index);
	return { schemaVersion: 2, kind: 'recovery', profile, rawFlip: 6, exposureScale: 2,
		frame: { descriptor: { schemaVersion: 1, width: 16, height: 16, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }, pixels } };
}

test('ABI2 captures source, required profile and exact receivers before loading; native exit precedes the held Float32 borrower', async () => {
	const worker = new TransportWorker(true), loading = deferred<WebAssembly.Module>(), entered = deferred<void>(), release = deferred<void>();
	const bytes = Uint8Array.of(1, 2, 3, 4), output = response();
	const request: { bytes: Uint8Array; profile: RawRecoveryProfileV2 } = { bytes, profile: PROFILE }; let consumed = false;
	const config = {
		loadModule(): Promise<WebAssembly.Module> { assert.equal(this, config); return loading.promise; },
		createWorker(): TransportWorker { assert.equal(this, config); return worker; },
	};
	const work = observed(withDecodedRawRecoveryFrameV2(request, async view => {
		assert.equal(worker.retired, true); assert.deepEqual(Object.keys(view).sort(), ['exposureScale', 'frame', 'profile', 'rawFlip']);
		assert.equal(view.profile, PROFILE); assert.equal(view.rawFlip, 6); assert.equal(view.exposureScale, 2);
		assert.deepEqual([...view.frame.pixels.slice(0, 4)], [-0.25, 1.5, 2 ** -25, 1], 'Native normalization is already applied; exposureScale is descriptive.');
		consumed = true; entered.resolve(); await release.promise; return [...view.frame.pixels.slice(0, 4)];
	}, config));
	try {
		bytes.fill(9); request.profile = 'linear-headroom-v1'; config.createWorker = () => { throw new Error('Late factory replacement.'); };
		loading.resolve(MODULE); await worker.posted.promise; assert.deepEqual([...worker.input!], [1, 2, 3, 4]);
		assert.equal(Object.getOwnPropertyDescriptor(worker.request, 'profile')?.value, PROFILE);
		worker.terminate = async () => { throw new Error('Late retirement replacement.'); };
		worker.reply(output); await worker.retiring.promise; assert.equal(consumed, false);
		assert.equal(output.frame.pixels[1], 1.5); worker.retirement.resolve(); await entered.promise;
		release.resolve(); const result = await work; assert.ok(result.ok); assert.deepEqual(result.value, [-0.25, 1.5, 2 ** -25, 1]);
		assert.ok(output.frame.pixels.every(value => value === 0)); assert.deepEqual([...bytes], [9, 9, 9, 9]); assert.equal(worker.terminations, 1);
	} finally { loading.resolve(MODULE); worker.retirement.resolve(); release.resolve(); await work; }
});

test('both fixed profiles roundtrip distinctly without a default or normalization change', async () => {
	for (const profile of ['linear-headroom-v1', 'highlight-recovery-v1'] as const) {
		const worker = new TransportWorker(), output = response(profile);
		const work = withDecodedRawRecoveryFrameV2({ bytes: Uint8Array.of(1), profile }, view => {
			assert.equal(worker.retired, true); assert.equal(view.profile, profile); assert.equal(view.frame.descriptor.sampleFormat, 'float32');
			assert.equal(view.frame.descriptor.primaries, 'srgb'); assert.equal(view.frame.descriptor.transfer, 'linear'); return view.frame.pixels[1];
		}, options(worker));
		await worker.posted.promise; worker.reply(output); assert.equal(await work, 1.5); assert.ok(output.frame.pixels.every(value => value === 0));
	}
});

test('response metadata and its exact physical plane are captured before held worker retirement', async () => {
	const worker = new TransportWorker(true), output = response(), original = output.frame.pixels;
	const replacement = response().frame.pixels; replacement[0] = 0.75;
	let borrowed: Float32Array | undefined;
	const work = withDecodedRawRecoveryFrameV2({ bytes: Uint8Array.of(1), profile: PROFILE }, view => {
		borrowed = view.frame.pixels;
		return { samples: [...view.frame.pixels.slice(0, 4)], rawFlip: view.rawFlip, exposureScale: view.exposureScale };
	}, options(worker));
	try {
		await worker.posted.promise; worker.reply(output); await worker.retiring.promise;
		output.frame.pixels = replacement; output.rawFlip = 2; output.exposureScale = 4;
		worker.retirement.resolve(); const result = await work;
		assert.equal(borrowed, original, 'The delivered plane must be the same physical backing captured for retirement.');
		assert.deepEqual(result, { samples: [-0.25, 1.5, 2 ** -25, 1], rawFlip: 6, exposureScale: 2 });
		assert.ok(new Uint8Array(original.buffer).every(byte => byte === 0));
		assert.equal(replacement[0], 0.75, 'A later transport-owned replacement never enters the borrower scope.');
	} finally { worker.retirement.resolve(); await work; }
});

test('captured pixels are revalidated after held retirement before they can enter the borrower', async () => {
	const changes: ReadonlyArray<(pixels: Float32Array<ArrayBuffer>) => ArrayBuffer | undefined> = [
		pixels => { pixels[0] = Infinity; return undefined; },
		pixels => { pixels[3] = 0.5; return undefined; },
		pixels => structuredClone(pixels.buffer, { transfer: [pixels.buffer] }),
	];
	for (const change of changes) {
		const worker = new TransportWorker(true), output = response(); let consumed = false, moved: ArrayBuffer | undefined;
		const work: ReturnType<typeof observed<void>> = observed(withDecodedRawRecoveryFrameV2({ bytes: Uint8Array.of(1), profile: PROFILE }, () => { consumed = true; }, options(worker)));
		try {
			await worker.posted.promise; worker.reply(output); await worker.retiring.promise;
			moved = change(output.frame.pixels); worker.retirement.resolve(); const result = await work;
			assert.ok(!result.ok); assert.equal(consumed, false); assert.equal(worker.retired, true);
			if (moved) assert.ok(result.error instanceof AggregateError, 'Detachment also reports the independent retirement failure.');
			else assert.ok(new Uint8Array(output.frame.pixels.buffer).every(byte => byte === 0));
		} finally { worker.retirement.resolve(); await work; if (moved) new Uint8Array(moved).fill(0); }
	}
});

test('preabort and closed profile/capability errors refuse before loader, worker or byte accessor acquisition', async () => {
	let loads = 0, workers = 0, reads = 0;
	const config = { loadModule: async () => { loads++; return MODULE; }, createWorker: () => { workers++; return new TransportWorker(); } };
	const stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); stop.abort(opaque.proxy);
	const cancelled = await observed(withDecodedRawRecoveryFrameV2({ bytes: Uint8Array.of(1), profile: PROFILE, signal: stop.signal }, () => undefined, config));
	assert.ok(!cancelled.ok); assert.ok(Object.is(cancelled.error, opaque.proxy));
	const getter = Object.defineProperty({ profile: PROFILE }, 'bytes', { enumerable: true, get() { reads++; return Uint8Array.of(1); } });
	for (const request of [getter, { bytes: Uint8Array.of(1) }, { bytes: Uint8Array.of(1), profile: 3 },
		{ bytes: Uint8Array.of(1), profile: 'highlight-recovery-v2' }, { bytes: Uint8Array.of(1), profile: PROFILE, highlight: 3 }]) {
		assert.ok(!(await observed(withDecodedRawRecoveryFrameV2(request, () => undefined, config))).ok);
	}
	const notCallable = undefined as unknown as () => void;
	assert.ok(!(await observed(withDecodedRawRecoveryFrameV2({ bytes: Uint8Array.of(1), profile: PROFILE }, notCallable, config))).ok);
	assert.equal(loads, 0); assert.equal(workers, 0); assert.equal(reads, 0);
});

test('source admission charges full intrinsic backing before its private snapshot, including small padded views', async () => {
	let loads = 0, workers = 0;
	const config = { loadModule: async () => { loads++; return MODULE; }, createWorker: () => { workers++; return new TransportWorker(); } };
	const oversized = new ArrayBuffer(64 * 1024 * 1024 + 1), smallView = new Uint8Array(oversized, oversized.byteLength - 1, 1); smallView[0] = 73;
	const shared = new Uint8Array(new SharedArrayBuffer(4));
	const resizable = new Uint8Array(Reflect.construct(ArrayBuffer, [4, { maxByteLength: 8 }]) as ArrayBuffer);
	const shadowed = Uint8Array.of(1); Object.defineProperty(shadowed, 'byteLength', { value: 1 });
	const detached = Uint8Array.of(1); structuredClone(detached.buffer, { transfer: [detached.buffer] });
	for (const bytes of [smallView, shared, resizable, shadowed, detached, new Uint8Array(), Uint16Array.of(1)]) {
		assert.ok(!(await observed(withDecodedRawRecoveryFrameV2({ bytes, profile: PROFILE }, () => undefined, config))).ok);
	}
	assert.equal(smallView[0], 73); assert.equal(loads, 0); assert.equal(workers, 0);
});

test('pending recovery cancellation joins retirement and wipes a late physically transferred Float32 plane', async () => {
	const worker = new TransportWorker(true), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	const original = response(), transferred = structuredClone(original, { transfer: [original.frame.pixels.buffer] }); let consumed = false, settled = false;
	const work = observed(withDecodedRawRecoveryFrameV2({ bytes: Uint8Array.of(1), profile: PROFILE, signal: stop.signal }, () => { consumed = true; }, options(worker)));
	void work.then(() => { settled = true; });
	try {
		await worker.posted.promise; stop.abort(opaque.proxy); await worker.retiring.promise;
		assert.equal(settled, false); assert.equal(original.frame.pixels.byteLength, 0); worker.reply(transferred);
		worker.retirement.resolve(); const result = await work; assert.ok(!result.ok); assert.ok(Object.is(result.error, opaque.proxy));
		assert.equal(consumed, false); assert.equal(worker.retired, true); assert.ok(transferred.frame.pixels.every(value => value === 0));
	} finally { worker.retirement.resolve(); await work; transferred.frame.pixels.fill(0); }
});

test('held consumer abort waits for borrowed pixels and wipes the physical backing despite later view shadows', async () => {
	const worker = new TransportWorker(), stop = new AbortController(), release = deferred<void>(), entered = deferred<void>();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const output = response(), backing = output.frame.pixels.buffer;
	let settled = false;
	const work = observed(withDecodedRawRecoveryFrameV2({ bytes: Uint8Array.of(1), profile: PROFILE, signal: stop.signal }, async view => {
		Object.defineProperty(view.frame.pixels, 'buffer', { value: new ArrayBuffer(0) }); entered.resolve(); await release.promise;
	}, options(worker))); void work.then(() => { settled = true; });
	try {
		await worker.posted.promise; worker.reply(output); await entered.promise; stop.abort(opaque.proxy);
		assert.equal(settled, false); assert.equal(new Float32Array(backing)[1], 1.5); release.resolve(); const result = await work;
		assert.ok(!result.ok); assert.ok(Object.is(result.error, opaque.proxy)); assert.ok(new Float32Array(backing).every(value => value === 0));
	} finally { release.resolve(); await work; }
});

test('an opaque consumer failure remains exact after successful Float32 physical retirement', async () => {
	const worker = new TransportWorker(), opaque = Proxy.revocable({}, {}); opaque.revoke(); const output = response();
	const work = observed(withDecodedRawRecoveryFrameV2({ bytes: Uint8Array.of(1), profile: PROFILE }, () => { throw opaque.proxy; }, options(worker)));
	await worker.posted.promise; worker.reply(output); const result = await work;
	assert.ok(!result.ok); assert.ok(Object.is(result.error, opaque.proxy)); assert.ok(output.frame.pixels.every(value => value === 0));
});

test('detached output and opaque consumer failure retain both distinct outcomes', async () => {
	const worker = new TransportWorker(), opaque = Proxy.revocable({}, {}); opaque.revoke(); const output = response();
	const work = observed(withDecodedRawRecoveryFrameV2({ bytes: Uint8Array.of(1), profile: PROFILE }, view => {
		structuredClone(view.frame.pixels.buffer, { transfer: [view.frame.pixels.buffer] }); throw opaque.proxy;
	}, options(worker)));
	await worker.posted.promise; worker.reply(output); const result = await work;
	assert.ok(!result.ok); assert.ok(result.error instanceof AggregateError); assert.ok(Object.is(result.error.cause, opaque.proxy));
	assert.ok(result.error.errors.some((error: unknown) => Object.is(error, opaque.proxy)));
	assert.ok(result.error.errors.some((error: unknown) => !Object.is(error, opaque.proxy) && error instanceof TypeError));
});

test('abort and independent worker cleanup errors remain separate without coercing either opaque value', async () => {
	const worker = new TransportWorker(), stop = new AbortController(), primary = Proxy.revocable({}, {}), cleanup = Proxy.revocable({}, {});
	primary.revoke(); cleanup.revoke(); worker.terminate = async () => { worker.terminations++; throw cleanup.proxy; };
	const work = observed(withDecodedRawRecoveryFrameV2({ bytes: Uint8Array.of(1), profile: PROFILE, signal: stop.signal }, () => assert.fail(), options(worker)));
	await worker.posted.promise; stop.abort(primary.proxy); const result = await work;
	assert.ok(!result.ok); assert.ok(result.error instanceof AggregateError); assert.ok(Object.is(result.error.cause, primary.proxy));
	assert.ok(result.error.errors.some((error: unknown) => Object.is(error, primary.proxy)));
	assert.ok(result.error.errors.some((error: unknown) => Object.is(error, cleanup.proxy))); worker.input?.fill(0);
});

test('malformed, ABI1 and mismatched-profile responses never publish and still wipe their complete transferred storage', async () => {
	const defects: ReadonlyArray<(value: ReturnType<typeof response>) => unknown> = [
		value => Object.assign(value, { future: true }), value => Object.assign(value, { schemaVersion: 1 }),
		value => Object.assign(value, { profile: 'linear-headroom-v1' }), value => Object.assign(value, { rawFlip: 8 }),
		value => Object.assign(value, { exposureScale: 0 }), value => Object.assign(value, { exposureScale: 65_537 }),
		value => Object.assign(value, { exposureScale: NaN }), value => { value.frame.pixels[0] = Infinity; return value; },
		value => { value.frame.pixels[3] = 0.5; return value; },
		value => { Object.assign(value.frame.descriptor, { transfer: 'srgb' }); return value; },
		value => { Object.assign(value.frame.descriptor, { width: 17 }); return value; },
		value => { value.frame.pixels.fill(0); Object.assign(value.frame, { pixels: new Uint16Array(16 * 16 * 4).fill(65_535) }); return value; },
		value => {
			const padding = new Float32Array(value.frame.pixels.length + 2).fill(9); padding.set(value.frame.pixels, 1); value.frame.pixels.fill(0);
			value.frame.pixels = new Float32Array(padding.buffer, 4, padding.length - 2); return value;
		},
	];
	for (const corrupt of defects) {
		const worker = new TransportWorker(), output = response(), message = corrupt(output);
		const backing = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'buffer')!.get!.call(output.frame.pixels) as ArrayBuffer;
		const work: ReturnType<typeof observed<void>> = observed(withDecodedRawRecoveryFrameV2<void>({ bytes: Uint8Array.of(1), profile: PROFILE }, () => assert.fail('Malformed recovery output cannot publish.'), options(worker)));
		await worker.posted.promise; worker.reply(message); const result = await work;
		assert.ok(!result.ok); assert.equal(worker.retired, true); assert.ok(new Uint8Array(backing).every(byte => byte === 0));
	}
});

test('incomplete Worker capability admission still uses pinned terminate without invoking accessors', async () => {
	const worker = new TransportWorker(); let reads = 0;
	Object.defineProperty(worker, 'postMessage', { get() { reads++; throw new Error('Accessor must remain inert.'); } });
	const result = await observed(withDecodedRawRecoveryFrameV2({ bytes: Uint8Array.of(1), profile: PROFILE }, () => assert.fail(), options(worker)));
	assert.ok(!result.ok); assert.equal(reads, 0); assert.equal(worker.retired, true); assert.equal(worker.terminations, 1);
});
