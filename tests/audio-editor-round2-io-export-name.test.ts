/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createExportFileName, sanitizeExportName } from '../src/common/editor/export.js';

test('ordinary non-Latin project and track names remain identifiable in exported filenames', () => {
	for (const title of ['東京の録音', 'Запись', 'Αύριο', 'ध्वनि']) {
		assert.equal(sanitizeExportName(title), title);
		assert.equal(createExportFileName({ title }, { date: '2026-10-06' }), `${title}-mix-2026-10-06.wav`);
		assert.equal(createExportFileName({ title }, { mode: 'stem', trackName: title }), `01-${title}.wav`);
	}
	assert.equal(sanitizeExportName('Café'), 'Cafe');
	assert.equal(sanitizeExportName('Ka\u0308se'), 'Käse');
	assert.equal(sanitizeExportName('東京 / 録音: 1'), '東京-録音-1');
});
