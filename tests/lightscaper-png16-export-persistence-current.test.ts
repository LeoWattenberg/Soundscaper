/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJsonSha256 } from '../src/common/canonical-json-sha256.ts';
import { capturePhotoRasterExportBatchV1 } from '../src/lightscaper/controller/photo-raster-export-batch-v1.ts';
import { capturePhotoRasterExportOutputCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-output-current-v1.ts';
import { createPhotoRasterExportJournalV1, normalizePhotoRasterExportJournalV1 } from '../src/lightscaper/storage/photo-raster-export-journal-v1.ts';
import { PhotoRasterExportJournalOwnerCurrentV1 } from '../src/lightscaper/storage/photo-raster-export-journal-owner-current-v1.ts';
import { PhotoRasterExportJournalOwnerV1 } from '../src/lightscaper/storage/photo-raster-export-journal-owner-v1.ts';
import { capturePhotoRasterExportBatchCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-batch-current-v1.ts';
import { createPhotoRasterExportJournalCurrentV1, normalizePhotoRasterExportJournalCurrentV1 } from '../src/lightscaper/storage/photo-raster-export-journal-current-v1.ts';
import { PhotoRasterExportBatchQueueCurrentV1, type PhotoRasterExportBatchRuntimeCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-batch-queue-current-v1.ts';
import { PhotoRasterExportBatchQueue } from '../src/lightscaper/controller/photo-raster-export-batch-queue.ts';
import { PhotoRasterPersistedBatchCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-persisted-batch-current-v1.ts';
import { assertPhotoRasterJournalPlanCurrentV1, createPhotoRasterJournalDestinationsCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-journal-destinations-current-v1.ts';
import { reconcilePhotoRasterExportBatchRecoveryCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-batch-recovery-current-v1.ts';
import { reconcilePhotoRasterExportBatchRecoveryV1 } from '../src/lightscaper/controller/photo-raster-export-batch-recovery-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { encodePixelFramePng16V1 } from '../src/common/editor/imaging/pixel-frame-png16-v1.ts';
import { repairRasterFixture } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';
import type { PhotoRasterExportBatchDestinations } from '../src/lightscaper/controller/photo-raster-export-batch-queue.ts';

const output16 = () => capturePhotoRasterExportOutputCurrentV1({ schemaVersion: 2, bitDepth: 16,
	sizing: { kind: 'long-edge', pixels: 1200, allowUpscale: false }, quality: 'bilinear', metadataScope: 'strip',
	sharpen: { amount: 25, threshold: 0 }, textWatermark: { schemaVersion: 1, font: 'inter-600-latin', color: '#ffffff', text: 'Native depth', anchor: 'bottom-right', widthFraction: .3,
		marginFraction: .02, opacity: .5 } }, 'png');
type Fixture = Awaited<ReturnType<typeof repairRasterFixture>>;
function rawPlan(f: Fixture) { return { schemaVersion: 1, batchId: 'depth-queue', format: 'png', filenameTemplate: '{index:2}-{name}',
	members: f.photos.map(photo => ({ photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision, sourceFileName: photo.metadata.fileName })),
	output: { schemaVersion: 2, bitDepth: 16, sizing: { kind: 'original' }, quality: 'nearest' } }; }
function prepare(f: Fixture, recovery = false) { return PhotoRasterPersistedBatchCurrentV1.prepare({
	selection: recovery ? [] : f.photos.map(photo => ({ photoId: photo.id, fileName: photo.metadata.fileName })), execute: f.execute,
	readSidecar: f.readSidecar, openJournal: f.openJournal, signal: new AbortController().signal }); }

test('actual Current native journal preserves nested Output2 through write, CAS transitions and reopen while legacy admission stays strict', async () => {
	const f = await repairRasterFixture(), photo = f.photos[0]!;
	const plan = capturePhotoRasterExportBatchV1({ schemaVersion: 1, batchId: 'native-depth', format: 'png', filenameTemplate: '{name}',
		members: [{ photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision, sourceFileName: photo.metadata.fileName }] });
	const binding = { originalSha256: photo.original.contentSha256, recipeSha256: canonicalJsonSha256(photo.versions[0]!.develop), lutSha256: [] };
	const native = await f.openJournal(), owner = new PhotoRasterExportJournalOwnerCurrentV1(native.settings, photo.catalogId);
	const retained = { ...createPhotoRasterExportJournalV1(plan, { catalogId: photo.catalogId, filenameTemplate: '{name}', bindings: [binding] }), output: output16() };
	let reopened: PhotoRasterExportJournalOwnerCurrentV1 | undefined, legacy: PhotoRasterExportJournalOwnerV1 | undefined;
	try {
		const created = await owner.create(retained); assert.deepEqual(created.output, retained.output);
		await owner.started(plan.members[0]!.jobId);
		await owner.committed(plan.members[0]!.jobId, { status: 'download-started', method: 'download', fileName: plan.members[0]!.fileName, size: 123 });
		await owner.closeAndJoin();
		reopened = new PhotoRasterExportJournalOwnerCurrentV1(native.settings, photo.catalogId);
		const saved = await reopened.load(); assert.ok(saved); assert.equal(saved.schemaVersion, 1); assert.equal(saved.revision, 3);
		assert.deepEqual(saved.output, retained.output); assert.equal(saved.members[0]!.state, 'committed'); assert.equal(saved.members[0]!.delivery!.size, 123);
		assert.throws(() => normalizePhotoRasterExportJournalV1(saved));
		legacy = new PhotoRasterExportJournalOwnerV1(native.settings, photo.catalogId); await assert.rejects(legacy.load());
		assert.equal(f.events.length, 0); assert.equal(f.codecs.calls.opens, 0); assert.deepEqual((await f.inspect())[0]!.bytes, f.bytes);
	} finally { await Promise.all([owner.closeAndJoin(), reopened?.closeAndJoin(), legacy?.closeAndJoin()]); await f.close(); }
});

test('Current scalar Batch1 and Journal1 roundtrips preserve Output2 and refuse unsupported format/depth without widening legacy readers', () => {
	const raw = { schemaVersion: 1, batchId: 'scalar-depth', format: 'png', filenameTemplate: '{name}', output: output16(),
		members: [{ photoId: 'photo-1', versionId: 'main', expectedRevision: 3, sourceFileName: 'Native.DNG' }] };
	const plan = capturePhotoRasterExportBatchCurrentV1(raw), binding = { originalSha256: '1'.repeat(64), recipeSha256: '2'.repeat(64), lutSha256: [] };
	assert.equal(plan.schemaVersion, 1); assert.deepEqual(plan.output, raw.output); assert.ok(Object.isFrozen(plan.output));
	const journal = createPhotoRasterExportJournalCurrentV1(plan, { catalogId: 'catalog', filenameTemplate: '{name}', bindings: [binding] });
	assert.deepEqual(normalizePhotoRasterExportJournalCurrentV1(JSON.parse(JSON.stringify(journal))), journal);
	const current = { catalogId: 'catalog', members: [{ photoId: 'photo-1', versionId: 'main', expectedRevision: 3, binding }] };
	assert.equal(reconcilePhotoRasterExportBatchRecoveryCurrentV1(journal, current)[0]!.disposition, 'eligible');
	assert.throws(() => capturePhotoRasterExportBatchV1(raw)); assert.throws(() => createPhotoRasterExportJournalV1(plan, { catalogId: 'catalog', filenameTemplate: '{name}', bindings: [binding] }));
	assert.throws(() => normalizePhotoRasterExportJournalV1(journal)); assert.throws(() => reconcilePhotoRasterExportBatchRecoveryV1(journal, current));
	for (const changed of [{ ...raw, format: 'jpeg' }, { ...raw, output: { ...raw.output, bitDepth: 12 } }, { ...raw, output: { ...raw.output, schemaVersion: 3 } }]) assert.throws(() => capturePhotoRasterExportBatchCurrentV1(changed));
	assert.throws(() => normalizePhotoRasterExportJournalCurrentV1({ ...journal, format: 'jpeg', members: journal.members.map(member => ({ ...member, fileName: 'Native.jpg' })) }));
	const legacyRaw = { ...raw, output: { sizing: { kind: 'original' }, quality: 'nearest' } };
	assert.deepEqual(capturePhotoRasterExportBatchCurrentV1(legacyRaw), capturePhotoRasterExportBatchV1(legacyRaw));
});

test('actual Current queue persists PNG16, retains the acknowledged first member, and reviewed reopen delivers only the second native PNG16', async () => {
	const f = await repairRasterFixture(undefined, undefined, 2), first = await prepare(f), primary = Symbol('second native refusal');
	const input = f.request(), renderer = createPhotoDevelopRenderRuntimeCurrentV1({ source: f.session.cubeLuts.source, maskSource: f.session.maskRasterSource });
	const depths: number[] = [], plans: unknown[] = [];
	let nativeFailure = true, reopened: PhotoRasterPersistedBatchCurrentV1 | undefined, initial: PhotoRasterExportBatchQueueCurrentV1 | undefined, retry: PhotoRasterExportBatchQueueCurrentV1 | undefined;
	const saves = { prepareSave: input.prepareSave, async saveFile(request: Parameters<typeof input.saveFile>[0]) {
		const fileName = request.fileName; assert.ok(typeof fileName === 'string');
		if (nativeFailure && fileName.startsWith('02-')) throw primary; return input.saveFile(request);
	} };
	const runtime = (owner: PhotoRasterPersistedBatchCurrentV1, recovery = false): PhotoRasterExportBatchRuntimeCurrentV1 => ({
		fileTypeDescription: 'PNG', execute: f.execute, withOriginalFrame: input.withOriginalFrame, loadRenderer: async () => renderer,
		prepareDestinations(plan) { plans.push(plan.output); return recovery ? owner.prepareRecoveryDestinations(plan, saves, ['depth-queue:2'])
			: owner.prepareFreshDestinations(plan, saves, '{index:2}-{name}'); },
		encode(_format, frame, { bitDepth, ...options }) { assert.equal(bitDepth, 16); assert.equal(frame.descriptor.sampleFormat, 'float32'); depths.push(bitDepth); return encodePixelFramePng16V1(frame, options); },
	});
	try {
		initial = new PhotoRasterExportBatchQueueCurrentV1(runtime(first)); await assert.rejects(initial.start(rawPlan(f)));
		assert.deepEqual(first.journal!.members.map(member => member.state), ['committed', 'started']);
		assert.equal(f.outputs.length, 1); assert.equal(f.outputs[0]!.bytes[24], 16);
		const firstAck = first.journal!.members[0]!.delivery, firstBytes = f.outputs[0]!.bytes.slice();
		await first.closeAndJoin(); reopened = await prepare(f, true);
		assert.deepEqual(reopened.recovery.map(entry => entry.disposition), ['already-committed', 'needs-review']);
		assert.deepEqual(reopened.journal!.output, capturePhotoRasterExportBatchCurrentV1(rawPlan(f)).output);
		nativeFailure = false; retry = new PhotoRasterExportBatchQueueCurrentV1(runtime(reopened, true));
		const receipt = await retry.startRecovery(reopened.journal, ['depth-queue:2']);
		assert.deepEqual(receipt.members.map(member => [member.jobId, member.index, member.state]), [['depth-queue:2', 2, 'completed']]);
		assert.deepEqual(reopened.journal!.members.map(member => member.state), ['committed', 'committed']);
		assert.deepEqual(reopened.journal!.members[0]!.delivery, firstAck); assert.deepEqual(f.outputs[0]!.bytes, firstBytes);
		assert.deepEqual(f.outputs.map(row => row.name.slice(0, 3)), ['01-', '02-']); assert.ok(f.outputs.every(row => row.bytes[24] === 16));
		assert.deepEqual(depths, [16, 16, 16]); assert.deepEqual(plans, [capturePhotoRasterExportBatchCurrentV1(rawPlan(f)).output, capturePhotoRasterExportBatchCurrentV1(rawPlan(f)).output]);
		assert.deepEqual((await f.inspect()).map(row => row.bytes), [f.bytes, f.bytes]);
	} finally { await Promise.all([initial?.cancelAndJoin(), retry?.cancelAndJoin(), first.closeAndJoin(), reopened?.closeAndJoin()]); await f.close(); }
});

test('Current destination depth mismatch refuses before native authority and permanent legacy queue refuses Output2 before preparation', async () => {
	const f = await repairRasterFixture(), access = await f.openJournal(), owner = new PhotoRasterExportJournalOwnerCurrentV1(access.settings, f.photos[0]!.catalogId);
	let acquired = 0, legacy: PhotoRasterExportBatchQueue | undefined;
	try {
		const plan = capturePhotoRasterExportBatchCurrentV1(rawPlan(f)), photo = f.photos[0]!;
		await owner.create(createPhotoRasterExportJournalCurrentV1(plan, { catalogId: photo.catalogId, filenameTemplate: '{index:2}-{name}',
			bindings: [{ originalSha256: photo.original.contentSha256, recipeSha256: canonicalJsonSha256(photo.versions[0]!.develop), lutSha256: [] }] }));
		const changed = { ...plan, output: { ...plan.output!, schemaVersion: 2 as const, bitDepth: 8 as const } };
		assert.throws(() => assertPhotoRasterJournalPlanCurrentV1(changed, owner));
		assert.throws(() => createPhotoRasterJournalDestinationsCurrentV1(changed, owner, () => { acquired++; throw new Error('unreachable'); }));
		const input = f.request(), runtime = { fileTypeDescription: 'PNG', execute: f.execute, withOriginalFrame: input.withOriginalFrame, loadRenderer: input.loadRenderer,
			encode: (_format: 'png' | 'jpeg', ...args: Parameters<typeof input.encode>) => input.encode(...args),
			prepareDestinations() { acquired++; throw new Error('unreachable'); } };
		legacy = Reflect.construct(PhotoRasterExportBatchQueue, [runtime]) as PhotoRasterExportBatchQueue;
		await assert.rejects(legacy.start(rawPlan(f))); assert.equal(acquired, 0); assert.equal(f.outputs.length, 0); assert.equal(f.codecs.calls.opens, 0);
	} finally { await legacy?.cancelAndJoin(); await owner.closeAndJoin(); await f.close(); }
});

test('Current queue pins its encoder and glyph receiver before a held destination acquisition', async () => {
	const f = await repairRasterFixture(), input = f.request(), held = deferred<PhotoRasterExportBatchDestinations>();
	const renderer = createPhotoDevelopRenderRuntimeCurrentV1({ source: f.session.cubeLuts.source, maskSource: f.session.maskRasterSource });
	let glyphs = 0, encoded = 0;
	const runtime: PhotoRasterExportBatchRuntimeCurrentV1 = {
		fileTypeDescription: 'PNG', execute: f.execute, withOriginalFrame: input.withOriginalFrame, loadRenderer: async () => renderer,
		prepareDestinations() { assert.equal(this, runtime); return held.promise; },
		encode(_format, frame, { bitDepth, ...options }) { assert.equal(this, runtime); assert.equal(bitDepth, 16); encoded++; return encodePixelFramePng16V1(frame, options); },
		async withTextFrame(_request, consume) { assert.equal(this, runtime); glyphs++;
			return consume({ descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: Uint8Array.of(0, 0, 255, 255) });
		},
	};
	const queue = new PhotoRasterExportBatchQueueCurrentV1(runtime), raw = rawPlan(f);
	const work = queue.start({ ...raw, output: { ...raw.output, textWatermark: { schemaVersion: 1, text: 'Glyph', font: 'inter-600-latin',
		color: '#0000ff', anchor: 'bottom-right', widthFraction: 1 / 3, marginFraction: 0, opacity: 1 } } });
	void work.catch(() => undefined);
	Object.defineProperty(runtime, 'encode', { value() { assert.fail('late encoder replacement'); } });
	Object.defineProperty(runtime, 'withTextFrame', { value() { assert.fail('late glyph replacement'); } });
	try {
		held.resolve({ prepareSave: (_member, request) => input.prepareSave(request), saveFile: (_member, request) => input.saveFile(request), retireAndJoin: async () => {} });
		const result = await work; assert.equal(result.members[0]!.state, 'completed'); assert.equal(glyphs, 1); assert.equal(encoded, 1);
		assert.equal(f.outputs[0]!.bytes[24], 16); assert.deepEqual((await f.inspect())[0]!.bytes, f.bytes);
	} finally { held.resolve({ prepareSave: (_member, request) => input.prepareSave(request), saveFile: (_member, request) => input.saveFile(request), retireAndJoin: async () => {} }); await work.catch(() => undefined); await queue.cancelAndJoin(); await f.close(); }
});
