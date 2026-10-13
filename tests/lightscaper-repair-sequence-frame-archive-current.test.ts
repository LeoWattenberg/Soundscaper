/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync, inflateSync } from 'node:zlib';
import { exportPhotoFramescaperCollectionHandoffArchiveV1, type PhotoFramescaperCollectionHandoffArchiveV1, type PhotoFramescaperCollectionHandoffArchiveDependenciesV1 } from '../src/lightscaper/controller/photo-framescaper-collection-handoff-archive-v1.ts';
import { exportPhotoFramescaperCollectionHandoffArchiveCurrentV1, type PhotoFramescaperCollectionHandoffArchiveRequestCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-collection-handoff-archive-current-v1.ts';
import type { PhotoLibraryCollectionHandoffRequestV1 } from '../src/common/editor/photo-library-collection-handoff-port-v1.ts';
import { normalizeFramescaperImageSourceCurrentV1 } from '../src/common/editor/timeline-image-model-current-v1.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { cloneFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { openFramescaperCurrentImageFrameSource } from '../src/framescaper/timeline-image-current-frame-source.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { pngChunk } from './helpers/image-metadata-fixtures.ts';
import { ORIGINAL } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';
import { repairSequenceCurrentFixture, sequenceOutcome, type RepairSequenceCaptureView } from './helpers/lightscaper-repair-sequence-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type Fixture = Awaited<ReturnType<typeof repairSequenceCurrentFixture>>;
interface Capture {
	withCapture<Value>(binding: Readonly<PhotoLibraryCollectionHandoffRequestV1>, consume: (view: Readonly<RepairSequenceCaptureView>) => Value | Promise<Value>,
		options?: Readonly<{ signal?: AbortSignal }>): Promise<Value>;
}
function capture(f: Fixture, delivered?: (view: Readonly<RepairSequenceCaptureView>) => Readonly<RepairSequenceCaptureView>): Capture {
	const port: Capture = { withCapture(binding, consume, options) {
		assert.equal(this, port); return f.capture(view => consume(delivered ? delivered(view) : view), options, binding);
	} }; return port;
}
async function currentArchive(request: Readonly<PhotoFramescaperCollectionHandoffArchiveRequestCurrentV1>,
	dependencies: Readonly<PhotoFramescaperCollectionHandoffArchiveDependenciesV1>): Promise<Readonly<PhotoFramescaperCollectionHandoffArchiveV1>> {
	return await exportPhotoFramescaperCollectionHandoffArchiveCurrentV1(request, dependencies);
}
async function closeAll(owners: readonly Readonly<{ close(): Promise<void> }>[]) {
	const outcomes = await Promise.allSettled(owners.map(owner => owner.close()));
	const errors = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : []);
	if (errors.length === 1) throw errors[0]; if (errors.length) throw new AggregateError(errors, 'Sequence test owners failed retirement.');
}

for (const kind of ['manual', 'saved'] as const) test(`Light Current ${kind} sequence performs real native Frame import edit save reopen export and literal recipe rendering`, async t => {
	const f = await repairSequenceCurrentFixture(), options = { indexedDB: f.native.factory, preferOpfs: false };
	let store = createFramescaperProjectStore(PROFILE, options); t.after(() => closeAll([store, f]));
	const before = await f.inspect(), binding = f.binding(kind); let ordered: readonly string[] = [];
	const port = capture(f, view => { ordered = view.photos.map(photo => photo.binding.photoId); return view; });
	const archive = await currentArchive({ capture: port, binding }, f.dependencies);
	assert.equal(archive.photoCount, 4); assert.equal(archive.fileName, kind === 'manual' ? 'Manual selected.fscape' : 'Saved descending selected.fscape');
	if (kind === 'saved') assert.deepEqual(ordered, f.selectedPhotos.map(photo => photo.id).reverse());
	assert.deepEqual(await f.inspect(), before);
	const runtime = createFramescaperScapeNativeRuntime(PROFILE), imported = await runtime.importScapeProject(archive.blob, store);
	assert.equal(imported.readOnly, false); const project = cloneFramescaperProject(PROFILE, imported.project);
	assert.equal(project.schemaVersion, 1); assert.equal(project.sources.length, 4); assert.equal(project.clips.length, 4);
	assert.deepEqual(project.clips.map(clip => clip.kind === 'image' ? [clip.sequenceStartFrame, clip.sequenceFrameCount] : null), [[0, 150], [150, 150], [300, 150], [450, 150]]);
	assert.equal(new Set(project.sources.map(source => source.id)).size, 4);
	assert.equal(new Set(project.sources.map(source => { if (source.kind !== 'image') assert.fail('An actual image source is required.'); return source.storageKey; })).size, 4);
	assert.deepEqual(project.tracks[0]!.clipIds, project.clips.map(clip => clip.id));
	assert.deepEqual(project.sources.map(source => source.kind === 'image' && source.schemaVersion !== 1 && source.provenance.origin.schemaFamily === 'lightscaper'
		? source.provenance.origin.photoId : null), ordered);
	for (const value of project.sources) {
		const source = normalizeFramescaperImageSourceCurrentV1(value); assert.notEqual(source.schemaVersion, 1);
		if (source.schemaVersion === 1 || source.provenance.origin.schemaFamily !== 'lightscaper') assert.fail('Every placement requires complete saved Light provenance.');
		const origin = source.provenance.origin, photo = f.selectedPhotos.find(photo => photo.id === origin.photoId); assert.ok(photo);
		const version = photo.versions.find(version => version.id === photo.activeVersionId); assert.ok(version);
		assert.deepEqual(source.develop, version.develop); assert.equal(source.provenance.origin.schemaVersion, photo.schemaVersion);
		assert.equal(source.schemaVersion, photo.schemaVersion === 3 || version.develop.masks.some(mask => mask.inputs.length) ? 3 : 2);
		assert.equal(source.original.sha256, photo.original.contentSha256);
		const reader = await openFramescaperCurrentImageFrameSource(store, source, new AbortController().signal);
		try {
			const original = await reader.readOriginal(); try { assert.deepEqual(original, f.encoded); } finally { original.fill(0); }
			const pixels = await reader.readFrame(0);
			try { assert.deepEqual([...pixels], version.develop.processVersion === 3
				? [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255] : [255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255]); }
			finally { pixels.fill(0); }
		} finally { await reader.closeAndJoin(); }
	}
	const retainedOnly = f.resources.retainedOnly.storageKey; assert.equal(await store.loadMediaAsset(retainedOnly), null);
	for (const reference of [...f.resources.luts, ...f.resources.brushes]) {
		const body = await store.loadMediaAsset(reference.storageKey); assert.ok(body); assert.deepEqual(new Uint8Array(await body.arrayBuffer()), f.bodies.get(reference.storageKey));
	}
	const header = [83, 67, 77, 65, 83, 75, 48, 49, 3, 0, 0, 0, 1, 0, 0, 0];
	assert.deepEqual(f.bodies.get(f.resources.brushes[0]!.storageKey), Uint8Array.from([...header, 255, 0, 128]));
	assert.deepEqual(f.bodies.get(f.resources.brushes[1]!.storageKey), Uint8Array.from([...header, 64, 192, 31]));
	const source = project.sources[0]!; if (source.kind !== 'image') assert.fail('A real image edit is required.');
	const edited = applyFramescaperProjectCommand(PROFILE, project, { type: 'image-source/set', sourceId: source.id,
		expectedSource: source, source: { ...source, name: 'Edited sequence placement' } });
	assert.deepEqual(await store.saveProjectIfCurrent(project, edited), edited); assert.equal(await store.saveProjectIfCurrent(project, edited), null);
	await store.close(); store = createFramescaperProjectStore(PROFILE, options);
	assert.deepEqual(await store.loadProject(edited.id), edited);
	const exported = await runtime.exportScapeProject(edited, store); assert.ok(exported.blob);
	assert.equal(exported.manifest.assets.length, 7); assert.equal(exported.manifest.assets.filter(asset => asset.kind === 'photo-mask-raster').length, 2);
	assert.ok(exported.manifest.assets.every(asset => asset.sourceId !== retainedOnly));
	assert.deepEqual(await f.inspect(), before);
});

test('Light Current sequence pins actual capture receiver and native decode dependencies across held delivery', async t => {
	const f = await repairSequenceCurrentFixture(), entered = deferred<void>(), release = deferred<void>(), target = capture(f);
	t.after(async () => { release.resolve(); await f.close(); });
	const port: Capture = { async withCapture(...args) { assert.equal(this, port); entered.resolve(); await release.promise; return target.withCapture(...args); } };
	const binding: { -readonly [Key in keyof PhotoLibraryCollectionHandoffRequestV1]: PhotoLibraryCollectionHandoffRequestV1[Key] } = { ...f.manualBinding };
	const dependencies = { ...f.dependencies, openImage: f.dependencies.openImage.bind(f.dependencies) };
	const outcome = sequenceOutcome(currentArchive({ capture: port, binding }, dependencies));
	try {
		assert.equal(await Promise.race([entered.promise.then(() => true), outcome.then(() => false)]), true);
		binding.collectionId = 'late-missing'; port.withCapture = async () => { throw Symbol('late capability'); };
		dependencies.createId = () => 'late-id'; dependencies.now = () => 'invalid'; dependencies.openImage = async () => { throw Symbol('late decoder'); };
		release.resolve(); const result = await outcome; if (!result.ok) throw result.error;
		assert.equal(result.value.projectId, 'sequence-owned-1'); assert.equal(result.value.photoCount, 4);
	} finally { release.resolve(); await outcome; }
});

test('Light Current sequence refuses repeated per-photo pack minimum before first scoped Original or decode', async t => {
	const encoded = paddedPng(32 * 1024 * 1024), f = await repairSequenceCurrentFixture({ count: 4, mixed: false, originalBytes: encoded }); t.after(() => f.close());
	let originals = 0, delivered = false;
	const port = capture(f, view => { delivered = true; return { ...view, withOriginal<Value>(...args: Parameters<RepairSequenceCaptureView['withOriginal']>) {
		originals++; return Reflect.apply(view.withOriginal, view, args) as Promise<Value>;
	} }; });
	assert.ok(encoded.byteLength < 64 * 1024 * 1024); assert.ok((encoded.byteLength + 256 + 128) * 4 > 128 * 1024 * 1024);
	await assert.rejects(currentArchive({ capture: port, binding: f.manualBinding }, f.dependencies), /capacity|pack|byte/iu);
	assert.equal(delivered, true); assert.equal(originals, 0); assert.equal(f.events.filter(event => event.startsWith('native-')).length, 0);
	assert.equal((await f.inspect()).bytes.length, encoded.byteLength);
});

test('Light Current sequence refuses omitted declared brush inventory after actual native capture and before decode', async t => {
	const f = await repairSequenceCurrentFixture(); t.after(() => f.close()); let entered = false;
	const port = capture(f, view => { entered = true; return { ...view, maskRasterReferences: view.maskRasterReferences.slice(0, 1) }; });
	await assert.rejects(currentArchive({ capture: port, binding: f.manualBinding }, f.dependencies), /closure|brush|resource/iu);
	assert.equal(entered, true); assert.equal(f.events.filter(event => event === 'native-decode').length, 0);
});

test('Light Current sequence joins held actual native decode before caller cancellation and Session Close retire', async t => {
	const f = await repairSequenceCurrentFixture(), before = await f.inspect(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Symbol('opaque sequence cancel');
	f.hooks.nativeDecode = async () => { entered.resolve(); await release.promise; };
	const outcome = sequenceOutcome(currentArchive({ capture: capture(f), binding: f.manualBinding, signal: stop.signal }, f.dependencies));
	t.after(async () => { release.resolve(); await outcome; await f.close(); });
	assert.equal(await Promise.race([entered.promise.then(() => true), outcome.then(() => false)]), true);
	stop.abort(reason); const closing = f.session.close(); assert.equal(f.session.close(), closing);
	assert.equal(await remainsPending(outcome), true); assert.equal(await remainsPending(closing), true);
	release.resolve(); const result = await outcome; assert.equal(result.ok, false);
	if (result.ok) assert.fail('Actual captured cancellation must reject.'); assert.equal(result.error, reason);
	await closing; assert.equal(f.closed.resources, 1); assert.equal(f.events.filter(event => event === 'native-close').length, 1);
	assert.deepEqual(f.encoded, Uint8Array.from(before.bytes));
});

test('Light Current sequence joins genuine held brush demand and physically wipes its borrowed body after opaque cancellation', async t => {
	const f = await repairSequenceCurrentFixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Symbol('opaque native brush cancel');
	let delivered = false, held: Uint8Array<ArrayBuffer> | undefined;
	const port = capture(f, view => {
		delivered = true; f.hooks.beforeBrush = async (_reference, bytes) => { held = bytes; entered.resolve(); await release.promise; }; return view;
	});
	const outcome = sequenceOutcome(currentArchive({ capture: port, binding: f.manualBinding, signal: stop.signal }, f.dependencies));
	t.after(async () => { release.resolve(); await outcome; await f.close(); });
	assert.equal(await Promise.race([entered.promise.then(() => true), outcome.then(() => false)]), true);
	assert.equal(delivered, true); assert.equal(f.events.filter(event => event === 'native-decode').length, 4);
	assert.equal(f.events.filter(event => event === 'native-close').length, 4); assert.ok(held?.some(value => value !== 0));
	stop.abort(reason); const closing = f.session.close();
	assert.equal(await remainsPending(outcome), true); assert.equal(await remainsPending(closing), true);
	release.resolve(); const result = await outcome; assert.equal(result.ok, false);
	if (result.ok) assert.fail('The native held-body cancellation must reject.');
	// A genuine ZIP abort/close can contribute distinct cleanup or repeat the
	// primary. The exact opaque native reason must survive that joined tree.
	assert.ok(leaves(result.error).some(value => Object.is(value, reason))); await closing;
	assert.ok(held?.every(value => value === 0)); assert.ok(f.borrowed.every(bytes => bytes.every(value => value === 0))); assert.equal(f.closed.resources, 1);
});

test('Light permanent collection archive still refuses repaired saved Photos without reading Original or decoding', async t => {
	const f = await repairSequenceCurrentFixture(), before = await f.inspect(); t.after(() => f.close());
	const actual = f.session.collectionHandoff; assert.ok(actual);
	await assert.rejects(exportPhotoFramescaperCollectionHandoffArchiveV1({ capture: actual, binding: f.manualBinding }, f.dependencies), /Photo|version|unsupported/iu);
	assert.equal(f.events.filter(event => event === 'original' || event.startsWith('native-')).length, 0); assert.deepEqual(await f.inspect(), before);
});

function paddedPng(padding: number): Uint8Array<ArrayBuffer> {
	const header = Buffer.alloc(13); header.writeUInt32BE(3); header.writeUInt32BE(1, 4); header.set([8, 6], 8);
	const scanline = Buffer.from([0, ...ORIGINAL]), stored = deflateSync(scanline, { level: 0 }), empty = Buffer.alloc(Math.ceil(padding / 5) * 5);
	stored[2] = stored[2]! & ~1;
	for (let offset = 0; offset < empty.length; offset += 5) { empty[offset + 3] = 255; empty[offset + 4] = 255; }
	empty[empty.length - 5] = 1;
	const compressed = Buffer.concat([stored.subarray(0, -4), empty, stored.subarray(-4)]);
	assert.deepEqual(inflateSync(compressed), scanline);
	return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header),
		pngChunk('IDAT', compressed), pngChunk('IEND', new Uint8Array())]));
}

function leaves(error: unknown): readonly unknown[] {
	if (!(error instanceof AggregateError)) return [error];
	return (error.errors as readonly unknown[]).flatMap(leaves);
}
