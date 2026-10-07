/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import AudioEditorButtonTooltips from '../src/common/editor/ui/AudioEditorButtonTooltips.jsx';
import { retainAudioEditorDialogEscapeOwner } from '../src/common/editor/ui/dialog-escape-ownership.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: typeof React }).React = React;

test('a hovered button tooltip owns dismissal without moving focus or closing its underlying dialog', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const rootEvents = new EventTarget();
	const documentEvents = new EventTarget();
	const editor = dom.container as unknown as HTMLElement;
	editor.addEventListener = rootEvents.addEventListener.bind(rootEvents);
	editor.removeEventListener = rootEvents.removeEventListener.bind(rootEvents);
	document.addEventListener = documentEvents.addEventListener.bind(documentEvents);
	document.removeEventListener = documentEvents.removeEventListener.bind(documentEvents);
	let closed = 0;
	const releaseModal = retainAudioEditorDialogEscapeOwner(document, () => { closed += 1; });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(editor);
	try {
		await act(async () => { root.render(<><button aria-label="Fade out">Fade out</button>
			<AudioEditorButtonTooltips rootRef={{ current: editor }} /></>); });
		const trigger = dom.one('button');
		trigger.getBoundingClientRect = () => ({ left: 100, right: 124, top: 100, bottom: 124, width: 24, height: 24 });
		Object.assign(trigger, { cloneNode: () => ({ querySelectorAll: () => [], textContent: 'Fade out' }) });
		trigger.focus();
		const pointer = (type: string, point: Readonly<{ clientX: number; clientY: number }> = { clientX: 500, clientY: 500 }) => {
			const event = new Event(type);
			Object.defineProperty(event, 'target', { value: trigger });
			Object.defineProperty(event, 'relatedTarget', { value: editor });
			Object.assign(event, point);
			rootEvents.dispatchEvent(event);
		};
		await act(async () => { pointer('pointerover'); });
		const tooltip = dom.one('[role="tooltip"]');
		tooltip.getBoundingClientRect = () => ({ left: 80, right: 140, top: 132, bottom: 160, width: 60, height: 28 });
		await act(async () => { pointer('pointerout', { clientX: 112, clientY: 125 }); });
		assert.equal(dom.find('[role="tooltip"]'), tooltip, 'the path from the button into its label remains readable');
		await act(async () => { documentEvents.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 112, clientY: 145 })); });
		assert.equal(dom.find('[role="tooltip"]'), tooltip);
		const firstEscape = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
		await act(async () => { documentEvents.dispatchEvent(firstEscape); });
		assert.equal(dom.find('[role="tooltip"]'), null);
		assert.equal(firstEscape.defaultPrevented, true);
		assert.equal(closed, 0);
		assert.equal(document.activeElement, trigger);
		await act(async () => { pointer('pointerover'); });
		assert.equal(dom.find('[role="tooltip"]'), null, 'an already-hovered trigger does not undo explicit dismissal');
		await act(async () => { pointer('pointerout'); pointer('pointerover'); });
		assert.ok(dom.find('[role="tooltip"]'), 'a new hover can show the label again');
		await act(async () => { pointer('pointerout'); });
		await act(async () => { documentEvents.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' })); });
		assert.equal(closed, 1, 'idle Escape is again owned by the dialog');
	} finally {
		await act(async () => { root.unmount(); });
		releaseModal();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
