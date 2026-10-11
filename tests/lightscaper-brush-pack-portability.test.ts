/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { encodePhotoCatalogPackV2, measurePhotoCatalogPackRecordV2, readPhotoCatalogPackV2 } from '../src/lightscaper/archive/catalog-pack-v2.ts';
import { exportPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-export-v5.ts';
import { importPhotoCatalogArchiveV5, type PhotoCatalogArchiveStageV5 } from '../src/lightscaper/archive/catalog-archive-import-v5.ts';
import { normalizePhotoDocumentV2, serializePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { createPhotoMaskRasterReachabilityV1 } from '../src/lightscaper/catalog/photo-mask-raster-reachability-v1.ts';
import { LUT_BODY, LUT_REFERENCE, lutArchiveFixture, rewriteLutArchiveFixture } from './helpers/lightscaper-lut-archive-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const BRUSH = `brush-mask-v1:1:1:${'a'.repeat(64)}`;
const PORTABILITY = /brush.*(?:portab|transport)|portab.*brush/iu;
const CREATED = '2026-10-11T00:00:00.000Z';
const POSITIONS = ['active', 'inactive', 'history', 'redo', 'snapshot', 'unbound', 'unused', 'alpha'] as const;
type Position = typeof POSITIONS[number];
function brushPhoto(position: Position, index = 1, sourceRef = BRUSH) {
	const record = photoArchiveFixture(index), master = record.photo.versions[0]!;
	const graph = { schemaVersion: 1, id: 'brush', kind: 'matte',
		inputs: [{ name: 'Brush', sourceRef, kind: position === 'alpha' ? 'alpha' : 'raster' }],
		nodes: position === 'unused' ? [{ id: 'output', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }]
			: position === 'alpha' ? [{ id: 'output', kind: 'alpha', inputName: 'Brush' }]
				: [{ id: 'output', kind: 'raster', inputName: 'Brush', channel: 'alpha' }], outputNodeId: 'output' };
	const develop = { ...master.develop, processVersion: 2,
		effects: [{ id: 'tone', type: 'tone-ladder-v1', enabled: false, params: { exposure: 1 } }], masks: [graph],
		maskBindings: position === 'unbound' || position === 'unused' ? [] : [{ effectId: 'tone', maskId: 'brush' }] };
	const entry = (value: unknown) => ({ label: 'Retained edit', createdAt: CREATED, develop: value });
	const versions: unknown[] = [master];
	if (position === 'inactive') versions.push({ ...master, id: 'inactive', kind: 'virtual-copy', name: 'Inactive', develop });
	else if (position === 'history' || position === 'redo' || position === 'snapshot') {
		versions[0] = { ...master, workspace: { schemaVersion: 2, kind: 'photo-develop-workspace',
			cursor: position === 'history' ? 1 : 0,
			entries: position === 'history' ? [entry(develop), entry(master.develop)] : position === 'redo'
				? [entry(master.develop), entry(develop)] : [entry(master.develop)],
			snapshots: position === 'snapshot' ? [{ id: 'snapshot', name: 'Retained snapshot', createdAt: CREATED, develop }] : [] } };
	} else versions[0] = { ...master, develop };
	return { photo: normalizePhotoDocumentV2({ ...record.photo, schemaVersion: 2, versions }), original: record.original };
}
function scalarRecord() {
	const f = lutArchiveFixture(), version = f.record.photo.versions[0]!;
	const nodes = [
		{ id: 'output', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
		{ id: 'output', kind: 'radial-gradient', center: { x: 0.5, y: 0.5 }, radius: { x: 0.5, y: 0.5 }, innerFraction: 0 },
		{ id: 'output', kind: 'luminance-range', lower: 0.1, upper: 0.2, falloff: 0.1 },
		{ id: 'output', kind: 'color-range', color: { r: 1, g: 0, b: 0 }, radius: 0, falloff: 1 },
	];
	return { ...f.record, photo: normalizePhotoDocumentV2({ ...f.record.photo, versions: [{ ...version,
		develop: { ...version.develop, masks: nodes.map((node, index) => ({ schemaVersion: 1, id: `scalar-${String(index)}`,
			kind: 'mask', inputs: [], nodes: [node], outputNodeId: 'output' })) } }] }) };
}
async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
	const parts: Uint8Array<ArrayBuffer>[] = [];
	for await (const bytes of source) parts.push(new Uint8Array(bytes));
	const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0)); let offset = 0;
	for (const part of parts) { result.set(part, offset); offset += part.byteLength; } return result;
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** Independent tiny LSCPACK2 fixture: no encoder under test writes its header or JSON. */
function manualPack(records: readonly Readonly<{ photo: unknown; bytes: Uint8Array }>[]) {
	const parts = [new TextEncoder().encode('LSCPACK2')];
	for (const record of records) {
		const json = new TextEncoder().encode(JSON.stringify(record.photo)), header = new Uint8Array(12), view = new DataView(header.buffer);
		view.setUint32(0, json.byteLength, true); view.setBigUint64(4, BigInt(record.bytes.byteLength), true);
		parts.push(header, json, new Uint8Array(record.bytes));
	}
	const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0)); let offset = 0;
	for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; } return bytes;
}
async function* split(bytes: Uint8Array, span = 7) {
	for (let offset = 0; offset < bytes.byteLength; offset += span) yield bytes.subarray(offset, offset + span);
}
const bodySource = { async withBytes<T>(_reference: unknown, consume: (bytes: Uint8Array<ArrayBuffer>) => Promise<T>) {
	return await consume(new Uint8Array(LUT_BODY));
} };
/** Inspect only genuine composed AggregateError envelopes. Known opaque
 * reasons are identity-matched before any prototype or property operation. */
function failureLeaves(value: unknown, opaque: readonly unknown[] = [], seen = new Set<AggregateError>()): unknown[] {
	if (opaque.some(reason => Object.is(reason, value)) || !(value instanceof AggregateError)) return [value];
	if (seen.has(value)) return [];
	const descriptor = Object.getOwnPropertyDescriptor(value, 'errors');
	assert.ok(descriptor && Object.hasOwn(descriptor, 'value'));
	const errors: unknown = descriptor.value; assert.ok(Array.isArray(errors));
	// ZIP retirement can report the same envelope through two ownership edges.
	// Visit that object once without deduplicating distinct child failures.
	seen.add(value);
	return (errors as unknown[]).flatMap(error => failureLeaves(error, opaque, seen));
}
function assertPortableFailure(value: unknown, opaque: readonly unknown[] = []): unknown[] {
	const leaves = failureLeaves(value, opaque);
	const primary = leaves.filter(error => !opaque.some(reason => Object.is(reason, error))
		&& error instanceof TypeError && PORTABILITY.test(error.message));
	// ZIP/extractor owners may repeat an identical failed outcome through their
	// own cleanup envelopes; the refusal itself must be one actual error identity.
	assert.equal(new Set(primary).size, 1, 'Missing or replaced owning brush portability refusal');
	return leaves;
}

test('pack measurement refuses complete retained brush reachability without changing the owning Photo', () => {
	for (const position of POSITIONS) {
		const { photo } = brushPhoto(position), before = serializePhotoDocumentV1OrV2(photo);
		const collector = createPhotoMaskRasterReachabilityV1(); collector.addPhoto(photo);
		assert.equal(collector.finish().length, 1, position);
		assert.throws(() => measurePhotoCatalogPackRecordV2(photo), PORTABILITY, position);
		assert.equal(serializePhotoDocumentV1OrV2(photo), before);
	}
});

test('pack encoder refuses each retained brush before original native metadata or body acquisition', async () => {
	for (const position of POSITIONS) {
		const record = brushPhoto(position); let traps = 0;
		const original = new Proxy(record.original, { get() { traps++; throw Error('Original reflected'); } });
		await assert.rejects(collect(encodePhotoCatalogPackV2([{ photo: record.photo, original }])), PORTABILITY, position);
		assert.equal(traps, 0, position);
	}
});

test('independently framed incoming pack refuses complete Photo metadata before consumer or original pull', async () => {
	for (const position of POSITIONS) {
		const { photo } = brushPhoto(position), bytes = manualPack([{ photo, bytes: new Uint8Array([1, 2, 3]) }]);
		const metadataOnly = bytes.subarray(0, bytes.byteLength - 3); let calls = 0, originals = 0, returned = 0, consumed = 0;
		const source = { [Symbol.asyncIterator]() { return { async next() {
			if (calls++ === 0) return { done: false as const, value: metadataOnly };
			originals++; return { done: true as const, value: undefined };
		}, async return() { returned++; return { done: true as const, value: undefined }; } }; } };
		await assert.rejects(readPhotoCatalogPackV2(source, async () => { consumed++; }), PORTABILITY, position);
		assert.equal(consumed, 0); assert.equal(originals, 0); assert.equal(returned, 1);
	}
});

test('reserved future and malformed brush references also fail closed at direct pack boundaries', async () => {
	for (const sourceRef of ['brush-mask-future', `brush-mask-v2:1:1:${'a'.repeat(64)}`, `brush-mask-v1:01:1:${'a'.repeat(64)}`]) {
		const { photo, original } = brushPhoto('snapshot', 1, sourceRef); let consumed = 0;
		assert.throws(() => measurePhotoCatalogPackRecordV2(photo));
		await assert.rejects(collect(encodePhotoCatalogPackV2([{ photo, original }])));
		await assert.rejects(readPhotoCatalogPackV2(split(manualPack([{ photo, bytes: new Uint8Array([1, 2, 3]) }])), async () => { consumed++; }));
		assert.equal(consumed, 0);
	}
});

test('pack portability refusal joins captured source close and retains its distinct opaque cleanup', async () => {
	const { photo } = brushPhoto('redo'), bytes = manualPack([{ photo, bytes: new Uint8Array([1, 2, 3]) }]);
	const entered = deferred<void>(), release = deferred<void>(), cleanup = Object.freeze({ cleanup: true });
	let next = 0, returned = 0, consumed = 0, failure: unknown;
	const source = { [Symbol.asyncIterator]() { return { async next() {
		if (next++) return { done: true as const, value: undefined }; return { done: false as const, value: bytes };
	}, async return() { returned++; entered.resolve(); await release.promise; throw cleanup; } }; } };
	const work = readPhotoCatalogPackV2(source, async () => { consumed++; }).catch((error: unknown) => { failure = error; });
	try {
		await entered.promise; assert.equal(await remainsPending(work), true); assert.equal(consumed, 0); assert.equal(returned, 1);
	} finally { release.resolve(); await work; }
	assert.ok(failure instanceof AggregateError); assert.match(String(failure.errors[0]), PORTABILITY);
	assert.equal(failure.errors[1], cleanup); assert.equal(failure.cause, failure.errors[0]);
});

test('pack held-read cancellation keeps exact opaque primary and independently joined source retirement', async () => {
	const entered = deferred<void>(), release = deferred<void>(), leave = deferred<void>(), stop = new AbortController();
	const revoked = Proxy.revocable({}, {}); revoked.revoke(); const primary = revoked.proxy, cleanup = Object.freeze({ cleanup: true });
	let returned = 0, failure: unknown;
	const source = { [Symbol.asyncIterator]() { return { async next() { entered.resolve(); await release.promise;
		return { done: true as const, value: undefined }; }, async return() { returned++; await leave.promise; throw cleanup; } }; } };
	const work = readPhotoCatalogPackV2(source, async () => undefined, { signal: stop.signal }).catch((error: unknown) => { failure = error; });
	try { await entered.promise; stop.abort(primary); release.resolve(); assert.equal(await remainsPending(work), true); }
	finally { release.resolve(); leave.resolve(); await work; }
	assert.ok(failure instanceof AggregateError); assert.equal(failure.errors[0], primary); assert.equal(failure.errors[1], cleanup); assert.equal(returned, 1);
});

test('V5 records refuse retained brushes before canonical original acquisition or any LUT body read', async () => {
	const f = lutArchiveFixture();
	for (const position of POSITIONS) {
		const record = brushPhoto(position); let traps = 0, reads = 0;
		const original = new Proxy(record.original, { get() { traps++; throw Error('Original reflected'); } });
		const source = { async withBytes<T>(_reference: unknown, consume: (bytes: Uint8Array<ArrayBuffer>) => Promise<T>) {
			reads++; return await consume(new Uint8Array(LUT_BODY));
		} };
		await assert.rejects(exportPhotoCatalogArchiveV5(f.root, [{ photo: record.photo, original }], [], null, [], f.row, source),
			(error: unknown) => { assertPortableFailure(error); return true; }, position);
		assert.equal(traps, 0); assert.equal(reads, 0);
	}
});

test('V5 refused record joins upstream retirement and preserves a distinct failed cleanup', async () => {
	const f = lutArchiveFixture(), record = brushPhoto('inactive'), entered = deferred<void>(), release = deferred<void>();
	const cleanup = Object.freeze({ cleanup: true }); let next = 0, returned = 0, failure: unknown;
	const photos = { [Symbol.asyncIterator]() { return { async next() {
		if (next++) return { done: true as const, value: undefined }; return { done: false as const, value: record };
	}, async return() { returned++; entered.resolve(); await release.promise; throw cleanup; } }; } };
	const work = exportPhotoCatalogArchiveV5(f.root, photos, [], null, [], null, undefined).catch((error: unknown) => { failure = error; });
	try { await Promise.race([entered.promise, work]); assert.equal(await remainsPending(work), true); assert.equal(returned, 1); }
	finally { release.resolve(); await work; }
	const leaves = assertPortableFailure(failure, [cleanup]);
	assert.equal(leaves.filter(error => Object.is(error, cleanup)).length, 1);
});

test('V5 held-next cancellation precedes late metadata/original admission and joins exact opaque retirement outcomes', async () => {
	const f = lutArchiveFixture();
	for (const late of ['neutral', 'brush'] as const) for (const mode of ['distinct', 'same'] as const) {
		const record = late === 'brush' ? brushPhoto('snapshot') : photoArchiveFixture();
		const nextEntered = deferred<void>(), nextRelease = deferred<void>(), returnEntered = deferred<void>(), returnRelease = deferred<void>();
		const primary = Proxy.revocable({}, {}), secondary = Proxy.revocable({}, {}); primary.revoke(); secondary.revoke();
		const cleanup = mode === 'same' ? primary.proxy : secondary.proxy, stop = new AbortController();
		let traps = 0, returned = 0, failure: unknown;
		const original = new Proxy(record.original, { get() { traps++; throw Error('Late original reflected'); } });
		const photos = { [Symbol.asyncIterator]() { return { async next() {
			nextEntered.resolve(); await nextRelease.promise; return { done: false as const, value: { photo: record.photo, original } };
		}, async return() { returned++; returnEntered.resolve(); await returnRelease.promise; throw cleanup; } }; } };
		const work = exportPhotoCatalogArchiveV5(f.root, photos, [], null, [], null, undefined, { signal: stop.signal })
			.catch((error: unknown) => { failure = error; });
		try {
			await Promise.race([nextEntered.promise, work]); stop.abort(primary.proxy); nextRelease.resolve();
			await Promise.race([returnEntered.promise, work]); assert.equal(returned, 1);
			assert.equal(await remainsPending(work), true); assert.equal(traps, 0);
		} finally { nextRelease.resolve(); returnRelease.resolve(); await work; }
		if (mode === 'same') assert.equal(Object.is(failure, primary.proxy), true);
		else {
			const leaves = failureLeaves(failure, [primary.proxy, cleanup]);
			assert.equal(leaves.filter(error => Object.is(error, primary.proxy)).length, 1);
			assert.equal(leaves.filter(error => Object.is(error, cleanup)).length, 1);
		}
	}
});

async function rewrittenBrushArchive() {
	const f = lutArchiveFixture(), root = normalizePhotoCatalogRootV1({ ...f.root, photoCount: 2 });
	const records = [photoArchiveFixture(1), photoArchiveFixture(2)];
	const exported = await exportPhotoCatalogArchiveV5(root, records, [], null, [], f.row, bodySource);
	assert.ok(exported.blob); assert.equal(exported.document.packs.length, 1);
	const photo = brushPhoto('snapshot', 2).photo;
	const packBytes = manualPack([{ photo: records[0]!.photo, bytes: new Uint8Array([1, 2, 3]) }, { photo, bytes: new Uint8Array([1, 2, 3]) }]);
	const blob = await rewriteLutArchiveFixture(exported.blob, files => {
		const document = structuredClone(exported.document), manifest = structuredClone(exported.manifest), pack = document.packs[0]!;
		files.set(pack.entry, packBytes);
		manifest.assets = manifest.assets.map(asset => asset.sourceId === pack.id ? { ...asset, size: packBytes.byteLength, sha256: sha(packBytes) } : asset);
		const project = new TextEncoder().encode(JSON.stringify(document)); files.set('project.json', project);
		manifest.project = { ...manifest.project, size: project.byteLength, sha256: sha(project) };
		files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
	});
	return { blob, root };
}

test('authentic V5 rewrite rejects later brush before its consumer, joins rollback and never publishes provisional prefix', async () => {
	const { blob } = await rewrittenBrushArchive(), entered = deferred<void>(), release = deferred<void>();
	const events: string[] = [], photos: string[] = [], originals: Uint8Array[] = []; let failure: unknown;
	const stage: PhotoCatalogArchiveStageV5 = { async writePhoto(photo, body) {
		photos.push(photo.id); originals.push(await collect(body)); events.push('photo');
	}, async writeStack() {}, async writeSavedCollection() {}, async writeDevelopPresets() { events.push('preset'); },
		async writeLut() { events.push('lut'); }, async publish() { events.push('publish'); },
		async rollback() { events.push('rollback'); entered.resolve(); await release.promise; } };
	const work = importPhotoCatalogArchiveV5(blob, async () => { events.push('stage'); return stage; }).catch((error: unknown) => { failure = error; });
	try { await Promise.race([entered.promise, work]); assert.equal(await remainsPending(work), true); assert.deepEqual(events, ['stage', 'photo', 'rollback']); }
	finally { release.resolve(); await work; }
	assertPortableFailure(failure); assert.deepEqual(photos, ['photo-1']); assert.deepEqual(originals, [new Uint8Array([1, 2, 3])]);
	assert.equal(events.includes('publish'), false); assert.equal(events.includes('lut'), false);
});

test('V5 brush import retains independent rollback failure rather than replacing the rejected metadata reason', async () => {
	const { blob } = await rewrittenBrushArchive(), cleanup = Object.freeze({ cleanup: true }); let failure: unknown, publishes = 0;
	const stage: PhotoCatalogArchiveStageV5 = { async writePhoto(_photo, body) { await collect(body); }, async writeStack() {},
		async writeSavedCollection() {}, async writeDevelopPresets() {}, async writeLut() {}, async publish() { publishes++; }, async rollback() { throw cleanup; } };
	try { await importPhotoCatalogArchiveV5(blob, async () => stage); } catch (error) { failure = error; }
	const leaves = assertPortableFailure(failure, [cleanup]);
	assert.equal(leaves.filter(error => Object.is(error, cleanup)).length, 1); assert.equal(publishes, 0);
});

test('legacy Photo1 and Photo2 scalar masks retain exact pack bytes and complete V5 LUT custody', async () => {
	const scalar = scalarRecord(), records = [photoArchiveFixture(2), scalar];
	const bytes = await collect(encodePhotoCatalogPackV2(records));
	assert.deepEqual(bytes, manualPack(records.map(record => ({ photo: JSON.parse(serializePhotoDocumentV1OrV2(record.photo)) as unknown, bytes: new Uint8Array([1, 2, 3]) }))));
	const delivered: unknown[] = [];
	assert.equal(await readPhotoCatalogPackV2(split(bytes), async (photo, body) => { delivered.push({ photo, bytes: await collect(body) }); }), 2);
	assert.deepEqual(delivered, records.map(record => ({ photo: record.photo, bytes: new Uint8Array([1, 2, 3]) })));
	const f = lutArchiveFixture(), result = await exportPhotoCatalogArchiveV5(f.root, [scalar], [], null, [], f.row, bodySource);
	assert.ok(result.blob); const photos: unknown[] = [], refs: unknown[] = [], bodies: Uint8Array[] = [], rows: unknown[] = [];
	let published = 0, rolledBack = 0;
	const stage: PhotoCatalogArchiveStageV5 = { async writePhoto(photo, body) { photos.push({ photo, bytes: await collect(body) }); },
		async writeStack() {}, async writeSavedCollection() {}, async writeDevelopPresets(row) { rows.push(row); },
		async writeLut(reference, body) { refs.push(reference); bodies.push(new Uint8Array(body)); }, async publish() { published++; }, async rollback() { rolledBack++; } };
	assert.deepEqual(await importPhotoCatalogArchiveV5(result.blob, async () => stage), f.root);
	assert.deepEqual(photos, [{ photo: scalar.photo, bytes: new Uint8Array([1, 2, 3]) }]); assert.deepEqual(refs, [LUT_REFERENCE]);
	assert.deepEqual(bodies, [LUT_BODY]); assert.deepEqual(rows, [f.row]); assert.equal(published, 1); assert.equal(rolledBack, 0);
});
