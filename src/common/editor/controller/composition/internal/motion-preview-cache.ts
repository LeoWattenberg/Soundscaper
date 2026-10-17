/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionPreviewFrame } from '../motion-preview-types.ts';

export function createMotionPreviewCache(maximumBytes: number) {
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > 256 * 1024 * 1024) throw new RangeError('Motion preview cache budget must be between zero and 256 MiB.');
	const values = new Map<string, MotionPreviewFrame>(); let bytes = 0;
	return {
		get byteLength() { return bytes; },
		get(key: string, generation: number): MotionPreviewFrame | null {
			const value = values.get(key); if (!value) return null;
			values.delete(key); values.set(key, value);
			return { ...value, generation, rgba: new Uint8ClampedArray(value.rgba) };
		},
		put(key: string, value: MotionPreviewFrame): void {
			if (value.rgba.byteLength > maximumBytes) return;
			const prior = values.get(key); if (prior) { bytes -= prior.rgba.byteLength; values.delete(key); }
			while (bytes + value.rgba.byteLength > maximumBytes) {
				const oldest = values.entries().next().value; if (!oldest) break;
				values.delete(oldest[0]); bytes -= oldest[1].rgba.byteLength;
			}
			values.set(key, { ...value, rgba: new Uint8ClampedArray(value.rgba) }); bytes += value.rgba.byteLength;
		},
		clear(): void { values.clear(); bytes = 0; },
	};
}
