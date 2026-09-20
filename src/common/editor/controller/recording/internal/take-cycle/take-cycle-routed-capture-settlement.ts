/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RecordingCaptureControllerLike } from '../recording-session-service.ts';

export async function settleTakeCycleCaptureControllers(
	controllers: readonly (RecordingCaptureControllerLike | null)[],
	operation: (controller: RecordingCaptureControllerLike | null) => unknown,
	reportError: (error: unknown) => void,
): Promise<void> {
	const settled = await Promise.allSettled(controllers.map(async (controller) => operation(controller)));
	for (const result of settled) if (result.status === 'rejected') reportError(result.reason);
}

export function pauseTakeCycleCaptureTransport(
	pause: () => void,
	reportError: (error: unknown) => void,
): void {
	try {
		pause();
	} catch (error) {
		reportError(error);
	}
}

export function reportTakeCycleCaptureError(
	error: unknown,
	handleError: (error: unknown) => void,
): void {
	try {
		handleError(error);
	} catch {
		// Error reporting must never interrupt durable lane settlement.
	}
}

/** Reconcile the outer recording controller after asynchronous routed loss. */
export function settleTakeCycleRecordingSessionAfterInterruption(
	settlement: PromiseLike<unknown>,
	stopRecording: (() => PromiseLike<unknown> | unknown) | undefined,
	reportError: (error: unknown) => void,
): void {
	void Promise.resolve(settlement).catch(reportError).finally(() => {
		queueMicrotask(() => {
			try {
				void Promise.resolve(stopRecording?.()).catch(reportError);
			} catch (error) {
				reportError(error);
			}
		});
	});
}
