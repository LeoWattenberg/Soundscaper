/* SPDX-License-Identifier: AGPL-3.0-only */

/** Return lost keyboard focus after the native label row publishes a removal. */
export function prepareTimelineLabelRemovalFocus(lane: HTMLElement | null, labelId: string): (() => void) | null {
	if (!lane?.isConnected) return null;
	const document = lane.ownerDocument;
	const focused = document.activeElement as HTMLElement | null;
	if (!focused || !lane.contains(focused) || focused.dataset.labelId !== labelId) return null;
	const labels = [...lane.querySelectorAll<HTMLElement>('[data-label-id]')];
	const index = labels.indexOf(focused);
	const neighbours = [...labels.slice(index + 1), ...labels.slice(0, index).reverse()].map(label => label.dataset.labelId);
	return () => {
		requestAnimationFrame(() => {
			if (!lane.isConnected || focused.isConnected) return;
			const active = document.activeElement;
			if (active !== focused && active !== document.body) return;
			const survivors = [...lane.querySelectorAll<HTMLElement>('[data-label-id]')];
			const target = neighbours.map(id => survivors.find(label => label.dataset.labelId === id)).find(Boolean)
				?? survivors[0] ?? lane.closest<HTMLElement>('[data-label-track]')
					?.querySelector<HTMLElement>('.audio-editor-label-track-actions')?.querySelector<HTMLElement>('button');
			if (target?.isConnected) target.focus({ preventScroll: true });
		});
	};
}
