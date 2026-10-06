/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveRuntimeClipProjection, type RuntimeClipProject, type RuntimePersistedClip } from '../runtime-clip-projection.ts';

export interface RegularIntervalDialogProject extends RuntimeClipProject {
	readonly id: string;
	readonly primarySequenceId: string;
	readonly sampleRate: number;
	readonly clips: readonly RuntimePersistedClip[];
}

export function regularIntervalDialogDefaults(project: RegularIntervalDialogProject | null) {
	let endFrame = 1;
	if (project) {
		for (const clip of project.clips) {
			const resolved = resolveRuntimeClipProjection(project, clip);
			endFrame = Math.max(endFrame, resolved.timelineEndFrame);
		}
	}
	return {
		kind: 'marker' as const,
		startFrame: 0,
		endFrame,
		intervalFrames: Math.max(1, Math.round(project?.sampleRate ?? 48_000)),
		namePrefix: 'Cue',
	};
}
