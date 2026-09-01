/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeExportName } from '../src/common/editor/export.js';

test('export names preserve the explicitly supported German letters', () => {
	assert.equal(sanitizeExportName('Käse Öl Übergröße'), 'Käse-Öl-Übergröße');
	assert.equal(sanitizeExportName('Ka\u0308se'), 'Käse');
	assert.equal(sanitizeExportName('Café'), 'Cafe');
});
