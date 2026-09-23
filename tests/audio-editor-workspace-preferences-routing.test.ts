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
	assert.equal(workspacePreferencesPage('sound-activation'), 'general');
});

test('every preference page is reachable on both hosts', () => {
	for (const page of [
		'appearance', 'audio', 'playback-recording', 'editing', 'track-display',
		'workspace', 'shortcuts',
	]) {
		assert.equal(workspacePreferencesPage(page), page);
	}
});

test('preference aliases remain stable', () => {
	assert.equal(workspacePreferencesPage('snap'), 'editing');
	assert.equal(workspacePreferencesPage('waveform'), 'track-display');
	assert.equal(workspacePreferencesPage('spectrogram'), 'track-display');
	assert.equal(workspacePreferencesPage('panels'), 'workspace');
});
