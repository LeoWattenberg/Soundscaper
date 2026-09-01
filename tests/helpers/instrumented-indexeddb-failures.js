/* SPDX-License-Identifier: AGPL-3.0-only */

export function createRequestFailurePlan() {
	const failures = new Map();
	const key = (operation, storeName) => `${operation}:${storeName}`;
	const failNext = (operation, storeName, error) => { failures.set(key(operation, storeName), error); };
	return Object.freeze({
		controls: Object.freeze({
			failNextGetAllForStore(storeName, error = new Error(`Planned getAll failure for ${storeName}.`)) {
				failNext('getAll', storeName, error);
			},
			failNextPutForStore(storeName, error = new Error(`Planned put failure for ${storeName}.`)) {
				failNext('put', storeName, error);
			},
			failNextDeleteForStore(storeName, error = new Error(`Planned delete failure for ${storeName}.`)) {
				failNext('delete', storeName, error);
			},
		}),
		take(operation, storeName) {
			const failureKey = key(operation, storeName);
			const failure = failures.get(failureKey);
			if (failure !== undefined) failures.delete(failureKey);
			return failure;
		},
	});
}
