/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { handleWorkspaceKeyboard } from '../src/common/editor/ui/workspace-shortcuts.ts';

test('a configured but context-disabled Audacity chord cannot fall through to the browser', () => {
	let calls = 0;
	let prevented = 0;
	const event = {
		altKey: false,
		code: 'KeyR',
		ctrlKey: true,
		defaultPrevented: false,
		key: 'r',
		metaKey: false,
		repeat: false,
		shiftKey: false,
		target: null,
		preventDefault: () => { prevented += 1; },
	};
	const registry = {
		actionContext: { predicates: { 'repeatable-effect-and-editable-selection': false } },
		menus: [{ id: 'repeat-last-effect', onClick: () => { calls += 1; } }],
	};

	handleWorkspaceKeyboard(
		event,
		{ preferences: { shortcuts: { 'repeat-last-effect': ['Ctrl+R'] } } },
		(handler) => handler(),
		registry,
	);
	assert.equal(calls, 0);
	assert.equal(prevented, 1, 'Ctrl+R must not reload while Repeat Last Effect is unavailable');

	prevented = 0;
	handleWorkspaceKeyboard(event, { preferences: { shortcuts: {} } }, (handler) => handler(), registry);
	assert.equal(prevented, 0, 'an explicitly removed shortcut remains unclaimed');
});
