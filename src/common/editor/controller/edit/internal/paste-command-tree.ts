/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../../../commands/protocol.ts';

export type PasteCommand = Extract<AudioEditorCommand, { readonly type: 'clipboard/paste' }>;
export type SourceAddCommand = Extract<AudioEditorCommand, { readonly type: 'source/add' }>;

export interface DiscoveredPasteCommandTree {
	readonly pastes: readonly PasteCommand[];
	readonly sourceAdds: readonly SourceAddCommand[];
}

/** Collect paste inputs without assigning caller-specific cardinality or source-ID policy. */
export function discoverPasteCommandTree(command: AudioEditorCommand): DiscoveredPasteCommandTree {
	const pastes: PasteCommand[] = [];
	const sourceAdds: SourceAddCommand[] = [];
	visit(command);
	return { pastes, sourceAdds };

	function visit(candidate: AudioEditorCommand): void {
		if (candidate.type === 'clipboard/paste') pastes.push(candidate);
		if (candidate.type === 'source/add') sourceAdds.push(candidate);
		if (candidate.type === 'batch') candidate.commands.forEach(visit);
	}
}
