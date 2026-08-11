/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareTransformClipsCommand as prepareLegacyTransformClipsCommand } from '../commands/clip-transform-runtime.js';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import type {
	FrameCanonicalRateStretchPlan,
	FrameCanonicalRateStretchRequest,
	FrameCanonicalRateStretchTransform,
} from '../frame-canonical-rate-stretch-domain.ts';
import { planFrameCanonicalRateStretch } from '../frame-canonical-rate-stretch-planner.ts';
import type { VideoSourceTimingView } from '../video-source-timing-view.ts';
import type { EditorControllerLifetime } from './lifecycle.ts';

type TransformManyCommand = Extract<AudioEditorCommand, { readonly type: 'clip/transform-many' }>;

const prepareTransformClipsCommand = prepareLegacyTransformClipsCommand as unknown as (
	project: unknown,
	transforms: readonly FrameCanonicalRateStretchTransform[],
) => TransformManyCommand;

export type VideoRateStretchResultReporter = (
	plan: FrameCanonicalRateStretchPlan,
) => void;

export interface VideoRateStretchServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive'>;
	/** A fresh branded command projection for the live persisted project. */
	getProject(): unknown;
	/** Fresh verified source-timing evidence for that exact planning projection. */
	getTimingViews(project: unknown): ReadonlyMap<string, VideoSourceTimingView>;
	editingBlocked(): boolean;
	commit(command: AudioEditorCommand): unknown;
	/** Optional status adapter; previews and failed operations never call it. */
	readonly reportResult?: VideoRateStretchResultReporter;
}

export interface VideoRateStretchService {
	/** Plan immutable presentation geometry without changing document state. */
	preview(request: FrameCanonicalRateStretchRequest): FrameCanonicalRateStretchPlan;
	/** Replan against live project/timing authority and commit at most one command. */
	commit(request: FrameCanonicalRateStretchRequest): FrameCanonicalRateStretchPlan;
}

/** One controller boundary for video-bearing frame-canonical uniform rate stretch. */
export function createVideoRateStretchService(
	dependencies: VideoRateStretchServiceDependencies,
): Readonly<VideoRateStretchService> {
	function plan(request: FrameCanonicalRateStretchRequest): Readonly<{
		readonly project: unknown;
		readonly result: FrameCanonicalRateStretchPlan;
	}> {
		const project = dependencies.getProject();
		const timingViews = dependencies.getTimingViews(project);
		return {
			project,
			result: planFrameCanonicalRateStretch(
				project,
				timingViews,
				persistedLockRequest(project, request),
			),
		};
	}

	function preview(request: FrameCanonicalRateStretchRequest): FrameCanonicalRateStretchPlan {
		dependencies.lifetime.assertActive();
		return plan(request).result;
	}

	function commit(request: FrameCanonicalRateStretchRequest): FrameCanonicalRateStretchPlan {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) throw new RangeError('Editing is blocked.');
		const { project, result } = plan(request);
		if (result.kind === 'noop') {
			dependencies.reportResult?.(result);
			return result;
		}
		dependencies.commit(prepareTransformClipsCommand(project, result.transforms));
		dependencies.reportResult?.(result);
		return result;
	}

	return Object.freeze({ preview, commit });
}

/** Caller predicates are not authority; bind locks to the same live planning project. */
function persistedLockRequest(
	project: unknown,
	request: FrameCanonicalRateStretchRequest,
): Readonly<FrameCanonicalRateStretchRequest> {
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
		activeClipId: request.activeClipId,
		edge: request.edge,
		requestedBoundarySample: request.requestedBoundarySample,
		isTrackLocked: (trackId: string) => lockedTrackIds.has(trackId),
	});
}
