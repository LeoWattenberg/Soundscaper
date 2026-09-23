/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioWarpRuntimeClip, AudioWarpRuntimeProject } from '../../../audio-warp-runtime.ts';
import type { SourceLifecycleClip, SourceLifecycleProject } from './source-lifecycle-types.d.ts';

export function isAudioWarpRuntimeProject(
	project: SourceLifecycleProject,
): project is SourceLifecycleProject & AudioWarpRuntimeProject {
	const tempoMap = project.tempoMap;
	return Number.isSafeInteger(project.sampleRate) && Number(project.sampleRate) > 0
		&& typeof tempoMap === 'object' && tempoMap !== null
		&& 'events' in tempoMap && Array.isArray(tempoMap.events) && tempoMap.events.length > 0;
}

export function isAudioWarpRuntimeClip(
	clip: SourceLifecycleClip,
): clip is SourceLifecycleClip & AudioWarpRuntimeClip {
	return clip.kind === 'audio'
		&& Number.isSafeInteger(clip.timelineStartFrame) && Number(clip.timelineStartFrame) >= 0
		&& Number.isSafeInteger(clip.durationFrames) && Number(clip.durationFrames) > 0
		&& Number.isSafeInteger(clip.sourceStartFrame) && Number(clip.sourceStartFrame) >= 0
		&& Number.isSafeInteger(clip.sourceDurationFrames) && Number(clip.sourceDurationFrames) > 0;
}
