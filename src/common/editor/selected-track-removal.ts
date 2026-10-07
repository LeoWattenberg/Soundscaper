/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from './commands/protocol.ts';

interface RemovalProject {
	readonly tracks: readonly Readonly<{ id: string; laneGroupId?: unknown }>[];
	readonly selection?: Readonly<{ trackIds?: unknown }> | null;
}

/** The plural command owns the explicit track selection; lane groups remove once. */
export function prepareSelectedTrackRemoval(project: RemovalProject | null | undefined,
	focusedTrackId: string | null | undefined): AudioEditorCommand | null {
	if (!project) return null;
	const selected = project.selection?.trackIds;
	const ids = Array.isArray(selected) && selected.length ? new Set(selected as unknown[])
		: new Set(focusedTrackId ? [focusedTrackId] : []);
	const groups = new Set<string>();
	const commands: AudioEditorCommand[] = [];
	for (const track of project.tracks) {
		if (!ids.has(track.id)) continue;
		const group = typeof track.laneGroupId === 'string' ? track.laneGroupId : null;
		if (group && groups.has(group)) continue;
		if (group) groups.add(group);
		commands.push({ type: 'track/remove', trackId: track.id });
	}
	return commands.length === 0 ? null : commands.length === 1 ? commands[0]!
		: { type: 'batch', commands };
}
