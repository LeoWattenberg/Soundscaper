/* SPDX-License-Identifier: AGPL-3.0-only */

export function reverseFloat32(input: Float32Array): Float32Array {
	const output = new Float32Array(input.length);
	for (let index = 0; index < input.length; index += 1) output[index] = input[input.length - index - 1]!;
	return output;
}

export function stableSerialize(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(Object.is(value, -0) ? 0 : value);
	if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record).sort()
		.map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
}

export function cloneJson<Value>(value: Value): Value {
	if (value == null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}
