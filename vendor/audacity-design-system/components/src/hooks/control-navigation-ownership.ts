/** Editable widgets consume their own arrow, Home, and End keys. */
export function controlOwnsNavigationKeys(target: EventTarget | null): boolean {
	return typeof Element !== 'undefined' && target instanceof Element
		&& target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="spinbutton"], [role="combobox"]') !== null;
}
