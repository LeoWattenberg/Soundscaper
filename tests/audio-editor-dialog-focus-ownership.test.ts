/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { retainAudioEditorDialogFocusOwner } from '../src/common/editor/ui/dialog-focus-ownership.ts';

test('only the newest modal dialog traps focus and closing it restores the preceding owner', () => {
	const document = new EventTarget() as unknown as Document;
	const parent = retainAudioEditorDialogFocusOwner(document);
	assert.equal(parent.isCurrent(), true);
	const details = retainAudioEditorDialogFocusOwner(document);
	assert.equal(parent.isCurrent(), false);
	assert.equal(details.isCurrent(), true);
	details.release();
	assert.equal(details.isCurrent(), false);
	assert.equal(parent.isCurrent(), true);
	parent.release();
	assert.equal(parent.isCurrent(), false);
});

test('modal ownership is document-local and safe to release out of order twice', () => {
	const firstDocument = new EventTarget() as unknown as Document;
	const secondDocument = new EventTarget() as unknown as Document;
	const first = retainAudioEditorDialogFocusOwner(firstDocument);
	const second = retainAudioEditorDialogFocusOwner(firstDocument);
	const otherDocument = retainAudioEditorDialogFocusOwner(secondDocument);
	first.release();
	first.release();
	assert.equal(second.isCurrent(), true);
	assert.equal(otherDocument.isCurrent(), true);
	second.release();
	otherDocument.release();
});
