/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compilePinnedLibRawModuleV1 } from '../src/common/editor/raw/libraw-runtime-asset-v1.ts';
import { withDecodedRawOriginalV1 } from '../src/common/editor/raw/libraw-runtime-v1.ts';
import { withPhotoOriginalFrameCurrentV1, withPhotoPreviewOriginalFrameCurrentV1 } from '../src/lightscaper/preview/photo-original-frame-current-v1.ts';
import type { PhotoOriginalFramePortsCurrentV1 } from '../src/lightscaper/preview/photo-original-frame-current-v1.ts';
import { createPhotoLibraryDevelopOriginalSessionV1 } from '../src/lightscaper/controller/photo-library-develop-original-session-v1.ts';
import { createPhotoLibraryDevelopOriginalSessionV2 } from '../src/lightscaper/controller/photo-library-develop-original-session-v2.ts';
import { PhotoCatalogRevisionConflictError } from '../src/lightscaper/catalog/repository-types.ts';
import { PhotoPreviewSchedulerCurrentV1 } from '../src/lightscaper/preview/photo-preview-scheduler-current-v1.ts';
import { normalizePhotoPreviewPlanV1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import type { PreparedPhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-preparation-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { createPhotoLibraryDevelopOriginalSessionCurrentV1 } from '../src/lightscaper/controller/photo-library-develop-original-session-current-v1.ts';
import type { PhotoLibraryDevelopOriginalSessionHostCurrentV1 } from '../src/lightscaper/controller/photo-library-develop-original-session-current-v1.ts';
import { queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { rawDngFixtureV1 } from './helpers/lightscaper-raw-dng-current-fixture.ts';
import { rawWorkerFixtureV1 } from './helpers/lightscaper-raw-worker-current-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';

const WASM = new URL('../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url);
let modulePromise: Promise<WebAssembly.Module> | undefined;
function moduleBytes() {
	modulePromise ??= readFile(WASM).then(bytes => compilePinnedLibRawModuleV1(new Uint8Array(bytes))); return modulePromise;
}
function observed<Value>(work: Promise<Value>) {
	return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}
function retainedRaw(orientation: 1 | 3 | 6 | 8 = 1) {
	const bytes = rawDngFixtureV1(orientation).bytes, template = queryPhotoV1();
	const photo = normalizePhotoDocumentCurrentV1({ ...template, schemaVersion: 3,
		original: { ...template.original, mimeType: 'image/x-adobe-dng', width: 32, height: 32,
			byteLength: bytes.length, contentSha256: createHash('sha256').update(bytes).digest('hex') } });
	return { bytes, photo, body: new Blob([bytes], { type: 'image/x-adobe-dng' }) };
}
function binding(f: ReturnType<typeof retainedRaw>) {
	const original = f.photo.original;
	return { catalogId: f.photo.catalogId, photoId: f.photo.id, originalId: original.id, storageKey: original.storageKey,
		contentSha256: original.contentSha256, byteLength: original.byteLength, width: original.width, height: original.height };
}
async function nativePorts() {
	const workers = await rawWorkerFixtureV1(), calls = { raw: 0 }, captured: ArrayBuffer[] = [];
	const ports: PhotoOriginalFramePortsCurrentV1 = {
		withRawFrame(value, consume) {
			assert.equal(this, ports); calls.raw++;
			return withDecodedRawOriginalV1(value, view => {
				assert.equal(workers.active(), 0); assert.equal(workers.statistics.joined, calls.raw);
				captured.push(view.frame.pixels.buffer); return consume(view);
			}, { loadModule: moduleBytes, createWorker: workers.createWorker });
		},
	};
	return { ports, workers, calls, captured, close: workers.close };
}
function sessionFixture(f: ReturnType<typeof retainedRaw>, ports: PhotoOriginalFramePortsCurrentV1) {
	let photo = f.photo;
	const lifetime = new AbortController(), pending = new Set<Promise<unknown>>(), calls = { bodies: 0, reads: 0, ready: 0 };
	const hooks = { ready: async (): Promise<void> => undefined, body: async (): Promise<void> => undefined };
	const repository = { async loadPhoto(catalogId: string, photoId: string) {
		assert.equal(this, repository); assert.equal(catalogId, f.photo.catalogId); assert.equal(photoId, f.photo.id); calls.reads++; return photo;
	} };
	const host: PhotoLibraryDevelopOriginalSessionHostCurrentV1 = {
		repository, async ready() { assert.equal(this, host); calls.ready++; await hooks.ready(); return f.photo.catalogId; },
		async operation(run, signal) {
			assert.equal(this, host); const admitted = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
			admitted.throwIfAborted(); const work = run(admitted); pending.add(work);
			try { return await work; } finally { pending.delete(work); }
		},
		async loadOriginal(original) { assert.equal(this, host); assert.deepEqual(original, photo.original); calls.bodies++; await hooks.body(); return f.body; },
		withFrame(value, consume) { assert.equal(this, host); return withPhotoOriginalFrameCurrentV1(value, consume, ports); },
	};
	return { host, hooks, calls, pending, request: { schemaVersion: 1 as const, photoId: photo.id, expectedRevision: photo.revision },
		port: createPhotoLibraryDevelopOriginalSessionCurrentV1(host), replace(next: typeof photo) { photo = next; },
		async close(reason: unknown) { lifetime.abort(reason); await Promise.allSettled([...pending]); } };
}

test('Current OriginalSession lends native linear word pixels from its genuine retained Current3 DNG Original', async () => {
	const f = retainedRaw(), native = await nativePorts(), session = sessionFixture(f, native.ports);
	try {
		const result = await session.port.withFrame(session.request, view => {
			assert.equal(view.frame.descriptor.sampleFormat, 'unorm16'); assert.equal(view.frame.descriptor.transfer, 'linear');
			assert.ok(view.frame.pixels instanceof Uint16Array); assert.equal(view.frame.pixels.length, 32 * 32 * 4);
			const low = view.frame.pixels[(8 * 32 + 8) * 4]!, high = view.frame.pixels[(8 * 32 + 24) * 4]!;
			assert.ok(high > low); assert.equal(Math.floor(high / 257), Math.floor(low / 257)); return 'native-original';
		});
		assert.equal(result, 'native-original'); assert.equal(session.calls.bodies, 1); assert.equal(session.calls.reads, 4);
		assert.equal(native.calls.raw, 1); assert.ok(new Uint8Array(native.captured[0]!).every(byte => byte === 0));
		assert.deepEqual(new Uint8Array(await f.body.arrayBuffer()), f.bytes);
	} finally { await native.close(); }
});

test('Current Original default factory selects the actual RAW owner using only modeled worker transport and pinned runtime fetch', async () => {
	const f = retainedRaw(), native = await nativePorts(), session = sessionFixture(f, native.ports);
	const previousWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker'), previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
	const restore = (key: 'Worker' | 'fetch', descriptor: PropertyDescriptor | undefined) => {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
	};
	Object.defineProperty(globalThis, 'Worker', { configurable: true, value: function () { return native.workers.createWorker(); } });
	Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: unknown) => {
		assert.equal(typeof url, 'string'); assert.ok((url as string).endsWith('/runtime/libraw/0.22.2/libraw.wasm'));
		return new Response(new Uint8Array(await readFile(WASM)), { headers: { 'Content-Type': 'application/wasm' } });
	} });
	try {
		const reader = createPhotoLibraryDevelopOriginalSessionCurrentV1({ repository: session.host.repository,
				ready: async () => f.photo.catalogId, operation: async (run, signal) => run(signal ?? new AbortController().signal), loadOriginal: async () => f.body });
		await reader.withFrame(session.request, view => { assert.equal(view.frame.descriptor.sampleFormat, 'unorm16'); });
		assert.equal(native.calls.raw, 0); assert.equal(native.workers.statistics.joined, 1);
	} finally { restore('Worker', previousWorker); restore('fetch', previousFetch); await native.close(); }
});

test('Actual native Original metadata and physical orientation stay correlated for all four owned DNG rotations', async () => {
	const native = await nativePorts();
	try {
		for (const [orientation, flip] of [[1, 0], [3, 3], [6, 6], [8, 5]] as const) {
			const f = retainedRaw(orientation);
			await withPhotoOriginalFrameCurrentV1({ binding: binding(f), body: f.body }, async (frame, provenance) => {
				assert.deepEqual(provenance, { orientation, runtimeVersion: 'libraw-0.22.2' });
				assert.equal(frame.descriptor.sampleFormat, 'unorm16');
			}, { withRawFrame: (value, consume) => withDecodedRawOriginalV1(value, view => {
				assert.equal(view.rawFlip, flip); return consume(view);
			}, { loadModule: moduleBytes, createWorker: native.workers.createWorker }) });
		}
		assert.equal(native.workers.statistics.joined, 4);
	} finally { await native.close(); }
});

test('Current Original authenticates body length and whole SHA before admitting native RAW work', async () => {
	const f = retainedRaw(), native = await nativePorts();
	try {
		for (const source of [{ ...binding(f), byteLength: f.bytes.length + 1 }, { ...binding(f), contentSha256: 'b'.repeat(64) }]) {
			await assert.rejects(withPhotoOriginalFrameCurrentV1({ binding: source, body: f.body }, async () => undefined, native.ports), /length|SHA/u);
		}
		await assert.rejects(withPhotoOriginalFrameCurrentV1({ binding: { ...binding(f), width: 8192, height: 4096 }, body: f.body }, async () => undefined, native.ports), RangeError);
		assert.equal(native.calls.raw, 0); assert.equal(native.workers.statistics.created, 0);
	} finally { await native.close(); }
});

test('Current Original and disposable preview refuse noncallable consumers before any native worker acquisition', async () => {
	const f = retainedRaw(), native = await nativePorts();
	const invalid = undefined as unknown as Parameters<typeof withPhotoOriginalFrameCurrentV1>[1];
	try {
		await assert.rejects(withPhotoOriginalFrameCurrentV1({ binding: binding(f), body: f.body }, invalid, native.ports), TypeError);
		await assert.rejects(withPhotoPreviewOriginalFrameCurrentV1({ binding: binding(f), body: f.body }, invalid, native.ports), TypeError);
		assert.equal(native.calls.raw, 0); assert.equal(native.workers.statistics.created, 0);
	} finally { await native.close(); }
});

test('Current Original rejects a real native decoded geometry mismatch before delivery and retires its entire physical plane', async () => {
	const f = retainedRaw(), native = await nativePorts(); let consumed = false;
	try {
		await assert.rejects(withPhotoOriginalFrameCurrentV1({ binding: { ...binding(f), width: 31 }, body: f.body }, async () => { consumed = true; }, native.ports), /geometry/u);
		assert.equal(consumed, false); assert.equal(native.calls.raw, 1); assert.ok(new Uint8Array(native.captured[0]!).every(byte => byte === 0));
		assert.deepEqual(new Uint8Array(await f.body.arrayBuffer()), f.bytes);
	} finally { await native.close(); }
});

test('Current Original consumer cancellation and borrowed Session close join held native word consumption with exact opaque reasons', async () => {
	for (const close of [false, true]) {
		const f = retainedRaw(), native = await nativePorts(), session = sessionFixture(f, native.ports), stop = new AbortController();
		const entered = deferred<ArrayBuffer>(), release = deferred<void>(), opaque = Proxy.revocable({}, {}); opaque.revoke();
		const task = session.port.withFrame(session.request, async view => { entered.resolve(view.frame.pixels.buffer); await release.promise; return 'late'; }, { signal: stop.signal });
		const result = observed(task); let settled = false, closing: Promise<void> | undefined;
		void result.then(() => { settled = true; });
		try {
			const backing = await Promise.race([entered.promise, result.then(() => { throw new Error('Actual native Original did not reach held consumption.'); })]);
			assert.equal(native.workers.statistics.joined, 1);
			if (close) closing = session.close(opaque.proxy); else stop.abort(opaque.proxy);
			await Promise.resolve(); assert.equal(settled, false); assert.ok(new Uint8Array(backing).some(byte => byte !== 0));
			release.resolve(); const outcome = await result; assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, opaque.proxy));
			await closing; assert.equal(session.pending.size, 0); assert.ok(new Uint8Array(backing).every(byte => byte === 0));
		} finally { release.resolve(); await result; await closing; await native.close(); }
	}
});

test('Current Original rechecks the retained full Photo revision after a real native consumer and wipes words on refusal', async () => {
	const f = retainedRaw(), native = await nativePorts(), session = sessionFixture(f, native.ports);
	try {
		await assert.rejects(session.port.withFrame(session.request, () => {
			session.replace(normalizePhotoDocumentCurrentV1({ ...f.photo, revision: f.photo.revision + 1 })); return 'stale';
		}), PhotoCatalogRevisionConflictError);
		assert.ok(new Uint8Array(native.captured[0]!).every(byte => byte === 0)); assert.equal(native.workers.active(), 0);
	} finally { await native.close(); }
});

test('Current Original refuses source drift while a retained body read is held before any native initialization', async () => {
	const f = retainedRaw(), native = await nativePorts(), session = sessionFixture(f, native.ports), entered = deferred<void>(), release = deferred<void>();
	session.hooks.body = async () => { entered.resolve(); await release.promise; };
	const result = observed(session.port.withFrame(session.request, () => 'unexpected'));
	try {
		await entered.promise; session.replace(normalizePhotoDocumentCurrentV1({ ...f.photo,
			original: { ...f.photo.original, contentSha256: 'c'.repeat(64) } })); release.resolve();
		const outcome = await result; assert.ok(!outcome.ok); assert.ok(outcome.error instanceof PhotoCatalogRevisionConflictError);
		assert.equal(native.calls.raw, 0); assert.equal(native.workers.statistics.created, 0);
	} finally { release.resolve(); await result; await native.close(); }
});

test('Current Original scalar admission is inert before ready and request identity detaches before initialization yields', async () => {
	const f = retainedRaw(), native = await nativePorts(), session = sessionFixture(f, native.ports); let reads = 0;
	try {
		const request = { ...session.request }, invalid = Object.defineProperty({ ...request }, 'photoId', { get() { reads++; return request.photoId; } });
		await assert.rejects(session.port.withFrame(invalid, () => undefined), TypeError); assert.equal(reads, 0); assert.equal(session.calls.ready, 0);
		const entered = deferred<void>(), release = deferred<void>(); session.hooks.ready = async () => { entered.resolve(); await release.promise; };
		const work = observed(session.port.withFrame(request, view => view.photoId));
		await entered.promise; request.photoId = 'replaced'; request.expectedRevision++;
		Reflect.set(session.host.repository, 'loadPhoto', async () => { throw new Error('Late reader must not replace the captured repository method.'); });
		release.resolve(); const outcome = await work; assert.ok(outcome.ok); assert.equal(outcome.value, f.photo.id);
	} finally { await native.close(); }
});

test('Permanent OriginalSession V1 and V2 still refuse retained Current3 before body IO', async () => {
	const f = retainedRaw(), native = await nativePorts(), session = sessionFixture(f, native.ports);
	const host = { repository: { loadPhoto: async () => queryPhotoV1() }, ready: async () => f.photo.catalogId,
		operation: async <Result>(run: (signal: AbortSignal) => Promise<Result>) => run(new AbortController().signal),
		loadOriginal: async () => { session.calls.bodies++; return f.body; } };
	Reflect.set(host.repository, 'loadPhoto', async () => f.photo);
	try {
		for (const create of [createPhotoLibraryDevelopOriginalSessionV1, createPhotoLibraryDevelopOriginalSessionV2]) {
			await assert.rejects(create(host).withFrame(session.request, () => undefined), RangeError);
		}
		assert.equal(session.calls.bodies, 0); assert.equal(native.calls.raw, 0);
	} finally { await native.close(); }
});

test('Current disposable preview uses actual RAW decoding once, preserves its native Original and stores only encoded cache pixels', async () => {
	const f = retainedRaw(), native = await nativePorts();
	const rows = new Map<string, Readonly<PreparedPhotoPreviewV1>>();
	const scheduler = new PhotoPreviewSchedulerCurrentV1({ catalogId: f.photo.catalogId, loadPhoto: async () => f.photo, loadOriginal: async () => f.body,
		regenerate: (value, consume) => withPhotoPreviewOriginalFrameCurrentV1(value, consume, native.ports),
		cache: { load: async plan => rows.get(normalizePhotoPreviewPlanV1(plan).key) ?? null, store: async value => {
			const preview = value as Readonly<PreparedPhotoPreviewV1>; assert.ok(preview.body instanceof Blob);
			rows.set(preview.key, preview); return { outcome: 'stored' as const };
		}, trim: async () => ({ removedEntries: 0, removedBytes: 0, more: false }) } });
	try {
		const request = { photoId: f.photo.id, tier: 'thumbnail' }, first = await scheduler.request(request), second = await scheduler.request(request);
		assert.ok(first.outcome === 'ready' && second.outcome === 'ready');
		assert.equal(first.preview.descriptor.sampleFormat, 'unorm8'); assert.equal(first.preview.descriptor.transfer, 'srgb');
		assert.equal(first.preview.byteLength, 32 * 32 * 4); assert.equal(first.preview.body.size, first.preview.byteLength);
		assert.equal(second.cache, 'hit'); assert.equal(native.calls.raw, 1); assert.deepEqual(new Uint8Array(await f.body.arrayBuffer()), f.bytes);
	} finally { await scheduler.close(); await native.close(); }
});

test('Current raster delegation retains the old encoded V1 decoder and provenance without acquiring a RAW worker', async () => {
	// Only this static raster decoder is modeled. RAW cases above execute the
	// actual production worker and pinned native WASM decoder.
	const bytes = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
	const f = retainedRaw(), events: string[] = [], source = { ...binding(f), width: 1, height: 1,
		contentSha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length };
	let backing: ArrayBuffer | undefined;
	const result = await withPhotoOriginalFrameCurrentV1({ binding: source, body: new Blob([bytes]) }, async (frame, provenance) => {
		assert.deepEqual(provenance, { orientation: 1, runtimeVersion: 'explicit-raster-seam' });
		assert.deepEqual([...frame.pixels], [7, 19, 233, 255]); assert.deepEqual(events, ['open', 'close']); backing = frame.pixels.buffer; return 'raster';
	}, { withRawFrame: async () => { throw new Error('A raster must not enter LibRaw.'); }, openImage: async () => {
		events.push('open'); return { metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'explicit-raster-seam' },
			decodeFrame: async () => ({ rgba: Uint8Array.of(7, 19, 233, 255), durationMicroseconds: null }), close() { events.push('close'); } };
	} });
	assert.equal(result, 'raster'); assert.ok(backing); assert.ok(new Uint8Array(backing).every(byte => byte === 0));
});
