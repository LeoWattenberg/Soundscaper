/* SPDX-License-Identifier: AGPL-3.0-only */

interface RenameKeyEvent {
	readonly key: string;
	readonly nativeEvent?: Readonly<{ isComposing?: boolean }>;
	readonly currentTarget: Pick<HTMLElement, 'closest'>;
	preventDefault(): void;
	stopPropagation(): void;
}

/** Inline track naming removes its input; retain keyboard access to that track. */
export function finishInlineTrackRename(
	event: RenameKeyEvent,
	commit: () => void,
	cancel: () => void,
): boolean {
	if (event.nativeEvent?.isComposing) return false;
	if (event.key !== 'Enter' && event.key !== 'Escape') return false;
	event.preventDefault();
	event.stopPropagation();
	const control = event.currentTarget.closest('[data-track-header]')
		?.querySelector<HTMLButtonElement>('.ghost-button');
	if (event.key === 'Enter') commit();
	else cancel();
	queueMicrotask(() => {
		if (control?.isConnected) control.focus({ preventScroll: true });
	});
	return true;
}
