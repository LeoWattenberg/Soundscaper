/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { focusAdjacentVideoClip } from '../src/common/editor/ui/timeline/video-clip-focus.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('picture clip traversal visits neighbors in both directions and leaves track boundaries to its owner', () => {
	const dom = installReactTestDom();
	try {
		const clips = ['first', 'middle', 'last'].map(id => {
			const element = dom.container.ownerDocument.createElement('div');
			element.setAttribute('role', 'group');
			element.setAttribute('data-clip-id', id);
			element.setAttribute('tabindex', '-1');
			dom.container.appendChild(element);
			return element;
		});
		const root = dom.container as unknown as ParentNode;
		for (const [id, direction, expected] of [
			['first', 1, clips[1]], ['middle', 1, clips[2]],
			['last', -1, clips[1]], ['middle', -1, clips[0]],
		] as const) {
			assert.equal(focusAdjacentVideoClip(root, id, direction), true);
			assert.equal(dom.container.ownerDocument.activeElement, expected);
		}
		assert.equal(focusAdjacentVideoClip(root, 'first', -1), false);
		assert.equal(focusAdjacentVideoClip(root, 'last', 1), false);
		assert.equal(focusAdjacentVideoClip(root, 'removed', 1), false);
		assert.equal(focusAdjacentVideoClip(null, 'first', 1), false);
	} finally { dom.restore(); }
});

test('backward traversal reaches the preceding video clip fade controls before its group', () => {
	const dom = installReactTestDom();
	try {
		const document = dom.container.ownerDocument;
		const clips = ['video', 'image'].map(id => {
			const element = document.createElement('div');
			element.setAttribute('role', 'group');
			element.setAttribute('data-clip-id', id);
			element.setAttribute('tabindex', '-1');
			dom.container.appendChild(element);
			return element;
		});
		const fade = document.createElement('button');
		fade.setAttribute('data-video-clip-fade-handle', 'in');
		clips[0]!.appendChild(fade);
		const disabled = document.createElement('button');
		disabled.setAttribute('data-video-clip-fade-handle', 'out');
		disabled.setAttribute('disabled', '');
		disabled.disabled = true;
		clips[0]!.appendChild(disabled);
		const root = dom.container as unknown as ParentNode;
		assert.equal(focusAdjacentVideoClip(root, 'image', -1), true);
		assert.equal(document.activeElement, fade);
		assert.equal(focusAdjacentVideoClip(root, 'video', 1), true);
		assert.equal(document.activeElement, clips[1]);
	} finally { dom.restore(); }
});
