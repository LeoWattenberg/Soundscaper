/* SPDX-License-Identifier: AGPL-3.0-only */

import { fingerprintNativeMediaPlan } from '../common/editor/native-media-plan-canonical-form.ts';
import { sequenceFrameBoundarySample } from '../common/editor/sequence-frame-navigation.ts';
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import { digestMediaContent } from '../common/editor/storage/media-content-digest.ts';
import { multiplyDivideRationals } from '../common/editor/timeline-time.ts';
import {
	createUnifiedExactRenderVisualPreviewConsumerV13,
	resolveUnifiedExactRenderVisualPresentationV13,
	type UnifiedExactRenderVisualFrameEntryV13,
} from '../common/editor/unified-exact-render-visual-consumers-v13.ts';
import {
	materializeUnifiedExactRenderVisualEntryV13,
	type UnifiedExactRenderVisualRgbaV13,
} from '../common/editor/unified-exact-render-visual-materializer-v13.ts';
import type {
	UnifiedExactRenderPlanV13,
	UnifiedExactRenderVisualNode,
} from '../common/editor/unified-exact-render-plan.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../common/editor/video-clip-composition.ts';
import type { VideoFreezeFreshnessInputV1 } from '../common/editor/video-freeze-v24.ts';
import { resolveVideoRenderDescription } from '../common/editor/video-render-description.ts';
import { registeredVideoTimingIndex } from '../common/editor/video-source-time.ts';
import {
	bindVideoSourceTimingView,
	type BoundVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../common/editor/video-source-timing-view.ts';
import type {
	ProductVideoVisualPreviewCreateRequest,
	ProductVideoVisualPreviewFrame,
	ProductVideoVisualProjectBinThumbnail,
	ProductVideoVisualProjectBinThumbnailRequest,
	ProductVideoVisualPreviewSession,
} from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { normalizeVideoMaskMatteGraphV1 } from '../common/editor/video-mask-matte-v24.ts';
import { normalizeVideoVisualPresentationV1 } from '../common/editor/video-visual-presentation-v27.ts';
import {
	normalizeVideoGeneratorClipV1,
	normalizeVideoGeneratorSourceV1,
	normalizeVideoStillClipV1,
	normalizeVideoStillSourceV1,
} from '../common/editor/video-visual-model-v24.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV27 } from './editor-project-unified-render-plan-v27.ts';
import { createFramescaperSelectedExactPreviewV27 } from './editor-selected-v27-exact-preview.ts';
import {
	assertFramescaperProjectV27Profile,
} from './editor-project-runtime-profile-v27.ts';
import {
	validateFramescaperProjectV27,
} from './editor-project-v27.ts';

type Data = Readonly<Record<string, unknown>>;

export interface FramescaperSelectedVisualPreviewOptionsV27
	extends ProductVideoVisualPreviewCreateRequest {
	readonly profile: unknown;
	readonly store: AudioEditorProjectStore;
}

export interface FramescaperSelectedProjectBinThumbnailOptionsV27
	extends ProductVideoVisualProjectBinThumbnailRequest {
	readonly profile: unknown;
	readonly store: AudioEditorProjectStore;
}

interface DrawableVideo {
	readonly drawable: HTMLCanvasElement;
	readonly videoWidth: number;
	readonly videoHeight: number;
	readonly readyState: 4;
	readonly currentTime: 0;
	pause(): void;
}

/** Build the selected plan and every static drawable before publishing a preview session. */
export async function createFramescaperSelectedVisualPreviewSessionV27(
	options: FramescaperSelectedVisualPreviewOptionsV27,
): Promise<ProductVideoVisualPreviewSession | null> {
	assertFramescaperProjectV27Profile(options?.profile);
	validateFramescaperProjectV27(options.profile, options?.project);
	const project = record(options.project, 'Selected V27 visual preview project');
	if (!hasExecutableVisualState(project)) return null;
	const canvas = previewCanvas(options.width, options.height);
	const timingViews = previewTimingViews(project);
	const plan = createPreviewPlan(options.profile, project, canvas, timingViews);
	const consumer = createUnifiedExactRenderVisualPreviewConsumerV13(
		plan, previewTimingSidecars(project, timingViews),
	);
	const abort = new AbortController();
	const drawables = await materializeDrawables(
		plan, consumer, options.store, canvas, abort.signal,
	);
	const exact = await createFramescaperSelectedExactPreviewV27({
		profile: options.profile,
		project: options.project as never, plan, store: options.store, timingViews,
		boundTimingViews: previewTimingSidecars(project, timingViews), signal: abort.signal,
		assertCurrent() { if (abort.signal.aborted) throw abort.signal.reason; },
	});
	const effectsById = exactEffectsById(plan);
	let disposed = false;
	let cachedSample = -1;
	let cached: ReturnType<typeof consumer.resolveFrame> | null = null;
	const resolve = (timelineSample: number) => {
		if (disposed) throw new Error('The selected V27 visual preview session is disposed.');
		const sample = timelinePosition(timelineSample);
		if (sample !== cachedSample) {
			cached = consumer.resolveFrame({
				sequencePosition: sequencePosition(plan, sample),
			});
			cachedSample = sample;
		}
		return cached!;
	};
	const publish = (timelineSample: number): ProductVideoVisualPreviewFrame => {
		const frame = resolve(timelineSample);
		return Object.freeze({
				layers: Object.freeze(frame.layers.flatMap((layer) => layer.entries.map((entry) => {
					const video = drawables.get(entry.modelId);
					if (!video) throw new ReferenceError(`V13 visual drawable ${entry.modelId} is unavailable.`);
					return Object.freeze({
						trackId: layer.trackId,
						trackIndex: layer.sequenceOrder,
						blendMode: entry.blendMode,
						entries: Object.freeze([visualCompositorEntry(entry, video, canvas)]),
					});
				}))),
				adjustments: Object.freeze(frame.activeAdjustmentLayers.map((adjustment) => Object.freeze({
					nodeId: adjustment.nodeId,
					targetTrackIds: adjustment.targetTrackIds,
					effects: Object.freeze(adjustment.effectIds.map((effectId) => {
						const effect = effectsById.get(effectId);
						if (!effect) throw new ReferenceError(`V13 adjustment effect ${effectId} is unavailable.`);
						return effect;
					})),
					opacity: adjustment.opacity,
					blendMode: adjustment.blendMode,
					maskIds: Object.freeze(adjustment.masks.map(({ id }) => id)),
				}))),
				activeFreezeNodeIds: frame.activeFreezeNodeIds,
				availablePresetIds: frame.availablePresetIds,
				ledger: frame.ledger,
			});
	};
	return Object.freeze({
		resolve: publish,
		resolveTransitionWeight(clipId: string, timelineSample: number): number | null {
			if (typeof clipId !== 'string' || !clipId) throw new TypeError('A transition clip ID is required.');
			return resolve(timelineSample).transitionWeights.find((weight) => weight.clipId === clipId)?.weight ?? null;
		},
		async renderExact(request: Readonly<{
			readonly timelineSample: number;
			readonly mediaLayers: readonly unknown[];
		}>) {
			const frame = publish(request.timelineSample);
			return exact.render({ ...request, frame });
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			abort.abort(new DOMException('The V13 preview session was disposed.', 'AbortError'));
			exact.dispose();
			drawables.clear();
		},
	});
}

/** Materialize a Project Bin visual through the same admitted V13 presentation/materializer path. */
export async function createFramescaperSelectedProjectBinThumbnailV27(
	options: FramescaperSelectedProjectBinThumbnailOptionsV27,
): Promise<ProductVideoVisualProjectBinThumbnail | null> {
	assertFramescaperProjectV27Profile(options?.profile);
	validateFramescaperProjectV27(options.profile, options?.project);
	const project = record(options.project, 'Selected V27 Project Bin thumbnail project');
	const projectBin = record(project.projectBin, 'Selected V27 Project Bin');
	const clipId = stableId(options.clipId, 'Project Bin visual clip ID');
	const clip = records(projectBin.clips, 'Selected V27 Project Bin clips')
		.find((candidate) => candidate.id === clipId);
	if (!clip || (clip.kind !== 'still' && clip.kind !== 'generator')) return null;
	const source = records(project.sources, 'Selected V27 sources')
		.find((candidate) => candidate.id === clip.sourceId);
	if (!source || source.kind !== clip.kind) {
		throw new ReferenceError(`Project Bin visual ${clipId} has no matching source.`);
	}
	const authoredState: UnifiedExactRenderVisualNode['authoredState'] = clip.kind === 'still'
		? Object.freeze({ source: normalizeVideoStillSourceV1(source), clip: normalizeVideoStillClipV1(clip) })
		: Object.freeze({ source: normalizeVideoGeneratorSourceV1(source), clip: normalizeVideoGeneratorClipV1(clip) });
	const masks = records(project.videoMaskMattes, 'Selected V27 masks')
		.map(normalizeVideoMaskMatteGraphV1);
	const presentation = resolveUnifiedExactRenderVisualPresentationV13(
		records(project.videoVisualPresentations, 'Selected V27 visual presentations')
			.map(normalizeVideoVisualPresentationV1),
		{ modelId: clipId, authoredState },
		new Map(masks.map((mask) => [mask.id, mask])),
	);
	const modelKind = projectBinModelKind(source);
	const entry: UnifiedExactRenderVisualFrameEntryV13 = Object.freeze({
		nodeId: `project-bin:${clipId}`, modelId: clipId, modelKind,
		trackId: 'project-bin', authoredState,
		opacity: presentation.opacity, blendMode: presentation.blendMode,
		masks: presentation.masks,
	});
	const signal = options.signal ?? new AbortController().signal;
	const frame = await materializeUnifiedExactRenderVisualEntryV13(entry, {
		targetWidth: positiveInteger(options.width, 'Project Bin thumbnail width'),
		targetHeight: positiveInteger(options.height, 'Project Bin thumbnail height'),
		decodeStill: (still) => decodeStill(options.store, still.storageKey, still.contentSha256, signal),
		signal,
	});
	const pixels = frame.pixels.slice() as Uint8Array<ArrayBuffer>;
	if (presentation.opacity !== 1) for (let index = 3; index < pixels.length; index += 4) {
		pixels[index] = Math.round(pixels[index]! * presentation.opacity);
	}
	return Object.freeze({
		clipId, sourceId: stableId(source.id, 'Project Bin visual source ID'),
		width: frame.width, height: frame.height, pixels,
		opacity: presentation.opacity, blendMode: presentation.blendMode,
		presentationIds: presentation.presentationIds,
		maskIds: Object.freeze(presentation.masks.map(({ id }) => id)),
	});
}

function createPreviewPlan(
	profile: unknown,
	project: Data,
	canvas: Readonly<{ width: number; height: number }>,
	timingViews: ReadonlyMap<string, VideoSourceTimingView>,
): UnifiedExactRenderPlanV13 {
	const sequence = primarySequence(project);
	const rate = rational(sequence.rate, 'Selected V27 sequence rate');
	const sampleRate = positiveInteger(project.sampleRate, 'Selected V27 sample rate');
	const maximumFrame = records(project.clips, 'Selected V27 clips').reduce((maximum, clip) => (
		clip.sequenceId === sequence.id && ['video', 'still', 'generator'].includes(String(clip.kind))
			? Math.max(maximum, safeEnd(clip)) : maximum
	), 0);
	if (maximumFrame < 1) throw new RangeError('Selected V27 visual preview requires a non-empty picture range.');
	const sampleDuration = sequenceFrameBoundarySample(maximumFrame, rate, sampleRate);
	return createFramescaperProjectUnifiedExactRenderPlanV27(profile, project, {
		sequenceId: stableId(sequence.id, 'Selected V27 sequence ID'),
		sampleStart: 0,
		sampleDuration,
		outputRate: rate,
		format: { container: 'mp4', extension: 'mp4', mimeType: 'video/mp4' },
		codecs: {
			video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null,
			pixelFormat: 'yuv420p',
		},
		canvas: { ...canvas, fit: 'contain', pixelFormat: 'yuv420p', backgroundColor: '#000000' },
		quality: 'balanced',
		includeAudio: false,
		audioLayout: null,
		timingViews,
		visualFreshnessByModelId: previewVisualFreshness(project, stableId(sequence.id, 'sequence ID'), canvas),
	});
}

function previewTimingSidecars(
	project: Data,
	timingViews: ReadonlyMap<string, VideoSourceTimingView>,
): ReadonlyMap<string, BoundVideoSourceTimingView> {
	return new Map(records(project.sources, 'Selected V27 sources').flatMap((source) => {
		if (source.kind !== 'video') return [];
		const sourceId = stableId(source.id, 'Selected V27 video source ID');
		return [[sourceId, bindVideoSourceTimingView(timingViews, source)] as const];
	}));
}

function previewTimingViews(project: Data): ReadonlyMap<string, VideoSourceTimingView> {
	const result = new Map<string, VideoSourceTimingView>();
	for (const source of records(project.sources, 'Selected V27 sources')) {
		if (source.kind !== 'video') continue;
		const sourceId = stableId(source.id, 'Selected V27 video source ID');
		const decision = record(source.timingDecision, `Video source ${sourceId} timing decision`);
		if (decision.mode === 'conform-cfr-at-ingest') {
			result.set(sourceId, Object.freeze({
				kind: 'cfr',
				rate: rational(source.frameRate, `Video source ${sourceId} frame rate`),
				frameCount: positiveInteger(source.sourceFrameCount, `Video source ${sourceId} frame count`),
			}));
			continue;
		}
		if (decision.mode !== 'exact' || source.timingAsset == null) {
			throw new RangeError(`Video source ${sourceId} has no executable timing decision.`);
		}
		const index = registeredVideoTimingIndex(source);
		if (!index) throw new Error(`Video source ${sourceId} exact timing is not loaded for preview.`);
		result.set(sourceId, Object.freeze({
			kind: 'vfr',
			reference: source.timingAsset as never,
			index: index as never,
		}));
	}
	return result;
}

function previewVisualFreshness(
	project: Data,
	sequenceId: string,
	canvas: Readonly<{ width: number; height: number }>,
): ReadonlyMap<string, VideoFreezeFreshnessInputV1> {
	const sources = new Map(records(project.sources, 'Selected V27 sources')
		.map((source) => [stableId(source.id, 'source ID'), source]));
	const states = new Map<string, unknown>();
	for (const clip of records(project.clips, 'Selected V27 clips')) {
		if (clip.sequenceId !== sequenceId || (clip.kind !== 'still' && clip.kind !== 'generator')) continue;
		const source = sources.get(stableId(clip.sourceId, 'visual source ID'));
		if (!source) throw new ReferenceError('Selected V27 visual source is unavailable.');
		states.set(stableId(clip.id, 'visual clip ID'), Object.freeze({ source, clip }));
	}
	for (const value of records(project.videoAdjustmentLayers, 'Selected V27 adjustments')) {
		if (value.sequenceId === sequenceId) states.set(stableId(value.id, 'adjustment ID'), value);
	}
	for (const value of records(project.videoVisualPresets, 'Selected V27 presets')) {
		states.set(stableId(value.id, 'preset ID'), value);
	}
	for (const value of records(project.videoMaskMattes, 'Selected V27 masks')) {
		states.set(stableId(value.id, 'mask ID'), value);
	}
	for (const fallback of records(project.videoFreezeFallbacks, 'Selected V27 freezes')) {
		const sourceId = stableId(fallback.renderedSourceId, 'freeze source ID');
		const state = Object.freeze({
			schemaVersion: 1, kind: 'video-freeze', renderedSourceId: sourceId,
		});
		states.set(`video-freeze:${sourceId}`, Object.freeze({
			state,
			fallback,
		}));
	}
	return new Map([...states].map(([modelId, rawState]) => {
		const freeze = modelId.startsWith('video-freeze:')
			? record(rawState, `freeze freshness ${modelId}`) : null;
		const state = freeze === null ? rawState : freeze.state;
		const fallback = freeze === null ? null : record(freeze.fallback, `freeze fallback ${modelId}`);
		const authoredStateSha256 = fingerprintNativeMediaPlan(state).sha256;
		return [modelId, Object.freeze({
			authoredStateSha256,
			inputIdentitiesSha256: fallback?.authoredStateSha256 === authoredStateSha256
				? digest(fallback.inputIdentitiesSha256, 'freeze input identities')
				: fingerprintNativeMediaPlan({ modelId, state }).sha256,
			renderPlanFingerprintSha256: fallback?.authoredStateSha256 === authoredStateSha256
				? digest(fallback.renderPlanFingerprintSha256, 'freeze render plan')
				: fingerprintNativeMediaPlan({ sequenceId, canvas, modelId }).sha256,
			nativeEffectFingerprintSha256: fallback?.authoredStateSha256 === authoredStateSha256
				? digest(fallback.nativeEffectFingerprintSha256, 'freeze native effects')
				: fingerprintNativeMediaPlan({ nativeEffects: [] }).sha256,
		})] as const;
	}));
}

async function materializeDrawables(
	plan: UnifiedExactRenderPlanV13,
	consumer: ReturnType<typeof createUnifiedExactRenderVisualPreviewConsumerV13>,
	store: AudioEditorProjectStore,
	canvas: Readonly<{ width: number; height: number }>,
	signal: AbortSignal,
): Promise<Map<string, DrawableVideo>> {
	const drawables = new Map<string, DrawableVideo>();
	for (const node of plan.nodes) {
		if (node.kind !== 'visual' || node.placement === null || !('source' in node.authoredState)) continue;
		const track = plan.tracks.find(({ trackId }) => trackId === node.placement?.trackId);
		const soloed = plan.tracks.some(({ solo }) => solo);
		if (!track || (soloed ? !track.solo : track.hidden)) continue;
		const entry = consumer.resolveFrame({ sequencePosition: node.authoredState.clip.sequenceStartFrame })
			.layers.flatMap(({ entries }) => entries).find(({ modelId }) => modelId === node.modelId);
		if (!entry) throw new ReferenceError(`Active V13 visual ${node.modelId} was not resolved.`);
		const size = previewSourceSize(node, canvas);
		const frame = await materializeUnifiedExactRenderVisualEntryV13(entry, {
			targetWidth: size.width,
			targetHeight: size.height,
			decodeStill: (source) => decodeStill(store, source.storageKey, source.contentSha256, signal),
			signal,
		});
		drawables.set(node.modelId, rgbaDrawable(frame));
	}
	return drawables;
}

function visualCompositorEntry(
	entry: UnifiedExactRenderVisualFrameEntryV13,
	video: DrawableVideo,
	canvas: Readonly<{ width: number; height: number }>,
): Readonly<Record<string, unknown>> {
	const source = 'source' in entry.authoredState ? entry.authoredState.source : null;
	return Object.freeze({
		kind: entry.modelKind,
		role: 'single',
		clipId: entry.modelId,
		sourceId: source?.id ?? entry.modelId,
		source,
		available: true,
		video,
		effects: Object.freeze([]),
		opacity: entry.opacity,
		displayWidth: video.videoWidth,
		displayHeight: video.videoHeight,
		renderDescription: resolveVideoRenderDescription({
			composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
			sourceDisplaySize: { width: video.videoWidth, height: video.videoHeight },
			canvas,
			opacityStart: entry.opacity,
		}),
	});
}

async function decodeStill(
	store: AudioEditorProjectStore,
	storageKey: string,
	expectedSha256: string,
	signal: AbortSignal,
): Promise<UnifiedExactRenderVisualRgbaV13> {
	if (typeof globalThis.createImageBitmap !== 'function' || !globalThis.document?.createElement) {
		throw new Error('Selected V27 still preview requires browser image decode.');
	}
	const blob = await store.loadMediaAsset(storageKey, { signal });
	if (!(blob instanceof Blob)) throw new Error(`Selected V27 still ${storageKey} is unavailable.`);
	if (await digestMediaContent(blob) !== expectedSha256) {
		throw new RangeError(`Selected V27 still ${storageKey} failed content authentication.`);
	}
	const bitmap = await globalThis.createImageBitmap(blob);
	try {
		const canvas = globalThis.document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context) throw new Error('Selected V27 still decode has no 2D context.');
		context.drawImage(bitmap, 0, 0);
		const image = context.getImageData(0, 0, canvas.width, canvas.height);
		return Object.freeze({
			width: canvas.width,
			height: canvas.height,
			pixels: new Uint8Array(image.data) as Uint8Array<ArrayBuffer>,
		});
	} finally { bitmap.close(); }
}

function rgbaDrawable(frame: UnifiedExactRenderVisualRgbaV13): DrawableVideo {
	if (!globalThis.document?.createElement) throw new Error('V13 preview drawable requires a document.');
	const canvas = globalThis.document.createElement('canvas');
	canvas.width = frame.width;
	canvas.height = frame.height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('V13 preview drawable has no 2D context.');
	context.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
	return Object.freeze({
		drawable: canvas,
		videoWidth: frame.width,
		videoHeight: frame.height,
		readyState: 4 as const,
		currentTime: 0 as const,
		pause() {},
	});
}

function exactEffectsById(plan: UnifiedExactRenderPlanV13): ReadonlyMap<string, unknown> {
	const effects = new Map<string, unknown>();
	for (const node of plan.nodes) {
		if (node.kind !== 'clip') continue;
		for (const effect of node.pictureState.videoEffects) {
			if (effects.has(effect.id)) throw new RangeError(`V13 video effect ${effect.id} is ambiguous.`);
			effects.set(effect.id, effect);
		}
	}
	return effects;
}

function previewSourceSize(
	node: UnifiedExactRenderVisualNode,
	canvas: Readonly<{ width: number; height: number }>,
): Readonly<{ width: number; height: number }> {
	if (!('source' in node.authoredState)) throw new TypeError('A placed visual node is required.');
	const source = node.authoredState.source;
	const scale = Math.min(1, canvas.width / source.width, canvas.height / source.height);
	return Object.freeze({
		width: Math.max(1, Math.round(source.width * scale)),
		height: Math.max(1, Math.round(source.height * scale)),
	});
}

function sequencePosition(plan: UnifiedExactRenderPlanV13, sample: number) {
	const rate = plan.timebase.sequenceRate;
	return multiplyDivideRationals(
		sample,
		rate.num,
		positiveInteger(plan.timebase.sampleRate, 'V13 sample rate') * rate.den,
	);
}

function primarySequence(project: Data): Data {
	const id = stableId(project.primarySequenceId, 'Selected V27 primary sequence ID');
	const sequence = records(project.sequences, 'Selected V27 sequences').find((candidate) => candidate.id === id);
	if (!sequence) throw new ReferenceError(`Selected V27 primary sequence ${id} is unavailable.`);
	return sequence;
}

function hasExecutableVisualState(project: Data): boolean {
	if (records(project.clips, 'Selected V27 clips').some(({ kind }) => (
		kind === 'video' || kind === 'still' || kind === 'generator'
	))) return true;
	if (records(project.videoAdjustmentLayers, 'Selected V27 adjustments').length > 0
		|| records(project.videoFreezeFallbacks, 'Selected V27 freezes').length > 0) return true;
	return records(project.tracks, 'Selected V27 tracks').some((track) => (
		Array.isArray(track.videoTransitions) && track.videoTransitions.length > 0
	));
}

function projectBinModelKind(source: Data): UnifiedExactRenderVisualNode['modelKind'] {
	if (source.kind === 'still') return 'still';
	const generator = record(source.generator, 'Project Bin generator document');
	if (!['title', 'text', 'shape', 'solid'].includes(String(generator.kind))) {
		throw new RangeError('Dormant external generators have no Project Bin thumbnail.');
	}
	return generator.kind as UnifiedExactRenderVisualNode['modelKind'];
}

function previewCanvas(widthValue: number, heightValue: number): Readonly<{ width: number; height: number }> {
	const even = (value: number, name: string) => {
		const dimension = positiveInteger(value, name);
		return Math.max(2, dimension - dimension % 2);
	};
	return Object.freeze({ width: even(widthValue, 'preview width'), height: even(heightValue, 'preview height') });
}

function safeEnd(clip: Data): number {
	const start = nonNegativeInteger(clip.sequenceStartFrame, 'clip sequence start');
	const count = positiveInteger(clip.sequenceFrameCount, 'clip sequence duration');
	if (!Number.isSafeInteger(start + count)) throw new RangeError('Clip sequence range overflows.');
	return start + count;
}

function timelinePosition(value: unknown): number {
	return nonNegativeInteger(value, 'preview timeline sample');
}

function rational(value: unknown, name: string): Readonly<{ num: number; den: number }> {
	const input = record(value, name);
	return Object.freeze({
		num: positiveInteger(input.num, `${name} numerator`),
		den: positiveInteger(input.den, `${name} denominator`),
	});
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
		throw new TypeError(`${name} must be a stable ID.`);
	}
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function record(value: unknown, name: string): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Data;
}

function records(value: unknown, name: string): Data[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError(`${name} must be a lowercase SHA-256 digest.`);
	}
	return value;
}
