/* SPDX-License-Identifier: AGPL-3.0-only */

/** Validate one canonical little-endian Float32 PCM byte sequence. */
export function assertFiniteFloat32Pcm(
	value: unknown,
	createError: () => Error,
): asserts value is Uint8Array {
	if (!(value instanceof Uint8Array)
		|| value.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
		throw createError();
	}
	const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
	for (let offset = 0; offset < value.byteLength; offset += Float32Array.BYTES_PER_ELEMENT) {
		if (!Number.isFinite(view.getFloat32(offset, true))) throw createError();
	}
}
