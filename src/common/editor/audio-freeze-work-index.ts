/* SPDX-License-Identifier: AGPL-3.0-only */

type DataRecord = Readonly<Record<string, unknown>>;

export function inspectFreezeDataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a plain record.`);
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record.`);
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') throw new TypeError(`${name} must contain only named own data properties.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
			throw new TypeError(`${name}.${key} must be an enumerable own data property.`);
		}
		output[key] = descriptor.value as unknown;
	}
	return Object.freeze(output);
}

export function freezeStableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} ID must be nonempty.`);
	return value;
}

/** First query retains linear diagnostic order, including an early requested-ID duplicate. */
export function createExactFreezeRecordIndex(values: readonly unknown[], name: string) {
	let slots: Map<string, { first: number; duplicate: boolean }> | undefined;
	const records: DataRecord[] = [];
	const ids: string[] = [];
	const duplicate = (id: string): never => { throw new RangeError(`${name} ID ${id} is duplicated.`); };
	return {
		indexOf(id: string): number {
			if (!slots) {
				const pending = new Map<string, { first: number; duplicate: boolean }>();
				for (let index = 0; index < values.length; index++) {
					const label = `${name} ${String(index)}`;
					const record = inspectFreezeDataRecord(values[index], label);
					const candidateId = freezeStableId(record.id, label);
					records.push(record); ids.push(candidateId);
					const previous = pending.get(candidateId);
					if (previous) {
						previous.duplicate = true;
						if (candidateId === id) duplicate(id);
					} else pending.set(candidateId, { first: index, duplicate: false });
				}
				slots = pending;
			}
			const slot = slots.get(id);
			if (slot?.duplicate) duplicate(id);
			return slot?.first ?? -1;
		},
		recordAt(index: number): DataRecord { return records[index]!; },
		idAt(index: number): string { return ids[index]!; },
	};
}
