/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_EDITOR_STARTUP_MODES,
	resolveStartupProjectId,
} from '../src/common/editor/startup-preferences.ts';

test('Program start offers the three modes this editor can honour', () => {
	// Audacity's fourth mode, an empty window with no score, has no counterpart:
	// this editor always has a project open, so it collapses into the new project.
	assert.deepEqual([...AUDIO_EDITOR_STARTUP_MODES], [
		'continue-last-session',
		'new-project',
		'project',
	]);
});

test('continuing the last session is what an absent preference means', () => {
	assert.equal(resolveStartupProjectId(undefined, 'last'), 'last');
	assert.equal(resolveStartupProjectId(null, 'last'), 'last');
	assert.equal(resolveStartupProjectId({}, 'last'), 'last');
	assert.equal(resolveStartupProjectId({ mode: 'continue-last-session' }, 'last'), 'last');
	assert.equal(resolveStartupProjectId({ mode: 'continue-last-session' }, null), null);
});

test('starting with a new project ignores the last session', () => {
	assert.equal(resolveStartupProjectId({ mode: 'new-project', projectId: 'archive' }, 'last'), null);
});

test('a named startup project wins over the last session, and an empty name opens nothing', () => {
	assert.equal(resolveStartupProjectId({ mode: 'project', projectId: 'archive' }, 'last'), 'archive');
	assert.equal(resolveStartupProjectId({ mode: 'project', projectId: '' }, 'last'), null);
});
