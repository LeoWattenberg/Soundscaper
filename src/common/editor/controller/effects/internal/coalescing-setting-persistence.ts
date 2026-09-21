/* SPDX-License-Identifier: AGPL-3.0-only */

interface CoalescingSettingPersistenceOptions<Value extends object> {
	readonly persist: (value: Value) => Promise<unknown>;
	readonly handleError: (error: unknown) => void;
}

/** Keep a trailing settings write on the newest immutable state value. */
export function createCoalescingSettingPersistence<Value extends object>(
	options: CoalescingSettingPersistenceOptions<Value>,
) {
	let pending: Value | null = null;
	let writing: Promise<void> | null = null;

	return Object.freeze({ enqueue, flush });

	function enqueue(value: Value): void {
		pending = value;
		if (!writing) writing = drain();
	}

	async function drain(): Promise<void> {
		let retried: Value | null = null;
		try {
			while (pending) {
				const value = pending;
				pending = null;
				try {
					await options.persist(value);
				} catch (error) {
					options.handleError(error);
					// A newer state supersedes the failed value. Otherwise, retry this
					// immutable value once rather than spinning on a refusing store.
					if (!pending && retried !== value) {
						pending = value;
						retried = value;
					}
				}
			}
		} finally {
			writing = null;
		}
	}

	async function flush(): Promise<void> {
		while (writing) await writing;
	}
}
