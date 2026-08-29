/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { retainAudioEditorDialogEscapeOwner } from '../src/common/editor/ui/dialog-escape-ownership.ts';

test('one Escape dismisses only the newest eligible dialog owner', () => {
	const document = new EventTarget() as unknown as Document;
	const dismissed: string[] = [];
	const releaseBottom = retainAudioEditorDialogEscapeOwner(document, () => dismissed.push('bottom'));
	const releaseTop = retainAudioEditorDialogEscapeOwner(document, () => dismissed.push('top'));

	const firstEscape = escapeKeyEvent();
	document.dispatchEvent(firstEscape);
	assert.deepEqual(dismissed, ['top']);
	assert.equal(firstEscape.defaultPrevented, true);

	releaseTop();
	document.dispatchEvent(escapeKeyEvent());
	assert.deepEqual(dismissed, ['top', 'bottom']);

	releaseBottom();
	const unclaimedEscape = escapeKeyEvent();
	document.dispatchEvent(unclaimedEscape);
	assert.equal(unclaimedEscape.defaultPrevented, false);
});

test('ownership removal is idempotent and does not depend on release order', () => {
	const document = new EventTarget() as unknown as Document;
	const dismissed: string[] = [];
	const releaseBottom = retainAudioEditorDialogEscapeOwner(document, () => dismissed.push('bottom'));
	const releaseMiddle = retainAudioEditorDialogEscapeOwner(document, () => dismissed.push('middle'));
	const releaseTop = retainAudioEditorDialogEscapeOwner(document, () => dismissed.push('top'));

	releaseMiddle();
	releaseMiddle();
	document.dispatchEvent(escapeKeyEvent());
	assert.deepEqual(dismissed, ['top']);

	releaseTop();
	document.dispatchEvent(escapeKeyEvent());
	assert.deepEqual(dismissed, ['top', 'bottom']);
	releaseBottom();
});

test('an inner overlay can claim Escape before the dialog registry', () => {
	const document = new EventTarget() as unknown as Document;
	let dismissals = 0;
	const release = retainAudioEditorDialogEscapeOwner(document, () => {
		dismissals += 1;
	});
	const escape = escapeKeyEvent();
	escape.preventDefault();

	document.dispatchEvent(escape);
	assert.equal(dismissals, 0);
	release();
});

function escapeKeyEvent(): Event & Readonly<{ key: string }> {
	const event = new Event('keydown', { cancelable: true });
	return Object.assign(event, { key: 'Escape' });
}
