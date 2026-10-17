/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { preparePhotoLibraryRawDevelopmentEditCurrentV1, PhotoLibraryRawDevelopmentAuthoringCurrentV1 } from '../src/common/editor/controller/shared/photo-library-raw-development-authoring-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { withDecodedRawRecoveryFrameV2, type RawRecoveryFrameV2 } from '../src/common/editor/raw/libraw-runtime-v2.ts';
import { compilePinnedLibRawRecoveryModuleV2 } from '../src/common/editor/raw/libraw-runtime-asset-v2.ts';
import type { PhotoLibraryDevelopOriginalPortCurrentV1 } from '../src/common/editor/photo-library-develop-original-current-v1.ts';
import { rawRecoveryWorkerFixtureV2 } from './helpers/lightscaper-raw-recovery-worker-current-fixture.ts';
import { rawRecoveryDngFixtureV1 } from './helpers/lightscaper-raw-recovery-dng-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

let module: WebAssembly.Module;
test.before(async () => {
	const bytes = new Uint8Array(await readFile(new URL('../runtime-assets/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm', import.meta.url)));
	try { module = await compilePinnedLibRawRecoveryModuleV2(bytes); } finally { bytes.fill(0); }
});
function observe<Result>(work: Promise<Result>) {
	return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}
async function nativeOriginal() {
	const workers = await rawRecoveryWorkerFixtureV2(), bytes = rawRecoveryDngFixtureV1().bytes;
	const hooks = { afterConsume: async () => undefined as void }, planes: Float32Array[] = [], requests: unknown[] = [];
	const original: PhotoLibraryDevelopOriginalPortCurrentV1 = {
		async withFrame() { throw new Error('A canonical borrower cannot prove selected derived processing.'); },
		async withDerivedFrame(request, consume, options) {
			assert.equal(this, original); requests.push(request);
			return withDecodedRawRecoveryFrameV2({ bytes, profile: request.profile, ...(options?.signal ? { signal: options.signal } : {}) }, async view => {
				assert.equal(workers.active(), 0); planes.push(view.frame.pixels);
				const result = await consume(Object.freeze({ ...view, photoId: request.photoId, revision: request.expectedRevision }));
				await hooks.afterConsume(); return result;
			}, { loadModule: async () => module, createWorker: workers.createWorker });
		},
	};
	return { original, hooks, planes, requests, workers, close: () => workers.close() };
}

test('canonical RAW mode authoring preserves the existing recipe without inspecting any Original capability', async () => {
	let reflected = 0;
	const original = new Proxy({}, { ownKeys() { reflected++; throw new Error('Original reflected.'); }, getOwnPropertyDescriptor() { reflected++; throw new Error('Original reflected.'); } });
	const develop = defaultImageDevelopStateV2();
	const result = await preparePhotoLibraryRawDevelopmentEditCurrentV1({ photoId: 'photo', revision: 7, develop, mode: 'canonical', original });
	assert.deepEqual(result, develop); assert.equal(reflected, 0);
});

test('noncanonical RAW mode authoring refuses scalar frames without active native processing authority', async () => {
	const develop = defaultImageDevelopStateV2(); let reads = 0;
	const original = { async withFrame() { throw new Error('Canonical must not substitute for recovery.'); },
		async withDerivedFrame(_request: unknown, consume: (value: unknown) => Promise<unknown>) {
			assert.equal(this, original); reads++;
			return consume({ photoId: 'photo', revision: 7, profile: 'highlight-recovery-v1', rawFlip: 0, exposureScale: 2,
				frame: { descriptor: { schemaVersion: 1, width: 16, height: 16, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }, pixels: new Float32Array(16 * 16 * 4) } });
		} };
	await assert.rejects(preparePhotoLibraryRawDevelopmentEditCurrentV1({ photoId: 'photo', revision: 7, develop, mode: 'recovery', original }), /active|native|authority/u);
	assert.equal(reads, 1);
});

for (const mode of ['headroom', 'recovery'] as const) test(`actual native ${mode} authoring captures intent and joins physical retirement before returning scalar state`, async () => {
	const f = await nativeOriginal(), entered = deferred<void>(), release = deferred<void>();
	const develop = structuredClone(defaultImageDevelopStateV2());
	const request = { photoId: 'photo', revision: 7, develop, mode: mode as string, original: f.original };
	f.hooks.afterConsume = async () => { entered.resolve(); await release.promise; };
	const work = preparePhotoLibraryRawDevelopmentEditCurrentV1(request), observed = observe(work);
	try {
		request.mode = 'canonical'; request.photoId = 'replaced'; f.original.withDerivedFrame = async () => { throw new Error('Late method replacement.'); };
		await Promise.race([entered.promise, observed.then(() => { throw new Error('Native proof never entered its held retirement.'); })]);
		assert.equal(await remainsPending(work), true); assert.ok(f.planes[0]?.some(value => value !== 0));
		release.resolve(); const result = await observed; assert.ok(result.ok); assert.equal(result.value.processVersion, 4);
		if (result.value.processVersion !== 4) assert.fail('Explicit native processing did not promote its scalar state.');
		assert.equal(result.value.rawDevelopment.mode, mode); assert.deepEqual(result.value.effects, []);
		assert.deepEqual(f.requests, [{ schemaVersion: 1, photoId: 'photo', expectedRevision: 7,
			profile: mode === 'headroom' ? 'linear-headroom-v1' : 'highlight-recovery-v1' }]);
		assert.ok(f.planes.every(plane => plane.every(value => value === 0))); assert.equal(f.workers.active(), 0);
	} finally { release.resolve(); await observed; await f.close(); }
});

test('actual native proof cancellation keeps exact opaque identity and waits for physical retirement', async () => {
	const f = await nativeOriginal(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); f.hooks.afterConsume = async () => { entered.resolve(); await release.promise; };
	const work = preparePhotoLibraryRawDevelopmentEditCurrentV1({ photoId: 'photo', revision: 7, develop: defaultImageDevelopStateV2(), mode: 'recovery', original: f.original }, { signal: stop.signal });
	const observed = observe(work);
	try {
		await Promise.race([entered.promise, observed.then(() => { throw new Error('Native proof did not reach retirement.'); })]);
		stop.abort(opaque.proxy); assert.equal(await remainsPending(work), true); assert.ok(f.planes[0]?.some(value => value !== 0));
		release.resolve(); const result = await observed; assert.ok(!result.ok); assert.ok(Object.is(result.error, opaque.proxy));
		assert.ok(f.planes.every(plane => plane.every(value => value === 0))); assert.equal(f.workers.active(), 0);
	} finally { release.resolve(); await observed; await f.close(); }
});

test('expired genuine native pixels and absent native delivery cannot authorize a new edit', async () => {
	const f = await nativeOriginal(); let retired: Readonly<RawRecoveryFrameV2> | undefined;
	try {
		await f.original.withDerivedFrame({ schemaVersion: 1, photoId: 'photo', expectedRevision: 7, profile: 'highlight-recovery-v1' }, view => { retired = view; });
		assert.ok(retired); assert.ok(retired.frame.pixels.every(value => value === 0));
		const original = { withFrame: f.original.withFrame, async withDerivedFrame(_request: unknown, consume: (value: unknown) => unknown) {
			return consume({ ...retired, photoId: 'photo', revision: 7 });
		} };
		await assert.rejects(preparePhotoLibraryRawDevelopmentEditCurrentV1({ photoId: 'photo', revision: 7, develop: defaultImageDevelopStateV2(), mode: 'recovery', original }), /active|native/u);
		original.withDerivedFrame = async () => undefined;
		await assert.rejects(preparePhotoLibraryRawDevelopmentEditCurrentV1({ photoId: 'photo', revision: 7, develop: defaultImageDevelopStateV2(), mode: 'recovery', original }), /actual native/u);
	} finally { await f.close(); }
});

test('preabort wins before hostile reflection, while independent native cleanup errors preserve their exact outcome', async () => {
	const stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); stop.abort(opaque.proxy); let traps = 0;
	const hostile = new Proxy({}, { ownKeys() { traps++; throw new Error('Request reflected.'); } });
	const cancelled = await observe(preparePhotoLibraryRawDevelopmentEditCurrentV1(hostile, { signal: stop.signal }));
	assert.ok(!cancelled.ok); assert.ok(Object.is(cancelled.error, opaque.proxy)); assert.equal(traps, 0);
	const cleanup = new Error('Native cleanup failed.'), aggregate = new AggregateError([opaque.proxy, cleanup], 'Both outcomes.', { cause: opaque.proxy });
	const original = { async withDerivedFrame() { throw aggregate; } };
	const failed = await observe(preparePhotoLibraryRawDevelopmentEditCurrentV1({ photoId: 'photo', revision: 7, develop: defaultImageDevelopStateV2(), mode: 'recovery', original }));
	assert.ok(!failed.ok); assert.equal(failed.error, aggregate); assert.equal(aggregate.errors[1], cleanup);
});

test('the scalar controller joins a real cancelled proof, then accepts a new explicit canonical choice', async () => {
	const f = await nativeOriginal(), entered = deferred<void>(), release = deferred<void>();
	f.hooks.afterConsume = async () => { entered.resolve(); await release.promise; };
	const owner = new PhotoLibraryRawDevelopmentAuthoringCurrentV1({ photoId: 'photo', revision: 7, develop: defaultImageDevelopStateV2(), original: f.original });
	try {
		await owner.open(); assert.deepEqual(owner.snapshot().ready, defaultImageDevelopStateV2());
		const proof = owner.choose('recovery'); await entered.promise; const cancelled = owner.cancelAndJoin();
		assert.equal(await remainsPending(cancelled), true); assert.equal(owner.snapshot().ready, null);
		release.resolve(); await cancelled; await proof;
		assert.equal(owner.snapshot().working, false); assert.ok(f.planes.every(plane => plane.every(value => value === 0)));
		await owner.choose('canonical'); assert.deepEqual(owner.snapshot().ready, defaultImageDevelopStateV2());
	} finally { release.resolve(); await owner.close(); await f.close(); }
});

test('the controller has no ready state or native acquisition before its predecessor retirement joins', async () => {
	const before = deferred<void>(); let reflected = 0;
	const original = new Proxy({}, { ownKeys() { reflected++; throw new Error('Canonical Original reflected.'); } });
	const owner = new PhotoLibraryRawDevelopmentAuthoringCurrentV1({ photoId: 'photo', revision: 7, develop: defaultImageDevelopStateV2(), original });
	const opening = owner.open(before.promise);
	try {
		assert.equal(owner.snapshot().ready, null); assert.equal(await remainsPending(opening), true); assert.equal(reflected, 0);
		before.resolve(); await opening; assert.deepEqual(owner.snapshot().ready, defaultImageDevelopStateV2()); assert.equal(reflected, 0);
	} finally { before.resolve(); await owner.close(); }
});
