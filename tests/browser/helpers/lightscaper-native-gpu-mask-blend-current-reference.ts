/* SPDX-License-Identifier: AGPL-3.0-only */

import { blendLinearMaskCurrentV1, type LinearMaskBlendPolicyCurrentV1 } from '../../../src/common/editor/imaging/image-develop-linear-mask-blend-current-v1.ts';

export interface MaskBlendComponentRequest {
	readonly incoming: readonly number[];
	readonly candidate: readonly number[];
	readonly coverage: readonly number[];
	readonly policy: LinearMaskBlendPolicyCurrentV1;
}
const bits = (values: Float32Array<ArrayBuffer>): number[] => [...new Uint32Array(values.buffer, values.byteOffset, values.length)];
/** Actual shared Current CPU finisher, not a test formula or rounded GPU data.
 * Its extraction must delegate the existing permanent generic owner and lift
 * Current equality/CA restoration unchanged before this draft is runnable. */
export async function referenceNativeMaskBlendCurrentV1(value: MaskBlendComponentRequest) {
	const incoming = Float32Array.from(value.incoming), target = Float32Array.from(value.candidate), coverage = Uint8Array.from(value.coverage);
	if (incoming.length !== target.length || incoming.length !== coverage.length * 4 || !coverage.length || coverage.length > 256) throw new RangeError('Blend component requires bounded equal RGBA planes.');
	const before = bits(incoming), candidate = bits(target), frame = { descriptor: { schemaVersion: 1 as const, width: coverage.length, height: 1,
		sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }, pixels: incoming };
	try {
		await blendLinearMaskCurrentV1(frame, target, coverage, value.policy);
		const output = bits(target);
		if (bits(incoming).some((word, index) => word !== before[index])) throw new Error('CPU blend changed incoming source custody.');
		return { before, candidate, expected: output, coverage: [...coverage], width: coverage.length };
	} finally { incoming.fill(0); target.fill(0); coverage.fill(0); }
}
