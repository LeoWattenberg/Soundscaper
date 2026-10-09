/* SPDX-License-Identifier: AGPL-3.0-only */

import { handleWorkspaceKeyboard } from '../workspace-shortcuts.ts';

type SelectionKeyboardEvent = Parameters<typeof handleWorkspaceKeyboard>[0] & {
	stopPropagation(): void;
};

/** Give configured selection commands ownership before the clip's legacy trim handler. */
export function handleClipSelectionKeyboardCapture(
	event: SelectionKeyboardEvent,
	snapshot: Parameters<typeof handleWorkspaceKeyboard>[1],
	run: Parameters<typeof handleWorkspaceKeyboard>[2],
	registry: Parameters<typeof handleWorkspaceKeyboard>[3] = {},
): void {
	if (event.defaultPrevented || event.altKey || !event.shiftKey
		|| !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
	if (typeof Element === 'undefined' || !(event.target instanceof Element)
		|| !event.target.hasAttribute('data-clip-id') || event.target.getAttribute('role') !== 'group') return;
	if (event.target.closest('[data-product]')?.getAttribute('data-product') !== 'soundscaper') return;
	handleWorkspaceKeyboard(event, snapshot, run, registry);
	// A removed or remapped selection chord still cannot fall through into a
	// different edit merely because the selected clip owns keyboard focus.
	event.preventDefault();
	event.stopPropagation();
}
