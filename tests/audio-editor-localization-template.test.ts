/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { COPY_BY_LOCALE } from '../src/common/i18n/catalogs.js';
import {
	formatLocalizedTemplate,
	formatOptionsLabel,
	formatResizeLabel,
} from '../src/common/editor/ui/localization-template.ts';

test('accessible UI templates preserve locale-specific word order', () => {
	assert.equal(formatOptionsLabel(COPY_BY_LOCALE.en, 'Record'), 'Record options');
	assert.equal(formatOptionsLabel(COPY_BY_LOCALE.de, 'Aufnahme'), 'Optionen für Aufnahme');
	assert.equal(formatResizeLabel(COPY_BY_LOCALE.en, 'Mixer'), 'Resize: Mixer');
	assert.equal(formatResizeLabel(COPY_BY_LOCALE.de, 'Mixer'), 'Größe ändern: Mixer');
});

test('localized templates reject missing substitutions instead of leaking placeholders', () => {
	assert.equal(formatLocalizedTemplate('{name}: {count}', { name: 'Clips', count: 2 }), 'Clips: 2');
	assert.throws(() => formatLocalizedTemplate('{name}: {count}', { name: 'Clips' }), /count/);
});
