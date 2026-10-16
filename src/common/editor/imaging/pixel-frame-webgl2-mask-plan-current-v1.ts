/* SPDX-License-Identifier: AGPL-3.0-only */

import { readLinearDevelopAuthoredSlotsCurrentV1, type prepareLinearDevelopMetadataCurrentV1,
	type LinearDevelopMetadataStageCurrentV1 } from './image-develop-linear-metadata-current-v1.ts';
import type { LinearDevelopAuthoredSlotCurrentV1 } from './image-develop-linear-authored-slots-current-v1.ts';
import { imageDevelopMaskTransformsCurrentV1, type ImageDevelopMaskTransformCurrentV1 } from './image-develop-mask-plan-current-v1.ts';
import type { ImageDevelopMaskBindingPlanV1, ImageDevelopMaskPlanV1 } from './image-develop-mask-plan-v1.ts';
import type { LinearKernelDescriptorV1 } from './linear-kernel-descriptor-v1.ts';
import { preparePixelFrameWebGl2ColorsCurrentV1, type PreparedPixelFrameWebGl2ColorCurrentV1 } from './pixel-frame-webgl2-color-current-v1.ts';
import { preparePixelFrameWebGl2LutCurrentV1 } from './pixel-frame-webgl2-lut-current-v1.ts';
import { preparePixelFrameWebGl2GeometryCurrentV1 } from './pixel-frame-webgl2-geometry-current-v1.ts';
import { preparePixelFrameWebGl2OpticsCurrentV1 } from './pixel-frame-webgl2-optics-current-v1.ts';
import { preparePixelFrameWebGl2SpatialCurrentV1 } from './pixel-frame-webgl2-spatial-current-v1.ts';
import { readPixelFrameWebGl2PassCurrentV1, type PreparedPixelFrameWebGl2PassCurrentV1 } from './pixel-frame-webgl2-pass-current-v1.ts';

type Metadata = ReturnType<typeof prepareLinearDevelopMetadataCurrentV1>;
type Authored = ReturnType<typeof readLinearDevelopAuthoredSlotsCurrentV1>;
type Pass = PreparedPixelFrameWebGl2PassCurrentV1;
export type PixelFrameWebGl2MaskBlendCurrentV1 = Readonly<{ kind: 'generic' | 'unchanged-components' }>
	| Readonly<{ kind: 'ca-copy'; copyRed: boolean; copyBlue: boolean }>;
export interface PixelFrameWebGl2MaskCheckpointCurrentV1 {
	readonly index: number;
	/** Dense receipt index for observe/blend; declared-only never produces a receipt. */
	readonly executionIndex: number | null;
	readonly slotOrdinal: number;
	readonly stageIndex: number;
	readonly effectId: string;
	readonly maskId: string;
	readonly width: number;
	readonly height: number;
	readonly binding: Readonly<ImageDevelopMaskBindingPlanV1>;
	readonly selected: boolean;
	readonly mode: 'declared-only' | 'observe' | 'blend';
	readonly blend: PixelFrameWebGl2MaskBlendCurrentV1;
	readonly suffix: readonly ImageDevelopMaskTransformCurrentV1[];
}
export interface PixelFrameWebGl2MaskSlotCurrentV1 {
	readonly ordinal: number;
	readonly stageIndex: number | null;
	readonly authored: Readonly<LinearDevelopAuthoredSlotCurrentV1>;
	readonly identity: LinearDevelopAuthoredSlotCurrentV1['identity'];
	readonly incoming: LinearKernelDescriptorV1;
	readonly output: LinearKernelDescriptorV1;
	readonly pass: Pass | undefined;
	readonly candidateRequired: boolean;
	readonly checkpoint: Readonly<PixelFrameWebGl2MaskCheckpointCurrentV1> | undefined;
}
export interface PixelFrameWebGl2MaskGraphAdmissionCurrentV1 {
	readonly checkpointIndex: number;
	readonly executionIndex: number;
	readonly slotOrdinal: number;
	readonly binding: Readonly<ImageDevelopMaskBindingPlanV1>;
	readonly graph: ImageDevelopMaskBindingPlanV1['graph'];
	readonly descriptor: LinearKernelDescriptorV1;
}
export interface PreparedPixelFrameWebGl2MaskPlanCurrentV1 {
	readonly sourceDescriptor: LinearKernelDescriptorV1;
	readonly finalDescriptor: LinearKernelDescriptorV1;
	readonly maskPlan: Readonly<ImageDevelopMaskPlanV1>;
	readonly slots: readonly Readonly<PixelFrameWebGl2MaskSlotCurrentV1>[];
	readonly passes: readonly Pass[];
	readonly checkpoints: readonly Readonly<PixelFrameWebGl2MaskCheckpointCurrentV1>[];
	readonly executedCheckpoints: readonly Readonly<PixelFrameWebGl2MaskCheckpointCurrentV1>[];
	readonly selectedCheckpointIndex: number | undefined;
	readonly selectedExecutionIndex: number | undefined;
	readonly maximumFrameBytes: number;
	readonly imageTextureCount: 2 | 3;
	readonly referenceBytes: number;
	/** Existing admitted CPU mask/resource component, not a new complete GPU peak. */
	readonly knownMaskComponentBytes: number;
	/** Inert compiler requests, not compiled-graph or resource-body authority. */
	readonly graphAdmissionRequests: readonly Readonly<PixelFrameWebGl2MaskGraphAdmissionCurrentV1>[];
	readonly graphAdmissionComplete: boolean;
	readonly graphGpuBytes: number | null;
}
export interface PixelFrameWebGl2MaskCheckpointPlanCurrentV1 extends PreparedPixelFrameWebGl2MaskPlanCurrentV1 {
	readonly metadata: Metadata;
	readonly authored: Authored;
}
interface State {
	readonly plan: Readonly<PreparedPixelFrameWebGl2MaskPlanCurrentV1>;
	readonly checkpoints: Readonly<PixelFrameWebGl2MaskCheckpointPlanCurrentV1>;
}
const PREPARED = new WeakMap<object, State>();
const GENERIC = Object.freeze({ kind: 'generic' as const }), UNCHANGED = Object.freeze({ kind: 'unchanged-components' as const });

function descriptorEqual(a: LinearKernelDescriptorV1, b: LinearKernelDescriptorV1): boolean {
	return a.schemaVersion === b.schemaVersion && a.width === b.width && a.height === b.height
		&& a.sampleFormat === b.sampleFormat && a.primaries === b.primaries && a.transfer === b.transfer;
}
function effectFor(metadata: Metadata, slot: Readonly<LinearDevelopAuthoredSlotCurrentV1>) {
	if (slot.identity.origin === 'legacy-geometry') return undefined;
	const effect = metadata.develop.effects[slot.identity.effectIndex];
	if (!effect || effect.id !== slot.identity.effectId || effect.type !== slot.identity.effectType || effect.enabled !== slot.identity.enabled) {
		throw new RangeError('Native GPU slot differs from its captured authored identity.');
	}
	return effect;
}
function prepareStage(metadata: Metadata, slot: Readonly<LinearDevelopAuthoredSlotCurrentV1>, stage: LinearDevelopMetadataStageCurrentV1 | undefined,
	colors: ReadonlyMap<string, Readonly<PreparedPixelFrameWebGl2ColorCurrentV1>>): Readonly<{ pass: Pass | undefined; candidateRequired: boolean }> {
	if (!stage) return { pass: undefined, candidateRequired: false };
	const effect = effectFor(metadata, slot);
	switch (stage.kind) {
		case 'geometry': return { pass: preparePixelFrameWebGl2GeometryCurrentV1(stage.geometry, slot.incoming), candidateRequired: true };
		case 'color': { const pass = colors.get(stage.effect.id); return { pass, candidateRequired: pass !== undefined }; }
		case 'lut': return { pass: preparePixelFrameWebGl2LutCurrentV1({ id: stage.id, reference: stage.reference }), candidateRequired: true };
		case 'lens-distortion': case 'chromatic-aberration':
			if (!effect) throw new RangeError('Native GPU optics require their real authored identity.');
			return { pass: preparePixelFrameWebGl2OpticsCurrentV1(effect, slot.incoming), candidateRequired: true };
		case 'defringe': case 'optical-vignette':
			return { pass: preparePixelFrameWebGl2OpticsCurrentV1(stage.effect, slot.incoming), candidateRequired: stage.active };
		case 'spatial': return { pass: preparePixelFrameWebGl2SpatialCurrentV1(stage.effect, slot.incoming), candidateRequired: stage.active };
		case 'noop': return { pass: undefined, candidateRequired: false };
	}
}
function blendFor(metadata: Metadata, slot: Readonly<LinearDevelopAuthoredSlotCurrentV1>): PixelFrameWebGl2MaskBlendCurrentV1 {
	const effect = effectFor(metadata, slot);
	if (effect?.type === 'chromatic-aberration-v1') return Object.freeze({ kind: 'ca-copy', copyRed: effect.params.red === 0, copyBlue: effect.params.blue === 0 });
	return effect?.type === 'defringe-v1' || effect?.type === 'optical-vignette-v1' ? UNCHANGED : GENERIC;
}

/** Preserve complete authored traversal while preparing each genuine GPU pass
 * exactly once. No graph compiler, pixels, resource body or context is opened.
 * Incomplete graph admission is explicit and cannot enable mask execution. */
export function preparePixelFrameWebGl2MaskPlanCurrentV1(value: unknown): Readonly<PreparedPixelFrameWebGl2MaskPlanCurrentV1> {
	const authored = readLinearDevelopAuthoredSlotsCurrentV1(value);
	// The private scalar-owner identity above is the runtime type proof.
	const metadata = value as Metadata;
	if (authored.maskPlan !== metadata.masks.plan) throw new RangeError('Native GPU slots require their original Current mask plan.');
	const colors = preparePixelFrameWebGl2ColorsCurrentV1(metadata.stages.flatMap(stage => stage.kind === 'color' ? [stage.effect] : []));
	const byId = new Map(colors.map(pass => [pass.id, pass] as const)), passes: Pass[] = [];
	const slots: Readonly<PixelFrameWebGl2MaskSlotCurrentV1>[] = [], checkpoints: Readonly<PixelFrameWebGl2MaskCheckpointCurrentV1>[] = [];
	const executed: Readonly<PixelFrameWebGl2MaskCheckpointCurrentV1>[] = [], requests: Readonly<PixelFrameWebGl2MaskGraphAdmissionCurrentV1>[] = [];
	let current = metadata.descriptor, maximumFrameBytes = current.width * current.height * 16;
	let selectedCheckpointIndex: number | undefined, selectedExecutionIndex: number | undefined, needsThirdTarget = false;
	for (const slot of authored.slots) {
		if (slot.incoming !== current) throw new RangeError('Native GPU authored descriptor identity chain changed.');
		const stage = slot.stageIndex === null ? undefined : metadata.stages[slot.stageIndex];
		if (slot.stageIndex !== null && !stage) throw new RangeError('Native GPU authored slot lost its scalar stage.');
		const { pass, candidateRequired } = prepareStage(metadata, slot, stage, byId);
		if (pass) {
			if (readPixelFrameWebGl2PassCurrentV1(pass) !== pass) throw new TypeError('Native GPU stage requires its genuine private pass.');
			if ('sourceDescriptor' in pass) {
				if (!descriptorEqual(pass.sourceDescriptor, slot.incoming) || !descriptorEqual(pass.descriptor, slot.output)) throw new RangeError('Native GPU pass descriptor differs from its authored slot.');
			} else if (!descriptorEqual(slot.incoming, slot.output)) throw new RangeError('Pointwise GPU stage cannot change extent.');
			if ('id' in pass && slot.identity.origin === 'effect' && pass.id !== slot.identity.effectId) throw new RangeError('Native GPU pass lost its authored effect ID.');
			passes.push(pass);
		} else if (candidateRequired) throw new RangeError('Native GPU candidate requires an owning prepared pass.');
		let checkpoint: Readonly<PixelFrameWebGl2MaskCheckpointCurrentV1> | undefined;
		if (slot.binding) {
			if (slot.stageIndex === null) throw new RangeError('An admitted mask binding requires its scalar effect stage.');
			const selected = slot.binding === metadata.selectedBinding, mode = candidateRequired ? 'blend' : selected ? 'observe' : 'declared-only';
			const executionIndex = mode === 'declared-only' ? null : executed.length;
			checkpoint = Object.freeze({ index: checkpoints.length, executionIndex, slotOrdinal: slot.ordinal, stageIndex: slot.stageIndex,
				effectId: slot.binding.effectId, maskId: slot.binding.maskId, width: slot.binding.width, height: slot.binding.height,
				binding: slot.binding, selected, mode, blend: blendFor(metadata, slot), suffix: imageDevelopMaskTransformsCurrentV1(slot.binding) });
			checkpoints.push(checkpoint);
			if (executionIndex !== null) {
				executed.push(checkpoint);
				requests.push(Object.freeze({ checkpointIndex: checkpoint.index, executionIndex, slotOrdinal: slot.ordinal,
					binding: slot.binding, graph: slot.binding.graph, descriptor: slot.incoming }));
			}
			if (selected) {
				if (executionIndex === null) throw new RangeError('Selected coverage requires an executed checkpoint.');
				selectedCheckpointIndex = checkpoint.index; selectedExecutionIndex = executionIndex;
			}
			if (mode === 'blend') needsThirdTarget = true;
		}
		slots.push(Object.freeze({ ordinal: slot.ordinal, stageIndex: slot.stageIndex, authored: slot, identity: slot.identity, incoming: slot.incoming,
			output: slot.output, pass, candidateRequired, checkpoint }));
		current = slot.output; maximumFrameBytes = Math.max(maximumFrameBytes, current.width * current.height * 16);
	}
	if (current !== metadata.finalDescriptor || checkpoints.length !== metadata.masks.plan.bindings.length) throw new RangeError('Native GPU authored schedule is incomplete.');
	const plan: Readonly<PreparedPixelFrameWebGl2MaskPlanCurrentV1> = Object.freeze({ sourceDescriptor: metadata.descriptor,
		finalDescriptor: metadata.finalDescriptor, maskPlan: metadata.masks.plan, slots: Object.freeze(slots), passes: Object.freeze(passes),
		checkpoints: Object.freeze(checkpoints), executedCheckpoints: Object.freeze(executed), selectedCheckpointIndex, selectedExecutionIndex,
		maximumFrameBytes, imageTextureCount: needsThirdTarget ? 3 : 2, referenceBytes: executed.length ? maximumFrameBytes * 2 : 0,
		knownMaskComponentBytes: metadata.masks.peakWorkingBytes, graphAdmissionRequests: Object.freeze(requests),
		graphAdmissionComplete: requests.length === 0, graphGpuBytes: requests.length ? null : 0 });
	PREPARED.set(plan, Object.freeze({ plan, checkpoints: Object.freeze({ ...plan, metadata, authored }) })); return plan;
}

export function isPixelFrameWebGl2MaskPlanCurrentV1(value: unknown): value is Readonly<PreparedPixelFrameWebGl2MaskPlanCurrentV1> {
	return typeof value === 'object' && value !== null && PREPARED.has(value);
}
export function readPixelFrameWebGl2MaskPlanCurrentV1(value: unknown): Readonly<PreparedPixelFrameWebGl2MaskPlanCurrentV1> {
	if (!isPixelFrameWebGl2MaskPlanCurrentV1(value)) throw new TypeError('Native GPU mask pipeline requires an owning prepared identity.');
	return PREPARED.get(value)!.plan;
}
export const isPixelFrameWebGl2MaskCheckpointPlanCurrentV1 = isPixelFrameWebGl2MaskPlanCurrentV1;
export function readPixelFrameWebGl2MaskCheckpointPlanCurrentV1(value: unknown): Readonly<PixelFrameWebGl2MaskCheckpointPlanCurrentV1> {
	if (!isPixelFrameWebGl2MaskPlanCurrentV1(value)) throw new TypeError('Native GPU checkpoints require an owning prepared mask pipeline.');
	return PREPARED.get(value)!.checkpoints;
}
