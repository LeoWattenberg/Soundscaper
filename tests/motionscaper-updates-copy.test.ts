/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY, getEditorCopyMetadata } from '../src/common/i18n/editor-copy-inventory.ts';
import { MOTIONSCAPER_UPDATES_COPY_BY_LOCALE } from '../src/common/i18n/editor-motionscaper-updates-copy.ts';
test('the manual Motion updater copy is registered for canonical locale fallback and translation ownership', () => {
	for (const [key, english] of Object.entries(MOTIONSCAPER_UPDATES_COPY_BY_LOCALE.en)) {
		const identity = `ui.motionscaper-updates.${key}`;
		assert.equal(EDITOR_ENGLISH_COPY[identity], english); assert.equal(EDITOR_GERMAN_COPY[identity], MOTIONSCAPER_UPDATES_COPY_BY_LOCALE.de[key]);
		assert.equal(getEditorCopyMetadata()[identity]?.owner, 'motionscaper-updates');
	}
});
