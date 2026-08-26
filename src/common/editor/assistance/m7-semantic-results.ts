/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict, renderer-independent semantic formats for Milestone-7 model output. */

export const ASSISTANCE_WORD_ALIGNMENT_SCHEMA_VERSION = 1;
export const ASSISTANCE_AUDIO_TAGS_SCHEMA_VERSION = 1;
export const ASSISTANCE_BEAT_GRID_SCHEMA_VERSION = 1;
export const ASSISTANCE_EDITORIAL_PROPOSAL_SCHEMA_VERSION = 1;

export const ASSISTANCE_ALIGNMENT_SAMPLE_RATE = 16_000;
export const ASSISTANCE_AUDIO_TAG_SAMPLE_RATE = 32_000;
export const ASSISTANCE_AUDIO_TAG_WINDOW_SAMPLES = 32_000;
export const ASSISTANCE_BEAT_SAMPLE_RATE = 22_050;

export const MAXIMUM_ASSISTANCE_ALIGNMENT_WORDS = 100_000;
export const MAXIMUM_ASSISTANCE_AUDIO_TAG_WINDOWS = 100_000;
export const MAXIMUM_ASSISTANCE_BEAT_POINTS = 100_000;
export const MAXIMUM_ASSISTANCE_TEMPO_CHANGES = 10_000;
export const MAXIMUM_ASSISTANCE_EDITORIAL_CANDIDATES = 20;
export const MAXIMUM_ASSISTANCE_EDITORIAL_CHAPTERS = 12;

export interface AssistanceAlignedWordV1 {
	readonly segmentIndex: number;
	readonly wordIndex: number;
	readonly text: string;
	readonly startSample: number;
	readonly endSample: number;
	readonly confidence: number | null;
}

export interface AssistanceWordAlignmentV1 {
	readonly schemaVersion: typeof ASSISTANCE_WORD_ALIGNMENT_SCHEMA_VERSION;
	readonly sampleRate: typeof ASSISTANCE_ALIGNMENT_SAMPLE_RATE;
	readonly words: readonly AssistanceAlignedWordV1[];
}

export interface AssistanceExcitementScoresV1 {
	readonly laughter: number;
	readonly applause: number;
	readonly cheering: number;
}

export interface AssistanceAudioTagWindowV1 {
	readonly startSample: number;
	readonly scores: AssistanceExcitementScoresV1;
}

export interface AssistanceAudioTagsV1 {
	readonly schemaVersion: typeof ASSISTANCE_AUDIO_TAGS_SCHEMA_VERSION;
	readonly sampleRate: typeof ASSISTANCE_AUDIO_TAG_SAMPLE_RATE;
	readonly windowSamples: typeof ASSISTANCE_AUDIO_TAG_WINDOW_SAMPLES;
	readonly windows: readonly AssistanceAudioTagWindowV1[];
}

export interface AssistanceBeatPointV1 {
	readonly sample: number;
	readonly kind: 'beat' | 'downbeat';
	readonly confidence: number | null;
}

export interface AssistanceTempoChangeV1 {
	readonly startSample: number;
	readonly bpm: number;
}

export type AssistanceTempoProposalV1 =
	| Readonly<{ readonly kind: 'constant'; readonly bpm: number }>
	| Readonly<{
		readonly kind: 'piecewise-held';
		readonly changes: readonly AssistanceTempoChangeV1[];
	}>;

export interface AssistanceBeatGridV1 {
	readonly schemaVersion: typeof ASSISTANCE_BEAT_GRID_SCHEMA_VERSION;
	readonly sampleRate: typeof ASSISTANCE_BEAT_SAMPLE_RATE;
	readonly points: readonly AssistanceBeatPointV1[];
	readonly tempoProposal: AssistanceTempoProposalV1 | null;
}

export interface AssistanceEditorialCandidateV1 {
	readonly candidateId: string;
	readonly title: string | null;
	readonly hook: string | null;
	readonly chapters: readonly string[];
	readonly explanation: string | null;
}

export interface AssistanceEditorialProposalV1 {
	readonly schemaVersion: typeof ASSISTANCE_EDITORIAL_PROPOSAL_SCHEMA_VERSION;
	/** Array order is the optional model's reranking; no timing may be authored here. */
	readonly candidates: readonly AssistanceEditorialCandidateV1[];
}

const ALIGNMENT_FIELDS = Object.freeze(['schemaVersion', 'sampleRate', 'words']);
const ALIGNED_WORD_FIELDS = Object.freeze([
	'segmentIndex', 'wordIndex', 'text', 'startSample', 'endSample', 'confidence',
]);
const AUDIO_TAG_FIELDS = Object.freeze([
	'schemaVersion', 'sampleRate', 'windowSamples', 'windows',
]);
const AUDIO_TAG_WINDOW_FIELDS = Object.freeze(['startSample', 'scores']);
const EXCITEMENT_SCORE_FIELDS = Object.freeze(['laughter', 'applause', 'cheering']);
const BEAT_GRID_FIELDS = Object.freeze([
	'schemaVersion', 'sampleRate', 'points', 'tempoProposal',
]);
const BEAT_POINT_FIELDS = Object.freeze(['sample', 'kind', 'confidence']);
const CONSTANT_TEMPO_FIELDS = Object.freeze(['kind', 'bpm']);
const HELD_TEMPO_FIELDS = Object.freeze(['kind', 'changes']);
const TEMPO_CHANGE_FIELDS = Object.freeze(['startSample', 'bpm']);
const EDITORIAL_FIELDS = Object.freeze(['schemaVersion', 'candidates']);
const EDITORIAL_CANDIDATE_FIELDS = Object.freeze([
	'candidateId', 'title', 'hook', 'chapters', 'explanation',
]);
const CANDIDATE_ID = /^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,127}$/u;
const URI_OR_PATH = /(?:\b(?:data|file|https?|javascript):|(?:^|\s)(?:\/|\.\.\/|[a-z]:[\\/]))/iu;
const MARKUP = /(?:<[^>]*>|```|\[[^\]]*\]\([^)]*\))/u;
const CONTROL_OR_CODE = /[\u0000-\u001f\u007f`{}\\]/u;
const AUTHORED_TIMING = /(?:^|\s)(?:(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?|frame\s+\d+|\d+(?:\.\d+)?\s*(?:frames?|hours?|milliseconds?|minutes?|ms|seconds?))(?=$|[\s,.;)])/iu;
const EXECUTABLE_TEXT = /(?:#!|\$\(|<\?(?:php|xml)|\b(?:bash|cmd(?:\.exe)?|powershell|sh)\s+-c\b)/iu;

export function reviewAssistanceWordAlignmentV1(value: unknown): AssistanceWordAlignmentV1 {
	const record = exactRecord(value, ALIGNMENT_FIELDS, 'word-alignment result');
	exactVersion(record.schemaVersion, ASSISTANCE_WORD_ALIGNMENT_SCHEMA_VERSION, 'word-alignment');
	exactRate(record.sampleRate, ASSISTANCE_ALIGNMENT_SAMPLE_RATE, 'word-alignment');
	const candidates = boundedArray(record.words, MAXIMUM_ASSISTANCE_ALIGNMENT_WORDS,
		'word-alignment word inventory');
	let priorEnd = -1;
	let priorSegment = -1;
	let priorWord = -1;
	const words = candidates.map((candidate, index): AssistanceAlignedWordV1 => {
		const label = `word-alignment word ${String(index)}`;
		const row = exactRecord(candidate, ALIGNED_WORD_FIELDS, label);
		const segmentIndex = safeInteger(row.segmentIndex, 0, Number.MAX_SAFE_INTEGER,
			`${label} segment index`);
		const wordIndex = safeInteger(row.wordIndex, 0, Number.MAX_SAFE_INTEGER,
			`${label} word index`);
		if (segmentIndex < priorSegment || (segmentIndex === priorSegment && wordIndex <= priorWord)) {
			throw new RangeError('Word-alignment words must preserve strict transcript order.');
		}
		const startSample = safeInteger(row.startSample, 0, Number.MAX_SAFE_INTEGER,
			`${label} start sample`);
		const endSample = safeInteger(row.endSample, 1, Number.MAX_SAFE_INTEGER,
			`${label} end sample`);
		if (endSample <= startSample || startSample < priorEnd) {
			throw new RangeError('Word-alignment timing must be positive, ordered, and non-overlapping.');
		}
		const result = Object.freeze({
			segmentIndex,
			wordIndex,
			text: boundedText(row.text, 512, `${label} text`),
			startSample,
			endSample,
			confidence: nullableUnitInterval(row.confidence, `${label} confidence`),
		});
		priorSegment = segmentIndex;
		priorWord = wordIndex;
		priorEnd = endSample;
		return result;
	});
	return Object.freeze({
		schemaVersion: ASSISTANCE_WORD_ALIGNMENT_SCHEMA_VERSION,
		sampleRate: ASSISTANCE_ALIGNMENT_SAMPLE_RATE,
		words: Object.freeze(words),
	});
}

export function reviewAssistanceAudioTagsV1(value: unknown): AssistanceAudioTagsV1 {
	const record = exactRecord(value, AUDIO_TAG_FIELDS, 'audio-tags result');
	exactVersion(record.schemaVersion, ASSISTANCE_AUDIO_TAGS_SCHEMA_VERSION, 'audio-tags');
	exactRate(record.sampleRate, ASSISTANCE_AUDIO_TAG_SAMPLE_RATE, 'audio-tags');
	if (record.windowSamples !== ASSISTANCE_AUDIO_TAG_WINDOW_SAMPLES) {
		throw new RangeError('Audio-tag windows must cover exactly one second.');
	}
	const candidates = boundedArray(record.windows, MAXIMUM_ASSISTANCE_AUDIO_TAG_WINDOWS,
		'audio-tag window inventory');
	let priorStart = -1;
	const windows = candidates.map((candidate, index): AssistanceAudioTagWindowV1 => {
		const label = `audio-tag window ${String(index)}`;
		const row = exactRecord(candidate, AUDIO_TAG_WINDOW_FIELDS, label);
		const startSample = safeInteger(row.startSample, 0, Number.MAX_SAFE_INTEGER,
			`${label} start sample`);
		if (startSample % ASSISTANCE_AUDIO_TAG_WINDOW_SAMPLES !== 0) {
			throw new RangeError(`${label} must start on the exact one-second grid.`);
		}
		if (startSample <= priorStart) {
			throw new RangeError('Audio-tag windows must be strictly ordered.');
		}
		const scoreRecord = exactRecord(row.scores, EXCITEMENT_SCORE_FIELDS, `${label} scores`);
		const scores = Object.freeze({
			laughter: unitInterval(scoreRecord.laughter, `${label} laughter score`),
			applause: unitInterval(scoreRecord.applause, `${label} applause score`),
			cheering: unitInterval(scoreRecord.cheering, `${label} cheering score`),
		});
		priorStart = startSample;
		return Object.freeze({ startSample, scores });
	});
	return Object.freeze({
		schemaVersion: ASSISTANCE_AUDIO_TAGS_SCHEMA_VERSION,
		sampleRate: ASSISTANCE_AUDIO_TAG_SAMPLE_RATE,
		windowSamples: ASSISTANCE_AUDIO_TAG_WINDOW_SAMPLES,
		windows: Object.freeze(windows),
	});
}

export function reviewAssistanceBeatGridV1(value: unknown): AssistanceBeatGridV1 {
	const record = exactRecord(value, BEAT_GRID_FIELDS, 'beat-grid result');
	exactVersion(record.schemaVersion, ASSISTANCE_BEAT_GRID_SCHEMA_VERSION, 'beat-grid');
	exactRate(record.sampleRate, ASSISTANCE_BEAT_SAMPLE_RATE, 'beat-grid');
	const candidates = boundedArray(record.points, MAXIMUM_ASSISTANCE_BEAT_POINTS,
		'beat-grid point inventory');
	let priorSample = -1;
	const points = candidates.map((candidate, index): AssistanceBeatPointV1 => {
		const label = `beat-grid point ${String(index)}`;
		const row = exactRecord(candidate, BEAT_POINT_FIELDS, label);
		const sample = safeInteger(row.sample, 0, Number.MAX_SAFE_INTEGER, `${label} sample`);
		if (sample <= priorSample) throw new RangeError('Beat-grid points must be strictly ordered.');
		if (row.kind !== 'beat' && row.kind !== 'downbeat') {
			throw new TypeError(`${label} kind is unsupported.`);
		}
		priorSample = sample;
		return Object.freeze({
			sample,
			kind: row.kind,
			confidence: nullableUnitInterval(row.confidence, `${label} confidence`),
		});
	});
	const tempoProposal = reviewTempoProposal(record.tempoProposal);
	if (points.length === 0 && tempoProposal !== null) {
		throw new RangeError('An empty beat grid cannot carry a tempo proposal.');
	}
	return Object.freeze({
		schemaVersion: ASSISTANCE_BEAT_GRID_SCHEMA_VERSION,
		sampleRate: ASSISTANCE_BEAT_SAMPLE_RATE,
		points: Object.freeze(points),
		tempoProposal,
	});
}

export function reviewAssistanceEditorialProposalV1(
	value: unknown,
	allowedCandidateIdsValue: readonly string[],
): AssistanceEditorialProposalV1 {
	const record = exactRecord(value, EDITORIAL_FIELDS, 'editorial proposal');
	exactVersion(record.schemaVersion, ASSISTANCE_EDITORIAL_PROPOSAL_SCHEMA_VERSION,
		'editorial proposal');
	const authority = reviewAssistanceEditorialCandidateAuthorityV1(allowedCandidateIdsValue);
	const allowed = new Set(authority);
	const candidatesValue = boundedArray(record.candidates,
		MAXIMUM_ASSISTANCE_EDITORIAL_CANDIDATES, 'editorial candidate inventory');
	if (candidatesValue.length !== allowed.size) {
		throw new RangeError('Editorial output must rerank every authorized candidate exactly once.');
	}
	const seen = new Set<string>();
	const candidates = candidatesValue.map((candidate, index): AssistanceEditorialCandidateV1 => {
		const label = `editorial candidate ${String(index)}`;
		const row = exactRecord(candidate, EDITORIAL_CANDIDATE_FIELDS, label);
		const id = candidateId(row.candidateId, `${label} id`);
		if (!allowed.has(id)) throw new RangeError('Editorial output names an unknown candidate id.');
		if (seen.has(id)) throw new TypeError('Editorial output repeats a candidate id.');
		seen.add(id);
		const chaptersValue = boundedArray(row.chapters, MAXIMUM_ASSISTANCE_EDITORIAL_CHAPTERS,
			`${label} chapter inventory`);
		const chapters = chaptersValue.map((chapter, chapterIndex) => inertText(
			chapter, 160, `${label} chapter ${String(chapterIndex)}`,
		));
		return Object.freeze({
			candidateId: id,
			title: nullableInertText(row.title, 160, `${label} title`),
			hook: nullableInertText(row.hook, 512, `${label} hook`),
			chapters: Object.freeze(chapters),
			explanation: nullableInertText(row.explanation, 2_048, `${label} explanation`),
		});
	});
	if (seen.size !== allowed.size) {
		throw new RangeError('Editorial output omitted an authorized candidate id.');
	}
	return Object.freeze({
		schemaVersion: ASSISTANCE_EDITORIAL_PROPOSAL_SCHEMA_VERSION,
		candidates: Object.freeze(candidates),
	});
}

/** Re-admit the exact top-candidate authority before any optional model invocation. */
export function reviewAssistanceEditorialCandidateAuthorityV1(value: unknown): readonly string[] {
	if (!Array.isArray(value) || value.length < 1
		|| value.length > MAXIMUM_ASSISTANCE_EDITORIAL_CANDIDATES) {
		throw new RangeError('Editorial candidate authority exceeds its exact bound.');
	}
	const reviewed = value.map((id, index) =>
		candidateId(id, `editorial candidate authority ${String(index)}`));
	if (new Set(reviewed).size !== reviewed.length) {
		throw new TypeError('Editorial candidate authority repeats an identity.');
	}
	return Object.freeze(reviewed);
}

function reviewTempoProposal(value: unknown): AssistanceTempoProposalV1 | null {
	if (value === null) return null;
	const shape = plainRecord(value, 'tempo proposal');
	if (shape.kind === 'constant') {
		const row = exactRecord(shape, CONSTANT_TEMPO_FIELDS, 'constant tempo proposal');
		return Object.freeze({ kind: 'constant', bpm: bpm(row.bpm, 'constant tempo') });
	}
	if (shape.kind !== 'piecewise-held') throw new TypeError('The tempo proposal kind is unsupported.');
	const row = exactRecord(shape, HELD_TEMPO_FIELDS, 'piecewise-held tempo proposal');
	const values = boundedArray(row.changes, MAXIMUM_ASSISTANCE_TEMPO_CHANGES,
		'piecewise-held tempo changes');
	if (values.length < 1) throw new RangeError('A piecewise-held tempo proposal needs a change.');
	let priorStart = -1;
	const changes = values.map((candidate, index): AssistanceTempoChangeV1 => {
		const label = `tempo change ${String(index)}`;
		const change = exactRecord(candidate, TEMPO_CHANGE_FIELDS, label);
		const startSample = safeInteger(change.startSample, 0, Number.MAX_SAFE_INTEGER,
			`${label} start sample`);
		if (index === 0 && startSample !== 0) {
			throw new RangeError('A piecewise-held tempo proposal must begin at sample zero.');
		}
		if (startSample <= priorStart) throw new RangeError('Tempo changes must be strictly ordered.');
		priorStart = startSample;
		return Object.freeze({ startSample, bpm: bpm(change.bpm, label) });
	});
	return Object.freeze({ kind: 'piecewise-held', changes: Object.freeze(changes) });
}

function bpm(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 20 || value > 400) {
		throw new RangeError(`The ${label} BPM is outside its bounded domain.`);
	}
	return value;
}

function exactVersion(value: unknown, expected: number, label: string): void {
	if (value !== expected) throw new TypeError(`The ${label} schema version is unsupported.`);
}

function exactRate(value: unknown, expected: number, label: string): void {
	if (value !== expected) throw new RangeError(`The ${label} sample rate must be exactly ${String(expected)}.`);
}

function nullableUnitInterval(value: unknown, label: string): number | null {
	return value === null ? null : unitInterval(value, label);
}

function unitInterval(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError(`The ${label} must be finite and within the unit interval.`);
	}
	return value;
}

function nullableInertText(value: unknown, maximum: number, label: string): string | null {
	return value === null ? null : inertText(value, maximum, label);
}

function inertText(value: unknown, maximum: number, label: string): string {
	const result = boundedText(value, maximum, label);
	if (CONTROL_OR_CODE.test(result) || MARKUP.test(result) || URI_OR_PATH.test(result)
		|| AUTHORED_TIMING.test(result) || EXECUTABLE_TEXT.test(result)) {
		throw new TypeError(`The ${label} must be inert plain text without timing, markup, executable, URI, or path content.`);
	}
	return result;
}

function boundedText(value: unknown, maximum: number, label: string): string {
	if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
		throw new TypeError(`The ${label} is not bounded non-empty text.`);
	}
	return value;
}

function candidateId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !CANDIDATE_ID.test(value)) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value;
}

function safeInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is outside its safe integer bound.`);
	}
	return Number(value);
}

function boundedArray(value: unknown, maximum: number, label: string): readonly unknown[] {
	if (!Array.isArray(value) || value.length > maximum) {
		throw new RangeError(`The ${label} exceeds its exact bound.`);
	}
	return value;
}

function exactRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
): Readonly<Record<string, unknown>> {
	const record = plainRecord(value, label);
	const keys = Reflect.ownKeys(record);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return record;
}

function plainRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	return value as Readonly<Record<string, unknown>>;
}
