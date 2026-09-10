/* SPDX-License-Identifier: AGPL-3.0-only */

/** Controller state stores browser-style numeric handles, including in Node tests. */
export interface ControllerTimerOptions {
	readonly setTimeout?: (callback: () => void, delay: number) => number;
	readonly clearTimeout?: (handle: number) => void;
	readonly setInterval?: (callback: () => void, delay: number) => number;
	readonly clearInterval?: (handle: number) => void;
}

export function createControllerTimers(options: ControllerTimerOptions) {
	const scheduleTimer = options.setTimeout ?? ((callback: () => void, delay: number) => Number(globalThis.setTimeout(callback, delay)));
	const scheduleInterval = options.setInterval ?? ((callback: () => void, delay: number) => Number(globalThis.setInterval(callback, delay)));
	return Object.freeze({
		scheduleTimer,
		scheduleInterval,
		clearScheduledTimer(handle: unknown) {
			if (typeof handle === 'number') (options.clearTimeout ?? globalThis.clearTimeout)(handle);
		},
		clearScheduledInterval(handle: unknown) {
			if (typeof handle === 'number') (options.clearInterval ?? globalThis.clearInterval)(handle);
		},
	});
}
