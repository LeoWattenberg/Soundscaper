/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync, inflateSync } from 'node:zlib';
import { withImageExifContainerV1 } from '../src/common/editor/imaging/image-exif-container-v1.ts';
import { readImageMetadataV1 } from '../src/common/editor/imaging/image-metadata-reader-v1.ts';
import type { ImageExifMetadataV1 } from '../src/common/editor/imaging/image-metadata-model-v1.ts';
import { metadataCrc32 } from '../src/common/editor/imaging/image-metadata-binary.ts';

const EMPTY: Readonly<ImageExifMetadataV1> = Object.freeze({ orientation: null, cameraMake: null, cameraModel: null,
	lensModel: null, artist: null, copyright: null, description: null, exposureSeconds: null, aperture: null,
	iso: null, focalLengthMm: null, captureTime: null, captureTimeRaw: null });
const TIFF = Buffer.from(`49492a0008000000 0200 120103000100000001000000 698704000100000026000000 00000000
	0400 009007000400000030323332 01a003000100000001000000 02a004000100000002000000
	03a004000100000002000000 00000000`.replace(/\s/gu, ''), 'hex');
const OPTIONS = { maximumOutputBytes: 1024 * 1024 };
const ROWS = Uint8Array.of(0, 9, 81, 173, 255, 231, 42, 19, 0, 0, 56, 199, 103, 127, 145, 7, 224, 255);
function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> { return new Uint8Array(Buffer.concat(parts)); }
function crc(bytes: Uint8Array): number {
	let result = 0xffffffff;
	for (const byte of bytes) { result ^= byte; for (let bit = 0; bit < 8; bit++) result = (result >>> 1) ^ ((result & 1) ? 0xedb88320 : 0); }
	return (result ^ 0xffffffff) >>> 0;
}
function chunk(type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
	const result = new Uint8Array(payload.length + 12), view = new DataView(result.buffer);
	view.setUint32(0, payload.length); result.set(Buffer.from(type), 4); result.set(payload, 8);
	view.setUint32(result.length - 4, crc(result.subarray(4, result.length - 4))); return result;
}
function png(...extra: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const header = Uint8Array.of(0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0);
	return concat(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', header), chunk('sRGB', Uint8Array.of(0)),
		...extra, chunk('IDAT', deflateSync(ROWS)), chunk('IEND', new Uint8Array(0)));
}
function segment(marker: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
	return concat(Uint8Array.of(255, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255), payload);
}
const JFIF = segment(0xe0, Uint8Array.of(74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0));
const ICC = segment(0xe2, concat(Buffer.from('ICC_PROFILE\0'), Uint8Array.of(1, 1, 19, 23, 29)));
const SOF = segment(0xc0, Uint8Array.of(8, 0, 2, 0, 2, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0));
const SOS = segment(0xda, Uint8Array.of(3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0));
// Structural JPEG only: stuffed bytes and restart markers are preserved, not decoded.
function jpeg(...extra: Uint8Array[]): Uint8Array<ArrayBuffer> {
	return concat(Uint8Array.of(255, 216), JFIF, ICC, ...extra, SOF, SOS, Uint8Array.of(7, 255, 0, 31, 255, 208, 37, 255, 217));
}
function request(format: 'png' | 'jpeg', bytes = format === 'png' ? png() : jpeg(), scope?: string, exif: unknown = EMPTY) {
	return { format, bytes, exif, width: 2, height: 2, ...(scope === undefined ? {} : { scope }) };
}
async function compose(value: unknown, options: unknown = OPTIONS): Promise<Uint8Array<ArrayBuffer>> {
	return withImageExifContainerV1(value, bytes => bytes.slice(), options);
}
function pngChunks(bytes: Uint8Array): { type: string; data: Uint8Array; raw: Uint8Array }[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), chunks = [];
	for (let offset = 8; offset < bytes.length;) {
		const size = view.getUint32(offset), end = offset + size + 12;
		assert.ok(end <= bytes.length); assert.equal(view.getUint32(end - 4), crc(bytes.subarray(offset + 4, end - 4)));
		chunks.push({ type: Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString('ascii'), data: bytes.slice(offset + 8, end - 4), raw: bytes.slice(offset, end) });
		offset = end;
	}
	return chunks;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

test('shared CRC continuation agrees with a fixed independent vector, including empty spans', () => {
	const bytes = Buffer.from('123456789');
	assert.equal(metadataCrc32(bytes), 0xcbf43926); assert.equal(crc(bytes), 0xcbf43926);
	const first = metadataCrc32(bytes.subarray(0, 4));
	assert.equal(metadataCrc32(new Uint8Array(0), first), first);
	assert.equal(metadataCrc32(bytes.subarray(4), first), 0xcbf43926);
});

test('default strip copies exact PNG/JPEG offset bytes into scoped independent output, then wipes it', async () => {
	for (const format of ['png', 'jpeg'] as const) {
		const original = format === 'png' ? png() : jpeg(), padded = concat(Uint8Array.of(31, 32), original, Uint8Array.of(33));
		const source = padded.subarray(2, padded.length - 1), before = padded.slice(); let borrowed: Uint8Array | null = null;
		const result = await withImageExifContainerV1(request(format, source), output => {
			assert.deepEqual(output, original); assert.notEqual(output.buffer, source.buffer); borrowed = output; return 19;
		}, OPTIONS);
		assert.equal(result, 19); assert.ok(borrowed); assert.equal((borrowed as Uint8Array).every(byte => byte === 0), true); assert.deepEqual(padded, before);
	}
});

test('PNG eXIf has literal TIFF and CRC while compressed pixels/sRGB/chunk bytes stay exact', async () => {
	const source = png(), before = source.slice(), output = await compose(request('png', source, 'all'));
	const chunks = pngChunks(output), original = pngChunks(source);
	assert.deepEqual(chunks.map(item => item.type), ['IHDR', 'sRGB', 'eXIf', 'IDAT', 'IEND']);
	assert.deepEqual(chunks[2]!.data, new Uint8Array(TIFF));
	assert.deepEqual(chunks[2]!.raw.subarray(0, 8), Uint8Array.of(0, 0, 0, 92, 101, 88, 73, 102));
	assert.deepEqual(chunks[2]!.raw.subarray(-4), Uint8Array.of(0x32, 0x11, 0xb5, 0x6a));
	assert.deepEqual(chunks.filter(item => item.type !== 'eXIf').map(item => item.raw), original.map(item => item.raw));
	assert.deepEqual(new Uint8Array(inflateSync(chunks[3]!.data)), ROWS); assert.deepEqual(source, before);
	assert.equal(readImageMetadataV1(output).exif?.orientation, 1);
});

test('JPEG APP1 literal segment preserves JFIF, ICC and entropy without re-encoding', async () => {
	const source = jpeg(), before = source.slice(), output = await compose(request('jpeg', source, 'all'));
	const expected = concat(source.subarray(0, 2 + JFIF.length), Uint8Array.of(255, 225, 0, 100, 69, 120, 105, 102, 0, 0), TIFF, source.subarray(2 + JFIF.length));
	assert.deepEqual(output, expected); assert.deepEqual(source, before);
	assert.equal(readImageMetadataV1(output).exif?.orientation, 1);
	const progressive = concat(source.subarray(0, source.length - 2), segment(0xc4, Uint8Array.of(0)), SOS, Uint8Array.of(41, 255, 217));
	progressive[2 + JFIF.length + ICC.length + 1] = 0xc2; // Actual SOF2 progressive frame, then two scans.
	assert.deepEqual(await compose(request('jpeg', progressive)), progressive);
});

test('capture/descriptive/all scopes admit normalized facts without carrying stale orientation or private fields', async () => {
	const facts = { ...EMPTY, orientation: 8, cameraMake: 'Camera', artist: 'Artist', exposureSeconds: 1 / 125,
		captureTimeRaw: { dateTimeOriginal: '2024:  :   12:  :  ', offsetTimeOriginal: '   :  ', subsecondOriginal: '  ' } };
	const before = structuredClone(facts);
	for (const format of ['png', 'jpeg'] as const) for (const scope of ['capture', 'descriptive', 'all'] as const) {
		const output = await compose(request(format, undefined, scope, facts)), read = readImageMetadataV1(output);
		assert.deepEqual(read.issues, []); assert.equal(read.exif?.orientation, 1);
		assert.equal(read.exif?.cameraMake, scope === 'descriptive' ? null : 'Camera');
		assert.equal(read.exif?.artist, scope === 'capture' ? null : 'Artist');
		if (scope !== 'descriptive') assert.deepEqual(read.exif?.captureTimeRaw, facts.captureTimeRaw);
	}
	assert.deepEqual(facts, before);
});

test('PNG refuses duplicate metadata/critical chunks, wrong dimensions/profile, bad CRC and truncation', async () => {
	const source = png(), chunks = pngChunks(source), signature = source.subarray(0, 8);
	const badCrc = source.slice(); badCrc[29] ^= 1;
	const variants = [badCrc, source.subarray(0, source.length - 1), concat(source, Uint8Array.of(0)),
		png(chunk('eXIf', TIFF)), png(chunk('tEXt', Uint8Array.of(1))), png(chunks[0]!.raw), png(chunks[1]!.raw),
		concat(signature, chunks[0]!.raw, chunks[2]!.raw, chunks[1]!.raw, chunks[3]!.raw)];
	for (const bytes of variants) await assert.rejects(compose(request('png', bytes, 'all')));
	for (const [index, value] of [[3, 3], [8, 16], [9, 2], [12, 1]] as const) {
		const header = chunks[0]!.data.slice(); header[index] = value;
		await assert.rejects(compose(request('png', concat(signature, chunk('IHDR', header), ...chunks.slice(1).map(item => item.raw)), 'all')));
	}
});

test('JPEG refuses existing Exif/XMP/IPTC/comments, duplicate frames/ICC, bad dimensions and truncated markers', async () => {
	for (const bytes of [jpeg(segment(0xe1, concat(Buffer.from('Exif\0\0'), TIFF))), jpeg(segment(0xe1, Buffer.from('XMP'))),
		jpeg(segment(0xed, Buffer.from('Photoshop'))), jpeg(segment(0xfe, Buffer.from('comment'))), jpeg(SOF), jpeg(ICC),
		jpeg().subarray(0, jpeg().length - 1), concat(jpeg(), Uint8Array.of(0)), jpeg(Uint8Array.of(255, 219, 255, 255))]) {
		await assert.rejects(compose(request('jpeg', bytes, 'all')));
	}
	const wrong = jpeg(); wrong[2 + JFIF.length + ICC.length + 8] = 3;
	await assert.rejects(compose(request('jpeg', wrong, 'all')));
});

test('closed options, native signals, unsigned geometry, intrinsic fixed bytes and captured budget refuse invalid input', async () => {
	for (const value of [{ ...request('png'), width: 0 }, { ...request('png'), height: 1.5 }, { ...request('jpeg'), width: 65_536 },
		{ ...request('png'), format: 'tiff' }, { ...request('png'), scope: 'other' }, { ...request('png'), gps: {} },
		{ ...request('png'), bytes: new Uint8ClampedArray(png()) }, { ...request('png'), exif: { ...EMPTY, gps: {} } }]) await assert.rejects(compose(value));
	for (const options of [{ maximumOutputBytes: 0 }, { maximumOutputBytes: 268_435_457 }, { maximumOutputBytes: NaN },
		{ ...OPTIONS, signal: { aborted: false } }, { ...OPTIONS, unexpected: 1 }]) await assert.rejects(compose(request('png'), options));
	let invoked = false;
	await assert.rejects(compose({ ...request('png'), get bytes() { invoked = true; return png(); } })); assert.equal(invoked, false);
	const detached = png(); structuredClone(detached.buffer, { transfer: [detached.buffer] }); await assert.rejects(compose(request('png', detached)));
	const shadow = png(); Object.defineProperty(shadow, 'byteLength', { get() { invoked = true; return 1; } });
	await assert.rejects(compose(request('png', shadow))); assert.equal(invoked, false);
	const resizable = Reflect.construct(ArrayBuffer, [128, { maxByteLength: 256 }]) as ArrayBuffer;
	await assert.rejects(compose(request('png', new Uint8Array(resizable))));
});

test('output ceiling accounts for the full output plus retained TIFF scratch before allocation', async () => {
	for (const format of ['png', 'jpeg'] as const) {
		const source = format === 'png' ? png() : jpeg(), peak = source.length + (format === 'png' ? 12 : 10) + 2 * TIFF.length;
		await assert.rejects(compose(request(format, source, 'all'), { maximumOutputBytes: peak - 1 }), RangeError);
		assert.equal((await compose(request(format, source, 'all'), { maximumOutputBytes: peak })).length, peak - TIFF.length);
		assert.deepEqual(await compose(request(format, source), { maximumOutputBytes: source.length }), source);
		await assert.rejects(compose(request(format, source), { maximumOutputBytes: source.length - 1 }), RangeError);
	}
});

test('cancellation joins a held consumer before preserving its opaque reason and wiping output', async () => {
	const controller = new AbortController(), reason = Symbol('cancel'), entered = deferred<void>(), held = deferred<void>();
	const source = png(), before = source.slice(); let output: Uint8Array | null = null, settled = false;
	const operation = withImageExifContainerV1(request('png', source, 'all'), async bytes => { output = bytes; entered.resolve(); await held.promise; return 1; }, { ...OPTIONS, signal: controller.signal });
	const joined = operation.then(() => { settled = true; }, error => { settled = true; assert.equal(error, reason); });
	await entered.promise; controller.abort(reason); await new Promise<void>(resolve => { setTimeout(resolve, 0); });
	assert.equal(settled, false); assert.ok(output); assert.equal((output as Uint8Array).some(byte => byte !== 0), true);
	held.resolve(); await joined; assert.equal((output as Uint8Array).every(byte => byte === 0), true); assert.deepEqual(source, before);
});

test('consumer failures and detached output preserve truthful failure while releasing owned bytes', async () => {
	let exposed: Uint8Array | null = null;
	await assert.rejects(withImageExifContainerV1(request('jpeg', undefined, 'all'), bytes => { exposed = bytes; throw undefined; }, OPTIONS), error => error === undefined);
	assert.ok(exposed); assert.equal((exposed as Uint8Array).every(byte => byte === 0), true);
	await assert.rejects(withImageExifContainerV1(request('png'), bytes => { structuredClone(bytes.buffer, { transfer: [bytes.buffer] }); }, OPTIONS));
});

test('large codec streams yield tasks and refuse cancellation or detached input before exposing output', async () => {
	const small = jpeg(), source = concat(small.subarray(0, small.length - 2), new Uint8Array(200_000).fill(7), Uint8Array.of(255, 217));
	const controller = new AbortController(), reason = Symbol('task-cancel'); let called = false;
	setTimeout(() => { controller.abort(reason); }, 0);
	await assert.rejects(withImageExifContainerV1(request('jpeg', source), () => { called = true; }, { ...OPTIONS, signal: controller.signal }), error => error === reason);
	assert.equal(called, false);
	const detached = source.slice(); setTimeout(() => { structuredClone(detached.buffer, { transfer: [detached.buffer] }); }, 0);
	await assert.rejects(compose(request('jpeg', detached)), /detach/iu);
});

test('large valid PNG IDAT CRC/copy continuation yields and preserves every compressed byte', async () => {
	const rows = new Uint8Array(128 * 513); let state = 17;
	for (let index = 0; index < rows.length; index++) {
		state ^= state << 13; state ^= state >>> 17; state ^= state << 5; rows[index] = index % 513 === 0 ? 0 : state & 255;
	}
	const compressed = new Uint8Array(deflateSync(rows)); assert.ok(compressed.length > 65_536);
	const source = concat(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
		chunk('IHDR', Uint8Array.of(0, 0, 0, 128, 0, 0, 0, 128, 8, 6, 0, 0, 0)), chunk('sRGB', Uint8Array.of(0)),
		chunk('IDAT', compressed), chunk('IEND', new Uint8Array(0)));
	let yielded = false; setTimeout(() => { yielded = true; }, 0);
	const output = await compose({ ...request('png', source, 'all'), width: 128, height: 128 });
	assert.equal(yielded, true); const chunks = pngChunks(output);
	assert.deepEqual(chunks[3]!.data, compressed); assert.deepEqual(new Uint8Array(inflateSync(chunks[3]!.data)), rows);
	assert.deepEqual(chunks.filter(item => item.type !== 'eXIf').map(item => item.raw), pngChunks(source).map(item => item.raw));
	const invalid = source.slice(); invalid[invalid.length - 17] ^= 1;
	await assert.rejects(compose({ ...request('png', invalid), width: 128, height: 128 }));
});

test('many small PNG IDAT chunks yield during validation before a late bad CRC can mask queued cancellation', async () => {
	const rows = new Uint8Array(128 * 1025); let state = 31;
	for (let index = 0; index < rows.length; index++) {
		state ^= state << 13; state ^= state >>> 17; state ^= state << 5; rows[index] = index % 1025 === 0 ? 0 : state & 255;
	}
	const compressed = new Uint8Array(deflateSync(rows)), chunks: Uint8Array[] = [];
	assert.ok(compressed.length > 2 * 65_536);
	for (let offset = 0; offset < compressed.length; offset += 1024) chunks.push(chunk('IDAT', compressed.subarray(offset, offset + 1024)));
	const source = concat(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
		chunk('IHDR', Uint8Array.of(0, 0, 1, 0, 0, 0, 0, 128, 8, 6, 0, 0, 0)), chunk('sRGB', Uint8Array.of(0)),
		...chunks, chunk('IEND', new Uint8Array(0)));
	const controller = new AbortController(), reason = Symbol('many-chunk-cancel'), invalid = source.slice();
	invalid[invalid.length - 17] ^= 1; let invoked = false;
	setTimeout(() => { controller.abort(reason); }, 0);
	await assert.rejects(withImageExifContainerV1({ ...request('png', invalid), width: 256, height: 128 }, () => { invoked = true; },
		{ ...OPTIONS, signal: controller.signal }), error => error === reason);
	assert.equal(invoked, false);
	const output = await compose({ ...request('png', source, 'all'), width: 256, height: 128 });
	assert.deepEqual(pngChunks(output).filter(item => item.type !== 'eXIf').map(item => item.raw), pngChunks(source).map(item => item.raw));
	assert.deepEqual(new Uint8Array(inflateSync(Buffer.concat(pngChunks(output).filter(item => item.type === 'IDAT').map(item => item.data)))), rows);
});
