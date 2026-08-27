/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared strict re-admission for pathless Framescaper/highlight transform values. */

import type { AssistanceTrackedSubjectResultV1 } from './subject-tracker-v1.ts';
import { MAXIMUM_ASSISTANCE_EDITORIAL_CHAPTERS } from './m7-semantic-results.ts';
import { VIDEO_TIMING_ASSET_MAXIMUM_FRAMES } from '../video-timing-asset-reference.ts';
import {
	reviewAssistanceSourceTimeRowsV1,
	type AssistanceSourceTimeRowV1,
	type ReviewedAssistanceSourceTimeRowsV1,
} from './source-time-rows-v1.ts';
import type {
	AssistanceOwnedFramePackPlanV1,
	AssistanceOwnedHighlightCandidatesV1,
	AssistanceOwnedHighlightProposalsV1,
	AssistanceOwnedHighlightSignalsV1,
	AssistanceOwnedRankedHighlightCandidateV1,
	AssistanceVideoSourceTimeAuthorityV1,
} from './owned-video-highlight-transform-types-v1.ts';
import {
	ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_ITEMS,
	ownedArray,
	ownedBoolean,
	ownedExactRecord,
	ownedInteger,
	ownedNullableText,
	ownedText,
	ownedUnit,
} from './owned-transform-validation-v1.ts';

const ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const TICK = /^(?:0|[1-9]\d*)$/u;
const SHA256 = /^[a-f\d]{64}$/u;
const MAXIMUM_TICK = 0x7fff_ffff_ffff_ffffn;
const INVALID_TITLE = /(?:[\p{Cc}\p{Cf}\p{Zl}\p{Zp}`{}\\]|<[^>]*>|```|\[[^\]]*\]\([^)]*\)|\b(?:data|file|https?|javascript):|(?:^|\s)(?:\/|\.\.\/|[a-z]:[\\/])|#!|\$\(|\b(?:bash|cmd(?:\.exe)?|powershell|sh)\s+-c\b|(?:^|\s)(?:(?:\d{1,2}:)?\d{1,2}:\d{2}|frame\s+\d+|\d+(?:\.\d+)?\s*(?:frames?|hours?|milliseconds?|minutes?|ms|seconds?))(?=$|[\s,.;)]))/iu;

const SOURCE_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'sourceId', 'width', 'height', 'timescale',
	'sourceStartFrame', 'sourceEndFrame', 'presentationEndTick', 'frames',
] as const);
const SOURCE_FRAME_FIELDS = Object.freeze([
	'sourceFrame', 'presentationTick', 'timelineFrame',
] as const);
const FRAME_PACK_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'sourceId', 'width', 'height', 'timescale', 'frames',
] as const);
const PLAN_FRAME_FIELDS = Object.freeze([
	'resultId', 'shotId', 'anchor', 'sourceFrame', 'presentationTick', 'timelineFrame',
] as const);
const TRACKED_FIELDS = Object.freeze(['schemaVersion', 'width', 'height', 'timescale', 'frames'] as const);
const TRACKED_FRAME_FIELDS = Object.freeze(['sourceFrame', 'presentationTick', 'subjects'] as const);
const TRACKED_SUBJECT_FIELDS = Object.freeze(['trackId', 'kind', 'confidence', 'box'] as const);
const BOX_FIELDS = Object.freeze(['x', 'y', 'width', 'height'] as const);
const DIMENSION_FIELDS = Object.freeze(['width', 'height'] as const);
const SIGNALS_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'sourceId', 'sampleRate', 'sourceSize', 'candidates',
] as const);
const SIGNAL_FIELDS = Object.freeze([
	'id', 'startFrame', 'endFrame', 'sourceStartFrame', 'sourceEndFrame',
	'transcriptEvidence', 'transcriptExcerpt', 'visualSummary',
	'hook', 'conversationalStructure', 'excitement',
	'energyDynamics', 'semanticSelfContainedness', 'shotStructure', 'visualInterest',
	'speechlessAvailableWeight', 'duplication', 'videoOccurrenceId', 'audioOccurrenceId',
	'cropKeyframes',
] as const);
const CANDIDATES_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'sourceId', 'sampleRate', 'sourceSize', 'targetAspect', 'candidates',
] as const);
const RANKED_FIELDS = Object.freeze([
	'id', 'startFrame', 'endFrame', 'sourceStartFrame', 'sourceEndFrame', 'score',
	'evidenceMode', 'transcriptExcerpt', 'visualSummary', 'selected',
	'videoOccurrenceId', 'audioOccurrenceId', 'cropKeyframes',
] as const);
const PROPOSALS_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'workflowId', 'targetAspect', 'proposals',
] as const);
const PROPOSAL_FIELDS = Object.freeze([
	...RANKED_FIELDS, 'title', 'hook', 'chapters', 'explanation',
] as const);
const CROP_KEYFRAME_FIELDS = Object.freeze(['sourceFrame', 'authority', 'trackIds', 'crop'] as const);
const CROP_FIELDS = Object.freeze(['left', 'top', 'right', 'bottom'] as const);
const ANCHORS = new Set<unknown>([
	'first-quarter', 'first-third', 'midpoint', 'second-third', 'third-quarter',
]);

export function reviewOwnedVideoSourceTimeAuthorityV1(
	value: unknown,
): Omit<AssistanceVideoSourceTimeAuthorityV1, 'frames'> & Readonly<{
	readonly frames: ReviewedAssistanceSourceTimeRowsV1;
}> {
	const row = ownedExactRecord(value, SOURCE_FIELDS, 'video source-time authority');
	exactIdentity(row, 'video-source-time-authority', 'video source-time authority');
	const sourceId = stableId(row.sourceId, 'video source ID');
	const width = ownedInteger(row.width, 1, 4_096, 'video source width');
	const height = ownedInteger(row.height, 1, 4_096, 'video source height');
	const sourceStartFrame = ownedInteger(row.sourceStartFrame, 0, 0xffff_ffff,
		'video selected source start');
	const sourceEndFrame = ownedInteger(row.sourceEndFrame, sourceStartFrame + 1, 0xffff_ffff,
		'video selected source end');
	const timescale = ownedInteger(row.timescale, 1, 0x7fff_ffff, 'video source timescale');
	const frames = reviewVideoSourceFrames(row.frames);
	if (frames.first.sourceFrame !== sourceStartFrame
		|| frames.last.sourceFrame >= sourceEndFrame) {
		throw new RangeError('Video source-time authority must bind its selected start frame.');
	}
	const presentationEndTick = canonicalTick(row.presentationEndTick,
		'video source presentation end tick');
	if (BigInt(presentationEndTick) <= BigInt(frames.last.presentationTick)) {
		throw new RangeError('Video source presentation end must follow its final frame.');
	}
	return Object.freeze({ schemaVersion: 1, kind: 'video-source-time-authority',
		sourceId, width, height, sourceStartFrame, sourceEndFrame, timescale,
		presentationEndTick, frames });
}

function reviewVideoSourceFrames(value: unknown): ReviewedAssistanceSourceTimeRowsV1 {
	if (Array.isArray(value) && value[0] && typeof value[0] === 'object'
		&& (value[0] as Record<string, unknown>).kind === 'source-time-rows') {
		const reviewed = reviewAssistanceSourceTimeRowsV1(value);
		if (reviewed.rowCount > VIDEO_TIMING_ASSET_MAXIMUM_FRAMES) {
			throw new RangeError('Video source-time frames exceed their exact inventory bound.');
		}
		return reviewed;
	}
	let priorSource = -1;
	let priorTick = -1n;
	let priorTimeline = -1;
	const rows = ownedArray(value, VIDEO_TIMING_ASSET_MAXIMUM_FRAMES,
		'video source-time frames', 1).map((candidate, index) => {
		const label = `video source-time frame ${String(index)}`;
		const frame = ownedExactRecord(candidate, SOURCE_FRAME_FIELDS, label);
		const sourceFrame = ownedInteger(frame.sourceFrame, 0, 0xffff_ffff,
			`${label} source ordinal`);
		const presentationTick = canonicalTick(frame.presentationTick, `${label} presentation tick`);
		const timelineFrame = ownedInteger(frame.timelineFrame, 0, Number.MAX_SAFE_INTEGER,
			`${label} timeline frame`);
		if (sourceFrame <= priorSource || BigInt(presentationTick) <= priorTick
			|| timelineFrame < priorTimeline) {
			throw new RangeError('Video source-time authority must remain forward and monotonic.');
		}
		priorSource = sourceFrame;
		priorTick = BigInt(presentationTick);
		priorTimeline = timelineFrame;
		return Object.freeze({ sourceFrame, presentationTick, timelineFrame });
	});
	return sourceFrameReader(Object.freeze(rows));
}

function sourceFrameReader(rows: readonly AssistanceSourceTimeRowV1[]):
	ReviewedAssistanceSourceTimeRowsV1 {
	const row = (ordinal: number): AssistanceSourceTimeRowV1 => {
		if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= rows.length) {
			throw new RangeError('The video source-time row ordinal is invalid.');
		}
		return rows[ordinal]!;
	};
	return Object.freeze({ rowCount: rows.length, first: rows[0]!, last: rows.at(-1)!, row,
		firstAtOrAfterSource: (sourceFrame: number) => lowerBoundRows(rows,
			(candidate) => candidate.sourceFrame < sourceFrame),
		firstAtOrAfterPresentationTick: (presentationTick: string) => {
			const target = BigInt(canonicalTick(presentationTick, 'video source presentation tick'));
			return lowerBoundRows(rows, (candidate) => BigInt(candidate.presentationTick) < target);
		},
		firstAtOrAfterTimeline: (timelineFrame: number) => lowerBoundRows(rows,
			(candidate) => candidate.timelineFrame < timelineFrame),
		prefix: (rowCount: number) => {
			if (!Number.isSafeInteger(rowCount) || rowCount < 1 || rowCount > rows.length) {
				throw new RangeError('The video source-time prefix row count is invalid.');
			}
			return Object.freeze(rows.slice(0, rowCount));
		} });
}

function lowerBoundRows<T>(rows: readonly T[], before: (row: T) => boolean): number {
	let low = 0;
	let high = rows.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (before(rows[middle]!)) low = middle + 1;
		else high = middle;
	}
	return low;
}

export function reviewOwnedFramePackPlanV1(value: unknown): AssistanceOwnedFramePackPlanV1 {
	const row = ownedExactRecord(value, FRAME_PACK_FIELDS, 'owned frame-pack plan');
	exactIdentity(row, 'frame-pack-plan', 'owned frame-pack plan');
	const sourceId = stableId(row.sourceId, 'frame-pack source ID');
	const width = ownedInteger(row.width, 1, 4_096, 'frame-pack width');
	const height = ownedInteger(row.height, 1, 4_096, 'frame-pack height');
	const timescale = ownedInteger(row.timescale, 1, 0x7fff_ffff, 'frame-pack timescale');
	let priorSource = -1;
	let priorTick = -1n;
	let priorTimeline = -1;
	const frames = ownedArray(row.frames, ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_ITEMS,
		'frame-pack plan frames').map((candidate, index) => {
		const label = `frame-pack plan frame ${String(index)}`;
		const frame = ownedExactRecord(candidate, PLAN_FRAME_FIELDS, label);
		const resultId = stableId(frame.resultId, `${label} result ID`);
		if (resultId !== `visual-sample:${String(index)}`) {
			throw new TypeError('Frame-pack plan result identities must match exact row order.');
		}
		const sourceFrame = ownedInteger(frame.sourceFrame, 0, 0xffff_ffff,
			`${label} source frame`);
		const presentationTick = canonicalTick(frame.presentationTick,
			`${label} presentation tick`);
		const timelineFrame = ownedInteger(frame.timelineFrame, 0, Number.MAX_SAFE_INTEGER,
			`${label} timeline frame`);
		if (sourceFrame <= priorSource || BigInt(presentationTick) <= priorTick
			|| timelineFrame < priorTimeline) {
			throw new RangeError('Frame-pack plan authority must remain strictly source ordered.');
		}
		priorSource = sourceFrame;
		priorTick = BigInt(presentationTick);
		priorTimeline = timelineFrame;
		if (!ANCHORS.has(frame.anchor)) throw new TypeError(`${label} anchor is unsupported.`);
		return Object.freeze({ resultId, shotId: stableId(frame.shotId, `${label} shot ID`),
			anchor: frame.anchor as AssistanceOwnedFramePackPlanV1['frames'][number]['anchor'],
			sourceFrame, presentationTick, timelineFrame });
	});
	return Object.freeze({ schemaVersion: 1, kind: 'frame-pack-plan', sourceId,
		width, height, timescale, frames: Object.freeze(frames) });
}

export function reviewOwnedTrackedSubjectsV1(value: unknown): AssistanceTrackedSubjectResultV1 {
	const row = ownedExactRecord(value, TRACKED_FIELDS, 'owned tracked-subject result');
	if (row.schemaVersion !== 1) throw new TypeError('The tracked-subject schema version is unsupported.');
	const width = ownedInteger(row.width, 1, 4_096, 'tracked-subject width');
	const height = ownedInteger(row.height, 1, 4_096, 'tracked-subject height');
	const timescale = ownedInteger(row.timescale, 1, 0x7fff_ffff, 'tracked-subject timescale');
	let priorFrame = -1;
	let priorTick = -1n;
	const frames = ownedArray(row.frames, ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_ITEMS,
		'tracked-subject frames', 1).map((candidate, index) => {
		const label = `tracked-subject frame ${String(index)}`;
		const frame = ownedExactRecord(candidate, TRACKED_FRAME_FIELDS, label);
		const sourceFrame = ownedInteger(frame.sourceFrame, 0, 0xffff_ffff, `${label} source frame`);
		const presentationTick = canonicalTick(frame.presentationTick, `${label} presentation tick`);
		if (sourceFrame <= priorFrame || BigInt(presentationTick) <= priorTick) {
			throw new RangeError('Tracked-subject frames must remain strictly ordered.');
		}
		priorFrame = sourceFrame;
		priorTick = BigInt(presentationTick);
		let priorTrack = '';
		const subjects = ownedArray(frame.subjects, 256, `${label} subjects`).map((candidateSubject) => {
			const subject = ownedExactRecord(candidateSubject, TRACKED_SUBJECT_FIELDS, `${label} subject`);
			const trackId = stableId(subject.trackId, `${label} track ID`);
			if (trackId <= priorTrack) throw new TypeError(`${label} track IDs must be sorted and unique.`);
			priorTrack = trackId;
			if (subject.kind !== 'face' && subject.kind !== 'object') {
				throw new TypeError(`${label} subject kind is unsupported.`);
			}
			return Object.freeze({ trackId, kind: subject.kind,
				confidence: ownedUnit(subject.confidence, `${label} subject confidence`),
				box: normalizedBox(subject.box, `${label} subject box`) });
		});
		return Object.freeze({ sourceFrame, presentationTick, subjects: Object.freeze(subjects) });
	});
	return Object.freeze({ schemaVersion: 1, width, height, timescale, frames: Object.freeze(frames) });
}

export function reviewOwnedHighlightSignalsV1(value: unknown): AssistanceOwnedHighlightSignalsV1 {
	const row = ownedExactRecord(value, SIGNALS_FIELDS, 'owned highlight signals');
	exactIdentity(row, 'highlight-signals', 'owned highlight signals');
	const seen = new Set<string>();
	const candidates = ownedArray(row.candidates, ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_ITEMS,
		'highlight signal candidates').map((candidate, index) => {
		const label = `highlight signal candidate ${String(index)}`;
		const item = ownedExactRecord(candidate, SIGNAL_FIELDS, label);
		const id = uniqueId(item.id, seen, label);
		const range = timingRange(item, label);
		const transcriptEvidence = ownedBoolean(item.transcriptEvidence,
			`${label} transcript evidence`);
		const transcriptExcerpt = ownedNullableText(item.transcriptExcerpt, 8_192,
			`${label} transcript excerpt`);
		if (transcriptEvidence !== (transcriptExcerpt !== null)) {
			throw new TypeError(`${label} transcript excerpt disagrees with its evidence mode.`);
		}
		return Object.freeze({ id, ...range, transcriptEvidence, transcriptExcerpt,
			visualSummary: ownedText(item.visualSummary, 2_048, `${label} visual summary`),
			hook: ownedUnit(item.hook, `${label} hook`),
			conversationalStructure: ownedUnit(item.conversationalStructure, `${label} structure`),
			excitement: ownedUnit(item.excitement, `${label} excitement`),
			energyDynamics: ownedUnit(item.energyDynamics, `${label} energy`),
			semanticSelfContainedness: ownedUnit(item.semanticSelfContainedness,
				`${label} self-containedness`),
			shotStructure: ownedUnit(item.shotStructure, `${label} shot structure`),
			visualInterest: ownedUnit(item.visualInterest, `${label} visual interest`),
			speechlessAvailableWeight: ownedUnit(item.speechlessAvailableWeight,
				`${label} speechless available weight`),
			duplication: ownedUnit(item.duplication, `${label} duplication`),
			videoOccurrenceId: stableId(item.videoOccurrenceId, `${label} video occurrence`),
			audioOccurrenceId: nullableStableId(item.audioOccurrenceId,
				`${label} audio occurrence`),
			cropKeyframes: reviewCropKeyframes(item.cropKeyframes, range, label) });
	});
	return Object.freeze({ schemaVersion: 1, kind: 'highlight-signals',
		sourceId: stableId(row.sourceId, 'highlight source ID'),
		sampleRate: ownedInteger(row.sampleRate, 1, 768_000, 'highlight sample rate'),
		sourceSize: dimensions(row.sourceSize, 'highlight source size'),
		candidates: Object.freeze(candidates) });
}

export function reviewOwnedHighlightCandidatesV1(value: unknown): AssistanceOwnedHighlightCandidatesV1 {
	const row = ownedExactRecord(value, CANDIDATES_FIELDS, 'owned highlight candidates');
	exactIdentity(row, 'highlight-candidates', 'owned highlight candidates');
	const seen = new Set<string>();
	const candidates = ownedArray(row.candidates, 20, 'ranked highlight candidates').map(
		(candidate, index) => rankedCandidate(candidate, index, seen));
	return Object.freeze({ schemaVersion: 1, kind: 'highlight-candidates',
		sourceId: stableId(row.sourceId, 'ranked highlight source ID'),
		sampleRate: ownedInteger(row.sampleRate, 1, 768_000, 'ranked highlight sample rate'),
		sourceSize: dimensions(row.sourceSize, 'ranked highlight source size'),
		targetAspect: dimensions(row.targetAspect, 'ranked highlight target aspect'),
		candidates: Object.freeze(candidates) });
}

export function reviewOwnedHighlightProposalsV1(value: unknown): AssistanceOwnedHighlightProposalsV1 {
	const row = ownedExactRecord(value, PROPOSALS_FIELDS, 'owned highlight proposals');
	if (row.schemaVersion !== 1 || row.kind !== 'highlight-proposals'
		|| row.workflowId !== 'make-highlights') {
		throw new TypeError('The owned highlight proposal identity is unsupported.');
	}
	const aspect = dimensions(row.targetAspect, 'highlight proposal target aspect');
	if (aspect.width !== 9 || aspect.height !== 16) {
		throw new RangeError('Highlight proposals require the authenticated 9:16 target aspect.');
	}
	const seen = new Set<string>();
	const proposals = ownedArray(row.proposals, 20, 'owned highlight proposals').map(
		(candidate, index) => {
			const label = `owned highlight proposal ${String(index)}`;
			const item = ownedExactRecord(candidate, PROPOSAL_FIELDS, label);
			const base = rankedCandidate(item, index, seen, true);
			const title = ownedText(item.title, 160, `${label} title`);
			if (title !== title.trim() || INVALID_TITLE.test(title)) {
				throw new TypeError(`${label} title must be inert, non-executable plain text.`);
			}
			const hook = editorialText(item.hook, 512, `${label} hook`);
			const explanation = editorialText(item.explanation, 2_048, `${label} explanation`);
			const chapters = ownedArray(item.chapters, MAXIMUM_ASSISTANCE_EDITORIAL_CHAPTERS,
				`${label} chapters`).map((chapter, chapterIndex) => {
				const reviewed = ownedText(chapter, 160,
					`${label} chapter ${String(chapterIndex)}`);
				if (reviewed !== reviewed.trim() || INVALID_TITLE.test(reviewed)) {
					throw new TypeError(`${label} chapters must be inert, non-executable plain text.`);
				}
				return reviewed;
			});
			return Object.freeze({ ...base, title, hook, chapters: Object.freeze(chapters),
				explanation });
		});
	return Object.freeze({ schemaVersion: 1, kind: 'highlight-proposals',
		workflowId: 'make-highlights', targetAspect: Object.freeze({ width: 9, height: 16 }),
		proposals: Object.freeze(proposals) });
}

function editorialText(value: unknown, maximum: number, label: string): string | null {
	const reviewed = ownedNullableText(value, maximum, label);
	if (reviewed !== null && (reviewed !== reviewed.trim() || INVALID_TITLE.test(reviewed))) {
		throw new TypeError(`${label} must be inert, non-executable plain text.`);
	}
	return reviewed;
}

export function ownedSha256(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}

export function stableId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}

export function canonicalTick(value: unknown, label: string): string {
	if (typeof value !== 'string' || !TICK.test(value) || BigInt(value) > MAXIMUM_TICK) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return value;
}

export function dimensions(value: unknown, label: string): Readonly<{ width: number; height: number }> {
	const row = ownedExactRecord(value, DIMENSION_FIELDS, label);
	return Object.freeze({ width: ownedInteger(row.width, 1, 4_096, `${label} width`),
		height: ownedInteger(row.height, 1, 4_096, `${label} height`) });
}

function rankedCandidate(
	value: unknown,
	index: number,
	seen: Set<string>,
	proposal = false,
): AssistanceOwnedRankedHighlightCandidateV1 {
	const label = `${proposal ? 'proposal' : 'ranked'} highlight candidate ${String(index)}`;
	const item = proposal ? value as Record<typeof RANKED_FIELDS[number], unknown>
		: ownedExactRecord(value, RANKED_FIELDS, label);
	const id = uniqueId(item.id, seen, label);
	const range = timingRange(item, label);
	if (item.evidenceMode !== 'transcript' && item.evidenceMode !== 'speechless') {
		throw new TypeError(`${label} evidence mode is unsupported.`);
	}
	const transcriptExcerpt = ownedNullableText(item.transcriptExcerpt, 8_192,
		`${label} transcript excerpt`);
	if ((item.evidenceMode === 'transcript') !== (transcriptExcerpt !== null)) {
		throw new TypeError(`${label} transcript excerpt disagrees with its evidence mode.`);
	}
	if (item.selected !== false) throw new TypeError(`${label} must begin unselected.`);
	return Object.freeze({ id, ...range, score: ownedUnit(item.score, `${label} score`),
		evidenceMode: item.evidenceMode, transcriptExcerpt,
		visualSummary: ownedText(item.visualSummary, 2_048, `${label} visual summary`), selected: false,
		videoOccurrenceId: stableId(item.videoOccurrenceId, `${label} video occurrence`),
		audioOccurrenceId: nullableStableId(item.audioOccurrenceId, `${label} audio occurrence`),
		cropKeyframes: reviewCropKeyframes(item.cropKeyframes, range, label) });
}

function reviewCropKeyframes(
	value: unknown,
	range: Readonly<{ sourceStartFrame: number; sourceEndFrame: number }>,
	label: string,
) {
	let priorFrame = range.sourceStartFrame - 1;
	const cropKeyframes = ownedArray(value, 4_096, `${label} crop keyframes`, 2)
		.map((candidate, index) => {
			const keyframe = ownedExactRecord(candidate, CROP_KEYFRAME_FIELDS,
				`${label} crop keyframe ${String(index)}`);
			const sourceFrame = ownedInteger(keyframe.sourceFrame, range.sourceStartFrame,
				range.sourceEndFrame - 1, `${label} crop source frame`);
			if (sourceFrame <= priorFrame) throw new RangeError(`${label} crops must be ordered.`);
			priorFrame = sourceFrame;
			if (keyframe.authority !== 'subject' && keyframe.authority !== 'saliency'
				&& keyframe.authority !== 'center') {
				throw new TypeError(`${label} crop authority is invalid.`);
			}
			const trackIds = ownedArray(keyframe.trackIds, 256, `${label} crop track IDs`)
				.map((id) => stableId(id, `${label} crop track ID`));
			if (trackIds.some((id, trackIndex) => trackIndex > 0
				&& id <= trackIds[trackIndex - 1]!)) {
				throw new TypeError(`${label} crop tracks are invalid.`);
			}
			if ((keyframe.authority === 'subject') !== (trackIds.length > 0)) {
				throw new TypeError(`${label} crop subject authority is ambiguous.`);
			}
			return Object.freeze({ sourceFrame, authority: keyframe.authority,
				trackIds: Object.freeze(trackIds), crop: crop(keyframe.crop, label) });
		});
	if (cropKeyframes[0]!.sourceFrame !== range.sourceStartFrame
		|| cropKeyframes.at(-1)!.sourceFrame !== range.sourceEndFrame - 1) {
		throw new RangeError(`${label} crops must bind both exact proposal boundaries.`);
	}
	return Object.freeze(cropKeyframes);
}

function nullableStableId(value: unknown, label: string): string | null {
	return value === null ? null : stableId(value, label);
}

function timingRange(row: Record<string, unknown>, label: string): Readonly<{
	startFrame: number; endFrame: number; sourceStartFrame: number; sourceEndFrame: number;
}> {
	const startFrame = ownedInteger(row.startFrame, 0, Number.MAX_SAFE_INTEGER, `${label} start`);
	const endFrame = ownedInteger(row.endFrame, 1, Number.MAX_SAFE_INTEGER, `${label} end`);
	const sourceStartFrame = ownedInteger(row.sourceStartFrame, 0, Number.MAX_SAFE_INTEGER,
		`${label} source start`);
	const sourceEndFrame = ownedInteger(row.sourceEndFrame, 1, Number.MAX_SAFE_INTEGER,
		`${label} source end`);
	if (endFrame <= startFrame || sourceEndFrame <= sourceStartFrame) {
		throw new RangeError(`${label} must have positive exact timing.`);
	}
	return Object.freeze({ startFrame, endFrame, sourceStartFrame, sourceEndFrame });
}

function normalizedBox(value: unknown, label: string): Readonly<{
	x: number; y: number; width: number; height: number;
}> {
	const row = ownedExactRecord(value, BOX_FIELDS, label);
	const x = ownedUnit(row.x, `${label} x`);
	const y = ownedUnit(row.y, `${label} y`);
	const width = ownedUnit(row.width, `${label} width`);
	const height = ownedUnit(row.height, `${label} height`);
	if (width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
		throw new RangeError(`${label} exceeds normalized geometry.`);
	}
	return Object.freeze({ x, y, width, height });
}

function crop(value: unknown, label: string): Readonly<{
	left: number; top: number; right: number; bottom: number;
}> {
	const row = ownedExactRecord(value, CROP_FIELDS, `${label} crop`);
	const result = Object.freeze({ left: ownedUnit(row.left, `${label} crop left`),
		top: ownedUnit(row.top, `${label} crop top`),
		right: ownedUnit(row.right, `${label} crop right`),
		bottom: ownedUnit(row.bottom, `${label} crop bottom`) });
	if (result.left + result.right >= 1 || result.top + result.bottom >= 1) {
		throw new RangeError(`${label} crop has no aperture.`);
	}
	return result;
}

function uniqueId(value: unknown, seen: Set<string>, label: string): string {
	const id = stableId(value, `${label} ID`);
	if (seen.has(id)) throw new TypeError(`${label} repeats an identity.`);
	seen.add(id);
	return id;
}

function exactIdentity(
	row: Record<'schemaVersion' | 'kind', unknown>,
	kind: string,
	label: string,
): void {
	if (row.schemaVersion !== 1 || row.kind !== kind) {
		throw new TypeError(`The ${label} identity is unsupported.`);
	}
}
