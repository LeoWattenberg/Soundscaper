/* SPDX-License-Identifier: AGPL-3.0-only */

export interface IdempotentCaptureLease {
	readonly disposalStarted: boolean;
	readonly disposed: boolean;
	dispose(): Promise<void>;
}

/** Memoizes success or failure so an owned capture resource is released once. */
export function createIdempotentCaptureLease(
	disposeOnce: () => PromiseLike<void> | void,
): IdempotentCaptureLease {
	if (typeof disposeOnce !== 'function') {
		throw new TypeError('Capture lease disposal must be a function.');
	}
	let disposalPromise: Promise<void> | null = null;
	let disposed = false;

	function dispose(): Promise<void> {
		if (disposalPromise !== null) return disposalPromise;
		try {
			disposalPromise = Promise.resolve(disposeOnce()).then(() => {
				disposed = true;
			});
		} catch (error) {
			disposalPromise = Promise.reject(error);
		}
		return disposalPromise;
	}

	return Object.freeze({
		get disposalStarted(): boolean { return disposalPromise !== null; },
		get disposed(): boolean { return disposed; },
		dispose,
	});
}
