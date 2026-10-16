/* SPDX-License-Identifier: AGPL-3.0-only */

export interface WorkspacePanelResizeCallbacks {
	readonly active: () => boolean;
	readonly resize: (event: PointerEvent) => void;
	readonly finish: (event: PointerEvent | MouseEvent) => void;
	readonly cancel: (event?: PointerEvent) => void;
}

/** Retain the listeners belonging to one dock's current resize session. */
export function retainWorkspacePanelResizeLifecycle(
	target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
	callbacks: WorkspacePanelResizeCallbacks,
): () => void {
	const resize = (event: PointerEvent): void => {
		if (!callbacks.active()) return;
		if (event.pointerType === 'mouse' && event.button === 0 && (event.buttons & 1) === 0) callbacks.finish(event);
		else callbacks.resize(event);
	};
	const escape = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape' || !callbacks.active()) return;
		event.preventDefault(); event.stopPropagation();
		callbacks.cancel();
	};
	target.addEventListener('pointermove', resize, { passive: false });
	target.addEventListener('pointerup', callbacks.finish);
	target.addEventListener('mouseup', callbacks.finish);
	target.addEventListener('pointercancel', callbacks.cancel);
	target.addEventListener('keydown', escape);
	return () => {
		target.removeEventListener('pointermove', resize);
		target.removeEventListener('pointerup', callbacks.finish);
		target.removeEventListener('mouseup', callbacks.finish);
		target.removeEventListener('pointercancel', callbacks.cancel);
		target.removeEventListener('keydown', escape);
		callbacks.cancel();
	};
}
