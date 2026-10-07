/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { playheadKeyboardSeekFrame } from '../src/common/editor/ui/timeline/playhead-keyboard-seek.ts';
import { handleWorkspaceKeyboard } from '../src/common/editor/ui/workspace-shortcuts.ts';

test('the playhead leaves modified seek keys to existing contextual workspace commands', () => {
	for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
		for (const key of ['Home', 'End', 'ArrowLeft', 'ArrowRight']) {
			assert.equal(playheadKeyboardSeekFrame({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...modifiers },
				4800, 48_000, 38_400), null);
		}
	}
	const selected: string[] = [];
	for (const [key, action, track] of [['Home', 'track-view-first-track', 'first'], ['End', 'track-view-last-track', 'last']] as const) {
		const event = { key, code: key, target: null, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false,
			defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
		assert.equal(playheadKeyboardSeekFrame(event, 4800, 48_000, 38_400), null);
		handleWorkspaceKeyboard(event, { preferences: { shortcuts: { [action]: [`Ctrl+${key}`] } } }, handler => handler(), {
			menus: [{ id: action, onClick: () => { selected.push(track); } }],
		});
		assert.equal(event.defaultPrevented, true);
	}
	assert.deepEqual(selected, ['first', 'last']);
});

test('plain endpoints, single-sample arrows and Shift fine seeking retain the slider contract', () => {
	const key = { key: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
	assert.equal(playheadKeyboardSeekFrame({ ...key, key: 'Home' }, 4800, 48_000, 38_400), 0);
	assert.equal(playheadKeyboardSeekFrame({ ...key, key: 'End' }, 4800, 48_000, 38_400), 38_400);
	assert.equal(playheadKeyboardSeekFrame({ ...key, key: 'ArrowLeft' }, 4800, 48_000, 38_400), 4799);
	assert.equal(playheadKeyboardSeekFrame({ ...key, key: 'ArrowRight' }, 4800, 48_000, 38_400), 4801);
	assert.equal(playheadKeyboardSeekFrame({ ...key, key: 'ArrowRight', shiftKey: true }, 4800, 48_000, 38_400), 9600);
	assert.equal(playheadKeyboardSeekFrame({ ...key, key: 'Home', shiftKey: true }, 4800, 48_000, 38_400), 0);
	assert.equal(playheadKeyboardSeekFrame({ ...key, key: 'Tab' }, 4800, 48_000, 38_400), null);
});
