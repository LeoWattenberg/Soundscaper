/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from './commands/protocol.ts';
import type { LabeledAudioRegion } from './labeled-audio-regions.ts';

interface JoinableClip {
	readonly id: string;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
}

/** Plan each requested adjacent run once, even when labels share participating clips. */
export function planLabeledAudioJoinRuns(
	clipIds: readonly string[],
	regions: readonly LabeledAudioRegion[],
	findClip: (id: string) => JoinableClip | null | undefined,
): readonly Extract<AudioEditorCommand, { type: 'clip/join' }>[] {
	const clips = clipIds.map(findClip).filter((clip): clip is JoinableClip => Boolean(clip))
		.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame);
	let groups: Set<string>[] = [];
	for (const region of regions) {
		const covered = clips.filter(clip => clip.timelineStartFrame <= region.endFrame + 1
			&& clip.timelineStartFrame + clip.durationFrames >= region.startFrame - 1);
		for (const run of adjacentRuns(covered)) {
			const group = new Set(run);
			const intersecting = groups.filter(previous => run.some(id => previous.has(id)));
			for (const previous of intersecting) for (const id of previous) group.add(id);
			groups = groups.filter(previous => !intersecting.includes(previous));
			groups.push(group);
		}
	}
	const order = new Map(clips.map((clip, index) => [clip.id, index]));
	return groups.map(group => ({ type: 'clip/join' as const,
		clipIds: clips.filter(clip => group.has(clip.id)).map(clip => clip.id),
	})).sort((left, right) => order.get(left.clipIds[0]!)! - order.get(right.clipIds[0]!)!);
}

function adjacentRuns(clips: readonly JoinableClip[]): readonly (readonly string[])[] {
	const runs: string[][] = [];
	let current: string[] = [];
	let previousEndFrame: number | null = null;
	for (const clip of clips) {
		if (previousEndFrame !== null && clip.timelineStartFrame === previousEndFrame) current.push(clip.id);
		else {
			if (current.length > 1) runs.push(current);
			current = [clip.id];
		}
		previousEndFrame = clip.timelineStartFrame + clip.durationFrames;
	}
	if (current.length > 1) runs.push(current);
	return runs;
}
