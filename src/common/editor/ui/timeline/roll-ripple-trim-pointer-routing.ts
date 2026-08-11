/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FrameCanonicalTrimEdge } from '../../frame-canonical-edge-trim-domain.ts';
import type {
	FrameCanonicalRollRippleTrimMode,
	FrameCanonicalRollRippleTrimPlan,
	FrameCanonicalRollRippleTrimPreview,
	FrameCanonicalRollRippleTrimRequest,
} from '../../frame-canonical-roll-ripple-trim-domain.ts';
import type { TimelineTrimPointerSession } from './trim-pointer-routing.ts';

export interface TimelineRollRippleTrimPointerSession extends TimelineTrimPointerSession {
	readonly rollRippleMode?: FrameCanonicalRollRippleTrimMode | null;
}

export interface TimelineRollRippleTrimPointerCaptureInput {
	readonly session: TimelineTrimPointerSession;
	readonly canonicalVideoTrim: boolean;
	readonly pointerType: string;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
}

export interface TimelineRollRippleTrimPointerPreviewInput {
	readonly session: TimelineRollRippleTrimPointerSession;
	readonly edge: FrameCanonicalTrimEdge;
	readonly requestedBoundarySample: number;
	previewRollRipple(
		request: FrameCanonicalRollRippleTrimRequest,
	): FrameCanonicalRollRippleTrimPlan | null;
	/** Resolve planner-added participants that were absent from the pointer-down closure. */
	clipKind?(clipId: string): 'audio' | 'video' | null;
	previewOrdinary(): unknown;
}

export interface TimelineRollRippleTrimPointerCommitInput {
	readonly session: TimelineRollRippleTrimPointerSession;
	readonly edge: FrameCanonicalTrimEdge;
	readonly requestedBoundarySample: number;
	commitRollRipple(request: FrameCanonicalRollRippleTrimRequest): unknown;
	commitOrdinary(): unknown;
}

export interface TimelineRollRippleTrimAdaptedPreview
	extends FrameCanonicalRollRippleTrimPreview {
	readonly waveformPreviewKind?: 'trim';
}

export type TimelineRollRippleTrimPointerPreview = Readonly<
	TimelineRollRippleTrimAdaptedPreview & {
		readonly previews: readonly Readonly<TimelineRollRippleTrimAdaptedPreview>[];
		readonly guideSample: number;
	}
>;

/** Capture modifier meaning once at pointer-down; later modifier changes are irrelevant. */
export function captureTimelineRollRippleTrimPointerMode(
	input: TimelineRollRippleTrimPointerCaptureInput,
): FrameCanonicalRollRippleTrimMode | null {
	if (!input.canonicalVideoTrim
		|| input.pointerType === 'touch'
		|| !input.altKey
		|| !videoBearing(input.session)) return null;
	return input.shiftKey ? 'ripple' : 'roll';
}

/** Route a captured gesture to the frame-canonical planner and adapt every preview. */
export function resolveTimelineRollRippleTrimPointerPreview(
	input: TimelineRollRippleTrimPointerPreviewInput,
): TimelineRollRippleTrimPointerPreview | unknown | null {
	const mode = capturedMode(input.session);
	if (mode === null) return input.previewOrdinary();
	const plan = input.previewRollRipple(trimRequest(
		mode,
		input.session.clipId,
		input.edge,
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
		guideSample: plan.resolvedSourceCutSample,
	}) : null;
}

/** Commit from the final absolute pointer point through a fresh controller replan. */
export function commitTimelineRollRippleTrimPointer(
	input: TimelineRollRippleTrimPointerCommitInput,
): unknown {
	const mode = capturedMode(input.session);
	return mode === null
		? input.commitOrdinary()
		: input.commitRollRipple(trimRequest(
			mode,
			input.session.clipId,
			input.edge,
			input.requestedBoundarySample,
		));
}

function capturedMode(
	session: TimelineRollRippleTrimPointerSession,
): FrameCanonicalRollRippleTrimMode | null {
	return session.rollRippleMode === 'roll' || session.rollRippleMode === 'ripple'
		? session.rollRippleMode
		: null;
}

function adaptPreview(
	session: TimelineRollRippleTrimPointerSession,
	preview: FrameCanonicalRollRippleTrimPreview,
	clipKind: TimelineRollRippleTrimPointerPreviewInput['clipKind'],
): Readonly<TimelineRollRippleTrimAdaptedPreview> {
	const kind = clipKind?.(preview.clipId) ?? mediaKind(session.originals?.[preview.clipId]);
	return kind === 'audio' && preview.changeKind === 'source-trim'
		? Object.freeze({ ...preview, waveformPreviewKind: 'trim' })
		: Object.freeze({ ...preview });
}

function mediaKind(value: Readonly<Record<string, unknown>> | undefined): 'audio' | 'video' | null {
	return value?.kind === 'audio' || value?.kind === 'video' ? value.kind : null;
}

function videoBearing(session: TimelineTrimPointerSession): boolean {
	return session.original.kind === 'video'
		|| session.clipIds.some((clipId) => session.originals?.[clipId]?.kind === 'video');
}

function trimRequest(
	mode: FrameCanonicalRollRippleTrimMode,
	activeClipId: string,
	edge: FrameCanonicalTrimEdge,
	requestedBoundarySample: number,
): Readonly<FrameCanonicalRollRippleTrimRequest> {
	return Object.freeze({ mode, activeClipId, edge, requestedBoundarySample });
}
