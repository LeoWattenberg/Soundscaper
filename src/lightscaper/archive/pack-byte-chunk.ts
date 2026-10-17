/* SPDX-License-Identifier: AGPL-3.0-only */

/** An intrinsic borrowed view; callers must copy it before asynchronous retention. */
export function photoPackByteView(value: unknown): Uint8Array<ArrayBuffer> {
	if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype
		|| ['buffer', 'byteLength', 'byteOffset', 'length'].some((key) => Object.hasOwn(value, key))) {
		throw new TypeError('Photo pack source requires intrinsic byte chunks.');
	}
	if (!(value.buffer instanceof ArrayBuffer)
		|| Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get?.call(value.buffer) === true) {
		throw new TypeError('Photo pack source requires fixed byte buffers.');
	}
	return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}
