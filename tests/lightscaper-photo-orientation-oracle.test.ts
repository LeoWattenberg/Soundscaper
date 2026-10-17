/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readImageMetadataV1 } from '../src/common/editor/imaging/image-metadata-reader-v1.ts';
import { admitExifSrgbDeclarationsV1 } from '../src/common/editor/imaging/exif-color-admission-v1.ts';
import { jpegWithExifOrientationV1, permuteExifRgbaV1, photoOrientationGridV1, unprofiledCanvasJpegFixtureV1 } from './helpers/lightscaper-photo-orientation-oracle.ts';
import { compareOrientationPixelsV1 } from './helpers/lightscaper-photo-orientation-native-fixture.ts';
import { jpegFixture, jpegSegment, joinBytes } from './helpers/image-metadata-fixtures.ts';

const input = Uint8Array.from([1, 2, 3, 4, 5, 6].flatMap(red => [red, 0, 0, 255]));
const goldens = [
	[1, 2, 3, 4, 5, 6], [2, 1, 4, 3, 6, 5], [6, 5, 4, 3, 2, 1], [5, 6, 3, 4, 1, 2],
	[1, 3, 5, 2, 4, 6], [5, 3, 1, 6, 4, 2], [6, 4, 2, 5, 3, 1], [2, 4, 6, 1, 3, 5],
] as const;
for (const [index, golden] of goldens.entries()) test(`Exif orientation ${index + 1} permutes a non-square labeled raster to its independently specified golden`, () => {
	const result = permuteExifRgbaV1(input, 2, 3, index + 1);
	assert.deepEqual([result.width, result.height], index < 4 ? [2, 3] : [3, 2]);
	assert.deepEqual([...result.rgba].filter((_value, channel) => channel % 4 === 0), golden);
	assert.deepEqual([...input].filter((_value, channel) => channel % 4 === 0), [1, 2, 3, 4, 5, 6]);
});

test('the genuine browser encode seed is small, opaque and asymmetric under every orientation', () => {
	const grid = photoOrientationGridV1();
	assert.deepEqual([grid.width, grid.height, grid.rgba.length], [32, 24, 3072]);
	assert.equal([...grid.rgba].filter((_value, channel) => channel % 4 === 3).every(alpha => alpha === 255), true);
	const distinct = new Set(Array.from({ length: 8 }, (_unused, index) => [...permuteExifRgbaV1(grid.rgba, grid.width, grid.height, index + 1).rgba].join(',')));
	assert.equal(distinct.size, 8);
});

test('Exif fixture headers preserve all existing JPEG bytes and expose exact source orientation independently of color admission', () => {
	const source = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);
	for (let orientation = 1; orientation <= 8; orientation++) {
		const fixture = jpegWithExifOrientationV1(source, orientation);
		assert.deepEqual(fixture.subarray(0, 2), source.subarray(0, 2));
		assert.deepEqual(fixture.subarray(68), source.subarray(2));
		assert.deepEqual(readImageMetadataV1(fixture).issues, []);
		assert.equal(readImageMetadataV1(fixture).exif?.orientation, orientation);
	}
	const refused = jpegWithExifOrientationV1(source, 6, 65535);
	assert.equal(readImageMetadataV1(refused).exif?.orientation, 6);
	assert.throws(() => admitExifSrgbDeclarationsV1(refused.subarray(12, 68)), /colour/u);
});

test('fixture-only sRGB ICC removal preserves every other header and all compressed bytes', () => {
	const ordinary = jpegSegment(0xe0, Uint8Array.of(7, 8)), scan = jpegSegment(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0)), entropy = Uint8Array.of(99, 0xff, 0, 0x72);
	const icc = jpegSegment(0xe2, joinBytes(new TextEncoder().encode('ICC_PROFILE\0'), Uint8Array.of(1, 1, 10, 20, 30)));
	const result = unprofiledCanvasJpegFixtureV1(jpegFixture(icc, ordinary, scan, entropy));
	assert.deepEqual(result.jpeg, jpegFixture(ordinary, scan, entropy)); assert.equal(result.removedIccSegments, 1);
	const unknown = jpegSegment(0xe2, new TextEncoder().encode('Unrelated application2 metadata'));
	assert.deepEqual(unprofiledCanvasJpegFixtureV1(jpegFixture(unknown, scan, entropy)).jpeg, jpegFixture(unknown, scan, entropy));
});

test('pixel qualification cannot pass equal geometry with wrong mirrored pixels, missing bytes or changed alpha', () => {
	assert.deepEqual(compareOrientationPixelsV1(input, input), { maximumPixelDifference: 0, unequalChannels: 0 });
	assert.ok(compareOrientationPixelsV1(permuteExifRgbaV1(input, 2, 3, 2).rgba, input).unequalChannels > 0);
	assert.equal(compareOrientationPixelsV1(input.subarray(0, input.length - 1), input).unequalChannels, 1);
	assert.equal(compareOrientationPixelsV1(joinBytes(input, Uint8Array.of(255)), input).unequalChannels, 1);
	const alpha = input.slice(); alpha[3] = 0;
	assert.deepEqual(compareOrientationPixelsV1(alpha, input), { maximumPixelDifference: 255, unequalChannels: 1 });
});
