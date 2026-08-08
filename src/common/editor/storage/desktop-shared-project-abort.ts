/* SPDX-License-Identifier: AGPL-3.0-only */

export function raceDesktopSharedAbort<Value>(
	read: () => Promise<Value>,
	signal?: AbortSignal,
): Promise<Value> {
	if (!signal) return Promise.resolve().then(read);
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<Value>((resolve, reject) => {
		let settled = false;
		const finish = (complete: () => void): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			complete();
		};
		const onAbort = (): void => finish(() => reject(signal.reason));
		signal.addEventListener('abort', onAbort, { once: true });
		if (signal.aborted) {
			onAbort();
			return;
		}
		void Promise.resolve().then(read).then(
			(value) => finish(() => resolve(value)),
			(error: unknown) => finish(() => reject(error)),
		);
	});
}
