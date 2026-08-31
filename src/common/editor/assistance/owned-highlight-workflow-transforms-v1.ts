/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pure deterministic signal gathering, highlight ranking, and proposal assembly. */

import { scaleSampleFrame } from '../timeline-time.ts';
import { reviewAssistanceEmbeddingMatrixV1 } from './binary-formats-v1.ts';
import {
	reviewAssistanceSourceTimeRowsV1,
	type ReviewedAssistanceSourceTimeRowsV1,
} from './source-time-rows-v1.ts';
import {
	HIGHLIGHT_RANKING_V1_SPEECHLESS_WEIGHTS,
	rankAssistanceHighlightsV1,
} from './highlight-ranking-v1.ts';
import {
	reviewAssistanceAudioTagsV1,
	reviewAssistanceEditorialProposalV1,
} from './m7-semantic-results.ts';
import {
	reviewAssistanceAcceptedReframeDerivativeV1,
	type AssistanceAcceptedReframeDerivativeV1,
} from './reframe-derivative-v1.ts';
import type {
	AssistanceOwnedHighlightCandidatesV1,
	AssistanceOwnedHighlightProposalsV1,
	AssistanceOwnedHighlightSignalsV1,
} from './owned-video-highlight-transform-types-v1.ts';
import {
	assertOwnedHighlightCropAspectV1,
	assertOwnedHighlightReframeVideoAuthorityV1,
	createOwnedHighlightCropKeyframesV1,
} from './owned-highlight-crop-evidence-v1.ts';
import {
	dimensions,
	reviewOwnedHighlightCandidatesV1,
	reviewOwnedHighlightSignalsV1,
	stableId,
} from './owned-video-highlight-validation-v1.ts';
import {
	ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_PROPOSALS,
	ownedArray,
	ownedExactRecord,
	ownedInteger,
	ownedSafeAdd,
	ownedUnit,
	reviewOwnedAssistanceTranscriptV1,
} from './owned-transform-validation-v1.ts';
import { reviewAssistanceShotBoundariesV1 } from './shot-boundaries-v1.ts';
import type { AssistanceWorkflowSettingsV1 } from './workflow-settings-v1.ts';

type Settings = Extract<AssistanceWorkflowSettingsV1, { readonly workflowId: 'make-highlights' }>;

const GATHER_FIELDS = Object.freeze([
	'video', 'audio', 'transcript', 'shot-boundaries', 'audio-tags', 'reaction-ranges', 'embeddings',
] as const);
const VIDEO_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'sourceId', 'sampleRate', 'timescale', 'sourceSize',
	'videoOccurrenceId', 'audioOccurrenceId', 'selectionStartFrame', 'selectionEndFrame',
	'reframeEvidence', 'sourceTimeAuthority', 'windows',
] as const);
const WINDOW_FIELDS = Object.freeze([
	'id', 'startFrame', 'endFrame', 'shotStructure', 'visualInterest',
] as const);
const AUDIO_FIELDS = Object.freeze(['schemaVersion', 'kind', 'signals'] as const);
const AUDIO_SIGNAL_FIELDS = Object.freeze(['candidateId', 'energyDynamics'] as const);
const TRANSCRIPT_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'sourceTimelineStartFrame', 'transcript', 'signals',
] as const);
const TRANSCRIPT_SIGNAL_FIELDS = Object.freeze([
	'candidateId', 'hook', 'conversationalStructure', 'semanticSelfContainedness',
] as const);
const REACTION_SOURCE_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'sourceTimelineStartFrame', 'result',
] as const);
const REACTION_RESULT_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'sampleRate', 'threshold', 'ranges',
] as const);
const REACTION_FIELDS = Object.freeze([
	'id', 'kind', 'label', 'startSample', 'endSample', 'score', 'selected',
] as const);
const RANK_FIELDS = Object.freeze(['highlight-signals'] as const);
const ASSEMBLE_FIELDS = Object.freeze(['highlight-candidates', 'editorial'] as const);
const MAXIMUM_DUPLICATION_MULTIPLY_ADDS = 10_000_000;
const MAXIMUM_TRANSCRIPT_EXCERPT_UTF16_UNITS = 8_192;

interface VideoWindow {
	readonly id: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly shotStructure: number;
	readonly visualInterest: number;
}

interface ReviewedVideo {
	readonly sourceId: string;
	readonly sampleRate: number;
	readonly timescale: number;
	readonly sourceSize: Readonly<{ width: number; height: number }>;
	readonly videoOccurrenceId: string;
	readonly audioOccurrenceId: string | null;
	readonly selectionStartFrame: number;
	readonly selectionEndFrame: number;
	readonly reframeEvidence: AssistanceAcceptedReframeDerivativeV1 | null;
	readonly authority: ReviewedAssistanceSourceTimeRowsV1;
	readonly windows: readonly VideoWindow[];
}

export function gatherOwnedHighlightSignalsV1(
	inputsValue: unknown,
	settings: Settings,
): AssistanceOwnedHighlightSignalsV1 {
	const inputs = ownedExactRecord(inputsValue, GATHER_FIELDS, 'gather-signals inputs');
	const video = reviewVideo(inputs.video);
	const known = new Set(video.windows.map(({ id }) => id));
	const audio = reviewAudioSignals(inputs.audio, known);
	const transcript = reviewTranscriptSignals(inputs.transcript, known, video);
	const shotEdges = reviewShotEdges(inputs['shot-boundaries'], video);
	const reactionRanges = Object.freeze([
		...reviewAudioTagRanges(inputs['audio-tags'], video),
		...reviewReactionRanges(inputs['reaction-ranges'], video.sampleRate),
	]);
	const duplication = reviewDuplication(inputs.embeddings, video.windows.length);
	const shotAvailable = inputs['shot-boundaries'] !== null;
	const reactionAvailable = inputs['audio-tags'] !== null || inputs['reaction-ranges'] !== null;
	const energyAvailable = inputs.audio !== null;
	const visualAvailable = inputs.embeddings !== null;
	const speechlessAvailableWeight = quantize(
		(shotAvailable ? HIGHLIGHT_RANKING_V1_SPEECHLESS_WEIGHTS.shotStructure : 0)
		+ (reactionAvailable ? HIGHLIGHT_RANKING_V1_SPEECHLESS_WEIGHTS.excitement : 0)
		+ (energyAvailable ? HIGHLIGHT_RANKING_V1_SPEECHLESS_WEIGHTS.energyDynamics : 0)
		+ (visualAvailable ? HIGHLIGHT_RANKING_V1_SPEECHLESS_WEIGHTS.visualInterest : 0),
	);
	const edges = canonicalEdges(video, shotEdges, transcript.timelineEdges);
	const candidates = video.windows.flatMap((window, index) => {
		const startFrame = nearest(edges, window.startFrame);
		const endFrame = nearest(edges, window.endFrame);
		if (endFrame <= startFrame) {
			throw new RangeError(`Highlight window ${window.id} collapsed while snapping to admitted edges.`);
		}
		const sourceStartFrame = sourceAtTimeline(video.authority, startFrame);
		const sourceEndFrame = sourceAtTimeline(video.authority, endFrame);
		if (sourceEndFrame <= sourceStartFrame) {
			throw new RangeError(`Highlight window ${window.id} violates forward source-time authority.`);
		}
		if (sourceEndFrame - sourceStartFrame < 2) return [];
		const language = transcript.signals.get(window.id);
		const transcriptEvidence = language !== undefined
			&& transcript.ranges.some((range) => overlaps(startFrame, endFrame, range.start, range.end));
		const transcriptExcerpt = transcriptEvidence
			? boundedTranscriptExcerpt(transcript.ranges, startFrame, endFrame) : null;
		const shotStructure = shotAvailable
			? shotStructureScore(shotEdges, startFrame, endFrame, video.sampleRate) : 0;
		const visualInterest = visualAvailable ? window.visualInterest : 0;
		const cropKeyframes = createOwnedHighlightCropKeyframesV1({ video,
			sourceStartFrame, sourceEndFrame,
			targetAspect: { width: settings.targetAspectWidth, height: settings.targetAspectHeight } });
		return [Object.freeze({ id: window.id, startFrame, endFrame,
			sourceStartFrame, sourceEndFrame, transcriptEvidence, transcriptExcerpt,
			visualSummary: `Admitted shot-structure score ${shotStructure.toFixed(6)}; authenticated semantic visual-interest score ${visualInterest.toFixed(6)}.`,
			hook: transcriptEvidence ? language.hook : 0,
			conversationalStructure: transcriptEvidence ? language.conversationalStructure : 0,
			excitement: maximumOverlapScore(reactionRanges, startFrame, endFrame),
			energyDynamics: audio.get(window.id) ?? 0,
			semanticSelfContainedness: transcriptEvidence
				? language.semanticSelfContainedness : 0,
			shotStructure, visualInterest, speechlessAvailableWeight,
			duplication: duplication[index] ?? 0,
			videoOccurrenceId: video.videoOccurrenceId,
			audioOccurrenceId: video.audioOccurrenceId, cropKeyframes })];
	});
	return reviewOwnedHighlightSignalsV1({ schemaVersion: 1, kind: 'highlight-signals',
		sourceId: video.sourceId, sampleRate: video.sampleRate, sourceSize: video.sourceSize,
		candidates });
}

export function rankOwnedHighlightsV1(
	inputsValue: unknown,
	settings: Settings,
): AssistanceOwnedHighlightCandidatesV1 {
	const inputs = ownedExactRecord(inputsValue, RANK_FIELDS, 'rank-highlights inputs');
	const signals = reviewOwnedHighlightSignalsV1(inputs['highlight-signals']);
	const ranked = rankAssistanceHighlightsV1(signals.candidates.map((candidate) => ({
		id: candidate.id, startFrame: candidate.startFrame, endFrame: candidate.endFrame,
		transcriptEvidence: candidate.transcriptEvidence, hook: candidate.hook,
		conversationalStructure: candidate.conversationalStructure,
		excitement: candidate.excitement, energyDynamics: candidate.energyDynamics,
		semanticSelfContainedness: candidate.semanticSelfContainedness,
		shotStructure: candidate.shotStructure, visualInterest: candidate.visualInterest,
		speechlessAvailableWeight: candidate.speechlessAvailableWeight,
		duplication: candidate.duplication,
	})), { sampleRate: signals.sampleRate, maximumResults: settings.resultCount,
		minimumDurationSeconds: settings.minimumDurationSeconds,
		maximumDurationSeconds: settings.maximumDurationSeconds });
	const byId = new Map(signals.candidates.map((candidate) => [candidate.id, candidate]));
	const candidates = ranked.map((candidate) => {
		const source = byId.get(candidate.id)!;
		assertOwnedHighlightCropAspectV1(source.cropKeyframes, signals.sourceSize,
			{ width: settings.targetAspectWidth, height: settings.targetAspectHeight });
		return Object.freeze({ ...candidate, sourceStartFrame: source.sourceStartFrame,
			sourceEndFrame: source.sourceEndFrame, videoOccurrenceId: source.videoOccurrenceId,
			audioOccurrenceId: source.audioOccurrenceId, cropKeyframes: source.cropKeyframes,
			transcriptExcerpt: source.transcriptExcerpt, visualSummary: source.visualSummary });
	});
	return reviewOwnedHighlightCandidatesV1({ schemaVersion: 1, kind: 'highlight-candidates',
		sourceId: signals.sourceId, sampleRate: signals.sampleRate, sourceSize: signals.sourceSize,
		targetAspect: { width: settings.targetAspectWidth, height: settings.targetAspectHeight },
		candidates });
}

export function assembleOwnedHighlightsV1(
	inputsValue: unknown,
	settings: Settings,
): AssistanceOwnedHighlightProposalsV1 {
	const inputs = ownedExactRecord(inputsValue, ASSEMBLE_FIELDS, 'assemble-highlights inputs');
	const candidates = reviewOwnedHighlightCandidatesV1(inputs['highlight-candidates']);
	if (candidates.targetAspect.width !== settings.targetAspectWidth
		|| candidates.targetAspect.height !== settings.targetAspectHeight) {
		throw new RangeError('Highlight candidates disagree with the authenticated target aspect.');
	}
	const ids = candidates.candidates.map(({ id }) => id);
	const editorial = inputs.editorial === null ? null
		: reviewAssistanceEditorialProposalV1(inputs.editorial, ids);
	const ordered = editorial === null ? candidates.candidates
		: editorial.candidates.map(({ candidateId }) =>
			candidates.candidates.find(({ id }) => id === candidateId)!);
	const editorialById = new Map(editorial?.candidates.map((candidate) =>
		[candidate.candidateId, candidate] as const) ?? []);
	const proposals = ordered.map((candidate, index) => {
		assertOwnedHighlightCropAspectV1(candidate.cropKeyframes,
			candidates.sourceSize, candidates.targetAspect);
		const authored = editorialById.get(candidate.id);
		return Object.freeze({ ...candidate,
			title: authored?.title ?? `Highlight ${String(index + 1)}`,
			hook: authored?.hook ?? null, chapters: authored?.chapters ?? Object.freeze([]),
			explanation: authored?.explanation ?? null });
	});
	return Object.freeze({ schemaVersion: 1, kind: 'highlight-proposals',
		workflowId: 'make-highlights', targetAspect: Object.freeze({ width: 9, height: 16 }),
		proposals: Object.freeze(proposals) });
}

function reviewVideo(value: unknown): ReviewedVideo {
	const row = ownedExactRecord(value, VIDEO_FIELDS, 'highlight video signals');
	if (row.schemaVersion !== 1 || row.kind !== 'highlight-video-signals') {
		throw new TypeError('The highlight video signal identity is unsupported.');
	}
	const sampleRate = ownedInteger(row.sampleRate, 1, 768_000, 'highlight timeline sample rate');
	const timescale = ownedInteger(row.timescale, 1, 0x7fff_ffff, 'highlight source timescale');
	const selectionStartFrame = ownedInteger(row.selectionStartFrame, 0,
		Number.MAX_SAFE_INTEGER, 'highlight selection start');
	const selectionEndFrame = ownedInteger(row.selectionEndFrame, 1,
		Number.MAX_SAFE_INTEGER, 'highlight selection end');
	if (selectionEndFrame <= selectionStartFrame) throw new RangeError('The highlight selection is empty.');
	const reviewedAuthority = reviewAssistanceSourceTimeRowsV1(row.sourceTimeAuthority);
	if (reviewedAuthority.first.timelineFrame !== selectionStartFrame
		|| reviewedAuthority.last.timelineFrame !== selectionEndFrame) {
		throw new RangeError('Highlight source-time authority must bind both selection endpoints.');
	}
	const seen = new Set<string>();
	const windows = ownedArray(row.windows, ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_PROPOSALS,
		'highlight source windows').map((candidate, index) => {
		const item = ownedExactRecord(candidate, WINDOW_FIELDS, `highlight window ${String(index)}`);
		const id = stableId(item.id, `highlight window ${String(index)} ID`);
		if (seen.has(id)) throw new TypeError('Highlight window identities must be unique.');
		seen.add(id);
		const startFrame = ownedInteger(item.startFrame, selectionStartFrame,
			selectionEndFrame - 1, `highlight window ${id} start`);
		const endFrame = ownedInteger(item.endFrame, selectionStartFrame + 1,
			selectionEndFrame, `highlight window ${id} end`);
		if (endFrame <= startFrame) throw new RangeError(`Highlight window ${id} is empty.`);
		return Object.freeze({ id, startFrame, endFrame,
			shotStructure: ownedUnit(item.shotStructure, `highlight window ${id} shot structure`),
			visualInterest: ownedUnit(item.visualInterest, `highlight window ${id} visual interest`) });
	});
	const reframeEvidence = row.reframeEvidence === null ? null
		: reviewAssistanceAcceptedReframeDerivativeV1(row.reframeEvidence);
	const sourceId = stableId(row.sourceId, 'highlight source ID');
	const sourceSize = dimensions(row.sourceSize, 'highlight source size');
	if (reframeEvidence !== null) assertOwnedHighlightReframeVideoAuthorityV1(reframeEvidence, {
		sourceId, timescale, sourceSize,
		authority: reviewedAuthority, selectionStartFrame, selectionEndFrame,
	});
	return Object.freeze({ sourceId, sampleRate, timescale, sourceSize,
		videoOccurrenceId: stableId(row.videoOccurrenceId, 'highlight video occurrence'),
		audioOccurrenceId: row.audioOccurrenceId === null ? null
			: stableId(row.audioOccurrenceId, 'highlight audio occurrence'),
		selectionStartFrame, selectionEndFrame, reframeEvidence, authority: reviewedAuthority,
		windows: Object.freeze(windows) });
}

function reviewAudioSignals(value: unknown, known: ReadonlySet<string>): ReadonlyMap<string, number> {
	if (value === null) return new Map();
	const row = ownedExactRecord(value, AUDIO_FIELDS, 'highlight audio signals');
	if (row.schemaVersion !== 1 || row.kind !== 'highlight-audio-signals') {
		throw new TypeError('The highlight audio signal identity is unsupported.');
	}
	const result = new Map<string, number>();
	for (const [index, candidate] of ownedArray(row.signals, known.size, 'highlight audio scores').entries()) {
		const item = ownedExactRecord(candidate, AUDIO_SIGNAL_FIELDS,
			`highlight audio score ${String(index)}`);
		const id = admittedCandidate(item.candidateId, known, result, 'audio');
		result.set(id, ownedUnit(item.energyDynamics, `highlight audio score ${id} unit interval`));
	}
	return result;
}

function reviewTranscriptSignals(value: unknown, known: ReadonlySet<string>, video: ReviewedVideo) {
	if (value === null) return Object.freeze({ signals: new Map<string, Readonly<{
		hook: number; conversationalStructure: number; semanticSelfContainedness: number;
	}>>(), ranges: [] as readonly Readonly<{ start: number; end: number; text: string }>[],
		timelineEdges: [] as readonly number[] });
	const row = ownedExactRecord(value, TRANSCRIPT_FIELDS, 'highlight transcript signals');
	if (row.schemaVersion !== 1 || row.kind !== 'highlight-transcript-signals') {
		throw new TypeError('The highlight transcript signal identity is unsupported.');
	}
	const transcript = reviewOwnedAssistanceTranscriptV1(row.transcript);
	const offset = ownedInteger(row.sourceTimelineStartFrame, 0, Number.MAX_SAFE_INTEGER,
		'highlight transcript timeline start');
	const ranges = transcript.segments.map(({ startFrame, endFrame, text }) => Object.freeze({
		start: nearestAuthorityTimeline(video.authority, ownedSafeAdd(offset, Number(scaleSampleFrame(
			startFrame, transcript.sampleRate, video.sampleRate, 'enclosingStart')),
			'transcript timeline start')),
		end: nearestAuthorityTimeline(video.authority, ownedSafeAdd(offset, Number(scaleSampleFrame(
			endFrame, transcript.sampleRate, video.sampleRate, 'enclosingEnd')),
			'transcript timeline end')),
		text,
	})).filter(({ start, end }) => end > start);
	const signals = new Map<string, Readonly<{
		hook: number; conversationalStructure: number; semanticSelfContainedness: number;
	}>>();
	for (const [index, candidate] of ownedArray(row.signals, known.size,
		'highlight transcript scores').entries()) {
		const item = ownedExactRecord(candidate, TRANSCRIPT_SIGNAL_FIELDS,
			`highlight transcript score ${String(index)}`);
		const id = admittedCandidate(item.candidateId, known, signals, 'transcript');
		signals.set(id, Object.freeze({ hook: ownedUnit(item.hook, `highlight ${id} hook`),
			conversationalStructure: ownedUnit(item.conversationalStructure,
				`highlight ${id} conversational structure`),
			semanticSelfContainedness: ownedUnit(item.semanticSelfContainedness,
				`highlight ${id} self-containedness`) }));
	}
	return Object.freeze({ signals, ranges: Object.freeze(ranges),
		timelineEdges: Object.freeze(ranges.flatMap(({ start, end }) => [start, end])) });
}

function reviewShotEdges(value: unknown, video: ReviewedVideo): readonly number[] {
	if (value === null) return Object.freeze([]);
	const shots = reviewAssistanceShotBoundariesV1(value);
	if (shots.timescale !== video.timescale
		|| shots.sourceFrameCount !== video.authority.last.sourceFrame + 1) {
		throw new RangeError('Highlight shots disagree with exact source-time authority.');
	}
	return Object.freeze(shots.boundaries.map((boundary) => {
		const exact = sourceAuthorityAt(video.authority, boundary.sourceFrame);
		if (!exact || exact.presentationTick !== boundary.presentationTick) {
			throw new RangeError('A highlight shot boundary lacks exact source-time authority.');
		}
		return exact.timelineFrame;
	}));
}

function reviewReactionRanges(value: unknown, sampleRate: number): readonly Readonly<{
	start: number; end: number; score: number;
}>[] {
	if (value === null) return Object.freeze([]);
	const source = ownedExactRecord(value, REACTION_SOURCE_FIELDS, 'highlight reaction signals');
	if (source.schemaVersion !== 1 || source.kind !== 'highlight-reaction-signals') {
		throw new TypeError('The highlight reaction signal identity is unsupported.');
	}
	const offset = ownedInteger(source.sourceTimelineStartFrame, 0, Number.MAX_SAFE_INTEGER,
		'highlight reaction timeline start');
	const row = ownedExactRecord(source.result, REACTION_RESULT_FIELDS, 'highlight reaction result');
	if (row.schemaVersion !== 1 || row.kind !== 'reaction-ranges' || row.sampleRate !== 32_000) {
		throw new TypeError('The highlight reaction result identity is unsupported.');
	}
	ownedUnit(row.threshold, 'highlight reaction threshold');
	let priorStart = -1;
	return Object.freeze(ownedArray(row.ranges, ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_PROPOSALS,
		'highlight reaction ranges').map((candidate, index) => {
		const item = ownedExactRecord(candidate, REACTION_FIELDS,
			`highlight reaction range ${String(index)}`);
		stableId(item.id, `highlight reaction range ${String(index)} ID`);
		if (item.kind !== 'reaction' || typeof item.label !== 'string'
			|| !['Laughter', 'Applause', 'Cheering'].includes(item.label)
			|| item.selected !== false) throw new TypeError('A highlight reaction range is invalid.');
		const startSample = ownedInteger(item.startSample, 0, Number.MAX_SAFE_INTEGER,
			'highlight reaction start');
		const endSample = ownedInteger(item.endSample, 1, Number.MAX_SAFE_INTEGER,
			'highlight reaction end');
		if (startSample < priorStart || endSample <= startSample) {
			throw new RangeError('Highlight reaction ranges must remain ordered and positive.');
		}
		priorStart = startSample;
		return Object.freeze({ start: ownedSafeAdd(offset, Number(scaleSampleFrame(startSample, 32_000,
			sampleRate, 'enclosingStart')), 'reaction timeline start'),
		end: ownedSafeAdd(offset, Number(scaleSampleFrame(endSample, 32_000,
			sampleRate, 'enclosingEnd')), 'reaction timeline end'),
		score: ownedUnit(item.score, 'highlight reaction score') });
	}));
}

function reviewAudioTagRanges(value: unknown, video: ReviewedVideo): readonly Readonly<{
	start: number; end: number; score: number;
}>[] {
	if (value === null) return Object.freeze([]);
	const tags = reviewAssistanceAudioTagsV1(value);
	return Object.freeze(tags.windows.flatMap(({ startSample, scores }) => {
		const start = ownedSafeAdd(video.selectionStartFrame, Number(scaleSampleFrame(
			startSample, tags.sampleRate, video.sampleRate, 'enclosingStart',
		)), 'audio-tag timeline start');
		const end = Math.min(video.selectionEndFrame, ownedSafeAdd(
			video.selectionStartFrame, Number(scaleSampleFrame(
				startSample + tags.windowSamples, tags.sampleRate, video.sampleRate, 'enclosingEnd',
			)), 'audio-tag timeline end'));
		if (start >= end) return [];
		return [Object.freeze({ start, end,
			score: Math.max(scores.laughter, scores.applause, scores.cheering) })];
	}));
}

/** Normalize shot-segment density to one at an average shot length of five seconds. */
function shotStructureScore(
	edges: readonly number[], start: number, end: number, sampleRate: number,
): number {
	const segments = 1 + edges.filter((edge) => edge > start && edge < end).length;
	return quantize(Math.min(1, segments * 5 * sampleRate / (end - start)));
}

function reviewDuplication(value: unknown, count: number): readonly number[] {
	if (value === null) return Object.freeze(Array.from({ length: count }, () => 0));
	if (!(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) {
		throw new TypeError('Highlight duplication requires a strict embedding matrix body.');
	}
	const matrix = reviewAssistanceEmbeddingMatrixV1(value as ArrayBuffer | ArrayBufferView);
	if (matrix.rowCount !== count) throw new RangeError('Highlight embeddings disagree with window order.');
	const work = count * count * matrix.dimensions;
	if (!Number.isSafeInteger(work) || work > MAXIMUM_DUPLICATION_MULTIPLY_ADDS) {
		throw new RangeError('Highlight duplication analysis exceeds its deterministic work bound.');
	}
	const rows = Array.from({ length: count }, (_, index) => matrix.vector(index));
	return Object.freeze(rows.map((row, index) => {
		let maximum = 0;
		for (const [otherIndex, other] of rows.entries()) {
			if (otherIndex === index) continue;
			let dot = 0;
			for (let column = 0; column < row.length; column += 1) dot += row[column]! * other[column]!;
			maximum = Math.max(maximum, Math.min(1, Math.max(0, dot)));
		}
		return maximum;
	}));
}

function canonicalEdges(
	video: ReviewedVideo,
	shots: readonly number[],
	transcript: readonly number[],
): readonly number[] {
	const evidence = [...shots, ...transcript];
	const fallback = evidence.length === 0
		? video.windows.flatMap(({ startFrame, endFrame }) => [startFrame, endFrame])
		: evidence;
	return Object.freeze([...new Set([
		video.selectionStartFrame, video.selectionEndFrame, ...fallback,
	])].sort((left, right) => left - right));
}

function nearest(values: readonly number[], target: number): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (values[middle]! < target) low = middle + 1;
		else high = middle;
	}
	if (low === 0) return values[0]!;
	if (low === values.length) return values.at(-1)!;
	const left = values[low - 1]!;
	const right = values[low]!;
	return target - left <= right - target ? left : right;
}

function nearestAuthorityTimeline(authority: ReviewedAssistanceSourceTimeRowsV1, target: number): number {
	const low = authority.firstAtOrAfterTimeline(target);
	if (low === 0) return authority.first.timelineFrame;
	if (low === authority.rowCount) return authority.last.timelineFrame;
	const left = authority.row(low - 1).timelineFrame;
	const right = authority.row(low).timelineFrame;
	return target - left <= right - target ? left : right;
}

function sourceAtTimeline(authority: ReviewedAssistanceSourceTimeRowsV1, timelineFrame: number): number {
	const index = authority.firstAtOrAfterTimeline(timelineFrame);
	const exact = index < authority.rowCount ? authority.row(index) : undefined;
	if (!exact || exact.timelineFrame !== timelineFrame) {
		throw new RangeError('A snapped highlight edge lacks exact source-time authority.');
	}
	return exact.sourceFrame;
}

function sourceAuthorityAt(
	authority: ReviewedAssistanceSourceTimeRowsV1,
	sourceFrame: number,
): ReturnType<ReviewedAssistanceSourceTimeRowsV1['row']> | undefined {
	const index = authority.firstAtOrAfterSource(sourceFrame);
	if (index >= authority.rowCount) return undefined;
	const candidate = authority.row(index);
	return candidate.sourceFrame === sourceFrame ? candidate : undefined;
}

function maximumOverlapScore(
	ranges: readonly Readonly<{ start: number; end: number; score: number }>[],
	start: number,
	end: number,
): number {
	return ranges.reduce((maximum, range) => overlaps(start, end, range.start, range.end)
		? Math.max(maximum, range.score) : maximum, 0);
}

function overlaps(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
	return Math.max(leftStart, rightStart) < Math.min(leftEnd, rightEnd);
}

function boundedTranscriptExcerpt(
	ranges: readonly Readonly<{ start: number; end: number; text: string }>[],
	start: number,
	end: number,
): string {
	const excerpt = ranges.filter((range) => overlaps(start, end, range.start, range.end))
		.map(({ text }) => text.trim()).filter(Boolean).join(' ').trim();
	if (excerpt === '') throw new TypeError('Transcript evidence requires admitted nonempty text.');
	if (excerpt.length <= MAXIMUM_TRANSCRIPT_EXCERPT_UTF16_UNITS) return excerpt;
	let endOffset = MAXIMUM_TRANSCRIPT_EXCERPT_UTF16_UNITS;
	const boundaryUnit = excerpt.charCodeAt(endOffset - 1);
	const followingUnit = excerpt.charCodeAt(endOffset);
	if (boundaryUnit >= 0xD800 && boundaryUnit <= 0xDBFF
		&& followingUnit >= 0xDC00 && followingUnit <= 0xDFFF) endOffset -= 1;
	return excerpt.slice(0, endOffset).trim();
}

function admittedCandidate<T>(
	value: unknown,
	known: ReadonlySet<string>,
	seen: ReadonlyMap<string, T>,
	label: string,
): string {
	const id = stableId(value, `highlight ${label} candidate ID`);
	if (!known.has(id) || seen.has(id)) throw new TypeError(`Highlight ${label} scores have ambiguous authority.`);
	return id;
}

function quantize(value: number): number {
	return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}
