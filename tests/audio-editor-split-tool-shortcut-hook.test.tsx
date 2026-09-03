/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useRef } from 'react';

import { useSplitToolShortcut } from '../src/common/editor/ui/timeline/useSplitToolShortcut.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

type ShortcutEvent = KeyboardEvent & { readonly relatedTarget?: EventTarget | null };
type Listener = EventListenerOrEventListenerObject;

const SPLIT_BINDINGS = Object.freeze(['S']);
const SHIFT_SPLIT_BINDINGS = Object.freeze(['Shift+S']);

test('Split Tool shortcut is root-scoped, works after toolbar focus, and cleans up globally', async () => {
	const dom = installReactTestDom();
	const globalEvents = captureGlobalEvents();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let momentary = false;
	let toggles = 0;
	const togglePersistent = () => { toggles += 1; };

	function Harness({
		bindings = SPLIT_BINDINGS,
		persistentEnabled = false,
		projectId = 'project-a',
	}: Readonly<{ bindings?: readonly string[]; persistentEnabled?: boolean; projectId?: string | null }>) {
		const editorRef = useRef<HTMLDivElement>(null);
		const shortcut = useSplitToolShortcut({
			bindings,
			persistentEnabled,
			projectId,
			onTogglePersistent: togglePersistent,
			rootRef: editorRef,
		});
		momentary = shortcut.momentaryEnabled;
		return <div ref={editorRef} data-editor-root><span data-owned /><button data-control /></div>;
	}

	try {
		await act(async () => root.render(<Harness />));
		const owned = dom.one('[data-owned]');
		const control = dom.one('[data-control]');
		const outside = document.createElement('div');
		document.body.appendChild(outside);

		await dispatchWithAct(globalEvents, 'keydown', keyEvent(outside));
		assert.equal(momentary, false, 'an editor must not own a keydown from another surface');
		await dispatchWithAct(globalEvents, 'keydown', keyEvent(control));
		assert.equal(momentary, true, 'non-editing controls do not strand the tool shortcut after a click');
		await dispatchWithAct(globalEvents, 'focusout', focusEvent(control, outside));
		assert.equal(momentary, false);
		assert.equal(toggles, 0, 'leaving the editor cancels the control-started press');

		const modal = document.createElement('div');
		modal.setAttribute('role', 'alertdialog');
		modal.setAttribute('aria-modal', 'true');
		document.body.appendChild(modal);
		await dispatchWithAct(globalEvents, 'keydown', keyEvent(owned));
		assert.equal(momentary, false, 'an open modal blocks background editor shortcuts');
		document.body.removeChild(modal);

		const cancelledDown = keyEvent(owned);
		await dispatchWithAct(globalEvents, 'keydown', cancelledDown);
		assert.equal(momentary, true);
		assert.equal(cancelledDown.defaultPrevented, true);
		await dispatchWithAct(globalEvents, 'focusout', focusEvent(owned, control));
		await dispatchWithAct(globalEvents, 'focusin', focusEvent(control, owned));
		assert.equal(momentary, true, 'focus movement within the editor preserves Split Tool');
		const internalModal = document.createElement('div');
		internalModal.setAttribute('role', 'alertdialog');
		internalModal.setAttribute('aria-modal', 'true');
		const editorRoot = dom.one('[data-editor-root]') as unknown as Element;
		editorRoot.appendChild(internalModal);
		await dispatchWithAct(globalEvents, 'focusin', focusEvent(internalModal, control));
		assert.equal(momentary, false, 'modal focus deactivates the editor tool context');
		assert.equal(toggles, 0);
		editorRoot.removeChild(internalModal);

		await dispatchWithAct(globalEvents, 'keydown', keyEvent(owned));
		assert.equal(momentary, true);
		await dispatchWithAct(globalEvents, 'focusout', focusEvent(owned, outside));
		assert.equal(momentary, false, 'leaving the editor cancels a momentary press');
		assert.equal(toggles, 0, 'focus loss cancels instead of converting the press into a tap');

		await dispatchWithAct(globalEvents, 'keydown', keyEvent(owned));
		assert.equal(momentary, true);
		const outsideKeyUp = keyEvent(outside);
		await dispatchWithAct(globalEvents, 'keyup', outsideKeyUp);
		assert.equal(momentary, false, 'keyup outside the editor still releases the press');
		assert.equal(outsideKeyUp.defaultPrevented, true);
		assert.equal(toggles, 1, 'a completed quick tap toggles persistent Split Tool once');

		await act(async () => root.render(<Harness persistentEnabled />));
		const persistentModal = document.createElement('div');
		persistentModal.setAttribute('role', 'dialog');
		persistentModal.setAttribute('aria-modal', 'true');
		(dom.one('[data-editor-root]') as unknown as Element).appendChild(persistentModal);
		await dispatchWithAct(globalEvents, 'focusin', focusEvent(persistentModal, owned));
		assert.equal(toggles, 2, 'modal context loss deactivates persistent Split Tool');
		(dom.one('[data-editor-root]') as unknown as Element).removeChild(persistentModal);

		await act(async () => root.render(<Harness bindings={SHIFT_SPLIT_BINDINGS} />));
		await dispatchWithAct(globalEvents, 'keydown', keyEvent(owned, { shiftKey: true }));
		assert.equal(momentary, true);
		await dispatchWithAct(globalEvents, 'keyup', keyEvent(owned, { shiftKey: true }));
		assert.equal(momentary, false);

		await act(async () => root.render(<Harness persistentEnabled />));
		const controlEscape = keyEvent(control, { code: 'Escape', key: 'Escape' });
		await dispatchWithAct(globalEvents, 'keydown', controlEscape);
		assert.equal(toggles, 4, 'Escape from an in-editor control deactivates persistent Split Tool');
		assert.equal(controlEscape.defaultPrevented, false, 'the focused control retains its Escape behavior');
	} finally {
		await act(async () => root.unmount());
		globalEvents.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('Split Tool requires an open project and deactivates persistent and momentary state on close', async () => {
	const dom = installReactTestDom();
	const globalEvents = captureGlobalEvents();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let momentary = false;
	let toggles = 0;
	const onTogglePersistent = () => { toggles += 1; };

	function Harness({
		persistentEnabled,
		projectId,
	}: Readonly<{ persistentEnabled: boolean; projectId: string | null }>) {
		const editorRef = useRef<HTMLDivElement>(null);
		momentary = useSplitToolShortcut({
			bindings: SPLIT_BINDINGS,
			persistentEnabled,
			projectId,
			onTogglePersistent,
			rootRef: editorRef,
		}).momentaryEnabled;
		return <div ref={editorRef}><span data-project-owned /></div>;
	}

	try {
		await act(async () => root.render(<Harness persistentEnabled projectId="project-a" />));
		await act(async () => root.render(<Harness persistentEnabled projectId={null} />));
		assert.equal(toggles, 1, 'closing the project turns persistent Split Tool off');

		await act(async () => root.render(<Harness persistentEnabled={false} projectId={null} />));
		const owned = dom.one('[data-project-owned]');
		const closedDown = keyEvent(owned);
		await dispatchWithAct(globalEvents, 'keydown', closedDown);
		await dispatchWithAct(globalEvents, 'keyup', keyEvent(owned));
		assert.equal(momentary, false, 'a closed editor does not admit the Split shortcut');
		assert.equal(closedDown.defaultPrevented, false, 'a closed editor does not consume the shortcut');
		assert.equal(toggles, 1, 'a closed editor cannot toggle persistent Split Tool');

		await act(async () => root.render(<Harness persistentEnabled={false} projectId="project-b" />));
		await dispatchWithAct(globalEvents, 'keydown', keyEvent(owned));
		assert.equal(momentary, true);
		await act(async () => root.render(<Harness persistentEnabled={false} projectId={null} />));
		assert.equal(momentary, false, 'losing the project cancels a held Split shortcut');
		await dispatchWithAct(globalEvents, 'keyup', keyEvent(owned));
		assert.equal(toggles, 1, 'canceling a momentary press is not a persistent toggle');
	} finally {
		await act(async () => root.unmount());
		globalEvents.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function captureGlobalEvents() {
	const listeners = new Map<string, Set<Listener>>();
	const addDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'addEventListener');
	const removeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'removeEventListener');
	Object.defineProperty(globalThis, 'addEventListener', {
		configurable: true,
		value: (type: string, listener: Listener) => {
			const group = listeners.get(type) ?? new Set<Listener>();
			group.add(listener);
			listeners.set(type, group);
		},
	});
	Object.defineProperty(globalThis, 'removeEventListener', {
		configurable: true,
		value: (type: string, listener: Listener) => { listeners.get(type)?.delete(listener); },
	});
	return {
		dispatch(type: string, event: ShortcutEvent) {
			for (const listener of [...(listeners.get(type) ?? [])]) {
				if (typeof listener === 'function') listener(event);
				else listener.handleEvent(event);
			}
		},
		restore() {
			if (addDescriptor) Object.defineProperty(globalThis, 'addEventListener', addDescriptor);
			else Reflect.deleteProperty(globalThis, 'addEventListener');
			if (removeDescriptor) Object.defineProperty(globalThis, 'removeEventListener', removeDescriptor);
			else Reflect.deleteProperty(globalThis, 'removeEventListener');
		},
	};
}

async function dispatchWithAct(
	events: ReturnType<typeof captureGlobalEvents>,
	type: string,
	event: ShortcutEvent,
): Promise<void> {
	await act(async () => { events.dispatch(type, event); });
}

function keyEvent(
	target: unknown,
	options: Readonly<{ code?: string; key?: string; shiftKey?: boolean }> = {},
): ShortcutEvent {
	let prevented = false;
	return {
		target,
		altKey: false,
		code: options.code ?? 'KeyS',
		ctrlKey: false,
		key: options.key ?? 's',
		metaKey: false,
		repeat: false,
		shiftKey: options.shiftKey ?? false,
		get defaultPrevented() { return prevented; },
		preventDefault: () => { prevented = true; },
		stopPropagation: () => undefined,
	} as unknown as ShortcutEvent;
}

function focusEvent(target: unknown, relatedTarget: unknown): ShortcutEvent {
	return { target, relatedTarget } as unknown as ShortcutEvent;
}
