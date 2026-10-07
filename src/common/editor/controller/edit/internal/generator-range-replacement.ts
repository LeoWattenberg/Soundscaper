/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import { prepareRangeReplacementCommand } from '../../../commands/range-runtime.js';
import type { AudioGeneratorProject, AudioGeneratorSelection, AudioGeneratorTrack } from './generator-project-view.ts';

/** Every selected lane receives the generated signal, sharing its one stored PCM body. */
export function prepareGeneratorRangeReplacement(
	project: AudioGeneratorProject,
	selection: AudioGeneratorSelection,
	focused: AudioGeneratorTrack,
	source: Readonly<Record<string, unknown>>,
	requestedTrackId: string | null | undefined,
	createId: (prefix?: string) => string,
): Readonly<{ command: AudioEditorCommand; trackId: string; clipId: string }> {
	const selectedIds = new Set(selection.trackIds ?? []);
	const selected = requestedTrackId ? [focused] : project.tracks.filter(track => track.type === 'audio' && selectedIds.has(track.id));
	const targets = selected.length ? selected : [focused];
	const commands = targets.map((track, index) => prepareRangeReplacementCommand(project, {
		trackId: track.id,
		startFrame: selection.startFrame,
		endFrame: selection.endFrame,
		// Range replacement owns a new source descriptor per lane. Its storage
		// key continues to address the one successfully published generator body.
		source: index ? { ...source, id: createId('generator') } : source,
	}, createId) as Extract<AudioEditorCommand, { readonly type: 'range/replace' }>);
	const primary = commands.find(command => command.trackId === focused.id) ?? commands[0]!;
	return {
		command: commands.length === 1 ? commands[0]! : { type: 'batch', commands },
		trackId: primary.trackId,
		clipId: primary.clipId,
	};
}
