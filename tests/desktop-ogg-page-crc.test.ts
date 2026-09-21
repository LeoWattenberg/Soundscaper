/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { oggPageCrc as opusOggPageCrc } from '../desktop/bundled-opus-stream.ts';
import { oggPageCrc } from '../desktop/ogg-page-crc.ts';

test('the shared Ogg page CRC matches a known page and ignores its checksum field', () => {
	assert.equal(opusOggPageCrc, oggPageCrc);
	const page = new Uint8Array(29);
	page.set(new TextEncoder().encode('OggS'));
	page[5] = 2;
	new DataView(page.buffer).setUint32(14, 0x1234_5678, true);
	page[26] = 1;
	page[27] = 1;
	page[28] = 0x7f;

	assert.equal(oggPageCrc(page), 0x1a5e_08b4);
	page.set([1, 2, 3, 4], 22);
	assert.equal(oggPageCrc(page), 0x1a5e_08b4);
	assert.equal(opusOggPageCrc(page), oggPageCrc(page));
});
