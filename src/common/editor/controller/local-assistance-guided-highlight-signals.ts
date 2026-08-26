/* SPDX-License-Identifier: AGPL-3.0-only */

/** Project-authoritative, model-free highlight windows and audio dynamics. */

import { reviewAssistanceFloat32MonoWaveV1 } from '../assistance/float32-mono-wave-v1.ts';
import {
	reviewAssistanceAcceptedReframeDerivativeV1,
	type AssistanceAcceptedReframeDerivativeV1,
} from '../assistance/reframe-derivative-v1.ts';
import { scaleSampleFrame } from '../timeline-time.ts';
import {
	validateAssistanceWorkflowSettingsV1,
	type AssistanceWorkflowSettingsV1,
} from '../assistance/workflow-settings-v1.ts';
import type { LocalAssistanceSelectedVideoSourceTimeDescriptorV1 } from
	'./local-assistance-selected-video-source-time.ts';

type HighlightSettings = Extract<AssistanceWorkflowSettingsV1,
	{ readonly workflowId: 'make-highlights' }>;

export interface LocalAssistanceGuidedHighlightWindowV1 {
	readonly id: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly shotStructure: 0;
	readonly visualInterest: number;
}

export interface LocalAssistanceGuidedHighlightVideoSignalsV1 {
	readonly schemaVersion: 1;
	readonly kind: 'highlight-video-signals';
	readonly sourceId: string;
	readonly sampleRate: number;
	readonly timescale: number;
	readonly sourceSize: Readonly<{ readonly width: number; readonly height: number }>;
	readonly videoOccurrenceId: string;
	readonly audioOccurrenceId: string | null;
	readonly selectionStartFrame: number;
	readonly selectionEndFrame: number;
	readonly reframeEvidence: AssistanceAcceptedReframeDerivativeV1 | null;
	readonly sourceTimeAuthority: readonly Readonly<{
		readonly sourceFrame: number;
		readonly presentationTick: string;
		readonly timelineFrame: number;
	}>[];
	readonly windows: readonly LocalAssistanceGuidedHighlightWindowV1[];
}

export interface LocalAssistanceGuidedHighlightAudioSignalsV1 {
	readonly schemaVersion: 1;
	readonly kind: 'highlight-audio-signals';
	readonly signals: readonly Readonly<{
		readonly candidateId: string;
		readonly energyDynamics: number;
	}>[];
}

const AUTHORITY_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'projectId', 'projectRevision', 'sequenceId', 'videoOccurrenceId',
	'sourceId', 'sourceSha256', 'timingAuthoritySha256', 'sourceWidth', 'sourceHeight',
	'sourceStartFrame', 'sourceEndFrame', 'sampleRate', 'timescale', 'selectionStartFrame',
	'selectionEndFrame', 'frames',
] as const);
const FRAME_FIELDS = Object.freeze(['sourceFrame', 'presentationTick', 'timelineFrame'] as const);
const VIDEO_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'sourceId', 'sampleRate', 'timescale', 'sourceSize',
	'videoOccurrenceId', 'audioOccurrenceId', 'selectionStartFrame', 'selectionEndFrame',
	'reframeEvidence', 'sourceTimeAuthority', 'windows',
] as const);
const WINDOW_FIELDS = Object.freeze([
	'id', 'startFrame', 'endFrame', 'shotStructure', 'visualInterest',
] as const);
const MAXIMUM_AUTHORITY_ROWS = 100_000;
const MAXIMUM_WINDOWS = 80;
const MAXIMUM_AUDIO_BYTES = 512 * 1024 * 1024;
const AUDIO_SAMPLE_RATE = 32_000;
const ENERGY_BLOCK_FRAMES = 8_000;
const CANCELLATION_FRAMES = 262_144;
const STABLE_ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const SHA256 = /^[a-f\d]{64}$/u;

export function createLocalAssistanceGuidedHighlightVideoSignalsV1(request: Readonly<{
	readonly authority: LocalAssistanceSelectedVideoSourceTimeDescriptorV1;
	readonly audioOccurrenceId: string | null;
	readonly settings: AssistanceWorkflowSettingsV1;
}>): LocalAssistanceGuidedHighlightVideoSignalsV1 {
	const authority = reviewSourceTimeAuthority(request?.authority);
	const settings = validateAssistanceWorkflowSettingsV1(
		request?.settings, 'make-highlights',
	) as HighlightSettings;
	const audioOccurrenceId = request?.audioOccurrenceId === null ? null
		: stableId(request?.audioOccurrenceId, 'audio occurrence');
	const windows = createWindows(authority, settings);
	return Object.freeze({ schemaVersion: 1, kind: 'highlight-video-signals',
		sourceId: authority.sourceId, sampleRate: authority.sampleRate,
		timescale: authority.timescale,
		sourceSize: Object.freeze({ width: authority.sourceWidth, height: authority.sourceHeight }),
		videoOccurrenceId: authority.videoOccurrenceId, audioOccurrenceId,
		selectionStartFrame: authority.selectionStartFrame,
		selectionEndFrame: authority.selectionEndFrame,
		reframeEvidence: null,
		sourceTimeAuthority: authority.frames,
		windows });
}

export async function createLocalAssistanceGuidedHighlightAudioSignalsV1(request: Readonly<{
	readonly body: Blob;
	readonly video: LocalAssistanceGuidedHighlightVideoSignalsV1;
	readonly signal: AbortSignal;
}>): Promise<LocalAssistanceGuidedHighlightAudioSignalsV1> {
	if (!(request?.signal instanceof AbortSignal)) {
		throw new TypeError('Highlight audio signals require one cancellation signal.');
	}
	request.signal.throwIfAborted();
	const video = reviewVideoSignals(request.video);
	if (!(request.body instanceof Blob) || request.body.type !== 'audio/wav'
		|| request.body.size < 44 || request.body.size > MAXIMUM_AUDIO_BYTES) {
		throw new RangeError('Highlight audio needs one bounded Float32 WAV body.');
	}
	const bytes = new Uint8Array(await request.body.arrayBuffer());
	request.signal.throwIfAborted();
	const wave = reviewAssistanceFloat32MonoWaveV1(bytes, AUDIO_SAMPLE_RATE);
	const duration = video.selectionEndFrame - video.selectionStartFrame;
	const expectedFrames = Number(scaleSampleFrame(
		duration, video.sampleRate, AUDIO_SAMPLE_RATE, 'point',
	));
	if (wave.samples.length !== expectedFrames) {
		throw new RangeError('Highlight audio duration disagrees with exact video selection geometry.');
	}
	const envelope = await rmsEnvelope(wave.samples, request.signal);
	const signals = video.windows.map((window) => Object.freeze({ candidateId: window.id,
		energyDynamics: windowDynamics(window, video, envelope) }));
	return Object.freeze({ schemaVersion: 1, kind: 'highlight-audio-signals',
		signals: Object.freeze(signals) });
}

function createWindows(
	authority: ReturnType<typeof reviewSourceTimeAuthority>,
	settings: HighlightSettings,
): readonly LocalAssistanceGuidedHighlightWindowV1[] {
	const totalFrames = authority.selectionEndFrame - authority.selectionStartFrame;
	const minimumFrames = safeMultiply(authority.sampleRate, settings.minimumDurationSeconds,
		'highlight minimum duration');
	const maximumFrames = safeMultiply(authority.sampleRate, settings.maximumDurationSeconds,
		'highlight maximum duration');
	const available = Math.floor(totalFrames / minimumFrames);
	if (available < 1) return Object.freeze([]);
	const count = Math.min(MAXIMUM_WINDOWS, settings.resultCount * 4, available);
	const targetDuration = Math.min(maximumFrames, Math.max(minimumFrames,
		Math.floor(totalFrames / count)));
	const seen = new Set<string>();
	const windows: LocalAssistanceGuidedHighlightWindowV1[] = [];
	for (let index = 0; index < count; index += 1) {
		const startTarget = count === 1 ? authority.selectionStartFrame
			: authority.selectionStartFrame + Math.round(
				(totalFrames - targetDuration) * index / (count - 1),
			);
		const startIndex = nearestTimelineIndex(authority.frames, startTarget);
		const start = authority.frames[startIndex]!;
		const endIndex = nearestAdmittedEndIndex(authority.frames, startIndex,
			start.timelineFrame + targetDuration, minimumFrames, maximumFrames);
		if (endIndex === null) continue;
		const end = authority.frames[endIndex]!;
		const id = `highlight:${authority.sourceSha256.slice(0, 12)}:${String(start.sourceFrame)}:${
			String(end.sourceFrame)}`;
		if (seen.has(id)) continue;
		seen.add(id);
		windows.push(Object.freeze({ id, startFrame: start.timelineFrame,
			endFrame: end.timelineFrame, shotStructure: 0, visualInterest: 0 }));
	}
	return Object.freeze(windows);
}

function nearestAdmittedEndIndex(
	frames: readonly SourceFrame[],
	startIndex: number,
	target: number,
	minimumDuration: number,
	maximumDuration: number,
): number | null {
	const start = frames[startIndex]!.timelineFrame;
	let first = lowerBoundTimeline(frames, start + minimumDuration);
	if (first <= startIndex) first = startIndex + 1;
	let last = upperBoundTimeline(frames, start + maximumDuration) - 1;
	last = Math.min(last, frames.length - 1);
	if (first > last) return null;
	const nearest = nearestTimelineIndex(frames, target);
	return Math.min(last, Math.max(first, nearest));
}

interface SourceFrame {
	readonly sourceFrame: number;
	readonly presentationTick: string;
	readonly timelineFrame: number;
}

function nearestTimelineIndex(frames: readonly SourceFrame[], target: number): number {
	const right = lowerBoundTimeline(frames, target);
	if (right === 0) return 0;
	if (right === frames.length) return frames.length - 1;
	const left = right - 1;
	return target - frames[left]!.timelineFrame <= frames[right]!.timelineFrame - target
		? left : right;
}

function lowerBoundTimeline(frames: readonly SourceFrame[], target: number): number {
	let low = 0;
	let high = frames.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (frames[middle]!.timelineFrame < target) low = middle + 1;
		else high = middle;
	}
	return low;
}

function upperBoundTimeline(frames: readonly SourceFrame[], target: number): number {
	let low = 0;
	let high = frames.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (frames[middle]!.timelineFrame <= target) low = middle + 1;
		else high = middle;
	}
	return low;
}

async function rmsEnvelope(samples: Float32Array, signal: AbortSignal): Promise<Float64Array> {
	const result = new Float64Array(Math.ceil(samples.length / ENERGY_BLOCK_FRAMES));
	let visited = 0;
	for (let block = 0; block < result.length; block += 1) {
		signal.throwIfAborted();
		const start = block * ENERGY_BLOCK_FRAMES;
		const end = Math.min(samples.length, start + ENERGY_BLOCK_FRAMES);
		let squares = 0;
		for (let index = start; index < end; index += 1) {
			const sample = samples[index]!;
			squares += sample * sample;
			visited += 1;
			if (visited % CANCELLATION_FRAMES === 0) await yieldForCancellation(signal);
		}
		result[block] = Math.sqrt(squares / (end - start));
	}
	return result;
}

function windowDynamics(
	window: LocalAssistanceGuidedHighlightWindowV1,
	video: LocalAssistanceGuidedHighlightVideoSignalsV1,
	envelope: Float64Array,
): number {
	const relativeStart = window.startFrame - video.selectionStartFrame;
	const relativeEnd = window.endFrame - video.selectionStartFrame;
	const audioStart = Number(scaleSampleFrame(
		relativeStart, video.sampleRate, AUDIO_SAMPLE_RATE, 'enclosingStart',
	));
	const audioEnd = Number(scaleSampleFrame(
		relativeEnd, video.sampleRate, AUDIO_SAMPLE_RATE, 'enclosingEnd',
	));
	const firstBlock = Math.floor(audioStart / ENERGY_BLOCK_FRAMES);
	const finalBlock = Math.min(envelope.length, Math.ceil(audioEnd / ENERGY_BLOCK_FRAMES));
	let minimum = Number.POSITIVE_INFINITY;
	let maximum = 0;
	for (let block = firstBlock; block < finalBlock; block += 1) {
		minimum = Math.min(minimum, envelope[block]!);
		maximum = Math.max(maximum, envelope[block]!);
	}
	if (!Number.isFinite(minimum) || maximum <= 1e-12) return 0;
	return quantize(Math.min(1, Math.max(0, (maximum - minimum) / maximum)));
}

function reviewSourceTimeAuthority(value: unknown) {
	const row = exactRecord(value, AUTHORITY_FIELDS, 'selected-video source-time authority');
	if (row.schemaVersion !== 1 || row.kind !== 'selected-video-source-time-authority') {
		throw new TypeError('Selected-video source-time authority has an unsupported identity.');
	}
	const sourceStartFrame = integer(row.sourceStartFrame, 0, 'source start frame');
	const sourceEndFrame = integer(row.sourceEndFrame, 1, 'source end frame');
	const selectionStartFrame = integer(row.selectionStartFrame, 0, 'selection start frame');
	const selectionEndFrame = integer(row.selectionEndFrame, 1, 'selection end frame');
	if (sourceEndFrame <= sourceStartFrame || selectionEndFrame <= selectionStartFrame) {
		throw new RangeError('Selected-video source-time authority has empty geometry.');
	}
	const candidates = boundedArray(row.frames, 2, MAXIMUM_AUTHORITY_ROWS, 'source-time rows');
	let priorSource = -1;
	let priorTick = -1n;
	let priorTimeline = -1;
	const frames = candidates.map((candidate) => {
		const frame = exactRecord(candidate, FRAME_FIELDS, 'source-time row');
		const sourceFrame = integer(frame.sourceFrame, 0, 'source frame');
		const presentationTick = tick(frame.presentationTick);
		const timelineFrame = integer(frame.timelineFrame, 0, 'timeline frame');
		if (sourceFrame <= priorSource || BigInt(presentationTick) <= priorTick
			|| timelineFrame <= priorTimeline) {
			throw new RangeError('Selected-video source-time authority must be strictly forward.');
		}
		priorSource = sourceFrame; priorTick = BigInt(presentationTick); priorTimeline = timelineFrame;
		return Object.freeze({ sourceFrame, presentationTick, timelineFrame });
	});
	if (frames[0]!.sourceFrame !== sourceStartFrame || frames.at(-1)!.sourceFrame !== sourceEndFrame
		|| frames[0]!.timelineFrame !== selectionStartFrame
		|| frames.at(-1)!.timelineFrame !== selectionEndFrame) {
		throw new RangeError('Selected-video source-time authority does not bind exact endpoints.');
	}
	return Object.freeze({
		projectId: stableId(row.projectId, 'project'),
		projectRevision: integer(row.projectRevision, 0, 'project revision'),
		sequenceId: stableId(row.sequenceId, 'sequence'),
		videoOccurrenceId: stableId(row.videoOccurrenceId, 'video occurrence'),
		sourceId: stableId(row.sourceId, 'video source'),
		sourceSha256: digest(row.sourceSha256, 'source'),
		timingAuthoritySha256: digest(row.timingAuthoritySha256, 'timing authority'),
		sourceWidth: integer(row.sourceWidth, 1, 'source width'),
		sourceHeight: integer(row.sourceHeight, 1, 'source height'),
		sourceStartFrame, sourceEndFrame,
		sampleRate: integer(row.sampleRate, 1, 'timeline sample rate'),
		timescale: integer(row.timescale, 1, 'source timescale'),
		selectionStartFrame, selectionEndFrame,
		frames: Object.freeze(frames),
	});
}

function reviewVideoSignals(value: unknown): LocalAssistanceGuidedHighlightVideoSignalsV1 {
	const row = exactRecord(value, VIDEO_FIELDS, 'highlight video signals');
	if (row.schemaVersion !== 1 || row.kind !== 'highlight-video-signals') {
		throw new TypeError('Highlight video signals have an unsupported identity.');
	}
	const sampleRate = integer(row.sampleRate, 1, 'highlight sample rate');
	const selectionStartFrame = integer(row.selectionStartFrame, 0, 'highlight selection start');
	const selectionEndFrame = integer(row.selectionEndFrame, 1, 'highlight selection end');
	if (selectionEndFrame <= selectionStartFrame) throw new RangeError('Highlight selection is empty.');
	const size = exactRecord(row.sourceSize, ['width', 'height'] as const, 'highlight source size');
	const sourceTimeAuthority = boundedArray(row.sourceTimeAuthority, 2,
		MAXIMUM_AUTHORITY_ROWS, 'highlight source-time rows').map((candidate) => {
		const frame = exactRecord(candidate, FRAME_FIELDS, 'highlight source-time row');
		return Object.freeze({ sourceFrame: integer(frame.sourceFrame, 0, 'highlight source frame'),
			presentationTick: tick(frame.presentationTick),
			timelineFrame: integer(frame.timelineFrame, 0, 'highlight timeline frame') });
	});
	const windows = boundedArray(row.windows, 0, MAXIMUM_WINDOWS, 'highlight windows')
		.map((candidate) => {
			const window = exactRecord(candidate, WINDOW_FIELDS, 'highlight window');
			if (window.shotStructure !== 0 || window.visualInterest !== 0) {
				throw new TypeError('Controller-owned highlight windows cannot fabricate visual scores.');
			}
			const startFrame = integer(window.startFrame, selectionStartFrame, 'highlight window start');
			const endFrame = integer(window.endFrame, startFrame + 1, 'highlight window end');
			if (endFrame > selectionEndFrame) throw new RangeError('Highlight window exceeds selection.');
			return Object.freeze({ id: stableId(window.id, 'highlight candidate'), startFrame, endFrame,
				shotStructure: 0 as const, visualInterest: 0 as const });
		});
	const reframeEvidence = row.reframeEvidence === null ? null
		: reviewAssistanceAcceptedReframeDerivativeV1(row.reframeEvidence);
	return Object.freeze({ schemaVersion: 1, kind: 'highlight-video-signals',
		sourceId: stableId(row.sourceId, 'highlight source'), sampleRate,
		timescale: integer(row.timescale, 1, 'highlight source timescale'),
		sourceSize: Object.freeze({ width: integer(size.width, 1, 'highlight source width'),
			height: integer(size.height, 1, 'highlight source height') }),
		videoOccurrenceId: stableId(row.videoOccurrenceId, 'highlight video occurrence'),
		audioOccurrenceId: row.audioOccurrenceId === null ? null
			: stableId(row.audioOccurrenceId, 'highlight audio occurrence'),
		selectionStartFrame, selectionEndFrame, reframeEvidence,
		sourceTimeAuthority: Object.freeze(sourceTimeAuthority), windows: Object.freeze(windows) });
}

function exactRecord<const Key extends string>(
	value: unknown, fields: readonly Key[], label: string,
): Record<Key, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be one plain record.`);
	}
	const row = value as Record<string, unknown>;
	if (Reflect.ownKeys(row).length !== fields.length
		|| Reflect.ownKeys(row).some((key) => typeof key !== 'string' || !fields.includes(key as Key))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return row as Record<Key, unknown>;
}

function boundedArray(value: unknown, minimum: number, maximum: number, label: string): unknown[] {
	if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
		throw new RangeError(`The ${label} exceed their bound.`);
	}
	return value;
}

function stableId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !STABLE_ID.test(value)) {
		throw new TypeError(`The ${label} ID is invalid.`);
	}
	return value;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError(`The ${label} digest is invalid.`);
	}
	return value;
}

function tick(value: unknown): string {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(value)
		|| BigInt(value) > 0x7fff_ffff_ffff_ffffn) {
		throw new RangeError('The source-time presentation tick is invalid.');
	}
	return value;
}

function integer(value: unknown, minimum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function safeMultiply(left: number, right: number, label: string): number {
	const result = left * right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`The ${label} overflowed.`);
	return result;
}

function quantize(value: number): number {
	return Math.round(value * 1_000_000) / 1_000_000;
}

async function yieldForCancellation(signal: AbortSignal): Promise<void> {
	signal.throwIfAborted();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	signal.throwIfAborted();
}
