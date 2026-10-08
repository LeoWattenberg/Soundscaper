/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import { expandPhotoImportNameV1, normalizePhotoImportRenameV1 } from '../src/lightscaper/import/photo-import-name-template-v1.ts';

const rename = { template: '{stem}-{sequence}.{extension}', sequenceStart: 10, sequencePadding: 4 };

test('rename preserves Unicode/case and uses the original selected index, including failed slots', () => {
	assert.equal(expandPhotoImportNameV1('Été.photo.JPG', 0, rename), 'Été.photo-0010.JPG');
	assert.equal(expandPhotoImportNameV1('Été.photo.JPG', 2, rename), 'Été.photo-0012.JPG');
	assert.equal(expandPhotoImportNameV1('  Photo.JPG  ', 0, null), '  Photo.JPG  ');
	for (const [source, expected] of [['.hidden', '.hidden|'], ['photo.', 'photo.|'], ['plain', 'plain|'], ['a.b.c', 'a.b|c']]) {
		assert.equal(expandPhotoImportNameV1(source!, 0, { ...rename, template: '{stem}|{extension}' }), expected);
	}
});

test('closed templates refuse scripts, unknown/unmatched tokens, unsafe numbers and output overflow', () => {
	let invoked = 0;
	const hostile = Object.defineProperty({ ...rename }, 'template', { enumerable: true, get: () => { invoked++; return '{stem}'; } });
	for (const value of [hostile, { ...rename, future: true }, { ...rename, template: '{unknown}' },
		{ ...rename, template: '{{stem}}' }, { ...rename, template: '{stem' }, { ...rename, template: 'stem}' },
		{ ...rename, template: 'a'.repeat(257) }, { ...rename, sequenceStart: 0 }, { ...rename, sequenceStart: 1.5 },
		{ ...rename, sequencePadding: 0 }, { ...rename, sequencePadding: 17 }]) assert.throws(() => normalizePhotoImportRenameV1(value));
	assert.equal(invoked, 0);
	assert.throws(() => expandPhotoImportNameV1('a'.repeat(256), 0, rename), /filename|name|bound/iu);
	assert.throws(() => expandPhotoImportNameV1('a', 1, { ...rename, sequenceStart: Number.MAX_SAFE_INTEGER }), /sequence/iu);
	assert.throws(() => expandPhotoImportNameV1('a', 64, rename));
});

test('sequence expansion has deterministic decimal padding for every admitted selection index', () => {
	fc.assert(fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.integer({ min: 0, max: 63 }),
		fc.integer({ min: 1, max: 16 }), (start, index, padding) => {
			assert.equal(expandPhotoImportNameV1('Photo.png', index, { template: '{sequence}', sequenceStart: start, sequencePadding: padding }),
				String(start + index).padStart(padding, '0'));
		}), { seed: 502, numRuns: 100 });
});
