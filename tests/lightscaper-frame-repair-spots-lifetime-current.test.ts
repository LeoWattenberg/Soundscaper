/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../src/common/editor/timeline-image-model.ts';
import { normalizeFramescaperImageSourceCurrentV1 } from '../src/common/editor/timeline-image-model-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { openFramescaperCurrentImageFrameSource, type FramescaperCurrentImageFrameReader } from '../src/framescaper/timeline-image-current-frame-source.ts';
import { ORIGINAL, pngBytes, repairRecipe } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const OPTIONS = { concurrency: false, timeout: 5_000 };
function fixture(schemaVersion: 1 | 2 | 3 = 1, frameCount = 1) {
	const original = pngBytes(ORIGINAL), pixels = Uint8Array.from(ORIGINAL);
	const pack = createFramescaperImageFramePackV1({ original, receipt: { schemaVersion: 1, orientation: 1, decoder: { id: 'browser-native', version: '1' } },
		width: 3, height: 1, timingMode: 'fallback', frames: Array.from({ length: frameCount }, (_, index) => ({ presentationTicks: BigInt(index) * 1_000_000n, durationTicks: 1_000_000n, rgba: pixels })) });
	const base = { schemaVersion: 1 as const, kind: 'image' as const, id: 'native-pack', name: 'Native image', storageKey: 'native-pack', mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
		assetByteLength: pack.assetByteLength, contentSha256: pack.contentSha256, conversionReceiptSha256: pack.conversionReceiptSha256,
		original: { fileName: 'original.png', mimeType: 'image/png', recognizedFormat: 'png', byteLength: original.byteLength, sha256: pack.originalSha256 },
		canonical: { width: 3, height: 1, hasAlpha: false, frameCount, durationTicks: pack.durationTicks, timingMode: 'fallback' } };
	const initial = schemaVersion === 3 ? repairRecipe() : defaultImageDevelopStateV2(), develop = { ...initial, geometry: { ...initial.geometry, flipHorizontal: true } };
	const source = normalizeFramescaperImageSourceCurrentV1(schemaVersion === 1 ? base : { ...base, schemaVersion, develop, developed: { width: 3, height: 1 },
		provenance: { schemaVersion: schemaVersion === 3 ? 2 : 1, kind: 'image-develop-handoff',
			original: { exactName: base.original.fileName, sha256: pack.originalSha256, byteLength: original.byteLength },
			developSha256: createHash('sha256').update(JSON.stringify(develop)).digest('hex'), origin: { schemaFamily: 'lightscaper', schemaVersion: schemaVersion === 3 ? 3 : 2,
				catalogId: 'catalog', photoId: 'photo', revision: 0, versionId: 'version', versionKind: 'master', versionName: 'Original', versionCreatedAt: '2026-10-01T00:00:00.000Z' } } });
	const blob = new Blob([new Uint8Array(pack.bytes)]), store = { loadMediaAsset(key: string) { assert.equal(this, store); assert.equal(key, source.storageKey); return Promise.resolve(blob); } };
	return { original, pixels, pack, source, blob, store };
}
function observed<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
async function entered<Value>(gate: Promise<void>, work: ReturnType<typeof observed<Value>>): Promise<void> {
	await Promise.race([gate, work.then(value => { if (!value.ok) throw value.error; assert.fail('Actual native operation did not reach its held boundary.'); })]);
}

// Before the successor exists, this baseline adapter uses the actual selected
// readFrame output at its declared dimensions. A flipped/developed frame must
// fail the raw-original oracle; it grants no canonical or native decode proof.
function canonical<Value>(reader: FramescaperCurrentImageFrameReader, consume: (frame: Readonly<PixelFrameV1>) => Value | Promise<Value>, signal?: AbortSignal): Promise<Value> {
	const descriptor = Object.getOwnPropertyDescriptor(reader, 'withCanonicalFrame');
	if (descriptor && Object.hasOwn(descriptor, 'value')) {
		return Reflect.apply(descriptor.value as (...args: unknown[]) => unknown, reader, [consume, signal]) as Promise<Value>;
	}
	return reader.readFrame(0, signal).then(pixels => consume({ descriptor: { schemaVersion: 1, width: reader.source.canonical.width,
		height: reader.source.canonical.height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: pixels as Uint8Array<ArrayBuffer> }));
}

test('Light Frame Source1 Close seals its actual readFrame and readOriginal frontdoors', OPTIONS, async () => {
	const f = fixture(), reader = await openFramescaperCurrentImageFrameSource(f.store, f.source);
	try { await reader.closeAndJoin();
		await assert.rejects(reader.readFrame(0), /closed/iu); await assert.rejects(reader.readOriginal(), /closed/iu);
	} finally { await reader.closeAndJoin(); }
});

test('Light Frame Source1 Close joins both accepted asynchronous pack frame and Original reads', OPTIONS, async () => {
	const f = fixture(), reader = await openFramescaperCurrentImageFrameSource(f.store, f.source); let frameDone = false, originalDone = false;
	const frame = observed(reader.readFrame(0)), original = observed(reader.readOriginal());
	void frame.then(() => { frameDone = true; }); void original.then(() => { originalDone = true; });
	try { const closing = reader.closeAndJoin(); assert.equal(reader.closeAndJoin(), closing); await closing;
		assert.equal(frameDone, true, 'Close acknowledged while a real accepted frame read was pending.');
		assert.equal(originalDone, true, 'Close acknowledged while a real accepted Original read was pending.');
		const result = await original; if (!result.ok) throw result.error; assert.deepEqual(result.value, f.original);
	} finally { const outcomes = await Promise.all([frame, original]); for (const result of outcomes) if (result.ok) result.value.fill(0); await reader.closeAndJoin(); }
});

for (const version of [2, 3] as const) test(`Light Frame Source${String(version)} lends raw canonical pixels before its saved geometry/repair recipe`, OPTIONS, async () => {
	const f = fixture(version), reader = await openFramescaperCurrentImageFrameSource(f.store, f.source); let backing: ArrayBuffer | undefined;
	try { const result = await canonical(reader, frame => {
		assert.deepEqual(frame.descriptor, { schemaVersion: 1, width: 3, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' });
		backing = frame.pixels.buffer; assert.deepEqual([...frame.pixels], ORIGINAL); return 'canonical';
	}); assert.equal(result, 'canonical'); assert.ok(backing); assert.ok(new Uint8Array(backing).every(byte => byte === 0));
		const original = await reader.readOriginal(); try { assert.deepEqual(original, f.original); } finally { original.fill(0); }
		const developed = await reader.readFrame(0); try { assert.notDeepEqual([...developed], ORIGINAL); } finally { developed.fill(0); }
		assert.deepEqual(new Uint8Array(await f.blob.arrayBuffer()), f.pack.bytes);
	} finally { await reader.closeAndJoin(); }
});

test('Light Source1 late cancelled native body transfer retires returned backing while its immutable Blob stays intact', OPTIONS, async () => {
	const f = fixture(), held = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Symbol('late snapshot cancellation');
	let backing: ArrayBuffer | undefined;
	// Explicit Node body port: forward a genuine Blob intrinsic, then hold its
	// actual returned allocation. This is not a native browser file/decoder claim.
	const body = { size: f.blob.size, slice: f.blob.slice.bind(f.blob), async arrayBuffer() {
		assert.equal(this, body); backing = await Blob.prototype.arrayBuffer.call(f.blob); held.resolve(); await release.promise; return backing;
	} };
	const store = { loadMediaAsset() { assert.equal(this, store); return Promise.resolve(body); } };
	const work = observed(openFramescaperCurrentImageFrameSource(store, f.source, stop.signal));
	try { await entered(held.promise, work); assert.ok(backing); assert.ok(new Uint8Array(backing).some(byte => byte !== 0)); stop.abort(reason);
		assert.equal(await remainsPending(work), true); release.resolve(); const outcome = await work;
		assert.equal(outcome.ok, false); if (!outcome.ok) assert.equal(Object.is(outcome.error, reason), true);
		assert.ok(backing.byteLength === 0 || new Uint8Array(backing).every(byte => byte === 0)); assert.deepEqual(new Uint8Array(await f.blob.arrayBuffer()), f.pack.bytes);
	} finally { release.resolve(); const value = await work; if (value.ok) await value.value.closeAndJoin(); }
});

for (const version of [1, 2, 3] as const) test(`Light Source${String(version)} canonical callback owns its physical backing until joined Close despite opaque borrower failure`, OPTIONS, async () => {
	const f = fixture(version), reader = await openFramescaperCurrentImageFrameSource(f.store, f.source), held = deferred<void>(), release = deferred<void>();
	const revoked = Proxy.revocable({}, {}); revoked.revoke(); let backing: ArrayBuffer | undefined, reflected = 0;
	const work = observed(canonical(reader, async frame => {
		backing = frame.pixels.buffer; held.resolve(); await release.promise;
		for (const key of ['buffer', 'fill', 'length', 'byteLength']) Object.defineProperty(frame.pixels, key, { configurable: true, get() { reflected++; throw new Error('Borrower metadata reflected.'); } });
		throw revoked.proxy;
	})); let closing: Promise<void> | undefined;
	try { await entered(held.promise, work); closing = reader.closeAndJoin(); assert.equal(reader.closeAndJoin(), closing);
		assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing), true); assert.ok(backing); assert.ok(new Uint8Array(backing).some(byte => byte !== 0));
		release.resolve(); const outcome = await work; await closing; assert.equal(outcome.ok, false); if (!outcome.ok) assert.equal(Object.is(outcome.error, revoked.proxy), true);
		assert.equal(reflected, 0); assert.ok(new Uint8Array(backing).every(byte => byte === 0)); assert.deepEqual(new Uint8Array(await f.blob.arrayBuffer()), f.pack.bytes);
	} finally { release.resolve(); await work; await (closing ?? reader.closeAndJoin()); }
});

test('Light canonical borrow links per-borrow cancellation and retires the complete guard backing after callback joins', OPTIONS, async () => {
	const f = fixture(3), reader = await openFramescaperCurrentImageFrameSource(f.store, f.source), held = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const reason = Symbol('canonical borrow cancelled'); let backing: ArrayBuffer | undefined;
	const work = observed(canonical(reader, async frame => { backing = frame.pixels.buffer; held.resolve(); await release.promise; return 'late'; }, stop.signal));
	try { await entered(held.promise, work); stop.abort(reason); assert.equal(await remainsPending(work), true); release.resolve(); const result = await work;
		assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, reason), true); assert.ok(backing); assert.ok(new Uint8Array(backing).every(byte => byte === 0));
	} finally { release.resolve(); await work; await reader.closeAndJoin(); }
});

test('Light canonical borrow refuses animated Source1 before a frame consumer can enter', OPTIONS, async () => {
	const f = fixture(1, 2), reader = await openFramescaperCurrentImageFrameSource(f.store, f.source); let delivered = 0;
	try { await assert.rejects(canonical(reader, () => { delivered++; }), /static|single/iu); assert.equal(delivered, 0); }
	finally { await reader.closeAndJoin(); }
});

for (const fail of [false, true]) test(`Light canonical borrow refuses actual backing transfer after a held ${fail ? 'failed' : 'successful'} consumer`, OPTIONS, async () => {
	const f = fixture(3), reader = await openFramescaperCurrentImageFrameSource(f.store, f.source), held = deferred<void>(), release = deferred<void>();
	const primary = Symbol('borrower transfer failure'); let original: ArrayBuffer | undefined, moved: ArrayBuffer | undefined;
	const work = observed(canonical(reader, async frame => {
		original = frame.pixels.buffer; moved = structuredClone(original, { transfer: [original] }); held.resolve(); await release.promise;
		if (fail) throw primary; return 'transferred';
	})); let closing: Promise<void> | undefined;
	try {
		await entered(held.promise, work); assert.ok(original); assert.equal(original.byteLength, 0); assert.ok(moved);
		assert.deepEqual([...new Uint8Array(moved).subarray(0, ORIGINAL.length)], ORIGINAL);
		closing = reader.closeAndJoin(); assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing), true);
		release.resolve(); const outcome = await work; await closing; assert.equal(outcome.ok, false);
		if (!outcome.ok) {
			if (fail) { assert.ok(outcome.error instanceof AggregateError); assert.equal(Object.is(outcome.error.cause, primary), true);
				assert.equal(outcome.error.errors.some((error: unknown) => Object.is(error, primary)), true);
				assert.equal(outcome.error.errors.some((error: unknown) => error instanceof TypeError && /backing|detach|retire/iu.test(error.message)), true);
			} else { assert.ok(outcome.error instanceof TypeError); assert.match(outcome.error.message, /backing|detach|retire/iu); }
		}
		assert.deepEqual(new Uint8Array(await f.blob.arrayBuffer()), f.pack.bytes);
	} finally {
		release.resolve(); await work; await (closing ?? reader.closeAndJoin());
		// The explicit test borrower owns this illegally moved allocation. Test
		// cleanup cannot claim that the product could retire transferred bytes.
		if (moved) new Uint8Array(moved).fill(0);
	}
});

test('Light explicit canonical authoring refuses normalized Source1 work overflow before loading a snapshot', OPTIONS, async () => {
	const f = fixture(), source = normalizeFramescaperImageSourceCurrentV1({ ...f.source, assetByteLength: 160 * 1024 * 1024,
		canonical: { ...f.source.canonical, width: 4096, height: 4096 } }); let loads = 0;
	// Metadata-only refusal oracle: normalization admits the scalar source, but
	// its oversized native body must never be requested or fabricated here.
	const store = { loadMediaAsset() { loads++; return Promise.resolve(null); } };
	const work = Reflect.apply(openFramescaperCurrentImageFrameSource, undefined, [store, source, undefined, undefined, 'canonical-authoring']) as Promise<FramescaperCurrentImageFrameReader>;
	await assert.rejects(work, /512|working|byte bound/iu); assert.equal(loads, 0);
});
