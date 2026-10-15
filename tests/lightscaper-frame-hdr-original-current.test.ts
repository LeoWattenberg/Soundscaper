/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { createImageDevelopHandoffProvenanceHdrCurrentV1 } from '../src/common/editor/image-develop-handoff-provenance-hdr-current-v1.ts';
import { createFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { normalizeFramescaperHdrImageSourceCurrentV1 } from '../src/common/editor/timeline-image-model-hdr-current-v1.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../src/common/editor/timeline-image-model.ts';
import { withFramescaperHdrImageOriginalCurrentV1 } from '../src/common/editor/timeline-image-hdr-original-current-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const samples = [3, .5, -.25, 1, 1e-30, -0, 1 / 65535, 1];
function canonical(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`).join(',')}}`;
}
function fixture(receiptPatch: Record<string, unknown> = {}) {
	const metadata = { schemaVersion: 1, operation: 'hdr-merge-v1', referenceIndex: 0, alignment: 'none', deghost: { mode: 'off', threshold: .15 },
		inputs: [0, 1].map(index => ({ product: 'lightscaper', ownerId: 'catalog', sourceId: `photo-${index}`, revision: 1,
			original: { fileName: `${index}.dng`, mimeType: 'image/x-adobe-dng', sha256: String(index + 1).repeat(64), byteLength: 1024, width: 2, height: 1 },
			profile: 'linear-srgb16', exposureMultiplier: index ? .25 : 1, offset: { x: 0, y: 0 }, alignmentError: 0, alignmentSupport: 2 })),
		output: { x: 0, y: 0, width: 2, height: 1 } };
	const json = new TextEncoder().encode(canonical(metadata)), payloadOffset = Math.ceil((64 + json.length) / 4) * 4;
	const original = new Uint8Array(payloadOffset + 24), view = new DataView(original.buffer);
	original.set(new TextEncoder().encode('LSCHDRF1')); view.setUint32(8, 64, true); view.setUint32(12, 1, true);
	view.setUint32(16, 2, true); view.setUint32(20, 1, true); view.setUint32(24, json.length, true); view.setUint32(28, 24, true);
	original.set(createHash('sha256').update(json).digest(), 32); original.set(json, 64);
	for (let pixel = 0; pixel < 2; pixel++) for (let channel = 0; channel < 3; channel++) view.setFloat32(payloadOffset + (pixel * 3 + channel) * 4, samples[pixel * 4 + channel]!, true);
	const descriptor = { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' };
	const hdr = { schemaVersion: 1, format: 'lightscaper-hdr', bodyVersion: 1, descriptor, pixelEncoding: 'rgb32f-le',
		pixelsSha256: digest(original.subarray(payloadOffset)), metadataSha256: digest(json), ...receiptPatch };
	// Deliberately unrelated byte presentation cache must never become authority.
	const pack = createFramescaperImageFramePackV1({ original, receipt: { schemaVersion: 1, kind: 'hdr-original', hdr }, width: 2, height: 1,
		timingMode: 'fallback', frames: [{ presentationTicks: 0n, durationTicks: 1000000n, rgba: Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 255) }] });
	const develop = defaultImageDevelopStateV1(), provenance = createImageDevelopHandoffProvenanceHdrCurrentV1({ develop,
		original: { exactName: 'HDR master.lshdr', sha256: pack.originalSha256, byteLength: original.length },
		origin: { schemaFamily: 'framescaper', schemaVersion: 1, projectId: 'project', revision: 1, sourceId: 'hdr', sequenceId: 'sequence', clipId: 'clip' } });
	const source = normalizeFramescaperHdrImageSourceCurrentV1({ schemaVersion: 5, kind: 'image', id: 'hdr', name: 'HDR', storageKey: 'hdr',
		mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, contentSha256: pack.contentSha256, assetByteLength: pack.assetByteLength,
		original: { fileName: 'HDR master.lshdr', mimeType: 'image/x-lightscaper-hdr', recognizedFormat: 'lightscaper-hdr', byteLength: original.length, sha256: pack.originalSha256 },
		canonical: { width: 2, height: 1, hasAlpha: false, frameCount: 1, durationTicks: '1000000', timingMode: 'fallback' },
		conversionReceiptSha256: pack.conversionReceiptSha256, develop, developed: { width: 2, height: 1 }, provenance, hdr });
	return { source, pack: pack.bytes, metadata, original };
}

test('explicit Source5 native owner proves a real FramePack1 Original and yields exact Float32 instead of its byte cache', async () => {
	const f = fixture(), before = f.pack.slice(); let exposed: Float32Array | undefined, checks = 0;
	const request = { source: f.source, read(offset: number, length: number) { assert.equal(this, request); return f.pack.slice(offset, offset + length); },
		assertCurrent() { assert.equal(this, request); checks++; } };
	const result = await withFramescaperHdrImageOriginalCurrentV1(request, view => {
		exposed = view.frame.pixels; assert.deepEqual([...view.frame.pixels], [...new Float32Array(samples)]);
		assert.ok(Object.is(view.frame.pixels[5], -0)); assert.equal(view.frame.pixels[0], 3); assert.deepEqual(view.provenance, f.metadata); return 7;
	});
	assert.equal(result, 7); assert.ok(checks > 3); assert.deepEqual(f.pack, before); assert.ok(exposed?.every(value => value === 0));
});

test('native Source5 owner refuses scalar receipt mismatch before range I/O and native body disagreement before delivery', async () => {
	const f = fixture(); let reads = 0, consumed = false;
	await assert.rejects(withFramescaperHdrImageOriginalCurrentV1({ source: { ...f.source, conversionReceiptSha256: '0'.repeat(64) },
		read() { reads++; return new Uint8Array(0); } }, () => { consumed = true; }), /receipt/iu);
	assert.equal(reads, 0); assert.equal(consumed, false);
	for (const patch of [{ pixelsSha256: '0'.repeat(64) }, { metadataSha256: '1'.repeat(64) }]) {
		const wrong = fixture(patch);
		await assert.rejects(withFramescaperHdrImageOriginalCurrentV1({ source: wrong.source,
			read: (offset, length) => wrong.pack.slice(offset, offset + length) }, () => { consumed = true; }), /receipt|native|provenance/iu);
		assert.equal(consumed, false);
	}
	const damaged = f.pack.slice(); damaged[damaged.length - 1]! ^= 1;
	await assert.rejects(withFramescaperHdrImageOriginalCurrentV1({ source: f.source, read: (offset, length) => damaged.slice(offset, offset + length) }, () => { consumed = true; }), /digest/iu);
	assert.equal(consumed, false);
});

test('native Source5 owner joins held consumer, rejects late stale authority or opaque cancellation, and wipes native storage', async () => {
	for (const kind of ['stale', 'cancel'] as const) {
		const f = fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(); let stale = false, exposed: Float32Array | undefined;
		const reason = Symbol(kind), work = withFramescaperHdrImageOriginalCurrentV1({ source: f.source, signal: stop.signal,
			read: (offset, length) => f.pack.slice(offset, offset + length), assertCurrent() { if (stale) throw reason; } }, async view => {
			exposed = view.frame.pixels; entered.resolve(); await release.promise; assert.equal(view.frame.pixels[0], 3); return 'done';
		});
		try { await entered.promise; if (kind === 'cancel') stop.abort(reason); else stale = true;
			assert.equal(await remainsPending(work), true); assert.equal(exposed?.[0], 3); release.resolve(); await assert.rejects(work, error => Object.is(error, reason));
			assert.ok(exposed?.every(value => value === 0));
		} finally { release.resolve(); await work.catch(() => undefined); }
	}
});

test('native Source5 owner refuses accessor capabilities, hostile physical ranges and detached consumer output', async () => {
	const f = fixture(); let reads = 0;
	await assert.rejects(withFramescaperHdrImageOriginalCurrentV1({ source: f.source, get read() { reads++; return () => new Uint8Array(); } }, () => 1), /data/iu);
	assert.equal(reads, 0);
	const oversized = new Uint8Array(16 * 1024 * 1024 + 1); oversized.set(f.pack);
	await assert.rejects(withFramescaperHdrImageOriginalCurrentV1({ source: f.source, read: (offset, length) => oversized.subarray(offset, offset + length) }, () => 1), /physical|backing|bounded/iu);
	await assert.rejects(withFramescaperHdrImageOriginalCurrentV1({ source: f.source, read: (offset, length) => f.pack.slice(offset, offset + length) }, view => {
		structuredClone(view.frame.pixels.buffer, { transfer: [view.frame.pixels.buffer] });
	}), /detach|retire/iu);
	const stop = new AbortController(), reason = Symbol('before request'); stop.abort(reason);
	await assert.rejects(withFramescaperHdrImageOriginalCurrentV1({ source: f.source, signal: stop.signal, read() { reads++; return f.pack; } }, () => 1), error => Object.is(error, reason));
	assert.equal(reads, 0);
});

test('Source5 pre-IO metadata cancellation retains its exact opaque reason before a competing reflection error', async () => {
	const f = fixture(), stop = new AbortController(), reason = Symbol('during scalar admission'); let reads = 0;
	const source = new Proxy(f.source, { ownKeys() { stop.abort(reason); throw new Error('competing metadata failure'); } });
	await assert.rejects(withFramescaperHdrImageOriginalCurrentV1({ source, signal: stop.signal,
		read() { reads++; return f.pack; } }, () => assert.fail('cancelled metadata cannot deliver')), error => Object.is(error, reason));
	assert.equal(reads, 0);
});
