/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	ShortcutEditorRow,
	persistedShortcutBindings,
	shortcutEditorDraft,
	shortcutFocusTargetAfterRemove,
} from '../src/common/editor/ui/dialogs/ShortcutEditorRow.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

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

test('a conflicting field points at the text explaining the conflict', () => {
	const markup = renderRow({ [ACTION_ID]: ['Ctrl+Delete'], 'other-action': ['Ctrl+Delete'] });

	const explanation = /<small\b[^>]*role="alert"[^>]*>/u.exec(markup)?.[0];
	assert.ok(explanation, 'the row explains the conflict');
	const errorId = /\bid="([^"]+)"/u.exec(explanation)?.[1];
	assert.ok(errorId, 'the explanation carries an id to point at');
	const field = /<input\b[^>]*data-shortcut-binding="0"[^>]*>/u.exec(markup)?.[0];
	assert.ok(field, 'the binding keeps its field');
	assert.match(field, /aria-invalid="true"/u);
	assert.ok(
		(/aria-describedby="([^"]*)"/u.exec(field)?.[1] || '').split(' ').includes(errorId),
		'the invalid field names the element explaining the conflict',
	);
});

test('focus after a removal follows the position rather than the binding', () => {
	assert.equal(shortcutFocusTargetAfterRemove(0, 2), '[data-shortcut-remove="0"]');
	assert.equal(shortcutFocusTargetAfterRemove(2, 2), '[data-shortcut-remove="1"]');
	assert.equal(shortcutFocusTargetAfterRemove(1, 1), '[data-shortcut-add="true"]');
});

test('removing a binding hands focus to the control that took its place', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(shortcutRow({
			[ACTION_ID]: ['Ctrl+Delete', 'Ctrl+Backspace', 'Ctrl+Shift+Delete'],
		})));
		await act(async () => { reactProps(dom.one('[data-shortcut-remove="2"]')).onClick?.({}); });
		assert.equal(
			dom.container.ownerDocument.activeElement?.getAttribute('data-shortcut-remove'),
			'1',
			'removing the trailing binding leaves focus on the one that becomes last',
		);
		await act(async () => { reactProps(dom.one('[data-shortcut-remove="0"]')).onClick?.({}); });
		assert.equal(
			dom.container.ownerDocument.activeElement?.getAttribute('data-shortcut-add'),
			'true',
			'a lone binding carries no remove control, so the add control takes focus',
		);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

function shortcutRow(shortcuts: Readonly<Record<string, readonly string[]>>) {
	return <ShortcutEditorRow
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
	/>;
}

function renderRow(shortcuts: Readonly<Record<string, readonly string[]>>): string {
	const runtimeGlobal = globalThis as typeof globalThis & { React?: typeof React };
	const priorReact = Object.getOwnPropertyDescriptor(runtimeGlobal, 'React');
	runtimeGlobal.React = React;
	try {
		return renderToStaticMarkup(shortcutRow(shortcuts));
	} finally {
		if (priorReact) Object.defineProperty(runtimeGlobal, 'React', priorReact);
		else Reflect.deleteProperty(runtimeGlobal, 'React');
	}
}
