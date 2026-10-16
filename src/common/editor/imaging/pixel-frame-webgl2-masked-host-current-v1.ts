/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainRecord as record, readClosedDomainField as field } from '../closed-domain-value.ts';
import { readPixelFrameV1, readPixelFrameDescriptorV1 } from './pixel-frame-contract-v1.ts';
import { captureLinearKernelDescriptorV1 } from './linear-kernel-descriptor-v1.ts';
import type { LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import type { ImageDevelopMaskOverlayViewV1 } from './image-develop-mask-overlay-v1.ts';
import { LinearDevelopOwnerV1 } from './image-develop-linear-owner-v1.ts';
import { readImageDevelopGpuMaskPhasePlanCurrentV1 } from './image-develop-gpu-mask-phase-plan-current-v1.ts';
import { readPixelFrameWebGl2MaskCheckpointPlanCurrentV1 } from './pixel-frame-webgl2-mask-plan-current-v1.ts';
import { captureMaskRasterSourceV1, withMaskRasterSourceScopeV1, type MaskRasterSourceScopeV1 } from './mask-raster-source-scope-v1.ts';
import { captureCubeLutSourceV1 } from './cube-lut-source-scope-v1.ts';
import { withPixelFrameWebGl2LutsCurrentV1, isPixelFrameWebGl2LutCurrentV1, type PixelFrameWebGl2LutResourcesCurrentV1 } from './pixel-frame-webgl2-lut-current-v1.ts';
import { withPixelFrameWebGl2MaskReceiptsCurrentV1 } from './pixel-frame-webgl2-mask-checkpoint-current-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './pixel-frame-repair-lifetime-v1.ts';
import type { PixelFrameWebGl2MaskOverlayStorageCurrentV1 } from './pixel-frame-webgl2-mask-overlay-current-v1.ts';

type Context = Awaited<ReturnType<typeof import('./pixel-frame-webgl2-context-current-v1.ts')['openPixelFrameWebGl2ContextCurrentV1']>>;
export type PixelFrameWebGl2MaskedViewCurrentV1 = Readonly<{ backend: 'cpu'; reason: string; source: Readonly<LinearWorkingPixelFrameV1> }>
	| Readonly<{ backend: 'webgl2'; frame: Readonly<LinearWorkingPixelFrameV1>; overlay?: Readonly<ImageDevelopMaskOverlayViewV1> }>;
const TYPED = Object.getPrototypeOf(Float32Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const SET = Float32Array.prototype.set;
function sameDescriptor(a: ReturnType<typeof readPixelFrameDescriptorV1>, b: ReturnType<typeof readPixelFrameDescriptorV1>): boolean {
	return a.schemaVersion === b.schemaVersion && a.width === b.width && a.height === b.height && a.sampleFormat === b.sampleFormat && a.primaries === b.primaries && a.transfer === b.transfer;
}
function distinct(primary: unknown, cleanup: unknown): unknown {
	return Object.is(primary, cleanup) ? primary : new AggregateError([primary, cleanup], 'Masked GPU work and physical retirement failed.', { cause: primary });
}

/** Internal lower host. No arbitrary GL opener/renderer/source map is injected.
 * Complete metadata and exact padded-backing admission precede stable capture;
 * stable source samples are copied before the first asynchronous continuation.
 * The external callback is admitted once, after auth/proof scopes retire. */
export async function withPixelFrameWebGl2MaskedHostCurrentV1<Result>(value: unknown,
	consume: (view: PixelFrameWebGl2MaskedViewCurrentV1) => Result | Promise<Result>): Promise<Result> {
	const ownSignal = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (ownSignal && !Object.hasOwn(ownSignal, 'value')) throw new TypeError('Masked GPU signal requires own data.');
	const signal = captureRepairSignalV1(ownSignal?.value), check = () => { checkRepairSignalV1(signal); }; check();
	if (typeof consume !== 'function') throw new TypeError('Masked GPU requires one joined consumer.');
	const input = record(value, 'masked GPU host', ['frame', 'phase', 'lutSource', 'maskSource', 'signal'], ['frame', 'phase']);
	const phaseValue = field(input, 'phase', 'masked GPU host'), phase = readImageDevelopGpuMaskPhasePlanCurrentV1(phaseValue);
	const checkpoints = readPixelFrameWebGl2MaskCheckpointPlanCurrentV1(phase.checkpointPlan), metadata = checkpoints.metadata;
	if (!phase.eligible) throw new RangeError('Masked GPU attempt exceeds its complete physical phase admission.');
	const lutPasses = Object.freeze(checkpoints.passes.filter(isPixelFrameWebGl2LutCurrentV1));
	const lutSource = lutPasses.length ? captureCubeLutSourceV1(field(input, 'lutSource', 'masked GPU host')) : undefined;
	const maskSource = metadata.masks.references.length ? captureMaskRasterSourceV1(field(input, 'maskSource', 'masked GPU host')) : undefined;
	const raw = record(field(input, 'frame', 'masked GPU host'), 'masked GPU native frame', ['descriptor', 'pixels']);
	const descriptor = readPixelFrameDescriptorV1(field(raw, 'descriptor', 'masked GPU frame'));
	if (!sameDescriptor(descriptor, metadata.sourcePlan.descriptor)) throw new TypeError('Masked GPU source differs from its captured metadata descriptor.');
	const source = readPixelFrameV1({ descriptor: metadata.sourcePlan.descriptor, pixels: field(raw, 'pixels', 'masked GPU frame') }, metadata.profile.source); check();
	if (!(source.pixels instanceof Float32Array) && !(source.pixels instanceof Uint16Array)) throw new TypeError('Masked GPU requires native linear source words or floats.');
	const physical = Number(Reflect.apply(SIZE, Reflect.apply(BUFFER, source.pixels, []), []));
	if (physical !== phase.physicalSourceBytes) throw new RangeError('Masked GPU physical backing differs from its complete phase admission.');
	// This owner allocates only F and RF. Every external graph/texture/table fee
	// is already in the private <=768MiB phase ledger; do not subtract it twice.
	const owner = new LinearDevelopOwnerV1(physical, physical + phase.floatCaptureBytes + phase.readbackBytes);
	return owner.run(async () => {
		const pixels = owner.floats(phase.floatCaptureBytes / 4), backing = pixels.buffer;
		if (source.pixels instanceof Float32Array) Reflect.apply(SET, pixels, [source.pixels]);
		else for (let index = 0; index < pixels.length; index++) pixels[index] = source.pixels[index]! / 65535;
		const captured: Readonly<LinearWorkingPixelFrameV1> = Object.freeze({ descriptor: captureLinearKernelDescriptorV1(metadata.descriptor), pixels });
		const checkSource = () => { check(); if (Number(Reflect.apply(SIZE, backing, [])) !== phase.floatCaptureBytes) throw new TypeError('Masked GPU stable source detached before retirement.'); };
		checkSource(); let context: Context | undefined, readback: Float32Array<ArrayBuffer> | undefined, entered = false;
		// Invocation-local identity: even an old marker exposed by an earlier
		// cleanup aggregate cannot forge a fresh auth-port fallback.
		let nativeFailure: Readonly<{ error: Error; reason: string }> | undefined;
		const allocate = () => { if (readback) throw new TypeError('Masked GPU readback allocation is repeated.'); return readback = owner.floats(phase.readbackBytes / 4); };
		const open = async (scope?: Readonly<MaskRasterSourceScopeV1>, resources?: Readonly<PixelFrameWebGl2LutResourcesCurrentV1>, overlay?: Readonly<PixelFrameWebGl2MaskOverlayStorageCurrentV1>) => {
			const native = await import('./pixel-frame-webgl2-context-current-v1.ts'); checkSource();
			let repair: ReturnType<typeof import('./pixel-frame-webgl2-repair-execution-current-v1.ts')['preparePixelFrameWebGl2RepairExecutionCurrentV1']> | undefined;
			if (phase.repairPrefix) {
				const prefix = await import('./pixel-frame-webgl2-repair-execution-current-v1.ts'); checkSource();
				// Private phase/source association is validated outside the native
				// refusal catch. No standalone repair frontdoor or extra source copy.
				repair = prefix.preparePixelFrameWebGl2RepairExecutionCurrentV1({ phase: phaseValue, checkCurrent: checkSource });
			}
			const attempt = async (receipts?: unknown) => {
				// Token preparation/scope validation is outside the unavailable catch.
				let token: ReturnType<typeof import('./pixel-frame-webgl2-masked-execution-current-v1.ts')['preparePixelFrameWebGl2MaskedExecutionCurrentV1']> | undefined;
				if (receipts !== undefined) { const masked = await import('./pixel-frame-webgl2-masked-execution-current-v1.ts'); checkSource(); token = masked.preparePixelFrameWebGl2MaskedExecutionCurrentV1(receipts); }
				try { context = await native.openPixelFrameWebGl2ContextCurrentV1(captured, checkpoints.passes, allocate, signal, resources, token, repair); }
				catch (error) {
					// An opaque aborted reason can itself be a public native error. Abort
					// still wins and must never be enrolled as a capability fallback.
					checkSource(); const reason = native.pixelFrameWebGl2UnavailableReasonCurrentV1(error);
					if (reason === null) throw error;
					if (nativeFailure) throw new TypeError('Masked native refusal was enrolled twice.', { cause: error });
					nativeFailure = Object.freeze({ error: new Error('Masked native attempt declined before external delivery.', { cause: error }), reason });
					throw nativeFailure.error;
				}
			};
			if (checkpoints.executedCheckpoints.length) await withPixelFrameWebGl2MaskReceiptsCurrentV1(phase.checkpointPlan, receipts => attempt({
				phase: phaseValue, receipts, ...(scope ? { scope } : {}), ...(overlay ? { overlay } : {}), checkCurrent: checkSource,
			}), signal);
			// Zero executed checkpoints need full declaration authentication but no
			// token/receipt owner; otherwise its64KiB scratch would be uncharged.
			else await attempt();
		};
		const resources = async (overlay?: Readonly<PixelFrameWebGl2MaskOverlayStorageCurrentV1>) => {
			const luts = (scope?: Readonly<MaskRasterSourceScopeV1>) => lutSource
				? withPixelFrameWebGl2LutsCurrentV1(lutPasses, lutSource, tables => open(scope, tables, overlay), signal)
				: open(scope, undefined, overlay);
			if (maskSource) await withMaskRasterSourceScopeV1(metadata.masks.references, new Set(phase.retainedStorageKeys), maskSource, scope => luts(scope), signal);
			else await luts();
		};
		const deliver = async (overlay?: Readonly<ImageDevelopMaskOverlayViewV1>): Promise<Result> => {
			checkSource(); if (!context) throw new TypeError('Masked GPU has no completed native context.'); context.assertCurrent(); entered = true;
			const result = await consume(Object.freeze({ backend: 'webgl2', frame: Object.freeze({ descriptor: checkpoints.finalDescriptor, pixels: context.pixels }), ...(overlay ? { overlay } : {}) }));
			checkSource(); context.assertCurrent(); return result;
		};
		const inside = async (storage?: Readonly<PixelFrameWebGl2MaskOverlayStorageCurrentV1>): Promise<Result> => {
			await resources(storage); checkSource();
			if (!storage) return deliver();
			const selected = checkpoints.executedCheckpoints[checkpoints.selectedExecutionIndex!];
			if (!selected) throw new TypeError('Masked GPU overlay lost its selected checkpoint.');
			return storage.withCoverage(view => deliver(Object.freeze({ effectId: selected.effectId, maskId: selected.maskId, width: view.width, height: view.height, coverage: view.coverage })));
		};
		let outcome: { value: Result } | { error: unknown };
		try {
			if (phase.overlayPlan !== undefined) {
				const overlay = await import('./pixel-frame-webgl2-mask-overlay-current-v1.ts'); checkSource();
				outcome = { value: await overlay.withPixelFrameWebGl2MaskOverlayCurrentV1(phase.overlayPlan, inside, signal) };
			} else outcome = { value: await inside() };
		} catch (error) { outcome = { error }; }
		// Success keeps GL alive through the external borrow. Failed auth/proof
		// after a successful open still retires that context before propagation.
		try { context?.dispose(); } catch (cleanup) {
			throw 'error' in outcome ? distinct(outcome.error, cleanup) : cleanup;
		}
		if ('error' in outcome) {
			const reason = nativeFailure && Object.is(outcome.error, nativeFailure.error) ? nativeFailure.reason : undefined;
			if (entered || reason === undefined) throw outcome.error;
			if (readback) { try { owner.retire(readback.buffer); } catch (cleanup) { throw distinct(outcome.error, cleanup); } }
			checkSource();
			const result = await consume(Object.freeze({ backend: 'cpu', reason, source: captured })); checkSource(); return result;
		}
		return outcome.value;
	});
}
