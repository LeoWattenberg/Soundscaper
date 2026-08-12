/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDACITY_ACTION_STATUS,
	audacityActionDefinition,
} from '../src/common/editor/audacity-action-parity.js';
import { AUDACITY_PINNED_APP_MENU_CONTAINER_POLICY } from '../src/common/editor/audacity-pinned-ui-inventory.js';
import {
	AUDIO_EDITOR_CRITICAL_APPLICATION_MENU_ACTION_IDS,
	AUDIO_EDITOR_UNAVAILABLE_APPLICATION_MENU_ACTION_IDS,
} from '../src/common/editor/ui/application-menu-registry.ts';

const DEFINITIONS = Object.freeze([
	['select-previous-clip-boundary-to-cursor', 'selection.selectPreviousClipBoundaryToCursor', 'project-has-audio', 'Select > Audio clips'],
	['select-cursor-to-next-clip-boundary', 'selection.selectCursorToNextClipBoundary', 'project-has-audio', 'Select > Audio clips'],
	['select-previous-clip', 'selection.selectPreviousClip', 'project-has-audio', 'Select > Audio clips'],
	['select-next-clip', 'selection.selectNextClip', 'project-has-audio', 'Select > Audio clips'],
	['skip-to-selection-start', 'selection.skipToSelectionStart', 'project-opened', 'View > Skip to'],
	['skip-to-selection-end', 'selection.skipToSelectionEnd', 'project-opened', 'View > Skip to'],
	['select-no-tracks', 'selection.selectNoTracks', 'track-selected', 'Select > Tracks'],
] as const);

test('clip-selection navigation actions have implemented parity contracts and menu parents', () => {
	const critical = new Set<string>(AUDIO_EDITOR_CRITICAL_APPLICATION_MENU_ACTION_IDS);
	const unavailable = new Set<string>(AUDIO_EDITOR_UNAVAILABLE_APPLICATION_MENU_ACTION_IDS);
	for (const [id, handler, enableWhen, location] of DEFINITIONS) {
		const definition = audacityActionDefinition(id);
		assert.equal(definition?.status, AUDACITY_ACTION_STATUS.IMPLEMENTED, id);
		assert.equal(definition?.handler, handler, id);
		assert.equal(definition?.enableWhen, enableWhen, id);
		assert.deepEqual(definition?.locations, [location], id);
		assert.equal(critical.has(id), true, id);
		assert.equal(unavailable.has(id), false, id);
	}

	for (const id of ['menu-selection-audio-clips', 'menu-skip']) {
		assert.equal(audacityActionDefinition(id), null, id);
		assert.equal(AUDACITY_PINNED_APP_MENU_CONTAINER_POLICY[id]?.status, 'implemented', id);
	}
});
