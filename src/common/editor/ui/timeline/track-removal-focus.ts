/* SPDX-License-Identifier: AGPL-3.0-only */

/** A per-row observer disappears with the row; capture keyboard removal at its owner. */
export function prepareTimelineTrackRemovalFocus(ownerDocument: Document,
	selectTrack: (trackId: string) => unknown): (() => void) | null {
	const focused = ownerDocument.activeElement as HTMLElement | null;
	const row = focused?.closest<HTMLElement>('[data-track-row]');
	const editor = row?.closest<HTMLElement>('[data-audio-editor]');
	if (!focused || !row?.isConnected || !editor?.isConnected) return null;
	const rows = [...editor.querySelectorAll<HTMLElement>('[data-track-row]')];
	const index = rows.indexOf(row);
	const neighbours = [...rows.slice(index + 1), ...rows.slice(0, index).reverse()].map(candidate => candidate.dataset.trackId);
	return () => {
		requestAnimationFrame(() => {
			if (!editor.isConnected || row.isConnected || focused.isConnected) return;
			const active = ownerDocument.activeElement;
			if (active !== focused && active !== ownerDocument.body) return;
			const survivors = [...editor.querySelectorAll<HTMLElement>('[data-track-row]')]
				.filter(candidate => !candidate.closest('[hidden], [aria-hidden="true"]'));
			const next = neighbours.map(id => survivors.find(candidate => candidate.dataset.trackId === id)).find(Boolean)
				?? survivors[0];
			const target = next?.querySelector<HTMLElement>('.track')
				?? next?.querySelector<HTMLElement>('[data-track-header] button:not(:disabled), button:not(:disabled)')
				?? editor.querySelector<HTMLElement>('[data-ruler-focus]');
			if (target?.isConnected) {
				if (next?.dataset.trackId) selectTrack(next.dataset.trackId);
				target.focus({ preventScroll: true });
			}
		});
	};
}
