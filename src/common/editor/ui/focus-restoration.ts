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
	excluded: HTMLElement | null = null,
): HTMLElement | null {
	const direct = editorFocusableElement(document, fallback);
	if (direct && !excluded?.contains(direct) && isAvailableReturnFocusTarget(document, direct)) return direct;
	const elements = histories.get(document)?.elements || [];
	for (let index = elements.length - 1; index >= 0; index -= 1) {
		const element = elements[index];
		if (!excluded?.contains(element) && isAvailableReturnFocusTarget(document, element)) return element;
	}
	return null;
}

/** Layout changes can replace or hide a modal's original menu opener. */
export function restoreEditorDialogReturnFocus(
	document: Document,
	previous: EventTarget | null,
	closingPanel: HTMLElement | null,
	editor: HTMLElement | null,
): void {
	const remembered = resolveEditorReturnFocus(document, previous, closingPanel);
	if (remembered) { remembered.focus({ preventScroll: true }); return; }
	const controls = [
		...(editor?.querySelectorAll<HTMLElement>('[data-chrome-drawer-toggle]') ?? []),
		...(editor?.querySelector<HTMLElement>('[data-application-menubar]')?.querySelectorAll<HTMLButtonElement>('button') ?? []),
	];
	controls.find(element => isAvailableReturnFocusTarget(document, element)
		&& !element.hasAttribute('disabled'))?.focus({ preventScroll: true });
}

function isAvailableReturnFocusTarget(document: Document, element: HTMLElement): boolean {
	if (!element.isConnected || element.ownerDocument !== document) return false;
	for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
		if (ancestor.inert || ancestor.hidden || ancestor.getAttribute('aria-hidden') === 'true') return false;
	}
	return true;
}

function editorFocusableElement(document: Document, target: EventTarget | null): HTMLElement | null {
	const ElementClass = document.defaultView?.HTMLElement;
	if (!ElementClass || !(target instanceof ElementClass)) return null;
	if (target === document.body || target === document.documentElement) return null;
	return target as HTMLElement;
}
