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
const PIXELS = [0, 0, 0, 255, 200, 200, 200, 255, 0, 0, 0, 255];
const EXPECTED = [1, 0, 0, 255, 200, 200, 200, 255, 1, 0, 0, 255];
function correction(red = -100, blue = 100) { return createVideoEffect('chromatic-aberration-v1', { id: 'manual-ca', params: { red, blue } }); }
function recipe(red = -100, blue = 100) {
	return normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), processVersion: 3,
		repairs: { schemaVersion: 1, spots: [] }, effects: [correction(red, blue)] });
}

test('Light Frame exact CPU finishing delivers a literal independent red/blue correction with fixed green and alpha', OPTIONS, async () => {
	const pixels = Uint8Array.from(PIXELS), source = { width: 3, height: 1, pixels }, before = pixels.slice();
	const output = await applyVideoExactBrowserEffectsFinishing(source, [correction()], new AbortController().signal);
	try {
		assert.deepEqual([output.width, output.height], [3, 1]); assert.deepEqual([...output.pixels], EXPECTED);
		assert.notEqual(output.pixels.buffer, pixels.buffer); assert.deepEqual(pixels, before);
	} finally { output.pixels.fill(0); }
	for (const effect of [correction(0, 0), { ...correction(), enabled: false }]) {
		const identity = await applyVideoExactBrowserEffectsFinishing(source, [effect], new AbortController().signal);
		try { assert.deepEqual(identity.pixels, before); assert.notEqual(identity.pixels.buffer, pixels.buffer); }
		finally { identity.pixels.fill(0); }
	}
});

test('Current byte PNG export executes manual chromatic correction through its actual selected renderer and preserves native Photo custody', OPTIONS, async () => {
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

for (const schemaVersion of [2, 3] as const) test(`Light Current Source${schemaVersion} reader executes saved chromatic correction while canonical Original and pack stay immutable`, OPTIONS, async () => {
	const base = normalizeImageDevelopStateV2({ ...defaultImageDevelopStateV2(), effects: [correction()] }), f = editableImageFixture({ crop: false, develop: base });
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
			// Each corner has radius²1/4. Red samples inward by1/800
			// on both axes; blue samples outward and retains corner color.
			assert.deepEqual([...developed], [254, 0, 0, 255, 1, 255, 0, 255, 1, 0, 255, 255, 254, 255, 255, 255]);
		} finally { developed.fill(0); }
		const returnedOriginal = await reader.readOriginal(); try { assert.deepEqual(returnedOriginal, original); } finally { returnedOriginal.fill(0); }
		assert.equal(JSON.stringify(source), metadata); assert.deepEqual(f.pack.bytes, packed); assert.deepEqual(f.original, original);
	} finally { await reader.closeAndJoin(); }
});

test('RAW Photo handoff retains native receipt, exact Original and unchanged chromatic recipe, then Source4 renders actual words before final display', OPTIONS, async () => {
	const develop = recipe(37.5, -62.5), f = await createRawFrameFixtureCurrentV1({ develop, orientation: 6 });
	const original = f.original.slice(), fixturePack = f.pack.bytes.slice(), receipt = JSON.stringify(f.raw), expected = chromaticRawOracle(f.native.words, 32, 32, 37.5, -62.5);
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

test('Actual Current CA evaluates its native reduced grid before processing and keeps Full natural pixels distinct', OPTIONS, async () => {
	const width = 4096, pixels = new Float32Array(width * 4);
	for (let x = 0; x < width; x++) { const wave = x % 4 === 1 || x % 4 === 2 ? 1 : 0; pixels.set([wave * 2 - .25, x / 65535, (1 - wave) * 2, 1], x * 4); }
	const source = { descriptor: { schemaVersion: 1 as const, width, height: 1, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }, pixels };
	const before = pixels.slice(), runtime = createPhotoDevelopRenderRuntimeCurrentV1(), develop = recipe(-100, 100);
	let retired: Float32Array<ArrayBuffer> | undefined;
	const proxy = await runtime.withProxy({ frame: source, develop, signal: new AbortController().signal }, view => {
		assert.equal(view.frame.descriptor.width, 2048); assert.ok(view.frame.pixels instanceof Float32Array);
		assert.equal(view.histogram.sampledPixels, 2048); retired = view.frame.pixels; return view.frame.pixels.slice();
	});
	const full = await runtime.withFullResolution({ frame: source, develop, signal: new AbortController().signal }, view => {
		assert.equal(view.frame.descriptor.width, width); assert.ok(view.frame.pixels instanceof Float32Array); return view.frame.pixels.slice();
	});
	try {
		for (let x = 0; x < 2048; x++) {
			assert.equal(proxy[x * 4 + 1], before[x * 8 + 1]); assert.equal(proxy[x * 4 + 3], 1);
			for (const [channel, amount] of [[0, -100], [2, 100]] as const) {
				const expected = independentlySample1d(2048, x, amount, index => before[index * 8 + channel]!);
				assert.ok(Math.abs(proxy[x * 4 + channel]! - expected) <= 1e-6);
			}
		}
		assert.ok(proxy.some((value, index) => index % 4 === 0 && value < 0));
		assert.ok(proxy.some((value, index) => index % 4 === 0 && value > 1));
		assert.ok(proxy.some((value, index) => index % 4 === 0 && Math.abs(value - full[Math.floor(index / 4) * 8]!) > .01));
		assert.ok(retired?.every(value => value === 0)); assert.deepEqual(pixels, before);
	} finally { proxy.fill(0); full.fill(0); pixels.fill(0); before.fill(0); }
});

function independentlySample1d(width: number, x: number, amount: number, sample: (index: number) => number): number {
	const dx = x + .5 - width / 2, sx = x + dx * amount / 10000 * dx * dx / (width * width / 4 + .25);
	const left = Math.floor(sx); let sum = 0, support = 0;
	for (const index of [left, left + 1]) if (index >= 0 && index < width) {
		const weight = Math.max(0, 1 - Math.abs(sx - index)); support += weight; sum += sample(index) * weight;
	}
	return support > 0 ? Math.fround(sum / support) : 0;
}

/** Independent basis-function oracle, using only native words and the written
 * R/B coordinate equations. G/A copy the reference grid. Native channel writes
 * round once to Float32; final display alone encodes sRGB and quantizes bytes. */
function chromaticRawOracle(words: readonly number[], width: number, height: number, red: number, blue: number): Uint8Array<ArrayBuffer> {
	const source = Float32Array.from(words, word => word / 65535), output = new Uint8Array(width * height * 4);
	try {
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			const offset = (y * width + x) * 4, dx = x + .5 - width / 2, dy = y + .5 - height / 2;
			const radius = 4 * (dx * dx + dy * dy) / (width * width + height * height);
			for (let channel = 0; channel < 3; channel++) {
				const amount = channel === 0 ? red : channel === 2 ? blue : 0;
				let value = source[offset + channel]!;
				if (amount !== 0) {
					const sx = x + dx * amount * radius / 10000, sy = y + dy * amount * radius / 10000;
					const left = Math.floor(sx), top = Math.floor(sy); let color = 0, alpha = 0;
					for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++) {
						if (xx < left || xx > left + 1 || yy < top || yy > top + 1) continue;
						const weight = Math.max(0, 1 - Math.abs(sx - xx)) * Math.max(0, 1 - Math.abs(sy - yy));
						const index = (yy * width + xx) * 4, a = source[index + 3]! * weight;
						alpha += a; color += source[index + channel]! * a;
					}
					value = alpha > 0 ? Math.fround(color / alpha) : 0;
				}
				const linear = Math.max(0, Math.min(1, value));
				output[offset + channel] = Math.round(255 * (linear <= .0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - .055));
			}
			output[offset + 3] = Math.round(source[offset + 3]! * 255);
		}
		return output;
	} catch (error) { output.fill(0); throw error; }
	finally { source.fill(0); }
}
