/* SPDX-License-Identifier: AGPL-3.0-only */

/** Platform-local, immutable body reader; it is never serialized into authored project intent. */
export interface MotionAssetBody {
	readonly size: number;
	stream(): ReadableStream<Uint8Array>;
}
