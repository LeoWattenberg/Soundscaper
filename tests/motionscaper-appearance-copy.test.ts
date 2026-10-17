/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { motionscaperCopy } from '../src/common/editor/ui/motionscaper/motionscaper-copy.ts';
test('Motion appearance copy is owned, localized and merged into menu copy', () => {
	const key = 'ui.motionscaper-appearance.motionscaperAppearance';
	assert.equal(EDITOR_ENGLISH_COPY[key], 'Text and Appearance'); assert.equal(EDITOR_GERMAN_COPY[key], 'Text und Aussehen');
	assert.equal(motionscaperCopy('de').motionscaperAppearance, 'Text und Aussehen');
	assert.equal(motionscaperCopy('fr', { [key]: 'Texte et apparence' }).motionscaperAppearance, 'Texte et apparence');
	for (const suffix of ['FontImport', 'GradientStop', 'StrokeWidth', 'TextLayout']) {
		assert.equal(typeof EDITOR_ENGLISH_COPY[`ui.motionscaper-appearance.motionscaper${suffix}`], 'string');
		assert.equal(typeof EDITOR_GERMAN_COPY[`ui.motionscaper-appearance.motionscaper${suffix}`], 'string');
	}
});
