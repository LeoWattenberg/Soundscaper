/* SPDX-License-Identifier: AGPL-3.0-only */

export function sameProjectSnapshot(left: unknown, right: unknown): boolean {
	return sameSnapshotValue(left, right, new Map<object, object>());
}

function sameSnapshotValue(left: unknown, right: unknown, seen: Map<object, object>): boolean {
	if (Object.is(left, right)) return true;
	if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
	if (left instanceof Date || right instanceof Date) {
		return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
	}
	if (left instanceof ArrayBuffer || right instanceof ArrayBuffer) {
		return left instanceof ArrayBuffer && right instanceof ArrayBuffer
			&& sameBytes(new Uint8Array(left), new Uint8Array(right));
	}
	if (ArrayBuffer.isView(left) || ArrayBuffer.isView(right)) {
		return ArrayBuffer.isView(left) && ArrayBuffer.isView(right)
			&& left.constructor === right.constructor
			&& sameBytes(
				new Uint8Array(left.buffer, left.byteOffset, left.byteLength),
				new Uint8Array(right.buffer, right.byteOffset, right.byteLength),
			);
	}
	if (Array.isArray(left) !== Array.isArray(right)) return false;
	if (!Array.isArray(left)) {
		const leftPrototype = Object.getPrototypeOf(left) as unknown;
		const rightPrototype = Object.getPrototypeOf(right) as unknown;
		if (leftPrototype !== rightPrototype
			|| leftPrototype !== Object.prototype && leftPrototype !== null) return false;
	}
	const prior = seen.get(left);
	if (prior) return prior === right;
	seen.set(left, right);
	const leftKeys = Reflect.ownKeys(left);
	const rightKeys = Reflect.ownKeys(right);
	if (leftKeys.length !== rightKeys.length || leftKeys.some((key) => !rightKeys.includes(key))) return false;
	for (const key of leftKeys) {
		const leftDescriptor = Object.getOwnPropertyDescriptor(left, key);
		const rightDescriptor = Object.getOwnPropertyDescriptor(right, key);
		if (!leftDescriptor || !rightDescriptor
			|| !Object.hasOwn(leftDescriptor, 'value') || !Object.hasOwn(rightDescriptor, 'value')
			|| leftDescriptor.enumerable !== rightDescriptor.enumerable
			|| !sameSnapshotValue(leftDescriptor.value, rightDescriptor.value, seen)) return false;
	}
	return true;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}
