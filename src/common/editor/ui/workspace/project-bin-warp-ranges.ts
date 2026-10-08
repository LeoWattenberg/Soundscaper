/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioWarpRuntimeEvaluator, type AudioWarpRuntimeClip, type AudioWarpRuntimeProject } from '../../audio-warp-runtime.ts';
import { projectForRuntimeConsumers } from '../../project-current-runtime.ts';
import { resolveRuntimeClipProjection, type RuntimeClipProject, type RuntimePersistedClip } from '../../runtime-clip-projection.ts';
import type { ProjectBinRange } from './project-bin-model.ts';

/** Sample each painted interval through the same source authority as playback. */
export function projectBinWarpRanges(
	projectValue: unknown,
	clipValue: unknown,
	maximumColumns: number,
	collect: (sourceStart: number, sourceDuration: number) => readonly ProjectBinRange[],
): ProjectBinRange[] {
	if (!projectValue) return [];
	const project = projectForRuntimeConsumers(projectValue as RuntimeClipProject);
	const clip = resolveRuntimeClipProjection(project, clipValue as RuntimePersistedClip);
	const evaluator = createAudioWarpRuntimeEvaluator(project as AudioWarpRuntimeProject, clip as AudioWarpRuntimeClip);
	const columns = Math.max(1, Math.min(maximumColumns, clip.durationFrames));
	const result: ProjectBinRange[] = [];
	for (let column = 0; column < columns; column += 1) {
		const from = evaluator.sourceAtTimelineFrame(clip.timelineStartFrame + Math.floor(column * clip.durationFrames / columns));
		const to = evaluator.sourceAtTimelineFrame(clip.timelineStartFrame + Math.ceil((column + 1) * clip.durationFrames / columns));
		const start = Math.floor(from.num / from.den);
		const end = Math.ceil(to.num / to.den);
		const ranges = collect(start, Math.max(1, end - start));
		if (ranges.length === 0) return [];
		result.push({ minimum: Math.min(...ranges.map(range => range.minimum)),
			maximum: Math.max(...ranges.map(range => range.maximum)) });
	}
	return result;
}
