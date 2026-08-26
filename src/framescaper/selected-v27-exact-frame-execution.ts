/* SPDX-License-Identifier: AGPL-3.0-only */
import {
	addUnifiedExactLinearCompositionEntryV13,
	addUnifiedExactLinearDissolveEntryV13,
	compositeUnifiedExactLinearFrameV13,
	createUnifiedExactLinearPremultipliedFrameV13,
	encodeUnifiedExactLinearFrameV13,
	flattenUnifiedExactLinearCompositionV13,
	placeUnifiedExactLinearRgbaFrameV13,
	straightUnifiedExactLinearFrameV13,
	type UnifiedExactLinearCompositionEntryV13,
} from '../common/editor/unified-exact-linear-rgba-v13.ts';
import {
	authoredCompositingOrder,
	backgroundLinear,
	captureBrowserFrame,
	combinedGraphs,
	combinedMask,
	gradeLinearFrame,
	gradeVisual,
	identityDescription,
	mediaPresentation,
	orderBucketEntries,
	renderBlendMode,
	type TrackOrderBucketV27,
} from './selected-v27-exact-frame-support.ts';
import {
	createUnifiedExactRenderFinishingPreviewConsumerV13,
	type UnifiedExactRenderRgbaFrameV13,
} from '../common/editor/unified-exact-render-finishing-consumers-v13.ts';
import {
	createUnifiedExactRenderVisualPreviewConsumerV13,
	type UnifiedExactRenderActiveAdjustmentV13,
	type UnifiedExactRenderVisualFrameEntryV13,
} from '../common/editor/unified-exact-render-visual-consumers-v13.ts';
import type { UnifiedExactRenderVisualRgbaV13 } from '../common/editor/unified-exact-render-visual-materializer-v13.ts';
import type {
	UnifiedExactRenderFinishingNode,
	UnifiedExactRenderPlanV13,
} from '../common/editor/unified-exact-render-plan.ts';
import type { UnifiedExactRenderTimingSidecars } from '../common/editor/unified-exact-render-timing-authority.ts';
import { applyVideoExactBrowserEffectsV27 } from './editor-video-exact-browser-effects-v27.ts';
import type { FramescaperProjectV27 } from './editor-project-v27.ts';
import {
	createFramescaperSelectedOpenFxCompositionV28,
	type FramescaperSelectedOpenFxCompositionV28,
} from './selected-v28-openfx-exact-composition.ts';
import {
	createFramescaperSelectedOpenFxExactPlanesV28,
	type FramescaperSelectedOpenFxExecutionV28,
} from './selected-v28-openfx-exact-planes.ts';
import type { FramescaperOpenFxFrameDispositionV28 } from './editor-openfx-frame-graph-v28.ts';
import { createFramescaperSelectedMotionAcceleratorV27 } from './selected-v27-motion-accelerator.ts';
import type { FramescaperVideoFrameAddressV27 } from './video-frame-address-v27.ts';
import {
	loadFramescaperVideoExportFinishingAssetsV27,
	type FramescaperVideoExportFinishingAssetStoreV27,
} from './video-export-finishing-v27.ts';
import {
	loadFramescaperVideoExportVisualAssetsV27,
	type FramescaperVideoExportVisualAssetStoreV27,
} from './video-export-visual-assets-v27.ts';
import {
	framescaperSelectedOpenFxFrozenFrameResolverV28,
	materializeFramescaperSelectedOpenFxVisualsV28,
	orderedFramescaperSelectedOpenFxVisualEntriesV28,
} from './selected-v28-openfx-visual-inputs.ts';
import {
	framescaperSupplementalPictureIdentityV27,
	validatedFramescaperSupplementalPictureIdsV27,
} from './selected-v27-supplemental-picture-authority.ts';
type Data = Readonly<Record<string, unknown>>;
export interface FramescaperSelectedExactFrameExecutionV27 {
	render(request: Readonly<{
		readonly sequencePosition: Readonly<{ readonly num: number; readonly den: number }>;
		readonly layers: readonly unknown[];
		readonly supplementalPictures?: readonly FramescaperSelectedExactSupplementalPictureV27[];
		readonly width: number;
		readonly height: number;
		readonly target: Uint8Array<ArrayBuffer>;
		readonly signal: AbortSignal;
	}>): Promise<Readonly<{
		readonly consumedNodeIds: readonly string[];
		readonly openFxDispositions: readonly FramescaperOpenFxFrameDispositionV28[];
		readonly reportsOpenFxDegradation: boolean;
	}>>;
	acceleratorDisposition(): Readonly<{
		readonly attempted: boolean;
		readonly active: boolean;
		readonly fallbackReasons: readonly string[];
	}>;
	dispose(): Promise<void>;
}

/** A plan-authenticated straight-linear picture supplied by a newer product generation. */
export interface FramescaperSelectedExactSupplementalPictureV27 {
	readonly trackId: string;
	readonly clipId: string;
	readonly sourceId: string;
	readonly frame: UnifiedExactRenderRgbaFrameV13;
	readonly displayWidth: number;
	readonly displayHeight: number;
	readonly renderDescription: unknown;
	readonly opacity: number;
}
export type CaptureFrameV27 = (entry: Data, signal: AbortSignal) => (
	PromiseLike<UnifiedExactRenderRgbaFrameV13> | UnifiedExactRenderRgbaFrameV13
);
export type ApplyEffectsV27 = (frame: UnifiedExactRenderRgbaFrameV13, effects: readonly unknown[],
	signal: AbortSignal) => PromiseLike<UnifiedExactRenderRgbaFrameV13>;
export async function createFramescaperSelectedExactFrameExecutionV27(options: Readonly<{
	readonly project: FramescaperProjectV27;
	readonly plan: UnifiedExactRenderPlanV13;
	readonly timingSidecars: UnifiedExactRenderTimingSidecars;
	readonly store?: FramescaperVideoExportVisualAssetStoreV27 & FramescaperVideoExportFinishingAssetStoreV27;
	readonly sourceFrames?: FramescaperVideoFrameAddressV27;
	readonly captureFrame?: CaptureFrameV27;
	readonly applyEffects?: ApplyEffectsV27;
	readonly openFx?: FramescaperSelectedOpenFxExecutionV28;
	readonly createAcceleratorCanvas?: () => unknown;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
}>): Promise<FramescaperSelectedExactFrameExecutionV27> {
	assertReady(options);
	const finishingConsumer = createUnifiedExactRenderFinishingPreviewConsumerV13(options.plan, options.timingSidecars);
	const visualConsumer = createUnifiedExactRenderVisualPreviewConsumerV13(
		options.plan, options.timingSidecars, { allowExternalGenerators: options.openFx !== undefined },
	);
	const finishing = requiredFinishing(options.plan);
	const finishingAssets = await loadFramescaperVideoExportFinishingAssetsV27({
		project: options.project,
		...(options.store ? { store: options.store } : {}),
		signal: options.signal, assertCurrent: options.assertCurrent,
	}, finishing);
	const visualAssets = await loadFramescaperVideoExportVisualAssetsV27({
		...(options.store ? { store: options.store } : {}),
		signal: options.signal, assertCurrent: options.assertCurrent,
	}, options.plan, finishing);
	assertReady(options);
	const captureFrame = options.captureFrame ?? captureBrowserFrame;
	const applyEffects = options.applyEffects ?? applyVideoExactBrowserEffectsV27;
	const openFxExecution = options.openFx === undefined ? undefined
		: options.openFx.resolveFrozenFrame || !options.sourceFrames ? options.openFx
			: Object.freeze({ ...options.openFx,
				resolveFrozenFrame: framescaperSelectedOpenFxFrozenFrameResolverV28(
					options.openFx.plan, options.sourceFrames,
				) });
	const openFxPlanes = openFxExecution === undefined ? null
		: createFramescaperSelectedOpenFxExactPlanesV28({
			foundationPlan: options.plan, openFx: openFxExecution, assertCurrent: options.assertCurrent,
		});
	const clips = new Map(options.plan.nodes.flatMap((node) => (
		node.kind === 'clip' ? [[node.clipId, node] as const] : []
	)));
	const sourceIdByNodeId = new Map(options.plan.sources.map(({ nodeId, sourceId }) => [nodeId, sourceId]));
	const effectsById = new Map(options.plan.nodes.flatMap((node) => node.kind !== 'clip' ? []
		: node.pictureState.videoEffects.map((effect) => [effect.id, effect] as const)));
	const supplementalVisuals = new Map(options.plan.nodes.flatMap((node) => {
		if (node.kind !== 'visual' || !('source' in node.authoredState)
			|| node.authoredState.source.kind !== 'generator' || node.placement === null) return [];
		return [[node.modelId, Object.freeze({
			trackId: node.placement.trackId,
			sourceId: node.authoredState.source.id,
			clipId: node.authoredState.clip.id,
		})] as const];
	}));
	const masks = new Map(options.plan.nodes.flatMap((node) => (
		node.kind === 'visual' && node.modelKind === 'mask-matte' && 'inputs' in node.authoredState
			? [[node.modelId, node.authoredState] as const] : []
	)));
	const maskNodeIds = new Map(options.plan.nodes.flatMap((node) => (
		node.kind === 'visual' && node.modelKind === 'mask-matte'
			? [[node.modelId, node.nodeId] as const] : []
	)));
	const fallbackReasons: string[] = [];
	const needsAccelerator = finishing.processorStacks.some(({ processors }) => processors.some(
		({ enabled, kind }) => enabled && kind === 'temporal-denoise',
	));
	const acceleratorAdmission = needsAccelerator
		? await createFramescaperSelectedMotionAcceleratorV27(options.createAcceleratorCanvas)
		: Object.freeze({ accelerator: null, fallbackReason: null });
	const accelerator = acceleratorAdmission.accelerator;
	if (acceleratorAdmission.fallbackReason) fallbackReasons.push(acceleratorAdmission.fallbackReason);
	let disposed = false;
	let active = false;

	async function render(
		request: Parameters<FramescaperSelectedExactFrameExecutionV27['render']>[0],
	) {
		if (disposed) throw new Error('Selected V27 exact frame execution is closed.');
		if (active) throw new Error('Selected V27 exact frame execution cannot overlap frames.');
		const signal = request.signal;
		throwIfAborted(signal);
		active = true;
		let accepted = false;
		try {
			assertReady(options);
			const width = dimension(request.width, 'Selected V27 exact frame width');
			const height = dimension(request.height, 'Selected V27 exact frame height');
			if (!(request.target instanceof Uint8Array) || request.target.byteLength !== width * height * 4) {
				throw new RangeError('Selected V27 exact frame target geometry changed.');
			}
			accepted = true;
			const visual = visualConsumer.resolveFrame({ sequencePosition: request.sequencePosition });
			const visualEntries = visual.layers.flatMap(({ entries }) => entries);
			const activeVisualIds = new Set(visualEntries.map(({ modelId }) => modelId));
			const supplementalPictureIds = validatedFramescaperSupplementalPictureIdsV27(
				request.supplementalPictures ?? [], supplementalVisuals, activeVisualIds,
			);
			const rawVisuals = new Map(await materializeFramescaperSelectedOpenFxVisualsV28(
				visualEntries.filter(({ modelId }) => !supplementalPictureIds.has(modelId)), visualAssets.stills,
				width, height, signal, openFxPlanes,
			));
			if (supplementalPictureIds.size > 0) {
				const transparent = Object.freeze({
					width, height, pixels: new Uint8Array(width * height * 4),
				});
				for (const entry of visualEntries) {
					if (!supplementalPictureIds.has(entry.modelId)) continue;
					rawVisuals.set(entry.modelId, transparent);
					if ('source' in entry.authoredState) rawVisuals.set(entry.authoredState.source.id, transparent);
				}
			}
			const trackFrames = new Map<string, TrackOrderBucketV27[]>();
			const clipCompositingOrders = new Map<string, number>();
			const openFx = openFxPlanes === null ? null : createFramescaperSelectedOpenFxCompositionV28({
				planes: openFxPlanes, plan: options.plan,
				outputOrdinal: openFxPlanes.ordinal(request.sequencePosition),
				transitionWeights: visual.transitionWeights,
				maskGraphs: masks, maskInputs: rawVisuals, initialPlanes: rawVisuals,
				width, height, signal,
			});
			const consumed = new Set(visual.ledger.consumedNodeIds);
			consumed.add(finishing.nodeId);
			const adjustmentEffects = new Set(visual.activeAdjustmentLayers.flatMap(({ effectIds }) => effectIds));
			for (const layerValue of request.layers) await renderMediaLayer(
				record(layerValue, 'Selected V27 media layer'), trackFrames,
				clipCompositingOrders, rawVisuals, consumed, adjustmentEffects,
				openFx, width, height, signal,
			);
			if (openFx) {
				const transitionFrames = new Map<string, UnifiedExactLinearCompositionEntryV13[]>();
				await openFx.applyTransitions(transitionFrames);
				const activeTransitionIds = new Set(visual.transitionWeights.map(({ transitionId }) => transitionId));
				for (const [trackId, entries] of transitionFrames) {
					const orders = new Set(options.plan.nodes.flatMap((node) => node.kind === 'transition'
						&& node.edges.trackId === trackId && activeTransitionIds.has(node.transition.id)
						&& openFxPlanes?.has('transition', node.transition.id)
						? [clipCompositingOrders.get(node.edges.outgoing.clipId),
							clipCompositingOrders.get(node.edges.incoming.clipId)] : [])
						.filter((order): order is number => order !== undefined));
					if (orders.size !== 1) {
						throw new Error('Selected V28 OpenFX Transition changed authored compositing order.');
					}
					orderBucketEntries(trackFrames, trackId, [...orders][0]!).push(...entries);
				}
			}
			for (const { trackId, entry } of orderedFramescaperSelectedOpenFxVisualEntriesV28(
				visual.layers,
			)) {
				if (supplementalPictureIds.has(entry.modelId)) continue;
				await renderVisualLayer(
					trackId, [entry], trackFrames, rawVisuals, openFx, width, height, signal,
				);
			}
			// V32 preview coalesces inherited visual entries before its authenticated
			// image entries on each track; export preserves that painter order.
			for (const picture of request.supplementalPictures ?? []) renderSupplementalPicture(
				picture, supplementalVisuals, activeVisualIds, trackFrames, width, height,
			);
			for (const adjustment of visual.activeAdjustmentLayers) await applyAdjustment(
				adjustment, trackFrames, rawVisuals, openFx, width, height, signal,
			);
			const output = createUnifiedExactLinearPremultipliedFrameV13(
				width, height, backgroundLinear(options.plan, finishing),
			);
			// Canonical painter order: authored compositingOrder ascending, then
			// sequence position descending, matching resolveActiveVideoLayers.
			const ordered = [...options.plan.tracks].flatMap((track) => (
				(trackFrames.get(track.trackId) ?? []).map((bucket) => ({ track, bucket }))
			)).sort((left, right) => (
				left.bucket.order - right.bucket.order
				|| right.track.sequenceOrder - left.track.sequenceOrder
				|| compareText(left.track.trackId, right.track.trackId)
			));
			for (const { bucket } of ordered) {
				for (const { frame, blendMode } of bucket.entries) {
					compositeUnifiedExactLinearFrameV13(output, frame, blendMode);
				}
			}
			encodeUnifiedExactLinearFrameV13(
				output, finishing.colorContext.outputSpace, request.target,
			);
			throwIfAborted(signal);
			assertReady(options);
			const disposition = openFx?.disposition() ?? Object.freeze({
				effects: Object.freeze([]), reportsDegradation: false,
			});
			return Object.freeze({
				consumedNodeIds: Object.freeze([...consumed].sort(compareText)),
				openFxDispositions: disposition.effects,
				reportsOpenFxDegradation: disposition.reportsDegradation,
			});
		} catch (error) {
			if (accepted) request.target.fill(0);
			throw error;
		} finally { active = false; }
	}

	function renderSupplementalPicture(
		pictureValue: FramescaperSelectedExactSupplementalPictureV27,
		visuals: typeof supplementalVisuals,
		activeVisualIds: ReadonlySet<string>,
		trackFrames: Map<string, TrackOrderBucketV27[]>,
		width: number,
		height: number,
	): void {
		const picture = record(pictureValue, 'Selected V27 supplemental picture');
		const { trackId } = framescaperSupplementalPictureIdentityV27(
			picture, visuals, activeVisualIds,
		);
		const frame = checkedFrame(picture.frame, 'Selected V27 supplemental linear frame');
		const renderDescription = picture.renderDescription;
		const placed = placeUnifiedExactLinearRgbaFrameV13({
			frame,
			displayWidth: dimension(picture.displayWidth, 'Selected V27 supplemental display width'),
			displayHeight: dimension(picture.displayHeight, 'Selected V27 supplemental display height'),
			outputWidth: width,
			outputHeight: height,
			renderDescription,
			opacity: unit(picture.opacity, 'Selected V27 supplemental opacity'),
		});
		addUnifiedExactLinearCompositionEntryV13(
			orderBucketEntries(trackFrames, trackId, authoredCompositingOrder(renderDescription)),
			placed,
			renderBlendMode(renderDescription),
		);
	}

	async function renderMediaLayer(
		layer: Data,
		trackFrames: Map<string, TrackOrderBucketV27[]>,
		clipCompositingOrders: Map<string, number>,
		maskInputs: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
		consumed: Set<string>,
		adjustmentEffects: ReadonlySet<string>,
		openFx: FramescaperSelectedOpenFxCompositionV28 | null,
		width: number,
		height: number,
		signal: AbortSignal,
	): Promise<void> {
		const trackId = stableId(layer.trackId, 'Selected V27 media track ID');
		const entries = records(layer.entries, 'Selected V27 media entries');
		for (const entry of entries) {
			const effects = records(entry.effects ?? [], 'Selected V27 media effects').filter((effect) => (
				!adjustmentEffects.has(stableId(effect.id, 'Selected V27 media effect ID'))
			));
			const clipId = stableId(entry.clipId, 'Selected V27 media clip ID');
			const clip = clips.get(clipId);
			if (!clip) throw new ReferenceError(`Selected V27 clip ${clipId} is absent from its V13 plan.`);
			const sourceId = sourceIdByNodeId.get(clip.sourceNodeId);
			if (!sourceId || entry.sourceId !== sourceId) {
				throw new Error(`Selected V27 clip ${clipId} changed source authority.`);
			}
			const descriptor = record(entry.presentationDescriptor, 'Selected V27 media presentation');
			const sourceFrame = nonNegativeInteger(
				descriptor.drawableSourceFrame, 'Selected V27 drawable source frame',
			);
			const outerCell = nonNegativeInteger(descriptor.outerCell, 'Selected V27 outer cell');
			const raw = await captureFrame(entry, signal);
			let frame = checkedFrame(raw, 'Selected V27 captured media frame');
			if (effects.length > 0) frame = checkedFrame(
				await applyEffects(frame, effects, signal), 'Selected V27 effected media frame',
			);
			const resolved = await finishingConsumer.resolveFrame({
				clipId, sourceFrame, sequenceFrame: clip.sequenceStartFrame + outerCell,
				frame, presentationScope: 'source', outputEncoding: 'linear-rec709-d65',
				// Captured media pixels are browser readback: full-range canvas sRGB.
				frameEncoding: 'canvas-srgb',
				analysisBodies: finishingAssets.analyses, lutBodies: finishingAssets.luts,
				...(accelerator ? { accelerator } : {}),
				onAcceleratorFallback(reason) { if (!fallbackReasons.includes(reason)) fallbackReasons.push(reason); },
				...(options.sourceFrames ? {
					resolveTemporalFrame: ({ sourceFrame: ordinal, width: frameWidth,
						height: frameHeight, signal: temporalSignal }) => options.sourceFrames!.resolve({
						sourceId, sourceFrame: ordinal, width: frameWidth, height: frameHeight,
						signal: temporalSignal ?? signal,
					}),
				} : {}),
				signal,
			});
			const presentation = mediaPresentation(finishing, clipId, sourceId);
			const mask = presentation.maskIds.length === 0 ? undefined
				: combinedMask(presentation.maskIds, masks, width, height, maskInputs);
			for (const id of presentation.maskIds) consumed.add(requiredVisual(maskNodeIds, id));
			const compositingOrder = authoredCompositingOrder(entry.renderDescription);
			clipCompositingOrders.set(clipId, compositingOrder);
			const target = orderBucketEntries(trackFrames, trackId, compositingOrder);
			let placed = placeUnifiedExactLinearRgbaFrameV13({
				frame: resolved,
				displayWidth: dimension(entry.displayWidth, 'Selected V27 media display width'),
				displayHeight: dimension(entry.displayHeight, 'Selected V27 media display height'),
				outputWidth: width, outputHeight: height,
				renderDescription: entry.renderDescription,
				intervalProgress: unit(entry.intervalProgress ?? 0, 'Selected V27 interval progress'),
				opacity: presentation.opacity,
				...(mask ? { mask } : {}),
			});
			if (openFx) placed = await openFx.clip(placed, clipId, sourceId);
			if (!openFx?.omitsDefaultClip(clipId)) addUnifiedExactLinearDissolveEntryV13(
				target, placed, presentation.blendMode ?? renderBlendMode(entry.renderDescription),
			);
		}
	}

	async function renderVisualLayer(
		trackId: string,
		entries: readonly UnifiedExactRenderVisualFrameEntryV13[],
		trackFrames: Map<string, TrackOrderBucketV27[]>,
		maskInputs: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
		openFx: FramescaperSelectedOpenFxCompositionV28 | null,
		width: number,
		height: number,
		signal: AbortSignal,
	): Promise<void> {
		const target = orderBucketEntries(trackFrames, trackId, 0);
		for (const entry of entries) {
			const raw = requiredVisual(maskInputs, entry.modelId);
			const linear = gradeVisual(finishing, entry, raw, finishingAssets.luts, signal);
			const mask = entry.masks.length === 0 ? undefined
				: combinedGraphs(entry.masks, width, height, maskInputs);
			let placed = placeUnifiedExactLinearRgbaFrameV13({
				frame: linear, displayWidth: width, displayHeight: height,
				outputWidth: width, outputHeight: height,
				renderDescription: identityDescription(width, height, entry.blendMode),
				opacity: entry.opacity, ...(mask ? { mask } : {}),
			});
			if (openFx && 'source' in entry.authoredState) {
				placed = await openFx.visual(placed, entry.modelId, entry.authoredState.source.id);
			}
			addUnifiedExactLinearCompositionEntryV13(target, placed, entry.blendMode);
		}
	}

	async function applyAdjustment(
		adjustment: UnifiedExactRenderActiveAdjustmentV13,
		trackFrames: Map<string, TrackOrderBucketV27[]>,
		maskInputs: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
		openFx: FramescaperSelectedOpenFxCompositionV28 | null,
		width: number,
		height: number,
		signal: AbortSignal,
	): Promise<void> {
		const presentations = finishing.visualPresentations.filter(({ enabled, owner }) => (
			enabled && owner.kind === 'adjustment-layer' && owner.id === adjustment.modelId
		));
		if (presentations.some(({ processorStackId }) => processorStackId !== null)) {
			throw new Error('Selected V27 adjustment motion requires a source-bound track processor.');
		}
		const grades = presentations.flatMap(({ grade }) => grade ? [grade] : []);
		for (const trackId of adjustment.targetTrackIds) {
			for (const bucket of trackFrames.get(trackId) ?? []) {
				if (bucket.entries.length === 0) continue;
				// The flattened track keeps its authored blend authority against
				// lower tracks; an adjustment layer must not rewrite it to normal.
				const blendModes = new Set(bucket.entries.map(({ blendMode }) => blendMode));
				if (blendModes.size > 1) {
					throw new Error('Selected V27 adjustment flatten requires one track blend authority.');
				}
				const preservedBlendMode = bucket.entries[0]!.blendMode;
				const target = flattenUnifiedExactLinearCompositionV13(width, height, bucket.entries);
				let adjusted = straightUnifiedExactLinearFrameV13(target);
				if (adjustment.effectIds.length > 0) adjusted = checkedFrame(await applyEffects(
					adjusted, adjustment.effectIds.map((id) => requiredVisual(effectsById, id)), signal,
				), 'Selected V27 adjustment effect frame');
				const graded = gradeLinearFrame(adjusted, grades,
					finishingAssets.luts, signal);
				const mask = adjustment.masks.length === 0 ? undefined
					: combinedGraphs(adjustment.masks, width, height, maskInputs);
				let overlay = placeUnifiedExactLinearRgbaFrameV13({
					frame: graded, displayWidth: width, displayHeight: height,
					outputWidth: width, outputHeight: height,
					renderDescription: identityDescription(width, height, adjustment.blendMode),
					opacity: adjustment.opacity, ...(mask ? { mask } : {}),
				});
				if (openFx) overlay = await openFx.adjustment(overlay, adjustment.modelId);
				compositeUnifiedExactLinearFrameV13(target, overlay, adjustment.blendMode);
				bucket.entries = [Object.freeze({ frame: target, blendMode: preservedBlendMode })];
			}
		}
	}

	function acceleratorDisposition() {
		return Object.freeze({
			attempted: needsAccelerator,
			active: accelerator !== null,
			fallbackReasons: Object.freeze([...fallbackReasons]),
		});
	}

	async function dispose(): Promise<void> {
		if (disposed) return;
		if (active) throw new Error('Selected V27 exact frame execution is active.');
		disposed = true;
		accelerator?.dispose();
		for (const frame of visualAssets.stills.values()) frame.pixels.fill(0);
	}

	return Object.freeze({ render, acceleratorDisposition, dispose });
}
function checkedFrame(value: unknown, name: string): UnifiedExactRenderRgbaFrameV13 {
	if (!value || typeof value !== 'object') throw new TypeError(`${name} must be an RGBA frame.`);
	const frame = value as Partial<UnifiedExactRenderRgbaFrameV13>;
	const width = dimension(frame.width, `${name} width`);
	const height = dimension(frame.height, `${name} height`);
	if (!(frame.pixels instanceof Uint8Array) || frame.pixels.byteLength !== width * height * 4) {
		throw new RangeError(`${name} geometry changed.`);
	}
	return Object.freeze({ width, height, pixels: frame.pixels.slice() });
}

function requiredVisual<Value>(values: ReadonlyMap<string, Value>, id: string): Value {
	const value = values.get(id);
	if (!value) throw new ReferenceError(`Selected V27 visual ${id} is unavailable.`);
	return value;
}

function requiredFinishing(plan: UnifiedExactRenderPlanV13): UnifiedExactRenderFinishingNode {
	const values = plan.nodes.filter((node): node is UnifiedExactRenderFinishingNode => node.kind === 'finishing');
	if (values.length !== 1) throw new ReferenceError('Selected V27 exact execution requires one finishing node.');
	return values[0]!;
}

function assertReady(options: Readonly<{ signal: AbortSignal; assertCurrent: () => void }>): void {
	throwIfAborted(options.signal);
	options.assertCurrent();
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason ?? new DOMException('Selected V27 exact execution was aborted.', 'AbortError');
}

function dimension(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 65_536) {
		throw new RangeError(`${name} must be a positive bounded integer.`);
	}
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function unit(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError(`${name} must be between zero and one.`);
	}
	return value;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) throw new TypeError(`${name} is invalid.`);
	return value;
}

function record(value: unknown, name: string): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Data;
}

function records(value: unknown, name: string): Data[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((entry, index) => record(entry, `${name}[${String(index)}]`));
}

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
