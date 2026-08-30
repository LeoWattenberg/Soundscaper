/* SPDX-License-Identifier: AGPL-3.0-only */

export function createStaffPadRuntimeLoader(loadRuntime) {
	let runtimePromise;
	let runtimeUrl;
	return function getRuntime(wasmUrl) {
		const requestedUrl = wasmUrl || undefined;
		if (runtimePromise && runtimeUrl === requestedUrl) return runtimePromise;
		const pending = Promise.resolve().then(() => loadRuntime(requestedUrl));
		runtimeUrl = requestedUrl;
		runtimePromise = pending;
		void pending.catch(() => {
			if (runtimePromise !== pending) return;
			runtimePromise = undefined;
			runtimeUrl = undefined;
		});
		return pending;
	};
}
