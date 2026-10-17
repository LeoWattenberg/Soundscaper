/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { encodePixelFramePng16V1 } from '../src/common/editor/imaging/pixel-frame-png16-v1.ts';
import { encodePixelFramePngV1 } from '../src/common/editor/imaging/pixel-frame-png-v1.ts';
import { withImageExifContainerV1 } from '../src/common/editor/imaging/image-exif-container-v1.ts';
import { withImageExifContainerCurrentV1 } from '../src/common/editor/imaging/image-exif-container-current-v1.ts';
import { readImageMetadataV1 } from '../src/common/editor/imaging/image-metadata-reader-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const FACTS = Object.freeze({ orientation: 8, cameraMake: 'Saved camera', cameraModel: 'Owned source', lensModel: null,
	artist: 'Private artist', copyright: null, description: 'Private caption', exposureSeconds: 1 / 125,
	aperture: 2.8, iso: 100, focalLengthMm: 50, captureTime: null, captureTimeRaw: null });
async function png16() {
	return encodePixelFramePng16V1({ descriptor: { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'srgb' },
		pixels: new Uint16Array([1, 2, 3, 65535, 32768, 65534, 65535, 32768]) });
}
const request = (bytes: Uint8Array, scope = 'capture') => ({ format: 'png', bytes, exif: FACTS, width: 2, height: 1, scope });
const compose = (bytes: Uint8Array, options: unknown = {}) => withImageExifContainerCurrentV1(request(bytes), output => output.slice(), options);
function crc(bytes: Uint8Array): number {
	let value = 0xffffffff;
	for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
	return (value ^ 0xffffffff) >>> 0;
}
function chunk(kind: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(payload.length + 12), view = new DataView(bytes.buffer);
	view.setUint32(0, payload.length); bytes.set(Buffer.from(kind), 4); bytes.set(payload, 8);
	view.setUint32(bytes.length - 4, crc(bytes.subarray(4, bytes.length - 4))); return bytes;
}
function chunks(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), result = [];
	for (let at = 8; at < bytes.length;) {
		const length = view.getUint32(at), end = at + length + 12;
		assert.ok(end <= bytes.length); assert.equal(view.getUint32(end - 4), crc(bytes.subarray(at + 4, end - 4)));
		result.push({ kind: Buffer.from(bytes.subarray(at + 4, at + 8)).toString('ascii'), payload: bytes.slice(at + 8, end - 4), raw: bytes.slice(at, end) });
		at = end;
	}
	return result;
}
function geometry(tiff: Uint8Array): number[] {
	const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength); assert.equal(view.getUint16(0, true), 0x4949);
	let exif = 0;
	for (let index = 0; index < view.getUint16(8, true); index++) {
		const at = 10 + index * 12; if (view.getUint16(at, true) === 0x8769) exif = view.getUint32(at + 8, true);
	}
	assert.ok(exif > 0); const values: number[] = [];
	for (let index = 0; index < view.getUint16(exif, true); index++) {
		const at = exif + 2 + index * 12, tag = view.getUint16(at, true);
		if (tag === 0xa002 || tag === 0xa003) values.push(view.getUint32(at + 8, true));
	}
	return values;
}

test('Current PNG16 Capture EXIF composes actual codec output without changing its bit depth or camera facts', async () => {
	const bytes = await png16(); assert.equal(bytes[24], 16);
	const before = bytes.slice(), result = await compose(bytes), rows = chunks(result), facts = readImageMetadataV1(result);
	assert.equal(result[24], 16); assert.deepEqual(rows.map(row => row.kind), ['IHDR', 'sRGB', 'eXIf', 'IDAT', 'IEND']);
	assert.deepEqual(rows.filter(row => row.kind !== 'eXIf').map(row => row.raw), chunks(bytes).map(row => row.raw));
	assert.deepEqual([...inflateSync(Buffer.concat(rows.filter(row => row.kind === 'IDAT').map(row => row.payload)))],
		[0, 0, 1, 0, 2, 0, 3, 255, 255, 128, 0, 255, 254, 255, 255, 128, 0]);
	assert.deepEqual(geometry(rows.find(row => row.kind === 'eXIf')!.payload), [2, 1]);
	assert.equal(facts.exif?.cameraMake, 'Saved camera'); assert.equal(facts.exif?.cameraModel, 'Owned source');
	assert.equal(facts.exif?.orientation, 1); assert.equal(facts.exif?.exposureSeconds, 1 / 125);
	assert.equal(facts.exif?.artist, null); assert.equal(facts.exif?.description, null); assert.deepEqual(facts.issues, []);
	assert.deepEqual(bytes, before); await assert.rejects(withImageExifContainerV1(request(bytes), output => output.slice()), /profile/iu);
});

test('Current keeps PNG8 composition identical and PNG16 strip preserves exact offset bytes with scoped retirement', async () => {
	const png8 = await encodePixelFramePngV1({ descriptor: { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' },
		pixels: Uint8Array.of(9, 81, 173, 255, 231, 42, 19, 127) });
	assert.deepEqual(await compose(png8), await withImageExifContainerV1(request(png8), output => output.slice()));
	const bytes = await png16(), padded = new Uint8Array(bytes.length + 3); padded.set([91, 92]); padded.set(bytes, 2); padded[padded.length - 1] = 93;
	const source = padded.subarray(2, padded.length - 1), before = padded.slice(); let exposed: Uint8Array | undefined;
	const value = await withImageExifContainerCurrentV1(request(source, 'strip'), output => {
		assert.notEqual(output.buffer, source.buffer); assert.deepEqual(output, bytes); exposed = output; return 19;
	}, { maximumOutputBytes: source.length });
	assert.equal(value, 19); assert.ok(exposed); assert.equal((exposed as Uint8Array).every(byte => byte === 0), true); assert.deepEqual(padded, before);
});

test('Current PNG16 still refuses unsupported headers, malformed CRC/order, stale metadata and wrong final dimensions', async () => {
	const bytes = await png16(), parts = chunks(bytes), prefix = bytes.subarray(0, 8), header = parts[0]!.payload;
	const join = (...values: Uint8Array[]) => new Uint8Array(Buffer.concat(values));
	const badCrc = bytes.slice(); badCrc[29] = badCrc[29]! ^ 1;
	const variants = [badCrc, bytes.subarray(0, bytes.length - 1), join(bytes, Uint8Array.of(0)),
		join(prefix, parts[0]!.raw, parts[2]!.raw, parts[1]!.raw, parts[3]!.raw), await compose(bytes)];
	for (const [index, value] of [[8, 12], [9, 2], [12, 1]] as const) {
		const changed = header.slice(); changed[index] = value; variants.push(join(prefix, chunk('IHDR', changed), ...parts.slice(1).map(row => row.raw)));
	}
	for (const invalid of variants) await assert.rejects(compose(invalid), /markers|profile|geometry|checksum/iu);
	await assert.rejects(withImageExifContainerCurrentV1({ ...request(bytes), width: 1 }, () => assert.fail('Wrong dimensions cannot reach the consumer.')), /geometry/iu);
});

test('Current PNG16 output limits include the retained TIFF and inserted chunk before consumer delivery', async () => {
	const bytes = await png16(), output = await compose(bytes), tiff = chunks(output).find(row => row.kind === 'eXIf')!.payload;
	const peak = bytes.length + 12 + 2 * tiff.length;
	await assert.rejects(compose(bytes, { maximumOutputBytes: peak - 1 }), RangeError);
	assert.deepEqual(await compose(bytes, { maximumOutputBytes: peak }), output);
});

test('Current PNG16 cancellation joins the held consumer and wipes output while preserving an opaque reason', async () => {
	const bytes = await png16(), before = bytes.slice(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); let exposed: Uint8Array | undefined;
	const work = withImageExifContainerCurrentV1(request(bytes), async output => { exposed = output; entered.resolve(); await release.promise; return 1; }, { signal: stop.signal });
	const outcome = work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	try {
		await entered.promise; stop.abort(opaque.proxy); assert.equal(await remainsPending(outcome), true);
		assert.ok(exposed); assert.equal((exposed as Uint8Array).some(byte => byte !== 0), true); release.resolve();
		const result = await outcome; assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, opaque.proxy), true);
		assert.equal((exposed as Uint8Array).every(byte => byte === 0), true); assert.deepEqual(bytes, before);
	} finally { release.resolve(); await outcome; }
});

test('Current PNG16 consumer failure is preserved and transferring scoped output refuses successful completion', async () => {
	const bytes = await png16(), before = bytes.slice(), primary = Symbol('consumer'); let exposed: Uint8Array | undefined;
	await assert.rejects(withImageExifContainerCurrentV1(request(bytes), output => { exposed = output; throw primary; }), error => Object.is(error, primary));
	assert.ok(exposed); assert.equal((exposed as Uint8Array).every(byte => byte === 0), true);
	await assert.rejects(withImageExifContainerCurrentV1(request(bytes), output => { structuredClone(output.buffer, { transfer: [output.buffer] }); }), /detach/iu);
	assert.deepEqual(bytes, before);
});
