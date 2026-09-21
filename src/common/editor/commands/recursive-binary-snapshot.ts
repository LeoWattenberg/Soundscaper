/* SPDX-License-Identifier: AGPL-3.0-only */

type DataRecord = Record<string, unknown>;
type BinaryKind = 'array-buffer' | 'uint8-array';
const BINARY_BYTES = Symbol('recursive-binary-snapshot-bytes');
const BINARY_KIND = Symbol('recursive-binary-snapshot-kind');

interface BinarySnapshot {
	readonly [BINARY_BYTES]: Uint8Array;
	readonly [BINARY_KIND]: BinaryKind;
}

/** Share binary-copy and recursive comparison while callers retain their exact data-property errors. */
export function createRecursiveBinarySnapshotAuthority(
	dataValue: (record: DataRecord, key: string) => unknown,
): Readonly<{
	snapshotValue(value: unknown): unknown;
	snapshotRecord(value: DataRecord, omitted?: ReadonlySet<string>): unknown;
	sameSnapshot(left: unknown, right: unknown): boolean;
}> {
	function snapshotRecord(value: DataRecord, omitted: ReadonlySet<string> = new Set()): unknown {
		const result: DataRecord = {};
		for (const key of Object.keys(value).sort()) {
			if (!omitted.has(key)) result[key] = snapshotValue(dataValue(value, key));
		}
		return Object.freeze(result);
	}

	function snapshotValue(value: unknown): unknown {
		if (value === null || typeof value !== 'object') return value;
		if (value instanceof Uint8Array) return binarySnapshot(value, 'uint8-array');
		if (value instanceof ArrayBuffer) return binarySnapshot(new Uint8Array(value), 'array-buffer');
		if (Array.isArray(value)) return Object.freeze(value.map(snapshotValue));
		return snapshotRecord(record(value));
	}

	function sameSnapshot(left: unknown, right: unknown): boolean {
		if (Object.is(left, right)) return true;
		if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
		const leftBytes = binaryBytes(left);
		const rightBytes = binaryBytes(right);
		if (leftBytes !== null || rightBytes !== null) {
			return leftBytes !== null && rightBytes !== null
				&& binaryKind(left) === binaryKind(right)
				&& leftBytes.byteLength === rightBytes.byteLength
				&& leftBytes.every((value, index) => value === rightBytes[index]);
		}
		if (Array.isArray(left) || Array.isArray(right)) {
			return Array.isArray(left) && Array.isArray(right)
				&& left.length === right.length
				&& left.every((value, index) => sameSnapshot(value, right[index]));
		}
		const leftRecord = left as DataRecord;
		const rightRecord = right as DataRecord;
		const leftKeys = Object.keys(leftRecord).sort();
		const rightKeys = Object.keys(rightRecord).sort();
		return leftKeys.length === rightKeys.length
			&& leftKeys.every((key, index) => key === rightKeys[index]
				&& sameSnapshot(dataValue(leftRecord, key), dataValue(rightRecord, key)));
	}

	return Object.freeze({ snapshotValue, snapshotRecord, sameSnapshot });
}

function binarySnapshot(value: Uint8Array, kind: BinaryKind): BinarySnapshot {
	return Object.freeze({ [BINARY_BYTES]: new Uint8Array(value), [BINARY_KIND]: kind });
}

function binaryBytes(value: object): Uint8Array | null {
	return Object.hasOwn(value, BINARY_BYTES) ? (value as BinarySnapshot)[BINARY_BYTES] : null;
}

function binaryKind(value: object): BinaryKind | null {
	return Object.hasOwn(value, BINARY_KIND) ? (value as BinarySnapshot)[BINARY_KIND] : null;
}

function record(value: object): DataRecord {
	return value as DataRecord;
}
