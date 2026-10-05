/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { mouseShortcutBinding, mouseShortcutKey } from '../src/common/editor/mouse-shortcut.ts';
import { normalizeAudioEditorShortcut } from '../src/common/editor/audio-editor-shortcut-normalization.ts';
import { createAudioEditorPreferencesV1, findAudioEditorShortcutConflicts, loadAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { createMouseShortcutGesture } from '../src/common/editor/controller/preferences/mouse-shortcut-gesture.ts';
import {
	blockWorkspaceMouseShortcutPointer,
	handleWorkspaceMouseDown,
} from '../src/common/editor/ui/workspace-mouse-shortcuts.ts';

function mouseEvent(button = 3, overrides = {}) {
	return {
		button, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
		defaultPrevented: false, target: null as EventTarget | null,
		prevented: 0, stopped: 0,
		preventDefault() { this.prevented += 1; },
		stopPropagation() { this.stopped += 1; },
		...overrides,
	};
}

test('extra mouse buttons have stable one-based shortcut names and modifiers', () => {
	assert.equal(mouseShortcutKey(3), 'Mouse4');
	assert.equal(mouseShortcutKey(4), 'Mouse5');
	assert.equal(mouseShortcutKey(7), 'Mouse8');
	assert.equal(mouseShortcutBinding(mouseEvent(4, { ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+Mouse5');
	assert.equal(mouseShortcutBinding(mouseEvent(3, { metaKey: true, altKey: true })), 'Meta+Alt+Mouse4');
	for (const button of [0, 1, 2, -1, 3.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
		assert.equal(mouseShortcutKey(button), null, String(button));
		assert.equal(mouseShortcutBinding(mouseEvent(button)), null, String(button));
	}
});

test('mouse shortcut normalization rejects standard buttons and canonicalizes extra buttons', () => {
	assert.equal(normalizeAudioEditorShortcut('shift+ctrl+mouse04'), 'Ctrl+Shift+Mouse4');
	assert.equal(normalizeAudioEditorShortcut('mouse8'), 'Mouse8');
	for (const binding of ['Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Ctrl+Mouse3', 'Mouse9007199254740992']) {
		assert.throws(() => normalizeAudioEditorShortcut(binding), /mouse/iu, binding);
	}
});

test('mouse bindings persist and participate in shortcut conflicts', () => {
	const shortcuts = { 'new-mono-track': ['Mouse4', 'Ctrl+Mouse5'] };
	assert.deepEqual(loadAudioEditorPreferencesV1(createAudioEditorPreferencesV1({ shortcuts })).preferences.shortcuts, shortcuts);
	assert.deepEqual(findAudioEditorShortcutConflicts({
		'new-mono-track': ['Mouse4'], 'new-label-track': ['mouse04'],
	}), [{ binding: 'Mouse4', actionIds: ['new-mono-track', 'new-label-track'] }]);
});

test('mouse shortcuts dispatch once on mousedown and suppress matching pointer and release events', () => {
	let calls = 0;
	const snapshot = { preferences: { shortcuts: { 'new-mono-track': ['Mouse4'] } } };
	const registry = { menus: [{ id: 'new-mono-track', onClick: () => { calls += 1; } }] };
	const gesture = createMouseShortcutGesture();
	const pointer = mouseEvent();
	blockWorkspaceMouseShortcutPointer(pointer, snapshot, registry);
	assert.deepEqual([pointer.prevented, pointer.stopped, calls], [0, 1, 0]);
	const down = mouseEvent();
	handleWorkspaceMouseDown(down, snapshot, (handler) => handler(), registry, (button) => gesture.claim(button));
	assert.deepEqual([down.prevented, down.stopped, calls], [1, 1, 1]);
	for (const release of [mouseEvent(), mouseEvent()]) {
		gesture.release(release);
		assert.deepEqual([release.prevented, release.stopped, calls], [1, 1, 1]);
	}
});

test('unassigned and standard mouse buttons retain their native behavior', () => {
	const snapshot = { preferences: { shortcuts: { 'new-mono-track': ['Ctrl+Mouse4'] } } };
	let calls = 0;
	const registry = { menus: [{ id: 'new-mono-track', onClick: () => { calls += 1; } }] };
	for (const button of [0, 1, 2, 3, 4]) {
		const event = mouseEvent(button);
		blockWorkspaceMouseShortcutPointer(event, snapshot, registry);
		handleWorkspaceMouseDown(event, snapshot, (handler) => handler(), registry);
		assert.deepEqual([event.prevented, event.stopped, calls], [0, 0, 0]);
	}
	const event = mouseEvent(3, { ctrlKey: true });
	handleWorkspaceMouseDown(event, snapshot, (handler) => handler(), registry);
	assert.equal(calls, 1);
});

test('mouse dispatch reads modifier properties from native event prototypes', () => {
	const event = mouseEvent();
	for (const key of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) Reflect.deleteProperty(event, key);
	Object.setPrototypeOf(event, { altKey: false, ctrlKey: true, metaKey: false, shiftKey: false });
	let calls = 0;
	handleWorkspaceMouseDown(event,
		{ preferences: { shortcuts: { 'new-mono-track': ['Ctrl+Mouse4'] } } },
		(handler) => handler(),
		{ menus: [{ id: 'new-mono-track', onClick: () => { calls += 1; } }] });
	assert.deepEqual([calls, event.prevented, event.stopped], [1, 1, 1]);
});

test('disabled commands consume their mouse binding without running', () => {
	let calls = 0;
	const event = mouseEvent(4);
	handleWorkspaceMouseDown(event,
		{ preferences: { shortcuts: { 'repeat-last-effect': ['Mouse5'] } } },
		(handler) => handler(), {
			actionContext: { predicates: { 'repeatable-effect-and-editable-selection': false } },
			menus: [{ id: 'repeat-last-effect', onClick: () => { calls += 1; } }],
		});
	assert.deepEqual([calls, event.prevented, event.stopped], [0, 1, 1]);
});

test('modal and already-consumed mouse presses do not execute workspace commands', () => {
	let calls = 0;
	const snapshot = { preferences: { shortcuts: { 'new-mono-track': ['Mouse4'] } } };
	const registry = { menus: [{ id: 'new-mono-track', onClick: () => { calls += 1; } }] };
	const target = { closest: () => ({}) } as unknown as EventTarget;
	for (const event of [mouseEvent(3, { target }), mouseEvent(3, { defaultPrevented: true })]) {
		blockWorkspaceMouseShortcutPointer(event, snapshot, registry);
		handleWorkspaceMouseDown(event, snapshot, (handler) => handler(), registry);
		assert.deepEqual([calls, event.prevented, event.stopped], [0, 0, 0]);
	}
	const gesture = createMouseShortcutGesture();
	handleWorkspaceMouseDown(mouseEvent(), snapshot, (handler) => handler(), registry, (button) => gesture.claim(button));
	const release = mouseEvent(3, { target });
	gesture.release(release);
	assert.equal(release.prevented, 1, 'release still cancels navigation when the command opens a modal');
});

test('unknown action bindings do not claim a mouse event', () => {
	const event = mouseEvent();
	const snapshot = { preferences: { shortcuts: { unknown: ['Mouse4'] } } };
	blockWorkspaceMouseShortcutPointer(event, snapshot);
	handleWorkspaceMouseDown(event, snapshot, (handler) => handler());
	assert.deepEqual([event.prevented, event.stopped], [0, 0]);
});
