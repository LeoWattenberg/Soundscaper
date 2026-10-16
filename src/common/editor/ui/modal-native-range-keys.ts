/* SPDX-License-Identifier: AGPL-3.0-only */

interface NativeRangeKeyEvent {
	readonly target: EventTarget | null;
	readonly key: string;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly defaultPrevented: boolean;
	preventDefault(): void;
	stopPropagation(): void;
}

const RANGE_NAVIGATION_KEYS = new Set([
	'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp',
]);

/** Modal command suspension must also prevent the native parameter edit. */
export function guardModalNativeRangeKey(event: NativeRangeKeyEvent, modal: boolean): void {
	if (!modal || event.defaultPrevented || (!event.ctrlKey && !event.metaKey && !event.altKey)
		|| !RANGE_NAVIGATION_KEYS.has(event.key) || !(event.target instanceof Element)
		|| event.target.tagName !== 'INPUT' || (event.target as HTMLInputElement).type !== 'range') return;
	event.preventDefault();
	event.stopPropagation();
}
