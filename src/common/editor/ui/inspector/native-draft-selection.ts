/* SPDX-License-Identifier: AGPL-3.0-only */

interface NativeDraftSelectionField extends EventTarget {
	readonly disabled: boolean;
	readonly readOnly: boolean;
	readonly selectionStart: number | null;
	readonly selectionEnd: number | null;
}

/** Observe the native selection boundary, including number inputs without key events. */
export function observeNativeDraftSelection(
	field: NativeDraftSelectionField | null,
	reserve: (() => void) | undefined,
): () => void {
	if (!field || !reserve) return () => undefined;
	let active = true;
	const selected = (event: Event): void => {
		if (!active || event.target !== field || field.disabled || field.readOnly) return;
		// Number inputs expose no range, but still dispatch their native select event.
		const { selectionStart, selectionEnd } = field;
		if (selectionStart !== null && selectionEnd !== null && selectionStart === selectionEnd) return;
		reserve();
	};
	field.addEventListener('select', selected);
	return () => {
		active = false;
		field.removeEventListener('select', selected);
	};
}
