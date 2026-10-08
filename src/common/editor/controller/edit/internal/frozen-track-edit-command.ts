/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import { createEditorCommandMutationTransaction } from '../../../commands/mutation-transaction.ts';
import { normalizeAudioTrackFreezeV1 } from '../../../audio-track-freeze-v21.ts';
import { projectForCommandConsumers } from '../../../project-current-runtime.ts';
import { cloneProject } from '../../../project.js';
import { isSoundscaperProductionProject } from '../../../project-schema-version.ts';

interface MembershipProject {
	readonly tracks: readonly Readonly<{ id: string; clipIds?: readonly string[] }>[];
}

/** Ordinary edits retire an unusable freeze while retaining canonical freeze admission. */
export function prepareFrozenTrackEditCommand(project: unknown, command: AudioEditorCommand): AudioEditorCommand {
	if (!isSoundscaperProductionProject(project) || !removesClips(command)) return command;
	const canonical = project as Readonly<Record<string, unknown>>;
	const frozen = (canonical.tracks as readonly Readonly<Record<string, unknown>>[])
		.filter(track => track.type === 'audio' && Object.hasOwn(track, 'audioFreeze'));
	if (!frozen.length) return command;
	const projection = projectForCommandConsumers(canonical);
	const draft = cloneProject(projection) as unknown as MembershipProject;
	createEditorCommandMutationTransaction(canonical, projection).mutate(draft, command);
	const retained = new Map(draft.tracks.map(track => [track.id, track]));
	const removals: AudioEditorCommand[] = frozen.flatMap(track => {
		const after = retained.get(String(track.id));
		return after && Array.isArray(after.clipIds) && after.clipIds.length === 0
			? [{ type: 'audio-freeze/remove' as const, trackId: String(track.id),
				expectedFreeze: normalizeAudioTrackFreezeV1(track.audioFreeze) }]
			: [];
	});
	return removals.length ? { type: 'batch', commands: [...removals, command] } : command;
}

function removesClips(command: AudioEditorCommand): boolean {
	return command.type === 'batch' ? command.commands.some(removesClips)
		: command.type === 'clip/remove-many' || command.type === 'range/lift-delete'
			|| command.type === 'range/ripple-delete' || command.type === 'range/per-clip-ripple-delete'
			|| command.type === 'range/keep';
}
