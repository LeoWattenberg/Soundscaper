/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { verifyPhotoResourcesCurrentV1 } from '../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const TEXT = 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1';
const TIME = '2026-10-11T00:00:00.000Z';
function observe<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
async function fixture() {
	const raw = createInstrumentedIndexedDB(), databaseName = `lightscaper-photo-current-resources-${crypto.randomUUID()}`;
	const media = new PhotoMediaStoreV1({ indexedDB: raw as unknown as IDBFactory, databaseName, preferOpfs: false, locks: null });
	const parsed = parseCubeLutV1(TEXT), lut = { bytes: new TextEncoder().encode(TEXT), reference: { storageKey: `lut-sha256:${parsed.sha256}`,
		sha256: parsed.sha256, byteLength: parsed.byteLength, size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax } };
	const brush = await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(0, 255) }, prepared => ({ reference: prepared.reference, bytes: prepared.bytes.slice() }));
	const base = photoArchiveFixture().photo, initial = base.versions[0]!.develop;
	const repair = replaceImageDevelopRepairSpotsV1({ ...initial, processVersion: 2, effects: [{ id: 'lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: lut.reference } }],
		masks: [{ schemaVersion: 2, id: 'unused-brush', name: 'Retained brush', kind: 'matte', inputs: [{ name: 'Unused', sourceRef: brush.reference.storageKey, kind: 'raster' }],
			nodes: [{ id: 'solid', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 0.5, height: 0.5 }], outputNodeId: 'solid' }], maskBindings: [] }, { schemaVersion: 1, spots: [] });
	const photo = normalizePhotoDocumentCurrentV1({ ...base, schemaVersion: 3, versions: [{ ...base.versions[0], workspace: { schemaVersion: 3, kind: 'photo-develop-workspace',
		entries: [{ label: 'Original', createdAt: TIME, develop: initial }, { label: 'Redo', createdAt: TIME, develop: repair }], cursor: 0,
		snapshots: [{ id: 'snapshot', name: 'Resources', createdAt: TIME, develop: repair }] } },
		{ ...base.versions[0], id: 'inactive', kind: 'virtual-copy', name: 'Inactive', develop: repair }] });
	const host = { cubeLutResources: () => media.getCubeLutResources(), maskRasterResources: () => media.getMaskRasterResources() };
	return { raw, databaseName, media, host, photo, lut, brush };
}

test('Current full retained resource closure authenticates actual selected LUT and unused brush bodies serially', async () => {
	const f = await fixture();
	try {
		const luts = await f.media.getCubeLutResources(), masks = await f.media.getMaskRasterResources();
		await luts.put(f.lut.reference, f.lut.bytes); await masks.put(f.brush.reference, f.brush.bytes);
		const before = f.raw.records(f.databaseName, 'analysis'); let reads = 0;
		const count = () => { reads++; f.raw.onNextGetForStore('analysis', count); }; f.raw.onNextGetForStore('analysis', count);
		await verifyPhotoResourcesCurrentV1(f.photo, f.host); assert.equal(reads, 2);
		assert.deepEqual(f.raw.records(f.databaseName, 'analysis'), before);
		await assert.rejects(luts.verifyPhoto(f.photo)); await assert.rejects(masks.verifyPhoto(f.photo));
	} finally { await f.media.close(); }
});

test('Current reference verification reuses independent verifier slots while both actual render borrowers are held', async () => {
	const f = await fixture(), release = deferred<void>(), lumaEntered = deferred<void>(), brushEntered = deferred<void>();
	const joining: { luma?: Promise<unknown>; brush?: Promise<unknown> } = {};
	try {
		const luts = await f.media.getCubeLutResources(), masks = await f.media.getMaskRasterResources();
		await luts.put(f.lut.reference, f.lut.bytes); await masks.put(f.brush.reference, f.brush.bytes);
		joining.luma = luts.source.withBytes(f.lut.reference, async bytes => { assert.deepEqual(bytes, f.lut.bytes); lumaEntered.resolve(); await release.promise; });
		joining.brush = masks.source.withBytes(f.brush.reference, async bytes => { assert.deepEqual(bytes, f.brush.bytes); brushEntered.resolve(); await release.promise; });
		await Promise.all([lumaEntered.promise, brushEntered.promise]);
		await verifyPhotoResourcesCurrentV1(f.photo, f.host);
		assert.equal(await remainsPending(joining.luma), true); assert.equal(await remainsPending(joining.brush), true);
		await assert.rejects(luts.source.withBytes(f.lut.reference, () => undefined), /pending/u);
		await assert.rejects(masks.source.withBytes(f.brush.reference, () => undefined), /pending/u);
	} finally { release.resolve(); await Promise.allSettled([joining.luma, joining.brush]); await f.media.close(); }
});

test('missing body in inactive/redo/snapshot closure refuses before any original authority', async () => {
	const f = await fixture();
	try { await (await f.media.getCubeLutResources()).put(f.lut.reference, f.lut.bytes);
		await assert.rejects(verifyPhotoResourcesCurrentV1(f.photo, f.host), /missing/u);
		assert.equal(f.raw.recordCount(f.databaseName, 'mediaAssets'), 0); assert.equal(f.raw.recordCount(f.databaseName, 'catalogOriginalRoots'), 0);
	} finally { await f.media.close(); }
});

test('resource-free repaired aggregate completes without acquiring immutable body owners', async () => {
	const base = photoArchiveFixture().photo, repair = replaceImageDevelopRepairSpotsV1(base.versions[0]!.develop, { schemaVersion: 1, spots: [] });
	const photo = normalizePhotoDocumentCurrentV1({ ...base, schemaVersion: 3, versions: [{ ...base.versions[0], develop: repair }] });
	let acquired = 0; const host = { cubeLutResources: async () => { acquired++; throw Error('Unexpected LUT owner'); },
		maskRasterResources: async () => { acquired++; throw Error('Unexpected brush owner'); } };
	await verifyPhotoResourcesCurrentV1(photo, host); assert.equal(acquired, 0);
});

test('selected body factory receiver is pinned before a held acquisition and cancellation joins its complete outcome', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), cancel = new AbortController();
	const reason = Proxy.revocable({}, {}); reason.revoke();
	const luts = await f.media.getCubeLutResources(), masks = await f.media.getMaskRasterResources();
	await luts.put(f.lut.reference, f.lut.bytes); await masks.put(f.brush.reference, f.brush.bytes);
	let brushCalls = 0;
	const host = { async cubeLutResources(this: unknown) { assert.equal(this, host); entered.resolve(); await release.promise; return luts; },
		async maskRasterResources(this: unknown) { assert.equal(this, host); brushCalls++; return masks; } };
	const work = observe(verifyPhotoResourcesCurrentV1(f.photo, host, cancel.signal));
	try {
		const reached = await Promise.race([entered.promise.then(() => true), work.then(() => false)]); assert.equal(reached, true);
		host.maskRasterResources = async () => { throw Error('Replaced source factory'); }; cancel.abort(reason.proxy);
		assert.equal(await remainsPending(work), true); release.resolve(); const result = await work;
		assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error, reason.proxy); assert.equal(brushCalls, 0);
	} finally { release.resolve(); await work; await f.media.close(); }
});
