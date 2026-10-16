/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { retainAudioEditorDialogEscapeOwner } from '../src/common/editor/ui/dialog-escape-ownership.ts';

test('dialog dismissal releases composing Escape and retains its ordinary owner afterward', () => {
	const document = new EventTarget() as unknown as Document;
	const dismissed: string[] = [];
	const releaseBottom = retainAudioEditorDialogEscapeOwner(document, () => { dismissed.push('bottom'); });
	const releaseTop = retainAudioEditorDialogEscapeOwner(document, () => { dismissed.push('top'); });
	try {
		const composing = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape', isComposing: true });
		document.dispatchEvent(composing);
		assert.deepEqual(dismissed, [], 'the input method cancels its own composition without dismissing a dialog');
		assert.equal(composing.defaultPrevented, false);
		const ordinary = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape', isComposing: false });
		document.dispatchEvent(ordinary);
		assert.deepEqual(dismissed, ['top']);
		assert.equal(ordinary.defaultPrevented, true);
		releaseTop();
		document.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
		assert.deepEqual(dismissed, ['top', 'bottom']);
	} finally {
		releaseTop();
		releaseBottom();
	}
});
