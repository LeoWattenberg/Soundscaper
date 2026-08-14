/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Plans the commands that land a transcript on a label track.
 *
 * The planner is pure: it returns an ordinary command batch a controller
 * commits through the single mutation path, so an accepted transcript is
 * inspectable in history and undoes in one step like any other edit. Labels
 * are the surface transcripts land on today because they already round-trip
 * SubRip and WebVTT; when milestone 4 owns a styled caption schema, the target
 * changes here and the transcript itself does not.
 */

import { createAddLabelCommand, createAddLabelTrackCommand } from '../commands/factories.ts';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { AssistanceTranscript } from './transcript.ts';
import { transcriptToLabelDrafts, type TranscriptLabelOptions } from './transcript.ts';

/** A transcript may not author more labels than this in one batch. */
export const MAX_TRANSCRIPT_LABEL_COMMANDS = 10_000;

export interface TranscriptLabelPlanOptions extends TranscriptLabelOptions {
	/** An existing label track to append to, or null to create one. */
	readonly targetTrackId?: string | null;
	/** Supplies the new track id when one must be created. */
	readonly createTrackId?: () => string;
	/** The name given to a newly created track. */
	readonly trackName?: string;
}

export interface TranscriptLabelPlan {
	readonly targetTrackId: string;
	readonly createdTrack: boolean;
	readonly labelCount: number;
	readonly commands: readonly AudioEditorCommand[];
}

/**
 * Builds the batch. Every id the batch depends on is decided here rather than
 * during execution, so replaying the recorded command reproduces the same
 * document.
 */
export function planTranscriptLabelCommands(
	transcript: AssistanceTranscript,
	options: TranscriptLabelPlanOptions = {},
): TranscriptLabelPlan {
	const drafts = transcriptToLabelDrafts(transcript, options);
	if (drafts.length === 0) {
		throw new RangeError('A transcript with no segments authors no labels.');
	}
	if (drafts.length > MAX_TRANSCRIPT_LABEL_COMMANDS) {
		throw new RangeError('A transcript exceeds the label batch ceiling.');
	}

	const commands: AudioEditorCommand[] = [];
	const existingTrackId = options.targetTrackId ?? null;
	const createdTrack = existingTrackId === null;
	let targetTrackId: string;
	if (existingTrackId === null) {
		const createTrackId = options.createTrackId;
		if (typeof createTrackId !== 'function') {
			throw new TypeError('Creating a label track needs an id factory.');
		}
		const created = createTrackId();
		if (typeof created !== 'string' || created.trim() === '') {
			throw new TypeError('A label track id must be a non-empty string.');
		}
		targetTrackId = created;
		const name = options.trackName;
		commands.push(createAddLabelTrackCommand(
			name === undefined ? { id: targetTrackId } : { id: targetTrackId, name },
		));
	} else {
		targetTrackId = existingTrackId;
	}

	for (const label of drafts) {
		commands.push(createAddLabelCommand(targetTrackId, {
			startFrame: label.startFrame,
			endFrame: label.endFrame,
			title: label.title,
		}));
	}

	return Object.freeze({
		targetTrackId,
		createdTrack,
		labelCount: drafts.length,
		commands: Object.freeze(commands),
	});
}
