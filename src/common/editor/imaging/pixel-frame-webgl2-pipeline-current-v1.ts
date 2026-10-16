/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainArray as array } from '../closed-domain-value.ts';
import { captureLinearKernelDescriptorV1 } from './linear-kernel-descriptor-v1.ts';
import { readPixelFrameWebGl2PassCurrentV1 } from './pixel-frame-webgl2-pass-current-v1.ts';

/** One legacy geometry can precede the complete256-effect authored stack.
 * Admit all private pass bindings and natural extents before native samples.
 * Two maximum-extent textures and, for nonlocal recipes, two normative CPU
 * planes conservatively bound changing ping-pong extents without provenance
 * images or recursive neighborhood evaluation. */
export function planPixelFrameWebGl2PipelineCurrentV1(descriptorValue: unknown, values: unknown) {
	const sourceDescriptor = captureLinearKernelDescriptorV1(descriptorValue);
	const passes = Object.freeze(array(values, 'Native GPU passes', 0, 257).map(readPixelFrameWebGl2PassCurrentV1));
	let current = sourceDescriptor, maximumFrameBytes = current.width * current.height * 16, hasGeometry = false, hasOptics = false;
	const steps = passes.map(pass => {
		const sourceDescriptor = current;
		if ('sourceDescriptor' in pass) {
			if (pass.sourceDescriptor.width !== current.width || pass.sourceDescriptor.height !== current.height
				|| pass.sourceDescriptor.primaries !== current.primaries) throw new RangeError('Native GPU descriptor chain does not match its prepared binding.');
			current = pass.descriptor;
			if (pass.kind === 9) hasGeometry = true; else hasOptics = true;
		}
		maximumFrameBytes = Math.max(maximumFrameBytes, current.width * current.height * 16);
		return Object.freeze({ pass, sourceDescriptor, descriptor: current });
	});
	const hasPlaneReference = hasGeometry || hasOptics;
	return Object.freeze({ sourceDescriptor, finalDescriptor: current, passes, steps: Object.freeze(steps), maximumFrameBytes,
		hasGeometry, hasOptics, hasPlaneReference, textureBytes: maximumFrameBytes * 2, referenceBytes: hasPlaneReference ? maximumFrameBytes * 2 : 0,
		readbackBytes: current.width * current.height * 16 });
}
