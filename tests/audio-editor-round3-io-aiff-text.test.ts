/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { decodeAiffMetadataText } from '../src/common/editor/aiff-metadata-text.ts';

test('an unchanged libsndfile AIFF retains UTF-8 title and artist metadata', async () => {
	const bytes = Buffer.from(readFileSync(new URL('./fixtures/libsndfile-utf8-text.aiff.base64', import.meta.url), 'utf8').trim(), 'base64');
	const inspected = await inspectImportedMediaMetadata(new Blob([bytes], { type: 'audio/aiff' }));
	assert.deepEqual(inspected.metadata.normalized, {
		artist: 'Élodie', comment: 'Recorded at dawn', title: 'Straße am Meer',
	});
	assert.equal(inspected.metadata.raw?.NAME, 'Straße am Meer');
	assert.equal(inspected.metadata.raw?.AUTH, 'Élodie');
});

test('AIFF text keeps legacy single-byte accents when UTF-8 decoding is unavailable', () => {
	assert.equal(decodeAiffMetadataText(Buffer.from('Élodie, Straße', 'latin1')), 'Élodie, Straße');
	assert.equal(decodeAiffMetadataText(new TextEncoder().encode('東京の記録\0')), '東京の記録');
	const field = Buffer.from([0xff, ...new TextEncoder().encode('Élodie'), 0xff]);
	assert.equal(decodeAiffMetadataText(field.subarray(1, -1)), 'Élodie');
});
