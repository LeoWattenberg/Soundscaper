/* SPDX-License-Identifier: AGPL-3.0-only */

interface FolderRenameKeyEvent {
	readonly key: string;
	readonly currentTarget: Pick<HTMLInputElement, 'value' | 'closest'>;
	preventDefault(): void;
	stopPropagation(): void;
}

/** Return keyboard focus to the tree after React removes its rename input. */
export function finishTrackFolderRenameFromKeyboard(
	event: FolderRenameKeyEvent,
	folderId: string,
	onRename: (folderId: string, value: string | null) => void,
): boolean {
	if (event.key !== 'Enter' && event.key !== 'Escape') return false;
	event.preventDefault();
	event.stopPropagation();
	const row = event.currentTarget.closest<HTMLElement>('[data-track-folder-row]');
	onRename(folderId, event.key === 'Escape' ? null : event.currentTarget.value);
	queueMicrotask(() => {
		if (row?.isConnected) row.focus({ preventScroll: true });
	});
	return true;
}
