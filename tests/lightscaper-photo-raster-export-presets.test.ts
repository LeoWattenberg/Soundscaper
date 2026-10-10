/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { normalizePhotoRasterExportPresetV1 } from '../src/lightscaper/controller/photo-raster-export-preset-v1.ts';
import { normalizePhotoExportPresetRowV1, readPhotoExportPresetsV1, readPhotoExportPresetV1, writePhotoExportPresetV1, photoExportPresetsKeyV1, PhotoExportPresetConflictError } from '../src/lightscaper/storage/photo-raster-export-presets-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
const RECIPE = { schemaVersion: 1, id: 'preset', name: 'Print', format: 'png', filenameTemplate: '{name}-{index:3}', sidecarEnabled: false,
	output: { sizing: { kind: 'percentage', percentage: 50 }, quality: 'nearest', metadataScope: 'capture', sharpen: { amount: 37, threshold: 9 } } };
function repository() { return new KeyValueRepository({ memory: getMemoryDatabase(`export-presets-${crypto.randomUUID()}`), database: async () => null }, 'settings'); }

for (const sizing of [{ kind: 'original' }, { kind: 'fit', width: 12, height: 9, allowUpscale: false },
	{ kind: 'long-edge', pixels: 12, allowUpscale: true }, { kind: 'megapixels', megapixels: 0.0001, allowUpscale: false },
	{ kind: 'percentage', percentage: 50 }]) test(`preset admission preserves actual ${sizing.kind} output and filename semantics`, () => {
	const captured = normalizePhotoRasterExportPresetV1({ ...RECIPE, output: { ...RECIPE.output, sizing } });
	assert.deepEqual(captured.output.sizing, sizing); assert.deepEqual(captured.output.sharpen, { amount: 37, threshold: 9 });
	assert.equal(captured.output.metadataScope, 'capture'); assert.equal(captured.filenameTemplate, '{name}-{index:3}'); assert.ok(Object.isFrozen(captured.output.sizing));
});
for (const key of ['photoId', 'versionId', 'body', 'handle', 'graphic', 'textWatermark']) test(`closed scalar presets refuse ${key} without granting future authority`, () => {
	assert.throws(() => normalizePhotoRasterExportPresetV1({ ...RECIPE, [key]: key === 'body' ? new Blob(['private']) : {} }), TypeError);
});
test('preset admission does not invoke accessors, accepts no unknown output field, and bounds actual names/templates', () => {
	let read = 0; const accessor = { ...RECIPE }; Object.defineProperty(accessor, 'name', { enumerable: true, get() { read++; return 'Hidden'; } });
	assert.throws(() => normalizePhotoRasterExportPresetV1(accessor), TypeError); assert.equal(read, 0);
	for (const patch of [{ name: ' ' }, { id: ' bad' }, { name: 'x'.repeat(257) }, { filenameTemplate: '{clock}' },
		{ output: { ...RECIPE.output, textWatermark: { text: 'future' } } }, { output: { ...RECIPE.output, sizing: { kind: 'percentage', percentage: Infinity } } }]) {
		assert.throws(() => normalizePhotoRasterExportPresetV1({ ...RECIPE, ...patch }));
	}
});
test('actual selected settings CAS retains scalar recipes across readers, rejects stale delete and bounds capacity', async () => {
	const r = repository(); let snapshot = await readPhotoExportPresetsV1(r, 'catalog'); assert.equal(snapshot.revision, 0);
	for (let index = 0; index < 16; index++) snapshot = await writePhotoExportPresetV1(r, 'catalog', { type: 'save', expectedRevision: snapshot.revision, preset: { ...RECIPE, id: `preset-${index}` } });
	assert.equal(snapshot.presets.length, 16);
	await assert.rejects(writePhotoExportPresetV1(r, 'catalog', { type: 'save', expectedRevision: snapshot.revision, preset: { ...RECIPE, id: 'overflow' } }), RangeError);
	await assert.rejects(writePhotoExportPresetV1(r, 'catalog', { type: 'delete', expectedRevision: 0, presetId: 'preset-0' }), PhotoExportPresetConflictError);
	const before = await r.get(photoExportPresetsKeyV1('catalog'));
	assert.throws(() => normalizePhotoExportPresetRowV1(before, 'different'), /foreign/u);
	assert.deepEqual((await readPhotoExportPresetV1(r, 'catalog', 'preset-0', snapshot.revision)).preset, { ...RECIPE, id: 'preset-0' });
	await writePhotoExportPresetV1(r, 'catalog', { type: 'delete', expectedRevision: snapshot.revision, presetId: 'preset-0' });
	assert.equal((await readPhotoExportPresetsV1(r, 'catalog')).presets.length, 15);
});
test('lost CAS ACK reconciles only the exact complete next row and retains opaque refusal identity otherwise', async () => {
	const r = repository(), primary = new Proxy({}, { get() { assert.fail('Opaque failure reflected'); } });
	const committed = { get: r.get.bind(r), readEntry: r.readEntry.bind(r), replaceIfCurrent: r.replaceIfCurrent.bind(r),
		async putIfAbsent(key: string, value: unknown) { await r.putIfAbsent(key, value); throw primary; } };
	assert.equal((await writePhotoExportPresetV1(committed, 'catalog', { type: 'save', expectedRevision: 0, preset: RECIPE })).revision, 1);
	const refused = { ...committed, async putIfAbsent() { throw primary; } };
	let observed: unknown;
	try { await writePhotoExportPresetV1(refused, 'other', { type: 'save', expectedRevision: 0, preset: RECIPE }); } catch (cause) { observed = cause; }
	assert.equal(observed === primary, true);
});
test('distinct opaque publication and readback failures stay in an owned immutable-error relationship', async () => {
	const r = repository(), primary = Symbol('publication'), cleanup = undefined; let reads = 0;
	const ports = { get: r.get.bind(r), replaceIfCurrent: r.replaceIfCurrent.bind(r),
		readEntry(key: string) { if (reads++) return Promise.reject(cleanup); return r.readEntry(key); }, putIfAbsent: async () => { throw primary; } };
	await assert.rejects(writePhotoExportPresetV1(ports, 'catalog', { type: 'save', expectedRevision: 0, preset: RECIPE }), error => {
		assert.ok(error instanceof AggregateError); assert.equal(error.cause, primary); assert.deepEqual(error.errors, [primary, cleanup]); return true;
	});
});
test('truthy non-boolean CAS ACK is refused and malformed physical row presence cannot masquerade as empty', async () => {
	const r = repository(), ports = { get: r.get.bind(r), readEntry: r.readEntry.bind(r), replaceIfCurrent: r.replaceIfCurrent.bind(r), putIfAbsent: async () => 'yes' as unknown as boolean };
	await assert.rejects(writePhotoExportPresetV1(ports, 'catalog', { type: 'save', expectedRevision: 0, preset: RECIPE }), PhotoExportPresetConflictError);
	await r.putIfAbsent(photoExportPresetsKeyV1('catalog'), undefined);
	await assert.rejects(readPhotoExportPresetsV1(r, 'catalog'), /value|present/u);
});
test('held entry read pins current native capabilities and detaches the complete requested scalar recipe', async () => {
	const r = repository(), entered = deferred<void>(), release = deferred<void>();
	const ports = { get: r.get.bind(r), putIfAbsent: r.putIfAbsent.bind(r), replaceIfCurrent: r.replaceIfCurrent.bind(r), async readEntry(key: string) {
		assert.equal(this, ports); entered.resolve(); await release.promise; return r.readEntry(key);
	} };
	const mutable = structuredClone(RECIPE), work = writePhotoExportPresetV1(ports, 'catalog', { type: 'save', expectedRevision: 0, preset: mutable });
	try {
		await entered.promise; assert.equal(await remainsPending(work), true); mutable.output.sizing.percentage = 99;
		ports.putIfAbsent = async () => assert.fail('Replaced CAS was borrowed'); release.resolve(); await work;
		assert.equal(((await readPhotoExportPresetV1(r, 'catalog', 'preset', 1)).preset.output.sizing as { percentage: number }).percentage, 50);
	} finally { release.resolve(); await work.catch(() => undefined); }
});
