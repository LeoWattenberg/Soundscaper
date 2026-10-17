/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { metadataCrc32 } from '../src/common/editor/imaging/image-metadata-binary.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { createFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, normalizeFramescaperImageSourceV1 } from '../src/common/editor/timeline-image-model.ts';
import { normalizeFramescaperImageSourceV2, normalizeFramescaperImageSourceV1OrV2 } from '../src/common/editor/timeline-image-model-v2.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { openFramescaperCurrentImageFrameSource } from '../src/framescaper/timeline-image-current-frame-source.ts';
import { createFramescaperMaskRasterSourceTimelineImageV1 } from '../src/framescaper/timeline-image-mask-raster-source-v1.ts';
import { withFramescaperImageDevelopFrameV3 } from '../src/framescaper/timeline-image-develop-frame-v3.ts';
import { withFramescaperImageDevelopFrameV2 } from '../src/framescaper/timeline-image-develop-frame-v2.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred } from './helpers/async-test-control.ts';
import type { FramescaperStoredImageAssetStoreTimelineImage } from '../src/framescaper/editor-selected-timeline-image-image-frame-source.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
function png(width: number, height: number, pixels: Uint8Array) {
	function chunk(name: string, bytes: Uint8Array) {
		const type = Buffer.from(name), value = Buffer.alloc(bytes.length + 12); value.writeUInt32BE(bytes.length);
		type.copy(value, 4); value.set(bytes, 8); value.writeUInt32BE(metadataCrc32(Buffer.concat([type, bytes])), bytes.length + 8); return value;
	}
	const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
	const rows = Buffer.alloc(height * (width * 4 + 1));
	for (let y = 0; y < height; y++) rows.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
	return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', new Uint8Array())]));
}
function fixture(mode: 'clone' | 'heal' = 'clone') {
	const width = 10, height = 5, pixels = new Uint8Array(width * height * 4);
	for (let i = 0; i < pixels.length; i += 4) pixels.set([0, 0, 0, 255], i);
	for (let y = 1; y <= 3; y++) for (let x = 0; x < 4; x++) pixels.set([64, 64, 64, 255], (y * width + x) * 4);
	for (const [x, y] of [[8, 2], [7, 1], [7, 3]] as const) pixels.set([255, 255, 255, 255], (y * width + x) * 4);
	const original = png(width, height, pixels), normalized = replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV2(), { schemaVersion: 1,
		spots: [{ id: 'repair', mode, enabled: true, target: { x: .7, y: .5 }, source: { x: .2, y: .5 }, radius: .15, feather: 0, opacity: 1 }] });
	const develop = { ...normalized, repairs: { schemaVersion: 1 as const, spots: normalized.repairs.spots.map(value => ({ ...value, target: { ...value.target }, source: { ...value.source } })) } };
	// Real PNG and canonical pack bytes; this Node fixture does not claim native browser decoding.
	const pack = createFramescaperImageFramePackV1({ original, receipt: { schemaVersion: 1, orientation: 1, decoder: { id: 'browser-native', version: '1' } },
		width, height, timingMode: 'fallback', frames: [{ presentationTicks: 0n, durationTicks: 1_000_000n, rgba: pixels }] });
	const source = { schemaVersion: 3, kind: 'image', id: 'repair-source', name: 'Repaired photo', storageKey: 'repair-source', mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
		assetByteLength: pack.assetByteLength, contentSha256: pack.contentSha256, conversionReceiptSha256: pack.conversionReceiptSha256,
		original: { fileName: 'repair.png', mimeType: 'image/png', recognizedFormat: 'png', byteLength: original.byteLength, sha256: pack.originalSha256 },
		canonical: { width, height, hasAlpha: false, frameCount: 1, durationTicks: pack.durationTicks, timingMode: 'fallback' }, develop, developed: { width, height },
		provenance: { schemaVersion: 2, kind: 'image-develop-handoff', original: { exactName: 'repair.png', sha256: pack.originalSha256, byteLength: original.byteLength },
			developSha256: createHash('sha256').update(JSON.stringify(develop)).digest('hex'), origin: { schemaFamily: 'lightscaper', schemaVersion: 3,
				catalogId: 'catalog', photoId: 'photo', revision: 7, versionId: 'saved', versionKind: 'master', versionName: 'Saved', versionCreatedAt: '2026-10-01T00:00:00.000Z' } } };
	return { source, pack, original, pixels };
}
for (const mode of ['clone', 'heal'] as const) test(`Light Current Frame ${mode} evaluates the immutable original at natural dimensions`, async t => {
	const f = fixture(mode), before = f.pack.bytes.slice(), indexedDB = createInstrumentedIndexedDB();
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: indexedDB as unknown as IDBFactory, preferOpfs: false });
	t.after(() => store.close()); await store.writeMediaAsset(f.source.storageKey, new Blob([new Uint8Array(f.pack.bytes)]), { kind: 'timeline-image',
		encoding: 'framescaper-image-asset-v1', name: f.source.name, mimeType: f.source.mimeType });
	const reader = await openFramescaperCurrentImageFrameSource(store, f.source); let result: Uint8Array | undefined;
	try {
		assert.deepEqual([reader.source.canonical.width, reader.source.canonical.height], [10, 5]); result = await reader.readFrame(0);
		assert.deepEqual([...result.slice(26 * 4, 28 * 4)], mode === 'clone' ? [64, 64, 64, 255, 64, 64, 64, 255] : [137, 137, 137, 255, 225, 225, 225, 255]);
		const unchanged = result.slice(); unchanged.set(f.pixels.slice(26 * 4, 28 * 4), 26 * 4); assert.deepEqual(unchanged, f.pixels);
		assert.deepEqual(f.pack.bytes, before); assert.deepEqual(new Uint8Array(await (await store.loadMediaAsset(f.source.storageKey))!.arrayBuffer()), before);
	} finally { result?.fill(0); await reader.closeAndJoin(); }
});

test('Light Current Frame source metadata is captured before native reads and a changed pack refuses delivery', async t => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>();
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	const originalLoad = store.loadMediaAsset; let reads = 0;
	await store.writeMediaAsset(f.source.storageKey, new Blob([new Uint8Array(f.pack.bytes)]));
	const port = { async loadMediaAsset(...args: Parameters<typeof store.loadMediaAsset>) {
		assert.equal(this, port); reads++; const body = await Reflect.apply(originalLoad, store, args) as Blob | null;
		entered.resolve(); await release.promise; return body;
	} };
	const work = openFramescaperCurrentImageFrameSource(port, f.source); const outcome = work.then(value => ({ value }), error => ({ error: error as unknown }));
	t.after(async () => { release.resolve(); const settled = await outcome; if ('value' in settled) await settled.value.closeAndJoin(); await store.close(); });
	const admission = await Promise.race([entered.promise.then(() => true), outcome.then(() => false)]); assert.equal(admission, true);
	port.loadMediaAsset = () => { throw Error('Mutable reader used after admission'); }; f.source.develop.repairs.spots[0]!.target.x = .1;
	release.resolve(); const settled = await outcome; if ('error' in settled) throw settled.error;
	const pixels = await settled.value.readFrame(0); try { assert.deepEqual([...pixels.slice(26 * 4, 28 * 4)], [64, 64, 64, 255, 64, 64, 64, 255]); }
	finally { pixels.fill(0); await settled.value.closeAndJoin(); }
	assert.equal(reads, 1);
	const bad = fixture(), bytes = bad.pack.bytes.slice(); bytes[bytes.length - 1]! ^= 1;
	await store.deleteMediaAsset(bad.source.storageKey); await store.writeMediaAsset(bad.source.storageKey, new Blob([bytes]));
	await assert.rejects((async () => { const invalid = await openFramescaperCurrentImageFrameSource(store, bad.source);
		try { await invalid.readFrame(0); } finally { await invalid.closeAndJoin(); } })(), /digest|SHA|binding|frame/iu);
});

test('Light permanently strict Frame Source1/2 APIs refuse independently valid Source3 before a pack read', async () => {
	const f = fixture(); let reads = 0;
	for (const normalize of [normalizeFramescaperImageSourceV1, normalizeFramescaperImageSourceV2, normalizeFramescaperImageSourceV1OrV2]) assert.throws(() => normalize(f.source));
	await assert.rejects(withFramescaperImageDevelopFrameV2({ source: f.source, read() { reads++; return f.pack.bytes; } }, () => undefined)); assert.equal(reads, 0);
});

function maskBody() {
	const bytes = new Uint8Array([83, 67, 77, 65, 83, 75, 48, 49, 1, 0, 0, 0, 1, 0, 0, 0, 64]), sha256 = createHash('sha256').update(bytes).digest('hex');
	return { bytes, reference: { storageKey: `brush-mask-v1:1:1:${sha256}`, sha256, width: 1, height: 1, byteLength: 17 } };
}
test('Light Source3 scoped consumer cancellation joins and ignores hostile output metadata while wiping its real backing', async t => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const revoked = Proxy.revocable({}, {}); revoked.revoke(); let backing: ArrayBuffer | undefined, traps = 0, settled = false;
	const request = { source: f.source, signal: stop.signal, read(offset: number, length: number) { assert.equal(this, request); return f.pack.bytes.slice(offset, offset + length); } };
	const work = withFramescaperImageDevelopFrameV3(request, async view => {
		backing = view.frame.pixels.buffer; entered.resolve(); await release.promise;
		for (const key of ['buffer', 'byteLength', 'length', 'fill']) Object.defineProperty(view.frame.pixels, key, { configurable: true, get() { traps++; throw Error('Borrower metadata reflected'); } });
		throw revoked.proxy;
	});
	const outcome = work.then(value => ({ value }), (error: unknown) => ({ error })); void outcome.then(() => { settled = true; });
	t.after(async () => { release.resolve(); await outcome; });
	assert.equal(await Promise.race([entered.promise.then(() => true), outcome.then(() => false)]), true); stop.abort(revoked.proxy);
	await new Promise<void>(resolve => { setImmediate(resolve); }); assert.equal(settled, false); assert.ok(backing);
	assert.ok(new Uint8Array(backing).some(value => value !== 0)); release.resolve(); const result = await outcome;
	assert.ok('error' in result); assert.ok(Object.is(result.error, revoked.proxy)); assert.equal(traps, 0); assert.ok(new Uint8Array(backing).every(value => value === 0));
});

test('Light immutable Frame brush source pins its native receiver and joins Close before physical body retirement', async t => {
	const body = maskBody(), store = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), opaque = Symbol('native brush cancellation');
	await store.writeMediaAsset(body.reference.storageKey, new Blob([body.bytes])); const actualLoad = store.loadMediaAsset;
	const port = { loadMediaAsset(...args: Parameters<typeof store.loadMediaAsset>) { assert.equal(this, port); return Reflect.apply(actualLoad, store, args) as ReturnType<typeof actualLoad>; } };
	const source = createFramescaperMaskRasterSourceTimelineImageV1(port); port.loadMediaAsset = () => { throw Error('Replaced media reader invoked'); };
	let backing: ArrayBuffer | undefined, reflected = 0, closed = false;
	const work = source.withBytes(body.reference, async bytes => { backing = bytes.buffer; entered.resolve(); await release.promise;
		for (const key of ['buffer', 'fill']) Object.defineProperty(bytes, key, { get() { reflected++; throw Error('Brush cleanup reflected shadow'); } }); return 'borrowed';
	}, { signal: stop.signal }); const outcome = work.then(value => ({ value }), (error: unknown) => ({ error }));
	t.after(async () => { release.resolve(); await outcome; await source.close(); await store.close(); });
	assert.equal(await Promise.race([entered.promise.then(() => true), outcome.then(() => false)]), true); stop.abort(opaque);
	const closing = source.close(); assert.equal(source.close(), closing); void closing.then(() => { closed = true; });
	await new Promise<void>(resolve => { setImmediate(resolve); }); assert.equal(closed, false); assert.ok(backing); assert.deepEqual([...new Uint8Array(backing)], [...body.bytes]);
	release.resolve(); const result = await outcome; assert.ok('error' in result); assert.ok(Object.is(result.error, opaque)); await closing;
	assert.equal(reflected, 0); assert.ok(new Uint8Array(backing).every(value => value === 0)); assert.deepEqual(body.bytes.slice(16), new Uint8Array([64]));
});

test('Light Source3 repair work refusal precedes its native pack or resource body reads', async () => {
	const f = fixture(), spots = Array.from({ length: 2 }, (_, index) => ({ ...f.source.develop.repairs.spots[0]!, id: `large-${index}`, radius: 1, target: { x: .5, y: .5 }, source: { x: .5, y: .5 } }));
	const develop = replaceImageDevelopRepairSpotsV1(f.source.develop, { schemaVersion: 1, spots });
	const source = { ...f.source, canonical: { ...f.source.canonical, width: 4096, height: 4096 }, developed: { width: 4096, height: 4096 }, develop,
		provenance: { ...f.source.provenance, developSha256: createHash('sha256').update(JSON.stringify(develop)).digest('hex') } };
	let reads = 0; const port = { loadMediaAsset() { reads++; throw Error('Overwork read bytes'); } };
	await assert.rejects(openFramescaperCurrentImageFrameSource(port, source), /work|visit|budget/iu); assert.equal(reads, 0);
});


test('Light Source3 keeps genuine Photo2 brush recipes unpromoted and retires their output despite opaque borrower shadows', async t => {
	const f = fixture(), body = maskBody(), develop = normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), masks: [{ schemaVersion: 1, id: 'unused', kind: 'matte',
		inputs: [{ name: 'paint', kind: 'alpha', sourceRef: body.reference.storageKey }], nodes: [{ id: 'painted', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'painted' }] });
	const source = { ...f.source, develop, provenance: { ...f.source.provenance, origin: { ...f.source.provenance.origin, schemaVersion: 2 },
		developSha256: createHash('sha256').update(JSON.stringify(develop)).digest('hex') } };
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	await store.writeMediaAsset(body.reference.storageKey, new Blob([body.bytes])); const maskSource = createFramescaperMaskRasterSourceTimelineImageV1(store);
	t.after(async () => { await maskSource.close(); await store.close(); });
	const revoked = Proxy.revocable({}, {}); revoked.revoke(); let backing: ArrayBuffer | undefined, reflected = 0;
	const work = withFramescaperImageDevelopFrameV3({ source, read: (offset: number, length: number) => f.pack.bytes.slice(offset, offset + length) }, view => {
		assert.deepEqual(view.frame.pixels, f.pixels); backing = view.frame.pixels.buffer;
		for (const key of ['buffer', 'fill']) Object.defineProperty(view.frame.pixels, key, { get() { reflected++; throw Error('Legacy borrower shadow reflected'); } });
		throw revoked.proxy;
	}, { maskSource }); const outcome = await work.then(value => ({ value }), (error: unknown) => ({ error }));
	assert.ok('error' in outcome);
	assert.ok(Object.is(outcome.error, revoked.proxy)); assert.equal(reflected, 0); assert.ok(backing);
	assert.ok(new Uint8Array(backing).every(value => value === 0)); assert.equal(source.develop.processVersion, 2); assert.equal(source.provenance.origin.schemaVersion, 2);
});


test('Light Current Frame base cancellation remains authoritative during a held real brush load under an independent read signal', async t => {
	const f = fixture(), body = maskBody(), base = new AbortController(), external = new AbortController(), entered = deferred<void>(), release = deferred<void>();
	const develop = replaceImageDevelopRepairSpotsV1({ ...f.source.develop, masks: [{ schemaVersion: 1, id: 'unused', kind: 'matte',
		inputs: [{ name: 'paint', kind: 'alpha', sourceRef: body.reference.storageKey }], nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'alpha' }] }, f.source.develop.repairs);
	const source = { ...f.source, develop, provenance: { ...f.source.provenance, developSha256: createHash('sha256').update(JSON.stringify(develop)).digest('hex') } };
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	await store.writeMediaAsset(source.storageKey, new Blob([new Uint8Array(f.pack.bytes)])); await store.writeMediaAsset(body.reference.storageKey, new Blob([body.bytes]));
	const load: FramescaperStoredImageAssetStoreTimelineImage['loadMediaAsset'] = store.loadMediaAsset.bind(store); let bodyReads = 0, heldSignal: AbortSignal | undefined;
	const port = { async loadMediaAsset(...args: Parameters<typeof load>) { assert.equal(this, port); const blob = await Reflect.apply(load, store, args) as Awaited<ReturnType<typeof load>>;
		if (args[0] === body.reference.storageKey) { bodyReads++; heldSignal = args[1]?.signal; assert.ok(heldSignal); assert.equal(Object.getPrototypeOf(heldSignal), AbortSignal.prototype); assert.equal(heldSignal.aborted, false); entered.resolve(); await release.promise; } return blob;
	} };
	const reader = await openFramescaperCurrentImageFrameSource(port, source, base.signal), reason = Symbol('original reader generation retired');
	const work = reader.readFrame(0, external.signal), outcome = work.then(value => ({ value }), (error: unknown) => ({ error })); let settled = false, closed = false;
	void outcome.then(() => { settled = true; }); t.after(async () => { release.resolve(); const result = await outcome; if ('value' in result) result.value.fill(0); await reader.closeAndJoin(); await store.close(); });
	assert.equal(await Promise.race([entered.promise.then(() => true), outcome.then(() => false)]), true); base.abort(reason); assert.ok(heldSignal); assert.equal(heldSignal.aborted, true); assert.ok(Object.is(heldSignal.reason, reason));
	const closing = reader.closeAndJoin(); assert.equal(reader.closeAndJoin(), closing); void closing.then(() => { closed = true; });
	await new Promise<void>(resolve => { setImmediate(resolve); }); assert.equal(settled, false); assert.equal(closed, false); assert.equal(external.signal.aborted, false);
	release.resolve(); const result = await outcome; assert.ok('error' in result); assert.ok(Object.is(result.error, reason)); await closing;
	assert.equal(bodyReads, 1); assert.deepEqual(new Uint8Array(await (await store.loadMediaAsset(source.storageKey))!.arrayBuffer()), f.pack.bytes);
	assert.deepEqual(new Uint8Array(await (await store.loadMediaAsset(body.reference.storageKey))!.arrayBuffer()), body.bytes);
});
