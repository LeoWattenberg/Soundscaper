/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	workspacePreferencesPage,
} from '../src/common/editor/ui/workspace/workspace-preferences-routing.ts';

test('Preferences opens on General the way Audacity does', () => {
	assert.equal(workspacePreferencesPage(undefined), 'general');
	assert.equal(workspacePreferencesPage('general'), 'general');
	assert.equal(workspacePreferencesPage('nonsense'), 'general');
});

test('every preference page is reachable on both hosts', () => {
	for (const page of ['appearance', 'editing', 'spectrogram', 'workspace', 'panels', 'shortcuts']) {
		assert.equal(workspacePreferencesPage(page), page);
	}
});

test('preference aliases remain stable', () => {
	assert.equal(workspacePreferencesPage('snap'), 'editing');
	assert.equal(workspacePreferencesPage('sound-activation'), 'sound-activation');
});
