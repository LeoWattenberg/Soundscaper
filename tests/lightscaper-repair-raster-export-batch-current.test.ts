/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePhotoRasterBatchSelectionCurrentV1 as preparePhotoRasterBatchSelection } from '../src/lightscaper/controller/photo-raster-export-batch-selection-current-v1.ts';
import { PhotoRasterExportBatchQueueCurrentV1 as PhotoRasterExportBatchQueue, type PhotoRasterExportBatchRuntimeCurrentV1 as PhotoRasterExportBatchRuntime } from '../src/lightscaper/controller/photo-raster-export-batch-queue-current-v1.ts';
import type { PhotoRasterExportBatchDestinations } from '../src/lightscaper/controller/photo-raster-export-batch-queue.ts';
import { PhotoRasterPersistedBatchCurrentV1 as PhotoRasterPersistedBatch } from '../src/lightscaper/controller/photo-raster-export-persisted-batch-current-v1.ts';
import { capturePhotoRasterExportBatchV1 } from '../src/lightscaper/controller/photo-raster-export-batch-v1.ts';
import { createPhotoDevelopRenderRuntimeV3 } from '../src/lightscaper/photo-develop-render-runtime-v3.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import type { BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { repairRasterFixture, decodePng, type RepairRasterRequest } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';

type Fixture = Awaited<ReturnType<typeof repairRasterFixture>>;
type Runtime = Omit<PhotoRasterExportBatchRuntime, 'execute' | 'loadRenderer'> & Pick<RepairRasterRequest, 'execute' | 'loadRenderer'>;
const selection = (f: Fixture) => f.photos.map(photo => ({ photoId: photo.id, fileName: photo.metadata.fileName }));
function prepare(f: Fixture, selected = selection(f), openJournal = f.openJournal) {
	return Reflect.apply(PhotoRasterPersistedBatch.prepare, PhotoRasterPersistedBatch, [{ selection: selected, execute: f.execute,
		readSidecar: f.readSidecar, openJournal, signal: new AbortController().signal }]) as ReturnType<typeof PhotoRasterPersistedBatch.prepare>;
}
function rawPlan(f: Fixture, batchId = 'repairs') { return { schemaVersion: 1, batchId, format: 'png', filenameTemplate: '{index:2}-{name}',
	members: f.photos.map(photo => ({ photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision, sourceFileName: photo.metadata.fileName })) }; }
function plan(f: Fixture, batchId = 'repairs') { return capturePhotoRasterExportBatchV1(rawPlan(f, batchId)); }
function runtime(f: Fixture, prepareDestinations?: Runtime['prepareDestinations']): Runtime {
	const input = f.request();
	return { fileTypeDescription: 'PNG', execute: f.execute, withOriginalFrame: input.withOriginalFrame, loadRenderer: input.loadRenderer,
		encode: (_format, frame, options) => input.encode(frame, options),
		prepareDestinations: prepareDestinations ?? (() => ({ prepareSave: (_member, request) => input.prepareSave(request),
			saveFile: (_member, request) => input.saveFile(request), retireAndJoin: async () => { f.events.push('destinations-closed'); } })),
	};
}
function queue(value: Runtime): PhotoRasterExportBatchQueue {
	return Reflect.construct(PhotoRasterExportBatchQueue, [value]) as PhotoRasterExportBatchQueue;
}

test('Current batch selection captures real schema3 saved ordinals without reading an Original or renderer', async () => {
	const f = await repairRasterFixture(undefined, undefined, 3);
	try {
		const value = await (Reflect.apply(preparePhotoRasterBatchSelection, undefined, [selection(f), f.execute, new AbortController().signal]) as ReturnType<typeof preparePhotoRasterBatchSelection>);
		assert.equal(value.catalogId, f.photos[0]!.catalogId);
		assert.deepEqual(value.members.map(member => [member.photoId, member.versionId, member.expectedRevision]), f.photos.map(photo => [photo.id, photo.activeVersionId, photo.revision]));
		assert.equal(f.codecs.calls.opens, 0); assert.deepEqual(f.events, []);
	} finally { await f.close(); }
});

test('Current batch shares the actual cached runtime, serializes native Original demand and emits literal PNGs in stable order', async () => {
	const f = await repairRasterFixture(undefined, undefined, 3), input = f.request(); let active = 0, maximum = 0;
	const owner = queue({ ...runtime(f), withOriginalFrame: async (...args) => { maximum = Math.max(maximum, ++active); try { return await input.withOriginalFrame(...args); } finally { active--; } } });
	try {
		const work = owner.start(rawPlan(f)); assert.equal(f.codecs.calls.opens, 0); const result = await work;
		assert.deepEqual(result.members.map(member => member.state), ['completed', 'completed', 'completed']); assert.equal(maximum, 1);
		assert.equal(f.codecs.calls.opens, 3); assert.equal(f.codecs.calls.closes, 3);
		assert.deepEqual(f.outputs.map(output => output.name), plan(f).members.map(member => member.fileName));
		for (const output of f.outputs) assert.deepEqual([...decodePng(output.bytes).pixels], [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255]);
		assert.ok(f.borrowed.every(bytes => bytes.every(value => value === 0))); assert.ok(f.encoded.every(bytes => bytes.every(value => value === 0)));
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('Current persisted cancel and reopen preserve an acknowledged ordinal and require review only for genuinely started work', async () => {
	const f = await repairRasterFixture(undefined, undefined, 3), held = deferred<void>(), entered = deferred<void>(); let batch: PhotoRasterPersistedBatch | undefined;
	let owner: PhotoRasterExportBatchQueue | undefined, reads = 0;
	try {
		batch = await prepare(f); const value = plan(f), input = f.request();
		owner = queue({ ...runtime(f, next => batch!.prepareFreshDestinations(next, { prepareSave: input.prepareSave, saveFile: input.saveFile }, '{index:2}-{name}')),
			encode: async (_format, frame, options) => { if (++reads === 2) { entered.resolve(); await held.promise; } return input.encode(frame, options); } });
		const work = owner.start(rawPlan(f)); void work.catch(() => undefined);
		await Promise.race([entered.promise, work.then(() => assert.fail('Second real encode never entered'))]);
		const closing = owner.cancelAndJoin(); assert.equal(await remainsPending(closing), true); held.resolve(); await closing; await work.catch(() => undefined);
		assert.equal(f.outputs.length, 1); assert.equal(batch.journal!.members[0]!.state, 'committed'); await batch.closeAndJoin();
		const reopened = await prepare(f, []);
		try {
			assert.equal(reopened.recovery[0]!.disposition, 'already-committed'); assert.equal(reopened.recovery[1]!.disposition, 'eligible');
			const recover = queue(runtime(f, next => reopened.prepareRecoveryDestinations(next, { prepareSave: input.prepareSave, saveFile: input.saveFile }, [])));
			try { await recover.startRecovery(reopened.journal, [value.members[2]!.jobId, value.members[1]!.jobId]); }
			finally { await recover.cancelAndJoin(); }
			assert.deepEqual(f.outputs.map(output => output.name), value.members.map(member => member.fileName)); assert.equal(f.outputs.filter(output => output.name === value.members[0]!.fileName).length, 1);
		} finally { await reopened.closeAndJoin(); }
	} finally { held.resolve(); await owner?.cancelAndJoin(); await batch?.closeAndJoin(); await f.close(); }
});

test('Current held durable started intent followed by an actual native revision change forbids download and requires explicit recovery review', async () => {
	const f = await repairRasterFixture(), entered = deferred<void>(), held = deferred<void>(), access = await f.openJournal(), settings = access.settings;
	let batch: PhotoRasterPersistedBatch | undefined, destinations: Readonly<PhotoRasterExportBatchDestinations> | undefined;
	try {
		batch = await prepare(f, selection(f), async () => ({ ...access, settings: { ...settings, async replaceIfCurrent(key, before, next) {
			entered.resolve(); await held.promise; return Reflect.apply(settings.replaceIfCurrent, settings, [key, before, next]) as Promise<boolean>;
		} } }));
		const value = plan(f), input = f.request(); destinations = await batch.prepareFreshDestinations(value, { prepareSave: input.prepareSave, saveFile: input.saveFile }, '{index:2}-{name}');
		const request = { fileName: value.members[0]!.fileName, blob: new Blob(['staged']), signal: new AbortController().signal };
		await destinations.prepareSave(value.members[0]!, request);
		const work = Promise.resolve(destinations.saveFile(value.members[0]!, request));
		void work.catch(() => undefined); await Promise.race([entered.promise, work.then(() => assert.fail('Actual CAS never entered'))]);
		await f.session.applyMetadata(f.photos[0]!.id, f.photos[0]!.revision, { title: 'Native revision changed' }); held.resolve(); await assert.rejects(work);
		assert.equal(f.outputs.length, 0); assert.equal(batch.journal!.members[0]!.state, 'started');
		const reopened = await prepare(f, []); try { assert.equal(reopened.recovery[0]!.disposition, 'needs-review'); assert.equal(reopened.recovery[0]!.currentMatches, false); }
		finally { await reopened.closeAndJoin(); }
	} finally { held.resolve(); await destinations?.retireAndJoin().catch(() => undefined); await batch?.closeAndJoin(); await f.close(); }
});

test('Current native journal CAS conflict cannot authorize a second download from an old cached journal revision', async () => {
	const f = await repairRasterFixture(); let first: PhotoRasterPersistedBatch | undefined, second: PhotoRasterPersistedBatch | undefined;
	let one: Readonly<PhotoRasterExportBatchDestinations> | undefined, two: Readonly<PhotoRasterExportBatchDestinations> | undefined;
	try {
		first = await prepare(f); const value = plan(f), input = f.request(); one = await first.prepareFreshDestinations(value, { prepareSave: input.prepareSave, saveFile: input.saveFile }, '{index:2}-{name}');
		second = await prepare(f, []); two = await second.prepareRecoveryDestinations(value, { prepareSave: input.prepareSave, saveFile: input.saveFile }, []);
		const request = { fileName: value.members[0]!.fileName, blob: new Blob(['staged']), signal: new AbortController().signal };
		await one.prepareSave(value.members[0]!, request); await one.saveFile(value.members[0]!, request);
		await two.prepareSave(value.members[0]!, request); await assert.rejects(Promise.resolve(two.saveFile(value.members[0]!, request)));
		assert.equal(f.outputs.length, 1); assert.equal(first.journal!.members[0]!.state, 'committed'); assert.equal(second.journal!.members[0]!.state, 'pending');
	} finally { await Promise.allSettled([one?.retireAndJoin(), two?.retireAndJoin()]); await Promise.all([first?.closeAndJoin(), second?.closeAndJoin()]); await f.close(); }
});

test('Current renderer independently authenticates a corrupted unused actual brush delivery before any PNG or publication', async () => {
	const f = await repairRasterFixture(), installed = await f.installBrush();
	const current = f.photos[0]!.versions[0]!.develop;
	await f.changeRecipe({ ...current, masks: [{ schemaVersion: 1, id: 'unused', kind: 'matte', inputs: [{ name: 'paint', sourceRef: installed.reference.storageKey, kind: 'alpha' }],
		nodes: [{ id: 'paint', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'paint' }], maskBindings: [] });
	const actual = f.session.maskRasterSource!, withBytes = actual.withBytes; let calls = 0;
	const source: MaskRasterSourcePortV1 = { async withBytes<Result>(reference: Readonly<BrushMaskResourceReferenceV1>, consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>) {
		return Reflect.apply(withBytes, actual, [reference, async (bytes: Uint8Array<ArrayBuffer>) => { calls++; bytes[16] = bytes[16]! ^ 1; return consume(bytes); }, options]) as Promise<Result>;
	} };
	const renderer = createPhotoDevelopRenderRuntimeV3({ source: f.session.cubeLuts.source, maskSource: source }), owner = queue({ ...runtime(f), loadRenderer: async () => renderer });
	try {
		await assert.rejects(owner.start(rawPlan(f))); assert.equal(calls, 1); assert.equal(f.encoded.length, 0); assert.equal(f.outputs.length, 0);
		assert.ok(f.borrowed.every(bytes => bytes.every(value => value === 0))); assert.deepEqual((await f.inspect())[0]!.bytes, f.bytes);
	} finally { await owner.cancelAndJoin(); await f.close(); }
});
