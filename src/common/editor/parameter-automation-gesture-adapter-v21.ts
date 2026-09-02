/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalParameterAddressKey, type ParameterAddress } from './parameter-address.ts';
import {
	trackAutomationModeForLane,
	type TrackAutomationRuntime,
} from './track-automation-runtime.ts';
import type { TrackAutomationTargetV21 } from './track-automation-targets-v21.ts';

export interface ParameterAutomationGestureContextV21 {
	readonly runtime?: Readonly<TrackAutomationRuntime> | null;
	readonly target?: TrackAutomationTargetV21 | null;
	readonly project?: Readonly<{ readonly automationLanes?: readonly unknown[] }> | null;
	readonly address: ParameterAddress;
}

export interface ParameterAutomationGestureSessionV21 {
	readonly type: 'parameter-automation-gesture-session-v21';
	readonly addressKey: string;
	readonly laneId: string;
	readonly token: unknown;
	readonly runtime: Readonly<TrackAutomationRuntime>;
}

const FINISHED = new WeakSet<ParameterAutomationGestureSessionV21>();
const PENDING = new WeakSet<ParameterAutomationGestureSessionV21>();

/** True only when this exact visible target owns the matching live control. */
export function parameterAutomationCaptureAvailableV21(
	context: ParameterAutomationGestureContextV21,
): boolean {
	const runtime = context.runtime;
	if (!runtime || typeof runtime.beginGesture !== 'function') return false;
	const laneId = matchingLaneId(context);
	return laneId !== null
		&& trackAutomationModeForLane(runtime, laneId) !== 'read';
}

export function beginParameterAutomationGestureV21(
	context: ParameterAutomationGestureContextV21,
	controlValue: number,
): ParameterAutomationGestureSessionV21 | null {
	if (!parameterAutomationCaptureAvailableV21(context)) return null;
	const runtime = context.runtime!;
	const laneId = matchingLaneId(context)!;
	const token = runtime.beginGesture!(laneId, finite(controlValue));
	if (token === null || token === undefined) {
		throw new TypeError('The automation runtime returned no gesture token.');
	}
	return Object.freeze({
		type: 'parameter-automation-gesture-session-v21' as const,
		addressKey: canonicalParameterAddressKey(context.address),
		laneId,
		token,
		runtime,
	});
}

export function previewParameterAutomationGestureV21(
	session: ParameterAutomationGestureSessionV21,
	controlValue: number,
): unknown {
	assertActive(session);
	return session.runtime.previewGesture?.(session.token, finite(controlValue));
}

export function releaseParameterAutomationGestureV21(
	session: ParameterAutomationGestureSessionV21,
	controlValue?: number,
): unknown {
	assertActive(session);
	return finishTransaction(session, () => session.runtime.releaseGesture?.(
		session.token, controlValue === undefined ? undefined : finite(controlValue),
	));
}

export function cancelParameterAutomationGestureV21(
	session: ParameterAutomationGestureSessionV21,
): unknown {
	assertActive(session);
	return finishTransaction(session, () => session.runtime.cancelGesture?.(session.token));
}

function assertActive(session: ParameterAutomationGestureSessionV21): void {
	if (!session || session.type !== 'parameter-automation-gesture-session-v21') {
		throw new TypeError('A parameter automation gesture session is required.');
	}
	if (PENDING.has(session)) throw new RangeError('The parameter automation gesture is finishing.');
	if (FINISHED.has(session)) throw new RangeError('The parameter automation gesture is already complete.');
}

function matchingLaneId(context: ParameterAutomationGestureContextV21): string | null {
	const runtimeLaneId = context.runtime?.snapshot.laneId;
	if (!runtimeLaneId) return null;
	let requestedKey: string;
	try { requestedKey = canonicalParameterAddressKey(context.address); } catch { return null; }
	if (context.target) {
		const targetLaneId = context.target.lane?.id;
		return targetLaneId === runtimeLaneId && context.target.key === requestedKey
			? targetLaneId
			: null;
	}
	const lanes = context.project?.automationLanes;
	if (!Array.isArray(lanes)) return null;
	for (const candidate of lanes) {
		if (!record(candidate) || candidate.id !== runtimeLaneId || !record(candidate.address)) continue;
		try {
			if (canonicalParameterAddressKey(candidate.address as unknown as ParameterAddress) === requestedKey) {
				return runtimeLaneId;
			}
		} catch {
			// Ignore malformed non-matching project candidates at this UI boundary.
		}
	}
	return null;
}

function finishTransaction(
	session: ParameterAutomationGestureSessionV21,
	operation: () => unknown,
): unknown {
	PENDING.add(session);
	let result: unknown;
	try {
		result = operation();
	} catch (error) {
		PENDING.delete(session);
		throw error;
	}
	if (isPromiseLike(result)) {
		return Promise.resolve(result).then((value) => {
			PENDING.delete(session);
			FINISHED.add(session);
			return value;
		}, (error: unknown) => {
			PENDING.delete(session);
			throw error;
		});
	}
	PENDING.delete(session);
	FINISHED.add(session);
	return result;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return value !== null && (typeof value === 'object' || typeof value === 'function')
		&& typeof (value as { then?: unknown }).then === 'function';
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new RangeError('A parameter automation control value must be finite.');
	}
	return Object.is(value, -0) ? 0 : value;
}
