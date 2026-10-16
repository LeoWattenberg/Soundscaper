/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { handleWorkspaceKeyboard } from '../src/common/editor/ui/workspace-shortcuts.ts';
import { installReactTestDom, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const role of ['dialog', 'alertdialog']) test(`a body dropdown retains its ${role} shortcut owner`, () => {
	const dom = installReactTestDom();
	const document = dom.container.ownerDocument;
	Object.defineProperty(document, 'querySelectorAll', { value: (selector: string) => {
		assert.equal(selector, '[aria-haspopup="listbox"][aria-controls]');
		return document.body.querySelectorAll('[aria-controls]').filter(trigger => trigger.getAttribute('aria-haspopup') === 'listbox');
	} });
	const owner = document.createElement('section');
	owner.setAttribute('role', role);
	owner.setAttribute('aria-modal', 'false');
	const trigger = document.createElement('button');
	trigger.setAttribute('aria-haspopup', 'listbox');
	trigger.setAttribute('aria-controls', 'effect-choice');
	owner.appendChild(trigger);
	dom.container.appendChild(owner);
	const portal = document.createElement('div');
	portal.setAttribute('id', 'effect-choice');
	portal.setAttribute('role', 'listbox');
	const option = document.createElement('div');
	option.setAttribute('role', 'option');
	portal.appendChild(option);
	document.body.appendChild(portal);
	const outside = document.createElement('button');
	dom.container.appendChild(outside);
	let mutations = 0;
	const dispatch = (target: ReactTestElement) => {
		handleWorkspaceKeyboard({ key: 'b', code: 'KeyB', ctrlKey: true, metaKey: false,
			altKey: false, shiftKey: false, defaultPrevented: false, target: target as unknown as Element,
			preventDefault: () => undefined }, { preferences: { shortcuts: { 'new-label-track': ['Ctrl+b'] } } },
			command => command(), { menus: [{ id: 'new-label-track', onClick: () => { mutations++; } }] });
	};
	try {
		dispatch(trigger);
		assert.equal(mutations, 0, 'the ordinary trigger already suspends project shortcuts');
		dispatch(outside);
		assert.equal(mutations, 1, 'a nonmodal effect leaves the surrounding workspace usable');
		dispatch(option);
		assert.equal(mutations, 1, 'the actual portaled option shares its controlling dialog');
		dispatch(portal);
		assert.equal(mutations, 1, 'focus on the actual native listbox shares the same owner');
		trigger.setAttribute('aria-controls', 'other-choice');
		dispatch(portal);
		assert.equal(mutations, 2, 'an unrelated dialog does not suspend another native popup');
		outside.setAttribute('aria-haspopup', 'listbox');
		outside.setAttribute('aria-controls', 'effect-choice');
		dispatch(option);
		assert.equal(mutations, 3, 'ordinary workspace dropdowns retain their shortcut admission');
	} finally {
		dom.restore();
	}
});
