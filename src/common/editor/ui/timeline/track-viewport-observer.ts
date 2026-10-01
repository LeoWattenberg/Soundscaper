/* SPDX-License-Identifier: AGPL-3.0-only */

const OVERSCAN_PIXELS = 64;
type VisibilityListener = (visible: boolean) => void;
interface RowListeners {
	visibility: VisibilityListener;
	interaction?: (nativeDrag: boolean) => void;
}
interface ViewportObserver {
	observer: IntersectionObserver;
	rows: Map<HTMLElement, RowListeners>;
	stopInteractions: () => void;
}

const viewports = new WeakMap<Element, ViewportObserver>();
const reveals = new WeakMap<Element, () => void>();

/** Share one browser observer across the fixed-height slots in each timeline. */
export function observeTrackViewportRow(
	row: HTMLElement,
	onVisible: VisibilityListener,
	onInteraction?: (nativeDrag: boolean) => void,
): () => void {
	if (typeof IntersectionObserver !== 'function') {
		onVisible(true);
		return () => {};
	}
	const root = row.closest('[data-timeline]');
	if (!root) {
		onVisible(true);
		return () => {};
	}
	const bounds = row.getBoundingClientRect();
	const viewportBounds = root.getBoundingClientRect();
	onVisible(bounds.bottom >= viewportBounds.top - OVERSCAN_PIXELS
		&& bounds.top <= viewportBounds.bottom + OVERSCAN_PIXELS);
	let viewport = viewports.get(root);
	if (!viewport) {
		const rows = new Map<HTMLElement, RowListeners>();
		const observer = new IntersectionObserver((entries) => {
			for (const entry of entries) rows.get(entry.target as HTMLElement)?.visibility(entry.isIntersecting);
		}, { root, rootMargin: `${OVERSCAN_PIXELS}px 0px` });
		// Timeline React capture handlers can stop propagation before the row.
		// Observe ownership at the document first, without per-row listeners.
		const document = root.ownerDocument;
		const pinInteraction = (event: Event) => {
			const target = event.target as Element | null;
			const slot = target?.closest?.<HTMLElement>('[data-track-viewport-row]');
			if (slot) rows.get(slot)?.interaction?.(event.type === 'dragstart');
		};
		document.addEventListener('pointerdown', pinInteraction, true);
		document.addEventListener('dragstart', pinInteraction, true);
		const stopInteractions = () => {
			document.removeEventListener('pointerdown', pinInteraction, true);
			document.removeEventListener('dragstart', pinInteraction, true);
		};
		viewport = { observer, rows, stopInteractions };
		viewports.set(root, viewport);
	}
	const registered = viewport;
	registered.rows.set(row, { visibility: onVisible, interaction: onInteraction });
	registered.observer.observe(row);
	return () => {
		registered.observer.unobserve(row);
		registered.rows.delete(row);
		if (registered.rows.size === 0) {
			registered.observer.disconnect();
			registered.stopInteractions();
			viewports.delete(root);
		}
	};
}

export function registerTrackViewportReveal(row: HTMLElement, reveal: () => void): () => void {
	reveals.set(row, reveal);
	return () => { reveals.delete(row); };
}

/** Focus routing is synchronous: controls must exist before their DOM lookup. */
export function revealTrackViewportRow(root: Element | null, trackIndex: number): void {
	const row = root?.querySelector(`[data-track-viewport-row][data-track-index="${trackIndex}"]`);
	if (row) reveals.get(row)?.();
}
