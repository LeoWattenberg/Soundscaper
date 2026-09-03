/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyAudacityParityToMenus } from '../src/common/editor/audacity-action-parity.js';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { createAudioEditorSearchEntries } from '../src/common/editor/search.js';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { handleWorkspaceKeyboard } from '../src/common/editor/ui/workspace-shortcuts.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

interface MenuItem {
	readonly id?: string;
	readonly shortcut?: string;
	readonly items?: readonly MenuItem[];
}

test('Audacity parity decoration installs the imported default shortcut labels', () => {
	const [split, deleteRipple] = applyAudacityParityToMenus([
		{ id: 'split', label: 'Split' },
		{ id: 'delete-all-tracks-ripple', label: 'Ripple delete' },
	]);
	assert.equal(split.shortcut, 'Ctrl+I');
	assert.equal(deleteRipple.shortcut, 'Ctrl+Del, Ctrl+Backspace');
});

test('application menus and command search expose persisted shortcut alternatives', () => {
	const menus = createApplicationMenus(menuInput({
		'file-new': ['Alt+N', 'Ctrl+Alt+N'],
	}));
	const menuCommand = findMenuItem(menus, 'new-project');
	const searchCommand = createAudioEditorSearchEntries({ menus })
		.find((entry) => entry.kind === 'command' && entry.commandId === 'file-new');

	assert.equal(menuCommand?.shortcut, 'Alt+N, Ctrl+Alt+N');
	assert.equal(searchCommand?.shortcut, 'Alt+N, Ctrl+Alt+N');
});

test('application menus and command search do not restore a removed shortcut', () => {
	const menus = createApplicationMenus(menuInput({}));
	const menuCommand = findMenuItem(menus, 'new-project');
	const saveAs = findMenuItem(menus, 'file-save-as');
	const saveAup4 = findMenuItem(menus, 'save-aup4');
	const searchCommand = createAudioEditorSearchEntries({ menus })
		.find((entry) => entry.kind === 'command' && entry.commandId === 'file-new');

	assert.equal(Object.hasOwn(menuCommand ?? {}, 'shortcut'), false);
	assert.equal(Object.hasOwn(saveAs ?? {}, 'shortcut'), false);
	assert.equal(Object.hasOwn(saveAup4 ?? {}, 'shortcut'), false);
	assert.equal(searchCommand?.shortcut, null);
});

test('canonical paste-insert and native save-as menu items consume persisted shortcuts', () => {
	const calls: string[] = [];
	const shortcuts = {
		insert: ['Shift+V'],
		'file-save-as': ['Ctrl+Shift+S'],
	};
	const menus = createApplicationMenus(menuInput(shortcuts, {
		saveAup4: () => { calls.push('aup4'); },
		saveScape: () => { calls.push('scape'); },
	}));

	assert.equal(findMenuItem(menus, 'insert')?.shortcut, 'Shift+V');
	assert.equal(findMenuItem(menus, 'file-save-as')?.shortcut, 'Ctrl+Shift+S');
	assert.ok(findMenuItem(menus, 'save-aup4'));
	handleWorkspaceKeyboard(keyboardEvent('S'), { preferences: { shortcuts } }, (handler) => handler(), { menus });
	assert.deepEqual(calls, ['scape']);
});

function findMenuItem(items: readonly MenuItem[], id: string): MenuItem | null {
	for (const item of items) {
		if (item.id === id) return item;
		const nested = item.items ? findMenuItem(item.items, id) : null;
		if (nested) return nested;
	}
	return null;
}

function menuInput(
	shortcuts: Readonly<Record<string, readonly string[]>>,
	actionOverrides: Readonly<Record<string, () => void>> = {},
) {
	return {
		productId: 'soundscaper',
		aboutLabel: 'About',
		capabilities: {},
		locale: 'en',
		copy: ENGLISH_COPY,
		project: null,
		snapshot: {
			project: null,
			selectedTrackId: null,
			deliveryReport: null,
			preferences: createAudioEditorPreferencesV1({ shortcuts }),
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		},
		blocked: false,
		editBlocked: false,
		handoffBlocked: false,
		showArmControls: false,
		selectionActive: false,
		selectedClip: null,
		durationFrames: 0,
		effectsPanelOpen: false,
		projectBinEffectivelyOpen: false,
		uiFlags: {},
		actionRuntime: null,
		actions: new Proxy(actionOverrides, {
			get: (target, property, receiver) => Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: () => undefined,
		}),
	};
}

function keyboardEvent(key: string) {
	return {
		altKey: false,
		code: `Key${key}`,
		ctrlKey: true,
		defaultPrevented: false,
		key,
		metaKey: false,
		shiftKey: true,
		target: null,
		preventDefault() { this.defaultPrevented = true; },
	};
}
