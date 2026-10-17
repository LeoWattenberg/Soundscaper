/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionCompositionFrame } from './motion-composition-evaluation.ts';
import type { MotionDepthPlan } from './motion-depth-plan.ts';
import { MOTION_MAXIMUM_DEPTH_RAYS } from './motion-depth-plan.ts';
import type { MotionVector3 } from './motion-property.ts';
import { motionNumber } from './motion-values.ts';

export interface MotionLight {
	readonly kind: 'ambient' | 'point' | 'spot'; readonly rgb: MotionVector3; readonly position: MotionVector3; readonly direction: MotionVector3;
	readonly outerCone: number; readonly innerCone: number; readonly castsShadows: boolean;
}
export interface MotionLighting { readonly lights: readonly MotionLight[] }

/** Own linear-SDR, two-sided Lambert/Blinn response; point/spot intensity has no distance attenuation. */
export function planMotionLighting(frame: MotionCompositionFrame, depth: MotionDepthPlan): MotionLighting {
	const lights: MotionLight[] = [];
	for (const layer of frame.layers) {
		if (layer.state.kind !== 'light') continue;
		const state = layer.state;
		const intensity = motionNumber(state.intensity, 'light intensity', 0, 64);
		state.color.forEach((value) => motionNumber(value, 'light color', 0, 1));
		const cone = motionNumber(state.coneAngle, 'light cone angle', 0, 180) * Math.PI / 360;
		const feather = motionNumber(state.coneFeather, 'light cone feather', 0, 1);
		const m = layer.worldMatrix; if (m.some((value) => !Number.isFinite(value))) throw new RangeError('Motion light world transform must be finite.');
		const length = Math.hypot(m[8], m[9], m[10]); if (state.lightType === 'spot' && (!Number.isFinite(length) || length <= 1e-12)) throw new RangeError('Motion spot light orientation must be finite and nonsingular.');
		lights.push(Object.freeze({ kind: state.lightType, rgb: Object.freeze(state.color.slice(0, 3).map((value) => value * state.color[3] * intensity)) as unknown as MotionVector3,
			position: Object.freeze([m[12], m[13], m[14]]) as MotionVector3, direction: Object.freeze(length ? [m[8] / length, m[9] / length, m[10] / length] : [0, 0, 1]) as MotionVector3,
			outerCone: Math.cos(cone), innerCone: Math.cos(cone * (1 - feather)), castsShadows: state.castsShadows && state.lightType !== 'ambient' }));
	}
	if (lights.length > 32) throw new RangeError('Motion lighting exceeds its 32-light budget.');
	for (const plane of depth.planes) {
		const material = plane.layer.state.material;
		motionNumber(material.ambient, 'material ambient', 0, 1); motionNumber(material.diffuse, 'material diffuse', 0, 1);
		motionNumber(material.specular, 'material specular', 0, 1); motionNumber(material.shininess, 'material shininess', 0, 1024);
	}
	const casters = depth.planes.filter((plane) => plane.layer.state.material.castsShadows).length;
	const work = frame.width * frame.height * depth.planes.length * depth.lenses.length * (1 + lights.length + lights.filter((light) => light.castsShadows).length * casters);
	if (!Number.isSafeInteger(work) || work > MOTION_MAXIMUM_DEPTH_RAYS) throw new RangeError('Motion lighting/shadow ray workload exceeds its ray budget; reduce canvas size, lights or shadow casters.');
	return Object.freeze({ lights: Object.freeze(lights) });
}
