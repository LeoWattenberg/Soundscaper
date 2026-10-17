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
	assertReady, throwIfAborted, dimension, nonNegativeInteger, unit, stableId, record, records, compareText,
	authoredCompositingOrder,
	backgroundLinear,
	captureBrowserFrame,
	checkedFrame,
	mediaPresentation,
	orderBucketEntries,
	requiredFinishing,
	renderBlendMode,
	type TrackOrderBucketFinishing,
} from './selected-finishing-exact-frame-support.ts';
import { placeFramescaperManagedGradedVisualFrameV1, placeFramescaperManagedGradedAdjustmentFrameV1 } from './selected-finishing-managed-grade-frame.ts';
import { selectedFinishingMaskGraphsV1, legacySelectedFinishingMaskV1, applySelectedFinishingLuminanceMaskV1, selectedFinishingCompositionRangeMaskV1, admitSelectedFinishingLuminanceMasksV1 } from './selected-finishing-luminance-mask-frame-v1.ts';
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
import type { UnifiedExactRenderPlanV13 } from '../common/editor/unified-exact-render-plan.ts';
import {
	outputAtSequencePosition,
	sampleAtSequencePosition,
} from '../common/editor/unified-exact-render-output-timing.ts';
import { applyVideoExactBrowserEffectsFinishing } from './editor-video-exact-browser-effects-finishing.ts';
import {
	createFramescaperSelectedOpenFxCompositionNativeMedia,
	type FramescaperSelectedOpenFxCompositionNativeMedia,
} from './selected-native-media-openfx-exact-composition.ts';
import {
	createFramescaperSelectedOpenFxExactPlanesNativeMedia,
} from './selected-native-media-openfx-exact-planes.ts';
import { createFramescaperSelectedMotionAcceleratorFinishing } from './selected-finishing-motion-accelerator.ts';
import {
	loadFramescaperVideoExportFinishingAssetsFinishing,
} from './video-export-finishing-finishing.ts';
import {
	loadFramescaperVideoExportVisualAssetsFinishing,
} from './video-export-visual-assets-finishing.ts';
import {
	framescaperSelectedOpenFxFrozenFrameResolverNativeMedia,
	materializeFramescaperSelectedOpenFxVisualsNativeMedia,
	orderedFramescaperSelectedOpenFxVisualEntriesNativeMedia,
} from './selected-native-media-openfx-visual-inputs.ts';
import {
	framescaperSupplementalPictureIdentityFinishing,
	validatedFramescaperSupplementalPictureIdsFinishing,
} from './selected-finishing-supplemental-picture-authority.ts';
import { createFramescaperSoundVisualizerWindowReader } from './sound-visualizer-window.ts';
import { assertUnifiedExactRenderPlanV16, type UnifiedExactRenderPlanV16 } from '../common/editor/unified-exact-render-plan-v16.ts';
import { createUnifiedExactRenderFinishingPreviewConsumerV16 } from '../common/editor/unified-exact-render-finishing-consumers-v16.ts';
import { createUnifiedExactRenderVisualPreviewConsumerV16 } from '../common/editor/unified-exact-render-visual-consumers-v16.ts';
import { assertUnifiedExactRenderPlanV13, assertUnifiedExactRenderPlanWithTimingSidecars } from '../common/editor/unified-exact-render-plan.ts';
import { applyVideoExactBrowserEffectsFinishingV2 } from './editor-video-exact-browser-effects-finishing-v2.ts';
import { createFramescaperCubeLutSourceFinishing } from './cube-lut-source-finishing.ts';
import { withFramescaperActiveFrameCapturesV1 } from './selected-finishing-active-frame-capture.ts';
import { normalizeVideoEffectsV2 } from '../common/editor/video-effects-v2.ts';
import { createSelectedFinishingPrivateFrameBacking } from './selected-finishing-private-frame-backing.ts';
import type { FramescaperSelectedExactFrameExecutionFinishing, FramescaperSelectedExactSupplementalPictureFinishing,
	SelectedExactFrameExecutionOptions } from './selected-finishing-exact-frame-contract.ts';
type Data = Readonly<Record<string, unknown>>;
const ANY = AbortSignal.any, ABORT = AbortController.prototype.abort, FILL = Uint8Array.prototype.fill;
type Options = SelectedExactFrameExecutionOptions<UnifiedExactRenderPlanV13 | UnifiedExactRenderPlanV16>;
export const createSelectedExactFrameLegacyCore = (options: SelectedExactFrameExecutionOptions<UnifiedExactRenderPlanV13>) => createExecution(options, false);
export const createSelectedExactFrameResourceCore = (options: SelectedExactFrameExecutionOptions<UnifiedExactRenderPlanV16>) => createExecution(options, true);
async function createExecution(options: Options, resource: boolean): Promise<FramescaperSelectedExactFrameExecutionFinishing> {
	assertReady(options);
	const { finishingConsumer, visualConsumer } = consumers(options, resource);
	const captureFrame = options.captureFrame ?? captureBrowserFrame;
	const suppliedEffects = options.applyEffects, ownsEffectOutput = suppliedEffects === undefined;
	const needsCube = resource && options.plan.nodes.some(node => node.kind === 'clip' && node.pictureState.videoEffects.some(
		effect => effect.type === 'cube-lut-profile-v1' && effect.enabled && effect.params.lut !== null));
	const cubeSource = needsCube && ownsEffectOutput ? createFramescaperCubeLutSourceFinishing(options.store) : undefined;
	const applyEffects = suppliedEffects ?? (resource
		? (frame, effects, signal) => applyVideoExactBrowserEffectsFinishingV2(frame, effects, signal, { source: cubeSource })
		: applyVideoExactBrowserEffectsFinishing);
	const finishing = requiredFinishing(options.plan);
	const finishingAssets = await loadFramescaperVideoExportFinishingAssetsFinishing({
		project: options.project,
		...(options.store ? { store: options.store } : {}),
		signal: options.signal, assertCurrent: options.assertCurrent, confirmFileSizeWarning: options.confirmFileSizeWarning,
	}, finishing);
	const visualAssets = await loadFramescaperVideoExportVisualAssetsFinishing({
		...(options.store ? { store: options.store } : {}),
		signal: options.signal, assertCurrent: options.assertCurrent, confirmFileSizeWarning: options.confirmFileSizeWarning,
	}, options.plan, finishing);
	const soundVisualizer = options.plan.nodes.some((node) => node.kind === 'visual'
		&& node.modelKind === 'sound-visualizer')
		? createFramescaperSoundVisualizerWindowReader({ project: options.project, store: options.store }) : null;
	assertReady(options);
	const openFxPlanes = options.openFx === undefined ? null
		: createFramescaperSelectedOpenFxExactPlanesNativeMedia({
			foundationPlan: options.plan, openFx: options.openFx, assertCurrent: options.assertCurrent,
			...(!options.openFx.resolveFrozenFrame && options.sourceFrames ? {
				fallbackFrozenFrame: framescaperSelectedOpenFxFrozenFrameResolverNativeMedia(options.openFx.plan, options.sourceFrames),
			} : {}),
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
		? await createFramescaperSelectedMotionAcceleratorFinishing(options.createAcceleratorCanvas)
		: Object.freeze({ accelerator: null, fallbackReason: null });
	const accelerator = acceleratorAdmission.accelerator;
	if (acceleratorAdmission.fallbackReason) fallbackReasons.push(acceleratorAdmission.fallbackReason);
	let disposed = false;
	let active = false;
	const retirementStop = new AbortController();
	let activeDrain: Promise<void> | undefined, retirement: Promise<void> | undefined;
	const privateFrames = resource ? createSelectedFinishingPrivateFrameBacking() : undefined;
	const copyFrame: typeof checkedFrame = (value, name) => {
		const frame = checkedFrame(value, name); return privateFrames?.retain(frame) ?? frame;
	};

	async function render(
		request: Parameters<FramescaperSelectedExactFrameExecutionFinishing['render']>[0],
	) {
		if (disposed) throw new Error('Selected finishing exact frame execution is closed.');
		if (active) throw new Error('Selected finishing exact frame execution cannot overlap frames.');
		if (!resource) throwIfAborted(request.signal);
		active = true;
		let complete!: () => void;
		activeDrain = new Promise<void>(resolve => { complete = resolve; });
		let accepted = false;
		try {
			const signal = resource ? Reflect.apply(ANY, AbortSignal, [[request.signal, retirementStop.signal]]) as AbortSignal : request.signal;
			throwIfAborted(signal);
			assertReady(options);
			const width = dimension(request.width, 'Selected finishing exact frame width');
			const height = dimension(request.height, 'Selected finishing exact frame height');
			if (!(request.target instanceof Uint8Array) || request.target.byteLength !== width * height * 4) {
				throw new RangeError('Selected finishing exact frame target geometry changed.');
			}
			accepted = true;
			const layers = request.layers.map(value => record(value, 'Selected finishing media layer'));
			const entries = layers.flatMap(layer => records(layer.entries, 'Selected finishing media entries'));
			if (resource) for (const entry of entries) {
				const clipId = stableId(entry.clipId, 'Selected finishing media clip ID'), clip = clips.get(clipId);
				if (!clip || entry.sourceId !== sourceIdByNodeId.get(clip.sourceNodeId)) throw new Error('Active Frame capture changed clip/source authority.');
				normalizeVideoEffectsV2(entry.effects ?? []);
			}
			const execute = async (captures?: ReadonlyMap<Data, UnifiedExactRenderRgbaFrameV13>) => {
				const visual = visualConsumer.resolveFrame({ sequencePosition: request.sequencePosition });
				const outputOrdinal = request.outputOrdinal ?? outputAtSequencePosition(request.sequencePosition, options.plan);
				const visualEntries = visual.layers.flatMap(({ entries }) => entries);
				const activeVisualIds = new Set(visualEntries.map(({ modelId }) => modelId));
				const supplementalPictureIds = validatedFramescaperSupplementalPictureIdsFinishing(
					request.supplementalPictures ?? [], supplementalVisuals, activeVisualIds,
				);
				const rawVisuals = new Map(await materializeFramescaperSelectedOpenFxVisualsNativeMedia(
					visualEntries.filter(({ modelId }) => !supplementalPictureIds.has(modelId)), visualAssets.stills,
					width, height, options.plan.output.canvas.fit, signal, openFxPlanes, outputOrdinal,
					soundVisualizer ? (entry) => soundVisualizer.window(entry,
						request.timelineSample ?? sampleAtSequencePosition(request.sequencePosition, options.plan), outputOrdinal, signal) : undefined,
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
				const trackFrames = new Map<string, TrackOrderBucketFinishing[]>();
				const clipCompositingOrders = new Map<string, number>();
				const openFx = openFxPlanes === null ? null : createFramescaperSelectedOpenFxCompositionNativeMedia({
					planes: openFxPlanes, plan: options.plan,
					outputOrdinal: openFxPlanes.ordinal(request.sequencePosition),
					transitionWeights: visual.transitionWeights,
					maskGraphs: masks, maskInputs: rawVisuals, initialPlanes: rawVisuals,
					width, height, signal,
				});
				const consumed = new Set(visual.ledger.consumedNodeIds);
				consumed.add(finishing.nodeId);
				const adjustmentEffects = new Set(visual.activeAdjustmentLayers.flatMap(({ effectIds }) => effectIds));
				for (const layerValue of layers) await renderMediaLayer(
					record(layerValue, 'Selected finishing media layer'), trackFrames,
					clipCompositingOrders, rawVisuals, consumed, adjustmentEffects,
					openFx, width, height, signal, captures,
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
							throw new Error('Selected nativeMedia OpenFX Transition changed authored compositing order.');
						}
						orderBucketEntries(trackFrames, trackId, [...orders][0]!).push(...entries);
					}
				}
				for (const { trackId, entry } of orderedFramescaperSelectedOpenFxVisualEntriesNativeMedia(
					visual.layers,
				)) {
					if (supplementalPictureIds.has(entry.modelId)) continue;
					await renderVisualLayer(
						trackId, [entry], trackFrames, rawVisuals, openFx, width, height, signal,
					);
				}
				// timelineImage preview coalesces inherited visual entries before its authenticated
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
			};
			return resource ? await withFramescaperActiveFrameCapturesV1(entries, captureFrame, signal,
				frames => execute(new Map(entries.map((entry, index) => [entry, frames[index]!] as const)))) : await execute();
		} catch (error) {
			if (accepted) request.target.fill(0);
			throw error;
		} finally { privateFrames?.retire(); active = false; activeDrain = undefined; complete(); }
	}

	function renderSupplementalPicture(
		pictureValue: FramescaperSelectedExactSupplementalPictureFinishing,
		visuals: typeof supplementalVisuals,
		activeVisualIds: ReadonlySet<string>,
		trackFrames: Map<string, TrackOrderBucketFinishing[]>,
		width: number,
		height: number,
	): void {
		const picture = record(pictureValue, 'Selected finishing supplemental picture');
		const { trackId } = framescaperSupplementalPictureIdentityFinishing(
			picture, visuals, activeVisualIds,
		);
		const frame = copyFrame(picture.frame, 'Selected finishing supplemental linear frame');
		const renderDescription = picture.renderDescription;
		const placed = placeUnifiedExactLinearRgbaFrameV13({
			frame,
			displayWidth: dimension(picture.displayWidth, 'Selected finishing supplemental display width'),
			displayHeight: dimension(picture.displayHeight, 'Selected finishing supplemental display height'),
			outputWidth: width,
			outputHeight: height,
			renderDescription,
			opacity: unit(picture.opacity, 'Selected finishing supplemental opacity'),
		});
		addUnifiedExactLinearCompositionEntryV13(
			orderBucketEntries(trackFrames, trackId, authoredCompositingOrder(renderDescription)),
			placed,
			renderBlendMode(renderDescription),
		);
	}

	async function renderMediaLayer(
		layer: Data,
		trackFrames: Map<string, TrackOrderBucketFinishing[]>,
		clipCompositingOrders: Map<string, number>,
		maskInputs: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
		consumed: Set<string>,
		adjustmentEffects: ReadonlySet<string>,
		openFx: FramescaperSelectedOpenFxCompositionNativeMedia | null,
		width: number,
		height: number,
		signal: AbortSignal,
		captures?: ReadonlyMap<Data, UnifiedExactRenderRgbaFrameV13>,
	): Promise<void> {
		const trackId = stableId(layer.trackId, 'Selected finishing media track ID');
		const entries = records(layer.entries, 'Selected finishing media entries');
		for (const entry of entries) {
			const effects = records(entry.effects ?? [], 'Selected finishing media effects').filter((effect) => (
				!adjustmentEffects.has(stableId(effect.id, 'Selected finishing media effect ID'))
			));
			const clipId = stableId(entry.clipId, 'Selected finishing media clip ID');
			const clip = clips.get(clipId);
			if (!clip) throw new ReferenceError(`Selected finishing clip ${clipId} is absent from its V13 plan.`);
			const sourceId = sourceIdByNodeId.get(clip.sourceNodeId);
			if (!sourceId || entry.sourceId !== sourceId) {
				throw new Error(`Selected finishing clip ${clipId} changed source authority.`);
			}
			const descriptor = record(entry.presentationDescriptor, 'Selected finishing media presentation');
			const sourceFrame = nonNegativeInteger(
				descriptor.drawableSourceFrame, 'Selected finishing drawable source frame',
			);
			const outerCell = nonNegativeInteger(descriptor.outerCell, 'Selected finishing outer cell');
			const presentation = mediaPresentation(finishing, clipId, sourceId), graphs = selectedFinishingMaskGraphsV1(presentation.maskIds, masks);
			admitSelectedFinishingLuminanceMasksV1(graphs, width, height);
			const raw = captures?.get(entry) ?? await captureFrame(entry, signal);
			let frame = copyFrame(raw, 'Selected finishing captured media frame');
			if (effects.length > 0) {
				const effected = await applyEffects(frame, effects, signal);
				if (ownsEffectOutput) privateFrames?.retain(effected);
				frame = copyFrame(effected, 'Selected finishing effected media frame');
			}
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
			privateFrames?.retain(resolved);
			const mask = legacySelectedFinishingMaskV1(graphs, width, height, maskInputs);
			for (const id of presentation.maskIds) consumed.add(requiredVisual(maskNodeIds, id));
			const compositingOrder = authoredCompositingOrder(entry.renderDescription);
			clipCompositingOrders.set(clipId, compositingOrder);
			const target = orderBucketEntries(trackFrames, trackId, compositingOrder);
			let placed = placeUnifiedExactLinearRgbaFrameV13({
				frame: resolved,
				displayWidth: dimension(entry.displayWidth, 'Selected finishing media display width'),
				displayHeight: dimension(entry.displayHeight, 'Selected finishing media display height'),
				outputWidth: width, outputHeight: height,
				renderDescription: entry.renderDescription,
				intervalProgress: unit(entry.intervalProgress ?? 0, 'Selected finishing interval progress'),
				opacity: presentation.opacity,
				...(mask ? { mask } : {}),
			});
			placed = applySelectedFinishingLuminanceMaskV1(placed, graphs, maskInputs, signal);
			if (openFx) placed = await openFx.clip(placed, clipId, sourceId);
			if (!openFx?.omitsDefaultClip(clipId)) addUnifiedExactLinearDissolveEntryV13(
				target, placed, presentation.blendMode ?? renderBlendMode(entry.renderDescription),
			);
		}
	}

	async function renderVisualLayer(
		trackId: string,
		entries: readonly UnifiedExactRenderVisualFrameEntryV13[],
		trackFrames: Map<string, TrackOrderBucketFinishing[]>,
		maskInputs: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
		openFx: FramescaperSelectedOpenFxCompositionNativeMedia | null,
		width: number,
		height: number,
		signal: AbortSignal,
	): Promise<void> {
		const target = orderBucketEntries(trackFrames, trackId, 0);
		for (const entry of entries) {
			const raw = requiredVisual(maskInputs, entry.modelId);
			const mask = legacySelectedFinishingMaskV1(entry.masks, width, height, maskInputs);
			let placed = await placeFramescaperManagedGradedVisualFrameV1({
				finishing, entry, frame: raw, luts: finishingAssets.luts,
				canvas: { width, height, fit: options.plan.output.canvas.fit }, signal,
				...(mask ? { mask } : {}),
			});
			placed = applySelectedFinishingLuminanceMaskV1(placed, entry.masks, maskInputs, signal);
			if (openFx && 'source' in entry.authoredState) {
				placed = await openFx.visual(placed, entry.modelId, entry.authoredState.source.id);
			}
			addUnifiedExactLinearCompositionEntryV13(target, placed, entry.blendMode);
		}
	}

	async function applyAdjustment(
		adjustment: UnifiedExactRenderActiveAdjustmentV13,
		trackFrames: Map<string, TrackOrderBucketFinishing[]>,
		maskInputs: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
		openFx: FramescaperSelectedOpenFxCompositionNativeMedia | null,
		width: number,
		height: number,
		signal: AbortSignal,
	): Promise<void> {
		const presentations = finishing.visualPresentations.filter(({ enabled, owner }) => (
			enabled && owner.kind === 'adjustment-layer' && owner.id === adjustment.modelId
		));
		if (presentations.some(({ processorStackId }) => processorStackId !== null)) {
			throw new Error('Selected finishing adjustment motion requires a source-bound track processor.');
		}
		const grades = presentations.flatMap(({ grade }) => grade ? [grade] : []);
		for (const trackId of adjustment.targetTrackIds) {
			for (const bucket of trackFrames.get(trackId) ?? []) {
				if (bucket.entries.length === 0) continue;
				// The flattened track keeps its authored blend authority against
				// lower tracks; an adjustment layer must not rewrite it to normal.
				const blendModes = new Set(bucket.entries.map(({ blendMode }) => blendMode));
				if (blendModes.size > 1) {
					throw new Error('Selected finishing adjustment flatten requires one track blend authority.');
				}
				const preservedBlendMode = bucket.entries[0]!.blendMode;
				const target = flattenUnifiedExactLinearCompositionV13(width, height, bucket.entries);
				const rangeMask = selectedFinishingCompositionRangeMaskV1(adjustment.masks, target, maskInputs, signal);
				try {
					let adjusted = straightUnifiedExactLinearFrameV13(target);
					privateFrames?.retain(adjusted);
					if (adjustment.effectIds.length > 0) {
						const effected = await applyEffects(adjusted, adjustment.effectIds.map((id) => requiredVisual(effectsById, id)), signal);
						if (ownsEffectOutput) privateFrames?.retain(effected);
						adjusted = copyFrame(effected, 'Selected finishing adjustment effect frame');
					}
					const mask = rangeMask ?? legacySelectedFinishingMaskV1(adjustment.masks, width, height, maskInputs);
					let overlay = await placeFramescaperManagedGradedAdjustmentFrameV1({
						frame: adjusted, grades, luts: finishingAssets.luts, width, height, signal,
						blendMode: adjustment.blendMode,
						opacity: adjustment.opacity, ...(mask ? { mask } : {}),
					});
					if (openFx) overlay = await openFx.adjustment(overlay, adjustment.modelId);
					compositeUnifiedExactLinearFrameV13(target, overlay, adjustment.blendMode);
					bucket.entries = [Object.freeze({ frame: target, blendMode: preservedBlendMode })];
				} finally { if (rangeMask) Reflect.apply(FILL, rangeMask, [0]); }
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

	function dispose(): Promise<void> {
		if (!resource) return disposeLegacy();
		if (retirement) return retirement;
		disposed = true;
		const held = activeDrain;
		let done!: () => void, fail!: (error: unknown) => void;
		retirement = new Promise<void>((resolve, reject) => { done = resolve; fail = reject; });
		// The cached join exists before native abort dispatch can reenter Close.
		Reflect.apply(ABORT, retirementStop, []);
		void retire().then(done, fail);
		return retirement;
		async function retire() {
			await held;
			const errors: unknown[] = [];
			try { accelerator?.dispose(); } catch (error) { errors.push(error); }
			try { soundVisualizer?.dispose(); } catch (error) { errors.push(error); }
			try { await cubeSource?.close(); } catch (error) { errors.push(error); }
			for (const frame of visualAssets.stills.values()) Reflect.apply(FILL, frame.pixels, [0]);
			if (errors.length === 1) throw errors[0];
			if (errors.length > 1) throw new AggregateError(errors, 'Selected Frame resource retirement failures.');
		}
	}
	async function disposeLegacy(): Promise<void> {
		if (disposed) return;
		if (active) throw new Error('Selected finishing exact frame execution is active.');
		disposed = true;
		accelerator?.dispose();
		soundVisualizer?.dispose();
		await cubeSource?.close();
		for (const frame of visualAssets.stills.values()) frame.pixels.fill(0);
	}

	return Object.freeze({ render, acceleratorDisposition, dispose });
}
function requiredVisual<Value>(values: ReadonlyMap<string, Value>, id: string): Value {
	const value = values.get(id);
	if (!value) throw new ReferenceError(`Selected finishing visual ${id} is unavailable.`);
	return value;
}

function consumers(options: Options, resource: boolean) {
	if (resource) {
		assertUnifiedExactRenderPlanV16(options.plan, options.timingSidecars);
		return { finishingConsumer: createUnifiedExactRenderFinishingPreviewConsumerV16(options.plan, options.timingSidecars),
			visualConsumer: createUnifiedExactRenderVisualPreviewConsumerV16(options.plan, options.timingSidecars, { allowExternalGenerators: options.openFx !== undefined }) };
	}
	assertLegacyPlan(options);
	return { finishingConsumer: createUnifiedExactRenderFinishingPreviewConsumerV13(options.plan, options.timingSidecars),
		visualConsumer: createUnifiedExactRenderVisualPreviewConsumerV13(options.plan, options.timingSidecars, { allowExternalGenerators: options.openFx !== undefined }) };
}
function assertLegacyPlan(options: Options): asserts options is SelectedExactFrameExecutionOptions<UnifiedExactRenderPlanV13> {
	if (options.timingSidecars === undefined) assertUnifiedExactRenderPlanV13(options.plan);
	else {
		assertUnifiedExactRenderPlanWithTimingSidecars(options.plan, options.timingSidecars);
		if (options.plan.version !== 13) throw new RangeError('Selected finishing requires a V13 plan.');
	}
}
