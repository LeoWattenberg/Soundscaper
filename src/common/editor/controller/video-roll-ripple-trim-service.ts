/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareTransformClipsCommand as prepareLegacyTransformClipsCommand } from '../commands/clip-transform-runtime.js';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import type {
	FrameCanonicalRollRippleTrimPlan,
	FrameCanonicalRollRippleTrimRequest,
	FrameCanonicalRollRippleTrimTransform,
} from '../frame-canonical-roll-ripple-trim-domain.ts';
import { planFrameCanonicalRollRippleTrim } from '../frame-canonical-roll-ripple-trim-planner.ts';
import type { EditorControllerLifetime } from './lifecycle.ts';

type TransformManyCommand = Extract<AudioEditorCommand, { readonly type: 'clip/transform-many' }>;

const prepareTransformClipsCommand = prepareLegacyTransformClipsCommand as unknown as (
	project: unknown,
	transforms: readonly FrameCanonicalRollRippleTrimTransform[],
) => TransformManyCommand;

export type VideoRollRippleTrimResultReporter = (
	plan: FrameCanonicalRollRippleTrimPlan,
) => void;

export interface VideoRollRippleTrimServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive'>;
	/** A fresh branded command projection for the live persisted project. */
	getProject(): unknown;
	editingBlocked(): boolean;
	commit(command: AudioEditorCommand): unknown;
	/** Optional existing-status adapter; previews and failed operations never call it. */
	readonly reportResult?: VideoRollRippleTrimResultReporter;
}

export interface VideoRollRippleTrimService {
	/** Plan immutable presentation geometry without changing document state. */
	preview(request: FrameCanonicalRollRippleTrimRequest): FrameCanonicalRollRippleTrimPlan;
	/** Replan against the live document and commit at most one transform command. */
	commit(request: FrameCanonicalRollRippleTrimRequest): FrameCanonicalRollRippleTrimPlan;
}

/** One controller boundary for video-bearing frame-canonical roll and ripple trims. */
export function createVideoRollRippleTrimService(
	dependencies: VideoRollRippleTrimServiceDependencies,
): Readonly<VideoRollRippleTrimService> {
	function preview(
		request: FrameCanonicalRollRippleTrimRequest,
	): FrameCanonicalRollRippleTrimPlan {
		dependencies.lifetime.assertActive();
		const project = dependencies.getProject();
		return planFrameCanonicalRollRippleTrim(project, persistedLockRequest(project, request));
	}

	function commit(
		request: FrameCanonicalRollRippleTrimRequest,
	): FrameCanonicalRollRippleTrimPlan {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) throw new RangeError('Editing is blocked.');
		const project = dependencies.getProject();
		const plan = planFrameCanonicalRollRippleTrim(
			project,
			persistedLockRequest(project, request),
		);
		if (plan.kind === 'noop') {
			dependencies.reportResult?.(plan);
			return plan;
		}
		dependencies.commit(prepareTransformClipsCommand(project, plan.transforms));
		dependencies.reportResult?.(plan);
		return plan;
	}

	return Object.freeze({ preview, commit });
}

/** Caller predicates are never authority; bind locks to the same live planning project. */
function persistedLockRequest(
	project: unknown,
	request: FrameCanonicalRollRippleTrimRequest,
): Readonly<FrameCanonicalRollRippleTrimRequest> {
	const candidate = project !== null && typeof project === 'object'
		? project as Readonly<Record<string, unknown>>
		: null;
	const tracks = Array.isArray(candidate?.tracks) ? candidate.tracks : [];
	const lockedTrackIds = new Set(tracks.flatMap((value) => {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
		const track = value as Readonly<Record<string, unknown>>;
		return track.locked === true && typeof track.id === 'string' && track.id.length > 0
			? [track.id]
			: [];
	}));
	return Object.freeze({
		mode: request.mode,
		activeClipId: request.activeClipId,
		edge: request.edge,
		requestedBoundarySample: request.requestedBoundarySample,
		isTrackLocked: (trackId: string) => lockedTrackIds.has(trackId),
	});
}
