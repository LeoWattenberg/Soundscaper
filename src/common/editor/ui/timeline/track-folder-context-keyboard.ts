/* SPDX-License-Identifier: AGPL-3.0-only */

interface FolderContextKeyboardEvent {
	readonly key: string;
	readonly shiftKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly target: EventTarget | null;
	readonly currentTarget: HTMLElement;
	preventDefault(): void;
	stopPropagation(): void;
}

/** Open the row's existing context menu at its visible keyboard anchor. */
export function openTrackFolderMenuFromKeyboard(
	event: FolderContextKeyboardEvent,
	folderId: string,
	openMenu: (folderId: string, position: { x: number; y: number }) => void,
): boolean {
	if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey
		|| !(event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) return false;
	const rect = event.currentTarget.getBoundingClientRect();
	event.preventDefault();
	event.stopPropagation();
	openMenu(folderId, { x: rect.left, y: rect.bottom });
	return true;
}
