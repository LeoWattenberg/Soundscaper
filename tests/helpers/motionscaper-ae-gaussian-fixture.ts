/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeGaussianProfile } from '../../src/common/editor/motion-ae-gaussian-profile.ts';
export const gaussianHost = { version: '25.0', buildNumber: 17, locale: 'en_US' };
export function motionAeGaussianProfileFixture(): MotionAeGaussianProfile { return { format: 'org.motionscaper.ae-gaussian-profile', version: 1, qualification: 'unqualified', reviewed: true, host: gaussianHost,
	review: { dimensions: 'both', repeatEdgePixels: false, effectOpacity: 100, effectMasks: 'none' }, blurrinessPerSigma: 2, blurrinessPath: ['reviewed-radius'], effectOpacityPath: ['reviewed-compositing', 'reviewed-opacity'],
	controls: { kind: 'group', matchName: 'ADBE Gaussian Blur 2', children: [
		{ kind: 'scalar', matchName: 'reviewed-radius', value: 0, minimum: 0, maximum: 1000 },
		{ kind: 'scalar', matchName: 'reviewed-dimensions', value: 81, minimum: 1, maximum: 100 },
		{ kind: 'scalar', matchName: 'reviewed-repeat', value: 0, minimum: 0, maximum: 1 },
		{ kind: 'group', matchName: 'reviewed-compositing', children: [{ kind: 'scalar', matchName: 'reviewed-opacity', value: 100, minimum: 0, maximum: 100 }, { kind: 'group', matchName: 'reviewed-mask-references', children: [] }] },
	] } }; }
