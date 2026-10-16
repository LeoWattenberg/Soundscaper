/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAudioWarpRuntimeInputs } from './audio-warp-runtime-authority.ts';
import { renderExactAudioWarpPcm } from './audio-warp-render-parity.ts';
import type { AudioWarpRuntimeClip, AudioWarpRuntimeProject } from './audio-warp-runtime.ts';
import type { AudioWarpMap } from './audio-warp-domain.ts';
import { scaleSampleFrame } from './timeline-time.ts';

export interface Aup4WarpMaterial {
	readonly project: AudioWarpRuntimeProject;
	readonly clip: AudioWarpRuntimeClip & Readonly<{ warpMap: Readonly<AudioWarpMap> }>;
}

/** Capture only the timing authority needed to bake one clip's visible warped samples. */
export function aup4WarpMaterial(
	project: AudioWarpRuntimeProject,
	clip: AudioWarpRuntimeClip,
): Aup4WarpMaterial | null {
	if (clip.warpMap == null) return null;
	const authority = normalizeAudioWarpRuntimeInputs(project, clip);
	return {
		project: { sampleRate: project.sampleRate, tempoMap: project.tempoMap },
		clip: {
			kind: 'audio', anchor: clip.anchor, timelineStartFrame: clip.timelineStartFrame,
			durationFrames: clip.durationFrames, sourceStartFrame: clip.sourceStartFrame,
			sourceDurationFrames: clip.sourceDurationFrames, reversed: false, warpMap: authority.map,
			musicalStartBeat: clip.musicalStartBeat, musicalExtent: clip.musicalExtent,
			musicalDurationBeats: clip.musicalDurationBeats,
		},
	};
}

export function aup4WarpMaterialFrameCount(material: Aup4WarpMaterial, outputRate: number): number {
	return Math.max(1, scaleSampleFrame(material.clip.durationFrames, material.project.sampleRate, outputRate));
}

/** Render original source PCM in the project clock before the existing native-rate resampler. */
export function renderAup4WarpMaterial(
	channels: readonly Float32Array[],
	material: Aup4WarpMaterial,
	sourceRate: number,
): readonly Float32Array[] {
	return renderExactAudioWarpPcm(material.project, material.clip, {
		startFrame: material.clip.timelineStartFrame,
		endFrame: material.clip.timelineStartFrame + material.clip.durationFrames,
		sourceSampleRate: sourceRate,
	}, channels);
}
