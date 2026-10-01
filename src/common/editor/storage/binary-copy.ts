/* SPDX-License-Identifier: AGPL-3.0-only */

/** Copy one byte view into an independently owned, exact-length ArrayBuffer. */
export function copyUint8ArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}
