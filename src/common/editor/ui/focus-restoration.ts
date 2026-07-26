/* SPDX-License-Identifier: AGPL-3.0-only */

const MAXIMUM_FOCUS_HISTORY = 16;

interface FocusHistory {
	readonly elements: HTMLElement[];
	readonly listener: (event: FocusEvent) => void;
	refCount: number;
}

const histories = new WeakMap<Document, FocusHistory>();

/** Retain document focus history for editor overlays that mount lazily. */
export function retainEditorFocusHistory(document: Document): () => void {
	let history = histories.get(document);
	if (!history) {
		const elements: HTMLElement[] = [];
		const listener = (event: FocusEvent) => {
			const element = editorFocusableElement(document, event.target);
			if (!element) return;
			const previousIndex = elements.indexOf(element);
			if (previousIndex >= 0) elements.splice(previousIndex, 1);
			elements.push(element);
			if (elements.length > MAXIMUM_FOCUS_HISTORY) elements.shift();
		};
		history = { elements, listener, refCount: 0 };
		histories.set(document, history);
		document.addEventListener('focusin', listener);
	}
	history.refCount += 1;
	let retained = true;
	return () => {
		if (!retained) return;
		retained = false;
		const current = histories.get(document);
		if (!current || --current.refCount > 0) return;
		document.removeEventListener('focusin', current.listener);
		histories.delete(document);
	};
}

/** Resolve a connected return target even if a lazy overlay left body focused. */
export function resolveEditorReturnFocus(
	document: Document,
	fallback: EventTarget | null,
): HTMLElement | null {
	const direct = editorFocusableElement(document, fallback);
	if (direct?.isConnected) return direct;
	const elements = histories.get(document)?.elements || [];
	for (let index = elements.length - 1; index >= 0; index -= 1) {
		const element = elements[index];
		if (element.isConnected && element.ownerDocument === document) return element;
	}
	return null;
}

function editorFocusableElement(document: Document, target: EventTarget | null): HTMLElement | null {
	const ElementClass = document.defaultView?.HTMLElement;
	if (!ElementClass || !(target instanceof ElementClass)) return null;
	if (target === document.body || target === document.documentElement) return null;
	return target as HTMLElement;
}
