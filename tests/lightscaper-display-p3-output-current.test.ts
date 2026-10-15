/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJsonSha256 } from '../src/common/canonical-json-sha256.ts';
import { capturePhotoRasterExportOutput } from '../src/lightscaper/controller/photo-raster-export-contract-v1.ts';
import { capturePhotoRasterExportOutputCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-output-current-v1.ts';
import { normalizePhotoRasterExportPresetV1 } from '../src/lightscaper/controller/photo-raster-export-preset-v1.ts';
import { normalizePhotoRasterExportPresetCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-preset-current-v1.ts';
import { capturePhotoRasterExportBatchV1 } from '../src/lightscaper/controller/photo-raster-export-batch-v1.ts';
import { capturePhotoRasterExportBatchCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-batch-current-v1.ts';
import { createPhotoRasterExportJournalCurrentV1, normalizePhotoRasterExportJournalCurrentV1 } from '../src/lightscaper/storage/photo-raster-export-journal-current-v1.ts';
import { normalizePhotoRasterExportJournalV1 } from '../src/lightscaper/storage/photo-raster-export-journal-v1.ts';
import { PhotoRasterExportJournalOwnerCurrentV1 } from '../src/lightscaper/storage/photo-raster-export-journal-owner-current-v1.ts';
import { PhotoRasterExportJournalOwnerV1 } from '../src/lightscaper/storage/photo-raster-export-journal-owner-v1.ts';
import { reconcilePhotoRasterExportBatchRecoveryCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-batch-recovery-current-v1.ts';
import { assertPhotoRasterJournalPlanCurrentV1, createPhotoRasterJournalDestinationsCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-journal-destinations-current-v1.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { PhotoExportPresetConflictError } from '../src/lightscaper/storage/photo-raster-export-presets-v1.ts';
import { repairSettingsFixture } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { repairRasterFixture } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';

const COMMON = { sizing: { kind: 'percentage' as const, percentage: 50 }, quality: 'nearest' as const,
	metadataScope: 'capture' as const, sharpen: { amount: 31, threshold: 4 } };
const output = (profile: 'srgb' | 'display-p3' = 'display-p3', bitDepth: 8 | 16 = 16) => ({ schemaVersion: 3 as const, profile, bitDepth, ...COMMON });
const preset = () => ({ schemaVersion: 1 as const, id: 'p3-print', name: 'Display P3 print', format: 'png' as const,
	filenameTemplate: '{name}', sidecarEnabled: true, output: output() });
const rawPlan = () => ({ schemaVersion: 1, batchId: 'p3-batch', format: 'png', filenameTemplate: '{name}', output: output(),
	members: [{ photoId: 'photo', versionId: 'main', expectedRevision: 3, sourceFileName: 'Native.DNG' }] });

test('Current explicit Output3 captures profile and depth without changing either legacy output representation', () => {
	assert.equal(JSON.stringify(capturePhotoRasterExportOutputCurrentV1(COMMON, 'png')), JSON.stringify(capturePhotoRasterExportOutput(COMMON)));
	for (const bitDepth of [8, 16] as const) {
		const previous = { schemaVersion: 2, bitDepth, ...COMMON };
		assert.deepEqual(capturePhotoRasterExportOutputCurrentV1(previous, 'png'), previous);
		for (const profile of ['srgb', 'display-p3'] as const) {
			const raw = output(profile, bitDepth), captured = capturePhotoRasterExportOutputCurrentV1(raw, 'png');
			assert.deepEqual(captured, raw); assert.ok(Object.isFrozen(captured)); assert.ok(Object.isFrozen(captured.sizing));
			assert.deepEqual(capturePhotoRasterExportOutputCurrentV1(JSON.parse(JSON.stringify(captured)), 'png'), raw);
			assert.throws(() => capturePhotoRasterExportOutput(raw), /unsupported field/u);
		}
	}
	assert.deepEqual(capturePhotoRasterExportOutputCurrentV1(output('srgb', 8), 'jpeg'), output('srgb', 8));
});

test('Current profile admission refuses unsupported JPEG profiles and hostile or incomplete Output3 metadata', () => {
	for (const bitDepth of [8, 16] as const) assert.throws(() => capturePhotoRasterExportOutputCurrentV1(output('display-p3', bitDepth), 'jpeg'), /PNG|JPEG|profile/u);
	assert.throws(() => capturePhotoRasterExportOutputCurrentV1(output('srgb', 16), 'jpeg'), /requires PNG/u);
	for (const patch of [{ profile: 'adobe-rgb' }, { profile: undefined }, { schemaVersion: 4 }, { bitDepth: 12 }, { extra: true }])
		assert.throws(() => capturePhotoRasterExportOutputCurrentV1({ ...output(), ...patch }, 'png'));
	const missing = { ...output() }; Reflect.deleteProperty(missing, 'profile');
	assert.throws(() => capturePhotoRasterExportOutputCurrentV1(missing, 'png'));
	assert.throws(() => capturePhotoRasterExportOutputCurrentV1({ ...output(), schemaVersion: 2 }, 'png'));
	let reads = 0;
	const hostile = Object.defineProperty({ ...output() }, 'profile', { enumerable: true, get() { reads++; return 'display-p3'; } });
	assert.throws(() => capturePhotoRasterExportOutputCurrentV1(hostile, 'png'), /data/u); assert.equal(reads, 0);
});

test('Current preset, Batch1, Journal1 and reviewed recovery retain the exact explicit profile while permanent readers refuse it', () => {
	assert.deepEqual(normalizePhotoRasterExportPresetCurrentV1(preset()), preset());
	assert.throws(() => normalizePhotoRasterExportPresetV1(preset()));
	const plan = capturePhotoRasterExportBatchCurrentV1(rawPlan());
	const binding = { originalSha256: '1'.repeat(64), recipeSha256: '2'.repeat(64), lutSha256: [] };
	const journal = createPhotoRasterExportJournalCurrentV1(plan, { catalogId: 'catalog', filenameTemplate: '{name}', bindings: [binding] });
	assert.equal(journal.schemaVersion, 1); assert.deepEqual(journal.output, output());
	assert.deepEqual(normalizePhotoRasterExportJournalCurrentV1(JSON.parse(JSON.stringify(journal))), journal);
	assert.equal(reconcilePhotoRasterExportBatchRecoveryCurrentV1(journal, { catalogId: 'catalog', members: [
		{ photoId: 'photo', versionId: 'main', expectedRevision: 3, binding } ] })[0]!.disposition, 'eligible');
	assert.throws(() => capturePhotoRasterExportBatchV1(rawPlan())); assert.throws(() => normalizePhotoRasterExportJournalV1(journal));
});

test('actual Current Session persists and reopens Output3 presets with exact Original custody and stale-CAS refusal', async () => {
	const f = await repairSettingsFixture(1);
	let reopened: Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>> | undefined;
	try {
		const before = await f.inspect(), access = await f.session.exportPresetsCurrent!.open();
		const saved = await access.write({ schemaVersion: 1, command: { type: 'save', expectedRevision: 0, preset: preset() } });
		assert.deepEqual((await access.read({ schemaVersion: 1, presetId: preset().id, expectedRevision: saved.snapshot.revision })).preset, preset());
		const legacy = await f.session.exportPresets!.open();
		await assert.rejects(legacy.read({ schemaVersion: 1, presetId: preset().id, expectedRevision: saved.snapshot.revision }));
		assert.deepEqual(await f.inspect(), before);
		await f.session.close(); await assert.rejects(access.list({ schemaVersion: 1 }), /closed/u);
		reopened = await createPhotoLibrarySessionCurrentV1(f.options);
		const fresh = await reopened.exportPresetsCurrent!.open();
		const snapshot = await fresh.list({ schemaVersion: 1 }); assert.equal(snapshot.revision, saved.snapshot.revision);
		assert.deepEqual((await fresh.read({ schemaVersion: 1, presetId: preset().id, expectedRevision: snapshot.revision })).preset, preset());
		await assert.rejects(fresh.write({ schemaVersion: 1, command: { type: 'delete', expectedRevision: 0, presetId: preset().id } }), PhotoExportPresetConflictError);
		assert.deepEqual(await f.inspect(), before);
	} finally { await reopened?.close(); await f.close(); }
});

test('actual Current native journal retains Output3 across ACK transitions, reopen and recovery destination binding', async () => {
	const f = await repairRasterFixture(), photo = f.photos[0]!;
	const plan = capturePhotoRasterExportBatchCurrentV1({ ...rawPlan(), members: [{ photoId: photo.id, versionId: photo.activeVersionId,
		expectedRevision: photo.revision, sourceFileName: photo.metadata.fileName }] });
	const binding = { originalSha256: photo.original.contentSha256, recipeSha256: canonicalJsonSha256(photo.versions[0]!.develop), lutSha256: [] };
	const native = await f.openJournal(), owner = new PhotoRasterExportJournalOwnerCurrentV1(native.settings, photo.catalogId);
	let reopened: PhotoRasterExportJournalOwnerCurrentV1 | undefined, legacy: PhotoRasterExportJournalOwnerV1 | undefined, acquired = 0;
	try {
		const before = await f.inspect();
		await owner.create(createPhotoRasterExportJournalCurrentV1(plan, { catalogId: photo.catalogId, filenameTemplate: '{name}', bindings: [binding] }));
		await owner.started(plan.members[0]!.jobId);
		await owner.committed(plan.members[0]!.jobId, { status: 'download-started', method: 'download', fileName: plan.members[0]!.fileName, size: 123 });
		await owner.closeAndJoin(); reopened = new PhotoRasterExportJournalOwnerCurrentV1(native.settings, photo.catalogId);
		const saved = await reopened.load(); assert.ok(saved); assert.equal(saved.revision, 3); assert.deepEqual(saved.output, output());
		assert.equal(saved.members[0]!.state, 'committed'); assert.equal(saved.members[0]!.delivery!.size, 123);
		assertPhotoRasterJournalPlanCurrentV1(plan, reopened);
		const changed = capturePhotoRasterExportBatchCurrentV1({ ...rawPlan(), output: output('srgb'), members: [{ photoId: photo.id,
			versionId: photo.activeVersionId, expectedRevision: photo.revision, sourceFileName: photo.metadata.fileName }] });
		assert.throws(() => assertPhotoRasterJournalPlanCurrentV1(changed, reopened!));
		assert.throws(() => createPhotoRasterJournalDestinationsCurrentV1(changed, reopened!, () => { acquired++; assert.fail('profile mismatch must precede destination acquisition'); }));
		legacy = new PhotoRasterExportJournalOwnerV1(native.settings, photo.catalogId); await assert.rejects(legacy.load());
		assert.equal(acquired, 0); assert.deepEqual(await f.inspect(), before); assert.equal(f.outputs.length, 0); assert.equal(f.codecs.calls.opens, 0);
	} finally { await Promise.all([owner.closeAndJoin(), reopened?.closeAndJoin(), legacy?.closeAndJoin()]); await f.close(); }
});
