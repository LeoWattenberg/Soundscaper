/* SPDX-License-Identifier: AGPL-3.0-only */

export const APPLICATION_READY_EVENT = 'scape:application-ready';
export const APPLICATION_READY_SELECTOR =
	'[data-audio-editor-bound="true"], [data-privacy-policy-dialog="true"], [role="alert"]';

/** @typedef {{
 * addEventListener: (type: string, listener: EventListener) => void,
 * removeEventListener: (type: string, listener: EventListener) => void,
 * requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number,
 * cancelIdleCallback?: (handle: number) => void,
 * setTimeout: (callback: () => void, delay: number) => number,
 * clearTimeout: (handle: number) => void,
 * }} SchedulerWindow */

/** @typedef {{ querySelector: (selector: string) => unknown }} SchedulerDocument */

/**
 * Schedule one non-critical task after the editor has bound or failed.
 * A direct user request bypasses both the readiness and idle gates.
 *
 * @param {{
 * windowObject?: SchedulerWindow,
 * documentObject?: SchedulerDocument,
 * task: () => void,
 * }} options
 */
export function createApplicationReadyScheduler(options) {
	const {
		windowObject = window,
		documentObject = document,
		task,
	} = options;
	if (typeof task !== 'function') throw new TypeError('An application-ready task is required.');
	let disposed = false;
	let started = false;
	let idleHandle = null;
	let timeoutHandle = null;

	const cancelIdle = () => {
		if (idleHandle !== null) windowObject.cancelIdleCallback?.(idleHandle);
		if (timeoutHandle !== null) windowObject.clearTimeout(timeoutHandle);
		idleHandle = null;
		timeoutHandle = null;
	};
	const request = () => {
		if (disposed || started) return;
		started = true;
		cancelIdle();
		task();
	};
	const schedule = () => {
		if (disposed || started || idleHandle !== null || timeoutHandle !== null) return;
		if (typeof windowObject.requestIdleCallback === 'function') {
			idleHandle = windowObject.requestIdleCallback(request, { timeout: 2_000 });
			return;
		}
		timeoutHandle = windowObject.setTimeout(request, 1_000);
	};
	const handleReady = () => { schedule(); };

	windowObject.addEventListener(APPLICATION_READY_EVENT, handleReady);
	if (documentObject.querySelector(APPLICATION_READY_SELECTOR)) schedule();

	return Object.freeze({
		request,
		dispose() {
			if (disposed) return;
			disposed = true;
			windowObject.removeEventListener(APPLICATION_READY_EVENT, handleReady);
			cancelIdle();
		},
	});
}
