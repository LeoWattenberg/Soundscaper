/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync, inflateSync } from 'node:zlib';
import { encodeImageExifTiffV1 } from '../src/common/editor/imaging/exif-metadata-writer-v1.ts';
import { encodeImageExifTiffProfileCurrentV1 as encode } from '../src/common/editor/imaging/exif-metadata-writer-profile-current-v1.ts';
import { withImageExifContainerCurrentV1 } from '../src/common/editor/imaging/image-exif-container-current-v1.ts';
import { withImageExifContainerV1 } from '../src/common/editor/imaging/image-exif-container-v1.ts';
import { withImageExifContainerProfileCurrentV1 as compose } from '../src/common/editor/imaging/image-exif-container-profile-current-v1.ts';
import type { ImageExifMetadataV1 } from '../src/common/editor/imaging/image-metadata-model-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type Profile = 'srgb' | 'display-p3';
type Depth = 8 | 16;
const FACTS: Readonly<ImageExifMetadataV1> = Object.freeze({ orientation: 8, cameraMake: 'Saved camera', cameraModel: 'Owned source',
	lensModel: 'Saved lens', artist: 'Private artist', copyright: 'Private copyright', description: 'Private caption',
	exposureSeconds: 1 / 125, aperture: 2.8, iso: 200, focalLengthMm: 50,
	captureTime: { local: '2026-10-15T13:14:15', offsetMinutes: 120, subsecond: '00120' },
	captureTimeRaw: { dateTimeOriginal: '2026:10:15 13:14:15', offsetTimeOriginal: '+02:00', subsecondOriginal: '00120' } });
const TIFF_OPTIONS = Object.freeze({ scope: 'capture', width: 2, height: 1, maximumOutputBytes: 65_527 });
type Request = Readonly<{ format: 'png' | 'jpeg'; bytes: Uint8Array; exif: Readonly<ImageExifMetadataV1> | null;
	width: number; height: number; scope: 'capture' | 'strip'; profile: Profile; bitDepth: Depth }>;

function crc(bytes: Uint8Array): number {
	let value = 0xffffffff;
	for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
	return (value ^ 0xffffffff) >>> 0;
}
function chunk(type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(payload.length + 12), view = new DataView(bytes.buffer);
	view.setUint32(0, payload.length); bytes.set(Buffer.from(type, 'ascii'), 4); bytes.set(payload, 8);
	view.setUint32(bytes.length - 4, crc(bytes.subarray(4, bytes.length - 4))); return bytes;
}
const join = (...parts: readonly Uint8Array[]) => new Uint8Array(Buffer.concat(parts));
function png(depth: Depth, profile: Profile = 'display-p3'): Uint8Array<ArrayBuffer> {
	const header = new Uint8Array(13), view = new DataView(header.buffer); view.setUint32(0, 2); view.setUint32(4, 1);
	header.set([depth, 6, 0, 0, 0], 8);
	const row = depth === 8 ? Uint8Array.of(0, 1, 2, 3, 255, 128, 254, 255, 127)
		: Uint8Array.of(0, 0, 1, 0, 2, 0, 3, 255, 255, 128, 0, 255, 254, 255, 255, 128, 0);
	return join(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', header),
		profile === 'display-p3' ? chunk('cICP', Uint8Array.of(12, 13, 0, 1)) : chunk('sRGB', Uint8Array.of(0)),
		chunk('IDAT', deflateSync(row)), chunk('IEND', new Uint8Array()));
}
function chunks(bytes: Uint8Array) {
	assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), result = [];
	for (let at = 8; at < bytes.length;) {
		const end = at + view.getUint32(at) + 12; assert.ok(end <= bytes.length);
		assert.equal(view.getUint32(end - 4), crc(bytes.subarray(at + 4, end - 4)));
		result.push({ type: Buffer.from(bytes.subarray(at + 4, at + 8)).toString('ascii'),
			body: bytes.slice(at + 8, end - 4), raw: bytes.slice(at, end) }); at = end;
	}
	return result;
}
function tiff(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	assert.deepEqual([...bytes.subarray(0, 8)], [73, 73, 42, 0, 8, 0, 0, 0]);
	const directory = (at: number) => {
		const values = new Map<number, { type: number; count: number; data: Uint8Array }>(), count = view.getUint16(at, true);
		assert.ok(at + 2 + count * 12 + 4 <= bytes.length);
		for (let index = 0; index < count; index++) {
			const entry = at + 2 + index * 12, type = view.getUint16(entry + 2, true), count = view.getUint32(entry + 4, true);
			const unit = ({ 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 } as Record<number, number>)[type]; assert.ok(unit);
			const length = unit * count, start = length <= 4 ? entry + 8 : view.getUint32(entry + 8, true);
			assert.ok(start + length <= bytes.length); values.set(view.getUint16(entry, true), { type, count, data: bytes.slice(start, start + length) });
		}
		assert.equal(view.getUint32(at + 2 + count * 12, true), 0); return values;
	};
	const root = directory(8), sub = root.get(0x8769); assert.ok(sub); assert.deepEqual([sub.type, sub.count], [4, 1]);
	const exif = directory(new DataView(sub.data.buffer).getUint32(0, true));
	const scalar = (tags: typeof root, tag: number) => {
		const value = tags.get(tag); assert.ok(value); assert.equal(value.count, 1);
		const item = new DataView(value.data.buffer); return value.type === 3 ? item.getUint16(0, true) : item.getUint32(0, true);
	};
	const text = (tags: typeof root, tag: number) => { const value = tags.get(tag); assert.ok(value); assert.equal(value.type, 2); return Buffer.from(value.data).toString('ascii'); };
	return { root, exif, scalar, text };
}
const request = (bytes: Uint8Array, bitDepth: Depth, profile: Profile = 'display-p3', scope: Request['scope'] = 'capture'): Request =>
	({ format: 'png', bytes, exif: FACTS, width: 2, height: 1, profile, bitDepth, scope });
const copy = (value: Request, options: unknown = {}) => compose(value, bytes => bytes.slice(), options);

test('profiled TIFF declares non-sRGB uncalibrated without changing captured facts or upright geometry', () => {
	const bytes = encode(FACTS, { ...TIFF_OPTIONS, profile: 'display-p3' }); assert.ok(bytes);
	const { root, exif, scalar, text } = tiff(bytes);
	assert.equal(scalar(exif, 0xa001), 0xffff); assert.equal(scalar(root, 0x0112), 1);
	assert.deepEqual([scalar(exif, 0xa002), scalar(exif, 0xa003)], [2, 1]);
	assert.equal(text(root, 0x010f), 'Saved camera\0'); assert.equal(text(exif, 0xa434), 'Saved lens\0');
	assert.equal(text(exif, 0x9003), '2026:10:15 13:14:15\0'); assert.equal(text(exif, 0x9011), '+02:00\0');
	assert.equal(text(exif, 0x9291), '00120\0'); assert.equal(scalar(exif, 0x8833), 200);
	assert.equal(root.has(0x013b), false); assert.equal(root.has(0x010e), false);
	assert.equal(exif.has(0xa005), false, 'no DCF sRGB interoperability declaration');
});

for (const depth of [8, 16] as const) test(`P3 PNG${depth} Capture keeps exact color and pixel chunks and adds truthful EXIF`, async () => {
	const source = png(depth), before = source.slice(), output = await copy(request(source, depth)), rows = chunks(output);
	assert.deepEqual(rows.map(row => row.type), ['IHDR', 'cICP', 'eXIf', 'IDAT', 'IEND']);
	assert.equal(output[24], depth); assert.deepEqual(rows[1]!.body, Uint8Array.of(12, 13, 0, 1));
	assert.deepEqual(rows.filter(row => row.type !== 'eXIf').map(row => row.raw), chunks(source).map(row => row.raw));
	const metadata = tiff(rows[2]!.body); assert.equal(metadata.scalar(metadata.exif, 0xa001), 0xffff);
	assert.deepEqual(inflateSync(Buffer.concat(rows.filter(row => row.type === 'IDAT').map(row => row.body))),
		inflateSync(Buffer.concat(chunks(source).filter(row => row.type === 'IDAT').map(row => row.body))));
	assert.deepEqual(source, before);
});

test('sRGB explicit profile preserves permanent TIFF and Current PNG8/16 composition bytes exactly', async () => {
	assert.deepEqual(encode(FACTS, { ...TIFF_OPTIONS, profile: 'srgb' }), encodeImageExifTiffV1(FACTS, TIFF_OPTIONS));
	for (const depth of [8, 16] as const) {
		const bytes = png(depth, 'srgb'), value = request(bytes, depth, 'srgb'), { profile: _profile, bitDepth: _depth, ...legacy } = value;
		assert.deepEqual(await copy(value), await withImageExifContainerCurrentV1(legacy, output => output.slice()));
	}
});

test('permanent TIFF, PNG8 and Current1 PNG16 readers retain their exact closed sRGB policies', async () => {
	assert.throws(() => encodeImageExifTiffV1(FACTS, { ...TIFF_OPTIONS, profile: 'display-p3' }), TypeError);
	const value = request(png(16), 16), { profile: _profile, bitDepth: _depth, ...old } = value;
	await assert.rejects(withImageExifContainerCurrentV1(value, output => output.slice()), TypeError);
	await assert.rejects(withImageExifContainerCurrentV1(old, output => output.slice()), RangeError);
	await assert.rejects(withImageExifContainerV1({ ...old, bytes: png(16, 'srgb') }, output => output.slice()), RangeError);
});

test('P3 Strip retains exact offset codec bytes and independent scoped output retirement', async () => {
	const bytes = png(16), padded = join(Uint8Array.of(71, 72), bytes, Uint8Array.of(73)), before = padded.slice();
	let plane: Uint8Array | undefined;
	assert.equal(await compose(request(padded.subarray(2, padded.length - 1), 16, 'display-p3', 'strip'), output => {
		assert.deepEqual(output, bytes); assert.notEqual(output.buffer, padded.buffer); plane = output; return 7;
	}, { maximumOutputBytes: bytes.length }), 7);
	assert.ok(plane); assert.equal(plane.every(value => value === 0), true); assert.deepEqual(padded, before);
});

test('profiled PNG refuses color conflicts, malformed cICP, ordering, CRC, stale EXIF and selected depth mismatch', async () => {
	const bytes = png(16), parts = chunks(bytes), signature = bytes.subarray(0, 8);
	const rebuild = (...rows: Uint8Array[]) => join(signature, ...rows);
	const variants = [rebuild(parts[0]!.raw, parts[2]!.raw, parts[1]!.raw, parts[3]!.raw),
		rebuild(parts[0]!.raw, parts[1]!.raw, parts[1]!.raw, parts[2]!.raw, parts[3]!.raw),
		rebuild(parts[0]!.raw, parts[2]!.raw, parts[3]!.raw)];
	for (const payload of [Uint8Array.of(12, 13, 0), Uint8Array.of(1, 13, 0, 1), Uint8Array.of(12, 1, 0, 1),
		Uint8Array.of(12, 13, 1, 1), Uint8Array.of(12, 13, 0, 0)]) variants.push(rebuild(parts[0]!.raw, chunk('cICP', payload), parts[2]!.raw, parts[3]!.raw));
	for (const name of ['sRGB', 'iCCP', 'gAMA', 'cHRM', 'eXIf']) variants.push(rebuild(parts[0]!.raw, parts[1]!.raw,
		chunk(name, name === 'sRGB' ? Uint8Array.of(0) : new Uint8Array(4)), parts[2]!.raw, parts[3]!.raw));
	const corrupt = bytes.slice(); corrupt[45] = corrupt[45]! ^ 1; variants.push(corrupt, join(bytes, Uint8Array.of(0)), bytes.subarray(0, bytes.length - 1));
	for (const invalid of variants) await assert.rejects(copy(request(invalid, 16)), RangeError);
	await assert.rejects(copy(request(bytes, 8)), RangeError);
	await assert.rejects(copy(request(png(8), 16)), RangeError);
	await assert.rejects(copy(request(bytes, 16, 'srgb')), RangeError);
	await assert.rejects(copy(request(png(16, 'srgb'), 16)), RangeError);
});

test('P3 JPEG is unavailable before reading source bytes and unsupported profile metadata is closed', async () => {
	let reads = 0; const bytes = new Proxy(png(8), { getPrototypeOf() { reads++; throw new Error('Pixel bytes must stay untouched.'); } });
	await assert.rejects(compose({ ...request(bytes, 8), format: 'jpeg' }, () => assert.fail('P3 JPEG cannot deliver')), RangeError); assert.equal(reads, 0);
	for (const profile of ['display-p3-future', null, {}, 'bt2020']) {
		await assert.rejects(compose({ ...request(png(8), 8), profile }, () => assert.fail('Bad profile cannot deliver')), RangeError);
	}
});

test('profiled container budgets retained TIFF and output together before delivering any bytes', async () => {
	const bytes = png(16), output = await copy(request(bytes, 16)), metadata = chunks(output).find(row => row.type === 'eXIf'); assert.ok(metadata);
	const peak = bytes.length + 12 + 2 * metadata.body.length;
	await assert.rejects(copy(request(bytes, 16), { maximumOutputBytes: peak - 1 }), RangeError);
	assert.deepEqual(await copy(request(bytes, 16), { maximumOutputBytes: peak }), output);
});

test('profiled input admission refuses shared, resizable, detached and shadowed backing without invoking accessors', async () => {
	const bytes = png(8), shared = new Uint8Array(new SharedArrayBuffer(bytes.length)); shared.set(bytes);
	const resizable = Reflect.construct(ArrayBuffer, [bytes.length, { maxByteLength: bytes.length * 2 }]) as ArrayBuffer;
	const resized = new Uint8Array(resizable); resized.set(bytes);
	const detached = bytes.slice(); structuredClone(detached.buffer, { transfer: [detached.buffer] });
	let reads = 0; const shadowed = bytes.slice(); Object.defineProperty(shadowed, 'buffer', { get() { reads++; return bytes.buffer; } });
	for (const invalid of [shared, resized, detached, shadowed]) await assert.rejects(copy(request(invalid, 8)), TypeError);
	assert.equal(reads, 0);
});

test('profiled pre-abort wins over hostile metadata and downstream aggregate cancellation remains exact', async () => {
	const stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); stop.abort(opaque.proxy);
	let reads = 0; const hostile = new Proxy({}, { getPrototypeOf() { reads++; throw new Error('Unreachable metadata.'); } });
	const aborted = await compose(hostile, () => 1, { signal: stop.signal })
		.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	assert.equal(aborted.ok, false); if (!aborted.ok) assert.equal(Object.is(aborted.error, opaque.proxy), true); assert.equal(reads, 0);
	const next = new AbortController(), cleanup = new Error('downstream retirement'), primary = new AggregateError([opaque.proxy, cleanup]);
	let retained: Uint8Array | undefined;
	const failed = await compose(request(png(8), 8), output => { retained = output; next.abort(Symbol('late abort')); throw primary; }, { signal: next.signal })
		.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	assert.equal(failed.ok, false); if (!failed.ok) assert.equal(failed.error, primary);
	assert.ok(retained); assert.equal(retained.every(value => value === 0), true);
});

test('profiled cancellation joins a held consumer, wipes its physical output and preserves opaque primary identity', async () => {
	const source = png(16), before = source.slice(), stop = new AbortController(), entered = deferred<void>(), release = deferred<void>();
	const primary = Proxy.revocable({}, {}); primary.revoke(); let plane: Uint8Array | undefined;
	const task = compose(request(source, 16), async output => { plane = output; entered.resolve(); await release.promise; return 9; }, { signal: stop.signal });
	const outcome = task.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	try {
		await Promise.race([entered.promise, outcome.then(result => { if (!result.ok) throw result.error; throw new Error('Consumer never entered.'); })]);
		stop.abort(primary.proxy); assert.equal(await remainsPending(outcome), true);
		assert.ok(plane); assert.equal(plane.some(value => value !== 0), true); release.resolve(); const result = await outcome;
		assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, primary.proxy), true);
		assert.equal(plane.every(value => value === 0), true); assert.deepEqual(source, before);
	} finally { release.resolve(); await outcome; }
});

test('profiled physical retirement pins backing against shadows and aggregates opaque failure plus transfer refusal', async () => {
	const source = png(8), primary = Symbol('consumer'), before = source.slice(); let retained: Uint8Array | undefined;
	await assert.rejects(compose(request(source, 8), output => {
		retained = new Uint8Array(output.buffer); Object.defineProperty(output, 'buffer', { value: new ArrayBuffer(output.length) }); throw primary;
	}), error => Object.is(error, primary));
	assert.ok(retained); assert.equal(retained.every(value => value === 0), true);
	const revoked = Proxy.revocable({}, {}); revoked.revoke(); let moved: ArrayBuffer | undefined;
	const outcome = await compose(request(source, 8), output => {
		moved = structuredClone(output.buffer, { transfer: [output.buffer] }); throw revoked.proxy;
	}).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
	assert.equal(outcome.ok, false); if (!outcome.ok) {
		assert.equal(Object.is(outcome.error, revoked.proxy), false); assert.ok(outcome.error instanceof AggregateError);
		assert.equal(Object.is(outcome.error.errors[0], revoked.proxy), true); assert.ok(outcome.error.errors[1] instanceof TypeError);
	}
	assert.ok(moved); new Uint8Array(moved).fill(0); assert.deepEqual(source, before);
});
