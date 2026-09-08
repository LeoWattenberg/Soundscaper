/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { handleWorkspaceKeyboard } from '../src/common/editor/ui/workspace-shortcuts.ts';

test('workspace dispatch normalizes the shifted-minus zoom-out alias', () => {
	let calls = 0;
	let prevented = 0;
	handleWorkspaceKeyboard({
		altKey: false, code: 'Minus', ctrlKey: true, defaultPrevented: false,
		key: '_', metaKey: false, repeat: false, shiftKey: true, target: null,
		preventDefault: () => { prevented += 1; },
	}, { preferences: { shortcuts: { 'zoom-out': ['Ctrl+-'] } } }, (handler) => handler(), {
		menus: [{ id: 'zoom-out', onClick: () => { calls += 1; } }],
	});

	assert.deepEqual({ calls, prevented }, { calls: 1, prevented: 1 });
});
