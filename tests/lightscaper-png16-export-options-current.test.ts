/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoLibraryExportPresetsPortV1 } from '../src/common/editor/photo-library-export-presets-port-v1.ts';
import { capturePhotoRasterExportOutput } from '../src/lightscaper/controller/photo-raster-export-contract-v1.ts';
import { capturePhotoRasterExportOutputCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-output-current-v1.ts';
import { normalizePhotoRasterExportPresetV1 } from '../src/lightscaper/controller/photo-raster-export-preset-v1.ts';
import { normalizePhotoRasterExportPresetCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-preset-current-v1.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { readPhotoExportPresetCurrentV1, writePhotoExportPresetCurrentV1 } from '../src/lightscaper/storage/photo-raster-export-presets-current-v1.ts';
import { readPhotoExportPresetV1, PhotoExportPresetConflictError } from '../src/lightscaper/storage/photo-raster-export-presets-v1.ts';
import { deferred } from './helpers/async-test-control.ts';
import { repairSettingsFixture } from './helpers/lightscaper-repair-settings-current-fixture.ts';

const PRESET = { schemaVersion: 1 as const, id: 'png16', name: 'Native PNG', format: 'png' as const, filenameTemplate: '{name}', sidecarEnabled: false,
	output: { schemaVersion: 2 as const, bitDepth: 16 as const, sizing: { kind: 'original' as const }, quality: 'bilinear' as const, metadataScope: 'strip' as const } };

test('actual Current Session stores and reads explicit PNG16 output through its named export preset child', async () => {
	const f = await repairSettingsFixture(1);
	let reopened: Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>> | undefined;
	try {
		const custody = await f.inspect();
		const current = f.session as typeof f.session & { readonly exportPresetsCurrent?: Readonly<PhotoLibraryExportPresetsPortV1> };
		assert.ok(current.exportPresetsCurrent, 'The selected Current Session needs its explicit output-version-aware preset child.');
		const access = await current.exportPresetsCurrent.open();
		const saved = await access.write({ schemaVersion: 1, command: { type: 'save', expectedRevision: 0, preset: PRESET } });
		const read = await access.read({ schemaVersion: 1, presetId: PRESET.id, expectedRevision: saved.snapshot.revision });
		assert.deepEqual(read.preset, PRESET);
		assert.deepEqual(await f.inspect(), custody);
		const legacy = await f.session.exportPresets!.open();
		await assert.rejects(legacy.read({ schemaVersion: 1, presetId: PRESET.id, expectedRevision: saved.snapshot.revision }), /unsupported field/u);
		await f.session.close(); await assert.rejects(access.list({ schemaVersion: 1 }), /closed/u);
		reopened = await createPhotoLibrarySessionCurrentV1(f.options);
		const fresh = await reopened.exportPresetsCurrent!.open(), snapshot = await fresh.list({ schemaVersion: 1 });
		assert.equal(snapshot.revision, saved.snapshot.revision);
		assert.deepEqual((await fresh.read({ schemaVersion: 1, presetId: PRESET.id, expectedRevision: snapshot.revision })).preset, PRESET);
		await assert.rejects(fresh.write({ schemaVersion: 1, command: { type: 'delete', expectedRevision: 0, presetId: PRESET.id } }), PhotoExportPresetConflictError);
	} finally { await reopened?.close(); await f.close(); }
});

test('Current output captures keep default bytes exact and explicit output versions roundtrip without widening legacy admission', () => {
	const legacy = { sizing: { kind: 'percentage', percentage: 50 }, quality: 'nearest', metadataScope: 'capture', sharpen: { amount: 31, threshold: 4 } };
	assert.deepEqual(capturePhotoRasterExportOutputCurrentV1(legacy, 'png'), capturePhotoRasterExportOutput(legacy));
	assert.equal(JSON.stringify(capturePhotoRasterExportOutputCurrentV1(legacy, 'jpeg')), JSON.stringify(capturePhotoRasterExportOutput(legacy)));
	for (const bitDepth of [8, 16] as const) {
		const value = { schemaVersion: 2, bitDepth, ...legacy }, output = capturePhotoRasterExportOutputCurrentV1(value, 'png');
		assert.deepEqual(output, value); assert.deepEqual(capturePhotoRasterExportOutputCurrentV1(JSON.parse(JSON.stringify(output)), 'png'), value);
		assert.equal(Object.isFrozen(output), true); assert.equal(Object.isFrozen(output.sizing), true);
		assert.throws(() => capturePhotoRasterExportOutput(value), /unsupported field/u);
	}
	assert.deepEqual(normalizePhotoRasterExportPresetCurrentV1(PRESET), PRESET);
	assert.throws(() => normalizePhotoRasterExportPresetV1(PRESET), /unsupported field/u);
});

test('future output versions, JPEG16 and hostile fields refuse without invoking getters', () => {
	let reads = 0;
	for (const patch of [{ schemaVersion: 3 }, { schemaVersion: 1 }, { bitDepth: 12 }, { bitDepth: '16' }, { extra: true }]) {
		assert.throws(() => capturePhotoRasterExportOutputCurrentV1({ ...PRESET.output, ...patch }, 'png'));
	}
	assert.throws(() => capturePhotoRasterExportOutputCurrentV1({ ...PRESET.output, schemaVersion: undefined }, 'png'));
	assert.throws(() => capturePhotoRasterExportOutputCurrentV1(PRESET.output, 'jpeg'), /requires PNG/u);
	assert.throws(() => normalizePhotoRasterExportPresetCurrentV1({ ...PRESET, format: 'jpeg' }), /requires PNG/u);
	const hostile = Object.defineProperty({ ...PRESET.output }, 'bitDepth', { enumerable: true, get() { reads++; return 16; } });
	assert.throws(() => capturePhotoRasterExportOutputCurrentV1(hostile, 'png'), /data/u); assert.equal(reads, 0);
});

test('Current storage captures Output2 before held reads and retains its positive native CAS ACK through late abort', async () => {
	const repository = new KeyValueRepository({ memory: getMemoryDatabase(`png16-presets-${crypto.randomUUID()}`), database: async () => null }, 'settings');
	const entered = deferred<void>(), release = deferred<void>(), readEntered = deferred<void>(), readRelease = deferred<void>();
	const stop = new AbortController(), mutable = structuredClone(PRESET);
	const settings = { get: repository.get.bind(repository), replaceIfCurrent: repository.replaceIfCurrent.bind(repository),
		async readEntry(key: string) { readEntered.resolve(); await readRelease.promise; return repository.readEntry(key); },
		async putIfAbsent(key: string, value: unknown) { const ack = await repository.putIfAbsent(key, value); entered.resolve(); await release.promise; return ack; } };
	const work = writePhotoExportPresetCurrentV1(settings, 'catalog', { type: 'save', expectedRevision: 0, preset: mutable }, { signal: stop.signal });
	try {
		await readEntered.promise; Reflect.set(mutable.output, 'bitDepth', 8); readRelease.resolve();
		await entered.promise; stop.abort(Symbol('after native CAS'));
		release.resolve(); assert.equal((await work).revision, 1);
		assert.deepEqual((await readPhotoExportPresetCurrentV1(repository, 'catalog', PRESET.id, 1)).preset, PRESET);
		await assert.rejects(readPhotoExportPresetV1(repository, 'catalog', PRESET.id, 1), /unsupported field/u);
	} finally { readRelease.resolve(); release.resolve(); await work.catch(() => undefined); }
});
