/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MasteringSequenceDialogOperation } from './soundscaper-mastering-sequence-operation.ts';

/** Resolve the next authoring control after a mastering removal is published. */
export function masteringRemovalFocusFallback(
	command: MasteringSequenceDialogOperation,
	ownerDocument: Document = document,
): (() => HTMLElement | null) | undefined {
	if (command.type !== 'mastering-sequence/remove' && command.type !== 'mastering-sequence/entry-remove') return undefined;
	const target = ownerDocument.activeElement;
	const editor = target?.closest<HTMLElement>('[data-soundscaper-mastering-sequence-editor]');
	if (!editor) return undefined;
	if (command.type === 'mastering-sequence/remove') return () => (
		editor.querySelector<HTMLElement>('[data-mastering-action="remove-sequence"]')
		?? editor.querySelector<HTMLElement>('[data-mastering-action="new-sequence"]')
	);
	const entries = Array.from(editor.querySelectorAll<HTMLElement>('[data-mastering-entry]'));
	const index = entries.findIndex(entry => entry.contains(target));
	return () => {
		const remaining = editor.querySelectorAll<HTMLElement>('[data-mastering-entry]');
		return remaining[Math.min(Math.max(index, 0), remaining.length - 1)]
			?.querySelector<HTMLElement>('[data-mastering-action="remove-entry"]')
			?? editor.querySelector<HTMLElement>('[data-mastering-action="add-entry"]');
	};
}
