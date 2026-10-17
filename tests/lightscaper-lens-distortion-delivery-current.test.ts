/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
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
const PIXELS = [255, 0, 0, 255, 0, 128, 255, 128, 32, 200, 16, 64];
const POSITIVE = [255, 0, 0, 224, 0, 128, 255, 128, 32, 200, 16, 56];
function lens(amount = 100) { return createVideoEffect('lens-distortion-v1', { id: 'manual-lens', params: { amount } }); }
function recipe(amount = 100) {
	return normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), processVersion: 3,
		repairs: { schemaVersion: 1, spots: [] }, effects: [lens(amount)] });
}

test('Light Frame exact CPU finishing delivers a literal same-extent radial warp with transparent alpha', OPTIONS, async () => {
	const pixels = Uint8Array.from(PIXELS), source = { width: 3, height: 1, pixels }, before = pixels.slice();
	const output = await applyVideoExactBrowserEffectsFinishing(source, [lens()], new AbortController().signal);
	try {
		assert.deepEqual([output.width, output.height], [3, 1]); assert.deepEqual([...output.pixels], POSITIVE);
		assert.notEqual(output.pixels.buffer, pixels.buffer); assert.deepEqual(pixels, before);
	} finally { output.pixels.fill(0); }
	for (const effect of [lens(0), { ...lens(), enabled: false }]) {
		const identity = await applyVideoExactBrowserEffectsFinishing(source, [effect], new AbortController().signal);
		try { assert.deepEqual(identity.pixels, before); assert.notEqual(identity.pixels.buffer, pixels.buffer); }
		finally { identity.pixels.fill(0); }
	}
});

test('Current byte PNG export executes manual lens through its actual selected renderer and preserves native Photo custody', OPTIONS, async () => {
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
		try { assert.deepEqual([decoded.width, decoded.height], [3, 1]); assert.deepEqual([...decoded.pixels], POSITIVE); }
		finally { decoded.pixels.fill(0); }
		assert.equal(f.codecs.calls.opens, 1); assert.equal(f.codecs.calls.closes, 1);
		assert.ok(f.events.indexOf('download') > f.events.indexOf('original-settled'));
		assert.ok(f.borrowed.every(pixels => pixels.every(value => value === 0))); assert.ok(f.encoded.every(bytes => bytes.every(value => value === 0)));
		assert.deepEqual(await f.inspect(), before); assert.deepEqual(before[0]!.bytes, f.bytes);
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

for (const schemaVersion of [2, 3] as const) test(`Light Current Source${schemaVersion} reader executes saved lens while canonical Original and pack stay immutable`, OPTIONS, async () => {
	const base = normalizeImageDevelopStateV2({ ...defaultImageDevelopStateV2(), effects: [lens()] }), f = editableImageFixture({ crop: false, develop: base });
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
			// Every2×2 corner has radius²1/4. A1.075 radial scale leaves
			// each in-bounds tap weight0.9625², hence round(255*w)=236.
			assert.deepEqual([...developed], [255, 0, 0, 236, 0, 255, 0, 236, 0, 0, 255, 236, 255, 255, 255, 236]);
		} finally { developed.fill(0); }
		const returnedOriginal = await reader.readOriginal(); try { assert.deepEqual(returnedOriginal, original); } finally { returnedOriginal.fill(0); }
		assert.equal(JSON.stringify(source), metadata); assert.deepEqual(f.pack.bytes, packed); assert.deepEqual(f.original, original);
	} finally { await reader.closeAndJoin(); }
});

test('RAW Photo handoff retains native receipt, exact Original and unchanged lens recipe, then Source4 renders actual words before final display', OPTIONS, async () => {
	const develop = recipe(37.5), f = await createRawFrameFixtureCurrentV1({ develop, orientation: 6 });
	const original = f.original.slice(), fixturePack = f.pack.bytes.slice(), receipt = JSON.stringify(f.raw), expected = radialRawOracle(f.native.words, 32, 32, 37.5);
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

/** Independent mathematical oracle: native word division rounds once into
 * Float32; four explicit source-center basis weights are summed in linear
 * premultiplied space. Source taps outside the image contribute transparent0.
 * Only the final display applies clipped sRGB transfer and8-bit quantization.
 * No production plan, mapper, pixel writer or renderer supplies expected data. */
function radialRawOracle(words: readonly number[], width: number, height: number, amount: number): Uint8Array<ArrayBuffer> {
	const source = Float32Array.from(words, word => word / 65535), output = new Uint8Array(width * height * 4);
	try {
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			const dx = x + .5 - width / 2, dy = y + .5 - height / 2;
			const r2 = (4 * dx * dx + 4 * dy * dy) / (width * width + height * height), k = amount * .003;
			const sx = width / 2 + dx * (1 + k * r2) - .5, sy = height / 2 + dy * (1 + k * r2) - .5;
			const left = Math.floor(sx), top = Math.floor(sy), fx = sx - left, fy = sy - top;
			const taps = [[left, top, (1 - fx) * (1 - fy)], [left + 1, top, fx * (1 - fy)],
				[left, top + 1, (1 - fx) * fy], [left + 1, top + 1, fx * fy]] as const;
			let red = 0, green = 0, blue = 0, alpha = 0;
			for (const [tx, ty, weight] of taps) {
				if (tx < 0 || tx >= width || ty < 0 || ty >= height) continue;
				const index = (ty * width + tx) * 4, a = source[index + 3]! * weight;
				alpha += a; red += source[index]! * a; green += source[index + 1]! * a; blue += source[index + 2]! * a;
			}
			const offset = (y * width + x) * 4, a = Math.fround(Math.max(0, Math.min(1, alpha)));
			if (a > 0) for (const [channel, sum] of [red, green, blue].entries()) {
				const linear = Math.max(0, Math.min(1, Math.fround(sum / alpha)));
				output[offset + channel] = Math.round(255 * (linear <= .0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - .055));
			}
			output[offset + 3] = Math.round(a * 255);
		}
		return output;
	} catch (error) { output.fill(0); throw error; }
	finally { source.fill(0); }
}
