/* SPDX-License-Identifier: AGPL-3.0-only */

interface Offset { readonly x: number; readonly y: number }
interface HeaderBounds {
	readonly left: number;
	readonly right: number;
	readonly top: number;
	readonly bottom: number;
}

/** Keep the draggable title and close control inside the browser window. */
export function constrainDialogDragOffset(
	offset: Offset,
	startOffset: Offset,
	header: HeaderBounds,
	viewport: Readonly<{ width: number; height: number }>,
): Offset {
	const clamp = (value: number, minimum: number, maximum: number) => (
		Math.max(minimum, Math.min(maximum, value))
	);
	return {
		x: clamp(offset.x, startOffset.x + 8 - header.left,
			startOffset.x + viewport.width - 8 - header.right),
		y: clamp(offset.y, startOffset.y + 8 - header.top,
			startOffset.y + viewport.height - 8 - header.bottom),
	};
}

/** Centered windows can move their title when content or browser dimensions change. */
export function retainDialogGeometryLifecycle(
	panel: HTMLElement,
	view: Window,
	onGeometryChange: () => void,
): () => void {
	let retained = true;
	const changed = () => { if (retained) onGeometryChange(); };
	const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(changed);
	observer?.observe(panel);
	view.addEventListener('resize', changed);
	return () => {
		if (!retained) return;
		retained = false;
		observer?.disconnect();
		view.removeEventListener('resize', changed);
	};
}
