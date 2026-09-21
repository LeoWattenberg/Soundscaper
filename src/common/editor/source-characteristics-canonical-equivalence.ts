/* SPDX-License-Identifier: AGPL-3.0-only */

type DataRecord = Readonly<Record<string, unknown>>;

/** Canonical JSON used only for normalized source-characteristics equality. */
export function canonicalSourceCharacteristicsJson(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) {
		return `[${value.map(canonicalSourceCharacteristicsJson).join(',')}]`;
	}
	const entries = Object.entries(value as DataRecord)
		.sort(([left], [right]) => (left < right ? -1 : 1));
	return `{${entries.map(([key, entry]) => (
		`${JSON.stringify(key)}:${canonicalSourceCharacteristicsJson(entry)}`
	)).join(',')}}`;
}

export function sourceCharacteristicsCanonicallyEqual(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (left === null || right === null
		|| typeof left !== 'object' || typeof right !== 'object') return false;
	return canonicalSourceCharacteristicsJson(left) === canonicalSourceCharacteristicsJson(right);
}
