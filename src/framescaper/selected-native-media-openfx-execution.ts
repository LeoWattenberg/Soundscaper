/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoSourceTimingView } from '../common/editor/video-source-timing-view.ts';
import type { UnifiedExactRenderPlanV13, UnifiedExactRenderPlanV14 } from '../common/editor/unified-exact-render-plan.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from './editor-project-unified-render-plan-native-media.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import type { FramescaperProjectNativeMedia } from './editor-project-native-media.ts';
import type { FramescaperSelectedOpenFxExecutionNativeMedia } from './selected-native-media-openfx-exact-planes.ts';
import { createFramescaperVideoExportVisualFreshnessFinishing } from './video-export-visual-freshness-finishing.ts';

/** Rebuild V14 for the exact preview/export plane instead of reusing a differently sized queue plan. */
export function createFramescaperOpenFxPlanForFoundationNativeMedia(options: Readonly<{
	readonly profile: unknown;
	readonly project: FramescaperProjectNativeMedia;
	readonly foundationPlan: UnifiedExactRenderPlanV13;
	readonly timingViews: ReadonlyMap<string, VideoSourceTimingView>;
}>): UnifiedExactRenderPlanV14 {
	const plan = options.foundationPlan;
	const project = framescaperProjectFinishingFoundationShapeNativeMedia(options.project);
	return createFramescaperProjectUnifiedExactRenderPlanNativeMedia(options.profile, options.project, Object.freeze({
		sequenceId: plan.timebase.sequenceId,
		sampleStart: plan.timebase.sampleStart,
		sampleDuration: plan.timebase.sampleDuration,
		outputRate: plan.output.frameRate,
		format: Object.freeze({ container: 'mov', extension: 'mov', mimeType: 'video/quicktime' }),
		codecs: Object.freeze({
			video: 'prores', videoEncoder: 'prores_ks', audio: null, audioEncoder: null,
			pixelFormat: 'yuv422p10le',
		}),
		canvas: Object.freeze({ ...plan.output.canvas, pixelFormat: 'yuv422p10le' }),
		quality: plan.output.quality, includeAudio: false, audioLayout: null,
		timingViews: options.timingViews,
		visualFreshnessByModelId: createFramescaperVideoExportVisualFreshnessFinishing(project, {
			startFrame: plan.timebase.sampleStart, durationFrames: plan.timebase.sampleDuration,
		}),
	}));
}

export function createFramescaperOpenFxExecutionForFoundationNativeMedia(options: Readonly<{
	readonly profile: unknown;
	readonly project: FramescaperProjectNativeMedia;
	readonly foundationPlan: UnifiedExactRenderPlanV13;
	readonly timingViews: ReadonlyMap<string, VideoSourceTimingView>;
	readonly execute: FramescaperSelectedOpenFxExecutionNativeMedia['execute'];
	readonly resolveFrozenFrame?: FramescaperSelectedOpenFxExecutionNativeMedia['resolveFrozenFrame'];
}>): FramescaperSelectedOpenFxExecutionNativeMedia {
	return Object.freeze({
		plan: createFramescaperOpenFxPlanForFoundationNativeMedia(options),
		execute: options.execute,
		...(options.resolveFrozenFrame ? { resolveFrozenFrame: options.resolveFrozenFrame } : {}),
	});
}
