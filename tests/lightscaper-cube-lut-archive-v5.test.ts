/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { exportPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-export-v5.ts';
import { importPhotoCatalogArchiveV5, type PhotoCatalogArchiveStageV5 } from '../src/lightscaper/archive/catalog-archive-import-v5.ts';
import { exportPhotoCatalogArchiveV4 } from '../src/lightscaper/archive/catalog-archive-export-v4.ts';
import { exportPhotoCatalogArchiveV1 } from '../src/lightscaper/archive/catalog-archive-export.ts';
import { exportPhotoCatalogArchiveV2 } from '../src/lightscaper/archive/catalog-archive-export-v2.ts';
import { LUT_BODY, LUT_REFERENCE, lutArchiveFixture, rewriteLutArchiveFixture } from './helpers/lightscaper-lut-archive-fixture.ts';
import { digestScapeBytes } from '../src/common/editor/scape-byte-stream.ts';
import { borrowPhotoCubeLutArchiveSourceV1 } from '../src/lightscaper/archive/cube-lut-archive-source-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

function target() {
	const photos: unknown[] = [], rows: unknown[] = [], bodies: Uint8Array[] = [], events: string[] = [];
	const stage: PhotoCatalogArchiveStageV5 = { async writePhoto(photo, original) {
		const parts: Uint8Array[] = []; for await (const bytes of original) parts.push(new Uint8Array(bytes));
		photos.push({ photo, bytes: Array.from(parts.flatMap(bytes => [...bytes])) }); events.push('photo');
	}, async writeStack() {}, async writeSavedCollection() {}, async writeDevelopPresets(row) { rows.push(row); events.push('presets'); },
		async writeLut(reference, bytes) { assert.deepEqual(reference, LUT_REFERENCE); bodies.push(new Uint8Array(bytes)); events.push('lut'); },
		async publish() { events.push('publish'); }, async rollback() { events.push('rollback'); } };
	return { stage, photos, rows, bodies, events };
}
const bodySource = { async withBytes<T>(_reference: unknown, consume: (bytes: Uint8Array<ArrayBuffer>) => Promise<T>) { return await consume(new Uint8Array(LUT_BODY)); } };

test('V5 transports unique complete disabled Photo2/preset2 LUT custody and exact originals before publication', async () => {
	const fixture = lutArchiveFixture(); let reads = 0;
	const source = { async withBytes<T>(reference: unknown, consume: (bytes: Uint8Array<ArrayBuffer>) => Promise<T>) {
		assert.equal(this, source); reads++; assert.deepEqual(reference, LUT_REFERENCE); return bodySource.withBytes(reference, consume);
	} };
	const result = await exportPhotoCatalogArchiveV5(fixture.root, [fixture.record], [], null, [], fixture.row, source);
	assert.ok(result.blob); assert.equal(result.document.schemaVersion, 5); assert.equal(result.document.lutResources.length, 1);
	assert.equal(reads, 2); assert.equal(result.document.developPresetPack?.rowSchemaVersion, 2); assert.equal(result.document.developPresetPack?.revision, 29);
	assert.equal(result.manifest.assets.filter(value => value.kind === 'photo-cube-lut').length, 1);
	const destination = target(); assert.deepEqual(await importPhotoCatalogArchiveV5(result.blob, async () => destination.stage), fixture.root);
	assert.deepEqual(destination.events, ['photo', 'presets', 'lut', 'publish']); assert.deepEqual(destination.rows, [fixture.row]);
	assert.deepEqual(destination.bodies, [LUT_BODY]); assert.deepEqual(destination.photos, [{ photo: fixture.record.photo, bytes: [1, 2, 3] }]);
});

test('V4 retains exact absence while V5 preserves positive-empty row2 and refuses body mismatch without publish', async () => {
	const fixture = lutArchiveFixture(), old = await exportPhotoCatalogArchiveV4(fixture.root, [photoArchiveFixture()], [], null, [], null);
	assert.ok(old.blob); const oldTarget = target(); await importPhotoCatalogArchiveV5(old.blob, async (_root, _saved, header, refs) => {
		assert.equal(header, null); assert.deepEqual(refs, []); return oldTarget.stage;
	}); assert.deepEqual(oldTarget.events, ['photo', 'publish']);
	const empty = { ...fixture.row, presets: [], revision: 2 }, result = await exportPhotoCatalogArchiveV5(fixture.root, [photoArchiveFixture()], [], null, [], empty, undefined);
	assert.ok(result.blob); const current = target(); await importPhotoCatalogArchiveV5(result.blob, async () => current.stage);
	assert.deepEqual(current.rows, [empty]); assert.deepEqual(current.events, ['photo', 'presets', 'publish']);
	let aborted = 0; const corrupt = new Uint8Array(LUT_BODY); corrupt[corrupt.length - 2] = 48;
	await assert.rejects(exportPhotoCatalogArchiveV5(fixture.root, [fixture.record], [], null, [], fixture.row,
		{ async withBytes(_ref, consume) { return await consume(corrupt); } }, { writable: new WritableStream({ write() {}, abort() { aborted++; } }) }));
	assert.equal(aborted, 1);
});

test('source callback and retirement join before archive close, pinned methods survive function metadata tripwires', async () => {
	const fixture = lutArchiveFixture(), entered = deferred<void>(), release = deferred<void>(); let calls = 0, traps = 0;
	const source = { withBytes: new Proxy(async function<T>(this: unknown, _ref: unknown, consume: (bytes: Uint8Array<ArrayBuffer>) => Promise<T>) {
		assert.equal(this, source); calls++; const work = consume(new Uint8Array(LUT_BODY)); void work.catch(() => undefined);
		if (calls === 1) { entered.resolve(); await release.promise; } return await work;
	}, { get() { traps++; throw Error('Callable reflected'); } }) };
	const work = exportPhotoCatalogArchiveV5(fixture.root, [fixture.record], [], null, [], fixture.row, source);
	await entered.promise; assert.equal(await remainsPending(work), true); source.withBytes = async () => { throw Error('Replacement used'); };
	release.resolve(); await work; assert.equal(calls, 2); assert.equal(traps, 0);
});

test('stage acquisition opaque cancellation joins distinct rollback; durable publication ACK wins final abort', async () => {
	const fixture = lutArchiveFixture(), result = await exportPhotoCatalogArchiveV5(fixture.root, [fixture.record], [], null, [], fixture.row, bodySource);
	assert.ok(result.blob); const stop = new AbortController(); let traps = 0;
	const primary = new Proxy({}, { get() { traps++; throw Error('Reason inspected'); }, getPrototypeOf() { traps++; throw Error('Reason prototype'); } }), cleanup = Object.freeze({ cleanup: true });
	const stage = target().stage; let failure: unknown;
	try { await importPhotoCatalogArchiveV5(result.blob, async () => { stop.abort(primary); return { ...stage, async rollback() { throw cleanup; } }; }, { signal: stop.signal }); }
	catch (error) { failure = error; } assert.ok(failure instanceof AggregateError); assert.equal(failure.errors[0], primary); assert.equal(failure.errors[1], cleanup); assert.equal(traps, 0);
	const late = new AbortController(), completed = target(); await importPhotoCatalogArchiveV5(result.blob, async () => ({ ...completed.stage,
		async publish() { completed.events.push('publish'); late.abort(primary); } }), { signal: late.signal }); assert.equal(completed.events.at(-1), 'publish');
});

test('complete reachable declarations, exact row version and body digest refuse before publish and provisional LUT writes', async () => {
	const fixture = lutArchiveFixture(), result = await exportPhotoCatalogArchiveV5(fixture.root, [fixture.record], [], null, [], fixture.row, bodySource);
	assert.ok(result.blob);
	for (const mode of ['missing', 'geometry', 'row-version', 'body'] as const) {
		const malformed = await rewriteLutArchiveFixture(result.blob, files => {
			const document = structuredClone(result.document), manifest = structuredClone(result.manifest);
			if (mode === 'missing') { Reflect.set(document, 'lutResources', []); manifest.assets = manifest.assets.filter(asset => asset.kind !== 'photo-cube-lut'); files.delete(`assets/luts/${LUT_REFERENCE.sha256}.cube`); }
			if (mode === 'geometry') Reflect.set(document, 'lutResources', [{ ...document.lutResources[0], reference: { ...LUT_REFERENCE, domainMax: [2, 1, 1] } }]);
			if (mode === 'row-version') Reflect.set(document, 'developPresetPack', { ...document.developPresetPack, rowSchemaVersion: 1 });
			if (mode === 'body') { const bytes = new Uint8Array(LUT_BODY); bytes[bytes.length - 2] = 48; files.set(`assets/luts/${LUT_REFERENCE.sha256}.cube`, bytes); }
			const project = new TextEncoder().encode(JSON.stringify(document)); files.set('project.json', project);
			manifest.project = { ...manifest.project, size: project.byteLength, sha256: digestScapeBytes(project) };
			files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
		});
		const current = target(); await assert.rejects(importPhotoCatalogArchiveV5(malformed, async () => current.stage));
		assert.equal(current.events.includes('publish'), false); assert.equal(current.events.includes('lut'), false); assert.equal(current.events.at(-1), 'rollback');
	}
});

test('broken early source settlement still joins the body and retains distinct opaque retirement evidence', async () => {
	const entered = deferred<void>(), release = deferred<void>(); const cleanup = Object.freeze({ cleanup: true });
	let retained: Uint8Array | undefined, traps = 0;
	const primary = new Proxy({}, { get() { traps++; throw Error('Reason inspected'); }, getPrototypeOf() { traps++; throw Error('Prototype inspected'); } });
	const read = borrowPhotoCubeLutArchiveSourceV1({ async withBytes(_ref, consume) {
		const work = consume(new Uint8Array(LUT_BODY)); void work.catch(() => undefined); throw cleanup;
	} });
	let failure: unknown; const work = read(LUT_REFERENCE, async bytes => { retained = bytes; entered.resolve(); await release.promise; throw primary; })
		.catch((error: unknown) => { failure = error; });
	await entered.promise; assert.equal(await remainsPending(work), true); release.resolve(); await work;
	assert.ok(failure instanceof AggregateError); assert.deepEqual(failure.errors, [primary, cleanup]); assert.ok(retained?.every(value => value === 0)); assert.equal(traps, 0);
	const same = borrowPhotoCubeLutArchiveSourceV1({ async withBytes(_ref, consume) { return await consume(new Uint8Array(LUT_BODY)); } });
	try { await same(LUT_REFERENCE, async () => { throw NaN; }); } catch (error) { failure = error; } assert.equal(Object.is(failure, NaN), true);
});

test('new importer preserves strict V1 and V2 photo bytes and exact resource/preset absence', async () => {
	const f = lutArchiveFixture(), record = photoArchiveFixture();
	for (const version of [1, 2] as const) {
		const result = version === 1 ? await exportPhotoCatalogArchiveV1(f.root, [record]) : await exportPhotoCatalogArchiveV2(f.root, [record], []);
		assert.ok(result.blob); const current = target();
		await importPhotoCatalogArchiveV5(result.blob, async (root, saved, preset, references) => {
			assert.deepEqual(root, f.root); assert.equal(saved, null); assert.equal(preset, null); assert.deepEqual(references, []); return current.stage;
		});
		assert.deepEqual(current.photos, [{ photo: record.photo, bytes: [1, 2, 3] }]); assert.deepEqual(current.events, ['photo', 'publish']);
	}
});

test('one-shot final source verification pins its callable receiver and follows all authenticated resource reads', async () => {
	const f = lutArchiveFixture(), events: string[] = []; let traps = 0;
	const source = { async withBytes<T>(_reference: unknown, consume: (bytes: Uint8Array<ArrayBuffer>) => Promise<T>) {
		events.push('body'); return consume(new Uint8Array(LUT_BODY));
	} };
	const options = { verifySource: new Proxy(async function (this: unknown) { assert.equal(this, options); events.push('source'); },
		{ get() { traps++; throw new Error('Verifier metadata inspected'); } }) };
	await exportPhotoCatalogArchiveV5(f.root, [f.record], [], null, [], f.row, source, options);
	assert.deepEqual(events, ['body', 'body', 'source']); assert.equal(traps, 0);
});

test('writer captures one external destination and streaming mode before held final verification or option replacement', async () => {
	const f = lutArchiveFixture();
	for (const mode of ['held', 'cold-getter'] as const) {
		const entered = deferred<void>(), release = deferred<void>(); let reads = 0, closed = 0, written = 0;
		const writable = new WritableStream<Uint8Array>({ write(bytes) { written += bytes.byteLength; }, close() { closed++; } });
		const options = { writable: writable as WritableStream<Uint8Array> | undefined, maximumBlobBytes: 1,
			async verifySource() { if (mode === 'held') { entered.resolve(); await release.promise; } } };
		if (mode === 'cold-getter') Object.defineProperty(options, 'writable', { configurable: true, get() { return ++reads === 1 ? writable : undefined; } });
		const work = exportPhotoCatalogArchiveV5(f.root, [f.record], [], null, [], f.row, bodySource, options);
		try {
			if (mode === 'held') { await Promise.race([entered.promise, work]); options.writable = undefined; release.resolve(); }
			const result = await work; assert.equal(result.blob, null); assert.equal(closed, 1); assert.equal(written, result.byteLength);
			assert.ok(written > options.maximumBlobBytes); if (mode === 'cold-getter') assert.equal(reads, 1);
		} finally { release.resolve(); await work.catch(() => undefined); }
	}
});
