/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { closeWorkspacePanelAndRestoreFocus } from '../src/common/editor/ui/workspace/workspace-panel-focus.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('closing the focused singleton History panel returns keyboard use to the surviving playhead', () => {
	const dom = installReactTestDom();
	const frames: Array<() => void> = [];
	Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true,
		value: (callback: () => void) => { frames.push(callback); return frames.length; } });
	try {
		const document = dom.container.ownerDocument;
		const panel = document.createElement('section');
		panel.setAttribute('data-workspace-panel-members', 'history');
		const trigger = document.createElement('button');
		panel.appendChild(trigger);
		dom.container.appendChild(panel);
		const playhead = document.createElement('div');
		playhead.setAttribute('tabindex', '0');
		dom.container.appendChild(playhead);
		const owner = {
			get activeElement() { return document.activeElement; },
			querySelector(selector: string) {
				return selector === '[data-workspace-panel="history"]' ? panel
					: selector === '[data-editor-tool-toolbar] [data-time-display] .timecode' ? playhead : null;
			},
		};
		trigger.focus();
		closeWorkspacePanelAndRestoreFocus(owner, 'history', () => {
			dom.container.removeChild(panel);
			document.body.focus();
		});
		for (const frame of frames.splice(0)) frame();
		assert.equal(document.activeElement, playhead, 'keyboard focus follows the surviving editor control');
		assert.equal(frames.length, 0, 'focus completes without lingering retries');
	} finally { dom.restore(); }
});

test('closing an unfocused singleton panel preserves the user current control', () => {
	const dom = installReactTestDom();
	try {
		const document = dom.container.ownerDocument;
		const panel = document.createElement('section');
		const current = document.createElement('input');
		dom.container.appendChild(panel);
		dom.container.appendChild(current);
		current.focus();
		closeWorkspacePanelAndRestoreFocus({ activeElement: current, querySelector: () => panel }, 'history', () => {
			dom.container.removeChild(panel);
		});
		assert.equal(document.activeElement, current);
	} finally { dom.restore(); }
});
