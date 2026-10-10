/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoRasterExport, type PhotoRasterExportRequest } from '../src/lightscaper/controller/photo-raster-export.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { currentRecipe } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

function fixture(format: 'png' | 'jpeg' = 'png', pickedName = 'User renamed.png') {
	const owner = new PhotoRasterExport(format), events: string[] = [], downloads: { name: string; type: string; text: string }[] = [];
	const photo = normalizePhotoDocumentV2({ ...photoArchiveFixture().photo, schemaVersion: 2,
		versions: [{ ...photoArchiveFixture().photo.versions[0]!, develop: currentRecipe() }] });
	const source = Uint8Array.of(11, 73, 149, 255), before = source.slice(), encoded = Uint8Array.of(1, 3, 5);
	let recipe = photo, renders = 0, reads = 0, pickers = 0, active = true;
	const request: PhotoRasterExportRequest = { photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision,
		fileName: format === 'png' ? 'suggested.png' : 'suggested.jpg', fileTypeDescription: format === 'png' ? 'PNG' : 'JPEG',
		prepareSave: () => { pickers++; events.push('picker'); return { mode: 'blob', fileName: pickedName, target: { browserDownload: true } }; },
		saveFile: async value => { assert.ok(value.blob); assert.equal(typeof value.suggestedName, 'string'); const name = value.suggestedName as string; events.push(value.mimeType!);
			downloads.push({ name, type: value.blob.type, text: await value.blob.text() });
			return { fileName: name, method: 'download', size: value.blob.size }; },
		execute: async (run, signal) => { assert.ok(signal); await run({ signal, isCurrent: () => active, refresh: async () => undefined,
			acquire: async () => ({ schemaVersion: 2, read: async () => ({ schemaVersion: 2, catalogId: recipe.catalogId, photoId: recipe.id, revision: recipe.revision,
				activeVersionId: recipe.activeVersionId, versionId: recipe.activeVersionId, versions: recipe.versions.map(({ id, name, kind }) => ({ id, name, kind })),
				develop: recipe.versions[0]!.develop, history: { cursor: 0, entries: [] }, snapshots: [] }), apply: async () => assert.fail('No edits') }) }); return 'completed'; },
		withOriginalFrame: async (_request, consume) => { const result = await consume({ photoId: photo.id, revision: photo.revision,
			frame: { descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: source } });
			events.push('original-joined'); return result; },
		loadRenderer: async () => createPhotoDevelopRenderRuntimeV2(), encode: async () => { renders++; events.push('encode'); return encoded.slice(); },
		sidecar: { read: async binding => { reads++; events.push('sidecar-read'); return serializePhotoExportSidecarV1(createPhotoExportSidecarV1(recipe, binding)); } } };
	return { owner, request, events, downloads, source, before, photo, get reads() { return reads; }, get renders() { return renders; }, get pickers() { return pickers; },
		changeFacts: () => { recipe = normalizePhotoDocumentV2({ ...recipe, metadata: { ...recipe.metadata, title: 'Changed without revision' } }); },
		retire: () => { active = false; } };
}

test('default-off preserves raster bytes and performs no sidecar reads or JSON downloads', async () => {
	const f = fixture(), { sidecar: _sidecar, ...request } = f.request;
	assert.equal((await f.owner.start(request)).status, 'download-started'); assert.equal(f.reads, 0);
	assert.deepEqual(f.downloads.map(item => item.type), ['image/png']); assert.deepEqual(f.source, f.before);
});

test('sidecar follows the real picked filename and publishes only after joined frames and complete final facts', async () => {
	const f = fixture(), result = await f.owner.start(f.request);
	assert.ok(result.status !== 'cancelled'); assert.equal(result.status, 'download-started');
	assert.equal(result.sidecar?.status, 'download-started'); assert.equal(f.reads, 2);
	assert.deepEqual(f.downloads.map(item => [item.name, item.type]), [['User renamed.png', 'image/png'], ['User renamed.png.lightscaper.json', 'application/json']]);
	assert.ok(f.events.indexOf('image/png') > f.events.indexOf('original-joined'));
	assert.equal(f.downloads[1]!.text, serializePhotoExportSidecarV1(createPhotoExportSidecarV1(f.photo,
		{ catalogId: f.photo.catalogId, photoId: f.photo.id, versionId: f.photo.activeVersionId, expectedRevision: f.photo.revision })));
	assert.deepEqual(f.source, f.before); assert.equal(f.pickers, 1);
});

for (const [format, fileName, expected] of [['png', 'Actual picked.png', 'Actual picked.png.lightscaper.json'],
	['jpeg', 'Actual picked.jpg', 'Actual picked.jpg.lightscaper.json']] as const) {
	test(`sidecar retains the complete acknowledged ${format} filename before its suffix`, async () => {
		const f = fixture(format, fileName), result = await f.owner.start(f.request);
		assert.ok(result.status !== 'cancelled'); assert.equal(result.sidecar?.fileName, expected);
		assert.deepEqual(f.downloads.map(item => item.name), [fileName, expected]);
	});
}

test('stable canonical sidecar with a different saved recipe refuses before any rendering or output', async () => {
	const f = fixture(), version = f.photo.versions[0]!;
	const different = normalizePhotoDocumentV2({ ...f.photo, versions: [{ ...version,
		develop: { ...version.develop, geometry: { ...version.develop.geometry, flipHorizontal: true } } }] });
	await assert.rejects(f.owner.start({ ...f.request, sidecar: { read: async binding =>
		serializePhotoExportSidecarV1(createPhotoExportSidecarV1(different, binding)) } }), /sidecar.*recipe/iu);
	assert.equal(f.renders, 0); assert.deepEqual(f.downloads, []); assert.deepEqual(f.source, f.before);
});

test('canonical sidecar for a different active version refuses the single-current export', async () => {
	const f = fixture(), version = f.photo.versions[0]!;
	const different = normalizePhotoDocumentV2({ ...f.photo, activeVersionId: 'another-version', versions: [version,
		{ ...version, id: 'another-version', kind: 'virtual-copy', name: 'Another' }] });
	await assert.rejects(f.owner.start({ ...f.request, sidecar: { read: async binding =>
		serializePhotoExportSidecarV1(createPhotoExportSidecarV1(different, binding)) } }), /sidecar.*active/iu);
	assert.equal(f.renders, 0); assert.deepEqual(f.downloads, []); assert.deepEqual(f.source, f.before);
});

test('complete facts drift during render refuses BOTH outputs even if revision/selected recipe still match', async () => {
	const f = fixture(), encode = f.request.encode;
	await assert.rejects(f.owner.start({ ...f.request, encode: async (...args) => { const bytes = await encode(...args); f.changeFacts(); return bytes; } }), /sidecar.*changed/iu);
	assert.deepEqual(f.downloads, []); assert.equal(f.reads, 2); assert.deepEqual(f.source, f.before);
});

test('JSON failure preserves image ACK and retries only sidecar with original gesture-time capability', async () => {
	const f = fixture(), save = f.request.saveFile, primary = Symbol('JSON delivery'); let fail = true;
	const request = { ...f.request, saveFile: async function (value: Parameters<typeof save>[0]) {
		if (value.mimeType === 'application/json' && fail) throw primary; return save(value);
	} };
	const first = await f.owner.start(request); assert.ok(first.status !== 'cancelled');
	assert.equal(first.status, 'download-started'); assert.equal(first.sidecar?.status, 'failed');
	assert.equal(first.sidecar?.status === 'failed' && first.sidecar.cause, primary);
	request.saveFile = async () => assert.fail('Replaced capability cannot be acquired'); fail = false;
	const second = await f.owner.retrySidecar(); assert.ok(second.status !== 'cancelled'); assert.equal(second.sidecar?.status, 'download-started');
	assert.equal(f.renders, 1); assert.equal(f.pickers, 1); assert.deepEqual(f.downloads.map(item => item.type), ['image/png', 'application/json']);
});

test('retirement joins held JSON delivery; late failure remains a distinct partial image receipt', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(), save = f.request.saveFile, reason = Symbol('retired');
	const work = f.owner.start({ ...f.request, saveFile: async value => { if (value.mimeType === 'application/json') {
		entered.resolve(); await release.promise; value.signal!.throwIfAborted(); } return save(value); } });
	await entered.promise; const closing = f.owner.cancelAndJoin(reason); assert.equal(await remainsPending(closing), true);
	assert.deepEqual(f.downloads.map(item => item.type), ['image/png']); release.resolve(); await closing;
	const result = await work; assert.ok(result.status !== 'cancelled'); assert.equal(result.status, 'download-started');
	assert.equal(result.sidecar?.status, 'cancelled'); assert.equal(result.sidecar?.status === 'cancelled' && result.sidecar.cause, reason);
});

test('a held initial read joins cancellation before raster work; stale retry retains prior image ACK', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(), read = f.request.sidecar!.read;
	const work = f.owner.start({ ...f.request, sidecar: { read: async (...args) => { entered.resolve(); await release.promise; return read(...args); } } });
	const reason = Symbol('cancel initial'), observed = work.catch((error: unknown) => error);
	await entered.promise; const closing = f.owner.cancelAndJoin(reason); assert.equal(await remainsPending(closing), true); release.resolve(); await closing;
	assert.equal(await observed, reason); assert.equal(f.renders, 0); assert.deepEqual(f.downloads, []);
	const g = fixture(), save = g.request.saveFile;
	await g.owner.start({ ...g.request, saveFile: async value => { if (value.mimeType === 'application/json') throw Symbol('first'); return save(value); } });
	g.retire(); const result = await g.owner.retrySidecar(); assert.ok(result.status !== 'cancelled');
	assert.equal(result.status, 'download-started'); assert.equal(result.sidecar?.status, 'failed'); assert.equal(g.renders, 1);
});

test('a real JSON ACK after held cancellation remains completed and cannot be retried', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(), save = f.request.saveFile;
	const work = f.owner.start({ ...f.request, saveFile: async value => { if (value.mimeType === 'application/json') { entered.resolve(); await release.promise; } return save(value); } });
	await entered.promise; const closing = f.owner.cancelAndJoin(Symbol('late')); assert.equal(await remainsPending(closing), true);
	release.resolve(); await closing; const result = await work; assert.ok(result.status !== 'cancelled');
	assert.equal(result.sidecar?.status, 'download-started'); await assert.rejects(f.owner.retrySidecar(), /retryable/iu);
});

test('malformed sidecar authority refuses before picker; future JSON facts refuse before rendering', async () => {
	const f = fixture(); let getters = 0;
	const hostile = Object.defineProperty({}, 'read', { enumerable: true, get() { getters++; throw Symbol('reflected'); } });
	await assert.rejects(f.owner.start({ ...f.request, sidecar: hostile as NonNullable<PhotoRasterExportRequest['sidecar']> }), TypeError);
	assert.equal(getters, 0); assert.equal(f.pickers, 0);
	const read = f.request.sidecar!.read;
	await assert.rejects(f.owner.start({ ...f.request, sidecar: { read: async (...args) => {
		const json: Record<string, unknown> = JSON.parse(await read(...args)) as Record<string, unknown>;
		return JSON.stringify({ ...json, schemaVersion: 2 });
	} } }), /Unsupported/iu);
	assert.equal(f.renders, 0); assert.deepEqual(f.downloads, []);
});
