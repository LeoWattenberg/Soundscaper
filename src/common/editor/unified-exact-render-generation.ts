/* SPDX-License-Identifier: AGPL-3.0-only */

export function requireMinimumRenderGeneration(actual: number, minimum: number, kind: unknown): void {
	if (actual < minimum) {
		throw new RangeError(`${String(kind)} render node requires plan generation V${String(minimum)}.`);
	}
}

export function requireDormantRenderGeneration(
	actual: number,
	allowed: readonly number[],
	kind: unknown,
): void {
	if (!allowed.includes(actual)) {
		throw new RangeError(`Selected generation V${String(actual)} does not inherit dormant ${String(kind)} authority.`);
	}
}

export function requireSelectedRenderGeneration(actual: number, expected: number, kind: unknown): void {
	if (actual !== expected) {
		throw new RangeError(`${String(kind)} render node requires selected plan V${String(expected)}.`);
	}
}
