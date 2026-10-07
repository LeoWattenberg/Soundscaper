/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { withPhotoOriginalFrameV1 } from '../src/lightscaper/preview/photo-original-frame-v1.ts';
import { planPhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { preparePhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-preparation-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import type { FramescaperBrowserNativeImageDecodeSessionV1, OpenFramescaperBrowserNativeImageV1 } from '../src/common/editor/timeline-image-native-decode-v1.ts';
import { jpegFixture, jpegSegment, jpegExif, tiffFixture, numberEntry } from './helpers/image-metadata-fixtures.ts';
import { compareOrientationPixelsV1 } from './helpers/lightscaper-photo-regeneration-native-fixture.ts';

const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const binding = (bytes: Uint8Array = PNG, width = 1, height = 1) => ({ catalogId: 'catalog', photoId: 'photo', originalId: 'original', storageKey: 'retained-original', contentSha256: digest(bytes), byteLength: bytes.length, width, height });
const request = (bytes: Uint8Array = PNG, width = 1, height = 1) => ({ binding: binding(bytes, width, height), body: new Blob([new Uint8Array(bytes)], { type: 'text/plain' }) });
function session(events: string[], width = 1, height = 1): FramescaperBrowserNativeImageDecodeSessionV1 {
	return { metadata: { width, height, frameCount: 1, topology: 'single', runtimeVersion: 'fixture-1' },
		decodeFrame: async () => { events.push('decode'); const rgba = new Uint8Array(width * height * 4); rgba.fill(255); return { rgba, durationMicroseconds: null }; },
		close: () => { events.push('close'); } };
}
const opener = (events: string[], width = 1, height = 1): OpenFramescaperBrowserNativeImageV1 => async () => { events.push('open'); return session(events, width, height); };
function jpeg(orientation = 6, colorSpace = 1) {
	return jpegFixture(jpegExif(tiffFixture([numberEntry(0x112, orientation)], [numberEntry(0xa001, colorSpace)])), jpegSegment(0xc0, Uint8Array.of(8, 0, 1, 0, 2, 1, 1, 0x11, 0)), jpegSegment(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0)), Uint8Array.of(0));
}

test('retained regeneration closes source before consuming and wipes owned frame after independent preview publication', async () => {
	const events: string[] = []; let observed: PixelFrameV1 | null = null, input: Uint8Array | null = null;
	const current = request(); const open = opener(events);
	const preview = await withPhotoOriginalFrameV1(current, async (frame, provenance) => {
		observed = frame; events.push('consume'); assert.deepEqual(events, ['open', 'decode', 'close', 'consume']);
		assert.deepEqual(provenance, { orientation: 1, runtimeVersion: 'fixture-1' });
		const plan = planPhotoPreviewV1({ binding: current.binding, source: frame.descriptor, tier: 'thumbnail' });
		return preparePhotoPreviewV1({ plan, binding: current.binding, frame });
	}, { openImage: async value => { input = value.bytes; return open(value); } });
	assert.deepEqual(compareOrientationPixelsV1(new Uint8Array(await preview.body.arrayBuffer()), Uint8Array.of(255, 255, 255, 255)), { maximumPixelDifference: 0, unequalChannels: 0 });
	assert.ok(observed); assert.deepEqual(Array.from((observed as PixelFrameV1).pixels), [0, 0, 0, 0]);
	assert.ok(input); assert.equal((input as Uint8Array).every(value => value === 0), true);
	assert.deepEqual(new Uint8Array(await current.body.arrayBuffer()), PNG);
});

test('orientation is read from immutable original EXIF and oriented binding refuses before native open', async () => {
	const bytes = jpeg(), events: string[] = [];
	const result = await withPhotoOriginalFrameV1(request(bytes, 1, 2), async (frame, provenance) => ({ width: frame.descriptor.width, height: frame.descriptor.height, orientation: provenance.orientation }), { openImage: opener(events, 1, 2) });
	assert.deepEqual(result, { width: 1, height: 2, orientation: 6 });
	await assert.rejects(withPhotoOriginalFrameV1(request(bytes, 2, 1), async () => undefined, { openImage: opener(events, 2, 1) }), /orientation|geometry/u);
	assert.deepEqual(events, ['open', 'decode', 'close']);
	await assert.rejects(withPhotoOriginalFrameV1({ ...request(bytes, 1, 2), metadata: { orientation: 1 } }, async () => undefined, { openImage: opener(events) }), TypeError);
});

test('size, independent original SHA, binding and source declarations refuse before native open', async () => {
	const events: string[] = [], openImage = opener(events);
	await assert.rejects(withPhotoOriginalFrameV1({ ...request(), binding: { ...binding(), byteLength: PNG.length + 1 } }, async () => undefined, { openImage }), /length|size/u);
	await assert.rejects(withPhotoOriginalFrameV1({ ...request(), binding: { ...binding(), contentSha256: 'b'.repeat(64) } }, async () => undefined, { openImage }), /digest|SHA/u);
	await assert.rejects(withPhotoOriginalFrameV1({ ...request(), binding: { ...binding(), width: 8192, height: 8192 } }, async () => undefined, { openImage }), RangeError);
	await assert.rejects(withPhotoOriginalFrameV1(request(jpeg(6, 65535), 1, 2), async () => undefined, { openImage }), /colour|ColorSpace|sRGB/u);
	await assert.rejects(withPhotoOriginalFrameV1({ ...request(), body: Object.create(Blob.prototype) as Blob }, async () => undefined, { openImage }), TypeError);
	assert.deepEqual(events, []);
});

test('genuine Blob subclass getters and read/slice overrides remain inert', async () => {
	let invoked = 0;
	class Hostile extends Blob {
		override get size(): number { invoked++; throw new Error('size accessor'); }
		override slice(): Blob { invoked++; throw new Error('slice override'); }
		override arrayBuffer(): Promise<ArrayBuffer> { invoked++; throw new Error('read override'); }
	}
	const body = new Hostile([PNG.slice()]);
	const result = await withPhotoOriginalFrameV1({ binding: binding(), body }, async frame => frame.descriptor.width, { openImage: opener([]) });
	assert.equal(result, 1); assert.equal(invoked, 0);
});

test('decoder input replacement refuses after decode and leaves retained Blob bytes exact', async () => {
	const events: string[] = []; let consumed = 0; const current = request();
	await assert.rejects(withPhotoOriginalFrameV1(current, async () => { consumed++; }, { openImage: async value => { value.bytes[0] = 0; return session(events); } }), /digest|SHA/u);
	assert.deepEqual(events, ['decode', 'close']); assert.equal(consumed, 0);
	assert.deepEqual(new Uint8Array(await current.body.arrayBuffer()), PNG);
});

test('safe session snapshots reject accessor metadata before decoding and close exactly once', async () => {
	let invoked = 0; const events: string[] = [], native = session(events);
	Object.defineProperty(native.metadata, 'width', { get() { invoked++; throw new Error('metadata accessor'); } });
	await assert.rejects(withPhotoOriginalFrameV1(request(), async () => undefined, { openImage: async () => native }), TypeError);
	assert.equal(invoked, 0); assert.deepEqual(events, ['close']);
});

test('native pixels are copied without method getters and hidden transparent RGB is canonical', async () => {
	const events: string[] = [], native = session(events), rgba = Uint8Array.of(17, 29, 41, 0); let invoked = 0;
	for (const key of ['slice', 'constructor', Symbol.iterator]) Object.defineProperty(rgba, key, { get() { invoked++; throw new Error('pixel accessor'); } });
	const result = await withPhotoOriginalFrameV1(request(), async frame => Array.from(frame.pixels), { openImage: async () => ({ ...native, decodeFrame: async () => ({ rgba, durationMicroseconds: null }) }) });
	assert.deepEqual(result, [0, 0, 0, 0]); assert.equal(invoked, 0); assert.deepEqual(events, ['close']);
});

test('late native open after external cancellation closes its session without decode or consumption', async () => {
	const controller = new AbortController(), reason = new Error('cancel pending open'), events: string[] = [];
	let resolveSession!: (value: FramescaperBrowserNativeImageDecodeSessionV1) => void, reached!: () => void;
	const opened = new Promise<void>(resolve => { reached = resolve; });
	const pending = withPhotoOriginalFrameV1({ ...request(), signal: controller.signal }, async () => { events.push('consume'); }, { openImage: () => { reached(); return new Promise(resolve => { resolveSession = resolve; }); } });
	await opened; controller.abort(reason); resolveSession(session(events));
	await assert.rejects(pending, error => error === reason); assert.deepEqual(events, ['close']);
});

test('decode/consumer failures and cancellation during consume all wipe temporary custody', async () => {
	const events: string[] = [], reason = new Error('consumer failed'); let observed: PixelFrameV1 | null = null;
	await assert.rejects(withPhotoOriginalFrameV1(request(), async frame => { observed = frame; throw reason; }, { openImage: opener(events) }), error => error === reason);
	assert.ok(observed); assert.equal((observed as PixelFrameV1).pixels.every(value => value === 0), true);
	assert.deepEqual(events, ['open', 'decode', 'close']);
	await assert.rejects(withPhotoOriginalFrameV1(request(), async () => undefined, { openImage: async () => ({ ...session(events), decodeFrame: async () => { throw reason; } }) }), error => error === reason);
	const controller = new AbortController();
	await assert.rejects(withPhotoOriginalFrameV1({ ...request(), signal: controller.signal }, async frame => { observed = frame; controller.abort(reason); }, { openImage: opener([]) }), error => error === reason);
	assert.equal((observed as PixelFrameV1).pixels.every(value => value === 0), true);
});
