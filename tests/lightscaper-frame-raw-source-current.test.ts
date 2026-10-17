/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { createImageDevelopHandoffProvenanceV2 } from '../src/common/editor/image-develop-handoff-provenance-v2.ts';
import { normalizeFramescaperImageSourceV1 } from '../src/common/editor/timeline-image-model.ts';
import { normalizeFramescaperImageSourceV2, normalizeFramescaperImageSourceV1OrV2 } from '../src/common/editor/timeline-image-model-v2.ts';
import { normalizeFramescaperImageSourceV3 } from '../src/common/editor/timeline-image-model-v3.ts';
import { normalizeFramescaperImageSourceV4, framescaperImageSourceResourceReferencesV4 } from '../src/common/editor/timeline-image-model-v4.ts';
import { normalizeFramescaperImageSourceCurrentV1, framescaperImageSourceResourceReferencesCurrentV1 } from '../src/common/editor/timeline-image-model-current-v1.ts';
import { normalizeFramescaperRawOriginalReceiptV1, framescaperRawOriginalPixelsSha256V1 } from '../src/common/editor/timeline-image-raw-receipt-v1.ts';
import { collectFramescaperImageProjectResourcesCurrentV1 } from '../src/common/editor/video-cube-lut-project-references-current-v1.ts';
import { collectCubeLutProfileProjectReferencesV1 } from '../src/common/editor/video-cube-lut-project-references-v1.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { createRawFrameFixtureCurrentV1 } from './helpers/lightscaper-raw-frame-current-fixture.ts';
import { profile, LUT_REFERENCE } from './helpers/lightscaper-masked-frame-fixture.ts';
import { repairRecipe } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
let captured: ReturnType<typeof nativeSource> | undefined;
function fixture() { captured ??= nativeSource(); return captured; }
async function nativeSource() {
	const f = await createRawFrameFixtureCurrentV1({ develop: defaultImageDevelopStateV1(), orientation: 6 });
	try { assert.equal(f.workers.active(), 0); assert.equal(f.workers.statistics.joined, 1); return { source: f.source, pack: f.pack, original: f.original, words: f.native.words }; }
	finally { await f.close(); }
}
type Source = Awaited<ReturnType<typeof nativeSource>>['source'];
function edited(source: Source, value: unknown) {
	const develop = normalizeImageDevelopStateCurrentV1(value);
	return normalizeFramescaperImageSourceV4({ ...source, develop, provenance: createImageDevelopHandoffProvenanceV2({ develop,
		original: source.provenance.original, origin: source.provenance.origin }) });
}
function wordFrame(words: Uint16Array<ArrayBuffer>, width = words.length / 4, height = 1) {
	return { descriptor: { schemaVersion: 1, width, height, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' }, pixels: words };
}
function observed<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }

test('Current Frame source admits an actual native RAW Original receipt beside an unchanged byte presentation pack and process1 recipe', async () => {
	const f = await fixture(), before = structuredClone(f.source);
	assert.equal(f.source.raw.rawFlip, 6); assert.equal(f.source.raw.descriptor.sampleFormat, 'unorm16');
	assert.equal(f.source.raw.descriptor.transfer, 'linear'); assert.equal(f.source.develop.processVersion, 1);
	assert.deepEqual(normalizeFramescaperImageSourceCurrentV1(f.source), f.source);
	assert.deepEqual(normalizeFramescaperImageSourceV4(JSON.parse(JSON.stringify(f.source))), f.source);
	assert.deepEqual(f.source, before); assert.equal(f.source.original.sha256, digest(f.original));
	assert.equal(Object.isFrozen(normalizeFramescaperImageSourceV4(f.source).raw.descriptor), true);
});

test('permanent Source1/2/3 and legacy resource transport refuse Source4 while all unchanged Current recipes retain their schema', async () => {
	const f = await fixture();
	for (const normalize of [normalizeFramescaperImageSourceV1, normalizeFramescaperImageSourceV2, normalizeFramescaperImageSourceV1OrV2, normalizeFramescaperImageSourceV3]) {
		assert.throws(() => normalize(f.source));
	}
	assert.throws(() => collectCubeLutProfileProjectReferencesV1({ sources: [f.source] }));
	for (const develop of [defaultImageDevelopStateV1(), defaultImageDevelopStateV2(), repairRecipe()]) {
		const current = edited(f.source, develop); assert.equal(current.schemaVersion, 4); assert.deepEqual(current.develop, develop);
		assert.deepEqual(current.raw, f.source.raw); assert.deepEqual(current.original, f.source.original);
		assert.equal(current.contentSha256, f.pack.contentSha256); assert.deepEqual(current.provenance.origin, f.source.provenance.origin);
	}
});

test('Source4 binds native format, pinned decoder, extent, alpha, Original and unchanged recipe through closed own metadata', async () => {
	const source = (await fixture()).source;
	const cases = [
		{ ...source, schemaVersion: 5 }, { ...source, raw: { ...source.raw, unexpected: true } },
		{ ...source, raw: { ...source.raw, decoder: { ...source.raw.decoder, sha256: '0'.repeat(64) } } },
		{ ...source, raw: { ...source.raw, decoder: { ...source.raw.decoder, abiVersion: 2 } } },
		{ ...source, raw: { ...source.raw, rawFlip: 8 } }, { ...source, raw: { ...source.raw, pixelEncoding: 'rgba16le' } },
		{ ...source, raw: { ...source.raw, pixelsSha256: 'A'.repeat(64) } },
		{ ...source, raw: { ...source.raw, descriptor: { ...source.raw.descriptor, sampleFormat: 'unorm8' } } },
		{ ...source, raw: { ...source.raw, descriptor: { ...source.raw.descriptor, transfer: 'srgb' } } },
		{ ...source, raw: { ...source.raw, descriptor: { ...source.raw.descriptor, primaries: 'bt709' } } },
		{ ...source, raw: { ...source.raw, descriptor: { ...source.raw.descriptor, width: 33 } } },
		{ ...source, original: { ...source.original, recognizedFormat: 'png', mimeType: 'image/png' } },
		{ ...source, original: { ...source.original, mimeType: 'image/png' } }, { ...source, original: { ...source.original, byteLength: 67_108_865 } },
		{ ...source, original: { ...source.original, sha256: 'a'.repeat(64) } },
		{ ...source, canonical: { ...source.canonical, hasAlpha: true } }, { ...source, canonical: { ...source.canonical, frameCount: 2 } },
		{ ...source, assetByteLength: 536_870_913 }, { ...source, developed: { width: 8193, height: 1 } },
		{ ...source, provenance: { ...source.provenance, developSha256: 'b'.repeat(64) } },
	];
	for (const value of cases) assert.throws(() => normalizeFramescaperImageSourceCurrentV1(value));
	let reads = 0;
	const hostile = { ...source, raw: Object.defineProperty({ ...source.raw }, 'rawFlip', { enumerable: true, get() { reads++; return 6; } }) };
	assert.throws(() => normalizeFramescaperImageSourceV4(hostile), /data/u); assert.equal(reads, 0);
	const crw = { ...source, original: { ...source.original, recognizedFormat: 'crw', mimeType: 'image/x-canon-crw' } };
	assert.equal(normalizeFramescaperImageSourceV4(crw).original.recognizedFormat, 'crw'); // Scalar admission grants no container-byte evidence.
});

test('native word digest uses literal big-endian RGBA16 order and preserves subbyte values and offset source storage', async () => {
	const padded = Uint16Array.of(91, 1, 256, 65534, 65535, 92), words = padded.subarray(1, 5), before = padded.slice();
	const hash = await framescaperRawOriginalPixelsSha256V1(wordFrame(words));
	assert.equal(hash, digest(Uint8Array.of(0, 1, 1, 0, 255, 254, 255, 255)));
	assert.notEqual(hash, digest(Uint8Array.of(1, 0, 0, 1, 254, 255, 255, 255))); assert.deepEqual(padded, before);
	const f = await fixture(), native = new Uint16Array(f.words);
	assert.equal(await framescaperRawOriginalPixelsSha256V1({ descriptor: f.source.raw.descriptor, pixels: native }), f.source.raw.pixelsSha256);
	assert.deepEqual(normalizeFramescaperRawOriginalReceiptV1(f.source.raw), f.source.raw); assert.deepEqual([...native], f.words);
});

test('native word digest refuses unsupported metadata before touching pixels and requires exact opaque native word custody', async () => {
	let reads = 0;
	for (const descriptor of [wordFrame(new Uint16Array(4)).descriptor, { ...wordFrame(new Uint16Array(4)).descriptor, width: 8193 }]) {
		await assert.rejects(framescaperRawOriginalPixelsSha256V1({ descriptor: { ...descriptor, transfer: 'srgb' }, get pixels() { reads++; throw new Error('unreachable'); } }));
	}
	assert.equal(reads, 0);
	await assert.rejects(framescaperRawOriginalPixelsSha256V1(wordFrame(Uint16Array.of(1, 2, 3, 0))), /opaque/iu);
	await assert.rejects(framescaperRawOriginalPixelsSha256V1({ ...wordFrame(Uint16Array.of(1, 2, 3, 65535)), pixels: new Uint16Array(3) }), /sample/iu);
	const words = Uint16Array.of(1, 2, 3, 65535); Object.defineProperty(words, 'buffer', { get() { reads++; return new ArrayBuffer(8); } });
	await assert.rejects(framescaperRawOriginalPixelsSha256V1(wordFrame(words)), /shadow/iu); assert.equal(reads, 0);
});

test('streamed word digest yields and preserves opaque cancellation identity or detached-backing refusal without mutation', async () => {
	const words = new Uint16Array(128 * 128 * 4); for (let at = 3; at < words.length; at += 4) words[at] = 65535;
	const before = words.slice(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	setTimeout(() => { stop.abort(opaque.proxy); }, 0);
	const outcome = observed(framescaperRawOriginalPixelsSha256V1(wordFrame(words, 128, 128), stop.signal));
	const result = await outcome; assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, opaque.proxy), true);
	assert.deepEqual(words, before);
	const detached = new Uint16Array(before);
	setTimeout(() => { structuredClone(detached.buffer, { transfer: [detached.buffer] }); }, 0);
	await assert.rejects(framescaperRawOriginalPixelsSha256V1(wordFrame(detached, 128, 128)), /detach/iu);
	const early = new AbortController(), reason = Symbol('before metadata'); early.abort(reason); let reflected = false;
	await assert.rejects(framescaperRawOriginalPixelsSha256V1(new Proxy({}, { ownKeys() { reflected = true; throw new Error('unreachable'); } }), early.signal), error => Object.is(error, reason));
	assert.equal(reflected, false);
});

test('Source4 retains disabled LUT and unused brush declarations and invokes the complete cross-source identity ledger', async () => {
	const f = await fixture(), brush = await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(0, 255) }, prepared => prepared.reference);
	const develop = normalizeImageDevelopStateCurrentV1({ ...repairRecipe(), effects: [profile(false)], masks: [{ schemaVersion: 2, id: 'unused', name: 'Retained paint', kind: 'matte',
		inputs: [{ name: 'paint', kind: 'alpha', sourceRef: brush.storageKey }], nodes: [{ id: 'paint', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'paint' }], maskBindings: [] });
	const source = edited(f.source, develop), expected = { luts: [LUT_REFERENCE], brushes: [brush] };
	assert.deepEqual(framescaperImageSourceResourceReferencesV4(source), expected);
	assert.deepEqual(framescaperImageSourceResourceReferencesCurrentV1(source), expected);
	assert.deepEqual(collectFramescaperImageProjectResourcesCurrentV1({ sources: [source] }), expected);
	const conflicting = edited(f.source, { ...develop, effects: [{ ...profile(false), params: { lut: { ...LUT_REFERENCE, domainMin: [-1, -1, -1] } } }] });
	assert.throws(() => collectFramescaperImageProjectResourcesCurrentV1({ sources: [source, { ...conflicting, id: 'second', storageKey: 'second' }] }), /conflict/iu);
	const foreign = { ...develop, masks: [{ ...develop.masks[0], inputs: [{ name: 'paint', kind: 'alpha', sourceRef: 'foreign-source' }] }] };
	assert.throws(() => edited(f.source, foreign));
});
