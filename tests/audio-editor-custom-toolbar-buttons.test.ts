/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MUSESCORE_ICON_CODES } from '../src/common/editor/audacity-iconcodes.js';
import { normalizeCustomToolbarButtons } from '../src/common/editor/custom-toolbar-buttons.ts';
import {
	applyAudioEditorWorkspace,
	createAudioEditorPreferencesV1,
	createCustomAudioEditorWorkspace,
	deleteCustomAudioEditorWorkspace,
	loadAudioEditorPreferencesV1,
	updateAudioEditorPreferencesV1,
	validateAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';

const BUTTON = { id: 'custom-split', name: 'Split selection', icon: 'CUT', actionId: 'split' };

test('custom toolbar buttons normalize copied records while preserving stable IDs', () => {
	assert.deepEqual(normalizeCustomToolbarButtons(), []);
	const button = { id: ' custom-split ', name: ' Split selection ', icon: ' CUT ', actionId: ' split ' };
	const input = [button];
	const normalized = normalizeCustomToolbarButtons(input);
	assert.deepEqual(normalized, [BUTTON]);
	assert.notEqual(normalized, input);
	assert.notEqual(normalized[0], button);
	assert.equal(button.name, ' Split selection ');
	assert.deepEqual(normalizeCustomToolbarButtons(normalized), [BUTTON]);
});

test('custom toolbar buttons accept every registered font symbol and preserve action IDs', () => {
	const buttons = Object.keys(MUSESCORE_ICON_CODES).map((icon) => ({
		...BUTTON, id: `custom-${icon}`, icon, actionId: 'action://editor/selection-action',
	}));
	assert.deepEqual(normalizeCustomToolbarButtons(buttons), buttons);
});

test('custom toolbar buttons reject malformed records, unsupported symbols and duplicate IDs', () => {
	for (const value of [null, false, '', {}, 1]) {
		assert.throws(() => normalizeCustomToolbarButtons(value), TypeError);
	}
	for (const value of [null, false, [], new Date(), 'button']) {
		assert.throws(() => normalizeCustomToolbarButtons([value]), TypeError);
	}
	for (const field of ['id', 'name', 'icon', 'actionId']) {
		for (const value of [undefined, null, false, 1, '', '  ']) {
			assert.throws(() => normalizeCustomToolbarButtons([{ ...BUTTON, [field]: value }]), TypeError);
		}
	}
	for (const icon of ['NOT_AN_ICON', '__proto__', 'toString']) {
		assert.throws(() => normalizeCustomToolbarButtons([{ ...BUTTON, icon }]), RangeError);
	}
	assert.throws(() => normalizeCustomToolbarButtons([BUTTON, { ...BUTTON, id: ' custom-split ' }]), RangeError);
	assert.equal(normalizeCustomToolbarButtons([BUTTON, { ...BUTTON, id: 'custom-split-2' }]).length, 2);
});

test('custom toolbar button normalization reads enumerable data fields without invoking accessors', () => {
	let accessed = false;
	const accessor = Object.defineProperty({ ...BUTTON }, 'name', {
		enumerable: true, get() { accessed = true; return BUTTON.name; },
	});
	assert.throws(() => normalizeCustomToolbarButtons([accessor]), TypeError);
	assert.equal(accessed, false);
	const hidden = Object.defineProperty({ ...BUTTON }, 'icon', { enumerable: false });
	assert.throws(() => normalizeCustomToolbarButtons([hidden]), TypeError);
	assert.deepEqual(normalizeCustomToolbarButtons([Object.assign(Object.create(null) as object, BUTTON)]), [BUTTON]);
});

test('older preferences default to no custom buttons, and configured buttons survive persistence', () => {
	const defaults = createAudioEditorPreferencesV1();
	assert.deepEqual(defaults.workspace.customButtons, []);
	const oldWorkspace: Record<string, unknown> = { ...defaults.workspace };
	delete oldWorkspace.customButtons;
	const oldPreferences = { ...defaults, workspace: oldWorkspace };
	assert.deepEqual(loadAudioEditorPreferencesV1(oldPreferences).preferences.workspace.customButtons, []);
	const preferences = updateAudioEditorPreferencesV1(defaults, { workspace: { customButtons: [BUTTON] } });
	assert.deepEqual(preferences.workspace.customButtons, [BUTTON]);
	assert.deepEqual(defaults.workspace.customButtons, []);
	assert.deepEqual(preferences.workspace.toolbars, defaults.workspace.toolbars);
	assert.equal(validateAudioEditorPreferencesV1(preferences), true);
	const restored = loadAudioEditorPreferencesV1(JSON.parse(JSON.stringify(preferences)) as unknown);
	assert.equal(restored.readOnly, false);
	assert.deepEqual(restored.preferences.workspace.customButtons, [BUTTON]);
	const untrimmed = { ...preferences, workspace: {
		...preferences.workspace, customButtons: [{ ...BUTTON, id: ' custom-split ', name: ' Split selection ' }],
	} };
	assert.deepEqual(loadAudioEditorPreferencesV1(untrimmed).preferences.workspace.customButtons, [BUTTON]);
	assert.throws(() => createAudioEditorPreferencesV1({ workspace: { customButtons: [{ ...BUTTON, icon: 'missing' }] } }), RangeError);
	assert.throws(() => validateAudioEditorPreferencesV1({ ...defaults, workspace: { ...defaults.workspace, customButtons: [BUTTON, BUTTON] } }), RangeError);
});

test('custom buttons belong to the user across built-in and saved workspace changes', () => {
	const preferences = createAudioEditorPreferencesV1({ workspace: { customButtons: [BUTTON] } });
	const classic = applyAudioEditorWorkspace(preferences, 'classic');
	assert.deepEqual(classic.workspace.customButtons, [BUTTON]);
	const custom = createCustomAudioEditorWorkspace(classic, { id: 'editing', name: 'Editing' });
	assert.deepEqual(custom.workspace.customButtons, [BUTTON]);
	const modern = applyAudioEditorWorkspace(custom, 'modern');
	assert.deepEqual(modern.workspace.customButtons, [BUTTON]);
	const editing = applyAudioEditorWorkspace(modern, 'editing');
	assert.deepEqual(editing.workspace.customButtons, [BUTTON]);
	const deleted = deleteCustomAudioEditorWorkspace(editing, 'editing');
	assert.deepEqual(deleted.workspace.customButtons, [BUTTON]);
	const cleared = updateAudioEditorPreferencesV1(deleted, { workspace: { customButtons: [] } });
	assert.deepEqual(cleared.workspace.customButtons, []);
});
