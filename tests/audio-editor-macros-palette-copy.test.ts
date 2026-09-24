/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import { AUDACITY_ACTION_MANIFEST, resolveAudacityActionId } from '../src/common/editor/audacity-action-parity.js';

test('the macro editing surface is named Macros palette in both maintained locales', () => {
	assert.equal(ENGLISH_COPY.macrosPalette, 'Macros palette');
	assert.equal(GERMAN_COPY.macrosPalette, 'Makropalette');
	assert.equal(Object.hasOwn(ENGLISH_COPY, 'macroManager'), false);
	assert.equal(AUDACITY_ACTION_MANIFEST['manage-macros']?.label, 'Macros palette');
	assert.equal(resolveAudacityActionId('macros-palette'), 'manage-macros');
	assert.equal(resolveAudacityActionId('macro-manager'), 'manage-macros');
});
