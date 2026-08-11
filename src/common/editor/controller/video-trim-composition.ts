/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../commands/protocol.ts';
import { sourceMonitorTimecodeLabel } from '../source-monitor-model.ts';
import type { VideoSourceTimingView } from '../video-source-timing-view.ts';
import { resolveVideoSourceTimingViews } from '../video-source-timing-views.ts';
import type { EditorControllerLifetime } from './lifecycle.ts';
import type { VideoEdgeTrimFeedbackCopy } from './video-edge-trim-feedback.ts';
import { createVideoEdgeTrimResultReporter } from './video-edge-trim-feedback.ts';
import { createVideoEdgeTrimService, type VideoEdgeTrimService } from './video-edge-trim-service.ts';
import type { VideoRollRippleTrimFeedbackCopy } from './video-roll-ripple-trim-feedback.ts';
import { createVideoRollRippleTrimResultReporter } from './video-roll-ripple-trim-feedback.ts';
import {
	createVideoRollRippleTrimService,
	type VideoRollRippleTrimService,
} from './video-roll-ripple-trim-service.ts';
import type { VideoRateStretchFeedbackCopy } from './video-rate-stretch-feedback.ts';
import { createVideoRateStretchResultReporter } from './video-rate-stretch-feedback.ts';
import { createVideoRateStretchService, type VideoRateStretchService } from './video-rate-stretch-service.ts';
import type { VideoSlipSlideFeedbackCopy } from './video-slip-slide-feedback.ts';
import { createVideoSlipSlideResultReporter } from './video-slip-slide-feedback.ts';
import { createVideoSlipSlideService, type VideoSlipSlideService } from './video-slip-slide-service.ts';

export interface VideoTrimCompositionCopy
	extends VideoEdgeTrimFeedbackCopy,
		VideoRollRippleTrimFeedbackCopy,
		VideoSlipSlideFeedbackCopy,
		VideoRateStretchFeedbackCopy {}

export interface VideoTrimCompositionDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive'>;
	readonly copy: VideoTrimCompositionCopy;
	getProject(): unknown;
	/** Optional seam for focused composition tests; production resolves the captured project directly. */
	getTimingViews?(project: unknown): ReadonlyMap<string, VideoSourceTimingView>;
	editingBlocked(): boolean;
	commit(command: AudioEditorCommand): unknown;
	label(sample: number, sequenceId?: string): string;
	/** Optional seam for focused composition tests; production reads the source's persisted origin. */
	sourceLabel?(sourceId: string, sourceFrame: number): string;
	setStatus(message: string, state: 'info' | 'success'): void;
}

export interface VideoTrimServices {
	readonly edge: Readonly<VideoEdgeTrimService>;
	readonly rollRipple: Readonly<VideoRollRippleTrimService>;
	readonly slipSlide: Readonly<VideoSlipSlideService>;
	readonly rateStretch: Readonly<VideoRateStretchService>;
}

/** Compose all frame-canonical trim services without growing the application root. */
export function createVideoTrimServices(
	dependencies: VideoTrimCompositionDependencies,
): Readonly<VideoTrimServices> {
	const common = {
		lifetime: dependencies.lifetime,
		getProject: dependencies.getProject,
		editingBlocked: dependencies.editingBlocked,
		commit: dependencies.commit,
	};
	return Object.freeze({
		edge: createVideoEdgeTrimService({
			...common,
			reportResult: createVideoEdgeTrimResultReporter(dependencies),
		}),
		rollRipple: createVideoRollRippleTrimService({
			...common,
			reportResult: createVideoRollRippleTrimResultReporter(dependencies),
		}),
		slipSlide: createVideoSlipSlideService({
			...common,
			getTimingViews: dependencies.getTimingViews ?? resolveVideoSourceTimingViews,
			reportResult: createVideoSlipSlideResultReporter({
				copy: dependencies.copy,
				sourceLabel: dependencies.sourceLabel ?? ((sourceId, sourceFrame) => (
					liveSourceLabel(dependencies.getProject(), sourceId, sourceFrame)
				)),
				programLabel: dependencies.label,
				setStatus: dependencies.setStatus,
			}),
		}),
		rateStretch: createVideoRateStretchService({
			...common,
			getTimingViews: dependencies.getTimingViews ?? resolveVideoSourceTimingViews,
			reportResult: createVideoRateStretchResultReporter(dependencies),
		}),
	});
}

function liveSourceLabel(projectValue: unknown, sourceId: string, sourceFrame: number): string {
	if (!projectValue || typeof projectValue !== 'object' || Array.isArray(projectValue)) {
		throw new TypeError('A project is required to label a slip source frame.');
	}
	const project = projectValue as Readonly<Record<string, unknown>>;
	if (!Array.isArray(project.sources)) throw new TypeError('project.sources must be an array.');
	const source = project.sources.find((value) => (
		value !== null
		&& typeof value === 'object'
		&& !Array.isArray(value)
		&& (value as Readonly<Record<string, unknown>>).id === sourceId
	));
	if (!source) throw new ReferenceError(`Video source ${sourceId} is unavailable.`);
	return sourceMonitorTimecodeLabel(source, sourceFrame);
}
