/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep the contextual keyboard subject when its label changes React owners. */
export function prepareLabelTrackMoveFocus(trackId: string, labelId: string, destinationId: string): (() => void) | null {
	const document = globalThis.document;
	const focused = document?.activeElement as HTMLElement | null | undefined;
	const marker = focused?.closest<HTMLElement>('[data-label-id]');
	const root = marker?.closest<HTMLElement>('[data-audio-editor]');
	if (!root?.isConnected || focused !== marker || marker.dataset.labelId !== labelId
		|| marker.closest<HTMLElement>('[data-label-track]')?.dataset.trackId !== trackId) return null;
	return () => {
		requestAnimationFrame(() => {
			if (!root.isConnected || focused.isConnected) return;
			const active = document.activeElement;
			if (active !== focused && active !== document.body) return;
			const target = [...root.querySelectorAll<HTMLElement>('[data-label-id]')].find(candidate => (
				candidate.dataset.labelId === labelId
				&& candidate.closest<HTMLElement>('[data-label-track]')?.dataset.trackId === destinationId
			));
			if (target?.isConnected) target.focus({ preventScroll: true });
		});
	};
}
