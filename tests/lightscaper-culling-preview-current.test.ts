/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { normalizePhotoPreviewPlanV1, planPhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { planPhotoCullingPreviewCurrentV1, normalizePhotoCullingPreviewPlanCurrentV1 } from '../src/lightscaper/preview/photo-culling-preview-plan-current-v1.ts';
import { preparePhotoCullingPreviewCurrentV1, PHOTO_CULLING_PREVIEW_WORKING_BYTES_CURRENT_V1 } from '../src/lightscaper/preview/photo-culling-preview-preparation-current-v1.ts';
import { RepairPixelFrameLifetimeV1 } from '../src/common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import manifest from '../config/lightscaper-libraw-runtime-manifest.json';

const binding = { catalogId: 'camera-catalog', photoId: 'camera-photo', originalId: 'camera-original', storageKey: 'retained-camera',
	contentSha256: 'a'.repeat(64), byteLength: 123, width: 4, height: 4 };
const descriptor = (width: number, height: number) => ({ schemaVersion: 1 as const, width, height,
	sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const });

const plan = (selected = binding, tier: 'thumbnail' | 'fit-screen' = 'thumbnail') => planPhotoCullingPreviewCurrentV1({ binding: selected, tier, source: 'camera-embedded' });
const frame = () => ({ descriptor: descriptor(2, 1), pixels: Uint8Array.of(10, 20, 30, 255, 110, 120, 130, 255) });
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('Light Current camera culling contains actual embedded extent inside the Original-derived target', async () => {
	const value = await preparePhotoCullingPreviewCurrentV1({ plan: plan(), binding, frame: frame() });
	const black = [0, 0, 0, 255], first = [10, 20, 30, 255], second = [110, 120, 130, 255];
	assert.deepEqual(new Uint8Array(await value.body.arrayBuffer()), Uint8Array.from([
		...black, ...black, ...black, ...black, ...first, ...first, ...second, ...second,
		...first, ...first, ...second, ...second, ...black, ...black, ...black, ...black]));
	assert.deepEqual(value.descriptor, descriptor(4, 4));
	assert.equal(value.outputSha256, digest(new Uint8Array(await value.body.arrayBuffer())));
	assert.equal(Object.hasOwn(value, 'original'), false);
});

test('Light Current camera culling has an explicit decoder-pinned recipe distinct from the permanent Original preview', () => {
	const value = plan(), legacy = planPhotoPreviewV1({ binding, source: descriptor(4, 4), tier: 'thumbnail' });
	assert.equal(value.recipe.id, 'lightscaper.raw-culling.camera-embedded.rgba8-contain-nearest');
	assert.equal(value.recipe.decoder.sha256, manifest.runtime.sha256);
	assert.equal(value.recipe.decoder.version, '0.22.2');
	assert.notEqual(value.key, legacy.key);
	assert.deepEqual(value.originalExtent, { width: 4, height: 4 });
	assert.equal(value.source, 'camera-embedded');
	assert.throws(() => normalizePhotoPreviewPlanV1(value));
	assert.throws(() => normalizePhotoCullingPreviewPlanCurrentV1(legacy));
});

test('Light Current culling target and key exist before independent camera geometry or availability is known', () => {
	const original = { ...binding, width: 3088, height: 2056 };
	assert.deepEqual(plan(original).output, descriptor(512, 341));
	assert.deepEqual(plan(original, 'fit-screen').output, descriptor(2048, 1364));
	assert.deepEqual(normalizePhotoCullingPreviewPlanCurrentV1(JSON.parse(JSON.stringify(plan(original)))), plan(original));
	assert.notEqual(plan({ ...binding, photoId: 'another-photo' }).key, plan().key);
	assert.notEqual(plan({ ...binding, contentSha256: 'b'.repeat(64) }).key, plan().key);
	assert.notEqual(plan(binding, 'fit-screen').key, plan().key);
	assert.ok(Object.isFrozen(plan().recipe.decoder));
	assert.throws(() => plan({ ...binding, width: 8192, height: 8192 }), RangeError);
	for (const changed of [{ ...plan(), schemaVersion: 2 }, { ...plan(), key: 'photo-preview-sha256:' + 'b'.repeat(64) },
		{ ...plan(), source: 'neutral-original' }, { ...plan(), originalExtent: { width: 2, height: 1 } },
		{ ...plan(), recipe: { ...plan().recipe, decoder: { ...plan().recipe.decoder, sha256: '0'.repeat(64) } } },
		{ ...plan(), recipe: { ...plan().recipe, fallback: 'contain' } }, { ...plan(), output: descriptor(2, 2) }, { ...plan(), extra: true }]) {
		assert.throws(() => normalizePhotoCullingPreviewPlanCurrentV1(changed));
	}
});

test('Light Current camera contain preserves straight alpha and deterministic odd-axis centering', async () => {
	const selected = { ...binding, width: 5, height: 4 }, camera = { descriptor: descriptor(1, 2), pixels: Uint8Array.of(9, 19, 29, 0, 39, 49, 59, 127) };
	const result = await preparePhotoCullingPreviewCurrentV1({ plan: plan(selected), binding: selected, frame: camera });
	const black = [0, 0, 0, 255], first = [9, 19, 29, 0], second = [39, 49, 59, 127];
	assert.deepEqual(new Uint8Array(await result.body.arrayBuffer()), Uint8Array.from([
		...black, ...first, ...first, ...black, ...black, ...black, ...first, ...first, ...black, ...black,
		...black, ...second, ...second, ...black, ...black, ...black, ...second, ...second, ...black, ...black]));
});

test('Light Current neutral fallback uses exact Original nearest samples without camera containment', async () => {
	const selected = { ...binding, width: 1024, height: 3 }, pixels = new Uint8Array(1024 * 3 * 4);
	for (let y = 0; y < 3; y++) for (let x = 0; x < 1024; x++) pixels.set([x % 251, 20 + y, x % 113, 255], (y * 1024 + x) * 4);
	const result = await preparePhotoCullingPreviewCurrentV1({ plan: plan(selected), binding: selected,
		frame: { descriptor: descriptor(1024, 3), pixels }, representation: 'neutral-original' });
	const expected = new Uint8Array(512 * 2 * 4);
	for (let y = 0; y < 2; y++) for (let x = 0; x < 512; x++) expected.set([(x * 2) % 251, 20 + y, (x * 2) % 113, 255], (y * 512 + x) * 4);
	assert.deepEqual(result.descriptor, descriptor(512, 2));
	assert.deepEqual(new Uint8Array(await result.body.arrayBuffer()), expected);
	await assert.rejects(preparePhotoCullingPreviewCurrentV1({ plan: plan(), binding, frame: frame(), representation: 'neutral-original' }), /fallback.*Original extent/iu);
});

test('Light Current culling refuses bad binding and native profiles before any pixel getter', async () => {
	let calls = 0;
	const pixels = { enumerable: true, get() { calls++; throw new Error('pixel getter must not execute'); } };
	const hostile = Object.defineProperty({ descriptor: descriptor(2, 1) }, 'pixels', pixels);
	await assert.rejects(preparePhotoCullingPreviewCurrentV1({ plan: plan(), binding: { ...binding, storageKey: 'changed' }, frame: hostile }), /binding/iu);
	for (const metadata of [{ ...descriptor(2, 1), transfer: 'linear', sampleFormat: 'unorm16' }, descriptor(8192, 8192)]) {
		await assert.rejects(preparePhotoCullingPreviewCurrentV1({ plan: plan(), binding, frame: Object.defineProperty({ descriptor: metadata }, 'pixels', pixels) }), RangeError);
	}
	assert.equal(calls, 0);
	await assert.rejects(preparePhotoCullingPreviewCurrentV1({ plan: plan(), binding, frame: frame(), representation: 'invented' }), TypeError);
	const shadowed = frame(); Object.defineProperty(shadowed.pixels, 'buffer', { get() { calls++; return new ArrayBuffer(8); } });
	await assert.rejects(preparePhotoCullingPreviewCurrentV1({ plan: plan(), binding, frame: shadowed }), TypeError); assert.equal(calls, 0);
});

test('Light Current culling snapshots before its task yield and physically retires both owned planes', async t => {
	const buffers: ArrayBuffer[] = [], actual = RepairPixelFrameLifetimeV1.prototype.bytes;
	t.mock.method(RepairPixelFrameLifetimeV1.prototype, 'bytes', function (this: RepairPixelFrameLifetimeV1, length: number) {
		const bytes = Reflect.apply(actual, this, [length]) as Uint8Array<ArrayBuffer>; buffers.push(bytes.buffer); return bytes;
	});
	const source = frame(), original = source.pixels.slice(); let methods = 0;
	for (const key of ['slice', 'constructor', Symbol.iterator]) Object.defineProperty(source.pixels, key, { get() { methods++; throw new Error('sample method'); } });
	const pending = preparePhotoCullingPreviewCurrentV1({ plan: plan(), binding, frame: source });
	Uint8Array.prototype.fill.call(source.pixels, 0);
	const result = await pending, body = new Uint8Array(await result.body.arrayBuffer());
	assert.deepEqual(Array.from(body.subarray(16, 20)), Array.from(original.subarray(0, 4)));
	assert.equal(methods, 0); assert.equal(buffers.length, 2);
	for (const buffer of buffers) assert.ok(new Uint8Array(buffer).every(value => value === 0));
});

test('Light Current culling joins opaque cancellation before wiping and publishes no result', async t => {
	const buffers: ArrayBuffer[] = [], actual = RepairPixelFrameLifetimeV1.prototype.bytes;
	t.mock.method(RepairPixelFrameLifetimeV1.prototype, 'bytes', function (this: RepairPixelFrameLifetimeV1, length: number) {
		const bytes = Reflect.apply(actual, this, [length]) as Uint8Array<ArrayBuffer>; buffers.push(bytes.buffer); return bytes;
	});
	const reason = Proxy.revocable({}, {}); reason.revoke(); const controller = new AbortController();
	const observed = preparePhotoCullingPreviewCurrentV1({ plan: plan(), binding, frame: frame(), signal: controller.signal })
		.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	controller.abort(reason.proxy); const outcome = await observed;
	if (outcome.ok) throw new Error('Cancelled culling preparation returned a body.');
	assert.ok(Object.is(outcome.error, reason.proxy)); assert.equal(buffers.length, 2);
	for (const buffer of buffers) assert.ok(new Uint8Array(buffer).every(value => value === 0));
});

test('Light Current culling refuses physical borrowed padding and certifies owned detach failure', async t => {
	const padding = new ArrayBuffer(PHOTO_CULLING_PREVIEW_WORKING_BYTES_CURRENT_V1);
	await assert.rejects(preparePhotoCullingPreviewCurrentV1({ plan: plan(), binding,
		frame: { descriptor: descriptor(2, 1), pixels: new Uint8Array(padding, 0, 8) } }), /physical working byte bound/iu);
	const buffers: ArrayBuffer[] = [], actual = RepairPixelFrameLifetimeV1.prototype.bytes;
	t.mock.method(RepairPixelFrameLifetimeV1.prototype, 'bytes', function (this: RepairPixelFrameLifetimeV1, length: number) {
		const bytes = Reflect.apply(actual, this, [length]) as Uint8Array<ArrayBuffer>; buffers.push(bytes.buffer); return bytes;
	});
	const observed = preparePhotoCullingPreviewCurrentV1({ plan: plan(), binding, frame: frame() })
		.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	structuredClone(buffers[0]!, { transfer: [buffers[0]!] }); const outcome = await observed;
	if (outcome.ok) throw new Error('Detached culling snapshot returned a body.');
	assert.ok(outcome.error instanceof TypeError || outcome.error instanceof AggregateError);
	assert.ok(new Uint8Array(buffers[1]!).every(value => value === 0));
});

test('Light Current culling never combines an earlier metadata size with a later delivered frame', async () => {
	const source = { descriptor: descriptor(1, 1), pixels: frame().pixels };
	const changing = new Proxy(source, { getOwnPropertyDescriptor(target, key) {
		// A data-record Proxy may change another own field during admission.
		// One captured frame can be admitted consistently or safely refused.
		if (key === 'pixels') target.descriptor = descriptor(2, 1);
		return Reflect.getOwnPropertyDescriptor(target, key);
	} });
	const outcome = await preparePhotoCullingPreviewCurrentV1({ plan: plan(), binding, frame: changing })
		.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	if (!outcome.ok) { assert.ok(outcome.error instanceof TypeError || outcome.error instanceof RangeError); return; }
	const expected = await preparePhotoCullingPreviewCurrentV1({ plan: plan(), binding, frame: frame() });
	assert.deepEqual(new Uint8Array(await outcome.value.body.arrayBuffer()), new Uint8Array(await expected.body.arrayBuffer()));
});
