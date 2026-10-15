/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorkspaceFocusRequest } from '../src/common/editor/controller/composition/workspace-focus-request.ts';
import {
	closeWorkspacePanelAndRestoreFocus,
	FOCUS_ATTEMPTS,
	focusWorkspacePanelMenuButton,
} from '../src/common/editor/ui/workspace/workspace-panel-focus.js';
import { installReactTestDom, type ReactTestElement } from './helpers/react-test-dom.ts';

function focusFixture() {
	const dom = installReactTestDom();
	const document = dom.container.ownerDocument;
	const frames: Array<() => void> = [];
	const targets = new Map<string, ReactTestElement[]>();
	Object.defineProperty(globalThis, 'requestAnimationFrame', {
		configurable: true,
		value: (callback: () => void) => { frames.push(callback); return frames.length; },
	});
	return {
		...dom, document, frames, targets,
		owner: {
			get activeElement() { return document.activeElement; },
			body: document.body,
			documentElement: document.documentElement,
			querySelector: (selector: string) => targets.get(selector)?.[0] ?? null,
			querySelectorAll: (selector: string) => targets.get(selector) ?? [],
		},
		mount(tag = 'button') {
			const element = document.createElement(tag);
			dom.container.appendChild(element);
			return element;
		},
		setMenu(panel: string, elements: ReactTestElement[]) {
			targets.set(`[data-workspace-panel-menu="${panel}"] button`, elements);
		},
	};
}

for (const delayed of [false, true]) {
	test(`closing Project Bin preserves keyboard-help focus ${delayed ? 'while the sibling mounts later' : 'before the first animation frame'}`, () => {
		const fixture = focusFixture();
		try {
			const { document, frames, owner } = fixture;
			const panel = fixture.mount('section');
			panel.setAttribute('data-workspace-panel-members', 'project-bin history');
			fixture.targets.set('[data-workspace-panel="project-bin"]', [panel]);
			const close = document.createElement('button');
			panel.appendChild(close);
			const sibling = fixture.mount();
			const help = fixture.mount('div');
			help.setAttribute('tabindex', '0');
			if (!delayed) fixture.setMenu('history', [sibling]);
			close.focus();
			closeWorkspacePanelAndRestoreFocus(owner, 'project-bin', () => {
				fixture.container.removeChild(panel);
				document.body.focus();
			});
			if (delayed) {
				frames.shift()?.();
				assert.equal(frames.length, 1, 'the replacement has not mounted yet');
			}
			help.focus();
			fixture.setMenu('history', [sibling]);
			frames.shift()?.();
			assert.equal(document.activeElement, help, 'a queued handoff must respect the user’s newer focus choice');
			assert.equal(frames.length, 0, 'a superseded handoff stops polling');
		} finally { fixture.restore(); }
	});
}

test('a newer panel handoff retires an older missing-target retry even after focus returns to the body', () => {
	const fixture = focusFixture();
	try {
		const { document, frames, owner } = fixture;
		document.body.focus();
		focusWorkspacePanelMenuButton(owner, 'history');
		frames.shift()?.();
		const newerTarget = fixture.mount();
		fixture.setMenu('markers', [newerTarget]);
		focusWorkspacePanelMenuButton(owner, 'markers');
		const olderFrame = frames.shift();
		frames.shift()?.();
		assert.equal(document.activeElement, newerTarget);
		document.body.focus();
		fixture.setMenu('history', [fixture.mount()]);
		olderFrame?.();
		assert.equal(document.activeElement, document.body);
		assert.equal(frames.length, 0);
	} finally { fixture.restore(); }
});

test('a replacement still receives focus after the original control unmounts', () => {
	const fixture = focusFixture();
	try {
		const origin = fixture.mount();
		origin.focus();
		focusWorkspacePanelMenuButton(fixture.owner, 'history', origin);
		fixture.frames.shift()?.();
		fixture.container.removeChild(origin);
		fixture.document.body.focus();
		const replacement = fixture.mount();
		fixture.setMenu('history', [replacement]);
		fixture.frames.shift()?.();
		assert.equal(fixture.document.activeElement, replacement);
		assert.equal(fixture.frames.length, 0);
	} finally { fixture.restore(); }
});

test('closing a dock menu may restore its original trigger before the replacement mounts', () => {
	const fixture = focusFixture();
	try {
		const trigger = fixture.mount();
		const menuItem = fixture.mount();
		const replacement = fixture.mount();
		menuItem.focus();
		fixture.setMenu('history', [trigger]);
		focusWorkspacePanelMenuButton(fixture.owner, 'history', trigger);
		trigger.focus();
		fixture.frames.shift()?.();
		assert.equal(fixture.frames.length, 1, 'the old trigger is not the replacement');
		fixture.setMenu('history', [trigger, replacement]);
		fixture.frames.shift()?.();
		assert.equal(fixture.document.activeElement, replacement);
		assert.equal(fixture.frames.length, 0);
	} finally { fixture.restore(); }
});

test('an unrelated focus choice retires missing-target polling permanently', () => {
	const fixture = focusFixture();
	try {
		fixture.document.body.focus();
		focusWorkspacePanelMenuButton(fixture.owner, 'history');
		fixture.mount('input').focus();
		fixture.frames.shift()?.();
		assert.equal(fixture.frames.length, 0);
	} finally { fixture.restore(); }
});

test('a still-owned handoff retains the original bounded mount polling budget', () => {
	const fixture = focusFixture();
	try {
		fixture.document.body.focus();
		focusWorkspacePanelMenuButton(fixture.owner, 'history');
		for (let index = 0; index < FOCUS_ATTEMPTS; index += 1) {
			assert.equal(fixture.frames.length, 1, `frame ${index + 1}`);
			fixture.frames.shift()?.();
		}
		assert.equal(fixture.frames.length, 0);
	} finally { fixture.restore(); }
});

test('focus requests in another document do not retire this document’s handoff', () => {
	const first = { activeElement: null };
	const second = { activeElement: null };
	const firstOwnsFocus = createWorkspaceFocusRequest(first);
	const secondOwnsFocus = createWorkspaceFocusRequest(second);
	assert.equal(firstOwnsFocus(), true);
	assert.equal(secondOwnsFocus(), true);
	createWorkspaceFocusRequest(first);
	assert.equal(firstOwnsFocus(), false);
	assert.equal(secondOwnsFocus(), true);
});

test('a retired focus request cannot revive when its original control regains focus', () => {
	const original = {};
	const owner = { activeElement: original };
	const ownsFocus = createWorkspaceFocusRequest(owner);
	owner.activeElement = {};
	assert.equal(ownsFocus(), false);
	owner.activeElement = original;
	assert.equal(ownsFocus(), false);
});
