/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { createImageDevelopSelectedPresetV4 } from '../src/common/editor/imaging/image-develop-preset-selected-v4.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { repairBackupCurrentFixture, readRepairBackupArchive, repairBackupDestination } from './helpers/lightscaper-repair-backup-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type Fixture = Awaited<ReturnType<typeof repairBackupCurrentFixture>>;
interface Pack { readonly entry: string; readonly photoCount: number }
interface Resource { readonly id: string; readonly entry: string; readonly reference: { readonly storageKey: string; readonly sha256: string } }
function outcome<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
async function archive(f: Fixture) {
	const result = await f.session.backupCatalog(); assert.ok(result.blob); assert.equal(result.byteLength, result.blob.size);
	return { ...await readRepairBackupArchive(result.blob), result };
}
function packedPhotos(document: Record<string, unknown>, entries: Map<string, Uint8Array<ArrayBuffer>>) {
	const photos: ReturnType<typeof normalizePhotoDocumentCurrentV1>[] = [], originals: Uint8Array<ArrayBuffer>[] = [];
	for (const pack of document.packs as readonly Pack[]) {
		const bytes = entries.get(pack.entry); assert.ok(bytes); assert.equal(new TextDecoder().decode(bytes.subarray(0, 8)), 'LSCPACK4');
		let offset = 8, count = 0;
		while (offset < bytes.length) {
			assert.ok(offset + 12 <= bytes.length); const frame: DataView<ArrayBuffer> = new DataView(bytes.buffer, bytes.byteOffset + offset, 12);
			const jsonSize: number = frame.getUint32(0, true), originalSize: number = Number(frame.getBigUint64(4, true)); offset += 12;
			assert.ok(Number.isSafeInteger(originalSize) && originalSize > 0 && offset + jsonSize + originalSize <= bytes.length);
			photos.push(normalizePhotoDocumentCurrentV1(JSON.parse(new TextDecoder().decode(bytes.subarray(offset, offset + jsonSize))) as unknown));
			offset += jsonSize; originals.push(bytes.slice(offset, offset + originalSize)); offset += originalSize; count++;
		}
		assert.equal(count, pack.photoCount);
	}
	return { photos, originals };
}

for (const placement of ['active', 'redo', 'snapshot', 'inactive'] as const) test(`actual selected Current backup carries complete ${placement} Photo3 in Archive7/Pack4 without changing Original or source`, async () => {
	const f = await repairBackupCurrentFixture(placement);
	try {
		const before = await f.inspect(), value = await archive(f); assert.equal(value.document.schemaVersion, 7);
		const actual = packedPhotos(value.document, value.entries); assert.deepEqual(actual.photos, before);
		assert.deepEqual(actual.originals, await Promise.all(f.records.map(async row => new Uint8Array(await row.original.arrayBuffer()))));
		assert.deepEqual(await f.inspect(), before); assert.deepEqual(value.result.notices, []);
		assert.equal(value.document.developPresetPack, null); assert.deepEqual(value.document.lutResources, []); assert.deepEqual(value.document.maskRasters, []);
		const retained = before.at(-1)!; assert.equal(retained!.schemaVersion, 3);
		if (placement !== 'active') assert.equal(retained!.versions.find(version => version.id === retained.activeVersionId)!.develop.processVersion, 1);
	} finally { await f.close(); }
});

test('native Row4 selects Archive8 for wholly legacy Photos and authenticates preset-only disabled LUT and unused brushes before destination/original', async () => {
	const f = await repairBackupCurrentFixture('legacy'), target = repairBackupDestination(f.events);
	try {
		const preset = await f.savePreset(true), row = await f.row(), before = await f.inspect(); assert.ok(before.every(photo => photo?.schemaVersion === 1));
		const result = await f.session.backupCatalog({ createWritable: target.createWritable }); assert.equal(result.blob, null);
		assert.equal(target.writable.locked, false); assert.equal(f.events.at(-1), 'commit'); assert.equal(f.events.filter(value => value === 'commit').length, 1);
		const value = await readRepairBackupArchive(new Blob(target.parts)); assert.equal(value.document.schemaVersion, 8);
		assert.deepEqual(packedPhotos(value.document, value.entries).photos, before);
		const header = value.document.developPresetPack as { entry: string; rowSchemaVersion: number; revision: number; presetCount: number };
		assert.equal(header.entry, 'assets/develop-presets-v4.bin'); assert.equal(header.rowSchemaVersion, 4); assert.equal(header.revision, 1); assert.equal(header.presetCount, 1);
		assert.deepEqual(JSON.parse(new TextDecoder().decode(value.entries.get(header.entry))) as unknown, row);
		const masks = value.document.maskRasters as readonly Resource[], luts = value.document.lutResources as readonly Resource[];
		assert.equal(masks.length, 2); assert.equal(luts.length, 1);
		const opened = f.events.indexOf('open'), original = f.events.indexOf('original'); assert.ok(opened >= 0 && original > opened);
		for (const resource of [...masks, ...luts]) {
			assert.ok(value.entries.get(resource.entry)); assert.ok(f.events.indexOf(`${masks.includes(resource) ? 'brush' : 'lut'}:${resource.id}`) < opened);
		}
		assert.deepEqual((row as { presets: unknown[] }).presets, [preset]); assert.deepEqual(await f.row(), row); assert.deepEqual(await f.inspect(), before);
		assert.ok(f.borrowed.length > 0 && f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await f.close(); }
});

test('empty sticky native Row4 remains present at its exact revision and still chooses Archive8', async () => {
	const f = await repairBackupCurrentFixture('legacy');
	try {
		await f.savePreset(); await f.session.develop.presetsCurrent!.write({ schemaVersion: 3, catalogId: f.root.id,
			command: { type: 'delete', expectedRevision: 1, presetId: 'portable' } });
		const row = await f.row(), value = await archive(f), header = value.document.developPresetPack as { entry: string; rowSchemaVersion: number; revision: number; presetCount: number };
		assert.equal(value.document.schemaVersion, 8); assert.equal(header.rowSchemaVersion, 4); assert.equal(header.revision, 2); assert.equal(header.presetCount, 0);
		assert.deepEqual(JSON.parse(new TextDecoder().decode(value.entries.get(header.entry))) as unknown, row); assert.deepEqual(await f.row(), row);
		assert.ok(packedPhotos(value.document, value.entries).photos.every(photo => photo.schemaVersion === 1));
	} finally { await f.close(); }
});

for (const brush of [false, true]) test(`whole legacy Current backup preserves exact existing Archive${brush ? 6 : 5} payload bytes`, async () => {
	const f = await repairBackupCurrentFixture('legacy'); let legacy: Awaited<ReturnType<Fixture['legacySession']>> | undefined;
	try {
		if (brush) await f.saveLegacyBrush(); const current = await archive(f); legacy = await f.legacySession(); const old = await legacy.backupCatalog(); assert.ok(old.blob);
		const previous = await readRepairBackupArchive(old.blob); assert.equal(current.document.schemaVersion, brush ? 6 : 5);
		assert.deepEqual(current.document, previous.document); assert.deepEqual(current.entries, previous.entries);
	} finally { await legacy?.close(); await f.close(); }
});

test('preset-only unused corrupt body refuses before Original or writable and leaves the native row unchanged', async () => {
	const f = await repairBackupCurrentFixture('legacy'), target = repairBackupDestination(f.events);
	try {
		const preset = await f.savePreset(true), reference = preset.settings.develop.masks[0]!.inputs[1]!.sourceRef;
		await f.corruptResource(reference); const row = await f.row(), before = await f.inspect();
		await assert.rejects(f.session.backupCatalog({ createWritable: target.createWritable }));
		assert.equal(f.events.includes('original'), false); assert.equal(f.events.includes('open'), false); assert.equal(f.events.includes('commit'), false);
		assert.deepEqual(await f.row(), row); assert.deepEqual(await f.inspect(), before); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await f.close(); }
});

for (const sourceRef of ['foreign-source', `brush-mask-v2:3:1:${'a'.repeat(64)}`]) test(`complete native preset ${sourceRef} declaration refuses before any resource, Original or destination`, async () => {
	const f = await repairBackupCurrentFixture('legacy'), target = repairBackupDestination(f.events);
	try {
		const preset = await f.savePreset(true), base = preset.settings.develop, graph = base.masks[0]!;
		const develop = normalizeImageDevelopStateCurrentV1({ ...base, masks: [{ ...graph, inputs: [...graph.inputs, { name: 'foreign', sourceRef, kind: 'alpha' }] }] });
		const changed = createImageDevelopSelectedPresetV4({ schemaVersion: 4, id: preset.identity.id, name: preset.identity.name, settings: { ...preset.settings, develop } });
		const row = { schemaVersion: 4, kind: 'photo-develop-presets', catalogId: f.root.id, revision: 1, presets: [changed] }; await f.writeRow(row); f.events.splice(0);
		await assert.rejects(f.session.backupCatalog({ createWritable: target.createWritable })); assert.deepEqual(f.events, []); assert.deepEqual(await f.row(), row);
	} finally { await f.close(); }
});

test('late native preset revision drift prevents destination Close after real streaming began', async () => {
	const f = await repairBackupCurrentFixture('legacy'), parts: Uint8Array<ArrayBuffer>[] = []; let changed = false;
	try {
		await f.savePreset(); const row = await f.row() as Record<string, unknown>, before = await f.inspect();
		const writable = new WritableStream<Uint8Array>({ async write(bytes) {
			parts.push(new Uint8Array(bytes)); if (!changed) { changed = true; await f.writeRow({ ...row, revision: 2 }); }
		}, close() { f.events.push('commit'); }, abort() { f.events.push('abort'); } });
		await assert.rejects(f.session.backupCatalog({ createWritable: async () => { f.events.push('open'); return writable; } }));
		assert.equal(changed, true); assert.ok(parts.length > 0); assert.equal(f.events.includes('commit'), false); assert.equal(f.events.includes('abort'), true);
		assert.equal(writable.locked, false); assert.deepEqual(await f.inspect(), before);
	} finally { await f.close(); }
});

test('actual Current backup cancellation and Session Close join held preset brush bytes before wipe and refuse any destination', async () => {
	const f = await repairBackupCurrentFixture('legacy'), entered = deferred<void>(), release = deferred<void>(), target = repairBackupDestination(f.events);
	const stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); const joining: { work?: ReturnType<typeof outcome>; close?: Promise<void> } = {};
	let held: Uint8Array<ArrayBuffer> | undefined;
	try {
		await f.savePreset(true); f.hooks.beforeBrush = async (_reference, bytes) => { held = bytes; entered.resolve(); await release.promise; };
		const work = f.session.backupCatalog({ createWritable: target.createWritable, signal: stop.signal }); joining.work = outcome(work);
		assert.equal(await Promise.race([entered.promise.then(() => true), joining.work.then(() => false)]), true);
		stop.abort(opaque.proxy); joining.close = f.session.close(); assert.equal(await remainsPending(joining.close), true); assert.ok(held?.some(byte => byte !== 0));
		release.resolve(); const observed = await joining.work; assert.equal(observed.ok, false); if (!observed.ok) assert.equal(observed.error, opaque.proxy);
		await joining.close; assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0))); assert.equal(f.events.includes('open'), false); assert.equal(f.events.includes('original'), false);
	} finally { release.resolve(); await joining.work; await joining.close?.catch(() => undefined); await f.close(); }
});

test('Current backup native preabort precedes hostile option reflection with exact opaque reason', async () => {
	const f = await repairBackupCurrentFixture(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); stop.abort(opaque.proxy); let reflected = 0;
	try {
		const options = new Proxy({ signal: stop.signal }, { ownKeys() { reflected++; throw new Error('Late backup option reflection'); } });
		const observed = await outcome(f.session.backupCatalog(options)); assert.equal(observed.ok, false);
		if (!observed.ok) assert.equal(observed.error, opaque.proxy); assert.equal(reflected, 0); assert.deepEqual(f.events, []);
	} finally { await f.close(); }
});

test('permanent strict legacy Session backup refuses genuine retained Photo3 before resource/original/destination capabilities', async () => {
	const f = await repairBackupCurrentFixture('redo'), target = repairBackupDestination(f.events); let legacy: Awaited<ReturnType<Fixture['legacySession']>> | undefined;
	try { legacy = await f.legacySession(); await assert.rejects(legacy.backupCatalog({ createWritable: target.createWritable })); assert.deepEqual(f.events, []); }
	finally { await legacy?.close(); await f.close(); }
});
