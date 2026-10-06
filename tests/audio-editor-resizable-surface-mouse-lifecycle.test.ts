/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { retainAudioEditorDialogEscapeOwner } from '../src/common/editor/ui/dialog-escape-ownership.ts';
import { retainResizableSurfaceMouseLifecycle } from '../src/common/editor/ui/resizable-surface-mouse-lifecycle.ts';

test('the live resize owns Escape before its modal and later release cannot finish the canceled preview', () => {
	const document = new EventTarget() as unknown as Document;
	let dismissed = 0;
	let active = true;
	let width = 900;
	let commits = 0;
	const releaseModal = retainAudioEditorDialogEscapeOwner(document, () => { dismissed += 1; });
	const releaseResize = retainResizableSurfaceMouseLifecycle(document, {
		move: () => { if (active) width = 840; },
		finish: () => { if (active) { active = false; commits += 1; } },
		cancel: () => { if (active) { active = false; width = 900; } },
	});
	document.dispatchEvent(new Event('mousemove'));
	assert.equal(width, 840);
	document.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
	assert.equal(width, 900);
	assert.equal(dismissed, 0);
	document.dispatchEvent(new Event('mouseup'));
	assert.equal(commits, 0);
	releaseResize();
	document.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
	assert.equal(dismissed, 1);
	releaseModal();
});

test('resize teardown cancels its active preview and releases move listeners', () => {
	const document = new EventTarget() as unknown as Document;
	let moved = 0;
	let canceled = 0;
	const release = retainResizableSurfaceMouseLifecycle(document, {
		move: () => { moved += 1; }, finish: () => undefined,
		cancel: () => { canceled += 1; },
	});
	release();
	document.dispatchEvent(new Event('mousemove'));
	assert.equal(moved, 0);
	assert.equal(canceled, 1);
});
