/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { independentDefringeEncoded } from './helpers/lightscaper-defringe-oracle.ts';
import test from 'node:test';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { openFramescaperCurrentImageFrameSource } from '../src/framescaper/timeline-image-current-frame-source.ts';
import { PhotoRasterExportCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-current-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { decodePhotoImageHandoffSourceCurrentV1 } from '../src/lightscaper/controller/photo-image-handoff-decode-current-v1.ts';
import { createPhotoFramescaperHandoffProjectCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-project-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { createPhotoExportSidecarCurrentV1, serializePhotoExportSidecarCurrentV1 } from '../src/lightscaper/catalog/photo-export-sidecar-current-v1.ts';
import { createImageDevelopHandoffProvenanceV2 } from '../src/common/editor/image-develop-handoff-provenance-v2.ts';
import { normalizeFramescaperImageSourceCurrentV1 } from '../src/common/editor/timeline-image-model-current-v1.ts';
import { framescaperImagePackSourceCurrentV1 } from '../src/common/editor/timeline-image-pack-source-current-v1.ts';
import { openFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { repairRasterFixture, decodePng } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';
import { editableImageFixture, CORNERS } from './helpers/framescaper-editable-image-current-fixture.ts';
import { createRawFrameFixtureCurrentV1 } from './helpers/lightscaper-raw-frame-current-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

const OPTIONS = { concurrency: false, timeout: 30_000 };
const PIXELS = [0, 0, 0, 255, 255, 0, 255, 255, 255, 255, 255, 255];
const EXPECTED = [0, 0, 0, 255, 73, 73, 73, 255, 255, 255, 255, 255];
function defringe(purple = 100, green = 100, edgeThreshold = 25) { return createVideoEffect('defringe-v1', { id: 'manual-defringe', params: { purple, green, edgeThreshold } }); }
function recipe(purple = 100, green = 100, edgeThreshold = 25) {
	return normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), processVersion: 3,
		repairs: { schemaVersion: 1, spots: [] }, effects: [defringe(purple, green, edgeThreshold)] });
}

test('Light Frame exact CPU finishing delivers a literal edge-selective defringe with fixed alpha', OPTIONS, async () => {
	const pixels = Uint8Array.from(PIXELS), source = { width: 3, height: 1, pixels }, before = pixels.slice();
	const output = await applyVideoExactBrowserEffectsFinishing(source, [defringe()], new AbortController().signal);
	try {
		assert.deepEqual([output.width, output.height], [3, 1]); assert.deepEqual([...output.pixels], EXPECTED);
		assert.notEqual(output.pixels.buffer, pixels.buffer); assert.deepEqual(pixels, before);
	} finally { output.pixels.fill(0); }
	for (const effect of [defringe(0, 0), { ...defringe(), enabled: false }]) {
		const identity = await applyVideoExactBrowserEffectsFinishing(source, [effect], new AbortController().signal);
		try { assert.deepEqual(identity.pixels, before); assert.notEqual(identity.pixels.buffer, pixels.buffer); }
		finally { identity.pixels.fill(0); }
	}
});

test('Current byte PNG export executes manual defringe through its actual selected renderer and preserves native Photo custody', OPTIONS, async () => {
	const develop = recipe(), f = await repairRasterFixture(develop, PIXELS), before = await f.inspect(), owner = new PhotoRasterExportCurrentV1('png');
	const actual = createPhotoDevelopRenderRuntimeCurrentV1({ source: f.session.cubeLuts.source, maskSource: f.session.maskRasterSource });
	let renders = 0;
	try {
		const request = { ...f.request(), loadRenderer: async () => ({ withFullResolution: async <Value>(
			value: Parameters<typeof actual.withFullResolution>[0], consume: (view: Parameters<Parameters<typeof actual.withFullResolution>[1]>[0]) => Value | Promise<Value>,
		): Promise<Value> => {
			renders++; assert.deepEqual(value.develop, develop); assert.deepEqual([...value.frame.pixels], PIXELS);
			return actual.withFullResolution(value, consume);
		} }) };
		const receipt = await Reflect.apply(owner.start, owner, [request]) as Awaited<ReturnType<typeof owner.start>>;
		assert.equal(receipt.status, 'download-started'); assert.equal(renders, 1); assert.equal(f.outputs.length, 1);
		const decoded = decodePng(f.outputs[0]!.bytes);
		try { assert.deepEqual([decoded.width, decoded.height], [3, 1]); assert.deepEqual([...decoded.pixels], EXPECTED); }
		finally { decoded.pixels.fill(0); }
		assert.equal(f.codecs.calls.opens, 1); assert.equal(f.codecs.calls.closes, 1);
		assert.ok(f.events.indexOf('download') > f.events.indexOf('original-settled'));
		assert.ok(f.borrowed.every(pixels => pixels.every(value => value === 0))); assert.ok(f.encoded.every(bytes => bytes.every(value => value === 0)));
		assert.deepEqual(await f.inspect(), before); assert.deepEqual(before[0]!.bytes, f.bytes);
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

for (const schemaVersion of [2, 3] as const) test(`Light Current Source${schemaVersion} reader executes saved defringe while canonical Original and pack stay immutable`, OPTIONS, async () => {
	const base = normalizeImageDevelopStateV2({ ...defaultImageDevelopStateV2(), effects: [defringe()] }), f = editableImageFixture({ crop: false, develop: base });
	const develop = schemaVersion === 2 ? f.source.develop : recipe();
	const source = normalizeFramescaperImageSourceCurrentV1(schemaVersion === 2 ? f.source : { ...f.source, schemaVersion: 3, develop,
		provenance: createImageDevelopHandoffProvenanceV2({ original: f.source.provenance.original, develop,
			origin: { ...f.source.provenance.origin, schemaVersion: 3 } }) });
	const metadata = JSON.stringify(source), packed = f.pack.bytes.slice(), original = f.original.slice();
	const reader = await openFramescaperCurrentImageFrameSource(f.store, source);
	try {
		let canonicalBacking: ArrayBuffer | undefined;
		await reader.withCanonicalFrame(frame => {
			canonicalBacking = frame.pixels.buffer; assert.deepEqual([...frame.pixels], CORNERS);
			assert.deepEqual([frame.descriptor.width, frame.descriptor.height], [2, 2]);
		});
		assert.ok(canonicalBacking); assert.ok(new Uint8Array(canonicalBacking).every(value => value === 0));
		const developed = await reader.readFrame(0);
		try {
			// Only the green corner has an opponent excess. Neighbor contrast
			// and relative excess fully gate its encoded luma183*255/256.
			assert.deepEqual([...developed], [255, 0, 0, 255, 182, 182, 182, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
		} finally { developed.fill(0); }
		const returnedOriginal = await reader.readOriginal(); try { assert.deepEqual(returnedOriginal, original); } finally { returnedOriginal.fill(0); }
		assert.equal(JSON.stringify(source), metadata); assert.deepEqual(f.pack.bytes, packed); assert.deepEqual(f.original, original);
	} finally { await reader.closeAndJoin(); }
});

test('RAW Photo handoff retains native receipt, exact Original and unchanged defringe recipe, then Source4 renders actual words before final display', OPTIONS, async () => {
	const develop = recipe(100, 100, 0), f = await createRawFrameFixtureCurrentV1({ develop, orientation: 6 });
	const original = f.original.slice(), fixturePack = f.pack.bytes.slice(), receipt = JSON.stringify(f.raw), expected = defringeRawOracle(f.native.words, 32, 100, 100, 0);
	try { await f.withDefaultTransport(async () => {
		const seed = photoArchiveFixture(1, f.original).photo;
		const photo = normalizePhotoDocumentCurrentV1({ ...seed, schemaVersion: 3,
			original: { ...seed.original, name: 'Native precision.dng', mimeType: 'image/x-adobe-dng', width: 32, height: 32 },
			versions: [{ ...seed.versions[0]!, develop }] });
		const factsJson = serializePhotoExportSidecarCurrentV1(createPhotoExportSidecarCurrentV1(photo,
			{ catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision }));
		const handoff = await decodePhotoImageHandoffSourceCurrentV1({ factsJson, originalBlob: f.originalBlob, signal: new AbortController().signal,
			original: { exactName: photo.original.name, mimeType: photo.original.mimeType, contentSha256: photo.original.contentSha256,
				byteLength: photo.original.byteLength, width: 32, height: 32, hasAlpha: false } }, 'native-lens-handoff',
			{ openImage: async () => assert.fail('Retained RAW may not enter a browser raster decoder.') });
		assert.equal(handoff.source.schemaVersion, 4); if (handoff.source.schemaVersion !== 4) assert.fail('RAW must retain Source4.');
		assert.deepEqual(handoff.source.develop, develop); assert.equal(JSON.stringify(handoff.source.raw), receipt);
		assert.deepEqual(handoff.source.original, { ...f.source.original, fileName: photo.original.name });
		const project = createPhotoFramescaperHandoffProjectCurrentV1(handoff.source,
			{ projectId: 'lens-native-project', sequenceId: 'lens-sequence', trackId: 'lens-track', clipId: 'lens-clip', now: '2026-10-15T00:00:00.000Z' });
		assert.deepEqual(project.sources.find(source => source.id === handoff.source.id), handoff.source);
		const packed = new Uint8Array(await handoff.body.arrayBuffer()), metadata = JSON.stringify(handoff.source);
		const pack = await openFramescaperImageFramePackV1({ source: framescaperImagePackSourceCurrentV1(handoff.source),
			read: (offset, length) => packed.slice(offset, offset + length) });
		assert.deepEqual(pack.receipt, { schemaVersion: 1, kind: 'raw-original', raw: f.raw });
		const retainedOriginal = await pack.readOriginal(), baseCache = await pack.readFrame(0);
		try { assert.deepEqual(retainedOriginal, original); assert.deepEqual(baseCache, f.cache); assert.notDeepEqual(baseCache, expected); }
		finally { retainedOriginal.fill(0); baseCache.fill(0); }
		const store = { async loadMediaAsset(key: string) { assert.equal(this, store); assert.equal(key, handoff.source.storageKey); return handoff.body; } };
		const reader = await openFramescaperCurrentImageFrameSource(store, handoff.source);
		try {
			await reader.withCanonicalFrame(frame => {
				assert.equal(frame.descriptor.sampleFormat, 'unorm16'); assert.deepEqual([...frame.pixels], f.native.words);
				assert.equal(f.workers.active(), 0);
			});
			const output = await reader.readFrame(0);
			try { assert.deepEqual(output, expected); assert.equal(f.workers.active(), 0); assert.equal(f.workers.statistics.created, f.workers.statistics.joined); }
			finally { output.fill(0); }
			const fromReader = await reader.readOriginal(); try { assert.deepEqual(fromReader, original); } finally { fromReader.fill(0); }
		} finally { await reader.closeAndJoin(); }
		assert.equal(JSON.stringify(handoff.source), metadata); assert.deepEqual(new Uint8Array(await handoff.body.arrayBuffer()), packed);
		assert.deepEqual(f.original, original); assert.deepEqual(f.pack.bytes, fixturePack); assert.equal(JSON.stringify(f.raw), receipt);
	}); } finally { expected.fill(0); await f.close(); }
});

test('Actual Current defringe evaluates reduced native neighborhoods before processing while Full keeps natural context', OPTIONS, async () => {
	const width = 4096, pixels = new Float32Array(width * 4);
	for (let x = 0; x < width; x++) pixels.set(x % 4 === 0 ? [0, 0, 0, 1] : x % 4 === 3 ? [1, 1, 1, 1] : [1, 0, 1, 1], x * 4);
	const source = { descriptor: { schemaVersion: 1 as const, width, height: 1, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }, pixels };
	const before = pixels.slice(), runtime = createPhotoDevelopRenderRuntimeCurrentV1(), develop = recipe(100, 0, 25);
	let retired: Float32Array<ArrayBuffer> | undefined;
	const proxy = await runtime.withProxy({ frame: source, develop, signal: new AbortController().signal }, view => {
		assert.equal(view.frame.descriptor.width, 2048); assert.ok(view.frame.pixels instanceof Float32Array);
		assert.equal(view.histogram.sampledPixels, 2048); retired = view.frame.pixels; return view.frame.pixels.slice();
	});
	const full = await runtime.withFullResolution({ frame: source, develop, signal: new AbortController().signal }, view => {
		assert.equal(view.frame.descriptor.width, width); assert.ok(view.frame.pixels instanceof Float32Array); return view.frame.pixels.slice();
	});
	try {
		// Nearest proxy sampling keeps black/magenta and removes the white
		// neighbor that fully gates natural source pixel2. Its contrast gate
		// is only4*(73/256−1/4)=9/64; relative excess already saturates.
		const luma = 73 / 256, weight = 9 / 64;
		for (let x = 0; x < 2048; x++) {
			const expected = x % 2 === 0 ? [0, 0, 0] : [decoded(1 + weight * (luma - 1)), decoded(weight * luma), decoded(1 + weight * (luma - 1))];
			for (let c = 0; c < 3; c++) assert.ok(Math.abs(proxy[x * 4 + c]! - expected[c]!) <= 2e-7);
			assert.equal(proxy[x * 4 + 3], 1);
		}
		assert.ok(Math.abs(full[8]! - decoded(luma)) <= 2e-7); assert.ok(Math.abs(proxy[4]! - full[8]!) > .1);
		assert.ok(retired?.every(value => value === 0)); assert.deepEqual(pixels, before);
	} finally { proxy.fill(0); full.fill(0); pixels.fill(0); before.fill(0); }
});

/** Reference operates on actual decoded native words, aggregates each source
 * address's logical-neighborhood multiplicity, and quantizes only at native
 * stage write and final display. No production sampler/renderer supplies it. */
function defringeRawOracle(words: readonly number[], width: number, purple: number, green: number, threshold: number): Uint8Array<ArrayBuffer> {
	const linear = Float32Array.from(words, word => word / 65535), encoded = [...linear].map((value, index) => index % 4 === 3 ? value : encode(value));
	const corrected = independentDefringeEncoded(encoded, width, purple, green, threshold), output = new Uint8Array(words.length);
	try {
		for (let i = 0; i < output.length; i++) {
			if (i % 4 === 3) output[i] = Math.round(255 * linear[i]!);
			else {
				const sample = corrected[i] === encoded[i] ? linear[i]! : Math.fround(decoded(corrected[i]!));
				const clipped = Math.max(0, Math.min(1, sample)); output[i] = Math.round(255 * encode(clipped));
			}
		}
		return output;
	} catch (error) { output.fill(0); throw error; }
	finally { linear.fill(0); encoded.fill(0); corrected.fill(0); }
}
function encode(value: number): number { const n = Math.abs(value); return Math.sign(value) * (n <= .0031308 ? 12.92 * n : 1.055 * n ** (1 / 2.4) - .055); }
function decoded(value: number): number { const n = Math.abs(value); return Math.sign(value) * (n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4); }
