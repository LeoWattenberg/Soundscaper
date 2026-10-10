/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { PhotoRasterExport, PhotoRasterExportMetadataRefusal, type PhotoRasterExportRequest } from '../src/lightscaper/controller/photo-raster-export.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { encodePixelFramePngV1 } from '../src/common/editor/imaging/pixel-frame-png-v1.ts';
import { readImageMetadataV1 } from '../src/common/editor/imaging/image-metadata-reader-v1.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { createFileSystemPreparedSave } from '../src/common/editor/file-save-stream.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const EXIF = Object.freeze({ orientation: 8, cameraMake: 'Saved camera', cameraModel: 'Model', lensModel: null,
	artist: 'Original artist', copyright: null, description: 'Original description', exposureSeconds: 1 / 125,
	aperture: 2.8, iso: 100, focalLengthMm: 50, captureTime: null, captureTimeRaw: null });
function fixture() {
	const owner = new PhotoRasterExport('png'), events: string[] = [], saved: Uint8Array[] = [], codec: Uint8Array[] = [];
	const source = Uint8Array.of(9, 81, 173, 255, 231, 42, 19, 127), before = source.slice();
	let revision = 3, catalogId = 'catalog', metadataCalls = 0;
	const request: PhotoRasterExportRequest = { photoId: 'photo', versionId: 'master', expectedRevision: 3,
		fileName: 'original', fileTypeDescription: 'PNG image', output: { sizing: { kind: 'original' }, quality: 'nearest', metadataScope: 'capture' },
		prepareSave(value) { events.push('picker'); assert.ok(typeof value.suggestedName === 'string'); return { mode: 'blob', target: { browserDownload: true }, fileName: value.suggestedName! }; },
		saveFile: async value => { events.push('download'); assert.ok(typeof value.suggestedName === 'string'); assert.ok(value.blob); saved.push(new Uint8Array(await value.blob.arrayBuffer()));
			return { method: 'download', fileName: value.suggestedName!, size: value.blob.size }; },
		execute: async (action, signal) => { assert.ok(signal); await action({ signal, isCurrent: () => true, refresh: async () => undefined,
			acquire: async () => ({ schemaVersion: 2, read: async () => { events.push('revision'); return { schemaVersion: 2, catalogId, photoId: 'photo', revision,
				activeVersionId: 'master', versionId: 'master', versions: [{ id: 'master', name: 'Master', kind: 'master' }],
				develop: defaultImageDevelopStateV2(), history: { cursor: 0, entries: [] }, snapshots: [] }; }, apply: async () => assert.fail('Export cannot edit') }) }); return 'completed'; },
		withOriginalFrame: async (_value, consume) => { const result = await consume({ photoId: 'photo', revision: 3, frame: { descriptor: {
			schemaVersion: 1, width: 1, height: 2, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: source } }); events.push('original-settled'); return result; },
		loadRenderer: async () => createPhotoDevelopRenderRuntimeV2(), encode: async (frame, options) => {
			const bytes = await encodePixelFramePngV1(frame, options); codec.push(bytes); events.push('encoded'); return bytes;
		}, readMetadata: async function (photoId, expectedRevision, options) {
			assert.equal(this.readMetadata, request.readMetadata); assert.equal(photoId, 'photo'); assert.equal(expectedRevision, 3); options.signal.throwIfAborted();
			metadataCalls++; events.push('metadata'); return { catalogId: 'catalog', snapshot: { photoId: 'photo', revision: 3,
				metadata: photoArchiveFixture().photo.metadata, extracted: { schemaVersion: 1, container: 'png', exif: EXIF, iptc: null, issues: [] },
				originalFileName: 'original.png', originalSha256: 'a'.repeat(64) } };
		} };
	return { owner, request, events, source, before, saved, codec, get metadataCalls() { return metadataCalls; },
		setRevision: (value: number) => { revision = value; }, setCatalog: (value: string) => { catalogId = value; } };
}
function chunks(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), result = [];
	for (let offset = 8; offset < bytes.length;) { const size = view.getUint32(offset), kind = Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString('ascii');
		result.push({ kind, bytes: bytes.slice(offset + 8, offset + 8 + size) }); offset += size + 12; }
	return result;
}
function dimensions(tiff: Uint8Array) {
	const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength), count = view.getUint16(8, true); let exif = 0;
	for (let index = 0; index < count; index++) { const at = 10 + index * 12; if (view.getUint16(at, true) === 0x8769) exif = view.getUint32(at + 8, true); }
	const result: number[] = [];
	for (let index = 0; index < view.getUint16(exif, true); index++) { const at = exif + 2 + index * 12, tag = view.getUint16(at, true);
		if (tag === 0xa002 || tag === 0xa003) result.push(view.getUint32(at + 8, true)); }
	return result;
}

test('default Strip preserves exact codec bytes without a metadata read or composition allocation', async () => {
	const f = fixture(); let exact: Uint8Array | null = null;
	const { output: _output, ...request } = f.request;
	const work = f.owner.start({ ...request, readMetadata: async () => assert.fail('Strip cannot read metadata'),
		prepareSave: request => { assert.ok(typeof request.suggestedName === 'string'); return createFileSystemPreparedSave({ fileName: request.suggestedName!, signal: request.signal,
			target: { createWritable: async () => ({ write: value => { assert.ok(value instanceof Uint8Array); exact = value; }, close: () => undefined, abort: () => undefined }) } }); } });
	await work; assert.ok(exact); assert.equal((exact as Uint8Array).buffer, f.codec[0]!.buffer); assert.deepEqual(f.source, f.before); assert.equal(f.metadataCalls, 0);
});

test('Capture reconstructs only stored camera facts at final output dimensions after both frame owners settle', async () => {
	const f = fixture(), receipt = await f.owner.start(f.request), output = f.saved[0]!;
	assert.equal(receipt.status, 'download-started'); assert.equal(f.metadataCalls, 1);
	assert.equal(f.events.indexOf('download') > f.events.indexOf('original-settled'), true);
	const facts = readImageMetadataV1(output); assert.equal(facts.exif?.cameraMake, 'Saved camera'); assert.equal(facts.exif?.orientation, 1);
	assert.equal(facts.exif?.artist, null); assert.equal(facts.exif?.description, null); assert.deepEqual(facts.issues, []);
	const rows = chunks(output); assert.deepEqual(dimensions(rows.find(row => row.kind === 'eXIf')!.bytes), [1, 2]);
	assert.deepEqual([...inflateSync(Buffer.concat(rows.filter(row => row.kind === 'IDAT').map(row => row.bytes)))], [0, 9, 81, 173, 255, 0, 231, 42, 19, 127]);
	assert.deepEqual(f.source, f.before); assert.equal(f.codec[0]!.every(byte => byte === 0), true);
});

test('a held metadata read keeps Save joined and refuses another catalog with identical photo/revision', async () => {
	const f = fixture(), entered = deferred<void>(), released = deferred<void>(), read = f.request.readMetadata!;
	const work = f.owner.start({ ...f.request, readMetadata: async (...args) => {
		entered.resolve(); await released.promise; return { ...await Reflect.apply(read, f.request, args), catalogId: 'other-catalog' };
	} });
	const rejection = assert.rejects(work, error => error instanceof PhotoRasterExportMetadataRefusal && error.cause instanceof Error && /catalog/iu.test(error.cause.message)); await entered.promise;
	assert.equal(await remainsPending(work), true); assert.deepEqual(f.saved, []); released.resolve(); await rejection;
	assert.deepEqual(f.saved, []); assert.deepEqual(f.codec, []);
});

test('late renderer/original failure and final revision changes suppress metadata delivery', async () => {
	for (const mode of ['renderer', 'original', 'revision', 'catalog'] as const) {
		const f = fixture(), primary = Symbol(mode), original = f.request.withOriginalFrame, runtime = createPhotoDevelopRenderRuntimeV2();
		const request: PhotoRasterExportRequest = { ...f.request, loadRenderer: async () => mode === 'renderer' ? { ...runtime,
			withFullResolution: async (...args: Parameters<typeof runtime.withFullResolution>) => { await runtime.withFullResolution(...args); throw primary; } } : runtime,
			withOriginalFrame: async (request, consume, options) => { const result = await original(request, consume, options);
				if (mode === 'original') throw primary; if (mode === 'revision') f.setRevision(4); if (mode === 'catalog') f.setCatalog('replacement'); return result; } };
		await assert.rejects(f.owner.start(request), error => mode === 'original' || mode === 'renderer' ? error === primary : error instanceof Error);
		assert.deepEqual(f.saved, []); assert.deepEqual(f.source, f.before); assert.equal(f.codec[0]!.every(byte => byte === 0), true);
	}
});

test('Capture cancellation joins actual native write and abort drain before wiping composed output', async () => {
	const f = fixture(), writing = deferred<void>(), write = deferred<void>(), aborting = deferred<void>(), abort = deferred<void>();
	const reason = Symbol('retired capture'); let exposed: Uint8Array | null = null;
	const work = f.owner.start({ ...f.request, prepareSave: request => { assert.ok(typeof request.suggestedName === 'string'); return createFileSystemPreparedSave({ fileName: request.suggestedName!, signal: request.signal,
		target: { createWritable: async () => ({ write: async value => { assert.ok(value instanceof Uint8Array); exposed = value; writing.resolve(); await write.promise;
			assert.equal(value.some(byte => byte !== 0), true); }, close: () => assert.fail('Cancelled Capture cannot commit'),
			abort: async () => { aborting.resolve(); await abort.promise; assert.ok(exposed); assert.equal((exposed as Uint8Array).some(byte => byte !== 0), true); } }) } }); } });
	const outcome = work.catch((error: unknown) => error); await writing.promise; assert.ok(exposed); assert.notEqual((exposed as Uint8Array).buffer, f.codec[0]!.buffer);
	const joined = f.owner.cancelAndJoin(reason); await aborting.promise; assert.equal(await remainsPending(joined), true);
	write.resolve(); assert.equal(await remainsPending(joined), true); abort.resolve(); await joined;
	assert.equal(await outcome, reason); assert.ok(exposed); assert.equal((exposed as Uint8Array).every(byte => byte === 0), true);
	assert.equal(f.codec[0]!.every(byte => byte === 0), true); assert.deepEqual(f.source, f.before);
});

test('Capture preserves exact primary and cleanup failure identities with one destination abort', async () => {
	const f = fixture(), primary = Symbol('final read'), cleanup = Symbol('abort failure'); let aborts = 0;
	await assert.rejects(f.owner.start({ ...f.request, prepareSave: request => { assert.ok(typeof request.suggestedName === 'string'); return createFileSystemPreparedSave({ fileName: request.suggestedName!, signal: request.signal,
		target: { createWritable: async () => ({ write: () => { f.setRevision(4); }, close: () => undefined, abort: () => { aborts++; throw cleanup; } }) } }); },
		execute: async (action, signal) => { assert.ok(signal); try { await action({ signal, isCurrent: () => true, refresh: async () => undefined,
			acquire: async () => ({ schemaVersion: 2, read: async () => { if (f.events.includes('encoded')) throw primary;
				return { schemaVersion: 2, catalogId: 'catalog', photoId: 'photo', revision: 3, activeVersionId: 'master', versionId: 'master',
					versions: [{ id: 'master', name: 'Master', kind: 'master' }], develop: defaultImageDevelopStateV2(), history: { cursor: 0, entries: [] }, snapshots: [] }; }, apply: async () => assert.fail('Export cannot edit') }) }); }
			catch { return 'failed'; } return 'completed'; } }), error => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, cleanup]); assert.equal(error.cause, primary); return true;
	}); assert.equal(aborts, 1); assert.equal(f.codec[0]!.every(byte => byte === 0), true);
});

test('metadata scope detaches before the original Save gesture can mutate its source settings', async () => {
	const f = fixture(), output = { sizing: { kind: 'original' as const }, quality: 'nearest' as const, metadataScope: 'capture' as 'strip' | 'capture' };
	await f.owner.start({ ...f.request, output, prepareSave: request => {
		output.metadataScope = 'strip'; return f.request.prepareSave(request);
	} });
	assert.equal(f.metadataCalls, 1); assert.equal(readImageMetadataV1(f.saved[0]!).exif?.cameraMake, 'Saved camera');
});

test('completed Capture delivery survives a late borrowed workflow error after its irreversible acknowledgment', async () => {
	const f = fixture(), primary = Symbol('late observer'), execute = f.request.execute;
	const result = await f.owner.start({ ...f.request, execute: async (...args) => { await execute(...args); throw primary; } });
	assert.equal(result.status, 'download-started'); assert.equal(f.saved.length, 1); assert.equal(f.codec[0]!.every(byte => byte === 0), true);
});

test('failed cleanup after metadata refusal preserves both failures when the real workflow reports failed', async () => {
	const f = fixture(), primary = Symbol('metadata read'), cleanup = Symbol('prepared destination cleanup'), execute = f.request.execute;
	let aborted = 0;
	await assert.rejects(f.owner.start({ ...f.request, readMetadata: async () => { throw primary; },
		prepareSave: request => { assert.ok(typeof request.suggestedName === 'string'); const destination = createFileSystemPreparedSave({ fileName: request.suggestedName!, signal: request.signal,
			target: { createWritable: async () => assert.fail('Refused metadata cannot open a write') } });
			return { ...destination, abort: async reason => { aborted++; await destination.abort(reason); throw cleanup; } }; },
		execute: async (...args) => { try { return await execute(...args); } catch { return 'failed'; } } }), error => {
		assert.ok(error instanceof AggregateError); assert.ok(error.errors[0] instanceof PhotoRasterExportMetadataRefusal);
		assert.equal(error.errors[0].cause, primary); assert.equal(error.errors[1], cleanup); assert.equal(error.cause, error.errors[0]); return true;
	}); assert.equal(aborted, 1); assert.deepEqual(f.codec, []);
});
