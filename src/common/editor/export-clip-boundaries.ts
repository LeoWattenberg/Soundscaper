/* SPDX-License-Identifier: AGPL-3.0-only */

import { projectForRuntimeConsumers } from './project-current-runtime.ts';
import type { RuntimeClipProject } from './runtime-clip-projection.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export interface ExportClip {
	readonly name: string;
	readonly trackId: string;
	readonly clipId: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly durationFrames: number;
}

interface ExportClipRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

/** One file per audible clip, in its owning track's document order. */
export function resolveExportClips(projectValue: unknown, range: ExportClipRange): readonly ExportClip[] {
	const project = projectForRuntimeConsumers(projectValue as RuntimeClipProject);
	const byId = new Map(project.clips.map((clip) => [clip.id, clip]));
	const clips: ExportClip[] = [];
	for (const value of project.tracks) {
		const track = value as DataRecord;
		if (track.type !== 'audio' || !Array.isArray(track.clipIds)) continue;
		for (const id of track.clipIds as readonly unknown[]) {
			const clip = byId.get(id);
			if (!clip || (clip.kind !== undefined && clip.kind !== 'audio')) continue;
			const startFrame = Math.max(clip.timelineStartFrame, range.startFrame);
			const endFrame = Math.min(clip.timelineEndFrame, range.endFrame);
			if (endFrame <= startFrame) continue;
			clips.push(Object.freeze({
				name: String(clip.title ?? ''), trackId: String(track.id), clipId: String(clip.id),
				startFrame, endFrame, durationFrames: endFrame - startFrame,
			}));
		}
	}
	if (!clips.length) throw new RangeError('No audio clip falls inside the delivered range, so there is no clip to write.');
	return Object.freeze(clips);
}

/** Allow the export dialog to offer clips only when audio clips are available. */
export function exportClipCount(projectValue: unknown): number {
	try {
		return resolveExportClips(projectValue, { startFrame: 0, endFrame: Number.MAX_SAFE_INTEGER }).length;
	} catch {
		return 0;
	}
}
