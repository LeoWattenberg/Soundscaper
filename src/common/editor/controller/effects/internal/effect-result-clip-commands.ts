/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectRelatedClipIds, type EditingAuthorityProject } from '../../../commands/editing-selection-authority.ts';
import type { AudioEditorCommand, CommandObject } from '../../../commands/protocol.ts';

interface ClipResult {
	readonly target: Readonly<{ clipId: string }>;
	readonly frameCount: number;
}

/** A fully truncated clip is removed; an empty media source cannot represent it. */
export function prepareExactClipEffectResultCommands<Entry extends ClipResult>(
	project: EditingAuthorityProject, entries: readonly Entry[], sourceFor: (entry: Entry) => CommandObject,
): AudioEditorCommand[] {
	const removed = entries.filter(entry => entry.frameCount === 0).map(entry => entry.target.clipId);
	const surviving = entries.filter(entry => entry.frameCount > 0);
	const related = new Set(collectRelatedClipIds(project, removed));
	if (surviving.some(entry => related.has(entry.target.clipId))) {
		throw new RangeError('Related clips produced inconsistent effect duration ratios.');
	}
	return [
		...(surviving.length ? [{ type: 'clip/render-replace-many' as const,
			entries: surviving.map(entry => ({ clipId: entry.target.clipId, source: sourceFor(entry) })) }] : []),
		...(removed.length ? [{ type: 'clip/remove-many' as const, clipIds: removed, rippleMode: 'track' as const }] : []),
	];
}
