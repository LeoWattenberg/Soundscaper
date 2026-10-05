/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoKeyframeExportPresentationResolver } from '../common/editor/video-keyframe-export-frame-source.ts';
import { createVideoKeyframeExportPresentationAuthority } from '../common/editor/video-keyframe-export-presentation-authority.ts';
import { createVideoRetimeWebCoreOrdinalAuthority } from '../common/editor/video-retime-web-core-ordinal-authority.ts';
import type { BoundVideoSourceTimingView } from '../common/editor/video-source-timing-view.ts';
import { videoTimelineDurationFrames } from '../common/editor/video-timeline.js';

const WINDOW_SAMPLES = 1_000_000;

/** Keep audio-rate preview ordinals bounded while retaining the export oracle's absolute sample phase. */
export function createSelectedFinishingPreviewSamplePresentation(options: Readonly<{
	readonly project: Readonly<Record<string, unknown>>;
	readonly runtimeProject: Readonly<Record<string, unknown>>;
	readonly timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>;
}>): Readonly<{ resolvePresentationDescriptor: VideoKeyframeExportPresentationResolver }> {
	const sampleRate = options.runtimeProject.sampleRate;
	if (!Number.isSafeInteger(sampleRate) || Number(sampleRate) < 1) {
		throw new RangeError('Selected preview sample rate must be a positive safe integer.');
	}
	const endSample = videoTimelineDurationFrames(options.runtimeProject);
	let windowStart = -1;
	let presentation: ReturnType<typeof createVideoKeyframeExportPresentationAuthority> | null = null;
	return Object.freeze({
		resolvePresentationDescriptor(request) {
			const sample = request.outputOrdinal;
			if (!Number.isSafeInteger(sample) || Number(sample) < 0 || Number(sample) >= endSample) {
				throw new RangeError('Selected preview sample is outside its video timeline.');
			}
			const nextStart = Math.floor(Number(sample) / WINDOW_SAMPLES) * WINDOW_SAMPLES;
			if (nextStart !== windowStart || presentation === null) {
				presentation = createVideoKeyframeExportPresentationAuthority({
					project: options.project,
					timingBySourceId: options.timingBySourceId,
					exactOrdinalAuthority: createVideoRetimeWebCoreOrdinalAuthority({
						project: options.runtimeProject,
						timingBySourceId: options.timingBySourceId,
						startFrame: nextStart,
						endFrame: Math.min(endSample, nextStart + WINDOW_SAMPLES),
						outputRate: { num: Number(sampleRate), den: 1 },
					}),
				});
				windowStart = nextStart;
			}
			return presentation.resolvePresentationDescriptor({
				...request, outputOrdinal: Number(sample) - windowStart,
			});
		},
	});
}
