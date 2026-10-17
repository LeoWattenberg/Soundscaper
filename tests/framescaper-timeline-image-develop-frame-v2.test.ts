/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { withFramescaperImageDevelopFrameV2 } from '../src/framescaper/timeline-image-develop-frame-v2.ts';
import { createFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../src/common/editor/timeline-image-model.ts';
import { createImageDevelopHandoffProvenanceV1 } from '../src/common/editor/image-develop-handoff-provenance-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { withImageDevelopFrameV2 } from '../src/common/editor/imaging/image-develop-frame-v2.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../src/common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

const BODY = new TextEncoder().encode(`LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '0.25 0 0\n').join('')}`);
const sha = createHash('sha256').update(BODY).digest('hex');
const ref = { storageKey: `lut-sha256:${sha}`, sha256: sha, byteLength: BODY.byteLength, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
const corners = [0, 0, 255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255];
function fixture(develop: unknown = defaultImageDevelopStateV2(), width = 2, height = 2) {
	// Native orientation8 has already produced top-left canonical blue/white/red/green.
	const original = new TextEncoder().encode('exact untouched orientation8 original');
	const pack = createFramescaperImageFramePackV1({ original, receipt: { schemaVersion: 1, orientation: 8, decoder: { id: 'browser-native', version: '1' } }, width: 2, height: 2,
		timingMode: 'fallback', frames: [{ presentationTicks: 0n, durationTicks: 1_000_000n, rgba: new Uint8Array(corners) }] });
	const provenance = createImageDevelopHandoffProvenanceV1({ original: { exactName: 'e\u0301.png', sha256: pack.originalSha256, byteLength: original.byteLength }, develop,
		origin: { schemaFamily: 'lightscaper', schemaVersion: 2, catalogId: 'catalog', photoId: 'photo', revision: 7, versionId: 'copy', versionKind: 'virtual-copy', versionName: 'Saved', versionCreatedAt: '2026-10-01T00:00:00.000Z' } });
	const source = { schemaVersion: 2, kind: 'image', id: 'source', name: 'Photo', storageKey: 'source', mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
		assetByteLength: pack.assetByteLength, contentSha256: pack.contentSha256, conversionReceiptSha256: pack.conversionReceiptSha256,
		original: { fileName: 'é.png', mimeType: 'image/png', recognizedFormat: 'png', byteLength: original.byteLength, sha256: pack.originalSha256 },
		canonical: { width: 2, height: 2, hasAlpha: false, frameCount: 1, durationTicks: pack.durationTicks, timingMode: 'fallback' }, develop, developed: { width, height }, provenance };
	let reads = 0;
	const request = { source, read(offset: number, length: number) { assert.equal(this, request); reads++; return pack.bytes.slice(offset, offset + length); } };
	return { request, pack, original, get reads() { return reads; } };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; }

test('Frame evaluates saved orientation-canonical crop and rotation at natural dimensions before contain', async () => {
	const develop = { ...defaultImageDevelopStateV2(), geometry: { crop: { x: .5, y: 0, width: .5, height: 1 }, rotationDegrees: 90, flipHorizontal: false, flipVertical: false } };
	const f = fixture(develop, 2, 1); let borrowed: Uint8Array | undefined;
	const result = await withFramescaperImageDevelopFrameV2(f.request, view => { borrowed = view.frame.pixels; return { descriptor: view.frame.descriptor, pixels: [...view.frame.pixels] }; });
	assert.equal(result.descriptor.width, 2); assert.equal(result.descriptor.height, 1); assert.equal(result.descriptor.transfer, 'srgb');
	assert.deepEqual(result.pixels, [0, 255, 0, 255, 255, 255, 255, 255]); assert.ok(borrowed?.every(value => value === 0));
	assert.deepEqual([...f.original], [...new TextEncoder().encode('exact untouched orientation8 original')]);
});

test('all declared LUTs including disabled references authenticate, while only active processing changes literal pixels', async () => {
	for (const enabled of [false, true]) {
		const f = fixture({ ...defaultImageDevelopStateV2(), effects: [{ id: 'profile', type: 'cube-lut-profile-v1', enabled, params: { lut: ref } }] });
		let calls = 0; const source: CubeLutSourcePortV1 = { async withBytes(reference, consume) { assert.equal(this, source); assert.deepEqual(reference, ref); calls++; return consume(BODY); } };
		const pixels = await withFramescaperImageDevelopFrameV2(f.request, view => [...view.frame.pixels], { source });
		assert.deepEqual(pixels, enabled ? Array.from({ length: 4 }, () => [137, 0, 0, 255]).flat() : corners); assert.ok(calls >= 1);
		const bad: CubeLutSourcePortV1 = { async withBytes(_reference, consume) { return consume(new Uint8Array(BODY.byteLength)); } };
		await assert.rejects(withFramescaperImageDevelopFrameV2(f.request, () => { throw Error('Unauthenticated resource reached delivery'); }, { source: bad }));
	}
});

test('the common and Frame owners preserve authored LUT/effect order after natural geometry with independent literal pixels', async () => {
	const invert = createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } });
	const profile = { id: 'profile', type: 'cube-lut-profile-v1', enabled: true, params: { lut: ref } };
	const source: CubeLutSourcePortV1 = { async withBytes(_reference, consume) { return consume(BODY); } };
	for (const [effects, expected] of [[[profile, invert], [118, 255, 255, 255]], [[invert, profile], [137, 0, 0, 255]]] as const) {
		const develop = { ...defaultImageDevelopStateV2(), geometry: { crop: { x: .5, y: 0, width: .5, height: 1 }, rotationDegrees: 0, flipHorizontal: false, flipVertical: false }, effects };
		const f = fixture(develop, 1, 2);
		const common = await withImageDevelopFrameV2({ frame: { descriptor: { schemaVersion: 1, width: 2, height: 2, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array(corners) }, develop }, view => [...view.frame.pixels], PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1, { source });
		const frame = await withFramescaperImageDevelopFrameV2(f.request, view => [...view.frame.pixels], { source });
		assert.deepEqual(common, [...expected, ...expected]); assert.deepEqual(frame, [...expected, ...expected]);
	}
});

test('a disabled resource capability must actually prove its body rather than resolve without invoking its consumer', async () => {
	const f = fixture({ ...defaultImageDevelopStateV2(), effects: [{ id: 'profile', type: 'cube-lut-profile-v1', enabled: false, params: { lut: ref } }] });
	const source = { withBytes: () => Promise.resolve(undefined) } as unknown as CubeLutSourcePortV1;
	let delivered = false;
	await assert.rejects(withFramescaperImageDevelopFrameV2(f.request, () => { delivered = true; }, { source })); assert.equal(delivered, false);
});

test('held consumers join before cancellation/currentness refusal and owned frame retirement', async () => {
	const f = fixture(), entered = deferred(), release = deferred(), controller = new AbortController(); let borrowed: Uint8Array | undefined, settled = false;
	const opaque = Object.freeze({ cancellation: true });
	const work = withFramescaperImageDevelopFrameV2({ ...f.request, read: f.request.read.bind(f.request), signal: controller.signal }, async view => {
		borrowed = view.frame.pixels; entered.resolve(); await release.promise; assert.deepEqual([...view.frame.pixels], corners);
	});
	void work.then(() => { settled = true; }, () => { settled = true; }); await entered.promise; controller.abort(opaque);
	await new Promise<void>(resolve => { setImmediate(resolve); }); assert.equal(settled, false); assert.deepEqual([...borrowed!], corners);
	release.resolve(); await assert.rejects(work, error => error === opaque); assert.ok(borrowed?.every(byte => byte === 0));
});

test('a held authenticated range read is joined before cancellation can retire or deliver a frame', async () => {
	const f = fixture(), entered = deferred(), release = deferred(), controller = new AbortController(); let settled = false, first = true, delivered = false;
	const opaque = Object.freeze({ cancellation: 'held read' });
	const work = withFramescaperImageDevelopFrameV2({ source: f.request.source, signal: controller.signal, async read(offset: number, length: number) {
		if (first) { first = false; entered.resolve(); await release.promise; }
		return f.request.read(offset, length);
	} }, () => { delivered = true; });
	void work.then(() => { settled = true; }, () => { settled = true; }); await entered.promise; controller.abort(opaque);
	await new Promise<void>(resolve => { setImmediate(resolve); }); assert.equal(settled, false); assert.equal(delivered, false);
	release.resolve(); await assert.rejects(work, error => error === opaque); assert.equal(delivered, false);
});

test('LUT authority is pinned before held pack I/O and resource retirement is joined before cancellation refuses delivery', async () => {
	const develop = { ...defaultImageDevelopStateV2(), effects: [{ id: 'profile', type: 'cube-lut-profile-v1', enabled: true, params: { lut: ref } }] };
	const f = fixture(develop), entered = deferred(), release = deferred(); let first = true;
	const source: CubeLutSourcePortV1 = { async withBytes(_reference, consume) { assert.equal(this, source); return consume(BODY); } };
	const options = { source };
	const work = withFramescaperImageDevelopFrameV2({ source: f.request.source, async read(offset: number, length: number) {
		if (first) { first = false; entered.resolve(); await release.promise; } return f.request.read(offset, length);
	} }, view => [...view.frame.pixels], options);
	await entered.promise; source.withBytes = () => { throw Error('Replaced source used'); };
	options.source = { withBytes: () => { throw Error('Replaced options used'); } }; release.resolve();
	assert.deepEqual(await work, Array.from({ length: 4 }, () => [137, 0, 0, 255]).flat());
	const held = deferred(), retire = deferred(), stop = new AbortController(), reason = Symbol('resource cancellation'); let borrowed: Uint8Array | undefined, delivered = false;
	const port: CubeLutSourcePortV1 = { async withBytes(_reference, consume) { const bytes = BODY.slice(); borrowed = bytes;
		try { const result = await consume(bytes); held.resolve(); await retire.promise; return result; } finally { bytes.fill(0); } } };
	const pending = withFramescaperImageDevelopFrameV2({ source: f.request.source, read: f.request.read.bind(f.request), signal: stop.signal }, () => { delivered = true; }, { source: port });
	let settled = false; void pending.then(() => { settled = true; }, () => { settled = true; }); await held.promise; stop.abort(reason);
	await new Promise<void>(resolve => { setImmediate(resolve); }); assert.equal(settled, false); assert.ok(borrowed?.some(value => value !== 0));
	retire.resolve(); await assert.rejects(pending, error => error === reason); assert.ok(borrowed?.every(value => value === 0)); assert.equal(delivered, false);
});

test('late captured currentness and declared-dimension failures suppress delivery without replacing opaque read failures', async () => {
	const f = fixture(), opaque = Object.freeze({ read: 'failed' });
	await assert.rejects(withFramescaperImageDevelopFrameV2({ source: f.request.source, read() { throw opaque; } }, () => undefined), error => error === opaque);
	let current = true, deliveries = 0;
	await assert.rejects(withFramescaperImageDevelopFrameV2({ source: f.request.source, read: f.request.read.bind(f.request), assertCurrent() { if (!current) throw opaque; } }, () => { current = false; deliveries++; }), error => error === opaque);
	assert.equal(deliveries, 1);
	const wrong = fixture(defaultImageDevelopStateV2(), 1, 2);
	await assert.rejects(withFramescaperImageDevelopFrameV2(wrong.request, () => { deliveries++; })); assert.equal(deliveries, 1);
});

test('source binding and native signal admission precede I/O, and original pack tampering refuses publication', async () => {
	const f = fixture(); let getters = 0;
	await assert.rejects(withFramescaperImageDevelopFrameV2({ ...f.request, signal: { get aborted() { getters++; return false; } } }, () => undefined));
	assert.equal(getters, 0); assert.equal(f.reads, 0);
	await assert.rejects(withFramescaperImageDevelopFrameV2({ ...f.request, source: { ...f.request.source, provenance: { ...f.request.source.provenance, developSha256: '0'.repeat(64) } } }, () => undefined));
	assert.equal(f.reads, 0); f.pack.bytes[100] ^= 1;
	await assert.rejects(withFramescaperImageDevelopFrameV2(f.request, () => { throw Error('Tampered pack delivered'); }));
});

test('disabled bound masks are neutral while inactive definitions and old process1 recipes remain intact', async () => {
	const mask = { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], nodes: [{ id: 'rectangle', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }], outputNodeId: 'rectangle' };
	const develop = { ...defaultImageDevelopStateV2(), effects: [{ id: 'profile', type: 'cube-lut-profile-v1', enabled: false, params: { lut: null } }],
		masks: [mask], maskBindings: [{ effectId: 'profile', maskId: 'mask' }] };
	const bound = fixture(develop);
	assert.deepEqual(await withFramescaperImageDevelopFrameV2(bound.request, view => [...view.frame.pixels]), corners); assert.ok(bound.reads > 0);
	const inactive = fixture({ ...develop, maskBindings: [] });
	assert.deepEqual(await withFramescaperImageDevelopFrameV2(inactive.request, view => [...view.frame.pixels]), corners);
	const legacy = fixture({ ...defaultImageDevelopStateV2(), processVersion: 1 });
	assert.deepEqual(await withFramescaperImageDevelopFrameV2(legacy.request, view => [...view.frame.pixels]), corners);
});
