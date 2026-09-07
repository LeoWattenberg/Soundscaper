/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Expose an owner's fields on the flat controller state as live accessors, so
 * the owner and the legacy readers always see one value. Reassigning a whole
 * field through either side updates both; the owner object stays the storage.
 */
export function exposeOwnedFields<Target extends object, Owner extends object>(
	target: Target,
	owner: Owner,
): Target & Owner {
	for (const key of Object.keys(owner) as (keyof Owner & string)[]) {
		Object.defineProperty(target, key, {
			enumerable: true,
			configurable: true,
			get: () => owner[key],
			set: (value: Owner[typeof key]) => { owner[key] = value; },
		});
	}
	return target as Target & Owner;
}
