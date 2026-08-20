/* SPDX-License-Identifier: AGPL-3.0-only */

export type ProjectDataRecord = Record<string, unknown>;

export function projectRecord(value: unknown, name: string): ProjectDataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as ProjectDataRecord;
}

export function projectArray(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value;
}

export function projectString(value: unknown, name: string, allowEmpty = false): string {
	if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
		throw new TypeError(`${name} must be ${allowEmpty ? 'a string' : 'a non-empty string'}.`);
	}
	return value;
}

export function projectOptionalId(value: unknown, name: string): string | null {
	if (value === null) return null;
	return projectString(value, name);
}

export function projectBoolean(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean.`);
	return value;
}

export function projectSafeInteger(value: unknown, minimum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`${name} must be a safe integer greater than or equal to ${String(minimum)}.`);
	}
	return Number(value);
}

export function projectFiniteInRange(
	value: unknown,
	minimum: number,
	maximum: number,
	name: string,
): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new RangeError(`${name} must be between ${String(minimum)} and ${String(maximum)}.`);
	}
	return value;
}

export function projectPositiveFinite(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		throw new RangeError(`${name} must be positive.`);
	}
	return value;
}

export function projectTimestamp(value: unknown, name: string): string {
	const timestamp = projectString(value, name);
	const date = new Date(timestamp);
	if (!Number.isFinite(date.getTime()) || date.toISOString() !== timestamp) {
		throw new TypeError(`${name} must be a canonical ISO timestamp.`);
	}
	return timestamp;
}

export function projectUniqueStrings(value: unknown, name: string): readonly string[] {
	const values = projectArray(value, name).map((item, index) => (
		projectString(item, `${name}[${String(index)}]`)
	));
	if (new Set(values).size !== values.length) {
		throw new RangeError(`${name} cannot contain duplicate IDs.`);
	}
	return values;
}

export function projectUniqueIds(values: readonly unknown[], name: string): void {
	const ids = new Set<string>();
	for (const [index, value] of values.entries()) {
		const item = projectRecord(value, `${name}[${String(index)}]`);
		const id = projectString(item.id, `${name}[${String(index)}].id`);
		if (ids.has(id)) throw new RangeError(`${name} cannot contain duplicate ID: ${id}.`);
		ids.add(id);
	}
}

export function validateProjectEnvelope(value: unknown, name: string): void {
	const points = projectArray(value, name);
	let previousFrame = -1;
	for (const [index, value] of points.entries()) {
		const point = projectRecord(value, `${name}[${String(index)}]`);
		const frame = projectSafeInteger(point.frame, 0, `${name}[${String(index)}].frame`);
		projectFiniteInRange(point.value, 0, 16, `${name}[${String(index)}].value`);
		if (frame <= previousFrame) throw new RangeError(`${name} points must use strictly increasing frames.`);
		previousFrame = frame;
	}
}
