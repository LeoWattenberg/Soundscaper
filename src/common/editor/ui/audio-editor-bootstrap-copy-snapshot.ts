/* SPDX-License-Identifier: AGPL-3.0-only */

type CopyDataPropertyRequirement = 'own data property' | 'own enumerable data property';

// The combined three-product catalog exceeds 4,096 fields. Retain a fixed
// admission ceiling with room for its menu copy while refusing unbounded input.
const MAXIMUM_COPY_FIELDS = 8_192;

/** Snapshot a validated bootstrap copy without evaluating accessors or retaining mutable fields. */
export function snapshotBootstrapCopyFields(
	record: Readonly<Record<string, unknown>>,
	label: string,
	requirement: CopyDataPropertyRequirement,
): Readonly<Record<string, unknown>> {
	const keys = Reflect.ownKeys(record);
	if (keys.length > MAXIMUM_COPY_FIELDS || keys.some((key) => typeof key !== 'string')) {
		throw new RangeError(`${label} has an invalid field inventory.`);
	}
	const output: Record<string, unknown> = Object.create(null);
	for (const key of keys as string[]) {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}.${key} must be an ${requirement}.`);
		}
		output[key] = descriptor.value;
	}
	return Object.freeze(output);
}
