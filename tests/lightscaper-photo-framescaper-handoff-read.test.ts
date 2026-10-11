/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { normalizeFramescaperImageSourceV2 } from '../src/common/editor/timeline-image-model-v2.ts';
import { imageDevelopHandoffRecipeSha256V1 } from '../src/common/editor/image-develop-handoff-provenance-v1.ts';
import { withPhotoFramescaperHandoffReadV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-read-v1.ts';
import { preparePhotoFramescaperHandoffOriginalV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-original-v1.ts';
import { exportPhotoFramescaperHandoffArchiveV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-archive-v1.ts';
import type { PhotoLibraryImageHandoffPortV1 } from '../src/common/editor/photo-library-image-handoff-port-v1.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { LUT_BODY, LUT_REFERENCE, rewriteLutArchiveFixture } from './helpers/lightscaper-lut-archive-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
async function fixture(processVersion: 1 | 2 = 2, enabled = false) {
	const base = photoArchiveFixture(1, PNG), version = base.photo.versions[0]!;
	const photo = normalizePhotoDocumentV1OrV2({ ...base.photo, schemaVersion: processVersion, original: { ...base.photo.original, name: 'e\u0301.png' },
		versions: [{ ...version, develop: { ...version.develop, processVersion,
			effects: processVersion === 2 ? [{ id: 'saved-lut', type: 'cube-lut-profile-v1', enabled, params: { lut: LUT_REFERENCE } }] : [] } }] });
	const binding = { catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision };
	const withLutBytes: CubeLutSourcePortV1['withBytes'] = async (reference, borrower) => {
		assert.deepEqual(reference, LUT_REFERENCE); const bytes = LUT_BODY.slice();
		try { return await borrower(bytes); } finally { bytes.fill(0); }
	};
	const capture: PhotoLibraryImageHandoffPortV1 = { async withCapture(_binding, consume, options) {
		return await consume(Object.freeze({ schemaVersion: 1, signal: options?.signal ?? new AbortController().signal,
			factsJson: serializePhotoExportSidecarV1(createPhotoExportSidecarV1(photo, binding)), originalBlob: base.original,
			original: { exactName: photo.original.name, contentSha256: photo.original.contentSha256, byteLength: PNG.length,
				mimeType: 'image/png', width: 1, height: 1, hasAlpha: false }, lutReferences: processVersion === 2 ? [LUT_REFERENCE] : [], withLutBytes }));
	} };
	let index = 0;
	const archive = await exportPhotoFramescaperHandoffArchiveV1({ capture, binding }, { createId: () => `handoff-${String(++index)}`,
		now: () => '2026-10-10T00:00:00.000Z', openImage: async request => { assert.deepEqual(request.bytes, PNG);
			return { metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'read-fixture' },
				decodeFrame: async () => ({ rgba: Uint8Array.of(23, 71, 149, 255), durationMicroseconds: null }), close() {} }; } });
	return { archive: archive.blob, sourceId: 'handoff-2', photo };
}

for (const [processVersion, enabled] of [[1, false], [2, false], [2, true]] as const) test(`Light reverse reader authenticates real editable archive process${processVersion}/${enabled ? 'active' : 'disabled'} without publication`, async () => {
	const f = await fixture(processVersion, enabled), before = new Uint8Array(await f.archive.arrayBuffer());
	const value = await withPhotoFramescaperHandoffReadV1({ archive: f.archive, sourceId: f.sourceId }, async view => {
		assert.ok(Object.isFrozen(view)); assert.ok(Object.isFrozen(view.source)); assert.equal(view.projectId, 'handoff-1'); assert.equal(view.projectRevision, 1);
		assert.deepEqual(view.source.develop, f.photo.versions[0]!.develop); assert.equal(view.source.provenance.original.exactName, 'e\u0301.png');
		assert.equal(view.source.original.fileName, 'é.png'); assert.deepEqual(view.source.developed, { width: 1, height: 1 });
		assert.ok(view.originalBlob instanceof Blob); assert.equal(view.originalBlob.type, 'image/png');
		assert.deepEqual(new Uint8Array(await view.originalBlob.arrayBuffer()), PNG);
		assert.equal(view.canonicalFrameSha256, createHash('sha256').update(Uint8Array.of(23, 71, 149, 255)).digest('hex'));
		assert.deepEqual(view.lutReferences, processVersion === 2 ? [LUT_REFERENCE] : []);
		if (processVersion === 2) assert.equal(await view.withLutBytes(LUT_REFERENCE, bytes => { assert.deepEqual(bytes, LUT_BODY); return 71; }, { signal: view.signal }), 71);
		return 'authenticated selected recipe';
	});
	assert.equal(value, 'authenticated selected recipe'); assert.deepEqual(new Uint8Array(await f.archive.arrayBuffer()), before);
});

for (const kind of ['pack', 'disabled-lut'] as const) test(`Light reverse reader refuses corrupt ${kind} body before consumer`, async () => {
	const f = await fixture(); let consumers = 0;
	const archive = await rewriteLutArchiveFixture(f.archive, files => { const name = [...files.keys()].find(key => kind === 'pack' ? key.includes('/image/') : key.includes('/lut/'));
		assert.ok(name); const bytes = files.get(name)!; bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1; });
	await assert.rejects(withPhotoFramescaperHandoffReadV1({ archive, sourceId: f.sourceId }, () => { consumers++; }), /SHA|digest|verification/iu);
	assert.equal(consumers, 0);
});

async function projectEdit(archive: Blob, edit: (project: Record<string, unknown>) => void) {
	return rewriteLutArchiveFixture(archive, files => { const project = JSON.parse(new TextDecoder().decode(files.get('project.json'))) as Record<string, unknown>;
		edit(project); const bytes = new TextEncoder().encode(JSON.stringify(project)); files.set('project.json', bytes);
		const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json'))) as { project: { size: number; sha256: string; schemaVersion: number } };
		manifest.project.size = bytes.length; manifest.project.sha256 = createHash('sha256').update(bytes).digest('hex');
		manifest.project.schemaVersion = project.schemaVersion as number; files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest))); });
}

async function ordinaryFixture(hint: string | null = null) {
	const f = await fixture(1); let clipId = '', sequenceId = '', projectId = '', revision = 0;
	const archive = await projectEdit(f.archive, project => {
		const source = (project.sources as Record<string, unknown>[])[0]!, clip = (project.clips as Record<string, unknown>[])[0]!;
		source.schemaVersion = 1; delete source.develop; delete source.developed; delete source.provenance;
		(source.original as Record<string, unknown>).mimeType = hint;
		clipId = clip.id as string; sequenceId = clip.sequenceId as string; projectId = project.id as string; revision = project.revision as number;
	});
	return { ...f, archive, clipId, sequenceId, projectId, revision };
}

test('Light ordinary Source1 reader authenticates the unchanged pack before neutral promotion with actual clip context', async () => {
	const f = await ordinaryFixture(), before = new Uint8Array(await f.archive.arrayBuffer());
	await withPhotoFramescaperHandoffReadV1({ archive: f.archive, sourceId: f.sourceId, imageClipId: f.clipId }, async view => {
		assert.equal(view.source.schemaVersion, 2); assert.equal(view.source.original.mimeType, 'image/png');
		assert.deepEqual(view.source.develop, { processVersion: 1, effects: [], masks: [], maskBindings: [],
			geometry: { crop: null, rotationDegrees: 0, flipHorizontal: false, flipVertical: false } });
		assert.deepEqual(view.source.provenance.origin, { schemaFamily: 'framescaper', schemaVersion: 1, projectId: f.projectId,
			revision: f.revision, sourceId: f.sourceId, sequenceId: f.sequenceId, clipId: f.clipId });
		assert.equal(view.source.provenance.original.exactName, 'é.png'); assert.deepEqual(view.lutReferences, []);
		assert.deepEqual(new Uint8Array(await view.originalBlob.arrayBuffer()), PNG);
		assert.equal(view.canonicalFrameSha256, createHash('sha256').update(Uint8Array.of(23, 71, 149, 255)).digest('hex'));
	});
	assert.deepEqual(new Uint8Array(await f.archive.arrayBuffer()), before);
});

test('Light ordinary reader requires explicit context and binds each real timeline/bin placement without choosing the first', async () => {
	const f = await ordinaryFixture('application/octet-stream');
	const archive = await projectEdit(f.archive, project => {
		const clip = (project.clips as Record<string, unknown>[])[0]!;
		(project.projectBin as { clips: unknown[] }).clips.push({ ...clip, id: 'actual-bin-placement', sourceStartTicks: '1000000' });
	});
	await assert.rejects(withPhotoFramescaperHandoffReadV1({ archive, sourceId: f.sourceId }, () => assert.fail('No implicit placement.')), /explicit.*clip/iu);
	for (const clipId of [f.clipId, 'actual-bin-placement']) {
		await withPhotoFramescaperHandoffReadV1({ archive, sourceId: f.sourceId, imageClipId: clipId }, view => {
			assert.deepEqual(view.source.provenance.origin, { schemaFamily: 'framescaper', schemaVersion: 1, projectId: f.projectId,
				revision: f.revision, sourceId: f.sourceId, sequenceId: f.sequenceId, clipId });
			assert.equal(view.originalBlob.type, 'application/octet-stream'); assert.equal(view.source.original.mimeType, 'image/png');
			assert.deepEqual(view.source.developed, { width: 1, height: 1 });
		});
	}
});

test('Light ordinary reader refuses source-only, stale, wrong-source and invalid-sequence context before delivery', async () => {
	const f = await ordinaryFixture(); let consumers = 0;
	const sourceOnly = await projectEdit(f.archive, project => { project.clips = [];
		for (const track of project.tracks as { clipIds: string[] }[]) track.clipIds = []; });
	await assert.rejects(withPhotoFramescaperHandoffReadV1({ archive: sourceOnly, sourceId: f.sourceId, imageClipId: f.clipId }, () => { consumers++; }), /clip/iu);
	await assert.rejects(withPhotoFramescaperHandoffReadV1({ archive: f.archive, sourceId: f.sourceId, imageClipId: 'stale-clip' }, () => { consumers++; }), /clip/iu);
	for (const field of ['sourceId', 'sequenceId'] as const) {
		const archive = await projectEdit(f.archive, project => { (project.clips as Record<string, unknown>[])[0]![field] = 'missing-owner'; });
		await assert.rejects(withPhotoFramescaperHandoffReadV1({ archive, sourceId: f.sourceId, imageClipId: f.clipId }, () => { consumers++; }));
	}
	assert.equal(consumers, 0);
});

test('Light ordinary reader refuses duplicated timeline/bin clip IDs in actual current project admission', async () => {
	const f = await ordinaryFixture(); let consumers = 0;
	const archive = await projectEdit(f.archive, project => {
		(project.projectBin as { clips: unknown[] }).clips.push(structuredClone((project.clips as unknown[])[0]));
	});
	await assert.rejects(withPhotoFramescaperHandoffReadV1({ archive, sourceId: f.sourceId, imageClipId: f.clipId }, () => { consumers++; }), /duplicat/iu);
	assert.equal(consumers, 0);
});

test('Light ordinary reader authenticates pack bytes and retains downstream signature verification before native authority', async () => {
	const f = await ordinaryFixture(); let consumers = 0, opens = 0;
	const corrupt = await rewriteLutArchiveFixture(f.archive, files => { const name = [...files.keys()].find(key => key.includes('/image/'))!;
		const bytes = files.get(name)!; bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1; });
	await assert.rejects(withPhotoFramescaperHandoffReadV1({ archive: corrupt, sourceId: f.sourceId, imageClipId: f.clipId }, () => { consumers++; }), /SHA|digest|verification/iu);
	const mislabeled = await projectEdit(f.archive, project => {
		((project.sources as { original: Record<string, unknown> }[])[0]!.original).recognizedFormat = 'jpeg';
	});
	await withPhotoFramescaperHandoffReadV1({ archive: mislabeled, sourceId: f.sourceId, imageClipId: f.clipId }, async view => {
		assert.equal(view.source.original.mimeType, 'image/jpeg');
		await assert.rejects(preparePhotoFramescaperHandoffOriginalV1({ source: view.source, originalBlob: view.originalBlob,
			canonicalFrameSha256: view.canonicalFrameSha256, signal: view.signal }, { openImage: async () => { opens++; throw new Error('No decode before actual signature admission.'); } }), /signature.*format/iu);
	});
	assert.equal(consumers, 0); assert.equal(opens, 0);
});

test('Light ordinary reader captures clip selection before yielding and joins held consumer on opaque cancellation', async () => {
	const f = await ordinaryFixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Symbol('ordinary-consumer');
	const request = { archive: f.archive, sourceId: f.sourceId, imageClipId: f.clipId, signal: stop.signal };
	const work = withPhotoFramescaperHandoffReadV1(request, async view => { assert.equal(view.source.provenance.origin.schemaFamily, 'framescaper');
		assert.deepEqual(view.source.provenance.origin, { schemaFamily: 'framescaper', schemaVersion: 1, projectId: f.projectId,
			revision: f.revision, sourceId: f.sourceId, sequenceId: f.sequenceId, clipId: f.clipId }); entered.resolve(); await release.promise; });
	const refusal = assert.rejects(work, error => error === reason); request.imageClipId = 'late';
	await entered.promise; stop.abort(reason); assert.equal(await remainsPending(work), true); release.resolve(); await refusal;
});

test('Light Source2 rejects any ordinary clip field and Source1 refuses accessor selection without invoking it', async () => {
	const f = await fixture(1); let getters = 0, consumers = 0;
	await assert.rejects(withPhotoFramescaperHandoffReadV1({ archive: f.archive, sourceId: f.sourceId, imageClipId: 'handoff-5' }, () => { consumers++; }), /Source2/iu);
	const ordinary = await ordinaryFixture();
	const request = Object.defineProperty({ archive: ordinary.archive, sourceId: ordinary.sourceId, imageClipId: ordinary.clipId }, 'imageClipId', { get() { getters++; return ordinary.clipId; } });
	await assert.rejects(withPhotoFramescaperHandoffReadV1(request, () => { consumers++; })); assert.equal(getters, 0); assert.equal(consumers, 0);
});
for (const kind of ['future-project', 'future-source', 'legacy-source', 'nonstatic-source'] as const) test(`Light reverse reader refuses ${kind} editable authority`, async () => {
	const f = await fixture(1); let consumers = 0;
	const archive = await projectEdit(f.archive, project => {
		if (kind === 'future-project') { project.schemaVersion = 999; return; }
		const source = (project.sources as Record<string, unknown>[])[0]!;
		if (kind === 'nonstatic-source') (source.canonical as Record<string, unknown>).frameCount = 2;
		else { source.schemaVersion = kind === 'future-source' ? 3 : 1;
			if (kind === 'legacy-source') { delete source.develop; delete source.developed; delete source.provenance; } }
	});
	await assert.rejects(withPhotoFramescaperHandoffReadV1({ archive, sourceId: f.sourceId }, () => { consumers++; })); assert.equal(consumers, 0);
});

test('Light reverse reader pins immutable Blob authority, selected request and private signal before yielding', async () => {
	const f = await fixture(1), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(); let shadowReads = 0;
	const request = { archive: f.archive, sourceId: f.sourceId, signal: stop.signal };
	const work = withPhotoFramescaperHandoffReadV1(request, async view => { entered.resolve(); await release.promise; return view.source.id; });
	request.sourceId = 'other-source'; Object.defineProperty(f.archive, 'size', { get() { shadowReads++; throw Symbol('Blob size shadow'); } });
	await entered.promise; Object.defineProperty(stop.signal, 'aborted', { get() { shadowReads++; throw Symbol('late signal getter'); } });
	release.resolve(); assert.equal(await work, f.sourceId); assert.equal(shadowReads, 0);
});

test('Light reverse reader joins held consumer before preserving opaque cancellation', async () => {
	const f = await fixture(1), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Symbol('cancel-held-consumer');
	let completed = false;
	const work = withPhotoFramescaperHandoffReadV1({ archive: f.archive, sourceId: f.sourceId, signal: stop.signal }, async view => {
		assert.notEqual(view.signal, stop.signal); entered.resolve(); await release.promise; completed = true;
	});
	const refusal = assert.rejects(work, error => error === reason);
	await entered.promise; stop.abort(reason); assert.equal(await remainsPending(work), true); assert.equal(completed, false);
	release.resolve(); await refusal; assert.equal(completed, true);
});

test('Light reverse reader joins forgotten LUT consumer, refuses overlap and wipes only after settlement', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(); let borrowed: Uint8Array | undefined;
	let retained: Parameters<Parameters<typeof withPhotoFramescaperHandoffReadV1>[1]>[0]['withLutBytes'] | undefined;
	const work = withPhotoFramescaperHandoffReadV1({ archive: f.archive, sourceId: f.sourceId }, async view => {
		retained = view.withLutBytes; void view.withLutBytes(LUT_REFERENCE, async bytes => { borrowed = bytes; entered.resolve(); await release.promise; assert.deepEqual(bytes, LUT_BODY); });
		await entered.promise; await assert.rejects(view.withLutBytes(LUT_REFERENCE, () => undefined), /pending/iu); return 17;
	});
	await entered.promise; assert.equal(await remainsPending(work), true); assert.deepEqual(borrowed, LUT_BODY); release.resolve(); assert.equal(await work, 17);
	assert.ok(borrowed); assert.ok(borrowed.every(value => value === 0)); assert.ok(retained); await assert.rejects(retained(LUT_REFERENCE, () => undefined), /closed/iu);
});

test('Light reverse reader preserves distinct opaque consumer and forgotten borrower failures', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), primary = Symbol('consumer'), cleanup = Symbol('borrower');
	const work = withPhotoFramescaperHandoffReadV1({ archive: f.archive, sourceId: f.sourceId }, async view => {
		void view.withLutBytes(LUT_REFERENCE, async () => { entered.resolve(); await release.promise; throw cleanup; }).catch(() => undefined);
		await entered.promise; throw primary;
	});
	const refusal = assert.rejects(work, error => error instanceof AggregateError && error.cause === primary && error.errors[0] === primary && error.errors[1] === cleanup);
	await entered.promise; assert.equal(await remainsPending(work), true); release.resolve(); await refusal;
});

test('Light reverse reader refuses input bounds, getters, inherited request and unknown selection before delivery', async () => {
	const f = await fixture(1); let getters = 0;
	// Composite immutable Blob storage shares prior parts; no giant byte array is materialized.
	let oversized = new Blob([Uint8Array.of(0)]);
	for (let index = 0; index < 28; index++) oversized = new Blob([oversized, oversized]);
	oversized = new Blob([oversized, Uint8Array.of(0)]);
	await assert.rejects(withPhotoFramescaperHandoffReadV1({ archive: oversized, sourceId: f.sourceId }, () => undefined), /bound|capacity/iu);
	await assert.rejects(withPhotoFramescaperHandoffReadV1(Object.defineProperty({ archive: f.archive, sourceId: f.sourceId }, 'archive', { get() { getters++; return f.archive; } }), () => undefined));
	await assert.rejects(withPhotoFramescaperHandoffReadV1(Object.create(f) as typeof f, () => undefined));
	await assert.rejects(withPhotoFramescaperHandoffReadV1({ archive: f.archive, sourceId: 'missing' }, () => undefined), /selected|missing/iu);
	assert.equal(getters, 0);
});


test('Light reverse reader preserves an admitted self-contained mask and its saved binding', async () => {
	const f = await fixture(); let consumers = 0;
	const archive = await projectEdit(f.archive, project => {
		const source = (project.sources as Record<string, unknown>[])[0]!, develop = source.develop as Record<string, unknown>;
		develop.masks = [{ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], outputNodeId: 'rectangle',
			nodes: [{ id: 'rectangle', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }] }];
		develop.maskBindings = [{ effectId: 'saved-lut', maskId: 'mask' }];
		(source.provenance as Record<string, unknown>).developSha256 = imageDevelopHandoffRecipeSha256V1(develop);
		project.sources = [normalizeFramescaperImageSourceV2(source)];
	});
	await withPhotoFramescaperHandoffReadV1({ archive, sourceId: f.sourceId }, view => {
		consumers++; assert.deepEqual(view.source.develop.maskBindings, [{ effectId: 'saved-lut', maskId: 'mask' }]);
		assert.equal(view.source.develop.masks[0]?.nodes[0]?.kind, 'vector-shape');
	});
	assert.equal(consumers, 1);
});

test('Light reverse reader captures LUT identity and refuses foreign lifetime without exposing bytes', async () => {
	const f = await fixture(); let getters = 0, borrowers = 0;
	await withPhotoFramescaperHandoffReadV1({ archive: f.archive, sourceId: f.sourceId }, async view => {
		const reference = Object.defineProperty({ ...LUT_REFERENCE }, 'byteLength', { get() { getters++; return LUT_REFERENCE.byteLength; } });
		await assert.rejects(view.withLutBytes(reference, () => { borrowers++; }));
		await assert.rejects(view.withLutBytes(LUT_REFERENCE, () => { borrowers++; }, { signal: new AbortController().signal }), /captured/iu);
		const sha256 = '7'.repeat(64);
		await assert.rejects(view.withLutBytes({ ...LUT_REFERENCE, sha256, storageKey: `lut-sha256:${sha256}` }, () => { borrowers++; }), /closure/iu);
	});
	assert.equal(getters, 0); assert.equal(borrowers, 0);
});

test('Light reverse reader cancels and joins a held LUT borrower before wiping owned bytes', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Symbol('cancel-LUT');
	let borrowed: Uint8Array | undefined;
	const work = withPhotoFramescaperHandoffReadV1({ archive: f.archive, sourceId: f.sourceId, signal: stop.signal }, async view => {
		return await view.withLutBytes(LUT_REFERENCE, async bytes => { borrowed = bytes; entered.resolve(); await release.promise; assert.deepEqual(bytes, LUT_BODY); });
	});
	const refusal = assert.rejects(work, error => error === reason);
	await entered.promise; stop.abort(reason); assert.equal(await remainsPending(work), true); assert.deepEqual(borrowed, LUT_BODY);
	release.resolve(); await refusal; assert.ok(borrowed); assert.ok(borrowed.every(value => value === 0));
});

test('Light reverse reader wipes a late original allocation before preserving cancellation', async () => {
	const f = await fixture(1), stop = new AbortController(), reason = Symbol('late-original');
	const Native = globalThis.Uint8Array; let original: Uint8Array | undefined, consumers = 0;
	globalThis.Uint8Array = new Proxy(Native, { construct(target, args: unknown[], newTarget) {
		const bytes = Reflect.construct(target, args, newTarget) as Uint8Array;
		if (args[0] === PNG.length) { original = bytes; queueMicrotask(() => { stop.abort(reason); }); }
		return bytes;
	} });
	try {
		await assert.rejects(withPhotoFramescaperHandoffReadV1({ archive: f.archive, sourceId: f.sourceId, signal: stop.signal }, () => { consumers++; }), error => error === reason);
		assert.ok(original); assert.ok(original.every(value => value === 0)); assert.equal(consumers, 0);
	} finally { globalThis.Uint8Array = Native; }
});

test('Light reverse reader retains independent immutable original while retiring original byte storage', async () => {
	const f = await fixture(1), Native = globalThis.Uint8Array, owned: Uint8Array[] = [];
	globalThis.Uint8Array = new Proxy(Native, { construct(target, args: unknown[], newTarget) {
		const bytes = Reflect.construct(target, args, newTarget) as Uint8Array;
		if (args[0] === PNG.length || args[0] instanceof Native && args[0].byteLength === PNG.length) owned.push(bytes);
		return bytes;
	} });
	try {
		const original = await withPhotoFramescaperHandoffReadV1({ archive: f.archive, sourceId: f.sourceId }, view => view.originalBlob);
		assert.ok(owned.length > 0); assert.ok(owned.every(bytes => bytes.every(value => value === 0)));
		assert.deepEqual(new Native(await original.arrayBuffer()), PNG);
	} finally { globalThis.Uint8Array = Native; }
});

test('Light reverse reader retires every native pack range backing after joined reading', async () => {
	const f = await fixture(1), Native = globalThis.Uint8Array, ranges: Uint8Array[] = []; let packSize = 0;
	await rewriteLutArchiveFixture(f.archive, files => { const name = [...files.keys()].find(key => key.includes('/image/')); assert.ok(name); packSize = files.get(name)!.length; });
	const species = new Proxy(Native, { construct(target, args: unknown[], newTarget) {
		const bytes = Reflect.construct(target, args, newTarget) as Uint8Array; ranges.push(bytes); return bytes;
	} });
	globalThis.Uint8Array = new Proxy(Native, { construct(target, args: unknown[], newTarget) {
		const bytes = Reflect.construct(target, args, newTarget) as Uint8Array;
		if (args[0] === packSize) Object.defineProperty(bytes, 'constructor', { value: { [Symbol.species]: species } });
		return bytes;
	} });
	try {
		await withPhotoFramescaperHandoffReadV1({ archive: f.archive, sourceId: f.sourceId }, async view => { assert.deepEqual(new Native(await view.originalBlob.arrayBuffer()), PNG); });
		assert.ok(ranges.length > 0); assert.ok(ranges.every(bytes => bytes.every(value => value === 0)));
	} finally { globalThis.Uint8Array = Native; }
});

for (const kind of ['consumer', 'borrower'] as const) test(`Light reverse reader preserves opaque Proxy ${kind} failure without reflection`, async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(); let reflections = 0;
	const reason = new Proxy({}, { getPrototypeOf() { reflections++; throw Symbol('forbidden reason reflection'); } });
	const work = withPhotoFramescaperHandoffReadV1({ archive: f.archive, sourceId: f.sourceId }, async view => {
		if (kind === 'consumer') throw reason;
		void view.withLutBytes(LUT_REFERENCE, async () => { entered.resolve(); await release.promise; throw reason; }).catch(() => undefined);
		await entered.promise;
	});
	const refusal = assert.rejects(work, error => error === reason);
	if (kind === 'borrower') { await entered.promise; assert.equal(await remainsPending(work), true); release.resolve(); }
	await refusal; assert.equal(reflections, 0);
});

test('Light reverse reader preserves opaque native cancellation during original acquisition without reflection', async () => {
	const f = await fixture(1), Native = globalThis.Uint8Array, stop = new AbortController(); let reflections = 0, original: Uint8Array | undefined;
	const reason = new Proxy({}, { getPrototypeOf() { reflections++; throw Symbol('forbidden abort reflection'); } });
	globalThis.Uint8Array = new Proxy(Native, { construct(target, args: unknown[], newTarget) {
		const bytes = Reflect.construct(target, args, newTarget) as Uint8Array;
		if (args[0] === PNG.length) { original = bytes; queueMicrotask(() => { stop.abort(reason); }); }
		return bytes;
	} });
	try {
		await assert.rejects(withPhotoFramescaperHandoffReadV1({ archive: f.archive, sourceId: f.sourceId, signal: stop.signal }, () => assert.fail('cancelled archive consumer')), error => error === reason);
		assert.ok(original); assert.ok(original.every(value => value === 0)); assert.equal(reflections, 0);
	} finally { globalThis.Uint8Array = Native; }
});

test('Light reverse reader joins and wipes canonical frame storage before preserving cancellation', async () => {
	const f = await fixture(1), Native = globalThis.Uint8Array, stop = new AbortController(), reason = Symbol('canonical-frame-cancel');
	let backing: Uint8Array | undefined, before: number[] | undefined, consumers = 0;
	globalThis.Uint8Array = new Proxy(Native, { construct(target, args: unknown[], newTarget) {
		const bytes = Reflect.construct(target, args, newTarget) as Uint8Array;
		if (args[0] === 5) { backing = bytes; queueMicrotask(() => { before = Array.from(bytes); stop.abort(reason); }); }
		return bytes;
	} });
	try {
		await assert.rejects(withPhotoFramescaperHandoffReadV1({ archive: f.archive, sourceId: f.sourceId, signal: stop.signal }, () => { consumers++; }), error => error === reason);
		assert.deepEqual(before, [23, 71, 149, 255, 0]); assert.ok(backing); assert.ok(backing.every(value => value === 0)); assert.equal(consumers, 0);
	} finally { globalThis.Uint8Array = Native; }
});
