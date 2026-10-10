/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeImageExifTiffV1 } from '../src/common/editor/imaging/exif-metadata-writer-v1.ts';
import { readExifMetadataV1 } from '../src/common/editor/imaging/exif-metadata-reader-v1.ts';
import { IMAGE_METADATA_LIMITS_V1, type ImageExifMetadataV1 } from '../src/common/editor/imaging/image-metadata-model-v1.ts';

const EMPTY: Readonly<ImageExifMetadataV1> = Object.freeze({ orientation: null, cameraMake: null, cameraModel: null,
	lensModel: null, artist: null, copyright: null, description: null, exposureSeconds: null, aperture: null,
	iso: null, focalLengthMm: null, captureTime: null, captureTimeRaw: null });
const OPTIONS = Object.freeze({ scope: 'all' as const, width: 3, height: 2, maximumOutputBytes: 65_527 });
function encode(facts: unknown = EMPTY, options: unknown = OPTIONS): Uint8Array<ArrayBuffer> {
	const bytes = encodeImageExifTiffV1(facts, options);
	assert.ok(bytes !== null);
	return bytes;
}

// Independent classic-TIFF parser: no production traversal, layout or fixture builder.
interface Tag { readonly id: number; readonly type: number; readonly count: number; readonly offset: number; readonly data: Uint8Array; }
function directory(bytes: Uint8Array, offset: number): Tag[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	assert.deepEqual([...bytes.subarray(0, 8)], [73, 73, 42, 0, 8, 0, 0, 0]);
	assert.equal(offset % 2, 0);
	const count = view.getUint16(offset, true), tags: Tag[] = [];
	assert.ok(offset + 2 + count * 12 + 4 <= bytes.length);
	for (let index = 0; index < count; index++) {
		const at = offset + 2 + index * 12;
		const id = view.getUint16(at, true), type = view.getUint16(at + 2, true), samples = view.getUint32(at + 4, true);
		const size = ({ 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 } as Record<number, number>)[type];
		assert.ok(size && samples > 0);
		const length = size * samples, body = length <= 4 ? at + 8 : view.getUint32(at + 8, true);
		assert.ok(body + length <= bytes.length);
		if (length > 4) assert.equal(body % 2, 0);
		if (tags.length) assert.ok(id > (tags.at(-1)?.id ?? 0));
		tags.push({ id, type, count: samples, offset: body, data: bytes.slice(body, body + length) });
	}
	assert.equal(view.getUint32(offset + 2 + count * 12, true), 0, 'no linked thumbnail IFD');
	return tags;
}
function tag(tags: readonly Tag[], id: number): Tag {
	const found = tags.find(value => value.id === id); assert.ok(found); return found;
}
function scalar(value: Tag): number {
	const view = new DataView(value.data.buffer, value.data.byteOffset, value.data.byteLength);
	assert.equal(value.count, 1);
	return value.type === 3 ? view.getUint16(0, true) : view.getUint32(0, true);
}
function parse(bytes: Uint8Array): { root: Tag[]; exif: Tag[] } {
	const root = directory(bytes, 8);
	assert.deepEqual([tag(root, 0x8769).type, tag(root, 0x8769).count], [4, 1]);
	return { root, exif: directory(bytes, scalar(tag(root, 0x8769))) };
}
function text(value: Tag): string { assert.equal(value.type, 2); return String.fromCharCode(...value.data); }
function fraction(value: Tag): number[] {
	assert.deepEqual([value.type, value.count], [5, 1]);
	const view = new DataView(value.data.buffer); return [view.getUint32(0, true), view.getUint32(4, true)];
}

test('empty facts have a literal deterministic TIFF layout with current geometry, orientation and sRGB', () => {
	const expected = Buffer.from(`49492a0008000000 0200
		120103000100000001000000 698704000100000026000000 00000000
		0400 009007000400000030323332 01a003000100000001000000
		02a004000100000003000000 03a004000100000002000000 00000000`.replace(/\s/gu, ''), 'hex');
	assert.deepEqual(encode(), new Uint8Array(expected));
	assert.deepEqual(encode(null), new Uint8Array(expected));
	const source = { ...EMPTY, orientation: 8 };
	assert.deepEqual(encode(source), new Uint8Array(expected));
	assert.equal(source.orientation, 8);
});

test('descriptive fields pin sorted tags, inline strings, aligned offsets and the CIPA copyright pair', () => {
	const bytes = encode({ ...EMPTY, description: 'hello', artist: 'AB', copyright: 'Owner\nEditor', cameraMake: 'PRIVATE' },
		{ ...OPTIONS, scope: 'descriptive' });
	const { root, exif } = parse(bytes);
	assert.deepEqual(root.map(value => [value.id, value.type, value.count]), [
		[0x10e, 2, 6], [0x112, 3, 1], [0x13b, 2, 3], [0x8298, 2, 13], [0x8769, 4, 1],
	]);
	assert.equal(scalar(tag(root, 0x8769)), 74);
	assert.equal(tag(root, 0x10e).offset, 128);
	assert.equal(tag(root, 0x8298).offset, 134);
	assert.deepEqual([...tag(root, 0x8298).data], [79, 119, 110, 101, 114, 0, 69, 100, 105, 116, 111, 114, 0]);
	assert.equal(text(tag(root, 0x13b)), 'AB\0');
	assert.equal(bytes.length, 148);
	assert.equal(bytes[147], 0, 'final alignment padding is deterministic zero');
	assert.deepEqual(exif.map(value => value.id), [0x9000, 0xa001, 0xa002, 0xa003]);
});

test('capture selects only camera facts and preserves literal unsigned fractions and the complete ISO domain', () => {
	for (const iso of [200, 65_535, 70_000, 0xffffffff]) {
		const { root, exif } = parse(encode({ ...EMPTY, cameraMake: 'CAM', cameraModel: 'Model', lensModel: 'Lens',
			exposureSeconds: 0.008, aperture: 2.8, focalLengthMm: 100 / 3, iso, artist: 'PRIVATE', description: 'PRIVATE' },
			{ ...OPTIONS, scope: 'capture' }));
		assert.deepEqual(root.map(value => value.id), [0x10f, 0x110, 0x112, 0x8769]);
		assert.equal(text(tag(root, 0x10f)), 'CAM\0');
		assert.equal(text(tag(exif, 0xa434)), 'Lens\0');
		assert.deepEqual(fraction(tag(exif, 0x829a)), [1, 125]);
		assert.deepEqual(fraction(tag(exif, 0x829d)), [14, 5]);
		assert.deepEqual(fraction(tag(exif, 0x920a)), [100, 3]);
		assert.deepEqual([tag(exif, 0x8827).type, scalar(tag(exif, 0x8827))], [3, Math.min(iso, 65_535)]);
		assert.deepEqual([tag(exif, 0x8830).type, scalar(tag(exif, 0x8830))], [3, 3]);
		assert.deepEqual([tag(exif, 0x8833).type, scalar(tag(exif, 0x8833))], [4, iso]);
	}
});

test('all scopes exclude opaque original tags and raw time fields retain partial and unknown components exactly', () => {
	const rawCases = [
		{ dateTimeOriginal: '    :02:29   :  :  ', offsetTimeOriginal: '   :  ', subsecondOriginal: '   ' },
		{ dateTimeOriginal: ' '.repeat(19), offsetTimeOriginal: null, subsecondOriginal: null },
		{ dateTimeOriginal: '2026:10:07 01:02:03', offsetTimeOriginal: '      ', subsecondOriginal: '00120' },
	];
	for (const raw of rawCases) {
		const facts = { ...EMPTY, artist: 'Owner', captureTime: raw.dateTimeOriginal.startsWith('2026')
			? { local: '2026-10-07T01:02:03', offsetMinutes: null, subsecond: '00120' } : null, captureTimeRaw: raw };
		const before = structuredClone(facts), bytes = encode(facts), { root, exif } = parse(bytes);
		assert.equal(text(tag(exif, 0x9003)), `${raw.dateTimeOriginal}\0`);
		for (const [id, value] of [[0x9011, raw.offsetTimeOriginal], [0x9291, raw.subsecondOriginal]] as const) {
			if (value === null) assert.equal(exif.some(entry => entry.id === id), false);
			else assert.equal(text(tag(exif, id)), `${value}\0`);
		}
		assert.equal(text(tag(root, 0x13b)), 'Owner\0');
		assert.ok([...root, ...exif].every(value => ![0x8825, 0x927c, 0x9286, 0xa005, 0x201, 0x202].includes(value.id)));
		assert.deepEqual(facts, before);
		assert.deepEqual(readExifMetadataV1(bytes).captureTimeRaw, raw, 'reader round-trip is a secondary control');
	}
});

test('legacy normalized times encode declared offsets without inventing an unknown timezone', () => {
	for (const offsetMinutes of [null, 0, -270, 330]) {
		const { exif } = parse(encode({ ...EMPTY, captureTime: { local: '2024-02-29T13:14:15', offsetMinutes, subsecond: '007' } }));
		assert.equal(text(tag(exif, 0x9003)), '2024:02:29 13:14:15\0');
		assert.equal(text(tag(exif, 0x9291)), '007\0');
		if (offsetMinutes === null) assert.equal(exif.some(value => value.id === 0x9011), false);
		else assert.equal(text(tag(exif, 0x9011)), `${offsetMinutes === 0 ? '+00:00' : offsetMinutes < 0 ? '-04:30' : '+05:30'}\0`);
	}
});

test('zero and representable boundary fractions survive while unrepresentable positive values refuse loss', () => {
	for (const [value, expected] of [[0, [0, 1]], [1 / 3, [1, 3]], [1 / 0xffffffff, [1, 0xffffffff]],
		[0xffffffff, [0xffffffff, 1]]] as const) {
		assert.deepEqual(fraction(tag(parse(encode({ ...EMPTY, exposureSeconds: value })).exif, 0x829a)), expected);
	}
	for (const value of [Number.MIN_VALUE, 1e-12, 0xffffffff - 0.5]) {
		assert.throws(() => encode({ ...EMPTY, exposureSeconds: value }), /represent/u);
	}
});

test('strip emits no TIFF; closed admission refuses bad metadata, unknown fields and non-ASCII without getters', () => {
	assert.equal(encodeImageExifTiffV1(EMPTY, { ...OPTIONS, scope: 'strip' }), null);
	let calls = 0;
	const accessor = { ...EMPTY }; Object.defineProperty(accessor, 'cameraMake', { enumerable: true, get() { calls++; return 'X'; } });
	for (const value of [accessor, { ...EMPTY, gps: 'forbidden' }, { ...EMPTY, cameraMake: 'München' },
		{ ...EMPTY, description: 'x\0y' }, { ...EMPTY, copyright: 'one\ntwo\nthree' }, { ...EMPTY, iso: 0 },
		{ ...EMPTY, aperture: NaN }, { ...EMPTY, exposureSeconds: -1 },
		{ ...EMPTY, captureTimeRaw: { dateTimeOriginal: '2026:01:01 00:00:00', offsetTimeOriginal: '+00:00', subsecondOriginal: null } },
		{ ...EMPTY, cameraMake: 'x'.repeat(IMAGE_METADATA_LIMITS_V1.maximumStringBytes) }]) {
		assert.throws(() => encode(value));
	}
	assert.equal(calls, 0);
});

test('rendered geometry and output limits are captured strict unsigned integers and checked before output allocation', () => {
	for (const width of [0, -1, 1.5, NaN, Infinity, 0x100000000]) assert.throws(() => encode(EMPTY, { ...OPTIONS, width }));
	for (const height of [0, -1, 1.5, 0x100000000]) assert.throws(() => encode(EMPTY, { ...OPTIONS, height }));
	for (const maximumOutputBytes of [0, -1, 1.5, IMAGE_METADATA_LIMITS_V1.maximumMetadataBytes + 1]) {
		assert.throws(() => encode(EMPTY, { ...OPTIONS, maximumOutputBytes }));
	}
	for (const options of [{ ...OPTIONS, scope: 'gps' }, { ...OPTIONS, littleEndian: false }]) assert.throws(() => encode(EMPTY, options));
	let reads = 0; const options = { ...OPTIONS };
	Object.defineProperty(options, 'width', { enumerable: true, get() { reads++; return 3; } });
	assert.throws(() => encode(EMPTY, options)); assert.equal(reads, 0);
	assert.throws(() => encode(EMPTY, { ...OPTIONS, maximumOutputBytes: 91 }), /byte/u);
	assert.equal(encode(EMPTY, { ...OPTIONS, maximumOutputBytes: 92 }).length, 92);
	const { root, exif } = parse(encode(EMPTY, { ...OPTIONS, width: 0xffffffff, height: 65_536 }));
	assert.deepEqual(root.map(value => value.id), [0x112, 0x8769]);
	assert.equal(scalar(tag(exif, 0xa002)), 0xffffffff); assert.equal(scalar(tag(exif, 0xa003)), 65_536);
	const one = encode(), two = encode(); one.fill(0); assert.equal(two[0], 73);
});
