/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { admitExifSrgbDeclarationsV1 } from '../src/common/editor/imaging/exif-color-admission-v1.ts';
import { readImageMetadataV1 } from '../src/common/editor/imaging/image-metadata-reader-v1.ts';
import { joinBytes, numberEntry, textEntry, tiffFixture } from './helpers/image-metadata-fixtures.ts';

function linkedDirectory(pointer: 'interop' | 'gps', index: string, little: boolean): Uint8Array {
	const tag = pointer === 'interop' ? 0xa005 : 0x8825;
	const tiff = pointer === 'interop' ? tiffFixture([], [numberEntry(tag, 0, little, 4)], little)
		: tiffFixture([numberEntry(tag, 0, little, 4)], [], little);
	const bytes = joinBytes(tiff, new Uint8Array(18)), view = new DataView(bytes.buffer);
	const root = view.getUint32(4, little), owner = pointer === 'interop' ? view.getUint32(root + 10, little) : root;
	view.setUint32(owner + 10, tiff.length, little);
	view.setUint16(tiff.length, 1, little);
	view.setUint16(tiff.length + 2, 1, little); view.setUint16(tiff.length + 4, 2, little);
	view.setUint32(tiff.length + 6, 4, little); bytes.set(new TextEncoder().encode(`${index}\0`), tiff.length + 10);
	return bytes;
}

test('Exif ColorSpace and DCF interoperability declarations must independently admit sRGB', () => {
	for (const little of [true, false]) {
		admitExifSrgbDeclarationsV1(tiffFixture([], [numberEntry(0xa001, 1, little)], little));
		admitExifSrgbDeclarationsV1(linkedDirectory('interop', 'R98', little));
		admitExifSrgbDeclarationsV1(linkedDirectory('gps', 'N  ', little));
		for (const index of ['R03', 'THM', '???']) assert.throws(() => admitExifSrgbDeclarationsV1(linkedDirectory('interop', index, little)), /colour/u);
		for (const value of [0, 2, 65535]) assert.throws(() => admitExifSrgbDeclarationsV1(tiffFixture([], [numberEntry(0xa001, value, little)], little)), /colour/u);
		assert.throws(() => admitExifSrgbDeclarationsV1(tiffFixture([], [numberEntry(0xa001, 1, little, 4)], little)), /colour/u);
		assert.throws(() => admitExifSrgbDeclarationsV1(tiffFixture([], [numberEntry(0xa500, 1, little)], little)), /colour/u);
		assert.throws(() => admitExifSrgbDeclarationsV1(tiffFixture([numberEntry(0x8773, 1, little)], [], little)), /colour/u);
	}
});

test('malformed descriptive text cannot hide later color declarations or change extraction behavior', () => {
	const artist = textEntry(0x013b, 'invalid'); artist.data[0] = 255;
	const allowed = tiffFixture([artist], [numberEntry(0xa001, 1)]);
	admitExifSrgbDeclarationsV1(allowed);
	assert.deepEqual(readImageMetadataV1(allowed).issues, ['unsupported-text-encoding']);
	assert.throws(() => admitExifSrgbDeclarationsV1(tiffFixture([artist], [numberEntry(0xa001, 65535)])), /colour/u);
	const unknown = tiffFixture([textEntry(0x013b, 'Ada')], [numberEntry(0xa001, 65535)]);
	assert.equal(readImageMetadataV1(unknown).exif?.artist, 'Ada');
});

test('color visitor inherits TIFF cycle, duplicate, work, geometry and intrinsic byte bounds', () => {
	const normal = tiffFixture([], [numberEntry(0xa001, 1)]);
	for (let length = 0; length < normal.length; length++) assert.throws(() => admitExifSrgbDeclarationsV1(normal.slice(0, length)));
	const cycle = normal.slice(); new DataView(cycle.buffer).setUint32(18, 8, true);
	assert.throws(() => admitExifSrgbDeclarationsV1(cycle), /malformed-exif/u);
	assert.throws(() => admitExifSrgbDeclarationsV1(tiffFixture([], [numberEntry(0xa001, 1), numberEntry(0xa001, 1)])), /malformed-exif/u);
	assert.throws(() => admitExifSrgbDeclarationsV1(tiffFixture(Array.from({ length: 513 }, (_unused, index) => numberEntry(index, 1)))), /metadata-limit/u);
	let invoked = 0;
	Object.defineProperty(normal, 'byteOffset', { get() { invoked++; throw new Error('byte getter'); } });
	assert.throws(() => admitExifSrgbDeclarationsV1(normal)); assert.equal(invoked, 0);
});

test('generated color declarations refuse every value outside the verified sRGB enum', () => {
	let state = 0x65786966;
	for (let index = 0; index < 2_000; index++) {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		const little = index % 2 === 0, color = state & 0xffff;
		const bytes = tiffFixture([], [numberEntry(0xa001, color, little)], little);
		if (color === 1) admitExifSrgbDeclarationsV1(bytes);
		else assert.throws(() => admitExifSrgbDeclarationsV1(bytes), /colour/u);
	}
});
