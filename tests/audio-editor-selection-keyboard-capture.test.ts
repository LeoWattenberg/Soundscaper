/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { handleClipSelectionKeyboardCapture } from '../src/common/editor/ui/timeline/selection-keyboard-capture.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('clip focus routes selection chords through installed shortcuts before legacy clip trimming', () => {
	const dom = installReactTestDom();
	try {
		const clip = document.createElement('div');
		clip.setAttribute('data-clip-id', 'clip');
		clip.setAttribute('role', 'group');
		dom.container.setAttribute('data-product', 'soundscaper');
		dom.container.appendChild(clip as never);
		const calls: string[] = [];
		for (const [actionId, key, ctrlKey, metaKey] of [
			['track-view-item-extend-left', 'ArrowLeft', false, false],
			['track-view-item-extend-right', 'ArrowRight', false, false],
			['track-view-item-reduce-left', 'ArrowLeft', true, false],
			['track-view-item-reduce-right', 'ArrowRight', false, true],
		] as const) {
			const event = keyboardEvent(clip, key, { ctrlKey, metaKey });
			handleClipSelectionKeyboardCapture(event, {
				preferences: { shortcuts: { [actionId]: [`${ctrlKey || metaKey ? 'Ctrl+' : ''}Shift+${key.slice(5)}`] } },
			}, (handler) => handler(), { menus: [{ id: actionId, onClick: () => { calls.push(actionId); } }] });
			assert.equal(event.defaultPrevented, true);
			assert.equal(event.stopped, true);
		}
		assert.deepEqual(calls, [
			'track-view-item-extend-left', 'track-view-item-extend-right',
			'track-view-item-reduce-left', 'track-view-item-reduce-right',
		]);
	} finally { dom.restore(); }
});

test('clip capture respects custom bindings and shields removed selection chords from clip edits', () => {
	const dom = installReactTestDom();
	try {
		const clip = document.createElement('div');
		clip.setAttribute('data-clip-id', 'clip');
		clip.setAttribute('role', 'group');
		dom.container.setAttribute('data-product', 'soundscaper');
		dom.container.appendChild(clip as never);
		let customCalls = 0;
		const event = keyboardEvent(clip, 'ArrowLeft');
		handleClipSelectionKeyboardCapture(event, {
			preferences: { shortcuts: { 'custom-action': ['Shift+Left'] } },
		}, (handler) => handler(), { menus: [{ id: 'custom-action', onClick: () => { customCalls += 1; } }] });
		assert.equal(customCalls, 1);
		assert.equal(event.stopped, true);
		const removed = keyboardEvent(clip, 'ArrowRight');
		handleClipSelectionKeyboardCapture(removed, { preferences: { shortcuts: {} } }, (handler) => handler());
		assert.equal(removed.defaultPrevented, true);
		assert.equal(removed.stopped, true);
	} finally { dom.restore(); }
});

test('capture leaves playhead controls, track navigation, clip movement and Alt stretching with their owners', () => {
	const dom = installReactTestDom();
	try {
		const clip = document.createElement('div');
		clip.setAttribute('data-clip-id', 'clip');
		clip.setAttribute('role', 'group');
		dom.container.setAttribute('data-product', 'soundscaper');
		dom.container.appendChild(clip as never);
		const playhead = document.createElement('div');
		playhead.setAttribute('role', 'slider');
		for (const event of [
			keyboardEvent(playhead, 'ArrowLeft'),
			keyboardEvent(clip, 'ArrowUp'),
			keyboardEvent(clip, 'ArrowLeft', { shiftKey: false, ctrlKey: true }),
			keyboardEvent(clip, 'ArrowRight', { altKey: true }),
		]) {
			handleClipSelectionKeyboardCapture(event, {}, (handler) => handler());
			assert.equal(event.defaultPrevented, false);
			assert.equal(event.stopped, false);
		}
	} finally { dom.restore(); }
});

test('Framescaper clip focus retains its existing trim chords', () => {
	const dom = installReactTestDom();
	try {
		const clip = document.createElement('div');
		clip.setAttribute('data-clip-id', 'clip');
		clip.setAttribute('role', 'group');
		dom.container.setAttribute('data-product', 'framescaper');
		dom.container.appendChild(clip as never);
		let selections = 0;
		const event = keyboardEvent(clip, 'ArrowLeft');
		handleClipSelectionKeyboardCapture(event, {
			preferences: { shortcuts: { 'track-view-item-extend-left': ['Shift+Left'] } },
		}, (handler) => handler(), { menus: [{ id: 'track-view-item-extend-left', onClick: () => { selections += 1; } }] });
		assert.equal(selections, 0);
		assert.equal(event.defaultPrevented, false);
		assert.equal(event.stopped, false);
	} finally { dom.restore(); }
});

function keyboardEvent(target: Element, key: string, overrides: Readonly<Record<string, boolean>> = {}) {
	return {
		altKey: false, code: key, ctrlKey: false, defaultPrevented: false, key, metaKey: false,
		repeat: false, shiftKey: true, target, stopped: false, ...overrides,
		preventDefault() { this.defaultPrevented = true; },
		stopPropagation() { this.stopped = true; },
	};
}
