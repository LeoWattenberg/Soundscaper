/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic clipping of accepted Reframe paths into exact Highlight ranges. */

import type { AssistanceAcceptedReframeDerivativeV1 } from './reframe-derivative-v1.ts';
import type { AssistanceOwnedHighlightCropKeyframeV1 } from
	'./owned-video-highlight-transform-types-v1.ts';
import type { ReviewedAssistanceSourceTimeRowsV1 } from './source-time-rows-v1.ts';
import {
	interpolateAssistanceReframeCropV1,
	planAssistanceReframePathV1,
} from './reframe-planner-v1.ts';

interface VideoGeometry {
	readonly sourceId: string;
	readonly timescale: number;
	readonly sourceSize: Readonly<{ width: number; height: number }>;
	readonly selectionStartFrame: number;
	readonly selectionEndFrame: number;
	readonly authority: ReviewedAssistanceSourceTimeRowsV1;
}

export function createOwnedHighlightCropKeyframesV1(request: Readonly<{
	readonly video: VideoGeometry & Readonly<{
		readonly reframeEvidence: AssistanceAcceptedReframeDerivativeV1 | null;
	}>;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly targetAspect: Readonly<{ width: number; height: number }>;
}>): readonly AssistanceOwnedHighlightCropKeyframeV1[] {
	if (request.sourceEndFrame - request.sourceStartFrame < 2) {
		throw new RangeError('A highlight proposal needs two exact source crop anchors.');
	}
	if (request.video.reframeEvidence === null) {
		const center = planAssistanceReframePathV1({ sourceSize: request.video.sourceSize,
			targetAspect: request.targetAspect, samples: [
				{ sourceFrame: request.sourceStartFrame, subjects: [], saliency: null },
				{ sourceFrame: request.sourceEndFrame - 1, subjects: [], saliency: null },
			] }).map(({ schemaVersion: _, ...keyframe }) => keyframe);
		return Object.freeze(center);
	}
	const result = request.video.reframeEvidence.result;
	if (result.path.targetAspect.width !== request.targetAspect.width
		|| result.path.targetAspect.height !== request.targetAspect.height) {
		throw new RangeError('Accepted Reframe evidence disagrees with Highlight target aspect.');
	}
	const path = result.path.keyframes;
	const endFrame = request.sourceEndFrame - 1;
	const interpolationPath = path.map((keyframe) => ({ schemaVersion: 1 as const, ...keyframe }));
	const boundary = (sourceFrame: number): AssistanceOwnedHighlightCropKeyframeV1 => {
		const exact = path.find((keyframe) => keyframe.sourceFrame === sourceFrame);
		return exact ?? Object.freeze({ sourceFrame, authority: 'center' as const,
			trackIds: Object.freeze([]),
			crop: interpolateAssistanceReframeCropV1(interpolationPath, sourceFrame) });
	};
	const cropKeyframes = Object.freeze([
		boundary(request.sourceStartFrame),
		...path.filter(({ sourceFrame }) => sourceFrame > request.sourceStartFrame
			&& sourceFrame < endFrame),
		boundary(endFrame),
	]);
	assertOwnedHighlightCropAspectV1(cropKeyframes, request.video.sourceSize,
		request.targetAspect);
	return cropKeyframes;
}

export function assertOwnedHighlightReframeVideoAuthorityV1(
	evidence: AssistanceAcceptedReframeDerivativeV1,
	video: VideoGeometry,
): void {
	const range = evidence.authority.sourceRange;
	if (range.sourceId !== video.sourceId
		|| evidence.result.authority.width !== video.sourceSize.width
		|| evidence.result.authority.height !== video.sourceSize.height
		|| evidence.result.authority.timescale !== video.timescale
		|| video.authority.first.sourceFrame !== range.sourceStartFrame
		|| video.authority.last.sourceFrame !== range.sourceEndFrame
		|| video.authority.first.timelineFrame !== video.selectionStartFrame
		|| video.authority.last.timelineFrame !== video.selectionEndFrame) {
		throw new RangeError('Accepted Reframe evidence disagrees with Highlight video geometry.');
	}
	if (evidence.result.authority.frames.some(({ sourceFrame, presentationTick }) =>
		sourcePresentationTick(video.authority, sourceFrame) !== presentationTick)) {
		throw new RangeError('Accepted Reframe evidence disagrees with Highlight source time.');
	}
}

function sourcePresentationTick(
	authority: ReviewedAssistanceSourceTimeRowsV1,
	sourceFrame: number,
): string | undefined {
	const index = authority.firstAtOrAfterSource(sourceFrame);
	return index < authority.rowCount && authority.row(index).sourceFrame === sourceFrame
		? authority.row(index).presentationTick : undefined;
}

export function assertOwnedHighlightCropAspectV1(
	keyframes: readonly AssistanceOwnedHighlightCropKeyframeV1[],
	sourceSize: Readonly<{ width: number; height: number }>,
	targetAspect: Readonly<{ width: number; height: number }>,
): void {
	const expected = targetAspect.width / targetAspect.height;
	for (const { crop } of keyframes) {
		const width = sourceSize.width * (1 - crop.left - crop.right);
		const height = sourceSize.height * (1 - crop.top - crop.bottom);
		if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0
			|| Math.abs(width / height - expected) > Math.max(1, expected) * 1e-8) {
			throw new RangeError('Highlight crop evidence disagrees with authenticated target aspect.');
		}
	}
}
