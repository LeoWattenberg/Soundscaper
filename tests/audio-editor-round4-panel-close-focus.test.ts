/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { closeWorkspacePanelAndRestoreFocus } from '../src/common/editor/ui/workspace/workspace-panel-focus.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('closing an active workspace tab follows its surviving sibling after publication', () => {
	const dom = installReactTestDom();
	try {
		const group = dom.container.ownerDocument.createElement('section');
		group.setAttribute('data-workspace-panel-members', 'history markers');
		const removed = dom.container.ownerDocument.createElement('button');
		const surviving = dom.container.ownerDocument.createElement('button');
		group.appendChild(removed);
		dom.container.appendChild(group);
		removed.focus();
		const frames: Array<() => void> = [];
		Object.defineProperty(globalThis, 'requestAnimationFrame', {
			configurable: true, value: (callback: () => void) => { frames.push(callback); return frames.length; },
		});
		let closed = false;
		let replacementMounted = false;
		const ownerDocument = { querySelector: (selector: string) => {
			if (selector === '[data-workspace-panel="markers"]') return closed ? null : group;
			if (selector === '[data-workspace-panel-menu="history"] button') return replacementMounted ? surviving : null;
			return null;
		} };
		closeWorkspacePanelAndRestoreFocus(ownerDocument, 'markers', () => { closed = true; });
		assert.equal(closed, true);
		assert.equal(frames.length, 1, 'the close owns one deferred focus handoff');
		frames.shift()?.();
		assert.equal(frames.length, 1, 'wait for the surviving panel to mount');
		group.removeChild(removed);
		group.appendChild(surviving);
		replacementMounted = true;
		frames.shift()?.();
		assert.equal(dom.container.ownerDocument.activeElement, surviving);
	} finally {
		dom.restore();
	}
});

test('closing the last tab does not invent a sibling or take unrelated focus', () => {
	const dom = installReactTestDom();
	try {
		const group = dom.container.ownerDocument.createElement('section');
		group.setAttribute('data-workspace-panel-members', 'history');
		const unrelated = dom.container.ownerDocument.createElement('input');
		dom.container.appendChild(unrelated);
		unrelated.focus();
		let frames = 0;
		Object.defineProperty(globalThis, 'requestAnimationFrame', {
			configurable: true, value: () => { frames += 1; return frames; },
		});
		const closed: string[] = [];
		closeWorkspacePanelAndRestoreFocus({ querySelector: () => group }, 'history', (id: string) => { closed.push(id); });
		assert.deepEqual(closed, ['history']);
		assert.equal(frames, 0);
		assert.equal(dom.container.ownerDocument.activeElement, unrelated);
	} finally {
		dom.restore();
	}
});

test('closing a middle tab follows the next surviving member rather than an inactive first tab', () => {
	const dom = installReactTestDom();
	try {
		const group = dom.container.ownerDocument.createElement('section');
		group.setAttribute('data-workspace-panel-members', 'history markers metadata');
		const surviving = dom.container.ownerDocument.createElement('button');
		Object.defineProperty(globalThis, 'requestAnimationFrame', {
			configurable: true, value: (callback: () => void) => { callback(); return 1; },
		});
		let closed = false;
		closeWorkspacePanelAndRestoreFocus({ querySelector: (selector: string) => {
			if (selector === '[data-workspace-panel="markers"]') return group;
			if (selector === '[data-workspace-panel-menu="metadata"] button' && closed) return surviving;
			return null;
		} }, 'markers', () => { closed = true; });
		assert.equal(dom.container.ownerDocument.activeElement, surviving);
	} finally {
		dom.restore();
	}
});
