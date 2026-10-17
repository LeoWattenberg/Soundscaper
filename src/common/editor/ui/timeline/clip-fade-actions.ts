/* SPDX-License-Identifier: AGPL-3.0-only */

import { fadeField } from './clip-fade-geometry.ts';
import type { ClipFadeEdge } from './clip-fade-geometry.ts';
import {
	clipFadeEditsCommand, clipFadeEditsPreviews, planSelectedClipFadeEdits,
	planSelectedClipFadeCommand,
} from './selected-clip-fades.ts';
import type { ClipFadeTarget, SelectedClipFadeChanges, SelectedClipFadeEdit } from './selected-clip-fades.ts';

interface FadeProject {
	readonly clips: readonly ClipFadeTarget[];
	readonly tracks: readonly Readonly<{ id: string; clipIds?: readonly string[] }>[];
	readonly selection?: Readonly<{ clipIds?: readonly string[] }>;
}

interface FadeSession {
	readonly clipId: string;
	readonly original: ClipFadeTarget;
	readonly fadeTargets?: readonly ClipFadeTarget[];
}

export function clipFadeChangeCommand(project: FadeProject, clipId: string, sampleRate: number,
	changes: SelectedClipFadeChanges, editedEdge?: ClipFadeEdge) {
	return planSelectedClipFadeCommand({ clips: project.clips, editedClipId: clipId,
		selectedIds: project.selection?.clipIds ?? [], sampleRate,
		edit: editedEdge ? { kind: 'length', edge: editedEdge, frames: changes[fadeField(editedEdge)] ?? 0 }
			: { kind: 'properties', changes },
	});
}

/** Captured targets keep the same native participants throughout one pointer gesture. */
export function clipFadeSessionPreviews(session: FadeSession, project: FadeProject, sampleRate: number, edit: SelectedClipFadeEdit) {
	const clips = session.fadeTargets ?? [session.original];
	const edits = planSelectedClipFadeEdits({ clips, editedClipId: session.clipId,
		selectedIds: clips.map(clip => clip.id), sampleRate, edit });
	const owners = new Map(project.tracks.flatMap(track => (track.clipIds ?? []).map(id => [id, track.id] as const)));
	return { previews: clipFadeEditsPreviews(edits, owners) };
}

/** Reject stale captured fades before native batch validation and lock admission. */
export function clipFadeSessionCommand(session: FadeSession, project: FadeProject, sampleRate: number, edit: SelectedClipFadeEdit) {
	const clips = session.fadeTargets ?? [session.original];
	for (const original of clips) {
		const current = project.clips.find(clip => clip.id === original.id);
		if (!current || (['timelineStartFrame', 'durationFrames', 'fadeInFrames', 'fadeOutFrames', 'fadeInShape', 'fadeOutShape'] as const)
			.some(field => current[field] !== original[field])) return null;
	}
	return clipFadeEditsCommand(planSelectedClipFadeEdits({ clips, editedClipId: session.clipId,
		selectedIds: clips.map(clip => clip.id), sampleRate, edit }));
}
