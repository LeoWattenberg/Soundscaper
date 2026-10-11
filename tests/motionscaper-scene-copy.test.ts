/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { motionscaperCopy } from '../src/common/editor/ui/motionscaper/motionscaper-copy.ts';
test('Motion scene copy is owned, localized and merged into menu copy', () => {
	const key = 'ui.motionscaper-scene.motionscaperScene';
	assert.equal(EDITOR_ENGLISH_COPY[key], '3D Scene and Quality'); assert.equal(EDITOR_GERMAN_COPY[key], '3D-Szene und Qualität');
	assert.equal(motionscaperCopy('de').motionscaperScene, '3D-Szene und Qualität');
	assert.equal(motionscaperCopy('fr', { [key]: 'Scène 3D et qualité' }).motionscaperScene, 'Scène 3D et qualité');
});
