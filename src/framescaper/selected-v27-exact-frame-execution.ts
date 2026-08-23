/* SPDX-License-Identifier: AGPL-3.0-only */
import {
	applyManagedSdrGradeStackLinearPixelV1,
	applyManagedSdrLinearGradeStackPixelV1,
	defaultVideoSourceColorInterpretationV1,
	type ParsedCubeLutV1,
	type VideoColorGradeV1,
	type VideoSourceColorInterpretationV1,
} from '../common/editor/video-color-management-v27.ts';
import {
	addUnifiedExactLinearCompositionEntryV13,
	addUnifiedExactLinearDissolveEntryV13,
	compositeUnifiedExactLinearFrameV13,
	createUnifiedExactLinearPremultipliedFrameV13,
	encodeUnifiedExactLinearFrameV13,
	flattenUnifiedExactLinearCompositionV13,
	placeUnifiedExactLinearRgbaFrameV13,
	straightUnifiedExactLinearFrameV13,
	type UnifiedExactLinearBlendModeV13,
	type UnifiedExactLinearCompositionEntryV13,
} from '../common/editor/unified-exact-linear-rgba-v13.ts';
import {
	createUnifiedExactRenderFinishingPreviewConsumerV13,
	type UnifiedExactRenderRgbaFrameV13,
} from '../common/editor/unified-exact-render-finishing-consumers-v13.ts';
import {
	createUnifiedExactRenderVisualPreviewConsumerV13,
	type UnifiedExactRenderActiveAdjustmentV13,
	type UnifiedExactRenderVisualFrameEntryV13,
} from '../common/editor/unified-exact-render-visual-consumers-v13.ts';
import {
	materializeUnifiedExactRenderVisualEntryV13,
	type UnifiedExactRenderVisualRgbaV13,
} from '../common/editor/unified-exact-render-visual-materializer-v13.ts';
import type {
	UnifiedExactRenderFinishingNode,
	UnifiedExactRenderPlanV13,
} from '../common/editor/unified-exact-render-plan.ts';
import type { UnifiedExactRenderTimingSidecars } from '../common/editor/unified-exact-render-timing-authority.ts';
import { evaluateVideoMaskMatteRgbaV13 } from '../common/editor/video-mask-matte-rgba-v13.ts';
import { applyVideoExactBrowserEffectsV27 } from './editor-video-exact-browser-effects-v27.ts';
import { videoDeliveryColorChannels } from '../common/editor/video-delivery-color.ts';
import type { FramescaperProjectV27 } from './editor-project-v27.ts';
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
type Data = Readonly<Record<string, unknown>>;
export interface FramescaperSelectedExactFrameExecutionV27 {
	render(request: Readonly<{
		readonly sequencePosition: Readonly<{ readonly num: number; readonly den: number }>;
		readonly layers: readonly unknown[];
		readonly width: number;
		readonly height: number;
		readonly target: Uint8Array<ArrayBuffer>;
		readonly signal: AbortSignal;
	}>): Promise<Readonly<{ readonly consumedNodeIds: readonly string[] }>>;
	acceleratorDisposition(): Readonly<{
		readonly attempted: boolean;
		readonly active: boolean;
		readonly fallbackReasons: readonly string[];
	}>;
	dispose(): Promise<void>;
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
	readonly createAcceleratorCanvas?: () => unknown;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
}>): Promise<FramescaperSelectedExactFrameExecutionV27> {
	assertReady(options);
	const finishingConsumer = createUnifiedExactRenderFinishingPreviewConsumerV13(options.plan, options.timingSidecars);
	const visualConsumer = createUnifiedExactRenderVisualPreviewConsumerV13(options.plan, options.timingSidecars);
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
	const clips = new Map(options.plan.nodes.flatMap((node) => (
		node.kind === 'clip' ? [[node.clipId, node] as const] : []
	)));
	const sourceIdByNodeId = new Map(options.plan.sources.map(({ nodeId, sourceId }) => [nodeId, sourceId]));
	const effectsById = new Map(options.plan.nodes.flatMap((node) => node.kind !== 'clip' ? []
		: node.pictureState.videoEffects.map((effect) => [effect.id, effect] as const)));
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
			const rawVisuals = await materializeVisuals(
				visual.layers.flatMap(({ entries }) => entries), visualAssets.stills,
				width, height, signal,
			);
			const trackFrames = new Map<string, UnifiedExactLinearCompositionEntryV13[]>();
			const consumed = new Set(visual.ledger.consumedNodeIds);
			consumed.add(finishing.nodeId);
			const adjustmentEffects = new Set(visual.activeAdjustmentLayers.flatMap(({ effectIds }) => effectIds));
			for (const layerValue of request.layers) await renderMediaLayer(
				record(layerValue, 'Selected V27 media layer'), trackFrames,
				rawVisuals, consumed, adjustmentEffects, width, height, signal,
			);
			for (const layer of visual.layers) renderVisualLayer(
				layer.trackId, layer.entries, trackFrames,
				rawVisuals, width, height, signal,
			);
			for (const adjustment of visual.activeAdjustmentLayers) await applyAdjustment(
				adjustment, trackFrames, rawVisuals, width, height, signal,
			);
			const output = createUnifiedExactLinearPremultipliedFrameV13(
				width, height, backgroundLinear(options.plan, finishing),
			);
			for (const track of [...options.plan.tracks].sort((left, right) => (
				right.sequenceOrder - left.sequenceOrder || compareText(left.trackId, right.trackId)
			))) {
				for (const { frame, blendMode } of trackFrames.get(track.trackId) ?? []) {
					compositeUnifiedExactLinearFrameV13(output, frame, blendMode);
				}
			}
			encodeUnifiedExactLinearFrameV13(
				output, finishing.colorContext.outputSpace, request.target,
			);
			throwIfAborted(signal);
			assertReady(options);
			return Object.freeze({ consumedNodeIds: Object.freeze([...consumed].sort(compareText)) });
		} catch (error) {
			if (accepted) request.target.fill(0);
			throw error;
		} finally { active = false; }
	}

	async function renderMediaLayer(
		layer: Data,
		trackFrames: Map<string, UnifiedExactLinearCompositionEntryV13[]>,
		maskInputs: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
		consumed: Set<string>,
		adjustmentEffects: ReadonlySet<string>,
		width: number,
		height: number,
		signal: AbortSignal,
	): Promise<void> {
		const trackId = stableId(layer.trackId, 'Selected V27 media track ID');
		const entries = records(layer.entries, 'Selected V27 media entries');
		const target = trackFrames.get(trackId) ?? [];
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
			const placed = placeUnifiedExactLinearRgbaFrameV13({
				frame: resolved,
				displayWidth: dimension(entry.displayWidth, 'Selected V27 media display width'),
				displayHeight: dimension(entry.displayHeight, 'Selected V27 media display height'),
				outputWidth: width, outputHeight: height,
				renderDescription: entry.renderDescription,
				intervalProgress: unit(entry.intervalProgress ?? 0, 'Selected V27 interval progress'),
				opacity: presentation.opacity,
				...(mask ? { mask } : {}),
			});
			addUnifiedExactLinearDissolveEntryV13(target, placed, presentation.blendMode
				?? renderBlendMode(entry.renderDescription));
		}
		trackFrames.set(trackId, target);
	}

	function renderVisualLayer(
		trackId: string,
		entries: readonly UnifiedExactRenderVisualFrameEntryV13[],
		trackFrames: Map<string, UnifiedExactLinearCompositionEntryV13[]>,
		maskInputs: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
		width: number,
		height: number,
		signal: AbortSignal,
	): void {
		const target = trackFrames.get(trackId) ?? [];
		for (const entry of entries) {
			const raw = requiredVisual(maskInputs, entry.modelId);
			const linear = gradeVisual(finishing, entry, raw, finishingAssets.luts, signal);
			const mask = entry.masks.length === 0 ? undefined
				: combinedGraphs(entry.masks, width, height, maskInputs);
			addUnifiedExactLinearCompositionEntryV13(target, placeUnifiedExactLinearRgbaFrameV13({
				frame: linear, displayWidth: width, displayHeight: height,
				outputWidth: width, outputHeight: height,
				renderDescription: identityDescription(width, height, entry.blendMode),
				opacity: entry.opacity, ...(mask ? { mask } : {}),
			}), entry.blendMode);
		}
		trackFrames.set(trackId, target);
	}

	async function applyAdjustment(
		adjustment: UnifiedExactRenderActiveAdjustmentV13,
		trackFrames: Map<string, UnifiedExactLinearCompositionEntryV13[]>,
		maskInputs: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
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
			const entries = trackFrames.get(trackId);
			if (!entries) continue;
			const target = flattenUnifiedExactLinearCompositionV13(width, height, entries);
			let adjusted = straightUnifiedExactLinearFrameV13(target);
			if (adjustment.effectIds.length > 0) adjusted = checkedFrame(await applyEffects(
				adjusted, adjustment.effectIds.map((id) => requiredVisual(effectsById, id)), signal,
			), 'Selected V27 adjustment effect frame');
			const graded = gradeLinearFrame(adjusted, grades,
				finishingAssets.luts, signal);
			const mask = adjustment.masks.length === 0 ? undefined
				: combinedGraphs(adjustment.masks, width, height, maskInputs);
			const overlay = placeUnifiedExactLinearRgbaFrameV13({
				frame: graded, displayWidth: width, displayHeight: height,
				outputWidth: width, outputHeight: height,
				renderDescription: identityDescription(width, height, adjustment.blendMode),
				opacity: adjustment.opacity, ...(mask ? { mask } : {}),
			});
			compositeUnifiedExactLinearFrameV13(target, overlay, adjustment.blendMode);
			trackFrames.set(trackId, [Object.freeze({ frame: target, blendMode: 'normal' })]);
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
async function materializeVisuals(
	entries: readonly UnifiedExactRenderVisualFrameEntryV13[],
	stills: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
	width: number,
	height: number,
	signal: AbortSignal,
): Promise<ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>> {
	const result = new Map<string, UnifiedExactRenderVisualRgbaV13>();
	for (const entry of entries) {
		const raw = await materializeUnifiedExactRenderVisualEntryV13(Object.freeze({
			...entry, masks: Object.freeze([]),
		}), {
			targetWidth: width, targetHeight: height,
			decodeStill: (source) => Promise.resolve(requiredVisual(stills, source.id)),
			signal,
		});
		result.set(entry.modelId, raw);
		if ('source' in entry.authoredState) result.set(String(entry.authoredState.source.id), raw);
	}
	return result;
}
function gradeVisual(
	finishing: UnifiedExactRenderFinishingNode,
	entry: UnifiedExactRenderVisualFrameEntryV13,
	frame: UnifiedExactRenderVisualRgbaV13,
	luts: ReadonlyMap<string, ParsedCubeLutV1>,
	signal: AbortSignal,
): UnifiedExactRenderRgbaFrameV13 {
	if (!('source' in entry.authoredState)) throw new TypeError('Selected V27 visual source is unavailable.');
	const source = entry.authoredState.source;
	const presentations = finishing.visualPresentations.filter(({ enabled, owner }) => enabled && (
		(owner.kind === 'clip' && owner.id === entry.modelId)
		|| ((owner.kind === 'source' || owner.kind === 'generator') && owner.id === source.id)
	));
	const interpretation = source.kind === 'still'
		? requiredInterpretation(finishing, source.id)
		: defaultVideoSourceColorInterpretationV1('still', source.id);
	return gradeEncodedFrame(frame, interpretation,
		presentations.flatMap(({ grade }) => grade ? [grade] : []), luts, signal);
}
function gradeEncodedFrame(
	frame: UnifiedExactRenderVisualRgbaV13,
	interpretation: VideoSourceColorInterpretationV1,
	grades: readonly VideoColorGradeV1[],
	luts: ReadonlyMap<string, ParsedCubeLutV1>,
	signal: AbortSignal,
): UnifiedExactRenderRgbaFrameV13 {
	const pixels = new Uint8Array(frame.pixels.length);
	const bodies = grades.map(({ lut }) => lut ? luts.get(lut.sha256) : undefined);
	for (let offset = 0; offset < pixels.length; offset += 4) {
		if (offset % (frame.width * 4) === 0) throwIfAborted(signal);
		const value = applyManagedSdrGradeStackLinearPixelV1({
			rgba: channels(frame.pixels, offset), interpretation, grades, luts: bodies,
		});
		writeChannels(pixels, offset, value);
	}
	return Object.freeze({ width: frame.width, height: frame.height, pixels });
}
function gradeLinearFrame(
	frame: UnifiedExactRenderRgbaFrameV13,
	grades: readonly VideoColorGradeV1[],
	luts: ReadonlyMap<string, ParsedCubeLutV1>,
	signal: AbortSignal,
): UnifiedExactRenderRgbaFrameV13 {
	const pixels = new Uint8Array(frame.pixels.length);
	const bodies = grades.map(({ lut }) => lut ? luts.get(lut.sha256) : undefined);
	for (let offset = 0; offset < pixels.length; offset += 4) {
		if (offset % (frame.width * 4) === 0) throwIfAborted(signal);
		writeChannels(pixels, offset, applyManagedSdrLinearGradeStackPixelV1({
			rgba: channels(frame.pixels, offset), grades, luts: bodies,
		}));
	}
	return Object.freeze({ width: frame.width, height: frame.height, pixels });
}
async function captureBrowserFrame(entry: Data, signal: AbortSignal): Promise<UnifiedExactRenderRgbaFrameV13> {
	throwIfAborted(signal);
	if (!globalThis.document?.createElement) throw new Error('Selected V27 source readback is unavailable.');
	const video = record(entry.video, 'Selected V27 media drawable');
	const width = dimension(video.videoWidth, 'Selected V27 media width');
	const height = dimension(video.videoHeight, 'Selected V27 media height');
	const drawable = video.drawable ?? entry.video;
	const canvas = globalThis.document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
	if (!context) throw new Error('Selected V27 source readback has no 2D context.');
	context.clearRect(0, 0, width, height);
	context.drawImage(drawable as CanvasImageSource, 0, 0, width, height);
	const data = context.getImageData(0, 0, width, height).data;
	throwIfAborted(signal);
	return Object.freeze({ width, height, pixels: Uint8Array.from(data) as Uint8Array<ArrayBuffer> });
}

function mediaPresentation(finishing: UnifiedExactRenderFinishingNode, clipId: string, sourceId: string) {
	const presentations = finishing.visualPresentations.filter(({ enabled, owner }) => enabled && (
		(owner.kind === 'clip' && owner.id === clipId) || (owner.kind === 'source' && owner.id === sourceId)
	));
	let opacity = 1;
	let blendMode: UnifiedExactLinearBlendModeV13 | null = null;
	const maskIds = new Set<string>();
	for (const presentation of presentations) {
		opacity *= presentation.opacity;
		blendMode = presentation.blendMode;
		for (const id of presentation.maskMatteIds) maskIds.add(id);
	}
	return Object.freeze({ opacity, blendMode, maskIds: Object.freeze([...maskIds].sort(compareText)) });
}

function combinedMask(
	ids: readonly string[],
	graphs: ReadonlyMap<string, unknown>,
	width: number,
	height: number,
	inputs: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
): Uint8Array<ArrayBuffer> {
	return combinedGraphs(ids.map((id) => {
		const graph = graphs.get(id);
		if (!graph) throw new ReferenceError(`Selected V27 mask ${id} is unavailable.`);
		return graph;
	}), width, height, inputs);
}

function combinedGraphs(
	graphs: readonly unknown[],
	width: number,
	height: number,
	inputs: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(width * height).fill(255);
	for (const graph of graphs) {
		const value = evaluateVideoMaskMatteRgbaV13(graph, width, height, inputs);
		for (let index = 0; index < output.length; index += 1) {
			output[index] = Math.round(output[index]! * value[index]! / 255);
		}
	}
	return output;
}

function backgroundLinear(
	plan: UnifiedExactRenderPlanV13,
	finishing: UnifiedExactRenderFinishingNode,
): readonly [number, number, number, number] {
	const channels = videoDeliveryColorChannels(plan.output.canvas.backgroundColor);
	if (!channels) throw new Error('Selected V27 exact finishing requires a hexadecimal background color.');
	const transfer = finishing.colorContext.outputSpace;
	const interpretation: VideoSourceColorInterpretationV1 = Object.freeze({
		schemaVersion: 1, sourceId: 'v27-output-background', sourceKind: 'still',
		primaries: transfer === 'srgb' ? 'srgb' : 'bt709',
		transfer: transfer === 'srgb' ? 'srgb' : 'bt709',
		matrix: 'rgb', range: 'full', provenance: 'user-override',
	});
	return applyManagedSdrGradeStackLinearPixelV1({
		rgba: [channels.red, channels.green, channels.blue, channels.alpha],
		interpretation, grades: [],
	});
}

function identityDescription(width: number, height: number, blendMode: UnifiedExactLinearBlendModeV13) {
	return Object.freeze({
		crop: Object.freeze({
			normalized: Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 }),
			sourcePixels: Object.freeze({ x: 0, y: 0, width, height }),
		}),
		sourceDisplayToCanvas: Object.freeze([1, 0, 0, 1, 0, 0]),
		opacityStart: 1, opacityEnd: 1, blendMode, compositingOrder: 0,
	});
}

function renderBlendMode(value: unknown): UnifiedExactLinearBlendModeV13 {
	const description = record(value, 'Selected V27 render description');
	const mode = description.blendMode;
	if (!['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference', 'exclusion']
		.includes(String(mode))) throw new RangeError('Selected V27 blend mode is unsupported.');
	return mode as UnifiedExactLinearBlendModeV13;
}

function channels(value: Uint8Array, offset: number): readonly [number, number, number, number] {
	return [value[offset]! / 255, value[offset + 1]! / 255,
		value[offset + 2]! / 255, value[offset + 3]! / 255];
}

function writeChannels(target: Uint8Array, offset: number, value: readonly number[]): void {
	for (let channel = 0; channel < 4; channel += 1) target[offset + channel] = Math.round(value[channel]! * 255);
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

function requiredInterpretation(
	finishing: UnifiedExactRenderFinishingNode,
	sourceId: string,
): VideoSourceColorInterpretationV1 {
	const value = finishing.sourceInterpretations.find((candidate) => candidate.sourceId === sourceId);
	if (!value) throw new ReferenceError(`Selected V27 source interpretation ${sourceId} is unavailable.`);
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
