/* SPDX-License-Identifier: AGPL-3.0-only */
import { planPixelFrameV1, type PixelFrameDescriptorV1 } from './pixel-frame-contract-v1.ts';

export type LinearKernelDescriptorV1 = Readonly<PixelFrameDescriptorV1 & { sampleFormat: 'float32'; transfer: 'linear'; primaries: 'srgb' | 'bt709' }>;
export const LINEAR_KERNEL_LIMITS_V1 = Object.freeze({ maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 268_435_456 });

/** Scalar admission shared by metadata planning and native pixel owners. */
export function captureLinearKernelDescriptorV1(value: unknown): LinearKernelDescriptorV1 {
	const { descriptor } = planPixelFrameV1(value, LINEAR_KERNEL_LIMITS_V1);
	if (descriptor.sampleFormat !== 'float32' || descriptor.transfer !== 'linear' || (descriptor.primaries !== 'srgb' && descriptor.primaries !== 'bt709')) {
		throw new RangeError('Linear kernels require native Float32 linear sRGB/BT709.');
	}
	return descriptor as LinearKernelDescriptorV1;
}
