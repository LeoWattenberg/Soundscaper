/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic transcript evidence for known, timing-authorized highlight windows. */

import {
	reviewOwnedAssistanceTranscriptV1,
} from '../assistance/owned-transform-validation-v1.ts';
import {
	createAssistanceTranscript,
	type AssistanceTranscript,
	type TranscriptSegment,
} from '../assistance/transcript.ts';
import { scaleSampleFrame } from '../timeline-time.ts';
import type {
	LocalAssistanceGuidedHighlightVideoSignalsV1,
} from './local-assistance-guided-highlight-signals.ts';

export interface LocalAssistanceGuidedHighlightTranscriptSignalsV1 {
	readonly schemaVersion: 1;
	readonly kind: 'highlight-transcript-signals';
	readonly sourceTimelineStartFrame: number;
	readonly transcript: AssistanceTranscript;
	readonly signals: readonly Readonly<{
		readonly candidateId: string;
		readonly hook: number;
		readonly conversationalStructure: number;
		readonly semanticSelfContainedness: number;
	}>[];
}

const TRANSCRIPT_MEDIA_TYPE = 'application/vnd.soundscaper.transcript+json';
const MAXIMUM_TRANSCRIPT_BYTES = 32 * 1024 * 1024;
const ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;

export async function createLocalAssistanceGuidedHighlightTranscriptSignalsV1(
	request: Readonly<{
		readonly body: Blob;
		readonly video: LocalAssistanceGuidedHighlightVideoSignalsV1;
		readonly audioSourceId: string;
		readonly audioSourceStartFrame: number;
		readonly audioSourceEndFrame: number;
		readonly signal: AbortSignal;
	}>,
): Promise<LocalAssistanceGuidedHighlightTranscriptSignalsV1> {
	if (!(request?.signal instanceof AbortSignal)) {
		throw new TypeError('Highlight transcript signals require one cancellation signal.');
	}
	request.signal.throwIfAborted();
	if (!(request.body instanceof Blob) || request.body.type !== TRANSCRIPT_MEDIA_TYPE
		|| request.body.size < 2 || request.body.size > MAXIMUM_TRANSCRIPT_BYTES) {
		throw new RangeError('Highlight transcript evidence needs one bounded transcript body.');
	}
	const video = videoSignals(request.video);
	const audioSourceId = stableId(request.audioSourceId, 'audio source');
	const sourceStart = integer(request.audioSourceStartFrame, 0, 'audio source start');
	const sourceEnd = integer(request.audioSourceEndFrame, sourceStart + 1, 'audio source end');
	const bytes = new Uint8Array(await request.body.arrayBuffer());
	request.signal.throwIfAborted();
	let parsed: unknown;
	try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
	catch (error) {
		throw new TypeError('Highlight transcript evidence is not strict UTF-8 JSON.', { cause: error });
	}
	const transcript = reviewOwnedAssistanceTranscriptV1(parsed);
	if (transcript.sourceId !== audioSourceId) {
		throw new Error('Highlight transcript source authority changed after admission.');
	}
	const audioDuration = sourceEnd - sourceStart;
	const videoDuration = video.selectionEndFrame - video.selectionStartFrame;
	if (Number(scaleSampleFrame(audioDuration, transcript.sampleRate,
		video.sampleRate, 'point')) !== videoDuration) {
		throw new RangeError('Highlight transcript and video selection durations disagree.');
	}
	const selected = createAssistanceTranscript({ sourceId: transcript.sourceId,
		sampleRate: transcript.sampleRate, language: transcript.language,
		modelId: transcript.modelId,
		segments: transcript.segments.filter(({ startFrame, endFrame }) => (
			startFrame >= sourceStart && endFrame <= sourceEnd
		)).map((segment) => Object.freeze({
			startFrame: segment.startFrame - sourceStart,
			endFrame: segment.endFrame - sourceStart,
			text: segment.text, speaker: segment.speaker,
			words: segment.words.map((word) => Object.freeze({ ...word,
				startFrame: word.startFrame - sourceStart,
				endFrame: word.endFrame - sourceStart })),
		})),
	});
	request.signal.throwIfAborted();
	const signals = video.windows.flatMap((window) => {
		const evidence = selected.segments.filter((segment) => overlapsWindow(
			segment, window.startFrame, window.endFrame, selected.sampleRate, video,
		));
		return evidence.length === 0 ? [] : [Object.freeze({ candidateId: window.id,
			...scores(evidence, window.startFrame, window.endFrame,
				selected.sampleRate, video) })];
	});
	return Object.freeze({ schemaVersion: 1, kind: 'highlight-transcript-signals',
		sourceTimelineStartFrame: video.selectionStartFrame,
		transcript: selected, signals: Object.freeze(signals) });
}

function scores(
	segments: readonly TranscriptSegment[],
	windowStart: number,
	windowEnd: number,
	transcriptRate: number,
	video: LocalAssistanceGuidedHighlightVideoSignalsV1,
) {
	const firstStart = timelineStartFrame(segments[0]!.startFrame, transcriptRate, video);
	const lastEnd = timelineEndFrame(segments.at(-1)!.endFrame, transcriptRate, video);
	const duration = windowEnd - windowStart;
	const words = segments.reduce((count, { text }) => count
		+ text.trim().split(/\s+/u).filter(Boolean).length, 0);
	const punctuationHook = /[?!]/u.test(segments[0]!.text) ? 0.25 : 0;
	const earlyHook = firstStart - windowStart <= duration / 4 ? 0.5 : 0.25;
	const hook = quantize(Math.min(1, earlyHook + punctuationHook + Math.min(0.25, words / 160)));
	const speakers = new Set(segments.map(({ speaker }) => speaker).filter((value) => value !== null));
	const conversationalStructure = quantize(Math.min(1,
		segments.length / 4 + (speakers.size > 1 ? 0.5 : 0)));
	const complete = firstStart >= windowStart && lastEnd <= windowEnd ? 0.5 : 0;
	const semanticSelfContainedness = quantize(Math.min(1,
		complete + Math.min(0.5, words / 80)));
	return Object.freeze({ hook, conversationalStructure, semanticSelfContainedness });
}

function overlapsWindow(
	segment: TranscriptSegment,
	windowStart: number,
	windowEnd: number,
	transcriptRate: number,
	video: LocalAssistanceGuidedHighlightVideoSignalsV1,
): boolean {
	const start = timelineStartFrame(segment.startFrame, transcriptRate, video);
	const end = timelineEndFrame(segment.endFrame, transcriptRate, video);
	return Math.max(start, windowStart) < Math.min(end, windowEnd);
}

// The two rounding policies stay literal at their call sites: the shared timeline
// conversion audit classifies every helper call by the policy it names, and a policy
// threaded through a parameter cannot be classified at all.
function timelineStartFrame(
	frame: number,
	transcriptRate: number,
	video: LocalAssistanceGuidedHighlightVideoSignalsV1,
): number {
	return timelineFrame(scaleSampleFrame(frame, transcriptRate, video.sampleRate, 'enclosingStart'), video);
}

function timelineEndFrame(
	frame: number,
	transcriptRate: number,
	video: LocalAssistanceGuidedHighlightVideoSignalsV1,
): number {
	return timelineFrame(scaleSampleFrame(frame, transcriptRate, video.sampleRate, 'enclosingEnd'), video);
}

function timelineFrame(
	relative: bigint | number,
	video: LocalAssistanceGuidedHighlightVideoSignalsV1,
): number {
	const result = video.selectionStartFrame + Number(relative);
	if (!Number.isSafeInteger(result)) throw new RangeError('Highlight transcript timing overflowed.');
	return result;
}

function videoSignals(
	value: LocalAssistanceGuidedHighlightVideoSignalsV1,
): LocalAssistanceGuidedHighlightVideoSignalsV1 {
	if (!value || value.schemaVersion !== 1 || value.kind !== 'highlight-video-signals'
		|| !Number.isSafeInteger(value.sampleRate) || value.sampleRate < 1
		|| !Number.isSafeInteger(value.selectionStartFrame) || value.selectionStartFrame < 0
		|| !Number.isSafeInteger(value.selectionEndFrame)
		|| value.selectionEndFrame <= value.selectionStartFrame || !Array.isArray(value.windows)) {
		throw new TypeError('Highlight transcript evidence needs exact video signal authority.');
	}
	return value;
}

function stableId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !ID.test(value)) {
		throw new TypeError(`The highlight ${label} ID is invalid.`);
	}
	return value;
}

function integer(value: unknown, minimum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`The highlight ${label} is invalid.`);
	}
	return Number(value);
}

function quantize(value: number): number {
	return Math.round(value * 1_000_000) / 1_000_000;
}
