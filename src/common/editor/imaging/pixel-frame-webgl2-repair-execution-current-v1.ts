/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainRecord as record, readClosedDomainField as field } from '../closed-domain-value.ts';
import { readImageDevelopGpuMaskPhasePlanCurrentV1 } from './image-develop-gpu-mask-phase-plan-current-v1.ts';
import { readPixelFrameWebGl2MaskCheckpointPlanCurrentV1 } from './pixel-frame-webgl2-mask-plan-current-v1.ts';
import { readPixelFrameWebGl2RepairCurrentV1 } from './pixel-frame-webgl2-repair-current-v1.ts';
import { executePixelFrameWebGl2RepairPrefixCurrentV1 } from './pixel-frame-webgl2-repair-prefix-current-v1.ts';
import type { PixelFrameWebGl2MaskImageCurrentV1 } from './pixel-frame-webgl2-mask-context-current-v1.ts';
import type { LinearKernelDescriptorV1 } from './linear-kernel-descriptor-v1.ts';
import type { PreparedPixelFrameWebGl2PassCurrentV1 as Pass } from './pixel-frame-webgl2-pass-current-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './pixel-frame-repair-lifetime-v1.ts';
export interface PixelFrameWebGl2RepairExecutionCurrentV1 { readonly kind: 'native-repair-execution-current-v1'; }
interface State {
	readonly phaseValue: unknown; readonly phase: ReturnType<typeof readImageDevelopGpuMaskPhasePlanCurrentV1>;
	readonly checkpoints: ReturnType<typeof readPixelFrameWebGl2MaskCheckpointPlanCurrentV1>;
	readonly prefix: ReturnType<typeof readPixelFrameWebGl2RepairCurrentV1>; readonly check: () => void;
	claimed: boolean; started: boolean;
}
const OWNED = new WeakMap<object, State>();
function own(value: unknown): State {
	const state = value !== null && typeof value === 'object' ? OWNED.get(value) : undefined;
	if (!state) throw new TypeError('Repair native attempt requires its private execution token.'); return state;
}
const same = (a: LinearKernelDescriptorV1, b: LinearKernelDescriptorV1) => a.schemaVersion === b.schemaVersion && a.width === b.width && a.height === b.height
	&& a.sampleFormat === b.sampleFormat && a.transfer === b.transfer && a.primaries === b.primaries;
export function preparePixelFrameWebGl2RepairExecutionCurrentV1(value: unknown): Readonly<PixelFrameWebGl2RepairExecutionCurrentV1> {
	const input = record(value, 'repair native attempt', ['phase', 'checkCurrent']), phaseValue = field(input, 'phase', 'repair native attempt');
	const phase = readImageDevelopGpuMaskPhasePlanCurrentV1(phaseValue), checkpoints = readPixelFrameWebGl2MaskCheckpointPlanCurrentV1(phase.checkpointPlan);
	const prefix = readPixelFrameWebGl2RepairCurrentV1(phase.repairPrefix), method = field(input, 'checkCurrent', 'repair native attempt');
	if (typeof method !== 'function') throw new TypeError('Repair native attempt needs a captured source currentness method.');
	if (!checkpoints.metadata.repairs || phase.imageTextureCount !== 3 || !same(prefix.descriptor, checkpoints.sourceDescriptor)) throw new TypeError('Repair native attempt differs from its exact original-space phase.');
	const check = () => { if (Reflect.apply(method, value, []) !== undefined) throw new TypeError('Repair source currentness must complete synchronously.'); };
	check(); const token = Object.freeze({ kind: 'native-repair-execution-current-v1' as const });
	OWNED.set(token, { phaseValue, phase, checkpoints, prefix, check, claimed: false, started: false }); return token;
}
export function claimPixelFrameWebGl2RepairExecutionCurrentV1(value: unknown, descriptor: LinearKernelDescriptorV1, passes: readonly Pass[]) {
	const state = own(value); state.check(); if (state.claimed) throw new TypeError('Repair native attempt was already claimed.');
	if (!same(descriptor, state.prefix.descriptor) || passes.length !== state.checkpoints.passes.length || passes.some((pass, at) => pass !== state.checkpoints.passes[at])) throw new TypeError('Repair context differs from its complete source/recipe phase.');
	state.claimed = true; return Object.freeze({ phaseValue: state.phaseValue, phase: state.phase, checkpoints: state.checkpoints, repairPrefix: state.prefix });
}
export async function executePixelFrameWebGl2RepairExecutionCurrentV1(value: unknown, gl: WebGL2RenderingContext,
	images: readonly [Readonly<PixelFrameWebGl2MaskImageCurrentV1>, Readonly<PixelFrameWebGl2MaskImageCurrentV1>, Readonly<PixelFrameWebGl2MaskImageCurrentV1>],
	unavailable: (reason: string) => never, signalValue?: AbortSignal): Promise<0 | 1 | 2> {
	const signal = captureRepairSignalV1(signalValue); checkRepairSignalV1(signal); const state = own(value); state.check();
	if (!state.claimed || state.started) throw new TypeError('Repair prefix needs its single claimed native attempt.'); state.started = true;
	if (!state.phase.eligible) unavailable('working-set');
	const result = await executePixelFrameWebGl2RepairPrefixCurrentV1(gl, state.prefix, images, state.check, unavailable, signal);
	state.check(); return result.index;
}
