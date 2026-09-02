/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	beginParameterAutomationGestureV21,
	cancelParameterAutomationGestureV21,
	parameterAutomationCaptureAvailableV21,
	previewParameterAutomationGestureV21,
	releaseParameterAutomationGestureV21,
	type ParameterAutomationGestureSessionV21,
} from './parameter-automation-gesture-adapter-v21.ts';
import { canonicalParameterAddressKey, type ParameterAddress } from './parameter-address.ts';
import type { TrackAutomationRuntime } from './track-automation-runtime.ts';

export interface ParameterAutomationControlRouterContextV21 {
	readonly runtime?: Readonly<TrackAutomationRuntime> | null;
	readonly project?: Readonly<{ readonly automationLanes?: readonly unknown[] }> | null;
	readonly onError?: ((error: unknown) => void) | null;
}

export interface ParameterAutomationControlRouterV21 {
	setContext(context: ParameterAutomationControlRouterContextV21): void;
	captureAvailable(address: ParameterAddress): boolean;
	owns(address: ParameterAddress): boolean;
	begin(address: ParameterAddress, value: number): boolean;
	preview(address: ParameterAddress, value: number): boolean;
	release(address: ParameterAddress, value?: number): boolean;
	cancel(address?: ParameterAddress): boolean;
	performAtomic(address: ParameterAddress, value: number): boolean;
}

interface ActiveControlGesture {
	readonly addressKey: string;
	readonly session: ParameterAutomationGestureSessionV21;
}

/**
 * Own the single automation session used by one control surface. Boolean return
 * values mean "the automation path owns this event", so callers can reliably
 * suppress their ordinary static mutation even when live authority goes stale.
 */
export function createParameterAutomationControlRouterV21(
	initialContext: ParameterAutomationControlRouterContextV21 = {},
): ParameterAutomationControlRouterV21 {
	let context = initialContext;
	let active: ActiveControlGesture | null = null;
	const addressKey = (address: ParameterAddress): string | null => {
		try { return canonicalParameterAddressKey(address); } catch { return null; }
	};
	const report = (error: unknown): void => {
		if (typeof context.onError === 'function') context.onError(error);
	};
	const matchingActive = (address?: ParameterAddress): ActiveControlGesture | null => {
		if (!active) return null;
		if (address === undefined) return active;
		return addressKey(address) === active.addressKey ? active : null;
	};
	const captureAvailable = (address: ParameterAddress): boolean => (
		parameterAutomationCaptureAvailableV21({
			runtime: context.runtime,
			project: context.project,
			address,
		})
	);
	const finish = (
		gesture: ActiveControlGesture,
		operation: () => unknown,
		recoverWithCancellation: boolean,
	): void => {
		const clear = (): void => {
			if (active === gesture) active = null;
		};
		const reject = (error: unknown): void => {
			report(error);
			if (!recoverWithCancellation) {
				clear();
				return;
			}
			let cancellation: unknown;
			try {
				cancellation = cancelParameterAutomationGestureV21(gesture.session);
			} catch (cancellationError) {
				clear();
				report(cancellationError);
				return;
			}
			if (!isPromiseLike(cancellation)) {
				clear();
				return;
			}
			void Promise.resolve(cancellation).then(clear, (cancellationError: unknown) => {
				clear();
				report(cancellationError);
			});
		};
		let result: unknown;
		try {
			result = operation();
		} catch (error) {
			reject(error);
			return;
		}
		if (!isPromiseLike(result)) {
			clear();
			return;
		}
		void Promise.resolve(result).then(clear, reject);
	};
	const router: ParameterAutomationControlRouterV21 = {
		setContext(nextContext) {
			context = nextContext;
		},
		captureAvailable,
		owns(address) {
			return matchingActive(address) !== null;
		},
		begin(address, value) {
			if (active || !captureAvailable(address)) return false;
			try {
				const session = beginParameterAutomationGestureV21({
					runtime: context.runtime,
					project: context.project,
					address,
				}, value);
				if (!session) return false;
				active = Object.freeze({ addressKey: session.addressKey, session });
				return true;
			} catch (error) {
				report(error);
				return false;
			}
		},
		preview(address, value) {
			const gesture = matchingActive(address);
			if (!gesture) return false;
			try {
				const result = previewParameterAutomationGestureV21(gesture.session, value);
				if (isPromiseLike(result)) void Promise.resolve(result).catch(report);
			} catch (error) {
				report(error);
			}
			return true;
		},
		release(address, value) {
			const gesture = matchingActive(address);
			if (!gesture) return false;
			finish(gesture, () => releaseParameterAutomationGestureV21(gesture.session, value), true);
			return true;
		},
		cancel(address) {
			const gesture = matchingActive(address);
			if (!gesture) return false;
			finish(gesture, () => cancelParameterAutomationGestureV21(gesture.session), false);
			return true;
		},
		performAtomic(address, value) {
			if (!captureAvailable(address)) return false;
			if (!router.begin(address, value)) return true;
			router.preview(address, value);
			router.release(address, value);
			return true;
		},
	};
	return Object.freeze(router);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return value !== null && (typeof value === 'object' || typeof value === 'function')
		&& typeof (value as { then?: unknown }).then === 'function';
}
