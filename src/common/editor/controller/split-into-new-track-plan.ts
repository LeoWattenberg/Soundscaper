/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Plan the time-range half of "Split into new track".
 *
 * Upstream's `doGlobalSplitIntoNewTrack` asks the time selection first and
 * falls back to the selected clips
 * (`src/trackedit/internal/trackeditactionscontroller.cpp`); this module owns
 * the first half, which had no implementation here at all — a drawn range left
 * the command doing nothing. The clip half stays where it was, splitting the
 * selected clip at the playhead.
 *
 * A range is realised as splits at its edges followed by moves: the pieces the
 * splits leave inside the range are exactly what upstream copies out, and
 * preparing the edges right to left keeps every clip identifier the earlier
 * command produced valid for the later one.
 */

// Command and document shapes are the editor's untyped runtime ports; the
// controller narrows them as their owning services migrate.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RuntimeValue = any;

export interface SplitIntoNewTrackRuntime {
	readonly getProject: () => RuntimeValue;
	readonly findClip: (project: RuntimeValue, clipId: string) => RuntimeValue;
	readonly createStableId: (prefix?: string) => string;
	readonly createAddTrackCommand: (track: RuntimeValue) => RuntimeValue;
	readonly prepareLinkedSplitCommand: (
		project: RuntimeValue,
		clipId: string,
		atFrame: number,
		idFactory: (prefix?: string) => string,
	) => RuntimeValue;
}

export interface SplitIntoNewTrackRange {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds: readonly string[];
}

export interface SplitIntoNewTrackPlan {
	readonly command: RuntimeValue;
	readonly selectTrackId: string;
	readonly selectClipId: string;
}

export function prepareSplitRangeIntoNewTrackCommand(
	runtime: SplitIntoNewTrackRuntime,
	range: SplitIntoNewTrackRange,
): SplitIntoNewTrackPlan | null {
	const project = runtime.getProject();
	const perTrack = rangeClipsPerTrack(runtime, project, range);
	if (!perTrack.size) return null;
	const commands: RuntimeValue[] = [];
	const moves: RuntimeValue[] = [];
	let selectTrackId = '';
	let selectClipId = '';
	for (const [trackId, entries] of perTrack) {
		const sourceTrack = project.tracks.find((track: RuntimeValue) => track.id === trackId);
		if (!sourceTrack) continue;
		const newTrackId = runtime.createStableId('track');
		commands.push(runtime.createAddTrackCommand({
			...sourceTrack,
			id: newTrackId,
			name: `${sourceTrack.name} 2`,
			clipIds: [],
			effects: [],
		}));
		for (const entry of entries) {
			commands.push(...entry.splits);
			moves.push({
				type: 'clip/move',
				clipId: entry.clipId,
				trackId: newTrackId,
				timelineStartFrame: entry.timelineStartFrame,
			});
		}
		selectTrackId ||= newTrackId;
		selectClipId ||= entries[0]?.clipId ?? '';
	}
	if (!moves.length) return null;
	return {
		command: { type: 'batch', commands: [...commands, ...moves] },
		selectTrackId,
		selectClipId,
	};
}

interface PlannedClip {
	readonly clipId: string;
	readonly timelineStartFrame: number;
	readonly splits: readonly RuntimeValue[];
}

/** A clip an audio edit may lift onto another track on its own. */
function liftable(clip: RuntimeValue, track: RuntimeValue): boolean {
	return Boolean(clip) && clip.kind !== 'video' && !clip.avLinkId && track?.type === 'audio';
}

function rangeClipsPerTrack(
	runtime: SplitIntoNewTrackRuntime,
	project: RuntimeValue,
	range: SplitIntoNewTrackRange,
): Map<string, PlannedClip[]> {
	const perTrack = new Map<string, PlannedClip[]>();
	const trackIds = new Set(range.trackIds);
	for (const track of project.tracks) {
		if (!trackIds.has(track.id) || !Array.isArray(track.clipIds)) continue;
		for (const clipId of track.clipIds) {
			const clip = runtime.findClip(project, clipId);
			if (!liftable(clip, track)) continue;
			const clipEndFrame = clip.timelineStartFrame + clip.durationFrames;
			if (clipEndFrame <= range.startFrame || clip.timelineStartFrame >= range.endFrame) continue;
			const splits: RuntimeValue[] = [];
			// Right edge first: the left piece keeps the identifier the next
			// command names, so the second split still finds the clip it means.
			if (range.endFrame > clip.timelineStartFrame && range.endFrame < clipEndFrame) {
				splits.push(runtime.prepareLinkedSplitCommand(project, clip.id, range.endFrame, runtime.createStableId));
			}
			let lifted = clip.id;
			let timelineStartFrame = clip.timelineStartFrame;
			if (range.startFrame > clip.timelineStartFrame && range.startFrame < clipEndFrame) {
				const split = runtime.prepareLinkedSplitCommand(project, clip.id, range.startFrame, runtime.createStableId);
				splits.push(split);
				lifted = split.rightClipId;
				timelineStartFrame = split.atFrame;
			}
			const entries = perTrack.get(track.id);
			const planned = { clipId: lifted, timelineStartFrame, splits };
			if (entries) entries.push(planned);
			else perTrack.set(track.id, [planned]);
		}
	}
	return perTrack;
}
