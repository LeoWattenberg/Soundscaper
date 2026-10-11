/* SPDX-License-Identifier: AGPL-3.0-only */
import { exportMotionAeGaussianEffects } from '../../src/common/editor/motion-ae-gaussian-conversion.ts';
import { motionAeGaussianProfileFixture } from './motionscaper-ae-gaussian-fixture.ts';
import { createMotionLayer } from '../../src/motionscaper/editor-project.ts';
import { motionScalar } from '../../src/common/editor/motion-property.ts';
import type { MotionAeExchange } from '../../src/common/editor/motion-ae-exchange-types.ts';
export function gaussianExchange(): MotionAeExchange {
	const gaussianProfile = motionAeGaussianProfileFixture(), layer = { ...createMotionLayer({ id: 'layer', name: 'Blur', durationFrames: 24, content: { kind: 'null' } }), effects: [{ id: 'blur', type: 'gaussian-blur', enabled: true, parameters: [{ id: 'sigma', value: motionScalar(3) }] }] };
	return { format: 'org.motionscaper.ae-exchange', version: 1, transferId: 'reviewed-gaussian', gaussianProfile,
		producer: { application: 'motionscaper', version: '0.1.0', bridgeVersion: '0.1.0' }, source: { name: 'Blur', revisionDigest: null }, color: { workingSpace: '', linearBlending: true, bitsPerChannel: 32 }, footage: [], report: [],
		compositions: [{ id: 'comp', name: 'Blur', width: 64, height: 64, pixelAspect: 1, frameRate: 24, duration: 1, displayStartTime: 0, background: [0, 0, 0], layers: [{ id: 'layer', name: 'Blur', kind: 'null', sourceId: null, parentId: null, matte: null,
			startTime: 0, inPoint: 0, outPoint: 1, stretch: 100, enabled: true, threeD: false, adjustment: false, blendMode: 'normal', effectsActive: true, compositing: { preserveTransparency: false, collapseTransformation: false }, properties: exportMotionAeGaussianEffects(layer, { num: 24, den: 1 }, gaussianProfile, []) }] }] };
}
