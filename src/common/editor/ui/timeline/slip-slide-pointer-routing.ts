/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FrameCanonicalSlipSlideMode,
	FrameCanonicalSlipSlidePlan,
	FrameCanonicalSlipSlidePreview,
	FrameCanonicalSlipSlideRequest,
} from '../../frame-canonical-slip-slide-domain.ts';
import {
	buildFrameCanonicalSlipSlidePointerRequest,
	type FrameCanonicalSlipSlidePointerAuthority,
	type FrameCanonicalSlipSlidePointerCapture,
} from '../../frame-canonical-slip-slide-pointer-request.ts';
import type { TimelineTrimPointerSession } from './trim-pointer-routing.ts';

export interface TimelineSlipSlidePointerSession extends TimelineTrimPointerSession {
	readonly kind?: string;
	readonly slipSlideMode?: FrameCanonicalSlipSlideMode | null;
	readonly slipSlidePointerAuthority?: FrameCanonicalSlipSlidePointerAuthority | null;
}

export interface TimelineSlipSlidePointerCaptureInput {
	readonly session: TimelineSlipSlidePointerSession;
	readonly canonicalVideoTrim: boolean;
	readonly pointerType: string;
	readonly isPrimary: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly pointerDownSample: number;
	capturePointerAuthority(
		capture: FrameCanonicalSlipSlidePointerCapture,
	): FrameCanonicalSlipSlidePointerAuthority | null | undefined;
}

export interface TimelineSlipSlidePointerGesture {
	readonly mode: FrameCanonicalSlipSlideMode;
	readonly authority: FrameCanonicalSlipSlidePointerAuthority | null;
}

export interface TimelineSlipSlidePointerPreviewInput {
	readonly session: TimelineSlipSlidePointerSession;
	readonly currentPointerSample: number;
	previewSlipSlide(request: FrameCanonicalSlipSlideRequest): FrameCanonicalSlipSlidePlan | null;
	/** Resolve planner-added participants that were absent from the pointer-down closure. */
	clipKind?(clipId: string): 'audio' | 'video' | null;
	previewOrdinary(): unknown;
}

export interface TimelineSlipSlidePointerCommitInput {
	readonly session: TimelineSlipSlidePointerSession;
	readonly currentPointerSample: number;
	commitSlipSlide(request: FrameCanonicalSlipSlideRequest): unknown;
	commitOrdinary(): unknown;
}

export interface TimelineSlipSlideAdaptedPreview extends FrameCanonicalSlipSlidePreview {
	readonly slipSlideMode: FrameCanonicalSlipSlideMode;
	readonly sourceSlipPreview?: true;
	readonly waveformPreviewKind?: 'trim';
}

export interface TimelineSlideGuideSamples {
	readonly start: number;
	readonly end: number;
}

export type TimelineSlipSlidePointerPreview = Readonly<
	TimelineSlipSlideAdaptedPreview & {
		readonly previews: readonly Readonly<TimelineSlipSlideAdaptedPreview>[];
		readonly guideSamples?: Readonly<TimelineSlideGuideSamples>;
	}
>;

/** Resolve the exact body chord before asking the controller to capture authority. */
export function captureTimelineSlipSlidePointerGesture(
	input: TimelineSlipSlidePointerCaptureInput,
): Readonly<TimelineSlipSlidePointerGesture> | null {
	const mode = pointerMode(input);
	if (mode === null) return null;
	const capture = Object.freeze({
		mode,
		activeClipId: input.session.clipId,
		pointerDownSample: input.pointerDownSample,
	});
	const authority = input.capturePointerAuthority(capture) ?? null;
	if (authority && (authority.mode !== mode
		|| authority.activeClipId !== input.session.clipId
		|| authority.pointerDownSample !== input.pointerDownSample)) {
		throw new RangeError('Captured slip/slide pointer authority disagrees with its gesture.');
	}
	return Object.freeze({ mode, authority });
}

/** Route a captured gesture to the planner and adapt every participant preview. */
export function resolveTimelineSlipSlidePointerPreview(
	input: TimelineSlipSlidePointerPreviewInput,
): TimelineSlipSlidePointerPreview | unknown | null {
	const mode = capturedMode(input.session);
	if (mode === null) return input.previewOrdinary();
	const authority = capturedAuthority(input.session, mode);
	if (authority === null) return null;
	const plan = input.previewSlipSlide(buildFrameCanonicalSlipSlidePointerRequest(
		authority,
		input.currentPointerSample,
	));
	if (!plan || plan.kind === 'noop') return null;
	if (plan.mode !== mode) throw new RangeError('Slip/slide preview mode disagrees with its gesture.');
	const previews = Object.freeze(plan.previews.map((preview) => (
		adaptPreview(input.session, mode, preview, input.clipKind)
	)));
	const active = previews.find(({ clipId }) => clipId === input.session.clipId);
	if (!active) return null;
	return Object.freeze({
		...active,
		previews,
		...(plan.mode === 'slide' ? {
			guideSamples: Object.freeze({
				start: plan.appliedStartSample,
				end: plan.appliedEndSample,
			}),
		} : {}),
	});
}

/** Build from the final absolute pointer point, then ask the controller to replan live. */
export function commitTimelineSlipSlidePointer(
	input: TimelineSlipSlidePointerCommitInput,
): unknown {
	const mode = capturedMode(input.session);
	if (mode === null) return input.commitOrdinary();
	const authority = capturedAuthority(input.session, mode);
	return authority === null ? null : input.commitSlipSlide(
		buildFrameCanonicalSlipSlidePointerRequest(authority, input.currentPointerSample),
	);
}

function pointerMode(
	input: TimelineSlipSlidePointerCaptureInput,
): FrameCanonicalSlipSlideMode | null {
	if (input.session.kind !== 'move'
		|| input.canonicalVideoTrim !== true
		|| input.isPrimary !== true
		|| input.pointerType === 'touch'
		|| input.altKey !== true
		|| input.ctrlKey
		|| input.metaKey
		|| !videoBearing(input.session)) return null;
	return input.shiftKey ? 'slide' : 'slip';
}

function capturedMode(
	session: TimelineSlipSlidePointerSession,
): FrameCanonicalSlipSlideMode | null {
	return session.slipSlideMode === 'slip' || session.slipSlideMode === 'slide'
		? session.slipSlideMode
		: null;
}

function capturedAuthority(
	session: TimelineSlipSlidePointerSession,
	mode: FrameCanonicalSlipSlideMode,
): FrameCanonicalSlipSlidePointerAuthority | null {
	const authority = session.slipSlidePointerAuthority;
	if (!authority) return null;
	if (authority.mode !== mode || authority.activeClipId !== session.clipId) {
		throw new RangeError('Slip/slide pointer session authority is stale or mismatched.');
	}
	return authority;
}

function adaptPreview(
	session: TimelineSlipSlidePointerSession,
	mode: FrameCanonicalSlipSlideMode,
	preview: FrameCanonicalSlipSlidePreview,
	clipKind: TimelineSlipSlidePointerPreviewInput['clipKind'],
): Readonly<TimelineSlipSlideAdaptedPreview> {
	const kind = clipKind?.(preview.clipId) ?? mediaKind(session.originals?.[preview.clipId]);
	const sourceChanging = preview.changeKind === 'source-slip'
		|| preview.changeKind === 'neighbor-trim';
	return Object.freeze({
		...preview,
		slipSlideMode: mode,
		...(preview.changeKind === 'source-slip' ? { sourceSlipPreview: true as const } : {}),
		...(kind === 'audio' && sourceChanging ? { waveformPreviewKind: 'trim' as const } : {}),
	});
}

function mediaKind(value: Readonly<Record<string, unknown>> | undefined): 'audio' | 'video' | null {
	return value?.kind === 'audio' || value?.kind === 'video' ? value.kind : null;
}

function videoBearing(session: TimelineTrimPointerSession): boolean {
	return session.original.kind === 'video'
		|| session.clipIds.some((clipId) => session.originals?.[clipId]?.kind === 'video');
}
