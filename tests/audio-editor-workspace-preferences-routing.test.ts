/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	workspacePreferencesPage,
} from '../src/common/editor/ui/workspace/workspace-preferences-routing.ts';

test('desktop Preferences defaults to General and admits the desktop-only page', () => {
	assert.equal(workspacePreferencesPage(undefined, true), 'general');
	assert.equal(workspacePreferencesPage('general', true), 'general');
	assert.equal(workspacePreferencesPage('appearance', true), 'appearance');
});

test('browser Preferences preserves its Shortcuts default and rejects General', () => {
	assert.equal(workspacePreferencesPage(undefined, false), 'shortcuts');
	assert.equal(workspacePreferencesPage('general', false), 'shortcuts');
	assert.equal(workspacePreferencesPage('appearance', false), 'appearance');
});

test('preference aliases remain stable on both hosts', () => {
	assert.equal(workspacePreferencesPage('snap', true), 'editing');
	assert.equal(workspacePreferencesPage('sound-activation', false), 'sound-activation');
});
