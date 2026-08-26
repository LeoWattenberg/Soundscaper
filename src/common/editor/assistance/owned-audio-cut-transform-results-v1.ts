/* SPDX-License-Identifier: AGPL-3.0-only */

/** Semantic re-admission for serialized owned audio/cut transform results. */

import {
	ASSISTANCE_AUDIO_TAG_SAMPLE_RATE,
	ASSISTANCE_BEAT_SAMPLE_RATE,
	reviewAssistanceBeatGridV1,
} from './m7-semantic-results.ts';
import {
	ASSISTANCE_OWNED_AUDIO_CUT_TRANSFORM_IDS_V1,
	type AssistanceBeatLabelsV1,
	type AssistanceCaptionsV1,
	type AssistanceCleanupProposalsV1,
	type AssistanceCutProposalsV1,
	type AssistanceOwnedAudioCutTransformIdV1,
	type AssistanceOwnedAudioCutTransformResultV1,
	type AssistanceReactionRangesV1,
	type AssistanceTempoMapDiffV1,
	type AssistanceTranscriptIndexV1,
} from './owned-audio-cut-transform-types-v1.ts';
import { reviewOwnedTextChunksV1 } from './owned-audio-workflow-transforms-v1.ts';
import {
	ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_ITEMS,
	ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_PROPOSALS,
	ownedArray,
	ownedBoolean,
	ownedExactRecord,
	ownedInteger,
	ownedText,
	ownedUnit,
	reviewOwnedAssistanceTranscriptV1,
} from './owned-transform-validation-v1.ts';
import { reviewAssistanceShotBoundariesV1 } from './shot-boundaries-v1.ts';
import { normalizeAssistanceTranscriptCleanupPreset } from './transcript-cleanup-presets.ts';

const SHA256 = /^[a-f\d]{64}$/u;
const IDS = new Set<unknown>(ASSISTANCE_OWNED_AUDIO_CUT_TRANSFORM_IDS_V1);

export function reviewAssistanceOwnedAudioCutTransformResultV1(
	value: unknown,
): AssistanceOwnedAudioCutTransformResultV1 {
	const result = ownedExactRecord(value, ['schemaVersion', 'transformId', 'outputs'],
		'owned audio/cut transform result');
	if (result.schemaVersion !== 1 || !IDS.has(result.transformId)) {
		throw new TypeError('The owned audio/cut transform result identity is unsupported.');
	}
	const transformId = result.transformId as AssistanceOwnedAudioCutTransformIdV1;
	switch (transformId) {
		case 'assemble-captions': return wrapped(transformId, result.outputs, ['captions'],
			(outputs) => Object.freeze({ captions: reviewCaptions(outputs.captions) }));
		case 'propose-cleanup': return wrapped(transformId, result.outputs, ['cleanup-proposals'],
			(outputs) => Object.freeze({
				'cleanup-proposals': reviewCleanup(outputs['cleanup-proposals']),
			}));
		case 'attribute-speakers': return wrapped(transformId, result.outputs, ['attributed-transcript'],
			(outputs) => Object.freeze({
				'attributed-transcript': reviewOwnedAssistanceTranscriptV1(outputs['attributed-transcript']),
			}));
		case 'merge-reaction-ranges': return wrapped(transformId, result.outputs, ['reaction-ranges'],
			(outputs) => Object.freeze({
				'reaction-ranges': reviewReactions(outputs['reaction-ranges']),
			}));
		case 'chunk-transcript': return wrapped(transformId, result.outputs, ['text-chunks'],
			(outputs) => Object.freeze({ 'text-chunks': reviewOwnedTextChunksV1(outputs['text-chunks']) }));
		case 'publish-transcript-index': return wrapped(transformId, result.outputs, ['transcript-index'],
			(outputs) => Object.freeze({
				'transcript-index': reviewTranscriptIndex(outputs['transcript-index']),
			}));
		case 'propose-tempo-map': return reviewTempoResult(result.outputs);
		case 'normalize-cuts': return wrapped(transformId, result.outputs, ['cut-proposals'],
			(outputs) => Object.freeze({ 'cut-proposals': reviewCuts(outputs['cut-proposals']) }));
	}
}

function wrapped<Id extends AssistanceOwnedAudioCutTransformIdV1, Output>(
	transformId: Id,
	outputsValue: unknown,
	fields: readonly string[],
	review: (outputs: Record<string, unknown>) => Output,
): AssistanceOwnedAudioCutTransformResultV1 {
	const outputs = ownedExactRecord(outputsValue, fields, `${transformId} outputs`);
	return Object.freeze({ schemaVersion: 1, transformId, outputs: review(outputs) }) as
		AssistanceOwnedAudioCutTransformResultV1;
}

function reviewCaptions(value: unknown): AssistanceCaptionsV1 {
	const row = ownedExactRecord(value, [
		'schemaVersion', 'kind', 'sourceId', 'sampleRate', 'alignmentApplied', 'cues',
	], 'captions result');
	exactKind(row, 'captions', 'captions');
	const sourceId = ownedText(row.sourceId, 256, 'captions source ID');
	const sampleRate = ownedInteger(row.sampleRate, 1, 768_000, 'captions sample rate');
	let priorEnd = -1;
	const cues = ownedArray(row.cues, ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_PROPOSALS,
		'caption cues').map((candidate, index) => {
		const label = `caption cue ${String(index)}`;
		const cue = ownedExactRecord(candidate, [
			'cueId', 'startFrame', 'endFrame', 'text', 'words',
		], label);
		if (cue.cueId !== `caption:${String(index)}`) {
			throw new TypeError('Caption cue identities must match stable cue order.');
		}
		const startFrame = ownedInteger(cue.startFrame, 0, Number.MAX_SAFE_INTEGER,
			`${label} start frame`);
		const endFrame = ownedInteger(cue.endFrame, startFrame + 1, Number.MAX_SAFE_INTEGER,
			`${label} end frame`);
		if (startFrame < priorEnd) throw new RangeError('Caption cues must be ordered and disjoint.');
		priorEnd = endFrame;
		let priorWordEnd = startFrame;
		const words = ownedArray(cue.words, 1_000, `${label} words`).map((wordValue, wordIndex) => {
			const wordLabel = `${label} word ${String(wordIndex)}`;
			const word = ownedExactRecord(wordValue, [
				'text', 'startFrame', 'endFrame', 'confidence',
			], wordLabel);
			const wordStart = ownedInteger(word.startFrame, startFrame, endFrame, `${wordLabel} start`);
			const wordEnd = ownedInteger(word.endFrame, wordStart, endFrame, `${wordLabel} end`);
			if (wordStart < priorWordEnd) throw new RangeError('Caption words must be ordered and disjoint.');
			priorWordEnd = wordEnd;
			return Object.freeze({
				text: ownedText(word.text, 512, `${wordLabel} text`), startFrame: wordStart,
				endFrame: wordEnd, confidence: word.confidence === null ? null
					: ownedUnit(word.confidence, `${wordLabel} confidence`),
			});
		});
		return Object.freeze({
			cueId: cue.cueId, startFrame, endFrame,
			text: ownedText(cue.text, 16_544, `${label} text`), words: Object.freeze(words),
		});
	});
	return Object.freeze({
		schemaVersion: 1, kind: 'captions', sourceId, sampleRate,
		alignmentApplied: ownedBoolean(row.alignmentApplied, 'caption alignment flag'),
		cues: Object.freeze(cues),
	});
}

function reviewCleanup(value: unknown): AssistanceCleanupProposalsV1 {
	const row = ownedExactRecord(value, ['schemaVersion', 'kind', 'preset', 'proposals'],
		'cleanup-proposals result');
	exactKind(row, 'cleanup-proposals', 'cleanup-proposals');
	const preset = normalizeAssistanceTranscriptCleanupPreset(row.preset);
	let prior: Readonly<{ startFrame: number; endFrame: number; kind: string; id: string }> | null = null;
	const ids = new Set<string>();
	const proposals = ownedArray(row.proposals, ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_PROPOSALS,
		'cleanup proposals').map((candidate, index) => {
		const label = `cleanup proposal ${String(index)}`;
		const proposal = ownedExactRecord(candidate, [
			'id', 'kind', 'startFrame', 'endFrame', 'text', 'selected',
		], label);
		const id = ownedText(proposal.id, 256, `${label} ID`);
		if (ids.has(id)) throw new TypeError('Cleanup proposal identities must be unique.');
		ids.add(id);
		if (proposal.kind !== 'filler' && proposal.kind !== 'repetition' && proposal.kind !== 'silence') {
			throw new TypeError(`${label} has an unsupported kind.`);
		}
		const startFrame = ownedInteger(proposal.startFrame, 0, Number.MAX_SAFE_INTEGER,
			`${label} start frame`);
		const endFrame = ownedInteger(proposal.endFrame, startFrame + 1, Number.MAX_SAFE_INTEGER,
			`${label} end frame`);
		const next = { startFrame, endFrame, kind: proposal.kind, id };
		if (prior && compareProposalOrder(prior, next) > 0) {
			throw new RangeError('Cleanup proposals must preserve deterministic order.');
		}
		prior = next;
		if (proposal.selected !== false) throw new TypeError('Cleanup proposals must start unselected.');
		return Object.freeze({
			id, kind: proposal.kind, startFrame, endFrame,
			text: ownedText(proposal.text, 4_096, `${label} text`, true), selected: false as const,
		});
	});
	return Object.freeze({
		schemaVersion: 1, kind: 'cleanup-proposals', preset, proposals: Object.freeze(proposals),
	});
}

function reviewReactions(value: unknown): AssistanceReactionRangesV1 {
	const row = ownedExactRecord(value, [
		'schemaVersion', 'kind', 'sampleRate', 'threshold', 'ranges',
	], 'reaction-ranges result');
	exactKind(row, 'reaction-ranges', 'reaction-ranges');
	if (row.sampleRate !== ASSISTANCE_AUDIO_TAG_SAMPLE_RATE) {
		throw new RangeError('Reaction ranges require exact 32 kHz sample authority.');
	}
	let priorStart = -1;
	const ids = new Set<string>();
	const ranges = ownedArray(row.ranges, ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_PROPOSALS,
		'reaction ranges').map((candidate, index) => {
		const label = `reaction range ${String(index)}`;
		const range = ownedExactRecord(candidate, [
			'id', 'kind', 'label', 'startSample', 'endSample', 'score', 'selected',
		], label);
		if (range.kind !== 'reaction' || !['Laughter', 'Applause', 'Cheering'].includes(String(range.label))) {
			throw new TypeError(`${label} has an unsupported reaction identity.`);
		}
		const startSample = ownedInteger(range.startSample, 0, Number.MAX_SAFE_INTEGER,
			`${label} start sample`);
		const endSample = ownedInteger(range.endSample, startSample + 1, Number.MAX_SAFE_INTEGER,
			`${label} end sample`);
		if (startSample < priorStart) throw new RangeError('Reaction ranges must be ordered.');
		priorStart = startSample;
		const reactionLabel = range.label as 'Laughter' | 'Applause' | 'Cheering';
		const id = `reaction:${reactionLabel.toLowerCase()}:${String(startSample)}:${String(endSample)}`;
		if (range.id !== id || ids.has(id)) throw new TypeError('Reaction range identities are invalid.');
		ids.add(id);
		if (range.selected !== false) throw new TypeError('Reaction ranges must start unselected.');
		return Object.freeze({
			id, kind: 'reaction' as const, label: reactionLabel, startSample, endSample,
			score: ownedUnit(range.score, `${label} score`), selected: false as const,
		});
	});
	return Object.freeze({
		schemaVersion: 1, kind: 'reaction-ranges', sampleRate: ASSISTANCE_AUDIO_TAG_SAMPLE_RATE,
		threshold: ownedUnit(row.threshold, 'reaction threshold'), ranges: Object.freeze(ranges),
	});
}

function reviewTranscriptIndex(value: unknown): AssistanceTranscriptIndexV1 {
	const row = ownedExactRecord(value, [
		'schemaVersion', 'kind', 'sourceId', 'sampleRate', 'embedding', 'rows',
	], 'transcript-index result');
	exactKind(row, 'transcript-index', 'transcript-index');
	const embeddingValue = ownedExactRecord(row.embedding, [
		'schemaVersion', 'byteLength', 'sha256', 'rowCount', 'dimensions',
	], 'transcript-index embedding');
	exactV1(embeddingValue.schemaVersion, 'transcript-index embedding');
	const rowCount = ownedInteger(embeddingValue.rowCount, 0,
		ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_ITEMS, 'transcript-index embedding row count');
	const dimensions = ownedInteger(embeddingValue.dimensions, 1, 8_192,
		'transcript-index embedding dimensions');
	const sha = ownedText(embeddingValue.sha256, 64, 'transcript-index embedding SHA-256');
	if (!SHA256.test(sha)) throw new TypeError('The transcript-index embedding SHA-256 is invalid.');
	const embedding = Object.freeze({
		schemaVersion: 1 as const,
		byteLength: ownedInteger(embeddingValue.byteLength, 1, 512 * 1024 * 1024,
			'transcript-index embedding byte length'),
		sha256: sha, rowCount, dimensions,
	});
	let priorFrame = -1;
	const ids = new Set<string>();
	const rows = ownedArray(row.rows, ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_ITEMS,
		'transcript-index rows').map((candidate, index) => {
		const label = `transcript-index row ${String(index)}`;
		const item = ownedExactRecord(candidate, [
			'resultId', 'timelineFrame', 'sourceEndFrame', 'segmentStartIndex',
			'segmentEndIndexExclusive', 'label', 'embeddingRow',
		], label);
		const resultId = ownedText(item.resultId, 256, `${label} result ID`);
		if (ids.has(resultId)) throw new TypeError('Transcript-index result IDs must be unique.');
		ids.add(resultId);
		const timelineFrame = ownedInteger(item.timelineFrame, 0, Number.MAX_SAFE_INTEGER,
			`${label} timeline frame`);
		const sourceEndFrame = ownedInteger(item.sourceEndFrame, timelineFrame + 1,
			Number.MAX_SAFE_INTEGER, `${label} source end`);
		if (timelineFrame < priorFrame) throw new RangeError('Transcript-index rows must be ordered.');
		priorFrame = timelineFrame;
		const segmentStartIndex = ownedInteger(item.segmentStartIndex, 0,
			Number.MAX_SAFE_INTEGER, `${label} first segment`);
		return Object.freeze({
			resultId, timelineFrame, sourceEndFrame, segmentStartIndex,
			segmentEndIndexExclusive: ownedInteger(item.segmentEndIndexExclusive,
				segmentStartIndex + 1, Number.MAX_SAFE_INTEGER, `${label} final segment`),
			label: ownedText(item.label, 1_024, `${label} label`),
			embeddingRow: ownedInteger(item.embeddingRow, index, index, `${label} embedding row`),
		});
	});
	if (rows.length !== rowCount) {
		throw new RangeError('Transcript-index rows disagree with embedding geometry.');
	}
	return Object.freeze({
		schemaVersion: 1, kind: 'transcript-index',
		sourceId: ownedText(row.sourceId, 256, 'transcript-index source ID'),
		sampleRate: ownedInteger(row.sampleRate, 1, 768_000, 'transcript-index sample rate'),
		embedding, rows: Object.freeze(rows),
	});
}

function reviewTempoResult(value: unknown): AssistanceOwnedAudioCutTransformResultV1 {
	const outputs = ownedExactRecord(value, ['beat-labels', 'tempo-map-diff'],
		'propose-tempo-map outputs');
	const beatLabels = reviewBeatLabels(outputs['beat-labels']);
	const diff = ownedExactRecord(outputs['tempo-map-diff'], [
		'schemaVersion', 'kind', 'applicationRequested', 'proposal',
	], 'tempo-map-diff result');
	exactKind(diff, 'tempo-map-diff', 'tempo-map-diff');
	const grid = reviewAssistanceBeatGridV1({
		schemaVersion: 1, sampleRate: ASSISTANCE_BEAT_SAMPLE_RATE,
		points: beatLabels.points.map(({ sample, kind, confidence }) => ({ sample, kind, confidence })),
		tempoProposal: diff.proposal,
	});
	const tempoMapDiff: AssistanceTempoMapDiffV1 = Object.freeze({
		schemaVersion: 1, kind: 'tempo-map-diff',
		applicationRequested: ownedBoolean(diff.applicationRequested,
			'tempo-map application request'),
		proposal: grid.tempoProposal,
	});
	return Object.freeze({
		schemaVersion: 1, transformId: 'propose-tempo-map',
		outputs: Object.freeze({ 'beat-labels': beatLabels, 'tempo-map-diff': tempoMapDiff }),
	});
}

function reviewBeatLabels(value: unknown): AssistanceBeatLabelsV1 {
	const row = ownedExactRecord(value, [
		'schemaVersion', 'kind', 'publicationRequested', 'points',
	], 'beat-labels result');
	exactKind(row, 'beat-labels', 'beat-labels');
	let priorSample = -1;
	const points = ownedArray(row.points, ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_ITEMS,
		'beat-label points').map((candidate, index) => {
		const label = `beat-label point ${String(index)}`;
		const point = ownedExactRecord(candidate, [
			'id', 'kind', 'label', 'sample', 'confidence', 'selected',
		], label);
		if (point.kind !== 'beat' && point.kind !== 'downbeat') {
			throw new TypeError(`${label} kind is unsupported.`);
		}
		const sample = ownedInteger(point.sample, 0, Number.MAX_SAFE_INTEGER, `${label} sample`);
		if (sample <= priorSample) throw new RangeError('Beat-label points must be strictly ordered.');
		priorSample = sample;
		const expectedLabel = point.kind === 'downbeat' ? 'Downbeat' : 'Beat';
		if (point.id !== `beat-grid:${point.kind}:${String(sample)}` || point.label !== expectedLabel
			|| point.selected !== false) throw new TypeError(`${label} identity or selection is invalid.`);
		return Object.freeze({
			id: point.id, kind: point.kind, label: expectedLabel, sample,
			confidence: point.confidence === null ? null : ownedUnit(point.confidence,
				`${label} confidence`), selected: false as const,
		});
	});
	return Object.freeze({
		schemaVersion: 1, kind: 'beat-labels',
		publicationRequested: ownedBoolean(row.publicationRequested, 'beat publication request'),
		points: Object.freeze(points),
	});
}

function reviewCuts(value: unknown): AssistanceCutProposalsV1 {
	const row = ownedExactRecord(value, [
		'schemaVersion', 'kind', 'mode', 'detector', 'timescale', 'sourceFrameCount', 'proposals',
	], 'cut-proposals result');
	exactKind(row, 'cut-proposals', 'cut-proposals');
	if (row.mode !== 'fast' && row.mode !== 'accurate') {
		throw new TypeError('The cut-proposals mode is unsupported.');
	}
	const expectedDetector = row.mode === 'fast' ? 'ffmpeg-scdet' : 'transnetv2';
	if (row.detector !== expectedDetector) {
		throw new RangeError('The cut-proposals detector substituted for its mode.');
	}
	const candidates = ownedArray(row.proposals, ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_ITEMS,
		'cut proposals');
	const boundaries = candidates.map((candidate, index) => {
		const label = `cut proposal ${String(index)}`;
		const proposal = ownedExactRecord(candidate, [
			'id', 'sourceFrame', 'presentationTick', 'score', 'selected',
		], label);
		if (proposal.selected !== false) throw new TypeError('Cut proposals must start unselected.');
		return {
			id: proposal.id,
			sourceFrame: proposal.sourceFrame,
			presentationTick: proposal.presentationTick,
			score: proposal.score,
		};
	});
	const review = reviewAssistanceShotBoundariesV1({
		schemaVersion: 1, detector: row.detector, timescale: row.timescale,
		sourceFrameCount: row.sourceFrameCount,
		boundaries: boundaries.map(({ sourceFrame, presentationTick, score }) => ({
			sourceFrame, presentationTick, score,
		})),
	});
	const proposals = review.boundaries.map((boundary, index) => {
		if (boundary.sourceFrame === 0) throw new RangeError('The source start is not a cut proposal.');
		const expectedId = `cut:${String(boundary.sourceFrame)}:${boundary.presentationTick}`;
		if (boundaries[index]!.id !== expectedId) throw new TypeError('A cut proposal ID is invalid.');
		return Object.freeze({ ...boundary, id: expectedId, selected: false as const });
	});
	return Object.freeze({
		schemaVersion: 1, kind: 'cut-proposals', mode: row.mode, detector: review.detector,
		timescale: review.timescale, sourceFrameCount: review.sourceFrameCount,
		proposals: Object.freeze(proposals),
	});
}

function exactKind(
	row: Record<string, unknown>,
	kind: string,
	label: string,
): void {
	exactV1(row.schemaVersion, label);
	if (row.kind !== kind) throw new TypeError(`The ${label} kind is invalid.`);
}

function exactV1(value: unknown, label: string): void {
	if (value !== 1) throw new TypeError(`The ${label} schema version is unsupported.`);
}

function compareProposalOrder(
	left: Readonly<{ startFrame: number; endFrame: number; kind: string; id: string }>,
	right: Readonly<{ startFrame: number; endFrame: number; kind: string; id: string }>,
): number {
	return left.startFrame - right.startFrame || left.endFrame - right.endFrame
		|| left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id);
}
