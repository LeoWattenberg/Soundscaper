/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoSourceTimingView } from '../common/editor/video-source-timing-view.ts';
import type { UnifiedExactRenderPlanV13, UnifiedExactRenderPlanV14 } from '../common/editor/unified-exact-render-plan.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV28 } from './editor-project-unified-render-plan-v28.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';
import type { FramescaperProjectV28 } from './editor-project-v28.ts';
import type { FramescaperSelectedOpenFxExecutionV28 } from './selected-v28-openfx-exact-planes.ts';
import { createFramescaperVideoExportVisualFreshnessV27 } from './video-export-visual-freshness-v27.ts';

/** Rebuild V14 for the exact preview/export plane instead of reusing a differently sized queue plan. */
export function createFramescaperOpenFxPlanForFoundationV28(options: Readonly<{
	readonly profile: unknown;
	readonly project: FramescaperProjectV28;
	readonly foundationPlan: UnifiedExactRenderPlanV13;
	readonly timingViews: ReadonlyMap<string, VideoSourceTimingView>;
}>): UnifiedExactRenderPlanV14 {
	const plan = options.foundationPlan;
	const project = framescaperProjectV27FoundationShapeV28(options.project);
	return createFramescaperProjectUnifiedExactRenderPlanV28(options.profile, options.project, Object.freeze({
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
		visualFreshnessByModelId: createFramescaperVideoExportVisualFreshnessV27(project, {
			startFrame: plan.timebase.sampleStart, durationFrames: plan.timebase.sampleDuration,
		}),
	}));
}

export function createFramescaperOpenFxExecutionForFoundationV28(options: Readonly<{
	readonly profile: unknown;
	readonly project: FramescaperProjectV28;
	readonly foundationPlan: UnifiedExactRenderPlanV13;
	readonly timingViews: ReadonlyMap<string, VideoSourceTimingView>;
	readonly execute: FramescaperSelectedOpenFxExecutionV28['execute'];
	readonly resolveFrozenFrame?: FramescaperSelectedOpenFxExecutionV28['resolveFrozenFrame'];
}>): FramescaperSelectedOpenFxExecutionV28 {
	return Object.freeze({
		plan: createFramescaperOpenFxPlanForFoundationV28(options),
		execute: options.execute,
		...(options.resolveFrozenFrame ? { resolveFrozenFrame: options.resolveFrozenFrame } : {}),
	});
}
