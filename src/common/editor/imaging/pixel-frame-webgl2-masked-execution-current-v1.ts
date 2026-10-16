/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainRecord as record, readClosedDomainField as field } from '../closed-domain-value.ts';
import { readImageDevelopGpuMaskPhasePlanCurrentV1 } from './image-develop-gpu-mask-phase-plan-current-v1.ts';
import { readPixelFrameWebGl2MaskContextCurrentV1 } from './pixel-frame-webgl2-mask-context-plan-current-v1.ts';
import { readPixelFrameWebGl2MaskCheckpointPlanCurrentV1 } from './pixel-frame-webgl2-mask-plan-current-v1.ts';
import { withPixelFrameWebGl2MaskContextCurrentV1, type PixelFrameWebGl2MaskImageCurrentV1 } from './pixel-frame-webgl2-mask-context-current-v1.ts';
import { assertPixelFrameWebGl2MaskReceiptsCurrentV1, capturePixelFrameWebGl2MaskCheckpointCurrentV1,
	capturePixelFrameWebGl2MaskOverlayCurrentV1, type PixelFrameWebGl2MaskReceiptsCurrentV1 } from './pixel-frame-webgl2-mask-checkpoint-current-v1.ts';
import { assertPixelFrameWebGl2MaskOverlayStorageCurrentV1, type PixelFrameWebGl2MaskOverlayStorageCurrentV1 } from './pixel-frame-webgl2-mask-overlay-current-v1.ts';
import { assertMaskRasterSourceScopeV1, type MaskRasterSourceScopeV1 } from './mask-raster-source-scope-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './pixel-frame-repair-lifetime-v1.ts';
import type { LinearKernelDescriptorV1 } from './linear-kernel-descriptor-v1.ts';
import type { PreparedPixelFrameWebGl2PassCurrentV1 as Pass } from './pixel-frame-webgl2-pass-current-v1.ts';

export interface PixelFrameWebGl2MaskedExecutionCurrentV1 { readonly kind: 'native-masked-execution-current-v1'; }
interface State {
	readonly phaseValue: unknown;
	readonly phase: ReturnType<typeof readImageDevelopGpuMaskPhasePlanCurrentV1>;
	readonly checkpoints: ReturnType<typeof readPixelFrameWebGl2MaskCheckpointPlanCurrentV1>;
	readonly receipts: Readonly<PixelFrameWebGl2MaskReceiptsCurrentV1>;
	readonly scope: Readonly<MaskRasterSourceScopeV1> | undefined;
	readonly overlay: Readonly<PixelFrameWebGl2MaskOverlayStorageCurrentV1> | undefined;
	readonly checkSource: () => void;
	claimed: boolean;
	started: boolean;
}
const PREPARED = new WeakMap<object, State>();
function same(a: LinearKernelDescriptorV1, b: LinearKernelDescriptorV1): boolean {
	return a.schemaVersion === b.schemaVersion && a.width === b.width && a.height === b.height && a.sampleFormat === b.sampleFormat
		&& a.primaries === b.primaries && a.transfer === b.transfer;
}
function current(value: unknown): State {
	const state = value !== null && typeof value === 'object' ? PREPARED.get(value) : undefined;
	if (!state) throw new TypeError('Masked execution requires its private attempt token.'); return state;
}
function authorities(state: State): void {
	state.checkSource();
	assertPixelFrameWebGl2MaskReceiptsCurrentV1(state.receipts, state.phase.checkpointPlan);
	if (state.scope !== undefined || state.checkpoints.metadata.masks.references.length) assertMaskRasterSourceScopeV1(state.scope, state.checkpoints.metadata.masks.references);
	if (state.overlay) assertPixelFrameWebGl2MaskOverlayStorageCurrentV1(state.overlay, state.phase.overlayPlan);
}
/** Scalars and genuine live scope association only. The token does not create
 * brush/receipt/overlay authority or replace Root's physical-source admission. */
export function preparePixelFrameWebGl2MaskedExecutionCurrentV1(value: unknown): Readonly<PixelFrameWebGl2MaskedExecutionCurrentV1> {
	const input = record(value, 'masked native attempt', ['phase', 'receipts', 'scope', 'overlay', 'checkCurrent'], ['phase', 'receipts', 'checkCurrent']);
	const phaseValue = field(input, 'phase', 'masked native attempt'), phase = readImageDevelopGpuMaskPhasePlanCurrentV1(phaseValue);
	const checkpoints = readPixelFrameWebGl2MaskCheckpointPlanCurrentV1(phase.checkpointPlan), context = readPixelFrameWebGl2MaskContextCurrentV1(phase.contextPlan);
	if (!checkpoints.executedCheckpoints.length) throw new RangeError('Declared-only masks keep the unmasked open path without receipt allocation.');
	if (context.checkpointPlan !== checkpoints) throw new TypeError('Masked execution lost its exact context/checkpoint association.');
	const scope = Object.hasOwn(input, 'scope') ? field(input, 'scope', 'masked native attempt') as Readonly<MaskRasterSourceScopeV1> : undefined;
	const overlay = Object.hasOwn(input, 'overlay') ? field(input, 'overlay', 'masked native attempt') as Readonly<PixelFrameWebGl2MaskOverlayStorageCurrentV1> : undefined;
	if ((checkpoints.selectedExecutionIndex !== undefined) !== (overlay !== undefined)) throw new TypeError('Masked execution requires exactly its selected retained overlay scope.');
	const currentMethod = field(input, 'checkCurrent', 'masked native attempt');
	if (typeof currentMethod !== 'function') throw new TypeError('Masked attempt requires its captured source currentness check.');
	const checkSource = () => { if (Reflect.apply(currentMethod, value, []) !== undefined) throw new TypeError('Masked source currentness must complete synchronously.'); };
	const state: State = { phaseValue, phase, checkpoints, receipts: field(input, 'receipts', 'masked native attempt') as Readonly<PixelFrameWebGl2MaskReceiptsCurrentV1>, scope, overlay, checkSource, claimed: false, started: false };
	authorities(state); const token = Object.freeze({ kind: 'native-masked-execution-current-v1' as const }); PREPARED.set(token, state); return token;
}
/** One context open per attempt. Called before canvas/native allocation and
 * before source samples; private metadata and each pass identity must match. */
export function claimPixelFrameWebGl2MaskedExecutionCurrentV1(value: unknown, descriptor: LinearKernelDescriptorV1, passes: readonly Pass[]) {
	const state = current(value);
	if (state.claimed) throw new TypeError('Masked native attempt is repeated.'); state.claimed = true;
	if (!same(descriptor, state.checkpoints.sourceDescriptor) || passes.length !== state.checkpoints.passes.length
		|| passes.some((pass, index) => pass !== state.checkpoints.passes[index])) throw new TypeError('Masked context differs from its complete private authored schedule.');
	authorities(state);
	return Object.freeze({ phaseValue: state.phaseValue, phase: state.phase, checkpointPlan: state.phase.checkpointPlan,
		checkpoints: state.checkpoints, receipts: state.receipts, scope: state.scope });
}

/** Root privately supplies its image-bank functions; no new GL image owner,
 * pixel upload, CPU coverage plane or alternative shader formula is created. */
export interface PixelFrameWebGl2MaskedImageHostCurrentV1 {
	readonly gl: WebGL2RenderingContext;
	readonly bankCount: 2 | 3;
	view(index: number, descriptor: LinearKernelDescriptorV1): Readonly<PixelFrameWebGl2MaskImageCurrentV1>;
	ensure(index: number, descriptor: LinearKernelDescriptorV1): Readonly<PixelFrameWebGl2MaskImageCurrentV1>;
	draw(input: number, output: number, descriptor: LinearKernelDescriptorV1, pass: Pass): void;
	wait(): Promise<void>;
	checkCurrent(): void;
	unavailable(reason: string): never;
}
export async function executePixelFrameWebGl2MaskedSlotsCurrentV1(token: unknown, hostValue: Readonly<PixelFrameWebGl2MaskedImageHostCurrentV1>, signalValue?: AbortSignal): Promise<number> {
	const signal = captureRepairSignalV1(signalValue); checkRepairSignalV1(signal);
	const state = current(token); if (!state.claimed || state.started) throw new TypeError('Masked slot execution requires its single claimed context attempt.'); state.started = true;
	const input = record(hostValue, 'native image-bank host', ['gl', 'bankCount', 'view', 'ensure', 'draw', 'wait', 'checkCurrent', 'unavailable']);
	const gl = field(input, 'gl', 'image-bank host') as WebGL2RenderingContext, bankCount = field(input, 'bankCount', 'image-bank host');
	if ((bankCount !== 2 && bankCount !== 3) || bankCount !== state.checkpoints.imageTextureCount) throw new TypeError('Masked context has the wrong admitted image-bank count.');
	const methods = new Map<string, (...args: unknown[]) => unknown>();
	for (const name of ['view', 'ensure', 'draw', 'wait', 'checkCurrent', 'unavailable']) {
		const method = field(input, name, 'image-bank host'); if (typeof method !== 'function') throw new TypeError('Native image-bank host requires own callable methods.');
		methods.set(name, method as (...args: unknown[]) => unknown);
	}
	const invoke = (name: string, args: readonly unknown[]) => Reflect.apply(methods.get(name)!, hostValue, args) as unknown;
	const check = () => { checkRepairSignalV1(signal); state.checkSource(); if (invoke('checkCurrent', []) !== undefined) throw new TypeError('Native currentness must complete synchronously.'); };
	const unavailable = (reason: string): never => { invoke('unavailable', [reason]); throw new TypeError('Native unavailable callback must throw.'); };
	const view = (index: number, descriptor: LinearKernelDescriptorV1) => invoke('view', [index, descriptor]) as Readonly<PixelFrameWebGl2MaskImageCurrentV1>;
	const ensure = (index: number, descriptor: LinearKernelDescriptorV1) => invoke('ensure', [index, descriptor]) as Readonly<PixelFrameWebGl2MaskImageCurrentV1>;
	const idle = (a: number, b = -1) => { for (let index = 0; index < bankCount; index++) if (index !== a && index !== b) return index; throw new TypeError('Masked candidate/blend requires its distinct third bank.'); };
	check(); if (!state.phase.eligible) unavailable('mask-working-set'); let currentBank = 0;
	await withPixelFrameWebGl2MaskContextCurrentV1({ gl, prepared: state.phase.contextPlan, phasePlan: state.phaseValue,
		...(state.scope ? { scope: state.scope } : {}), signal, checkCurrent: check, unavailable }, async executor => {
		for (const slot of state.checkpoints.slots) {
			check(); const incoming = view(currentBank, slot.incoming), checkpoint = slot.checkpoint;
			let candidateBank: number | undefined, candidate: Readonly<PixelFrameWebGl2MaskImageCurrentV1> | undefined;
			if (slot.candidateRequired) {
				if (!slot.pass) throw new TypeError('An active authored slot requires its genuine prepared pass.');
				candidateBank = idle(currentBank); candidate = ensure(candidateBank, slot.output);
				if (invoke('draw', [currentBank, candidateBank, slot.output, slot.pass]) !== undefined) throw new TypeError('Native image draw must complete synchronously.'); check();
			}
			if (checkpoint && checkpoint.mode !== 'declared-only') {
				if ((checkpoint.mode === 'blend') !== (candidateBank !== undefined)) throw new TypeError('Masked slot candidate differs from its private checkpoint policy.');
				let blended: number | undefined;
				await executor.withCoverage(checkpoint, incoming, async coverage => {
					await capturePixelFrameWebGl2MaskCheckpointCurrentV1(state.receipts, checkpoint, { width: coverage.width, height: coverage.height }, (top, rows, target) => { coverage.readStripe(top, rows, target); }); check();
					if (checkpoint.selected) {
						if (!state.overlay) throw new TypeError('Selected coverage requires its genuine retained overlay owner.');
						await coverage.withTexture(texture => state.overlay!.project({ gl, texture, width: coverage.width, height: coverage.height, checkCurrent: state.checkSource, unavailable })); check();
						await capturePixelFrameWebGl2MaskOverlayCurrentV1(state.receipts, checkpoint, { width: state.checkpoints.finalDescriptor.width, height: state.checkpoints.finalDescriptor.height },
							(top, rows, target) => { state.overlay!.readStripe(top, rows, target); }); check();
					}
					if (candidateBank !== undefined) {
						blended = idle(currentBank, candidateBank); const destination = ensure(blended, slot.output); coverage.blend(candidate!, destination);
						await invoke('wait', []); check();
					}
				});
				if (blended !== undefined) currentBank = blended;
			} else if (candidateBank !== undefined) currentBank = candidateBank;
			await new Promise<void>(resolve => { setTimeout(resolve, 0); }); check();
		}
	});
	check(); return currentBank;
}
