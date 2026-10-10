/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { retainAudioEditorDialogEscapeOwner } from '../src/common/editor/ui/dialog-escape-ownership.ts';
import { retainDialogMoveLifecycle } from '../src/common/editor/ui/dialog-move-lifecycle.ts';

test('Escape restores a moving dialog before its idle dismissal and ignores later mouse release', () => {
	const document = new EventTarget() as unknown as Document;
	const window = new EventTarget() as unknown as Window;
	let offset = 0;
	let dismissed = 0;
	let finished = 0;
	const releaseModal = retainAudioEditorDialogEscapeOwner(document, () => { dismissed += 1; });
	const releaseMove = retainDialogMoveLifecycle(document, window, {
		move: () => { offset = 50; },
		finish: () => { finished += 1; },
		cancel: () => { offset = 0; },
	});
	window.dispatchEvent(new Event('mousemove'));
	assert.equal(offset, 50);
	document.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
	assert.equal(offset, 0);
	assert.equal(dismissed, 0);
	window.dispatchEvent(new Event('mousemove'));
	window.dispatchEvent(Object.assign(new Event('mouseup'), { button: 0, buttons: 0 }));
	assert.equal(offset, 0);
	assert.equal(finished, 0);
	document.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
	assert.equal(dismissed, 1);
	releaseMove();
	releaseModal();
});

test('normal move completion releases ownership and teardown leaves no active listeners', () => {
	const document = new EventTarget() as unknown as Document;
	const window = new EventTarget() as unknown as Window;
	let moved = 0;
	let finished = 0;
	let canceled = 0;
	const release = retainDialogMoveLifecycle(document, window, {
		move: () => { moved += 1; }, finish: () => { finished += 1; },
		cancel: () => { canceled += 1; },
	});
	window.dispatchEvent(Object.assign(new Event('mouseup'), { button: 0, buttons: 0 }));
	window.dispatchEvent(new Event('mousemove'));
	document.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
	assert.equal(finished, 1);
	assert.equal(moved, 0);
	assert.equal(canceled, 0);
	release();
	const releasePending = retainDialogMoveLifecycle(document, window, {
		move: () => { moved += 1; }, finish: () => { finished += 1; },
		cancel: () => { canceled += 1; },
	});
	releasePending();
	window.dispatchEvent(Object.assign(new Event('mouseup'), { button: 0, buttons: 0 }));
	assert.equal(finished, 1);
});

for (const button of [1, 2]) test(`an active title move survives native button ${button} release while primary remains held`, () => {
	const document = new EventTarget() as unknown as Document;
	const window = new EventTarget() as unknown as Window;
	let offset = 0;
	let completed = 0;
	const release = retainDialogMoveLifecycle(document, window, {
		move: () => { offset += 24; }, finish: () => { completed += 1; }, cancel: () => { offset = 0; },
	});
	window.dispatchEvent(new Event('mousemove'));
	window.dispatchEvent(Object.assign(new Event('mouseup'), { button, buttons: 1 }));
	assert.equal(completed, 0, 'only the owning primary release completes the title move');
	window.dispatchEvent(new Event('mousemove'));
	assert.equal(offset, 48, 'continued primary movement remains admitted');
	window.dispatchEvent(Object.assign(new Event('mouseup'), { button: 0, buttons: 0 }));
	assert.equal(completed, 1);
	window.dispatchEvent(new Event('mousemove'));
	assert.equal(offset, 48);
	release();
});
