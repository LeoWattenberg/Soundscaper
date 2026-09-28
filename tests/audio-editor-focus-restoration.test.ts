/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	resolveEditorReturnFocus,
	retainEditorFocusHistory,
} from '../src/common/editor/ui/focus-restoration.ts';

class FocusElement extends EventTarget {
	inert = false;
	hidden = false;
	isConnected = true;
	ariaHidden: string | null = null;
	constructor(
		readonly ownerDocument: Document,
		readonly parentElement: FocusElement | null = null,
	) { super(); }
	getAttribute(name: string): string | null {
		return name === 'aria-hidden' ? this.ariaHidden : null;
	}
}

function focusDocument(): Readonly<{
	document: Document;
	body: FocusElement;
	focus: (element: FocusElement) => void;
}> {
	const document = new EventTarget() as Document;
	const documentElement = new FocusElement(document);
	const body = new FocusElement(document, documentElement);
	Object.assign(document, {
		defaultView: { HTMLElement: FocusElement }, documentElement, body,
	});
	return {
		document, body,
		focus(element) {
			const event = new Event('focusin');
			Object.defineProperty(event, 'target', { value: element });
			document.dispatchEvent(event);
		},
	};
}

test('focus restoration skips connected controls in an inert drawer', () => {
	const { document, body, focus } = focusDocument();
	const opener = new FocusElement(document, body);
	const drawer = new FocusElement(document, body);
	const drawerButton = new FocusElement(document, drawer);
	const release = retainEditorFocusHistory(document);
	try {
		focus(opener);
		focus(drawerButton);
		drawer.inert = true;
		assert.equal(resolveEditorReturnFocus(document, null), opener);
		assert.equal(resolveEditorReturnFocus(document, drawerButton), opener);
	} finally {
		release();
	}
});

test('focus restoration skips hidden and aria-hidden history entries', () => {
	const { document, body, focus } = focusDocument();
	const opener = new FocusElement(document, body);
	const hiddenPanel = new FocusElement(document, body);
	const hiddenButton = new FocusElement(document, hiddenPanel);
	const ariaPanel = new FocusElement(document, body);
	const ariaButton = new FocusElement(document, ariaPanel);
	const release = retainEditorFocusHistory(document);
	try {
		focus(opener);
		focus(hiddenButton);
		focus(ariaButton);
		hiddenPanel.hidden = true;
		ariaPanel.ariaHidden = 'true';
		assert.equal(resolveEditorReturnFocus(document, null), opener);
	} finally {
		release();
	}
});
