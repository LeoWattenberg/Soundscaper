/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { capturePhotoRasterExportBatchV1 } from '../src/lightscaper/controller/photo-raster-export-batch-v1.ts';
import { createPhotoRasterExportJournalV1, normalizePhotoRasterExportJournalV1 } from '../src/lightscaper/storage/photo-raster-export-journal-v1.ts';
import { PhotoRasterExportBatchQueue, PhotoRasterExportBatchError, type PhotoRasterExportBatchRuntime } from '../src/lightscaper/controller/photo-raster-export-batch-queue.ts';
import { preparePhotoRasterBatchGraphicV1, reselectPhotoRasterBatchGraphicV1 } from '../src/lightscaper/controller/photo-raster-export-batch-graphic-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { encodePixelFramePngV1 } from '../src/common/editor/imaging/pixel-frame-png-v1.ts';
import { PhotoRasterExportJournalOwnerV1 } from '../src/lightscaper/storage/photo-raster-export-journal-owner-v1.ts';
import { createPhotoRasterJournalDestinationsV1 } from '../src/lightscaper/controller/photo-raster-export-journal-destinations-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const intent = { schemaVersion: 1, kind: 'photo-raster-batch-graphic', contentSha256: 'a'.repeat(64), byteLength: 4,
	anchor: 'bottom-right', widthFraction: 0.25, marginFraction: 0.05, opacity: 0.8 } as const;
function input() { return { schemaVersion: 1, batchId: 'graphic', format: 'png', filenameTemplate: '{index:2}-{name}', members: [
	{ photoId: 'one', versionId: 'master', expectedRevision: 3, sourceFileName: 'First.png' },
] }; }
const binding = { originalSha256: 'b'.repeat(64), recipeSha256: 'c'.repeat(64), lutSha256: [] };
function journal(plan: ReturnType<typeof capturePhotoRasterExportBatchV1>) {
	return createPhotoRasterExportJournalV1(plan, { catalogId: 'catalog', filenameTemplate: '{index:2}-{name}', bindings: [binding] });
}

test('batch scalar capture retains a detached graphic fingerprint and placement', () => {
	const raw = { ...intent, opacity: Number(intent.opacity) }, plan = capturePhotoRasterExportBatchV1({ ...input(), graphicWatermark: raw });
	assert.deepEqual(Reflect.get(plan, 'graphicWatermark'), intent); raw.opacity = 0.2;
	assert.deepEqual(Reflect.get(plan, 'graphicWatermark'), intent);
	assert.equal(Object.isFrozen(Reflect.get(plan, 'graphicWatermark')), true);
});

async function fixture() {
	const prepared = await preparePhotoRasterBatchGraphicV1({ body: new Blob([Uint8Array.of(1, 2, 3, 4)]),
		anchor: 'bottom-right', widthFraction: 0.5, marginFraction: 0, opacity: 1 });
	const events: string[] = [], encoded: number[][] = [], originals: Uint8Array[] = [], graphics: Uint8Array[] = [];
	const held = deferred<void>(), entered = deferred<void>(); let holdGraphic = false;
	const runtime: PhotoRasterExportBatchRuntime = {
		fileTypeDescription: 'PNG',
		prepareDestinations() { assert.equal(this, runtime); events.push('authority'); return {
			prepareSave: member => ({ mode: 'blob', target: { browserDownload: true }, fileName: member.fileName }),
			saveFile: (member, request) => { events.push(`save:${member.photoId}`); return { method: 'download', fileName: member.fileName, size: request.blob!.size }; },
			retireAndJoin: async () => { events.push('retire'); },
		}; },
		execute: async (action, signal) => { assert.ok(signal); await action({ signal, isCurrent: () => true, refresh: async () => undefined,
			acquire: async () => ({ schemaVersion: 2, read: async request => ({ schemaVersion: 2, catalogId: 'catalog', photoId: request.photoId, revision: 3,
				activeVersionId: 'master', versionId: 'master', versions: [], develop: defaultImageDevelopStateV2(), history: { cursor: 0, entries: [] }, snapshots: [] }),
				apply: async () => assert.fail('Export cannot edit') }) }); return 'completed'; },
		withOriginalFrame: async (request, consume) => {
			const pixels = Uint8Array.of(40, 40, 40, 255, 100, 100, 100, 255, 160, 160, 160, 255, 220, 220, 220, 255); originals.push(pixels);
			return consume({ photoId: request.photoId, revision: 3, frame: { descriptor: { schemaVersion: 1, width: 4, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels } });
		},
		loadRenderer: async () => createPhotoDevelopRenderRuntimeV2(),
		encode: async (_format, frame, options) => { encoded.push([...frame.pixels]); return encodePixelFramePngV1(frame, options); },
	};
	const withGraphicFrame: NonNullable<PhotoRasterExportBatchRuntime['withGraphicFrame']> = async function(this: unknown, value, consume) {
		assert.equal(this, withRuntime); assert.ok(value && typeof value === 'object'); assert.equal(Reflect.get(value, 'body'), prepared.request.body); events.push('graphic');
		const pixels = Uint8Array.of(255, 0, 0, 255); graphics.push(pixels);
		try { const result = await consume({ descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels },
			{ orientation: 1, runtimeVersion: 'unit-frame-borrow' }); if (holdGraphic) { entered.resolve(); await held.promise; } return result; }
		finally { pixels.fill(0); events.push('graphic-settled'); }
	};
	const withRuntime = { ...runtime, graphicWatermark: prepared, withGraphicFrame,
		prepareDestinations: runtime.prepareDestinations.bind(runtime) };
	const plan = { ...input(), graphicWatermark: prepared.intent, output: { sizing: { kind: 'percentage', percentage: 50 }, quality: 'nearest', sharpen: { amount: 100, threshold: 0 } } };
	return { prepared, runtime, withRuntime, plan, events, encoded, originals, graphics, held, entered, hold: () => { holdGraphic = true; } };
}

test('fresh and raster-recovery jobs refuse missing, changed or foreign selection before destinations', async () => {
	const f = await fixture();
	for (const recovery of [false, true]) {
		const owner = new PhotoRasterExportBatchQueue(f.runtime);
		const work = recovery ? owner.startRecovery(journal(capturePhotoRasterExportBatchV1(f.plan)), ['graphic:1']) : owner.start(f.plan);
		await assert.rejects(work, PhotoRasterExportBatchError); assert.deepEqual(f.events, []);
	}
	const mismatch = new PhotoRasterExportBatchQueue(f.withRuntime);
	await assert.rejects(mismatch.start({ ...f.plan, graphicWatermark: { ...f.prepared.intent, opacity: 0.2 } }), PhotoRasterExportBatchError);
	assert.deepEqual(f.events, []);
	assert.throws(() => new PhotoRasterExportBatchQueue({ ...f.withRuntime, graphicWatermark: { ...f.prepared } }), TypeError);
	let reads = 0;
	assert.throws(() => new PhotoRasterExportBatchQueue(Object.defineProperty({ ...f.withRuntime }, 'graphicWatermark', { enumerable: true, get() { reads++; return f.prepared; } })), TypeError);
	assert.equal(reads, 0);
	const unwanted = new PhotoRasterExportBatchQueue(f.withRuntime); await assert.rejects(unwanted.start(input()), PhotoRasterExportBatchError); assert.deepEqual(f.events, []);
});

test('each batch member uses the existing resize, sharpen and graphic compositor with pinned receivers', async () => {
	const f = await fixture(), owner = new PhotoRasterExportBatchQueue(f.withRuntime);
	f.withRuntime.withGraphicFrame = async () => assert.fail('Late graphic port substitution');
	const receipt = await owner.start({ ...f.plan, members: [...input().members, { photoId: 'two', versionId: 'master', expectedRevision: 3, sourceFileName: 'Second.png' }] });
	assert.deepEqual(receipt.members.map(row => row.delivery?.status), ['download-started', 'download-started']);
	assert.deepEqual(f.encoded, [[10, 10, 10, 255, 255, 0, 0, 255], [10, 10, 10, 255, 255, 0, 0, 255]]);
	assert.equal(f.events.filter(event => event === 'graphic').length, 2); assert.equal(f.events.filter(event => event === 'graphic-settled').length, 2);
	assert.ok(f.graphics.every(plane => plane.every(value => value === 0)));
	assert.ok(f.originals.every(plane => plane[0] === 40 && plane.at(-4) === 220));
});

test('member cancellation joins a held graphic borrower and forbids its later native delivery', async () => {
	const f = await fixture(); f.hold(); const owner = new PhotoRasterExportBatchQueue(f.withRuntime), work = owner.start(f.plan);
	await f.entered.promise; const closing = owner.cancelAndJoin(); assert.equal(await remainsPending(closing), true);
	assert.equal(f.graphics[0]![0], 255); assert.equal(f.events.some(event => event.startsWith('save:')), false);
	f.held.resolve(); await closing; assert.equal((await work).members[0]!.state, 'cancelled'); assert.ok(f.graphics[0]!.every(value => value === 0));
	assert.equal(f.events.some(event => event.startsWith('save:')), false);
});

test('opaque graphic refusal retains its exact cause and no member is delivered', async () => {
	const f = await fixture(), opaque = new Proxy({}, { get() { assert.fail('Foreign graphic error reflection'); } });
	const owner = new PhotoRasterExportBatchQueue({ ...f.withRuntime, withGraphicFrame: async () => { throw opaque; } });
	const outcome: unknown = await owner.start(f.plan).then(() => assert.fail('Refused graphic cannot finish'), (cause: unknown) => cause);
	assert.ok(outcome instanceof PhotoRasterExportBatchError); assert.equal(outcome.failure.cause, opaque);
	assert.equal(f.events.some(event => event.startsWith('save:')), false); assert.equal(f.events.at(-1), 'retire');
});

test('zero opacity retains its graphic intent while the existing single owner bypasses decode', async () => {
	const f = await fixture(), prepared = await preparePhotoRasterBatchGraphicV1({ ...f.prepared.request, opacity: 0 });
	const owner = new PhotoRasterExportBatchQueue({ ...f.withRuntime, graphicWatermark: prepared, withGraphicFrame: async () => assert.fail('Zero opacity cannot decode') });
	await owner.start({ ...f.plan, graphicWatermark: prepared.intent }); assert.deepEqual(f.encoded, [[10, 10, 10, 255, 190, 190, 190, 255]]);
	assert.equal(f.events.includes('graphic'), false);
});

test('reselection proves the retained placement and raster recovery preserves original ordinals', async () => {
	const f = await fixture(), replacement = await reselectPhotoRasterBatchGraphicV1(f.prepared.intent, new Blob([Uint8Array.of(1, 2, 3, 4)]));
	await assert.rejects(reselectPhotoRasterBatchGraphicV1(f.prepared.intent, new Blob([Uint8Array.of(4, 3, 2, 1)])));
	const whole = capturePhotoRasterExportBatchV1({ ...f.plan, members: [...input().members, { photoId: 'two', versionId: 'master', expectedRevision: 3, sourceFileName: 'Second.png' }] });
	const raw = createPhotoRasterExportJournalV1(whole, { catalogId: 'catalog', filenameTemplate: '{index:2}-{name}', bindings: [binding, binding] });
	const owner = new PhotoRasterExportBatchQueue({ ...f.withRuntime, graphicWatermark: replacement,
		withGraphicFrame: async (_value, consume) => consume({ descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: Uint8Array.of(255, 0, 0, 255) }, { orientation: 1, runtimeVersion: 'unit-borrow' }) });
	const receipt = await owner.startRecovery(JSON.parse(JSON.stringify(raw)), ['graphic:2']);
	assert.deepEqual(receipt.members.map(row => [row.jobId, row.index, row.fileName]), [['graphic:2', 2, '02-Second.png']]);
});

test('journal destinations refuse changed or dropped graphic intent before acquiring native authority', async () => {
	const plan = capturePhotoRasterExportBatchV1({ ...input(), graphicWatermark: intent }), stored = journal(plan); let acquired = 0;
	const owner = new PhotoRasterExportJournalOwnerV1({ get: async () => stored, putIfAbsent: async () => false, replaceIfCurrent: async () => false }, 'catalog');
	await owner.load();
	for (const bad of [{ ...plan, graphicWatermark: { ...intent, opacity: 0.1 } }, capturePhotoRasterExportBatchV1(input())]) {
		assert.throws(() => createPhotoRasterJournalDestinationsV1(bad, owner, () => { acquired++; assert.fail('No authority'); }));
	}
	assert.equal(acquired, 0); await owner.closeAndJoin();
});

test('durable graphic intent round-trips scalar JSON without a body or native capability', () => {
	const value = journal(capturePhotoRasterExportBatchV1({ ...input(), graphicWatermark: intent }));
	assert.deepEqual(Reflect.get(value, 'graphicWatermark'), intent);
	assert.deepEqual(normalizePhotoRasterExportJournalV1(JSON.parse(JSON.stringify(value))), value);
	assert.equal(JSON.stringify(value).includes('"body"'), false);
});

test('legacy plan and journal bytes remain literal and future fields or versions refuse', () => {
	const plan = capturePhotoRasterExportBatchV1(input()), value = journal(plan);
	assert.deepEqual(Object.keys(plan), ['schemaVersion', 'batchId', 'format', 'members']);
	assert.deepEqual(Object.keys(value), ['schemaVersion', 'kind', 'catalogId', 'revision', 'batchId', 'format', 'filenameTemplate', 'members']);
	assert.equal(JSON.stringify(normalizePhotoRasterExportJournalV1(JSON.parse(JSON.stringify(value)))), JSON.stringify(value));
	for (const bad of [{ ...intent, schemaVersion: 2 }, { ...intent, body: new Blob(['no durable body']) }, { ...intent, futureField: true }]) {
		assert.throws(() => capturePhotoRasterExportBatchV1({ ...input(), graphicWatermark: bad }));
		assert.throws(() => normalizePhotoRasterExportJournalV1({ ...value, graphicWatermark: bad }));
	}
});
