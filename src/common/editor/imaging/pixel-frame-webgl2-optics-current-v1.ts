/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { prepareLensDistortionEffectV1 } from '../video-lens-distortion-v1.ts';
import { prepareChromaticAberrationEffectV1 } from '../video-chromatic-aberration-v1.ts';
import { prepareDefringeEffectV1 } from '../video-defringe-v1.ts';
import { prepareOpticalVignetteEffectV1 } from '../video-optical-vignette-v1.ts';
import type { PixelFrameDescriptorV1 } from './pixel-frame-contract-v1.ts';
import type { LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import { captureLinearKernelDescriptorV1, LINEAR_KERNEL_LIMITS_V1, type LinearKernelDescriptorV1 } from './linear-kernel-descriptor-v1.ts';
import { prepareLinearLensDistortionV1, writeLinearLensDistortionV1 } from './pixel-frame-linear-lens-distortion-v1.ts';
import { prepareLinearChromaticAberrationV1, writeLinearChromaticAberrationV1 } from './pixel-frame-linear-chromatic-aberration-v1.ts';
import { prepareLinearDefringeV1, writeLinearDefringeV1 } from './pixel-frame-linear-defringe-v1.ts';
import { prepareLinearOpticalVignetteV1, writeLinearOpticalVignetteV1 } from './pixel-frame-linear-optical-vignette-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './pixel-frame-repair-lifetime-v1.ts';

type Vec4 = readonly [number, number, number, number];
type OpticsType = 'lens-distortion-v1' | 'chromatic-aberration-v1' | 'defringe-v1' | 'optical-vignette-v1';
export interface PreparedPixelFrameWebGl2OpticsCurrentV1 {
	readonly id: string;
	readonly type: OpticsType;
	readonly kind: 10 | 11 | 12 | 13;
	readonly sourceDescriptor: LinearKernelDescriptorV1;
	readonly descriptor: LinearKernelDescriptorV1;
	readonly params0: Vec4;
	/** x/y preserve raw authored activity; w retains enabled. Never derive these
	 * flags from rounded coefficients, including a Double coefficient of zero. */
	readonly params1: Vec4;
	readonly supported: boolean;
}
type Cpu = Readonly<{ kind: 10; plan: ReturnType<typeof prepareLinearLensDistortionV1> }>
	| Readonly<{ kind: 11; plan: ReturnType<typeof prepareLinearChromaticAberrationV1> }>
	| Readonly<{ kind: 12; plan: ReturnType<typeof prepareLinearDefringeV1> }>
	| Readonly<{ kind: 13; plan: ReturnType<typeof prepareLinearOpticalVignetteV1> }>;
interface State { readonly pass: Readonly<PreparedPixelFrameWebGl2OpticsCurrentV1>; readonly cpu: Cpu }
const PREPARED = new WeakMap<object, Readonly<State>>();
const tuple = (value: Vec4): Vec4 => Object.freeze([value[0], value[1], value[2], value[3]] as const);

/** Capture complete closed effect/descriptor metadata before pixel access.
 * The private native plans remain the unchanged whole-plane CPU authority;
 * Float32 uniforms never become the reference controls. */
export function preparePixelFrameWebGl2OpticsCurrentV1(effectValue: unknown,
	descriptorValue: PixelFrameDescriptorV1): Readonly<PreparedPixelFrameWebGl2OpticsCurrentV1> {
	const input = record(effectValue, 'native GPU optics', ['id', 'type', 'enabled', 'params']);
	const snapshot = Object.freeze({ id: field(input, 'id', 'native GPU optics'), type: field(input, 'type', 'native GPU optics'),
		enabled: field(input, 'enabled', 'native GPU optics'), params: field(input, 'params', 'native GPU optics') });
	const descriptor = captureLinearKernelDescriptorV1(descriptorValue);
	if (snapshot.type === 'lens-distortion-v1') {
		const effect = prepareLensDistortionEffectV1(snapshot);
		return own(effect.id, effect.type, descriptor, [effect.k, 0, 0, 0], [effect.amount !== 0 ? 1 : 0, 0, 0, effect.enabled ? 1 : 0],
			{ kind: 10, plan: prepareLinearLensDistortionV1(effect.enabled ? effect.amount : 0, descriptor, LINEAR_KERNEL_LIMITS_V1) });
	}
	if (snapshot.type === 'chromatic-aberration-v1') {
		const effect = prepareChromaticAberrationEffectV1(snapshot);
		return own(effect.id, effect.type, descriptor, [effect.redCoefficient, effect.blueCoefficient, 0, 0],
			[effect.red !== 0 ? 1 : 0, effect.blue !== 0 ? 1 : 0, 0, effect.enabled ? 1 : 0], { kind: 11,
				plan: prepareLinearChromaticAberrationV1(effect.enabled ? effect.red : 0, effect.enabled ? effect.blue : 0, descriptor, LINEAR_KERNEL_LIMITS_V1) });
	}
	if (snapshot.type === 'defringe-v1') {
		const effect = prepareDefringeEffectV1(snapshot);
		const params = Object.freeze({ purple: effect.purple, green: effect.green, edgeThreshold: effect.edgeThreshold });
		return own(effect.id, effect.type, descriptor, [effect.purpleAmount, effect.greenAmount, effect.threshold, 0],
			[effect.purple !== 0 || effect.green !== 0 ? 1 : 0, 0, 0, effect.enabled ? 1 : 0], { kind: 12,
				plan: prepareLinearDefringeV1(Object.freeze({ id: effect.id, type: effect.type, enabled: effect.enabled, params }), descriptor, LINEAR_KERNEL_LIMITS_V1) });
	}
	if (snapshot.type === 'optical-vignette-v1') {
		const effect = prepareOpticalVignetteEffectV1(snapshot), params = Object.freeze({ amount: effect.amount });
		return own(effect.id, effect.type, descriptor, [2 * effect.amount / 100, 0, 0, 0],
			[effect.amount !== 0 ? 1 : 0, 0, 0, effect.enabled ? 1 : 0], { kind: 13,
				plan: prepareLinearOpticalVignetteV1(Object.freeze({ id: effect.id, type: effect.type, enabled: effect.enabled, params }), descriptor, LINEAR_KERNEL_LIMITS_V1) });
	}
	throw new RangeError('Unsupported native GPU optics family.');
}

function own(id: string, type: OpticsType, descriptor: LinearKernelDescriptorV1, p0: Vec4, p1: Vec4,
	cpu: Cpu): Readonly<PreparedPixelFrameWebGl2OpticsCurrentV1> {
	const params0 = tuple(p0), params1 = tuple(p1);
	const supported = [...params0, ...params1].every(value => {
		const rounded = Math.fround(value); return Number.isFinite(rounded) && (value === 0 || rounded !== 0);
	});
	const pass = Object.freeze({ id, type, kind: cpu.kind, sourceDescriptor: descriptor, descriptor, params0, params1, supported });
	PREPARED.set(pass, Object.freeze({ pass, cpu: Object.freeze(cpu) })); return pass;
}

/** Identity checks never inspect caller properties, even for revoked proxies. */
export function isPixelFrameWebGl2OpticsCurrentV1(value: unknown): value is Readonly<PreparedPixelFrameWebGl2OpticsCurrentV1> {
	return typeof value === 'object' && value !== null && PREPARED.has(value);
}
export function readPixelFrameWebGl2OpticsCurrentV1(value: unknown): Readonly<PreparedPixelFrameWebGl2OpticsCurrentV1> {
	if (!isPixelFrameWebGl2OpticsCurrentV1(value)) throw new TypeError('Native GPU optics requires an owning prepared identity.');
	return PREPARED.get(value)!.pass;
}

/** No plane or scratch allocation. Callers own the dedicated disjoint source
 * and destination, join this operation and retire their physical backings. */
export async function writePixelFrameWebGl2OpticsCurrentV1(value: unknown, source: LinearWorkingPixelFrameV1,
	target: Float32Array<ArrayBuffer>, signalValue?: AbortSignal): Promise<void> {
	const signal = captureRepairSignalV1(signalValue); checkRepairSignalV1(signal);
	const pass = readPixelFrameWebGl2OpticsCurrentV1(value), cpu = PREPARED.get(pass)!.cpu;
	switch (cpu.kind) {
		case 10: await writeLinearLensDistortionV1(cpu.plan, source, target, signal); break;
		case 11: await writeLinearChromaticAberrationV1(cpu.plan, source, target, signal); break;
		case 12: await writeLinearDefringeV1(cpu.plan, source, target, signal); break;
		case 13: await writeLinearOpticalVignetteV1(cpu.plan, source, target, signal); break;
	}
}
