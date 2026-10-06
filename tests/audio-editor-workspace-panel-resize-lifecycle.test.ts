/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { retainWorkspacePanelResizeLifecycle } from '../src/common/editor/ui/workspace/workspace-panel-resize-lifecycle.ts';

test('Escape cancels an active panel resize and release cannot commit it', () => {
	const target = new EventTarget();
	let active = true;
	let size = 360;
	let commits = 0;
	const dispose = retainWorkspacePanelResizeLifecycle(target as unknown as Window, {
		active: () => active,
		resize: () => { if (active) size = 310; },
		finish: () => { if (active) { active = false; commits += 1; } },
		cancel: () => { if (active) { active = false; size = 360; } },
	});
	target.dispatchEvent(new Event('pointermove'));
	assert.equal(size, 310);
	const escape = new Event('keydown', { cancelable: true });
	Object.defineProperty(escape, 'key', { value: 'Escape' });
	target.dispatchEvent(escape);
	assert.equal(escape.defaultPrevented, true);
	assert.equal(size, 360);
	target.dispatchEvent(new Event('pointerup'));
	target.dispatchEvent(new Event('mouseup'));
	assert.equal(commits, 0);
	dispose();
});

test('resize ownership does not consume idle Escape and disposes an active preview', () => {
	const target = new EventTarget();
	let active = false;
	let canceled = 0;
	const dispose = retainWorkspacePanelResizeLifecycle(target as unknown as Window, {
		active: () => active, resize: () => undefined, finish: () => undefined,
		cancel: () => { if (active) { active = false; canceled += 1; } },
	});
	const escape = new Event('keydown', { cancelable: true });
	Object.defineProperty(escape, 'key', { value: 'Escape' });
	target.dispatchEvent(escape);
	assert.equal(escape.defaultPrevented, false);
	active = true;
	dispose();
	assert.equal(canceled, 1);
	active = true;
	target.dispatchEvent(escape);
	assert.equal(canceled, 1);
	assert.equal(escape.defaultPrevented, false);
});
