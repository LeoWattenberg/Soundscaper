/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import { POST_CROP_VIGNETTE_EFFECT_TYPE_V1 } from '../video-post-crop-vignette-v1.ts';
import { withPostCropVignettePixelFrameV1 } from './pixel-frame-post-crop-vignette-v1.ts';
import { CLARITY_EFFECT_TYPE_V1 } from '../video-clarity-v1.ts';
import { withClarityPixelFrameV1 } from './pixel-frame-clarity-v1.ts';
import { NOISE_REDUCTION_EFFECT_TYPE_V1 } from '../video-noise-reduction-v1.ts';
import { withNoiseReductionPixelFrameV1 } from './pixel-frame-noise-reduction-v1.ts';
import { GRAIN_EFFECT_TYPE_V1 } from '../video-grain-v1.ts';
import { withGrainPixelFrameV1 } from './pixel-frame-grain-v1.ts';
import { TEXTURE_EFFECT_TYPE_V1 } from '../video-texture-v1.ts';
import { withTexturePixelFrameV1 } from './pixel-frame-texture-v1.ts';
import { DEHAZE_EFFECT_TYPE_V1 } from '../video-dehaze-v1.ts';
import { withDehazePixelFrameV1 } from './pixel-frame-dehaze-v1.ts';
import { DETAIL_SHARPEN_EFFECT_TYPE_V1 } from '../video-sharpen-v1.ts';
import { COLOR_WHEELS_EFFECT_TYPE_V1 } from '../video-color-wheels-v1.ts';
import { withDetailSharpenPixelFrameV1 } from './pixel-frame-sharpen-v1.ts';
import { withGlobalDevelopPixelFrameV1 } from './pixel-frame-global-develop-v1.ts';
import { withGeometryPixelFrameV1 } from './pixel-frame-geometry-v1.ts';
import { createPixelFrameHistogramV1, type PixelFrameHistogramV1 } from './pixel-frame-histogram-v1.ts';
import { isCurvesEffectTypeV1 } from '../video-curves-v1.ts';
import { isGlobalDevelopEffectTypeV1 } from '../video-global-develop-v1.ts';
import { CHROMA_DEVELOP_EFFECT_TYPE_V1 } from '../video-chroma-develop-v1.ts';
import { BLACK_WHITE_MIX_EFFECT_TYPE_V1 } from '../video-black-white-mix-v1.ts';
import { HSL_MIXER_EFFECT_TYPE_V1 } from '../video-hsl-mixer-v1.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, imageGeometryForVideoEffectV1 } from '../video-image-geometry-v1.ts';
import type { ImageGeometryV1 } from './image-geometry-v1.ts';
import { IMAGE_DEVELOP_LIMITS_V1, type ImageDevelopStateV1 } from './image-develop-contract-v1.ts';
import type { ImageDevelopStateV2 } from './image-develop-state-v2.ts';
import type { VideoEffectLeafV2 } from '../video-effect-leaf-v2.ts';
import { normalizeImageDevelopEffectsV1 } from './image-develop-effects-v1.ts';
import { admitImageDevelopMaskAuthorityV1, planImageDevelopMasksV1, IMAGE_DEVELOP_MASK_WORKING_LIMIT_V1, type ImageDevelopMaskBindingPlanV1 } from './image-develop-mask-plan-v1.ts';
import { prepareImageDevelopMaskOverlaySelectionV1, assertImageDevelopMaskOverlayBudgetV1, withProjectedImageDevelopMaskCoverageV1, type ImageDevelopMaskOverlayViewV1 } from './image-develop-mask-overlay-v1.ts';
import { withVideoMaskMatteRgbaV1, withVideoMaskMatteBrushScopeV1 } from '../video-mask-matte-rgba-v13.ts';
import { blendImageDevelopMaskedAdjustmentV1 } from './pixel-frame-masked-adjustment-v1.ts';
import { admitImageDevelopBrushMaskAuthorityV1, prepareImageDevelopBrushMasksV1 } from './image-develop-brush-mask-v1.ts';
import { withMaskRasterSourceScopeV1, type MaskRasterSourceScopeV1 } from './mask-raster-source-scope-v1.ts';
import type { MaskRasterSourcePortV1 } from './mask-raster-source-port-v1.ts';
import { captureImageDevelopFrameProfileV3, ImageDevelopFrameOwnedPixelsV1, retireImageDevelopFrameFailureV1 } from './image-develop-frame-owned-pixels-v1.ts';

export interface ImageDevelopFrameStageInput {
	readonly descriptor: Readonly<PixelFrameDescriptorV1>;
	readonly pixels: Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer>;
}
export interface ImageDevelopFramePixels extends ImageDevelopFrameStageInput {
	readonly pixels: Uint8Array<ArrayBuffer>;
}
export interface ImageDevelopFrameViewV1 {
	readonly frame: Readonly<ImageDevelopFramePixels>;
	readonly histogram: Readonly<PixelFrameHistogramV1>;
	readonly maskOverlay?: Readonly<ImageDevelopMaskOverlayViewV1>;
}
const SIGNAL_PROTOTYPE = AbortSignal.prototype;
const CHECK = SIGNAL_PROTOTYPE.throwIfAborted;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

export interface ImageDevelopFrameProfile { readonly source: PixelFrameLimitsV1; readonly render: PixelFrameLimitsV1 }
export type ImageDevelopFrameStage = (frame: ImageDevelopFramePixels, signal: AbortSignal | undefined, limits: PixelFrameLimitsV1,
	accept: (frame: ImageDevelopFrameStageInput) => void) => Promise<void>;
export type ImageDevelopFrameOriginalStage = (frame: ImageDevelopFrameStageInput, signal: AbortSignal | undefined,
	accept: (frame: ImageDevelopFrameStageInput) => void) => Promise<void>;
export interface ImageDevelopFramePolicy {
	readonly normalizeDevelop: (value: unknown) => ImageDevelopStateV1 | ImageDevelopStateV2;
	readonly prepareRequestOptions?: () => void;
	/** Hosts opt in with an independently captured immutable-body source. */
	readonly prepareMaskSource?: (develop: ImageDevelopStateV1 | ImageDevelopStateV2) => Readonly<MaskRasterSourcePortV1> | undefined;
	/** Undefined selects the strict legacy kernel; null is a retained neutral resource stage. */
	readonly prepareResourceStage?: (effect: VideoEffectLeafV2) => ImageDevelopFrameStage | null | undefined;
	/** Explicit new owners plan their original-space prepass from metadata only.
	 * A returned stage must join its own cleanup before its one output is adopted. */
	readonly prepareOriginalStage?: (descriptor: Readonly<PixelFrameDescriptorV1>, limits: PixelFrameLimitsV1) => ImageDevelopFrameOriginalStage;
	/** Current-version dispatch opts in only after the complete recipe is admitted. */
	readonly hasOriginalStage?: () => boolean;
}
export async function withImageDevelopFrameCore<Result>(value: unknown,
	consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>, profile: ImageDevelopFrameProfile, policy: ImageDevelopFramePolicy): Promise<Result> {
	const input = record(value, 'photo develop proxy', ['frame', 'develop', 'signal', 'maskOverlay'], ['frame', 'develop']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'photo develop proxy') : undefined;
	if (signal !== undefined) assertImageDevelopSignal(signal);
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check(); if (typeof consume !== 'function') throw new TypeError('Photo develop proxy requires a scoped consumer.');
	const metadata = <Output>(work: () => Output): Output => {
		if (!policy.prepareOriginalStage) return work();
		try { const result = work(); check(); return result; } catch (error) { check(); throw error; }
	};
	if (policy.prepareRequestOptions) {
		try { policy.prepareRequestOptions(); } catch (error) { check(); throw error; }
		check();
	}
	const normalized = metadata(() => policy.normalizeDevelop(field(input, 'develop', 'photo develop proxy')));
	const usesOriginalStage = policy.hasOriginalStage?.() ?? Boolean(policy.prepareOriginalStage);
	const capturedProfile = usesOriginalStage ? metadata(() => captureImageDevelopFrameProfileV3(profile)) : profile;
	let maskSource: Readonly<MaskRasterSourcePortV1> | undefined;
	try { maskSource = policy.prepareMaskSource?.(normalized); } catch (error) { check(); throw error; }
	check();
	const develop = metadata(() => maskSource ? admitImageDevelopBrushMaskAuthorityV1(normalized) : admitImageDevelopMaskAuthorityV1(normalized));
	const rawOverlay = metadata(() => Object.hasOwn(input, 'maskOverlay') ? field(input, 'maskOverlay', 'photo develop proxy') : undefined);
	const selection = metadata(() => rawOverlay === undefined ? undefined : prepareImageDevelopMaskOverlaySelectionV1(rawOverlay));
	const serialized = JSON.stringify(develop), maximum = IMAGE_DEVELOP_LIMITS_V1.maximumBytes;
	if (serialized.length > maximum || new TextEncoder().encode(serialized).byteLength > maximum) throw new RangeError('Photo proxy settings exceed their byte budget.');
	const prepared = metadata(() => develop.effects.map(candidate => {
		const render = policy.prepareResourceStage?.(candidate);
		if (render !== undefined) return Object.freeze({ kind: 'resource' as const, id: candidate.id, enabled: candidate.enabled, render });
		const effect = normalizeImageDevelopEffectsV1([candidate])[0]!;
		if (effect.enabled && effect.type !== DEHAZE_EFFECT_TYPE_V1 && effect.type !== TEXTURE_EFFECT_TYPE_V1 && effect.type !== GRAIN_EFFECT_TYPE_V1 && effect.type !== NOISE_REDUCTION_EFFECT_TYPE_V1 && effect.type !== POST_CROP_VIGNETTE_EFFECT_TYPE_V1 && effect.type !== CLARITY_EFFECT_TYPE_V1 && effect.type !== DETAIL_SHARPEN_EFFECT_TYPE_V1 && effect.type !== IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1 && effect.type !== CHROMA_DEVELOP_EFFECT_TYPE_V1
			&& effect.type !== BLACK_WHITE_MIX_EFFECT_TYPE_V1 && effect.type !== HSL_MIXER_EFFECT_TYPE_V1 && effect.type !== COLOR_WHEELS_EFFECT_TYPE_V1
			&& !isGlobalDevelopEffectTypeV1(effect.type) && !isCurvesEffectTypeV1(effect.type)) {
			throw new RangeError(`Unsupported photo proxy effect: ${effect.type}.`);
		}
		return Object.freeze({ kind: 'legacy' as const, effect });
	}));
	const rawValue = metadata(() => field(input, 'frame', 'photo develop proxy'));
	let raw = usesOriginalStage ? undefined : record(rawValue, 'photo proxy source', ['descriptor', 'pixels']);
	const descriptor = metadata(() => {
		if (raw) return field(raw, 'descriptor', 'photo proxy source');
		if (typeof rawValue !== 'object' || rawValue === null) throw new TypeError('Photo proxy source must be an object.');
		return field(rawValue as Readonly<Record<string, unknown>>, 'descriptor', 'photo proxy source');
	});
	const admitted = metadata(() => admitPixelFrameV1(descriptor, { limits: capturedProfile.source }));
	const originalStage = usesOriginalStage ? metadata(() => policy.prepareOriginalStage?.(admitted.descriptor, capturedProfile.source)) : undefined;
	const brushPlan = metadata(() => maskSource ? prepareImageDevelopBrushMasksV1(develop, admitted.descriptor.width, admitted.descriptor.height, capturedProfile.render, selection) : undefined);
	const masks = metadata(() => brushPlan?.plan ?? planImageDevelopMasksV1(develop, admitted.descriptor.width, admitted.descriptor.height, capturedProfile.render));
	const selectedBinding = selection && masks.bindings.find(binding => binding.maskId === selection.maskId && binding.effectId === selection.effectId);
	if (selection && !selectedBinding) throw new RangeError('Mask overlay requires one retained mask/effect binding.');
	if (selectedBinding) {
		const retainedBytes = masks.width * masks.height;
		if (Math.max(masks.maximumWorkingBytes + retainedBytes, retainedBytes * 5) > IMAGE_DEVELOP_MASK_WORKING_LIMIT_V1) throw new RangeError('Retained mask overlay exceeds its working byte budget.');
		metadata(() => { assertImageDevelopMaskOverlayBudgetV1(selectedBinding, retainedBytes); });
	}
	raw ??= metadata(() => record(rawValue, 'photo proxy source', ['descriptor', 'pixels']));
	const source = metadata(() => readPixelFrameV1({ descriptor: admitted.descriptor, pixels: field(raw!, 'pixels', 'photo proxy source') }, capturedProfile.source));
	const originalSource = originalStage ? metadata(() => {
		const pixels = source.pixels;
		if (!(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)) throw new TypeError('Repair prepass requires native UNORM8 pixels.');
		return Object.freeze({ descriptor: source.descriptor, pixels });
	}) : undefined;
	const owner = originalStage ? new ImageDevelopFrameOwnedPixelsV1() : undefined;
	let retirementOrder: () => readonly (ArrayBuffer | undefined)[] = () => [];
	const execute = async (): Promise<Result> => {
		// The callback copies exactly one F while the repair owner is live (4F+S).
		// Its awaited retirement precedes adoption; there is no ordinary recopy or
		// selected brush scope overlapping the original/scratch/kernel output.
		let current: ImageDevelopFramePixels = originalStage && owner && originalSource
			? await owner.stage(accept => originalStage(originalSource, signal as AbortSignal | undefined, accept))
			: Object.freeze({ descriptor: source.descriptor, pixels: new Uint8Array(source.pixels) });
		let owned = owner ? owner.buffer(current.pixels) : current.pixels.buffer;
		let maskOverlay: Readonly<ImageDevelopMaskOverlayViewV1> | undefined;
		let maskOverlayBacking: ArrayBuffer | undefined;
		let activeMaskScope: Readonly<MaskRasterSourceScopeV1> | undefined;
		retirementOrder = () => [owned, maskOverlayBacking];
		const retire = (buffer: ArrayBuffer) => { if (owner) owner.retire(buffer); else wipe(buffer); };
		const runStage = (run: (accept: (frame: ImageDevelopFrameStageInput) => void) => Promise<void>) => owner ? owner.stage(run) : stage(run);
		const renderGeometry = (value: Readonly<ImageGeometryV1>) => owner
			? owner.stage(accept => withGeometryPixelFrameV1({ frame: current, geometry: value, signal }, accept, { limits: capturedProfile.render }))
			: geometry(current, value, signal as AbortSignal | undefined, capturedProfile.render);
		const replace = (next: ImageDevelopFramePixels) => { retire(owned); current = next; owned = owner ? owner.buffer(next.pixels) : next.pixels.buffer; };
		const evaluate = <Output>(binding: Readonly<ImageDevelopMaskBindingPlanV1>, accept: (coverage: Uint8Array<ArrayBuffer>) => Output | Promise<Output>) => {
			const request = { graph: binding.graph, width: binding.width, height: binding.height, currentFrame: current, signal };
			return activeMaskScope ? withVideoMaskMatteBrushScopeV1(request, accept, activeMaskScope) : withVideoMaskMatteRgbaV1(request, accept);
		};
		const observe = async (binding: Readonly<ImageDevelopMaskBindingPlanV1>, coverage: Uint8Array<ArrayBuffer>) => {
			if (binding !== selectedBinding) return;
			await withProjectedImageDevelopMaskCoverageV1(binding, coverage, view => {
				const retained = owner ? owner.copy(view.coverage, 'overlay coverage') : new Uint8Array(view.coverage); maskOverlayBacking = owner ? owner.buffer(retained) : retained.buffer;
				maskOverlay = Object.freeze({ ...view, coverage: retained });
			}, capturedProfile, signal as AbortSignal | undefined);
		};
		const observeUnchanged = async (effectId: string) => {
			if (selectedBinding?.effectId !== effectId) return;
			await evaluate(selectedBinding, coverage => observe(selectedBinding, coverage));
		};
		const adjust = async (effectId: string, render: () => Promise<ImageDevelopFramePixels>) => {
			const next = await render();
			try {
				const binding = masks.bindings.find(candidate => candidate.effectId === effectId);
				if (binding) await evaluate(binding, async coverage => {
					await blendImageDevelopMaskedAdjustmentV1(current, next, coverage, capturedProfile.render, signal as AbortSignal | undefined);
					await observe(binding, coverage);
				});
				replace(next);
			} catch (error) {
				if (owner) retireImageDevelopFrameFailureV1(owner, owner.buffer(next.pixels), error);
				wipe(next.pixels.buffer); throw error;
			}
		};
		const render = async (scope?: Readonly<MaskRasterSourceScopeV1>): Promise<Result> => {
			activeMaskScope = scope;
			const legacy = develop.geometry;
			if (legacy.crop !== null || legacy.rotationDegrees !== 0 || legacy.flipHorizontal || legacy.flipVertical) {
				replace(await renderGeometry({ schemaVersion: 1, ...legacy, perspective: null }));
			}
			for (const step of prepared) {
				check();
				if (step.kind === 'resource') {
					const render = step.render;
					if (step.enabled && render) await adjust(step.id, () => runStage(accept => render(current, signal as AbortSignal | undefined, capturedProfile.render, accept)));
					else await observeUnchanged(step.id);
					continue;
				}
				const effect = step.effect; if (!effect.enabled) { await observeUnchanged(effect.id); continue; }
				if (effect.type === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1) {
					replace(await renderGeometry(imageGeometryForVideoEffectV1(effect, current.descriptor.width, current.descriptor.height)));
				} else if (effect.type === POST_CROP_VIGNETTE_EFFECT_TYPE_V1) {
					await adjust(effect.id, () => runStage(accept => withPostCropVignettePixelFrameV1({ frame: current, effect, signal }, accept, { limits: capturedProfile.render })));
				} else if (effect.type === CLARITY_EFFECT_TYPE_V1) {
					await adjust(effect.id, () => runStage(accept => withClarityPixelFrameV1({ frame: current, effect, signal }, accept, { limits: capturedProfile.render })));
				} else if (effect.type === NOISE_REDUCTION_EFFECT_TYPE_V1) {
					await adjust(effect.id, () => runStage(accept => withNoiseReductionPixelFrameV1({ frame: current, effect, signal }, accept, { limits: capturedProfile.render })));
				} else if (effect.type === GRAIN_EFFECT_TYPE_V1) {
					await adjust(effect.id, () => runStage(accept => withGrainPixelFrameV1({ frame: current, effect, signal }, accept, { limits: capturedProfile.render })));
				} else if (effect.type === TEXTURE_EFFECT_TYPE_V1) {
					await adjust(effect.id, () => runStage(accept => withTexturePixelFrameV1({ frame: current, effect, signal }, accept, { limits: capturedProfile.render })));
				} else if (effect.type === DEHAZE_EFFECT_TYPE_V1) {
					await adjust(effect.id, () => runStage(accept => withDehazePixelFrameV1({ frame: current, effect, signal }, accept, { limits: capturedProfile.render })));
				} else if (effect.type === DETAIL_SHARPEN_EFFECT_TYPE_V1) {
					await adjust(effect.id, () => runStage(accept => withDetailSharpenPixelFrameV1({ frame: current, effect, signal }, accept, { limits: capturedProfile.render })));
				} else {
					await adjust(effect.id, () => runStage(accept => withGlobalDevelopPixelFrameV1({ frame: current, effects: [effect], signal }, accept,
						{ limits: capturedProfile.render, maximumEffects: 1 })));
				}
			}
			check();
			const histogram = await createPixelFrameHistogramV1(current, { limits: capturedProfile.render, ...(signal ? { signal } : {}) });
			check(); const result = await consume(Object.freeze({ frame: current, histogram, ...(maskOverlay ? { maskOverlay } : {}) })); check(); return result;
		};
		try {
			// Snapshot the host pixels before any selected resource source can yield.
			return brushPlan && maskSource ? await withMaskRasterSourceScopeV1(brushPlan.references, brushPlan.retainedStorageKeys,
				maskSource, render, signal as AbortSignal | undefined) : await render();
		} finally { if (!owner) { wipe(owned); if (maskOverlayBacking) wipe(maskOverlayBacking); } }
	};
	return owner ? owner.run(execute, () => retirementOrder()) : execute();
}

function geometry(frame: ImageDevelopFramePixels, geometry: Readonly<ImageGeometryV1>, signal: AbortSignal | undefined, limits: PixelFrameLimitsV1): Promise<ImageDevelopFramePixels> {
	return stage(accept => withGeometryPixelFrameV1({ frame, geometry, signal }, accept, { limits }));
}

/** A kernel may cancel after its callback returns. Retain and wipe that staged
 * copy if delivery refuses, rather than abandoning an allocated output. */
async function stage(run: (accept: (frame: ImageDevelopFrameStageInput) => void) => Promise<void>): Promise<ImageDevelopFramePixels> {
	const staged: { frame: ImageDevelopFramePixels | null; buffer: ArrayBuffer | null } = { frame: null, buffer: null };
	try {
		await run(frame => {
			const pixels = new Uint8Array(frame.pixels); staged.buffer = pixels.buffer;
			staged.frame = Object.freeze({ descriptor: frame.descriptor, pixels });
		});
		if (!staged.frame) throw new Error('Photo proxy stage produced no frame.');
		return staged.frame;
	} catch (error) { if (staged.buffer) wipe(staged.buffer); throw error; }
}

function wipe(buffer: ArrayBuffer): void {
	if (Number(Reflect.apply(BUFFER_SIZE, buffer, [])) > 0) new Uint8Array(buffer).fill(0);
}

/** Keep cancellation admission identical to the existing photo recipe owner. */
function assertImageDevelopSignal(value: unknown): asserts value is AbortSignal {
	if (typeof value !== 'object' || value === null) throw new TypeError('Collapsed queries require a native cancellation signal.');
	Reflect.apply(CHECK, value, []);
	if (Object.getPrototypeOf(value) !== SIGNAL_PROTOTYPE
		|| ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(value, key))) {
		throw new TypeError('Collapsed queries require native cancellation behavior without overrides.');
	}
}
