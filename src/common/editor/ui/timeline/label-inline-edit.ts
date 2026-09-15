/* SPDX-License-Identifier: AGPL-3.0-only */

/** Open the existing inline editor after a menu or shortcut creates or renames a label. */
export function startLabelInlineEdit(
	root: ParentNode | null | undefined,
	target: Readonly<{ trackId?: unknown; labelId?: unknown }>,
): boolean {
	const marker = [...(root?.querySelectorAll<HTMLElement>('[data-label-id]') || [])]
		.find((candidate) => candidate.dataset.labelId === target.labelId
			&& candidate.closest<HTMLElement>('[data-label-track]')?.dataset.trackId === target.trackId);
	if (!marker) return false;
	marker.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	marker.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
	return true;
}

/** A selected label stays a rename target after opening a menu moves focus. */
export function focusedOrSelectedTimelineLabel(document: Document, selectedTrackId: string | null) {
	const marker = document.activeElement?.closest<HTMLElement>('[data-label-id]')
		|| [...document.querySelectorAll<HTMLElement>('[data-selected-label="true"]')]
			.find((candidate) => candidate.closest<HTMLElement>('[data-label-track]')?.dataset.trackId === selectedTrackId);
	const row = marker?.closest<HTMLElement>('[data-label-track]');
	return marker?.dataset.labelId && row?.dataset.trackId
		? { trackId: row.dataset.trackId, labelId: marker.dataset.labelId }
		: null;
}
