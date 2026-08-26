/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact source-authority wrappers for raw operation outputs consumed by owned transforms. */

import { reviewAssistanceWordAlignmentV1 } from
	'../src/common/editor/assistance/m7-semantic-results.ts';
import { reviewOwnedAssistanceTranscriptV1 } from
	'../src/common/editor/assistance/owned-transform-validation-v1.ts';
import { ingestRecognitionResult } from
	'../src/common/editor/assistance/transcript-ingest.ts';
import {
	createAssistanceTranscript,
	type AssistanceTranscript,
} from '../src/common/editor/assistance/transcript.ts';
import type {
	AssistanceWorkflowSourceRangeV1,
	AssistanceWorkflowV1,
} from '../src/common/editor/assistance/workflow.ts';
import { splitAssistanceWav2Vec2EnglishSegmentWordsV1 } from
	'../src/common/editor/assistance/wav2vec2-english-tokenizer-v1.ts';
import { scaleSampleFrame } from '../src/common/editor/timeline-time.ts';
import { normalizeSpeakerDiarizationResult } from './assistance-diarization-runtime.ts';
import { normalizeRecognition } from './assistance-speech-runtime.ts';
import { normalizeVoiceActivityResult } from './assistance-vad-runtime.ts';

export type AssistanceWorkflowOwnedAudioCutInputBodyKind = 'json' | 'embeddings' | 'transcript'
	| 'voice-activity' | 'speaker-turns' | 'word-alignment';

export class AssistanceWorkflowOwnedStageUnavailableError extends Error {}

export function normalizeAssistanceWorkflowOwnedAudioCutInputV1(
	kind: AssistanceWorkflowOwnedAudioCutInputBodyKind,
	value: unknown,
	request: AssistanceWorkflowV1,
): unknown {
	switch (kind) {
		case 'json': return value;
		case 'transcript': return normalizeTranscript(value, request);
		case 'voice-activity': return normalizeVoiceActivity(value, request);
		case 'speaker-turns': return normalizeSpeakerTurns(value, request);
		case 'word-alignment': return normalizeWordAlignment(value, request);
		case 'embeddings': throw new Error('Embedding bodies are never JSON.');
	}
}

function normalizeTranscript(value: unknown, request: AssistanceWorkflowV1): AssistanceTranscript {
	try {
		const transcript = reviewOwnedAssistanceTranscriptV1(value);
		assertTranscriptAuthority(transcript, request);
		return transcript;
	} catch (error) {
		if (hasOwn(value, 'schemaVersion')) throw error;
	}
	const range = soleAudioRange(request);
	const recognition = normalizeRecognition(strictRecognition(value));
	const model = request.models.find(({ stageId, slotId }) =>
		stageId === 'recognize-speech' && slotId === 'speech-recognizer');
	if (!model) {
		throw new AssistanceWorkflowOwnedStageUnavailableError(
			'Raw speech has no exact recognizer identity.',
		);
	}
	const enriched = model.modelId.toLocaleLowerCase('en-US').includes('whisper')
		? rawWhisperWordInventory(recognition) : recognition;
	const report = ingestRecognitionResult(enriched, { sourceId: range.sourceId,
		sampleRate: range.sourceSampleRate!, modelId: model.modelId,
		sourceFrameCount: range.sourceEndFrame - range.sourceStartFrame });
	if (report.droppedSegments !== 0 || report.droppedWords !== 0) {
		throw new RangeError('Raw recognition lost semantic rows during exact normalization.');
	}
	return offsetTranscript(report.transcript, range.sourceStartFrame);
}

function normalizeVoiceActivity(value: unknown, request: AssistanceWorkflowV1): unknown {
	if (hasOwn(value, 'schemaVersion')) {
		const wrapper = exactRecord(value, ['schemaVersion', 'sourceSampleRate', 'sourceStartFrame',
			'sourceEndFrame', 'result'], 'voice-activity source wrapper');
		const range = matchingAudioRange(request, wrapper.sourceSampleRate,
			wrapper.sourceStartFrame, wrapper.sourceEndFrame);
		const result = normalizeVoiceActivityWrappedResult(wrapper.result);
		assertRawExtent(result.segments, range, result.sampleRate, 'voice-activity');
		return Object.freeze({ ...wrapper, result });
	}
	const range = soleAudioRange(request);
	const result = normalizeVoiceActivityResult(value);
	assertRawExtent(result.segments, range, result.sampleRate, 'voice-activity');
	return Object.freeze({ schemaVersion: 1, sourceSampleRate: range.sourceSampleRate!,
		sourceStartFrame: range.sourceStartFrame, sourceEndFrame: range.sourceEndFrame,
		result: Object.freeze({ kind: 'voice-activity', ...result }) });
}

function normalizeSpeakerTurns(value: unknown, request: AssistanceWorkflowV1): unknown {
	if (hasOwn(value, 'schemaVersion')) {
		const wrapper = exactRecord(value, ['schemaVersion', 'sourceSampleRate', 'sourceStartFrame',
			'result'], 'speaker-turns source wrapper');
		const range = matchingAudioRange(request, wrapper.sourceSampleRate,
			wrapper.sourceStartFrame);
		const result = normalizeSpeakerWrappedResult(wrapper.result);
		assertRawExtent(result.turns, range, result.sampleRate, 'speaker-turns');
		return Object.freeze({ ...wrapper, result });
	}
	const range = soleAudioRange(request);
	const result = normalizeSpeakerDiarizationResult(value);
	assertRawExtent(result.turns, range, result.sampleRate, 'speaker-turns');
	return Object.freeze({ schemaVersion: 1, sourceSampleRate: range.sourceSampleRate!,
		sourceStartFrame: range.sourceStartFrame,
		result: Object.freeze({ kind: 'speaker-turns', ...result }) });
}

function normalizeWordAlignment(value: unknown, request: AssistanceWorkflowV1): unknown {
	if (!hasOwn(value, 'alignment')) {
		const range = soleAudioRange(request);
		const alignment = reviewAssistanceWordAlignmentV1(value);
		assertAlignmentExtent(alignment.words, range, alignment.sampleRate);
		return Object.freeze({ schemaVersion: 1, sourceSampleRate: range.sourceSampleRate!,
			sourceStartFrame: range.sourceStartFrame, alignment });
	}
	const wrapper = exactRecord(value, ['schemaVersion', 'sourceSampleRate', 'sourceStartFrame',
		'alignment'], 'word-alignment source wrapper');
	const range = matchingAudioRange(request, wrapper.sourceSampleRate, wrapper.sourceStartFrame);
	const alignment = reviewAssistanceWordAlignmentV1(wrapper.alignment);
	assertAlignmentExtent(alignment.words, range, alignment.sampleRate);
	return Object.freeze({ ...wrapper, alignment });
}

function assertTranscriptAuthority(transcript: AssistanceTranscript, request: AssistanceWorkflowV1): void {
	const matches = request.fence.sourceRanges.filter(({ mediaKind, sourceId, sourceSampleRate }) =>
		mediaKind === 'audio' && sourceId === transcript.sourceId
		&& sourceSampleRate === transcript.sampleRate);
	if (matches.length !== 1) {
		throw new AssistanceWorkflowOwnedStageUnavailableError('Transcript source authority is ambiguous.');
	}
	const range = matches[0]!;
	if (transcript.segments.some(({ startFrame, endFrame }) =>
		startFrame < range.sourceStartFrame || endFrame > range.sourceEndFrame)) {
		throw new RangeError('Transcript timing exceeds the exact fenced source range.');
	}
}

function soleAudioRange(request: AssistanceWorkflowV1): AssistanceWorkflowSourceRangeV1 {
	const ranges = request.fence.sourceRanges.filter(({ mediaKind }) => mediaKind === 'audio');
	if (ranges.length !== 1 || ranges[0]!.sourceSampleRate === null) {
		throw new AssistanceWorkflowOwnedStageUnavailableError(
			'Raw model timing has no unambiguous audio source authority.',
		);
	}
	return ranges[0]!;
}

function matchingAudioRange(
	request: AssistanceWorkflowV1,
	sampleRateValue: unknown,
	startValue: unknown,
	endValue?: unknown,
): AssistanceWorkflowSourceRangeV1 {
	const ranges = request.fence.sourceRanges.filter(({ mediaKind, sourceSampleRate, sourceStartFrame,
		sourceEndFrame }) => mediaKind === 'audio' && sourceSampleRate === sampleRateValue
		&& sourceStartFrame === startValue && (endValue === undefined || sourceEndFrame === endValue));
	if (ranges.length !== 1) {
		throw new AssistanceWorkflowOwnedStageUnavailableError(
			'Source wrapper has no exact fenced authority.',
		);
	}
	return ranges[0]!;
}

function assertRawExtent(
	rows: readonly Readonly<{ startSample: number; sampleCount: number }>[],
	range: AssistanceWorkflowSourceRangeV1,
	rawRate: number,
	label: string,
): void {
	const maximum = Number(scaleSampleFrame(range.sourceEndFrame - range.sourceStartFrame,
		range.sourceSampleRate!, rawRate, 'point'));
	if (rows.some(({ startSample, sampleCount }) => startSample + sampleCount > maximum)) {
		throw new RangeError(`${label} timing exceeds the exact fenced source extent.`);
	}
}

function assertAlignmentExtent(
	words: readonly Readonly<{ endSample: number }>[],
	range: AssistanceWorkflowSourceRangeV1,
	rawRate: number,
): void {
	const maximum = Number(scaleSampleFrame(range.sourceEndFrame - range.sourceStartFrame,
		range.sourceSampleRate!, rawRate, 'point'));
	if (words.some(({ endSample }) => endSample > maximum)) {
		throw new RangeError('word-alignment timing exceeds the exact fenced source extent.');
	}
}

function offsetTranscript(transcript: AssistanceTranscript, offset: number): AssistanceTranscript {
	if (offset === 0) return transcript;
	return createAssistanceTranscript({ ...transcript, segments: transcript.segments.map((segment) => ({
		...segment, startFrame: addFrames(segment.startFrame, offset),
		endFrame: addFrames(segment.endFrame, offset), words: segment.words.map((word) => ({
			...word, startFrame: addFrames(word.startFrame, offset),
			endFrame: addFrames(word.endFrame, offset),
		})),
	})) });
}

function rawWhisperWordInventory(recognition: ReturnType<typeof normalizeRecognition>) {
	return Object.freeze({ ...recognition, segments: Object.freeze(recognition.segments.map((segment) => {
		if (segment.words !== undefined && segment.words.length > 0) return segment;
		const text = segment.text ?? '';
		const words = text.trim() === '' ? []
			: splitAssistanceWav2Vec2EnglishSegmentWordsV1(text).map((word) => Object.freeze({
			text: word, startSeconds: segment.startSeconds, endSeconds: segment.startSeconds,
			confidence: null,
		}));
		return Object.freeze({ ...segment, words: Object.freeze(words) });
	})) });
}

function strictRecognition(value: unknown): unknown {
	const row = exactRecord(value, ['language', 'segments'], 'raw recognition result');
	if (!Array.isArray(row.segments) || row.segments.length > 100_000) {
		throw new RangeError('Raw recognition segments exceed their bound.');
	}
	for (const [index, candidate] of row.segments.entries()) {
		const segment = openRecord(candidate, ['startSeconds', 'endSeconds', 'text', 'words', 'speaker'],
			`raw recognition segment ${String(index)}`, ['startSeconds', 'endSeconds']);
		if (segment.words !== undefined) {
			if (!Array.isArray(segment.words) || segment.words.length > 1_000) {
				throw new RangeError('Raw recognition words exceed their bound.');
			}
			segment.words.forEach((word, wordIndex) => openRecord(word,
				['text', 'startSeconds', 'endSeconds', 'confidence'],
				`raw recognition word ${String(wordIndex)}`, ['text', 'startSeconds', 'endSeconds']));
		}
	}
	return row;
}

function normalizeVoiceActivityWrappedResult(value: unknown) {
	const row = exactRecord(value, ['kind', 'sampleRate', 'segments'], 'voice-activity result');
	if (row.kind !== 'voice-activity') throw new TypeError('Voice-activity result kind is invalid.');
	const normalized = normalizeVoiceActivityResult({ sampleRate: row.sampleRate, segments: row.segments });
	return Object.freeze({ kind: 'voice-activity' as const, ...normalized });
}

function normalizeSpeakerWrappedResult(value: unknown) {
	const row = exactRecord(value, ['kind', 'sampleRate', 'turns'], 'speaker-turns result');
	if (row.kind !== 'speaker-turns') throw new TypeError('Speaker-turns result kind is invalid.');
	const normalized = normalizeSpeakerDiarizationResult({ sampleRate: row.sampleRate, turns: row.turns });
	return Object.freeze({ kind: 'speaker-turns' as const, ...normalized });
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	return openRecord(value, keys, label, keys);
}

function openRecord(
	value: unknown, keys: readonly string[], label: string, required: readonly string[],
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const row = value as Record<string, unknown>;
	if (Object.keys(row).some((key) => !keys.includes(key))
		|| required.some((key) => !Object.hasOwn(row, key))) {
		throw new TypeError(`The ${label} schema keys are invalid.`);
	}
	return row;
}

function hasOwn(value: unknown, key: string): boolean {
	return !!value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, key);
}

function addFrames(left: number, right: number): number {
	const value = left + right;
	if (!Number.isSafeInteger(value)) throw new RangeError('Transcript source timing exceeds safe frames.');
	return value;
}
