/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createPhotoImageHandoffSourceV1 } from '../src/lightscaper/controller/photo-image-handoff-source-v1.ts';
import { createFramescaperImageFramePackV1, openFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { framescaperImageSourceResourceReferencesV2 } from '../src/common/editor/timeline-image-model-v2.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageGeometryVideoEffectV1 } from '../src/common/editor/video-image-geometry-v1.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { currentRecipe } from './helpers/lightscaper-current-develop-session-fixture.ts';

/** Actual shared pack and Photo owners; these synthetic original bytes do not
 * claim native raster ingestion or cross-product browser qualification. */
function fixture(processVersion: 1 | 2 = 2, geometry = false) {
	const originalBytes = new TextEncoder().encode('exact immutable encoded original');
	const pixels = Uint8Array.from(Array.from({ length: 8 }, (_, index) => [index * 23, 17, 71, 255]).flat());
	const pack = createFramescaperImageFramePackV1({ original: originalBytes,
		receipt: { schemaVersion: 1, orientation: 8, decoder: { id: 'browser-native', version: 'fixture' } },
		width: 4, height: 2, timingMode: 'fallback', frames: [{ presentationTicks: 0n, durationTicks: 5_000_000n, rgba: pixels }] });
	const base = photoArchiveFixture(1, originalBytes).photo;
	const develop = normalizeImageDevelopStateV1OrV2({ ...base.versions[0]!.develop, processVersion,
		geometry: { crop: { x: .5, y: 0, width: .5, height: 1 }, rotationDegrees: 90, flipHorizontal: true, flipVertical: false },
		effects: geometry ? [normalizeImageGeometryVideoEffectV1({ id: 'second-crop', type: 'develop-geometry-v1', enabled: true,
			params: { cropWidth: .5, cropHeight: 1 } }), normalizeImageGeometryVideoEffectV1({ id: 'disabled-crop', type: 'develop-geometry-v1', enabled: false,
			params: { cropWidth: .5, rotationDegrees: 90 } })] : processVersion === 2 ? currentRecipe().effects : [] });
	const photo = normalizePhotoDocumentV1OrV2({ ...base, schemaVersion: processVersion,
		original: { ...base.original, name: 'e\u0301.png', width: 4, height: 2 },
		versions: [base.versions[0]!, { ...base.versions[0]!, id: 'selected-copy', kind: 'virtual-copy', name: 'Saved copy', develop }],
		activeVersionId: 'selected-copy' });
	const factsJson = serializePhotoExportSidecarV1(createPhotoExportSidecarV1(photo,
		{ catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision }));
	const request = { sourceId: 'destination-image', factsJson,
		original: { mimeType: photo.original.mimeType, width: photo.original.width, height: photo.original.height, hasAlpha: photo.original.hasAlpha }, pack };
	return { request, photo, originalBytes, pixels, pack };
}
async function reader(result: Awaited<ReturnType<typeof createPhotoImageHandoffSourceV1>>) {
	const { develop: _develop, developed: _developed, provenance: _provenance, ...base } = result.source;
	const bytes = new Uint8Array(await result.body.arrayBuffer());
	return openFramescaperImageFramePackV1({ source: { ...base, schemaVersion: 1 }, read: (offset, length) => bytes.slice(offset, offset + length) });
}

for (const processVersion of [1, 2] as const) test(`Light selected Photo${processVersion} preserves saved recipe, exact original and virtual-copy provenance`, async () => {
	const f = fixture(processVersion), before = structuredClone(f.photo), packBefore = f.pack.bytes.slice();
	const result = await createPhotoImageHandoffSourceV1(f.request), source = result.source;
	assert.equal(source.schemaVersion, 2); assert.equal(source.develop.processVersion, processVersion);
	assert.deepEqual(source.develop, f.photo.versions[1]!.develop); assert.deepEqual(source.developed, { width: 2, height: 2 });
	assert.equal(source.original.fileName, 'é.png'); assert.equal(source.provenance.original.exactName, 'e\u0301.png');
	assert.deepEqual(source.provenance.origin, { schemaFamily: 'lightscaper', schemaVersion: processVersion, catalogId: f.photo.catalogId,
		photoId: f.photo.id, revision: f.photo.revision, versionId: 'selected-copy', versionKind: 'virtual-copy', versionName: 'Saved copy',
		versionCreatedAt: f.photo.versions[1]!.createdAt });
	const opened = await reader(result);
	assert.deepEqual(await opened.readOriginal(), f.originalBytes); assert.deepEqual(await opened.readFrame(0), f.pixels);
	assert.deepEqual(f.photo, before); assert.deepEqual(f.pack.bytes, packBefore);
	assert.ok(Object.isFrozen(source)); assert.ok(Object.isFrozen(source.develop));
});

test('Light current editable source retains disabled recipe LUT references without borrowing or applying them', async () => {
	const f = fixture(), result = await createPhotoImageHandoffSourceV1(f.request);
	assert.deepEqual(framescaperImageSourceResourceReferencesV2(result.source), [currentRecipe().effects[0]!.params.lut]);
	assert.equal(result.source.develop.effects[0]!.enabled, false);
	assert.deepEqual(await (await reader(result)).readFrame(0), f.pixels);
});

test('Light natural output follows legacy geometry then enabled shared geometry in saved order', async () => {
	const f = fixture(2, true), result = await createPhotoImageHandoffSourceV1(f.request);
	assert.deepEqual(result.source.developed, { width: 1, height: 2 });
	const runtime = createPhotoDevelopRenderRuntimeV2();
	const rendered = await runtime.withFullResolution({ frame: { descriptor: { schemaVersion: 1, width: 4, height: 2,
		sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: f.pixels }, develop: result.source.develop,
		signal: new AbortController().signal }, view => ({ width: view.frame.descriptor.width, height: view.frame.descriptor.height }));
	assert.deepEqual(result.source.developed, rendered);
});

test('Light source rejects selected facts whose active version differs from its captured saved version', async () => {
	const f = fixture(), changed = normalizePhotoDocumentV1OrV2({ ...f.photo, activeVersionId: f.photo.versions[0]!.id });
	const factsJson = serializePhotoExportSidecarV1(createPhotoExportSidecarV1(changed,
		{ catalogId: changed.catalogId, photoId: changed.id, versionId: 'selected-copy', expectedRevision: changed.revision }));
	await assert.rejects(createPhotoImageHandoffSourceV1({ ...f.request, factsJson }), /active.*version|saved.*version/iu);
});

test('Light source rejects noncanonical saved facts and future process versions', async () => {
	const f = fixture();
	await assert.rejects(createPhotoImageHandoffSourceV1({ ...f.request, factsJson: ` ${f.request.factsJson}` }), /canonical/iu);
	await assert.rejects(createPhotoImageHandoffSourceV1({ ...f.request, factsJson: f.request.factsJson.replace('"processVersion":2', '"processVersion":3') }), /process.*version/iu);
});

for (const [key, value] of [['width', 3], ['height', 1], ['hasAlpha', true]] as const) test(`Light source refuses decoded pack ${key} drift from selected original geometry`, async () => {
	const f = fixture();
	await assert.rejects(createPhotoImageHandoffSourceV1({ ...f.request, original: { ...f.request.original, [key]: value } }), /original.*geometry|original.*alpha|binding/iu);
});

test('Light source authenticates whole pack bytes before exposing an archive body', async () => {
	const f = fixture(), bytes = f.pack.bytes.slice(); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
	await assert.rejects(createPhotoImageHandoffSourceV1({ ...f.request, pack: { ...f.pack, bytes } }), /digest/iu);
});

test('Light source rejects a valid other original pack even with the same dimensions', async () => {
	const f = fixture(), pack = createFramescaperImageFramePackV1({ original: new TextEncoder().encode('another immutable encoded original'),
		receipt: { schemaVersion: 1 }, width: 4, height: 2, timingMode: 'fallback', frames: [{ presentationTicks: 0n, durationTicks: 5_000_000n, rgba: f.pixels }] });
	await assert.rejects(createPhotoImageHandoffSourceV1({ ...f.request, pack }), /original.*binding|original.*digest/iu);
});

test('Light pack snapshot is independent of caller mutation after admission', async () => {
	const f = fixture(), expected = f.pack.bytes.slice(), work = createPhotoImageHandoffSourceV1(f.request);
	f.pack.bytes.fill(0); f.request.original.width = 1; f.request.factsJson = '{}';
	const result = await work; assert.deepEqual(new Uint8Array(await result.body.arrayBuffer()), expected);
	assert.deepEqual(await (await reader(result)).readOriginal(), f.originalBytes);
});

test('Light source preserves opaque cancellation and publishes no result', async () => {
	const f = fixture(), stop = new AbortController(), reason = Symbol('cancel-source');
	const work = createPhotoImageHandoffSourceV1({ ...f.request, signal: stop.signal }); stop.abort(reason);
	await assert.rejects(work, cause => cause === reason);
});

test('Light source refuses caller signal overrides without invoking their getters', async () => {
	const f = fixture(), stop = new AbortController(); let reads = 0;
	Object.defineProperty(stop.signal, 'aborted', { get() { reads++; throw Symbol('getter'); } });
	await assert.rejects(createPhotoImageHandoffSourceV1({ ...f.request, signal: stop.signal }), /native|unmodified/iu);
	assert.equal(reads, 0);
});

test('Light source uses native joined cancellation after caller overrides mutate during the first yield', async () => {
	const f = fixture(), stop = new AbortController(), reason = Symbol('native reason'); let reads = 0;
	const work = createPhotoImageHandoffSourceV1({ ...f.request, signal: stop.signal });
	Object.defineProperties(stop.signal, { aborted: { get() { reads++; return false; } }, reason: { get() { reads++; return 'replaced'; } } });
	stop.abort(reason); await assert.rejects(work, cause => cause === reason); assert.equal(reads, 0);
});

test('Light source never invokes late signal accessors when authenticating its frame pack', async () => {
	const f = fixture(), stop = new AbortController(); let reads = 0;
	const work = createPhotoImageHandoffSourceV1({ ...f.request, signal: stop.signal });
	Object.defineProperties(stop.signal, { aborted: { get() { reads++; return false; } }, reason: { get() { reads++; return 'replaced'; } } });
	assert.equal((await work).source.id, f.request.sourceId); assert.equal(reads, 0);
});

test('Light source wipes its owned decoded plane when cancellation lands after the last compressed read', async () => {
	const f = fixture(), stop = new AbortController(), reason = Symbol('cancel-late');
	const offset = Number(new DataView(f.pack.bytes.buffer).getBigUint64(80, true));
	const slice = Uint8Array.prototype.slice, fill = Uint8Array.prototype.fill; let reached = false, wiped = false;
	const sliced = test.mock.method(Uint8Array.prototype, 'slice', function (this: Uint8Array, start?: number, end?: number) {
		const bytes = slice.call(this, start, end);
		if (start === offset) { reached = true; queueMicrotask(() => { stop.abort(reason); }); }
		return bytes;
	});
	const filled = test.mock.method(Uint8Array.prototype, 'fill', function (this: Uint8Array, value: number, start?: number, end?: number) {
		if (value === 0 && this.length === f.pixels.length && this !== f.pixels && this[1] === f.pixels[1]) wiped = true;
		return fill.call(this, value, start, end);
	});
	try {
		await assert.rejects(createPhotoImageHandoffSourceV1({ ...f.request, signal: stop.signal }), cause => cause === reason);
		assert.equal(reached, true); assert.equal(wiped, true); assert.ok(f.pixels.some(value => value !== 0));
	} finally { sliced.mock.restore(); filled.mock.restore(); }
});

test('Light source authenticates the original section even when complete pack digest is re-signed', async () => {
	const f = fixture(), bytes = f.pack.bytes.slice();
	// The canonical pack header carries the original offset at byte 32.
	const offset = Number(new DataView(bytes.buffer).getBigUint64(32, true)); bytes[offset] = bytes[offset]! ^ 1;
	const pack = { ...f.pack, bytes, contentSha256: createHash('sha256').update(bytes).digest('hex') };
	await assert.rejects(createPhotoImageHandoffSourceV1({ ...f.request, pack }), /original.*digest|original.*section|header/iu);
});
