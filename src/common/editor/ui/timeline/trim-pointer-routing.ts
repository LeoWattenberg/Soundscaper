/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FrameCanonicalEdgeTrimPlan,
	FrameCanonicalEdgeTrimPreview,
	FrameCanonicalEdgeTrimRequest,
	FrameCanonicalTrimEdge,
} from '../../frame-canonical-edge-trim-domain.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export interface TimelineTrimPointerSession {
	readonly clipId: string;
	readonly clipIds: readonly string[];
	readonly original: DataRecord;
	readonly originals?: Readonly<Record<string, DataRecord>>;
}

export interface TimelineTrimPointerPreviewInput {
	readonly projectIndex: unknown;
	readonly session: TimelineTrimPointerSession;
	readonly edge: FrameCanonicalTrimEdge;
	readonly requestedBoundarySample: number;
	readonly canonicalVideoTrim?: boolean;
	legacyRequestedDelta(): number;
	previewVideo(request: FrameCanonicalEdgeTrimRequest): FrameCanonicalEdgeTrimPlan | null;
	createLegacyPreview(
		projectIndex: unknown,
		session: TimelineTrimPointerSession,
		requestedDelta: number,
		edge: FrameCanonicalTrimEdge,
	): unknown;
}

export interface TimelineTrimPointerCommitInput {
	readonly session: TimelineTrimPointerSession;
	readonly edge: FrameCanonicalTrimEdge;
	readonly requestedBoundarySample: number;
	readonly dragPreview: DataRecord | null;
	readonly canonicalVideoTrim?: boolean;
	commitVideo(request: FrameCanonicalEdgeTrimRequest): unknown;
	commitAudio(clipId: string, changes: Readonly<Record<string, number>>): unknown;
}

/** Route video-bearing preview to the sole frame-canonical planner authority. */
export function resolveTimelineTrimPointerPreview(
	input: TimelineTrimPointerPreviewInput,
): Readonly<FrameCanonicalEdgeTrimPreview & {
	readonly previews: readonly FrameCanonicalEdgeTrimPreview[];
}> | unknown | null {
	if (!usesCanonicalVideoTrim(input.session, input.canonicalVideoTrim)) {
		return input.createLegacyPreview(
			input.projectIndex,
			input.session,
			input.legacyRequestedDelta(),
			input.edge,
		);
	}
	const plan = input.previewVideo(trimRequest(
		input.session.clipId,
		input.edge,
		input.requestedBoundarySample,
	));
	if (!plan || plan.kind === 'noop') return null;
	const previews = Object.freeze(plan.previews.map((preview) => Object.freeze({
		...preview,
		waveformPreviewKind: 'trim' as const,
	})));
	const active = previews.find(({ clipId }) => clipId === input.session.clipId);
	return active ? Object.freeze({ ...active, previews }) : null;
}

/** Commit video from the final absolute pointer boundary, never stale preview data. */
export function commitTimelineTrimPointer(input: TimelineTrimPointerCommitInput): unknown {
	if (usesCanonicalVideoTrim(input.session, input.canonicalVideoTrim)) {
		return input.commitVideo(trimRequest(
			input.session.clipId,
			input.edge,
			input.requestedBoundarySample,
		));
	}
	const preview = input.dragPreview;
	if (!preview) return null;
	if (input.edge === 'right') {
		const durationFrames = safeInteger(preview.durationFrames);
		return durationFrames !== null && durationFrames !== input.session.original.durationFrames
			? input.commitAudio(input.session.clipId, Object.freeze({ durationFrames }))
			: null;
	}
	const changes: Record<string, number> = {};
	const timelineStartFrame = safeInteger(preview.timelineStartFrame);
	const durationFrames = safeInteger(preview.durationFrames);
	if (timelineStartFrame !== null && timelineStartFrame !== input.session.original.timelineStartFrame) {
		changes.timelineStartFrame = timelineStartFrame;
	}
	if (durationFrames !== null && durationFrames !== input.session.original.durationFrames) {
		changes.durationFrames = durationFrames;
	}
	return Object.keys(changes).length
		? input.commitAudio(input.session.clipId, Object.freeze(changes))
		: null;
}

function videoBearing(session: TimelineTrimPointerSession): boolean {
	return session.clipIds.some((clipId) => session.originals?.[clipId]?.kind === 'video');
}

function usesCanonicalVideoTrim(
	session: TimelineTrimPointerSession,
	canonicalVideoTrim: boolean | undefined,
): boolean {
	return canonicalVideoTrim !== false && videoBearing(session);
}

function trimRequest(
	activeClipId: string,
	edge: FrameCanonicalTrimEdge,
	requestedBoundarySample: number,
): Readonly<FrameCanonicalEdgeTrimRequest> {
	return Object.freeze({ activeClipId, edge, requestedBoundarySample });
}

function safeInteger(value: unknown): number | null {
	return Number.isSafeInteger(value) ? Number(value) : null;
}
