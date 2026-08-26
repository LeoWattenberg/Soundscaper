/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic, pathless implementations of the seven owned audio workflow stages. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { scaleSampleFrame } from '../timeline-time.ts';
import {
	reviewAssistanceEmbeddingMatrixV1,
} from './binary-formats-v1.ts';
import { createAssistanceBeatProposals } from './beat-proposals.ts';
import { findDisfluencyProposals, type DisfluencyProposal } from './disfluency.ts';
import {
	ASSISTANCE_ALIGNMENT_SAMPLE_RATE,
	ASSISTANCE_AUDIO_TAG_SAMPLE_RATE,
	reviewAssistanceBeatGridV1,
	reviewAssistanceWordAlignmentV1,
} from './m7-semantic-results.ts';
import type {
	AssistanceBeatLabelsV1,
	AssistanceCaptionsV1,
	AssistanceCleanupProposalsV1,
	AssistanceReactionRangesV1,
	AssistanceTempoMapDiffV1,
	AssistanceTextChunksV1,
	AssistanceTranscriptIndexV1,
} from './owned-audio-cut-transform-types-v1.ts';
import {
	ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_ITEMS,
	ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_PROPOSALS,
	ownedArray,
	ownedBoolean,
	ownedExactRecord,
	ownedInteger,
	ownedSafeAdd,
	ownedText,
	ownedUnit,
	reviewOwnedAssistanceTranscriptV1,
} from './owned-transform-validation-v1.ts';
import { createAssistanceReactionProposals } from './reaction-proposals.ts';
import { attributeTranscriptSpeakers } from './speaker-attribution.ts';
import {
	assistanceTranscriptCleanupPresetProfile,
} from './transcript-cleanup-presets.ts';
import {
	createAssistanceNomicDocumentChunksV1,
	type AssistanceTokenizerV1,
} from './transcript-indexing-v1.ts';
import { transcriptToLabelDrafts, type AssistanceTranscript } from './transcript.ts';
import { voiceActivitySilenceProposals } from './vad-silence.ts';
import type { AssistanceWorkflowSettingsV1 } from './workflow-settings-v1.ts';

type Settings<Id extends AssistanceWorkflowSettingsV1['workflowId']> =
	Extract<AssistanceWorkflowSettingsV1, { readonly workflowId: Id }>;

const ALIGNMENT_WRAPPER_FIELDS = Object.freeze([
	'schemaVersion', 'sourceSampleRate', 'sourceStartFrame', 'alignment',
] as const);
const VAD_WRAPPER_FIELDS = Object.freeze([
	'schemaVersion', 'sourceSampleRate', 'sourceStartFrame', 'sourceEndFrame', 'result',
] as const);
const VAD_RESULT_FIELDS = Object.freeze(['kind', 'sampleRate', 'segments'] as const);
const RANGE_FIELDS = Object.freeze(['startSample', 'sampleCount'] as const);
const SPEAKER_WRAPPER_FIELDS = Object.freeze([
	'schemaVersion', 'sourceSampleRate', 'sourceStartFrame', 'result',
] as const);
const SPEAKER_RESULT_FIELDS = Object.freeze(['kind', 'sampleRate', 'turns'] as const);
const SPEAKER_TURN_FIELDS = Object.freeze(['startSample', 'sampleCount', 'speakerId'] as const);
const TEXT_CHUNK_FIELDS = Object.freeze([
	'schemaVersion', 'chunkId', 'sourceStartFrame', 'sourceEndFrame', 'segmentStartIndex',
	'segmentEndIndexExclusive', 'inputIds', 'label',
] as const);
const FIXED_ENGLISH_FILLER_LEXICON = Object.freeze(['um', 'uh', 'erm']);
const MAXIMUM_LABEL_UNITS = 1_024;

export function assembleOwnedCaptionsV1(
	inputsValue: unknown,
	settings: Settings<'transcribe-captions'>,
): AssistanceCaptionsV1 {
	const inputs = ownedExactRecord(inputsValue, ['transcript', 'word-alignment'],
		'assemble-captions inputs');
	const transcript = reviewOwnedAssistanceTranscriptV1(inputs.transcript);
	if (transcript.segments.length > ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_PROPOSALS) {
		throw new RangeError('Caption assembly exceeds its exact cue bound.');
	}
	const aligned = inputs['word-alignment'] === null ? null
		: alignedCaptionWords(inputs['word-alignment'], transcript, settings);
	const labels = transcriptToLabelDrafts(transcript);
	const cues = labels.map((label, segmentIndex) => Object.freeze({
		cueId: `caption:${String(segmentIndex)}`,
		startFrame: label.startFrame,
		endFrame: label.endFrame,
		text: label.title,
		words: Object.freeze(aligned?.[segmentIndex] ?? transcript.segments[segmentIndex]!.words.map(
			({ text, startFrame, endFrame, confidence }) => Object.freeze({
				text, startFrame, endFrame, confidence,
			}),
		)),
	}));
	return Object.freeze({
		schemaVersion: 1, kind: 'captions', sourceId: transcript.sourceId,
		sampleRate: transcript.sampleRate, alignmentApplied: aligned !== null,
		cues: Object.freeze(cues),
	});
}

export function proposeOwnedCleanupV1(
	inputsValue: unknown,
	settings: Settings<'clean-filler-silence'>,
): AssistanceCleanupProposalsV1 {
	const inputs = ownedExactRecord(inputsValue, ['voice-activity', 'transcript'],
		'propose-cleanup inputs');
	const profile = assistanceTranscriptCleanupPresetProfile(settings.preset);
	const vad = cleanupVadProposals(inputs['voice-activity'], profile.minimumSilenceSamples,
		profile.speechPaddingSamples);
	const transcript = inputs.transcript === null ? null
		: reviewOwnedAssistanceTranscriptV1(inputs.transcript);
	if (transcript && transcript.language !== 'en') {
		throw new RangeError('Filler cleanup requires an English transcript.');
	}
	if (transcript && transcript.sampleRate !== vad.sourceSampleRate) {
		throw new RangeError('Cleanup transcript and voice activity disagree on source sample rate.');
	}
	if (transcript && transcript.segments.some(({ startFrame, endFrame }) =>
		startFrame < vad.sourceStartFrame || endFrame > vad.sourceEndFrame)) {
		throw new RangeError('Cleanup transcript timing exceeds the exact selected source range.');
	}
	const proposals = [
		...(transcript ? findDisfluencyProposals(transcript, {
			fillerLexicon: FIXED_ENGLISH_FILLER_LEXICON,
			detectRepetitions: true,
			minConfidence: profile.minimumWordConfidence,
			minSilenceFrames: 0,
			silencePaddingFrames: 0,
		}) : []),
		...vad.proposals,
	].sort(compareProposals);
	if (proposals.length > ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_PROPOSALS) {
		throw new RangeError('Cleanup proposals exceed their exact result bound.');
	}
	return Object.freeze({
		schemaVersion: 1, kind: 'cleanup-proposals', preset: settings.preset,
		proposals: Object.freeze(proposals.map((proposal) => Object.freeze({
			...proposal, selected: false as const,
		}))),
	});
}

export function attributeOwnedSpeakersV1(
	inputsValue: unknown,
	_settings: Settings<'identify-speakers'>,
): AssistanceTranscript {
	const inputs = ownedExactRecord(inputsValue, ['transcript', 'speaker-turns'],
		'attribute-speakers inputs');
	const transcript = reviewOwnedAssistanceTranscriptV1(inputs.transcript);
	const wrapper = ownedExactRecord(inputs['speaker-turns'], SPEAKER_WRAPPER_FIELDS,
		'speaker-turns source wrapper');
	exactV1(wrapper.schemaVersion, 'speaker-turns source wrapper');
	const sourceSampleRate = ownedInteger(wrapper.sourceSampleRate, 1, 768_000,
		'speaker-turns source sample rate');
	if (sourceSampleRate !== transcript.sampleRate) {
		throw new RangeError('Speaker turns and transcript disagree on source sample rate.');
	}
	const sourceStartFrame = ownedInteger(wrapper.sourceStartFrame, 0, Number.MAX_SAFE_INTEGER,
		'speaker-turns source start frame');
	const result = ownedExactRecord(wrapper.result, SPEAKER_RESULT_FIELDS, 'speaker-turns result');
	if (result.kind !== 'speaker-turns') throw new TypeError('The speaker-turns result kind is invalid.');
	const turnRate = ownedInteger(result.sampleRate, 1, 768_000, 'speaker-turns sample rate');
	let priorRaw: Readonly<{ start: number; end: number; speakerId: number }> | null = null;
	const turns = ownedArray(result.turns, ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_ITEMS,
		'speaker turns').map((candidate, index) => {
		const label = `speaker turn ${String(index)}`;
		const turn = ownedExactRecord(candidate, SPEAKER_TURN_FIELDS, label);
		const start = ownedInteger(turn.startSample, 0, Number.MAX_SAFE_INTEGER, `${label} start`);
		const count = ownedInteger(turn.sampleCount, 1, Number.MAX_SAFE_INTEGER, `${label} count`);
		const end = ownedSafeAdd(start, count, label);
		const speakerId = ownedInteger(turn.speakerId, 0, Number.MAX_SAFE_INTEGER - 1,
			`${label} speaker ID`);
		const raw = Object.freeze({ start, end, speakerId });
		if (priorRaw && compareSpeakerTurns(priorRaw, raw) > 0) {
			throw new RangeError('Speaker turns must preserve stable model-result order.');
		}
		priorRaw = raw;
		return Object.freeze({
			startFrame: ownedSafeAdd(sourceStartFrame, Number(scaleSampleFrame(
				start, turnRate, sourceSampleRate, 'enclosingStart')),
			`${label} source start`),
			endFrame: ownedSafeAdd(sourceStartFrame, Number(scaleSampleFrame(
				end, turnRate, sourceSampleRate, 'enclosingEnd')),
			`${label} source end`),
			speakerId,
		});
	});
	return attributeTranscriptSpeakers(transcript, {
		sampleRate: sourceSampleRate, turns: Object.freeze(turns),
	});
}

export function mergeOwnedReactionRangesV1(
	inputsValue: unknown,
	settings: Settings<'mark-reactions'>,
): AssistanceReactionRangesV1 {
	const inputs = ownedExactRecord(inputsValue, ['audio-tags'], 'merge-reaction-ranges inputs');
	const threshold = ownedUnit(settings.threshold, 'authenticated reaction threshold');
	const ranges = createAssistanceReactionProposals(inputs['audio-tags'] as never, { threshold });
	return Object.freeze({
		schemaVersion: 1, kind: 'reaction-ranges', sampleRate: ASSISTANCE_AUDIO_TAG_SAMPLE_RATE,
		threshold, ranges,
	});
}

export function chunkOwnedTranscriptV1(
	inputsValue: unknown,
	_settings: Settings<'index-transcript'>,
	tokenizer: AssistanceTokenizerV1 | null,
): AssistanceTextChunksV1 {
	const inputs = ownedExactRecord(inputsValue, ['transcript'], 'chunk-transcript inputs');
	const transcript = reviewOwnedAssistanceTranscriptV1(inputs.transcript);
	if (transcript.segments.length === 0) return Object.freeze({
		schemaVersion: 1, kind: 'text-chunks', sourceId: transcript.sourceId,
		sampleRate: transcript.sampleRate, chunks: Object.freeze([]),
	});
	if (!tokenizer) throw new Error('Transcript chunking requires the exact installed tokenizer adapter.');
	const chunks = createAssistanceNomicDocumentChunksV1(transcript, tokenizer).map((chunk) =>
		Object.freeze({ ...chunk, label: chunkLabel(transcript, chunk.segmentStartIndex,
			chunk.segmentEndIndexExclusive) }));
	return Object.freeze({
		schemaVersion: 1, kind: 'text-chunks', sourceId: transcript.sourceId,
		sampleRate: transcript.sampleRate, chunks: Object.freeze(chunks),
	});
}

export function publishOwnedTranscriptIndexV1(
	inputsValue: unknown,
	_settings: Settings<'index-transcript'>,
): AssistanceTranscriptIndexV1 {
	const inputs = ownedExactRecord(inputsValue, ['text-chunks', 'embeddings'],
		'publish-transcript-index inputs');
	const chunks = reviewOwnedTextChunksV1(inputs['text-chunks']);
	if (!(inputs.embeddings instanceof ArrayBuffer) && !ArrayBuffer.isView(inputs.embeddings)) {
		throw new TypeError('Transcript-index embeddings require the strict binary matrix body.');
	}
	const matrixValue = inputs.embeddings as ArrayBuffer | ArrayBufferView;
	const matrix = reviewAssistanceEmbeddingMatrixV1(matrixValue);
	if (matrix.rowCount !== chunks.chunks.length) {
		throw new RangeError('Transcript index chunk and embedding row inventories disagree.');
	}
	const bytes = binaryBytes(matrixValue);
	const embedding = Object.freeze({
		schemaVersion: 1 as const, byteLength: bytes.byteLength,
		sha256: bytesToHex(sha256(bytes)), rowCount: matrix.rowCount, dimensions: matrix.dimensions,
	});
	const rows = chunks.chunks.map((chunk, embeddingRow) => Object.freeze({
		resultId: chunk.chunkId,
		timelineFrame: chunk.sourceStartFrame,
		sourceEndFrame: chunk.sourceEndFrame,
		segmentStartIndex: chunk.segmentStartIndex,
		segmentEndIndexExclusive: chunk.segmentEndIndexExclusive,
		label: chunk.label,
		embeddingRow,
	}));
	return Object.freeze({
		schemaVersion: 1, kind: 'transcript-index', sourceId: chunks.sourceId,
		sampleRate: chunks.sampleRate, embedding, rows: Object.freeze(rows),
	});
}

export function proposeOwnedTempoMapV1(
	inputsValue: unknown,
	settings: Settings<'detect-beats-tempo'>,
): Readonly<{ beatLabels: AssistanceBeatLabelsV1; tempoMapDiff: AssistanceTempoMapDiffV1 }> {
	const inputs = ownedExactRecord(inputsValue, ['beat-grid'], 'propose-tempo-map inputs');
	const reviewed = reviewAssistanceBeatGridV1(inputs['beat-grid']);
	const points = createAssistanceBeatProposals(reviewed);
	return Object.freeze({
		beatLabels: Object.freeze({
			schemaVersion: 1, kind: 'beat-labels',
			publicationRequested: ownedBoolean(settings.publishBeatLabels,
				'authenticated beat-label publication setting'),
			points,
		}),
		tempoMapDiff: Object.freeze({
			schemaVersion: 1, kind: 'tempo-map-diff',
			applicationRequested: ownedBoolean(settings.applyTempoMap,
				'authenticated tempo-map application setting'),
			proposal: reviewed.tempoProposal,
		}),
	});
}

export function reviewOwnedTextChunksV1(value: unknown): AssistanceTextChunksV1 {
	const row = ownedExactRecord(value, ['schemaVersion', 'kind', 'sourceId', 'sampleRate', 'chunks'],
		'text-chunks result');
	exactV1(row.schemaVersion, 'text-chunks result');
	if (row.kind !== 'text-chunks') throw new TypeError('The text-chunks result kind is invalid.');
	const sourceId = ownedText(row.sourceId, 256, 'text-chunks source ID');
	const sampleRate = ownedInteger(row.sampleRate, 1, 768_000, 'text-chunks sample rate');
	let priorStart = -1;
	const seen = new Set<string>();
	const chunks = ownedArray(row.chunks, ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_ITEMS,
		'text chunks').map((candidate, index) => {
		const label = `text chunk ${String(index)}`;
		const chunk = ownedExactRecord(candidate, TEXT_CHUNK_FIELDS, label);
		exactV1(chunk.schemaVersion, label);
		const chunkId = ownedText(chunk.chunkId, 256, `${label} ID`);
		if (chunkId !== `transcript:${String(index)}` || seen.has(chunkId)) {
			throw new TypeError('Text chunk IDs must match stable chunk order and remain unique.');
		}
		seen.add(chunkId);
		const sourceStartFrame = ownedInteger(chunk.sourceStartFrame, 0, Number.MAX_SAFE_INTEGER,
			`${label} source start`);
		const sourceEndFrame = ownedInteger(chunk.sourceEndFrame, 1, Number.MAX_SAFE_INTEGER,
			`${label} source end`);
		if (sourceEndFrame <= sourceStartFrame || sourceStartFrame < priorStart) {
			throw new RangeError('Text chunks must retain ordered positive source ranges.');
		}
		priorStart = sourceStartFrame;
		const segmentStartIndex = ownedInteger(chunk.segmentStartIndex, 0,
			Number.MAX_SAFE_INTEGER, `${label} first segment`);
		const segmentEndIndexExclusive = ownedInteger(chunk.segmentEndIndexExclusive,
			segmentStartIndex + 1, Number.MAX_SAFE_INTEGER, `${label} final segment`);
		const inputIds = ownedArray(chunk.inputIds, 256, `${label} token IDs`, 1).map(
			(token, tokenIndex) => ownedInteger(token, 0, Number.MAX_SAFE_INTEGER,
				`${label} token ${String(tokenIndex)}`));
		return Object.freeze({
			schemaVersion: 1 as const, chunkId, sourceStartFrame, sourceEndFrame,
			segmentStartIndex, segmentEndIndexExclusive, inputIds: Object.freeze(inputIds),
			label: ownedText(chunk.label, MAXIMUM_LABEL_UNITS, `${label} label`),
		});
	});
	return Object.freeze({
		schemaVersion: 1, kind: 'text-chunks', sourceId, sampleRate,
		chunks: Object.freeze(chunks),
	});
}

function alignedCaptionWords(
	value: unknown,
	transcript: AssistanceTranscript,
	settings: Settings<'transcribe-captions'>,
): readonly (readonly Readonly<{
	text: string; startFrame: number; endFrame: number; confidence: number | null;
}>[])[] {
	if (settings.recognizer !== 'whisper' || settings.language !== 'en'
		|| settings.englishWhisperAlignment !== 'when-installed') {
		throw new RangeError('Word alignment is admitted only for explicitly selected English Whisper.');
	}
	const wrapper = ownedExactRecord(value, ALIGNMENT_WRAPPER_FIELDS, 'word-alignment source wrapper');
	exactV1(wrapper.schemaVersion, 'word-alignment source wrapper');
	const sourceRate = ownedInteger(wrapper.sourceSampleRate, 1, 768_000,
		'word-alignment source sample rate');
	if (sourceRate !== transcript.sampleRate) {
		throw new RangeError('Word alignment and transcript disagree on source sample rate.');
	}
	const sourceStart = ownedInteger(wrapper.sourceStartFrame, 0, Number.MAX_SAFE_INTEGER,
		'word-alignment source start frame');
	const alignment = reviewAssistanceWordAlignmentV1(wrapper.alignment);
	const expected = transcript.segments.flatMap((segment, segmentIndex) =>
		segment.words.map((word, wordIndex) => ({ segment, segmentIndex, word, wordIndex })));
	if (alignment.words.length !== expected.length) {
		throw new RangeError('Word alignment must cover every transcript word exactly once.');
	}
	const bySegment = transcript.segments.map(() => [] as Array<Readonly<{
		text: string; startFrame: number; endFrame: number; confidence: number | null;
	}>>);
	for (const [index, aligned] of alignment.words.entries()) {
		const authority = expected[index]!;
		if (aligned.segmentIndex !== authority.segmentIndex || aligned.wordIndex !== authority.wordIndex
			|| aligned.text !== authority.word.text) {
			throw new RangeError('Word alignment changed transcript word identity or order.');
		}
		const startFrame = ownedSafeAdd(sourceStart, Number(scaleSampleFrame(
			aligned.startSample, ASSISTANCE_ALIGNMENT_SAMPLE_RATE, sourceRate, 'enclosingStart')),
		'word-alignment source start');
		const endFrame = ownedSafeAdd(sourceStart, Number(scaleSampleFrame(
			aligned.endSample, ASSISTANCE_ALIGNMENT_SAMPLE_RATE, sourceRate, 'enclosingEnd')),
		'word-alignment source end');
		if (startFrame < authority.segment.startFrame || endFrame > authority.segment.endFrame
			|| endFrame <= startFrame) {
			throw new RangeError('Word alignment exceeds its transcript segment timing authority.');
		}
		bySegment[authority.segmentIndex]!.push(Object.freeze({
			text: aligned.text, startFrame, endFrame, confidence: aligned.confidence,
		}));
	}
	return Object.freeze(bySegment.map((words) => Object.freeze(words)));
}

function cleanupVadProposals(
	value: unknown,
	minimumSamples: number,
	paddingSamples: number,
): Readonly<{
	sourceSampleRate: number; sourceStartFrame: number; sourceEndFrame: number;
	proposals: readonly DisfluencyProposal[];
}> {
	const wrapper = ownedExactRecord(value, VAD_WRAPPER_FIELDS, 'voice-activity source wrapper');
	exactV1(wrapper.schemaVersion, 'voice-activity source wrapper');
	const sourceSampleRate = ownedInteger(wrapper.sourceSampleRate, 1, 768_000,
		'voice-activity source sample rate');
	const sourceStartFrame = ownedInteger(wrapper.sourceStartFrame, 0, Number.MAX_SAFE_INTEGER,
		'voice-activity source start frame');
	const sourceEndFrame = ownedInteger(wrapper.sourceEndFrame, sourceStartFrame + 1,
		Number.MAX_SAFE_INTEGER, 'voice-activity source end frame');
	const result = ownedExactRecord(wrapper.result, VAD_RESULT_FIELDS, 'voice-activity result');
	if (result.kind !== 'voice-activity' || result.sampleRate !== ASSISTANCE_ALIGNMENT_SAMPLE_RATE) {
		throw new RangeError('Voice activity requires the exact reviewed 16 kHz result.');
	}
	const selectionSamples = Number(scaleSampleFrame(sourceEndFrame - sourceStartFrame,
		sourceSampleRate, ASSISTANCE_ALIGNMENT_SAMPLE_RATE, 'point'));
	const segments = ownedArray(result.segments, ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_ITEMS,
		'voice-activity segments').map((candidate, index) => {
		const label = `voice-activity segment ${String(index)}`;
		const segment = ownedExactRecord(candidate, RANGE_FIELDS, label);
		const startFrame = ownedInteger(segment.startSample, 0, selectionSamples, `${label} start`);
		const count = ownedInteger(segment.sampleCount, 1, Number.MAX_SAFE_INTEGER, `${label} count`);
		return Object.freeze({ startFrame, endFrame: ownedSafeAdd(startFrame, count, label) });
	});
	const relative = voiceActivitySilenceProposals({
		sampleRate: ASSISTANCE_ALIGNMENT_SAMPLE_RATE,
		selectionStartFrame: 0,
		selectionEndFrame: selectionSamples,
		segments: Object.freeze(segments),
	}, { minimumFrames: minimumSamples, paddingFrames: paddingSamples });
	const proposals = relative.flatMap((proposal) => {
		const startFrame = ownedSafeAdd(sourceStartFrame, Number(scaleSampleFrame(
			proposal.startFrame, ASSISTANCE_ALIGNMENT_SAMPLE_RATE, sourceSampleRate, 'enclosingEnd')),
		'cleanup silence start');
		const endFrame = ownedSafeAdd(sourceStartFrame, Number(scaleSampleFrame(
			proposal.endFrame, ASSISTANCE_ALIGNMENT_SAMPLE_RATE, sourceSampleRate, 'enclosingStart')),
		'cleanup silence end');
		return endFrame <= startFrame ? [] : [Object.freeze({
			...proposal, id: `vad-silence-${String(startFrame)}-${String(endFrame)}`,
			startFrame, endFrame,
		})];
	});
	return Object.freeze({
		sourceSampleRate, sourceStartFrame, sourceEndFrame, proposals: Object.freeze(proposals),
	});
}

function chunkLabel(transcript: AssistanceTranscript, start: number, end: number): string {
	const value = transcript.segments.slice(start, end).map(({ text }) => text.trim())
		.join(' ').replace(/\s+/gu, ' ').trim();
	return [...value].slice(0, MAXIMUM_LABEL_UNITS).join('');
}

function binaryBytes(value: ArrayBuffer | ArrayBufferView): Uint8Array {
	return value instanceof ArrayBuffer
		? new Uint8Array(value)
		: new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function compareProposals(left: DisfluencyProposal, right: DisfluencyProposal): number {
	return left.startFrame - right.startFrame || left.endFrame - right.endFrame
		|| left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id);
}

function compareSpeakerTurns(
	left: Readonly<{ start: number; end: number; speakerId: number }>,
	right: Readonly<{ start: number; end: number; speakerId: number }>,
): number {
	return left.start - right.start || left.speakerId - right.speakerId || left.end - right.end;
}

function exactV1(value: unknown, label: string): void {
	if (value !== 1) throw new TypeError(`The ${label} schema version is unsupported.`);
}
