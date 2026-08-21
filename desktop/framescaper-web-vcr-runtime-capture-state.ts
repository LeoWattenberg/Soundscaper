/* SPDX-License-Identifier: AGPL-3.0-only */

import type { WebVcrCaptureStateRequestV1 } from './framescaper-web-vcr-contract.ts';
import {
	framescaperWebVcrCaptureIsActive,
	framescaperWebVcrCaptureSetupLocked,
	webVcrCaptureStateTransitionAllowed,
	type FramescaperWebVcrRuntimeSessionV1,
} from './framescaper-web-vcr-runtime-support.ts';
import type { FramescaperWebVcrResolvedTargetObservationV1 } from './framescaper-web-vcr-target-observer.ts';

export type FramescaperWebVcrTargetUpdateV1 = 'ignored' | 'changed' | 'target-lost';

export function enterFramescaperWebVcrRecoveryV1(
	state: FramescaperWebVcrRuntimeSessionV1,
	message: string,
): boolean {
	if (!framescaperWebVcrCaptureSetupLocked(state)) return false;
	if (state.captureTransitionPending) {
		state.captureTransitionInvalidated = true;
		return false;
	}
	state.activeRecordingToken = null;
	state.targetEndedRecordingToken = null;
	state.failure = message;
	state.captureState = 'recovery';
	return true;
}

export function applyFramescaperWebVcrTargetObservationV1(
	state: FramescaperWebVcrRuntimeSessionV1,
	observation: Readonly<FramescaperWebVcrResolvedTargetObservationV1>,
): FramescaperWebVcrTargetUpdateV1 {
	if (observation.navigationGeneration !== state.navigation.generation) return 'ignored';
	const ended = observation.endedTarget;
	if (framescaperWebVcrCaptureIsActive(state.captureState) || state.captureTransitionPending) {
		if (ended && ended.endedRecordingToken !== null
			&& ended.endedRecordingToken === state.activeRecordingToken
			&& state.target?.targetId === ended.targetId
			&& state.target.generation === ended.generation) {
			state.target = Object.freeze({ ...state.target, mediaState: 'ended' });
			state.targetEndedRecordingToken = ended.endedRecordingToken;
			return 'changed';
		}
		const retained = state.target === null || observation.targets.some((candidate) => (
			candidate.targetId === state.target?.targetId
				&& candidate.generation === state.target.generation
		));
		if (!retained && state.captureTransitionPending) {
			state.captureTransitionInvalidated = true;
			state.target = null;
			state.targetEndedRecordingToken = null;
			return 'ignored';
		}
		return retained ? 'ignored' : 'target-lost';
	}
	if (ended && state.target?.targetId === ended.targetId
		&& state.target.generation === ended.generation) {
		state.target = Object.freeze({ ...state.target, mediaState: 'ended' });
		state.targetEndedRecordingToken = ended.endedRecordingToken;
	} else {
		state.target = observation.selection.kind === 'target' ? observation.selection.target : null;
		state.targetEndedRecordingToken = null;
	}
	return 'changed';
}

export async function transitionFramescaperWebVcrCaptureStateV1(
	state: FramescaperWebVcrRuntimeSessionV1,
	request: Readonly<WebVcrCaptureStateRequestV1>,
	isCurrent: () => boolean,
): Promise<boolean> {
	if (state.captureTransitionPending
		|| !webVcrCaptureStateTransitionAllowed(state.captureState, request.state)) return false;
	if (request.state === 'preparing') return installRecordingFence(state, request, isCurrent);

	const previous = state.captureState;
	if (request.state !== 'recording') {
		state.captureTransitionPending = true;
		try {
			await state.observer.setRecordingToken(null);
		} catch (error) {
			state.captureTransitionPending = false;
			throw error;
		}
		if (!isCurrent() || state.captureState !== previous) {
			state.captureTransitionPending = false;
			return false;
		}
		state.activeRecordingToken = null;
		state.targetEndedRecordingToken = null;
	}
	return true;
}

async function installRecordingFence(
	state: FramescaperWebVcrRuntimeSessionV1,
	request: Extract<WebVcrCaptureStateRequestV1, { readonly state: 'preparing' }>,
	isCurrent: () => boolean,
): Promise<boolean> {
	if (state.navigation.isLoading || targetAlreadyEnded(state)) return false;
	const previousNavigation = state.navigation.generation;
	const previousTarget = state.target;
	state.captureTransitionPending = true;
	state.captureTransitionInvalidated = false;
	state.activeRecordingToken = request.recordingToken;
	state.targetEndedRecordingToken = null;
	try {
		await state.observer.setRecordingToken(request.recordingToken);
	} catch (error) {
		state.captureTransitionPending = false;
		state.captureTransitionInvalidated = false;
		state.activeRecordingToken = null;
		state.targetEndedRecordingToken = null;
		throw error;
	}
	if (!isCurrent() || state.captureState !== 'ready' || state.captureTransitionInvalidated
		|| state.navigation.generation !== previousNavigation || state.navigation.isLoading
		|| !state.visible || state.window.isDestroyed()
		|| !sameTarget(previousTarget, state.target) || targetAlreadyEnded(state)) {
		if (isCurrent() && !state.window.isDestroyed()) {
			await state.observer.setRecordingToken(null);
		}
		state.captureTransitionPending = false;
		state.captureTransitionInvalidated = false;
		state.activeRecordingToken = null;
		state.targetEndedRecordingToken = null;
		return false;
	}
	return true;
}

function targetAlreadyEnded(state: FramescaperWebVcrRuntimeSessionV1): boolean {
	return state.target?.mediaState === 'ended';
}

function sameTarget(
	left: FramescaperWebVcrRuntimeSessionV1['target'],
	right: FramescaperWebVcrRuntimeSessionV1['target'],
): boolean {
	return left === null ? right === null : right !== null
		&& left.targetId === right.targetId && left.generation === right.generation;
}
