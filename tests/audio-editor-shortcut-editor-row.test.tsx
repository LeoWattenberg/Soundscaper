/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	ShortcutEditorRow,
	persistedShortcutBindings,
	shortcutEditorDraft,
} from '../src/common/editor/ui/dialogs/ShortcutEditorRow.tsx';

const ACTION_ID = 'delete-all-tracks-ripple';
const IMPORTED_BINDINGS = Object.freeze(['Ctrl+Delete', 'Ctrl+Backspace']);

test('a shortcut draft normalizes every binding a command holds', () => {
	const draft = shortcutEditorDraft({
		shortcuts: { [ACTION_ID]: IMPORTED_BINDINGS },
		preferenceId: ACTION_ID,
		bindings: ['ctrl+shift+del', '   ', 'Ctrl+Backspace'],
	});

	assert.deepEqual(draft.bindings, ['Ctrl+Shift+Delete', 'Ctrl+Backspace']);
	assert.equal(draft.conflict, null);
	assert.equal(draft.invalid, false);
});

test('a shortcut draft collapses two spellings of the same chord', () => {
	const draft = shortcutEditorDraft({
		shortcuts: {},
		preferenceId: ACTION_ID,
		bindings: ['Ctrl+Delete', 'ctrl+del', 'Ctrl+Backspace', 'ctrl+backspace'],
	});

	assert.deepEqual(draft.bindings, ['Ctrl+Delete', 'Ctrl+Backspace']);
	assert.equal(draft.conflict, null);
});

test('a shortcut draft reports a conflict on any binding, not only the first', () => {
	const draft = shortcutEditorDraft({
		shortcuts: {
			[ACTION_ID]: IMPORTED_BINDINGS,
			'other-action': ['Ctrl+Backspace'],
		},
		preferenceId: ACTION_ID,
		bindings: ['Ctrl+Shift+Delete', 'Ctrl+Backspace'],
	});

	assert.deepEqual(draft.conflict, {
		binding: 'Ctrl+Backspace',
		actionIds: [ACTION_ID, 'other-action'],
	});
});

test('emptying every field clears the command instead of assigning a blank', () => {
	const draft = shortcutEditorDraft({
		shortcuts: { [ACTION_ID]: IMPORTED_BINDINGS },
		preferenceId: ACTION_ID,
		bindings: ['   ', ''],
	});

	assert.deepEqual(draft.bindings, []);
	assert.equal(draft.conflict, null);
});

test('an unusable binding is reported as invalid rather than as a conflict', () => {
	const draft = shortcutEditorDraft({
		shortcuts: {},
		preferenceId: ACTION_ID,
		bindings: [null as unknown as string],
	});

	assert.equal(draft.invalid, true);
	assert.equal(draft.conflict, null);
	assert.deepEqual(draft.bindings, []);
});

test('a command reachable under either identifier reports the bindings it holds', () => {
	const command = { id: ACTION_ID, preferenceId: 'action://trackedit/delete-all', label: 'Delete' };
	assert.deepEqual(
		persistedShortcutBindings({ 'action://trackedit/delete-all': ['Ctrl+K'] }, command),
		['Ctrl+K'],
	);
	assert.deepEqual(persistedShortcutBindings({}, command), []);
});

test('every binding gets its own editable field, with controls to add and remove', () => {
	const markup = renderRow({ [ACTION_ID]: IMPORTED_BINDINGS });

	assert.match(markup, /data-shortcut-binding="0"[^>]*value="Ctrl\+Delete"/u);
	assert.match(markup, /data-shortcut-binding="1"[^>]*value="Ctrl\+Backspace"/u);
	assert.match(markup, /data-shortcut-remove="0"/u);
	assert.match(markup, /data-shortcut-remove="1"/u);
	assert.match(markup, /data-shortcut-add="true"/u);
});

test('a command with one binding offers no remove control for it', () => {
	const markup = renderRow({ [ACTION_ID]: ['Ctrl+Delete'] });

	assert.match(markup, /data-shortcut-binding="0"[^>]*value="Ctrl\+Delete"/u);
	assert.doesNotMatch(markup, /data-shortcut-remove/u);
	assert.match(markup, /data-shortcut-add="true"/u);
});

function renderRow(shortcuts: Readonly<Record<string, readonly string[]>>): string {
	const runtimeGlobal = globalThis as typeof globalThis & { React?: typeof React };
	const priorReact = Object.getOwnPropertyDescriptor(runtimeGlobal, 'React');
	runtimeGlobal.React = React;
	try {
		return renderToStaticMarkup(<ShortcutEditorRow
			command={{
				id: ACTION_ID,
				preferenceId: ACTION_ID,
				label: 'Delete and close gap',
				disabled: false,
				disabledReason: null,
			}}
			preferences={{ shortcuts }}
			controller={{ actions: { preferences: { setShortcut: () => undefined } } }}
			copy={{
				shortcutAddBinding: 'Add shortcut',
				shortcutAssign: 'Assign',
				shortcutColumn: 'Shortcut',
				shortcutConflict: '{binding} conflicts with {action}',
				shortcutInvalid: 'Invalid shortcut',
				shortcutRemoveBinding: 'Remove shortcut',
			}}
			run={(operation: () => unknown) => operation()}
		/>);
	} finally {
		if (priorReact) Object.defineProperty(runtimeGlobal, 'React', priorReact);
		else Reflect.deleteProperty(runtimeGlobal, 'React');
	}
}
