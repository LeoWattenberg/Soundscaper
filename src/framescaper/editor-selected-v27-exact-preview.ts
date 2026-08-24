/* SPDX-License-Identifier: AGPL-3.0-only */

import { digestMediaContent } from '../common/editor/storage/media-content-digest.ts';
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import { multiplyDivideRationals } from '../common/editor/timeline-time.ts';
import type { UnifiedExactRenderPlanV13 } from '../common/editor/unified-exact-render-plan.ts';
import { collectProductVideoVisualPreviewEffectIds } from '../common/editor/ui/workspace/product-video-visual-preview-effect-ledger.ts';
import type { ProductVideoVisualPreviewFrame } from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../common/editor/video-clip-composition.ts';
import { createVideoKeyframeExportPresentationAuthority } from '../common/editor/video-keyframe-export-presentation-authority.ts';
import { createVideoRetimeWebCoreOrdinalAuthority } from '../common/editor/video-retime-web-core-ordinal-authority.ts';
import { videoTimelineDurationFrames } from '../common/editor/video-timeline.js';
import { resolveVideoRenderDescription } from '../common/editor/video-render-description.ts';
import type { BoundVideoSourceTimingView, VideoSourceTimingView } from '../common/editor/video-source-timing-view.ts';
import type { FramescaperProjectV27 } from './editor-project-v27.ts';
import {
	createFramescaperSelectedExactFrameExecutionV27,
	type CaptureFrameV27,
} from './selected-v27-exact-frame-execution.ts';
import {
	createFramescaperVideoFrameAddressV27,
	type FramescaperVideoFrameAddressV27,
} from './video-frame-address-v27.ts';

type Data = Readonly<Record<string, unknown>>;

interface PreviewOutputV27 {
	readonly drawable: unknown;
	write(pixels: Uint8Array<ArrayBuffer>): void;
	dispose(): void;
}

export interface FramescaperSelectedExactPreviewV27 {
	render(request: Readonly<{
		readonly timelineSample: number;
		readonly mediaLayers: readonly unknown[];
		readonly frame: ProductVideoVisualPreviewFrame;
	}>): Promise<Readonly<{
		readonly frame: ProductVideoVisualPreviewFrame;
		readonly layers: readonly Data[];
		readonly renderedEffectIds: readonly string[];
	}>>;
	dispose(): void;
}

/** Create the same authenticated per-source V13 route used by selected export. */
export async function createFramescaperSelectedExactPreviewV27(options: Readonly<{
	readonly project: FramescaperProjectV27;
	readonly plan: UnifiedExactRenderPlanV13;
	readonly store: AudioEditorProjectStore;
	readonly timingViews: ReadonlyMap<string, VideoSourceTimingView>;
	readonly boundTimingViews: ReadonlyMap<string, BoundVideoSourceTimingView>;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
	readonly captureFrame?: CaptureFrameV27;
	readonly createOutput?: (width: number, height: number) => PreviewOutputV27;
}>): Promise<FramescaperSelectedExactPreviewV27> {
	const output = (options.createOutput ?? createCanvasOutput)(
		options.plan.output.canvas.width, options.plan.output.canvas.height,
	);
	const publishedLayers = outputLayers(output.drawable, options.plan);
	let sourceFrames: FramescaperVideoFrameAddressV27 | undefined;
	try {
		sourceFrames = await createTemporalSourceFrames(options);
		const exact = await createFramescaperSelectedExactFrameExecutionV27({
			project: options.project, plan: options.plan, store: options.store,
			timingSidecars: options.boundTimingViews,
			...(sourceFrames ? { sourceFrames } : {}),
			...(options.captureFrame ? { captureFrame: options.captureFrame } : {}),
			signal: options.signal, assertCurrent: options.assertCurrent,
		});
		const project = options.project as unknown as Data;
		const clips = new Map(records(project.clips, 'Selected V27 preview clips')
			.filter(({ kind }) => kind === 'video').map((clip) => [String(clip.id), clip]));
		const sources = new Map(records(project.sources, 'Selected V27 preview sources')
			.filter(({ kind }) => kind === 'video').map((source) => [String(source.id), source]));
		// Preview and export are the same render: descriptors resolve through
		// the same exact ordinal oracle the export uses, whose outer cell comes
		// from the point-rounded sequence grid. Resolving from exact frame
		// fractions instead disagrees with export on NTSC boundary samples.
		const presentation = clips.size === 0 ? null : createVideoKeyframeExportPresentationAuthority({
			project, timingBySourceId: options.boundTimingViews,
			exactOrdinalAuthority: createVideoRetimeWebCoreOrdinalAuthority({
				project,
				timingBySourceId: options.boundTimingViews,
				startFrame: 0,
				endFrame: videoTimelineDurationFrames(project),
				outputRate: { num: options.plan.timebase.sampleRate, den: 1 },
			}),
		});
		let disposed = false;
		let active = false;
		let renderIdle = Promise.resolve();
		async function render(
			request: Parameters<FramescaperSelectedExactPreviewV27['render']>[0],
		) {
			if (disposed) throw new Error('The selected V27 exact preview is disposed.');
			if (active) throw new Error('The selected V27 exact preview cannot overlap frames.');
			active = true;
			let markIdle = (): void => undefined;
			renderIdle = new Promise<void>((resolve) => { markIdle = resolve; });
			const target = new Uint8Array(
				options.plan.output.canvas.width * options.plan.output.canvas.height * 4,
			);
			try {
				const sample = timelineSample(request.timelineSample);
				const sequence = sequencePosition(options.plan, sample);
				const layers = enrichMediaLayers(
					request.mediaLayers, sequence, sample, clips, sources, presentation,
				);
				const result = await exact.render({
					sequencePosition: sequence, layers,
					width: options.plan.output.canvas.width,
					height: options.plan.output.canvas.height,
					target, signal: options.signal,
				});
				output.write(target);
				return Object.freeze({
					frame: exactFrameLedger(request.frame, result.consumedNodeIds),
					layers: publishedLayers,
					renderedEffectIds: collectProductVideoVisualPreviewEffectIds(layers, request.frame),
				});
			} catch (error) {
				target.fill(0);
				throw error;
			} finally { active = false; markIdle(); }
		}
		function dispose(): void {
			if (disposed) return;
			disposed = true;
			output.dispose();
			void renderIdle.then(async () => {
				await exact.dispose();
				if (sourceFrames) await sourceFrames.dispose();
			}).catch(() => undefined);
		}
		return Object.freeze({ render, dispose });
	} catch (error) {
		output.dispose();
		if (sourceFrames) await sourceFrames.dispose();
		throw error;
	}
}

function enrichMediaLayers(
	layersValue: readonly unknown[],
	sequencePosition: Readonly<{ num: number; den: number }>,
	timelineSample: number,
	clips: ReadonlyMap<string, Data>,
	sources: ReadonlyMap<string, Data>,
	presentation: ReturnType<typeof createVideoKeyframeExportPresentationAuthority> | null,
): readonly Data[] {
	return Object.freeze(layersValue.map((layerValue, layerIndex) => {
		const layer = record(layerValue, `Selected V27 preview media layer ${String(layerIndex)}`);
		if (!Array.isArray(layer.entries)) throw new TypeError('Selected V27 preview media entries are unavailable.');
		return Object.freeze({
			...layer,
			entries: Object.freeze(layer.entries.map((entryValue, entryIndex) => {
				const entry = record(entryValue, `Selected V27 preview media entry ${String(entryIndex)}`);
				const clipId = stableId(entry.clipId, 'Selected V27 preview clip ID');
				const sourceId = stableId(entry.sourceId, 'Selected V27 preview source ID');
				const clip = required(clips, clipId, 'clip');
				const source = required(sources, sourceId, 'source');
				if (!presentation) throw new ReferenceError('Selected V27 preview presentation authority is unavailable.');
				return Object.freeze({
					...entry,
					presentationDescriptor: presentation.resolvePresentationDescriptor({
						clip, source, localSequencePosition: localPosition(sequencePosition, clip),
						outputOrdinal: timelineSample,
					}),
				});
			})),
		});
	}));
}

async function createTemporalSourceFrames(options: Readonly<{
	project: FramescaperProjectV27;
	plan: UnifiedExactRenderPlanV13;
	store: AudioEditorProjectStore;
	timingViews: ReadonlyMap<string, VideoSourceTimingView>;
	signal: AbortSignal;
	assertCurrent: () => void;
}>): Promise<FramescaperVideoFrameAddressV27 | undefined> {
	const sourceIds = temporalSourceIds(options.project, options.plan);
	if (sourceIds.size === 0) return undefined;
	const project = options.project as unknown as Data;
	const byId = new Map(records(project.sources, 'Selected V27 preview temporal sources')
		.map((source) => [String(source.id), source]));
	const bodies = new Map<string, Blob>();
	for (const sourceId of [...sourceIds].sort(compareText)) {
		options.assertCurrent();
		throwIfAborted(options.signal);
		const source = required(byId, sourceId, 'temporal source');
		const original = await authenticatedBody(
			options.store, String(source.storageKey ?? sourceId), String(source.contentSha256), options.signal,
		);
		const proxy = source.proxyAttachment == null ? null
			: record(source.proxyAttachment, `Selected V27 proxy ${sourceId}`);
		const body = original ?? (proxy === null ? null : await authenticatedBody(
			options.store, String(proxy.storageKey), String(proxy.sha256), options.signal,
		));
		if (!body) throw new Error(`Selected V27 temporal source ${sourceId} is unavailable.`);
		bodies.set(sourceId, body);
	}
	return createFramescaperVideoFrameAddressV27({
		sources: bodies, timingViewsBySourceId: options.timingViews,
	});
}

function temporalSourceIds(
	project: FramescaperProjectV27,
	plan: UnifiedExactRenderPlanV13,
): ReadonlySet<string> {
	const finishing = plan.nodes.find((node) => node.kind === 'finishing');
	if (!finishing) throw new ReferenceError('Selected V27 preview finishing node is unavailable.');
	const stacks = new Map(finishing.processorStacks.map((stack) => [stack.id, stack]));
	const clipSources = new Map(records(
		(project as unknown as Data).clips, 'Selected V27 preview temporal clips',
	).map((clip) => [String(clip.id), String(clip.sourceId)]));
	return new Set(finishing.visualPresentations.flatMap((item) => {
		if (!item.enabled || item.processorStackId === null) return [];
		const stack = stacks.get(item.processorStackId);
		if (!stack?.processors.some((processor) => processor.enabled && processor.kind === 'temporal-denoise')) {
			return [];
		}
		if (item.owner.kind === 'source') return [item.owner.id];
		if (item.owner.kind === 'clip') {
			const sourceId = clipSources.get(item.owner.id);
			if (!sourceId) throw new ReferenceError('Selected V27 temporal clip source is unavailable.');
			return [sourceId];
		}
		throw new Error('Selected V27 temporal processing requires a video source owner.');
	}));
}

async function authenticatedBody(
	store: AudioEditorProjectStore,
	storageKey: string,
	digest: string,
	signal: AbortSignal,
): Promise<Blob | null> {
	const value = await store.loadMediaAsset(storageKey, { signal });
	if (!value) return null;
	const body = value instanceof Blob ? value : new Blob([await value.arrayBuffer()]);
	if (await digestMediaContent(body) !== digest) {
		throw new RangeError(`Selected V27 preview media ${storageKey} failed authentication.`);
	}
	return body;
}

function exactFrameLedger(
	frame: ProductVideoVisualPreviewFrame,
	consumedNodeIds: readonly string[],
): ProductVideoVisualPreviewFrame {
	const requested = new Set([...frame.ledger.requestedNodeIds, ...consumedNodeIds]);
	const consumed = new Set([...frame.ledger.consumedNodeIds, ...consumedNodeIds]);
	const omitted = frame.ledger.omittedNodeIds.filter((nodeId) => !consumed.has(nodeId));
	return Object.freeze({
		...frame,
		ledger: Object.freeze({
			requestedNodeIds: Object.freeze([...requested].sort(compareText)),
			consumedNodeIds: Object.freeze([...consumed].sort(compareText)),
			omittedNodeIds: Object.freeze(omitted),
		}),
	});
}

function outputLayers(drawable: unknown, plan: UnifiedExactRenderPlanV13): readonly Data[] {
	const width = plan.output.canvas.width;
	const height = plan.output.canvas.height;
	return Object.freeze([Object.freeze({
		trackId: 'framescaper-v27-exact-output', trackIndex: 0,
		entries: Object.freeze([Object.freeze({
			kind: 'video', role: 'single', clipId: 'framescaper-v27-exact-output',
			sourceId: 'framescaper-v27-exact-output', available: true,
			video: Object.freeze({ drawable, videoWidth: width, videoHeight: height,
				readyState: 4, currentTime: 0, pause() {} }),
			effects: Object.freeze([]), opacity: 1, displayWidth: width, displayHeight: height,
			renderDescription: resolveVideoRenderDescription({
				composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
				sourceDisplaySize: { width, height }, canvas: { width, height }, opacityStart: 1,
			}),
		})]),
	})]);
}

function createCanvasOutput(width: number, height: number): PreviewOutputV27 {
	if (!globalThis.document?.createElement) throw new Error('Selected V27 exact preview requires a document.');
	const canvas = globalThis.document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Selected V27 exact preview has no 2D output context.');
	return Object.freeze({
		drawable: canvas,
		write(pixels: Uint8Array<ArrayBuffer>) {
			context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
		},
		dispose() { context.clearRect(0, 0, width, height); },
	});
}

function sequencePosition(plan: UnifiedExactRenderPlanV13, sample: number) {
	const rate = plan.timebase.sequenceRate;
	return multiplyDivideRationals(sample, rate.num, plan.timebase.sampleRate * rate.den);
}

function localPosition(position: Readonly<{ num: number; den: number }>, clip: Data) {
	let numerator = BigInt(position.num) - BigInt(nonNegativeInteger(
		clip.sequenceStartFrame, 'Selected V27 preview clip start',
	)) * BigInt(position.den);
	let denominator = BigInt(position.den);
	if (numerator < 0n) throw new RangeError('Selected V27 preview position precedes its clip.');
	let left = numerator;
	let right = denominator;
	while (right !== 0n) [left, right] = [right, left % right];
	numerator /= left;
	denominator /= left;
	return Object.freeze({ num: Number(numerator), den: Number(denominator) });
}

function timelineSample(value: unknown): number {
	return nonNegativeInteger(value, 'Selected V27 preview timeline sample');
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${name} must be an ID.`);
	return value;
}

function required<Value>(values: ReadonlyMap<string, Value>, id: string, name: string): Value {
	const value = values.get(id);
	if (!value) throw new ReferenceError(`Selected V27 preview ${name} ${id} is unavailable.`);
	return value;
}

function record(value: unknown, name: string): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Data;
}

function records(value: unknown, name: string): Data[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason ?? new DOMException('Selected V27 preview was cancelled.', 'AbortError');
}

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
