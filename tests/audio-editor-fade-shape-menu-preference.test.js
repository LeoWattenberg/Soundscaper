/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAudioEditorPreferencesV1,
	loadAudioEditorPreferencesV1,
	updateAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';
import { createApplicationViewMenu } from '../src/common/editor/ui/application-view-menu.js';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

test('fade shape handles show by default and preserve the saved View choice', () => {
	const defaults = createAudioEditorPreferencesV1();
	assert.equal(defaults.view.showFadeShapeHandles, true);
	const hidden = updateAudioEditorPreferencesV1(defaults, { view: { showFadeShapeHandles: false } });
	assert.equal(loadAudioEditorPreferencesV1(hidden).preferences.view.showFadeShapeHandles, false);
	const legacy = { ...defaults, view: { showMasterTrack: false, showMarkers: false } };
	assert.equal(loadAudioEditorPreferencesV1(legacy).preferences.view.showFadeShapeHandles, true);
	const previouslyHiddenByDefault = { ...defaults, view: { ...legacy.view, showFadeShapeHandles: false } };
	assert.equal(loadAudioEditorPreferencesV1(previouslyHiddenByDefault).preferences.view.showFadeShapeHandles, true);
	assert.throws(() => createAudioEditorPreferencesV1({ view: { showFadeShapeHandles: 'yes' } }), /view\.showFadeShapeHandles/u);
});

test('the View visibility item exposes noun labels and the current preference', () => {
	let toggled = false;
	const preferences = createAudioEditorPreferencesV1();
	const menu = (copy, showFadeShapeHandles) => createApplicationViewMenu({
		capabilities: {}, clipSelectionNavigationMenus: { skip: { id: 'skip' } }, compactLayout: false,
		copy, desktopHost: { view: [] }, divider: () => ({ id: 'divider' }), editBlocked: false,
		effectsPanelOpen: false, preferences, productItems: { view: [], mixer: [] }, project: null,
		projectBinEffectivelyOpen: false, selectedAudioTrack: null, editSelectionActive: false,
		showArmControls: false, snapshot: { preferences: { view: { showFadeShapeHandles } } }, uiFlags: {},
	}, { toggleFadeShapeHandles: () => { toggled = true; } });
	const disabled = menu(ENGLISH_COPY, false).items.find((item) => item.id === 'show-fade-shape-handles');
	assert.equal(disabled?.label, 'Fade shape handles');
	assert.equal(disabled?.checked, false);
	assert.equal(disabled?.visibilityToggle, true);
	disabled?.onClick();
	assert.equal(toggled, true);
	const enabled = menu(GERMAN_COPY, true).items.find((item) => item.id === 'show-fade-shape-handles');
	assert.equal(enabled?.label, 'Fadeform-Griffe');
	assert.equal(enabled?.checked, true);
});
