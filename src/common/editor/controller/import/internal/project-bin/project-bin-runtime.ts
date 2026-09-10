/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveRuntimeClipProjection } from '../../../../runtime-clip-projection.ts';
import { scaleSampleFrame } from '../../../../timeline-time.ts';
import type { ProjectBinClip, ProjectBinProject, ProjectBinSource } from '../../project-bin-types.ts';

/** Preview geometry is sample anchored even when the authored bin clip follows beats. */
export function resolveProjectBinAudioPreviewClip(project: ProjectBinProject, clip: ProjectBinClip) {
	const resolved = resolveRuntimeClipProjection(project, clip);
	return { ...resolved, anchor: 'sample' as const, timelineStartFrame: 0 };
}

export function projectBinReplacementShortensClip(
	project: ProjectBinProject, clip: ProjectBinClip, oldSource: ProjectBinSource, newSource: ProjectBinSource,
): boolean {
	const resolved = resolveRuntimeClipProjection(project, clip);
	const count = newSource.sampleFrameCount ?? newSource.frameCount;
	if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) {
		throw new TypeError('A replacement source requires a finite sample extent.');
	}
	const newRate = Math.max(1, newSource.sampleRate || project.sampleRate);
	const oldRate = Math.max(1, oldSource.sampleRate || project.sampleRate);
	const start = scaleSampleFrame(resolved.sourceStartFrame, oldRate, newRate, 'point');
	const duration = scaleSampleFrame(resolved.sourceDurationFrames, oldRate, newRate, 'point');
	return start + duration > count;
}
