/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareTransformClipsCommand as prepareLegacyTransformClipsCommand } from '../commands/clip-transform-runtime.js';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import type {
	FrameCanonicalSlipSlidePlan,
	FrameCanonicalSlipSlideRequest,
	FrameCanonicalSlipSlideTransform,
	VideoSourceTimingView,
} from '../frame-canonical-slip-slide-domain.ts';
import { planFrameCanonicalSlipSlide } from '../frame-canonical-slip-slide-planner.ts';
import {
	captureFrameCanonicalSlipSlidePointerAuthority,
	type FrameCanonicalSlipSlidePointerAuthority,
	type FrameCanonicalSlipSlidePointerCapture,
} from '../frame-canonical-slip-slide-pointer-request.ts';
import {
	buildFrameCanonicalSlipSlideStepRequest,
	type FrameCanonicalSlipSlideStep,
} from '../frame-canonical-slip-slide-step-request.ts';
import type { EditorControllerLifetime } from './lifecycle.ts';

type TransformManyCommand = Extract<AudioEditorCommand, { readonly type: 'clip/transform-many' }>;

const prepareTransformClipsCommand = prepareLegacyTransformClipsCommand as unknown as (
	project: unknown,
	transforms: readonly FrameCanonicalSlipSlideTransform[],
) => TransformManyCommand;

export type VideoSlipSlideResultReporter = (plan: FrameCanonicalSlipSlidePlan) => void;

export interface VideoSlipSlideServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive'>;
	/** A fresh branded command projection for the live persisted project. */
	getProject(): unknown;
	/** Fresh verified source-timing evidence for the same planning attempt. */
	getTimingViews(project: unknown): ReadonlyMap<string, VideoSourceTimingView>;
	editingBlocked(): boolean;
	commit(command: AudioEditorCommand): unknown;
	/** Optional existing-status adapter; previews and failed operations never call it. */
	readonly reportResult?: VideoSlipSlideResultReporter;
}

export interface VideoSlipSlideService {
	/** Capture immutable whole-clip gesture authority from one fresh project/timing read. */
	capturePointerAuthority(
		capture: FrameCanonicalSlipSlidePointerCapture,
	): FrameCanonicalSlipSlidePointerAuthority;
	/** Build an absolute one-frame menu request from fresh immutable authority. */
	buildStepRequest(step: FrameCanonicalSlipSlideStep): Readonly<FrameCanonicalSlipSlideRequest>;
	/** Plan immutable presentation geometry without changing document state. */
	preview(request: FrameCanonicalSlipSlideRequest): FrameCanonicalSlipSlidePlan;
	/** Replan against live project and timing authority, then commit at most one command. */
	commit(request: FrameCanonicalSlipSlideRequest): FrameCanonicalSlipSlidePlan;
}

/** One controller boundary for video-bearing frame-canonical slip and slide edits. */
export function createVideoSlipSlideService(
	dependencies: VideoSlipSlideServiceDependencies,
): Readonly<VideoSlipSlideService> {
	function plan(request: FrameCanonicalSlipSlideRequest): Readonly<{
		readonly project: unknown;
		readonly result: FrameCanonicalSlipSlidePlan;
	}> {
		const project = dependencies.getProject();
		const timingViews = dependencies.getTimingViews(project);
		return {
			project,
			result: planFrameCanonicalSlipSlide(
				project,
				timingViews,
				persistedLockRequest(project, request),
			),
		};
	}

	function preview(request: FrameCanonicalSlipSlideRequest): FrameCanonicalSlipSlidePlan {
		dependencies.lifetime.assertActive();
		return plan(request).result;
	}

	function buildStepRequest(
		step: FrameCanonicalSlipSlideStep,
	): Readonly<FrameCanonicalSlipSlideRequest> {
		dependencies.lifetime.assertActive();
		return buildFrameCanonicalSlipSlideStepRequest(dependencies.getProject(), step);
	}

	function capturePointerAuthority(
		capture: FrameCanonicalSlipSlidePointerCapture,
	): FrameCanonicalSlipSlidePointerAuthority {
		dependencies.lifetime.assertActive();
		const project = dependencies.getProject();
		return captureFrameCanonicalSlipSlidePointerAuthority(
			project,
			dependencies.getTimingViews(project),
			capture,
		);
	}

	function commit(request: FrameCanonicalSlipSlideRequest): FrameCanonicalSlipSlidePlan {
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

	return Object.freeze({ capturePointerAuthority, buildStepRequest, preview, commit });
}

/** Caller predicates are never authority; bind locks to the live planning project. */
function persistedLockRequest(
	project: unknown,
	request: FrameCanonicalSlipSlideRequest,
): Readonly<FrameCanonicalSlipSlideRequest> {
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
	const isTrackLocked = (trackId: string): boolean => lockedTrackIds.has(trackId);
	return request.mode === 'slip'
		? Object.freeze({
			mode: request.mode,
			activeClipId: request.activeClipId,
			requestedSourceInFrame: request.requestedSourceInFrame,
			isTrackLocked,
		})
		: Object.freeze({
			mode: request.mode,
			activeClipId: request.activeClipId,
			requestedStartSample: request.requestedStartSample,
			isTrackLocked,
		});
}
