/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { motionscaperCopy } from '../src/common/editor/ui/motionscaper/motionscaper-copy.ts';
test('Motion tracking copy is owned, localized and merged into menu copy', () => {
	const key = 'ui.motionscaper-tracking.motionscaperTracking';
	assert.equal(EDITOR_ENGLISH_COPY[key], 'Tracking and Stabilization'); assert.equal(EDITOR_GERMAN_COPY[key], 'Tracking und Stabilisierung');
	assert.equal(motionscaperCopy('de').motionscaperTracking, 'Tracking und Stabilisierung');
	assert.equal(motionscaperCopy('fr', { [key]: 'Suivi et stabilisation' }).motionscaperTracking, 'Suivi et stabilisation');
});
