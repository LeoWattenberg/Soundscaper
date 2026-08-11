/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FrameCanonicalTrimEdge } from '../../frame-canonical-edge-trim-domain.ts';
import type {
	FrameCanonicalRateStretchPlan,
	FrameCanonicalRateStretchPreview,
	FrameCanonicalRateStretchRequest,
} from '../../frame-canonical-rate-stretch-domain.ts';
import type { TimelineTrimPointerSession } from './trim-pointer-routing.ts';

export interface TimelineRateStretchPointerSession extends TimelineTrimPointerSession {
	readonly kind?: string;
}

export interface TimelineRateStretchRouteInput {
	readonly session: TimelineRateStretchPointerSession;
	readonly canonicalVideoTrim: boolean;
}

export interface TimelineRateStretchPointerPreviewInput extends TimelineRateStretchRouteInput {
	readonly requestedBoundarySample: number;
	previewRateStretch(request: FrameCanonicalRateStretchRequest): FrameCanonicalRateStretchPlan | null;
	/** Resolve planner-added participants that were absent from the pointer-down closure. */
	clipKind?(clipId: string): 'audio' | 'video' | null;
	previewOrdinary(): unknown;
}

export interface TimelineRateStretchPointerCommitInput extends TimelineRateStretchRouteInput {
	readonly requestedBoundarySample: number;
	commitRateStretch(request: FrameCanonicalRateStretchRequest): unknown;
	commitOrdinary(): unknown;
}

export interface TimelineRateStretchAdaptedPreview extends FrameCanonicalRateStretchPreview {
	readonly rateStretchPreview: true;
	readonly waveformPreviewKind?: 'rate-stretch';
}

export type TimelineRateStretchPointerPreview = Readonly<
	TimelineRateStretchAdaptedPreview & {
		readonly previews: readonly Readonly<TimelineRateStretchAdaptedPreview>[];
		readonly rateStretchGuideSample: number;
		readonly rateStretchGuideEdge: FrameCanonicalTrimEdge;
	}
>;

/** Only Framescaper's existing video stretch handles own this canonical route. */
export function usesFrameCanonicalTimelineRateStretch(
	input: TimelineRateStretchRouteInput,
): boolean {
	return input.canonicalVideoTrim === true
		&& input.session.original.kind === 'video'
		&& stretchEdge(input.session) !== null;
}

/** Plan from one absolute edge point and adapt every relation participant. */
export function resolveTimelineRateStretchPointerPreview(
	input: TimelineRateStretchPointerPreviewInput,
): TimelineRateStretchPointerPreview | unknown | null {
	if (!usesFrameCanonicalTimelineRateStretch(input)) return input.previewOrdinary();
	const edge = stretchEdge(input.session);
	if (edge === null) return input.previewOrdinary();
	const plan = input.previewRateStretch(rateStretchRequest(
		input.session.clipId,
		edge,
		input.requestedBoundarySample,
	));
	if (!plan || plan.kind === 'noop') return null;
	const previews = Object.freeze(plan.previews.map((preview) => (
		adaptPreview(input.session, preview, input.clipKind)
	)));
	const active = previews.find(({ clipId }) => clipId === input.session.clipId);
	return active ? Object.freeze({
		...active,
		previews,
		rateStretchGuideSample: plan.boundarySample,
		rateStretchGuideEdge: edge,
	}) : null;
}

/** Rebuild the final absolute request so preview transforms can never commit. */
export function commitTimelineRateStretchPointer(
	input: TimelineRateStretchPointerCommitInput,
): unknown {
	if (!usesFrameCanonicalTimelineRateStretch(input)) return input.commitOrdinary();
	const edge = stretchEdge(input.session);
	return edge === null ? input.commitOrdinary() : input.commitRateStretch(rateStretchRequest(
		input.session.clipId,
		edge,
		input.requestedBoundarySample,
	));
}

function adaptPreview(
	session: TimelineRateStretchPointerSession,
	preview: FrameCanonicalRateStretchPreview,
	clipKind: TimelineRateStretchPointerPreviewInput['clipKind'],
): Readonly<TimelineRateStretchAdaptedPreview> {
	const kind = clipKind?.(preview.clipId) ?? mediaKind(session.originals?.[preview.clipId]);
	return Object.freeze({
		...preview,
		rateStretchPreview: true as const,
		...(kind === 'audio' ? { waveformPreviewKind: 'rate-stretch' as const } : {}),
	});
}

function stretchEdge(session: TimelineRateStretchPointerSession): FrameCanonicalTrimEdge | null {
	if (session.kind === 'stretch-left') return 'left';
	if (session.kind === 'stretch-right') return 'right';
	return null;
}

function mediaKind(value: Readonly<Record<string, unknown>> | undefined): 'audio' | 'video' | null {
	return value?.kind === 'audio' || value?.kind === 'video' ? value.kind : null;
}

function rateStretchRequest(
	activeClipId: string,
	edge: FrameCanonicalTrimEdge,
	requestedBoundarySample: number,
): Readonly<FrameCanonicalRateStretchRequest> {
	return Object.freeze({ activeClipId, edge, requestedBoundarySample });
}
