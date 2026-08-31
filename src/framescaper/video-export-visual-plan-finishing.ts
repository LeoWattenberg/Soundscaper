/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProductVideoExportPlan,
	ProductVideoExportStrategyPlanRequest,
} from '../common/editor/controller/product-video-export-strategy.ts';
import { compareCodeUnits } from '../common/editor/code-unit-order.ts';
import { sequenceFrameBoundarySample } from '../common/editor/sequence-frame-navigation.ts';
import { normalizeVideoDeliveryAudioLayout } from '../common/editor/video-delivery-audio-layout.ts';
import { normalizeVideoDeliveryColor } from '../common/editor/video-delivery-color.ts';
import { normalizeVideoDeliveryQuality } from '../common/editor/video-delivery-quality.ts';
import { isVideoCanvasFit, VIDEO_CANVAS_MAXIMUM_EXTENT } from '../common/editor/video-canvas-fit.ts';
import { getVideoExportFormat } from '../common/editor/video-export.js';
import { createVisibleVideoTrackPredicate } from '../common/editor/video-track-visibility.js';
import { compareRationals, normalizeRational, type Rational } from '../common/editor/timeline-time.ts';
import type { FramescaperProjectFinishing } from './editor-project-finishing.ts';

export interface FramescaperVideoVisualPlanFinishing extends ProductVideoExportPlan {
	readonly version: 13;
	readonly strategy: 'framescaper-visual-rgba';
	readonly sampleRate: number;
	readonly quality: ReturnType<typeof normalizeVideoDeliveryQuality>;
	readonly audioLayout: ReturnType<typeof normalizeVideoDeliveryAudioLayout>;
	readonly canvas: Readonly<{
		readonly width: number;
		readonly height: number;
		readonly frameRate: Rational;
		readonly fit: 'contain' | 'cover' | 'stretch';
		readonly pixelFormat: 'yuv420p';
		readonly backgroundColor: string;
	}>;
}

/** Build a detached exact output clock for a timeline whose active picture is product-owned. */
export function createFramescaperVideoVisualPlanFinishing(
	project: FramescaperProjectFinishing,
	request: ProductVideoExportStrategyPlanRequest,
): FramescaperVideoVisualPlanFinishing {
	const sampleRate = positiveInteger(project.sampleRate, 'finishing visual project sample rate');
	const sequence = primarySequence(project);
	const sequenceRate = rate(sequence.rate, 'finishing visual sequence rate');
	const projectRange = visualProjectRange(project, sequence, sampleRate, sequenceRate);
	const range = requestedRange(project, request.range, projectRange);
	if (range.durationFrames < 1) throw new RangeError('finishing visual export range must contain picture time.');
	const placements = activeVisualPlacements(project, sequence, range, sampleRate, sequenceRate);
	if (placements.length < 1) throw new RangeError('finishing visual export range has no active still or generator.');
	const canvas = visualCanvas(request.canvas, placements[0]!.source, sequenceRate);
	const format = getVideoExportFormat(request.format) as Readonly<{
		id: 'mp4' | 'webm'; extension: 'mp4' | 'webm'; mimeType: 'video/mp4' | 'video/webm';
	}>;
	const activeStillSources = unique(placements.flatMap(({ source }) => source.kind === 'still'
		? [source] : []), (source) => String(source.id));
	const inputs: Readonly<Record<string, unknown>>[] = activeStillSources.map((source, inputIndex) => (
		Object.freeze({
			kind: 'still-source', inputIndex, sourceId: source.id,
			storageKey: source.storageKey, contentSha256: source.contentSha256,
		})
	));
	const audioLayout = normalizeVideoDeliveryAudioLayout(
		request.audioLayout, 'finishing visual export audio layout',
	);
	if (request.includeAudio) inputs.push(Object.freeze({
		kind: 'staged-audio-mix', channelLayout: audioLayout,
	}));
	return Object.freeze({
		version: 13 as const,
		strategy: 'framescaper-visual-rgba' as const,
		format: format.id,
		extension: format.extension,
		mimeType: format.mimeType,
		sampleRate,
		range,
		canvas,
		quality: normalizeVideoDeliveryQuality(request.quality, 'finishing visual export quality'),
		audioLayout,
		inputs: Object.freeze(inputs),
		// Still/generator materialization owns no decoded video input; complete
		// timing closure is captured separately by the product strategy.
		activeSourceIds: Object.freeze([]),
	});
}

export function isFramescaperVideoVisualPlanFinishing(
	value: ProductVideoExportPlan,
): value is FramescaperVideoVisualPlanFinishing {
	return value.version === 13 && value.strategy === 'framescaper-visual-rgba';
}

function visualProjectRange(
	project: FramescaperProjectFinishing,
	sequence: Readonly<Record<string, unknown>>,
	sampleRate: number,
	sequenceRate: Rational,
) {
	const trackIds = new Set(strings(sequence.trackIds, 'finishing sequence track IDs'));
	const clipIds = new Set(records(project.tracks, 'finishing visual tracks')
		.filter((track) => trackIds.has(String(track.id)))
		.flatMap((track) => strings(track.clipIds, 'finishing visual track clip IDs')));
	// Playback plays every clip on the timeline, so the 'project' range must
	// cover every clip too — matching the keyed route's shared resolver. A
	// range from stills and generators alone would silently cut the audio
	// tail out of the delivered file.
	let endFrame = 0;
	for (const clip of records(project.clips, 'finishing visual clips')) {
		if (!clipIds.has(String(clip.id))) continue;
		if (clip.kind === 'audio') {
			endFrame = Math.max(endFrame, positiveSum(
				clip.timelineStartFrame, clip.durationFrames, 'finishing audio clip range',
			));
			continue;
		}
		if (clip.kind !== 'still' && clip.kind !== 'generator' && clip.kind !== 'video') continue;
		endFrame = Math.max(endFrame, sequenceFrameBoundarySample(
			positiveSum(clip.sequenceStartFrame, clip.sequenceFrameCount, 'finishing visual clip range'),
			sequenceRate, sampleRate,
		));
	}
	return Object.freeze({ startFrame: 0, endFrame, durationFrames: endFrame });
}

function requestedRange(
	project: FramescaperProjectFinishing,
	value: unknown,
	projectRange: Readonly<{ startFrame: number; endFrame: number; durationFrames: number }>,
) {
	let startFrame: unknown;
	let endFrame: unknown;
	if (value === undefined || value === 'project') return projectRange;
	if (value === 'selection') ({ startFrame, endFrame } = record(project.selection, 'finishing selection'));
	else if (value === 'loop') {
		const loop = record(project.loop, 'finishing loop');
		if (loop.enabled !== true) throw new RangeError('The finishing visual export loop is not enabled.');
		({ startFrame, endFrame } = loop);
	} else {
		const rangeValue = record(value, 'finishing visual export range');
		if (Reflect.ownKeys(rangeValue).length !== 2) {
			throw new TypeError('finishing visual export range requires exactly startFrame and endFrame.');
		}
		({ startFrame, endFrame } = rangeValue);
	}
	const start = nonNegativeInteger(startFrame, 'finishing visual export range start');
	const end = nonNegativeInteger(endFrame, 'finishing visual export range end');
	if (end <= start) throw new RangeError('finishing visual export range must be positive.');
	return Object.freeze({ startFrame: start, endFrame: end, durationFrames: end - start });
}

function activeVisualPlacements(
	project: FramescaperProjectFinishing,
	sequence: Readonly<Record<string, unknown>>,
	rangeValue: Readonly<{ startFrame: number; endFrame: number }>,
	sampleRate: number,
	sequenceRate: Rational,
) {
	const clips = new Map(records(project.clips, 'finishing visual clips')
		.map((clip) => [String(clip.id), clip]));
	const sources = new Map(records(project.sources, 'finishing visual sources')
		.map((source) => [String(source.id), source]));
	const sequenceTrackIds = strings(sequence.trackIds, 'finishing sequence track IDs');
	const sequenceTrackIndex = new Map(sequenceTrackIds.map((id, index) => [id, index]));
	const tracks = records(project.tracks, 'finishing visual tracks');
	const visible = createVisibleVideoTrackPredicate(tracks);
	const result: Array<Readonly<{
		clip: Readonly<Record<string, unknown>>;
		source: Readonly<Record<string, unknown>>;
		sequenceStartFrame: number;
		trackIndex: number;
	}>> = [];
	for (const track of tracks) {
		const trackIndex = sequenceTrackIndex.get(String(track.id));
		if (trackIndex === undefined || !visible(track)) continue;
		for (const clipId of strings(track.clipIds, 'finishing visual track clip IDs')) {
			const clip = clips.get(String(clipId));
			if (!clip || (clip.kind !== 'still' && clip.kind !== 'generator')) continue;
			const sequenceStartFrame = nonNegativeInteger(
				clip.sequenceStartFrame,
				'finishing visual clip start',
			);
			const start = sequenceFrameBoundarySample(
				sequenceStartFrame,
				sequenceRate, sampleRate,
			);
			const end = sequenceFrameBoundarySample(
				positiveSum(clip.sequenceStartFrame, clip.sequenceFrameCount, 'finishing visual clip range'),
				sequenceRate, sampleRate,
			);
			if (start >= rangeValue.endFrame || end <= rangeValue.startFrame) continue;
			const source = sources.get(String(clip.sourceId));
			if (!source || source.kind !== clip.kind) throw new ReferenceError('finishing visual clip source is unavailable.');
			result.push(Object.freeze({ clip, source, sequenceStartFrame, trackIndex }));
		}
	}
	return result.sort((left, right) => left.sequenceStartFrame - right.sequenceStartFrame
		|| left.trackIndex - right.trackIndex
		|| compareCodeUnits(String(left.clip.id), String(right.clip.id)));
}

function visualCanvas(value: unknown, source: Readonly<Record<string, unknown>>, sequenceRate: Rational) {
	const request = value === undefined ? {} : record(value, 'finishing visual export canvas');
	const maximumWidth = optionalPositive(request.maximumWidth, 1_280, 'canvas.maximumWidth');
	const maximumHeight = optionalPositive(request.maximumHeight, 720, 'canvas.maximumHeight');
	const statedSize = request.size === undefined ? null : record(request.size, 'canvas.size');
	const sourceWidth = optionalPositive(request.width, positiveInteger(source.width, 'visual source width'), 'canvas.width');
	const sourceHeight = optionalPositive(request.height, positiveInteger(source.height, 'visual source height'), 'canvas.height');
	const scale = Math.min(1, maximumWidth / sourceWidth, maximumHeight / sourceHeight);
	const width = evenExtent(statedSize?.width ?? Math.max(2, Math.floor(sourceWidth * scale / 2) * 2), 'canvas.width');
	const height = evenExtent(statedSize?.height ?? Math.max(2, Math.floor(sourceHeight * scale / 2) * 2), 'canvas.height');
	const maximumRate = positiveRate(request.maximumFrameRate ?? { num: 30, den: 1 }, 'canvas.maximumFrameRate');
	const statedRate = request.frameRate === undefined ? null : positiveRate(request.frameRate, 'canvas.frameRate');
	const frameRate = statedRate ?? (compareRationals(sequenceRate, maximumRate) > 0 ? maximumRate : sequenceRate);
	const fit = request.fit ?? 'contain';
	if (!isVideoCanvasFit(fit)) throw new RangeError('finishing visual export canvas fit is unsupported.');
	return Object.freeze({
		width, height, frameRate, fit, pixelFormat: 'yuv420p' as const,
		backgroundColor: normalizeVideoDeliveryColor(
			request.backgroundColor ?? '#000000', 'canvas.backgroundColor',
		),
	});
}

function primarySequence(project: FramescaperProjectFinishing): Readonly<Record<string, unknown>> {
	const sequence = records(project.sequences, 'finishing visual sequences')
		.find(({ id }) => id === project.primarySequenceId);
	if (!sequence) throw new ReferenceError('finishing visual export primary sequence is unavailable.');
	return sequence as unknown as Readonly<Record<string, unknown>>;
}

function positiveRate(value: unknown, name: string): Rational {
	const result = normalizeRational(value as never);
	if (result.num <= 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function rate(value: unknown, name: string): Rational { return positiveRate(value, name); }

function evenExtent(value: unknown, name: string): number {
	const result = positiveInteger(value, name);
	if (result % 2 !== 0 || result > VIDEO_CANVAS_MAXIMUM_EXTENT) {
		throw new RangeError(`${name} must be an even bounded extent.`);
	}
	return result;
}

function optionalPositive(value: unknown, fallback: number, name: string): number {
	return value === undefined ? fallback : positiveInteger(value, name);
}

function positiveSum(left: unknown, right: unknown, name: string): number {
	const result = nonNegativeInteger(left, name) + positiveInteger(right, name);
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} overflows.`);
	return result;
}

function positiveInteger(value: unknown, name: string): number {
	const result = nonNegativeInteger(value, name);
	if (result < 1) throw new RangeError(`${name} must be positive.`);
	return result;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function strings(value: unknown, name: string): readonly string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
		throw new TypeError(`${name} must be an ID array.`);
	}
	return value;
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Readonly<Record<string, unknown>>;
}

function records(value: unknown, name: string): Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}

function unique<Value>(values: readonly Value[], key: (value: Value) => string): readonly Value[] {
	return [...new Map(values.map((value) => [key(value), value])).values()];
}
