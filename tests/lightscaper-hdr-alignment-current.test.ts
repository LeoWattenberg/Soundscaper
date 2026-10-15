/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

async function owner() {
	assert.ok(existsSync(new URL('../src/common/editor/imaging/image-hdr-alignment-v1.ts', import.meta.url)), 'HDR needs actual bounded Ward MTB registration.');
	return import('../src/common/editor/imaging/image-hdr-alignment-v1.ts');
}
function bytes(width: number, height: number, value: (x: number, y: number) => number) {
	return { descriptor: { schemaVersion: 1 as const, width, height, sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const },
		pixels: Uint8Array.from(Array.from({ length: width * height }, (_, i) => { const n = value(i % width, Math.floor(i / width)); return [n, n, n, 255]; }).flat()) };
}
function texture(x: number, y: number): number {
	// Asymmetric multi-scale structures; the known translation is imposed below,
	// rather than recovered by an oracle importing the registration algorithm.
	return 20 + ((Math.imul(Math.floor(x / 3) + 31, 73856093) ^ Math.imul(Math.floor(y / 3) + 17, 19349663)) >>> 0) % 190;
}
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

test('real Ward pyramid estimates a known two-axis integer translation despite monotonic exposure and moving foreground', async () => {
	const api = await owner(), width = 161, height = 127, reference = bytes(width, height, texture);
	const moved = bytes(width, height, (x, y) => x > 75 && x < 91 && y > 40 && y < 58 ? 250 : Math.min(255, Math.round(texture(x - 7, y + 4) * 1.2)));
	const before = reference.pixels.slice(), beforeMoved = moved.pixels.slice();
	const result = await api.withImageHdrAlignmentGuideV1(reference, ref => api.withImageHdrAlignmentGuideV1(moved, candidate => api.alignImageHdrGuidesV1(ref, candidate, { maximumShiftPixels: 16 })));
	assert.equal(result.x, -7); assert.equal(result.y, 4); assert.ok(result.support > 1000); assert.ok(result.error < .15);
	assert.deepEqual(reference.pixels, before); assert.deepEqual(moved.pixels, beforeMoved);
});

test('flat and periodically ambiguous guides refuse instead of publishing assumed zero alignment', async () => {
	const api = await owner();
	for (const source of [bytes(96, 80, () => 100), bytes(96, 80, (x, y) => (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 220 : 20)]) {
		await assert.rejects(api.withImageHdrAlignmentGuideV1(source, ref => api.withImageHdrAlignmentGuideV1(source, candidate => api.alignImageHdrGuidesV1(ref, candidate, { maximumShiftPixels: 8 }))), /ambig|texture|support|confiden/iu);
	}
});

test('guide conversion is alignment-only, refuses alpha and uses callback-scoped physical storage', async () => {
	const api = await owner(), source = bytes(16, 16, (x, y) => 30 + x * 5 + y * 3), before = source.pixels.slice();
	let borrowed: Uint8Array | undefined;
	await api.withImageHdrAlignmentGuideV1(source, guide => { borrowed = guide.pixels; assert.equal(guide.width, 16); assert.equal(guide.height, 16); assert.equal(guide.pixels.length, 256); assert.ok(guide.pixels.some(n => n > 0)); });
	assert.ok(borrowed); assert.ok(borrowed.every(n => n === 0)); assert.deepEqual(source.pixels, before);
	const translucent = bytes(16, 16, () => 80); translucent.pixels[3] = 254;
	await assert.rejects(api.withImageHdrAlignmentGuideV1(translucent, () => assert.fail('opaque canonical input required')));
	const words = { descriptor: { ...source.descriptor, sampleFormat: 'unorm16' as const, transfer: 'linear' as const }, pixels: Uint16Array.from(Array.from({ length: 256 }, () => [16384, 32768, 49152, 65535]).flat()) };
	await api.withImageHdrAlignmentGuideV1(words, guide => { assert.equal(guide.pixels.length, 256); assert.ok(guide.pixels[0]! > 0); });
});

test('held guide consumption joins before exact opaque cancellation and physical wipe', async () => {
	const api = await owner(), held = gate(), entered = gate(), abort = new AbortController(), reason = Object.create(null) as object;
	let pixels: Uint8Array | undefined, settled = false;
	const operation = api.withImageHdrAlignmentGuideV1(bytes(32, 32, texture), async guide => { pixels = guide.pixels; entered.release(); await held.promise; }, abort.signal);
	void operation.then(() => { settled = true; }, () => { settled = true; }); await entered.promise; abort.abort(reason); await Promise.resolve();
	assert.equal(settled, false); assert.ok(pixels?.some(value => value !== 0)); held.release();
	try { await operation; assert.fail('expected exact cancellation'); } catch (error) { assert.equal(error, reason); }
	assert.ok(pixels?.every(value => value === 0));
});

test('registration and guide phases charge actual padded backing and retain task cancellation', async () => {
	const api = await owner(), ordinary = bytes(128, 128, texture), controller = new AbortController(), reason = Object.create(null) as object;
	setTimeout(() => { controller.abort(reason); }, 0);
	try { await api.withImageHdrAlignmentGuideV1(ordinary, () => assert.fail('cancel before delivery'), controller.signal); assert.fail('expected cancellation'); }
	catch (error) { assert.equal(error, reason); }
	const buffer = new ArrayBuffer(192 * 1024 * 1024), padded = { ...bytes(1, 1, () => 100), pixels: new Uint8Array(buffer, 0, 4) };
	await assert.rejects(api.withImageHdrAlignmentGuideV1(padded, () => assert.fail('physical budget must reject before ownership')), /budget|working|physical/iu);
});

test('alignment pre-abort keeps its opaque reason before bad options and native guide geometry cannot be shadowed', async () => {
	const api = await owner(), controller = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke(); controller.abort(reason.proxy);
	let read = 0;
	try { await api.alignImageHdrGuidesV1({}, {}, Object.defineProperty({ signal: controller.signal }, 'maximumShiftPixels', { enumerable: true, get() { read++; return 4; } })); assert.fail('pre-abort must win'); }
	catch (error) { assert.ok(Object.is(error, reason.proxy)); }
	assert.equal(read, 0);
	const source = Uint8Array.from({ length: 64 * 48 }, (_, i) => texture(i % 64, Math.floor(i / 64))), other = source.slice();
	Object.defineProperty(source, 'length', { get() { read++; throw new Error('geometry shadow'); } });
	await assert.rejects(api.alignImageHdrGuidesV1({ width: 64, height: 48, pixels: source }, { width: 64, height: 48, pixels: other }, { maximumShiftPixels: 4 }), /shadow|intrinsic/iu);
	assert.equal(read, 0);
});

test('registration refuses a coincidental edge strip below half the full guide overlap', async () => {
	const api = await owner(), width = 64, height = 32;
	const noise = (x: number, y: number, seed: number) => {
		let n = Math.imul(x + seed, 374761393) + Math.imul(y + seed * 17, 668265263);
		n = Math.imul(n ^ n >>> 13, 1274126177); return 20 + ((n ^ n >>> 16) >>> 0) % 216;
	};
	const reference = { width, height, pixels: Uint8Array.from({ length: width * height }, (_, i) => noise(i % width, Math.floor(i / width), 11)) };
	// Only the rightmost16 reference columns match the leftmost16 candidate
	// columns at placement(+48,0); the remaining75% is a different image.
	const candidate = { width, height, pixels: Uint8Array.from({ length: width * height }, (_, i) => {
		const x = i % width, y = Math.floor(i / width); return x < 16 ? reference.pixels[y * width + x + 48]! : noise(x, y, 101);
	}) };
	await assert.rejects(api.alignImageHdrGuidesV1(reference, candidate, { maximumShiftPixels: 63 }), /overlap|support|confiden|texture|ambig/iu);
});
