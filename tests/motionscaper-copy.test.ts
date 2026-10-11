/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { MOTIONSCAPER_CANONICAL_ENGLISH_COPY, resolveMotionscaperCopy } from '../src/common/i18n/editor-motionscaper-copy.ts';

test('Motionscaper owned copy participates in canonical translation generation and scoped overrides', () => {
	const key = 'ui.motionscaper.motionscaperNewComposition';
	assert.equal(EDITOR_ENGLISH_COPY[key], 'New Composition');
	assert.equal(EDITOR_GERMAN_COPY[key], 'Neue Komposition');
	assert.equal(MOTIONSCAPER_CANONICAL_ENGLISH_COPY[key], EDITOR_ENGLISH_COPY[key]);
	assert.equal(resolveMotionscaperCopy('de-DE').motionscaperNewComposition, 'Neue Komposition');
	assert.equal(resolveMotionscaperCopy('fr', { [key]: 'Nouvelle composition' }).motionscaperNewComposition, 'Nouvelle composition');
	assert.equal(resolveMotionscaperCopy('fr').motionscaperNewComposition, 'New Composition');
});
