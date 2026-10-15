/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoLibraryDevelopDerivedOriginalSessionCurrentV1, type PhotoLibraryDevelopDerivedOriginalSessionHostCurrentV1 } from '../src/lightscaper/controller/photo-library-develop-derived-original-session-current-v1.ts';
import { withPhotoOriginalDerivedFrameCurrentV1 } from '../src/lightscaper/preview/photo-original-derived-frame-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { PhotoCatalogRevisionConflictError } from '../src/lightscaper/catalog/repository-types.ts';
import type { RawRecoveryProfileV2 } from '../src/common/editor/raw/libraw-wasm-instance-v2.ts';
import { queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { rawDerivedOriginalFixtureCurrentV1, rawDerivedOriginalNativeCurrentV1 } from './helpers/lightscaper-raw-derived-original-current-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';
import { capturePhotoLibraryDevelopDerivedReadCurrentV1 } from '../src/common/editor/photo-library-develop-original-current-v1.ts';

function observed<Value>(work: Promise<Value>) {
	return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

test('selected derived read capture detaches exact identity and profile without invoking hostile metadata', () => {
	const input = { schemaVersion: 1, photoId: 'photo-raw', expectedRevision: 7, profile: 'highlight-recovery-v1' };
	const captured = capturePhotoLibraryDevelopDerivedReadCurrentV1(input); assert.ok(Object.isFrozen(captured));
	input.photoId = 'replaced'; input.profile = 'linear-headroom-v1'; input.expectedRevision++;
	assert.deepEqual(captured, { schemaVersion: 1, photoId: 'photo-raw', expectedRevision: 7, profile: 'highlight-recovery-v1' });
	let inspected = 0;
	const accessor = Object.defineProperty({ ...captured }, 'profile', { get() { inspected++; return 'linear-headroom-v1'; } });
	for (const value of [accessor, { ...captured, profile: 'future' }, { ...captured, exposureScale: 2 }, { ...captured, expectedRevision: -0 },
		{ ...captured, photoId: 'a'.repeat(129) }, { ...captured, photoId: 'bad id' }, { ...captured, schemaVersion: 2 }]) {
		assert.throws(() => capturePhotoLibraryDevelopDerivedReadCurrentV1(value));
	}
	assert.equal(inspected, 0);
});

async function fixture() {
	const source = rawDerivedOriginalFixtureCurrentV1(6), native = await rawDerivedOriginalNativeCurrentV1(), template = queryPhotoV1();
	const original = { ...template.original, id: source.binding.originalId, storageKey: source.binding.storageKey,
		contentSha256: source.binding.contentSha256, byteLength: source.binding.byteLength, width: source.binding.width,
		height: source.binding.height, mimeType: 'image/x-adobe-dng' };
	let photo = normalizePhotoDocumentCurrentV1({ ...template, schemaVersion: 3, catalogId: source.binding.catalogId, id: source.binding.photoId, original });
	const lifetime = new AbortController(), pending = new Set<Promise<unknown>>(), calls = { ready: 0, reads: 0, bodies: 0, derived: 0 };
	const hooks = { ready: async (): Promise<void> => undefined, body: async (): Promise<void> => undefined };
	const host: PhotoLibraryDevelopDerivedOriginalSessionHostCurrentV1 = {
		repository: { async loadPhoto(catalogId, photoId) { calls.reads++; assert.equal(catalogId, photo.catalogId); assert.equal(photoId, photo.id); return photo; } },
		async ready() { calls.ready++; await hooks.ready(); return source.binding.catalogId; },
		operation(run, signal) {
			const admitted = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
			const work = Promise.resolve().then(() => { admitted.throwIfAborted(); return run(admitted); });
			pending.add(work); void work.then(() => pending.delete(work), () => pending.delete(work)); return work;
		},
		async loadOriginal(value) { calls.bodies++; assert.deepEqual(value, original); await hooks.body(); return source.body; },
		withDerivedFrame(value, consume, dependencies) {
			assert.equal(this, host); calls.derived++;
			return withPhotoOriginalDerivedFrameCurrentV1(value, consume, {
				withRawFrame: (request, accept) => native.ports.withRawFrame!(request, accept),
				withRecoveryFrame: (request, accept) => native.ports.withRecoveryFrame!(request, accept),
				assertCurrent: async () => { await native.ports.assertCurrent!(); await dependencies?.assertCurrent?.(); },
			});
		},
	};
	const port = createPhotoLibraryDevelopDerivedOriginalSessionCurrentV1(host);
	const request = (profile: RawRecoveryProfileV2 = 'highlight-recovery-v1') => ({ schemaVersion: 1 as const, photoId: photo.id, expectedRevision: photo.revision, profile });
	return { source, native, host, calls, hooks, port, request, pending, current: () => photo,
		replace(value: unknown) { photo = normalizePhotoDocumentCurrentV1(value); },
		async close(reason?: unknown) { lifetime.abort(reason); await Promise.allSettled([...pending]); await native.close(); },
	};
}

test('derived Session binds real two-worker RAW output to the selected Photo identity and unchanged Original', async () => {
	for (const profile of ['linear-headroom-v1', 'highlight-recovery-v1'] as const) {
		const f = await fixture(); let backing: ArrayBuffer | undefined;
		try {
			const result = await f.port.withDerivedFrame(f.request(profile), view => {
				assert.deepEqual(Object.keys(view).sort(), ['exposureScale', 'frame', 'photoId', 'profile', 'rawFlip', 'revision']);
				assert.equal(view.photoId, f.current().id); assert.equal(view.revision, f.current().revision);
				assert.equal(view.profile, profile); assert.equal(view.rawFlip, 6); assert.ok(view.exposureScale > 1);
				assert.equal(view.frame.descriptor.width, 96); assert.equal(view.frame.descriptor.height, 128);
				assert.equal(view.frame.descriptor.sampleFormat, 'float32'); assert.equal(f.native.canonical.active(), 0); assert.equal(f.native.recovery.active(), 0);
				backing = view.frame.pixels.buffer; assert.ok(view.frame.pixels.some(value => value > 1)); return profile;
			});
			assert.equal(result, profile); assert.equal(f.calls.bodies, 1); assert.equal(f.calls.derived, 1);
			assert.equal(f.native.canonical.statistics.joined, 1); assert.equal(f.native.recovery.statistics.joined, 1);
			assert.ok(backing); assert.ok(new Uint8Array(backing).every(byte => byte === 0));
			assert.deepEqual(new Uint8Array(await f.source.body.arrayBuffer()), f.source.bytes); assert.equal(f.pending.size, 0);
		} finally { await f.close(); }
	}
});

test('a stale revision after canonical retirement prevents acquiring the recovery worker', async () => {
	const f = await fixture(); let consumed = false;
	f.native.hooks.afterCanonical = async () => { f.replace({ ...f.current(), revision: f.current().revision + 1 }); };
	try {
		await assert.rejects(f.port.withDerivedFrame(f.request(), () => { consumed = true; }), PhotoCatalogRevisionConflictError);
		assert.equal(consumed, false); assert.equal(f.native.canonical.statistics.joined, 1); assert.equal(f.native.recovery.statistics.created, 0);
		assert.ok(f.native.inputs.every(bytes => bytes.every(byte => byte === 0))); assert.equal(f.pending.size, 0);
	} finally { await f.close(); }
});

test('source drift during held Original IO refuses both decoders even when the revision number is unchanged', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	f.hooks.body = async () => { entered.resolve(); await release.promise; };
	const result = observed(f.port.withDerivedFrame(f.request(), () => assert.fail('Stale Original cannot publish.')));
	try {
		await entered.promise; f.replace({ ...f.current(), original: { ...f.current().original, contentSha256: 'c'.repeat(64) } }); release.resolve();
		const outcome = await result; assert.ok(!outcome.ok); assert.ok(outcome.error instanceof PhotoCatalogRevisionConflictError);
		assert.equal(f.native.canonical.statistics.created, 0); assert.equal(f.native.recovery.statistics.created, 0);
	} finally { release.resolve(); await result; await f.close(); }
});

test('derived Session captures request identity, profile and host capabilities before readiness yields', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), request = f.request();
	f.hooks.ready = async () => { entered.resolve(); await release.promise; };
	const work = observed(f.port.withDerivedFrame(request, view => view.profile));
	try {
		await entered.promise; request.photoId = 'replaced'; request.expectedRevision++; request.profile = 'linear-headroom-v1';
		Reflect.set(f.host.repository, 'loadPhoto', async () => { throw new Error('Late reader must remain unused.'); });
		Reflect.set(f.host, 'loadOriginal', async () => { throw new Error('Late Original loader must remain unused.'); });
		Reflect.set(f.host, 'withDerivedFrame', async () => { throw new Error('Late decoder must remain unused.'); });
		release.resolve(); const result = await work; assert.ok(result.ok); assert.equal(result.value, 'highlight-recovery-v1');
		assert.equal(f.calls.bodies, 1); assert.equal(f.calls.derived, 1);
	} finally { release.resolve(); await work; await f.close(); }
});

test('Session Close waits for a held real Float32 borrower and preserves its opaque cancellation reason', async () => {
	const f = await fixture(), entered = deferred<ArrayBuffer>(), release = deferred<void>(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	const work = observed(f.port.withDerivedFrame(f.request(), async view => { entered.resolve(view.frame.pixels.buffer); await release.promise; return 'late'; }));
	let settled = false, closing: Promise<void> | undefined; void work.then(() => { settled = true; });
	try {
		const backing = await Promise.race([entered.promise, work.then(() => { throw new Error('Native derived borrower was not entered.'); })]);
		closing = f.close(opaque.proxy); await Promise.resolve(); assert.equal(settled, false); assert.ok(new Uint8Array(backing).some(byte => byte !== 0));
		release.resolve(); const result = await work; assert.ok(!result.ok); assert.ok(Object.is(result.error, opaque.proxy)); await closing;
		assert.ok(new Uint8Array(backing).every(byte => byte === 0)); assert.equal(f.pending.size, 0);
	} finally { release.resolve(); await work; await closing; await f.close(); }
});

test('revision changes made by a derived borrower refuse successful publication after physical output retirement', async () => {
	const f = await fixture(); let backing: ArrayBuffer | undefined;
	try {
		await assert.rejects(f.port.withDerivedFrame(f.request(), view => { backing = view.frame.pixels.buffer;
			f.replace({ ...f.current(), revision: f.current().revision + 1 }); return 'stale'; }), PhotoCatalogRevisionConflictError);
		assert.ok(backing); assert.ok(new Uint8Array(backing).every(byte => byte === 0)); assert.equal(f.native.recovery.active(), 0);
	} finally { await f.close(); }
});

test('closed derived requests and preabort refuse before readiness, body IO or either decoder', async () => {
	const f = await fixture(); let reads = 0;
	try {
		for (const request of [{ ...f.request(), profile: 'arbitrary' }, { ...f.request(), exposureScale: 2 }, { ...f.request(), schemaVersion: 2 },
			Object.defineProperty({ ...f.request() }, 'photoId', { get() { reads++; return f.source.binding.photoId; } })]) {
			await assert.rejects(f.port.withDerivedFrame(request as ReturnType<typeof f.request>, () => undefined));
		}
		const stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); stop.abort(opaque.proxy);
		const result = await observed(f.port.withDerivedFrame(f.request(), () => undefined, { signal: stop.signal }));
		assert.ok(!result.ok); assert.ok(Object.is(result.error, opaque.proxy));
		assert.equal(reads, 0); assert.equal(f.calls.ready, 0); assert.equal(f.calls.bodies, 0);
		assert.equal(f.native.canonical.statistics.created, 0); assert.equal(f.native.recovery.statistics.created, 0);
	} finally { await f.close(); }
});
