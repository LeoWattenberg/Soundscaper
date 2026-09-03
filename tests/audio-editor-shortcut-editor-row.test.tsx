/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	ShortcutEditorRow,
	shortcutEditorDraft,
} from '../src/common/editor/ui/dialogs/WorkspacePreferencesDialog.jsx';

const ACTION_ID = 'delete-all-tracks-ripple';
const IMPORTED_BINDINGS = Object.freeze(['Ctrl+Delete', 'Ctrl+Backspace']);

test('shortcut editor assignment replaces the primary and preserves imported alternatives', () => {
	const draft = shortcutEditorDraft({
		shortcuts: { [ACTION_ID]: IMPORTED_BINDINGS },
		preferenceId: ACTION_ID,
		persistedBindings: IMPORTED_BINDINGS,
		binding: 'Ctrl+Shift+Delete',
	});

	assert.equal(draft.normalized, 'Ctrl+Shift+Delete');
	assert.deepEqual(draft.bindings, ['Ctrl+Shift+Delete', 'Ctrl+Backspace']);
	assert.equal(draft.conflict, null);
});

test('shortcut editor conflict detection includes every preserved alternative', () => {
	const draft = shortcutEditorDraft({
		shortcuts: {
			[ACTION_ID]: IMPORTED_BINDINGS,
			'other-action': ['Ctrl+Backspace'],
		},
		preferenceId: ACTION_ID,
		persistedBindings: IMPORTED_BINDINGS,
		binding: 'Ctrl+Shift+Delete',
	});

	assert.deepEqual(draft.bindings, ['Ctrl+Shift+Delete', 'Ctrl+Backspace']);
	assert.deepEqual(draft.conflict, {
		binding: 'Ctrl+Backspace',
		actionIds: [ACTION_ID, 'other-action'],
	});
});

test('clearing a shortcut draft removes the primary and every alternative', () => {
	const draft = shortcutEditorDraft({
		shortcuts: { [ACTION_ID]: IMPORTED_BINDINGS },
		preferenceId: ACTION_ID,
		persistedBindings: IMPORTED_BINDINGS,
		binding: '   ',
	});

	assert.equal(draft.normalized, '');
	assert.deepEqual(draft.bindings, []);
	assert.equal(draft.conflict, null);
});

test('shortcut editor visibly exposes bindings after the editable primary', () => {
	const runtimeGlobal = globalThis as typeof globalThis & { React?: typeof React };
	const priorReact = Object.getOwnPropertyDescriptor(runtimeGlobal, 'React');
	runtimeGlobal.React = React;
	let markup: string;
	try {
		markup = renderToStaticMarkup(<ShortcutEditorRow
			command={{
				id: ACTION_ID,
				preferenceId: ACTION_ID,
				label: 'Delete and close gap',
				disabled: false,
				disabledReason: null,
			}}
			preferences={{ shortcuts: { [ACTION_ID]: IMPORTED_BINDINGS } }}
			controller={{ actions: { preferences: { setShortcut: () => undefined } } }}
			copy={{
				shortcutAssign: 'Assign',
				shortcutColumn: 'Shortcut',
				shortcutConflict: '{binding} conflicts with {action}',
				shortcutInvalid: 'Invalid shortcut',
			}}
			run={(operation: () => unknown) => operation()}
		/>);
	} finally {
		if (priorReact) Object.defineProperty(runtimeGlobal, 'React', priorReact);
		else Reflect.deleteProperty(runtimeGlobal, 'React');
	}

	assert.match(markup, /value="Ctrl\+Delete"/u);
	assert.match(markup, /data-shortcut-alternatives="true"/u);
	assert.match(markup, /Shortcut: Ctrl\+Backspace/u);
});
