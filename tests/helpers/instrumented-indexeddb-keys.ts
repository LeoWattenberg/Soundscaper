/* SPDX-License-Identifier: AGPL-3.0-only */

/** Key/range semantics used by the instrumented database; native browser tests remain authoritative. */
export function compareInstrumentedKeys(left: unknown, right: unknown): number {
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left)) return -1;
		if (!Array.isArray(right)) return 1;
		for (let index = 0; index < Math.min(left.length, right.length); index++) {
			const comparison = compareInstrumentedKeys(left[index], right[index]);
			if (comparison) return comparison;
		}
		return Math.sign(left.length - right.length);
	}
	if (left === right) return 0;
	if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : 1;
	if (typeof left === 'number') return -1;
	if (typeof right === 'number') return 1;
	if (left instanceof Date && right instanceof Date) return Math.sign(left.getTime() - right.getTime());
	if (left instanceof Date) return -1;
	if (right instanceof Date) return 1;
	return String(left) < String(right) ? -1 : 1;
}

export class InstrumentedKeyRange {
	private constructor(readonly lower: IDBValidKey | undefined, readonly upper: IDBValidKey | undefined,
		readonly lowerOpen: boolean, readonly upperOpen: boolean) {}
	static bound(lower: IDBValidKey, upper: IDBValidKey, lowerOpen = false, upperOpen = false): InstrumentedKeyRange {
		const comparison = compareInstrumentedKeys(lower, upper);
		if (comparison > 0 || comparison === 0 && (lowerOpen || upperOpen)) throw new DOMException('Invalid key range.', 'DataError');
		return new InstrumentedKeyRange(lower, upper, lowerOpen, upperOpen);
	}
	static lowerBound(lower: IDBValidKey, open = false): InstrumentedKeyRange { return new InstrumentedKeyRange(lower, undefined, open, false); }
	static upperBound(upper: IDBValidKey, open = false): InstrumentedKeyRange { return new InstrumentedKeyRange(undefined, upper, false, open); }
	static only(key: IDBValidKey): InstrumentedKeyRange { return new InstrumentedKeyRange(key, key, false, false); }
	includes(key: unknown): boolean {
		const lower = this.lower === undefined ? 1 : compareInstrumentedKeys(key, this.lower);
		const upper = this.upper === undefined ? -1 : compareInstrumentedKeys(key, this.upper);
		return (lower > 0 || lower === 0 && !this.lowerOpen) && (upper < 0 || upper === 0 && !this.upperOpen);
	}
}

export function matchesInstrumentedQuery(key: unknown, query: unknown): boolean {
	return query === undefined || query === null || (query instanceof InstrumentedKeyRange ? query.includes(key) : compareInstrumentedKeys(key, query) === 0);
}

export function instrumentedKeyPath(value: Record<string, unknown>, path: string | readonly string[]): unknown {
	return Array.isArray(path) ? path.map((field: string) => value[field]) : value[path as string];
}
